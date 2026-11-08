import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {KeyVault,ScavioProvider} from './provider.mjs';
import {ResearchEngine} from './engine.mjs';
import {AppError,safeError,eventFor} from './errors.mjs';
import {dealTypes,categoriesFrom,planScan,coverage} from './costco.mjs';
import {toCsv} from './export.mjs';
import {EnrichmentService} from './enrichment.mjs';
import {fieldDefinitions} from './enrichment-fields.mjs';
import {MatchingService} from './matching.mjs';
import {UpcLookupService} from './upc-lookup.mjs';
import {AccessService} from './access.mjs';
import {KeepaClient,DemoKeepaClient,CatalogService} from './catalog.mjs';
import {WorkflowService} from './workflow.mjs';
import {ReceiptService} from './receipts.mjs';

export async function createApp({db,dataDir,provider:injectedProvider,vault:injectedVault,keepa:injectedKeepa,retryDelay=1500,demo=false}){
  const store=new Store(db),vault=injectedVault??new KeyVault(dataDir),provider=injectedProvider??new ScavioProvider(store,vault);
  const engine=new ResearchEngine(store,provider,{retryDelay}),session=randomUUID();
  await engine.initialize();
  const enrichment=new EnrichmentService(store);
  enrichment.initialize();
  const matching=new MatchingService(store,enrichment,provider);
  const upcLookup=new UpcLookupService(store,matching,provider,enrichment);
  await upcLookup.initialize();
  const access=new AccessService(db),keepaVault=new KeyVault(dataDir,{name:'keepa',envName:'KEEPA_API_KEY'}),keepa=injectedKeepa??(demo?new DemoKeepaClient():new KeepaClient(store,keepaVault));
  const catalog=new CatalogService(store,matching,keepa,{demo}),workflow=new WorkflowService(store,matching,catalog),receipts=new ReceiptService(db);
  matching.catalogConnected=()=>!demo&&keepa.configured();
  let monitorTimer,monitoring=false;
  let base;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://gdx-assets.costco.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
  function send(res,body,status=200,type='application/json; charset=utf-8'){
    res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);
  }
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==new URL(base).host)throw new AppError('LOCAL_HOST_REQUIRED','Open the local application address.',{status:403});
      const url=new URL(req.url,base),p=url.pathname;
      const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8']};
      if(req.method==='GET'&&files[p]){
        const [name,type]=files[p];
        let data=await readFile(new URL('../dist/'+name,import.meta.url));
        if(p==='/')data=Buffer.from(data.toString().replace('__SESSION__',session));
        send(res,data,200,type);return;
      }
      if(!p.startsWith('/api/'))throw new AppError('NOT_FOUND','Not found.',{status:404});
      if(req.headers['x-50toc-session']!==session||req.headers.origin&&req.headers.origin!==base)throw new AppError('SESSION_REQUIRED','Reload the local application page.',{status:403});
      let body={};
      if(req.method==='POST'){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new AppError('JSON_REQUIRED','A JSON request is required.');
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>(p==='/api/receipts/upload'?12*1024*1024:65536))throw new AppError('REQUEST_TOO_LARGE','Request is too large.',{status:413});chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('INVALID_JSON','The request is not valid JSON.');}
        if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('JSON_REQUIRED','A JSON object is required.');
      }
      const user=await access.current(req);
      if(p==='/api/auth/state'&&req.method==='GET'){send(res,{user,accountsEnabled:!user?.local&&await access.enabled()});return;}
      if(p==='/api/auth/login'&&req.method==='POST'){const result=await access.login(body);res.setHeader('Set-Cookie',result.cookie);send(res,{user:result.user});return;}
      if(p==='/api/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',await access.logout(req));send(res,{ok:true});return;}
      access.require(user,'any');
      if(p==='/api/worker'&&req.method==='GET'){send(res,await workflow.workerState(user));return;}
      if(p==='/api/worker/reserve'&&req.method==='POST'){send(res,await workflow.reserve(body,user));return;}
      if(p==='/api/worker/purchase'&&req.method==='POST'){send(res,await workflow.purchase(body,user));return;}
      if(p==='/api/worker/submit'&&req.method==='POST'){send(res,await workflow.submit(body,user));return;}
      if(p==='/api/receipts/upload'&&req.method==='POST'){send(res,await receipts.upload(body,user));return;}
      if(p==='/api/receipts/file'&&req.method==='GET'){send(res,await receipts.read(url.searchParams.get('id'),user));return;}
      if(user.role==='worker'&&p==='/api/state'&&req.method==='GET'){send(res,{version:'Jason Buying Engine 0.5',demo,user});return;}
      access.require(user);
      if(p==='/api/accounts'&&req.method==='GET'){send(res,{users:await access.users(),local:user.local===true});return;}
      if(p==='/api/accounts'&&req.method==='POST'){
        const created=await access.add(body,user);if(user.local){const logged=await access.login(body);res.setHeader('Set-Cookie',logged.cookie);}send(res,{user:created});return;
      }
      if(p==='/api/keepa/key'&&req.method==='POST'){
        if(demo)throw new AppError('DEMO_MODE','Open the live version to connect Keepa.');if(catalog.busy)throw new AppError('CATALOG_ACTIVE','Wait for Amazon lookup before changing its key.',{status:409});
        await keepaVault.save(body.key,{sessionOnly:body.storage==='session'});send(res,{configured:true});return;
      }
      if(p==='/api/catalog/lookup'&&req.method==='POST'){send(res,await catalog.lookup(body.productKey,user));return;}
      if(p==='/api/catalog/product'&&req.method==='GET'){send(res,{lookup:await catalog.latest(url.searchParams.get('productKey'))});return;}
      if(p==='/api/workflow'&&req.method==='GET'){send(res,await workflow.state(user));return;}
      if(p==='/api/workflow/context'&&req.method==='GET'){send(res,await workflow.context(url.searchParams.get('productKey'),url.searchParams.get('asin')));return;}
      if(p==='/api/workflow/settings'&&req.method==='POST'){send(res,{settings:await workflow.saveSettings(body,user)});return;}
      if(p==='/api/workflow/analyze'&&req.method==='POST'){send(res,await workflow.analyze(body,user));return;}
      if(p==='/api/workflow/decision'&&req.method==='POST'){send(res,await workflow.decision(body,user));return;}
      if(p==='/api/workflow/block'&&req.method==='POST'){send(res,await workflow.block(body,user));return;}
      if(p==='/api/workflow/check'&&req.method==='POST'){send(res,await workflow.monitor(user));return;}
      if(p==='/api/workflow/correct'&&req.method==='POST'){send(res,await workflow.correct(body,user));return;}
      if(p==='/api/workflow/intake'&&req.method==='POST'){send(res,await workflow.intake(body,user));return;}
      if(p==='/api/workflow/visit'&&req.method==='POST'){send(res,await workflow.visit(body,user));return;}
      if(p==='/api/workflow/release-reservation'&&req.method==='POST'){send(res,await workflow.releaseReservation(body,user));return;}
      if(p==='/api/workflow/export'&&req.method==='GET'){
        const state=await workflow.state(user),type=url.searchParams.get('type');
        if(!['items','targets','purchases','payments','submissions','dealAlerts'].includes(type))throw new AppError('EXPORT_INVALID','Choose an export type.');
        send(res,{filename:'50TOC-'+type+'.csv',csv:toCsv(state[type])});return;
      }
      if(p==='/api/workflow/pay/calculate'&&req.method==='POST'){send(res,await workflow.calculatePay(body,user));return;}
      if(p==='/api/workflow/pay/paid'&&req.method==='POST'){send(res,await workflow.markPaid(body,user));return;}
      if(p==='/api/workflow/history'&&req.method==='GET'){send(res,{history:await workflow.history(url.searchParams.get('id'),user)});return;}
      if(p==='/api/receipts/reconcile'&&req.method==='POST'){send(res,await receipts.reconcile(body,user));return;}
      if(p==='/api/state'&&req.method==='GET'){
        send(res,{version:'Jason Buying Engine 0.5',demo,user,keepaConfigured:keepa.configured(),keepaStorageMode:demo?'demo':keepaVault.mode(),databaseMode:db.mode,configured:provider.configured(),keyStorageMode:demo?'demo':vault.mode(),enrichmentPreparing:enrichment.preparing,
          categories:await store.get('categories',[]),warehouses:await store.get('warehouses',[]),
          preferences:await store.get('preferences',{warehouses:[],categoryIds:[],dealTypes:['clearance','manager_markdown']}),
          rules:await store.get('rules',{flagVariety:true,flagPerishable:true}),jobs:await store.jobs(),dealTypes,coverage,priceLimit:null,analysisConnected:true});return;
      }
      if(p==='/api/key'&&req.method==='POST'){
        if(demo)throw new AppError('DEMO_MODE','Open the live version to connect Scavio.');
        if(engine.starting||engine.running||upcLookup.busy)throw new AppError('SCAN_ACTIVE','Stop the active Research or UPC lookup before changing connections.',{status:409});
        await vault.save(body.key,{sessionOnly:body.storage==='session'});send(res,{configured:true});return;
      }
      if(p==='/api/usage'&&req.method==='POST'){send(res,await provider.usage());return;}
      if(p==='/api/categories'&&req.method==='POST'){
        if(body.parentId&&!/^[0-9]{1,20}$/.test(body.parentId))throw new AppError('DEPARTMENT_INVALID','Choose a department with a provider category ID.');
        const result=await provider.call('costco/categories',{country:'us',...(body.parentId?{category_id:body.parentId}:{})},body.force===true);
        const rows=categoriesFrom(result.json),all=[...new Map([...(await store.get('categories',[])),...rows].map(c=>[c.id,c])).values()];
        await store.set('categories',all);send(res,{categories:all,cached:result.cached});return;
      }
      if(p==='/api/warehouses'&&req.method==='POST'){
        if(!/^\d{5}$/.test(String(body.zip)))throw new AppError('ZIP_INVALID','Enter a five-digit ZIP code.');
        const result=await provider.call('costco/warehouses',{country:'us',zip:String(body.zip),limit:50},body.force===true);
        if(!Array.isArray(result.json.data?.warehouses))throw new AppError('WAREHOUSE_SCHEMA_CHANGED','Scavio did not return a warehouse list.',{status:502,stage:'response'});
        const warehouses=result.json.data.warehouses.filter(w=>w&&/^\d{1,8}$/.test(String(w.warehouse_id)));
        const all=[...new Map([...(await store.get('warehouses',[])),...warehouses].map(w=>[String(w.warehouse_id),w])).values()];
        await store.set('warehouses',all);send(res,{warehouses:all,cached:result.cached});return;
      }
      if(p==='/api/plan'&&req.method==='POST'){const plan=planScan(body,await store.get('categories',[]));send(res,{...plan,taskCount:plan.tasks.length});return;}
      if(p==='/api/scans'&&req.method==='POST'){
        if(upcLookup.busy||matching.lookupActive)throw new AppError('UPC_LOOKUP_ACTIVE','Stop UPC lookup before starting Research.',{status:409});
        send(res,{job:await engine.create(body)},202);return;
      }
      const action=p.match(/^\/api\/scans\/([a-zA-Z0-9-]+)\/(stop|resume)$/);
      if(action&&req.method==='POST'){
        if(action[2]==='resume'&&(upcLookup.busy||matching.lookupActive))throw new AppError('UPC_LOOKUP_ACTIVE','Stop UPC lookup before resuming Research.',{status:409});
        send(res,{job:await (action[2]==='stop'?engine.stop(action[1]):engine.resume(action[1]))});return;
      }
      if(p==='/api/rules'&&req.method==='POST'){await store.set('rules',{flagVariety:body.flagVariety!==false,flagPerishable:body.flagPerishable!==false});send(res,{ok:true});return;}
      if(p==='/api/offers'&&req.method==='GET'){
        const all=await store.offers({scanId:url.searchParams.get('scanId'),search:url.searchParams.get('q')??'',decision:url.searchParams.get('decision')??'all'});
        const page=Math.max(1,Number.parseInt(url.searchParams.get('page'))||1);
        send(res,{total:all.length,page,offers:all.slice((page-1)*50,page*50)});return;
      }
      if(p==='/api/offer'&&req.method==='GET'){
        const offer=await store.offer(url.searchParams.get('id'),url.searchParams.get('scanId'));
        if(!offer)throw new AppError('OFFER_NOT_FOUND','Saved product not found.',{status:404});send(res,{offer});return;
      }
      if(p==='/api/export'&&req.method==='GET'){
        const scanId=url.searchParams.get('scanId'),records=await store.offers({scanId});
        if(url.searchParams.get('format')==='csv')send(res,toCsv(records),200,'text/csv; charset=utf-8');
        else send(res,{schema:'50toc.research.handoff.v2',exportedAt:new Date().toISOString(),demo,records,scans:await store.jobs(),
          sourcePages:scanId?await store.sourcePages(scanId):[],priceLimit:null,analysisConnected:true});
        return;
      }
      if(p==='/api/diagnostics'&&req.method==='GET'){send(res,{events:await store.events()});return;}
      if(p==='/api/enrichment'&&req.method==='GET'){
        send(res,{...(await enrichment.list({search:url.searchParams.get('q')??'',status:url.searchParams.get('status')??'all',page:Math.max(1,Number.parseInt(url.searchParams.get('page'))||1)})),fieldDefinitions});return;
      }
      if(p==='/api/enrichment/product'&&req.method==='GET'){
        send(res,{...(await enrichment.get(url.searchParams.get('productKey'))),fieldDefinitions});return;
      }
      if(p==='/api/enrichment/review'&&req.method==='POST'){
        if(typeof body.productKey!=='string')throw new AppError('PRODUCT_REQUIRED','Choose a saved club product.');
        send(res,await enrichment.save(body.productKey,{...body,actor:user.username}));return;
      }
      if(p==='/api/enrichment/export'&&req.method==='GET'){
        const rows=(await db.query('SELECT body FROM jason_research.enrichment_profiles ORDER BY product_key')).rows.map(r=>r.body);
        if(url.searchParams.get('format')==='csv')send(res,toCsv(rows),200,'text/csv; charset=utf-8');
        else send(res,{schema:'50toc.enrichment.v1',exportedAt:new Date().toISOString(),photoAnalysis:'not_connected',products:rows});
        return;
      }
      if(p==='/api/matching'&&req.method==='GET'){send(res,await matching.list());return;}
      if(p==='/api/matching/product'&&req.method==='GET'){send(res,await matching.get(url.searchParams.get('productKey')));return;}
      if(p==='/api/matching/upc'&&req.method==='POST'){send(res,await matching.saveUpc(body.productKey,{...body,actor:user.username}));return;}
      if(p==='/api/matching/candidate-title'&&req.method==='POST'){send(res,matching.parseCandidate(body));return;}
      if(p==='/api/matching/candidate'&&req.method==='POST'){send(res,await matching.saveCandidate(body.productKey,{...body,actor:user.username}));return;}
      if(p==='/api/matching/history'&&req.method==='GET'){send(res,{history:await matching.candidateHistory(url.searchParams.get('productKey'),url.searchParams.get('asin'))});return;}
      if(p==='/api/matching/retailer-details'&&req.method==='POST'){
        if(engine.starting||engine.running||upcLookup.busy)throw new AppError('SCAN_ACTIVE','Wait for Research or automatic UPC lookup to finish before a separate detail lookup.',{status:409});
        send(res,await matching.retailerDetails(body.productKey));return;
      }
      if(p==='/api/upc-lookup'&&req.method==='GET'){send(res,await upcLookup.state());return;}
      if(p==='/api/upc-lookup/plan'&&req.method==='POST'){send(res,await upcLookup.plan(body));return;}
      if(p==='/api/upc-lookup/start'&&req.method==='POST'){
        if(engine.starting||engine.running||matching.lookupActive)throw new AppError('SCAN_ACTIVE','Finish the active Research or manual detail request before UPC lookup.',{status:409});
        send(res,await upcLookup.start(body),202);return;
      }
      if(p==='/api/upc-lookup/stop'&&req.method==='POST'){send(res,await upcLookup.stop());return;}
      if(p==='/api/upc-lookup/resume'&&req.method==='POST'){
        if(engine.starting||engine.running||matching.lookupActive)throw new AppError('SCAN_ACTIVE','Finish Research or the manual detail request before resuming UPC lookup.',{status:409});
        send(res,await upcLookup.resume(),202);return;
      }
      if(p==='/api/matching/export'&&req.method==='GET'){
        const products=(await matching.list()).products,records=[];
        for(const product of products)records.push(await matching.get(product.productKey));
        const upcLookupReports=(await db.query('SELECT body FROM jason_research.upc_lookup_reports ORDER BY observed_at')).rows.map(r=>r.body);
        send(res,{schema:'50toc.exact-matches.v2',exportedAt:new Date().toISOString(),records,upcLookupReports,liveCatalogConnected:!demo&&keepa.configured(),secondaryEngineConnected:false});return;
      }
      throw new AppError('NOT_FOUND','Not found.',{status:404});
    }catch(error){
      const e=error instanceof AppError?error:new AppError('LOCAL_ERROR','The operation failed. Saved research is retained.',{status:500,stage:'local'});
      if(!e.eventId){
        const event=eventFor(e,'local_request');e.eventId=event.id;try{await store.event(event);}catch{}
      }
      send(res,safeError(e),e.status);
    }
  });
  return {server,store,engine,provider,session,enrichment,matching,upcLookup,access,catalog,workflow,receipts,
    async listen(port=8876){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
      monitorTimer=setInterval(async()=>{if(monitoring)return;monitoring=true;try{await workflow.monitor({id:'local-monitor',username:'Local daily monitor',role:'manager'});}catch(error){try{await store.event(eventFor(error,'daily_queue_check'));}catch{}}finally{monitoring=false;}},60000);monitorTimer.unref();return base;},
    async close(){clearInterval(monitorTimer);while(monitoring)await new Promise(r=>setTimeout(r,10));await upcLookup.close();await engine.close();await enrichment.close();await new Promise(resolve=>server.close(resolve));await db.close();}
  };
}
