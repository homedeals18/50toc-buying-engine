import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {ResearchEngine} from '../server/engine.mjs';
import {ScavioProvider} from '../server/provider.mjs';
import {planScan,selectedTypes,normalizeOffer,readPage} from '../server/costco.mjs';
import {nonnegativeNumber,AppError,redact} from '../server/errors.mjs';
import {createApp} from '../server/app.mjs';
import {DemoProvider} from '../server/demo.mjs';
import {toCsv} from '../server/export.mjs';

const categories=[{id:'grocery',slug:'grocery',name:'Grocery',nativeId:'1'},{id:'home',slug:'home',name:'Home',nativeId:'2'}];
const scope={warehouses:['1062'],categoryIds:['grocery'],dealTypes:['clearance','manager_markdown']};
const at='2026-11-07T12:00:00.000Z';
const row=(id,price=12.97)=>({item_number:String(id),title:'Example Item '+id,price:19.99,warehouse:{warehouse_id:'1062',price,availability:'in_stock'}});
const response=(items,page=1,total=1)=>({json:{data:{page,total_pages:total,results:items}},cached:false,observedAt:at});
async function setup(provider){
  const db=await openDatabase(),store=new Store(db);await store.set('categories',categories);
  const engine=new ResearchEngine(store,provider,{retryDelay:1});
  return {db,store,engine};
}
async function runScan(engine,input=scope){const job=await engine.create(input);await engine.running;return job.id;}

