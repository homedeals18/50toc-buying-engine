// Local title interpretation only. Provider fields and the original title stay intact.
export const TITLE_PARSER_VERSION = '1.2.0';
const NUM = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const amount = text => Number(text.replaceAll(',', ''));
const unique = list => [...new Set(list)];
const unitName = text => {
 const u=text.toLowerCase().replace(/[.\s]/g,'');
 if(/^(?:fl(?:uid)?oz|fluidounces?)$/.test(u))return 'fl oz';
 if(/^(?:oz|ounces?)$/.test(u))return 'oz';
 if(/^(?:lb|lbs|pounds?)$/.test(u))return 'lb';
 if(/^(?:kg|kilograms?)$/.test(u))return 'kg';
 if(/^(?:ml|millilit(?:er|re)s?)$/.test(u))return 'mL';
 if(/^(?:l|lit(?:er|re)s?)$/.test(u))return 'L';
 if(/^(?:g|grams?)$/.test(u))return 'g';
 if(/^(?:mg|milligrams?)$/.test(u))return 'mg';
 if(/^(?:mcg|[µμ]g|micrograms?)$/.test(u))return 'mcg';
 return text;
};
const plural = text => ({box:'boxes',pouch:'pouches',bottle:'bottles',tube:'tubes',jar:'jars',bar:'bars',can:'cans',roll:'rolls',razor:'razors',cartridge:'cartridges',tablet:'tablets',softgel:'softgels',capsule:'capsules',wipe:'wipes',serving:'servings'})[text.toLowerCase()]??text.toLowerCase();

