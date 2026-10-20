import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';

async function freePort(){
 const server=net.createServer();
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const port=server.address().port;
 await new Promise(done=>server.close(done));
 return port;
}

async function withIsolatedServer(fn,extraEnv={}){
 const dir=mkdtempSync(join(tmpdir(),'vincent-auth-boundary-'));
 const port=await freePort();
 const email='auth-audit@test.example',password='Auth_Audit_123456!';
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:resolve('.'),
  env:{...process.env,VINCENT_DATA_DIR:dir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password,...extraEnv},
  stdio:['ignore','pipe','pipe']
 });
 const request=async(path,body,cookie,headers={})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
   method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
 };
 try{
  await new Promise((done,reject)=>{
   let output='';
   const timer=setTimeout(()=>reject(Error('Server startup timed out: '+output)),8000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timer);done();}});
   child.stderr.on('data',chunk=>{output+=chunk;});
   child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${output}`));});
  });
  await fn({request,dir,port,email,password});
 }finally{
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
}

test('expired sessions, origin checks and valid same-origin requests', {timeout:20000},async()=>{
 await withIsolatedServer(async({request,dir,port,email,password})=>{
  const invalidOrigin=`https://outside.example`;
  assert.equal((await request('login',{email,password},undefined,{Origin:invalidOrigin})).status,403);
  const login=await request('login',{email,password},undefined,{Origin:`http://127.0.0.1:${port}`});
  assert.equal(login.status,200);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await request('me',undefined,cookie)).status,200);
  assert.equal((await request('logout',{},cookie,{Origin:invalidOrigin})).status,403);
  assert.equal((await request('me',undefined,cookie)).status,200,'invalid origin must not revoke session');
  assert.equal((await request('me',undefined,cookie,{'Sec-Fetch-Site':'cross-site'})).status,200,'GET may be read-only');
  assert.equal((await request('logout',{},cookie,{'Sec-Fetch-Site':'cross-site'})).status,403);
  const hash=createHash('sha256').update(cookie.slice('session='.length)).digest('hex');
  const db=new DatabaseSync(join(dir,'vincent.sqlite'));
  try{
   assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(hash).n,1);
   db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1000,hash);
  }finally{db.close();}
  assert.equal((await request('me',undefined,cookie)).status,401,'expired session cannot read data');
  assert.equal((await request('buildings',undefined,cookie)).status,401,'expired session cannot access buildings');
  assert.equal((await request('logout',{},cookie)).status,401,'expired session cannot perform logout');
  const renewed=await request('login',{email,password});
  assert.equal(renewed.status,200,'login without Origin remains supported for native clients');
  assert.notEqual(renewed.cookie.split(';')[0],cookie);
 });
});

test('eight failed logins lock out subsequent attempts, including forged proxy IP', {timeout:20000},async()=>{
 await withIsolatedServer(async({request,email,password})=>{
  for(let i=0;i<3;i++) assert.equal((await request('login',{email,password:'wrong-password'})).status,401);
  const reset=await request('login',{email,password});
  assert.equal(reset.status,200,'successful login clears failures before threshold');
  for(let i=0;i<8;i++) {
   const r=await request('login',{email,password:'wrong-password'},undefined,{'X-Forwarded-For':`198.51.100.${i+1}`});
   assert.equal(r.status,401,`failure ${i+1}`);
  }
  assert.equal((await request('login',{email,password:'wrong-password'},undefined,{'X-Forwarded-For':'203.0.113.1'})).status,429);
  assert.equal((await request('login',{email,password},undefined,{'X-Forwarded-For':'203.0.113.2'})).status,429,'valid password remains locked out');
 });
});

test('production login cookie carries Secure flag', {timeout:20000},async()=>{
 await withIsolatedServer(async({request,email,password})=>{
  const r=await request('login',{email,password});
  assert.equal(r.status,200);
  assert.match(r.cookie,/; Secure(?:;|$)/);
  assert.match(r.cookie,/HttpOnly/);
  assert.match(r.cookie,/SameSite=Strict/);
 },{NODE_ENV:'production'});
});
