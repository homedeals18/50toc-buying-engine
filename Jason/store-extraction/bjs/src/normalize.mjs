const str = x => typeof x === 'string' ? x.trim() || null : null;
const money = x => { if (x == null || x === '') return null; const n=Number(String(x).replace(/[$,]/g,'')); return Number.isFinite(n)&&n>=0?Math.round(n*100)/100:null; };
export function normalize(raw, meta) {
  const errors=[], warnings=[];
  const name=str(raw.productName??raw.name), sku=str(raw.sku), url=str(raw.productUrl??raw.url);
  const price=money(raw.currentPrice??raw.price), source=str(raw.dealSource);
  if(!name)errors.push('missing_name');
  if(!sku&&!url)errors.push('missing_identity');
  if(price===null)errors.push('missing_or_invalid_price');
  if(!['Clearance','Wow Deals'].includes(source))errors.push('invalid_deal_source');
  if(!meta.storeId)errors.push('missing_store_id');
  if(!raw.upc)warnings.push('missing_upc');
  if(!meta.storeLocation)warnings.push('unverified_store_location');
  return {schemaVersion:'1.0',retailer:'BJs',scanId:meta.scanId,scannedAt:meta.scannedAt,
    storeId:meta.storeId,storeLocation:meta.storeLocation??null,dealSource:source,sku,
    upc:str(raw.upc),productName:name,brand:str(raw.brand),category:str(raw.category),
    packageSize:str(raw.packageSize),currentPrice:price,originalPrice:money(raw.originalPrice),
    discount:str(raw.discount),coupon:str(raw.coupon),availability:str(raw.availability),
    productUrl:url,imageUrl:str(raw.imageUrl),extraction:{status:errors.length?'invalid':'valid',errors,warnings}};
}
export function handoff(input, scannedAt=new Date().toISOString()) {
  if(!input||!Array.isArray(input.products)||!input.storeId)throw Error('products array and storeId required');
  if(input.scanComplete!==true)throw Error('Incomplete scan: scanComplete must be true');
  const scanId=input.scanId??'unspecified';
  const seen=new Set(),unique=[];let duplicates=0;
  for(const raw of input.products){
    const record=normalize(raw,{scanId,scannedAt,storeId:input.storeId,storeLocation:input.storeLocation});
    const key=[record.storeId,record.dealSource,record.sku||record.productUrl].join('|');
    if(seen.has(key)){duplicates++;continue;}seen.add(key);unique.push(record);
  }
  if(Number.isInteger(input.expectedProductCount)&&unique.length<input.expectedProductCount)
    throw Error('Incomplete coverage: expected '+input.expectedProductCount+', found '+unique.length);
  const products=unique.filter(x=>x.extraction.status==='valid');
  const rejectedRecords=unique.filter(x=>x.extraction.status!=='valid');
  return {schemaVersion:'1.0',report:{scanId,scannedAt,storeId:input.storeId,scanComplete:true,
    inputCount:input.products.length,uniqueCount:unique.length,duplicateCount:duplicates,
    validCount:products.length,invalidCount:rejectedRecords.length,
    missingUpcCount:products.filter(x=>!x.upc).length,
    coverageVerified:Number.isInteger(input.expectedProductCount)&&unique.length>=input.expectedProductCount},
    products,rejectedRecords};
}
