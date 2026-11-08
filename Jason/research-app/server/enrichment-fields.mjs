import {createHash} from 'node:crypto';
import {parseProductTitle,TITLE_PARSER_VERSION} from './title-parser.mjs';
import {nonnegativeNumber} from './errors.mjs';

export const extractionVersion='title-review-1.0.0/'+TITLE_PARSER_VERSION;
export const fieldDefinitions=[
  {id:'productName',label:'Product name',type:'text',help:'The product itself; brand is kept from the API.'},
  {id:'productType',label:'Product type / form',type:'text',help:'For example protein shake, detergent, capsule or wipe.'},
  {id:'packCount',label:'Containers in one club package',type:'count',help:'One club 10-pack contains 10 bottles; it is one purchased club unit.'},
  {id:'packUnit',label:'Container type',type:'text',help:'Bottles, cans, pouches, bars or items. Keep unknown if unclear.'},
  {id:'innerCount',label:'Contents per container',type:'count',help:'Only when explicitly per bottle, pouch or other inner container.'},
  {id:'innerUnit',label:'Contents unit',type:'text',help:'For example tablets, capsules or wipes per container.'},
  {id:'contentsCount',label:'Total contents in club package',type:'count',help:'An explicit total count; do not guess from ambiguous title wording.'},
  {id:'contentsUnit',label:'Total contents unit',type:'text',help:'For example wipes, capsules or tablets.'},
  {id:'sizeValue',label:'Size amount',type:'number',help:'Keep the amount separate from its unit and basis.'},
  {id:'sizeUnit',label:'Size unit',type:'choice',options:['fl oz','oz','lb','g','kg','mL','L'],help:'Fluid ounces and weight ounces are different.'},
  {id:'sizeBasis',label:'Size applies to',type:'choice',options:['per_unit','total_package','unspecified'],help:'Review any inferred per-unit size. Never multiply it into the saved individual size.'},
  {id:'flavor',label:'Flavor',type:'text',help:'Leave unknown or explicitly mark not applicable.'},
  {id:'scent',label:'Scent / fragrance',type:'text',help:'Use the wording on the product, including unscented when stated.'},
  {id:'variant',label:'Variant / formulation',type:'text',help:'For example Sensitive Skin or Original; not automatically a scent.'},
  {id:'strength',label:'Strength',type:'text',help:'For example 500 mg; do not treat a dosage as package weight.'},
  {id:'isVariety',label:'Mixed / variety pack',type:'choice',options:['yes','no'],help:'A flavor name such as Rainbow alone is not a variety pack.'}
];
const blank=()=>Object.fromEntries(fieldDefinitions.map(f=>[f.id,{value:null,reviewState:'unreviewed',origin:'unknown',evidence:[]}]));
const equal=(a,b)=>String(a??'').trim().toLocaleLowerCase()===String(b??'').trim().toLocaleLowerCase();
const known=v=>v!==undefined&&v!==null&&v!=='';
const keyFor=x=>JSON.stringify(x);

export function identitySources(offers){
  const rows=offers.map(o=>{
    const r=o.sourceData?.item??{};
    return {title:o.title,brand:o.brand??null,upc:o.upc??null,packCount:o.packCount??null,packageSize:o.packageSize??null,imageUrl:o.imageUrl??null,productUrl:o.productUrl??null,
      api:Object.fromEntries(['product_name','pack_count','pack_unit','inner_count','inner_unit','contents_count','contents_unit','size_value','size_unit','size_basis','flavor','scent','variant','strength','product_type','is_variety','package_size','size'].filter(k=>known(r[k])).map(k=>[k,r[k]]))};
  });
  return [...new Map(rows.map(r=>[keyFor(r),r])).values()].sort((a,b)=>keyFor(a).localeCompare(keyFor(b)));
}
export const sourceSignature=offers=>createHash('sha256').update(JSON.stringify(identitySources(offers))).digest('hex');

