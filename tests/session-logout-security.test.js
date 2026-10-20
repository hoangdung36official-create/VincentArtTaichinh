import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

async function freePort(){
 const socket=net.createServer();
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 return port;
}

test('logout revokes its session token without affecting later logins', {timeout:20000},async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-session-security-'));
 const port=await freePort();
 const email='session@test.example',password='Session_Test_Password_12345!';
 const child=spawn(process.execPath,['src/server.js'],{
  cwd:resolve('.'),
  env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},
  stdio:['ignore','pipe','pipe']
 });
 const request=async(path,body,cookie,extraHeaders={})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
   method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extraHeaders},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json(),setCookie:response.headers.get('set-cookie')};
 };
 try{
  await new Promise((resolveReady,reject)=>{
   let output='';
   const timer=setTimeout(()=>reject(Error('Server startup timeout: '+output)),8000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timer);resolveReady();}});
   child.stderr.on('data',chunk=>{output+=chunk;});
   child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${output}`));});
  });

  const login=await request('login',{email,password});
  assert.equal(login.status,200);
  assert.match(login.setCookie,/^session=[a-f0-9]{64};/);
  assert.match(login.setCookie,/HttpOnly/);
  assert.match(login.setCookie,/SameSite=Strict/);
  const oldSession=login.setCookie.split(';')[0];
  assert.equal((await request('me',undefined,oldSession)).status,200);

  const blocked=await request('logout',{},oldSession,{'Sec-Fetch-Site':'cross-site'});
  assert.equal(blocked.status,403,'cross-site logout must be rejected');
  assert.equal((await request('me',undefined,oldSession)).status,200,'blocked request must not revoke session');

  const logout=await request('logout',{},oldSession);
  assert.equal(logout.status,200);
  assert.match(logout.setCookie,/Max-Age=0/);
  assert.equal((await request('me',undefined,oldSession)).status,401,'replayed session token must be invalid');
  assert.equal((await request('buildings',undefined,oldSession)).status,401,'replayed token must not access protected data');
  assert.equal((await request('logout',{},oldSession)).status,401,'repeated logout must not renew a revoked session');

  const again=await request('login',{email,password});
  assert.equal(again.status,200);
  const newSession=again.setCookie.split(';')[0];
  assert.notEqual(newSession,oldSession);
  assert.equal((await request('me',undefined,newSession)).status,200);
  assert.equal((await request('me',undefined,oldSession)).status,401);
 }finally{
  child.kill();
  await new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',done);setTimeout(done,1500);});
  rmSync(dataDir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
