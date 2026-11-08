import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGtin,identifierCandidates} from '../server/identifiers.mjs';
import {exactMatch} from '../server/exact-rules.mjs';
import {fieldDefinitions} from '../server/enrichment-fields.mjs';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {EnrichmentService} from '../server/enrichment.mjs';
import {MatchingService} from '../server/matching.mjs';
import {normalizeOffer} from '../server/costco.mjs';
import {createApp} from '../server/app.mjs';
import {DemoProvider} from '../server/demo.mjs';
const code='012345678905';
const reviewed=(value)=>({value,reviewState:'confirmed'});
function fields(){
  const result=Object.fromEntries(fieldDefinitions.map(f=>[f.id,{value:null,reviewState:'not_applicable'}]));
  for(const [id,value]of Object.entries({productName:'Protein Shake',productType:'Protein Shake',packCount:10,packUnit:'bottles',sizeValue:14,sizeUnit:'fl oz',sizeBasis:'per_unit',flavor:'Chocolate',isVariety:'no'}))result[id]=reviewed(value);
  return result;
}
const source=()=>({productKey:'costco|item:123',brand:'Example Brand',sourceSignature:'signature-1',revision:2,lastReviewedAt:'2026-11-08T12:00:00Z',sourceChanged:false,fields:fields()});
const sourceUpc=()=>({value:code,status:'verified',scope:'club_package',sourceSignature:'signature-1'});
const candidate=()=>({asin:'B000000001',title:'Example Brand Protein Shake',brand:'Example Brand',fields:fields(),upc:code,upcScope:'amazon_package',upcVerified:true,detailsReviewed:true});
const clone=x=>JSON.parse(JSON.stringify(x));
function offer(changes={},at='2026-11-08T12:00:00.000Z'){
  return normalizeOffer({item_number:'123',product_id:'456',title:'Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack',brand:'Example Brand',warehouse:{warehouse_id:'1062',price:19.97},...changes},
    {warehouse:'1062',categories:[{id:'grocery',name:'Grocery'}],types:['clearance'],scanId:'test-scan',endpoint:'costco/category',observedAt:at});
}
async function setup(provider={configured:()=>true}){
  const db=await openDatabase(),store=new Store(db),enrichment=new EnrichmentService(store),matching=new MatchingService(store,enrichment,provider);
  await store.saveJob({id:'test-scan',createdAt:'2026-11-08T12:00:00.000Z',status:'complete',tasks:[]});
  const o=offer();await db.transaction(tx=>store.saveOffer(tx,'test-scan',o));
  let {profile}=await enrichment.get(o.productKey);
  const input={action:'confirm',revision:profile.revision,sourceSignature:profile.sourceSignature,actor:'Test reviewer',note:'Checked explicit package identity.',fields:fields()};
  profile=(await enrichment.save(o.productKey,input)).profile;
  return {db,store,enrichment,matching,key:o.productKey,profile};
}
const upcInput=profile=>({value:code,status:'verified',scope:'club_package',sourceKind:'package_barcode',sourceUrl:'',note:'Read the full outer package barcode.',actor:'Test reviewer',checkedPackage:true,revision:0,profileRevision:profile.revision,sourceSignature:profile.sourceSignature});
const candidateInput=profile=>({...candidate(),actor:'Test reviewer',note:'Checked the child ASIN package.',sourceUrl:'https://www.amazon.com/dp/B000000001',revision:0,profileRevision:profile.revision,sourceSignature:profile.sourceSignature});

