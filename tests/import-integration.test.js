import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {sampleXlsx} from './xlsx-fixture.js';

const root=resolve('.');
const adminPassword='Import_Test_Password_123!';
const header='Phòng;Tháng;Điện cũ;Điện mới;Nước cũ;Nước mới;Tiền phòng;Internet;Vệ sinh;Giá điện;Giá nước;Tổng';
const row201='A12.201;10/2026;86;125;0;0;4.300.000;100.000;150.000;3.800;0;4.698.200';
const row202='A12.202;10/2026;0;10;0;0;2.000.000;0;0;3.800;0;2.038.000';
const csv=(...rows)=>[header,...rows].join('\n');

async function port(){const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const value=socket.address().port;await new Promise(r=>socket.close(r));return value;}

test('reviewed CSV import: money reconciliation, building scopes, atomic apply, locks and carryover', {timeout:30000},async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-csv-e2e-'));
 const listen=await port();
 const server=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(listen),ADMIN_EMAIL:'import.admin@example.com',ADMIN_PASSWORD:adminPassword},stdio:['ignore','pipe','pipe']});
 let messages='';
 try{
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Startup timeout '+messages)),7000);server.stdout.on('data',c=>{messages+=c;if(messages.includes('Vincent ART:')){clearTimeout(timer);yes();}});server.stderr.on('data',c=>messages+=c);server.on('exit',code=>{clearTimeout(timer);no(Error('Startup exit '+code+' '+messages));});});
  async function request(path,body,cookie){
   const response=await fetch(`http://127.0.0.1:${listen}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function ok(path,body,cookie){const x=await request(path,body,cookie);assert.equal(x.status,200,`${path}: ${JSON.stringify(x.data)}`);return x.data;}
  async function denied(path,body,cookie,status){const x=await request(path,body,cookie);assert.equal(x.status,status,`${path}: ${JSON.stringify(x.data)}`);return x.data;}
  const admin=(await request('login',{email:'import.admin@example.com',password:adminPassword})).cookie;
  const bid=(await ok('buildings',{code:'A12',name:'Building A12',electricRate:3800},admin)).id;
  const other=(await ok('buildings',{code:'A13',name:'Building A13'},admin)).id;
  const room201=(await ok('rooms',{buildingId:bid,code:'201',rent:4300000,internet:100000,cleaning:150000},admin)).id;
  await ok('rooms',{buildingId:bid,code:'202',rent:2000000},admin);
  await ok('rooms',{buildingId:other,code:'201',rent:900000},admin);
  const scope=(await ok('users',{email:'import.accountant@example.com',password:'Accountant_Import_123!',role:'ACCOUNTANT',buildingIds:[bid]},admin));
  assert.ok(scope.id);
  const accountant=(await request('login',{email:'import.accountant@example.com',password:'Accountant_Import_123!'})).cookie;
  const input=(buildingId,source,month='2026-10')=>({buildingId,month,csv:source});

  await t.test('detect 800 VND mismatch instead of changing financial total',async()=>{
   const p=await ok('imports/preview',input(bid,csv(row201.replace('4.698.200','4.699.000'))),admin);
   assert.equal(p.ready,0);assert.equal(p.errors,1);assert.match(p.rows[0].message,/800đ/);assert.equal(p.previewId,undefined);
  });
  await t.test('reject unknown buildings, rooms, duplicate rooms and partial files',async()=>{
   await denied('imports/preview',input(other,csv(row201)),accountant,403);
   const wrong=await ok('imports/preview',input(other,csv(row201)),admin);
   assert.equal(wrong.errors,1);assert.match(wrong.rows[0].message,/tòa khác/);
   const missing=await ok('imports/preview',input(bid,csv(row201.replace('A12.201','A12.999'))),admin);
   assert.equal(missing.errors,1);assert.match(missing.rows[0].message,/Không tìm thấy phòng/);
   const duplicate=await ok('imports/preview',input(bid,csv(row201,row201)),admin);
   assert.equal(duplicate.ready,1);assert.equal(duplicate.errors,1);assert.equal(duplicate.previewId,undefined);
   const count=await ok('invoices?buildingId='+bid+'&month=2026-10',undefined,admin);
   assert.equal(count.length,0,'preview must never persist invoices');
  });
  await t.test('skip another month and constrain preview token to reviewing user',async()=>{
   const historical=row202.replace('10/2026','09/2026');
   const preview=await ok('imports/preview',input(bid,csv(row201,historical)),admin);
   assert.equal(preview.ready,1);assert.equal(preview.skippedMonth,1);assert.equal(preview.errors,0);
   await denied('imports/apply',{previewId:preview.previewId},accountant,409);
   await ok('periods',{buildingId:bid,month:'2026-10'},admin);
   await ok('periods/lock',{buildingId:bid,month:'2026-10',locked:true,reason:'Verify import locking',acknowledgeMissing:true},admin);
   await denied('imports/apply',{previewId:preview.previewId},admin,409);
   await ok('periods/lock',{buildingId:bid,month:'2026-10',locked:false,reason:'Complete reviewed import'},admin);
   const receipt=await ok('imports/apply',{previewId:preview.previewId},admin);
   assert.equal(receipt.count,1);
   await denied('imports/apply',{previewId:preview.previewId},admin,409);
   const actual=await ok('invoices?buildingId='+bid+'&month=2026-10',undefined,admin);
   assert.equal(actual.length,1);assert.equal(actual[0].total,4698200);
   assert.equal((await ok(`invoices/${actual[0].id}/versions`,undefined,admin)).length,1);
  });
  await t.test('atomic rejection after preview if a room gains another invoice',async()=>{
   const preview=await ok('imports/preview',input(bid,csv(row202)),admin);
   assert.equal(preview.ready,1);
   const created=await ok('invoices',{roomId:(await ok('rooms?buildingId='+bid,undefined,admin)).find(x=>x.code==='202').id,month:'2026-10',input:{previousElectric:0,currentElectric:10,previousWater:0,currentWater:0}},admin);
   assert.equal(created.total,2038000);
   await denied('imports/apply',{previewId:preview.previewId},admin,409);
   assert.equal((await ok('invoices?buildingId='+bid+'&month=2026-10',undefined,admin)).length,2);
   const retry=await ok('imports/preview',input(bid,csv(row201,row202)),admin);
   assert.equal(retry.ready,0);assert.equal(retry.errors,2);
  });
  await t.test('revising prior readings requires acknowledging the following month',async()=>{
   await ok('periods',{buildingId:bid,month:'2026-11'},admin);
   const next=await ok('invoices',{roomId:room201,month:'2026-11',input:{currentElectric:140,currentWater:2}},admin);
   assert.equal(next.input.previousElectric,125);assert.equal(next.input.previousWater,0);
   const oct=(await ok('invoices?buildingId='+bid+'&month=2026-10',undefined,admin)).find(x=>x.room_code==='201');
   const attempt={input:{currentElectric:130},reason:'Meter photo correction'};
   const blocked=await denied(`invoices/${oct.id}/revise`,attempt,admin,409);
   assert.match(blocked.error,/2026-11/);
   const revised=await ok(`invoices/${oct.id}/revise`,{...attempt,acknowledgeCarryover:true},admin);
   assert.equal(revised.total-oct.total,19000);
   assert.equal((await ok(`invoices/${next.id}`,undefined,admin)).input.previousElectric,125);
   const ai=await ok('assistant/preview',{message:'Sửa nước mới của A12.201 thành 5 tháng 10/2026'},admin);
   assert.match(ai.reply,/tháng 2026-11/);
   assert.equal(ai.items[0].impact.month,'2026-11');
   await denied('assistant/apply',{previewId:ai.previewId},admin,409);
   await ok('assistant/apply',{previewId:ai.previewId,acknowledgeCarryover:true},admin);
   assert.equal((await ok(`invoices/${next.id}`,undefined,admin)).input.previousWater,0);
   assert.equal((await ok(`invoices/${oct.id}/versions`,undefined,admin)).length,3);
   const logs=await ok('audit',undefined,admin);
   assert.ok(logs.some(x=>x.action==='IMPORT_CSV'));
   const waterAudit=logs.find(x=>x.action==='AI_WATER_EDIT');
   assert.ok(waterAudit);
   assert.equal(JSON.parse(waterAudit.after_data).carryoverReview.month,'2026-11');
  });
  await t.test('Excel multi-sheet import: exact month, 1,000 VND reconciliation and one-time approval',async()=>{
   await ok('rooms',{buildingId:bid,code:'203',rent:2000000},admin);
   const base64=sampleXlsx();
   const sheets=await ok('imports/sheets',{buildingId:bid,xlsxBase64:base64},accountant);
   assert.deepEqual(sheets.sheets.map(x=>x.month),['2026-11','2026-12']);
   await denied('imports/sheets',{buildingId:other,xlsxBase64:base64},accountant,403);
   const wrong=await denied('imports/preview',{buildingId:bid,month:'2026-11',xlsxBase64:base64,sheetName:'Tháng 12-2026'},admin,400);
   assert.match(wrong.error,/không phải kỳ/);
   const mismatch=await ok('imports/preview',{buildingId:bid,month:'2026-12',xlsxBase64:sampleXlsx({total:2039000})},admin);
   assert.equal(mismatch.ready,0);assert.equal(mismatch.errors,1);
   assert.match(mismatch.rows[0].message,/1000đ/);
   const proposal=await ok('imports/preview',{buildingId:bid,month:'2026-12',xlsxBase64:base64},admin);
   assert.equal(proposal.sheetName,'Tháng 12-2026');
   assert.equal(proposal.skippedHeaderRows,2);
   assert.equal(proposal.ready,1);
   assert.equal((await ok('invoices?buildingId='+bid+'&month=2026-12',undefined,admin)).length,0);
   const applied=await ok('imports/apply',{previewId:proposal.previewId},admin);
   assert.equal(applied.count,1);
   await denied('imports/apply',{previewId:proposal.previewId},admin,409);
   const invoices=await ok('invoices?buildingId='+bid+'&month=2026-12',undefined,admin);
   assert.equal(invoices.length,1);assert.equal(invoices[0].total,2038000);
  });
 }finally{
  server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,1200);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
});
