// Local static server allowlist against a fixture build directory. Not a Pages or device check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
test('static server serves the index, flat assets and the one artwork PNG at the root and under /homecall/, and nothing else', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homecall-static-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'assets')); await mkdir(path.join(dir, 'now-playing'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html>index');
  await writeFile(path.join(dir, 'assets', 'app-1.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'now-playing', 'homecall-512.png'), PNG);
  await writeFile(path.join(dir, 'now-playing', 'homecall-512.svg'), '<svg/>');
  await writeFile(path.join(dir, 'now-playing', 'PROVENANCE.md'), 'doc');
  await writeFile(path.join(dir, 'secret.json'), '{}');
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', HOMECALL_STATIC_ROOT: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await exited; } });
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(Error('Server startup timed out')), 5000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    child.on('exit', code => { clearTimeout(timeout); reject(Error('Server exited ' + code)); });
  });
  // Raw paths: http.request does not normalize dot segments or encodings.
  const get = (target, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(base + target, { method }, response => { const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) })); });
    req.on('error', reject); req.end();
  });
  for (const prefix of ['', '/homecall']) {
    const index = await get(`${prefix}/`);
    assert.equal(index.status, 200, prefix); assert.equal(index.headers['content-type'], 'text/html'); assert.equal(index.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get(`${prefix}/assets/app-1.js`)).headers['content-type'], 'text/javascript');
    const art = await get(`${prefix}/now-playing/homecall-512.png?v=1`);
    assert.equal(art.status, 200); assert.equal(art.headers['content-type'], 'image/png'); assert.equal(art.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(art.body, PNG);
    const head = await get(`${prefix}/now-playing/homecall-512.png`, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body.length, 0);
    for (const target of ['/now-playing/homecall-512.svg', '/now-playing/PROVENANCE.md', '/now-playing/', '/now-playing/other.png', '/secret.json', '/index.html',
      '/assets/../secret.json', '/assets/%2e%2e/secret.json', '/assets/.hidden', '/assets/%2Fsecret.json', '/assets/sub/app-1.js', '/now-playing/../secret.json'])
      assert.equal((await get(prefix + target)).status, 404, prefix + target);
  }
  for (const target of ['/homecall/homecall/', '/homecallx/', '/other/', '/homecall/now-playing/homecall-512.PNG']) assert.equal((await get(target)).status, 404, target);
  const redirect = await get('/homecall');
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.location, '/homecall/');
  assert.equal((await get('/homecall/now-playing/homecall-512.png', 'POST')).status, 405);
  assert.equal((await get('/api/sync/teams', 'TRACE')).status, 405, 'API method checks are unchanged');
});
