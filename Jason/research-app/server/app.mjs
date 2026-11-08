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

export async function createApp({db,dataDir,provider:injectedProvider,vault:injectedVault,retryDelay=1500,demo=false}){
  const store=new Store(db),vault=injectedVault??new KeyVault(dataDir),provider=injectedProvider??new ScavioProvider(store,vault);
  const engine=new ResearchEngine(store,provider,{retryDelay}),session=randomUUID();
  await engine.initialize();
  const enrichment=new EnrichmentService(store);
  enrichment.initialize();
  const matching=new MatchingService(store,enrichment,provider);
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
        for await(const chunk of req){size+=chunk.length;if(size>65536)throw new AppError('REQUEST_TOO_LARGE','Request is too large.',{status:413});chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('INVALID_JSON','The request is not valid JSON.');}
        if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('JSON_REQUIRED','A JSON object is required.');
      }
      if(p==='/api/state'&&req.method==='GET'){
        send(res,{version:'Jason Research 0.3',demo,databaseMode:db.mode,configured:provider.configured(),keyStorageMode:demo?'demo':vault.mode(),enrichmentPreparing:enrichment.preparing,
          categories:await store.get('categories',[]),warehouses:await store.get('warehouses',[]),
          preferences:await store.get('preferences',{warehouses:[],categoryIds:[],dealTypes:['clearance','manager_markdown']}),
          rules:await store.get('rules',{flagVariety:true,flagPerishable:true}),jobs:await store.jobs(),dealTypes,coverage,priceLimit:null,analysisConnected:false});return;
      }
      if(p==='/api/key'&&req.method==='POST'){
        if(demo)throw new AppError('DEMO_MODE','Open the live version to connect Scavio.');
        if(engine.running)throw new AppError('SCAN_ACTIVE','Stop the scan before changing connections.',{status:409});
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
      if(p==='/api/scans'&&req.method==='POST'){send(res,{job:await engine.create(body)},202);return;}
      const action=p.match(/^\/api\/scans\/([a-zA-Z0-9-]+)\/(stop|resume)$/);
      if(action&&req.method==='POST'){send(res,{job:await (action[2]==='stop'?engine.stop(action[1]):engine.resume(action[1]))});return;}
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
          sourcePages:scanId?await store.sourcePages(scanId):[],priceLimit:null,analysisConnected:false});
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
        send(res,await enrichment.save(body.productKey,body));return;
      }
      if(p==='/api/enrichment/export'&&req.method==='GET'){
        const rows=(await db.query('SELECT body FROM jason_research.enrichment_profiles ORDER BY product_key')).rows.map(r=>r.body);
        if(url.searchParams.get('format')==='csv')send(res,toCsv(rows),200,'text/csv; charset=utf-8');
        else send(res,{schema:'50toc.enrichment.v1',exportedAt:new Date().toISOString(),photoAnalysis:'not_connected',products:rows});
        return;
      }
      if(p==='/api/matching'&&req.method==='GET'){send(res,await matching.list());return;}
      if(p==='/api/matching/product'&&req.method==='GET'){send(res,await matching.get(url.searchParams.get('productKey')));return;}
      if(p==='/api/matching/upc'&&req.method==='POST'){send(res,await matching.saveUpc(body.productKey,body));return;}
      if(p==='/api/matching/candidate-title'&&req.method==='POST'){send(res,matching.parseCandidate(body));return;}
      if(p==='/api/matching/candidate'&&req.method==='POST'){send(res,await matching.saveCandidate(body.productKey,body));return;}
      if(p==='/api/matching/history'&&req.method==='GET'){send(res,{history:await matching.candidateHistory(url.searchParams.get('productKey'),url.searchParams.get('asin'))});return;}
      if(p==='/api/matching/retailer-details'&&req.method==='POST'){
        if(engine.running)throw new AppError('SCAN_ACTIVE','Wait for the Research scan to finish before a separate detail lookup.',{status:409});
        send(res,await matching.retailerDetails(body.productKey));return;
      }
      if(p==='/api/matching/export'&&req.method==='GET'){
        const products=(await matching.list()).products,records=[];
        for(const product of products)records.push(await matching.get(product.productKey));
        send(res,{schema:'50toc.exact-matches.v1',exportedAt:new Date().toISOString(),records,liveCatalogConnected:false,secondaryEngineConnected:false});return;
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
  return {server,store,engine,provider,session,enrichment,matching,
    async listen(port=8876){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;return base;},
    async close(){await engine.close();await enrichment.close();await new Promise(resolve=>server.close(resolve));await db.close();}
  };
}
