import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {sampleXlsx} from './xlsx-fixture.js';

const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const workspace=resolve('.');
async function freePort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const n=s.address().port;await new Promise(ok=>s.close(ok));return n;}
async function until(fn,label,ms=7000){const began=Date.now();let last;while(Date.now()-began<ms){try{const result=await fn();if(result)return result;}catch(e){last=e;}await new Promise(r=>setTimeout(r,75));}throw Error(`Timeout: ${label}. ${last||''}`);}
class DevTools {
 constructor(websocket){this.ws=websocket;this.next=0;this.pending=new Map();websocket.addEventListener('message',event=>{const value=JSON.parse(event.data);const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);value.error?p.reject(Error(JSON.stringify(value.error))):p.resolve(value.result);});}
 async send(method,params={}){const id=++this.next;return await new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+JSON.stringify(r.exceptionDetails.exception));return r.result.value;}
 async screenshot(path){const r=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path,Buffer.from(r.data,'base64'));}
 close(){this.ws.close();}
}

test('Chromium UI: finance lifecycle, CSV/XLSX, AI, journal/export, invoice print, lock/unlock and mobile', {skip:!browser?'Chromium browser unavailable':false,timeout:70000}, async()=>{
 const tmp=mkdtempSync(join(tmpdir(),'vincent-browser-'));
 const chromeProfile=join(tmp,'profile'),db=join(tmp,'db');
 const appPort=await freePort(),debugPort=await freePort();
 const app=spawn(process.execPath,['src/server.js'],{cwd:workspace,env:{...process.env,PORT:String(appPort),VINCENT_DATA_DIR:db,ADMIN_EMAIL:'browser@example.com',ADMIN_PASSWORD:'Browser_Test_123456!'},stdio:'ignore'});
 const chrome=spawn(browser,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${chromeProfile}`,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-allow-origins=*',`http://127.0.0.1:${appPort}/`],{stdio:'ignore'});
 let cdp;
 try{
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${appPort}/`);return r.ok;},'application startup');
  const tab=await until(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);return (await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);},'Chrome debugging');
  const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
  cdp=new DevTools(ws);await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await until(()=>cdp.evaluate('document.documentElement.dataset.appReady === "true"'),'application script ready');
  assert.equal(await cdp.evaluate('document.title'),'VINCENT ART | Tài chính');
  await cdp.evaluate(`document.querySelector('#loginForm [name="email"]').value='browser@example.com';document.querySelector('#loginForm [name="password"]').value='Browser_Test_123456!';document.querySelector('#loginForm').requestSubmit()`);
  await until(()=>cdp.evaluate("!document.querySelector('#shell').hidden"),'login completed');
  await cdp.evaluate("document.querySelector('#monthSelect').value='2026-10';document.querySelector('#monthSelect').dispatchEvent(new Event('change'))");
  await cdp.evaluate("document.querySelector('[data-page=buildings]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#addBuilding")'),'building form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#addBuilding');f.elements.code.value='A1';f.elements.name.value='Tòa A1';f.requestSubmit()})()");
  await until(()=>cdp.evaluate('document.querySelector("#buildingSelect").options.length===1'),'building created');
  await cdp.evaluate("document.querySelector('[data-page=rooms]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#addRoom")'),'room form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#addRoom');f.elements.code.value='201';f.elements.rent.value='4300000';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('4.300.000')"),'room created');
  await cdp.evaluate("document.querySelector('[data-page=imports]').click()");
  await until(()=>cdp.evaluate("!!document.querySelector('#csvUpload')"),'CSV import form');
  await cdp.evaluate(`(()=>{const f=document.querySelector('#csvUpload');f.elements.month.value='2026-10';const csv='Phòng;Tháng;Điện cũ;Điện mới;Nước cũ;Nước mới;Tiền phòng;Giá điện;Tổng\\nA1.201;10/2026;86;125;0;0;4.300.000;3.800;4.448.200';const dt=new DataTransfer();dt.items.add(new File([csv],'a1-oct.csv',{type:'text/csv'}));f.elements.file.files=dt.files;f.requestSubmit();})()`);
  await until(()=>cdp.evaluate("!!document.querySelector('#csvConfirm')"),'CSV reviewed');
  assert.match(await cdp.evaluate("document.querySelector('#csvResult').textContent"),/1 phòng hợp lệ/);
  await cdp.evaluate("window.confirm=()=>true;document.querySelector('#csvConfirm').click()");
  await until(()=>cdp.evaluate("document.querySelector('#notice').textContent.includes('Đã nhập 1 hóa đơn')"),'CSV applied');
  await cdp.evaluate("document.querySelector('[data-page=invoices]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('4.448.200')"),'imported invoice visible');
  await cdp.evaluate("document.querySelector('#aiOpen').click();document.querySelector('#aiMessage').value='Sửa giá điện nhà A1 lên 4.000đ/kwh';document.querySelector('#aiForm').requestSubmit()");
  await until(()=>cdp.evaluate("!!document.querySelector('#aiAccept')"),'assistant proposal');
  await cdp.evaluate("document.querySelector('#aiAccept').click()");
  await until(()=>cdp.evaluate("document.querySelector('#aiLog').textContent.includes('Đã cập nhật thành công')"),'assistant confirmed');
  await cdp.evaluate("document.querySelector('#aiClose').click();document.querySelector('[data-page=payments]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#makePayment")'),'payment form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#makePayment');f.elements.amount.value='2000000';f.elements.method.value='TRANSFER';f.elements.reference.value='BROWSER-001';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('BROWSER-001')"),'payment journal after save');
  const paymentSnapshot=await cdp.evaluate("({due:document.querySelector('#content').textContent.includes('2.448.200'),journal:document.querySelector('#content').textContent.includes('Nhật ký giao dịch'),reviseHidden:[...document.querySelectorAll('[data-revise]')].every(b=>b.hidden),exportUrl:document.querySelector('a[download]')?.getAttribute('href')})");
  assert.equal(paymentSnapshot.due,true,'payment amount must reduce invoice balance');
  assert.equal(paymentSnapshot.journal,true);
  assert.equal(paymentSnapshot.reviseHidden,true,'payment page should not show invoice edit controls');
  assert.match(paymentSnapshot.exportUrl,/\/api\/payments\/export/);
  const csvDownload=await cdp.evaluate("(async()=>{const r=await fetch(document.querySelector('a[download]').href);return {status:r.status,disposition:r.headers.get('content-disposition'),text:await r.text()}})()");
  assert.equal(csvDownload.status,200);
  assert.match(csvDownload.disposition,/attachment/);
  assert.match(csvDownload.text,/BROWSER-001/);
  await cdp.evaluate("window.__invoicePrint=[];window.open=()=>({document:{open(){},write(v){window.__invoicePrint.push(v)},close(){}},close(){}});document.querySelector('[data-view]').click()");
  await until(()=>cdp.evaluate("window.__invoicePrint.join('').includes('Thông báo tiền thuê nhà')"),'payment page invoice view and print');
  assert.equal(await cdp.evaluate("window.__invoicePrint.join('').includes('4.448.200')"),true);

  await cdp.evaluate("document.querySelector('[data-page=reconciliation]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#title').textContent.includes('Đối soát tài chính') && document.querySelector('.recon-desktop tbody tr')!==null"),'reconciliation view with real ledger');
  const firstReconciliation=await cdp.evaluate("({rows:document.querySelectorAll('.recon-desktop tbody tr').length,text:document.querySelector('#content').textContent,download:document.querySelector('.recon-export')?.getAttribute('href')})");
  assert.equal(firstReconciliation.rows,1,'one A1 room invoiced');
  assert.match(firstReconciliation.text,/4\.448\.200/);
  assert.match(firstReconciliation.text,/2\.000\.000/);
  assert.match(firstReconciliation.text,/2\.448\.200/);
  assert.match(firstReconciliation.text,/Chuyển khoản/);
  assert.match(firstReconciliation.download,/\/api\/reports\/reconciliation\/export/);

  await cdp.evaluate("document.querySelector('[data-page=rooms]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#addRoom")'),'additional room form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#addRoom');f.elements.code.value='202';f.elements.rent.value='3600000';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('202')"),'second room created');
  await cdp.evaluate("document.querySelector('[data-page=invoices]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('1 chưa có hóa đơn')"),'missing invoice review');
  await cdp.evaluate("document.querySelector('[data-page=reconciliation]').click()");
  await until(()=>cdp.evaluate("document.querySelector('.recon-summary')?.textContent.includes('1 thiếu hóa đơn')"),'missing room in reconciliation view');
  assert.equal(await cdp.evaluate("[...document.querySelectorAll('.recon-desktop tbody tr')].some(x=>x.textContent.includes('202')&&x.textContent.includes('Thiếu hóa đơn'))"),true,'missing room explicitly listed in ledger');
  await cdp.evaluate("document.querySelector('[data-page=invoices]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('1 chưa có hóa đơn')"),'return to invoice review');
  assert.equal(await cdp.evaluate("!!document.querySelector('#periodToggle')"),true);
  await cdp.evaluate("window.prompt=()=> 'Browser reconciliation test';window.confirm=()=>false;document.querySelector('#periodToggle').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('Đang mở')"),'cancelled lock retains open period');
  await cdp.evaluate("window.confirm=()=>true;document.querySelector('#periodToggle').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('Đã khóa')"),'period locked');
  assert.equal(await cdp.evaluate("!document.querySelector('#makeInvoice')&&[...document.querySelectorAll('[data-revise]')].every(b=>b.hidden)"),true,'no invoice write controls on locked period');
  await cdp.evaluate("document.querySelector('[data-page=payments]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('Kỳ thu đã khóa')"),'locked payment view');
  assert.equal(await cdp.evaluate("!document.querySelector('#makePayment')"),true,'no payment entry on locked period');
  await cdp.evaluate("document.querySelector('[data-page=invoices]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#periodToggle')?.textContent.includes('Mở khóa')"),'unlock action visible');
  await cdp.evaluate("document.querySelector('#periodToggle').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('Đang mở')"),'period unlocked');
  assert.equal(await cdp.evaluate("!!document.querySelector('#makeInvoice')"),true,'invoice form restored after unlock');

  await cdp.evaluate("document.querySelector('[data-page=buildings]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#addBuilding")'),'second building form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#addBuilding');f.elements.code.value='A12';f.elements.name.value='Tòa A12';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("document.querySelector('#buildingSelect').options.length===2"),'second building created');
  await cdp.evaluate("(()=>{const s=document.querySelector('#buildingSelect');s.value=[...s.options].find(o=>o.textContent.includes('A12')).value;s.dispatchEvent(new Event('change'));document.querySelector('#monthSelect').value='2026-12';document.querySelector('#monthSelect').dispatchEvent(new Event('change'));document.querySelector('[data-page=rooms]').click()})()");
  await until(()=>cdp.evaluate('!!document.querySelector("#addRoom")'),'A12 room form');
  await cdp.evaluate("(()=>{const f=document.querySelector('#addRoom');f.elements.code.value='203';f.elements.rent.value='2000000';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('2.000.000')"),'A12 room created');
  await cdp.evaluate("document.querySelector('[data-page=imports]').click()");
  await until(()=>cdp.evaluate('!!document.querySelector("#csvUpload")'),'Excel upload form');
  const xlsxBase64=sampleXlsx();
  await cdp.evaluate(`(()=>{const f=document.querySelector('#csvUpload');f.elements.month.value='2026-12';const bytes=Uint8Array.from(atob('${xlsxBase64}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'a12-multiple-months.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));f.elements.file.files=dt.files;f.elements.file.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>cdp.evaluate("!document.querySelector('#sheetPicker').hidden && document.querySelector('#csvUpload').elements.sheetName.options.length===3"),'multi-sheet workbook selector');
  assert.equal(await cdp.evaluate("document.querySelector('#csvUpload').elements.sheetName.options[1].textContent.includes('11-2026')"),true);
  await cdp.evaluate("(()=>{const f=document.querySelector('#csvUpload');f.elements.sheetName.value='Tháng 12-2026';f.requestSubmit()})()");
  await until(()=>cdp.evaluate("!!document.querySelector('#csvConfirm')"),'December workbook preview');
  assert.match(await cdp.evaluate("document.querySelector('#csvResult').textContent"),/1 phòng hợp lệ.*0 dòng lỗi/);
  await cdp.evaluate("document.querySelector('#csvConfirm').click()");
  await until(()=>cdp.evaluate("document.querySelector('#notice').textContent.includes('Đã nhập 1 hóa đơn')"),'December workbook imported');
  await cdp.evaluate("document.querySelector('[data-page=invoices]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('2.038.000')"),'XLSX invoice visible in correct month');
  await cdp.evaluate("document.querySelector('[data-revise]').click()");
  await until(()=>cdp.evaluate("!!document.querySelector('.invoice-editor[open]')"),'invoice editor modal');
  assert.equal(await cdp.evaluate("document.querySelector('#editorSave').disabled"),true,'must review before editing');
  await cdp.evaluate("document.querySelector('#editorReview').click()");
  await until(()=>cdp.evaluate("document.querySelector('#editorPreview').textContent.includes('Chưa thay đổi')"),'no-op review detected');
  assert.equal(await cdp.evaluate("document.querySelector('#editorSave').disabled"),true,'no-op version is blocked');
  await cdp.evaluate("(()=>{const f=document.querySelector('#invoiceEditForm');f.elements.extras.value='800';f.elements.extras.dispatchEvent(new Event('input',{bubbles:true}));f.elements.reason.value='Đối chiếu lại phụ phí';document.querySelector('#editorReview').click()})()");
  await until(()=>cdp.evaluate("document.querySelector('#editorPreview').textContent.includes('800') && !document.querySelector('#editorSave').disabled"),'invoice delta reviewed');
  await cdp.evaluate("document.querySelector('#invoiceEditForm').requestSubmit()");
  await until(()=>cdp.evaluate("!document.querySelector('.invoice-editor') && document.querySelector('#content').textContent.includes('2.038.800')"),'invoice version saved from modal');
  assert.equal(await cdp.evaluate("document.querySelector('#content').textContent.includes('v2')"),true,'updated version displayed');
  await cdp.evaluate("document.querySelector('[data-revise]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#editorVersions').textContent.includes('Đối chiếu lại phụ phí')"),'editor version history');
  assert.equal(await cdp.evaluate("document.querySelector('#editorVersions').textContent.includes('v1')"),true,'original invoice version retained');
  await cdp.evaluate("document.querySelector('#editorClose').click()");

  await cdp.evaluate("document.querySelector('[data-page=reports]').click()");
  await until(()=>cdp.evaluate("document.querySelector('#title').textContent.includes('Báo cáo theo người thu')"),'real reports view');
   await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('Ma trận thu tiền theo tòa')"),'collector matrix loaded');
  const dir=join(workspace,'.artifacts');mkdirSync(dir,{recursive:true});
  await cdp.screenshot(join(dir,'vincent-desktop-audit.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:820,height:1180,deviceScaleFactor:1,mobile:false});
  await until(()=>cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),'tablet without horizontal document overflow');
  await cdp.screenshot(join(dir,'vincent-tablet-audit.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.evaluate("document.querySelector('#menu').click()");
  await until(()=>cdp.evaluate("document.querySelector('#sidebar').classList.contains('open')"),'mobile drawer');
  await new Promise(r=>setTimeout(r,300));
  await cdp.screenshot(join(dir,'vincent-mobile-audit.png'));
  assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),true,'unexpected horizontal page scrolling');
  await cdp.evaluate("document.querySelector('#aiOpen').click()");
  assert.equal(await cdp.evaluate("!!document.querySelector('#sidebar').classList.contains('open') && document.elementFromPoint(100, 500).closest('#sidebar')!==null"),true,'mobile drawer must remain usable while AI assistant is visible');
  await cdp.evaluate("document.querySelector('#aiClose').click()");
  for(const width of [320,375]){
   await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:true});
   assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),true,`horizontal document overflow at ${width}px`);
   assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('#nav')).overflowY==='auto' || getComputedStyle(document.querySelector('#nav')).overflowY==='scroll'"),true,`sidebar menu must scroll on narrow screens (${width}px)`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.evaluate("document.querySelector('[data-page=reconciliation]').click()");
  await until(()=>cdp.evaluate("document.querySelector('.recon-mobile .recon-card')!==null"),'mobile reconciliation cards');
  const phone=await cdp.evaluate("({cardCount:document.querySelectorAll('.recon-mobile .recon-card').length,desktopHidden:getComputedStyle(document.querySelector('.recon-desktop')).display==='none',mobileVisible:getComputedStyle(document.querySelector('.recon-mobile')).display!=='none',horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth+1,text:document.querySelector('.recon-mobile').textContent})");
  assert.equal(phone.cardCount,1);
  assert.equal(phone.desktopHidden,true);
  assert.equal(phone.mobileVisible,true);
  assert.equal(phone.horizontalOverflow,false);
  assert.match(phone.text,/2\.038\.800/);
  await cdp.screenshot(join(dir,'vincent-reconciliation-mobile-audit.png'));
  await cdp.evaluate("document.querySelector('#aiOpen').click();document.querySelector('#aiMessage').value='Sửa điện mới A12.203 thành 15 tháng 12';document.querySelector('#aiForm').requestSubmit()");
  await until(()=>cdp.evaluate("document.querySelector('#aiLog').textContent.includes('2.057.800') && !!document.querySelector('#aiAccept')"),'mobile AI meter change proposal with selected year');
  await cdp.screenshot(join(dir,'vincent-ai-mobile-audit.png'));
  await cdp.evaluate("document.querySelector('#aiAccept').click()");
  await until(()=>cdp.evaluate("document.querySelector('#aiLog').textContent.includes('Đã sửa và lưu phiên bản hóa đơn')"),'mobile AI meter change committed');
  await until(()=>cdp.evaluate("document.querySelector('#content').textContent.includes('2.057.800')"),'mobile live reconciliation refresh');
  // Export tests use the isolated browser database. Capture downloads without writing to the host.
  const newInvoice=await cdp.evaluate(`(async()=>{
   const buildings=await (await fetch('/api/buildings')).json();
   const b=buildings.find(x=>x.code==='A12');
   const headers={'Content-Type':'application/json'};
   const roomResponse=await fetch('/api/rooms',{method:'POST',headers,body:JSON.stringify({buildingId:b.id,code:'204',rent:1500000})});
   if(!roomResponse.ok)throw Error('Room creation: '+await roomResponse.text());
   const room=await roomResponse.json();
   const invoiceResponse=await fetch('/api/invoices',{method:'POST',headers,body:JSON.stringify({roomId:room.id,month:'2026-12',input:{previousElectric:0,currentElectric:1,previousWater:0,currentWater:0}})});
   if(!invoiceResponse.ok)throw Error('Invoice creation: '+await invoiceResponse.text());
   return (await invoiceResponse.json()).id;
  })()`);
  assert.ok(newInvoice);
  await cdp.evaluate(`(()=>{
   window.__imageDownloads=[];
   const create=URL.createObjectURL.bind(URL);
   URL.createObjectURL=blob=>{const url=create(blob);window.__imageDownloads.push({url,blob});return url;};
   HTMLAnchorElement.prototype.click=function(){window.__downloadName=this.download;};
  })()`);
  await cdp.evaluate("document.querySelector('#aiMessage').value='Xuất ảnh hóa đơn A12.203 tháng 12/2026';document.querySelector('#aiForm').requestSubmit()");
  await until(()=>cdp.evaluate("[...document.querySelectorAll('#aiLog button')].some(x=>x.textContent.includes('Tải PNG #'))"),'AI single image download action');
  await cdp.evaluate("[...document.querySelectorAll('#aiLog button')].filter(x=>x.textContent.includes('Tải PNG #')).at(-1).click()");
  await until(()=>cdp.evaluate('window.__imageDownloads.length===1'),'invoice PNG generated');
  const singleImage=await cdp.evaluate(`(async()=>{
   const blob=window.__imageDownloads[0].blob;
   return {type:blob.type,size:blob.size,name:window.__downloadName,signature:[...new Uint8Array(await blob.slice(0,8).arrayBuffer())]};
  })()`);
  assert.equal(singleImage.type,'image/png');
  assert.ok(singleImage.size>5000);
  assert.match(singleImage.name,/A12-203-2026-12-v3\.png$/);
  assert.deepEqual(singleImage.signature,[137,80,78,71,13,10,26,10]);
  await cdp.evaluate("document.querySelector('#aiMessage').value='Xuất ảnh hóa đơn nhà A12 tháng 12/2026';document.querySelector('#aiForm').requestSubmit()");
  await until(()=>cdp.evaluate("[...document.querySelectorAll('#aiLog button')].some(x=>x.textContent.includes('Tải ZIP ảnh 2 hóa đơn'))"),'AI batch image download action');
  await cdp.evaluate("[...document.querySelectorAll('#aiLog button')].filter(x=>x.textContent.includes('Tải ZIP ảnh 2 hóa đơn')).at(-1).click()");
  await until(()=>cdp.evaluate('window.__imageDownloads.length===2'),'invoice ZIP generated');
  const archive=await cdp.evaluate(`(async()=>{
   const blob=window.__imageDownloads[1].blob,bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);
   let pos=0;const names=[];let pngs=0;
   while(pos+30<bytes.length&&view.getUint32(pos,true)===0x04034b50){
    const length=view.getUint32(pos+18,true),nameLength=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true);
    names.push(new TextDecoder().decode(bytes.slice(pos+30,pos+30+nameLength)));
    const start=pos+30+nameLength+extra;
    if(bytes[start]===137&&bytes[start+1]===80&&bytes[start+2]===78&&bytes[start+3]===71)pngs++;
    pos=start+length;
   }
   return {type:blob.type,size:blob.size,name:window.__downloadName,names,pngs,central:view.getUint32(pos,true),end:view.getUint32(bytes.length-22,true),count:view.getUint16(bytes.length-12,true)};
  })()`);
  assert.equal(archive.type,'application/zip');
  assert.match(archive.name,/hoa-don-hang-loat-2-phong\.zip/);
  assert.deepEqual(archive.names.sort(),['hoa-don-A12-203-2026-12-v3.png','hoa-don-A12-204-2026-12-v1.png']);
  assert.equal(archive.pngs,2);
  assert.equal(archive.central,0x02014b50);
  assert.equal(archive.end,0x06054b50);
  assert.equal(archive.count,2);
 }finally{
  cdp?.close();chrome.kill();app.kill();
  await new Promise(resolve=>setTimeout(resolve,175));
  rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});
 }
});
