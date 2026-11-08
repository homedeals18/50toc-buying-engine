import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {KeyVault} from '../server/provider.mjs';

test('Windows key storage encrypts a synthetic key and reads it without numeric conversion',{skip:process.platform!=='win32'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'50toc-vault-test-'));
  const secret='synthetic-key-not-for-any-service-001a22';
  try{
    const vault=new KeyVault(dir);
    try{await vault.save(secret);}catch(e){if(e.code==='DPAPI_UNAVAILABLE'){t.skip('Windows DPAPI encryption is unavailable in the automated logon context. Interactive verification required.');return;}t.diagnostic('Storage exception type: '+e.storageExceptionType);throw e;}
    assert.equal(vault.configured(),true);
    assert(!(await readFile(vault.path,'utf8')).includes(secret));
    assert.equal(await vault.read(),secret);
    assert.equal(await new KeyVault(dir).read(),secret);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('session-only keys remain in memory and are not written to disk',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'50toc-session-vault-test-'));
  try{
    const vault=new KeyVault(dir);await vault.save('synthetic-session-key',{sessionOnly:true});
    assert.equal(await vault.read(),'synthetic-session-key');assert.equal(vault.mode(),'session only');
    await assert.rejects(readFile(vault.path),e=>e.code==='ENOENT');
    assert.equal(new KeyVault(dir).configured(),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
