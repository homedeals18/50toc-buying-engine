import test from 'node:test';
import assert from 'node:assert/strict';
import {createScavioClient} from '../src/client.mjs';
test('Costco clearance uses documented endpoint and bearer authentication',async()=>{
 let request;
 const fakeFetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:{results:[]}})}};
 const client=createScavioClient({apiKey:'test-only',fetchImpl:fakeFetch});
 await client.request('costcoClearance',{warehouse_id:'1062',query:'snacks',pages:1});
 assert.equal(request.url,'https://api.scavio.dev/api/v1/costco/clearance');
 assert.equal(request.options.headers.Authorization,'Bearer test-only');
 assert.equal(JSON.parse(request.options.body).warehouse_id,'1062');
});
test('rejects missing key and unknown endpoints',async()=>{
 assert.throws(()=>createScavioClient({apiKey:''}),/SCAVIO_API_KEY/);
 await assert.rejects(()=>createScavioClient({apiKey:'test-only'}).request('unknown'),/Unsupported/);
});
test('does not include secret in API error',async()=>{
 const client=createScavioClient({apiKey:'secret-test',fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'bad key'})})});
 await assert.rejects(()=>client.request('costcoClearance',{}),e=>!e.message.includes('secret-test')&&e.message.includes('401'));
});
