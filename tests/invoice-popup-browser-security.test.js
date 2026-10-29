import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';

const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
async function freePort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const port=s.address().port;await new Promise(ok=>s.close(ok));return port;}
async function until(fn,label,ms=15000){const start=Date.now();let error;while(Date.now()-start<ms){try{const value=await fn();if(value)return value;}catch(e){error=e;}await new Promise(r=>setTimeout(r,75));}throw Error(`Timeout: ${label}. ${error||''}`);}
async function connect(tab){
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true});});
 let next=0;const pending=new Map();
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);});
 const send=(method,params={})=>new Promise((ok,fail)=>{const id=++next;pending.set(id,{resolve:ok,reject:fail});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 await send('Runtime.enable');
 return {evaluate,send,close:()=>ws.close()};
}

test('real invoice popup prints and renders invoice CSS under the page CSP', {skip:!browser?'Chromium unavailable':false,timeout:45000},async()=>{
 const temp=mkdtempSync(join(tmpdir(),'vincent-popup-security-'));
 const appPort=await freePort(),debugPort=await freePort();
 const host=`http://127.0.0.1:${appPort}`;
 const server=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,VINCENT_DATA_DIR:join(temp,'db'),PORT:String(appPort),ADMIN_EMAIL:'print@test.example',ADMIN_PASSWORD:'Print_Test_12345!'},stdio:'ignore'});
 const chrome=spawn(browser,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${join(temp,'chrome')}`,'--headless=new','--no-sandbox','--disable-popup-blocking','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--remote-allow-origins=*',host],{stdio:'ignore'});
 const sessions=[];
 try{
  await until(async()=>{const r=await fetch(host);return r.status===200;},'server ready');
  let cookie='';
  const api=async(path,body)=>{
   const r=await fetch(`${host}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
   const data=await r.json();assert.equal(r.status,200,`${path}: ${JSON.stringify(data)}`);
   if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
   return data;
  };
  await api('login',{email:'print@test.example',password:'Print_Test_12345!'});
  const b=await api('buildings',{code:'A1',name:'A1',electricRate:3800});
  const room=await api('rooms',{buildingId:b.id,code:'201',rent:4300000});
  await api('periods',{buildingId:b.id,month:'2026-10'});
  const inv=await api('invoices',{roomId:room.id,month:'2026-10',input:{previousElectric:86,currentElectric:125,previousWater:0,currentWater:0}});
  const tabs=await until(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);return (await r.json()).filter(x=>x.type==='page'&&x.webSocketDebuggerUrl);},'Chromium CDP');
  const main=await connect(tabs[0]);sessions.push(main);
  await until(()=>main.evaluate('document.documentElement.dataset.appReady === "true"'),'scripts ready');
  await main.evaluate(`(()=>{const f=document.querySelector('#loginForm');f.elements.email.value='print@test.example';f.elements.password.value='Print_Test_12345!';f.requestSubmit()})()`);
  await until(()=>main.evaluate('!document.querySelector("#shell").hidden'),'browser login');
  await main.evaluate(`(()=>{document.querySelector('#monthSelect').value='2026-10';document.querySelector('#monthSelect').dispatchEvent(new Event('change'));document.querySelector('[data-page=invoices]').click()})()`);
  await until(()=>main.evaluate('!!document.querySelector("[data-view]")'),'invoice view button');
  await main.evaluate('document.querySelector("[data-view]").click()');
  const popup=await until(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);return (await r.json()).find(x=>x.type==='page'&&x.id!==tabs[0].id&&x.webSocketDebuggerUrl);},'real popup opened');
  const print=await connect(popup);sessions.push(print);
  await until(()=>print.evaluate(`document.body?.textContent?.includes('4.448.200')`),'invoice content');
  const view=await print.evaluate(`({bodyFont:getComputedStyle(document.body).fontFamily,styleSheetCount:document.styleSheets.length,button:document.querySelector('button')?.textContent,invoice:document.body.textContent.includes('4.448.200')})`);
  assert.equal(view.invoice,true);
  assert.match(view.bodyFont,/Arial/i,'invoice inline CSS must render');
  assert.match(view.button,/In \/ Lưu PDF/);
  const count=await print.evaluate(`(()=>{window.__countPrints=0;window.print=()=>{window.__countPrints++};document.querySelector('button').click();return window.__countPrints})()`);
  assert.equal(count,1,'print button must invoke print()');
  assert.ok(inv.id>0);
 }finally{
  for(const session of sessions)session.close();
  chrome.kill();server.kill();
  await new Promise(ok=>setTimeout(ok,200));
  rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
 }
});