test('markdowns share one department task, independent of selected endings',()=>{
  const p=planScan(scope,categories);assert.equal(p.tasks.length,1);assert.equal(p.minimumCredits,2);
  assert.equal(planScan({...scope,warehouses:['1062','306'],categoryIds:['grocery','home']},categories).tasks.length,4);
  assert.equal(planScan({...scope,dealTypes:['clearance','coupon_book','treasure_hunt']},categories).tasks.length,3);
  assert.equal('max_price' in p.scope,false);assert.equal('query' in p.scope,false);
});
test('selection validation rejects malformed values and unknown departments',()=>{
  for(const input of [{...scope,warehouses:'1062'},{...scope,categoryIds:['missing']},{...scope,dealTypes:['unknown']},{...scope,warehouses:['x']}])assert.throws(()=>planScan(input,categories),AppError);
});
test('warehouse prices and selected markdowns never derive from online prices',()=>{
  assert.deepEqual(selectedTypes({...row(1),warehouse:null},'1062',['clearance']),['unverified_markdown']);
  assert.deepEqual(selectedTypes(row(1,12.88),'1062',scope.dealTypes),['manager_markdown']);
  assert.deepEqual(selectedTypes(row(1,12.49),'1062',['special_buy']),['special_buy']);
  assert.deepEqual(selectedTypes(row(1,12.99),'1062',scope.dealTypes),[]);
  const offer=normalizeOffer({...row(1),warehouse:{warehouse_id:'999',price:1.97}},{warehouse:'1062',categories,types:['clearance'],scanId:'s',endpoint:'costco/category',observedAt:at});
  assert.equal(offer.warehousePrice,null);assert.equal(offer.onlinePrice,19.99);assert.equal(offer.upc,null);
});
test('numbers accept formatted balances and keep unknown values unknown',()=>{
  assert.equal(nonnegativeNumber('1,234.50'),1234.5);assert.equal(nonnegativeNumber('$24.97'),24.97);
  for(const bad of [null,'',true,'12,34','NaN','1x','-1','  ',{},Infinity])assert.equal(nonnegativeNumber(bad),null);
});
test('all supported pages and all 247 products are processed without a price ceiling',async()=>{
  const calls=[];
  const provider={configured:()=>true,async call(endpoint,body){calls.push(body);return response(Array.from({length:body.page===3?7:120},(_,i)=>row((body.page-1)*120+i,200.97)),body.page,3);}};
  const {db,store,engine}=await setup(provider);
  try{const id=await runScan(engine);const job=await store.job(id);assert.equal(job.status,'complete');assert.equal(job.pages,3);assert.equal((await store.offers()).length,247);assert.deepEqual(calls.map(c=>c.page),[1,2,3]);assert(calls.every(c=>!('max_price' in c)&&!('query' in c)));assert.equal((await store.sourcePages(id)).length,3);}
  finally{await db.close();}
});
test('retry resumes the failed page; stop preserves saved pages and remaining work',async()=>{
  let fail=true,engineRef,stopNext=false;const pages=[];
  const provider={configured:()=>true,async call(endpoint,body){
    pages.push(body.page);
    if(body.page===2&&fail)throw new AppError('TEST_FAILURE','Synthetic failure',{status:502});
    if(stopNext){await engineRef.store.cancel((await engineRef.store.jobs())[0].id);stopNext=false;}
    return response([row(body.page)],body.page,3);
  }};
  const {db,store,engine}=await setup(provider);engineRef=engine;
  try{
    const id=await runScan(engine);assert.equal((await store.job(id)).status,'partial');assert.equal((await store.offers()).length,1);
    fail=false;stopNext=true;await engine.resume(id);await engine.running;
    assert.equal((await store.job(id)).status,'stopped');assert.equal((await store.offers()).length,2);
    await engine.resume(id);await engine.running;
    assert.equal((await store.job(id)).status,'complete');assert.deepEqual(pages,[1,2,2,3]);assert.equal((await store.offers()).length,3);
  }finally{await db.close();}
});
test('rescans retain first seen, historical snapshots and manual corrections',async()=>{
  let stamp=at,price=12.97;
  const provider={configured:()=>true,async call(){return {...response([row(1,price)]),observedAt:stamp};}};
  const {db,store,engine}=await setup(provider);
  try{
    const first=await runScan(engine),offer=(await store.offers())[0];
    await db.query('INSERT INTO jason_research.corrections VALUES($1,$2::jsonb)',[offer.id,JSON.stringify({size:'14 fl oz',actor:'test-user'})]);
    stamp='2026-11-08T12:00:00.000Z';price=10.97;
    await runScan(engine);
    const current=await store.offer(offer.id),historical=await store.offer(offer.id,first);
    assert.equal(current.firstSeen,at);assert.equal(current.warehousePrice,10.97);assert.equal(historical.warehousePrice,12.97);
    assert.equal(current.manualCorrection.size,'14 fl oz');assert.equal((await store.sourcePages(first))[0].body.data.results[0].warehouse.price,12.97);
    stamp='2026-11-06T12:00:00.000Z';price=15.97;await runScan(engine);
    assert.equal((await store.offer(offer.id)).warehousePrice,10.97);
  }finally{await db.close();}
});
test('feed results are limited to selected department membership and coupons retain dates',async()=>{
  const provider={configured:()=>true,async call(endpoint){
    if(endpoint==='costco/category')return response([row(1,12.99)]);
    if(endpoint==='costco/coupons')return {json:{data:{valid_from:'2026-11-01',valid_to:'2026-11-30',coupons:[{...row(1),warehouse:null,applies_to:'online',discount:{final_price:2}}]}},cached:false,observedAt:at};
    return response([row(1),row(2)]);
  }};
  const {db,store,engine}=await setup(provider);
  try{
    const id=await runScan(engine,{...scope,dealTypes:['treasure_hunt','coupon_book']});
    const offers=await store.offers();assert.equal(offers.length,1);assert.equal(offers[0].coupon.appliesTo,'online');assert.equal(offers[0].coupon.validTo,'2026-11-30');assert.notEqual(offers[0].warehousePrice,2);
    assert.equal((await store.job(id)).outsideScope,1);assert.deepEqual(offers[0].dealTypes,['treasure_hunt','coupon_book']);
  }finally{await db.close();}
});
test('concurrent starts are rejected, and restart never silently spends credits',async()=>{
  let release;
  const provider={configured:()=>true,call:()=>new Promise(r=>{release=()=>r(response([row(1)]));})};
  const {db,store,engine}=await setup(provider);
  try{
    const first=engine.create(scope);await assert.rejects(engine.create(scope),e=>e.code==='SCAN_ACTIVE');await first;
    while(!release)await new Promise(r=>setTimeout(r,1));
    release();await engine.running;
    const unfinished={...(await store.jobs())[0],id:'interrupted-test',status:'running'};await store.saveJob(unfinished);
    const next=new ResearchEngine(store,provider);await next.initialize();
    assert.equal((await store.job(unfinished.id)).status,'interrupted');assert.equal(next.running,null);
  }finally{await db.close();}
});
test('safe API diagnostics do not retain keys, response bodies or driver messages',async()=>{
  const {db,store}=await setup({});const key='synthetic-secret-12345';let requests=0;
  const vault={configured:()=>true,read:async()=>key};
  try{
    const provider=new ScavioProvider(store,vault,{fetcher:async(url,options)=>{
      requests++;assert.equal(options.headers.Authorization,'Bearer '+key);
      if(url.endsWith('/usage'))return new Response(JSON.stringify({credit_balance:'1,234'}));
      return new Response(JSON.stringify({data:{results:[{title:'safe '+key,api_key:key,url:'https://example.com/p?token='+key}]}}));
    }});
    assert.equal((await provider.usage()).creditBalance,1234);
    const a=await provider.call('costco/category',{category:'x'}),b=await provider.call('costco/category',{category:'x'});
    assert.equal(b.cached,true);assert.equal(a.observedAt,b.observedAt);assert.equal(requests,2);assert(!JSON.stringify(a).includes(key));
    const bad=new ScavioProvider(store,vault,{fetcher:async()=>new Response('Input string was not in a correct format '+key,{status:500})});
    await assert.rejects(bad.call('usage'),e=>e.code==='PROVIDER_HTTP_ERROR'&&e.eventId&& !e.message.includes(key));
    assert(!JSON.stringify(await store.events()).includes(key));assert(!JSON.stringify(await store.events()).includes('Input string'));
    const changed=new ScavioProvider(store,vault,{fetcher:async()=>new Response('{"credit_balance":null}')});
    await assert.rejects(changed.usage(),e=>e.code==='USAGE_SCHEMA_CHANGED'&&Boolean(e.eventId));
  }finally{await db.close();}
});
test('source redaction and CSV exports handle nested fields and spreadsheet formulas',()=>{
  assert(!JSON.stringify(redact({headers:{Authorization:'secret'},nested:{password:'secret'}})).includes('secret'));
  const csv=toCsv([{title:'=HYPERLINK("evil")',sourceData:{item:{pack_count:12,variants:[{size:'14 fl oz'}]}}}]);
  assert(csv.includes('sourceData.item.variants[0].size'));assert(csv.includes('sourceData.item.pack_count'));assert(csv.includes("'=HYPERLINK"));
});
test('API requires a local session and serves the built React application',async()=>{
  const db=await openDatabase(),provider=new DemoProvider();
  const app=await createApp({db,dataDir:os.tmpdir(),provider,demo:true,retryDelay:1}),base=await app.listen(0);
  try{
    const html=await (await fetch(base)).text();assert(html.includes('50toc-session'));assert(!html.includes('__SESSION__'));
    assert.equal((await fetch(base+'/api/state')).status,403);
    assert.equal((await fetch(base+'/api/state',{headers:{'x-50toc-session':app.session,Origin:'https://evil.invalid'}})).status,403);
    const headers={'x-50toc-session':app.session,'Content-Type':'application/json'};
    await app.store.set('categories',categories);
    const state=await (await fetch(base+'/api/state',{headers})).json();assert.equal(state.priceLimit,null);assert.equal(state.analysisConnected,false);
    assert.equal((await fetch(base+'/api/plan',{method:'POST',headers,body:'[]'})).status,400);
    const start=await fetch(base+'/api/scans',{method:'POST',headers,body:JSON.stringify(scope)});
    assert.equal(start.status,202);await app.engine.running;
    const offers=await (await fetch(base+'/api/offers',{headers})).json();assert.equal(offers.total,2);
    assert.equal((await fetch(base+'/app.js')).status,200);
    const exported=await (await fetch(base+'/api/export?format=csv',{headers})).text();assert(exported.includes('sourceData.item.item_number'));
  }finally{await app.close();}
});
test('local PostgreSQL records survive closing and reopening the application database',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'50toc-research-test-'));
  try{
    let db=await openDatabase({dataDir:dir}),store=new Store(db);await store.set('proof',{retained:true});await db.close();
    db=await openDatabase({dataDir:dir});store=new Store(db);assert.deepEqual(await store.get('proof'),{retained:true});await db.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});
