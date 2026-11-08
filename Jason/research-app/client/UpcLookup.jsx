import React,{useEffect,useRef,useState} from 'react';

export function UpcLookupControls({api,demo,productKey,active,onProgress}){
  const [state,setState]=useState(null),[plan,setPlan]=useState(null),[force,setForce]=useState(false),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const callback=useRef(onProgress),last=useRef('');callback.current=onProgress;
  async function refresh(){
    const next=await api('upc-lookup');setState(next);
    const version=JSON.stringify([next.job?.id,next.job?.cursor,next.job?.calls,next.job?.status]);
    if(last.current&&last.current!==version)callback.current?.();last.current=version;
  }
  useEffect(()=>{if(!active)return;let alive=true;const poll=()=>{if(alive)refresh().catch(e=>setError(e.message));};poll();const timer=setInterval(poll,1800);return()=>{alive=false;clearInterval(timer);};},[active]);
  useEffect(()=>{setPlan(null);},[productKey,force]);
  async function run(fn){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const job=state?.job,running=state?.running,pending=job&&['paused','interrupted','attention'].includes(job.status);
  return <section className="settings-card upc-automation"><div className="results-heading"><div><h2>Automatic UPC lookup</h2><p>Find barcode evidence, then confirm the exact package. Found numbers are never automatically verified.</p></div><span className="badge">{demo?'DEMO · no credits':'Uses Scavio'}</span></div>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="inline-form"><button disabled={busy||running||!productKey} onClick={()=>run(async()=>setPlan(await api('upc-lookup/plan',{productKey,force})))}>Estimate this product</button><button disabled={busy||running} onClick={()=>run(async()=>setPlan(await api('upc-lookup/plan',{force})))}>Estimate all saved products</button></div>
    <label className="choice"><input type="checkbox" checked={force} disabled={busy||running} onChange={e=>setForce(e.target.checked)}/>Recheck products looked up today. Current verified packages are always skipped.</label>
    {plan&&<div className="upc-plan" role="status"><strong>{plan.eligible} products to check · {plan.verifiedSkipped} verified and {plan.recentSkipped} recently checked skipped</strong><p>{demo?'Demo only. No credits will be used.':`Up to ${plan.maxCredits} Scavio credits if every request is uncached: ${plan.detailBatches} batched Costco detail requests, up to ${plan.maxSearches} searches and ${plan.maxPageReads} page reads. Saved identifiers and cache hits reduce this.`}</p><p>Each missing item gets one web-search page and up to two product-page reads. Every eligible saved product is processed. Photos are not analyzed.</p>
      {pending&&<label className="choice"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Replace the stopped batch with this new one. Its saved evidence will remain in the export.</label>}
      <button className="primary" disabled={busy||running||!plan.eligible||pending&&!replace} onClick={()=>run(async()=>{await api('upc-lookup/start',{scope:plan.scope,fingerprint:plan.fingerprint,replaceStopped:replace});setPlan(null);setReplace(false);})}>Start automatic lookup</button>
    </div>}
    {job&&<div className="upc-job" aria-live="polite"><strong>UPC batch: {job.status.replaceAll('_',' ')} · {job.completedProducts} / {job.productCount} products finished</strong><p>{job.calls} saved successful responses · {job.cachedResponses} cache hits · {job.uncachedResponses} uncached responses. These counters are not a billing receipt.</p>{job.currentTitle&&running&&<p>Checking: {job.currentTitle}</p>}{job.lastError&&<div className="alert error">{job.lastError.message}<small>Code {job.lastError.code} · Event {job.lastError.eventId}</small></div>}
      {running?<button disabled={busy||job.stopRequested} onClick={()=>run(()=>api('upc-lookup/stop',{}))}>{job.stopRequested?'Stopping after the current request…':'Stop after current request'}</button>:pending?<button disabled={busy} onClick={()=>run(()=>api('upc-lookup/resume',{}))}>Resume saved batch</button>:null}
      {job.status==='interrupted'&&<p>The service stopped during lookup. Paid requests resume only when you choose Resume.</p>}
    </div>}
  </section>;
}

export function UpcLookupEvidence({report,profile,upc,busy,onUse}){
  if(!report)return <div className="empty"><h3>UPC lookup has not run for this product</h3><p>Estimate this product or all saved products above, then start the lookup.</p></div>;
  const stale=report.sourceSignature!==profile.sourceSignature;
  return <section className="results-card upc-discoveries"><div className="results-heading"><div><h2>Automatic lookup results</h2><p>{report.completedAt?'Checked '+new Date(report.completedAt).toLocaleString():'Lookup in progress'} · {report.evidence.length} evidence records</p></div><span className={'badge '+(report.summary?.conflictingIdentifiers?'match-potential':'match-needs_information')}>{stale?'Recheck needed':report.summary?.status?.replaceAll('_',' ')??'Checking'}</span></div>
    {stale&&<div className="alert error">Club evidence changed after this lookup. Run lookup again before using these numbers.</div>}
    {report.summary?.conflictingIdentifiers&&<div className="alert error">Different UPCs were found. They may identify different packs or inner units. Confirm the number printed on the intended club package.</div>}
    {!report.evidence.length&&<div className="empty"><h3>{report.completedAt?'No explicit barcode found':'Looking for barcode evidence'}</h3><p>{report.completedAt?'No number was invented from the title or club item number. Manual package confirmation is still needed.':'Results will appear here as requests finish.'}</p></div>}
    <div className="upc-evidence-list">{report.evidence.map(e=><article key={e.id} className="upc-evidence-card"><div className="upc-evidence-top"><strong>{String(e.raw)}</strong><span className={'badge '+(e.valid?'match-needs_information':'match-mismatch')}>{e.valid?'Needs package confirmation':'Number check failed'}</span></div><p>{e.title}</p><p>{e.source} · {e.observedAt?new Date(e.observedAt).toLocaleString():'Saved API evidence'}{e.cached?' · cached':''}</p>{e.sourceUrl&&<a href={e.sourceUrl} target="_blank" rel="noreferrer">Open evidence source ↗</a>}{e.excerpt&&<blockquote>{e.excerpt}</blockquote>}<ul>{e.flags.map((f,i)=><li key={i}>{f}</li>)}</ul>{upc?.status==='verified'&&upc.sourceSignature===profile.sourceSignature&&e.gtin14===upc.validation?.gtin14?<p className="upc-confirmed">This number has a saved human verification: {upc.scope.replaceAll('_',' ')}.</p>:<button disabled={busy||stale||!e.valid} onClick={()=>onUse(e)}>Review this number</button>}</article>)}</div>
    {!!report.errors.length&&<details className="upc-report-details"><summary>Lookup issues · {report.errors.length}</summary>{report.errors.map((e,i)=><p key={i}>{e.message} <small>{e.code}</small></p>)}</details>}
    {report.search&&<details className="upc-report-details"><summary>Search and page coverage</summary><p>Query: {report.search.query}</p><p>One search-results page; up to two selected product pages are read. Remaining links are leads for manual checking.</p>{report.search.results.map((r,i)=><p key={i}><a href={r.url} target="_blank" rel="noreferrer">{r.title||r.url}</a> · {report.pages.find(p=>p.url===r.url)?.status??'Not read'}</p>)}</details>}
  </section>;
}
