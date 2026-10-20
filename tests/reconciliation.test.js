import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

const root=resolve('.');
async function portNumber(){
 const socket=net.createServer();
 await new Promise(ok=>socket.listen(0,'127.0.0.1',ok));
 const port=socket.address().port;
 await new Promise(ok=>socket.close(ok));
 return port;
}

test('reconciliation API: every room, accurate ledger, reversed transactions, access control, locks, corrupt data and overflow',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-reconciliation-'));
 const port=await portNumber();
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:root,
  env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:'audit@test.example',ADMIN_PASSWORD:'Reconciliation_Test_12345!'},
  stdio:['ignore','pipe','pipe']
 });
 let serverOutput='',admin,viewer;
 const request=async(path,payload,cookie=admin)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
   method:payload===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const ok=async(path,payload,cookie)=>{
  const r=await request(path,payload,cookie);
  assert.equal(r.status,200,`${path}: ${JSON.stringify(r.data)}`);
  return r.data;
 };
 const blocked=async(path,payload,status,cookie)=>{
  const r=await request(path,payload,cookie);
  assert.equal(r.status,status,`${path}: ${JSON.stringify(r.data)}`);
 };
 try{
  await new Promise((resolveReady,rejectReady)=>{
   const timeout=setTimeout(()=>rejectReady(Error('Server timed out: '+serverOutput)),8000);
   child.stdout.on('data',part=>{serverOutput+=part;if(serverOutput.includes('Vincent ART:')){clearTimeout(timeout);resolveReady();}});
   child.stderr.on('data',part=>serverOutput+=part);
   child.on('exit',code=>{clearTimeout(timeout);rejectReady(Error(`Server exited (${code}): ${serverOutput}`));});
  });
  admin=(await request('login',{email:'audit@test.example',password:'Reconciliation_Test_12345!'},null)).cookie;
  assert.match(admin,/^session=/);

  const a1=(await ok('buildings',{code:'A1',name:'Building A1',electricRate:3800,waterRate:10000})).id;
  const a2=(await ok('buildings',{code:'A2',name:'Building A2',electricRate:3800,waterRate:10000})).id;
  const roomIds=[];
  for(const [code,rent] of [['101',100000],['102',200000],['103',300000],['104',400000]]){
   roomIds.push((await ok('rooms',{buildingId:a1,code,rent})).id);
  }
  await ok('rooms',{buildingId:a2,code:'201',rent:150000});
  const path=`reports/reconciliation?buildingId=${a1}&month=2026-10`;

  await t.test('no period: clearly identify every unbilled room',async()=>{
   const report=await ok(path);
   assert.equal(report.periodExists,false);
   assert.deepEqual([report.rooms,report.invoiced,report.missing,report.transactions],[4,0,4,0]);
   assert.equal(report.totals.total,0);
   assert.deepEqual(report.checks.map(r=>[r.room,r.status]),[['101','MISSING'],['102','MISSING'],['103','MISSING'],['104','MISSING']]);
   assert.match(report.issues.join(' '),/4 phòng chưa có hóa đơn/);
  });

  await ok('periods',{buildingId:a1,month:'2026-10'});
  const invoiceIds=[];
  for(let i=0;i<3;i++)invoiceIds.push((await ok('invoices',{roomId:roomIds[i],month:'2026-10',input:{previousElectric:0,currentElectric:0,previousWater:0,currentWater:0}})).id);

  await t.test('unpaid, partial, complete, overpaid and multiple payment methods',async()=>{
   const initial=await ok(path);
   assert.deepEqual(initial.totals,{total:600000,paid:0,due:600000,overpaid:0});
   assert.equal(initial.missing,1);
   assert.equal(initial.errors,0);
   assert.equal(initial.checks.find(x=>x.room==='101').status,'VALID');
   await ok('payments',{invoiceId:invoiceIds[0],amount:40000,method:'TRANSFER',reference:'RECON-001'});
   const partial=await ok(path);
   assert.equal(partial.rows.find(x=>x.room==='101').status,'PARTIAL');
   assert.equal(partial.totals.due,560000);
   await ok('payments',{invoiceId:invoiceIds[0],amount:60000,method:'CASH',reference:'RECON-002'});
   const complete=await ok(path);
   assert.equal(complete.rows.find(x=>x.room==='101').status,'PAID');
   assert.equal(complete.rows.find(x=>x.room==='101').transactionCount,2);
   await ok('payments',{invoiceId:invoiceIds[1],amount:250000,method:'TRANSFER',reference:'RECON-003'});
   const report=await ok(path);
   assert.deepEqual(report.totals,{total:600000,paid:350000,due:300000,overpaid:50000});
   assert.deepEqual(report.paymentMethods,{cash:60000,transfer:290000});
   assert.equal(report.transactions,3);
   assert.equal(report.activeTransactions,3);
   assert.equal(report.rows.find(x=>x.room==='102').status,'OVERPAID');
   assert.equal(report.rows.find(x=>x.room==='103').status,'UNPAID');
   assert.equal(report.rows.find(x=>x.room==='104'),undefined);
  });

  await t.test('reversal is preserved in history, removes value from active ledger, and prevents duplicate reference',async()=>{
   const journal=await ok(`payments?buildingId=${a1}&month=2026-10`);
   const payment=journal.find(x=>x.reference==='RECON-002');
   await blocked(`payments/${payment.id}/reverse`,{reason:'no'},400);
   await ok(`payments/${payment.id}/reverse`,{reason:'Correct duplicate cash payment'});
   await blocked(`payments/${payment.id}/reverse`,{reason:'Second reversal disallowed'},409);
   await blocked('payments',{invoiceId:invoiceIds[0],amount:60000,method:'CASH',reference:'RECON-002'},409);
   const report=await ok(path);
   assert.deepEqual(report.totals,{total:600000,paid:290000,due:360000,overpaid:50000});
   assert.deepEqual(report.paymentMethods,{cash:0,transfer:290000});
   assert.deepEqual([report.transactions,report.activeTransactions,report.reversedTransactions],[3,2,1]);
   assert.equal(report.rows.find(x=>x.room==='101').transactionCount,1);
   assert.equal(report.rows.find(x=>x.room==='101').status,'PARTIAL');
   assert.equal(report.totals.total-report.totals.paid,report.totals.due-report.totals.overpaid);
  });

  await t.test('server-side building permissions, invalid month, and period lock',async()=>{
   const account=await ok('users',{email:'viewer-recon@test.example',password:'Viewer_Reconciliation_123!',role:'VIEWER',buildingIds:[a2]});
   assert.ok(account.id);
   viewer=(await request('login',{email:'viewer-recon@test.example',password:'Viewer_Reconciliation_123!'},null)).cookie;
   await blocked(path,undefined,403,viewer);
   const own=await ok(`reports/reconciliation?buildingId=${a2}&month=2026-10`,undefined,viewer);
   assert.equal(own.missing,1);
   assert.equal(own.totals.paid,0);
   await blocked('reports/reconciliation?buildingId='+a1+'&month=2026-13',undefined,400);
   await blocked(path,undefined,401,null);
   await blocked('periods/lock',{buildingId:a1,month:'2026-10',locked:true,reason:'Unacknowledged missing rooms'},409);
   await ok('periods/lock',{buildingId:a1,month:'2026-10',locked:true,reason:'Vacant room reviewed',acknowledgeMissing:true});
   assert.equal((await ok(path)).locked,true);
   await blocked('payments',{invoiceId:invoiceIds[0],amount:1,method:'CASH',reference:'LOCKED-001'},409);
   await ok('periods/lock',{buildingId:a1,month:'2026-10',locked:false,reason:'Reopen after review'});
   assert.equal((await ok(path)).locked,false);
  });

  await t.test('CSV export includes every room, totals and permissions, including absent invoices',async()=>{
   const exportPath=`http://127.0.0.1:${port}/api/reports/reconciliation/export?buildingId=${a1}&month=2026-10`;
   const exported=await fetch(exportPath,{headers:{Cookie:admin}});
   assert.equal(exported.status,200);
   assert.match(exported.headers.get('content-type'),/text\/csv/);
   assert.match(exported.headers.get('content-disposition'),/attachment/);
   const bytes=Buffer.from(await exported.arrayBuffer());
   assert.deepEqual([...bytes.subarray(0,3)],[0xEF,0xBB,0xBF],'Excel-compatible UTF-8 BOM');
   const csv=bytes.toString('utf8');
   assert.match(csv,/"104","MISSING"/);
   assert.match(csv,/"101","VALID"/);
   assert.match(csv,/"TỔNG","","","600000","290000","360000","50000","2"/);
   const secret=await fetch(exportPath,{headers:{Cookie:viewer}});
   assert.equal(secret.status,403,'viewer scoped to A2 must not export A1 data');
   const publicRequest=await fetch(exportPath);
   assert.equal(publicRequest.status,401,'export cannot be downloaded without authentication');
   const invalid=await fetch(exportPath.replace('2026-10','2026-13'),{headers:{Cookie:admin}});
   assert.equal(invalid.status,400);
  });

  await t.test('tampered invoice is reported and unsafe sum is rejected without changing real data',async()=>{
   const db=new DatabaseSync(join(dataDir,'vincent.sqlite'));
   try{
    db.prepare('UPDATE invoices SET total=total+800 WHERE id=?').run(invoiceIds[0]);
    const corrupted=await ok(path);
    assert.equal(corrupted.errors,1);
    assert.match(corrupted.issues.join(' '),/hóa đơn có lỗi/);
    assert.match(corrupted.checks.find(x=>x.room==='101').issues.join(' '),/Sai tổng tiền/);
    db.prepare('UPDATE invoices SET total=total-800 WHERE id=?').run(invoiceIds[0]);
    db.prepare('UPDATE invoices SET total=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,invoiceIds[0]);
    await blocked(path,undefined,409);
   }finally{
    db.prepare('UPDATE invoices SET total=? WHERE id=?').run(100000,invoiceIds[0]);
    db.close();
   }
   assert.deepEqual((await ok(path)).totals,{total:600000,paid:290000,due:360000,overpaid:50000});
  });
 }finally{
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
