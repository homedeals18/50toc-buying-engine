import {randomUUID} from 'node:crypto';
import {AppError} from './errors.mjs';
import {extractDetails,sourceSignature,identitySources,fieldDefinitions,reviewIssues,extractionVersion} from './enrichment-fields.mjs';

const ns='jason_research.', json=JSON.stringify;
const known=value=>value!==null&&value!==undefined&&value!=='';
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);

async function record(db,profile,action,actor){
  profile.updatedAt=new Date().toISOString();
  await db.query('INSERT INTO '+ns+'enrichment_profiles VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(product_key) DO UPDATE SET revision=EXCLUDED.revision,source_signature=EXCLUDED.source_signature,updated_at=EXCLUDED.updated_at,body=EXCLUDED.body',
    [profile.productKey,profile.revision,profile.sourceSignature,profile.updatedAt,json(profile)]);
  await db.query('INSERT INTO '+ns+'enrichment_history VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [randomUUID(),profile.productKey,profile.revision,profile.updatedAt,action,json({actor,identity:profile,localActorLabel:true})]);
}

// Caller owns the product row lock. This operation does not call external services.
export async function syncProductProfile(db,productKey){
  const offers=(await db.query('SELECT body FROM '+ns+'offers WHERE product_id=$1 ORDER BY id',[productKey])).rows.map(r=>r.body);
  if(!offers.length)return null;
  const signature=sourceSignature(offers);
  const previous=(await db.query('SELECT body FROM '+ns+'enrichment_profiles WHERE product_key=$1 FOR UPDATE',[productKey])).rows[0]?.body;
  if(previous?.sourceSignature===signature&&previous.extractionVersion===extractionVersion){
    const warehouses=[...new Set(offers.map(o=>o.warehouseId))];
    if(JSON.stringify(warehouses)!==JSON.stringify(previous.warehouses)){
      previous.warehouses=warehouses;
      await db.query('UPDATE '+ns+'enrichment_profiles SET body=$2::jsonb WHERE product_key=$1',[productKey,json(previous)]);
    }
    return previous;
  }
  const extraction=extractDetails(offers),fields=extraction.fields;
  const hasHuman=Boolean(previous?.lastReviewedAt||previous?.lastSavedBy);
  if(previous){
    for(const definition of fieldDefinitions){
      const old=previous.fields[definition.id];
      if(old&&(old.origin==='reviewer'||['confirmed','not_applicable','needs_recheck'].includes(old.reviewState))){
        fields[definition.id]={...old,reviewState:old.reviewState==='unreviewed'?'unreviewed':'needs_recheck'};
      }
    }
  }
  const latest=[...offers].sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0];
  const profile={productKey,revision:(previous?.revision??0)+1,sourceSignature:signature,extractionVersion,
    title:latest.title,brand:latest.brand,upc:latest.upc,itemNumber:latest.itemNumber,
    warehouses:[...new Set(offers.map(o=>o.warehouseId))],
    sourceSnapshot:identitySources(offers),fields,candidates:extraction.candidates,conflicts:extraction.conflicts,
    extractionIssues:extraction.issues,reviewIssues:reviewIssues(fields),
    photoAnalysis:'not_connected',sourceChanged:hasHuman,status:hasHuman?'source_changed':'not_reviewed',
    note:previous?.note??'',lastSavedBy:previous?.lastSavedBy??null,lastReviewedAt:previous?.lastReviewedAt??null,
    previousReviewedSignature:previous?.previousReviewedSignature??null};
  await record(db,profile,previous?'source_changed':'extracted','Automatic title extraction');
  return profile;
}

