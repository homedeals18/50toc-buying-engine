import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {EnrichmentService} from '../server/enrichment.mjs';
import {fieldDefinitions,extractDetails,sourceSignature} from '../server/enrichment-fields.mjs';
import {normalizeOffer} from '../server/costco.mjs';
import {createApp} from '../server/app.mjs';
import {DemoProvider} from '../server/demo.mjs';

const category={id:'grocery',slug:'grocery',name:'Grocery'};
const title='Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack';
function offer(overrides={},warehouse='1062',observedAt='2026-11-08T12:00:00.000Z'){
  return normalizeOffer({item_number:'123',product_id:'456',title,brand:'Example Brand',price:29.99,pack_count:10,size:'14 fl oz',warehouse:{warehouse_id:warehouse,price:19.97},...overrides},
    {warehouse,categories:[category],types:['clearance'],scanId:'test-scan',endpoint:'costco/category',observedAt});
}
async function setup(){
  const db=await openDatabase(),store=new Store(db),service=new EnrichmentService(store);
  await store.saveJob({id:'test-scan',createdAt:'2026-11-08T12:00:00.000Z',status:'complete',tasks:[]});
  return {db,store,service};
}
async function saveOffer(store,record){await store.db.transaction(db=>store.saveOffer(db,'test-scan',record));}
const known=v=>v!==null&&v!==undefined&&v!=='';
function payload(profile,action='confirm'){
  return {action,revision:profile.revision,sourceSignature:profile.sourceSignature,actor:'Test reviewer',note:'Checked the title and explicit package facts.',
    fields:Object.fromEntries(fieldDefinitions.map(d=>[d.id,{value:profile.fields[d.id].value,reviewState:known(profile.fields[d.id].value)?'confirmed':'not_applicable'}]))};
}

