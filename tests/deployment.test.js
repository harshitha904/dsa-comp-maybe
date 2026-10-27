import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../server/blob-store.js';

test('deployment snapshots isolate requests, retain updates, and roll back failed transactions', () => {
  const initial = { requests: [{ id: 'one', status: 'Pending' }], audit: [] };
  const first = memoryStore(initial), second = memoryStore(initial);
  const returned = first.all();
  returned.requests[0].status = 'Forged';
  assert.equal(first.all().requests[0].status, 'Pending');
  assert.throws(() => first.transaction(() => {
    first.put('requests', { id: 'one', status: 'Approved' });
    first.put('audit', { id: 'audit-one' });
    throw new Error('rollback');
  }));
  assert.deepEqual(first.all(), initial);
  assert.equal(first.dirty, false);
  first.transaction(() => {
    first.put('requests', { id: 'one', status: 'Approved' });
    first.put('audit', { id: 'audit-two' });
  });
  assert.equal(first.dirty, true);
  assert.equal(first.all().requests.length, 1);
  assert.equal(first.all().audit.length, 1);
  assert.deepEqual(second.all(), initial);
  assert.deepEqual(initial, { requests: [{ id: 'one', status: 'Pending' }], audit: [] });
});

import { createServer } from 'node:http';
import { createHandler } from '../api/index.js';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { seedData } from '../server/seed.js';

async function withHandler(overrides, run) {
  const server = createServer(createHandler(overrides));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const body = { type: 'Customer', name: 'Storage Adapter Probe', country: 'Singapore', identifier: 'PROBE-101', email: 'probe@example.invalid', requester: 'Deployment test', details: { segment: 'Direct account', terms: 'Net 30', credit: 1000 } };

test('raw HTTP wrapper waits for durable save before returning created response', async () => {
  let saved = false;
  await withHandler({
    loadState: async () => ({ state: seedData(), etag: 'version-one' }),
    saveState: async (state, etag) => {
      assert.equal(etag, 'version-one');
      assert.ok(state.requests.some(r => r.name === body.name));
      await new Promise(resolve => setTimeout(resolve, 20));
      saved = true;
    },
  }, async url => {
    const response = await fetch(`${url}/api/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.equal(saved, true);
    assert.equal((await response.json()).name, body.name);
  });
});

for (const [label, error, expected] of [
  ['conditional-write conflict', new BlobPreconditionFailedError(), 409],
  ['storage failure', new Error('offline'), 503],
]) test(`raw HTTP wrapper returns no success on ${label}`, async () => {
  await withHandler({
    loadState: async () => ({ state: seedData(), etag: 'version-one' }),
    saveState: async () => { throw error; },
  }, async url => {
    const response = await fetch(`${url}/api/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, expected);
    const payload = await response.json();
    assert.ok(payload.error);
    assert.equal(payload.id, undefined);
  });
});

test('missing durable storage fails closed on raw HTTP reads', async () => {
  await withHandler({ loadState: async () => { throw new Error('no credentials'); } }, async url => {
    const response = await fetch(`${url}/api/bootstrap`);
    assert.equal(response.status, 503);
    assert.ok((await response.json()).error);
  });
});

import { loadBlobState } from '../server/blob-store.js';
test('private compressed GET weak ETags normalize to the origin conditional-write token', async () => {
  const result = await loadBlobState({ getBlob: async () => ({ statusCode: 200, stream: new Response(JSON.stringify({ requests: [] })).body, blob: { etag: 'W/"origin-hash"' } }) });
  assert.equal(result.etag, '"origin-hash"');
});

test('competing cold-start initialization requires a successful durable read with an ETag', async () => {
  let calls = 0;
  await assert.rejects(loadBlobState({
    getBlob: async () => ++calls === 1 ? null : { statusCode: 200, blob: { etag: '' } },
    putBlob: async () => { throw new Error('competing write or storage outage'); },
  }), /competing write or storage outage/);
});
