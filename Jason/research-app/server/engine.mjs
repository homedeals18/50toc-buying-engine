import {randomUUID} from 'node:crypto';
import {AppError,eventFor,safeError} from './errors.mjs';
import {planScan,requestFor,readPage,aliases,selectedTypes,normalizeOffer} from './costco.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class ResearchEngine {
  constructor(store,provider,{retryDelay=1500}={}){Object.assign(this,{store,provider,retryDelay});this.running=null;this.starting=false;this.closing=false;}
  async initialize(){
    // An interrupted scan resumes only when explicitly requested, avoiding surprise credit use.
    for(const job of await this.store.jobs())if(['queued','running'].includes(job.status)){
      job.status='interrupted';
      for(const task of job.tasks)if(task.status==='running')task.status='pending';
      await this.store.saveJob(job);
    }
  }
  async create(input){
    if(this.starting||this.running)throw new AppError('SCAN_ACTIVE','A scan is already active.',{status:409});
    this.starting=true;
    try{
      if(await this.store.active())throw new AppError('SCAN_ACTIVE','A scan is already active.',{status:409});
      if(!this.provider.configured())throw new AppError('KEY_NOT_SAVED','Connect Scavio in Settings first.');
      const plan=planScan(input,await this.store.get('categories',[]));
      const job={id:randomUUID(),createdAt:new Date().toISOString(),status:'queued',...plan,calls:0,cacheHits:0,pages:0,received:0,matched:0,outsideScope:0,finishedAt:null};
      await this.store.saveJob(job);
      await this.store.set('preferences',{warehouses:plan.scope.warehouses,categoryIds:plan.scope.categories.map(c=>c.id),dealTypes:plan.scope.dealTypes});
      this.launch(job.id);return job;
    }finally{this.starting=false;}
  }
  launch(id){this.running=this.run(id).catch(async error=>{try{await this.store.event(eventFor(error,'scan_worker'));}catch{}}).finally(()=>{this.running=null;});}
  async stop(id){const job=await this.store.job(id);if(!job)throw new AppError('SCAN_NOT_FOUND','Scan not found.',{status:404});await this.store.cancel(id);return this.store.job(id);}
  async resume(id){
    if(this.starting||this.running)throw new AppError('SCAN_ACTIVE','Wait for the current scan to stop.',{status:409});
    this.starting=true;
    try{
      const job=await this.store.job(id);if(!job)throw new AppError('SCAN_NOT_FOUND','Scan not found.',{status:404});
      if(job.status==='complete')throw new AppError('SCAN_COMPLETE','This scan has already finished.');
      for(const task of job.tasks)if(task.status!=='complete'){task.status='pending';delete task.error;}
      job.status='queued';job.finishedAt=null;await this.store.cancel(id,false);await this.store.saveJob(job);this.launch(id);return job;
    }finally{this.starting=false;}
  }
  async run(id){
    let job=await this.store.job(id);
    try{
      job.status='running';await this.store.saveJob(job);
      for(const task of job.tasks){
        if(task.status==='complete')continue;
        if(await this.shouldStop(job))break;
        if(task.kind!=='department'&&job.tasks.some(t=>t.kind==='department'&&t.status!=='complete'&&(task.kind==='coupon'||t.warehouse===task.warehouse))){
          task.status='failed';task.error={code:'DEPARTMENT_INDEX_INCOMPLETE',error:'Complete the failed department pages before this feed can be scoped.'};await this.store.saveJob(job);continue;
        }
        task.status='running';delete task.error;await this.store.saveJob(job);
        try{
          while(task.status!=='complete'){
            if(await this.shouldStop(job)){task.status='pending';break;}
            let response;
            for(let attempt=0;attempt<3;attempt++){
              try{
                // Calls counts actual provider attempts, including errors/retries; cache hits count separately.
                response=await this.provider.call(task.endpoint,requestFor(task),job.scope.force);
                if(response.cached)job.cacheHits++;else job.calls++;
                break;
              }catch(e){
                job.calls++;await this.store.saveJob(job);
                if(!e.retryable||attempt===2||await this.shouldStop(job))throw e;
                await sleep(this.retryDelay*(2**attempt));
              }
            }
            const {items,data,finished,paginationError}=readPage(response.json,task);
            const checkpoint={page:task.page,lastPage:task.lastPage,received:job.received,matched:job.matched,pages:job.pages,outsideScope:job.outsideScope};
            const members=[],offers=[],rules=await this.store.get('rules',{});
            for(const item of items){
              if(task.kind==='department'){
                members.push({aliases:aliases(item),category:task.category,item,observedAt:response.observedAt});
                const types=selectedTypes(item,task.warehouse,job.scope.dealTypes);
                if(types.length)offers.push(normalizeOffer(item,{warehouse:task.warehouse,categories:[task.category],types,scanId:id,endpoint:task.endpoint,observedAt:response.observedAt,cached:response.cached,rules}));
              }else{
                let matched=false;
                for(const warehouse of task.kind==='coupon'?job.scope.warehouses:[task.warehouse]){
                  const match=await this.store.member(id,warehouse,aliases(item));
                  if(!match.length)continue;
                  matched=true;
                  offers.push(normalizeOffer(item,{warehouse,categories:match.map(m=>m.category),types:[task.kind==='coupon'?'coupon_book':task.type],scanId:id,endpoint:task.endpoint,observedAt:response.observedAt,cached:response.cached,base:match[0],book:task.kind==='coupon'?data:null,rules}));
                }
                if(!matched)job.outsideScope++;
              }
            }
            job.received+=items.length;job.matched+=offers.length;job.pages++;
            task.lastPage=task.page;
            if(finished)task.status='complete';else if(!paginationError)task.page++;
            // Evidence, offers, department membership and page cursor commit together.
            try{await this.store.commitPage(job,task,response,members,offers);}
            catch(error){
              task.page=checkpoint.page;task.lastPage=checkpoint.lastPage;task.status='running';
              for(const key of ['received','matched','pages','outsideScope'])job[key]=checkpoint[key];
              throw error;
            }
            if(paginationError)throw paginationError;
          }
        }catch(error){
          task.status='failed';task.error=safeError(error);
          if(!(error instanceof AppError)){const event=eventFor(error,task.endpoint);task.error.eventId=event.id;await this.store.event(event);}
          await this.store.saveJob(job);
          if(['AUTHENTICATION_FAILED','CREDITS_REQUIRED','ACCESS_DENIED','KEY_NOT_SAVED','KEY_STORAGE_FAILED','DPAPI_UNAVAILABLE','LOCAL_ERROR'].includes(task.error.code))break;
        }
        if(job.status==='stopped')break;
      }
      if(job.status!=='stopped')job.status=job.tasks.every(t=>t.status==='complete')?'complete':'partial';
      job.finishedAt=new Date().toISOString();await this.store.saveJob(job);
    }catch(error){
      job.status='partial';job.error=safeError(error);await this.store.saveJob(job);
    }
  }
  async shouldStop(job){
    if(this.closing||(await this.store.job(job.id)).cancelRequested){job.status='stopped';return true;}
    return false;
  }
  async close(){this.closing=true;await this.running;}
}
