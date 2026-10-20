import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

async function freePort(){
 const s=net.createServer();
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const port=s.address().port;
 await new Promise(resolve=>s.close(resolve));
 return port;
}

test('financial writes are serialized and cross-site POST requests are rejected', {timeout:30000},async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-concurrent-'));
 const port=await freePort();
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:resolve('.'),
  env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:'concurrency@test.example',ADMIN_PASSWORD:'Concurrency_Test_12345!'},
  stdio:['ignore','pipe','pipe']
 });
 let output='',cookie='';
 const request=async(path,body,headers={})=>{
  const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
   method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const ok=async(path,body)=>{
  const res=await request(path,body);
  assert.equal(res.status,200,`${path}: ${JSON.stringify(res.data)}`);
  return res.data;
 };
 try{
  await new Promise((resolveReady,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server timeout: '+output)),8000);
   child.stdout.on('data',data=>{output+=data;if(output.includes('Vincent ART:')){clearTimeout(timer);resolveReady();}});
   child.stderr.on('data',data=>output+=data);
   child.on('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${output}`));});
  });
  const login=await request('login',{email:'concurrency@test.example',password:'Concurrency_Test_12345!'});
  assert.equal(login.status,200);cookie=login.cookie;
  assert.match(cookie,/^session=/);

  const bid=(await ok('buildings',{code:'A1',name:'A1',electricRate:3800})).id;
  const roomId=(await ok('rooms',{buildingId:bid,code:'201',rent:4300000})).id;
  await ok('periods',{buildingId:bid,month:'2026-10'});
  const invoice=(await ok('invoices',{roomId,month:'2026-10',input:{previousElectric:86,currentElectric:125,previousWater:0,currentWater:0}}));

  await t.test('only one concurrent revision can use an old expectedVersion',async()=>{
   const edits=await Promise.all([
    request(`invoices/${invoice.id}/revise`,{expectedVersion:1,input:{currentElectric:130},reason:'Meter verified against photo'}),
    request(`invoices/${invoice.id}/revise`,{expectedVersion:1,input:{currentElectric:135},reason:'Different concurrent proposal'})
   ]);
   assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
   const result=await ok(`invoices/${invoice.id}`);
   assert.equal(result.version,2);
   assert.ok([130,135].includes(result.input.currentElectric));
   assert.equal(result.total,4300000+(result.input.currentElectric-86)*3800);
   assert.equal((await ok(`invoices/${invoice.id}/versions`)).length,2);
   const stale=await request(`invoices/${invoice.id}/preview`,{expectedVersion:1,input:{currentElectric:140}});
   assert.equal(stale.status,409);
  });

  await t.test('concurrent payment, retry and reversal preserve the financial ledger',async()=>{
   const payments=await Promise.all([
    request('payments',{invoiceId:invoice.id,amount:2000000,method:'TRANSFER',reference:'CONCURRENT-1'}),
    request('payments',{invoiceId:invoice.id,amount:1000000,method:'CASH',reference:'CONCURRENT-2'})
   ]);
   assert.deepEqual(payments.map(x=>x.status),[200,200]);
   assert.equal((await ok(`invoices/${invoice.id}`)).paid,3000000);
   const retries=await Promise.all(Array.from({length:3},()=>request('payments',{invoiceId:invoice.id,amount:1000000,method:'CASH',reference:'CONCURRENT-2'})));
   assert.ok(retries.every(x=>x.status===200&&x.data.duplicate===true));
   assert.equal((await ok('payments?buildingId='+bid+'&month=2026-10')).length,2);
   const paymentId=payments[0].data.id;
   const reversals=await Promise.all([
    request(`payments/${paymentId}/reverse`,{reason:'Verified duplicate transaction'}),
    request(`payments/${paymentId}/reverse`,{reason:'Verified duplicate transaction'})
   ]);
   assert.deepEqual(reversals.map(r=>r.status).sort(),[200,409]);
   assert.equal((await ok(`invoices/${invoice.id}`)).paid,1000000);
   assert.equal((await ok('payments?buildingId='+bid+'&month=2026-10')).filter(x=>x.reversed).length,1);
  });

  await t.test('cross-site fetch metadata blocks state-changing requests even without Origin',async()=>{
   const spoof=await request('payments',{invoiceId:invoice.id,amount:19,method:'CASH',reference:'CROSS-SITE-BLOCK'}, {'Sec-Fetch-Site':'cross-site'});
   assert.equal(spoof.status,403,`Cross-site request unexpectedly accepted: ${JSON.stringify(spoof.data)}`);
   const wrongOrigin=await request('payments',{invoiceId:invoice.id,amount:19,method:'CASH',reference:'WRONG-ORIGIN-BLOCK'}, {Origin:'https://outside.example'});
   assert.equal(wrongOrigin.status,403);
   const legit=await request('payments',{invoiceId:invoice.id,amount:1000000,method:'CASH',reference:'CONCURRENT-2'}, {Origin:`http://127.0.0.1:${port}`,'Sec-Fetch-Site':'same-origin'});
   assert.equal(legit.status,200);
   assert.equal(legit.data.duplicate,true);
   assert.equal((await ok(`invoices/${invoice.id}`)).paid,1000000);
  });

  await t.test('period lock rejects new payments and invoice revisions',async()=>{
   await ok('periods/lock',{buildingId:bid,month:'2026-10',locked:true,reason:'Reviewed month-end ledger'});
   const a=await request('payments',{invoiceId:invoice.id,amount:1,method:'CASH',reference:'LOCKED-NEW'});
   const b=await request(`invoices/${invoice.id}/revise`,{expectedVersion:2,input:{currentElectric:140},reason:'Late meter correction'});
   assert.deepEqual([a.status,b.status],[409,409]);
   assert.equal((await ok(`invoices/${invoice.id}`)).paid,1000000);
  });

  await t.test('collector SQL sums over the safe integer limit fail with a precise conflict',async()=>{
   const edgeBuilding=(await ok('buildings',{code:'EDGE',name:'Boundary test'})).id;
   await ok('periods',{buildingId:edgeBuilding,month:'2026-11'});
   const invoices=[];
   for(const code of ['101','102']){
    const room=(await ok('rooms',{buildingId:edgeBuilding,code,rent:1})).id;
    invoices.push((await ok('invoices',{roomId:room,month:'2026-11',input:{previousElectric:0,currentElectric:0,previousWater:0,currentWater:0}})).id);
   }
   const half=4_503_599_627_370_495;
   await ok('payments',{invoiceId:invoices[0],amount:half,method:'CASH',reference:'EDGE-1'});
   await ok('payments',{invoiceId:invoices[1],amount:half,method:'CASH',reference:'EDGE-2'});
   assert.equal((await ok('reports/collectors?month=2026-11'))[0].amount,half*2);
   await ok('payments',{invoiceId:invoices[0],amount:3,method:'CASH',reference:'EDGE-3'});
   const result=await request('reports/collectors?month=2026-11');
   assert.equal(result.status,409,JSON.stringify(result));
   assert.match(result.data.error,/safe integer/i);
  });
 }finally{
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
