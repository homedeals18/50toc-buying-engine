// Costco-only normalization for authorized Scavio JSON responses.
// Preserve source provenance; never fabricate missing UPCs, club prices or completeness.
const value=(...items)=>items.find(v=>v!==null&&v!==undefined&&v!=='')??null;
const str=v=>v===null||v===undefined?null:String(v).trim()||null;
const price=v=>{const n=Number(String(v??'').replace(/[$,]/g,''));return Number.isFinite(n)&&n>=0&&v!==null&&v!==undefined&&v!==''?n:null;};
export function normalizeCostcoItem(item,{warehouseId=null,observedAt=new Date().toISOString()}={}){
  if(!item||typeof item!=='object') throw new Error('Costco item must be an object');
  const name=str(value(item.name,item.product_name,item.title,item.productName));
  const sku=str(value(item.item_number,item.itemNumber,item.sku,item.product_id,item.id));
  const url=str(value(item.url,item.product_url,item.productUrl));
  const currentPrice=price(value(item.warehouse_price,item.club_price,item.sale_price,item.current_price,item.price));
  const originalPrice=price(value(item.original_price,item.regular_price,item.list_price,item.was_price));
  const upc=str(value(item.upc,item.gtin,item.gtin12,item.barcode));
  const warnings=[];
  if(!upc) warnings.push('upc_not_provided');
  if(!warehouseId&&!item.warehouse_id&&!item.warehouseId) warnings.push('warehouse_not_identified');
  if(currentPrice===null) warnings.push('price_not_provided');
  return {retailer:'costco',name,sku,upc,brand:str(item.brand),packageSize:str(value(item.package_size,item.size,item.pack_size)),currentPrice,originalPrice,warehouseId:str(value(item.warehouse_id,item.warehouseId,warehouseId)),availability:value(item.availability,item.in_stock),category:str(item.category),description:str(item.description),productUrl:url,imageUrl:str(value(item.image_url,item.image,item.imageUrl)),observedAt,source:'scavio',warnings,raw:item};
}
export function normalizeCostcoResponse(payload,options={}){
  const data=payload?.data??payload;
  const items=Array.isArray(data)?data:value(data?.results,data?.products,data?.items);
  if(!Array.isArray(items)) throw new Error('No Costco product array found; inspect live Scavio schema');
  return {retailer:'costco',generatedAt:new Date().toISOString(),coverage:{complete:false,reason:'Scavio search results do not establish full warehouse clearance coverage'},products:items.map(x=>normalizeCostcoItem(x,options))};
}
