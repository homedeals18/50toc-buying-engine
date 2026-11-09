import {AppError,nonnegativeNumber as number} from './errors.mjs';

const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const ns='jason_research.';
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
export function promotionDetails(offer,detail=null){
  const raw=offer.sourceData?.item??{},promotions=[raw.promotions,detail?.promotions].flatMap(v=>Array.isArray(v)?v:[]);
  const texts=[...new Set(promotions.flatMap(p=>typeof p==='string'?[p]:[p?.text,p?.description,p?.message,p?.title].filter(v=>typeof v==='string')).map(v=>v.slice(0,2000)))];
  const dates=[offer.coupon?.validTo,raw.promotion_end,raw.sale_end,raw.instant_savings?.end_date,...promotions.flatMap(p=>typeof p==='object'?[p?.end_date,p?.valid_to,p?.validTo]:[])].map(date).filter(Boolean);
  const end=[...new Set(dates)].sort((a,b)=>Date.parse(a)-Date.parse(b))[0]??null;
  return {promotionText:texts,saleEndDate:end,saleEndScope:offer.coupon?.appliesTo??(detail?'Retailer promotion; warehouse applicability unconfirmed':null)};
}
export function decoratePrice(offer,check=null,detail=null){
  if(offer.retailer==='samsclub'){
    const raw=offer.sourceData?.item?.instant_savings;
    return {...offer,saleEndDate:date(raw?.end_date),saleEndLabel:typeof raw?.end_date==='string'?raw.end_date:null,saleEndScope:'Sam’s Club promotion; channel applicability requires review',promotionText:[raw?.message,raw?.title].filter(v=>typeof v==='string')};
  }
  const promotions=promotionDetails(offer,detail),current=check&&Date.parse(check.observedAt)>=Date.parse(offer.warehousePriceObservedAt??offer.observedAt);
  const verified=current&&check.status==='verified',base=verified?check.basePrice:offer.warehousePrice;
  const saleEndDate=verified&&check.endDate?check.endDate:promotions.saleEndDate;
  const hasPromotion=promotions.promotionText.length>0||offer.dealTypes?.some(t=>['on_sale','coupon_book'].includes(t));
  // A general online promotion is never subtracted from a warehouse shelf price.
  const purchasePrice=verified?check.finalPrice:hasPromotion?null:offer.warehousePrice;
  return {...offer,...promotions,warehousePrice:base,warehouseCouponPrice:verified?check.finalPrice:null,
    warehouseDiscountAmount:verified?check.discountAmount:null,warehousePurchasePrice:purchasePrice,
    warehousePriceVerified:verified||!hasPromotion&&offer.warehousePrice!==null,
    warehousePriceObservedAt:verified?check.observedAt:offer.warehousePriceObservedAt,
    warehousePricingStatus:current?check.status:hasPromotion?'coupon_not_verified':'listing_price',
    warehouseCouponMessage:verified?check.discountAmount>0?'Confirmed warehouse savings included':check.discountAmount===0?'No warehouse coupon returned':'Final warehouse price confirmed; coupon amount not itemized':current&&check.status==='unavailable'?'Warehouse price unavailable':'Warehouse coupon not verified',
    priceCheck:current?check:null,saleEndDate,saleEndScope:verified&&check.endDate?'Warehouse coupon':promotions.saleEndScope};
}
export function normalizePriceCheck(item,warehouse,offer,response){
  const basePrice=number(warehouse.price??warehouse.original_price),discountAmount=number(warehouse.discount?.amount??warehouse.discount_amount??warehouse.discount),finalPrice=number(warehouse.final_price);
  let status=finalPrice===null?'unavailable':'verified';
  if(basePrice!==null&&finalPrice!==null&&(finalPrice>basePrice+.01||discountAmount!==null&&Math.abs(round(basePrice-discountAmount)-finalPrice)>.01))status='conflict';
  const endDate=date(warehouse.promotion_end??warehouse.end_date??warehouse.discount?.end_date??warehouse.promotion?.end_date);
  return {offerId:offer.id,itemNumber:offer.itemNumber,warehouseId:offer.warehouseId,status,basePrice,discountAmount,finalPrice:status==='verified'?finalPrice:null,endDate,
    observedAt:response.observedAt,cached:response.cached,source:'Scavio Costco Warehouse Prices',raw:{item,warehouse}};
}
export class PriceService{
  constructor(store,provider){Object.assign(this,{store,provider});this.busy=false;}
  async plan(input={}){
    if(input.productKey!==undefined&&typeof input.productKey!=='string')throw new AppError('PRICE_SCOPE_INVALID','Choose a saved product or all saved Costco offers.');
    const offers=(await this.store.offers()).filter(o=>o.retailer==='costco'&&(!input.productKey||o.productKey===input.productKey));
    if(!offers.length)throw new AppError('PRICE_SCOPE_EMPTY','No saved Costco offers are available.');
    if(offers.some(o=>!/^\d{1,20}$/.test(o.itemNumber)))throw new AppError('ITEM_NUMBER_REQUIRED','A Costco item number is required; a product ID cannot substitute for it.');
    const items=[...new Set(offers.map(o=>o.itemNumber))],warehouses=[...new Set(offers.map(o=>o.warehouseId))];
    return {scope:input.productKey?{productKey:input.productKey}:{},offers,items,warehouses,requests:Math.ceil(items.length/20)*Math.ceil(warehouses.length/9),
      explanation:'Up to 20 item numbers and 9 warehouses per request, 1 credit if uncached. Conflicting or missing rows remain unverified. No automatic retry.'};
  }
  async refresh(input={}){
    if(this.busy)throw new AppError('PRICE_CHECK_ACTIVE','Wait for the current warehouse price check.',{status:409});this.busy=true;
    try{
      const plan=await this.plan(input),saved=[];let calls=0,cacheHits=0;
      for(let i=0;i<plan.items.length;i+=20)for(let w=0;w<plan.warehouses.length;w+=9){
        const ids=plan.items.slice(i,i+20),warehouses=plan.warehouses.slice(w,w+9);
        const response=await this.provider.call('costco/prices',{country:'us',item_ids:ids,warehouse_ids:warehouses});
        response.cached?cacheHits++:calls++;
        const items=response.json?.data?.items;
        if(!Array.isArray(items))throw new AppError('PRICE_SCHEMA_CHANGED','The warehouse-price response was not usable. Earlier checked prices remain saved.',{status:502});
        for(const offer of plan.offers.filter(o=>ids.includes(o.itemNumber)&&warehouses.includes(o.warehouseId))){
          const matches=items.filter(r=>String(r.item_number??r.item_id??'')===offer.itemNumber);
          const locations=matches.length===1&&Array.isArray(matches[0].warehouses)?matches[0].warehouses.filter(r=>String(r.warehouse_id??'')===offer.warehouseId):[];
          const record=locations.length===1?normalizePriceCheck(matches[0],locations[0],offer,response):{offerId:offer.id,itemNumber:offer.itemNumber,warehouseId:offer.warehouseId,status:'unavailable',basePrice:null,discountAmount:null,finalPrice:null,endDate:null,observedAt:response.observedAt,cached:response.cached,source:'Scavio Costco Warehouse Prices',reason:'Response did not uniquely identify the requested item and warehouse.'};
          await this.store.db.transaction(async db=>{
            await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[offer.productKey]);
            await db.query('INSERT INTO '+ns+'warehouse_price_checks VALUES($1,$2,$3::jsonb) ON CONFLICT(offer_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,body=EXCLUDED.body WHERE '+ns+'warehouse_price_checks.observed_at<=EXCLUDED.observed_at',[offer.id,response.observedAt,JSON.stringify(record)]);
          });
          saved.push({offerId:offer.id,status:record.status});
        }
      }
      return {checked:saved.length,calls,cacheHits,results:saved};
    }finally{this.busy=false;}
  }
}