export function extractDetails(offers){
  const fields=blank(),candidates=Object.fromEntries(fieldDefinitions.map(f=>[f.id,[]])),issues=[];
  function add(field,value,evidence,origin){
    if(!known(value))return;
    const definition=fieldDefinitions.find(f=>f.id===field);
    if(['number','count'].includes(definition.type)){
      value=nonnegativeNumber(value);
      if(value===null||value<=0||definition.type==='count'&&!Number.isSafeInteger(value)){issues.push(definition.label+' has an invalid provider value.');return;}
    } else if(definition.type==='choice'&&!definition.options.includes(value)){issues.push(definition.label+' has an unsupported value.');return;}
    else if(typeof value!=='string'||value.length>500){issues.push(definition.label+' is not a supported text value.');return;}
    const old=candidates[field].find(c=>equal(c.value,value));
    if(old){old.evidence.push(evidence);if(origin==='api')old.origin='api';}else candidates[field].push({value,origin,evidence:[evidence]});
  }
  for(const source of identitySources(offers)){
    const parsed=parseProductTitle(source.title);
    const evidence=(field,kind='title')=>({source:kind,text:source.title,details:parsed.evidence.filter(e=>e.field===field),inferred:field==='sizeBasis'});
    const map={packCount:'packCount',packUnit:'packUnit',innerCount:'innerCount',innerUnit:'innerUnit',contentsCount:'contentsCount',contentsUnit:'contentsUnit',sizeValue:'sizeValue',sizeUnit:'sizeUnit',flavor:'flavor',scent:'scent',variant:'variant'};
    for(const [field,key]of Object.entries(map)){
      if(field==='contentsCount'&&Number(source.packCount)>1&&parsed.packCount===null&&!/\btotal\b/i.test(source.title)){
        if(parsed.contentsCount!==null)issues.push('The API lists multiple containers but the title contents count has no explicit total or per-container basis.');
        continue;
      }
      if(field==='contentsUnit'&&Number(source.packCount)>1&&parsed.packCount===null&&!/\btotal\b/i.test(source.title))continue;
      add(field,parsed[key],evidence(field==='sizeValue'||field==='sizeUnit'?'size':field),'title');
    }
    if(parsed.sizeValue!==null)add('sizeBasis',parsed.sizeBasis?.startsWith('Per unit')?'per_unit':parsed.sizeBasis?.startsWith('Total')?'total_package':'unspecified',{...evidence('size'),inferred:!parsed.sizeBasis?.startsWith('Total')},'title');
    if(parsed.strengths.length===1)add('strength',parsed.strengths[0],evidence('strengths'),'title');
    else if(parsed.strengths.length>1)issues.push('Multiple strengths are present; confirm the formulation.');
    if(parsed.isVariety)add('isVariety','yes',evidence('isVariety'),'title');
    const raw=source.api;
    const apiMap={product_name:'productName',product_type:'productType',pack_count:'packCount',pack_unit:'packUnit',inner_count:'innerCount',inner_unit:'innerUnit',contents_count:'contentsCount',contents_unit:'contentsUnit',size_value:'sizeValue',size_unit:'sizeUnit',size_basis:'sizeBasis',flavor:'flavor',scent:'scent',variant:'variant',strength:'strength'};
    const apiValues={...raw,pack_count:raw.pack_count??source.packCount};
    for(const [key,field]of Object.entries(apiMap))add(field,apiValues[key],{source:'api',field:key,value:apiValues[key],title:source.title},'api');
    if(typeof raw.is_variety==='boolean')add('isVariety',raw.is_variety?'yes':'no',{source:'api',field:'is_variety',value:raw.is_variety},'api');
    // A size string without its basis is retained as evidence, never assumed per unit.
    const sizeText=raw.package_size??raw.size??source.packageSize;
    if(typeof sizeText==='string'){
      const size=parseProductTitle(sizeText);
      add('sizeValue',size.sizeValue,{source:'api',field:'package_size',value:sizeText},'api');
      add('sizeUnit',size.sizeUnit,{source:'api',field:'package_size',value:sizeText},'api');
    }
    let name=source.title??'';
    if(typeof source.brand==='string'&&name.toLocaleLowerCase().startsWith(source.brand.toLocaleLowerCase()))name=name.slice(source.brand.length).replace(/^[\s,;:-]+/,'');
    // Remove only exact matched identity phrases. Keep other words rather than invent a new name.
    const removable=parsed.evidence.filter(e=>['packCount','size','flavor','scent','strengths','innerCount','contentsCount'].includes(e.field)).map(e=>e.matchedText);
    for(const text of removable)name=name.replace(text,' ');
    name=name.replace(/[,;]+/g,' ').replace(/\s+/g,' ').replace(/^[\s-]+|[\s-]+$/g,'').trim();
    if(name)add('productName',name,{source:'title',text:source.title,rule:'remove provided brand and explicit title details'},'title');
    const form=/\b(protein\s+shakes?|laundry\s+detergent|sparkling\s+water|mouthwash|toothpaste|shampoo|conditioner|wipes|capsules?|tablets?|softgels?|gummies|drinks?|powder|bars?)\b/i.exec(source.title??'');
    if(form)add('productType',form[0],{source:'title',text:source.title,matchedText:form[0]},'title');
    issues.push(...parsed.reviewReasons);
  }
  const conflicts=[];
  for(const [id,list]of Object.entries(candidates)){
    const preferred=list.find(c=>c.origin==='api')??list[0];
    if(preferred)fields[id]={...fields[id],...preferred};
    if(list.length>1){
      conflicts.push({field:id,candidates:list});
      // Conflicting quantities must stay unknown until explicitly resolved.
      fields[id]={...fields[id],value:null,origin:'conflict',evidence:list.flatMap(c=>c.evidence)};
    }
  }
  return {version:extractionVersion,fields,candidates,conflicts,issues:[...new Set(issues)],photoAnalysis:'not_connected'};
}

