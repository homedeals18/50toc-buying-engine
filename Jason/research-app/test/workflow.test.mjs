import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createApp} from '../server/app.mjs';
import {normalizeOffer} from '../server/costco.mjs';
import {fieldDefinitions} from '../server/enrichment-fields.mjs';
import {evaluateProfit,profitDefaults} from '../server/profit.mjs';
import {keepaFacts,KeepaClient,DemoKeepaClient} from '../server/catalog.mjs';
import {DemoProvider,} from '../server/demo.mjs';
const owner={id:'manager',username:'Test Manager',role:'manager'},worker={id:'worker1',username:'Worker One',role:'worker'},second={id:'worker2',username:'Worker Two',role:'worker'};
const current=()=>new Date().toISOString(),code='012345678905';
const controls=()=>({...profitDefaults,minRoi:25,minProfit:3,maxRank:100000,minVelocity:20,closeRoi:5,closeProfit:1,closeRank:10000,closeVelocity:5});
const values=()=>({clubPrice:19.97,taxPerClub:0,workerAllowance:.75,prepShipping:.75,otherCost:0,buyBoxPrice:39.99,amazonFees:8,rank:20000,monthlyVelocity:100,categoryId:'123',feeSource:'Manual confirmed FBA total at current Buy Box',priceSource:'Manual current Buy Box',velocitySource:'Listing monthly estimate from reviewed source',priceKind:'current_buy_box',observedAt:current(),eligibility:'not_checked',feesConfirmed:true,note:'Synthetic test evidence only.'});
const makeOffer=(changes={})=>normalizeOffer({item_number:'123',product_id:'456',title:'Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack',brand:'Example Brand',warehouse:{warehouse_id:'1062',price:19.97},...changes},{warehouse:'1062',categories:[],types:['clearance'],scanId:'s',endpoint:'costco/category',observedAt:current()});
function reviewedFields(){const fs=Object.fromEntries(fieldDefinitions.map(f=>[f.id,{value:null,reviewState:'not_applicable'}]));for(const [k,v]of Object.entries({productName:'Protein Shake',productType:'Protein Shake',packCount:10,packUnit:'bottles',sizeValue:14,sizeUnit:'fl oz',sizeBasis:'per_unit',flavor:'Chocolate',isVariety:'no'}))fs[k]={value:v,reviewState:'confirmed'};return fs;}
async function setup(){
  const db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:new DemoProvider(),keepa:new DemoKeepaClient(),demo:true});await app.enrichment.work;
  await app.store.saveJob({id:'s',createdAt:current(),status:'complete',tasks:[]});const o=makeOffer();await db.transaction(tx=>app.store.saveOffer(tx,'s',o));
  const context=await app.matching.get(o.productKey),fields=reviewedFields(),profile=(await app.enrichment.save(o.productKey,{action:'confirm',fields,revision:context.profile.revision,sourceSignature:context.profile.sourceSignature,actor:owner.username,note:'Reviewed synthetic package.'})).profile;
  await app.matching.saveUpc(o.productKey,{value:code,scope:'club_package',status:'verified',sourceKind:'package_barcode',sourceUrl:'',checkedPackage:true,note:'Synthetic exact package',actor:owner.username,revision:0,profileRevision:profile.revision,sourceSignature:profile.sourceSignature});
  await app.matching.saveCandidate(o.productKey,{asin:'B000000001',title:o.title,brand:o.brand,fields,upc:code,upcScope:'amazon_package',upcVerified:true,detailsReviewed:true,sourceUrl:'https://www.amazon.com/dp/B000000001',actor:owner.username,note:'Synthetic child listing',revision:0,profileRevision:profile.revision,sourceSignature:profile.sourceSignature});
  await app.workflow.saveSettings({...controls(),revision:0},owner);
  const analysis=(await app.workflow.analyze({productKey:o.productKey,asin:'B000000001',offerId:o.id,revision:0,values:values()},owner)).item;
  return {app,db,key:o.productKey,offer:o,item:analysis,async close(){await app.upcLookup.close();await app.enrichment.close();await db.close();}};
}
async function approve(s,units=500,extra={}){const decision=await s.app.workflow.decision({itemId:s.item.id,revision:s.item.revision,action:'approve',targetUnits:units,maxPrice:19.97,warehouses:['1062'],acknowledgeEligibility:true,note:'Test approval',...extra},owner);s.item=decision.item;return (await s.app.workflow.state(owner)).targets[0];}
async function buy(s,qty=1,rid='purchase-request-0001'){
  let t=(await s.app.workflow.workerState(worker)).targets[0];await s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:qty},worker);t=(await s.app.workflow.workerState(worker)).targets[0];
  const input={targetId:t.id,revision:t.revision,quantity:qty,unitPrice:19.97,tax:0,warehouse:'1062',requestId:rid};return {input,...await s.app.workflow.purchase(input,worker)};
}

