import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AppError,eventFor,redact,nonnegativeNumber} from './errors.mjs';

export class KeyVault {
  constructor(dir,{name='scavio',envName='SCAVIO_API_KEY'}={}){this.path=path.join(dir,name+'.key');this.envName=envName;this.name=name;this.value=null;this.memoryOnly=false;}
  configured(){return Boolean(process.env[this.envName]||this.value||existsSync(this.path));}
  mode(){return process.env[this.envName]?'server environment':this.memoryOnly?'session only':existsSync(this.path)?'encrypted Windows storage':'not configured';}
  async invoke(mode,key){
    if(process.platform!=='win32')throw new AppError('KEY_STORAGE_UNAVAILABLE','Use the server SCAVIO_API_KEY environment setting on this operating system.');
    return new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./vault.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore']});
      let output='',done=false;
      const fail=()=>{if(done)return;done=true;reject(new AppError('KEY_STORAGE_FAILED','Windows could not save or read the connection key. Re-enter it under your normal Windows account.',{stage:'key_storage'}));};
      const timer=setTimeout(()=>{child.kill();fail();},15000);
      child.on('error',()=>{clearTimeout(timer);fail();});
      child.stdin.on('error',()=>{});
      child.stdout.on('data',part=>{output+=part;if(output.length>8192){child.kill();fail();}});
      child.on('close',()=>{clearTimeout(timer);if(done)return;try{
        const result=JSON.parse(output);
        if(result.error){
          const stage=['input','encrypt','write','read','decrypt'].includes(result.stage)?result.stage:'unknown';
          const error=new AppError(result.error==='DPAPI_UNAVAILABLE'?'DPAPI_UNAVAILABLE':'KEY_STORAGE_FAILED','Windows key storage could not complete the '+stage+' step. You can use session-only storage or run under your normal Windows account.',{stage:'key_storage_'+stage});
          error.storageExceptionType=/^[A-Za-z]{1,80}$/.test(result.exceptionType??'')?result.exceptionType:'unknown';
          done=true;reject(error);return;
        }
        done=true;resolve(result);
      }catch{fail();}});
      // PowerShell receives the key through stdin, never arguments or environment.
      child.stdin.end(JSON.stringify({mode,path:this.path,key}));
    });
  }
  async read(){if(process.env[this.envName])return process.env[this.envName];if(!this.configured())throw new AppError('KEY_NOT_SAVED','Save the connection key in Settings first.');return this.value??=(await this.invoke('read')).key;}
  validateKey(key){
    if(process.env[this.envName])throw new AppError('KEY_MANAGED_BY_SERVER','This connection is managed by the server environment.');
    if(typeof key!=='string'||key.length<8||key.length>512||/[\s"'\u0000-\u001f]/.test(key))throw new AppError('KEY_INPUT_INVALID','Paste only the API key, without quotes or spaces.');
  }
  async save(key,{sessionOnly=false}={}){
    this.validateKey(key);
    if(sessionOnly){this.value=key;this.memoryOnly=true;return;}
    await this.invoke('save',key);this.value=null;this.memoryOnly=false;
  }
}

const endpoints=new Set(['usage','costco/categories','costco/category','costco/deals','costco/coupons','costco/warehouses','costco/product','google/customsearch','extract']);
export class ScavioProvider {
  constructor(store,vault,{fetcher=fetch,timeout=120000}={}){Object.assign(this,{store,vault,fetcher,timeout});}
  configured(){return this.vault.configured();}
  async call(endpoint,body={},force=false){
    if(!endpoints.has(endpoint))throw new AppError('ENDPOINT_INVALID','Unsupported provider operation.');
    const key=await this.vault.read();
    const cacheKey=createHash('sha256').update(JSON.stringify([key,endpoint,body])).digest('hex');
    if(endpoint!=='usage'&&!force){const hit=await this.store.cached(cacheKey);if(hit)return hit;}
    const start=Date.now();let httpStatus=null;
    try{
      let response;
      try{
        response=await this.fetcher('https://api.scavio.dev/api/v1/'+endpoint,{
          method:endpoint==='usage'?'GET':'POST',
          headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
          ...(endpoint==='usage'?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(this.timeout)
        });
      }catch(e){throw new AppError(e.name==='TimeoutError'?'PROVIDER_TIMEOUT':'NETWORK_ERROR','Scavio could not be reached. The scan retains its last saved page.',{status:502,retryable:true,stage:'transport'});}
      httpStatus=response.status;
      if(!response.ok){
        const errors={401:['AUTHENTICATION_FAILED','Scavio rejected this API key.'],402:['CREDITS_REQUIRED','Scavio reports insufficient credits.'],403:['ACCESS_DENIED','Scavio denied access to this operation.'],429:['RATE_LIMITED','Scavio is limiting requests. Waiting before retry.']};
        const [code,message]=errors[httpStatus]??['PROVIDER_HTTP_ERROR','Scavio returned an HTTP error. See the safe diagnostic event.'];
        await response.body?.cancel();
        throw new AppError(code,message,{status:502,stage:'http',httpStatus,retryable:httpStatus===429||httpStatus>=500});
      }
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>16*1024*1024)throw new AppError('PROVIDER_RESPONSE_TOO_LARGE','The provider response exceeded the supported page size.',{status:502,stage:'response'});chunks.push(chunk);}
      let payload;
      try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INVALID_PROVIDER_JSON','Scavio returned an unreadable response.',{status:502,stage:'response'});}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.error||payload.success===false)
        throw new AppError('PROVIDER_RESPONSE_ERROR','Scavio returned an error response. The raw error was omitted to protect connection details.',{status:502,stage:'response'});
      const json=redact(payload,[key]),observedAt=new Date().toISOString();
      await this.store.event({...eventFor(new AppError('RESPONSE_RECEIVED','',{stage:'response',httpStatus}),endpoint,Date.now()-start),httpStatus});
      if(endpoint!=='usage')await this.store.putCache(cacheKey,json,observedAt);
      return {json,cached:false,observedAt};
    }catch(error){
      const e=error instanceof AppError?error:new AppError('LOCAL_STORAGE_ERROR','The provider result could not be saved. Check free disk space.',{status:500,stage:'storage'});
      const event=eventFor(e,endpoint,Date.now()-start);event.httpStatus=httpStatus;e.eventId=event.id;
      await this.store.event(event);throw e;
    }
  }
  async usage(){
    const result=await this.call('usage');
    const root=result.json.data??result.json;
    const creditBalance=nonnegativeNumber(root.credit_balance??root.credits_remaining);
    if(creditBalance===null){
      const error=new AppError('USAGE_SCHEMA_CHANGED','Scavio responded, but its credit balance could not be read. The connection is not yet verified.',{status:502,stage:'response'});
      const event=eventFor(error,'usage');error.eventId=event.id;await this.store.event(event);throw error;
    }
    return {connected:true,creditBalance};
  }
}
