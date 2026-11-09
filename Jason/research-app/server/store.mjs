import {syncProductProfile} from './enrichment.mjs';
import {decoratePrice} from './pricing.mjs';
const ns='jason_research.';
const json=x=>JSON.stringify(x);
const merge=(old, next)=>({
  ...next,
  firstSeen: old?.firstSeen && old.firstSeen<next.firstSeen ? old.firstSeen : next.firstSeen,
  categories:[...new Map([...(old?.categories??[]),...next.categories].map(c=>[c.id,c])).values()],
  dealTypes:[...new Set([...(old?.dealTypes??[]),...next.dealTypes])],
  evidence:[...(old?.evidence??[]),...next.evidence]
});

export class Store {
  constructor(db){this.db=db;}
  async get(key, fallback=null){return (await this.db.query('SELECT body FROM '+ns+'settings WHERE key=$1',[key])).rows[0]?.body??fallback;}
  async set(key, body){await this.db.query('INSERT INTO '+ns+'settings VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET body=EXCLUDED.body',[key,json(body)]);}
  async saveJob(job, db=this.db){
    const {cancelRequested,...body}=job;
    await db.query('INSERT INTO '+ns+'scans(id,created_at,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET body=EXCLUDED.body',[job.id,job.createdAt,json(body)]);
  }
  async job(id){const row=(await this.db.query('SELECT body,cancel_requested FROM '+ns+'scans WHERE id=$1',[id])).rows[0];return row?{...row.body,cancelRequested:row.cancel_requested}:null;}
  async jobs(){return (await this.db.query('SELECT body,cancel_requested FROM '+ns+'scans ORDER BY created_at DESC')).rows.map(r=>({...r.body,cancelRequested:r.cancel_requested}));}
  async cancel(id, value=true){await this.db.query('UPDATE '+ns+'scans SET cancel_requested=$2 WHERE id=$1',[id,value]);}
  async active(){return (await this.jobs()).some(j=>['queued','running'].includes(j.status));}
  async cached(key){
    const row=(await this.db.query("SELECT body,observed_at FROM "+ns+"cache WHERE key=$1 AND observed_at > CURRENT_TIMESTAMP - INTERVAL '1 day'",[key])).rows[0];
    return row?{json:row.body,observedAt:new Date(row.observed_at).toISOString(),cached:true}:null;
  }
  async putCache(key, body, at){await this.db.query('INSERT INTO '+ns+'cache VALUES($1,$2,$3::jsonb) ON CONFLICT(key) DO UPDATE SET body=EXCLUDED.body,observed_at=EXCLUDED.observed_at',[key,at,json(body)]);}
  async event(event){await this.db.query('INSERT INTO '+ns+'diagnostics VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING',[event.id,event.utc,json(event)]);}
  async events(){return (await this.db.query('SELECT body FROM '+ns+'diagnostics ORDER BY utc DESC LIMIT 250')).rows.map(r=>r.body);}
  async member(scan, warehouse, aliases){
    if(!aliases.length)return [];
    const rows=(await this.db.query('SELECT body FROM '+ns+'membership WHERE scan_id=$1 AND warehouse_id=$2 AND alias=ANY($3::text[])',[scan,warehouse,aliases])).rows;
    return [...new Map(rows.map(r=>[r.body.category.id,r.body])).values()];
  }
  async commitPage(job, task, response, members, offers){
    await this.db.transaction(async db=>{
      await db.query('INSERT INTO '+ns+'source_pages(scan_id,task_id,page,observed_at,cached,body) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[job.id,task.id,task.lastPage,response.observedAt,response.cached,json(response.json)]);
      for(const m of members) for(const alias of m.aliases) await db.query('INSERT INTO '+ns+'membership VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(scan_id,warehouse_id,alias,category_id) DO UPDATE SET body=EXCLUDED.body',[job.id,task.warehouse,alias,task.category.id,json(m)]);
      for(const offer of offers) await this.saveOffer(db,job.id,offer);
      await this.saveJob(job,db);
    });
  }
  async saveOffer(db, scanId, offer){
    const current=(await db.query('SELECT body,first_seen FROM '+ns+'offers WHERE id=$1',[offer.id])).rows[0];
    const oldScan=(await db.query('SELECT body FROM '+ns+'scan_offers WHERE scan_id=$1 AND offer_id=$2',[scanId,offer.id])).rows[0]?.body;
    const snapshot=merge(oldScan,offer);
    if(current) snapshot.firstSeen=new Date(current.first_seen).toISOString()<snapshot.firstSeen?new Date(current.first_seen).toISOString():snapshot.firstSeen;
    await db.query('INSERT INTO '+ns+'products VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING',[offer.productKey,offer.retailer,json({title:offer.title,brand:offer.brand,upc:offer.upc,itemNumber:offer.itemNumber})]);
    // Serialize identity observations and enrichment confirmations for this product.
    await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[offer.productKey]);
    // A cached older observation remains evidence, but cannot replace a newer offer.
    if(!current || current.body.observedAt<=offer.observedAt) {
      await db.query('INSERT INTO '+ns+'offers VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET body=EXCLUDED.body,first_seen=LEAST('+ns+'offers.first_seen,EXCLUDED.first_seen)',[offer.id,offer.productKey,offer.warehouseId,snapshot.firstSeen,json(snapshot)]);
    }
    await db.query('INSERT INTO '+ns+'scan_offers VALUES($1,$2,$3::jsonb) ON CONFLICT(scan_id,offer_id) DO UPDATE SET body=EXCLUDED.body',[scanId,offer.id,json(snapshot)]);
    await syncProductProfile(db,offer.productKey);
  }
  async offers({scanId=null, search='', decision='all'}={}){
    const rows=scanId?(await this.db.query('SELECT body FROM '+ns+'scan_offers WHERE scan_id=$1',[scanId])).rows:(await this.db.query('SELECT body FROM '+ns+'offers')).rows;
    const q=search.toLocaleLowerCase();
    const offers=rows.map(r=>r.body).filter(o=>(decision==='all'||o.disposition===decision)&&(!q||[o.title,o.brand,o.upc,o.itemNumber,o.warehouseId,...o.categories.map(c=>c.name)].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
    return this.decorateOffers(offers,{historical:!!scanId});
  }
  async decorateOffers(offers,{historical=false}={}){
    const checks=historical?new Map():new Map((await this.db.query('SELECT offer_id,body FROM '+ns+'warehouse_price_checks')).rows.map(r=>[r.offer_id,r.body]));
    const details=historical?[]:(await this.db.query('SELECT body FROM '+ns+'upc_lookup_reports ORDER BY observed_at DESC')).rows.map(r=>r.body).filter(r=>r.detail?.product);
    return offers.map(o=>{
      const detail=details.find(r=>r.productKey===o.productKey&&String(r.detail.product.item_number??'')===o.itemNumber&&Date.parse(r.detail.observedAt)>=Date.parse(o.observedAt))?.detail;
      return decoratePrice(o,checks.get(o.id),detail?.product);
    });
  }
  async offer(id,scanId=null){
    const table=scanId?'scan_offers':'offers';
    const rows=(await this.db.query('SELECT body FROM '+ns+table+' WHERE '+(scanId?'scan_id=$2 AND offer_id':'id')+'=$1',scanId?[id,scanId]:[id])).rows;
    if(!rows.length)return null;
    const correction=(await this.db.query('SELECT body FROM '+ns+'corrections WHERE offer_id=$1',[id])).rows[0]?.body??null;
    return {...(await this.decorateOffers([rows[0].body],{historical:!!scanId}))[0],manualCorrection:correction};
  }
  async sourcePages(scanId){return (await this.db.query('SELECT task_id,page,observed_at,cached,body FROM '+ns+'source_pages WHERE scan_id=$1 ORDER BY id',[scanId])).rows;}
}
