import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCostcoItem,normalizeCostcoResponse} from '../src/normalize.mjs';
test('normalizes warehouse price without inventing UPC',()=>{
 const p=normalizeCostcoItem({name:'Test Item',item_number:'100',warehouse_price:'$9.97',regular_price:'19.99'},{warehouseId:'42'});
 assert.equal(p.retailer,'costco');assert.equal(p.currentPrice,9.97);assert.equal(p.warehouseId,'42');assert.equal(p.upc,null);assert.ok(p.warnings.includes('upc_not_provided'));
});
test('response is explicitly not full-coverage',()=>{
 const r=normalizeCostcoResponse({data:{results:[{name:'Item',sku:'1',price:5}]}});
 assert.equal(r.products.length,1);assert.equal(r.coverage.complete,false);
});
test('rejects unexpected response shape',()=>{
 assert.throws(()=>normalizeCostcoResponse({data:{foo:1}}),/No Costco product array/);
});
