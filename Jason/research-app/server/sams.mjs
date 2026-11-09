import {randomUUID} from 'node:crypto';
import {AppError,safeError} from './errors.mjs';
import {nonnegativeNumber as number} from './errors.mjs';

export const samsDealTypes=[{id:'instant_savings',label:'Instant Savings'},{id:'clearance',label:'Clearance'},{id:'department',label:'All items in selected departments'}];
const validId=x=>typeof x==='string'&&/^\d{1,20}$/.test(x);
const itemId=x=>String(x?.item_id??'');
const list=(x,label)=>{if(!Array.isArray(x)||x.some(v=>typeof v!=='string'))throw new AppError('SAMS_SELECTION_REQUIRED','Choose '+label+'.');return [...new Set(x)];};
export function samsCategory(input){
  let id=String(input.categoryId??'').trim();
  if(id.startsWith('https://')){let u;try{u=new URL(id);}catch{}if(!u||!['samsclub.com','www.samsclub.com'].includes(u.hostname)||!/^\/(?:browse|cp)\//.test(u.pathname))throw new AppError('SAMS_CATEGORY_INVALID','Paste a Sam’s Club department link.');id=u.pathname.split('/').filter(Boolean).at(-1);}
  const name=String(input.name??'').trim();
  if(!validId(id)||!name||name.length>150)throw new AppError('SAMS_CATEGORY_INVALID','Enter a department name and its Sam’s Club link or category number.');
  return {id,name};
}
export function samsPlan(input,categories=[]){
  const clubs=list(input.clubs,'at least one club'),ids=list(input.categoryIds,'departments'),types=list(input.dealTypes,'deal types');
  if(!clubs.length||clubs.some(x=>!validId(x)))throw new AppError('SAMS_CLUB_REQUIRED','Choose at least one club.');
  if(!types.length||types.some(x=>!samsDealTypes.some(t=>t.id===x)))throw new AppError('SAMS_DEAL_REQUIRED','Choose supported Sam’s Club deal types.');
  const selected=ids.map(id=>id==='all'?{id:'all',name:'All departments'}:categories.find(c=>c.id===id));
  if(!selected.length||selected.some(x=>!x)||ids.includes('all')&&ids.length!==1||ids.includes('all')&&types.includes('department'))throw new AppError('SAMS_DEPARTMENT_REQUIRED','Choose saved departments, or All departments for Instant Savings and Clearance.');
  const tasks=[];const task=(kind,endpoint,category=null)=>({id:randomUUID(),kind,endpoint,category,page:1,status:'pending'});
  if(!ids.includes('all'))for(const category of selected)tasks.push(task('category','samsclub/category',category));
  else if(types.includes('instant_savings'))tasks.push(task('savings','samsclub/savings'));
  if(types.includes('clearance'))tasks.push(task('clearance','samsclub/category',{id:'1150109',name:'Clearance'}));
  return {scope:{retailer:'samsclub',clubs,categories:selected,dealTypes:types,force:input.force===true},tasks,minimumCredits:tasks.length,
    explanation:'One credit per uncached page. Selected clubs do not multiply discovery pages. The feed chooses its own nearby club; selected-club price checks are a separate step. All returned pages and matching products are saved.'};
}
export function samsPage(payload,task){
  const data=payload?.data,items=data?.products;
  if(!Array.isArray(items)||items.some(x=>!x||!validId(itemId(x))))throw new AppError('SAMS_SCHEMA_CHANGED','Sam’s Club returned an unusable product list. Earlier pages remain saved.',{status:502});
  const pages=number(data.total_pages),page=number(data.page);
  const valid=Number.isSafeInteger(pages)&&pages>=0&&page===task.page&&task.page<=Math.max(1,pages)&&!(pages===0&&items.length)&&!(!items.length&&page<pages);
  return {data,items,finished:valid&&page>=pages,error:valid?null:new AppError('SAMS_PAGINATION_INCOMPLETE','Sam’s Club pagination could not be verified. Saved records are retained; this scan remains incomplete.',{status:502})};
}
const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function samsOffer(item,{job,task,response,data,types,categories,verified=false,targetClub=null}){
  if(!item||!validId(itemId(item)))throw new AppError('SAMS_SCHEMA_CHANGED','The product response did not include a valid item ID.',{status:502});
  const club=String(item.club?.club_id??data?.club?.club_id??''),id=itemId(item),key='samsclub|item:'+id;
  if(verified&&(id!==task.itemId||club!==targetClub))throw new AppError('SAMS_CLUB_MISMATCH','The product response did not identify the requested item and club. Its price was not saved.',{status:502});
  const cp=verified?item.club_price:null,final=number(cp?.price),was=number(cp?.was_price),discount=number(cp?.savings_amount);
  const conflict=final!==null&&was!==null&&(final>was+.01||discount!==null&&Math.abs(Math.round((was-discount)*100)/100-final)>.01);
  const usable=verified&&final!==null&&!conflict;
  const reasons=[];
  if(!usable)reasons.push(conflict?'Club price and savings conflict; confirmation is required.':'Selected-club purchase price has not been verified.');
  if(item.in_stock_at_club===false)reasons.push('Provider reports this item is not in stock at this club.');
  if(/\b(?:variety|assorted)\b/i.test(item.title??''))reasons.push('Mixed or variety pack needs sourcing review.');
  return {id:key+'|'+(club||'unverified'),productKey:key,retailer:'samsclub',warehouseId:club||'unverified',itemNumber:id,productId:String(item.product_id??''),title:String(item.title??'Unnamed Sam’s Club item'),brand:item.brand??null,upc:item.upc??null,
    packageSize:item.size??null,packCount:item.pack_count??null,description:item.short_description??null,warehousePrice:usable?(was??(discount>0?null:final)):null,warehousePriceObservedAt:usable?response.observedAt:null,
    warehouseCouponPrice:usable?final:null,warehousePurchasePrice:usable?final:null,warehouseDiscountAmount:usable?discount:null,warehousePriceVerified:usable,warehousePricingStatus:usable?'verified':conflict?'conflict':'unverified',
    warehouseCouponMessage:usable?'Confirmed club price; published savings already included':'Verify the selected club before analysis',onlinePrice:verified?number(item.price):null,discoveryClubPrice:verified?null:number(item.price),currency:'USD',priceContext:usable?'verified_club_price':'discovery_only',
    availability:verified?(item.in_stock_at_club===true?'in_stock':item.in_stock_at_club===false?'not_in_stock':'unknown'):null,availableQuantity:null,quantityNote:'Provider quantities may be capped; purchase limits are not stock counts.',
    imageUrl:safeUrl(item.image),productUrl:safeUrl(item.url),categories,dealTypes:types,firstSeen:response.observedAt,observedAt:response.observedAt,sourceCached:response.cached,
    selectedClubs:job.scope.clubs,discoveryClub:data?.club??item.club??null,coupon:item.instant_savings?{validTo:item.instant_savings.end_date??null,discount:item.instant_savings.amount??null,appliesTo:'Channel applicability requires review'}:null,
    disposition:reasons.length?'needs_information':'collected',reasons,analysisStatus:'not_connected',evidence:[{provider:'Scavio',endpoint:task.endpoint,scanId:job.id,observedAt:response.observedAt,cached:response.cached}],sourceData:{item},coverage:'Online-listed merchandise only. Discovery prices do not verify a selected club or physical shelf inventory.'};
}
export class SamsResearchEngine{
  constructor(store,provider){Object.assign(this,{store,provider});this.running=null;this.starting=false;this.closing=false;}
  async create(input){
    if(this.running||this.starting)throw new AppError('SCAN_ACTIVE','A Sam’s Club task is already running.',{status:409});this.starting=true;
    try{
      if(await this.store.active())throw new AppError('SCAN_ACTIVE','Finish or stop the current scan first.',{status:409});
      if(!this.provider.configured())throw new AppError('KEY_NOT_SAVED','Connect Scavio in Settings first.');
      const plan=samsPlan(input,await this.store.get('sams_categories',[]));
      const job={id:randomUUID(),createdAt:new Date().toISOString(),status:'queued',...plan,calls:0,cacheHits:0,pages:0,received:0,matched:0,outsideScope:0};
      await this.store.set('sams_preferences',{clubs:plan.scope.clubs,categoryIds:plan.scope.categories.map(c=>c.id),dealTypes:plan.scope.dealTypes});await this.store.saveJob(job);this.launch(job.id);return job;
    }finally{this.starting=false;}
  }
  async verificationPlan(input={}){
    const clubs=list(input.clubs,'clubs');if(!clubs.length||clubs.some(x=>!validId(x)))throw new AppError('SAMS_CLUB_REQUIRED','Choose valid clubs.');
    const offers=(await this.store.offers({scanId:input.scanId||null})).filter(o=>o.retailer==='samsclub');
    const items=[...new Map(offers.map(o=>[o.itemNumber,o])).values()];
    if(!items.length)throw new AppError('SAMS_SCOPE_EMPTY','Run a Sam’s Club discovery scan first.');
    return {items,clubs,requests:items.length*clubs.length};
  }
  async verify(input){
    if(this.running||this.starting)throw new AppError('SCAN_ACTIVE','Finish or stop the current scan first.',{status:409});
    this.starting=true;
    try{if(await this.store.active())throw new AppError('SCAN_ACTIVE','Finish or stop the current scan first.',{status:409});const plan=await this.verificationPlan(input);if(!this.provider.configured())throw new AppError('KEY_NOT_SAVED','Connect Scavio in Settings first.');
      const tasks=plan.items.flatMap(o=>plan.clubs.map(club=>({id:randomUUID(),kind:'verify',endpoint:'samsclub/product',club,itemId:o.itemNumber,categories:o.categories,types:o.dealTypes,status:'pending',page:1})));
      const job={id:randomUUID(),createdAt:new Date().toISOString(),status:'queued',scope:{retailer:'samsclub',clubs:plan.clubs,force:input.force===true,verification:true},tasks,calls:0,cacheHits:0,pages:0,received:0,matched:0,outsideScope:0};await this.store.saveJob(job);this.launch(job.id);return job;
    }finally{this.starting=false;}
  }
  launch(id){this.running=this.run(id).catch(()=>{}).finally(()=>{this.running=null;});}
  async stop(id){await this.store.cancel(id);return this.store.job(id);}
  async resume(id){
    if(this.running||this.starting)throw new AppError('SCAN_ACTIVE','Wait for the current scan to stop.',{status:409});
    this.starting=true;
    try{
      if(await this.store.active())throw new AppError('SCAN_ACTIVE','Wait for the current scan to stop.',{status:409});
      const job=await this.store.job(id);if(!job||job.scope?.retailer!=='samsclub')throw new AppError('SCAN_NOT_FOUND','Sam’s Club scan not found.',{status:404});if(job.status==='complete')throw new AppError('SCAN_COMPLETE','This scan has finished.');
      for(const t of job.tasks)if(t.status!=='complete'){t.status='pending';delete t.error;}
      job.status='queued';job.finishedAt=null;await this.store.cancel(id,false);await this.store.saveJob(job);this.launch(id);return job;
    }finally{this.starting=false;}
  }
  async run(id){
    const job=await this.store.job(id);
    try{job.status='running';await this.store.saveJob(job);
      for(const task of job.tasks){if(task.status==='complete')continue;
        if(this.closing||(await this.store.job(id)).cancelRequested){job.status='stopped';break;}
        try{
          if(task.kind==='clearance'&&job.tasks.some(t=>t.kind==='category'&&t.status!=='complete'))throw new AppError('SAMS_DEPARTMENT_INCOMPLETE','Complete department pages before scoping the clearance feed.');
          task.status='running';delete task.error;await this.store.saveJob(job);
          while(task.status!=='complete'){
            if(this.closing||(await this.store.job(id)).cancelRequested){job.status='stopped';task.status='pending';break;}
            const body=task.kind==='verify'?{item_id:task.itemId,club_id:task.club}:{page:task.page,...(task.category?{category_id:task.category.id}:{})};
            let response;try{response=await this.provider.call(task.endpoint,body,job.scope.force);response.cached?job.cacheHits++:job.calls++;}catch(e){job.calls++;throw e;}
            const parsed=task.kind==='verify'?{data:response.json?.data,items:[response.json?.data],finished:true}:samsPage(response.json,task);
            const offers=[],members=[];
            for(const item of parsed.items){
              let categories=task.categories??[task.category??{id:'all',name:'All departments'}],types=task.types??[];
              if(task.kind==='category'){
                members.push({aliases:['item:'+itemId(item)],category:task.category,item,observedAt:response.observedAt});
                if(job.scope.dealTypes.includes('department'))types.push('department');
                if(job.scope.dealTypes.includes('instant_savings')&&(item.instant_savings||number(item.savings_amount)>0))types.push('instant_savings');
              }else if(task.kind==='clearance'){
                if(!job.scope.categories.some(c=>c.id==='all')){const match=await this.store.member(id,'sams-index',['item:'+itemId(item)]);if(!match.length){job.outsideScope++;continue;}categories=match.map(m=>m.category);}types=['clearance'];
              }else if(task.kind==='savings')types=['instant_savings'];
              if(types.length)offers.push(samsOffer(item,{job,task,response,data:parsed.data,types,categories,verified:task.kind==='verify',targetClub:task.club}));
            }
            const checkpoint={...task},counts={received:job.received,matched:job.matched,pages:job.pages};
            job.received+=parsed.items.length;job.matched+=offers.length;job.pages++;task.lastPage=task.page;
            if(parsed.finished)task.status='complete';else if(!parsed.error)task.page++;
            try{await this.store.commitPage(job,{...task,warehouse:'sams-index'},response,members,offers);}catch(e){Object.assign(task,checkpoint);Object.assign(job,counts);throw e;}
            if(parsed.error)throw parsed.error;
          }
        }catch(e){task.status='failed';task.error=safeError(e);await this.store.saveJob(job);break;}
        if(job.status==='stopped')break;
      }
      if(job.status!=='stopped')job.status=job.tasks.every(t=>t.status==='complete')?'complete':'partial';
      job.finishedAt=new Date().toISOString();await this.store.saveJob(job);
    }catch(e){job.status='partial';job.error=safeError(e);await this.store.saveJob(job);}
  }
  async close(){this.closing=true;await this.running;}
}
