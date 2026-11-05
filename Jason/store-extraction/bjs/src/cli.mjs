import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {handoff} from './normalize.mjs';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
if(!args.includes('--input')||!args.includes('--output')){console.error('Usage: node cli.mjs --input raw.json --output handoff.json');process.exit(1);}
try {
  const data=handoff(JSON.parse(await readFile(resolve(get('--input')),'utf8')));
  const dest=resolve(get('--output'));await mkdir(dirname(dest),{recursive:true});
  const tmp=dest+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});await rename(tmp,dest);
  console.log(JSON.stringify(data.report,null,2));
} catch(e){console.error(e.message);process.exitCode=1;}
