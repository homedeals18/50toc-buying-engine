import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {SamsResearchEngine,samsPlan,samsPage,samsOffer,samsCategory} from '../server/sams.mjs';
import {decoratePrice} from '../server/pricing.mjs';
import {AppError} from '../server/errors.mjs';
const at='2026-11-09T06:00:00Z',categories=[{id:'1001',name:'Grocery'}],scope={clubs:['6372'],categoryIds:['all'],dealTypes:['instant_savings']};
const row=(id,extra={})=>({item_id:String(id),product_id:'ALPHA'+id,title:'Synthetic Water, 12 fl oz, 24-pack',brand:'Synthetic',price:209.99,was_price:219.99,savings_amount:10,instant_savings:{amount:10,end_date:'Nov 18',message:'$10 Instant Savings'},...extra});
const response=(items,page=1,total=1)=>({observedAt:at,cached:false,json:{data:{club:{club_id:'9999',city:'Provider chosen'},page,total_pages:total,products:items}}});
async function setup(provider){const db=await openDatabase(),store=new Store(db);await store.set('sams_categories',categories);return {db,store,engine:new SamsResearchEngine(store,provider)};}
test('Sam’s plans deals by departments; selected clubs do not multiply discovery calls',()=>{
  assert.equal(samsPlan({...scope,clubs:['6372','1111']}).tasks.length,1);
  const p=samsPlan({...scope,categoryIds:['1001'],dealTypes:['instant_savings','clearance']},categories);assert.equal(p.tasks.length,2);assert.equal(p.minimumCredits,2);
  assert.equal(p.tasks[0].endpoint,'samsclub/category');assert.equal(p.tasks[1].category.id,'1150109');assert.equal(p.scope.retailer,'samsclub');
  assert.throws(()=>samsPlan({...scope,dealTypes:['manager_markdown']}));assert.throws(()=>samsPlan({...scope,dealTypes:['department']}));assert.throws(()=>samsPlan({...scope,categoryIds:['missing']},categories));
  assert.deepEqual(samsCategory({name:'Test',categoryId:'https://www.samsclub.com/browse/test/1001'}),{name:'Test',id:'1001'});assert.throws(()=>samsCategory({name:'Test',categoryId:'https://other.example/browse/test/1001'}));
});
test('discovery never invents a selected-club shelf price or a full stock count',()=>{
  const job={id:'test',scope:{clubs:['6372']}},task={endpoint:'samsclub/savings'},r=response([row(1)]);
  const offer=samsOffer(row(1,{available_quantity:8,member_limit:10}),{job,task,response:r,data:r.json.data,types:['instant_savings'],categories:[]});
  assert.equal(offer.warehouseId,'9999');assert.equal(offer.warehousePrice,null);assert.equal(offer.warehousePurchasePrice,null);assert.equal(offer.onlinePrice,null);assert.equal(offer.discoveryClubPrice,209.99);assert.equal(offer.availableQuantity,null);assert.equal(offer.disposition,'needs_information');
  const d=decoratePrice(offer);assert.equal(d.saleEndDate,null);assert.equal(d.saleEndLabel,'Nov 18');assert.equal(d.warehousePurchasePrice,null);
});
test('selected-club verification uses exact item/club IDs and final club price without subtracting savings twice',()=>{
  const job={id:'test',scope:{clubs:['6372']}},task={endpoint:'samsclub/product',itemId:'1'},r=response([]);
  const params={job,task,response:r,data:{},types:['instant_savings'],categories:[],verified:true,targetClub:'6372'};
  const source=row(1,{club:{club_id:'6372'},club_price:{price:14.49,was_price:18.49,savings_amount:4},in_stock_at_club:true,upc:'012345678905'});
  const offer=decoratePrice(samsOffer(source,params));assert.equal(offer.warehousePrice,18.49);assert.equal(offer.warehousePurchasePrice,14.49);assert.equal(offer.onlinePrice,209.99);assert.equal(offer.upc,'012345678905');
  assert.throws(()=>samsOffer({...source,club:{club_id:'9999'}},params),/requested item and club/);assert.throws(()=>samsOffer({...source,item_id:'2'},params));
  assert.equal(samsOffer({...source,club_price:{price:10,was_price:20,savings_amount:4}},params).warehousePurchasePrice,null);
});
test('Sam’s processes every page and all 93 products, including prices over $150',async()=>{
  const calls=[],provider={configured:()=>true,async call(endpoint,body){calls.push({endpoint,body});return response(Array.from({length:body.page===3?3:45},(_,i)=>row((body.page-1)*45+i+1)),body.page,3);}};
  const {db,store,engine}=await setup(provider);
  try{const j=await engine.create(scope);await engine.running;assert.equal((await store.job(j.id)).status,'complete');assert.equal((await store.offers()).length,93);assert.equal((await store.sourcePages(j.id)).length,3);assert.deepEqual(calls.map(c=>c.body.page),[1,2,3]);assert(calls.every(c=>!('club_id' in c.body)&&!('query' in c.body)));assert.equal((await store.get('preferences')),null);assert.equal((await db.query('SELECT count(*) n FROM jason_research.enrichment_profiles')).rows[0].n,93);}
  finally{await db.close();}
});
test('department membership scopes clearance without adding unrelated products',async()=>{
  const provider={configured:()=>true,async call(endpoint,body){return response(body.category_id==='1001'?[row(1,{instant_savings:null,savings_amount:null})]:[row(1),row(2)]);}};
  const {db,store,engine}=await setup(provider);
  try{const j=await engine.create({...scope,categoryIds:['1001'],dealTypes:['clearance']});await engine.running;const saved=await store.offers();assert.equal(saved.length,1);assert.equal(saved[0].itemNumber,'1');assert.equal(saved[0].categories[0].id,'1001');assert.equal((await store.job(j.id)).outsideScope,1);}
  finally{await db.close();}
});
test('credit exhaustion retains all prior pages and resumes the exact next page without paid retries',async()=>{
  const calls=[];let fail=true;
  const provider={configured:()=>true,async call(endpoint,body){calls.push(body.page);if(body.page===2&&fail)throw new AppError('CREDITS_REQUIRED','Synthetic credits exhausted');return response([row(body.page)],body.page,3);}};
  const {db,store,engine}=await setup(provider);
  try{const j=await engine.create(scope);await engine.running;assert.equal((await store.job(j.id)).status,'partial');assert.equal((await store.offers()).length,1);fail=false;await engine.resume(j.id);await engine.running;assert.equal((await store.job(j.id)).status,'complete');assert.deepEqual(calls,[1,2,2,3]);assert.equal((await store.offers()).length,3);}
  finally{await db.close();}
});
test('club checks estimate every item × club, persist exact-club evidence and do not approve purchases',async()=>{
  const calls=[],provider={configured:()=>true,async call(endpoint,body){calls.push({endpoint,body});return endpoint==='samsclub/product'?{observedAt:at,cached:false,json:{data:row(body.item_id,{club:{club_id:body.club_id},club_price:{price:14.49,was_price:18.49,savings_amount:4},upc:'012345678905'})}}:response([row(1),row(2)]);}};
  const {db,store,engine}=await setup(provider);
  try{await engine.create(scope);await engine.running;const p=await engine.verificationPlan({clubs:['6372','1111']});assert.equal(p.requests,4);const j=await engine.verify({clubs:['6372','1111']});await engine.running;assert.equal((await store.job(j.id)).status,'complete');assert.equal(calls.filter(c=>c.endpoint==='samsclub/product').length,4);const saved=await store.offers();assert.equal(saved.filter(o=>o.warehousePurchasePrice===14.49).length,4);assert.equal((await store.offers({scanId:j.id})).length,4);assert.equal((await db.query('SELECT count(*) n FROM jason_research.buying_targets')).rows[0].n,0);}
  finally{await db.close();}
});
test('unverifiable pagination keeps received items but never claims scan completion',async()=>{
  assert(samsPage({data:{products:[row(1)],page:1}}, {page:1}).error);
  assert(samsPage({data:{products:[],page:1,total_pages:2}}, {page:1}).error);
  const provider={configured:()=>true,async call(){return {...response([row(1)]),json:{data:{products:[row(1)],page:1}}};}};
  const {db,store,engine}=await setup(provider);try{const j=await engine.create(scope);await engine.running;assert.equal((await store.job(j.id)).status,'partial');assert.equal((await store.offers()).length,1);}finally{await db.close();}
});
