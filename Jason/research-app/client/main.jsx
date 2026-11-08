import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

const token=document.querySelector('meta[name="50toc-session"]').content;
async function api(path,body){
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'x-50toc-session':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error+(result.eventId?' · Event '+result.eventId:''));
  return result;
}
const money=n=>n===null||n===undefined?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const time=s=>s?new Date(s).toLocaleString():'Not recorded';
const title=s=>String(s??'').replaceAll('_',' ');
const toggle=(xs,id)=>xs.includes(id)?xs.filter(x=>x!==id):[...xs,id];

function Selection({label,items,selected,onChange,empty,children,disabled=false}){
  return <section className="selection"><div className="section-heading"><h3>{label}</h3><span className="count">{selected.length} selected</span></div>
    {children}
    {!!items.length&&<div className="selection-actions"><button type="button" className="text-button" disabled={disabled} onClick={()=>onChange([...new Set(items.map(i=>i.id))])}>Select all</button><button type="button" className="text-button" disabled={disabled} onClick={()=>onChange([])}>Clear</button></div>}
    <div className="choices">{items.length?items.map(item=><label className="choice" key={item.id}><input type="checkbox" disabled={disabled} checked={selected.includes(item.id)} onChange={()=>onChange(toggle(selected,item.id))}/><span><strong>{item.label}</strong>{item.detail&&<small>{item.detail}</small>}</span></label>):<p className="muted">{empty}</p>}</div>
  </section>;
}

