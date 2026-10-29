import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

const portFree=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};

test('AI upgrade uses scoped, one-time preview and atomic financial edits',{timeout:30000},async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-ai-upgrade-'));
 const port=await portFree(),email='ai-upgrade@example.com',password='AI_Upgrade_123456!';
 const child=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,PORT:String(port),VINCENT_DATA_DIR:dataDir,ADMIN_EMAIL:email,ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 const req=async(path,body,cookie)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const ok=async(path,body,cookie)=>{const r=await req(path,body,cookie);assert.equal(r.status,200,`${path}: ${JSON.stringify(r.data)}`);return r.data;};
 const reject=async(path,body,cookie,status)=>{const r=await req(path,body,cookie);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.data)}`);};
 let admin;
 try{
  await new Promise((done,fail)=>{let out='';const timer=setTimeout(()=>fail(Error('Startup '+out)),8000);child.stdout.on('data',c=>{out+=c;if(out.includes('Vincent ART:')){clearTimeout(timer);done();}});child.stderr.on('data',c=>out+=c);child.once('exit',code=>{clearTimeout(timer);fail(Error('Exited '+code+out));});});
  admin=(await req('login',{email,password})).cookie;
  assert.ok(admin);
  const ask=(message,cookie=admin,month='2026-10')=>ok('assistant/preview',{message,month},cookie);
  const apply=(preview,cookie=admin,other={})=>ok('assistant/apply',{previewId:preview.previewId,...other},cookie);

  await t.test('V27 floor layout: validate, preview, atomically create 62 rooms and audit only after confirmation',async()=>{
   const message='Tạo tòa nhà v27 địa chỉ 11 ngõ 21/50/7 Yên xá, 62 phòng 3 phòng tầng 1, tầng 2-> 7 là 9p 1 tầng, tầng 8 có 5p';
   const invalid=message.replace('62 phòng','63 phòng');
   await reject('assistant/preview',{message:invalid},admin,400);
   await reject('assistant/preview',{message:message.replace('tầng 8 có 5p','tầng 8 có vài phòng')},admin,400);
   await reject('assistant/preview',{message:message.replace('tầng 8 có 5p','tầng 1 có 5p')},admin,400);
   const preview=await ask(message);
   assert.equal(preview.type,'create_building_floors');
   assert.equal(preview.items.length,63);
   assert.equal(preview.items[0].address,'11 ngõ 21/50/7 Yên xá');
   assert.deepEqual(preview.floors.map(f=>f.count),[3,9,9,9,9,9,9,5]);
   assert.match(preview.reply,/101–103/);
   assert.ok(!(await ok('buildings',undefined,admin)).some(b=>b.code==='V27'),'preview must not write to database');
   const created=await apply(preview);
   assert.match(created.reply,/62 phòng/);
   await reject('assistant/apply',{previewId:preview.previewId},admin,409);
   await reject('assistant/preview',{message},admin,409);
   const building=(await ok('buildings',undefined,admin)).find(b=>b.code==='V27');
   assert.ok(building);
   assert.equal(building.address,'11 ngõ 21/50/7 Yên xá');
   const rooms=await ok(`rooms?buildingId=${building.id}`,undefined,admin);
   assert.equal(rooms.length,62);
   assert.deepEqual(rooms.map(r=>r.code),[
    '101','102','103',...Array.from({length:6},(_,i)=>Array.from({length:9},(_,j)=>String((i+2)*100+j+1))).flat(),
    '801','802','803','804','805'
   ]);
   assert.ok(rooms.every(r=>r.rent===0),'unknown rents must not be invented');
   const logs=await ok('audit',undefined,admin);
   assert.equal(logs.filter(x=>x.action==='AI_CREATE_ROOM'&&x.entity_id===rooms[0].id).length,1);
   assert.ok(logs.some(x=>x.action==='AI_CREATE_BUILDING'&&x.entity_id===building.id));
  });

  await t.test('create buildings and 1–100 rooms with preserved Vietnamese names and no duplicate writes',async()=>{
   const p=await ask('Thêm tòa nhà A15 tên Tòa A15 địa chỉ 20 Lê Lợi giá điện 4.000 giá nước 10.000');
   assert.equal(p.items[0].name,'Tòa A15');assert.equal(p.items[0].address,'20 Lê Lợi');
   await apply(p);await reject('assistant/apply',{previewId:p.previewId},admin,409);
   const createdBuilding=(await ok('buildings',undefined,admin)).find(b=>b.code==='A15');
   assert.equal(createdBuilding.electric_rate,4000);
   assert.equal(createdBuilding.water_rate,10000);
   await reject('assistant/preview',{message:'Thêm tòa nhà A15'},admin,409);
   const rooms=await ask('Thêm các phòng 201,202,203 nhà A15 giá phòng 4.300.000 internet 100.000 vệ sinh 150.000');
   assert.equal(rooms.items.length,3);assert.equal(rooms.items[0].rent,4300000);
   await apply(rooms);
   await reject('assistant/preview',{message:'Thêm các phòng 201,204 nhà A15 giá phòng 3.000.000'},admin,409);
   const id=(await ok('buildings',undefined,admin)).find(b=>b.code==='A15').id;
   assert.deepEqual((await ok(`rooms?buildingId=${id}`,undefined,admin)).map(r=>r.code),['201','202','203']);
   await apply(await ask('Thêm phòng A15.401 giá phòng 3.000.000'));
   assert.equal((await ok(`rooms?buildingId=${id}`,undefined,admin)).find(r=>r.code==='401').rent,3000000);
  });

  const b=(await ok('buildings',undefined,admin)).find(b=>b.code==='A15');
  const rooms=await ok(`rooms?buildingId=${b.id}`,undefined,admin);
  const room=code=>rooms.find(r=>r.code===code);
  const manager=await ok('users',{email:'manager-ai@example.com',password:'Manager_AI_Password_123!',role:'MANAGER',buildingIds:[b.id]},admin);
  const viewer=await ok('users',{email:'viewer-ai@example.com',password:'Viewer_AI_Password_123!',role:'VIEWER',buildingIds:[b.id]},admin);
  const outsider=await ok('users',{email:'outsider-ai@example.com',password:'Outsider_AI_Password_123!',role:'MANAGER',buildingIds:[]},admin);
  const managerCookie=(await req('login',{email:'manager-ai@example.com',password:'Manager_AI_Password_123!'})).cookie;
  const viewerCookie=(await req('login',{email:'viewer-ai@example.com',password:'Viewer_AI_Password_123!'})).cookie;
  const outsiderCookie=(await req('login',{email:'outsider-ai@example.com',password:'Outsider_AI_Password_123!'})).cookie;
  assert.ok(manager.id&&viewer.id&&outsider.id);

  await t.test('search, debt and image lists are authorization-scoped; VIEWER cannot write',async()=>{
   assert.equal((await ask('Tìm phòng A15.201',viewerCookie)).records.length,1);
   await reject('assistant/preview',{message:'Thêm phòng A15.402 giá phòng 1000'},viewerCookie,403);
   await reject('assistant/preview',{message:'Thêm tòa nhà A16 tên Nhà A16'},managerCookie,403);
   await reject('assistant/preview',{message:'Tìm phòng A15.201'},outsiderCookie,403);
   await reject('assistant/preview',{message:'Xuất ảnh hóa đơn nhà A15 tháng 10/2026'},outsiderCookie,403);
   await reject('assistant/preview',{message:'Import Excel nhà A15'},outsiderCookie,403);
   assert.equal((await ask('Import Excel nhà A15',viewerCookie)).navigate,'imports');
  });

  await ok('periods',{buildingId:b.id,month:'2026-10'},admin);
  const baseInput={previousElectric:0,currentElectric:100,previousWater:0,currentWater:2};
  const first=(await ok('invoices',{roomId:room('201').id,month:'2026-10',input:baseInput},admin)).id;
  const second=(await ok('invoices',{roomId:room('202').id,month:'2026-10',input:baseInput},admin)).id;
  await ok('payments',{invoiceId:first,amount:1000000,method:'TRANSFER',reference:'AI-UPGRADE-PAYMENT'},admin);

  await t.test('batch meter changes keep payment, invoice history, total and one-time token',async()=>{
   const preview=await ask('Nhập điện mới nhà A15: 201=130, 202=140 tháng 10/2026');
   assert.equal(preview.items.length,2);
   await apply(preview);await reject('assistant/apply',{previewId:preview.previewId},admin,409);
   const after=await ok(`invoices/${first}`,undefined,admin);
   assert.equal(after.version,2);assert.equal(after.input.currentElectric,130);assert.equal(after.paid,1000000);
   assert.equal(after.total,4300000+100000+150000+130*4000+2*10000);
   assert.equal((await ok(`invoices/${first}/versions`,undefined,admin)).length,2);
   const water=await ask('Nhập nước mới nhà A15: 201=5, 202=7 tháng 10/2026');
   await apply(water);
   assert.equal((await ok(`invoices/${second}`,undefined,admin)).input.currentWater,7);
   const debts=await ask('Tìm công nợ nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(debts.records.find(x=>x.room==='201').paid,1000000);
   const list=await ask('Xuất ảnh hóa đơn nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(list.exportImages,true);assert.equal(list.invoices.length,2);
   assert.deepEqual(list.invoices.map(x=>x.id),[first,second]);
   const lookup=await ask('Lấy hóa đơn nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(lookup.invoices.length,2);
   await reject('assistant/preview',{message:'Nhập điện mới nhà A15: 201=150, 999=200 tháng 10/2026'},admin,404);
   assert.equal((await ok(`invoices/${first}`,undefined,admin)).input.currentElectric,130);
  });

  await t.test('new AI features: summary, missing invoices, high debt, toggle, room config, bulk update, delete invoice',async()=>{
   const summary=await ask('Tổng hợp tài chính nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(summary.type,'summary');assert.ok(summary.reply.includes('Tổng hợp'));
   const missing=await ask('Phòng nào chưa có hóa đơn nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(missing.type,'missing_invoices');assert.ok(missing.records.some(r=>r.code==='203'));
   const highDebt=await ask('Phòng nào nợ nhiều nhất nhà A15 tháng 10/2026',viewerCookie);
   assert.equal(highDebt.type,'high_debt');assert.ok(highDebt.records.length>0);

   const togglePrev=await ask('Tắt internet phòng A15.201');
   assert.equal(togglePrev.type,'toggle_service');assert.equal(togglePrev.items[0].to,0);
   await apply(togglePrev);
   const r201=(await ok(`rooms?buildingId=${b.id}`,undefined,admin)).find(r=>r.code==='201');
   assert.equal(r201.internet_enabled,0);

   const configPrev=await ask('Sửa giá dịch vụ A15.201 lên 170.000');
   assert.equal(configPrev.type,'update_room_config');
   await apply(configPrev);
   const r201b=(await ok(`rooms?buildingId=${b.id}`,undefined,admin)).find(r=>r.code==='201');
   assert.equal(r201b.service_rate,170000);

   const bulkPrev=await ask('Cập nhật giá dịch vụ tất cả phòng nhà A15 lên 170.000');
   assert.equal(bulkPrev.type,'bulk_service_update');
   await apply(bulkPrev);
   const r202=(await ok(`rooms?buildingId=${b.id}`,undefined,admin)).find(r=>r.code==='202');
   assert.equal(r202.service_rate,170000);

   const third=(await ok('invoices',{roomId:room('203').id,month:'2026-10',input:baseInput},admin)).id;
   const delPrev=await ask('Xóa hóa đơn A15.203 tháng 10/2026');
   assert.equal(delPrev.type,'delete_invoice');
   await apply(delPrev);
   await reject(`invoices/${third}`,undefined,admin,404);
  });

  await t.test('locked billing period denies AI edits and preserves ledger',async()=>{
   const preview=await ask('Nhập điện mới nhà A15: 201=135, 202=145 tháng 10/2026');
   // Test lock state directly through the authorized locking endpoint with acknowledged missing rooms.
   await ok('periods/lock',{buildingId:b.id,month:'2026-10',locked:true,reason:'AI upgrade regression',acknowledgeMissing:true,acknowledgeWarnings:true},admin);
   await reject('assistant/apply',{previewId:preview.previewId},admin,409);
   await reject('assistant/preview',{message:'Nhập điện mới nhà A15: 201=135, 202=145 tháng 10/2026'},admin,409);
   assert.equal((await ok(`invoices/${first}`,undefined,admin)).input.currentElectric,130);
  });
  const logs=await ok('audit',undefined,admin);
  assert.ok(logs.some(x=>x.action==='AI_CREATE_BUILDING'));
  assert.ok(logs.some(x=>x.action==='AI_CREATE_ROOM'));
  assert.ok(logs.some(x=>x.action==='AI_ELECTRIC_EDIT'));
  assert.ok(logs.some(x=>x.action==='AI_TOGGLE_SERVICE'));
  assert.ok(logs.some(x=>x.action==='AI_UPDATE_ROOM'));
  assert.ok(logs.some(x=>x.action==='AI_BULK_UPDATE_ROOMS'));
 }finally{child.kill();await new Promise(r=>child.once('exit',r));rmSync(dataDir,{recursive:true,force:true});}
});
