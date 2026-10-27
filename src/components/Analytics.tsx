import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronDown, ChevronUp, ClipboardCopy, Info, Lightbulb, Minus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { api } from '../api';
import './Analytics.css';

type Excluded = { enquiry: { orders: number; quantity: number }; setup: { orders: number; quantity: number }; orders: number; quantity: number };
type Point = { month: string; quantity: number; intensity?: number };
type ForecastPoint = { month: string; actual: number; baseline: number; candidate: number };
type Forecast = {
  horizonMonth: string; baselineModel: string; candidateModel: string;
  backtest: { minTrain: number; origins: number; points: ForecastPoint[]; baselineMae: number | null; candidateMae: number | null; meanActual: number | null; baselineMaePct: number | null; candidateMaePct: number | null; improvementPct: number | null; winner: 'candidate' | 'baseline' | 'tie' | 'insufficient-data' };
  trend: { slopePerMonth: number; r2: number };
  baselineForecast: number | null; candidateForecast: number | null; selected: 'baseline' | 'candidate'; selectedForecast: number | null; selectedMae: number | null; caveats: string[];
};
type Windows = { latestQuantity: number; previousQuantity: number; momGrowthPct: number | null; last3Quantity: number; prior3Quantity: number; growth3mPct: number | null };
type CountryEntry = Windows & {
  country: string; confirmedQuantity: number; confirmedOrders: number; sharePct: number; activeCustomers: number; rank: number; intensity: number;
  series: Point[]; byProduct: { productId: string; name: string; quantity: number; share: number; growth3mPct: number | null; series: number[] }[];
  excluded: Excluded; topCustomers: { id: string; name: string; quantity: number; sharePct: number; last3Quantity: number }[]; forecast: Forecast;
};
type Insight = {
  id: string; kind: 'risk' | 'opportunity'; type: string; priority: 'high' | 'medium' | 'low'; title: string; summary: string;
  countries: string[]; productIds: string[]; metrics: { label: string; value: string }[]; evidence: string[];
  customers: { id: string; name: string; country: string; detail: string }[];
  requests: { id: string; name: string; country: string; status: string; stage: string; daysOverdue: number }[]; action: string;
};
type View = {
  key: string; productIds: string[];
  totals: Windows & { confirmedQuantity: number; confirmedOrders: number; activeCustomers: number; latestMonth: string | null; excluded: Excluded };
  monthly: { month: string; confirmed: number; byCountry: Record<string, number>; byProduct: Record<string, number>; enquiryQuantity: number; setupQuantity: number }[];
  byProduct: { productId: string; name: string; quantity: number; sharePct: number }[];
  countries: CountryEntry[]; forecast: Forecast; risks: Insight[]; opportunities: Insight[];
};
type AnalyticsData = {
  meta: { months: string[]; nextMonth: string | null; countries: string[]; products: { id: string; name: string; category: string | null }[]; referenceDate: string; counts: Record<string, number>; dataQuality: Record<string, number>; methodology: Record<string, string> };
  views: Record<string, View>;
};

