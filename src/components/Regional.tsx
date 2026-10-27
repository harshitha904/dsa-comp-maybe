import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { api, countryCode, entities, errorText, fmt, monthLabel, type Customer } from '../api';
import './Regional.css';

type Model = {id:string;name:string;mae:number|null;maePct:number|null;forecast:number};
type Watch = {id:string;name:string;country:string;entity:string|null;last3Quantity:number;prior3Quantity:number;changePct:number;series:number[]};
type Forecast = {models:Model[];selectedForecast:number;selectedMae:number;selected:'baseline'|'candidate'|'holt';baselineModel:string;candidateModel:string;backtest:{baselineMae:number;candidateMae:number;baselineMaePct:number;candidateMaePct:number;origins:number}};
type ProductCell = {productId:string;name:string;quantity:number;share:number;growth3mPct:number|null};
type Country = {country:string;confirmedQuantity:number;sharePct:number;growth3mPct:number|null;series:number[];byProduct:ProductCell[];forecast:Forecast;activeCustomers:number};
type Signal = {id:string;kind:'risk'|'opportunity';priority:'high'|'medium'|'low';title:string;summary:string;countries:string[];metrics:{label:string;value:string}[];evidence:string[];customers:{id:string;name:string}[];requests:{id:string}[]|string[];action:string};
type View = {totals:{confirmedQuantity:number;confirmedOrders:number;activeCustomers:number;growth3mPct:number|null;excluded:{enquiry:{orders:number;quantity:number};setup:{orders:number;quantity:number};orders:number;quantity:number}};monthly:{month:string;confirmed:number}[];countries:Country[];forecast:Forecast;risks:Signal[];opportunities:Signal[];watchlist:Watch[]};
type Analytics = {meta:{months:string[];nextMonth:string;products:{id:string;name:string}[]};views:Record<string,View>};

const rank = {high:0, medium:1, low:2};
const short: Record<string, string> = {baseline:'Average', candidate:'Trend', holt:'Holt'};

function Growth({value}: {value: number|null|undefined}) {
 if (value == null) return <span className="flat">–</span>;
 const cls = value > 1 ? 'up' : value < -1 ? 'down' : 'flat';
 const Icon = cls === 'up' ? ArrowUpRight : cls === 'down' ? ArrowDownRight : Minus;
 return <span className={`growth ${cls}`}><Icon size={13}/>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}

