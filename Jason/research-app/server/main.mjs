import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {openDatabase} from './database.mjs';
import {createApp} from './app.mjs';
import {DemoProvider} from './demo.mjs';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url)),demo=process.argv.includes('--demo');
const dataDir=path.resolve(process.env.FIFTYTOC_DATA_DIR??path.join(root,'data',demo?'demo':'live'));
let app,lock;
try{
  await mkdir(dataDir,{recursive:true});
  const lockPath=path.join(dataDir,'service.lock');
  try{lock=await open(lockPath,'wx');}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const pid=Number(await readFile(lockPath,'utf8'));
    let alive=true;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
    if(alive)throw Error('Service already running');
    await unlink(lockPath);lock=await open(lockPath,'wx');
  }
  await lock.writeFile(String(process.pid));
  const db=await openDatabase({connectionString:demo?undefined:process.env.DATABASE_URL,dataDir:path.join(dataDir,'postgres')});
  app=await createApp({db,dataDir,demo,provider:demo?new DemoProvider():undefined});
  if(demo){
    const categories=(await app.provider.call('costco/categories')).json.data.categories.map(c=>({id:c.slug,slug:c.slug,name:c.name,nativeId:c.category_id,parent:''}));
    await app.store.set('categories',categories);
    await app.store.set('warehouses',(await app.provider.call('costco/warehouses')).json.data.warehouses);
    if(!await app.store.get('preferences'))await app.store.set('preferences',{warehouses:['1062'],categoryIds:[categories[0].id],dealTypes:['clearance','manager_markdown']});
  }
  const base=await app.listen(Number(process.env.PORT)||8876);
  console.log('50TOC Jason Research: '+base);
  console.log(demo?'DEMO — synthetic products only; no API calls.':'LOCAL — connect Scavio in Settings. No Python is required.');
  console.log('Storage: '+db.mode+'. Keep this service open while scans run.');
  if(process.platform==='win32'&&process.argv.includes('--open-browser')){
    const browser=spawn('cmd.exe',['/d','/c','start','',base],{windowsHide:true,stdio:'ignore'});
    browser.on('error',()=>console.log('Open the local address above in your browser.'));
  }
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await app.close();await lock.close();await unlink(lockPath);process.exit(0);};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}catch{
  console.error('50TOC could not start. Check whether it is already running, the data folder is writable, and any configured PostgreSQL server is available. Connection details were omitted.');
  if(lock){await lock.close();await unlink(path.join(dataDir,'service.lock')).catch(()=>{});}
  process.exit(1);
}
