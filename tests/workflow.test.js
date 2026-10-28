import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createApp } from '../server/index.js';
import { act, createRequest, defaultConfig, escalations, redact, validateConfig } from '../server/domain.js';
import { seedData } from '../server/seed.js';

const customer = {type:'Customer',name:'Brand New Clinic',country:'Vietnam',identifier:'VN-NEW-777',email:'buy@newclinic.example',requester:'Linh',details:{segment:'Private',terms:'Net 30',credit:1000}};

test('rule changes apply to new requests and leave in-flight requests on their original route', () => {
  const data = seedData();
  const old = createRequest(customer, data.customers, data.requests);
  const config = validateConfig({...defaultConfig(), routes:{...defaultConfig().routes, Customer:['Sales','Quality','Finance','BU Head']}});
  const fresh = createRequest({...customer, identifier:'VN-NEW-778', email:'b@x.example', name:'Other Clinic'}, data.customers, data.requests, config);
  assert.deepEqual(fresh.route, ['Sales','Quality','Finance','BU Head']);
  assert.equal(act(fresh, 'approve', '', 'Sales').stage, 'Quality');
  assert.equal(act(old, 'approve', '', 'Sales').stage, 'Finance');
});

test('added required fields are enforced and sensitive ones are redacted', () => {
  const base = defaultConfig();
  const config = validateConfig({...base, fields:{...base.fields, Customer:[...base.fields.Customer, {label:'Import licence no', sensitive:true}]}});
  assert.equal(config.fields.Customer.at(-1).key, 'importLicenceNo');
  const data = seedData();
  assert.throws(() => createRequest(customer, data.customers, data.requests, config), /Import licence no is required/);
  const made = createRequest({...customer, details:{...customer.details, importLicenceNo:'LIC-1'}}, data.customers, data.requests, config);
  const view = redact({...data, config:[config], requests:[made]}, 'Sales');
  assert.equal(view.requests[0].details.importLicenceNo, '[redacted]');
  assert.equal(redact({...data, config:[config], requests:[made]}, 'Finance').requests[0].details.importLicenceNo, 'LIC-1');
});

test('invalid rules are rejected', () => {
  const base = defaultConfig();
  assert.throws(() => validateConfig({...base, routes:{...base.routes, Item:[]}}), /1-6 approval steps/);
  assert.throws(() => validateConfig({...base, routes:{...base.routes, Item:['Finance','Finance']}}), /distinct/);
  assert.throws(() => validateConfig({...base, slaHours:1}), /4-336/);
});

test('escalation fires once per stage after the SLA', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const req = {id:'R1', type:'Customer', status:'Pending', stage:'Finance', route:['Sales','Finance','BU Head'], approvals:['Sales'], createdAt:'2026-10-20T00:00:00Z'};
  const log = [{id:'a', requestId:'R1', action:'approve', actor:'Sales', timestamp:'2026-10-25T00:00:00Z'}];
  const [hit] = escalations([req], log, {slaHours:48}, now);
  assert.equal(hit.request.escalatedTo, 'BU Head');
  assert.match(hit.entry.details, /No response from Finance in 48h/);
  assert.equal(escalations([hit.request], [...log, hit.entry], {slaHours:48}, now).length, 0);
  assert.equal(escalations([req], log, {slaHours:96}, now).length, 0);
});

test('config API is MDM-team only and escalations persist', async t => {
  const store = createStore(':memory:');
  const server = createApp(store).listen(0); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', body, role = 'Sales') => fetch(url + path, {method, headers:{'Content-Type':'application/json','X-Role':role}, body:body && JSON.stringify(body)}).then(async r => [r.status, await r.json()]);
  const [, config] = await call('/api/config');
  assert.equal(config.slaHours, 48);
  assert.equal((await call('/api/config', 'PUT', {...config, slaHours:24}, 'Finance'))[0], 403);
  assert.equal((await call('/api/config', 'PUT', {...config, slaHours:24}, 'Admin'))[1].slaHours, 24);
  const [, first] = await call('/api/escalations/run', 'POST');
  assert.ok(first.escalated.length > 0);
  assert.equal((await call('/api/escalations/run', 'POST'))[1].escalated.length, 0);
  store.close();
});

test('customers and requests carry a business entity; the NUH duplicate spans two entities', () => {
  const data = seedData();
  assert.ok(data.customers.every(c => ['SPD','QTS','QTG'].includes(c.entity)));
  assert.deepEqual([data.customers[0].entity, data.customers[1].entity], ['SPD','QTS']);
  assert.equal(createRequest({...customer, entity:'QTG'}, data.customers, data.requests).entity, 'QTG');
  assert.throws(() => createRequest({...customer, entity:'XYZ'}, data.customers, data.requests), /Invalid business entity/);
});