const COUNTRY_COLORS = ['#087f75', '#d08a3c', '#5b6fb5', '#b5566f', '#7d9a3f', '#7a7f86'];
const PRODUCT_COLORS = ['#087f75', '#d08a3c', '#5b6fb5', '#b5566f', '#7d9a3f'];
const CODES: Record<string, string> = { Singapore: 'SG', Malaysia: 'MY', Thailand: 'TH', Indonesia: 'ID', Vietnam: 'VN' };
const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number | null | undefined) => (n == null ? '—' : nf.format(Math.round(n)));
const pct = (n: number | null | undefined) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n}%`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const code = (c: string) => CODES[c] || c.slice(0, 2).toUpperCase();

function Trend({ value }: { value: number | null }) {
  if (value == null) return <span className="an-trend flat"><Minus size={13} />n/a</span>;
  const dir = value > 1 ? 'up' : value < -1 ? 'down' : 'flat';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return <span className={`an-trend ${dir}`}><Icon size={13} aria-hidden="true" /><span className="an-sr">{dir === 'up' ? 'up ' : dir === 'down' ? 'down ' : 'flat '}</span>{pct(value)}</span>;
}

/** Heatmap tile background: volume = teal ramp; growth = green (up) / amber (down) scaled to ±40%. */
function tileColor(c: CountryEntry, metric: 'volume' | 'growth') {
  if (metric === 'volume') return `rgba(8,127,117,${(0.06 + c.intensity * 0.5).toFixed(3)})`;
  const g = Math.max(-40, Math.min(40, c.growth3mPct ?? 0)) / 40;
  return g >= 0 ? `rgba(8,127,117,${(0.06 + g * 0.5).toFixed(3)})` : `rgba(208,138,60,${(0.06 - g * 0.55).toFixed(3)})`;
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [country, setCountry] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'total' | 'country' | 'product'>('total');
  const [heat, setHeat] = useState<'volume' | 'growth'>('volume');
  const [showExcluded, setShowExcluded] = useState(false);
  const [tab, setTab] = useState<'risk' | 'opportunity'>('risk');
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    setLoading(true); setError('');
    api<AnalyticsData>('/analytics').then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const products = data?.meta.products || [];
  const viewKey = useMemo(() => {
    if (!data || !selected.length || selected.length === products.length) return 'all';
    const key = products.filter((p) => selected.includes(p.id)).map((p) => p.id).join('+');
    return data.views[key] ? key : 'all';
  }, [data, selected, products]);
  const view = data?.views[viewKey] || data?.views.all;

  const toggleProduct = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pickCountry = (c: string | null, scroll = false) => {
    setCountry((cur) => (c && cur === c && !scroll ? null : c));
    if (c && scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  if (loading && !data) return <div className="analytics"><Header /><div className="panel an-state" role="status">Loading regional analytics…</div></div>;
  if (error && !data) return <div className="analytics"><Header /><div className="panel an-state" role="alert"><AlertTriangle size={22} /><p>Could not load analytics: {error}</p><button className="button" onClick={load}><RefreshCw size={15} />Try again</button></div></div>;
  if (!data || !view) return <div className="analytics"><Header /><div className="empty-state panel">No analytics available.</div></div>;

  const { meta } = data;
  const t = view.totals;
  const scopeName = viewKey === 'all' ? 'all products' : view.byProduct.map((p) => p.name).join(' + ');
  const activeCountry = country ? view.countries.find((c) => c.country === country) : undefined;
  const colorOf = (c: string) => COUNTRY_COLORS[meta.countries.indexOf(c) % COUNTRY_COLORS.length];
  const productColor = (id: string) => PRODUCT_COLORS[products.findIndex((p) => p.id === id) % PRODUCT_COLORS.length];

  return (
    <div className="analytics">
      <Header>
        <span className="badge" title="Latest month with order data">Data through {monthLabel(meta.months[meta.months.length - 1] || '2000-01')}</span>
        <button className="button secondary" onClick={load} disabled={loading} aria-label="Refresh analytics"><RefreshCw size={15} className={loading ? 'an-spin' : ''} />Refresh</button>
      </Header>
      {error && <div className="panel an-inline-error" role="alert">Refresh failed: {error}. Showing the last loaded data.</div>}

      <div className="an-toolbar">
        <div className="an-filter" role="group" aria-label="Product filter">
          <span className="an-filter-label">Products</span>
          <button className={`an-chip ${viewKey === 'all' ? 'on' : ''}`} aria-pressed={viewKey === 'all'} onClick={() => setSelected([])}>All products</button>
          {products.map((p) => (
            <button key={p.id} className={`an-chip ${viewKey !== 'all' && selected.includes(p.id) ? 'on' : ''}`} aria-pressed={viewKey !== 'all' && selected.includes(p.id)} onClick={() => toggleProduct(p.id)}>
              <i style={{ background: productColor(p.id) }} aria-hidden="true" />{p.name}
            </button>
          ))}
        </div>
        <div className="an-excluded-note" role="note">
          <Info size={15} aria-hidden="true" />
          <span>Demand counts <strong>confirmed</strong> orders only. Excluded for {scopeName}: <strong>{fmt(t.excluded.enquiry.orders)}</strong> enquiry orders ({fmt(t.excluded.enquiry.quantity)} units) and <strong>{fmt(t.excluded.setup.orders)}</strong> setup orders ({fmt(t.excluded.setup.quantity)} units).</span>
        </div>
      </div>

      <div className="stat-grid">
        <section className="stat-card"><div className="stat-label">Confirmed demand</div><strong>{fmt(t.confirmedQuantity)}</strong><small>units · {fmt(t.confirmedOrders)} orders · {fmt(t.activeCustomers)} customers · {meta.months.length} months</small></section>
        <section className="stat-card"><div className="stat-label">Latest month {t.latestMonth && `(${monthLabel(t.latestMonth)})`}</div><strong>{fmt(t.latestQuantity)}</strong><small><Trend value={t.momGrowthPct} /> vs {fmt(t.previousQuantity)} prior month</small></section>
        <section className="stat-card"><div className="stat-label">3-month growth</div><strong><Trend value={t.growth3mPct} /></strong><small>{fmt(t.last3Quantity)} units vs {fmt(t.prior3Quantity)} in the 3 months before</small></section>
        <section className="stat-card"><div className="stat-label">{meta.nextMonth && monthLabel(meta.nextMonth)} forecast</div><strong>{fmt(view.forecast.selectedForecast)}</strong><small>{view.forecast.selected === 'candidate' ? 'Linear trend' : 'Historical average'} · typical miss ±{fmt(view.forecast.selectedMae)} units</small></section>
      </div>

      <div className="an-grid an-grid-main">
        <section className="panel an-chart-panel" aria-labelledby="an-trend-h">
          <div className="an-panel-head">
            <div><h2 id="an-trend-h">Confirmed demand trend</h2><p className="muted">Units per month, {scopeName}</p></div>
            <div className="an-segment" role="group" aria-label="Chart view">
              {([['total', 'Total + forecast'], ['country', 'By country'], ['product', 'By product']] as const).map(([k, l]) => <button key={k} aria-pressed={chartMode === k} className={chartMode === k ? 'on' : ''} onClick={() => setChartMode(k)}>{l}</button>)}
            </div>
          </div>
          <TrendChart view={view} meta={meta} mode={chartMode} showExcluded={showExcluded} colorOf={colorOf} productColor={productColor} country={country} />
          <label className="an-check"><input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} /> Overlay excluded enquiry + setup units (not part of demand)</label>
        </section>
        <ForecastCard title={`Forecast check · ${scopeName}`} forecast={view.forecast} months={meta.months} />
      </div>

      <div className="an-grid an-grid-geo">
        <section className="panel" aria-labelledby="an-geo-h">
          <div className="an-panel-head">
            <div><h2 id="an-geo-h">Country heatmap</h2><p className="muted">Select a country for detail. Mini cells show each month, Oct–Sep.</p></div>
            <div className="an-segment" role="group" aria-label="Heatmap metric">
              {([['volume', 'Volume'], ['growth', '3-month growth']] as const).map(([k, l]) => <button key={k} aria-pressed={heat === k} className={heat === k ? 'on' : ''} onClick={() => setHeat(k)}>{l}</button>)}
            </div>
          </div>
          <div className="an-tiles">
            {view.countries.map((c) => (
              <button key={c.country} className={`an-tile ${country === c.country ? 'sel' : ''}`} style={{ background: tileColor(c, heat) }} aria-pressed={country === c.country} onClick={() => pickCountry(c.country)} aria-label={`${c.country}: ${fmt(c.confirmedQuantity)} confirmed units, 3-month growth ${pct(c.growth3mPct)}. ${country === c.country ? 'Selected' : 'Select for detail'}`}>
                <span className="an-tile-top"><span className="an-code">{code(c.country)}</span><span className="an-rank">#{c.rank}</span></span>
                <strong>{c.country}</strong>
                <span className="an-tile-num">{fmt(c.confirmedQuantity)}<small> units · {c.sharePct}%</small></span>
                <Trend value={c.growth3mPct} />
                <span className="an-strip" aria-hidden="true">{c.series.map((s) => <i key={s.month} title={`${monthLabel(s.month)}: ${fmt(s.quantity)}`} style={{ background: `rgba(8,127,117,${(0.08 + (s.intensity || 0) * 0.85).toFixed(2)})` }} />)}</span>
              </button>
            ))}
          </div>
          <div className="an-legend" aria-hidden="true">{heat === 'volume' ? <><span>Lower volume</span><i className="ramp teal" /><span>Higher volume</span></> : <><span>Declining</span><i className="ramp diverge" /><span>Growing</span></>}</div>
        </section>

        <section className="panel an-detail" ref={detailRef} aria-live="polite" aria-labelledby="an-detail-h">
          {activeCountry ? (
            <CountryDetail c={activeCountry} view={view} meta={meta} color={colorOf(activeCountry.country)} productColor={productColor} onClose={() => setCountry(null)} />
          ) : (
            <div className="an-empty"><h2 id="an-detail-h">Country detail</h2><p className="muted">Select a country tile to see its product mix, top customers, forecast accuracy and the risks and opportunities specific to it.</p>
              <ul className="an-rank-list">{view.countries.map((c) => <li key={c.country}><button onClick={() => pickCountry(c.country)}><span>{c.country}</span><span>{fmt(c.confirmedQuantity)} <Trend value={c.growth3mPct} /></span></button></li>)}</ul></div>
          )}
        </section>
      </div>

      <InsightsPanel view={view} tab={tab} setTab={setTab} country={country} clearCountry={() => setCountry(null)} onCountry={(c) => pickCountry(c, true)} />

      <p className="an-footnote">Illustrative synthetic data. Quantities are units, not revenue. Reference date for request ageing: {meta.referenceDate}. Method notes: {meta.methodology.growth} {meta.methodology.forecast}</p>
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div><div className="eyebrow">REGIONAL INTELLIGENCE</div><h1>Demand, risk and opportunity by market</h1><p>Confirmed purchasing only. Every signal below shows the evidence it was derived from.</p></div>
      {children && <div className="an-header-actions">{children}</div>}
    </div>
  );
}

function TrendChart({ view, meta, mode, showExcluded, colorOf, productColor, country }: { view: View; meta: AnalyticsData['meta']; mode: 'total' | 'country' | 'product'; showExcluded: boolean; colorOf: (c: string) => string; productColor: (id: string) => string; country: string | null }) {
  const rows = useMemo(() => {
    const out: any[] = view.monthly.map((m, i) => ({
      key: m.month, month: monthLabel(m.month), confirmed: m.confirmed, excluded: m.enquiryQuantity + m.setupQuantity, ...m.byCountry,
      ...Object.fromEntries(Object.entries(m.byProduct).map(([k, v]) => [`p:${k}`, v])),
      ...(i === view.monthly.length - 1 && mode === 'total' ? { forecast: m.confirmed } : {}),
    }));
    if (mode === 'total' && meta.nextMonth && view.forecast.selectedForecast != null) {
      out.push({ key: meta.nextMonth, month: monthLabel(meta.nextMonth), forecast: view.forecast.selectedForecast, avgPoint: view.forecast.baselineForecast, trendPoint: view.forecast.candidateForecast });
    }
    return out;
  }, [view, meta.nextMonth, mode]);
  const tip = (v: any, n: any) => [`${fmt(Number(v))} units`, n];
  return (
    <div className="an-chart" role="img" aria-label={`Monthly confirmed demand chart, ${mode === 'total' ? 'total with next-month forecast' : mode === 'country' ? 'stacked by country' : 'stacked by product'}. Data is also in the country and forecast tables.`}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e8eeec" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#76868a' }} tickLine={false} axisLine={{ stroke: '#d8e2df' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: '#76868a' }} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => nf.format(v)} />
          <Tooltip formatter={tip} contentStyle={{ borderRadius: 8, border: '1px solid #e1e8e6', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {mode === 'total' && <>
            <Area type="monotone" dataKey="confirmed" name="Confirmed demand" stroke="#087f75" strokeWidth={2.5} fill="#087f75" fillOpacity={0.14} dot={{ r: 3 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="forecast" name={`Forecast (${view.forecast.selected === 'candidate' ? 'trend' : 'average'})`} stroke="#d08a3c" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 4 }} isAnimationActive={false} connectNulls />
            <Line dataKey="avgPoint" name="Historical average" stroke="none" dot={{ r: 5, fill: '#5b6fb5', stroke: '#fff' }} isAnimationActive={false} legendType="circle" />
            <Line dataKey="trendPoint" name="Linear trend" stroke="none" dot={{ r: 5, fill: '#b5566f', stroke: '#fff' }} isAnimationActive={false} legendType="circle" />
          </>}
          {mode === 'country' && meta.countries.map((c) => <Area key={c} type="monotone" stackId="c" dataKey={c} name={c} stroke={colorOf(c)} fill={colorOf(c)} fillOpacity={country && country !== c ? 0.18 : 0.75} strokeWidth={country === c ? 2.5 : 1} isAnimationActive={false} />)}
          {mode === 'product' && view.productIds.map((id) => <Bar key={id} stackId="p" dataKey={`p:${id}`} name={view.byProduct.find((p) => p.productId === id)?.name || id} fill={productColor(id)} isAnimationActive={false} />)}
          {showExcluded && <Line type="monotone" dataKey="excluded" name="Excluded enquiry + setup" stroke="#8b9799" strokeDasharray="3 3" strokeWidth={2} dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ForecastCard({ title, forecast: f, months, compact }: { title: string; forecast: Forecast; months: string[]; compact?: boolean }) {
  const b = f.backtest;
  const verdict = {
    candidate: `Trend beat the historical average by ${b.improvementPct}% MAE on held-out months, so it is used.`,
    baseline: b.improvementPct != null ? `Trend was ${Math.abs(b.improvementPct)}% worse than the historical average on held-out months, so the average is used.` : 'The historical average had zero error on held-out months; the trend did worse, so the average is used.',
    tie: 'No meaningful difference between the models on held-out months; the simpler historical average is used.',
    'insufficient-data': 'Too few held-out months to compare the models; the historical average is used.',
  }[b.winner];
  const maxMae = Math.max(b.baselineMae || 0, b.candidateMae || 0, 1);
  return (
    <section className={`panel an-forecast ${compact ? 'compact' : ''}`} aria-label={title}>
      <div className="an-panel-head"><div><h2>{compact ? 'Forecast accuracy' : 'Forecast check'}</h2><p className="muted">{compact ? `Next month ${monthLabel(f.horizonMonth)}` : title.replace('Forecast check · ', '')}</p></div><span className={`badge ${b.winner === 'candidate' ? 'success' : b.winner === 'baseline' ? 'warning' : ''}`}>{b.winner === 'candidate' ? 'Trend wins' : b.winner === 'baseline' ? 'Average wins' : b.winner === 'tie' ? 'No clear winner' : 'Thin evidence'}</span></div>
      <p className="an-verdict">{verdict}</p>
      <div className="an-mae" aria-label="Mean absolute error on held-out months">
        {([['Historical average', b.baselineMae, f.baselineForecast, 'avg'], ['Linear trend', b.candidateMae, f.candidateForecast, 'trend']] as const).map(([name, mae, fc, k]) => (
          <div key={k} className={`an-mae-row ${f.selected === (k === 'avg' ? 'baseline' : 'candidate') ? 'chosen' : ''}`}>
            <span>{name}{f.selected === (k === 'avg' ? 'baseline' : 'candidate') && <em> · selected</em>}</span>
            <div className="an-mae-bar"><i className={k} style={{ width: `${mae == null ? 0 : Math.max(2, (mae / maxMae) * 100)}%` }} /></div>
            <span className="an-mae-val">MAE {fmt(mae)}{b.meanActual ? <small> ({k === 'avg' ? b.baselineMaePct : b.candidateMaePct}%)</small> : null}</span>
            <span className="an-mae-fc">→ {fmt(fc)}</span>
          </div>
        ))}
      </div>
      {b.points.length > 0 && !compact && (
        <div className="an-chart small" role="img" aria-label="Held-out months: actual versus both forecasts. Values are in the table below.">
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={b.points.map((p) => ({ ...p, label: monthLabel(p.month) }))} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e8eeec" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#76868a' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#76868a' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => nf.format(v)} domain={['auto', 'auto']} />
              <Tooltip formatter={(v: any, n: any) => [fmt(Number(v)), n]} contentStyle={{ borderRadius: 8, border: '1px solid #e1e8e6', fontSize: 12 }} />
              <Line dataKey="actual" name="Actual" stroke="#20393f" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              <Line dataKey="baseline" name="Historical average" stroke="#5b6fb5" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              <Line dataKey="candidate" name="Linear trend" stroke="#b5566f" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <details className="an-table-details">
        <summary>Held-out months ({b.origins}) · rolling origin from month {b.minTrain + 1}</summary>
        <div className="an-table-wrap"><table><thead><tr><th>Month</th><th>Actual</th><th>Average</th><th>Trend</th><th>|Err| avg</th><th>|Err| trend</th></tr></thead><tbody>
          {b.points.map((p) => <tr key={p.month}><td>{monthLabel(p.month)}</td><td>{fmt(p.actual)}</td><td>{fmt(p.baseline)}</td><td>{fmt(p.candidate)}</td><td>{fmt(Math.abs(p.actual - p.baseline))}</td><td>{fmt(Math.abs(p.actual - p.candidate))}</td></tr>)}
          {b.points.length === 0 && <tr><td colSpan={6}>No held-out months available.</td></tr>}
        </tbody></table></div>
      </details>
      <ul className="an-caveats">{f.caveats.map((c) => <li key={c}>{c}</li>)}<li>Window: {months[0] ? monthLabel(months[0]) : ''}–{months.length ? monthLabel(months[months.length - 1]) : ''}. Error is MAE in units; negative improvement is reported as-is.</li></ul>
    </section>
  );
}

function CountryDetail({ c, view, meta, color, productColor, onClose }: { c: CountryEntry; view: View; meta: AnalyticsData['meta']; color: string; productColor: (id: string) => string; onClose: () => void }) {
  const rows = c.series.map((s, i) => ({ month: monthLabel(s.month), ...Object.fromEntries(c.byProduct.map((p) => [p.productId, p.series[i]])) }));
  const related = [...view.risks, ...view.opportunities].filter((i) => i.countries.includes(c.country));
  return (
    <>
      <div className="an-panel-head">
        <div><div className="an-detail-title"><i style={{ background: color }} aria-hidden="true" /><h2 id="an-detail-h">{c.country}</h2><span className="an-code">{code(c.country)}</span></div><p className="muted">Rank #{c.rank} of {view.countries.length} · {c.sharePct}% of confirmed demand</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Close country detail"><X size={16} /></button>
      </div>
      <dl className="an-kv">
        <div><dt>Confirmed units</dt><dd>{fmt(c.confirmedQuantity)}</dd></div>
        <div><dt>3-month growth</dt><dd><Trend value={c.growth3mPct} /></dd></div>
        <div><dt>Latest month</dt><dd>{fmt(c.latestQuantity)} <Trend value={c.momGrowthPct} /></dd></div>
        <div><dt>Active customers</dt><dd>{fmt(c.activeCustomers)}</dd></div>
        <div><dt>Excluded enquiry</dt><dd>{fmt(c.excluded.enquiry.orders)} <small>({fmt(c.excluded.enquiry.quantity)} u)</small></dd></div>
        <div><dt>Excluded setup</dt><dd>{fmt(c.excluded.setup.orders)} <small>({fmt(c.excluded.setup.quantity)} u)</small></dd></div>
      </dl>
      <div className="an-chart small" role="img" aria-label={`${c.country} monthly confirmed units by product`}>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e8eeec" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#76868a' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#76868a' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => nf.format(v)} />
            <Tooltip formatter={(v: any, n: any) => [`${fmt(Number(v))} units`, n]} contentStyle={{ borderRadius: 8, border: '1px solid #e1e8e6', fontSize: 12 }} />
            {c.byProduct.map((p) => <Bar key={p.productId} stackId="x" dataKey={p.productId} name={p.name} fill={productColor(p.productId)} isAnimationActive={false} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <h3 className="an-sub">Product mix</h3>
      <ul className="an-bars">{c.byProduct.map((p) => <li key={p.productId}><span>{p.name}</span><div><i style={{ width: `${p.share}%`, background: productColor(p.productId) }} /></div><span>{p.share}% · {fmt(p.quantity)} <Trend value={p.growth3mPct} /></span></li>)}</ul>
      <h3 className="an-sub">Top customers</h3>
      {c.topCustomers.length ? <ul className="an-bars">{c.topCustomers.map((x) => <li key={x.id}><span title={x.name}>{x.name}</span><div><i style={{ width: `${x.sharePct}%`, background: color }} /></div><span>{x.sharePct}% · {fmt(x.quantity)}</span></li>)}</ul> : <p className="muted">No confirmed orders in this selection.</p>}
      <h3 className="an-sub">Next-month forecast</h3>
      <ForecastCard title={`${c.country}`} forecast={c.forecast} months={meta.months} compact />
      <h3 className="an-sub">Signals for {c.country} ({related.length})</h3>
      {related.length ? <ul className="an-related">{related.map((i) => <li key={i.id}><span className={`an-dot ${i.kind} ${i.priority}`} aria-hidden="true" />{i.title}<span className="an-sr"> ({i.kind}, {i.priority})</span></li>)}</ul> : <p className="muted">No risks or opportunities detected for this selection.</p>}
    </>
  );
}

function InsightsPanel({ view, tab, setTab, country, clearCountry, onCountry }: { view: View; tab: 'risk' | 'opportunity'; setTab: (t: 'risk' | 'opportunity') => void; country: string | null; clearCountry: () => void; onCountry: (c: string) => void }) {
  const scoped = (l: Insight[]) => (country ? l.filter((i) => i.countries.includes(country)) : l);
  const risks = scoped(view.risks), opps = scoped(view.opportunities);
  const list = tab === 'risk' ? risks : opps;
  return (
    <section className="panel an-insights" aria-labelledby="an-ins-h">
      <div className="an-panel-head">
        <div><h2 id="an-ins-h">Risks &amp; opportunities</h2><p className="muted">Each card lists the numbers and records behind it and a suggested next step.</p></div>
        <div className="an-segment" role="tablist" aria-label="Signal type">
          <button role="tab" aria-selected={tab === 'risk'} className={tab === 'risk' ? 'on' : ''} onClick={() => setTab('risk')}><ShieldAlert size={14} />Risks <b>{risks.length}</b></button>
          <button role="tab" aria-selected={tab === 'opportunity'} className={tab === 'opportunity' ? 'on' : ''} onClick={() => setTab('opportunity')}><Lightbulb size={14} />Opportunities <b>{opps.length}</b></button>
        </div>
      </div>
      {country && <div className="an-scope">Showing {country} only <button className="text-button" onClick={clearCountry}>Show all countries</button></div>}
      <div role="tabpanel" className="an-cards">
        {list.length === 0 && <div className="empty-state an-none">No {tab === 'risk' ? 'risks' : 'opportunities'} detected{country ? ` for ${country}` : ''} in this selection. Thresholds are explicit; nothing is shown without evidence.</div>}
        {list.map((i) => <InsightCard key={i.id} i={i} country={country} onCountry={onCountry} />)}
      </div>
    </section>
  );
}

function InsightCard({ i, country, onCountry }: { i: Insight; country: string | null; onCountry: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const customers = country ? i.customers.filter((c) => c.country === country) : i.customers;
  const shown = all ? customers : customers.slice(0, 4);
  const brief = `${i.title}\n${i.summary}\n\nEvidence:\n${i.evidence.map((e) => `- ${e}`).join('\n')}\n\nSuggested action: ${i.action}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(brief); } catch { const ta = document.createElement('textarea'); ta.value = brief; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  return (
    <article className={`an-card ${i.kind} ${i.priority}`}>
      <header>
        <span className={`badge ${i.priority === 'high' ? 'warning' : i.kind === 'opportunity' ? 'success' : ''}`}>{i.priority.toUpperCase()} {i.kind === 'risk' ? 'RISK' : 'OPPORTUNITY'}</span>
        <span className="an-countries">{i.countries.map((c) => <button key={c} className="an-pill" onClick={() => onCountry(c)} title={`Open ${c} detail`}>{c}</button>)}</span>
      </header>
      <h3>{i.title}</h3>
      <p className="muted">{i.summary}</p>
      <dl className="an-metrics">{i.metrics.map((m) => <div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
      <button className="text-button an-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}Evidence ({i.evidence.length}{customers.length ? ` · ${customers.length} record${customers.length > 1 ? 's' : ''}` : ''})</button>
      {open && (
        <div className="an-evidence">
          <ul>{i.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>
          {shown.length > 0 && <><h4>Customers</h4><ul className="an-cust">{shown.map((c) => <li key={c.id}><strong>{c.name}</strong> <span className="muted">{c.id} · {c.country}</span><br /><span>{c.detail}</span></li>)}</ul>{customers.length > 4 && <button className="text-button" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${customers.length}`}</button>}</>}
          {i.requests.length > 0 && <><h4>Requests</h4><ul className="an-cust">{i.requests.map((r) => <li key={r.id}><strong>{r.id}</strong> {r.name} <span className="muted">{r.status} · {r.stage} · {r.daysOverdue} d overdue</span></li>)}</ul></>}
        </div>
      )}
      <footer>
        <p><strong>Next step</strong>{i.action}</p>
        <button className="button secondary" onClick={copy} aria-live="polite">{copied ? <><Check size={14} />Copied</> : <><ClipboardCopy size={14} />Copy brief</>}</button>
      </footer>
    </article>
  );
}