test('GTIN validation preserves leading zeroes and canonicalizes equivalent UPC/EAN encodings',()=>{
  for(const value of [code,'036000291452','4006381333931','96385074'])assert.equal(validateGtin(value).valid,true,value);
  assert.equal(validateGtin(code).gtin14,validateGtin('0'+code).gtin14);
  assert.equal(validateGtin(code).value,code);
  for(const value of [12345678905,'012345678904','SKU012345678905','000000000000','123','',null])assert.equal(validateGtin(value).valid,false);
});
test('only explicit identifier fields become suggestions; SKUs and item numbers are excluded',()=>{
  const found=identifierCandidates({item_number:code,sku:code,ASIN:'B000000001',specifications:[{name:'UPC',value:code}],variants:[{gtin13:'0'+code}]});
  assert.equal(found.length,2);assert(found.every(r=>r.verified===false&&r.scope==='unknown'));assert(found.every(r=>!r.path.includes('item_number')&&!r.path.includes('sku')));
});
test('verified full-package UPC and reviewed package facts produce the primary exact route',()=>{
  const result=exactMatch(source(),sourceUpc(),candidate());
  assert.equal(result.route,'exact');assert.equal(result.method,'verified_upc');assert.equal(result.purchaseApproved,false);assert.equal(result.secondaryEngine,false);
});
test('a shared UPC cannot bypass brand, size, flavor or formulation contradictions',()=>{
  for(const [field,value]of [['packCount',12],['sizeValue',16],['flavor','Vanilla'],['variant','Different formulation']]){
    const c=candidate();c.fields[field]=reviewed(value);
    assert.notEqual(exactMatch(source(),sourceUpc(),c).route,'exact',field);
  }
  const c=candidate();c.brand='Other Brand';assert.equal(exactMatch(source(),sourceUpc(),c).route,'mismatch');
});
test('inner-unit and stale UPC evidence cannot masquerade as a verified package match',()=>{
  for(const upc of [{...sourceUpc(),scope:'inner_unit'},{...sourceUpc(),sourceSignature:'old-signature'},{...sourceUpc(),status:'unverified'}]){
    const result=exactMatch(source(),upc,candidate());assert.notEqual(result.method,'verified_upc');
    assert(result.warnings.some(w=>w.includes('UPC unverified')));
  }
});
test('strict reviewed identity can enter normal exact review with the explicit UPC-unverified flag',()=>{
  const c=candidate();c.upc='';c.upcVerified=false;
  const result=exactMatch(source(),null,c);assert.equal(result.route,'exact');assert.equal(result.method,'reviewed_details_upc_unverified');assert(result.warnings.some(w=>w.includes('UPC unverified')));
  c.fields.productName=reviewed('A different product');assert.notEqual(exactMatch(source(),null,c).route,'exact');
});
test('unknown fields and changed source evidence remain needs-information',()=>{
  const c=candidate();c.fields.packCount={value:null,reviewState:'not_applicable'};assert.equal(exactMatch(source(),sourceUpc(),c).route,'needs_information');
  assert.equal(exactMatch({...source(),sourceChanged:true},sourceUpc(),candidate()).route,'needs_information');
  assert.equal(exactMatch({...source(),lastReviewedAt:null},sourceUpc(),candidate()).route,'needs_information');
  assert.equal(exactMatch(source(),sourceUpc(),{...candidate(),detailsReviewed:false}).route,'needs_information');
});
test('pack-only alternatives are parked; wrong flavor remains excluded even when the pack also differs',()=>{
  const c=candidate();c.fields.packCount=reviewed(20);
  assert.equal(exactMatch(source(),sourceUpc(),c).route,'potential');
  c.fields.flavor=reviewed('Vanilla');assert.equal(exactMatch(source(),sourceUpc(),c).route,'mismatch');
});
test('different supplied package UPCs are held separately rather than treated as exact',()=>{
  const c=candidate();c.upc='036000291452';
  assert.equal(exactMatch(source(),sourceUpc(),c).route,'potential');
});
test('UPC evidence requires a check digit, package scope and human evidence, with history and concurrency checks',async()=>{
  const {db,matching,key,profile}=await setup();
  try{
    for(const patch of [{value:'012345678904'},{scope:'unknown'},{checkedPackage:false}])await assert.rejects(matching.saveUpc(key,{...upcInput(profile),...patch}),e=>e.code==='UPC_NOT_VERIFIABLE');
    await matching.saveUpc(key,upcInput(profile));
    const context=await matching.get(key);assert.equal(context.upc.value,code);assert.equal(context.upcHistory.length,1);
    await assert.rejects(matching.saveUpc(key,upcInput(profile)),e=>e.code==='UPC_REVIEW_OUTDATED');
    await assert.rejects(matching.saveUpc(key,{...upcInput(profile),revision:1,sourceUrl:'https://example.com/?api_key=private'}),e=>e.code==='EVIDENCE_URL_INVALID');
  }finally{await db.close();}
});
test('all exact ASIN candidates are retained and price-only rescans preserve classification',async()=>{
  const {db,store,matching,key,profile}=await setup();
  try{
    await matching.saveUpc(key,upcInput(profile));
    await matching.saveCandidate(key,candidateInput(profile));
    await matching.saveCandidate(key,{...candidateInput(profile),asin:'B000000002'});
    let context=await matching.get(key);assert.equal(context.candidates.length,2);assert(context.candidates.every(c=>c.result.route==='exact'));
    await db.transaction(tx=>store.saveOffer(tx,'test-scan',offer({warehouse:{warehouse_id:'1062',price:9.97}},'2026-11-09T12:00:00.000Z')));
    context=await matching.get(key);assert(context.candidates.every(c=>c.result.method==='verified_upc'));
    const list=await matching.list();assert.equal(list.products[0].counts.exact,2);assert.equal(list.secondaryEngineConnected,false);
  }finally{await db.close();}
});
test('changed packaging invalidates current matching without erasing previous candidate evidence',async()=>{
  const {db,store,matching,key,profile}=await setup();
  try{
    await matching.saveUpc(key,upcInput(profile));await matching.saveCandidate(key,candidateInput(profile));
    await db.transaction(tx=>store.saveOffer(tx,'test-scan',offer({title:'Example Brand Chocolate Protein Shake, 14 fl oz, 12-pack'},'2026-11-09T12:00:00.000Z')));
    const context=await matching.get(key);assert.equal(context.candidates[0].result.route,'needs_information');
    const history=await matching.candidateHistory(key,'B000000001');assert.equal(history[0].body.result.route,'exact');
    await assert.rejects(matching.saveCandidate(key,{...candidateInput(profile),revision:1}),e=>e.code==='MATCH_SOURCE_CHANGED');
  }finally{await db.close();}
});
test('retailer detail lookup accepts identifiers only from the exact requested retailer item',async()=>{
  let wrong=false,calls=0;
  const provider={configured:()=>true,async call(endpoint,body){calls++;assert.equal(endpoint,'costco/product');assert.deepEqual(body.item_ids,['456']);return {json:{data:{products:[{item_number:wrong?'999':'123',product_id:wrong?'other':'456',specifications:[{name:'UPC',value:code}]}]}},cached:false,observedAt:'2026-11-08T12:00:00.000Z'};}};
  const {db,matching,key}=await setup(provider);
  try{
    const lookup=await matching.retailerDetails(key);assert.equal(lookup.found,1);
    let context=await matching.get(key);assert.equal(context.upc,null);assert(context.suggestions.some(s=>s.raw===code));assert.equal(context.lookups.length,1);
    wrong=true;await assert.rejects(matching.retailerDetails(key),e=>e.code==='DETAIL_IDENTITY_UNVERIFIED');
    context=await matching.get(key);assert.equal(context.lookups.length,1);assert.equal(calls,2);
  }finally{await db.close();}
});
test('matching API is session-protected and leaves live catalog and purchasing disabled',async()=>{
  const db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:new DemoProvider(),demo:true}),base=await app.listen(0);
  try{
    assert.equal((await fetch(base+'/api/matching')).status,403);
    const result=await (await fetch(base+'/api/matching',{headers:{'x-50toc-session':app.session}})).json();
    assert.equal(result.liveCatalogConnected,false);assert.equal(result.secondaryEngineConnected,false);
  }finally{await app.close();}
});
