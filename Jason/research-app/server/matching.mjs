import {randomUUID} from 'node:crypto';
import {AppError} from './errors.mjs';
import {syncProductProfile,validateFields} from './enrichment.mjs';
import {fieldDefinitions,extractDetails} from './enrichment-fields.mjs';
import {validateGtin,identifierCandidates,evidenceUrl} from './identifiers.mjs';
import {exactMatch} from './exact-rules.mjs';
import {sameRetailerItem} from './upc-evidence.mjs';
const ns='jason_research.',json=JSON.stringify;
function text(input,name,limit=500,{required=false}={}){
  if(typeof input!=='string'||input.length>limit||/[\u0000-\u001f]/.test(input)||required&&!input.trim())throw new AppError('MATCH_INPUT_INVALID','Enter valid '+name+'.');
  return input.trim();
}
function expectation(input,profile){
  if(input.profileRevision!==profile.revision||input.sourceSignature!==profile.sourceSignature)throw new AppError('MATCH_SOURCE_CHANGED','Club evidence or enrichment changed. Reload before saving.',{status:409});
}
async function lockedProfile(db,key){
  if(typeof key!=='string'||key.length>1000)throw new AppError('PRODUCT_REQUIRED','Choose a saved club product.');
  const found=(await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[key])).rows.length;
  if(!found)throw new AppError('PRODUCT_NOT_FOUND','Saved club product not found.',{status:404});
  const profile=await syncProductProfile(db,key);
  if(!profile)throw new AppError('PRODUCT_NOT_FOUND','Saved club product has no current warehouse offer.',{status:404});
  return profile;
}

