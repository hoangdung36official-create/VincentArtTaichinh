import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';

const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const workspace = resolve('.');
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(fn, label, timeout = 8000) {
  const started = Date.now();
  let error;
  while (Date.now() - started < timeout) {
    try { if (await fn()) return; } catch (caught) { error = caught; }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timeout: ${label}. ${error ?? ''}`);
}

test('Tablet report heading, filters, and mobile navigation remain usable', {skip: !browser && 'Chromium unavailable', timeout: 45000}, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'vincent-responsive-'));
  const appPort = await freePort();
  const debugPort = await freePort();
  const app = spawn(process.execPath, ['src/server.js'], {
    cwd: workspace,
    env: {...process.env, PORT: String(appPort), VINCENT_DATA_DIR: join(temp, 'db'), ADMIN_EMAIL: 'responsive@example.com', ADMIN_PASSWORD: 'Responsive_Test_12345!'},
    stdio: 'ignore'
  });
  const chrome = spawn(browser, [
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(temp, 'chrome')}`,
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    `http://127.0.0.1:${appPort}/`
  ], {stdio: 'ignore'});
  let ws;
  let messageId = 0;
  const pending = new Map();
  const send = async (method, params = {}) => {
    const id = ++messageId;
    return await new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      ws.send(JSON.stringify({id, method, params}));
    });
  };
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok, 'isolated server start');
    let tab;
    await until(async () => {
      const result = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      tab = (await result.json()).find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl);
      return !!tab;
    }, 'Chromium debugger');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, {once: true});
      ws.addEventListener('error', reject, {once: true});
    });
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
    });
    await send('Runtime.enable');
    await until(() => evaluate('document.documentElement.dataset.appReady === "true"'), 'app ready');
    await evaluate(`document.querySelector('#loginForm [name="email"]').value='responsive@example.com';document.querySelector('#loginForm [name="password"]').value='Responsive_Test_12345!';document.querySelector('#loginForm').requestSubmit()`);
    await until(() => evaluate('!document.querySelector("#shell").hidden'), 'login');
    await evaluate('document.querySelector("[data-page=buildings]").click()');
    await until(() => evaluate('!!document.querySelector("#addBuilding")'), 'buildings form');
    await evaluate(`(()=>{const f=document.querySelector('#addBuilding');f.elements.code.value='A1';f.elements.name.value='Tòa A1';f.requestSubmit()})()`);
    await until(() => evaluate('document.querySelector("#buildingSelect").options.length === 1'), 'test building');
    await evaluate('document.querySelector("[data-page=reports]").click()');
    await until(() => evaluate('document.querySelector("#title").textContent.includes("Báo cáo theo người thu")'), 'report heading');
    await until(() => evaluate('document.querySelector("#content").textContent.includes("Ma trận thu tiền")'), 'report content');

    for (const width of [1024, 820, 768, 721, 390, 375, 320, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width <= 390});
      const layout = await evaluate(`(()=>{
        const heading=document.querySelector('.page-heading');
        const title=document.querySelector('#title');
        const filters=document.querySelector('.filters');
        const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const lineHeight=parseFloat(getComputedStyle(title).lineHeight);
        return {width:window.innerWidth,overflow:document.documentElement.scrollWidth>window.innerWidth+1,
          heading:rect(heading),title:rect(title),filters:rect(filters),
          filterItems:[...filters.children].map(rect), titleLines:title.getBoundingClientRect().height/lineHeight,
          sidebarVisible:getComputedStyle(document.querySelector('#sidebar')).position==='sticky'};
      })()`);
      console.log('responsive layout', JSON.stringify(layout));
      assert.equal(layout.overflow, false, `document overflow at ${width}px`);
      assert.ok(layout.filters.right <= width + 1, `filters clipped at ${width}px`);
      assert.ok(layout.filterItems.every(item => item.width >= 30), `filters collapsed at ${width}px`);
      if (width >= 721 && width <= 820) {
        assert.ok(layout.titleLines <= 1.2, `tablet heading wraps at ${width}px (${layout.titleLines.toFixed(1)} lines)`);
        assert.ok(layout.filters.top >= layout.title.bottom + 8 || layout.filters.left >= layout.title.right + 16,
          `tablet controls crowd the title at ${width}px`);
      }
    }
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    await evaluate('document.querySelector("#menu").click()');
    assert.equal(await evaluate('document.querySelector("#sidebar").classList.contains("open")'), true);
    await evaluate('document.querySelector("#closeMenu").click()');
    assert.equal(await evaluate('document.querySelector("#sidebar").classList.contains("open")'), false);
  } finally {
    ws?.close();
    chrome.kill();
    app.kill();
    await new Promise(resolve => setTimeout(resolve, 180));
    rmSync(temp, {recursive: true, force: true, maxRetries: 4, retryDelay: 150});
  }
});