export function validateFields(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fieldDefinitions.some(f=>f.id===k)))
    throw new AppError('ENRICHMENT_FIELDS_INVALID','The review fields are not valid.');
  const fields={};
  for(const definition of fieldDefinitions){
    const field=input[definition.id];
    if(!field||typeof field!=='object'||!['unreviewed','confirmed','not_applicable','needs_recheck'].includes(field.reviewState))
      throw new AppError('ENRICHMENT_FIELDS_INVALID','Choose a review state for '+definition.label+'.');
    let value=field.value;
    if(value===null||value===undefined||value==='')value=null;
    else if(['number','count'].includes(definition.type)){
      if(!['string','number'].includes(typeof value))throw new AppError('ENRICHMENT_VALUE_INVALID','Enter a number for '+definition.label+'.');
      if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))throw new AppError('ENRICHMENT_VALUE_INVALID','Enter a positive number for '+definition.label+'.');
      value=Number(value);
      if(typeof field.value==='boolean'||!Number.isFinite(value)||value<=0||value>1e9||definition.type==='count'&&!Number.isSafeInteger(value))
        throw new AppError('ENRICHMENT_VALUE_INVALID','Enter a positive '+(definition.type==='count'?'whole number':'number')+' for '+definition.label+'.');
    }else{
      if(typeof value!=='string'||value.length>500||/[\u0000-\u001f]/.test(value))throw new AppError('ENRICHMENT_VALUE_INVALID','Enter valid text for '+definition.label+'.');
      value=value.trim()||null;
      if(value&&definition.type==='choice'&&!definition.options.includes(value))throw new AppError('ENRICHMENT_VALUE_INVALID','Choose a supported value for '+definition.label+'.');
    }
    if(field.reviewState==='confirmed'&&!known(value))throw new AppError('CONFIRMED_VALUE_MISSING',definition.label+' is empty. Keep it unknown or mark it not applicable.');
    if(field.reviewState==='not_applicable'&&known(value))throw new AppError('NOT_APPLICABLE_HAS_VALUE','Clear '+definition.label+' before marking it not applicable.');
    fields[definition.id]={value,reviewState:field.reviewState};
  }
  return fields;
}

