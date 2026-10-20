import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';

test('AI invoice lookup finds a requested month older than the most recent 30 invoices', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'vincent-ai-lookup-'));
  const socket = net.createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      VINCENT_DATA_DIR: dataDir,
      PORT: String(port),
      ADMIN_EMAIL: 'history.admin@example.com',
      ADMIN_PASSWORD: 'Test_History_Admin_123!'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((done, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error(`Server startup timeout: ${output}`)), 8000);
      server.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('Vincent ART:')) { clearTimeout(timeout); done(); }
      });
      server.stderr.on('data', chunk => { output += chunk; });
      server.on('exit', code => { clearTimeout(timeout); reject(Error(`Server exited ${code}: ${output}`)); });
    });

    let cookie;
    const api = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (path === 'login') cookie = response.headers.get('set-cookie')?.split(';')[0];
      const result = await response.json();
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`);
      return result;
    };

    await api('login', { email: 'history.admin@example.com', password: 'Test_History_Admin_123!' });
    const building = await api('buildings', { code: 'A1', name: 'Test Building' });
    const room = await api('rooms', { buildingId: building.id, code: '201', rent: 1000 });
    let oldestId;
    for (let i = 0; i < 31; i++) {
      const month = new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 7);
      await api('periods', { buildingId: building.id, month });
      const invoice = await api('invoices', {
        roomId: room.id,
        month,
        input: { previousElectric: 0, currentElectric: 0, previousWater: 0, currentWater: 0 }
      });
      if (i === 0) oldestId = invoice.id;
    }
    const result = await api('assistant/preview', { message: 'Lấy hóa đơn A1.201 tháng 1/2023' });
    assert.deepEqual(result.invoices.map(invoice => invoice.id), [oldestId]);
    assert.equal(result.invoices[0].month, '2023-01');
  } finally {
    server.kill();
    await new Promise(done => {
      if (server.exitCode !== null) return done();
      server.once('exit', done);
      setTimeout(done, 1500);
    });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
