import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

const root=resolve('.');
const dataDir=mkdtempSync(join(tmpdir(),'vincent-sheet-test-'));
const email='admin.sheet@example.com',password='Sheet_Admin_Pass_123!';
let child,port;

async function serverPort(){
  const socket=net.createServer();
  await new Promise(res=>socket.listen(0,'127.0.0.1',res));
  const selected=socket.address().port;
  await new Promise(res=>socket.close(res));
  return selected;
}

async function start(){
  port=await serverPort();
  child=spawn(process.execPath,['src/server.js'],{
    cwd:root,env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']
  });
  let output='';
  await new Promise((yes,no)=>{
    const timeout=setTimeout(()=>no(Error('Timeout '+output)),8000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timeout);yes();}});
    child.stderr.on('data',chunk=>{output+=chunk;});
    child.on('exit',code=>{clearTimeout(timeout);no(Error('Exit '+code+' '+output));});
  });
}

async function stop(){
  if(child&&!child.killed){
    child.kill();
    await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  }
}

async function request(path,body,session,method=null){
  const headers={'Content-Type':'application/json'};
  if(session)headers.Cookie=session;
  const m=method||(body===undefined?'GET':'POST');
  const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:m,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json();
  return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}

test('spreadsheet API: 20 columns data, real-time formula persistence, invoice sync and period lock',async t=>{
  await start();
  try{
    const login=await request('login',{email,password});
    assert.equal(login.status,200);
    const admin=login.cookie;

    // Create building
    const bRes=await request('buildings',{code:'SH1',name:'Tòa Sheet Test',electricRate:3800,waterRate:25000},admin);
    assert.equal(bRes.status,200);
    const bid=bRes.data.id;

    // Create room
    const rRes=await request('rooms',{buildingId:bid,code:'101',rent:3500000},admin);
    assert.equal(rRes.status,200);
    const rid=rRes.data.id;

    // 1. GET /api/rooms/sheet
    const sheetGet=await request(`rooms/sheet?buildingId=${bid}&month=2026-10`,undefined,admin);
    assert.equal(sheetGet.status,200);
    assert.equal(sheetGet.data.buildingId,bid);
    assert.equal(sheetGet.data.month,'2026-10');
    assert.equal(sheetGet.data.rows.length,1);
    const row0=sheetGet.data.rows[0];
    assert.equal(row0.code,'101');
    assert.equal(row0.rent,3500000);
    assert.equal(row0.electricRate,3800);
    assert.equal(row0.waterRate,25000);

    // 2. POST /api/rooms/sheet - save 20 spreadsheet columns
    const sheetSave=await request('rooms/sheet',{
      buildingId:bid,
      month:'2026-10',
      rows:[{
        roomId:rid,
        rent:3500000,
        occupants:2,
        previousElectric:100,
        currentElectric:150,
        electricRate:4000,
        previousWater:10,
        currentWater:15,
        waterRate:25000,
        internetRate:100000,
        serviceRate:150000,
        evChargingCount:1,
        evChargingRate:100000,
        parkingCount:1,
        parkingRate:100000,
        extras:50000
      }]
    },admin);
    assert.equal(sheetSave.status,200);
    assert.equal(sheetSave.data.ok,true);
    assert.equal(sheetSave.data.saved,1);

    // 3. Verify invoice is synchronized with exact formula sum:
    // [1] rent = 3,500,000
    // [6] elec = (150-100)*4000 = 200,000
    // [10] water = (15-10)*25000 = 125,000
    // [11] internet = 100,000
    // [12]*[2] service = 150,000 * 2 = 300,000
    // [15] ev = 1 * 100,000 = 100,000
    // [18] parking = 1 * 100,000 = 100,000
    // [19] extras = 50,000
    // Total = 4,475,000 VND
    const invRes=await request(`invoices?buildingId=${bid}&month=2026-10`,undefined,admin);
    assert.equal(invRes.status,200);
    assert.equal(invRes.data.length,1);
    const invoice=invRes.data[0];
    assert.equal(invoice.total,4475000);

    // 4. Verify GET /api/rooms/sheet reflects the saved data
    const sheetGet2=await request(`rooms/sheet?buildingId=${bid}&month=2026-10`,undefined,admin);
    assert.equal(sheetGet2.status,200);
    const savedRow=sheetGet2.data.rows[0];
    assert.equal(savedRow.currentElectric,150);
    assert.equal(savedRow.currentWater,15);
    assert.equal(savedRow.occupants,2);
    assert.equal(savedRow.extras,50000);

    // 5. Verify period lock rejects spreadsheet edits
    await request('periods/lock',{buildingId:bid,month:'2026-10',locked:true,reason:'Chốt kỳ bảng tính'},admin);
    const sheetSaveLocked=await request('rooms/sheet',{
      buildingId:bid,
      month:'2026-10',
      rows:[{roomId:rid,rent:4000000}]
    },admin);
    assert.equal(sheetSaveLocked.status,409);
  }finally{
    await stop();
    try{rmSync(dataDir,{recursive:true,force:true});}catch(_){}
  }
});
