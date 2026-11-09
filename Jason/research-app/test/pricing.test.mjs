import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decoratePrice,normalizePriceCheck,promotionDetails,PriceService} from '../server/pricing.mjs';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {normalizeOffer} from '../server/costco.mjs';
const at='2026-11-09T06:00:00.000Z';
const offer={id:'costco|item:1106007|729',itemNumber:'1106007',productKey:'costco|item:1106007',retailer:'costco',warehouseId:'729',warehousePrice:23.99,warehousePriceObservedAt:at,observedAt:at,onlinePrice:19.99,dealTypes:['on_sale'],sourceData:{item:{promotions:['$4 OFF']}}};
test('online savings are never silently deducted from a warehouse listing',()=>{
  const p=decoratePrice(offer);assert.equal(p.warehousePrice,23.99);assert.equal(p.onlinePrice,19.99);
  assert.equal(p.warehouseCouponPrice,null);assert.equal(p.warehousePurchasePrice,null);assert.equal(p.warehousePriceVerified,false);
});
test('verified warehouse final price is used once, retaining separate original and online prices',()=>{
  const c=normalizePriceCheck({}, {price:18.49,discount:4,final_price:14.49},offer,{observedAt:at,cached:false});
  const p=decoratePrice(offer,c);assert.equal(p.warehousePrice,18.49);assert.equal(p.warehouseCouponPrice,14.49);assert.equal(p.warehousePurchasePrice,14.49);assert.equal(p.onlinePrice,19.99);assert.equal(p.warehouseDiscountAmount,4);
});
test('conflicting arithmetic, unavailable final prices and stale checks cannot verify a coupon',()=>{
  for(const row of [{price:18.49,discount:4,final_price:10.49},{price:18.49,discount:4}]){
    const c=normalizePriceCheck({},row,offer,{observedAt:at,cached:false});assert.notEqual(c.status,'verified');assert.equal(decoratePrice(offer,c).warehousePurchasePrice,null);
  }
  const c=normalizePriceCheck({}, {price:18.49,discount:4,final_price:14.49},offer,{observedAt:'2026-11-08T06:00:00Z',cached:true});assert.equal(decoratePrice(offer,c).warehouseCouponPrice,null);
});
test('explicit no-coupon and unitemized final prices preserve zero versus unknown discount',()=>{
  for(const [row,amount] of [[{price:12.99,discount:0,final_price:12.99},0],[{price:12.99,final_price:10.99},null]]){
    const c=normalizePriceCheck({},row,offer,{observedAt:at,cached:false});const p=decoratePrice(offer,c);assert.equal(p.warehouseDiscountAmount,amount);assert.equal(p.warehousePurchasePrice,row.final_price);
  }
});
test('published promotion expiry is retained without guessing dates from generic text',()=>{
  assert.equal(promotionDetails(offer,{promotions:[{description:'Manufacturer savings',end_date:'2026-11-16T07:59:00Z'}]}).saleEndDate,'2026-11-16T07:59:00Z');
  assert.equal(promotionDetails(offer).saleEndDate,null);
  assert.equal(promotionDetails({...offer,sourceData:{item:{instant_savings:{end_date:'Nov 18'}}}}).saleEndDate,null);
});
test('all 23 saved products are priced in two requests and matched by item and warehouse IDs',async()=>{
  const db=await openDatabase(),store=new Store(db),calls=[];
  try{
    for(let i=1;i<=23;i++){
      const o=normalizeOffer({item_number:String(i),title:'Item '+i,price:19.99,on_sale:true,promotions:['$4 OFF'],warehouse:{warehouse_id:'729',price:23.99}}, {warehouse:'729',categories:[],types:['on_sale'],scanId:'test',endpoint:'costco/category',observedAt:at});
      await db.query('INSERT INTO jason_research.products VALUES($1,$2,$3::jsonb)',[o.productKey,'costco',JSON.stringify({title:o.title})]);
      await db.query('INSERT INTO jason_research.offers VALUES($1,$2,$3,$4,$5::jsonb)',[o.id,o.productKey,'729',at,JSON.stringify(o)]);
    }
    const provider={async call(endpoint,body){calls.push({endpoint,body});return {observedAt:at,cached:false,json:{data:{items:body.item_ids.toReversed().map(item_number=>({item_number,warehouses:[{warehouse_id:'729',price:18.49,discount:4,final_price:14.49}]}))}}};}};
    const service=new PriceService(store,provider),r=await service.refresh();assert.equal(r.checked,23);assert.equal(calls.length,2);assert(calls.every(c=>c.endpoint==='costco/prices'&&c.body.item_ids.length<=20));
    assert((await store.offers()).every(o=>o.warehousePurchasePrice===14.49&&o.warehousePrice===18.49));
    provider.call=async()=>({observedAt:'2026-11-09T07:00:00Z',cached:false,json:{data:{items:[{item_number:'1',warehouses:[{warehouse_id:'999',price:1,discount:0,final_price:1}]}]}}});
    const bad=await service.refresh({productKey:'costco|item:1'});assert.equal(bad.results[0].status,'unavailable');assert.equal((await store.offers()).find(o=>o.itemNumber==='1').warehousePurchasePrice,null);
  }finally{await db.close();}
});