test('unverified warehouse coupons hold analysis; verified final price reaches ROI and approval exactly once',async()=>{
  const s=await setup();
  try{
    const raw={...s.offer,dealTypes:['on_sale'],sourceData:{item:{...s.offer.sourceData.item,promotions:['$4 online savings']}}};
    await s.db.query('UPDATE jason_research.offers SET body=$2::jsonb WHERE id=$1',[raw.id,JSON.stringify(raw)]);
    let item=(await s.app.workflow.analyze({productKey:s.key,asin:'B000000001',offerId:raw.id,revision:s.item.revision,values:values()},owner)).item;
    assert.equal(item.result.route,'needs_information');
    const check={offerId:raw.id,observedAt:current(),status:'verified',basePrice:19.97,discountAmount:4,finalPrice:15.97,endDate:'2099-11-30'};
    await s.db.query('INSERT INTO jason_research.warehouse_price_checks VALUES($1,$2,$3::jsonb)',[raw.id,check.observedAt,JSON.stringify(check)]);
    item=(await s.app.workflow.analyze({productKey:s.key,asin:'B000000001',offerId:raw.id,revision:item.revision,values:{...values(),clubPrice:15.97}},owner)).item;
    assert.equal(item.result.route,'normal');assert.equal(item.values.clubPrice,15.97);assert.equal(item.result.completeCost,17.47);
    await s.app.workflow.decision({itemId:item.id,revision:item.revision,action:'approve',targetUnits:1,maxPrice:15.97,warehouses:['1062'],acknowledgeEligibility:true,note:'Synthetic coupon check only'},owner);
    assert.equal((await s.app.workflow.state(owner)).targets[0].maxPrice,15.97);
    await s.db.query('UPDATE jason_research.warehouse_price_checks SET body=$2::jsonb WHERE offer_id=$1',[raw.id,JSON.stringify({...check,status:'unavailable',finalPrice:null})]);
    const target=(await s.app.workflow.workerState(worker)).targets[0];
    await assert.rejects(s.app.workflow.purchase({targetId:target.id,revision:target.revision,quantity:1,unitPrice:15.97,tax:0,warehouse:'1062',requestId:'synthetic-coupon-held'},worker),e=>e.code==='BUYING_HELD');
  }finally{await s.close();}
});

