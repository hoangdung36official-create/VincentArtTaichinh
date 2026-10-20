import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(fn, label, timeout = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try { if (await fn()) return; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${label}; ${lastError ?? ''}`);
}

test('Android PWA assets install, mobile layout, and private API stay network-only', {timeout: 45000}, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vincent-pwa-'));
  const port = await freePort();
  const host = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'), stdio: 'ignore',
    env: {...process.env, PORT: String(port), HOST: '127.0.0.1',
      VINCENT_DATA_DIR: join(tmp, 'db'), ADMIN_EMAIL: 'pwa@test.local',
      ADMIN_PASSWORD: 'PWA_Install_Test_12345!'}
  });
  let chrome;
  let ws;
  try {
    await until(async () => (await fetch(host)).ok, 'isolated app server');
    const manifestResponse = await fetch(`${host}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type'), /^application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    for (const icon of manifest.icons) {
      const response = await fetch(new URL(icon.src, host));
      assert.equal(response.status, 200, icon.src);
      assert.match(response.headers.get('content-type'), /^image\/png/, icon.src);
      const png = Buffer.from(await response.arrayBuffer());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
      assert.equal(png.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
    }
    for (const path of ['/sw.js', '/pwa-install.js']) {
      const response = await fetch(`${host}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    for (const path of ['/icons/unknown.png', '/data/vincent.sqlite']) {
      assert.equal((await fetch(`${host}${path}`)).status, 404, path);
    }
    if (!browser) return;

    const debugPort = await freePort();
    chrome = spawn(browser, [
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(tmp, 'chrome')}`,
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', host
    ], {stdio: 'ignore'});
    let tab;
    await until(async () => {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      tab = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
      return !!tab;
    }, 'headless Chromium');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, {once: true});
      ws.addEventListener('error', reject, {once: true});
    });
    let nextId = 0;
    const calls = new Map();
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (!calls.has(data.id)) return;
      const {resolve, reject} = calls.get(data.id);
      calls.delete(data.id);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      calls.set(id, {resolve, reject});
      ws.send(JSON.stringify({id, method, params}));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await until(() => evaluate("document.documentElement.dataset.appReady === 'true'"), 'app boot');
    await until(() => evaluate('navigator.serviceWorker.controller !== null'), 'service worker controlling page');
    const appManifest = await send('Page.getAppManifest');
    assert.equal(appManifest.url, `${host}/manifest.webmanifest`);
    assert.equal(appManifest.errors.length, 0, JSON.stringify(appManifest.errors));
    const installability = await send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], JSON.stringify(installability));
    assert.equal(await evaluate("document.querySelectorAll('.pwa-install').length"), 2);
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);

    const cachedPaths = await evaluate(`(async () => {
      await fetch('/style.css');
      await fetch('/api/me');
      const names = await caches.keys();
      const paths = [];
      for (const name of names) {
        const cache = await caches.open(name);
        paths.push(...(await cache.keys()).map(request => new URL(request.url).pathname));
      }
      return paths;
    })()`);
    assert.ok(cachedPaths.includes('/style.css'), JSON.stringify(cachedPaths));
    assert.ok(cachedPaths.every(path => !path.startsWith('/api/') && !['/', '/index.html'].includes(path)),
      JSON.stringify(cachedPaths));
  } finally {
    ws?.close();
    chrome?.kill();
    app.kill();
    await new Promise(resolve => setTimeout(resolve, 180));
    rmSync(tmp, {recursive: true, force: true, maxRetries: 4, retryDelay: 150});
  }
});
