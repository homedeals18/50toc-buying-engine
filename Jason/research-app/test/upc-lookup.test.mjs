import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {EnrichmentService} from '../server/enrichment.mjs';
import {MatchingService} from '../server/matching.mjs';
import {UpcLookupService} from '../server/upc-lookup.mjs';
import {queryFor,publicEvidenceUrl,labelledBarcodes,makeEvidence,summarizeEvidence} from '../server/upc-evidence.mjs';
import {normalizeOffer} from '../server/costco.mjs';
import {AppError} from '../server/errors.mjs';
import {createApp} from '../server/app.mjs';

const code='00811620024020',inner='811620021951',title='Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack';
const response=json=>({json,cached:false,observedAt:new Date().toISOString()});
const offer=(id=1,changes={})=>normalizeOffer({item_number:String(id),product_id:'p'+id,title,brand:'Example Brand',product_url:'https://www.costco.com/p/example/4000000001',warehouse:{warehouse_id:'1062',price:19.97},...changes},{warehouse:'1062',categories:[],types:['clearance'],scanId:'s',endpoint:'costco/category',observedAt:new Date().toISOString()});
async function setup(provider,count=1,changes={}){
  const db=await openDatabase(),store=new Store(db),enrichment=new EnrichmentService(store),matching=new MatchingService(store,enrichment,provider),lookup=new UpcLookupService(store,matching,provider,enrichment);
  await store.saveJob({id:'s',createdAt:new Date().toISOString(),status:'complete',tasks:[]});
  const offers=[];for(let i=1;i<=count;i++){const o=offer(i,changes);offers.push(o);await db.transaction(tx=>store.saveOffer(tx,'s',o));}
  await lookup.initialize();return {db,store,enrichment,matching,lookup,offers,key:offers[0].productKey};
}
async function run(lookup,scope={}){const plan=await lookup.plan(scope);await lookup.start({scope:plan.scope,fingerprint:plan.fingerprint});await lookup.running;return (await lookup.state()).job;}
function provider(handler){return {calls:[],configured:()=>true,async call(endpoint,body){this.calls.push({endpoint,body});return handler(endpoint,body);}};}
const emptyDetails=body=>response({data:{products:body.item_ids.map(id=>({product_id:id,title,brand:'Example Brand'}))}});
const resultPage=(link='https://www.bjs.com/product/example',snippet='UPC | '+code)=>response({searchInformation:{totalResults:'1'},items:[{title,link,snippet}]});

