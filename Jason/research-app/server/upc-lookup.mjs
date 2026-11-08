import {createHash,randomUUID} from 'node:crypto';
import {AppError,eventFor} from './errors.mjs';
import {identifierCandidates} from './identifiers.mjs';
import {queryFor,makeEvidence,labelledBarcodes,searchResults,publicEvidenceUrl,summarizeEvidence,sameRetailerItem} from './upc-evidence.mjs';

const ns='jason_research.',setting='upc_lookup_job',json=JSON.stringify;
const blocked=new Set(['AUTHENTICATION_FAILED','CREDITS_REQUIRED','ACCESS_DENIED','KEY_NOT_SAVED','KEY_STORAGE_FAILED','DPAPI_UNAVAILABLE','RATE_LIMITED','PROVIDER_TIMEOUT','NETWORK_ERROR']);
const currentVerified=(upc,p)=>upc?.status==='verified'&&upc.scope==='club_package'&&upc.sourceSignature===p.sourceSignature;
const unique=xs=>[...new Map(xs.map(x=>[x.id,x])).values()];

// One explicit, resumable batch. No paid work starts on application startup or Research ingestion.
export class UpcLookupService{
  constructor(store,matching,provider,enrichment){Object.assign(this,{store,matching,provider,enrichment});this.db=store.db;this.running=null;this.starting=false;this.closed=false;}
  get busy(){return !!this.running||this.starting;}
  async initialize(){
    const job=await this.store.get(setting);
    if(job&&['running','queued'].includes(job.status)){job.status='interrupted';job.stopRequested=false;await this.store.set(setting,job);}
  }
  publicJob(job){
    if(!job)return null;
    const {products,tasks,...summary}=job,task=tasks[job.cursor];
    return {...summary,productCount:products.length,currentTitle:products.find(p=>p.productKey===(task?.key??task?.keys?.[0]))?.title??null};
  }
  async state(){return {job:this.publicJob(await this.store.get(setting)),running:this.busy};}
  async plan(input={}){
    if(typeof input!=='object'||input===null||input.force!==undefined&&typeof input.force!=='boolean'||input.productKey!==undefined&&(typeof input.productKey!=='string'||input.productKey.length>1000))throw new AppError('UPC_SCOPE_INVALID','Choose one saved product or all saved products.');
    if(this.enrichment.work)await this.enrichment.work;
    const rows=(await this.db.query('SELECT e.body FROM '+ns+'enrichment_profiles e JOIN '+ns+'products p ON p.id=e.product_key WHERE p.retailer=$1 ORDER BY e.product_key',['costco'])).rows.map(r=>r.body);
    const selected=input.productKey?rows.filter(p=>p.productKey===input.productKey):rows;
    if(input.productKey&&!selected.length)throw new AppError('PRODUCT_NOT_FOUND','Choose a saved Costco product.',{status:404});
    const records=new Map((await this.db.query('SELECT product_key,body FROM '+ns+'product_upcs')).rows.map(r=>[r.product_key,r.body]));
    const reports=(await this.db.query('SELECT DISTINCT ON(product_key) product_key,body FROM '+ns+'upc_lookup_reports ORDER BY product_key,observed_at DESC')).rows;
    const recent=new Map(reports.map(r=>[r.product_key,r.body]));
    let verifiedSkipped=0,recentSkipped=0;
    const products=selected.filter(p=>{
      if(currentVerified(records.get(p.productKey),p)){verifiedSkipped++;return false;}
      const r=recent.get(p.productKey);
      if(!input.force&&r?.completedAt&&!r.errors.length&&r.sourceSignature===p.sourceSignature&&Date.now()-Date.parse(r.completedAt)<86400000){recentSkipped++;return false;}
      return true;
    }).map(p=>({productKey:p.productKey,sourceSignature:p.sourceSignature,title:p.title}));
    const context=[];
    // Saved explicit fields can avoid both the detail request and the web fallback.
    for(const p of products){const c=await this.matching.get(p.productKey);context.push({key:p.productKey,hasIdentifier:c.suggestions.some(s=>s.valid)});}
    const needsDetails=context.filter(c=>!c.hasIdentifier).map(c=>c.key),detailBatches=Math.ceil(needsDetails.length/20),webFallbacks=needsDetails.length;
    const scope={...(input.productKey?{productKey:input.productKey}:{}),force:input.force===true};
    const fingerprint=createHash('sha256').update(json([scope,products,context])).digest('hex');
    return {scope,fingerprint,products,needsDetails,selected:selected.length,eligible:products.length,verifiedSkipped,recentSkipped,detailBatches,
      maxSearches:webFallbacks,maxPageReads:webFallbacks*2,maxCredits:detailBatches+webFallbacks*3,
      explanation:'Saved API fields first. Up to 20 Costco details per request, then one web-search page and up to two product-page reads per unresolved item. Each request costs 1 Scavio credit if uncached. No automatic paid retry or higher extraction tier. All eligible products are included.'};
  }
  async start(input){
    if(input.replaceStopped!==undefined&&typeof input.replaceStopped!=='boolean')throw new AppError('UPC_SCOPE_INVALID','Choose whether to replace the stopped batch.');
    if(this.busy)throw new AppError('UPC_LOOKUP_ACTIVE','A UPC lookup is already running.',{status:409});
    this.starting=true;
    try{
      const old=await this.store.get(setting);
      if(old&&['paused','interrupted','attention'].includes(old.status)&&!input.replaceStopped)throw new AppError('UPC_JOB_PENDING','Resume the saved UPC batch or explicitly replace it.',{status:409});
      const plan=await this.plan(input.scope??{});
      if(input.fingerprint!==plan.fingerprint)throw new AppError('UPC_PLAN_CHANGED','Saved products changed. Review the updated lookup estimate before starting.',{status:409});
      if(!plan.eligible)throw new AppError('UPC_NOTHING_PENDING','No products need a new UPC lookup.');
      if(!this.provider.configured())throw new AppError('KEY_NOT_SAVED','Connect Scavio in Settings first.');
      const tasks=[];
      for(let i=0;i<plan.needsDetails.length;i+=20)tasks.push({type:'details',keys:plan.needsDetails.slice(i,i+20)});
      for(const p of plan.products)tasks.push({type:'web',key:p.productKey,phase:'search',page:0});
      this.job={id:randomUUID(),createdAt:new Date().toISOString(),status:'running',cursor:0,tasks,products:plan.products,maxCredits:plan.maxCredits,
        calls:0,uncachedResponses:0,cachedResponses:0,stopRequested:false,completedProducts:0,lastError:null};
      await this.store.set(setting,this.job);this.launch();return {job:this.publicJob(this.job)};
    }finally{this.starting=false;}
  }
  launch(){this.running=this.work().finally(()=>{this.running=null;});}
  async stop(){if(this.job&&this.running){this.job.stopRequested=true;await this.store.set(setting,this.job);}return this.state();}
  async resume(){
    if(this.busy)throw new AppError('UPC_LOOKUP_ACTIVE','A UPC lookup is already running.',{status:409});
    this.starting=true;
    try{
      const job=await this.store.get(setting);
      if(!job||!['paused','interrupted','attention'].includes(job.status))throw new AppError('UPC_NOT_RESUMABLE','There is no stopped UPC batch to resume.');
      if(!this.provider.configured())throw new AppError('KEY_NOT_SAVED','Connect Scavio in Settings first.');
      this.job={...job,status:'running',stopRequested:false,lastError:null};await this.store.set(setting,this.job);this.launch();return {job:this.publicJob(this.job)};
    }finally{this.starting=false;}
  }
  async call(endpoint,body){
    const response=await this.provider.call(endpoint,body);
    this.job.calls++;this.job[response.cached?'cachedResponses':'uncachedResponses']++;
    return response;
  }
  async report(key,context){
    const previous=(await this.db.query('SELECT body FROM '+ns+'upc_lookup_reports WHERE job_id=$1 AND product_key=$2',[this.job.id,key])).rows[0]?.body;
    return previous??{jobId:this.job.id,productKey:key,sourceSignature:context.profile.sourceSignature,profile:context.profile,startedAt:new Date().toISOString(),
      evidence:unique(context.suggestions.map(c=>makeEvidence(context.profile,c,{source:c.source,observedAt:c.observedAt??new Date().toISOString(),cached:c.cached===true}))),
      search:null,pages:[],errors:[],completedAt:null};
  }
  async save(report){
    report.evidence=unique(report.evidence);report.summary=summarizeEvidence(report.evidence);report.updatedAt=new Date().toISOString();
    await this.db.transaction(async db=>{
      await db.query('INSERT INTO '+ns+'upc_lookup_reports VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(job_id,product_key) DO UPDATE SET observed_at=EXCLUDED.observed_at,body=EXCLUDED.body',[this.job.id,report.productKey,report.updatedAt,json(report)]);
      await db.query('INSERT INTO '+ns+'settings VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET body=EXCLUDED.body',[setting,json(this.job)]);
    });
  }
  async details(task){
    const offers=await this.store.offers(),requested=task.keys.map(key=>({key,source:offers.find(o=>o.productKey===key)})).filter(r=>r.source?.productId||r.source?.itemNumber);
    if(!requested.length){this.job.cursor++;await this.store.set(setting,this.job);return;}
    const response=await this.call('costco/product',{country:'us',item_ids:requested.map(r=>r.source.productId||r.source.itemNumber)});
    const products=response.json?.data?.products;
    if(!Array.isArray(products))throw new AppError('DETAIL_SCHEMA_CHANGED','The Costco detail response could not be read. The batch stopped without accepting identifiers.',{status:502,stage:'response'});
    // Store every requested item's evidence independently. Never assign by array position.
    for(const key of task.keys){
      const context=await this.matching.get(key),report=await this.report(key,context),request=requested.find(r=>r.key===key);
      if(context.profile.sourceSignature!==this.job.products.find(p=>p.productKey===key).sourceSignature){report.errors.push({code:'SOURCE_CHANGED',message:'Club evidence changed during lookup. Run a new lookup for the updated package.'});await this.save(report);continue;}
      if(!request){report.errors.push({code:'RETAILER_ID_MISSING',message:'No retailer product ID was available.'});await this.save(report);continue;}
      const matches=products.filter(p=>p&&sameRetailerItem(p,request.source));
      if(matches.length!==1)report.errors.push({code:'DETAIL_IDENTITY_UNVERIFIED',message:'Detail response did not identify exactly one requested item. Web lookup will continue with review required.'});
      else{
        const product=matches[0];
        report.detail={observedAt:response.observedAt,cached:response.cached,product};
        report.evidence.push(...identifierCandidates(product,'Costco product details').map(c=>makeEvidence(context.profile,c,{source:'Costco product details',title:product.title??context.profile.title,sourceUrl:publicEvidenceUrl(request.source.productUrl),observedAt:response.observedAt,cached:response.cached})));
      }
      await this.save(report);
    }
    this.job.cursor++;await this.store.set(setting,this.job);
  }
  async web(task){
    const context=await this.matching.get(task.key),expected=this.job.products.find(p=>p.productKey===task.key),report=await this.report(task.key,context);
    if(context.profile.sourceSignature!==expected.sourceSignature){
      report.errors.push({code:'SOURCE_CHANGED',message:'Club identity changed. Run a new lookup for the updated package.'});return this.finish(report);
    }
    if(currentVerified(context.upc,context.profile)){report.skipped='A reviewer already verified the current full package.';return this.finish(report);}
    if(task.phase==='search'){
      if(report.evidence.some(e=>e.valid)){report.skipped='Explicit API barcode found; no web requests needed.';return this.finish(report);}
      const query=queryFor(context.profile),response=await this.call('google/customsearch',{q:query,num:10,gl:'us',hl:'en'});
      let results;
      try{results=searchResults(response.json,context.profile);}catch{throw new AppError('UPC_SEARCH_SCHEMA_CHANGED','The search response could not be read. Resume after checking the provider connection.',{status:502,stage:'response'});}
      report.search={query,observedAt:response.observedAt,cached:response.cached,results,searchPagesRead:1,pageReadLimit:2};
      for(const item of results)report.evidence.push(...labelledBarcodes(item.snippet).map(c=>makeEvidence(context.profile,c,{source:'Web search snippet',sourceUrl:item.url,title:item.title,observedAt:response.observedAt,cached:response.cached,kind:'search_snippet'})));
      task.phase='pages';task.page=0;
      if(!results.length)return this.finish(report);
      await this.save(report);return;
    }
    const targets=report.search?.results.slice(0,2)??[];
    if(task.page>=targets.length)return this.finish(report);
    const target=targets[task.page];
    let response;
    try{response=await this.call('extract',{url:target.url,format:'markdown',mode:'normal'});}
    catch(e){
      if(blocked.has(e.code)||!(e instanceof AppError))throw e;
      report.pages.push({url:target.url,title:target.title,status:'unavailable',code:e.code});report.errors.push({code:e.code,message:'A public product page could not be read. No access bypass or higher extraction tier was attempted.'});
      task.page++;await this.save(report);return;
    }
    const data=response.json?.data;
    if(typeof data?.content!=='string'||data.content.length>2_000_000)throw new AppError('UPC_PAGE_SCHEMA_CHANGED','The product-page response could not be read.',{status:502,stage:'response'});
    // A redirected page cannot silently retain the old product's attribution.
    const actualUrl=publicEvidenceUrl(data.url);
    if(!actualUrl||actualUrl!==target.url){
      report.pages.push({url:target.url,status:'unverified_redirect'});report.errors.push({code:'UPC_PAGE_REDIRECT',message:'A product page changed address. Open it manually before using any barcode.'});
    }else{
      const heading=data.content.match(/^#\s+(.+)$/m)?.[1]?.slice(0,1000),title=heading??target.title;
      report.pages.push({url:actualUrl,title,observedAt:response.observedAt,cached:response.cached,status:'read',content:data.content});
      report.evidence.push(...labelledBarcodes(data.content).map(c=>makeEvidence(context.profile,c,{source:'Public product page',sourceUrl:actualUrl,title,observedAt:response.observedAt,cached:response.cached,kind:'page_text'})));
    }
    task.page++;await this.save(report);
  }
  async finish(report){report.completedAt=new Date().toISOString();this.job.completedProducts++;this.job.cursor++;await this.save(report);}
  async work(){
    let before;
    try{
      while(this.job.cursor<this.job.tasks.length&&!this.closed&&!this.job.stopRequested){
        before=structuredClone(this.job);
        const task=this.job.tasks[this.job.cursor];
        if(task.type==='details')await this.details(task);else await this.web(task);
      }
      this.job.status=this.job.cursor===this.job.tasks.length?'complete':'paused';this.job.stopRequested=false;this.job.updatedAt=new Date().toISOString();await this.store.set(setting,this.job);
    }catch(error){
      // Reload the last committed cursor, including partial page evidence, before pausing.
      this.job=await this.store.get(setting,before??this.job);
      this.job.status='attention';this.job.stopRequested=false;
      const event=eventFor(error,'upc_lookup');await this.store.event(event);
      this.job.lastError={code:event.code,eventId:event.id,message:error instanceof AppError?error.message:'UPC lookup stopped. Saved evidence is retained; no automatic paid retry was made.'};
      await this.store.set(setting,this.job);
    }
  }
  async close(){this.closed=true;if(this.job)this.job.stopRequested=true;await this.running;}
}