test('complete-cost ROI uses net proceeds over complete cost and never subtracts rewards',()=>{
  const r=evaluateProfit({...values(),clubPrice:10,workerAllowance:0,prepShipping:0,buyBoxPrice:20,amazonFees:5,cashback:999},controls());assert.equal(r.profit,5);assert.equal(r.roi,50);assert.equal(r.completeCost,10);assert.equal(r.purchaseApproved,false);
  const unknown=evaluateProfit({...values(),amazonFees:null},controls());assert.equal(unknown.route,'needs_information');assert.equal(unknown.profit,null);
  const unconfigured=evaluateProfit(values(),profitDefaults);assert.equal(unconfigured.route,'needs_information');
});
test('Close requires every cutoff and its tolerance; loss, restriction and missing identity cannot pass',()=>{
  assert.equal(evaluateProfit({...values(),monthlyVelocity:18},controls()).route,'close');
  assert.equal(evaluateProfit({...values(),monthlyVelocity:10},controls()).route,'reject');
  assert.equal(evaluateProfit({...values(),buyBoxPrice:1},controls()).route,'reject');
  assert.equal(evaluateProfit({...values(),eligibility:'restricted'},controls()).route,'reject');
  assert.equal(evaluateProfit(values(),controls(),{matchRoute:'needs_information'}).route,'needs_information');
  assert.equal(evaluateProfit(values(),controls(),{blocked:true}).route,'blocked');
  assert.equal(evaluateProfit(values(),controls(),{expired:true}).route,'hold');
  assert.equal(evaluateProfit({...values(),observedAt:'2000-01-01'},controls()).route,'needs_information');
});
test('category rank/velocity overrides do not silently override global ROI and profit',()=>{
  const s={...controls(),categoryOverrides:[{categoryId:'123',maxRank:10000,minVelocity:200,closeRank:500,closeVelocity:10}]};const r=evaluateProfit(values(),s);assert.equal(r.route,'reject');assert.equal(r.rules.minRoi,25);assert(r.failures.length>=2);
});
test('human approval creates one shared target; 100 bought against 500 leaves 400 and one club unit is one wage unit',async()=>{
  const s=await setup();try{assert.equal(s.item.result.route,'normal');assert.equal((await s.app.workflow.state(owner)).targets.length,0);await approve(s);await buy(s,100);
    const state=await s.app.workflow.state(owner);assert.equal(state.targets[0].remainingUnits,400);assert.equal(state.targets[0].purchasedUnits,100);assert.equal(state.purchases[0].quantity,100);
    const again=await s.app.workflow.decision({itemId:s.item.id,revision:s.item.revision,action:'approve',targetUnits:500,maxPrice:19.97,warehouses:['1062'],acknowledgeEligibility:true,note:'Same total target'},owner);s.item=again.item;
    assert.equal((await s.app.workflow.state(owner)).targets.length,1);assert.equal((await s.app.workflow.state(owner)).targets[0].remainingUnits,400);
  }finally{await s.close();}
});
test('quantity reservations prevent simultaneous workers from claiming the same units, and purchase retries do not double-count',async()=>{
  const s=await setup();try{await approve(s,2);let t=(await s.app.workflow.workerState(worker)).targets[0];await s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:2},worker);t=(await s.app.workflow.workerState(second)).targets[0];
    await assert.rejects(s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:1},second),e=>e.code==='QUANTITY_UNAVAILABLE');
    const p={targetId:t.id,revision:t.revision,quantity:2,unitPrice:18.97,tax:0,warehouse:'1062',requestId:'idempotent-purchase-1'};await s.app.workflow.purchase(p,worker);assert.equal((await s.app.workflow.purchase(p,worker)).duplicate,true);
    assert.equal((await s.app.workflow.state(owner)).purchases.length,1);assert.equal((await s.app.workflow.state(owner)).targets[0].remainingUnits,0);
    await assert.rejects(s.app.workflow.purchase({...p,quantity:1},worker),e=>e.code==='REQUEST_REUSED');
  }finally{await s.close();}
});
test('higher prices, unauthorized warehouses and missing eligibility acknowledgment cannot become approved purchases',async()=>{
  const s=await setup();try{await assert.rejects(approve(s,2,{acknowledgeEligibility:false}),e=>e.code==='ELIGIBILITY_ACK_REQUIRED');await approve(s,2);let t=(await s.app.workflow.workerState(worker)).targets[0];await s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:1},worker);t=(await s.app.workflow.workerState(worker)).targets[0];
    const p={targetId:t.id,revision:t.revision,quantity:1,unitPrice:20,tax:0,warehouse:'1062',requestId:'higher-price-request'};await assert.rejects(s.app.workflow.purchase(p,worker),e=>e.code==='PRICE_ABOVE_APPROVAL');await assert.rejects(s.app.workflow.purchase({...p,unitPrice:19,warehouse:'999'},worker),e=>e.code==='WAREHOUSE_NOT_APPROVED');assert.equal((await s.app.workflow.state(owner)).purchases.length,0);
  }finally{await s.close();}
});
test('permanent blocks survive rescans; removing one never silently restores buying authority',async()=>{
  const s=await setup();try{await approve(s,5);await s.app.workflow.block({productKey:s.key,asin:'B000000001',active:true,note:'Wrong mapping for this club item'},owner);
    await s.db.transaction(tx=>s.app.store.saveOffer(tx,'s',makeOffer({warehouse:{warehouse_id:'1062',price:9.97}})));let state=await s.app.workflow.state(owner);assert.equal(state.blocks[0].active,true);assert.equal(state.targets[0].status,'held');
    await s.app.workflow.block({productKey:s.key,asin:'B000000001',active:false,note:'Corrected mapping reviewed'},owner);state=await s.app.workflow.state(owner);assert.equal(state.targets[0].status,'held');
  }finally{await s.close();}
});
test('changed mapping or stricter controls stop additional purchases before a daily check',async()=>{
  const s=await setup();try{await approve(s,2);let t=(await s.app.workflow.workerState(worker)).targets[0];await s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:1},worker);t=(await s.app.workflow.workerState(worker)).targets[0];
    const settings=await s.app.workflow.settings();await s.app.workflow.saveSettings({...settings,minRoi:500},owner);
    await assert.rejects(s.app.workflow.purchase({targetId:t.id,revision:t.revision,quantity:1,unitPrice:19,tax:0,warehouse:'1062',requestId:'controls-change-request'},worker),e=>e.code==='BUYING_HELD');
  }finally{await s.close();}
});
test('Close exceptions and budget warnings require explicit full-access reasons',async()=>{
  const s=await setup();try{const oldSettings=await s.app.workflow.settings();await s.app.workflow.saveSettings({...oldSettings,minVelocity:102,dailyBudget:1},owner);
    s.item=(await s.app.workflow.analyze({productKey:s.key,asin:s.item.asin,offerId:s.offer.id,revision:s.item.revision,values:values()},owner)).item;assert.equal(s.item.result.route,'close');
    await assert.rejects(approve(s,2),e=>e.code==='EXCEPTION_REASON_REQUIRED');await assert.rejects(approve(s,2,{exception:true}),e=>e.code==='BUDGET_WARNING');await approve(s,2,{exception:true,budgetOverride:true});assert.equal((await s.app.workflow.state(owner)).targets[0].reviewException,true);
  }finally{await s.close();}
});
test('worker wage calculation preserves paid rates, excludes paid units, and paid-work corrections create adjustments',async()=>{
  const s=await setup();try{await approve(s,10);const p=await buy(s,2);const input={workerId:worker.id,from:'2026-01-01',to:'2030-12-31',rates:{[s.key]:.75}};const q=await s.app.workflow.calculatePay(input,owner);assert.equal(q.groups[0].units,2);assert.equal(q.total,1.5);
    const paymentInput={...input,fingerprint:q.fingerprint,requestId:'wage-payment-request-1',note:'Recorded test payment, no funds transmitted'};const paid=await s.app.workflow.markPaid(paymentInput,owner);assert.equal((await s.app.workflow.markPaid(paymentInput,owner)).duplicate,true);assert.equal((await s.app.workflow.calculatePay(input,owner)).purchases.length,0);
    const purchase=(await s.app.workflow.state(owner)).purchases[0];await s.app.workflow.correct({purchaseId:p.purchase.id,revision:purchase.revision,quantity:3,unitPrice:19.97,tax:0,note:'Receipt proves three club packages'},owner);
    const state=await s.app.workflow.state(owner);assert.equal(state.payments[0].total,1.5);assert.equal(state.adjustments[0].unitDelta,1);assert.equal(state.targets[0].purchasedUnits,3);assert.equal(paid.payment.recordsPaymentOnly,true);
  }finally{await s.close();}
});
test('receipt attachments and reuploads do not add purchased units; item-line reconciliation is separate',async()=>{
  const s=await setup();try{await approve(s,4);const p=await buy(s,2),input={purchaseIds:[p.purchase.id],name:'fixture.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.7\nSynthetic receipt fixture').toString('base64')};
    const r=await s.app.receipts.upload(input,worker);assert.equal((await s.app.receipts.upload(input,worker)).duplicate,true);let state=await s.app.workflow.state(owner);assert.equal(state.purchases.length,1);assert.equal(state.purchases[0].quantity,2);
    await s.app.receipts.reconcile({purchaseId:p.purchase.id,receiptId:r.receipt.id,revision:state.purchases[0].revision,quantity:2,lineTotal:39.94,note:'Selected line explicitly shows 2 packages'},owner);state=await s.app.workflow.state(owner);assert.equal(state.purchases[0].receiptStatus,'reconciled');
    await assert.rejects(s.app.receipts.read(r.receipt.id,second),e=>e.code==='RECEIPT_ACCESS');await assert.rejects(s.app.receipts.upload({...input,mime:'image/png'},worker),e=>e.code==='RECEIPT_TYPE');
  }finally{await s.close();}
});
test('daily check runs at most once per calendar day and clearly uses saved observations without API spending',async()=>{
  const s=await setup();try{await approve(s,4);assert.equal((await s.app.workflow.monitor(owner)).checked,1);assert.equal((await s.app.workflow.monitor(owner)).checked,0);assert.equal(s.app.provider.calls.length,0);
    const state=await s.app.workflow.state(owner);assert(state.targets[0].lastCheckAt);assert.equal(state.targets[0].remainingUnits,4);
  }finally{await s.close();}
});
test('urgent in-store submissions enter Research only after manager confirmation and do not authorize buying',async()=>{
  const s=await setup();try{const submission=await s.app.workflow.submit({type:'new_deal',title:'Example New Product',itemNumber:'999',warehouse:'1062',price:9.97,note:'Shelf tag checked by worker',requestId:'shelf-find-request-1'},worker);
    await assert.rejects(s.app.workflow.intake({submissionId:submission.id,title:'Example New Product',brand:'Example Brand',itemNumber:'999',warehouse:'1062',price:9.97,confirmed:true},worker),e=>e.code==='MANAGER_REQUIRED');
    const intake=await s.app.workflow.intake({submissionId:submission.id,title:'Example New Product',brand:'Example Brand',itemNumber:'999',warehouse:'1062',price:9.97,confirmed:true},owner);assert(intake.productKey);assert.equal((await s.app.workflow.state(owner)).targets.length,0);assert.equal(s.app.provider.calls.length,0);
  }finally{await s.close();}
});
test('Keepa facts preserve price timestamps and distinguish fee components, eligibility and sales brackets',()=>{
  const f=keepaFacts({productType:0,domainId:1,asin:'B000000001',lastUpdate:1,monthlySold:1000,fbaFees:{pickAndPackFee:259},referralFeePercentage:15,stats:{buyBoxPrice:2000,buyBoxShipping:300,lastBuyBoxUpdate:1,current:[null,null,null,5000]}},current());
  assert.equal(f.buyBoxPrice,23);assert.equal(f.totalAmazonFees,null);assert.equal(f.monthlyVelocity,null);assert.equal(f.monthlyBoughtLowerBound,1000);assert.equal(f.eligibility,'not_checked');assert(f.buyBoxUpdatedAt.startsWith('2011-'));
  assert.equal(keepaFacts({stats:{buyBoxPrice:-1,buyBoxShipping:0}},current()).buyBoxPrice,null);
});
test('Keepa parent, inaccessible and non-US results never supply a current selling price',()=>{
  for(const patch of [{productType:5},{productType:3},{productType:0,domainId:6},{}]){const f=keepaFacts({...patch,stats:{buyBoxPrice:2000,buyBoxShipping:0},upcList:{malformed:true}},current());assert.equal(f.standardUsListing,false);assert.equal(f.buyBoxPrice,null);assert.deepEqual(f.identifiers,[]);}
});
test('Keepa requests use fixed HTTPS endpoints, cache evidence and redact the key from returned data',async()=>{
  const db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:new DemoProvider(),demo:true});let calls=0;const secret='synthetic-keepa-secret-001';
  const client=new KeepaClient(app.store,{read:async()=>secret,configured:()=>true},{fetcher:async(url,options)=>{calls++;assert.equal(url.origin,'https://api.keepa.com');assert.equal(url.searchParams.get('key'),secret);assert.equal(options.redirect,'error');return new Response(JSON.stringify({products:[],tokensLeft:100,message:secret}));}});
  try{const r=await client.request({code,history:0});assert(!JSON.stringify(r).includes(secret));assert.equal((await client.request({code,history:0})).cached,true);assert.equal(calls,1);}finally{await app.enrichment.close();await db.close();}
});
test('sign-in enforces worker permissions on the server and never returns passwords or hashes',async()=>{
  const db=await openDatabase(),app=await createApp({db,dataDir:'.',provider:new DemoProvider(),demo:true}),base=await app.listen(0);
  const headers={'x-50toc-session':app.session,'Content-Type':'application/json'};
  const call=(path,body,cookie)=>fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{const ownerAccount={username:'manager-test',name:'Test manager',password:'synthetic-owner-password',role:'manager'},created=await call('accounts',ownerAccount);assert.equal(created.status,200);const managerCookie=created.headers.get('set-cookie').split(';')[0];assert(created.headers.get('set-cookie').includes('HttpOnly'));assert(!JSON.stringify(await created.json()).includes('password'));
    const workerAccount={username:'worker-test',name:'Test worker',password:'synthetic-worker-password',role:'worker'};assert.equal((await call('accounts',workerAccount,managerCookie)).status,200);assert.equal((await call('workflow')).status,401);
    const login=await call('auth/login',{username:workerAccount.username,password:workerAccount.password}),cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await call('worker',undefined,cookie)).status,200);
    for(const [path,body]of [['workflow',undefined],['accounts',undefined],['workflow/decision',{}],['key',{key:'synthetic-key'}]])assert.equal((await call(path,body,cookie)).status,403,path);
    assert.equal((await call('auth/login',{username:workerAccount.username,password:'wrong'})).status,401);await call('auth/logout',{},cookie);assert.equal((await call('worker',undefined,cookie)).status,401);
  }finally{await app.close();}
});
test('a new loss analysis holds the existing target without erasing quantities or purchases',async()=>{
  const s=await setup();try{await approve(s,10);await buy(s,1);const next=await s.app.workflow.analyze({productKey:s.key,asin:s.item.asin,offerId:s.offer.id,revision:s.item.revision,values:{...values(),buyBoxPrice:1}},owner);assert.equal(next.item.result.route,'reject');const state=await s.app.workflow.state(owner);assert.equal(state.targets[0].status,'held');assert.equal(state.targets[0].remainingUnits,9);assert.equal(state.purchases.length,1);}finally{await s.close();}
});
test('concurrent payment attempts cannot pay the same club units twice',async()=>{
  const s=await setup();try{await approve(s,10);await buy(s,1);const input={workerId:worker.id,from:'2026-01-01',to:'2030-12-31',rates:{[s.key]:1}},quote=await s.app.workflow.calculatePay(input,owner);
    const result=await Promise.allSettled(['concurrent-payment-a','concurrent-payment-b'].map(requestId=>s.app.workflow.markPaid({...input,fingerprint:quote.fingerprint,requestId},owner)));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.app.workflow.state(owner)).payments.length,1);
  }finally{await s.close();}
});
test('worker responses expose their purchase facts but omit managerial analysis snapshots',async()=>{
  const s=await setup();try{await approve(s,3);const p=await buy(s,1);assert.equal(p.purchase.approvalSnapshot,undefined);const state=await s.app.workflow.workerState(worker);assert.equal(state.purchases[0].approvalSnapshot,undefined);assert.equal((await s.app.workflow.workerState(second)).purchases.length,0);assert((await s.app.workflow.state(owner)).purchases[0].approvalSnapshot.analysisSnapshot);}
  finally{await s.close();}
});
test('UPC review changes invalidate buying approval even if reviewed titles still agree',async()=>{
  const s=await setup();try{await approve(s,3);let t=(await s.app.workflow.workerState(worker)).targets[0];await s.app.workflow.reserve({targetId:t.id,revision:t.revision,units:1},worker);t=(await s.app.workflow.workerState(worker)).targets[0];const c=await s.app.matching.get(s.key);
    await s.app.matching.saveUpc(s.key,{...c.upc,status:'unverified',revision:c.upc.revision,profileRevision:c.profile.revision,sourceSignature:c.profile.sourceSignature,checkedPackage:false,actor:owner.username,note:'Barcode evidence withdrawn for rechecking.'});
    await assert.rejects(s.app.workflow.purchase({targetId:t.id,revision:t.revision,quantity:1,unitPrice:19.97,tax:0,warehouse:'1062',requestId:'changed-upc-purchase'},worker),e=>e.code==='BUYING_HELD');
  }finally{await s.close();}
});
test('Keepa import preserves existing human-reviewed candidates and holds new ASIN facts for review',async()=>{
  const s=await setup();try{await s.app.catalog.lookup(s.key,owner);const context=await s.app.matching.get(s.key);assert.equal(context.candidates.find(c=>c.asin==='B000000001').detailsReviewed,true);assert.equal(context.candidates.find(c=>c.asin==='DEMO000001').detailsReviewed,false);assert.equal(context.candidates.find(c=>c.asin==='DEMO000001').result.route,'needs_information');await s.app.catalog.lookup(s.key,owner);assert.equal((await s.app.matching.get(s.key)).candidates.length,2);}
  finally{await s.close();}
});
test('submission photos are linked evidence, do not create purchases and remain restricted to their owner',async()=>{
  const s=await setup();try{const submission=await s.app.workflow.submit({type:'new_deal',title:'New test product',warehouse:'1062',price:10,note:'Synthetic shelf photo follows.',requestId:'photo-submission-0001'},worker),file=await s.app.receipts.upload({submissionId:submission.id,name:'shelf.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.7\nSynthetic shelf evidence').toString('base64')},worker);assert.equal((await s.app.workflow.state(owner)).purchases.length,0);assert((await s.app.receipts.read(file.receipt.id,worker)).base64);await assert.rejects(s.app.receipts.read(file.receipt.id,second),e=>e.code==='RECEIPT_ACCESS');}
  finally{await s.close();}
});
