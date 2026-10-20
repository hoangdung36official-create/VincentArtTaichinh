import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';

const cwd=resolve('.');
const financeTables=['buildings','rooms','periods','invoices','invoice_versions','payments','payment_reversals'];
function cli(args,env,input){return spawnSync(process.execPath,['scripts/reset-admin.mjs',...args],{cwd,env,input,encoding:'utf8',timeout:25000});}
function inspect(dbPath,fn){const db=new DatabaseSync(dbPath,{readOnly:true});try{return fn(db);}finally{db.close();}}
function financeSnapshot(dbPath){return inspect(dbPath,db=>Object.fromEntries(financeTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));}
async function freePort(){
 const server=net.createServer();
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const port=server.address().port;
 await new Promise(done=>server.close(done));
 return port;
}

test('offline Admin recovery saves backup, revokes only Admin sessions and preserves financial rows',async()=>{
 const root=mkdtempSync(join(tmpdir(),'vincent-reset-admin-'));
 const dataDir=join(root,'data');mkdirSync(dataDir);
 const port=await freePort();
 const adminEmail='recovery@example.com';
 const legacyLogin='Admin';
 const newEmail='restored@example.com';
 const oldPassword='Original-Secure-Admin-123!';
 const updatedPassword='Updated-Secure-Admin-456!';
 const env={...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:adminEmail,ADMIN_PASSWORD:oldPassword};
 const endpoint=`http://127.0.0.1:${port}/api/`;
 const app=spawn(process.execPath,['src/server.js'],{cwd,env,stdio:'ignore'});
 const credentials=(email,password)=>fetch(endpoint+'login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 async function post(path,body,cookie){
  const response=await fetch(endpoint+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload;
 }
 try{
  let started=false;
  for(let i=0;i<80;i++){
   try{const response=await fetch(endpoint+'buildings');if(response.status===401){started=true;break;}}catch{}
   await new Promise(done=>setTimeout(done,100));
  }
  assert.ok(started,'application started');
  const adminResponse=await credentials(adminEmail,oldPassword);
  assert.equal(adminResponse.status,200);
  const adminCookie=adminResponse.headers.get('set-cookie').split(';')[0];

  const building=await post('buildings',{code:'A12',name:'Recovery Financial Data',electricRate:3800},adminCookie);
  const room=await post('rooms',{buildingId:building.id,code:'202',rent:4300000},adminCookie);
  await post('periods',{buildingId:building.id,month:'2026-10'},adminCookie);
  const invoice=await post('invoices',{roomId:room.id,month:'2026-10',input:{previousElectric:86,currentElectric:125,previousWater:0,currentWater:0}},adminCookie);
  await post('payments',{invoiceId:invoice.id,amount:2300000,method:'CASH',reference:'ADMIN-RECOVERY-PAY-1'},adminCookie);
  await post('users',{email:'collector@example.com',password:'Collector-Password-123!',role:'COLLECTOR',buildingIds:[building.id]},adminCookie);
  const collectorResponse=await credentials('collector@example.com','Collector-Password-123!');
  assert.equal(collectorResponse.status,200);
  const collectorCookie=collectorResponse.headers.get('set-cookie').split(';')[0];

  const dbPath=join(dataDir,'vincent.sqlite');
  const initial=financeSnapshot(dbPath);
  const beforeUsers=inspect(dbPath,db=>db.prepare('SELECT id,email,role FROM users ORDER BY id').all());
  const beforeAccess=inspect(dbPath,db=>db.prepare('SELECT * FROM user_buildings ORDER BY user_id,building_id').all());
  // Reproduce an existing Render account with a non-email login, without recreating the user.
  const writableLegacy=new DatabaseSync(dbPath);
  try{assert.equal(writableLegacy.prepare('UPDATE users SET email=? WHERE email=?').run(legacyLogin,adminEmail).changes,1);}
  finally{writableLegacy.close();}
  assert.equal(initial.payments[0].amount,2300000);
  assert.equal(initial.invoices[0].total,4448200);
  const list=cli(['--list'],env);
  assert.equal(list.status,0,list.stderr);
  assert.match(list.stdout,/Admin\s+SUPER_ADMIN/);
  assert.match(list.stdout,/collector@example\.com\s+COLLECTOR/);
  assert.doesNotMatch(list.stdout,/password_hash/i);

  for(const args of [
   ['--email','missing@example.com','--password-stdin'],
   ['--email','collector@example.com','--password-stdin'],
   ['--id','2','--password-stdin']
  ]){
   const rejected=cli(args,env,'Unused-Password-111!\nUnused-Password-111!\n');
   assert.notEqual(rejected.status,0);
  }
  const mismatched=cli(['--email',legacyLogin,'--new-email',newEmail,'--password-stdin'],env,'Another-Password-111!\nAnother-Password-222!\n');
  assert.notEqual(mismatched.status,0);
  const weak=cli(['--email',legacyLogin,'--password-stdin'],env,'short\nshort\n');
  assert.notEqual(weak.status,0);
  const malformed=cli(['--email',legacyLogin,'--new-email','invalid-email','--password-stdin'],env,'Unused-Password-111!\nUnused-Password-111!\n');
  assert.notEqual(malformed.status,0);
  assert.match(malformed.stderr,/Invalid new email/);
  const duplicate=cli(['--email',legacyLogin,'--new-email','COLLECTOR@example.com','--password-stdin'],env,'Unused-Password-111!\nUnused-Password-111!\n');
  assert.notEqual(duplicate.status,0);
  assert.match(duplicate.stderr,/New email belongs to another account/);
  const conflicting=cli(['--email',legacyLogin,'--id','1','--password-stdin'],env,'Unused-Password-111!\nUnused-Password-111!\n');
  assert.notEqual(conflicting.status,0);
  assert.equal(existsSync(join(dataDir,'backups')),false,'invalid password must not create backup');

  const reset=cli(['--email',legacyLogin,'--new-email',newEmail,'--password-stdin'],env,`${updatedPassword}\n${updatedPassword}\n`);
  assert.equal(reset.status,0,reset.stderr);
  assert.match(reset.stdout,/Revoked sessions: 1/);
  assert.doesNotMatch(reset.stdout+reset.stderr,new RegExp(updatedPassword));
  const files=readdirSync(join(dataDir,'backups')).filter(n=>n.endsWith('.sqlite'));
  assert.equal(files.length,1,'one durable pre-reset backup');
  const backupPath=join(dataDir,'backups',files[0]);
  assert.deepEqual(financeSnapshot(backupPath),initial,'backup contains all financial contents');
  assert.deepEqual(financeSnapshot(dbPath),initial,'live financial contents remain unchanged');
  assert.deepEqual(inspect(dbPath,db=>db.prepare('SELECT id,email,role FROM users ORDER BY id').all()).map(user=>({...user})),
   beforeUsers.map(user=>({...user,email:user.email===adminEmail?newEmail:user.email})),'same Admin id and role');
  assert.deepEqual(inspect(dbPath,db=>db.prepare('SELECT * FROM user_buildings ORDER BY user_id,building_id').all()),beforeAccess);
  assert.equal(inspect(dbPath,db=>db.prepare('PRAGMA integrity_check').get().integrity_check),'ok');

  const audit=inspect(dbPath,db=>db.prepare("SELECT * FROM audit_logs WHERE action='ADMIN_PASSWORD_RESET'").all());
  assert.equal(audit.length,1);
  assert.deepEqual(JSON.parse(audit[0].after_data),{email:newEmail,sessionsRevoked:1});
  assert.deepEqual(JSON.parse(audit[0].before_data),{email:legacyLogin});
  assert.doesNotMatch(JSON.stringify(audit),new RegExp(updatedPassword));
  assert.doesNotMatch(JSON.stringify(audit),/password_hash/);
  assert.equal(inspect(dbPath,db=>db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n),1,'collector session survives');

  assert.equal((await fetch(endpoint+'buildings',{headers:{Cookie:adminCookie}})).status,401,'old Admin cookie revoked');
  assert.equal((await fetch(endpoint+'buildings',{headers:{Cookie:collectorCookie}})).status,200,'other account still active');
  assert.equal((await credentials(legacyLogin,updatedPassword)).status,401,'old username rejected');
  assert.equal((await credentials(adminEmail,updatedPassword)).status,401,'initial username rejected');
  assert.equal((await credentials(newEmail,oldPassword)).status,401,'old password rejected');
  const newSession=await credentials(newEmail,updatedPassword);
  assert.equal(newSession.status,200,'new password works');
  const freshCookie=newSession.headers.get('set-cookie').split(';')[0];

  // Force audit INSERT to fail after password UPDATE / session DELETE; transaction must roll back.
  const writable=new DatabaseSync(dbPath);
  try{writable.exec("CREATE TRIGGER abort_admin_reset BEFORE INSERT ON audit_logs WHEN NEW.action='ADMIN_PASSWORD_RESET' BEGIN SELECT RAISE(ABORT,'forced test failure'); END");}
  finally{writable.close();}
  const failed=cli(['--id','1','--new-email','changed-after-failure@example.com','--password-stdin'],env,'Third-Password-Secure-789!\nThird-Password-Secure-789!\n');
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/forced test failure/);
  assert.equal((await fetch(endpoint+'buildings',{headers:{Cookie:freshCookie}})).status,200,'rollback restores Admin session');
  assert.equal((await credentials(newEmail,updatedPassword)).status,200,'rollback restores previous username and password');
  assert.equal((await credentials('changed-after-failure@example.com','Third-Password-Secure-789!')).status,401);
  assert.deepEqual(financeSnapshot(dbPath),initial);
  assert.equal(inspect(dbPath,db=>db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ADMIN_PASSWORD_RESET'").get().n),1);
  const removeTrigger=new DatabaseSync(dbPath);
  try{removeTrigger.exec('DROP TRIGGER abort_admin_reset');}finally{removeTrigger.close();}
  const passwordOnly=cli(['--id','1','--password-stdin'],env,'Password-Only-Reset-999!\nPassword-Only-Reset-999!\n');
  assert.equal(passwordOnly.status,0,passwordOnly.stderr);
  assert.equal((await credentials(newEmail,updatedPassword)).status,401);
  assert.equal((await credentials(newEmail,'Password-Only-Reset-999!')).status,200);
  assert.deepEqual(financeSnapshot(dbPath),initial);
 }finally{
  app.kill();
  await new Promise(done=>{if(app.exitCode!==null)return done();app.once('exit',done);setTimeout(done,1500);});
  rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});
 }
});

test('admin recovery refuses to create a missing production database',()=>{
 const root=mkdtempSync(join(tmpdir(),'vincent-reset-absent-'));
 try{
  const env={...process.env,VINCENT_DATA_DIR:join(root,'missing')};
  const result=cli(['--list'],env);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Database missing/);
  assert.equal(existsSync(env.VINCENT_DATA_DIR),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
