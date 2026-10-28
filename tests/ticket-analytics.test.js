import test from 'node:test';
import assert from 'node:assert/strict';
import {getAnalyticsFixture,buildRegional,buildDuplicateImpact,buildForecast,buildActions,scoreForecast} from '../server/ticket-analytics.js';
const total=a=>a.reduce((s,x)=>s+x,0);const close=(a,b,tolerance=.03)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
test('fixture has deterministic scope, unique duplicate clusters, full months and enquiry separation',()=>{
 const f=getAnalyticsFixture();assert.deepEqual(f,getAnalyticsFixture());assert.equal(f.canonicalCustomers.length,150);assert.equal(f.months[0],'2025-10');assert.equal(f.months.at(-1),'2026-09');assert.equal(new Set(f.customers.map(x=>x.country)).size,5);assert.deepEqual([...new Set(f.orders.map(x=>x.entity))].sort(),['QTG','QTS','SPD']);
 const duplicates=f.canonicalCustomers.filter(c=>f.customers.filter(x=>x.cluster_id===c.id).length>1);assert.equal(duplicates.length,12);assert.equal(f.customers.filter(x=>x.cluster_id==='C31').length,3);close(total(f.orders.filter(x=>x.status==='enquiry').map(x=>x.units))/total(f.orders.filter(x=>x.status!=='mdm_request').map(x=>x.units)),.3,.00001);
 assert.equal(new Set(f.orders.map(x=>x.id)).size,f.orders.length);assert.ok(f.orders.every(x=>f.customers.some(c=>c.id===x.customer_id)));
});
test('regional growth is independently recomputed from confirmed window totals',()=>{
 const f=getAnalyticsFixture(),r=buildRegional();for(const c of r.cells){const rows=f.orders.filter(o=>o.status==='confirmed'&&o.country===c.country&&o.product===c.product);const prior=total(rows.filter(x=>['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03'].includes(x.month)).map(x=>x.units));const current=total(rows.filter(x=>['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].includes(x.month)).map(x=>x.units));close(c.previous,prior);close(c.current,current);close(c.growthPct,(current-prior)/prior*100);}
 close(r.cells.find(c=>c.country==='Vietnam'&&c.product==='C').growthPct,30);close(r.cells.find(c=>c.country==='Malaysia'&&c.product==='C').growthPct,-12);close(r.cells.find(c=>c.country==='Thailand'&&c.product==='A').growthPct,-4);close(r.kpis.confirmedUnits,total(f.orders.filter(o=>o.status==='confirmed').map(x=>x.units)));
});
test('deduplication conserves all units and reveals largest A account',()=>{
 const f=getAnalyticsFixture(),d=buildDuplicateImpact();close(d.unitsBefore,d.unitsAfter);close(d.unitsAfter,total(f.orders.filter(x=>x.status==='confirmed'&&x.product==='A').map(x=>x.units)));assert.equal(d.focus.merged.rank,1);assert.ok(d.focus.aliases.every(x=>x.rank>1));close(total(d.focus.aliases.map(x=>x.units)),d.focus.merged.units);
});
test('forecasts only use preceding months and rolling baseline matches independent calculation',()=>{
 for(const country of ['Singapore','Malaysia','Thailand','Vietnam','Indonesia'])for(const product of ['A','B','C']){
 const f=buildForecast({country,product});assert.equal(f.backtest.length,6);for(let i=0;i<6;i++){const row=f.backtest[i],prior=f.history.slice(i,i+6);close(row.baseline,total(prior.map(x=>x.actual))/6);assert.ok(row.trainThrough<row.month);assert.equal(row.trainThrough,f.history[i+5].month);}
 for(const model of ['baseline','trend']){const errors=f.backtest.map(x=>Math.abs(x.actual-x[model]));close(f.scores[model].mae,total(errors)/6);close(f.scores[model].mape,total(f.backtest.map((x,i)=>errors[i]/x.actual))*100/6);}
 assert.equal(f.winner,f.scores.trend.mae<f.scores.baseline.mae?'trend':'baseline');assert.ok(f.forecast.lower>=0&&f.forecast.lower<=f.forecast.estimate&&f.forecast.upper>=f.forecast.estimate);assert.match(f.rangeNote,/six/);assert.match(f.rangeNote,/No seasonal model/);
 }
});
test('churn and cross-sell actions have data-backed cohorts and assigned owners',()=>{
 const f=getAnalyticsFixture(),a=buildActions(),churn=a.find(x=>x.id==='churn'),cross=a.find(x=>x.id==='cross-sell');assert.equal(churn.evidence.length,6);assert.ok(churn.evidence.every(x=>x.growthPct < -40));assert.equal(cross.evidence.eligible.length,18);assert.equal(cross.evidence.peersBuyingBoth,12);
 for(const id of cross.evidence.eligible){const rows=f.orders.filter(x=>x.status==='confirmed'&&x.cluster_id===id);assert.ok(rows.some(x=>x.product==='A'));assert.ok(rows.every(x=>x.product!=='B'));}
 assert.ok(a.every(x=>x.owner_role&&x.evidence&&x.description));assert.match(a.find(x=>x.id==='pricing').description,/no margin/);
});

test('zero actuals do not divide by zero and remain included in MAE',()=>{
 assert.deepEqual(scoreForecast([{actual:0,prediction:20},{actual:100,prediction:80}], 'prediction'),{mape:20,mae:20,zeroActualsSkipped:1});
 assert.deepEqual(scoreForecast([{actual:0,prediction:10}], 'prediction'),{mape:null,mae:10,zeroActualsSkipped:1});
});

test('separate synthetic signals and explicit conversion outcomes are counted independently',()=>{
 const fixture=getAnalyticsFixture(),r=buildRegional();
 for(const c of r.conversion){const cohort=fixture.orders.filter(x=>x.status==='enquiry'&&x.country===c.country);assert.equal(c.enquiries,cohort.length);assert.equal(c.converted,cohort.filter(x=>x.converted===true).length);close(c.conversionPct,c.converted/c.enquiries*100);}
 const lowest=r.conversion.slice().sort((a,b)=>a.conversionPct-b.conversionPct)[0];assert.equal(lowest.country,'Vietnam');close(lowest.conversionPct,22,.15);
 const requests=fixture.orders.filter(x=>x.status==='mdm_request');assert.equal(r.kpis.mdmRequestCount,requests.length);close(r.kpis.mdmRequestUnits,total(requests.map(x=>x.units)));assert.ok(requests.length>0);assert.equal(r.timeToFirstSale.hours,null);assert.equal(r.timeToFirstSale.sampleCount,0);
 const pricing=buildActions().find(x=>x.id==='pricing');assert.equal(pricing.evidence[0].country,'Vietnam');assert.equal(pricing.owner_role,'Product Manager');
});
test('sell-ready proxy comes from valid workflow unlock timestamps, excluding pending and invalid rows',()=>{
 const workflow={tickets:[{id:'a',created_at:'2026-10-01T00:00:00Z',auto_cleared:true},{id:'b',created_at:'2026-10-01T00:00:00Z',auto_cleared:false},{id:'pending',created_at:'2026-10-01T00:00:00Z'},{id:'invalid',created_at:'2026-10-02T00:00:00Z'}],unlocks:[{ticket_id:'a',key:'sell_on_credit',unlocked:true,unlocked_at:'2026-10-01T01:00:00Z'},{ticket_id:'b',key:'sell_on_credit',unlocked:true,unlocked_at:'2026-10-01T05:00:00Z'},{ticket_id:'pending',key:'sell_on_credit',unlocked:false,unlocked_at:null},{ticket_id:'invalid',key:'sell_on_credit',unlocked:true,unlocked_at:'2026-10-01T00:00:00Z'}]};
 const r=buildRegional(workflow).timeToFirstSale;assert.equal(r.hours,3);assert.equal(r.sampleCount,2);assert.equal(r.automaticHours,1);assert.equal(r.manualHours,5);assert.match(r.definition,/not an observed sale/);
});