export class EnrichmentService{
  constructor(store){this.store=store;this.db=store.db;this.preparing=false;this.closed=false;this.progress={prepared:0,total:0};}
  initialize(){
    this.preparing=true;
    this.work=this.prepareExisting().catch(async()=>{this.progress.error='Some saved products could not be prepared. Restart the local service to retry.';}).finally(()=>{this.preparing=false;});
  }
  async prepareExisting(){
    const products=(await this.db.query('SELECT id FROM '+ns+'products ORDER BY id')).rows;
    this.progress={prepared:0,total:products.length};
    for(const {id}of products){
      if(this.closed)break;
      await this.db.transaction(async db=>{
        await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[id]);
        await syncProductProfile(db,id);
      });
      this.progress.prepared++;
    }
  }
  async get(productKey){
    return this.db.transaction(async db=>{
      const exists=(await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[productKey])).rows.length;
      if(!exists)throw new AppError('PRODUCT_NOT_FOUND','Saved club product not found.',{status:404});
      const profile=await syncProductProfile(db,productKey);
      if(!profile)throw new AppError('PRODUCT_NOT_FOUND','Saved club product has no current offer.',{status:404});
      const history=(await db.query('SELECT revision,created_at,action,body FROM '+ns+'enrichment_history WHERE product_key=$1 ORDER BY revision DESC',[productKey])).rows;
      return {profile,history};
    });
  }
  async list({search='',status='all',page=1}={}){
    const rows=(await this.db.query('SELECT body FROM '+ns+'enrichment_profiles ORDER BY updated_at DESC,product_key')).rows.map(r=>r.body);
    const counts={all:rows.length,not_reviewed:0,draft:0,reviewed:0,reviewed_with_gaps:0,source_changed:0};
    for(const r of rows)counts[r.status]=(counts[r.status]??0)+1;
    const q=search.trim().toLocaleLowerCase();
    const matched=rows.filter(r=>(status==='all'||r.status===status)&&(!q||[r.title,r.brand,r.upc,r.itemNumber,r.fields.productName.value,r.fields.flavor.value,r.fields.scent.value].join(' ').toLocaleLowerCase().includes(q)));
    return {total:matched.length,page,counts,preparing:this.preparing,progress:this.progress,photoAnalysis:'not_connected',
      products:matched.slice((page-1)*50,page*50).map(({productKey,revision,title,brand,itemNumber,warehouses,status,sourceChanged,fields,reviewIssues,updatedAt,lastSavedBy})=>({productKey,revision,title,brand,itemNumber,warehouses,status,sourceChanged,values:Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,f.value])),reviewIssues,updatedAt,lastSavedBy}))};
  }
  async save(productKey,input){
    if(!['save_draft','confirm'].includes(input.action)||!Number.isSafeInteger(input.revision)||typeof input.sourceSignature!=='string')
      throw new AppError('ENRICHMENT_REVIEW_INVALID','Reload this review before saving.');
    if(typeof input.actor!=='string'||!input.actor.trim()||input.actor.length>100||/[\u0000-\u001f]/.test(input.actor))
      throw new AppError('REVIEWER_REQUIRED','Enter a reviewer label for the local history.');
    if(typeof input.note!=='string'||input.note.length>2000)throw new AppError('REVIEW_NOTE_INVALID','Keep the review note under 2,000 characters.');
    const values=validateFields(input.fields);
    return this.db.transaction(async db=>{
      await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[productKey]);
      const profile=await syncProductProfile(db,productKey);
      if(!profile)throw new AppError('PRODUCT_NOT_FOUND','Saved club product not found.',{status:404});
      if(profile.revision!==input.revision||profile.sourceSignature!==input.sourceSignature)
        throw new AppError('REVIEW_OUTDATED','This product or review changed while you were editing. Reload the latest review; your unsaved edits have not been applied.',{status:409});
      if(input.action==='confirm'&&Object.values(values).some(f=>f.reviewState==='needs_recheck'))
        throw new AppError('RECHECK_REQUIRED','Resolve each Recheck needed field before confirming. You may leave unresolved fields as Not reviewed.');
      const overrides=Object.entries(values).filter(([id,field])=>field.reviewState==='confirmed'&&profile.candidates[id]?.length&&!profile.candidates[id].some(c=>same(c.value,field.value)));
      if(input.action==='confirm'&&(overrides.length||profile.conflicts.length)&&!input.note.trim())
        throw new AppError('REVIEW_REASON_REQUIRED','Add a brief note explaining the correction or how conflicting evidence was resolved.');
      const fields={};
      for(const definition of fieldDefinitions){
        const id=definition.id,old=profile.fields[id],next=values[id];
        const manual=!same(next.value,old.value)||old.origin==='reviewer';
        fields[id]={...old,...next,origin:manual?'reviewer':old.origin,
          ...(manual?{evidence:[...old.evidence.filter(e=>e.source!=='reviewer'),{source:'reviewer',actor:input.actor.trim(),note:input.note.trim()}]}:{})};
      }
      const issues=reviewIssues(fields);
      const confirmed=input.action==='confirm';
      const next={...profile,fields,revision:profile.revision+1,note:input.note.trim(),lastSavedBy:input.actor.trim(),
        status:confirmed?(issues.length?'reviewed_with_gaps':'reviewed'):(profile.sourceChanged?'source_changed':'draft'),
        reviewIssues:issues,sourceChanged:confirmed?false:profile.sourceChanged,
        lastReviewedAt:confirmed?new Date().toISOString():profile.lastReviewedAt,
        previousReviewedSignature:confirmed?profile.sourceSignature:profile.previousReviewedSignature};
      await record(db,next,input.action,input.actor.trim());
      const history=(await db.query('SELECT revision,created_at,action,body FROM '+ns+'enrichment_history WHERE product_key=$1 ORDER BY revision DESC',[productKey])).rows;
      return {profile:next,history};
    });
  }
  async close(){this.closed=true;await this.work;}
}