test('extracts individual size, count, form and flavor with original evidence',()=>{
  const result=extractDetails([offer()]);
  assert.equal(result.fields.packCount.value,10);assert.equal(result.fields.sizeValue.value,14);assert.equal(result.fields.sizeUnit.value,'fl oz');assert.equal(result.fields.flavor.value,'Chocolate');
  assert.equal(result.fields.productName.value,'Protein Shake');assert.equal(result.fields.productType.value.toLowerCase(),'protein shake');
  assert.equal(result.fields.sizeBasis.value,'per_unit');assert(result.fields.sizeBasis.evidence.some(e=>e.inferred));
  assert.equal(result.fields.packCount.reviewState,'unreviewed');assert.equal(result.photoAnalysis,'not_connected');
});
test('conflicting API and title quantities remain unresolved',()=>{
  const result=extractDetails([offer({pack_count:12})]);
  assert.equal(result.fields.packCount.value,null);assert.equal(result.fields.packCount.origin,'conflict');
  assert.deepEqual(result.candidates.packCount.map(c=>c.value).sort((a,b)=>a-b),[10,12]);
  assert(result.conflicts.some(c=>c.field==='packCount'));
});
test('does not invent a scent, a single-container count or a total size',()=>{
  const result=extractDetails([offer({title:'Example Brand Original Detergent, 150 fl oz',pack_count:null,size:'150 fl oz'})]);
  assert.equal(result.fields.scent.value,null);assert.equal(result.fields.packCount.value,null);
  assert.equal(result.fields.sizeValue.value,150);assert.equal(result.fields.sizeBasis.value,'unspecified');
  assert.equal(result.fields.variant.value,'Original');assert.equal(result.fields.isVariety.value,null);
});
test('inner contents require explicit per-container wording',()=>{
  const ambiguous=extractDetails([offer({title:'Example Brand Wipes, 8 pouches, 480 wipes',pack_count:8,size:null})]);
  assert.equal(ambiguous.fields.innerCount.value,null);assert.equal(ambiguous.fields.contentsCount.value,null);
  assert(ambiguous.issues.some(i=>i.includes('whether the count is per container or total')));
  const explicit=extractDetails([offer({title:'Example Brand Wipes, 8 pouches, 60 wipes per pouch',pack_count:8,size:null})]);
  assert.equal(explicit.fields.innerCount.value,60);assert.equal(explicit.fields.packCount.value,8);
  const total=extractDetails([offer({title:'Example Brand Wipes, 8 pouches, 480 wipes total',pack_count:8,size:null})]);
  assert.equal(total.fields.contentsCount.value,480);assert.equal(total.fields.innerCount.value,null);
});
test('strength, nutritional claims and multiple sizes are not conflated',()=>{
  const vitamin=extractDetails([offer({title:'Example Brand Vitamin C, 500 mg, 120 tablets',pack_count:null,size:null})]);
  assert.equal(vitamin.fields.strength.value,'500 mg');assert.equal(vitamin.fields.sizeValue.value,null);
  const shake=extractDetails([offer({title:'Example Brand Chocolate Protein Shake, 30 g protein, 14 fl oz, 10-pack'})]);
  assert.equal(shake.fields.sizeValue.value,14);
  const multiple=extractDetails([offer({title:'Example Brand Drink 14 fl oz / 414 mL, 10-pack',size:null})]);
  assert.equal(multiple.fields.sizeValue.value,null);assert(multiple.issues.some(i=>i.includes('Multiple sizes')));
});
test('variety labels and flavor names are handled conservatively',()=>{
  const rainbow=extractDetails([offer({title:'Example Brand Rainbow Drink, 12 fl oz, 10-pack',size:'12 fl oz'})]);
  assert.equal(rainbow.fields.isVariety.value,null);assert.equal(rainbow.fields.flavor.value,null);
  const variety=extractDetails([offer({title:'Example Brand Sparkling Water, Variety Pack, 12 fl oz, 24-pack',pack_count:24,size:'12 fl oz'})]);
  assert.equal(variety.fields.isVariety.value,'yes');
});
test('a tablet count is contents, not a count of bottles',()=>{
  const result=extractDetails([offer({title:'Example Brand Vitamin C Capsules, 120-count',pack_count:null,size:null})]);
  assert.equal(result.fields.packCount.value,null);assert.equal(result.fields.contentsCount.value,120);
  assert.equal(result.fields.contentsUnit.value,'capsules');
  const ambiguous=extractDetails([offer({title:'Example Brand Vitamin C Capsules, 120-count',pack_count:2,size:null})]);
  assert.equal(ambiguous.fields.packCount.value,2);assert.equal(ambiguous.fields.contentsCount.value,null);
  assert(ambiguous.issues.some(i=>i.includes('multiple containers')));
});
test('price, timestamps and duplicate warehouse observations do not change identity signature',()=>{
  const a=offer(),b={...a,warehouseId:'306',warehousePrice:7.97,observedAt:'2026-11-09T12:00:00.000Z'};
  assert.equal(sourceSignature([a]),sourceSignature([b]));assert.equal(sourceSignature([a,b]),sourceSignature([a]));
  assert.notEqual(sourceSignature([a]),sourceSignature([{...a,title:title.replace('10-pack','12-pack')}]));
  assert.notEqual(sourceSignature([a]),sourceSignature([{...a,imageUrl:'https://example.com/new-package.jpg'}]));
});
test('research ingestion creates one shared enrichment record per club product',async()=>{
  const {db,store,service}=await setup();
  try{
    await saveOffer(store,offer());await saveOffer(store,offer({},'306'));
    const list=await service.list();assert.equal(list.total,1);assert.deepEqual(list.products[0].warehouses.sort(),['1062','306']);
    assert.equal(list.products[0].status,'not_reviewed');
    assert.equal((await service.get(offer().productKey)).history.length,1);
  }finally{await db.close();}
});
test('confirmation saves reviewed values, actor and append-only history without changing source facts',async()=>{
  const {db,store,service}=await setup();
  try{
    const original=offer();await saveOffer(store,original);
    const {profile}=await service.get(original.productKey);
    const input=payload(profile);input.fields.productName.value='Chocolate Protein Shake';
    const result=await service.save(original.productKey,input);
    assert.equal(result.profile.status,'reviewed');assert.equal(result.profile.fields.productName.value,'Chocolate Protein Shake');assert.equal(result.profile.fields.productName.origin,'reviewer');
    assert.equal(result.history.length,2);assert.equal(result.history[0].body.actor,'Test reviewer');
    assert.equal((await store.offer(original.id)).title,original.title);
    assert.equal(result.history[1].body.identity.fields.productName.value,'Protein Shake');
  }finally{await db.close();}
});
test('draft saves do not become completed reviews and unknowns remain flagged',async()=>{
  const {db,store,service}=await setup();
  try{
    const original=offer();await saveOffer(store,original);
    let {profile}=await service.get(original.productKey);
    const draft=payload(profile,'save_draft');draft.fields.packCount={value:null,reviewState:'unreviewed'};
    const saved=await service.save(original.productKey,draft);assert.equal(saved.profile.status,'draft');
    profile=saved.profile;const incomplete=payload(profile);incomplete.fields.packCount={value:null,reviewState:'unreviewed'};
    const confirmed=await service.save(original.productKey,incomplete);
    assert.equal(confirmed.profile.status,'reviewed_with_gaps');assert(confirmed.profile.reviewIssues.some(x=>x.includes('Containers per club package')));
  }finally{await db.close();}
});
test('invalid values, empty confirmations, unknown fields and unsupported actions are rejected',async()=>{
  const {db,store,service}=await setup();
  try{
    await saveOffer(store,offer());const {profile}=await service.get(offer().productKey);
    for(const value of [-1,0,1.5,true,'1e4',{},['2'],'NaN']){
      const input=payload(profile);input.fields.packCount.value=value;
      await assert.rejects(service.save(profile.productKey,input),e=>e.code==='ENRICHMENT_VALUE_INVALID');
    }
    const empty=payload(profile);empty.fields.flavor={value:null,reviewState:'confirmed'};
    await assert.rejects(service.save(profile.productKey,empty),e=>e.code==='CONFIRMED_VALUE_MISSING');
    const extra=payload(profile);extra.fields.secret={value:'x',reviewState:'confirmed'};
    await assert.rejects(service.save(profile.productKey,extra),e=>e.code==='ENRICHMENT_FIELDS_INVALID');
    await assert.rejects(service.save(profile.productKey,{...payload(profile),action:'approve_buy'}),e=>e.code==='ENRICHMENT_REVIEW_INVALID');
  }finally{await db.close();}
});
test('conflicting evidence and unsupported corrections require a review reason',async()=>{
  const {db,store,service}=await setup();
  try{
    await saveOffer(store,offer({pack_count:12}));
    const {profile}=await service.get(offer().productKey),input=payload(profile);
    input.fields.packCount={value:12,reviewState:'confirmed'};input.note='';
    await assert.rejects(service.save(profile.productKey,input),e=>e.code==='REVIEW_REASON_REQUIRED');
    input.note='Checked original API count; retained 12 pending photo.';
    const saved=await service.save(profile.productKey,input);assert.equal(saved.profile.fields.packCount.value,12);
  }finally{await db.close();}
});
test('concurrent saves detect stale revisions instead of silently overwriting a correction',async()=>{
  const {db,store,service}=await setup();
  try{
    await saveOffer(store,offer());const {profile}=await service.get(offer().productKey);
    const results=await Promise.allSettled([service.save(profile.productKey,payload(profile)),service.save(profile.productKey,payload(profile))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'REVIEW_OUTDATED');
    assert.equal((await service.get(profile.productKey)).history.length,2);
  }finally{await db.close();}
});
test('rescans preserve confirmations; changed packaging requires explicit recheck and retains prior history',async()=>{
  const {db,store,service}=await setup();
  try{
    const original=offer();await saveOffer(store,original);
    let {profile}=await service.get(original.productKey);profile=(await service.save(profile.productKey,payload(profile))).profile;
    const revision=profile.revision;
    await saveOffer(store,offer({warehouse:{warehouse_id:'1062',price:9.97}},'1062','2026-11-09T12:00:00.000Z'));
    assert.equal((await service.get(profile.productKey)).profile.revision,revision);
    await saveOffer(store,offer({title:title.replace('10-pack','12-pack'),pack_count:12},'1062','2026-11-10T12:00:00.000Z'));
    const changed=await service.get(profile.productKey);assert.equal(changed.profile.status,'source_changed');
    assert.equal(changed.profile.fields.packCount.value,10);assert.equal(changed.profile.fields.packCount.reviewState,'needs_recheck');
    await assert.rejects(service.save(profile.productKey,payload(profile)),e=>e.code==='REVIEW_OUTDATED');
    const recheck=payload(changed.profile);recheck.fields.packCount.reviewState='needs_recheck';
    await assert.rejects(service.save(profile.productKey,recheck),e=>e.code==='RECHECK_REQUIRED');
    const final=payload(changed.profile);final.fields.packCount.value=12;
    const confirmed=await service.save(profile.productKey,final);assert.equal(confirmed.profile.fields.packCount.value,12);
    assert.equal(confirmed.profile.sourceChanged,false);
    assert.equal(confirmed.history.find(h=>h.revision===revision).body.identity.fields.packCount.value,10);
  }finally{await db.close();}
});
test('existing Research records are backfilled without paid API or image requests',async()=>{
  const {db,store,service}=await setup();
  try{
    await saveOffer(store,offer());await db.exec('DELETE FROM jason_research.enrichment_history; DELETE FROM jason_research.enrichment_profiles;');
    service.initialize();await service.work;
    assert.equal((await service.list()).total,1);assert.equal(service.progress.prepared,1);
  }finally{await db.close();}
});
test('enrichment API enforces session access and exports reviewed details with evidence',async()=>{
  const db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:new DemoProvider(),demo:true});
  const base=await app.listen(0),headers={'x-50toc-session':app.session,'Content-Type':'application/json'};
  try{
    await app.store.saveJob({id:'test-scan',createdAt:'2026-11-08T12:00:00.000Z',status:'complete',tasks:[]});
    await saveOffer(app.store,offer());
    assert.equal((await fetch(base+'/api/enrichment')).status,403);
    const list=await (await fetch(base+'/api/enrichment',{headers})).json();assert.equal(list.total,1);assert.equal(list.photoAnalysis,'not_connected');
    const detail=await (await fetch(base+'/api/enrichment/product?'+new URLSearchParams({productKey:offer().productKey}),{headers})).json();
    const saved=await fetch(base+'/api/enrichment/review',{method:'POST',headers,body:JSON.stringify({...payload(detail.profile),productKey:detail.profile.productKey})});
    assert.equal(saved.status,200);assert.equal((await saved.json()).profile.status,'reviewed');
    const csv=await (await fetch(base+'/api/enrichment/export?format=csv',{headers})).text();assert(csv.includes('fields.packCount.reviewState'));assert(csv.includes('sourceSnapshot'));
    const state=await (await fetch(base+'/api/state',{headers})).json();assert.equal(state.analysisConnected,true);
  }finally{await app.close();}
});
