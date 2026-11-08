import {validateGtin} from './identifiers.mjs';
const known=v=>v!==null&&v!==undefined&&v!=='';
const norm=v=>String(v??'').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const value=(fields,key)=>fields?.[key]?.reviewState==='confirmed'?fields[key].value:null;
const reviewed=f=>f&&['confirmed','not_applicable'].includes(f.reviewState);
const available=upc=>upc?.status==='verified'&&upc.scope==='club_package'&&validateGtin(upc.value).valid;

export function exactMatch(profile,sourceUpc,candidate){
  const reasons=[],warnings=[];
  const outcome=(route,method=null)=>({route,method,reasons,warnings,purchaseApproved:false,secondaryEngine:false});
  if(!candidate.detailsReviewed){reasons.push('Amazon package details have not been reviewed.');return outcome('needs_information');}
  if(profile.sourceChanged){reasons.push('Club identity changed. Recheck Enrichment before matching.');return outcome('needs_information');}
  if(!profile.lastReviewedAt){reasons.push('Review the club product in Enrichment first.');return outcome('needs_information');}
  const sourceBarcode=available(sourceUpc)&&sourceUpc.sourceSignature===profile.sourceSignature?validateGtin(sourceUpc.value):null;
  const amazonBarcode=candidate.upcVerified&&candidate.upcScope==='amazon_package'?validateGtin(candidate.upc):null;
  const matchingBarcode=sourceBarcode?.valid&&amazonBarcode?.valid&&sourceBarcode.gtin14===amazonBarcode.gtin14;
  if(sourceUpc?.status==='verified'&&!sourceBarcode)warnings.push('Club UPC verification is for an inner unit or older source evidence; it is not verified for this club package.');
  const left=profile.fields,right=candidate.fields;
  if(!known(value(left,'packCount'))||!known(value(right,'packCount'))){reasons.push('Confirm the package count on both sides.');return outcome('needs_information');}
  if(!known(profile.brand)||!known(candidate.brand)){reasons.push('Brand is missing on one side.');return outcome('needs_information');}
  if(norm(profile.brand)!==norm(candidate.brand)){reasons.push('Brand differs.');return outcome('mismatch');}
  const mismatches=[],missing=[];
  function compare(key,label,{generic=false}={}){
    const l=left?.[key],r=right?.[key];
    if(!reviewed(l)||!reviewed(r)){missing.push(label+' needs reviewed values on both sides.');return;}
    if(l.reviewState==='not_applicable'&&r.reviewState==='not_applicable')return;
    if(l.reviewState!==r.reviewState){mismatches.push(label+' applies differently.');return;}
    if(!known(l.value)||!known(r.value)){missing.push(label+' is unknown.');return;}
    if(generic&&(norm(l.value)==='items'||norm(r.value)==='items'))return;
    if(norm(l.value)!==norm(r.value))mismatches.push(label+' differs ('+l.value+' vs '+r.value+').');
  }
  compare('packCount','Pack count');compare('packUnit','Container type',{generic:true});
  const packDifference=mismatches.filter(r=>r.startsWith('Pack count'));
  mismatches.splice(0,mismatches.length,...mismatches.filter(r=>!r.startsWith('Pack count')));
  for(const [key,label]of [['sizeValue','Size amount'],['sizeUnit','Size unit'],['sizeBasis','Size basis'],['innerCount','Contents per container'],['innerUnit','Inner contents unit'],['contentsCount','Total contents'],['contentsUnit','Total contents unit'],['flavor','Flavor'],['scent','Scent'],['variant','Formulation'],['strength','Strength'],['isVariety','Variety-pack status']])compare(key,label);
  compare('productType','Product type / form');
  const leftSize=value(left,'sizeValue'),rightSize=value(right,'sizeValue');
  const hasSizedPackage=known(leftSize)&&known(rightSize)&&value(left,'sizeBasis')!=='unspecified'&&value(right,'sizeBasis')!=='unspecified';
  const hasCountedPackage=known(value(left,'contentsCount'))&&known(value(right,'contentsCount'))||known(value(left,'innerCount'))&&known(value(right,'innerCount'));
  if(!hasSizedPackage&&!hasCountedPackage)missing.push('Confirm a per-unit/total size basis or an explicit contents count.');
  if(mismatches.length){reasons.push(...mismatches);return outcome('mismatch');}
  if(packDifference.length){reasons.push(...packDifference,...missing);return outcome('potential');}
  const suppliedSource=sourceUpc?.sourceSignature===profile.sourceSignature&&sourceUpc.scope==='club_package'?validateGtin(sourceUpc.value):null;
  const suppliedAmazon=candidate.upcScope==='amazon_package'?validateGtin(candidate.upc):null;
  if(suppliedSource?.valid&&suppliedAmazon?.valid&&suppliedSource.gtin14!==suppliedAmazon.gtin14){reasons.push('Supplied package UPC/GTIN values differ; resolve the identifier evidence.');return outcome('potential');}
  if(missing.length){reasons.push(...missing);return outcome('needs_information');}
  if(matchingBarcode){reasons.push('Reviewed package details and verified package UPC/GTIN agree.');return outcome('exact','verified_upc');}
  compare('productName','Product name');
  if(mismatches.length){reasons.push(...mismatches);return outcome('potential');}
  if(missing.length){reasons.push(...missing);return outcome('needs_information');}
  warnings.push('UPC unverified. This is a strict reviewed-details match, not a verified barcode match.');
  reasons.push('All reviewed identity and package fields agree exactly.');
  return outcome('exact','reviewed_details_upc_unverified');
}