export function reviewIssues(fields){
  const issues=[];
  const confirmed=id=>fields[id].reviewState==='confirmed'&&known(fields[id].value);
  if(!confirmed('productName'))issues.push('Product name is not confirmed.');
  if(!confirmed('packCount'))issues.push('Containers per club package are not confirmed.');
  if(!confirmed('packUnit'))issues.push('Container type is not confirmed.');
  const sizeReady=confirmed('sizeValue')&&confirmed('sizeUnit')&&confirmed('sizeBasis')&&fields.sizeBasis.value!=='unspecified';
  const contentsReady=confirmed('contentsCount')&&confirmed('contentsUnit');
  const innerReady=confirmed('innerCount')&&confirmed('innerUnit');
  if(!sizeReady&&!contentsReady&&!innerReady)issues.push('Confirm individual size and its basis, or an explicit contents count.');
  for(const definition of fieldDefinitions){
    const field=fields[definition.id];
    if(known(field.value)&&field.reviewState!=='confirmed')issues.push(definition.label+' contains an unconfirmed value.');
  }
  if(known(fields.sizeValue.value)&&(!confirmed('sizeBasis')||fields.sizeBasis.value==='unspecified'))issues.push('The stated size still needs an explicit per-unit or total-package basis.');
  for(const id of ['flavor','scent','variant','strength','isVariety']){
    if(!['confirmed','not_applicable'].includes(fields[id].reviewState))issues.push(fieldDefinitions.find(f=>f.id===id).label+' has not been reviewed.');
  }
  for(const [count,unit]of [['innerCount','innerUnit'],['contentsCount','contentsUnit'],['sizeValue','sizeUnit']]){
    if(known(fields[count].value)!==known(fields[unit].value))issues.push('Keep '+fieldDefinitions.find(f=>f.id===count).label+' and its unit together.');
  }
  return issues;
}
