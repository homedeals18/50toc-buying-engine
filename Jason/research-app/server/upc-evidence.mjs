import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {evidenceUrl,validateGtin} from './identifiers.mjs';
import {extractDetails} from './enrichment-fields.mjs';

const words=s=>String(s??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
const clip=(v,n=1000)=>typeof v==='string'?v.slice(0,n):'';
export function publicEvidenceUrl(value){
  const safe=evidenceUrl(value);if(!safe)return null;
  const u=new URL(safe),host=u.hostname.toLowerCase();
  if([...u.searchParams.keys()].some(k=>/key|token|auth|secret|password|signature|credential/i.test(k)))return null;
  if(u.port||isIP(host)||host.includes(':')||!host.includes('.')||/\.(?:local|localhost|internal|test|invalid|lan|home|arpa|onion)$/.test(host)||host.endsWith('.localdomain')||host.endsWith('.nip.io')||host.endsWith('.sslip.io')||/^\d/.test(host))return null;
  return u.href;
}
export function sameRetailerItem(product,source){
  const pairs=[[product.product_id??product.productId,source.productId],[product.item_number??product.itemNumber,source.itemNumber]];
  let matched=false;
  for(const [actual,expected]of pairs){
    if(actual==null||!expected)continue;
    if(String(actual)!==String(expected))return false;
    matched=true;
  }
  return matched;
}
export function queryFor(profile){
  // Only public product identity is sent. No warehouse, price, note or key enters a query.
  const title=words(profile.title).join(' ').slice(0,350),brand=words(profile.brand).join(' ');
  return (title.includes(brand)?title:brand+' '+title).trim().slice(0,450)+' (UPC OR GTIN OR barcode)';
}
export function labelledBarcodes(content){
  const result=[];
  const re=/\b(?:upc(?:-a)?|gtin(?:-?(?:8|12|13|14))?|ean(?:-?13)?|barcode)(?:\s+code)?\b[ \t*_:#|=\-]*(?:\r?\n[ \t*|:\-]*){0,2}["']?(\d{6,18})(?!\d)/gi;
  for(const m of String(content??'').matchAll(re))result.push({raw:m[1],path:'labelled text at '+m.index,excerpt:clip(content.slice(Math.max(0,m.index-90),m.index+m[0].length+90),300)});
  return result;
}
function assessment(profile,title,url){
  const flags=['Confirm the barcode against the exact full club package.'];
  const sourceHosts=profile.sourceSnapshot.map(s=>s.productUrl).filter(Boolean).map(s=>{try{return new URL(s).hostname.replace(/^www\./,'');}catch{return '';}});
  const host=url?new URL(url).hostname.replace(/^www\./,''):'';
  if(url&&!sourceHosts.includes(host))flags.push('Another website: this is a lead, not proof of the Costco package.');
  const sourceWords=words(profile.title),found=new Set(words(title));
  const overlap=sourceWords.length?sourceWords.filter(w=>found.has(w)).length/sourceWords.length:0;
  if(overlap<0.6)flags.push('Product name differs or is incomplete.');
  if(words(profile.brand).some(w=>!found.has(w)))flags.push('Brand is not fully confirmed by the page title.');
  const extracted=extractDetails([{title,sourceData:{item:{}}}]).fields;
  for(const [id,label]of [['packCount','Pack count'],['contentsCount','Contents count'],['sizeValue','Size'],['sizeUnit','Size unit'],['flavor','Flavor'],['scent','Scent'],['strength','Strength'],['isVariety','Variety']]){
    const a=profile.fields?.[id]?.value,b=extracted[id]?.value;
    if(a!==null&&a!==undefined&&a!==''&&b!==null&&b!==undefined&&b!==''&&String(a).toLowerCase()!==String(b).toLowerCase())flags.push(label+' differs from the saved club item.');
  }
  return {flags,overlap};
}
export function makeEvidence(profile,candidate,{source,sourceUrl=null,title=profile.title,observedAt,cached=false,kind='api_field'}){
  const a=assessment(profile,title,sourceUrl),validation=validateGtin(candidate.raw);
  if(!validation.valid)a.flags.unshift(validation.reason);
  if(kind==='search_snippet')a.flags.push('Search snippet only; the page may be stale or refer to another package.');
  if(kind==='page_text')a.flags.push('Page text may include other variants or related products.');
  const raw=typeof candidate.raw==='string'||typeof candidate.raw==='number'?candidate.raw:'Unsupported identifier';
  const evidence={raw,...validation,source,sourceUrl,title:clip(title),path:clip(candidate.path),excerpt:clip(candidate.excerpt??'',300),observedAt,cached,kind,
    scope:'unknown',verified:false,reviewRequired:true,flags:a.flags};
  evidence.id=createHash('sha256').update(JSON.stringify([profile.sourceSignature,sourceUrl,source,raw,evidence.path,evidence.excerpt])).digest('hex');
  return evidence;
}
export function searchResults(payload,profile){
  const root=payload.data??payload;
  if(root.items!==undefined&&!Array.isArray(root.items))throw Error('Invalid search items');
  // An empty documented Custom Search result omits items but includes searchInformation.
  if(!Array.isArray(root.items)&&!root.searchInformation)throw Error('Missing search result envelope');
  const seen=new Set();
  return (root.items??[]).flatMap(item=>{
    const url=publicEvidenceUrl(item?.link);if(!url||seen.has(url))return [];seen.add(url);
    const title=clip(item.title),snippet=clip(item.snippet,3000),a=assessment(profile,title,url);
    const host=new URL(url).hostname;
    const retailer=/^(?:www\.)?(?:costco\.com|bjs\.com|samsclub\.com|walmart\.com|target\.com|kroger\.com)$/.test(host);
    return [{url,title,snippet,rank:a.overlap+(retailer?0.2:0),flags:a.flags}];
  }).sort((a,b)=>b.rank-a.rank);
}
export function summarizeEvidence(evidence){
  const valid=[...new Set(evidence.filter(e=>e.valid).map(e=>e.gtin14))];
  return {validIdentifiers:valid.length,conflictingIdentifiers:valid.length>1,reviewRequired:!!evidence.length,
    status:valid.length>1?'conflicting_upcs':valid.length?'needs_confirmation':evidence.length?'invalid_identifiers':'not_found'};
}
