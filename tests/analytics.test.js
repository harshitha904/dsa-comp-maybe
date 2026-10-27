import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics, buildSeedFixture, forecastSeries, linearTrend, addMonths, monthRange, FORECAST_CONFIG } from '../server/analytics.js';

const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v && deepFreeze(v)); return Object.freeze(o); };
const mkCustomers = (n, country = 'Singapore') => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Customer ${i + 1}`, country, identifier: `ID-${i + 1}`, email: `c${i + 1}@x.example`, aliases: [] }));
const PRODUCTS = [{ id: 'A', name: 'Product A', category: 'x' }, { id: 'B', name: 'Product B', category: 'x' }, { id: 'C', name: 'Product C', category: 'x' }];
let seq = 0;
const order = (customerId, productId, month, quantity, signal = 'confirmed', country = 'Singapore') => ({ id: `o${++seq}`, customerId, productId, country, month, quantity, signal });
/** one confirmed order per month for the given quantities, starting 2026-01 */
const series = (customerId, productId, qtys, country, start = '2026-01') => qtys.map((q, i) => order(customerId, productId, addMonths(start, i), q, 'confirmed', country));

const seed = buildSeedFixture();
const seeded = buildAnalytics(seed);

test('seed fixture covers 2025-10..2026-09, five countries and Products A/B/C', () => {
  assert.deepEqual(seeded.meta.months, monthRange('2025-10', '2026-09'));
  assert.equal(seeded.meta.months.length, 12);
  assert.deepEqual([...seeded.meta.countries].sort(), ['Indonesia', 'Malaysia', 'Singapore', 'Thailand', 'Vietnam']);
  assert.deepEqual(seeded.meta.products.map((p) => p.name), ['Product A', 'Product B', 'Product C']);
  assert.equal(seeded.meta.nextMonth, '2026-10');
  assert.deepEqual(Object.keys(seeded.views).sort(), ['A', 'A+B', 'A+C', 'B', 'B+C', 'C', 'all']);
  assert.equal(seeded.meta.dataQuality.invalidOrders, 0);
});

test('demand counts confirmed orders only; enquiry and setup are excluded and counted separately', () => {
  const customers = mkCustomers(2);
  const orders = [
    order('c1', 'A', '2026-01', 100), order('c1', 'A', '2026-01', 7, 'enquiry'), order('c2', 'A', '2026-01', 3, 'setup'),
    order('c2', 'B', '2026-02', 40), order('c2', 'B', '2026-02', 500, 'enquiry'), order('c2', 'B', '2026-02', 11, 'setup'),
  ];
  const t = buildAnalytics({ customers, products: PRODUCTS, orders }).views.all.totals;
  assert.equal(t.confirmedQuantity, 140);
  assert.equal(t.confirmedOrders, 2);
  assert.deepEqual(t.excluded.enquiry, { orders: 2, quantity: 507 });
  assert.deepEqual(t.excluded.setup, { orders: 2, quantity: 14 });
  assert.equal(t.excluded.orders, 4);
  assert.equal(t.excluded.quantity, 521);
});

test('on the seed, totals reconcile with raw orders and enquiry/setup never leak into demand', () => {
  const raw = (pred) => seed.orders.filter(pred).reduce((s, o) => s + o.quantity, 0);
  const v = seeded.views.all;
  assert.equal(v.totals.confirmedQuantity, raw((o) => o.signal === 'confirmed'));
  assert.equal(v.totals.excluded.enquiry.quantity, raw((o) => o.signal === 'enquiry'));
  assert.equal(v.totals.excluded.setup.quantity, raw((o) => o.signal === 'setup'));
  assert.equal(v.monthly.reduce((s, m) => s + m.confirmed, 0), v.totals.confirmedQuantity);
  v.countries.forEach((c) => assert.equal(c.confirmedQuantity, raw((o) => o.signal === 'confirmed' && o.country === c.country), c.country));
  assert.ok(v.totals.excluded.enquiry.quantity > 0 && v.totals.excluded.setup.quantity > 0, 'seed should include excluded signals');
});

test('month-over-month and 3-month growth use exact windows', () => {
  const customers = mkCustomers(1);
  // 2026-01..2026-06 → 10,10,10,20,20,30 : last3 = 70, prior3 = 30, mom = 30 vs 20
  const orders = series('c1', 'A', [10, 10, 10, 20, 20, 30]);
  const v = buildAnalytics({ customers, products: PRODUCTS, orders }).views.all;
  assert.equal(v.totals.latestQuantity, 30);
  assert.equal(v.totals.previousQuantity, 20);
  assert.equal(v.totals.momGrowthPct, 50);
  assert.equal(v.totals.last3Quantity, 70);
  assert.equal(v.totals.prior3Quantity, 30);
  assert.equal(v.totals.growth3mPct, 133.3);
});

test('growth is null, not Infinity, when the comparison window is zero', () => {
  const orders = [order('c1', 'A', '2026-01', 0), order('c1', 'A', '2026-02', 0), order('c1', 'A', '2026-06', 50)];
  const v = buildAnalytics({ customers: mkCustomers(1), products: PRODUCTS, orders }).views.all;
  assert.equal(v.totals.momGrowthPct, null);
  assert.equal(v.totals.growth3mPct, null);
});

test('product filter views are consistent with the full view', () => {
  const { views } = seeded;
  const sumOf = (keys, f) => keys.reduce((s, k) => s + f(views[k]), 0);
  assert.equal(sumOf(['A', 'B', 'C'], (v) => v.totals.confirmedQuantity), views.all.totals.confirmedQuantity);
  assert.equal(views['A+B'].totals.confirmedQuantity, views.A.totals.confirmedQuantity + views.B.totals.confirmedQuantity);
  views.all.countries.forEach((c, i) => {
    const parts = ['A', 'B', 'C'].reduce((s, k) => s + views[k].countries[i].confirmedQuantity, 0);
    assert.equal(parts, c.confirmedQuantity, c.country);
    assert.equal(views.A.countries[i].country, c.country, 'country order stays fixed across filters');
  });
  assert.equal(views.A.byProduct.length, 1);
  views.A.monthly.forEach((m) => assert.deepEqual(Object.keys(m.byProduct), ['A']));
  assert.equal(views.A.forecast.horizonMonth, '2026-10');
});

test('forecast: linear trend wins on a perfectly linear series and the report says so', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  const f = forecastSeries(values, monthRange('2026-01', '2026-12'), '2027-01');
  assert.equal(f.backtest.origins, 6);
  assert.equal(f.backtest.candidateMae, 0);
  assert.ok(f.backtest.baselineMae > 0);
  assert.equal(f.backtest.winner, 'candidate');
  assert.equal(f.selected, 'candidate');
  assert.equal(f.candidateForecast, 130);
  assert.equal(f.backtest.improvementPct, 100);
});

test('forecast: an honest loss is reported when the trend overshoots (negative improvement, baseline selected)', () => {
  const values = [10, 20, 30, 40, 50, 60, 30, 30, 30, 30, 30, 30];
  const f = forecastSeries(values, monthRange('2026-01', '2026-12'), '2027-01');
  assert.ok(f.backtest.improvementPct < 0, `improvement ${f.backtest.improvementPct}`);
  assert.equal(f.backtest.winner, 'baseline');
  assert.equal(f.selected, 'baseline');
  assert.equal(f.selectedForecast, f.baselineForecast);
  assert.ok(f.caveats.some((c) => /did worse/.test(c)));
});

test('forecast: MAE equals an independent recomputation on every seeded series', () => {
  const check = (s, months) => {
    const f = forecastSeries(s, months, '2026-10');
    let eb = 0, ec = 0, k = 0;
    for (let t = FORECAST_CONFIG.minTrain; t < s.length; t++) {
      const train = s.slice(0, t);
      const avg = train.reduce((a, b) => a + b, 0) / t;
      const { slope, intercept } = linearTrend(train);
      eb += Math.abs(s[t] - avg); ec += Math.abs(s[t] - Math.max(0, intercept + slope * t)); k++;
    }
    assert.ok(Math.abs(f.backtest.baselineMae - eb / k) < 0.06);
    assert.ok(Math.abs(f.backtest.candidateMae - ec / k) < 0.06);
    // selection must follow the measured error, never the other way round
    if (f.selected === 'candidate') assert.ok(f.backtest.candidateMae < f.backtest.baselineMae);
  };
  const v = seeded.views.all;
  check(v.monthly.map((m) => m.confirmed), seeded.meta.months);
  v.countries.forEach((c) => check(c.series.map((x) => x.quantity), seeded.meta.months));
});

test('forecast: the seeded report is mixed, not uniformly flattering to the candidate', () => {
  const winners = new Set([seeded.views.all.forecast, ...seeded.views.all.countries.map((c) => c.forecast)].map((f) => f.backtest.winner));
  assert.ok(winners.has('candidate') && winners.has('baseline'), `winners: ${[...winners]}`);
  assert.ok([seeded.views.all.forecast, ...seeded.views.all.countries.map((c) => c.forecast)].some((f) => f.backtest.improvementPct < 0));
});

test('forecast: held-out scoring has no look-ahead (changing the future cannot change earlier predictions)', () => {
  const months = monthRange('2026-01', '2026-12');
  const base = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17];
  const a = forecastSeries(base, months, '2027-01');
  const changed = [...base]; changed[11] = 500;
  const b = forecastSeries(changed, months, '2027-01');
  assert.deepEqual(a.backtest.points.slice(0, -1), b.backtest.points.slice(0, -1));
  assert.notEqual(a.backtest.points.at(-1).actual, b.backtest.points.at(-1).actual);
  assert.equal(a.backtest.points.at(-1).baseline, b.backtest.points.at(-1).baseline, 'prediction for the last month ignores its own actual');
});

test('forecast: ties and thin history fall back to the historical average with a caveat', () => {
  const flat = forecastSeries(Array(12).fill(40), monthRange('2026-01', '2026-12'), '2027-01');
  assert.equal(flat.backtest.winner, 'tie');
  assert.equal(flat.selected, 'baseline');
  assert.equal(flat.selectedForecast, 40);
  const short = forecastSeries([5, 6, 7, 8, 9, 10, 11, 12], monthRange('2026-01', '2026-08'), '2026-09');
  assert.equal(short.backtest.winner, 'insufficient-data');
  assert.equal(short.selected, 'baseline');
  assert.equal(short.backtest.improvementPct, null);
  assert.ok(short.caveats.some((c) => /held-out/.test(c)));
  assert.ok(flat.caveats.some((c) => /seasonality/.test(c)));
});

test('forecast: a perfect baseline (MAE 0) against a worse trend is a baseline win, not a tie', () => {
  // Baseline predicts exactly 40 at every held-out month; the OLS trend fitted on the oscillating start cannot.
  const values = [30, 50, 30, 50, 30, 50, 40, 40, 40, 40, 40, 40];
  const f = forecastSeries(values, monthRange('2026-01', '2026-12'), '2027-01');
  assert.equal(f.backtest.baselineMae, 0);
  assert.ok(f.backtest.candidateMae > 0, `candidate MAE ${f.backtest.candidateMae}`);
  assert.equal(f.backtest.improvementPct, null, 'percentage undefined against a zero baseline error');
  assert.equal(f.backtest.winner, 'baseline');
  assert.equal(f.selected, 'baseline');
  assert.ok(f.caveats.some((c) => /did worse/.test(c)));
  // and the symmetric case stays a genuine tie
  assert.equal(forecastSeries(Array(12).fill(7), monthRange('2026-01', '2026-12'), '2027-01').backtest.winner, 'tie');
});

test('forecast never goes negative', () => {
  const f = forecastSeries([100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 1], monthRange('2026-01', '2026-12'), '2027-01');
  assert.ok(f.candidateForecast >= 0);
  assert.ok(f.backtest.points.every((p) => p.candidate >= 0));
});

test('declining country raises a risk whose evidence matches the computed numbers', () => {
  const my = seeded.views.all.countries.find((c) => c.country === 'Malaysia');
  const risk = seeded.views.all.risks.find((r) => r.type === 'declining-demand' && r.countries[0] === 'Malaysia');
  assert.ok(risk, 'Malaysia decline risk expected');
  assert.ok(my.growth3mPct < -10);
  assert.ok(risk.evidence[0].includes(new Intl.NumberFormat('en-US').format(my.last3Quantity)));
  assert.ok(risk.evidence[0].includes(new Intl.NumberFormat('en-US').format(my.prior3Quantity)));
  assert.ok(risk.metrics.some((m) => m.value === `${my.growth3mPct}%`));
  assert.ok(risk.action.length > 20);
  assert.equal(seeded.views.all.risks.some((r) => r.type === 'declining-demand' && r.countries[0] === 'Singapore'), false);
});

test('concentration, lapsed-customer and duplicate-record risks cite the right records', () => {
  const risks = seeded.views.all.risks;
  const conc = risks.find((r) => r.type === 'customer-concentration' && r.countries[0] === 'Thailand');
  const th = seeded.views.all.countries.find((c) => c.country === 'Thailand');
  assert.equal(conc.customers[0].name, 'Siam Mega Foods Co Ltd');
  assert.equal(th.topCustomers[0].name, 'Siam Mega Foods Co Ltd');
  assert.ok(th.topCustomers[0].sharePct > 60);
  assert.equal(risks.some((r) => r.type === 'customer-concentration' && r.countries[0] === 'Singapore'), false);

  const lapsed = risks.find((r) => r.type === 'lapsed-customers' && r.countries[0] === 'Malaysia');
  assert.deepEqual(lapsed.customers.map((c) => c.id), ['C-MY3']);
  assert.match(lapsed.evidence[0], /last confirmed order 2026-05/);

  const dup = risks.find((r) => r.type === 'duplicate-master-data');
  assert.deepEqual(dup.customers.map((c) => c.id).sort(), ['C-ID1', 'C-ID2']);
  assert.match(dup.evidence[0], /shared identifier/);
});

test('masked identifiers/emails never merge customers into duplicate groups', () => {
  const masked = mkCustomers(4).map((c) => ({ ...c, identifier: '[redacted]', email: '[REDACTED]' }));
  const orders = masked.map((c) => order(c.id, 'A', '2026-01', 10));
  assert.equal(buildAnalytics({ customers: masked, products: PRODUCTS, orders }).views.all.risks.some((r) => r.type === 'duplicate-master-data'), false);
  const mixed = [...masked.slice(0, 2), { ...masked[2], identifier: 'ID-77', email: 'same@x.example' }, { ...masked[3], identifier: 'id 77' }];
  const r = buildAnalytics({ customers: mixed, products: PRODUCTS, orders }).views.all.risks.filter((x) => x.type === 'duplicate-master-data');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].customers.map((c) => c.id).sort(), ['c3', 'c4']);
});

test('overdue open requests are flagged by country using the data-derived reference date; closed ones are not', () => {
  const risks = seeded.views.all.risks.filter((r) => r.type === 'overdue-requests');
  const my = risks.find((r) => r.countries[0] === 'Malaysia');
  assert.deepEqual(my.requests.map((r) => r.id).sort(), ['REQ-1001', 'REQ-1002']);
  const vn = risks.find((r) => r.countries[0] === 'Vietnam');
  assert.deepEqual(vn.requests.map((r) => r.id), ['REQ-1003']);
  assert.equal(risks.some((r) => r.countries[0] === 'Thailand' || r.countries[0] === 'Singapore'), false);
  assert.equal(seeded.meta.referenceDate, '2026-10-26');
  assert.match(my.evidence.join(' '), /last audit/);
});

test('co-purchase: confidence, lift and gap customers are computed from confirmed orders only', () => {
  const customers = mkCustomers(10);
  const orders = [];
  for (let i = 1; i <= 4; i++) { orders.push(order(`c${i}`, 'A', '2026-01', 10), order(`c${i}`, 'B', '2026-01', 5)); } // A+B
  for (let i = 5; i <= 6; i++) orders.push(order(`c${i}`, 'A', '2026-01', 30)); // A only (gap)
  for (let i = 7; i <= 10; i++) orders.push(order(`c${i}`, 'C', '2026-01', 8)); // C only
  orders.push(order('c5', 'B', '2026-02', 99, 'enquiry')); // must not count as a B purchase
  const out = buildAnalytics({ customers, products: PRODUCTS, orders });
  const pair = out.coPurchase.find((p) => p.id === 'A->B');
  assert.equal(pair.fromBuyers, 6);
  assert.equal(pair.bothBuyers, 4);
  assert.equal(pair.confidencePct, 66.7);
  assert.equal(pair.baseRatePct, 40);
  assert.equal(pair.lift, 1.67);
  assert.deepEqual(pair.gapCustomers.map((g) => g.id).sort(), ['c5', 'c6']);
  assert.equal(out.coPurchase.some((p) => p.id === 'B->A'), false, 'every B buyer already buys A, so there is no cross-sell gap');
});

test('co-purchase reports same-month overlap separately from any-month overlap', () => {
  const customers = mkCustomers(8);
  const orders = [
    order('c1', 'A', '2026-01', 5), order('c1', 'B', '2026-01', 5), // same month
    order('c2', 'A', '2026-01', 5), order('c2', 'B', '2026-03', 5), // different months
    order('c3', 'A', '2026-01', 5), order('c3', 'B', '2026-01', 5), // same month
    order('c4', 'A', '2026-01', 5), // gap
    ...[5, 6, 7, 8].map((i) => order(`c${i}`, 'C', '2026-01', 5)),
  ];
  const pair = buildAnalytics({ customers, products: PRODUCTS, orders }).coPurchase.find((p) => p.id === 'A->B');
  assert.equal(pair.bothBuyers, 3);
  assert.equal(pair.sameMonthBuyers, 2);
  assert.match(pair.basis, /not same-basket/);
});

test('co-purchase ignores pairs below minimum support and lift ≤ 1', () => {
  const customers = mkCustomers(4);
  const thin = [order('c1', 'A', '2026-01', 1), order('c1', 'B', '2026-01', 1), order('c2', 'A', '2026-01', 1), order('c3', 'C', '2026-01', 1), order('c4', 'C', '2026-01', 1)];
  assert.equal(buildAnalytics({ customers, products: PRODUCTS, orders: thin }).coPurchase.length, 0, 'only 2 A buyers: below support');
  const all = mkCustomers(4);
  const everyone = all.flatMap((c) => [order(c.id, 'A', '2026-01', 1), order(c.id, 'B', '2026-01', 1)]).concat([order('c1', 'A', '2026-02', 1)]);
  assert.equal(buildAnalytics({ customers: all, products: PRODUCTS, orders: everyone }).coPurchase.length, 0, 'no gap customers');
});

test('seeded cross-sell opportunity names the planted gap customers', () => {
  const opp = seeded.views.all.opportunities.find((o) => o.id === 'opp:copurchase:A->B');
  assert.ok(opp);
  const names = opp.customers.map((c) => c.name);
  ['Lion City Retail Pte Ltd', 'Langkawi Supplies Sdn Bhd', 'Da Nang Seafood JSC', 'Bali Hospitality PT'].forEach((n) => assert.ok(names.includes(n), n));
  assert.match(opp.evidence[0], /%/);
  assert.match(opp.evidence.at(-1), /not proof/);
  assert.match(opp.evidence.at(-1), /no basket or invoice id/);
  assert.equal(opp.metrics[0].label, 'Also buy (any month)');
  const claims = JSON.stringify([opp.title, opp.summary, opp.metrics, opp.action, opp.evidence.slice(0, -1)]);
  assert.doesNotMatch(claims, /bought together|same basket|basket|frequently bought|co-?purchase/i, 'claims must not imply basket-level co-purchase');
  assert.match(seeded.meta.methodology.coPurchase, /cannot be observed/);
});

test('opportunities: unconverted enquiry/setup signals are surfaced but never counted as demand', () => {
  const customers = mkCustomers(2);
  const orders = [...series('c1', 'A', [10, 10, 10, 10, 10, 10, 10, 10]), order('c1', 'B', '2026-08', 77, 'enquiry'), order('c2', 'A', '2026-08', 5, 'setup'), order('c1', 'A', '2026-08', 3, 'enquiry')];
  const v = buildAnalytics({ customers, products: PRODUCTS, orders }).views.all;
  const opp = v.opportunities.find((o) => o.type === 'unconverted-pipeline');
  assert.ok(opp);
  assert.match(opp.evidence.join(' '), /Product B.*77 units/);
  assert.ok(!opp.evidence.join(' ').includes('Product A, 3 units'), 'A enquiry was followed by a confirmed order in the same month');
  assert.equal(v.totals.confirmedQuantity, 80);
});

test('accelerating country is an opportunity with forecast evidence; filters keep insights product-relevant', () => {
  const vn = seeded.views.all.opportunities.find((o) => o.type === 'accelerating-demand' && o.countries[0] === 'Vietnam');
  assert.ok(vn);
  assert.match(vn.evidence.at(-1), /held-out MAE/);
  const onlyC = seeded.views.C;
  assert.ok(onlyC.opportunities.every((o) => o.type !== 'cross-sell' || o.productIds.includes('C')));
  assert.ok(onlyC.risks.filter((r) => r.productIds.length).every((r) => r.productIds.join() === 'C'));
});

test('insights are complete: id, priority, countries, evidence and an action', () => {
  const ids = new Set();
  for (const view of Object.values(seeded.views)) {
    [...view.risks, ...view.opportunities].forEach((i) => {
      assert.ok(['high', 'medium', 'low'].includes(i.priority), i.id);
      assert.ok(i.evidence.length > 0 && i.action && i.title && i.countries.length > 0, i.id);
      assert.ok(['risk', 'opportunity'].includes(i.kind));
    });
    const keyed = [...view.risks, ...view.opportunities].map((i) => i.id);
    assert.equal(new Set(keyed).size, keyed.length, `duplicate insight ids in view ${view.key}`);
    keyed.forEach((k) => ids.add(k));
    const ranks = view.risks.map((r) => ({ high: 0, medium: 1, low: 2 })[r.priority]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'risks sorted by priority');
  }
});

test('country tiles: fixed order, intensity normalised, ranks consistent', () => {
  const v = seeded.views.all;
  const order = v.countries.map((c) => c.country);
  assert.deepEqual(order, seeded.meta.countries);
  assert.deepEqual(seeded.views.B.countries.map((c) => c.country), order);
  assert.equal(Math.max(...v.countries.map((c) => c.intensity)), 1);
  const top = [...v.countries].sort((a, b) => b.confirmedQuantity - a.confirmedQuantity)[0];
  assert.equal(top.rank, 1);
  assert.ok(Math.abs(v.countries.reduce((s, c) => s + c.sharePct, 0) - 100) < 0.5);
  assert.equal(Math.max(...v.countries.flatMap((c) => c.series.map((s) => s.intensity))), 1);
});

test('robustness: empty input, bad rows and undeclared products are handled and reported', () => {
  const empty = buildAnalytics({});
  assert.equal(empty.views.all.totals.confirmedQuantity, 0);
  assert.equal(empty.meta.months.length, 0);
  assert.deepEqual(buildAnalytics().meta.countries, []);

  const orders = [
    order('c1', 'A', '2026-01', 10), order('c1', 'A', '2026-13', 10), order('c1', 'A', '2026-02', -4), order('c1', 'A', '2026-02', 'abc'),
    order('c1', 'A', '2026-02', 5, 'bogus'), order('ghost', 'A', '2026-02', 6), order('c1', 'Z', '2026-02', 9),
  ];
  const out = buildAnalytics({ customers: mkCustomers(1), products: PRODUCTS, orders });
  assert.equal(out.meta.dataQuality.invalidOrders, 3);
  assert.equal(out.meta.dataQuality.unknownSignals, 1);
  assert.equal(out.meta.dataQuality.orphanOrders, 1);
  assert.equal(out.meta.dataQuality.undeclaredProducts, 1);
  assert.equal(out.views.all.totals.confirmedQuantity, 25);
  assert.ok(out.meta.products.some((p) => p.id === 'Z'));
});

test('buildAnalytics is deterministic, JSON-serialisable and does not mutate its input', () => {
  const frozen = deepFreeze(JSON.parse(JSON.stringify(seed)));
  const a = buildAnalytics(frozen);
  const b = buildAnalytics(frozen);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(JSON.parse(JSON.stringify(a)).meta.months, a.meta.months);
  assert.ok(!JSON.stringify(a).includes('NaN') && !JSON.stringify(a).includes('Infinity'));
});

test('addMonths crosses year boundaries', () => {
  assert.equal(addMonths('2026-09'), '2026-10');
  assert.equal(addMonths('2026-12'), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('forecast: Holt only wins when it beats both the average (by the margin) and the linear trend', () => {
  const all = [seeded.views.all.forecast, ...seeded.views.all.countries.map((c) => c.forecast)];
  for (const f of all) {
    const byId = Object.fromEntries(f.models.map((m) => [m.id, m]));
    assert.equal(f.selectedForecast, byId[f.selected].forecast);
    if (f.selected === 'holt') assert.ok(byId.holt.mae < byId.candidate.mae && byId.holt.mae < byId.baseline.mae);
  }
  const linear = forecastSeries([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], monthRange('2026-01', '2026-12'), '2027-01');
  assert.equal(linear.selected, 'candidate', 'ties between challengers go to the simpler OLS trend');
});

test('drop-off watchlist flags declining customers who are still ordering, not lapsed ones', async () => {
  const { seedData } = await import('../server/seed.js');
  const app = buildAnalytics(seedData(new Date('2026-10-28T00:00:00Z')));
  const names = app.views.all.watchlist.map((w) => w.name);
  assert.ok(names.includes('Selangor Healthcare'), names.join(', '));
  assert.ok(!names.includes('Johor Distribution'), 'lapsed customers belong to the lapsed risk, not the watchlist');
  assert.ok(app.views.all.watchlist.every((w) => w.last3Quantity > 0 && w.changePct <= -15));
});
