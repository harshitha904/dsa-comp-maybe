import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { api, countryCode, errorText, fmt, monthLabel } from '../api';
import './Regional.css';

type Forecast = {selectedForecast:number;selectedMae:number;selected:'baseline'|'candidate';baselineModel:string;candidateModel:string;backtest:{baselineMae:number;candidateMae:number;baselineMaePct:number;candidateMaePct:number;origins:number}};
type ProductCell = {productId:string;name:string;quantity:number;share:number;growth3mPct:number|null};
type Country = {country:string;confirmedQuantity:number;sharePct:number;growth3mPct:number|null;series:number[];byProduct:ProductCell[];forecast:Forecast;activeCustomers:number};
type Signal = {id:string;kind:'risk'|'opportunity';priority:'high'|'medium'|'low';title:string;summary:string;countries:string[];metrics:{label:string;value:string}[];evidence:string[];customers:{id:string;name:string}[];requests:{id:string}[]|string[];action:string};
type View = {totals:{confirmedQuantity:number;confirmedOrders:number;activeCustomers:number;growth3mPct:number|null;excluded:{enquiry:{orders:number;quantity:number};setup:{orders:number;quantity:number};orders:number;quantity:number}};monthly:{month:string;confirmed:number}[];countries:Country[];forecast:Forecast;risks:Signal[];opportunities:Signal[]};
type Analytics = {meta:{months:string[];nextMonth:string;products:{id:string;name:string}[]};views:Record<string,View>};

const rank = {high:0, medium:1, low:2};

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
 useEffect(() => { api<Analytics>('/analytics').then(setData).catch(e => setError(errorText(e))); }, []);

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
    <p className="muted small">Both methods were tested on the last {fc.backtest.origins} months. The more accurate one is used.</p>
    {[{name:'6–12 month average (today’s method)', mae:fc.backtest.baselineMae, pct:fc.backtest.baselineMaePct, on:fc.selected === 'baseline'}, {name:'Trend model', mae:fc.backtest.candidateMae, pct:fc.backtest.candidateMaePct, on:fc.selected === 'candidate'}].map(m => <div key={m.name} className={`model ${m.on ? 'on' : ''}`}>
     <div><strong>{m.name}</strong>{m.on && <span className="pill green">Used</span>}</div>
     <div className="bar"><span style={{width:`${Math.min(100, m.pct * 10)}%`}}/></div>
     <span className="muted small">Off by {fmt(m.mae)} units a month ({m.pct.toFixed(1)}%)</span>
    </div>)}
    <p className="small note">Only 12 months of data, so seasonality is not modelled yet.</p>
   </div>
  </div>

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
