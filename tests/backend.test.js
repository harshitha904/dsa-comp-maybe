import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/db.js';
import { createApp } from '../server/index.js';

test('persistent API validates, routes approvals, redacts and simulates safely', async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mastergraph-')); const path=join(dir,'test.sqlite'); let store=createStore(path); const server=createApp(store).listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>{server.close();store.close();rmSync(dir,{recursive:true,force:true});}); const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,method='GET',body,role='Sales')=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Role':role},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
 let [,boot]=await call('/api/bootstrap'); assert.equal(boot.customers[0].email,'procurement@nuh.example'); assert.equal(new Set(boot.orders.map(o=>o.month)).size,12); assert.equal(new Set(boot.orders.map(o=>o.country)).size,5);
 const quality=(await call('/api/bootstrap','GET',null,'Quality'))[1];
 assert.equal(quality.requests.find(r=>r.type==='Vendor').details.category,'Logistics');
 assert.equal(quality.requests.find(r=>r.type==='Vendor').details.bankAccount,'[redacted]');
 const itemSeed=store.all().requests.find(r=>r.type==='Item');
 const itemDup=(await call('/api/duplicates','POST',itemSeed))[1]; assert.equal(itemDup.matches[0].customer.id,itemSeed.id);
 const conflict=await call('/api/requests','POST',itemSeed);assert.equal(conflict[0],409);assert.equal(conflict[1].matches[0].customer.id,itemSeed.id);
 assert.equal((await call('/api/duplicates','POST',{name:'a'.repeat(201)}))[0],400);
 let [,dup]=await call('/api/duplicates','POST',{type:'Customer',name:'NUH'}); assert.ok(dup.matches.length>=2); assert.equal(dup.matches[0].customer.identifier,'SG-NUH-001');
 const request={type:'Customer',name:'NUH',country:'Singapore',identifier:'SG-NUH-001',email:'procurement@nuh.example',requester:'Sam',details:'Customer segment: Direct account\nPayment terms: Net 30\nRequested credit limit (USD): 25000\nBusiness justification: Purchase'};
 assert.equal((await call('/api/requests','POST',request))[0],409); assert.equal((await call('/api/requests','POST',{...request,duplicateOverride:'short'}))[0],409);
 let [status,created]=await call('/api/requests','POST',{...request,duplicateOverride:'Reviewed separate legal entity'},'Finance'); assert.equal(status,201); assert.equal(created.stage,'Sales'); const id=created.id;
 assert.equal((await call(`/api/requests/${id}/sap`,'GET',null,'Finance'))[0],409); assert.equal((await call(`/api/requests/${id}/action`,'POST',{action:'approve'},'Finance'))[0],403);
 assert.equal((await call(`/api/requests/${id}/action`,'POST',{action:'clarify',note:'Please explain'},'Sales'))[1].status,'Clarification'); assert.equal((await call(`/api/requests/${id}/action`,'POST',{action:'resubmit',note:'Explained'},'Sales'))[1].stage,'Sales');
 for(const role of ['Sales','Finance','BU Head']) assert.equal((await call(`/api/requests/${id}/action`,'POST',{action:'approve'},role))[0],200);
 assert.equal((await call(`/api/requests/${id}/sap`,'GET',null,'Sales'))[0],403); assert.equal((await call(`/api/requests/${id}/sap`,'GET',null,'Finance'))[1].simulated,true);
 const before=(await call('/api/bootstrap','GET',null,'Finance'))[1]; const sim=(await call('/api/simulate','POST',{sourceId:'c1',targetId:'c2'}))[1]; assert.equal(sim.after.targetQuantity,sim.before.sourceQuantity+sim.before.targetQuantity); assert.deepEqual((await call('/api/bootstrap','GET',null,'Finance'))[1],before); assert.ok(before.audit.every(a=>!Number.isNaN(Date.parse(a.timestamp))));
 const reopened=createStore(path); assert.equal(reopened.all().requests.find(r=>r.id===id).status,'Approved'); reopened.close(); assert.equal((await call('/api/reset','POST',{}))[0],403); assert.equal((await call('/api/reset','POST',{},'Admin'))[0],200); assert.equal(store.all().requests.length,4);
});

import { seedData } from '../server/seed.js';
import { createRequest, duplicates, redact, sapPayload } from '../server/domain.js';
import { buildAnalytics } from '../server/analytics.js';

