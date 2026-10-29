import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

const root=resolve('.');
const dataDir=mkdtempSync(join(tmpdir(),'vincent-integration-'));
const email='test.admin@example.com',password='Test_Admin_Password_123!';
let child,port;

async function serverPort(){
 const socket=net.createServer();
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const selected=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 return selected;
}
async function start(){
 port=await serverPort();
 child=spawn(process.execPath,['src/server.js'],{
  cwd:root,env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']
 });
 let output='';
 await new Promise((yes,no)=>{
  const timeout=setTimeout(()=>no(Error('Server startup timeout '+output)),8000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timeout);yes();}});
  child.stderr.on('data',chunk=>{output+=chunk;});
  child.on('exit',code=>{clearTimeout(timeout);no(Error('Server exited '+code+' '+output));});
 });
}
async function stop(){if(child&&!child.killed){child.kill();await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});}}
async function request(path,body,session,extraHeaders={},method=null){
 const headers={'Content-Type':'application/json',...extraHeaders};
 if(session)headers.Cookie=session;
 const m = method || (body===undefined?'GET':'POST');
 const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:m,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await res.json();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function ok(path,body,session,method=null){const res=await request(path,body,session,{},method);assert.equal(res.status,200,`${path}: ${JSON.stringify(res.data)}`);return res.data;}
async function denied(path,body,session,status,method=null){const res=await request(path,body,session,{},method);assert.equal(res.status,status,`${path}: ${JSON.stringify(res.data)}`);return res.data;}

test('real HTTP, isolated database, user permissions and financial lifecycle',async t=>{
 await start();
 let admin;
 try{
  await t.test('login and authentication',async()=>{
   await denied('buildings',undefined,null,401);
   assert.equal((await request('login',{email,password},null,{Origin:'https://unauthorized.example'})).status,403);
   await denied('login',{email,password:'wrong'},null,401);
   const login=await request('login',{email,password});assert.equal(login.status,200);admin=login.cookie;
   assert.match(admin,/^session=/);assert.equal((await ok('me',undefined,admin)).role,'SUPER_ADMIN');
    const oversized={email,password,padding:'ế'.repeat(600_000)};
    assert.ok(Buffer.byteLength(JSON.stringify(oversized),'utf8')>1_000_000);
    await denied('login',oversized,null,413);
  });
  const ids={};
  await t.test('buildings, rooms and billing',async()=>{
   for(const code of ['A1','A2','A4'])ids[code]=(await ok('buildings',{code,name:`Building ${code}`,electricRate:3800,waterRate:10000},admin)).id;
   ids.a1room=(await ok('rooms',{buildingId:ids.A1,code:'201',rent:4300000,internet:100000,cleaning:150000},admin)).id;
   ids.a1empty=(await ok('rooms',{buildingId:ids.A1,code:'202',rent:3600000},admin)).id;
   ids.a2room=(await ok('rooms',{buildingId:ids.A2,code:'504',rent:3000000},admin)).id;
   ids.a4room=(await ok('rooms',{buildingId:ids.A4,code:'301',rent:2500000},admin)).id;
   await denied('rooms',{buildingId:ids.A1,code:'201'},admin,409);
   for(const bid of [ids.A1,ids.A2,ids.A4])await ok('periods',{buildingId:bid,month:'2026-10'},admin);
   const a1=await ok('invoices',{roomId:ids.a1room,month:'2026-10',input:{previousElectric:86,currentElectric:125,previousWater:0,currentWater:0}},admin);
   ids.a1invoice=a1.id;assert.equal(a1.total,4698200);
   ids.a2invoice=(await ok('invoices',{roomId:ids.a2room,month:'2026-10',input:{previousElectric:0,currentElectric:10,previousWater:0,currentWater:0}},admin)).id;
   ids.a4invoice=(await ok('invoices',{roomId:ids.a4room,month:'2026-10',input:{previousElectric:0,currentElectric:0,previousWater:5,currentWater:20}},admin)).id;
   await denied('invoices',{roomId:ids.a1room,month:'2026-10',input:{}},admin,409);
   await denied('invoices',{roomId:ids.a2room,month:'2026-11',input:{previousElectric:0,currentElectric:0,previousWater:0,currentWater:0}},admin,400);
  });
  await t.test('versioned revision, multiple payments, idempotency, debt and overpayment',async()=>{
   const revised=await ok(`invoices/${ids.a1invoice}/revise`,{input:{currentElectric:130},reason:'Correction after meter check'},admin);
   assert.equal(revised.total,4717200);assert.equal(revised.version,2);
   assert.equal((await ok(`invoices/${ids.a1invoice}/versions`,undefined,admin)).length,2);
   await ok('payments',{invoiceId:ids.a1invoice,amount:2000000,method:'TRANSFER',reference:'E2E-001'},admin);
   assert.equal((await ok(`invoices/${ids.a1invoice}`,undefined,admin)).due,2717200);
   const second=await ok('payments',{invoiceId:ids.a1invoice,amount:3000000,method:'CASH',reference:'E2E-002'},admin);
   assert.equal(second.invoice.overpaid,282800);assert.equal(second.invoice.status,'OVERPAID');
   assert.equal((await ok('payments',{invoiceId:ids.a1invoice,amount:3000000,method:'CASH',reference:'E2E-002'},admin)).duplicate,true);
   await denied('payments',{invoiceId:ids.a1invoice,amount:1,method:'CASH',reference:'E2E-002'},admin,409);
   assert.equal((await ok('payments?buildingId='+ids.A1+'&month=2026-10',undefined,admin)).length,2);
   const dashboard=await ok('dashboard?buildingId='+ids.A1+'&month=2026-10',undefined,admin);
   assert.equal(dashboard.total,4717200);assert.equal(dashboard.paid,5000000);assert.equal(dashboard.complete,1);
   assert.equal(dashboard.overpaid,282800);
  });
  await t.test('assistant preview confirmation, one-time apply, revisions',async()=>{
   const preview=await ok('assistant/preview',{message:'Sửa giá điện toàn bộ phòng nhà A1,A2 lên 4.000đ/kwh'},admin);
   assert.deepEqual(preview.items.map(x=>x.building),['A1','A2']);
   await denied('assistant/apply',{message:'Sửa giá điện toàn bộ phòng nhà A1 lên 100đ/kwh'},admin,400);
   await ok('assistant/apply',{previewId:preview.previewId},admin);
   await denied('assistant/apply',{previewId:preview.previewId},admin,409);
   await denied('assistant/preview',{message:'Sửa giá điện nhà A1,A2 lên 4.000đ/kwh'},admin,409);
   const b=await ok('buildings',undefined,admin);assert.equal(b.find(x=>x.code==='A1').electric_rate,4000);
   assert.equal((await ok(`invoices/${ids.a1invoice}`,undefined,admin)).total,4717200);
   const occupants=await ok('assistant/preview',{message:'sửa số người ở phòng A2.504 thành 3'},admin);
   await ok('assistant/apply',{previewId:occupants.previewId},admin);
   assert.equal((await ok('rooms?buildingId='+ids.A2,undefined,admin))[0].occupants,3);
   await denied('assistant/preview',{message:'sửa số người ở phòng A2.504 thành 3'},admin,409);
   await denied('assistant/preview',{message:'sửa số người ở phòng A2.504'},admin,400);
   await denied('assistant/preview',{message:'số nước mới của A4.301 là 50'},admin,400);
   await denied('assistant/preview',{message:'số nước mới của A4.301 là 50',month:'2026-14'},admin,400);
   const water=await ok('assistant/preview',{message:'số nước mới của A4.301 là 50',month:'2026-10'},admin);
   assert.equal(water.items[0].month,'2026-10');
   assert.equal(water.items[0].newTotal-water.items[0].oldTotal,300000);
   const result=await ok('assistant/apply',{previewId:water.previewId},admin);
   assert.equal(result.invoiceId,ids.a4invoice);
   assert.equal((await ok(`invoices/${ids.a4invoice}`,undefined,admin)).input.currentWater,50);
   await denied('assistant/preview',{message:'số nước mới của A4.301 là 50',month:'2026-10'},admin,409);
   assert.equal((await ok('assistant/preview',{message:'Lấy hóa đơn A4.301 tháng 10/2026'},admin)).invoices[0].id,ids.a4invoice);
  });
  await t.test('every-room invoice reconciliation and full multi-building financial report',async()=>{
   const check=await ok(`invoices/check?buildingId=${ids.A1}&month=2026-10`,undefined,admin);
   assert.equal(check.valid,1);assert.equal(check.errors,0);assert.equal(check.missing,1);
   assert.deepEqual(check.rooms.map(r=>[r.room,r.status]),[['201','VALID'],['202','MISSING']]);
   assert.equal(check.rooms[0].paid,5000000);
   await denied(`invoices/check?buildingId=${ids.A1}&month=2026-13`,undefined,admin,400);
   await denied(`invoices?buildingId=${ids.A1}&month=2026-13`,undefined,admin,400);
   const report=await ok('dashboard/summary?month=2026-10',undefined,admin);
   assert.equal(report.buildings.length,3);
   assert.deepEqual(report.totals,{rooms:4,invoiced:3,total:10705200,paid:5000000,due:5988000,overpaid:282800,unpaid:2,partial:0,complete:1});
   assert.equal(report.buildings.find(r=>r.code==='A1').rooms,2);
   assert.equal(report.buildings.find(r=>r.code==='A1').invoiced,1);
   await denied('dashboard/summary?month=not-a-month',undefined,admin,400);
   const tamper=new DatabaseSync(join(dataDir,'vincent.sqlite'));
   try{
    tamper.prepare('UPDATE invoices SET total=total+800 WHERE id=?').run(ids.a4invoice);
    const mismatched=await ok(`invoices/check?buildingId=${ids.A4}&month=2026-10`,undefined,admin);
    assert.equal(mismatched.errors,1);
    assert.equal(mismatched.valid,0);
    assert.match(mismatched.rooms[0].issues.join(' '),/Sai tổng tiền/);
    assert.equal(mismatched.rooms[0].expected,2950000);
    await denied('periods/lock',{buildingId:ids.A4,month:'2026-10',locked:true,reason:'Must not lock corrupted invoice'},admin,409);
   }finally{tamper.prepare('UPDATE invoices SET total=total-800 WHERE id=?').run(ids.a4invoice);tamper.close();}
   assert.equal((await ok(`invoices/check?buildingId=${ids.A4}&month=2026-10`,undefined,admin)).valid,1);
  });
  await t.test('version integrity and unusual usage must be reviewed before closing',async()=>{
   const corrupted=new DatabaseSync(join(dataDir,'vincent.sqlite'));
   try{
    corrupted.prepare('UPDATE invoice_versions SET total=total+1 WHERE invoice_id=? AND version=1').run(ids.a4invoice);
    const review=await ok(`invoices/check?buildingId=${ids.A4}&month=2026-10`,undefined,admin);
    assert.equal(review.errors,1);
    assert.match(review.rooms[0].issues.join(' '),/Lịch sử phiên bản/);
    await denied('periods/lock',{buildingId:ids.A4,month:'2026-10',locked:true,reason:'cannot bypass',acknowledgeWarnings:true,acknowledgeMissing:true},admin,409);
   }finally{corrupted.prepare('UPDATE invoice_versions SET total=total-1 WHERE invoice_id=? AND version=1').run(ids.a4invoice);corrupted.close();}
   const high=await ok(`invoices/${ids.a2invoice}/revise`,{input:{currentElectric:1700},reason:'Testing unusual usage review'},admin);
   assert.equal(high.input.currentElectric,1700);
   const review=await ok(`invoices/check?buildingId=${ids.A2}&month=2026-10`,undefined,admin);
   assert.equal(review.warnings,1);assert.equal(review.errors,0);
   assert.match(review.rooms[0].warnings.join(' '),/1.500 kWh/);
   await denied('periods/lock',{buildingId:ids.A2,month:'2026-10',locked:true,reason:'Unreviewed warning'},admin,409);
   await ok('periods/lock',{buildingId:ids.A2,month:'2026-10',locked:true,reason:'Reviewed exceptional meter',acknowledgeWarnings:true},admin);
   await denied(`invoices/${ids.a2invoice}/revise`,{input:{currentElectric:10},reason:'locked'},admin,409);
   await ok('periods/lock',{buildingId:ids.A2,month:'2026-10',locked:false,reason:'Reset test'},admin);
   await ok(`invoices/${ids.a2invoice}/revise`,{input:{currentElectric:10},reason:'Correct tested reading'},admin);
   assert.equal((await ok(`invoices/check?buildingId=${ids.A2}&month=2026-10`,undefined,admin)).valid,1);
  });
  await t.test('period lock/unlock and meter inheritance',async()=>{
   await denied('periods/lock',{buildingId:ids.A1,month:'2026-10',locked:true,reason:'No review of missing room'},admin,409);
   await ok('periods/lock',{buildingId:ids.A1,month:'2026-10',locked:true,reason:'Confirmed vacant room 202',acknowledgeMissing:true},admin);
   await denied(`invoices/${ids.a1invoice}/revise`,{input:{currentElectric:131},reason:'late'},admin,409);
   await denied('payments',{invoiceId:ids.a1invoice,amount:1,method:'CASH',reference:'E2E-003'},admin,409);
   await ok('periods/lock',{buildingId:ids.A1,month:'2026-10',locked:false,reason:'Reopen for validation'},admin);
   await ok('periods',{buildingId:ids.A1,month:'2026-11'},admin);
   const november=await ok('invoices',{roomId:ids.a1room,month:'2026-11',input:{currentElectric:145,currentWater:3}},admin);
   assert.equal(november.input.previousElectric,130);assert.equal(november.input.previousWater,0);
   assert.equal(november.input.electricRate,4000);
   await ok('periods',{buildingId:ids.A1,month:'2026-12'},admin);
   await denied('invoices',{roomId:ids.a1room,month:'2026-12',input:{previousElectric:130,currentElectric:152,previousWater:3,currentWater:4}},admin,409);
   const december=await ok('invoices',{roomId:ids.a1room,month:'2026-12',reason:'Meter physically replaced, verified with tenant',input:{previousElectric:130,currentElectric:152,previousWater:3,currentWater:4}},admin);
   assert.equal(december.input.previousElectric,130);
   const check=await ok(`invoices/check?buildingId=${ids.A1}&month=2026-12`,undefined,admin);
   assert.equal(check.warnings,1);assert.equal(check.missing,1);
   assert.match(check.rooms[0].warnings.join(' '),/kỳ trước/);
   await denied('periods/lock',{buildingId:ids.A1,month:'2026-12',locked:true,reason:'Need both acknowledgments',acknowledgeMissing:true},admin,409);
   await ok('periods/lock',{buildingId:ids.A1,month:'2026-12',locked:true,reason:'Both vacant room and meter replacement verified',acknowledgeMissing:true,acknowledgeWarnings:true},admin);
  });
  await t.test('least-privilege access and reporting',async()=>{
   const collector=await ok('users',{email:'collector@example.com',password:'Collector_password_123!',role:'COLLECTOR',buildingIds:[ids.A1]},admin);
   const viewer=await ok('users',{email:'viewer@example.com',password:'Viewer_password_123!',role:'VIEWER',buildingIds:[ids.A2]},admin);
   assert.ok(collector.id);assert.ok(viewer.id);
   const collectorCookie=(await request('login',{email:'collector@example.com',password:'Collector_password_123!'})).cookie;
   const viewerCookie=(await request('login',{email:'viewer@example.com',password:'Viewer_password_123!'})).cookie;
   await denied('rooms',{buildingId:ids.A1,code:'202',rent:10},collectorCookie,403);
   await denied('periods',{buildingId:ids.A1,month:'2026-12'},collectorCookie,403);
   await denied('invoices',{roomId:ids.a1room,month:'2026-10',input:{}},collectorCookie,403);
   await denied('dashboard?buildingId='+ids.A2+'&month=2026-10',undefined,collectorCookie,403);
   await denied(`invoices/check?buildingId=${ids.A2}&month=2026-10`,undefined,collectorCookie,403);
   await denied(`invoices/${ids.a4invoice}`,undefined,collectorCookie,403);
   await denied('payments',{invoiceId:ids.a2invoice,amount:1,method:'CASH',reference:'C-1'},collectorCookie,403);
   await denied('assistant/preview',{message:'sửa giá điện nhà A1 lên 500đ/kwh'},collectorCookie,403);
   await ok('payments',{invoiceId:ids.a1invoice,amount:100,method:'CASH',reference:'COL-1'},collectorCookie);
   await denied('payments',{invoiceId:ids.a2invoice,amount:1,method:'CASH',reference:'VIEW-1'},viewerCookie,403);
   await denied('rooms',{buildingId:ids.A2,code:'505'},viewerCookie,403);
   await denied('users',undefined,viewerCookie,403);
   const report=await ok('reports/collectors?month=2026-10',undefined,collectorCookie);
   assert.ok(report.every(x=>x.building_code==='A1'));
   const collectorSummary=await ok('dashboard/summary?month=2026-10',undefined,collectorCookie);
   assert.deepEqual(collectorSummary.buildings.map(x=>x.code),['A1']);
   assert.deepEqual([collectorSummary.totals.rooms,collectorSummary.totals.invoiced,collectorSummary.totals.paid,collectorSummary.totals.overpaid],[2,1,5000100,282900]);
   const viewerSummary=await ok('dashboard/summary?month=2026-10',undefined,viewerCookie);
   assert.deepEqual(viewerSummary.buildings.map(x=>x.code),['A2']);
   assert.equal(viewerSummary.totals.total,3038000);
   const ownCheck=await ok(`invoices/check?buildingId=${ids.A2}&month=2026-10`,undefined,viewerCookie);
   assert.equal(ownCheck.valid,1);
   await denied(`invoices/check?buildingId=${ids.A1}&month=2026-10`,undefined,viewerCookie,403);
   assert.ok((await ok('audit',undefined,admin)).some(x=>x.action==='AI_WATER_EDIT'));
  });
  await t.test('persist data on restart and reject invalid values',async()=>{
   await denied(`invoices/${ids.a1invoice}/revise`,{input:{currentElectric:10},reason:'Invalid'},admin,400);
   await denied('payments',{invoiceId:ids.a1invoice,amount:-2,method:'CASH',reference:'BAD'},admin,400);
   await stop();await start();
   const newCookie=(await request('login',{email,password})).cookie;
   const result=await ok(`invoices/${ids.a1invoice}`,undefined,newCookie);
   assert.equal(result.paid,5000100);assert.equal(result.version,2);
   assert.equal((await ok('rooms?buildingId='+ids.A2,undefined,newCookie))[0].occupants,3);
   assert.equal((await ok('dashboard/summary?month=2026-10',undefined,newCookie)).totals.paid,5000100);
  });
  await t.test('payment journal CSV download: scoped, authenticated and injection-safe',async()=>{
   const url=`http://127.0.0.1:${port}/api/payments/export?buildingId=${ids.A1}&month=2026-10`;
   const anon=await fetch(url);
   assert.equal(anon.status,401);
   const signed=(await request('login',{email,password})).cookie;
   const bad=await fetch(`http://127.0.0.1:${port}/api/payments/export?buildingId=${ids.A1}&month=invalid`,{headers:{Cookie:signed}});
   assert.equal(bad.status,400);
   const viewer=(await request('login',{email:'viewer@example.com',password:'Viewer_password_123!'})).cookie;
   const forbidden=await fetch(url,{headers:{Cookie:viewer}});
   assert.equal(forbidden.status,403);
   const allowed=await fetch(`http://127.0.0.1:${port}/api/payments/export?buildingId=${ids.A2}&month=2026-10`,{headers:{Cookie:viewer}});
   assert.equal(allowed.status,200);
   assert.equal((await allowed.text()).trim().split('\r\n').length,1);
   await ok('payments',{invoiceId:ids.a1invoice,amount:1,method:'CASH',reference:'=HYPERLINK("https://evil.example","x")'},signed);
   const res=await fetch(url,{headers:{Cookie:signed}});
   assert.equal(res.status,200);
   assert.match(res.headers.get('content-type'),/^text\/csv/);
   assert.match(res.headers.get('content-disposition'),/attachment/);
   assert.equal(res.headers.get('cache-control'),'no-store');
   const csv=await res.text();
   assert.ok(csv.startsWith('"Mã giao dịch"'),'Fetch decodes and strips UTF-8 BOM');
   assert.ok(csv.includes('"\'=HYPERLINK(""https://evil.example"",""x"")"'));
   assert.ok(csv.includes('"3000000"'));
   assert.ok(csv.includes('"2000000"'));
   assert.ok(!csv.includes('A2.504'));
  });
  await t.test('invoice correction preview, optimistic version, permission, payment preservation and next-month warning',async()=>{
   const session=(await request('login',{email,password})).cookie;
   const current=await ok(`invoices/${ids.a1invoice}`,undefined,session);
   const path=`invoices/${ids.a1invoice}`;
   const proposed={input:{extras:800},expectedVersion:current.version,reason:'Đối soát khoản phụ phí'};
   const first=await ok(`${path}/preview`,proposed,session);
   assert.equal(first.changed,true);
   assert.equal(first.delta,800);
   assert.equal(first.newTotal,current.total+800);
   assert.equal(first.paid,current.paid);
   assert.equal(first.carryover,null);
   assert.equal((await ok(path,undefined,session)).version,current.version,'preview must be read-only');
   const noop=await ok(`${path}/preview`,{input:{extras:current.input.extras},expectedVersion:current.version},session);
   assert.equal(noop.changed,false);
   await denied(`${path}/revise`,{input:{extras:current.input.extras},reason:'No change'},session,409);
   await denied(`${path}/preview`,{input:{extras:800},expectedVersion:current.version+1},session,409);
   await denied(`${path}/preview`,{input:{unknown:5},expectedVersion:current.version},session,400);
   await denied(`${path}/revise`,{input:{extras:-1},reason:'Invalid'},session,400);
   await denied(`${path}/revise`,{input:{extras:800},reason:' '},session,400);
   const viewer=(await request('login',{email:'viewer@example.com',password:'Viewer_password_123!'})).cookie;
   const collector=(await request('login',{email:'collector@example.com',password:'Collector_password_123!'})).cookie;
   await denied(`${path}/preview`,{input:{extras:800}},viewer,403);
   await denied(`${path}/preview`,{input:{extras:800}},collector,403);
   await denied(`${path}/revise`,proposed,collector,403);
   const saved=await ok(`${path}/revise`,proposed,session);
   assert.equal(saved.version,current.version+1);
   assert.equal(saved.total,current.total+800);
   assert.equal(saved.paid,current.paid);
   assert.equal(saved.overpaid,Math.max(saved.paid-saved.total,0));
   await denied(`${path}/revise`,proposed,session,409);
   const oldNext=(await ok(`invoices?buildingId=${ids.A1}&month=2026-11`,undefined,session))[0];
   const meter=await ok(`${path}/preview`,{input:{currentElectric:135},expectedVersion:saved.version},session);
   assert.equal(meter.delta,19000);
   assert.equal(meter.carryover.month,'2026-11');
   await denied(`${path}/revise`,{input:{currentElectric:135},reason:'Kiểm tra lại điện',expectedVersion:saved.version},session,409);
   const fixed=await ok(`${path}/revise`,{input:{currentElectric:135},reason:'Kiểm tra lại điện',expectedVersion:saved.version,acknowledgeCarryover:true},session);
   assert.equal(fixed.version,saved.version+1);
   assert.equal(fixed.total,saved.total+19000);
   assert.equal(fixed.paid,current.paid);
   assert.equal((await ok(`invoices/${oldNext.id}`,undefined,session)).input.previousElectric,oldNext.input.previousElectric);
   const versions=await ok(`${path}/versions`,undefined,session);
   assert.equal(versions.length,fixed.version);
   assert.equal(versions[0].total,fixed.total);
   assert.ok(versions.some(v=>v.reason==='Kiểm tra lại điện'));
   const totals=await ok(`dashboard?buildingId=${ids.A1}&month=2026-10`,undefined,session);
   assert.equal(totals.total,fixed.total);
   assert.equal(totals.paid,current.paid);
   assert.equal(totals.overpaid,fixed.overpaid);
   const revisions=await ok('audit',undefined,session);
   assert.ok(revisions.some(x=>x.action==='REVISE'&&x.entity_id===ids.a1invoice&&x.reason==='Kiểm tra lại điện'));
  });
  await t.test('AI electric meter: permission, stale review, carried meter, paid balance, versions and audit',async()=>{
   const session=(await request('login',{email,password})).cookie;
   await ok('periods',{buildingId:ids.A4,month:'2026-11'},session);
   const later=await ok('invoices',{roomId:ids.a4room,month:'2026-11',input:{currentElectric:3,currentWater:50}},session);
   assert.equal(later.input.previousElectric,0);
   await ok('payments',{invoiceId:ids.a4invoice,amount:1000000,method:'TRANSFER',reference:'AI-ELECTRIC-PAID'},session);
   const viewer=(await request('login',{email:'viewer@example.com',password:'Viewer_password_123!'})).cookie;
   const collector=(await request('login',{email:'collector@example.com',password:'Collector_password_123!'})).cookie;
   const message='Sửa chỉ số điện mới phòng A4.301 thành 5 tháng 10/2026';
   await denied('assistant/preview',{message},viewer,403);
   await denied('assistant/preview',{message},collector,403);
   await denied('assistant/preview',{message:'Sửa điện mới A4.301 thành -1',month:'2026-10'},session,400);
   const old=await ok(`invoices/${ids.a4invoice}`,undefined,session);
   const stale=await ok('assistant/preview',{message},session);
   assert.equal(stale.type,'electric_reading');
   assert.equal(stale.items[0].newTotal-stale.items[0].oldTotal,19000);
   assert.equal(stale.items[0].impact.month,'2026-11');
   await ok(`invoices/${ids.a4invoice}/revise`,{input:{extras:100},reason:'Documented additional charge'},session);
   await denied('assistant/apply',{previewId:stale.previewId,acknowledgeCarryover:true},session,409);
   const fresh=await ok('assistant/preview',{message},session);
   await denied('assistant/apply',{previewId:fresh.previewId},session,409);
   const result=await ok('assistant/apply',{previewId:fresh.previewId,acknowledgeCarryover:true,reason:'Verified electricity meter photo'},session);
   assert.equal(result.invoiceId,ids.a4invoice);
   assert.match(result.reply,/hóa đơn/);
   const updated=await ok(`invoices/${ids.a4invoice}`,undefined,session);
   assert.equal(updated.input.currentElectric,5);
   assert.equal(updated.total,old.total+100+19000);
   assert.equal(updated.paid,old.paid);
   assert.equal(updated.due,updated.total-updated.paid);
   assert.equal(updated.version,old.version+2);
   assert.equal((await ok(`invoices/${later.id}`,undefined,session)).input.previousElectric,0);
   const versions=await ok(`invoices/${ids.a4invoice}/versions`,undefined,session);
   assert.equal(versions.length,updated.version);
   assert.equal(versions[0].total,updated.total);
   const actions=await ok('audit',undefined,session);
   assert.ok(actions.some(a=>a.action==='AI_ELECTRIC_EDIT'&&a.entity_id===ids.a4invoice&&a.reason==='Verified electricity meter photo'));
   await denied('assistant/preview',{message},session,409);
   await denied('assistant/apply',{previewId:fresh.previewId,acknowledgeCarryover:true},session,409);
   await ok('periods/lock',{buildingId:ids.A4,month:'2026-10',locked:true,reason:'Reviewed electricity and water edits'},session);
   await denied('assistant/preview',{message:'Sửa điện mới A4.301 thành 6',month:'2026-10'},session,409);
  });
  await t.test('AI uses the billing year when command names only a month',async()=>{
   const session=(await request('login',{email,password})).cookie;
   await ok('periods',{buildingId:ids.A4,month:'2027-10'},session);
   const inv=await ok('invoices',{roomId:ids.a4room,month:'2027-10',input:{previousElectric:0,currentElectric:10,previousWater:0,currentWater:0}},session);
   const proposal=await ok('assistant/preview',{message:'Sửa điện mới A4.301 thành 15 tháng 10',month:'2027-10'},session);
   assert.equal(proposal.items[0].month,'2027-10');
   assert.equal(proposal.items[0].invoiceId,inv.id);
   assert.equal(proposal.items[0].newTotal-proposal.items[0].oldTotal,19000);
   await ok('assistant/apply',{previewId:proposal.previewId},session);
   assert.equal((await ok(`invoices/${inv.id}`,undefined,session)).input.currentElectric,15);
   const explicit=await ok('assistant/preview',{message:'Sửa điện mới A4.301 thành 16 tháng 10/2027',month:'2026-10'},session);
   assert.equal(explicit.items[0].month,'2027-10','year explicitly named by user has precedence');
  });
  await t.test('delete invoice endpoint removes invoice, versions, payments and writes audit log',async()=>{
   const session=(await request('login',{email,password})).cookie;
   await ok('periods',{buildingId:ids.A1,month:'2027-02'},session);
   const inv=await ok('invoices',{roomId:ids.a1room,month:'2027-02',input:{previousElectric:0,currentElectric:10,previousWater:0,currentWater:0}},session);
   assert.ok(inv.id);
   const payment=await ok('payments',{invoiceId:inv.id,amount:100000,method:'CASH',reference:'TEST-DEL-PAYMENT'},session);
   assert.ok(payment.id);
   const delResult=await ok(`invoices/${inv.id}`,{reason:'Deleted during integration test'},session,'DELETE');
   assert.equal(delResult.ok,true);
   await denied(`invoices/${inv.id}`,undefined,session,404);
   const logs=await ok('audit',undefined,session);
   assert.ok(logs.some(l=>l.action==='DELETE'&&l.entity==='invoice'&&l.entity_id===inv.id));
  });
 }finally{await stop();rmSync(dataDir,{recursive:true,force:true});}
});
