// Analytics engine for GET /api/analytics.
//   buildAnalytics({customers, products, orders, requests, audit}) -> analytics payload
// Pure and deterministic: no clock, no I/O, no randomness. Shape is documented in docs/analytics-notes.md.

export const FORECAST_CONFIG = { minTrain: 6, minBacktestPoints: 3, tieMarginPct: 2 };
export const COPURCHASE_CONFIG = { minSupport: 3, minConfidence: 0.5 };
const THRESHOLDS = {
  watchDropPct: 15,
  declinePct: -10, severeDeclinePct: -25, minWindowQuantity: 30,
  growthPct: 15, strongGrowthPct: 30,
  concentrationShare: 0.4, severeConcentrationShare: 0.6,
  lapsedShare: 0.03, lapsedHighShare: 0.2, lapsedMediumShare: 0.08,
  volatileMaePct: 25,
};
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SIGNALS = new Set(['confirmed', 'enquiry', 'setup']);
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const OPEN_STATUSES = new Set(['Pending', 'Clarification']);
const DAY_MS = 86400000;

// ---------- small helpers ----------
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const growthPct = (cur, prev) => (prev > 0 ? round(((cur - prev) / prev) * 100) : null);
const fmt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
const signed = (n) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n}%`);

export function addMonths(month, n = 1) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function monthRange(first, last) {
  const out = [];
  for (let m = first; m <= last && out.length < 600; m = addMonths(m)) out.push(m);
  return out;
}

// ---------- forecasting ----------
/** Ordinary least squares on x = 0..n-1. */
export function linearTrend(values) {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  if (n === 1) return { slope: 0, intercept: values[0], r2: 0 };
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let sxy = 0, sxx = 0, syy = 0;
  values.forEach((y, x) => { sxy += (x - xm) * (y - ym); sxx += (x - xm) ** 2; syy += (y - ym) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: ym - slope * xm, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}
const baselinePredict = (train) => mean(train);
const trendPredict = (train) => {
  const { slope, intercept } = linearTrend(train);
  return Math.max(0, intercept + slope * train.length);
};
// Holt's linear exponential smoothing: level and trend adapt to recent months, unlike OLS which
// weights all history equally. Smoothing constants are fixed, never tuned on the scored months.
export const HOLT = { alpha: 0.5, beta: 0.3 };
export function holtPredict(train, { alpha, beta } = HOLT) {
  if (train.length < 2) return Math.max(0, train[0] ?? 0);
  let level = train[0], trend = train[1] - train[0];
  for (let i = 1; i < train.length; i++) {
    const prev = level;
    level = alpha * train[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return Math.max(0, level + trend);
}

/**
 * Rolling-origin hold-out backtest. For each origin t >= minTrain the models only see values[0..t-1]
 * and predict values[t]. Nothing is tuned on the scored points, and the winner is whichever model
 * actually has the lower MAE; a candidate that does not beat the baseline is reported as such.
 */
export function forecastSeries(values, months, nextMonth, config = FORECAST_CONFIG) {
  const { minTrain, minBacktestPoints, tieMarginPct } = config;
  const points = [];
  for (let t = minTrain; t < values.length; t++) {
    const train = values.slice(0, t);
    points.push({
      month: months[t], actual: values[t],
      baseline: round(baselinePredict(train)), candidate: round(trendPredict(train)), holt: round(holtPredict(train)),
    });
  }
  const baselineMae = points.length ? round(mean(points.map((p) => Math.abs(p.actual - p.baseline)))) : null;
  const candidateMae = points.length ? round(mean(points.map((p) => Math.abs(p.actual - p.candidate)))) : null;
  const holtMae = points.length ? round(mean(points.map((p) => Math.abs(p.actual - p.holt)))) : null;
  const meanActual = points.length ? round(mean(points.map((p) => p.actual))) : null;
  const enough = points.length >= minBacktestPoints;
  const improvementPct = enough && baselineMae > 0 ? round(((baselineMae - candidateMae) / baselineMae) * 100) : null;

  let winner = 'insufficient-data';
  if (enough) {
    // improvementPct is undefined when the baseline is perfect (MAE 0), so that case is decided on the raw errors.
    if (baselineMae === 0) winner = candidateMae === 0 ? 'tie' : 'baseline';
    else if (improvementPct != null && improvementPct >= tieMarginPct) winner = 'candidate';
    else if (improvementPct != null && improvementPct <= -tieMarginPct) winner = 'baseline';
    else winner = 'tie';
  }
  // Holt is a second challenger under the same rule: it must beat the average by the tie margin,
  // and must also beat the linear trend outright (ties go to the simpler OLS trend).
  const holtGain = enough && baselineMae > 0 ? round(((baselineMae - holtMae) / baselineMae) * 100) : null;
  if (enough && holtGain != null && holtGain >= tieMarginPct && holtMae < candidateMae) winner = 'holt';
  // Ties and thin evidence fall back to the simpler model.
  const selected = winner === 'candidate' || winner === 'holt' ? winner : 'baseline';

  const trend = linearTrend(values);
  const baselineForecast = round(baselinePredict(values));
  const candidateForecast = round(trendPredict(values));
  const holtForecast = round(holtPredict(values));
  const selectedForecast = selected === 'candidate' ? candidateForecast : selected === 'holt' ? holtForecast : baselineForecast;
  const selectedMae = selected === 'candidate' ? candidateMae : selected === 'holt' ? holtMae : baselineMae;
  const pct = (mae) => (meanActual > 0 && mae != null ? round((mae / meanActual) * 100) : null);
  const models = [
    { id: 'baseline', name: 'Historical average', mae: baselineMae, maePct: pct(baselineMae), forecast: baselineForecast },
    { id: 'candidate', name: 'Linear trend', mae: candidateMae, maePct: pct(candidateMae), forecast: candidateForecast },
    { id: 'holt', name: "Holt's smoothing", mae: holtMae, maePct: pct(holtMae), forecast: holtForecast },
  ];

  const caveats = [];
  if (!enough) caveats.push(`Only ${points.length} held-out month(s) available; at least ${minBacktestPoints} are needed to compare models, so the historical average is used.`);
  if (values.length < 24) caveats.push(`Only ${values.length} months of history: seasonality cannot be validated, so neither model includes it.`);
  if (enough && winner === 'baseline') caveats.push('The trend models did worse than the historical average on held-out months.');
  if (enough && winner === 'tie') caveats.push(`Both models are within ${tieMarginPct}% MAE of each other on held-out months; the simpler historical average is used.`);

  return {
    horizonMonth: nextMonth,
    baselineModel: 'Historical average', candidateModel: 'Linear trend (OLS)',
    backtest: {
      minTrain, origins: points.length, points, baselineMae, candidateMae, meanActual,
      baselineMaePct: meanActual > 0 ? round((baselineMae / meanActual) * 100) : null,
      candidateMaePct: meanActual > 0 ? round((candidateMae / meanActual) * 100) : null,
      improvementPct, winner, holtMae,
    },
    trend: { slopePerMonth: round(trend.slope), r2: round(trend.r2, 2) },
    baselineForecast, candidateForecast, holtForecast, models,
    selected, selectedForecast, selectedMae,
    caveats,
  };
}

// ---------- input cleaning ----------
function cleanOrders(orders, customerIds, quality) {
  const out = [];
  for (const o of orders || []) {
    const qty = Number(o?.quantity);
    if (!o || !MONTH_RE.test(String(o.month)) || !Number.isFinite(qty) || qty < 0 || !o.productId || !o.country) { quality.invalidOrders++; continue; }
    if (!SIGNALS.has(o.signal)) { quality.unknownSignals++; continue; }
    if (!customerIds.has(o.customerId)) quality.orphanOrders++;
    out.push({ id: o.id, customerId: o.customerId, productId: o.productId, country: o.country, month: o.month, quantity: qty, signal: o.signal });
  }
  return out;
}

// Role-based redaction may replace identifiers/emails with a sentinel; masked values must never be used to match records.
const isMasked = (v) => /^\s*[\[(*•#-]*\s*(redacted|masked|hidden|withheld|n\/a|\*+)\s*[\])*•#-]*\s*$/i.test(String(v ?? ''));
const normId = (s) => (isMasked(s) ? '' : String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
const normEmail = (s) => (isMasked(s) ? '' : String(s ?? '').trim().toLowerCase());

function duplicateGroups(customers) {
  const parent = new Map(customers.map((c) => [c.id, c.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const seen = new Map();
  const reasons = new Map();
  for (const c of customers) {
    for (const [kind, key] of [['identifier', normId(c.identifier)], ['email', normEmail(c.email)]]) {
      if (!key) continue;
      const k = `${kind}:${key}`;
      if (seen.has(k)) { union(c.id, seen.get(k)); reasons.set(find(c.id), new Set([...(reasons.get(find(c.id)) || []), `shared ${kind} "${kind === 'identifier' ? c.identifier : key}"`])); }
      else seen.set(k, c.id);
    }
  }
  const groups = new Map();
  for (const c of customers) { const r = find(c.id); (groups.get(r) || groups.set(r, []).get(r)).push(c); }
  return [...groups.entries()].filter(([, m]) => m.length > 1).map(([root, members]) => {
    const why = new Set();
    for (const [kind, f] of [['identifier', (c) => normId(c.identifier)], ['email', (c) => normEmail(c.email)]]) {
      const counts = new Map();
      members.forEach((c) => { const k = f(c); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
      counts.forEach((n, k) => { if (n > 1) why.add(`shared ${kind} "${kind === 'identifier' ? members.find((c) => f(c) === k).identifier : k}"`); });
    }
    return { members, reasons: [...why] };
  });
}

// ---------- operational (request / master-data) risks, independent of product filter ----------
function referenceDate(requests, audit, lastMonth) {
  const stamps = [...requests.map((r) => r.createdAt), ...audit.map((a) => a.timestamp)].map((s) => Date.parse(s)).filter(Number.isFinite);
  if (stamps.length) return new Date(Math.max(...stamps));
  const [y, m] = lastMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)); // last day of last order month
}

function requestRisks(requests, audit, refDate) {
  const lastAudit = new Map();
  [...audit].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).forEach((a) => lastAudit.set(a.requestId, a));
  const overdue = requests.filter((r) => OPEN_STATUSES.has(r.status) && Date.parse(r.deadline) < refDate.getTime());
  const byCountry = new Map();
  overdue.forEach((r) => (byCountry.get(r.country) || byCountry.set(r.country, []).get(r.country)).push(r));
  const iso = refDate.toISOString().slice(0, 10);
  return [...byCountry.entries()].map(([country, list]) => {
    const daysLate = (r) => Math.max(1, Math.floor((refDate.getTime() - Date.parse(r.deadline)) / DAY_MS));
    list.sort((a, b) => daysLate(b) - daysLate(a));
    const worst = daysLate(list[0]);
    return {
      id: `risk:overdue-requests:${country}`, kind: 'risk', type: 'overdue-requests',
      priority: list.length >= 3 || worst >= 7 ? 'high' : 'medium',
      title: `${list.length} master-data request${list.length > 1 ? 's' : ''} overdue in ${country}`,
      summary: 'Open requests past their deadline delay onboarding of customers, vendors and items that orders depend on.',
      countries: [country], productIds: [],
      metrics: [{ label: 'Overdue requests', value: String(list.length) }, { label: 'Longest overdue', value: `${worst} d` }],
      evidence: list.map((r) => {
        const a = lastAudit.get(r.id);
        return `${r.id} · ${r.type} “${r.name}” is ${r.status} at ${r.stage}, ${daysLate(r)} day(s) past deadline ${String(r.deadline).slice(0, 10)} (as of ${iso})${a ? `; last audit: ${a.action} by ${a.actor}` : ''}.`;
      }),
      customers: [], requests: list.map((r) => ({ id: r.id, name: r.name, country: r.country, status: r.status, stage: r.stage, daysOverdue: daysLate(r) })),
      action: `Escalate ${list[0].id}${list.length > 1 ? ` and ${list.length - 1} other(s)` : ''} to the approver at the current stage and agree a revised date.`,
    };
  });
}

// ---------- main entry ----------
export function buildAnalytics({ customers = [], products = [], orders = [], requests = [], audit = [] } = {}) {
  const quality = { invalidOrders: 0, unknownSignals: 0, orphanOrders: 0 };
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const clean = cleanOrders(orders, new Set(customerById.keys()), quality);

  const productMeta = new Map(products.map((p) => [p.id, { id: p.id, name: p.name || p.id, category: p.category || null }]));
  clean.forEach((o) => { if (!productMeta.has(o.productId)) { productMeta.set(o.productId, { id: o.productId, name: o.productId, category: null }); quality.undeclaredProducts = (quality.undeclaredProducts || 0) + 1; } });
  const productList = [...productMeta.values()].filter((p) => clean.some((o) => o.productId === p.id) || products.some((x) => x.id === p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const productIdsAll = productList.map((p) => p.id);

  const allMonths = clean.map((o) => o.month).sort();
  const months = allMonths.length ? monthRange(allMonths[0], allMonths[allMonths.length - 1]) : [];
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const nextMonth = months.length ? addMonths(months[months.length - 1]) : null;
  const refDate = referenceDate(requests, audit, months[months.length - 1] || '1970-01');

  // Fixed country order: by total confirmed demand across all products (ties alphabetical) so tiles don't jump when filtering.
  const confirmedAll = clean.filter((o) => o.signal === 'confirmed');
  const countryTotals = new Map();
  clean.forEach((o) => countryTotals.set(o.country, countryTotals.get(o.country) || 0));
  confirmedAll.forEach((o) => countryTotals.set(o.country, countryTotals.get(o.country) + o.quantity));
  const countries = [...countryTotals.keys()].sort((a, b) => countryTotals.get(b) - countryTotals.get(a) || a.localeCompare(b));

  const dupGroups = duplicateGroups(customers);
  const coPurchase = buildCoPurchase(confirmedAll, customerById, productMeta);
  const opsRisks = requestRisks(requests, audit, refDate);

  const ctx = { months, monthIndex, nextMonth, countries, customerById, productMeta, clean, quality };
  const viewKeys = subsets(productIdsAll);
  const views = {};
  for (const ids of viewKeys) {
    const key = ids.length === productIdsAll.length ? 'all' : ids.join('+');
    views[key] = buildView(key, ids, ctx, { coPurchase, opsRisks, dupGroups });
  }
  if (!views.all) views.all = buildView('all', productIdsAll, ctx, { coPurchase, opsRisks, dupGroups });

  return {
    schemaVersion: 1,
    meta: {
      months, firstMonth: months[0] || null, lastMonth: months[months.length - 1] || null, nextMonth,
      referenceDate: refDate.toISOString().slice(0, 10),
      countries, products: productList, defaultView: 'all', viewKeys: Object.keys(views),
      counts: { customers: customers.length, orders: orders.length, ordersUsed: clean.length, requests: requests.length, audit: audit.length },
      dataQuality: quality,
      methodology: {
        demand: 'Demand is the sum of quantity on orders with signal "confirmed". Orders with signal "enquiry" or "setup" are counted separately as excluded and never enter demand, growth or forecasts.',
        growth: 'Month-over-month compares the latest month to the one before. 3-month growth compares the latest three months to the three before. Growth is null when the earlier window is zero.',
        forecast: `Rolling-origin hold-out: for each month from index ${FORECAST_CONFIG.minTrain} onward, models are fit only on earlier months and scored on that month. Candidate (linear trend) is selected only if its MAE beats the historical average by at least ${FORECAST_CONFIG.tieMarginPct}%; otherwise the average is used. Improvement can be negative.`,
        coPurchase: `Cross-sell signal = customer-level product overlap. Each customer counts once per product with a confirmed order in the period (orders are monthly customer×product aggregates with no basket or invoice id, so same-basket purchase cannot be observed). A pair is shown when at least ${COPURCHASE_CONFIG.minSupport} customers buy the source product, at least ${Math.round(COPURCHASE_CONFIG.minConfidence * 100)}% of them also buy the target, lift is above 1, and some source buyers lack the target. Same-month overlap is reported as supporting timing evidence only.`,
      },
    },
    views,
    coPurchase: coPurchase.pairs,
  };
}

function subsets(ids) {
  if (ids.length > 5) return [ids, ...ids.map((i) => [i])];
  const out = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) out.push(ids.filter((_, i) => mask & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

// ---------- co-purchase ----------
function buildCoPurchase(confirmed, customerById, productMeta) {
  const perCustomer = new Map();
  for (const o of confirmed) {
    const m = perCustomer.get(o.customerId) || perCustomer.set(o.customerId, new Map()).get(o.customerId);
    const e = m.get(o.productId) || m.set(o.productId, { quantity: 0, lastMonth: o.month, country: o.country, months: new Set() }).get(o.productId);
    e.months.add(o.month); e.quantity += o.quantity; if (o.month > e.lastMonth) e.lastMonth = o.month; e.country = o.country;
  }
  const buyers = new Map();
  perCustomer.forEach((m, cid) => m.forEach((_, pid) => (buyers.get(pid) || buyers.set(pid, new Set()).get(pid)).add(cid)));
  const totalCustomers = perCustomer.size;
  const pairs = [];
  for (const [from, fromSet] of buyers) {
    for (const [to, toSet] of buyers) {
      if (from === to || fromSet.size < COPURCHASE_CONFIG.minSupport) continue;
      const both = [...fromSet].filter((c) => toSet.has(c));
      const confidence = both.length / fromSet.size;
      const baseRate = toSet.size / totalCustomers;
      const lift = baseRate > 0 ? confidence / baseRate : 0;
      if (confidence < COPURCHASE_CONFIG.minConfidence || lift <= 1) continue;
      const gap = [...fromSet].filter((c) => !toSet.has(c)).map((cid) => {
        const e = perCustomer.get(cid).get(from);
        return { id: cid, name: customerById.get(cid)?.name || cid, country: e.country, detail: `${fmt(e.quantity)} units of ${productMeta.get(from).name}, last ordered ${e.lastMonth}; no confirmed ${productMeta.get(to).name} order`, quantity: e.quantity };
      }).sort((a, b) => b.quantity - a.quantity);
      if (!gap.length) continue;
      // Orders are monthly customer×product aggregates with no basket/invoice id, so "same month" is the finest timing evidence available.
      const sameMonthBuyers = both.filter((c) => [...perCustomer.get(c).get(from).months].some((mo) => perCustomer.get(c).get(to).months.has(mo))).length;
      pairs.push({
        id: `${from}->${to}`, from: productMeta.get(from), to: productMeta.get(to),
        basis: 'customer-level overlap across all months; not same-basket', fromBuyers: fromSet.size, bothBuyers: both.length, sameMonthBuyers, confidencePct: round(confidence * 100), baseRatePct: round(baseRate * 100), lift: round(lift, 2),
        totalCustomers, gapCustomers: gap,
      });
    }
  }
  pairs.sort((a, b) => b.gapCustomers.length * b.confidencePct - a.gapCustomers.length * a.confidencePct || b.lift - a.lift);
  return { pairs, totalCustomers };
}

// ---------- one product-filtered view ----------
function buildView(key, productIds, ctx, shared) {
  const { months, monthIndex, nextMonth, countries, customerById, productMeta, clean } = ctx;
  const n = months.length;
  const set = new Set(productIds);
  const rows = clean.filter((o) => set.has(o.productId));
  const conf = rows.filter((o) => o.signal === 'confirmed');
  const seriesOf = (list) => { const s = Array(n).fill(0); list.forEach((o) => { s[monthIndex.get(o.month)] += o.quantity; }); return s; };
  const total = seriesOf(conf);

  const windows = (s) => {
    const last = s[n - 1] ?? 0, prev = s[n - 2] ?? 0;
    const last3 = sum(s.slice(-3)), prior3 = sum(s.slice(-6, -3));
    return { latestQuantity: last, previousQuantity: prev, momGrowthPct: growthPct(last, prev), last3Quantity: last3, prior3Quantity: prior3, growth3mPct: n >= 6 ? growthPct(last3, prior3) : null };
  };
  const excludedOf = (list) => {
    const e = { enquiry: { orders: 0, quantity: 0 }, setup: { orders: 0, quantity: 0 } };
    list.forEach((o) => { if (o.signal !== 'confirmed') { e[o.signal].orders++; e[o.signal].quantity += o.quantity; } });
    return { ...e, orders: e.enquiry.orders + e.setup.orders, quantity: e.enquiry.quantity + e.setup.quantity };
  };

  // customers per country (confirmed)
  const custByCountry = new Map();
  conf.forEach((o) => {
    const cm = custByCountry.get(o.country) || custByCountry.set(o.country, new Map()).get(o.country);
    const e = cm.get(o.customerId) || cm.set(o.customerId, { id: o.customerId, series: Array(n).fill(0), quantity: 0, byProduct: {} }).get(o.customerId);
    e.series[monthIndex.get(o.month)] += o.quantity; e.quantity += o.quantity; e.byProduct[o.productId] = (e.byProduct[o.productId] || 0) + o.quantity;
  });

  const grand = sum(total);
  const countryEntries = countries.map((country) => {
    const cRows = rows.filter((o) => o.country === country);
    const cConf = cRows.filter((o) => o.signal === 'confirmed');
    const series = seriesOf(cConf);
    const quantity = sum(series);
    const cust = [...(custByCountry.get(country)?.values() || [])].sort((a, b) => b.quantity - a.quantity);
    const byProduct = productIds.map((pid) => {
      const ps = seriesOf(cConf.filter((o) => o.productId === pid));
      return { productId: pid, name: productMeta.get(pid).name, quantity: sum(ps), share: quantity ? round((sum(ps) / quantity) * 100) : 0, growth3mPct: n >= 6 ? growthPct(sum(ps.slice(-3)), sum(ps.slice(-6, -3))) : null, series: ps };
    });
    return {
      country, confirmedQuantity: quantity, confirmedOrders: cConf.length, sharePct: grand ? round((quantity / grand) * 100) : 0,
      activeCustomers: cust.length, ...windows(series), series: months.map((month, i) => ({ month, quantity: series[i] })),
      byProduct, excluded: excludedOf(cRows),
      topCustomers: cust.slice(0, 5).map((c) => ({ id: c.id, name: customerById.get(c.id)?.name || c.id, quantity: c.quantity, sharePct: quantity ? round((c.quantity / quantity) * 100) : 0, last3Quantity: sum(c.series.slice(-3)) })),
      forecast: forecastSeries(series, months, nextMonth),
      _cust: cust,
    };
  });
  const maxCountry = Math.max(0, ...countryEntries.map((c) => c.confirmedQuantity));
  const maxCell = Math.max(0, ...countryEntries.flatMap((c) => c.series.map((s) => s.quantity)));
  [...countryEntries].sort((a, b) => b.confirmedQuantity - a.confirmedQuantity).forEach((c, i) => { c.rank = i + 1; });
  countryEntries.forEach((c) => { c.intensity = maxCountry ? round(c.confirmedQuantity / maxCountry, 3) : 0; c.series.forEach((s) => { s.intensity = maxCell ? round(s.quantity / maxCell, 3) : 0; }); });

  const monthly = months.map((month, i) => {
    const mRows = rows.filter((o) => o.month === month);
    const mConf = mRows.filter((o) => o.signal === 'confirmed');
    const ex = excludedOf(mRows);
    return {
      month, confirmed: total[i],
      byCountry: Object.fromEntries(countryEntries.map((c) => [c.country, c.series[i].quantity])),
      byProduct: Object.fromEntries(productIds.map((pid) => [pid, sum(mConf.filter((o) => o.productId === pid).map((o) => o.quantity))])),
      enquiryQuantity: ex.enquiry.quantity, setupQuantity: ex.setup.quantity,
    };
  });

  const forecast = forecastSeries(total, months, nextMonth);
  const byProduct = productIds.map((pid) => {
    const ps = seriesOf(conf.filter((o) => o.productId === pid));
    return { productId: pid, name: productMeta.get(pid).name, quantity: sum(ps), sharePct: grand ? round((sum(ps) / grand) * 100) : 0, ...windows(ps), series: months.map((month, i) => ({ month, quantity: ps[i] })), forecast: forecastSeries(ps, months, nextMonth) };
  });

  const view = {
    key, productIds,
    totals: {
      confirmedQuantity: grand, confirmedOrders: conf.length, activeCustomers: new Set(conf.map((o) => o.customerId)).size,
      ...windows(total), latestMonth: months[n - 1] || null,
      excluded: excludedOf(rows),
    },
    monthly, byProduct, countries: countryEntries.map(({ _cust, ...c }) => c),
    forecast, maxMonthlyCell: maxCell,
  };

  // Early drop-off warning: customers still ordering, but whose last 3 months fell well below the
  // 3 before. Customers who already stopped are reported separately as lapsed.
  view.watchlist = [...custByCountry.values()].flatMap((m) => [...m.values()]).map((e) => {
    const last3 = sum(e.series.slice(-3)), prior3 = sum(e.series.slice(-6, -3));
    const c = customerById.get(e.id);
    return { id: e.id, name: c?.name ?? e.id, country: c?.country ?? null, entity: c?.entity ?? null, last3Quantity: last3, prior3Quantity: prior3, changePct: growthPct(last3, prior3), slopePerMonth: round(linearTrend(e.series).slope), series: e.series };
  }).filter((w) => w.last3Quantity > 0 && w.changePct != null && w.changePct <= -THRESHOLDS.watchDropPct)
    .sort((a, b) => a.changePct - b.changePct);
  const full = countryEntries; // retains _cust
  view.risks = [...demandRisks(view, full, ctx), ...shared.opsRisks, ...duplicateRisks(shared.dupGroups, view, ctx)];
  view.opportunities = [...growthOpportunities(view), ...pipelineOpportunities(rows, view, ctx), ...coPurchaseOpportunities(shared.coPurchase, set)];
  const rank = (i) => PRIORITY_RANK[i.priority];
  view.risks.sort((a, b) => rank(a) - rank(b));
  view.opportunities.sort((a, b) => rank(a) - rank(b));
  return view;
}

// ---------- insights ----------
const modelLabel = (f) => ({ candidate: 'linear trend', holt: "Holt's smoothing" }[f.selected] ?? 'historical average');
const labelOf = (view, ctx) => (view.productIds.length === ctx.productMeta.size ? 'all products' : view.productIds.map((id) => ctx.productMeta.get(id).name).join(' + '));
const windowLabel = (months) => `${months[Math.max(0, months.length - 3)]}…${months[months.length - 1]}`;
const priorLabel = (months) => `${months[Math.max(0, months.length - 6)]}…${months[Math.max(0, months.length - 4)]}`;

function demandRisks(view, entries, ctx) {
  const out = [];
  const { months } = ctx;
  const scope = labelOf(view, ctx);
  for (const c of entries) {
    // 1. declining demand
    if (c.growth3mPct != null && c.growth3mPct <= THRESHOLDS.declinePct && Math.max(c.prior3Quantity, c.last3Quantity) >= THRESHOLDS.minWindowQuantity) {
      const worst = [...c.byProduct].filter((p) => p.series.length).map((p) => ({ ...p, drop: sum(p.series.slice(-6, -3)) - sum(p.series.slice(-3)) })).sort((a, b) => b.drop - a.drop)[0];
      out.push({
        id: `risk:decline:${c.country}:${view.key}`, kind: 'risk', type: 'declining-demand',
        priority: c.growth3mPct <= THRESHOLDS.severeDeclinePct ? 'high' : 'medium',
        title: `${c.country} confirmed demand down ${Math.abs(c.growth3mPct)}% over 3 months`,
        summary: `Confirmed ${scope} demand in the latest three months is below the three months before.`,
        countries: [c.country], productIds: view.productIds,
        metrics: [{ label: '3-month change', value: signed(c.growth3mPct) }, { label: 'Latest 3 months', value: `${fmt(c.last3Quantity)} units` }, { label: 'Prior 3 months', value: `${fmt(c.prior3Quantity)} units` }],
        evidence: [
          `${windowLabel(months)}: ${fmt(c.last3Quantity)} units vs ${fmt(c.prior3Quantity)} in ${priorLabel(months)} (${signed(c.growth3mPct)}).`,
          `Latest month ${months[months.length - 1]}: ${fmt(c.latestQuantity)} units (${signed(c.momGrowthPct)} vs prior month).`,
          worst && worst.drop > 0 ? `Largest contributor: ${worst.name}, down ${fmt(worst.drop)} units between the two windows.` : 'No single product explains the drop.',
          `Next-month ${modelLabel(c.forecast)} forecast: ${fmt(c.forecast.selectedForecast)} units (held-out MAE ${c.forecast.selectedMae != null ? fmt(c.forecast.selectedMae) : 'n/a'}).`,
        ],
        customers: c._cust.filter((x) => sum(x.series.slice(-6, -3)) > sum(x.series.slice(-3))).sort((a, b) => (sum(b.series.slice(-6, -3)) - sum(b.series.slice(-3))) - (sum(a.series.slice(-6, -3)) - sum(a.series.slice(-3)))).slice(0, 5)
          .map((x) => ({ id: x.id, name: nameOf(ctx, x.id), country: c.country, detail: `${fmt(sum(x.series.slice(-6, -3)))} → ${fmt(sum(x.series.slice(-3)))} units` })),
        requests: [],
        action: `Review ${worst && worst.drop > 0 ? worst.name : 'top'} accounts in ${c.country} with the account owners and confirm whether the drop is lost volume, delayed orders or customers moved to another record.`,
      });
    }
    // 2. customer concentration
    const top = c._cust[0];
    if (top && c.confirmedQuantity > 0 && c._cust.length > 1 && top.quantity / c.confirmedQuantity >= THRESHOLDS.concentrationShare) {
      const share = top.quantity / c.confirmedQuantity;
      const recent = sum(top.series.slice(-3));
      out.push({
        id: `risk:concentration:${c.country}:${view.key}`, kind: 'risk', type: 'customer-concentration',
        priority: share >= THRESHOLDS.severeConcentrationShare ? 'high' : 'medium',
        title: `${nameOf(ctx, top.id)} is ${round(share * 100, 0)}% of ${c.country} demand`,
        summary: `A single customer carries most confirmed ${scope} demand in ${c.country}.`,
        countries: [c.country], productIds: view.productIds,
        metrics: [{ label: 'Share of country', value: `${round(share * 100, 0)}%` }, { label: 'Customer units', value: fmt(top.quantity) }, { label: 'Other customers', value: String(c._cust.length - 1) }],
        evidence: [
          `${nameOf(ctx, top.id)}: ${fmt(top.quantity)} of ${fmt(c.confirmedQuantity)} units over ${months.length} months (${round(share * 100, 1)}%).`,
          `Latest 3 months from this customer: ${fmt(recent)} units of ${fmt(c.last3Quantity)} (${c.last3Quantity ? round((recent / c.last3Quantity) * 100, 0) : 0}%).`,
          `Next largest: ${c._cust[1] ? `${nameOf(ctx, c._cust[1].id)} at ${round((c._cust[1].quantity / c.confirmedQuantity) * 100, 0)}%` : 'none'}.`,
        ],
        customers: [{ id: top.id, name: nameOf(ctx, top.id), country: c.country, detail: `${fmt(top.quantity)} units, ${round(share * 100, 0)}% of ${c.country}` }],
        requests: [],
        action: `Agree a joint demand plan and contract coverage with ${nameOf(ctx, top.id)}; build the pipeline of the next ${Math.min(3, c._cust.length - 1)} accounts.`,
      });
    }
    // 3. lapsed customers
    const lapsed = c._cust.filter((x) => n3(x.series).recent === 0 && n3(x.series).activeMonths >= 3);
    const lapsedQty = sum(lapsed.map((x) => x.quantity));
    if (lapsed.length && c.confirmedQuantity && lapsedQty / c.confirmedQuantity >= THRESHOLDS.lapsedShare) {
      const share = lapsedQty / c.confirmedQuantity;
      out.push({
        id: `risk:lapsed:${c.country}:${view.key}`, kind: 'risk', type: 'lapsed-customers',
        priority: share >= THRESHOLDS.lapsedHighShare ? 'high' : share >= THRESHOLDS.lapsedMediumShare ? 'medium' : 'low',
        title: `${lapsed.length} previously active ${c.country} customer${lapsed.length > 1 ? 's' : ''} stopped ordering`,
        summary: `No confirmed ${scope} orders in the latest three months from customers that ordered in at least three earlier months.`,
        countries: [c.country], productIds: view.productIds,
        metrics: [{ label: 'Lapsed customers', value: String(lapsed.length) }, { label: 'Historic units', value: fmt(lapsedQty) }, { label: 'Share of country', value: `${round(share * 100, 0)}%` }],
        evidence: lapsed.map((x) => { const last = months[x.series.map((v, i) => (v > 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1)]; return `${nameOf(ctx, x.id)}: ${fmt(x.quantity)} units across ${n3(x.series).activeMonths} months; last confirmed order ${last}.`; }),
        customers: lapsed.map((x) => ({ id: x.id, name: nameOf(ctx, x.id), country: c.country, detail: `${fmt(x.quantity)} historic units` })),
        requests: [],
        action: `Contact ${nameOf(ctx, lapsed[0].id)}${lapsed.length > 1 ? ' and the other lapsed accounts' : ''}: confirm if they moved supplier, merged into another record or paused demand.`,
      });
    }
    // 4. volatile series -> low-confidence forecast
    const bt = c.forecast.backtest;
    const mae = c.forecast.selectedMae;
    if (bt.origins >= FORECAST_CONFIG.minBacktestPoints && bt.meanActual > 0 && mae != null && (mae / bt.meanActual) * 100 >= THRESHOLDS.volatileMaePct) {
      out.push({
        id: `risk:volatile:${c.country}:${view.key}`, kind: 'risk', type: 'forecast-uncertainty', priority: 'low',
        title: `${c.country} demand is hard to forecast`,
        summary: `Even the better model misses by roughly ${round((mae / bt.meanActual) * 100, 0)}% of monthly demand on held-out months.`,
        countries: [c.country], productIds: view.productIds,
        metrics: [{ label: 'Selected-model MAE', value: `${fmt(mae)} units` }, { label: 'Mean held-out demand', value: `${fmt(bt.meanActual)} units` }],
        evidence: [`Held-out MAE: historical average ${fmt(bt.baselineMae)}, linear trend ${fmt(bt.candidateMae)} over ${bt.origins} months.`, ...c.forecast.caveats],
        customers: [], requests: [],
        action: 'Plan capacity with a range rather than a single number and review forecast bias monthly.',
      });
    }
  }
  return out;
}
const nameOf = (ctx, id) => ctx.customerById.get(id)?.name || id;
function n3(series) {
  return { recent: sum(series.slice(-3)), activeMonths: series.slice(0, -3).filter((v) => v > 0).length };
}

function duplicateRisks(groups, view, ctx) {
  const out = [];
  for (const g of groups) {
    const ids = new Set(g.members.map((m) => m.id));
    const rows = ctx.clean.filter((o) => ids.has(o.customerId) && o.signal === 'confirmed');
    if (!rows.length) continue;
    const countries = [...new Set(g.members.map((m) => m.country))];
    const quantity = sum(rows.map((o) => o.quantity));
    const countryTotal = sum(ctx.clean.filter((o) => o.signal === 'confirmed' && countries.includes(o.country)).map((o) => o.quantity));
    const share = countryTotal ? quantity / countryTotal : 0;
    const perMember = g.members.map((m) => ({ m, q: sum(rows.filter((o) => o.customerId === m.id).map((o) => o.quantity)) }));
    out.push({
      id: `risk:duplicate:${[...ids].sort().join('+')}`, kind: 'risk', type: 'duplicate-master-data',
      priority: share >= 0.15 ? 'high' : 'medium',
      title: `Possible duplicate customer records: ${g.members.map((m) => m.name).join(' / ')}`,
      summary: 'These records share a registration identifier or email, so their demand may be split across several master-data entries.',
      countries, productIds: [],
      metrics: [{ label: 'Records', value: String(g.members.length) }, { label: 'Combined units', value: fmt(quantity) }, { label: 'Share of country', value: `${round(share * 100, 0)}%` }],
      evidence: [`Match reason: ${g.reasons.join('; ')}.`, ...perMember.map(({ m, q }) => `${m.id} ${m.name} (${m.country}, ${m.identifier || 'no identifier'}): ${fmt(q)} confirmed units.`)],
      customers: perMember.map(({ m, q }) => ({ id: m.id, name: m.name, country: m.country, detail: `${fmt(q)} units` })),
      requests: [],
      action: 'Review in Customer Intelligence and merge or link the records so demand and credit exposure are viewed as one customer.',
    });
  }
  return out;
}

function growthOpportunities(view) {
  const out = [];
  const months = view.monthly.map((m) => m.month);
  for (const c of view.countries) {
    if (c.growth3mPct == null || c.growth3mPct < THRESHOLDS.growthPct || c.last3Quantity < THRESHOLDS.minWindowQuantity) continue;
    const lead = [...c.byProduct].map((p) => ({ ...p, gain: sum(p.series.slice(-3)) - sum(p.series.slice(-6, -3)) })).sort((a, b) => b.gain - a.gain)[0];
    const f = c.forecast;
    out.push({
      id: `opp:growth:${c.country}:${view.key}`, kind: 'opportunity', type: 'accelerating-demand',
      priority: c.growth3mPct >= THRESHOLDS.strongGrowthPct ? 'high' : 'medium',
      title: `${c.country} demand up ${c.growth3mPct}% over 3 months`,
      summary: 'Confirmed demand is growing; supply and onboarding capacity should keep pace.',
      countries: [c.country], productIds: view.productIds,
      metrics: [{ label: '3-month change', value: signed(c.growth3mPct) }, { label: 'Latest 3 months', value: `${fmt(c.last3Quantity)} units` }, { label: 'Next-month forecast', value: `${fmt(f.selectedForecast)} units` }],
      evidence: [
        `${windowLabel(months)}: ${fmt(c.last3Quantity)} units vs ${fmt(c.prior3Quantity)} in ${priorLabel(months)}.`,
        lead && lead.gain > 0 ? `${lead.name} contributes the most growth (+${fmt(lead.gain)} units).` : 'Growth is spread across products.',
        `Forecast for ${f.horizonMonth}: ${fmt(f.selectedForecast)} units using the ${modelLabel(f)} (held-out MAE ${f.selectedMae != null ? fmt(f.selectedMae) : 'n/a'}; ${f.backtest.winner === 'holt' ? 'Holt\'s smoothing beat the average' : f.backtest.winner === 'candidate' ? `trend beat the average by ${f.backtest.improvementPct}%` : f.backtest.winner === 'baseline' ? 'trend did not beat the average' : 'no clear winner'}).`,
      ],
      customers: [], requests: [],
      action: `Check stock and fulfilment capacity for ${lead && lead.gain > 0 ? lead.name : 'leading products'} in ${c.country} and fast-track pending customer setups there.`,
    });
  }
  return out;
}

function pipelineOpportunities(rows, view, ctx) {
  const { months } = ctx;
  const recentFrom = months[Math.max(0, months.length - 6)];
  const lastConfirmed = new Map();
  const open = new Map();
  for (const o of rows) {
    const k = `${o.customerId}|${o.productId}`;
    if (o.signal === 'confirmed') { if (!lastConfirmed.has(k) || o.month > lastConfirmed.get(k)) lastConfirmed.set(k, o.month); }
    else if (o.month >= recentFrom) {
      const e = open.get(k) || open.set(k, { customerId: o.customerId, productId: o.productId, country: o.country, quantity: 0, latest: o.month, signals: new Set() }).get(k);
      e.quantity += o.quantity; e.signals.add(o.signal); if (o.month > e.latest) e.latest = o.month;
    }
  }
  const byCountry = new Map();
  for (const [k, e] of open) {
    if (lastConfirmed.has(k) && lastConfirmed.get(k) >= e.latest) continue; // already converted afterwards
    (byCountry.get(e.country) || byCountry.set(e.country, []).get(e.country)).push(e);
  }
  const out = [];
  for (const [country, list] of byCountry) {
    list.sort((a, b) => b.quantity - a.quantity);
    const qty = sum(list.map((e) => e.quantity));
    const base = view.countries.find((c) => c.country === country)?.last3Quantity || 0;
    out.push({
      id: `opp:pipeline:${country}:${view.key}`, kind: 'opportunity', type: 'unconverted-pipeline',
      priority: base && qty / base >= 0.3 ? 'high' : list.length >= 3 ? 'medium' : 'low',
      title: `${list.length} open enquiry/setup signal${list.length > 1 ? 's' : ''} in ${country} not yet converted`,
      summary: 'These records are excluded from demand. They become demand only when a confirmed order follows.',
      countries: [country], productIds: [...new Set(list.map((e) => e.productId))],
      metrics: [{ label: 'Open signals', value: String(list.length) }, { label: 'Excluded units', value: fmt(qty) }, { label: 'vs latest-3-month demand', value: base ? `${round((qty / base) * 100, 0)}%` : 'n/a' }],
      evidence: list.slice(0, 6).map((e) => `${nameOf(ctx, e.customerId)}: ${[...e.signals].join(' + ')} for ${ctx.productMeta.get(e.productId).name}, ${fmt(e.quantity)} units, latest ${e.latest}; ${lastConfirmed.has(`${e.customerId}|${e.productId}`) ? `last confirmed ${lastConfirmed.get(`${e.customerId}|${e.productId}`)}` : 'no confirmed order yet'}.`),
      customers: list.map((e) => ({ id: e.customerId, name: nameOf(ctx, e.customerId), country, detail: `${ctx.productMeta.get(e.productId).name}: ${fmt(e.quantity)} units (${[...e.signals].join('+')})` })),
      requests: [],
      action: `Sales to qualify the top ${Math.min(3, list.length)} signals in ${country} and move them to a confirmed order or close them out.`,
    });
  }
  return out;
}

function coPurchaseOpportunities(cp, productSet) {
  return cp.pairs.filter((p) => productSet.has(p.from.id) || productSet.has(p.to.id)).map((p) => {
    const countries = [...new Set(p.gapCustomers.map((g) => g.country))];
    return {
      id: `opp:copurchase:${p.id}`, kind: 'opportunity', type: 'cross-sell',
      priority: p.gapCustomers.length >= 3 && p.lift >= 1.2 ? 'high' : p.gapCustomers.length >= 2 ? 'medium' : 'low',
      title: `Cross-sell ${p.to.name} to ${p.from.name} buyers`,
      summary: `${p.bothBuyers} of ${p.fromBuyers} ${p.from.name} customers also have confirmed ${p.to.name} orders in the period.`,
      countries, productIds: [p.from.id, p.to.id],
      metrics: [{ label: 'Also buy (any month)', value: `${p.confidencePct}%` }, { label: 'Lift', value: `${p.lift}×` }, { label: 'Customers without it', value: String(p.gapCustomers.length) }],
      evidence: [
        `${p.bothBuyers}/${p.fromBuyers} (${p.confidencePct}%) ${p.from.name} buyers also have confirmed ${p.to.name} orders, vs ${p.baseRatePct}% of all ${p.totalCustomers} buying customers (lift ${p.lift}×).`,
        `${p.gapCustomers.length} ${p.from.name} customer(s) have no confirmed ${p.to.name} order in the period.`,
        `${p.sameMonthBuyers} of the ${p.bothBuyers} customers with both ordered both products in the same month at least once.`,
        'Customer-level overlap in monthly order records; orders carry no basket or invoice id, so this does not show the products were bought together. Small customer base, not proof that offering the product will convert.',
      ],
      customers: p.gapCustomers.map(({ id, name, country, detail }) => ({ id, name, country, detail })), requests: [],
      action: `Offer ${p.to.name} to ${p.gapCustomers.slice(0, 3).map((g) => g.name).join(', ')}${p.gapCustomers.length > 3 ? ` and ${p.gapCustomers.length - 3} more` : ''}.`,
    };
  });
}


// ---------- deterministic seed (2025-10 .. 2026-09, five countries, Products A/B/C) ----------
// Synthetic and illustrative only. Used by tests and available to the backend fixture owner via
// `import { buildSeedFixture } from './analytics.js'`. Patterns are planted so the analysis has something to find
// (decline, concentration, lapsed account, duplicate record, unconverted enquiries, A→B cross-sell) but
// forecast accuracy is whatever the data produces: nothing is tuned so the candidate model wins.
export function buildSeedFixture() {
  let s = 20261028;
  const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const months = monthRange('2025-10', '2026-09');
  const products = [
    { id: 'A', name: 'Product A', category: 'Core components' },
    { id: 'B', name: 'Product B', category: 'Assemblies' },
    { id: 'C', name: 'Product C', category: 'Specialty' },
  ];
  // [name, base units per product, monthly trend, options]
  const spec = {
    Singapore: [
      ['Meridian Logistics Pte Ltd', { A: 120, B: 80 }, 0.01], ['Harbour Foods Pte Ltd', { A: 90, B: 60 }, 0.0],
      ['Lion City Retail Pte Ltd', { A: 70 }, 0.0, { enquiry: [['B', '2026-08', 60], ['B', '2026-09', 45]] }], ['Orchid Healthcare Pte Ltd', { A: 60, B: 50, C: 40 }, 0.01],
      ['Marina Components Pte Ltd', { C: 80 }, 0.0], ['Raffles Trading Pte Ltd', { A: 50, B: 30 }, 0.0],
    ],
    Malaysia: [
      ['Selangor Industrial Sdn Bhd', { A: 140, B: 90 }, -0.045], ['Penang Electronics Sdn Bhd', { A: 100, B: 70 }, -0.04],
      ['Johor Distribution Sdn Bhd', { A: 80, B: 40 }, 0.0, { stopsAfter: '2026-05' }], ['Kuala Mart Sdn Bhd', { B: 60, C: 40 }, -0.02],
      ['Langkawi Supplies Sdn Bhd', { A: 50 }, -0.01, { enquiry: [['B', '2026-07', 40], ['B', '2026-08', 35]] }], ['Melaka Packaging Sdn Bhd', { C: 50 }, 0.0],
    ],
    Thailand: [
      ['Siam Mega Foods Co Ltd', { A: 400, B: 250 }, 0.01], ['Bangkok Retail Co Ltd', { A: 50, B: 30 }, 0.0],
      ['Chiang Mai Crafts Co Ltd', { A: 40 }, 0.0], ['Phuket Marine Co Ltd', { C: 40 }, 0.0],
      ['Isan Agri Co Ltd', { A: 35 }, 0.0], ['Pattaya Hotel Supply Co Ltd', { B: 25 }, 0.0],
    ],
    Indonesia: [
      ['Jakarta Commodities Tbk', { A: 130, B: 90 }, 0.0, { season: true }], ['Jkt Commodities Indonesia', { A: 40 }, 0.0, { sharesIdentifierWith: 0 }],
      ['Surabaya Textiles PT', { A: 90, B: 60 }, 0.01, { season: true }], ['Bali Hospitality PT', { A: 70, C: 30 }, 0.0, { enquiry: [['B', '2026-09', 50]] }],
      ['Medan Agro PT', { A: 80 }, 0.0], ['Bandung Tech PT', { B: 60, C: 50 }, 0.0],
    ],
    Vietnam: [
      ['Saigon Components JSC', { A: 80, B: 50 }, 0.12], ['Hanoi Electronics JSC', { A: 60, B: 40 }, 0.1],
      ['Da Nang Seafood JSC', { A: 50 }, 0.08, { enquiry: [['B', '2026-08', 70], ['B', '2026-09', 80]] }], ['Hai Phong Port Supply JSC', { B: 40, C: 30 }, 0.1],
      ['Hue Textiles JSC', { A: 40, B: 30 }, 0.15, { startsAt: '2026-01' }], ['Can Tho Agri JSC', { C: 30 }, 0.05],
    ],
  };
  const codes = { Singapore: 'SG', Malaysia: 'MY', Thailand: 'TH', Indonesia: 'ID', Vietnam: 'VN' };
  const customers = [];
  const orders = [];
  let oid = 1;
  const push = (customerId, productId, country, month, quantity, signal) => orders.push({ id: `O-${String(oid++).padStart(4, '0')}`, customerId, productId, country, month, quantity, signal });
  for (const [country, list] of Object.entries(spec)) {
    list.forEach(([name, base, trend, opt = {}], idx) => {
      const id = `C-${codes[country]}${idx + 1}`;
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
      const shared = opt.sharesIdentifierWith != null ? customers.find((c) => c.id === `C-${codes[country]}${opt.sharesIdentifierWith + 1}`) : null;
      customers.push({ id, name, country, identifier: shared ? shared.identifier : `${codes[country]}-REG-${String(1000 + customers.length * 37)}`, email: `accounts@${slug.slice(0, 14)}.example`, aliases: [] });
      months.forEach((month, i) => {
        if (opt.startsAt && month < opt.startsAt) return;
        if (opt.stopsAfter && month > opt.stopsAfter) return;
        const season = opt.season ? 1 + 0.35 * Math.sin(((i - 1) / 12) * 2 * Math.PI) : 1;
        for (const [pid, b] of Object.entries(base)) {
          if (rand() < 0.08) continue; // intermittent ordering
          const qty = Math.max(5, Math.round(b * Math.max(0.2, 1 + trend * i) * season * (0.85 + 0.3 * rand())));
          push(id, pid, country, month, qty, 'confirmed');
          if (i === (opt.startsAt ? months.indexOf(opt.startsAt) : 0) && rand() < 0.5) push(id, pid, country, month, 5, 'setup');
          if (rand() < 0.07) push(id, pid, country, month, Math.round(b * (0.3 + rand() * 0.5)), 'enquiry');
        }
      });
      (opt.enquiry || []).forEach(([pid, month, qty]) => push(id, pid, country, month, qty, 'enquiry'));
    });
  }
  const requests = [
    { id: 'REQ-1001', type: 'Customer', name: 'Kampung Fresh Sdn Bhd', country: 'Malaysia', identifier: 'MY-REG-5521', email: 'ap@kampungfresh.example', details: 'New grocery distributor', requester: 'Sales', status: 'Pending', stage: 'Finance review', approvals: [], createdAt: '2026-09-22T09:00:00Z', deadline: '2026-10-06', priority: 1 },
    { id: 'REQ-1002', type: 'Vendor', name: 'Penang Freight Services', country: 'Malaysia', identifier: 'MY-REG-6610', email: 'ops@penangfreight.example', details: 'Freight vendor', requester: 'Sales', status: 'Clarification', stage: 'Quality review', approvals: ['Sales'], createdAt: '2026-09-25T09:00:00Z', deadline: '2026-10-12', priority: 2 },
    { id: 'REQ-1003', type: 'Customer', name: 'Mekong Fresh JSC', country: 'Vietnam', identifier: 'VN-REG-7001', email: 'ap@mekongfresh.example', details: 'Onboarding ahead of growth', requester: 'Sales', status: 'Pending', stage: 'Finance review', approvals: ['Sales'], createdAt: '2026-10-08T09:00:00Z', deadline: '2026-10-22', priority: 1 },
    { id: 'REQ-1004', type: 'Item', name: 'Product B packaging variant', country: 'Thailand', identifier: 'TH-ITEM-12', email: 'plan@example.example', details: 'Packaging change', requester: 'Quality', status: 'Pending', stage: 'BU Head approval', approvals: ['Quality'], createdAt: '2026-10-20T09:00:00Z', deadline: '2026-11-10', priority: 3 },
    { id: 'REQ-1005', type: 'Customer', name: 'Old Harbour Pte Ltd', country: 'Singapore', identifier: 'SG-REG-9001', email: 'ar@oldharbour.example', details: 'Reactivation', requester: 'Sales', status: 'Approved', stage: 'Complete', approvals: ['Sales', 'Finance'], createdAt: '2026-09-10T09:00:00Z', deadline: '2026-09-24', priority: 2 },
  ];
  const audit = [
    { id: 'AUD-1', requestId: 'REQ-1001', action: 'submitted', actor: 'Sales', timestamp: '2026-09-22T09:00:00Z', details: 'Request created' },
    { id: 'AUD-2', requestId: 'REQ-1002', action: 'clarify', actor: 'Quality', timestamp: '2026-10-01T11:30:00Z', details: 'Need freight licence' },
    { id: 'AUD-3', requestId: 'REQ-1003', action: 'submitted', actor: 'Sales', timestamp: '2026-10-08T09:00:00Z', details: 'Request created' },
    { id: 'AUD-4', requestId: 'REQ-1005', action: 'approve', actor: 'Finance', timestamp: '2026-10-26T08:00:00Z', details: 'Approved' },
  ];
  return { customers, products, orders, requests, audit };
}

export default buildAnalytics;
