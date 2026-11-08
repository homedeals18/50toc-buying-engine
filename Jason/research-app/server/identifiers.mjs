// GS1 Modulo 10 validates composition; it does not establish product ownership.
export function validateGtin(input){
  if(typeof input!=='string')return {valid:false,reason:'Barcode must be text so leading zeroes are preserved.'};
  const value=input.trim();
  if(!/^\d+$/.test(value)||![8,12,13,14].includes(value.length))return {valid:false,value,reason:'Use an 8, 12, 13 or 14 digit GTIN. Expand UPC-E from reliable evidence first.'};
  if(/^0+$/.test(value))return {valid:false,value,reason:'An all-zero value is not a usable product identifier.'};
  let sum=0,weight=3;
  for(let i=value.length-2;i>=0;i--){sum+=Number(value[i])*weight;weight=weight===3?1:3;}
  if((10-sum%10)%10!==Number(value.at(-1)))return {valid:false,value,reason:'Barcode check digit does not match. Recheck the printed number; do not invent a replacement digit.'};
  return {valid:true,value,gtin14:value.padStart(14,'0'),type:({8:'GTIN-8',12:'UPC-A',13:'EAN-13',14:'GTIN-14'})[value.length]};
}

export function identifierCandidates(value,source='Saved API',path='$'){
  const output=[];
  function visit(node,position,depth=0){
    if(depth>12||!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach((item,i)=>visit(item,position+'['+i+']',depth+1));return;}
    const label=String(node.name??node.label??node.key??'');
    if(/^(?:upc|upc-a|ean|ean-13|gtin|gtin-8|gtin-12|gtin-13|gtin-14|barcode)$/i.test(label)&&('value' in node))add(node.value,position+'.value');
    for(const [key,item]of Object.entries(node)){
      if(/^(?:upc|upc_code|upccode|gtin|gtin8|gtin12|gtin13|gtin14|ean|ean13|barcode)$/i.test(key))add(item,position+'.'+key);
      else if(item&&typeof item==='object')visit(item,position+'.'+key,depth+1);
    }
  }
  function add(raw,position){
    const values=Array.isArray(raw)?raw:[raw];
    for(const v of values){
      if(v===null||v===undefined||v==='')continue;
      const validation=validateGtin(v);
      output.push({raw:typeof v==='string'||typeof v==='number'?v:'Unsupported structured value',source,path:position,...validation,scope:'unknown',verified:false});
    }
  }
  visit(value,path);
  return [...new Map(output.map(r=>[JSON.stringify([r.source,r.path,r.raw]),r])).values()];
}

export function evidenceUrl(value){
  if(typeof value!=='string'||value.length>2000)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(k=>/token|api.?key|auth|secret|password|signature|credential/i.test(k)))return null;
    return url.href;
  }catch{return null;}
}
