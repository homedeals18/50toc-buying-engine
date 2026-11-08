import {createHash,randomUUID} from 'node:crypto';
import {AppError,redact,eventFor} from './errors.mjs';
import {validateGtin} from './identifiers.mjs';
const ns='jason_research.';
export const keepaDate=value=>Number.isSafeInteger(value)&&value>=0?new Date((value+21564000)*60000).toISOString():null;
const positive=v=>Number.isFinite(v)&&v>=0?v:null;
export function keepaFacts(p,at){
  const standard=p.productType===0&&p.domainId===1,s=standard?p.stats??{}:{},price=positive(s.buyBoxPrice),shipping=positive(s.buyBoxShipping),rank=positive(s.current?.[3]);
  return {asin:p.asin,title:p.title,brand:p.brand??null,observedAt:at,source:'Keepa API',marketplace:'US',currency:'USD',
    productType:p.productType??null,standardUsListing:standard,productUpdatedAt:keepaDate(p.lastUpdate),buyBoxUpdatedAt:keepaDate(s.lastBuyBoxUpdate),buyBoxPrice:price!==null&&shipping!==null&&s.buyBoxIsUnqualified!==true?(price+shipping)/100:null,
    rank,categoryId:p.salesRankReference>0?String(p.salesRankReference):null,
    monthlyBoughtLowerBound:positive(p.monthlySold),monthlyVelocity:null,velocityNote:'Amazon bought-past-month brackets are lower bounds, not a complete sales estimate. Rank drops are not unit sales.',
    fulfillmentFee:standard&&positive(p.fbaFees?.pickAndPackFee)!==null?p.fbaFees.pickAndPackFee/100:null,referralPercentage:standard?positive(p.referralFeePercentage):null,
    feesConfirmed:false,totalAmazonFees:null,eligibility:'not_checked',identifiers:[p.upcList,p.eanList,p.gtinList].flatMap(a=>Array.isArray(a)?a:[]).filter(v=>validateGtin(v).valid),
    warnings:[...(!standard?['Nonstandard, parent, inaccessible or unknown-marketplace result. No current selling price accepted.']:[]),'Keepa fee components are not a confirmed total fee estimate.','Confirm Amazon package facts before treating an imported ASIN as an exact match.']};
}
export class KeepaClient{
  constructor(store,vault,{fetcher=fetch,timeout=120000}={}){Object.assign(this,{store,vault,fetcher,timeout});}
  configured(){return this.vault.configured();}
  async request(params,{cache=true}={}){
    const key=await this.vault.read(),cacheKey=createHash('sha256').update(JSON.stringify(['keepa',key,params])).digest('hex');
    if(cache){const hit=await this.store.cached(cacheKey);if(hit)return hit;}
    const url=new URL('https://api.keepa.com/product');url.searchParams.set('key',key);url.searchParams.set('domain','1');for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
    try{
      let response;try{response=await this.fetcher(url,{headers:{'Accept-Encoding':'gzip'},redirect:'error',signal:AbortSignal.timeout(this.timeout)});}catch{throw new AppError('KEEPA_NETWORK','Keepa could not be reached. No automatic paid retry was made.',{status:502,stage:'transport'});}
      if(!response.ok){await response.body?.cancel();throw new AppError(response.status===429?'KEEPA_TOKENS_REQUIRED':'KEEPA_HTTP','Keepa did not accept the request. Check the key, subscription and token balance.',{status:502,httpStatus:response.status,stage:'http'});}
      const chunks=[];let size=0;for await(const part of response.body){size+=part.length;if(size>16*1024*1024)throw new AppError('KEEPA_RESPONSE_SIZE','Keepa returned an unexpectedly large response.',{status:502,stage:'response'});chunks.push(part);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError('KEEPA_JSON','Keepa returned an unreadable response.',{status:502,stage:'response'});}
      if(body.error||!Array.isArray(body.products))throw new AppError('KEEPA_SCHEMA','Keepa did not return a supported product response. No raw error details were exposed.',{status:502,stage:'response'});
      const json=redact(body,[key]),observedAt=new Date().toISOString();if(cache)await this.store.putCache(cacheKey,json,observedAt);
      return {json,observedAt,cached:false};
    }catch(e){const error=e instanceof AppError?e:new AppError('KEEPA_LOCAL','The Keepa result could not be saved.',{status:500});const event=eventFor(error,'keepa_product');error.eventId=event.id;await this.store.event(event);throw error;}
  }
}
export class CatalogService{
  constructor(store,matching,client,{demo=false}={}){Object.assign(this,{store,matching,client,demo});this.busy=false;}
  async lookup(key,actor){
    if(this.busy)throw new AppError('CATALOG_ACTIVE','Wait for the current Amazon lookup.',{status:409});this.busy=true;
    try{
      const context=await this.matching.get(key),upc=context.upc;
      if(!upc||upc.status!=='verified'||upc.scope!=='club_package'||upc.sourceSignature!==context.profile.sourceSignature||!validateGtin(upc.value).valid)throw new AppError('UPC_CONFIRM_REQUIRED','Confirm the current full club-package UPC before searching Amazon by barcode.');
      const response=await this.client.request({code:upc.value,stats:90,history:0,buybox:1});
      const products=response.json.products;
      if(!Array.isArray(products))throw new AppError('KEEPA_SCHEMA','Keepa product results could not be read.',{status:502});
      const record={id:randomUUID(),productKey:key,sourceSignature:context.profile.sourceSignature,upc:upc.value,observedAt:response.observedAt,cached:response.cached,tokensConsumed:response.json.tokensConsumed??null,tokensLeft:response.json.tokensLeft??null,
        records:products.filter(p=>/^[A-Z0-9]{10}$/.test(p?.asin??'')).map(p=>({product:p,facts:keepaFacts(p,response.observedAt)}))};
      await this.store.db.transaction(async db=>{
        await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[key]);
        const current=(await db.query('SELECT body FROM '+ns+'enrichment_profiles WHERE product_key=$1',[key])).rows[0]?.body;
        record.sourceChanged=current?.sourceSignature!==record.sourceSignature;
        await db.query('INSERT INTO '+ns+'catalog_lookups VALUES($1,$2,$3,$4::jsonb)',[record.id,key,record.observedAt,JSON.stringify(record)]);
        if(record.sourceChanged)return;
        for(const {product:p,facts}of record.records){
          if(!facts.standardUsListing)continue;
          const exists=(await db.query('SELECT asin FROM '+ns+'amazon_candidates WHERE product_key=$1 AND asin=$2',[key,p.asin])).rows.length;if(exists)continue;
          const parsed=this.matching.parseCandidate({title:String(p.title??'Untitled Amazon result').slice(0,1000),brand:String(p.brand??'').slice(0,200)});
          const candidate={asin:p.asin,title:p.title??'Untitled Amazon result',brand:p.brand??'',fields:parsed.fields,upc:facts.identifiers[0]??'',upcScope:'unknown',upcVerified:false,detailsReviewed:false,
            sourceUrl:'https://www.amazon.com/dp/'+p.asin,note:'Imported by UPC through Keepa. Confirm identity, package scope and fields.',actor:actor.username,revision:1,observedAt:response.observedAt,source:'keepa',clubRevisionAtSave:context.profile.revision,clubSignatureAtSave:context.profile.sourceSignature};
          await db.query('INSERT INTO '+ns+'amazon_candidates VALUES($1,$2,1,$3::jsonb)',[key,p.asin,JSON.stringify(candidate)]);
          await db.query('INSERT INTO '+ns+'candidate_history VALUES($1,$2,$3,1,$4,$5::jsonb)',[randomUUID(),key,p.asin,response.observedAt,JSON.stringify({candidate,result:{route:'needs_information',reasons:['Imported package facts require human review.'],purchaseApproved:false}})]);
        }
      });
      return {lookup:record,found:record.records.length,standardUsListings:record.records.filter(r=>r.facts.standardUsListing).length};
    }finally{this.busy=false;}
  }
  async latest(key){return (await this.store.db.query('SELECT body FROM '+ns+'catalog_lookups WHERE product_key=$1 ORDER BY observed_at DESC LIMIT 1',[key])).rows[0]?.body??null;}
}
export class DemoKeepaClient{
  configured(){return true;}
  async request(params){
    const now=Math.floor(Date.now()/60000)-21564000;
    return {cached:false,observedAt:new Date().toISOString(),json:{tokensConsumed:0,tokensLeft:0,products:[{productType:0,domainId:1,asin:'DEMO000001',title:'Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack',brand:'Example Brand',upcList:[params.code??'012345678905'],lastUpdate:now,salesRankReference:123,monthlySold:100,
      fbaFees:{pickAndPackFee:300},referralFeePercentage:15,stats:{current:[null,null,null,20000],lastBuyBoxUpdate:now,buyBoxPrice:3999,buyBoxShipping:0,buyBoxIsUnqualified:false}}]}};
  }
}
