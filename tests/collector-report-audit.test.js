import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {renderCollectorReport} from '../public/ui-pages.js';

const money=value=>new Intl.NumberFormat('vi-VN',{
 style:'currency',currency:'VND',maximumFractionDigits:0
}).format(value);

test('collector matrix preserves cash, transfer, per-building and grand totals near the safe integer boundary',async()=>{
 const entries=[
  {building_id:1,building_code:'A1',collector:'alpha@example.com',method:'CASH',amount:4_503_599_627_370_490,transactions:1},
  {building_id:1,building_code:'A1',collector:'beta@example.com',method:'TRANSFER',amount:1,transactions:1},
  {building_id:2,building_code:'A2',collector:'alpha@example.com',method:'TRANSFER',amount:4_503_599_627_370_493,transactions:1},
  {building_id:2,building_code:'A2',collector:'beta@example.com',method:'CASH',amount:3,transactions:1}
 ];
 const content={innerHTML:''};
 await renderCollectorReport({
  api:async()=>entries,heading:()=>{},month:()=> '2026-10',
  buildings:[{id:1,code:'A1'},{id:2,code:'A2'}],content,
  table:(headers,rows)=>`<table><thead>${headers.join('|')}</thead>${rows.join('')}</table>`,
  esc:value=>String(value),money
 });
 const total=Number(entries.reduce((sum,item)=>sum+BigInt(item.amount),0n));
 assert.equal(total,Number.MAX_SAFE_INTEGER-4);
 assert.ok(content.innerHTML.includes(`Tổng đã thu · 2026-10</div><div class="value">${money(total)}`));
 assert.ok(content.innerHTML.includes(`<div class="value">${money(4_503_599_627_370_493)}</div>`),'cash total');
 assert.ok(content.innerHTML.includes(`<div class="value">${money(4_503_599_627_370_494)}</div>`),'transfer total');
 assert.ok(content.innerHTML.includes(`<td><b>A1</b></td>`));
 assert.ok(content.innerHTML.includes(`<td><b>A2</b></td>`));
 assert.ok(content.innerHTML.includes(`<td class="num"><b>${money(total)}</b></td>`));
 assert.ok(content.innerHTML.includes('<div class="value">4</div>'),'four effective transactions');
});

async function freePort(){
 const socket=net.createServer();
 await new Promise(resolveReady=>socket.listen(0,'127.0.0.1',resolveReady));
 const port=socket.address().port;
 await new Promise(resolveDone=>socket.close(resolveDone));
 return port;
}

test('collector API isolates buildings and excludes reversals in multi-user, multi-method reports',{timeout:20000},async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-collectors-'));
 const port=await freePort();
 const email='collector-audit@test.example',password='Collector_Audit_Test_12345!';
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:resolve('.'),env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},
  stdio:['ignore','pipe','pipe']
 });
 const request=async(path,body,cookie)=>{
  const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
   method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const ok=async(path,body,cookie)=>{
  const result=await request(path,body,cookie);
  assert.equal(result.status,200,`${path}: ${JSON.stringify(result.data)}`);
  return result.data;
 };
 try{
  await new Promise((ready,reject)=>{
   let output='';
   const timer=setTimeout(()=>reject(Error(`Server startup timeout: ${output}`)),8000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timer);ready();}});
   child.stderr.on('data',chunk=>output+=chunk);
   child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${output}`));});
  });
  const adminLogin=await request('login',{email,password});
  assert.equal(adminLogin.status,200);
  const admin=adminLogin.cookie;
  const A1=(await ok('buildings',{code:'A1',name:'Building A1'},admin)).id;
  const A2=(await ok('buildings',{code:'A2',name:'Building A2'},admin)).id;
  const invoices=[];
  for(const [buildingId,code] of [[A1,'201'],[A2,'301']]){
   const roomId=(await ok('rooms',{buildingId,code,rent:1000},admin)).id;
   await ok('periods',{buildingId,month:'2026-10'},admin);
   invoices.push((await ok('invoices',{roomId,month:'2026-10',input:{previousElectric:0,currentElectric:0,previousWater:0,currentWater:0}},admin)).id);
  }
  await ok('users',{email:'a1collector@example.com',password:'Collector_User_Password_123!',role:'COLLECTOR',buildingIds:[A1]},admin);
  const collectorLogin=await request('login',{email:'a1collector@example.com',password:'Collector_User_Password_123!'});
  assert.equal(collectorLogin.status,200);
  const collector=collectorLogin.cookie;
  await ok('payments',{invoiceId:invoices[0],amount:800,method:'CASH',reference:'A1-ADMIN-CASH'},admin);
  await ok('payments',{invoiceId:invoices[0],amount:120,method:'TRANSFER',reference:'A1-STAFF-TRANSFER'},collector);
  const reversed=await ok('payments',{invoiceId:invoices[1],amount:300,method:'TRANSFER',reference:'A2-REVERSED'},admin);
  await ok('payments',{invoiceId:invoices[1],amount:500,method:'CASH',reference:'A2-ADMIN-CASH'},admin);
  await ok(`payments/${reversed.id}/reverse`,{reason:'Verified audit reversal'},admin);
  const report=await ok('reports/collectors?month=2026-10',undefined,admin);
  assert.deepEqual(report.map(item=>[item.building_code,item.collector,item.method,item.amount,item.transactions]),[
   ['A1','a1collector@example.com','TRANSFER',120,1],
   ['A1',email,'CASH',800,1],
   ['A2',email,'CASH',500,1]
  ]);
  const amount=report.reduce((sum,item)=>sum+item.amount,0);
  assert.equal(amount,1420);
  assert.equal(report.filter(item=>item.method==='CASH').reduce((sum,item)=>sum+item.amount,0),1300);
  assert.equal(report.filter(item=>item.method==='TRANSFER').reduce((sum,item)=>sum+item.amount,0),120);
  const limited=await ok('reports/collectors?month=2026-10',undefined,collector);
  assert.deepEqual(limited.map(item=>item.building_code),['A1','A1']);
  assert.equal(limited.reduce((sum,item)=>sum+item.amount,0),920);
  const journal=await ok(`payments?buildingId=${A2}&month=2026-10`,undefined,admin);
  assert.equal(journal.filter(item=>item.reversed).length,1);
  assert.equal(journal.reduce((sum,item)=>sum+item.net_amount,0),500);
 } finally {
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
