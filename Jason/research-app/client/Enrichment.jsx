import React,{useEffect,useRef,useState} from 'react';
import './enrichment.css';

const labels={not_reviewed:'Not reviewed',draft:'Draft',reviewed:'Details reviewed',reviewed_with_gaps:'Reviewed with gaps',source_changed:'Source changed'};
const stateLabels={unreviewed:'Not reviewed',confirmed:'Confirmed',not_applicable:'Not applicable',needs_recheck:'Recheck needed'};
const display=value=>value===null||value===undefined||value===''?'Unknown':String(value).replaceAll('_',' ');
const date=value=>value?new Date(value).toLocaleString():'Not yet';
const editingFields=profile=>Object.fromEntries(Object.entries(profile.fields).map(([id,field])=>[id,{value:field.value??'',reviewState:field.reviewState}]));

export default function Enrichment({active,api,demo,refreshKey,requestedProduct,onRequestHandled}){
  const [list,setList]=useState({products:[],counts:{all:0},total:0,fieldDefinitions:[]}),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1);
  const [review,setReview]=useState(null),[fields,setFields]=useState({}),[actor,setActor]=useState('Local reviewer'),[note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false),[showHistory,setShowHistory]=useState(10);
  const request=useRef(0),dialog=useRef(null),close=useRef(null),closeHandler=useRef(null);
  async function refresh(){
    const n=++request.current;
    const result=await api('enrichment?'+new URLSearchParams({q:search,status,page:String(page)}));
    if(n===request.current)setList(result);
  }
  useEffect(()=>{if(active)refresh().catch(e=>setError(e.message));},[active,search,status,page,refreshKey]);
  useEffect(()=>{setPage(1);},[search,status]);
  useEffect(()=>{
    if(!active||!list.preparing)return;
    const timer=setInterval(()=>refresh().catch(e=>setError(e.message)),1000);
    return ()=>clearInterval(timer);
  },[active,list.preparing,search,status,page]);
  async function run(fn){
    setBusy(true);setError('');setMessage('');
    try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function applyReview(result){
    setReview(result);setFields(editingFields(result.profile));setNote(result.profile.note??'');setActor(result.profile.lastSavedBy??'Local reviewer');setDirty(false);setDiscard(false);
  }
  async function open(productKey){await run(async()=>{const result=await api('enrichment/product?'+new URLSearchParams({productKey}));applyReview(result);setShowHistory(10);});}
  useEffect(()=>{
    if(active&&requestedProduct){
      if(dirty)setError('Your current review has unsaved edits. Save or close it before opening another product.');
      else open(requestedProduct);
      onRequestHandled();
    }
  },[active,requestedProduct]);
  useEffect(()=>{
    if(!dirty)return;
    const handler=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',handler);return ()=>window.removeEventListener('beforeunload',handler);
  },[dirty]);
  function closeReview(){
    if(dirty&&!discard){setDiscard(true);return;}
    setReview(null);setDirty(false);setDiscard(false);
  }
  closeHandler.current=closeReview;
  useEffect(()=>{
    if(!active||!review)return;
    const previous=document.activeElement;close.current?.focus();
    const handler=e=>{
      if(e.key==='Escape'){e.preventDefault();closeHandler.current();}
      if(e.key==='Tab'){
        const controls=[...dialog.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
        const first=controls[0],last=controls.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',handler);return ()=>{document.removeEventListener('keydown',handler);previous?.focus();};
  },[active,review?.profile.productKey]);
  function change(id,patch){
    setFields(current=>({...current,[id]:{...current[id],...patch}}));setDirty(true);setDiscard(false);
  }
  async function save(action){
    await run(async()=>{
      const result=await api('enrichment/review',{productKey:review.profile.productKey,revision:review.profile.revision,sourceSignature:review.profile.sourceSignature,fields,note,actor,action});
      applyReview({...review,...result});
      await refresh();
      setMessage(action==='save_draft'?'Draft saved.':result.profile.status==='reviewed'?'Product details reviewed. No purchase approval was created.':'Reviewed fields saved. Missing or unconfirmed details are still flagged.');
    });
  }
  async function exportData(format){
    const result=await fetch('/api/enrichment/export?format='+format,{headers:{'x-50toc-session':document.querySelector('meta[name="50toc-session"]').content}});
    if(!result.ok)throw Error('Enrichment export failed.');
    const blob=await result.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='50TOC-'+(demo?'DEMO-':'')+'enrichment.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const profile=review?.profile,definitions=review?.fieldDefinitions??[];
  return <div hidden={!active}>
    <div className="page-heading"><div><div className="eyebrow">UNDERSTAND THE PRODUCT</div><h1>Enrichment</h1><p>Review the package details before looking for Amazon matches.</p></div><span className="phase">PHASE 02</span></div>
    <div className="enrichment-notice"><strong>Title extraction is active · Photo analysis is disconnected</strong><p>Suggestions use saved API fields and titles. No paid analysis or image downloads. Your corrections are kept separately from the original source.</p></div>
    {error&&<div className="alert error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss enrichment error">×</button></div>}
    {message&&!review&&<div className="alert success" role="status">{message}</div>}
    <div className="enrichment-tabs" aria-label="Enrichment status filters">{Object.entries(labels).map(([key,label])=><button key={key} className={status===key?'selected':''} onClick={()=>setStatus(status===key?'all':key)} aria-pressed={status===key}>{label}<span>{list.counts[key]??0}</span></button>)}</div>
    <section className="results-card"><div className="results-heading"><div><h2>Product details <span className="count">{list.total}</span></h2><p>One record per club product, shared across its warehouse offers.</p></div><div className="export-actions"><button disabled={busy||!list.counts.all} onClick={()=>run(()=>exportData('csv'))}>Export enrichment CSV</button><button disabled={busy||!list.counts.all} onClick={()=>run(()=>exportData('json'))}>JSON</button></div></div>
      <div className="filters"><label><span className="sr-only">Search enrichment products</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, item number, flavor or scent…"/></label><button disabled={busy} onClick={()=>run(refresh)}>Refresh list</button>{status!=='all'&&<button onClick={()=>setStatus('all')}>Show all products</button>}</div>
      {list.preparing&&<p className="prepare-status" role="status">Preparing saved products: {list.progress.prepared} of {list.progress.total}. You can review products already listed.</p>}
      {list.progress?.error&&<p className="alert error">{list.progress.error}</p>}
      <div className="table-scroll"><table><thead><tr><th>Club product</th><th>Pack & size suggestions</th><th>Flavor / scent</th><th>Review status</th><th>Action</th></tr></thead><tbody>{list.products.map(product=><tr key={product.productKey}><td><strong>{product.title}</strong><small>Item {product.itemNumber||'not supplied'} · {product.warehouses.map(w=>'#'+w).join(', ')}</small></td><td>{display(product.values.packCount)} {product.values.packUnit||'containers'}<small>{display(product.values.sizeValue)} {product.values.sizeUnit||''} · {display(product.values.sizeBasis)}</small></td><td>{display(product.values.flavor)}<small>Scent: {display(product.values.scent)}</small></td><td><span className={'badge enrichment-'+product.status}>{labels[product.status]}</span><small>{product.reviewIssues.length?product.reviewIssues.length+' checks remaining':'Required identity checks reviewed'}</small></td><td><button disabled={busy} onClick={()=>open(product.productKey)} aria-label={'Review '+product.title}>Review details →</button></td></tr>)}</tbody></table></div>
      {!list.products.length&&<div className="empty"><span aria-hidden="true">◇</span><h3>{list.counts.all?'No products match this filter':'Your Research products will appear here'}</h3><p>Scan Costco deals first. Local title extraction runs automatically for saved products.</p></div>}
      {list.total>50&&<div className="pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {Math.ceil(list.total/50)}</span><button disabled={page*50>=list.total} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
    </section><p className="coverage">Reviewed details are product identity information. Amazon matching, eligibility, profit analysis and human purchase approval remain separate steps.</p>
    {review&&active&&<div className="modal-backdrop enrichment-backdrop"><section ref={dialog} className="dialog enrichment-dialog" role="dialog" aria-modal="true" aria-labelledby="enrichment-review-title">
      <div className="dialog-top"><span className="eyebrow">PRODUCT DETAILS REVIEW · REVISION {profile.revision}</span><button ref={close} disabled={busy} onClick={closeReview} aria-label="Close enrichment review">Close ×</button></div>
      {discard&&<div className="alert error">You have unsaved edits. <button onClick={()=>{setDirty(false);setReview(null);setDiscard(false);}}>Discard edits and close</button><button onClick={()=>setDiscard(false)}>Keep editing</button></div>}
      <h2 id="enrichment-review-title">{profile.title}</h2><p>Brand: {profile.brand??'Not supplied'} · UPC: {profile.upc??'Not supplied'} · Item {profile.itemNumber||'not supplied'} · Warehouses {profile.warehouses.map(w=>'#'+w).join(', ')}</p>
      <div className="review-status-line"><span className={'badge enrichment-'+profile.status}>{labels[profile.status]}</span><span>Photo analysis: not connected</span><span>{dirty?'Unsaved changes':'Saved revision '+profile.revision}</span></div>
      {profile.sourceChanged&&<div className="alert error"><strong>Product evidence changed.</strong> Previous corrections are retained. Recheck the values against the new title or packaging evidence; they have not been automatically reconfirmed.</div>}
      {error&&<div className="alert error" role="alert">{error}<button disabled={busy} onClick={()=>run(async()=>applyReview(await api('enrichment/product?'+new URLSearchParams({productKey:profile.productKey}))))}>Discard edits and reload latest review</button></div>}
      {message&&<div className="alert success" role="status">{message}</div>}
      <details className="source-evidence" open={profile.sourceChanged||profile.conflicts.length>0}><summary>Original title, API facts and photo links</summary>{profile.sourceSnapshot.map((source,i)=><div className="source-record" key={i}><strong>{source.title}</strong><dl><dt>API pack count</dt><dd>{display(source.packCount)}</dd><dt>API package size</dt><dd>{display(source.packageSize)}</dd></dl>{source.imageUrl&&<a href={source.imageUrl} target="_blank" rel="noreferrer">Open API-provided photo ↗</a>}{source.productUrl&&<a href={source.productUrl} target="_blank" rel="noreferrer">Open product page ↗</a>}<details><summary>All saved identity source fields</summary><pre className="raw">{JSON.stringify(source,null,2)}</pre></details></div>)}</details>
      <div className="review-instructions"><p>Compare the evidence, correct the values, then mark each field Confirmed, Not applicable, or leave it Not reviewed. Unknowns are allowed and remain flagged.</p><button disabled={busy} onClick={()=>{setFields(current=>Object.fromEntries(Object.entries(current).map(([id,f])=>[id,{...f,reviewState:f.value!==null&&f.value!==''?'confirmed':f.reviewState}])));setDirty(true);}}>Mark populated values confirmed</button><small>This is your acceptance of the displayed values. Check inferred size basis and any conflicting source first.</small></div>
      <div className="review-fields">{definitions.map(definition=>{
        const field=fields[definition.id],suggestions=profile.candidates[definition.id]??[],conflict=profile.conflicts.some(c=>c.field===definition.id);
        if(!field)return null;
        return <div key={definition.id} className={'review-field '+(conflict?'field-conflict':'')}>
          <div><label htmlFor={'value-'+definition.id}>{definition.label}</label><small>{definition.help}</small></div>
          <div className="field-evidence"><span className="field-column-label">{conflict?'Conflicting evidence':'Source suggestion'}</span>{suggestions.length?suggestions.map((candidate,i)=><div key={i}><strong>{display(candidate.value)}</strong> <span className="tag">{candidate.origin==='api'?'API':'Title'}</span><details><summary>Evidence</summary>{candidate.evidence.map((e,j)=><p key={j}>{e.source==='api'?e.field+': '+display(e.value):e.details?.map(d=>d.matchedText).join(' · ')||e.matchedText||e.text}{e.inferred&&<em> · Basis inferred from title layout; check manually.</em>}</p>)}</details></div>):<small>Not supplied or not safely extracted.</small>}</div>
          <div className="field-input"><label className="field-column-label" htmlFor={'value-'+definition.id}>Your value</label>{definition.type==='choice'?<select id={'value-'+definition.id} value={field.value??''} disabled={busy} onChange={e=>change(definition.id,{value:e.target.value,reviewState:'unreviewed'})}><option value="">Unknown</option>{definition.options.map(value=><option key={value} value={value}>{display(value)}</option>)}</select>:<input id={'value-'+definition.id} type={['count','number'].includes(definition.type)?'number':'text'} min={['count','number'].includes(definition.type)?'0.000001':undefined} step={definition.type==='count'?'1':definition.type==='number'?'any':undefined} maxLength={500} value={field.value??''} disabled={busy} onChange={e=>change(definition.id,{value:e.target.value,reviewState:'unreviewed'})} placeholder="Unknown"/>}</div>
          <div className="field-state"><label className="field-column-label" htmlFor={'state-'+definition.id}>Review state</label><select id={'state-'+definition.id} value={field.reviewState} disabled={busy} onChange={e=>change(definition.id,{reviewState:e.target.value,...(e.target.value==='not_applicable'?{value:''}:{})})}>{Object.entries(stateLabels).map(([value,label])=><option key={value} value={value} disabled={value==='needs_recheck'}>{label}</option>)}</select><small>{profile.fields[definition.id].origin==='reviewer'?'Human correction retained':profile.fields[definition.id].origin==='api'?'API value retained':profile.fields[definition.id].origin==='title'?'Title suggestion':'Unknown / conflicting'}</small></div>
        </div>;
      })}</div>
      {(profile.extractionIssues.length>0||profile.reviewIssues.length>0)&&<details className="review-issues"><summary>Extraction warnings and remaining checks</summary><ul>{[...new Set([...profile.extractionIssues,...profile.reviewIssues])].map((issue,i)=><li key={i}>{issue}</li>)}</ul><p>Warnings describe the saved evidence. Reviewed corrections are preserved separately.</p></details>}
      <div className="review-footer"><label htmlFor="reviewer-name">Reviewed by<input id="reviewer-name" value={actor} maxLength={100} disabled={busy} onChange={e=>{setActor(e.target.value);setDirty(true);}}/></label><small>A label for this local review history; this build does not authenticate individual users.</small><label htmlFor="review-note">Review note<textarea id="review-note" value={note} maxLength={2000} disabled={busy} onChange={e=>{setNote(e.target.value);setDirty(true);}} placeholder="Explain a correction or how you resolved conflicting evidence…"/></label><div className="review-buttons"><button disabled={busy} onClick={()=>save('save_draft')}>Save draft</button><button className="primary" disabled={busy} onClick={()=>save('confirm')}>Confirm reviewed fields</button></div><p>Confirmation saves your identity review. Missing details stay flagged. It does not approve buying or trigger Amazon searches.</p></div>
      <details className="review-history"><summary>Revision history · {review.history.length} entries</summary>{review.history.slice(0,showHistory).map(entry=><article key={entry.revision}><strong>Revision {entry.revision} · {display(entry.action)}</strong><p>{entry.body.actor} · {date(entry.created_at)}</p><details><summary>View saved values and evidence</summary><pre className="raw">{JSON.stringify(entry.body.identity,null,2)}</pre></details></article>)}{review.history.length>showHistory&&<button onClick={()=>setShowHistory(n=>n+20)}>Show earlier revisions</button>}</details>
    </section></div>}
  </div>;
}
