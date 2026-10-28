import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/index.js';
import { createStore } from '../server/db.js';
import { createHandler } from '../api/index.js';
import { seedData } from '../server/seed.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, user = 'management', body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'X-User-Id': user, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  };
}
const customer = name => ({ record_type: 'Customer', name, country: 'Singapore', entity: 'Lives Group', amount_usd: 1, basics: { regulated: false, credit_currency: 'SGD', credit_limit: 40000, credit_days: 30 } });

test('Express SQLite HTTP acceptance: owners, official record, notifications, reuse, policy and reset', async t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const api = await serve(t, createApp(store));
  const initial = await api('/tickets/T-1042');
  const id = initial.ticket.id;
  assert.deepEqual(initial.unlocks.filter(x => x.unlocked).map(x => x.key), ['quote']);
  await api(`/tickets/${id}/sections/credit_terms/complete`, 'management', { fields: {} }, 'POST', 403);
  await api(`/tickets/${id}/sections/licence_TH/complete`, 'wei', { fields: { licence_reference: 'NO' } }, 'POST', 403);
  await api(`/tickets/${id}/official`, 'priya', {}, 'POST', 409);
  const financed = await api(`/tickets/${id}/sections/credit_terms/complete`, 'wei', { fields: {} });
  assert.equal(financed.unlocks.find(x => x.key === 'sell_on_credit').unlocked, true);
  assert.equal(financed.unlocks.find(x => x.key === 'deliver_in_Thailand').unlocked, false);
  await api(`/tickets/${id}/sections/licence_TH/complete`, 'nurul', { fields: { licence_reference: 'TH-HTTP-1042' } });
  const ready = notifications => notifications.filter(n => n.ticket_id === id && n.kind === 'final_ready' && n.channel === 'in-app' && !n.read && !n.acted);
  assert.equal(ready(await api('/users/priya/notifications', 'priya')).length, 1);
  assert.equal(ready(await api('/users/priya/notifications', 'priya')).length, 1);
  await api(`/tickets/${id}/official`, 'management', {}, 'POST', 403);
  const complete = await api(`/tickets/${id}/official`, 'priya', {});
  assert.equal(complete.ticket.status, 'Complete');
  assert.equal(complete.record.state, 'official');
  assert.ok(complete.record.official_code);
  assert.equal(complete.unlocks.find(x => x.key === 'official_record').unlocked, true);
  assert.deepEqual(complete.audit.filter(x => ['completed', 'official'].includes(x.action)).map(x => [x.actor, x.action, x.field]), [['wei', 'completed', 'credit_terms'], ['nurul', 'completed', 'licence_TH'], ['priya', 'official', 'official_code']]);
  assert.equal(ready(await api('/users/priya/notifications', 'priya')).length, 0);
  assert.ok((await api('/users/somchai/notifications', 'somchai')).some(n => n.ticket_id === id && n.kind === 'complete'));
  const count = store.all().workflow[0].records.length;
  const duplicate = await api('/tickets/duplicate-check', 'amy', { name: 'NUH Singapore' });
  assert.ok(duplicate.candidates.some(x => x.id === 'nuh'));
  await api('/tickets', 'amy', customer('NUH Singapore'), 'POST', 409);
  const reused = await api('/tickets', 'amy', { ...customer('NUH Singapore'), duplicate_choice: 'existing', existing_record_id: 'nuh' });
  assert.equal(reused.ticket.record_id, 'nuh');
  assert.equal(reused.ticket.status, 'Complete');
  assert.equal(store.all().workflow[0].records.length, count);
  const first = await api('/tickets', 'amy', customer('HTTP Alpha Unique Clinic'));
  assert.equal(first.sections.find(x => x.key === 'credit_terms').status, 'auto');
  const rule = (await api('/rules')).find(x => x.record_type === 'Customer' && x.section_key === 'credit_terms');
  await api(`/rules/${rule.id}`, 'management', { auto_policy: { kind: 'credit', max_sgd: 10000, max_days: 30 } }, 'PUT');
  const second = await api('/tickets', 'amy', customer('HTTP Beta Distinct Laboratory'));
  assert.equal(second.sections.find(x => x.key === 'credit_terms').status, 'pending');
  assert.equal((await api(`/tickets/${first.ticket.id}`)).sections.find(x => x.key === 'credit_terms').status, 'auto');
  const auditIds = store.all().workflow[0].audit_log.map(x => x.id);
  await api('/demo/reset', 'management', {});
  const reset = await api('/tickets/T-1042');
  assert.equal(reset.ticket.status, 'In progress');
  assert.equal(reset.sections.find(x => x.key === 'credit_terms').status, 'pending');
  const after = store.all().workflow[0].audit_log;
  assert.ok(auditIds.every(id => after.some(x => x.id === id)));
  assert.ok(after.some(x => x.action === 'demo_reset'));
});

test('hosted HTTP persists initialization and workflow changes before response; rejected and unchanged reads do not save', async t => {
  let state = seedData(), saves = 0;
  const api = await serve(t, createHandler({
    loadState: async () => ({ state: structuredClone(state), etag: 'test-version' }),
    saveState: async (next, etag) => {
      assert.equal(etag, 'test-version');
      await new Promise(resolve => setTimeout(resolve, 15));
      state = structuredClone(next); saves++;
    },
  }));
  const csv = await api('/exports/dtw.csv', 'priya');
  assert.ok(csv.startsWith('Code,Name,Type,Entity,Country'));
  assert.equal(saves, 1);
  assert.equal(state.workflow.length, 1);
  const initial = await api('/tickets/T-1042');
  const before = saves;
  await api(`/tickets/${initial.ticket.id}/sections/credit_terms/complete`, 'wei', { fields: {} });
  assert.equal(saves, before + 1);
  assert.equal((await api('/tickets/T-1042', 'wei')).sections.find(x => x.key === 'credit_terms').status, 'done');
  assert.equal(state.workflow[0].sections.find(x => x.ticket_id === initial.ticket.id && x.key === 'credit_terms').completed_by, 'wei');
  const savedState = structuredClone(state), savedCount = saves;
  await api(`/tickets/${initial.ticket.id}/sections/licence_TH/complete`, 'nurul', { fields: {} }, 'POST', 400);
  assert.equal(saves, savedCount);
  assert.deepEqual(state, savedState);
  await api('/users/priya/notifications', 'priya');
  const afterSla = saves;
  await api('/users/priya/notifications', 'priya');
  assert.equal(saves, afterSla, 'unchanged notification polling must not write durable storage');
});

test('platform-owned JSON helper bypassing Express send still persists every mutation exactly once', async t => {
  let state = seedData(), saves = 0;
  const handler = createHandler({
    loadState: async () => ({ state: structuredClone(state), etag: 'platform-version' }),
    saveState: async next => { await new Promise(r => setTimeout(r, 5)); state = structuredClone(next); saves++; },
  });
  const api = await serve(t, (req, res) => {
    // Vercel's helper writes directly to the native response, not res.send.
    res.json = function (body) { this.setHeader('Content-Type', 'application/json'); this.end(JSON.stringify(body)); return this; };
    return handler(req, res);
  });
  await api('/users');
  assert.equal(saves, 1);
  const created = await api('/tickets', 'marcus', customer('Platform persistence regression clinic'));
  assert.equal(saves, 2);
  assert.equal((await api(`/tickets/${created.ticket.id}`)).record.name, 'Platform persistence regression clinic');
  await api(`/tickets/${created.ticket.id}/official`, 'priya', {});
  assert.equal(saves, 3);
  assert.equal((await api(`/tickets/${created.ticket.id}`)).ticket.status, 'Complete');
});
