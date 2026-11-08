import {createHash} from 'node:crypto';
import {AppError, nonnegativeNumber as number} from './errors.mjs';

export const dealTypes=[
  {id:'clearance',label:'Clearance',detail:'.97 warehouse price ending'},
  {id:'manager_markdown',label:'Manager markdowns',detail:'.00 / .88 warehouse price endings'},
  {id:'special_buy',label:'Special-buy indicators',detail:'.49 / .79 / .89 · not proof of a discount'},
  {id:'on_sale',label:'Sale promotions',detail:'Provider-reported active discounts'},
  {id:'coupon_book',label:'Member coupon book',detail:'Published savings, dates and offer scope'},
  {id:'while_supplies_last',label:'While Supplies Last',detail:'Limited-availability feed'},
  {id:'treasure_hunt',label:'Treasure Hunt',detail:'Discovery · discount not guaranteed'},
  {id:'online_only',label:'Online Only',detail:'Online offers · warehouse price not implied'},
  {id:'new',label:'New Items',detail:'Discovery · not necessarily discounted'},
  {id:'member_favorites',label:'Member Favorites',detail:'Discovery · not necessarily discounted'}
];
const markdowns=['clearance','manager_markdown','special_buy'];
const feeds=['while_supplies_last','treasure_hunt','online_only','new','member_favorites'];
export const coverage='All supported pages returned for the selected scope. Provider coverage is limited to listed online merchandise; physical warehouse inventory may differ.';
export const aliases=item=>[...new Set([['item',item.item_number??item.itemNumber],['product',item.product_id??item.productId],['sku',item.sku],['id',item.id]].filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([kind,value])=>kind+':'+String(value)))];
export function categoriesFrom(payload){
  if(!Array.isArray(payload?.data?.categories))throw new AppError('CATEGORY_SCHEMA_CHANGED','The provider did not return a department list.',{status:502,stage:'response'});
  const rows=[];
  function visit(items,parent=''){for(const x of items){if(!x||typeof x!=='object')continue;const id=String(x.slug??'').trim();if(id&&x.name)rows.push({id,slug:id,name:String(x.name),parent,nativeId:String(x.category_id??x.id??'')});for(const k of ['children','subcategories','categories'])if(Array.isArray(x[k]))visit(x[k],String(x.name??parent));}}
  visit(payload.data.categories);return [...new Map(rows.map(c=>[c.id,c])).values()];
}
export function planScan(input,categories){
  if(input.retailer && input.retailer!=='costco')throw new AppError('MODULE_NOT_CONNECTED','Choose Costco. The other club modules will follow later.');
  for(const k of ['warehouses','categoryIds','dealTypes'])if(!Array.isArray(input[k])||input[k].some(x=>typeof x!=='string'))throw new AppError('SELECTION_REQUIRED','Choose warehouses, departments and deal types.');
  const warehouses=[...new Set(input.warehouses)],ids=[...new Set(input.categoryIds)],types=[...new Set(input.dealTypes)];
  if(!warehouses.length||warehouses.some(x=>!/^\d{1,8}$/.test(x)))throw new AppError('WAREHOUSE_REQUIRED','Choose at least one valid warehouse.');
  const selected=ids.map(id=>categories.find(c=>c.id===id));
  if(!selected.length||selected.some(c=>!c))throw new AppError('DEPARTMENT_REQUIRED','Load and choose at least one Costco department.');
  if(!types.length||types.some(t=>!dealTypes.some(d=>d.id===t)))throw new AppError('DEAL_TYPE_REQUIRED','Choose at least one supported deal type.');
  const tasks=[];
  const needIndex=types.some(t=>feeds.includes(t)||t==='coupon_book');
  const needCategory=needIndex||types.some(t=>markdowns.includes(t)||t==='on_sale');
  if(needCategory)for(const warehouse of warehouses)for(const category of selected)tasks.push({id:'department-'+warehouse+'-'+category.id,kind:'department',endpoint:'costco/category',warehouse,category,onSaleOnly:!needIndex&&!types.some(t=>markdowns.includes(t))&&types.includes('on_sale'),page:1,status:'pending'});
  for(const type of types.filter(t=>feeds.includes(t)))for(const warehouse of warehouses)tasks.push({id:type+'-'+warehouse,kind:'feed',endpoint:'costco/deals',type,warehouse,page:1,status:'pending'});
  if(types.includes('coupon_book'))tasks.push({id:'coupon-book',kind:'coupon',endpoint:'costco/coupons',page:1,status:'pending'});
  return {scope:{retailer:'costco',warehouses,categories:selected,dealTypes:types,force:input.force===true},tasks,
    minimumCredits:tasks.reduce((n,t)=>n+(t.kind==='coupon'?1:2),0),requiresCategoryIndex:needIndex,
    explanation:tasks.map(t=>({label:t.kind==='department'?t.category.name+' · warehouse '+t.warehouse+(needIndex?' (also identifies department membership)':''):t.kind==='coupon'?'Member coupon book':dealTypes.find(d=>d.id===t.type).label+' · warehouse '+t.warehouse,minimumCredits:t.kind==='coupon'?1:2})),coverage};
}
export function requestFor(task){
  if(task.kind==='coupon')return {};
  return {country:'us',warehouse_id:task.warehouse,page:task.page,page_size:120,
    ...(task.kind==='department'?{category:task.category.slug,...(task.onSaleOnly?{on_sale:true}:{})}:{type:task.type})};
}
export function readPage(payload,task){
  const data=payload?.data,items=task.kind==='coupon'?data?.coupons:data?.results??data?.products;
  if(!Array.isArray(items)||items.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new AppError('PRODUCT_SCHEMA_CHANGED','The provider did not return a usable product list. Earlier pages remain saved.',{status:502,stage:'response'});
  if(task.kind==='coupon')return {data,items,finished:true};
  const total=number(data.total_pages), page=number(data.page);
  if(!Number.isInteger(total)||total<0||total>500||page!==task.page||(!items.length&&task.page<total)||(!total&&items.length)||task.page>Math.max(total,1))
    return {data,items,finished:false,paginationError:new AppError('PAGINATION_INCOMPLETE','The provider pagination could not be verified. This scan is incomplete; received records remain saved.',{status:502,stage:'response'})};
  return {data,items,finished:task.page>=total, paginationError:null};
}
export function selectedTypes(item, warehouse, types){
  const w=item.warehouse??{}, verified=String(w.warehouse_id??item.warehouse_id??'')===warehouse;
  const p=verified?number(w.price??item.warehouse_price):null;
  const ending=p===null?null:Math.round(p*100)%100;
  const inferred=ending===97?'clearance':[0,88].includes(ending)?'manager_markdown':[49,79,89].includes(ending)?'special_buy':null;
  const output=[];
  if(inferred&&types.includes(inferred))output.push(inferred);
  if(types.includes('on_sale')&&item.on_sale===true)output.push('on_sale');
  if(!output.length&&p===null&&types.some(t=>markdowns.includes(t)))output.push('unverified_markdown');
  return output;
}
function url(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function normalizeOffer(item,{warehouse,categories,types,scanId,endpoint,observedAt,cached=false,base=null,book=null,rules={}}){
  const source={...(base?.item??{}),...item}, ids=aliases(source);
  const title=String(source.title??source.name??'Unnamed product'), w=item.warehouse??base?.item?.warehouse??{};
  const verified=String(w.warehouse_id??source.warehouse_id??'')===warehouse;
  const warehousePrice=verified?number(w.price??source.warehouse_price):null;
  const productKey='costco|'+(ids[0]??createHash('sha256').update(JSON.stringify([title,source.brand,source.url])).digest('hex'));
  const reasons=[];
  if(!ids.length)reasons.push('Provider product identifier missing; temporary identity needs review.');
  if(warehousePrice===null)reasons.push('Warehouse purchase price is not verified.');
  if(types.includes('unverified_markdown'))reasons.push('Selected markdown type could not be verified.');
  if(types.includes('online_only'))reasons.push('Online-only offer; warehouse availability is not established.');
  if(rules.flagVariety!==false&&/\b(?:variety\s+pack|assorted|mixed\s+(?:flavou?r|pack)|sampler)\b/i.test(title))reasons.push('Mixed or variety pack needs sourcing review.');
  if(rules.flagPerishable!==false&&(source.requires_refrigeration===true||/\b(?:frozen|refrigerated|fresh produce|fresh meat|fresh seafood)\b/i.test(title)))reasons.push('Perishable item needs sourcing review.');
  return {id:productKey+'|'+warehouse,productKey,retailer:'costco',warehouseId:warehouse,itemNumber:String(source.item_number??source.itemNumber??''),productId:String(source.product_id??''),title,brand:source.brand??null,upc:source.upc??source.gtin??null,
    packageSize:source.package_size??source.size??null,packCount:source.pack_count??null,description:source.description??null,
    warehousePrice,warehousePriceObservedAt:warehousePrice===null?null:(item.warehouse?observedAt:base?.observedAt??observedAt),
    onlinePrice:number(source.price),currency:'USD',priceContext:warehousePrice===null?'unverified_warehouse_price':'provider_warehouse_price',
    availability:w.availability??null,availableQuantity:number(w.available_quantity),imageUrl:url(source.image_url??source.image),productUrl:url(source.url??source.product_url),
    categories,dealTypes:types,firstSeen:observedAt,observedAt,sourceCached:cached,
    coupon:book?{validFrom:book.valid_from??null,validTo:book.valid_to??null,appliesTo:item.applies_to??null,discount:item.discount??null,finalPrice:number(item.final_price??item.discount?.final_price)}:null,
    disposition:reasons.length?'needs_information':'collected',reasons,analysisStatus:'not_connected',
    evidence:[{provider:'Scavio',endpoint,scanId,observedAt,cached}],sourceData:{item,...(base?{departmentItem:base.item}:{})},coverage};
}