export function parseProductTitle(input) {
 const title=typeof input==='string'?input:'';
 const out={parserVersion:TITLE_PARSER_VERSION,source:'product_title',packCount:null,packUnit:null,contentsCount:null,contentsUnit:null,innerCount:null,innerUnit:null,sizeValue:null,sizeUnit:null,sizeBasis:null,flavor:null,scent:null,variant:null,strengths:[],nutritionClaims:[],isVariety:false,evidence:[],reviewReasons:[]};
 const evidence=(field,value,match,rule='explicit_title')=>out.evidence.push({field,value,matchedText:match[0],start:match.index,end:match.index+match[0].length,rule});
 if(title.length>10000){out.reviewReasons.push('Title is too long for automatic parsing.');return finish(out);}
 const sizes=[];
 const measures=new RegExp(`\\b(${NUM})\\s*(fl\\.?\\s*oz\\.?|fluid\\s+ounces?|milligrams?|micrograms?|kilograms?|millilit(?:er|re)s?|lit(?:er|re)s?|pounds?|ounces?|grams?|mcg|[µμ]g|mg|kg|ml|lbs?\\.?|oz\\.?|g|l)\\b`,'gi');
 for(const m of title.matchAll(measures)){
  const value=amount(m[1]),unit=unitName(m[2]),before=title.slice(Math.max(0,m.index-35),m.index),after=title.slice(m.index+m[0].length);
  if(/\d\s*[-–]\s*$/.test(before)){out.reviewReasons.push('A size/strength range is stated; a single value was not assumed.');continue;}
  if(unit==='mg'||unit==='mcg'){
   const text=value+' '+unit;out.strengths.push(text);evidence('strengths',text,m);continue;
  }
  if(unit==='g'&&(/^\s*(?:of\s+)?(?:protein|fiber|fibre|sugar|carbohydrates?|carbs?)\b/i.test(after)||/\b(?:protein|fiber|fibre|sugar)\s*[:=]?\s*$/i.test(before))){
   out.nutritionClaims.push(m[0]+(/^\s*(?:of\s+)?protein\b/i.test(after)?' protein':''));evidence('nutritionClaims',out.nutritionClaims.at(-1),m,'nutrition_context');continue;
  }
  sizes.push({value,unit,match:m,total:/^\s*(?:total|combined)\b/i.test(after)||/\btotal\s*[:=]?\s*$/i.test(before)});
 }
 const distinctSizes=[...new Map(sizes.map(s=>[s.value+'|'+s.unit,s])).values()];
 if(distinctSizes.length===1){const s=distinctSizes[0];out.sizeValue=s.value;out.sizeUnit=s.unit;if(s.total)out.sizeBasis='Total contents — explicitly stated';evidence('size',s.value+' '+s.unit,s.match);}
 else if(distinctSizes.length>1){out.reviewReasons.push('Multiple sizes are stated; no single package size was selected.');for(const s of distinctSizes)evidence('sizeCandidate',s.value+' '+s.unit,s.match);}

 const packs=[];
 const countForm=/\b(tablets?|capsules?|softgels?|gummies|wipes|servings?|napkins?)\b/i.exec(title);
 const listedContents=[];
 for(const m of title.matchAll(new RegExp(`\\b(${NUM})\\s*[- ]?\\s*(packs?|count|ct)\\b`,'gi'))){
  if(!/^pack/i.test(m[2])&&countForm)listedContents.push({value:amount(m[1]),unit:plural(countForm[1]),perContainer:false,total:/\btotal\b/i.test(title),match:m});
  else packs.push({value:amount(m[1]),unit:'items',match:m});
 }
 for(const m of title.matchAll(new RegExp(`\\b(${NUM})\\s*[x×]\\s*(?=${NUM}\\s*(?:fl|oz|g\\b|lb|ml|l\\b))`,'gi')))packs.push({value:amount(m[1]),unit:'items',match:m});
 for(const m of title.matchAll(new RegExp(`\\b(${NUM})\\s+(boxes|box|pouches|pouch|bottles?|tubes?|jars?|bars|cans?|rolls?|razors?|cartridges?)\\b`,'gi')))packs.push({value:amount(m[1]),unit:plural(m[2]),match:m});
 const validPacks=packs.filter(p=>Number.isSafeInteger(p.value)&&p.value>0);
 if(validPacks.length){
  if(unique(validPacks.map(p=>p.value)).length>1){out.reviewReasons.push('More than one pack/container count is stated; count needs review.');for(const p of validPacks)evidence('packCandidate',p.value+' '+p.unit,p.match);}
  else {const p=validPacks.find(p=>p.unit!=='items')??validPacks[0];out.packCount=p.value;out.packUnit=p.unit;evidence('packCount',p.value+' '+p.unit,p.match);}
 }
 const contents=[...listedContents];
 for(const m of title.matchAll(new RegExp(`\\b(${NUM})\\s+(?:(?:effervescent|chewable)\\s+)?(tablets?|softgels?|capsules?|gummies|wipes|servings?)(?:\\s+per\\s+(box|pouch|bottle|container))?\\b`,'gi'))){
  const count=amount(m[1]);if(Number.isSafeInteger(count)&&count>0)contents.push({value:count,unit:plural(m[2]),perContainer:!!m[3],total:/^\s*total\b/i.test(title.slice(m.index+m[0].length)),match:m});
 }
 if(contents.length===1){
  const c=contents[0];
  if(c.perContainer){out.innerCount=c.value;out.innerUnit=c.unit;evidence('innerCount',c.value+' '+c.unit,c.match);}
  else if(c.total||out.packCount===null||out.packCount===1){out.contentsCount=c.value;out.contentsUnit=c.unit;evidence('contentsCount',c.value+' '+c.unit,c.match);}
  else {out.reviewReasons.push('A contents count and multiple containers are stated without saying whether the count is per container or total.');evidence('contentsCandidate',c.value+' '+c.unit,c.match);}
  if(c.unit==='servings')out.reviewReasons.push('The title gives servings, not the number of tablets/capsules per serving.');
 }else if(contents.length>1){out.reviewReasons.push('Multiple contents counts are stated; contents count needs review.');for(const c of contents)evidence('contentsCandidate',c.value+' '+c.unit,c.match);}
 if(out.sizeValue!==null&&!out.sizeBasis)out.sizeBasis=out.packCount!==null?'Per unit — inferred from title layout':'Listed size — unit count not stated';

 const variety=/\b(?:variety\s+pack|assorted|mixed\s+(?:flavou?rs?|pack)|sampler)\b/i.exec(title);
 if(variety){out.isVariety=true;evidence('isVariety',true,variety);out.reviewReasons.push('Variety/mixed pack: individual flavors and their counts need verification.');}
 const foodContext=/\b(?:protein|shakes?|powder|nutrition|collagen|creatine|whey|energy\s+bar|snack|drink)\b/i.test(title);
 const oralContext=/\b(?:mouthwash|toothpaste|lip\s+balm)\b/i.test(title);
 const explicitFlavor=/\b([^,;]+?)\s+flavou?r\b/i.exec(title);
 const flavors=[];
 const namedFlavor=/\b(?:Creamy Chocolate Fudge|Strawberry Creme|Chocolate Mint|French Vanilla|Vanilla Bean|Triple Chocolate|Unflavou?red|Cool\s?mint|Chocolate|Vanilla|Strawberry|Munchies)\b/gi;
 for(const m of title.matchAll(namedFlavor))if(foodContext||(oralContext&&/mint/i.test(m[0]))){flavors.push(m[0]);evidence('flavor',m[0],m,'named_variant_in_product_context');}
 const originalFlavor=/\bOriginal\s+Flavou?r\b/i.exec(title);
 if(originalFlavor){flavors.push('Original');evidence('flavor','Original',originalFlavor);}
 const labeledFlavor=/(?:,\s*|\bflavou?r\s*:\s*)([a-z][a-z &'’+-]{1,50}?)\s+flavou?r\b(?=\s*(?:,|$))/i.exec(title);
 const prefixFlavor=/\bflavou?r\s*:\s*([a-z][a-z &'’+-]{1,50})(?=\s*(?:,|$))/i.exec(title);
 if(!flavors.length&&(labeledFlavor||prefixFlavor)){const m=labeledFlavor??prefixFlavor;flavors.push(m[1].trim());evidence('flavor',m[1].trim(),m);}
 // Unknown words near a comma are not automatically flavor or scent.
 if(!flavors.length&&explicitFlavor&&!originalFlavor)out.reviewReasons.push('A flavor phrase was found but needs a supported flavor rule.');
 out.flavor=flavors.length?unique(flavors).join('; '):null;
 if(unique(flavors).length>1&&!out.isVariety)out.reviewReasons.push('Multiple flavor names are present; verify whether this is a mixed pack.');
 const freeScent=/\b(?:fragrance[- ]free|unscented|scent[- ]free)\b/i.exec(title);
 const namedScent=/\b(?:lavender|fresh linen|lemon|citrus|ocean breeze|rose|original)\s+scent(?:ed)?\b/i.exec(title);
 const labeledScent=/(?:,\s*)([a-z][a-z &'’+-]{1,50}?)\s+(?:scent|fragrance)\b(?=\s*(?:,|$))/i.exec(title);
 const scent=freeScent??namedScent??labeledScent;
 if(scent){out.scent=scent===labeledScent?scent[0].replace(/^,\s*/,''):scent[0];evidence('scent',out.scent,scent);}
 const variant=/\b(?:Dry to Normal Sensitive Skin|Sensitive Skin|Black\s*&\s*White|Deep Moisture|Ultra Strength|Triple Strength|Original)\b/i.exec(title);
 if(variant&&!(out.flavor==='Original'&&originalFlavor)){out.variant=variant[0];evidence('variant',out.variant,variant,'named_variant_not_assumed_to_be_scent');}
 return finish(out);
}
function finish(out){out.strengths=unique(out.strengths);out.nutritionClaims=unique(out.nutritionClaims);out.reviewReasons=unique(out.reviewReasons);out.status=out.reviewReasons.length?'Review needed':out.evidence.length?'Parsed from title':'No supported details';return out;}

export function withTitleAttributes(offer){
 if(!offer)return offer;
 const titleAttributes=parseProductTitle(offer.title);
 titleAttributes.providerConflicts=[];
 if(offer.packCount!==null&&offer.packCount!==undefined&&offer.packCount!==''&&titleAttributes.packCount!==null&&Number(offer.packCount)!==titleAttributes.packCount){titleAttributes.providerConflicts.push('Provider pack count differs from the title-derived count.');titleAttributes.status='Review needed';}
 return {...offer,titleAttributes};
}
