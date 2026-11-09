import React from 'react';
const money=n=>n===null||n===undefined?'Not verified':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
export const clubPurchasePrice=o=>o&&Object.hasOwn(o,'warehousePurchasePrice')?o.warehousePurchasePrice:o?.warehousePrice??null;
export function SaleEnd({offer}){
  const end=offer.saleEndDate??offer.coupon?.validTo;
  if(!end)return <span className="muted">Not provided</span>;
  if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(end)||!Number.isFinite(Date.parse(end)))return <><span>{offer.saleEndLabel??end}</span><small>Year or exact date not supplied; expiry unverified</small></>;
  const dateOnly=end.length===10,zone=offer.retailer==='costco'?'America/Los_Angeles':'America/New_York';
  const day=dateOnly?end:new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(end));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date());
  const expired=dateOnly?day<today:Date.parse(end)<Date.now(),soon=!expired&&Date.parse(day)-Date.parse(today)<=3*86400000;
  return <><strong>{new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))}</strong><small>{offer.saleEndScope??'Retailer promotion'}{expired?' · Expired':soon?' · Ending soon':''}</small></>;
}
export function WarehouseCouponPrice({offer}){
  return <><strong>{money(offer.warehouseCouponPrice)}</strong><small>{offer.warehouseDiscountAmount>0?money(offer.warehouseDiscountAmount)+' warehouse savings':offer.warehouseCouponMessage??'Warehouse coupon not verified'}</small>{offer.promotionText?.length>0&&<details><summary>Promotion details</summary>{offer.promotionText.map((p,i)=><p key={i}>{p}</p>)}</details>}</>;
}
