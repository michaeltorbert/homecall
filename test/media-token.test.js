import test from 'node:test';
import assert from 'node:assert/strict';
import { sealMediaTarget, openMediaTarget } from '../lib/media-token.mjs';
const secret = Buffer.alloc(32, 17).toString('base64url');
const payload = { sourceId: 'station', version: 'v1', target: { url: 'https://audio.example/live?private=canary', allowedOrigins: ['https://audio.example'], kind: 'audio' } };
test('authenticated capabilities conceal targets and round trip scope', async () => {
  const a = await sealMediaTarget(payload, secret, { now: 1000, ttlSeconds: 10 });
  const b = await sealMediaTarget(payload, secret, { now: 1000, ttlSeconds: 10 });
  assert.notEqual(a, b); assert.ok(!Buffer.from(a, 'base64url').includes(Buffer.from('audio.example')));
  assert.deepEqual(await openMediaTarget(a, secret, { now: 10000 }), payload);
  await assert.rejects(openMediaTarget(a, secret, { now: 11000 }), /expired/);
  await assert.rejects(openMediaTarget(a, secret, { now: 0 }));
  await assert.rejects(openMediaTarget(a, Buffer.alloc(32, 18).toString('base64url'), { now: 1000 }));
  const bytes = Buffer.from(a, 'base64url'); bytes[20] ^= 1;
  await assert.rejects(openMediaTarget(bytes.toString('base64url'), secret, { now: 1000 }));
});
test('tokens reject malformed, oversized payloads and lifetimes', async () => {
  for (const token of ['', 'a', 'a='.repeat(10000), '$']) await assert.rejects(openMediaTarget(token, secret));
  await assert.rejects(sealMediaTarget(payload, 'a'));
  await assert.rejects(sealMediaTarget(payload, secret, { ttlSeconds: 86401 }));
  await assert.rejects(sealMediaTarget({ ...payload, target: { ...payload.target, url: 'x'.repeat(4097) } }, secret));
});
test('ISO catalog versions retain exact scope', async () => {
  const data = { ...payload, version: '2026-09-18T10:11:12.000Z' };
  const token = await sealMediaTarget(data, secret);
  assert.deepEqual(await openMediaTarget(token, secret), data);
});
