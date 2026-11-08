import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
// Read through Node's filesystem API so builds work on restricted Windows hosts
// where native directory enumeration of drive ancestors is unavailable.
const filesystem={
  name:'node-filesystem',
  setup(plugin){
    plugin.onResolve({filter:/.*/},args=>{
      const directory=args.importer?path.dirname(args.importer):root;
      const resolved=createRequire(path.join(directory,'package.json')).resolve(args.path.startsWith('.')?path.resolve(directory,args.path):args.path);
      return {path:resolved,namespace:'node-filesystem'};
    });
    plugin.onLoad({filter:/.*/,namespace:'node-filesystem'},async args=>({
      contents:await readFile(args.path,'utf8'),
      loader:args.path.endsWith('.css')?'css':args.path.endsWith('.jsx')?'jsx':'js',
      resolveDir:path.dirname(args.path)
    }));
  }
};
const result=await build({absWorkingDir:root,entryPoints:['./client/main.jsx'],plugins:[filesystem],tsconfigRaw:{compilerOptions:{}},bundle:true,minify:true,write:false,outdir:'dist',entryNames:'app',format:'esm',jsx:'automatic',target:['es2022'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
for(const file of result.outputFiles)await writeFile(file.path,file.contents);
await copyFile(new URL('../client/index.html',import.meta.url),new URL('../dist/index.html',import.meta.url));
console.log('Built Jason Research React interface.');
