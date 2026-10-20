import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

// Optional regression with the owner's real workbook; never store a copy in the repo.
const source=process.env.A12_SOURCE_XLSX;
test('real A12 workbook: blocked preview cannot write to the database',{skip:!source||!existsSync(source),timeout:25000},async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'vincent-a12-preview-'));
 const socket=net.createServer();
 await new Promise(r=>socket.listen(0,'127.0.0.1',r));
 const port=socket.address().port;
 await new Promise(r=>socket.close(r));
 const password='Test_A12_2026_Password!';
 const child=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,VINCENT_DATA_DIR:dataDir,PORT:String(port),ADMIN_EMAIL:'a12-preview@example.invalid',ADMIN_PASSWORD:password,AI_API_KEY:'',AI_API_URL:'',AI_MODEL:''},stdio:['ignore','pipe','pipe']});
 let output='';
 try{
  await new Promise((done,fail)=>{
   const timer=setTimeout(()=>fail(Error('Server startup timeout')),7000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Vincent ART:')){clearTimeout(timer);done();}});
   child.stderr.on('data',chunk=>{output+=chunk;});
   child.once('exit',code=>{clearTimeout(timer);fail(Error(`Server exited ${code}: ${output.slice(0,1000)}`));});
  });
  const request=async(path,body,cookie)=>{
   const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{
    method:body===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
   });
   return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=await request('login',{email:'a12-preview@example.invalid',password});
  assert.equal(login.status,200);
  const cookie=login.cookie;
  const xlsxBase64=readFileSync(source).toString('base64');
  const sheets=await request('imports/initial/sheets',{xlsxBase64},cookie);
  assert.equal(sheets.status,200);
  assert.ok(sheets.data.sheets.some(s=>s.name==='Th.10'));
  const preview=await request('imports/initial/preview',{xlsxBase64,buildingCode:'A12',month:'2026-10'},cookie);
  assert.equal(preview.status,200,JSON.stringify(preview.data).slice(0,350));
  const plan=preview.data;
  assert.equal(plan.sheetName,'Th.10');
  assert.equal(plan.rows.length,19);
  assert.equal(plan.ready,8);
  assert.equal(plan.rows.filter(r=>r.status==='ERROR').length,11);
  assert.equal(plan.totals.stated,103707000);
  assert.equal(plan.totals.computed,103700400);
  assert.equal(plan.totals.stated-plan.totals.computed,6600);
  assert.equal(plan.previewId,undefined,'differences must block apply');
  assert.equal((await request('imports/initial/apply',{previewId:'unissued-preview-token'},cookie)).status,409);
  assert.deepEqual(await request('buildings',undefined,cookie).then(x=>x.data),[]);
  assert.deepEqual(await request('invoices?month=2026-10',undefined,cookie).then(x=>x.data),[]);
 }finally{
  child.kill();
  await new Promise(r=>child.once('exit',r)).catch(()=>{});
  rmSync(dataDir,{recursive:true,force:true});
 }
});