test('fixture has meaningful demand, gaps, country trends, dropoff and a relative queue',()=>{
 const now=new Date('2030-02-10T12:00:00Z'); const data=seedData(now);
 assert.deepEqual(data,seedData(now)); assert.equal(data.customers.length,18);
 const months=[...new Set(data.orders.map(o=>o.month))].sort(); assert.equal(months[0],'2025-10');assert.equal(months.at(-1),'2026-09');assert.equal(months.length,12);
 assert.equal(data.customers[0].identifier,data.customers[1].identifier);
 const confirmed=data.orders.filter(o=>o.signal==='confirmed'); assert.ok(confirmed.length/data.orders.length>0.9);
 assert.ok(data.orders.some(o=>o.signal==='enquiry'));assert.ok(data.orders.some(o=>o.signal==='setup'));
 assert.ok(!confirmed.some(o=>o.customerId==='c7' && o.month>='2026-07'));
 const totals=(country,start,end)=>confirmed.filter(o=>o.country===country && o.month>=start && o.month<=end).reduce((n,o)=>n+o.quantity,0);
 assert.ok(totals('Vietnam','2026-07','2026-09')>totals('Vietnam','2026-04','2026-06'));
 assert.ok(totals('Malaysia','2026-07','2026-09')<totals('Malaysia','2026-04','2026-06'));
 assert.equal(data.requests.length,4);assert.ok(data.requests.some(r=>r.status==='Clarification'));
 assert.ok(data.requests.some(r=>Date.parse(r.deadline)<now));assert.ok(data.requests.some(r=>Date.parse(r.deadline)>now));
 const analytics=JSON.stringify(buildAnalytics(data));assert.match(analytics,/cross-sell/);assert.match(analytics,/unconverted-pipeline/);
});

test('all master types match same-type existing requests and enforce overrides',()=>{
 const data=seedData();
 for(const type of ['Vendor','Item','Cost Center']) {
  const existing=data.requests.find(r=>r.type===type);
  const input={...existing,requester:'Test user'};
  const matches=duplicates(input,data.customers,data.requests);assert.equal(matches[0].customer.id,existing.id);assert.equal(matches[0].score,100);
  assert.throws(()=>createRequest(input,data.customers,data.requests),e=>e.status===409);
  assert.equal(createRequest({...input,duplicateOverride:'Reviewed distinct master entity'},data.customers,data.requests).type,type);
  assert.equal(duplicates({...input,type:'Customer'},[],data.requests).length,0);
 }
 assert.throws(()=>duplicates({name:'x'.repeat(201)},data.customers),e=>e.status===400);
 assert.throws(()=>duplicates([],data.customers),e=>e.status===400);
 assert.throws(()=>createRequest({...data.requests[2],details:{line:'Product B'}},data.customers),/Unit of measure/);
 assert.throws(()=>createRequest({...data.requests[2],details:{line:'Product B',uom:'Box',cost:-2}},data.customers),/amount/);
});

test('Quality retains matching and operational details while financial fields stay restricted',()=>{
 const data=seedData(); const before=structuredClone(data);
 for(const role of ['Sales','Quality','BU Head']) {
  const safe=redact(data,role);assert.equal(safe.customers[0].identifier,'SG-NUH-001');
  const vendor=safe.requests.find(r=>r.type==='Vendor');assert.equal(vendor.details.category,'Logistics');assert.equal(vendor.details.bankAccount,'[redacted]');assert.equal(vendor.details.terms,'[redacted]');
  assert.equal(safe.requests.find(r=>r.type==='Item').details.shelf,24);
 }
 for(const role of ['Finance','Admin']) assert.equal(redact(data,role).requests[1].details.bankAccount,'SYNTHETIC-000123');
 assert.deepEqual(data,before);
});

test('SAP simulation produces validated Service Layer master payloads without mutation',()=>{
 const data=seedData();const before=structuredClone(data);
 const expected={Customer:'BusinessPartners',Vendor:'BusinessPartners',Item:'Items','Cost Center':'ProfitCenters'};
 for(const r of data.requests) {
  const sap=sapPayload({...r,status:'Approved'});assert.equal(sap.simulated,true);assert.equal(sap.entitySet,expected[r.type]);
  if(r.type==='Customer'||r.type==='Vendor') {assert.equal(sap.data.CardName,r.name);assert.equal(sap.data.FederalTaxID,r.identifier);assert.equal(sap.data.EmailAddress,r.email);assert.equal(sap.data.CardType,r.type==='Customer'?'cCustomer':'cSupplier');}
  if(r.type==='Item') assert.equal(sap.data.ItemCode,r.identifier);
  if(r.type==='Cost Center') assert.equal(sap.data.CenterCode,r.identifier);
 }
 assert.throws(()=>sapPayload({...data.requests[3],identifier:'TOO-LONG-CODE'}),/SAP code/);
 assert.throws(()=>sapPayload({...data.requests[0],email:'invalid'}),/valid email/);
 assert.deepEqual(data,before);
});
