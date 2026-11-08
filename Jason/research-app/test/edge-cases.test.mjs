import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {Store} from '../server/store.mjs';
import {ResearchEngine} from '../server/engine.mjs';
import {ScavioProvider} from '../server/provider.mjs';
import {AppError} from '../server/errors.mjs';

const category={id:'grocery',slug:'grocery',name:'Grocery'};
const scope={warehouses:['1062'],categoryIds:['grocery'],dealTypes:['clearance']};
const item={item_number:'123',title:'Example',warehouse:{warehouse_id:'1062',price:12.97}};

test('pagination errors save received records and mark coverage incomplete',async()=>{
  const db=await openDatabase(),store=new Store(db);
  await store.set('categories',[category]);
  const provider={configured:()=>true,async call(){return {json:{data:{page:1,results:[item]}},cached:false,observedAt:new Date().toISOString()};}};
  const engine=new ResearchEngine(store,provider,{retryDelay:1});
  try{
    const job=await engine.create(scope);await engine.running;
    assert.equal((await store.job(job.id)).status,'partial');assert.equal((await store.offers()).length,1);
    assert.equal((await store.sourcePages(job.id)).length,1);
    assert.equal((await store.job(job.id)).tasks[0].page,1);
    assert.equal((await store.job(job.id)).tasks[0].error.code,'PAGINATION_INCOMPLETE');
  }finally{await db.close();}
});

test('atomic page commit rolls back offers, evidence and cursor on a storage failure',async()=>{
  const db=await openDatabase(),store=new Store(db);
  await store.set('categories',[category]);
  const provider={configured:()=>true,async call(){return {json:{data:{page:1,total_pages:2,results:[item]}},cached:false,observedAt:new Date().toISOString()};}};
  const original=store.saveOffer;store.saveOffer=async function(...args){await original.call(this,...args);throw Error('synthetic storage failure');};
  const engine=new ResearchEngine(store,provider,{retryDelay:1});
  try{
    const job=await engine.create(scope);await engine.running;
    assert.equal((await store.offers()).length,0);assert.equal((await store.sourcePages(job.id)).length,0);
    assert.equal((await store.job(job.id)).status,'partial');
    // A failed transaction must leave the page pending, not advance past lost data.
    assert.equal((await store.job(job.id)).tasks[0].page,1);
  }finally{await db.close();}
});

test('retryable provider failures are bounded and secrets never enter scan errors',async()=>{
  const db=await openDatabase(),store=new Store(db);await store.set('categories',[category]);
  let attempts=0;
  const provider=new ScavioProvider(store,{configured:()=>true,read:async()=>'synthetic-test-secret'},{
    fetcher:async()=>{attempts++;return new Response('internal details synthetic-test-secret',{status:503});}
  });
  const engine=new ResearchEngine(store,provider,{retryDelay:1});
  try{
    const job=await engine.create(scope);await engine.running;const saved=await store.job(job.id);
    assert.equal(attempts,3);assert.equal(saved.calls,3);assert.equal(saved.status,'partial');
    assert(!JSON.stringify(saved).includes('synthetic-test-secret'));
    assert.equal((await store.events()).length,3);
  }finally{await db.close();}
});
