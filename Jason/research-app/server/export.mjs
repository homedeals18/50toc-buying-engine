export function flatten(value, prefix='', output={}) {
  if(Array.isArray(value)){
    if(!value.length)output[prefix]='[]';
    value.forEach((item,i)=>flatten(item,prefix+'['+i+']',output));
  } else if(value&&typeof value==='object'){
    const entries=Object.entries(value);
    if(!entries.length)output[prefix]='{}';
    for(const [key,item]of entries)flatten(item,prefix?prefix+'.'+key:key,output);
  } else output[prefix]=value??'';
  return output;
}
export function toCsv(records) {
  const rows=records.map(r=>flatten(r)),keys=[...new Set(rows.flatMap(Object.keys))];
  const escape=value=>{
    let s=String(value??'');
    // Prevent spreadsheet formula execution in imported provider text.
    if(/^[\s]*[=+@-]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  return '\ufeff'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(row=>row.map(escape).join(',')).join('\r\n');
}