export default function Regional({onOpenCustomer, onOpenRequest}: {onOpenCustomer:(id:string)=>void; onOpenRequest:(id:string)=>void}) {
 const [data, setData] = useState<Analytics>();
 const [error, setError] = useState('');
 const [product, setProduct] = useState('all');
 const [country, setCountry] = useState('');
 const [showAll, setShowAll] = useState(false);
 const [base, setBase] = useState<{customers:Customer[]; orders:{customerId:string;productId:string;country:string;quantity:number;signal:string}[]}>();
 useEffect(() => { api<Analytics>('/analytics').then(setData).catch(e => setError(errorText(e))); api('/bootstrap').then(setBase).catch(() => {}); }, []);
 // Entity × country from confirmed orders, plus customers that exist under more than one entity.
 const byEntity = useMemo(() => {
  if (!base) return undefined;
  const entityOf = new Map(base.customers.map(c => [c.id, c.entity ?? '–']));
  const cells = new Map<string, number>();
  base.orders.filter(o => o.signal === 'confirmed' && (product === 'all' || o.productId === product)).forEach(o => {
   const k = `${entityOf.get(o.customerId)}|${o.country}`; cells.set(k, (cells.get(k) ?? 0) + o.quantity);
  });
  const units = (id: string) => base.orders.filter(o => o.signal === 'confirmed' && o.customerId === id && (product === 'all' || o.productId === product)).reduce((n, o) => n + o.quantity, 0);
  const groups = new Map<string, Customer[]>();
  base.customers.forEach(c => { if (c.identifier) groups.set(c.identifier, [...(groups.get(c.identifier) ?? []), c]); });
  const split = [...groups.values()].filter(g => new Set(g.map(c => c.entity)).size > 1).map(g => g.map(c => ({c, units:units(c.id)})));
  return {cells, split};
 }, [base, product]);

 const view = data?.views[product];
 const selected = view?.countries.find(c => c.country === country);
 const chart = useMemo(() => {
  if (!data || !view) return [];
  const series = selected ? selected.series : view.monthly.map(m => m.confirmed);
  const forecast = (selected ?? view).forecast.selectedForecast;
  const rows: {month:string;actual?:number;forecast?:number}[] = data.meta.months.map((m, i) => ({month: monthLabel(m), actual: series[i]}));
  rows[rows.length - 1].forecast = rows[rows.length - 1].actual;
  rows.push({month: monthLabel(data.meta.nextMonth), forecast: Math.round(forecast)});
  return rows;
 }, [data, view, selected]);
 const signals = useMemo(() => {
  if (!view) return [];
  const sort = (xs: Signal[]) => xs.slice().sort((a, b) => rank[a.priority] - rank[b.priority]);
  const risks = sort(view.risks), opps = sort(view.opportunities);
  // Lead with the top 3 risks and top 2 opportunities so both show without expanding.
  return [...risks.slice(0, 3), ...opps.slice(0, 2), ...risks.slice(3), ...opps.slice(2)];
 }, [view]);

 if (error) return <div className="card empty">{error}</div>;
 if (!data || !view) return <div className="loading">Loading regional data…</div>;
 const {totals} = view;
 const fc = (selected ?? view).forecast;
 const products = data.meta.products;
 const productCols = product === 'all' ? products : products.filter(p => p.id === product);
 const max = Math.max(...view.countries.flatMap(c => c.byProduct.map(p => p.quantity)));
 const first = data.meta.months[0], last = data.meta.months[data.meta.months.length - 1];

 return <div className="regional">
  <div className="page-head">
   <div><h1>Regional view</h1><p>Confirmed orders, {monthLabel(first)} – {monthLabel(last)}. Enquiries and setup requests are kept out.</p></div>
   <div className="chips">{[{id:'all', name:'All products'}, ...products].map(p => <button key={p.id} className={`chip ${product === p.id ? 'on' : ''}`} onClick={() => setProduct(p.id)}>{p.name}</button>)}</div>
  </div>

  <div className="grid g4">
   <div className="stat"><div className="label">Confirmed units · 12 months</div><div className="value num">{fmt(totals.confirmedQuantity)}</div><div className="sub">{fmt(totals.confirmedOrders)} orders · {totals.activeCustomers} customers</div></div>
   <div className="stat"><div className="label">3-month growth</div><div className="value"><Growth value={totals.growth3mPct}/></div><div className="sub">vs the 3 months before</div></div>
   <div className="stat"><div className="label">Forecast · {monthLabel(data.meta.nextMonth)}</div><div className="value num">{fmt(view.forecast.selectedForecast)}</div><div className="sub">± {fmt(view.forecast.selectedMae)} units typical error</div></div>
   <div className="stat"><div className="label">Kept out of demand</div><div className="value num">{totals.excluded.orders}</div><div className="sub">{totals.excluded.enquiry.orders} enquiries · {totals.excluded.setup.orders} setup requests</div></div>
  </div>

  <BubbleMap countries={view.countries} signals={view.opportunities} selected={country} onSelect={c => setCountry(country === c ? '' : c)}/>

  <div className="card table-card">
   <div className="card-head"><h2>Country × product</h2><span className="muted small">Units · 3-month growth · click a row to chart it</span></div>
   <table className="matrix">
    <thead><tr><th>Country</th>{productCols.map(p => <th key={p.id}>{p.name}</th>)}{product === 'all' && <th>Total</th>}</tr></thead>
    <tbody>{view.countries.map(c => <tr key={c.country} className={country === c.country ? 'sel' : ''} onClick={() => setCountry(country === c.country ? '' : c.country)}>
     <td><span className="cc">{countryCode[c.country]}</span>{c.country}</td>
     {productCols.map(p => { const cell = c.byProduct.find(b => b.productId === p.id); const heat = cell ? cell.quantity / max : 0; return <td key={p.id} style={{background:`rgba(36,92,79,${(heat * 0.22).toFixed(3)})`}}>{cell ? <><span className="num">{fmt(cell.quantity)}</span><Growth value={cell.growth3mPct}/></> : <span className="flat">–</span>}</td>; })}
     {product === 'all' && <td className="total"><span className="num">{fmt(c.confirmedQuantity)}</span><Growth value={c.growth3mPct}/></td>}
    </tr>)}</tbody>
   </table>
   <p className="muted small foot">Growth = confirmed units in the last 3 months vs the 3 months before.</p>
  </div>

  {byEntity && <div className="card table-card">
   <div className="card-head"><h2>By business entity</h2><span className="muted small">Confirmed units · entity that owns the customer record</span></div>
   <table className="matrix entity">
    <thead><tr><th>Entity</th>{view.countries.map(c => <th key={c.country}>{c.country}</th>)}<th>Total</th></tr></thead>
    <tbody>{entities.map(e => { const row = view.countries.map(c => byEntity.cells.get(`${e}|${c.country}`) ?? 0); return <tr key={e}>
     <td><strong>{e}</strong></td>{row.map((v, i) => <td key={i} className="num">{v ? fmt(v) : <span className="flat">–</span>}</td>)}<td className="total num">{fmt(row.reduce((a, b) => a + b, 0))}</td>
    </tr>; })}</tbody>
   </table>
   {byEntity.split.map(g => <div key={g[0].c.id} className="alert amber split"><strong>Same customer, two entities:</strong> {g.map(x => `${x.c.name} (${x.c.entity}, ${fmt(x.units)} units)`).join(' and ')}. Its demand looks split in two until the records are linked. <button className="btn ghost" onClick={() => onOpenCustomer(g[0].c.id)}>Review in Graph</button></div>)}
  </div>}

  <div className="grid chart-row">
   <div className="card">
    <div className="card-head"><h2>Monthly demand{selected ? ` · ${selected.country}` : ''}</h2>{selected && <button className="btn ghost" onClick={() => setCountry('')}>Show all countries</button>}</div>
    <div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:8, right:8, left:-12, bottom:0}}>
     <CartesianGrid stroke="#ecece6" vertical={false}/>
     <XAxis dataKey="month" tick={{fontSize:11, fill:'#6b736f'}} tickLine={false} axisLine={false}/>
     <YAxis tick={{fontSize:11, fill:'#6b736f'}} tickLine={false} axisLine={false} domain={['auto', 'auto']}/>
     <Tooltip formatter={(v, n) => [fmt(Number(v)), n === 'actual' ? 'Confirmed' : 'Forecast']} contentStyle={{borderRadius:8, border:'1px solid #e6e6e0', fontSize:12}}/>
     <Line dataKey="actual" stroke="#245c4f" strokeWidth={2.5} dot={false}/>
     <Line dataKey="forecast" stroke="#b7791f" strokeWidth={2} strokeDasharray="5 4" dot={{r:4, fill:'#b7791f'}}/>
    </LineChart></ResponsiveContainer></div>
    <div className="legend"><span><i style={{background:'#245c4f'}}/>Confirmed</span><span><i className="dash"/>Forecast</span></div>
   </div>
   <div className="card forecast-card">
    <h2>Which forecast is more accurate?</h2>
    <p className="muted small">{selected ? selected.country : 'All countries'}: three methods tested on the last {fc.backtest.origins} months. The most accurate is used.</p>
    {fc.models.map(m => { const on = m.id === fc.selected; return <div key={m.id} className={`model ${on ? 'on' : ''}`}>
     <div><strong>{m.id === 'baseline' ? 'Average (today’s method)' : m.name}</strong>{on && <span className="pill green">Used</span>}</div>
     <div className="bar"><span style={{width:`${Math.min(100, (m.maePct ?? 0) * 10)}%`}}/></div>
     <span className="muted small">Off by {fmt(m.mae ?? 0)} units a month ({(m.maePct ?? 0).toFixed(1)}%)</span>
    </div>; })}
    <div className="per-country"><span className="muted small">Used per country:</span>{view.countries.map(c => <span key={c.country} className="pill grey">{countryCode[c.country]} · {short[c.forecast.selected]}</span>)}</div>
   </div>
  </div>

  {view.watchlist.length > 0 && <div className="card">
   <div className="card-head"><h2>Early warning: customers slowing down</h2><span className="muted small">Still ordering, but down 15%+ on the 3 months before</span></div>
   {view.watchlist.map(w => { const max = Math.max(...w.series, 1); const pts = w.series.map((v, i) => `${i * 10},${30 - v / max * 26}`).join(' ');
    return <div key={w.id} className="watch">
     <div><strong>{w.name}</strong><span className="muted small">{w.entity} · {w.country}</span></div>
     <svg viewBox="0 0 110 32" className="spark"><polyline points={pts}/></svg>
     <span className="num">{fmt(w.prior3Quantity)} → {fmt(w.last3Quantity)}</span>
     <Growth value={w.changePct}/>
     <button className="btn ghost" onClick={() => onOpenCustomer(w.id)}>View</button>
    </div>; })}
   <p className="muted small foot">Call these accounts now. Customers who already stopped ordering are listed under risks.</p>
  </div>}

  <div className="card">
   <div className="card-head"><h2>What to do next</h2><span className="muted small">{view.risks.length} risks · {view.opportunities.length} opportunities</span></div>
   <div className="signals">{(showAll ? signals : signals.slice(0, 5)).map(s => <div key={s.id} className="signal">
    <div className="signal-top">
     <span className={`pill ${s.kind === 'risk' ? (s.priority === 'high' ? 'red' : 'amber') : 'green'}`}>{s.kind === 'risk' ? 'Risk' : 'Opportunity'}</span>
     <span className="muted small">{s.countries.join(', ')}</span>
    </div>
    <strong>{s.title}</strong>
    <p className="action"><ArrowRight size={14}/>{s.action.replace('Customer Intelligence', 'the Graph')}</p>
    <details><summary>Details</summary>
     <div className="metrics">{s.metrics.map(m => <div key={m.label}><span className="muted small">{m.label}</span><strong>{m.value}</strong></div>)}</div>
     <ul className="plain small">{s.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
     <div className="links">{s.customers.map(c => <button key={c.id} className="btn ghost" onClick={() => onOpenCustomer(c.id)}>{c.name} in graph</button>)}
      {s.requests.map(r => { const id = typeof r === 'string' ? r : r.id; return <button key={id} className="btn ghost" onClick={() => onOpenRequest(id)}>Open {id}</button>; })}</div>
    </details>
   </div>)}</div>
   {signals.length > 5 && <button className="btn secondary more" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${signals.length}`}</button>}
  </div>
 </div>;
}

// Rough geographic placement so the region reads as a map; size and colour come from the data.
const spots: Record<string, {x:number; y:number}> = {Thailand:{x:235,y:100}, Vietnam:{x:440,y:105}, Malaysia:{x:250,y:255}, Singapore:{x:395,y:300}, Indonesia:{x:590,y:265}};
function BubbleMap({countries, signals, selected, onSelect}: {countries:Country[]; signals:Signal[]; selected:string; onSelect:(c:string)=>void}) {
 const max = Math.max(...countries.map(c => c.confirmedQuantity));
 const tone = (g: number|null) => g == null ? 'flat' : g > 3 ? 'up' : g < -3 ? 'down' : 'flat';
 const top = [...signals].sort((a, b) => rank[a.priority] - rank[b.priority]).find(s => s.countries.some(c => spots[c]));
 const anchor = top && spots[top.countries.find(c => spots[c])!];
 return <div className="card bubble-card">
  <div className="card-head"><h2>Where demand is moving</h2><span className="muted small">Bubble size = confirmed units · colour = 3-month growth</span></div>
  <svg viewBox="0 0 760 380" role="img" aria-label="Confirmed demand and growth by country">
   {anchor && <g className="b-callout"><line x1={anchor.x} y1={anchor.y} x2={Math.min(anchor.x + 150, 540)} y2={Math.max(anchor.y - 55, 40)}/><foreignObject x={Math.min(anchor.x + 150, 540)} y={Math.max(anchor.y - 80, 14)} width="210" height="60"><div className="b-tag">{top!.title}</div></foreignObject></g>}
   {countries.filter(c => spots[c.country]).map(c => { const p = spots[c.country], r = 24 + 42 * Math.sqrt(c.confirmedQuantity / max), t = tone(c.growth3mPct);
    return <g key={c.country} className={`b-node ${t} ${selected === c.country ? 'sel' : ''}`} role="button" tabIndex={0} aria-label={`${c.country}: ${fmt(c.confirmedQuantity)} units`} onClick={() => onSelect(c.country)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.country); } }}>
     <circle cx={p.x} cy={p.y} r={r}/>
     <text x={p.x} y={p.y - 4} className="b-name">{c.country}</text>
     <text x={p.x} y={p.y + 12} className="b-val">{c.growth3mPct == null ? '–' : `${Math.round(c.growth3mPct) > 0 ? '+' : ''}${Math.round(c.growth3mPct) || 0}%`} · {fmt(c.confirmedQuantity)}</text>
    </g>; })}
  </svg>
  {top && <p className="b-action"><ArrowRight size={14}/><span><strong>Next best action:</strong> {top.action}</span></p>}
 </div>;
}
