import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

const workspace=resolve('.');
async function freePort(){
 const server=net.createServer();
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const port=server.address().port;
 await new Promise(done=>server.close(done));
 return port;
}
function cli(script,args,env){return spawnSync(process.execPath,[script,...args],{cwd:workspace,env,encoding:'utf8',timeout:15000});}

test('online backup and safe verified restore preserve real financial data',async()=>{
 const tmp=mkdtempSync(join(tmpdir(),'vincent-restore-'));
 const live=join(tmp,'live'),backups=join(tmp,'backups'),staged=join(tmp,'staged');
 mkdirSync(live);
 const port=await freePort();
 const env={...process.env,VINCENT_DATA_DIR:live,PORT:String(port),ADMIN_EMAIL:'backup@example.com',ADMIN_PASSWORD:'Backup_Test_Password_123!'};
 const app=spawn(process.execPath,['src/server.js'],{cwd:workspace,env,stdio:'ignore'});
 try{
  const endpoint=`http://127.0.0.1:${port}/api/`;
  let ready=false;
  for(let i=0;i<60;i++){
   try{const r=await fetch(endpoint+'buildings');if(r.status===401){ready=true;break;}}catch{}
   await new Promise(done=>setTimeout(done,100));
  }
  assert.ok(ready,'server started');
  const login=await fetch(endpoint+'login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  async function post(path,body){
   const response=await fetch(endpoint+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
  }
  const building=await post('buildings',{code:'A12',name:'Backup test',electricRate:3800});
  const room=await post('rooms',{buildingId:building.id,code:'202',rent:4300000});
  await post('periods',{buildingId:building.id,month:'2026-10'});
  const invoice=await post('invoices',{roomId:room.id,month:'2026-10',input:{previousElectric:86,currentElectric:125,previousWater:0,currentWater:0}});
  assert.equal(invoice.total,4448200);
  await post('payments',{invoiceId:invoice.id,amount:2300000,method:'CASH',reference:'BACKUP-TEST-01'});

  const snapshot=cli('scripts/backup.mjs',[backups],env);
  assert.equal(snapshot.status,0,snapshot.stderr);
  const backupFile=join(backups,readdirSync(backups).find(name=>name.endsWith('.sqlite')));
  assert.ok(existsSync(backupFile));
  const restored=cli('scripts/restore.mjs',[backupFile,staged],env);
  assert.equal(restored.status,0,restored.stderr);
  assert.match(restored.stdout,/Verified restore staging/);
  const db=new DatabaseSync(join(staged,'vincent.sqlite'),{readOnly:true});
  try{
   assert.equal(db.prepare('SELECT COUNT(*) n FROM buildings').get().n,1);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_versions').get().n,1);
   assert.equal(db.prepare('SELECT total FROM invoices').get().total,4448200);
   assert.equal(db.prepare('SELECT SUM(amount) paid FROM payments').get().paid,2300000);
   assert.ok(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n>=4);
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{db.close();}

  const attemptedOverwrite=cli('scripts/restore.mjs',[backupFile,staged],env);
  assert.notEqual(attemptedOverwrite.status,0,'existing restore directory must remain untouched');
  assert.ok(existsSync(join(staged,'vincent.sqlite')));
  const activeOverwrite=cli('scripts/restore.mjs',[backupFile,live],env);
  assert.notEqual(activeOverwrite.status,0,'active database must not be overwritten');
  const bad=join(tmp,'invalid.sqlite');writeFileSync(bad,'not a SQLite database');
  const invalidRestored=join(tmp,'invalid-target');
  const attempt=cli('scripts/restore.mjs',[bad,invalidRestored],env);
  assert.notEqual(attempt.status,0,'corrupt backup must be rejected');
  assert.equal(existsSync(invalidRestored),false);
 }finally{
  app.kill();
  await new Promise(done=>{if(app.exitCode!==null)return done();app.once('exit',done);setTimeout(done,1000);});
  rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});
 }
});
