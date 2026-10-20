import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';

async function freePort(){
 const socket=net.createServer();
 await new Promise(done=>socket.listen(0,'127.0.0.1',done));
 const port=socket.address().port;
 await new Promise(done=>socket.close(done));
 return port;
}

test('cross-building invoice/reversal access and revoked AI/import previews preserve financial data',{timeout:30000},async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-rbac-audit-'));
 const port=await freePort();
 const email='rbac.audit.admin@example.com',password='Rbac_Audit_Admin_12345!';
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:resolve('.'),
  env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},
  stdio:['ignore','pipe','pipe']
 });
 let db;
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
 const denied=async(path,body,cookie,status)=>{
  const result=await request(path,body,cookie);
  assert.equal(result.status,status,`${path}: ${JSON.stringify(result.data)}`);
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
  const A1=(await ok('buildings',{code:'A1',name:'RBAC A1'},admin)).id;
  const A2=(await ok('buildings',{code:'A2',name:'RBAC A2'},admin)).id;
  const roomA1=(await ok('rooms',{buildingId:A1,code:'201',rent:1000},admin)).id;
  await ok('rooms',{buildingId:A1,code:'202',rent:1000},admin);
  const roomA2=(await ok('rooms',{buildingId:A2,code:'201',rent:1000},admin)).id;
  await ok('periods',{buildingId:A1,month:'2026-10'},admin);
  await ok('periods',{buildingId:A2,month:'2026-10'},admin);
  const input={previousElectric:0,currentElectric:1,previousWater:0,currentWater:0};
  const invoiceA1=(await ok('invoices',{roomId:roomA1,month:'2026-10',input},admin)).id;
  const invoiceA2=(await ok('invoices',{roomId:roomA2,month:'2026-10',input},admin)).id;
  const paymentA2=(await ok('payments',{invoiceId:invoiceA2,amount:200,method:'CASH',reference:'RBAC-A2-PAYMENT'},admin)).id;
  const roles={};
  for(const role of ['MANAGER','ACCOUNTANT','COLLECTOR','VIEWER']){
   const address=`rbac.${role.toLowerCase()}@example.com`;
   const secret=`Rbac_${role}_Password_123!`;
   const user=await ok('users',{email:address,password:secret,role,buildingIds:[A1]},admin);
   const login=await request('login',{email:address,password:secret});
   assert.equal(login.status,200);
   roles[role]={id:user.id,cookie:login.cookie};
  }
  const original=await ok(`invoices/${invoiceA2}`,undefined,admin);

  await t.test('A1 roles cannot read, preview, revise, reverse, or use AI against A2',async()=>{
   for(const [role,{cookie}] of Object.entries(roles)){
    await denied(`invoices/${invoiceA2}`,undefined,cookie,403);
    await denied(`invoices/${invoiceA2}/versions`,undefined,cookie,403);
    await denied(`invoices/${invoiceA2}/preview`,{input:{currentElectric:3},expectedVersion:1},cookie,403);
    await denied(`invoices/${invoiceA2}/revise`,{input:{currentElectric:3},expectedVersion:1,reason:'Cross-building audit check'},cookie,403);
    await denied(`payments/${paymentA2}/reverse`,{reason:'Cross-building audit check'},cookie,403);
    const command=role==='ACCOUNTANT'?'Sửa điện mới A2.201 thành 5 tháng 10/2026':'Sửa số người ở phòng A2.201 thành 3';
    await denied('assistant/preview',{message:command},cookie,403);
   }
   const after=await ok(`invoices/${invoiceA2}`,undefined,admin);
   assert.equal(after.version,original.version);
   assert.equal(after.total,original.total);
   assert.equal(after.paid,original.paid);
   assert.equal((await ok(`invoices/${invoiceA2}/versions`,undefined,admin)).length,1);
   assert.equal((await ok(`payments?buildingId=${A2}&month=2026-10`,undefined,admin))[0].reversed,0);
   assert.equal((await ok('audit',undefined,admin)).filter(x=>x.action==='REVERSE_PAYMENT').length,0);
  });

  // Revocation is performed only on the disposable test database. The server
  // must recheck building permissions when a previously authorized token applies.
  db=new DatabaseSync(join(dataDir,'vincent.sqlite'));
  await t.test('AI apply rejects a preview after building access is revoked',async()=>{
   const manager=roles.MANAGER;
   const proposal=await ok('assistant/preview',{message:'Sửa số người ở phòng A1.201 thành 3'},manager.cookie);
   assert.ok(proposal.previewId);
   db.prepare('DELETE FROM user_buildings WHERE user_id=? AND building_id=?').run(manager.id,A1);
   await denied('assistant/apply',{previewId:proposal.previewId},manager.cookie,403);
   assert.equal((await ok('rooms?buildingId='+A1,undefined,admin)).find(r=>r.id===roomA1).occupants,0);
  });

  await t.test('CSV import apply rejects a preview after building access is revoked',async()=>{
   const accountant=roles.ACCOUNTANT;
   const csv=[
    'Phòng;Tháng;Điện cũ;Điện mới;Nước cũ;Nước mới;Tiền phòng;Internet;Vệ sinh;Giá điện;Giá nước;Tổng',
    'A1.202;11/2026;0;0;0;0;1000;0;0;3800;0;1000'
   ].join('\n');
   const proposal=await ok('imports/preview',{buildingId:A1,month:'2026-11',csv},accountant.cookie);
   assert.equal(proposal.ready,1);
   assert.ok(proposal.previewId);
   db.prepare('DELETE FROM user_buildings WHERE user_id=? AND building_id=?').run(accountant.id,A1);
   await denied('imports/apply',{previewId:proposal.previewId},accountant.cookie,403);
   assert.deepEqual(await ok(`invoices?buildingId=${A1}&month=2026-11`,undefined,admin),[]);
   assert.equal((await ok(`periods?buildingId=${A1}`,undefined,admin)).some(p=>p.month==='2026-11'),false);
  });

  await t.test('authorized A1 edit and A2 admin reversal still work',async()=>{
   const edited=await ok(`invoices/${invoiceA1}/revise`,{input:{currentElectric:2},expectedVersion:1,reason:'Authorized RBAC control'},admin);
   assert.equal(edited.version,2);
   await ok(`payments/${paymentA2}/reverse`,{reason:'Authorized audit reversal'},admin);
   assert.equal((await ok(`invoices/${invoiceA2}`,undefined,admin)).paid,0);
  });
 } finally {
  db?.close();
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
