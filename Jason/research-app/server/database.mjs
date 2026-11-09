import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';

export async function openDatabase({connectionString, dataDir}={}) {
  if (connectionString) {
    const pool=new pg.Pool({connectionString, max:5, connectionTimeoutMillis:10000});
    // One Research worker per database, including across application processes.
    const owner=await pool.connect();
    const result=await owner.query('SELECT pg_try_advisory_lock(5020261106) AS locked');
    if (!result.rows[0].locked) { owner.release(); await pool.end(); throw Error('Research service already active'); }
    let ownershipLost=false;
    owner.on('error',()=>{ownershipLost=true;});
    pool.on('error',()=>{}); // Never print driver errors containing connection details.
    const requireOwner=()=>{if(ownershipLost)throw Error('Research database ownership lost');};
    const db={
      mode:'PostgreSQL server',
      query:(sql, values)=>{requireOwner();return pool.query(sql, values);},
      exec:sql=>{requireOwner();return pool.query(sql);},
      async transaction(fn) {
        requireOwner();
        const c=await pool.connect();
        try {await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result;}
        catch(e) {await c.query('ROLLBACK'); throw e;} finally {c.release();}
      },
      async close(){await owner.query('SELECT pg_advisory_unlock(5020261106)');owner.release();await pool.end();}
    };
    await migrate(db); return db;
  }
  const db=await PGlite.create(dataDir ?? 'memory://');
  db.mode='Local embedded PostgreSQL (PGlite)';
  await migrate(db); return db;
}

async function migrate(db) {
  for(const name of ['001_research.sql','002_enrichment.sql','003_exact_matches.sql','004_upc_lookup.sql','005_workflow.sql','006_prices.sql'])
    await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
}