export class MatchingService{
  constructor(store,enrichment,provider){Object.assign(this,{store,enrichment,provider});this.db=store.db;this.lookupActive=false;}
  async list(){
    const profiles=(await this.db.query('SELECT body FROM '+ns+'enrichment_profiles ORDER BY updated_at DESC,product_key')).rows.map(r=>r.body);
    const upcs=new Map((await this.db.query('SELECT product_key,body FROM '+ns+'product_upcs')).rows.map(r=>[r.product_key,r.body]));
    const candidates=(await this.db.query('SELECT product_key,body FROM '+ns+'amazon_candidates')).rows;
    const reports=new Map((await this.db.query('SELECT DISTINCT ON(product_key) product_key,body FROM '+ns+'upc_lookup_reports ORDER BY product_key,observed_at DESC')).rows.map(r=>[r.product_key,r.body]));
    return {liveCatalogConnected:this.catalogConnected?.()??false,secondaryEngineConnected:false,products:profiles.map(p=>{
      const barcode=upcs.get(p.productKey);
      const counts={exact:0,potential:0,needs_information:0,mismatch:0};
      for(const c of candidates.filter(c=>c.product_key===p.productKey))counts[exactMatch(p,barcode,c.body).route]++;
      const lookup=reports.get(p.productKey);
      return {productKey:p.productKey,title:p.title,itemNumber:p.itemNumber,counts,upcLookupStatus:barcode?.status==='verified'&&barcode.scope==='club_package'&&barcode.sourceSignature===p.sourceSignature?'package_verified':lookup?lookup.sourceSignature!==p.sourceSignature?'recheck_needed':lookup.summary?.status??'in_progress':'not_checked',
        upcStatus:barcode?.status==='verified'&&barcode.sourceSignature===p.sourceSignature?barcode.scope==='club_package'?'package_verified':'inner_unit_only':'needs_upc'};
    })};
  }
  async get(key){
    return this.db.transaction(async db=>{
      const profile=await lockedProfile(db,key);
      const upc=(await db.query('SELECT body FROM '+ns+'product_upcs WHERE product_key=$1',[key])).rows[0]?.body??null;
      const offers=(await db.query('SELECT body FROM '+ns+'offers WHERE product_id=$1',[key])).rows.map(r=>r.body);
      const lookups=(await db.query('SELECT body FROM '+ns+'identity_lookups WHERE product_key=$1 ORDER BY observed_at DESC',[key])).rows.map(r=>r.body);
      const suggestions=offers.flatMap(o=>identifierCandidates({upc:o.upc,sourceData:o.sourceData},'Saved retailer API').map(s=>({...s,observedAt:o.observedAt,cached:o.sourceCached===true})));
      suggestions.push(...lookups.filter(l=>l.sourceSignature===profile.sourceSignature).flatMap(l=>identifierCandidates(l.product,'Retailer detail lookup').map(s=>({...s,observedAt:l.observedAt,cached:l.cached}))));
      const upcLookup=(await db.query('SELECT body FROM '+ns+'upc_lookup_reports WHERE product_key=$1 ORDER BY observed_at DESC LIMIT 1',[key])).rows[0]?.body??null;
      const candidates=(await db.query('SELECT body FROM '+ns+'amazon_candidates WHERE product_key=$1 ORDER BY asin',[key])).rows.map(r=>r.body);
      const history=(await db.query('SELECT revision,created_at,body FROM '+ns+'upc_history WHERE product_key=$1 ORDER BY revision DESC',[key])).rows;
      return {profile,fieldDefinitions,upc,suggestions:[...new Map(suggestions.map(s=>[json([s.source,s.path,s.raw]),s])).values()],
        upcHistory:history,lookups,upcLookup,candidates:candidates.map(c=>({...c,result:exactMatch(profile,upc,c)})),
        liveCatalogConnected:this.catalogConnected?.()??false,secondaryEngineConnected:false};
    });
  }
  async saveUpc(key,input){
    const actor=text(input.actor,'reviewer label',100,{required:true}),note=text(input.note,'UPC evidence note',2000,{required:true});
    if(!['unverified','verified','rejected'].includes(input.status)||!['club_package','inner_unit','unknown'].includes(input.scope)||!['package_barcode','manufacturer','retailer','gs1','other'].includes(input.sourceKind))
      throw new AppError('UPC_REVIEW_INVALID','Choose UPC status, package scope and evidence source.');
    const value=text(input.value,'UPC/GTIN',100),validation=validateGtin(value),url=input.sourceUrl?evidenceUrl(input.sourceUrl):null;
    if(input.sourceUrl&&!url)throw new AppError('EVIDENCE_URL_INVALID','Use an HTTPS evidence link without credentials or access tokens.');
    if(input.status==='verified'&&(!validation.valid||input.scope==='unknown'||input.checkedPackage!==true))
      throw new AppError('UPC_NOT_VERIFIABLE',validation.valid?'Confirm whether this barcode identifies the full club package or an inner unit, and check the evidence.':validation.reason);
    return this.db.transaction(async db=>{
      const profile=await lockedProfile(db,key);expectation(input,profile);
      const old=(await db.query('SELECT body FROM '+ns+'product_upcs WHERE product_key=$1',[key])).rows[0]?.body;
      if((old?.revision??0)!==input.revision)throw new AppError('UPC_REVIEW_OUTDATED','The UPC record changed. Reload before saving.',{status:409});
      const record={value,validation,scope:input.scope,status:input.status,sourceKind:input.sourceKind,sourceUrl:url,note,actor,
        revision:(old?.revision??0)+1,sourceSignature:profile.sourceSignature,verifiedAt:input.status==='verified'?new Date().toISOString():null,updatedAt:new Date().toISOString(),localActorLabel:true};
      await db.query('INSERT INTO '+ns+'product_upcs VALUES($1,$2,$3::jsonb) ON CONFLICT(product_key) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body',[key,record.revision,json(record)]);
      await db.query('INSERT INTO '+ns+'upc_history VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),key,record.revision,record.updatedAt,json(record)]);
      return {upc:record};
    });
  }
  parseCandidate(input){
    const title=text(input.title,'Amazon title',1000,{required:true}),brand=text(input.brand,'Amazon brand',200);
    const result=extractDetails([{title,brand,sourceData:{item:{}}}]);
    return {fields:result.fields,issues:result.issues,fieldDefinitions};
  }
  async saveCandidate(key,input){
    const asin=text(input.asin,'ASIN',10,{required:true}).toUpperCase();
    if(!/^[A-Z0-9]{10}$/.test(asin))throw new AppError('ASIN_INVALID','Enter the 10-character child ASIN from the Amazon product page.');
    const title=text(input.title,'Amazon title',1000,{required:true}),brand=text(input.brand,'Amazon brand',200,{required:true});
    const actor=text(input.actor,'reviewer label',100,{required:true}),note=text(input.note,'candidate evidence note',2000,{required:true});
    const fields=validateFields(input.fields),upc=text(input.upc??'','Amazon UPC/GTIN',100);
    const sourceUrl=evidenceUrl(input.sourceUrl);
    if(!sourceUrl)throw new AppError('EVIDENCE_URL_INVALID','Add an HTTPS source link for the Amazon package facts.');
    if(typeof input.detailsReviewed!=='boolean'||typeof input.upcVerified!=='boolean'||!['amazon_package','inner_unit','unknown'].includes(input.upcScope)||!Number.isSafeInteger(input.revision))
      throw new AppError('CANDIDATE_REVIEW_INVALID','Choose the candidate review and barcode scope states.');
    if(input.upcVerified&&(!validateGtin(upc).valid||input.upcScope==='unknown'))throw new AppError('CANDIDATE_UPC_INVALID','A verified Amazon barcode needs a valid check digit and a known package scope.');
    return this.db.transaction(async db=>{
      const profile=await lockedProfile(db,key);expectation(input,profile);
      const old=(await db.query('SELECT body FROM '+ns+'amazon_candidates WHERE product_key=$1 AND asin=$2',[key,asin])).rows[0]?.body;
      if((old?.revision??0)!==input.revision)throw new AppError('CANDIDATE_OUTDATED','This ASIN record already exists or changed. Open the saved candidate before editing.',{status:409});
      const candidate={asin,title,brand,fields,upc,upcScope:input.upcScope,upcVerified:input.upcVerified,detailsReviewed:input.detailsReviewed,sourceUrl,
        note,actor,revision:(old?.revision??0)+1,observedAt:new Date().toISOString(),source:'manual_catalog_evidence',localActorLabel:true,
        clubRevisionAtSave:profile.revision,clubSignatureAtSave:profile.sourceSignature};
      const upcRecord=(await db.query('SELECT body FROM '+ns+'product_upcs WHERE product_key=$1',[key])).rows[0]?.body;
      const result=exactMatch(profile,upcRecord,candidate);
      await db.query('INSERT INTO '+ns+'amazon_candidates VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(product_key,asin) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body',[key,asin,candidate.revision,json(candidate)]);
      await db.query('INSERT INTO '+ns+'candidate_history VALUES($1,$2,$3,$4,$5,$6::jsonb)',[randomUUID(),key,asin,candidate.revision,candidate.observedAt,json({candidate,result})]);
      return {candidate,result};
    });
  }
  async candidateHistory(key,asin){return (await this.db.query('SELECT revision,created_at,body FROM '+ns+'candidate_history WHERE product_key=$1 AND asin=$2 ORDER BY revision DESC',[key,asin])).rows;}
  async retailerDetails(key){
    if(this.lookupActive)throw new AppError('LOOKUP_ACTIVE','Wait for the current retailer detail lookup.',{status:409});
    this.lookupActive=true;
    try{
      const context=await this.get(key);
      const offers=await this.store.offers();
      const source=offers.find(o=>o.productKey===key);
      if(source?.retailer!=='costco')throw new AppError('DETAIL_MODULE_UNAVAILABLE','Use Sam’s Club Research’s selected-club verification to collect product details. Automatic UPC lookup currently supports Costco only.');
      const id=source?.productId||source?.itemNumber;
      if(!id)throw new AppError('RETAILER_ID_MISSING','This product has no retailer item or product ID for the detail lookup.');
      const response=await this.provider.call('costco/product',{country:'us',item_ids:[id]});
      const products=response.json?.data?.products;
      if(!Array.isArray(products))throw new AppError('DETAIL_SCHEMA_CHANGED','The retailer detail response could not be read.',{status:502,stage:'response'});
      const match=products.filter(p=>p&&sameRetailerItem(p,source));
      if(match.length!==1)throw new AppError('DETAIL_IDENTITY_UNVERIFIED','The detail response could not be tied to exactly one saved club item. No UPC was accepted.',{status:502,stage:'response'});
      const record={product:match[0],observedAt:response.observedAt,cached:response.cached,source:'Scavio product details',sourceSignature:context.profile.sourceSignature};
      await this.db.transaction(async db=>{
        const current=await lockedProfile(db,key);
        if(current.sourceSignature!==context.profile.sourceSignature)throw new AppError('MATCH_SOURCE_CHANGED','The club evidence changed during lookup. Retry after reviewing the product.',{status:409});
        await db.query('INSERT INTO '+ns+'identity_lookups VALUES($1,$2,$3,$4::jsonb)',[randomUUID(),key,response.observedAt,json(record)]);
      });
      return {found:identifierCandidates(match[0]).length,cached:response.cached,observedAt:response.observedAt};
    }finally{this.lookupActive=false;}
  }
}
