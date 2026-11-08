import {mkdir,cp,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=process.argv[2]&&path.resolve(process.argv[2]);
const runtime=process.argv[3]&&path.resolve(process.argv[3]);
if(!target||!runtime||!path.isAbsolute(target)||!path.isAbsolute(runtime))throw Error('Provide an empty target and the Node runtime directory.');
await mkdir(target,{recursive:true});
if((await readdir(target)).length)throw Error('The packaging target must be empty.');
for(const entry of ['server','migrations','dist','test','package.json','README.md','UPGRADE_FROM_0_1.txt','START_RESEARCH.cmd','START_DEMO.cmd'])await cp(path.join(root,entry),path.join(target,entry),{recursive:true});
const seen=new Map();
async function copyPackage(name,from){
  const require=createRequire(path.join(from,'package.json'));
  const entry=require.resolve(name);
  let directory=path.dirname(entry),info;
  while(true){
    try{info=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));if(info.name===name)break;}catch{}
    const parent=path.dirname(directory);if(parent===directory)throw Error('Package root not found: '+name);directory=parent;
  }
  if(seen.has(name)){if(seen.get(name)!==info.version)throw Error('Conflicting runtime versions: '+name);return;}
  seen.set(name,info.version);
  await cp(directory,path.join(target,'node_modules',name),{recursive:true,dereference:true,filter:source=>!path.relative(directory,source).split(path.sep).includes('node_modules')});
  for(const dependency of Object.keys(info.dependencies??{}))await copyPackage(dependency,directory);
  for(const dependency of Object.keys(info.optionalDependencies??{})){
    try{createRequire(path.join(directory,'package.json')).resolve(dependency);}catch{continue;}
    await copyPackage(dependency,directory);
  }
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
for(const name of Object.keys(pkg.dependencies))await copyPackage(name,root);
await mkdir(path.join(target,'runtime'),{recursive:true});
await cp(path.join(runtime,'node.exe'),path.join(target,'runtime','node.exe'));
if(process.argv[4]){
  await cp(path.resolve(process.argv[4]),path.join(target,'runtime','NODE_LICENSE.txt'));
}else{
  const license=await fetch('https://raw.githubusercontent.com/nodejs/node/v'+process.versions.node+'/LICENSE');
  if(!license.ok)throw Error('Node license download failed.');
  await writeFile(path.join(target,'runtime','NODE_LICENSE.txt'),await license.text());
}
await writeFile(path.join(target,'RUNTIME_PACKAGES.json'),JSON.stringify({node:process.version,packages:Object.fromEntries(seen)},null,2));
console.log('Packaged Windows application with '+seen.size+' runtime packages; no data or keys included.');
