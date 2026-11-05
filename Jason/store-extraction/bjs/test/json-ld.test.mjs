import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProductFromJsonLd} from '../src/json-ld.mjs';
const product={ '@context':'https://schema.org','@type':'Product',name:'Sample',sku:'123',gtin12:'036000291452',brand:{name:'Brand'},offers:{price:'12.99',availability:'https://schema.org/InStock'},image:'/item.jpg' };
test('extracts product identifiers and offer from JSON-LD',()=>{
 const p=extractProductFromJsonLd([JSON.stringify(product)],{productUrl:'https://www.bjs.com/product/sample',sku:'123'});
 assert.equal(p.upc,'036000291452');assert.equal(p.currentPrice,'12.99');assert.equal(p.brand,'Brand');assert.equal(p.imageUrl,'https://www.bjs.com/item.jpg');
});
test('supports graph JSON-LD and matches requested SKU',()=>{
 const other={...product,sku:'999'};
 const p=extractProductFromJsonLd([JSON.stringify({'@graph':[other,product]})],{sku:'123'});
 assert.equal(p.sku,'123');
});
test('ignores malformed JSON and unrelated schema types',()=>{
 assert.equal(extractProductFromJsonLd(['broken',JSON.stringify({'@type':'BreadcrumbList'})]),null);
});