test('only labelled text becomes UPC evidence; zeroes and bad checksums are retained without correction',()=>{
  const e=labelledBarcodes('Item number: 00811620024020\nSKU: 811620021951\n| UPC | 00811620024020 |\nGTIN-14:\n00811620024021\nUPC code: 811620021951\nBarcode 12345678901234567890');
  assert.deepEqual(e.map(e=>e.raw),[code,'00811620024021',inner]);
  const p={title,brand:'Example Brand',fields:{},sourceSnapshot:[],sourceSignature:'s'};
  const evidence=e.map(c=>makeEvidence(p,c,{source:'Fixture'}));
  assert.equal(evidence[0].raw,code);assert.equal(evidence[1].valid,false);assert(evidence.every(e=>e.reviewRequired&&!e.verified&&e.scope==='unknown'));
  assert.equal(summarizeEvidence(evidence).conflictingIdentifiers,true);
});
test('lookup queries carry only public identity; page links cannot carry credentials or point to local hosts',()=>{
  const q=queryFor({title,brand:'Example Brand',price:123,note:'private-note',key:'secret',warehouse:'home-location'});
  assert(!/private|secret|home-location|123/.test(q));assert(q.includes('10 pack'));
  for(const url of ['http://example.com','https://localhost/a','https://127.0.0.1/a','https://[::1]/','https://169.254.169.254/','https://example.internal/','https://a.local/','https://user:pw@bjs.com/a','https://bjs.com/a?token=secret','https://example.com:8443/','https://127.0.0.1.nip.io/'])assert.equal(publicEvidenceUrl(url),null,url);
  assert.equal(publicEvidenceUrl('https://www.bjs.com/product/example'),'https://www.bjs.com/product/example');
});
test('saved explicit API barcodes avoid paid calls and never create a verified UPC record',async()=>{
  const p=provider(()=>{throw Error('No network expected');}),s=await setup(p,1,{upc:code});
  try{const plan=await s.lookup.plan();assert.equal(plan.maxCredits,0);const job=await run(s.lookup);assert.equal(job.status,'complete');assert.equal(p.calls.length,0);
    const c=await s.matching.get(s.key);assert.equal(c.upc,null);assert.equal(c.upcLookup.summary.status,'needs_confirmation');assert.equal(c.upcHistory.length,0);
  }finally{await s.db.close();}
});
test('21 products use two detail batches, map reordered IDs correctly, and have no arbitrary item cap',async()=>{
  const p=provider((e,b)=>{assert.equal(e,'costco/product');return response({data:{products:b.item_ids.toReversed().map(id=>({product_id:id,upc:code}))}});}),s=await setup(p,21);
  try{assert.equal((await s.lookup.plan()).detailBatches,2);const job=await run(s.lookup);assert.equal(job.completedProducts,21);assert.equal(job.status,'complete');assert.deepEqual(p.calls.map(c=>c.body.item_ids.length),[20,1]);
    for(const o of s.offers){const c=await s.matching.get(o.productKey);assert.equal(c.upcLookup.evidence[0].raw,code);assert.equal(c.upc,null);}
    assert.equal((await s.lookup.plan()).recentSkipped,21);
  }finally{await s.db.close();}
});
test('web fallback reads two pages, retains contradictory package leads and flags another retailer for human confirmation',async()=>{
  const p=provider((e,b)=>{
    if(e==='costco/product')return emptyDetails(b);
    if(e==='google/customsearch')return response({searchInformation:{totalResults:'3'},items:[
      {title,link:'https://www.bjs.com/product/example',snippet:'UPC | '+code},
      {title:'Example Brand Chocolate Protein Shake, 14 fl oz, 1-pack',link:'https://www.target.com/p/example',snippet:'UPC: '+inner},
      {title,link:'https://maker.com/product/example',snippet:'More product information'}]});
    assert.equal(e,'extract');assert.equal(b.mode,'normal');
    return response({data:{url:b.url,content:'# '+(b.url.includes('target')?'Example Brand Chocolate Protein Shake, 14 fl oz, 1-pack':title)+'\nUPC | '+(b.url.includes('target')?inner:code)}});
  }),s=await setup(p);
  try{const job=await run(s.lookup);assert.equal(job.status,'complete');assert.equal(p.calls.length,4);assert.equal(job.maxCredits,4);
    const c=await s.matching.get(s.key),r=c.upcLookup;assert.equal(r.summary.status,'conflicting_upcs');assert.equal(r.search.results.length,3);assert.equal(r.pages.length,2);
    assert(r.evidence.every(e=>e.scope==='unknown'&&!e.verified&&e.reviewRequired));assert(r.evidence.some(e=>e.flags.some(f=>f.includes('Another website'))));assert(r.evidence.some(e=>e.flags.some(f=>f.includes('Pack count differs'))));assert.equal(c.upc,null);
  }finally{await s.db.close();}
});
test('no barcode and invalid barcode outcomes are explicit, without treating an item ID as a UPC',async()=>{
  const p=provider((e,b)=>e==='costco/product'?emptyDetails(b):e==='google/customsearch'?resultPage('https://www.bjs.com/product/example','SKU: '+code):response({data:{url:b.url,content:'# '+title+'\nItem number: '+code}})),s=await setup(p);
  try{await run(s.lookup);const c=await s.matching.get(s.key);assert.equal(c.upcLookup.summary.status,'not_found');assert.equal(c.upc,null);
    assert.equal((await s.lookup.plan()).recentSkipped,1);assert.equal((await s.lookup.plan({force:true})).eligible,1);
  }finally{await s.db.close();}
});
test('a detail response for another item is not accepted and cannot suppress web lookup',async()=>{
  const p=provider((e,b)=>e==='costco/product'?response({data:{products:[{product_id:'wrong-item',upc:code}]}}):response({searchInformation:{totalResults:'0'}})),s=await setup(p);
  try{await run(s.lookup);const c=await s.matching.get(s.key);assert.equal(c.upcLookup.evidence.length,0);assert(c.upcLookup.errors.some(e=>e.code==='DETAIL_IDENTITY_UNVERIFIED'));assert.equal(p.calls[1].endpoint,'google/customsearch');}
  finally{await s.db.close();}
});
test('a redirected product page cannot silently supply barcode evidence for the old result',async()=>{
  const p=provider((e,b)=>e==='costco/product'?emptyDetails(b):e==='google/customsearch'?resultPage('https://www.bjs.com/product/example','No UPC shown'):response({data:{url:'https://www.bjs.com/product/something-else',content:'UPC '+code}})),s=await setup(p);
  try{await run(s.lookup);const c=await s.matching.get(s.key);assert.equal(c.upcLookup.evidence.length,0);assert.equal(c.upcLookup.pages[0].status,'unverified_redirect');}
  finally{await s.db.close();}
});
test('stop waits for the current request; explicit resume continues from the saved checkpoint',async()=>{
  let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const p=provider(async(e,b)=>{if(e==='costco/product'){entered();await gate;return emptyDetails(b);}return response({searchInformation:{totalResults:'0'}});}),s=await setup(p);
  try{const plan=await s.lookup.plan();await s.lookup.start({fingerprint:plan.fingerprint});await ready;await s.lookup.stop();release();await s.lookup.running;
    assert.equal((await s.lookup.state()).job.status,'paused');assert.equal(p.calls.length,1);
    await s.lookup.resume();await s.lookup.running;assert.equal((await s.lookup.state()).job.status,'complete');assert.equal(p.calls.length,2);
  }finally{release();await s.lookup.close();await s.db.close();}
});
test('startup marks an unfinished UPC job interrupted and never automatically spends credits',async()=>{
  const p=provider(()=>{throw Error('No requests expected');}),s=await setup(p);
  try{await s.store.set('upc_lookup_job',{id:'interrupted',status:'running',stopRequested:true,cursor:0,tasks:[],products:[]});
    const next=new UpcLookupService(s.store,s.matching,p,s.enrichment);await next.initialize();assert.equal((await next.state()).job.status,'interrupted');assert.equal(p.calls.length,0);assert.equal(next.running,null);
  }finally{await s.db.close();}
});
test('credit errors stop the batch with safe diagnostics and no automatic retry',async()=>{
  const p=provider(()=>{throw new AppError('CREDITS_REQUIRED','Scavio reports insufficient credits.',{status:502,stage:'http'});}),s=await setup(p,2);
  try{const job=await run(s.lookup);assert.equal(job.status,'attention');assert.equal(job.lastError.code,'CREDITS_REQUIRED');assert.equal(p.calls.length,1);assert.equal(job.completedProducts,0);assert(!JSON.stringify(await s.store.events()).includes('Bearer'));
    await assert.rejects(run(s.lookup),e=>e.code==='UPC_JOB_PENDING');
  }finally{await s.db.close();}
});
test('changed club identity invalidates an estimate and cannot silently verify a found number',async()=>{
  const p=provider((e,b)=>emptyDetails(b)),s=await setup(p);
  try{const plan=await s.lookup.plan();await s.db.transaction(tx=>s.store.saveOffer(tx,'s',offer(1,{title:'Example Brand Chocolate Protein Shake, 14 fl oz, 12-pack'})));
    await assert.rejects(s.lookup.start({fingerprint:plan.fingerprint}),e=>e.code==='UPC_PLAN_CHANGED');assert.equal(p.calls.length,0);
  }finally{await s.db.close();}
});
test('reviewed UPC evidence is never overwritten by lookup, and current verified packages are skipped',async()=>{
  const p=provider(()=>{throw Error('No network expected');}),s=await setup(p,1,{upc:code});
  try{await run(s.lookup);const c=await s.matching.get(s.key);
    await s.matching.saveUpc(s.key,{value:code,status:'verified',scope:'club_package',sourceKind:'package_barcode',sourceUrl:'',note:'Read exact outer-package barcode.',actor:'Reviewer',checkedPackage:true,revision:0,profileRevision:c.profile.revision,sourceSignature:c.profile.sourceSignature});
    const plan=await s.lookup.plan({force:true});assert.equal(plan.verifiedSkipped,1);assert.equal(plan.maxCredits,0);assert.equal((await s.matching.get(s.key)).upcHistory.length,1);
  }finally{await s.db.close();}
});
test('UPC APIs require the local session; export includes saved evidence and live catalog remains disconnected',async()=>{
  const p=provider(()=>{throw Error('No API calls expected');}),db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:p,demo:true}),base=await app.listen(0);
  const post=(path,body)=>fetch(base+'/api/'+path,{method:'POST',headers:{'x-50toc-session':app.session,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{assert.equal((await fetch(base+'/api/upc-lookup')).status,403);assert.equal((await post('upc-lookup/plan',{})).status,200);
    const out=await (await fetch(base+'/api/matching/export',{headers:{'x-50toc-session':app.session}})).json();assert.deepEqual(out.upcLookupReports,[]);assert.equal(out.liveCatalogConnected,false);
  }finally{await app.close();}
});