function App(){
  const [state,setState]=useState(null),[view,setView]=useState('research'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [warehouses,setWarehouses]=useState([]),[categoryIds,setCategoryIds]=useState([]),[types,setTypes]=useState([]),[zip,setZip]=useState('07601'),[force,setForce]=useState(false),[plan,setPlan]=useState(null);
  const [scanId,setScanId]=useState(''),[search,setSearch]=useState(''),[decision,setDecision]=useState('all'),[page,setPage]=useState(1),[results,setResults]=useState({offers:[],total:0}),[detail,setDetail]=useState(null);
  const [key,setKey]=useState(''),[keyStorage,setKeyStorage]=useState('windows'),[usage,setUsage]=useState(null),[diagnostics,setDiagnostics]=useState(null);
  const initialized=useRef(false),detailClose=useRef(null),latestOffers=useRef(0);
  async function refresh(){
    const next=await api('state');setState(next);
    if(!initialized.current){initialized.current=true;setWarehouses(next.preferences.warehouses??[]);setCategoryIds(next.preferences.categoryIds??[]);setTypes(next.preferences.dealTypes??[]);}
    return next;
  }
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  const active=state?.jobs.find(j=>['queued','running'].includes(j.status));
  useEffect(()=>{
    if(!active)return;
    const timer=setInterval(()=>refresh().catch(e=>setError(e.message)),1500);
    return ()=>clearInterval(timer);
  },[active?.id]);
  async function run(fn){
    setBusy(true);setError('');setNotice('');
    try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const scope={retailer:'costco',warehouses,categoryIds,dealTypes:types,force};
  useEffect(()=>{
    let current=true;setPlan(null);
    if(!warehouses.length||!categoryIds.length||!types.length)return;
    const timer=setTimeout(()=>api('plan',scope).then(p=>{if(current)setPlan(p);}).catch(e=>{if(current)setError(e.message);}),180);
    return ()=>{current=false;clearTimeout(timer);};
  },[JSON.stringify(scope),state?.categories.length]);
  async function loadOffers(){
    const request=++latestOffers.current;
    const params=new URLSearchParams({q:search,decision,page:String(page),...(scanId?{scanId}:{})});
    const next=await api('offers?'+params);if(request===latestOffers.current)setResults(next);
  }
  useEffect(()=>{if(state&&['research','library'].includes(view))loadOffers().catch(e=>setError(e.message));},[view,scanId,search,decision,page,state?.jobs.map(j=>j.id+j.pages+j.status).join('|')]);
  useEffect(()=>{setPage(1);},[search,decision,scanId]);
  useEffect(()=>{
    if(!detail)return;
    const previous=document.activeElement;detailClose.current?.focus();
    const handler=e=>{
      if(e.key==='Escape')setDetail(null);
      if(e.key==='Tab'){
        const controls=[...document.querySelector('.dialog').querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')];
        if(!controls.length)return;
        const first=controls[0],last=controls.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',handler);
    return ()=>{document.removeEventListener('keydown',handler);previous?.focus();};
  },[detail?.id]);
  async function download(format){
    const response=await fetch('/api/export?'+new URLSearchParams({format,...(scanId?{scanId}:{})}),{headers:{'x-50toc-session':token}});
    if(!response.ok)throw Error('The export could not be created.');
    const blob=await response.blob(),href=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=href;a.download='50TOC-'+(state.demo?'DEMO-':'')+'research.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  function navigate(next){setView(next);setError('');setNotice('');if(next==='library')setScanId('');}
  if(!state)return <div className="loading"><strong>50TOC</strong><p role="status">{error||'Opening Research…'}</p></div>;
  const warehouseItems=state.warehouses.map(w=>({id:String(w.warehouse_id),label:(w.name??'Costco')+' · #'+w.warehouse_id,detail:typeof w.address==='string'?w.address:JSON.stringify(w.address??'')}));
  // Selected warehouses remain visible even when a later ZIP search returns another area.
  for(const id of warehouses)if(!warehouseItems.some(w=>w.id===id))warehouseItems.push({id,label:'Saved warehouse #'+id,detail:'Refresh location details to verify this warehouse.'});
  const categoryItems=state.categories.map(c=>({id:c.id,label:c.name,detail:c.parent||c.slug}));
  const scanning=Boolean(active),last=state.jobs[0];
  return <div className="app">
    <aside className="sidebar"><a href="#research" className="brand" onClick={e=>{e.preventDefault();navigate('research');}}>50<span>TOC</span><small>BUYING ENGINE</small></a>
      <div className="workspace-label">JASON WORKSPACE</div>
      <nav aria-label="Main navigation">{[['research','⌕','Research'],['library','▤','Research library'],['enrichment','◇','Enrichment'],['analysis','▥','Analysis'],['approvals','✓','Approvals'],['buying','▣','Worker / Buyer'],['scheduling','◷','Scheduling'],['settings','⚙','Settings / APIs']].map(([id,icon,label])=><button key={id} className={view===id?'nav active':'nav'} onClick={()=>navigate(id)} aria-current={view===id?'page':undefined}><span aria-hidden="true">{icon}</span>{label}{!['research','library','settings'].includes(id)&&<small>Later</small>}</button>)}</nav>
      <div className="sidebar-footer"><span className={'dot '+(state.configured?'connected':'')}/>{state.demo?'Demonstration':state.configured?'Scavio configured':'Scavio not connected'}<small>Costco first · Research 0.1</small></div>
    </aside>
    <main><header className="topbar"><span>50TOC / {view==='settings'?'Connections':view==='library'?'Saved research':title(view)}</span><span className="mode">{state.demo?'DEMO · No API credits used':'LOCAL DEVELOPMENT'}</span></header>
      <div className="content">
        {state.demo&&<div className="demo-banner">Demonstration mode. All warehouses and products below are synthetic examples. Live and demo data are stored separately.</div>}
        {error&&<div role="alert" className="alert error">{error}<button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
        {notice&&<div role="status" className="alert success">{notice}</div>}
        {['research','library'].includes(view)?<>
          <div className="page-heading"><div><div className="eyebrow">SOURCE & DISCOVER</div><h1>{view==='research'?'Costco Research':'Research library'}</h1><p>{view==='research'?'Choose where to look and which deals to collect.':'Your saved products, warehouse offers and original source evidence.'}</p></div><span className="phase">PHASE 01</span></div>
          {view==='research'&&<>
            <div className="retailers"><button className="retailer selected">Costco <span>Connected module</span></button><button className="retailer" disabled>Sam’s Club <span>Planned</span></button><button className="retailer" disabled>BJ’s <span>Planned</span></button></div>
            <div className="scope-grid">
              <Selection label="Warehouses" items={warehouseItems} selected={warehouses} onChange={setWarehouses} disabled={busy||scanning} empty="Find nearby warehouses to begin.">
                <form className="inline-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('warehouses',{zip});await refresh();});}}><label className="sr-only" htmlFor="zip">ZIP code</label><input id="zip" inputMode="numeric" pattern="[0-9]{5}" value={zip} maxLength={5} onChange={e=>setZip(e.target.value)} placeholder="ZIP code" disabled={busy||scanning}/><button disabled={busy||scanning}>Find nearby</button></form><small className="muted">1 credit if uncached. Existing selections are retained.</small>
              </Selection>
              <Selection label="Departments" items={categoryItems} selected={categoryIds} onChange={setCategoryIds} disabled={busy||scanning} empty="Load the actual Costco department list.">
                <button className="secondary wide" disabled={busy||scanning} onClick={()=>run(async()=>{await api('categories',{});await refresh();})}>Load departments</button><small className="muted">1 credit if uncached. No predefined department restrictions.</small>
                {!!state.categories.length&&<details className="subcategories"><summary>Explore subdepartments</summary>{state.categories.filter(c=>c.nativeId).map(c=><button className="text-button" key={c.id} disabled={busy||scanning} onClick={()=>run(async()=>{await api('categories',{parentId:c.nativeId});await refresh();})}>{c.name} →</button>)}</details>}
              </Selection>
              <Selection label="Deal types" items={state.dealTypes.map(d=>({id:d.id,label:d.label,detail:d.detail}))} selected={types} onChange={setTypes} disabled={busy||scanning}/>
            </div>
            <section className="scan-bar"><div><h3>{plan?plan.taskCount+' initial '+(plan.taskCount===1?'task':'tasks'):'Choose your scan scope'}</h3><p>{plan?warehouses.length+' warehouses × '+categoryIds.length+' departments · at least '+plan.minimumCredits+' credits if uncached':'Select at least one warehouse, department and deal type.'}</p>
              {plan&&<details><summary>Why these tasks?</summary><ul>{plan.explanation.map((t,i)=><li key={i}>{t.label} · at least {t.minimumCredits} credits</li>)}</ul><p>Markdown types share a single department scan. Additional pages cost extra. Feeds are matched against the selected department membership.</p></details>}
              <label className="refresh-option"><input type="checkbox" checked={force} disabled={busy||scanning} onChange={e=>setForce(e.target.checked)}/>Get fresh data instead of reusing cached pages</label>
            </div><button className="primary scan-button" disabled={!plan||busy||scanning||!state.configured} onClick={()=>run(async()=>{const result=await api('scans',scope);setScanId(result.job.id);setPage(1);await refresh();})}>{scanning?'Scan in progress…':'Scan Deals'} <span aria-hidden="true">→</span></button></section>
            <p className="scope-note">All supported result pages are processed. No product keyword, product cap or price ceiling. Warehouse prices are kept separate from online prices.</p>
          </>}
          {last&&<section className="scan-status"><div><span className={'badge '+last.status}>{title(last.status)}</span><strong>{last.pages} pages saved</strong><span>{last.received} rows read · {last.calls} API attempts · {last.cacheHits} cached pages</span></div>
            <div>{scanning?<button disabled={busy} onClick={()=>run(async()=>{await api('scans/'+active.id+'/stop',{});setNotice('Stop requested. The current request will finish and its results will be saved.');await refresh();})}>Stop scan</button>:last.status!=='complete'&&<button disabled={busy} onClick={()=>run(async()=>{await api('scans/'+last.id+'/resume',{});setScanId(last.id);await refresh();})}>Resume incomplete scan</button>}<button className="text-button" onClick={()=>{setScanId(last.id);setView('library');}}>View this scan</button></div>
            {last.tasks.some(t=>t.error)&&<details><summary>Scan issues</summary>{last.tasks.filter(t=>t.error).map(t=><p key={t.id}>{t.category?.name??title(t.type??t.kind)}: {t.error.error} {t.error.eventId&&'· Event '+t.error.eventId}</p>)}</details>}
          </section>}
          <section className="results-card"><div className="results-heading"><div><h2>{view==='research'?'Collected deals':'Saved offers'} <span className="count">{results.total}</span></h2><p>Collection is the first step. These products have not been approved to buy.</p></div><div className="export-actions"><button disabled={busy||!results.total} onClick={()=>run(()=>download('csv'))}>Export all fields to CSV</button><button disabled={busy||!results.total} onClick={()=>run(()=>download('json'))}>JSON</button></div></div>
            <div className="filters"><label><span className="sr-only">Search saved results</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search saved results…"/></label><label><span className="sr-only">Scan history</span><select value={scanId} onChange={e=>setScanId(e.target.value)}><option value="">Current library · all scans</option>{state.jobs.map(j=><option key={j.id} value={j.id}>{time(j.createdAt)} · {title(j.status)}</option>)}</select></label><label><span className="sr-only">Research status</span><select value={decision} onChange={e=>setDecision(e.target.value)}><option value="all">All research statuses</option><option value="collected">Collected</option><option value="needs_information">Needs information</option></select></label></div>
            <div className="table-scroll"><table><thead><tr><th>Product</th><th>Warehouse</th><th>Warehouse price</th><th>Online price</th><th>Deal type</th><th>Research status</th></tr></thead><tbody>{results.offers.map(o=><tr key={o.id}><td><button className="product-link" onClick={()=>run(async()=>{const result=await api('offer?'+new URLSearchParams({id:o.id,...(scanId?{scanId}:{})}));setDetail(result.offer);})}>{o.title}</button><small>{o.brand||'Brand not supplied'} · Item {o.itemNumber||'not supplied'}</small></td><td>#{o.warehouseId}</td><td><strong>{money(o.warehousePrice)}</strong><small>{o.warehousePrice===null?'Not verified':time(o.warehousePriceObservedAt)}</small></td><td>{money(o.onlinePrice)}</td><td>{o.dealTypes.map(t=><span className="tag" key={t}>{title(t)}</span>)}</td><td><span className={'badge '+o.disposition}>{title(o.disposition)}</span>{o.sourceCached&&<small>Cached source · {time(o.observedAt)}</small>}</td></tr>)}</tbody></table></div>
            {!results.offers.length&&<div className="empty"><span aria-hidden="true">⌕</span><h3>{search||decision!=='all'?'No matching saved results':'Ready to discover your next deal'}</h3><p>{view==='research'?'Choose your scan scope above, then press Scan Deals.':'Run a Costco Research scan to start your saved library.'}</p></div>}
            {results.total>50&&<div className="pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {Math.ceil(results.total/50)} · all {results.total} offers saved</span><button disabled={page*50>=results.total} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
          </section><p className="coverage">{state.coverage}</p>
        </>:view==='settings'?<>
          <div className="page-heading"><div><div className="eyebrow">WORKSPACE SETTINGS</div><h1>API connections</h1><p>Connect the sources that power your research.</p></div></div>
          <section className="settings-card"><div className="section-heading"><h2>Scavio · Costco</h2><span className="badge">{state.configured?'Configured':'Not connected'}</span></div>
            <p>Keys stay on the server and are never returned to the screen. Choose encrypted Windows storage or memory for this session only. Current storage: {state.keyStorageMode}.</p>
            <form onSubmit={e=>{e.preventDefault();run(async()=>{await api('key',{key,storage:keyStorage});setKey('');setUsage(null);await refresh();setNotice(keyStorage==='session'?'Key is available for this session only. It will be cleared when the service closes.':'Scavio key saved encrypted. Use Test Connection to verify it.');});}}>
              <label htmlFor="key-storage">Key storage</label><select id="key-storage" value={keyStorage} disabled={busy||scanning||state.demo} onChange={e=>setKeyStorage(e.target.value)}><option value="windows">Encrypted Windows storage</option><option value="session">This session only · cleared when closed</option></select>
              <label htmlFor="api-key">Scavio API key</label><div className="inline-form"><input id="api-key" type="password" autoComplete="off" value={key} disabled={state.demo||busy||scanning} onChange={e=>setKey(e.target.value)} placeholder="Paste a new key to save or replace it"/><button disabled={state.demo||busy||scanning||!key}>Save key</button></div>
            </form><button className="primary" disabled={busy||!state.configured} onClick={()=>run(async()=>{const result=await api('usage',{});setUsage(result);setNotice(state.demo?'Demo connection works. No real API call was made.':'Scavio connection verified.');})}>Test Connection · 0 credits</button>
            {usage&&<p className="connection-result">{usage.demo?'Demo balance': 'Available Scavio credits'}: <strong>{usage.creditBalance.toLocaleString()}</strong></p>}
          </section>
          <section className="settings-card"><h2>Sourcing flags</h2><p>These flags send uncertain products to Needs information; they do not approve purchases.</p>{[['flagVariety','Flag mixed or variety packs'],['flagPerishable','Flag refrigerated or perishable items']].map(([id,label])=><label className="choice" key={id}><input type="checkbox" checked={state.rules[id]!==false} disabled={busy||scanning} onChange={e=>run(async()=>{await api('rules',{...state.rules,[id]:e.target.checked});await refresh();})}/>{label}</label>)}</section>
          <section className="settings-card"><h2>Storage & diagnostics</h2><p>{state.databaseMode}. This build is available on this computer only. Shared hosting and user sign-in will be added before remote access.</p><p>No Keepa connection, price ceiling, AI usage or purchase automation in this module.</p><button disabled={busy} onClick={()=>run(async()=>setDiagnostics((await api('diagnostics')).events))}>Show safe diagnostics</button>{diagnostics&&<pre className="raw">{JSON.stringify(diagnostics,null,2)}</pre>}</section>
        </>:<section className="future-module"><div className="eyebrow">A LATER PHASE</div><h1>{view==='buying'?'Worker / Buyer':title(view)}</h1><p>This module is part of the agreed structure. We are first building and testing Costco Research and its saved library.</p><button className="primary" onClick={()=>navigate('research')}>Return to Research</button></section>}
      </div>
    </main>
    {detail&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null);}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="dialog-top"><span className="eyebrow">SAVED RESEARCH EVIDENCE</span><button ref={detailClose} onClick={()=>setDetail(null)} aria-label="Close product details">Close ×</button></div><h2 id="detail-title">{detail.title}</h2><p>Item {detail.itemNumber||'not supplied'} · Warehouse #{detail.warehouseId}</p><div className="detail-prices"><div><small>Warehouse price</small><strong>{money(detail.warehousePrice)}</strong></div><div><small>Online price</small><strong>{money(detail.onlinePrice)}</strong></div><div><small>Observed</small><strong>{time(detail.observedAt)}</strong></div></div>
      <dl className="detail-fields">{[['Brand',detail.brand],['UPC',detail.upc],['Pack count',detail.packCount],['Size',detail.packageSize],['Availability',detail.availability],['First seen',time(detail.firstSeen)],['Departments',detail.categories.map(c=>c.name).join(', ')]].map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v??'Not supplied'}</dd></React.Fragment>)}</dl>
      {detail.reasons.length>0&&<div className="detail-flags"><strong>Needs information</strong><ul>{detail.reasons.map(r=><li key={r}>{r}</li>)}</ul></div>}
      <div className="detail-links">{detail.productUrl&&<a href={detail.productUrl} target="_blank" rel="noreferrer">Open product page ↗</a>}{detail.imageUrl&&<a href={detail.imageUrl} target="_blank" rel="noreferrer">Open API-provided photo ↗</a>}</div>
      <p className="muted">Photo analysis and product-component extraction belong to the next Enrichment module. Unknown information is retained.</p>
      <details><summary>View every saved field and original API record</summary><pre className="raw" tabIndex="0">{JSON.stringify(detail,null,2)}</pre></details>
    </section></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
