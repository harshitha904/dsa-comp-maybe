import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { graphEntities, graphEntity, groupGraphCustomers } from '../lib/graph-groups';
import './Graph.css';

type Customer = { id:string; entity?:string; name:string; country:string; identifier:string; email:string; aliases:string[] };
type Product = { id:string; name:string; category:string };
type Order = { id:string; customerId:string; productId:string; country:string; month:string; quantity:number; signal:string };
type Bootstrap = { customers:Customer[]; products:Product[]; orders:Order[] };
type Match = { customer:Customer; score:number; evidence:string[] };
type Simulation = { before:{customerCount:number;sourceQuantity:number;targetQuantity:number};after:{customerCount:number;targetQuantity:number};affectedOrders:number;totalQuantity:number;explanation:string };
const countryNames:Record<string,string> = { SG:'Singapore', MY:'Malaysia', TH:'Thailand', ID:'Indonesia', VN:'Vietnam' };
// Redaction placeholders are missing evidence, never shared identity signals.
const usable = (value:string) => {
 const v=value.trim().toLowerCase();
 return v && !/^[\s\[\]()*•#_-]*(redacted|masked|hidden|withheld|n\/a|not supplied|null|undefined|unknown)[\s\[\]()*•#_-]*$/i.test(v) && /[\p{L}\p{N}]/u.test(v) ? v : '';
};
const normalName = (value:string) => usable(value).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function potentialPairs(customers:Customer[]) {
 const records=customers.map(customer=>({customer,identifier:usable(customer.identifier),email:usable(customer.email),names:new Set([customer.name,...customer.aliases].map(normalName).filter(Boolean))}));
 const pairs:{source:string;target:string;evidence:string[]}[]=[];
 records.forEach((a,i)=>records.slice(i+1).forEach(b=>{
  const evidence:string[]=[];
  if(a.identifier && a.identifier===b.identifier)evidence.push('Shared identifier');
  if(a.email && a.email===b.email)evidence.push('Shared email');
  if([...a.names].some(name=>b.names.has(name)))evidence.push('Exact normalized name or alias');
  if(evidence.length)pairs.push({source:a.customer.id,target:b.customer.id,evidence});
 }));
 return pairs;
}
const fmt = (n:number) => n.toLocaleString();
// Fixed canvas: three entity hubs in a triangle, each customer orbiting the entity that owns its record.
const W=900, H=580;
const hubs:Record<string,{x:number;y:number}> = { SPD:{x:215,y:190}, QTS:{x:685,y:190}, QTG:{x:450,y:430}, Unassigned:{x:450,y:270} };
const centre = {x:450,y:270};
const short = (s:string, n=22) => s.length>n ? s.slice(0,n-1)+'…' : s;
type Placed = { c:Customer; x:number; y:number; r:number; units:number; dup:boolean };
const message = (e:unknown) => e instanceof Error ? e.message : 'Unable to load data. Please retry.';

export default function Graph({ initialCustomerId }: { initialCustomerId?:string }) {
 const [data,setData] = useState<Bootstrap>();
 const [loadError,setLoadError] = useState('');
 const [revision,setRevision] = useState(0);
 const [selected,setSelected] = useState('');
 const [query,setQuery] = useState('');
 const [country,setCountry] = useState('');
 const [entity,setEntity] = useState('');
 const [hover,setHover] = useState<Placed>();
 const [product,setProduct] = useState('');
 const [collisionsOnly,setCollisionsOnly] = useState(false);
 const [matches,setMatches] = useState<Match[]>([]);
 const [evidenceLoading,setEvidenceLoading] = useState(false);
 const [evidenceError,setEvidenceError] = useState('');
 const [target,setTarget] = useState('');
 const [simulation,setSimulation] = useState<Simulation>();
 const [simulating,setSimulating] = useState(false);
 const [simulationError,setSimulationError] = useState('');
 const simulationRun = useRef(0);
 useEffect(() => {
  let active=true; setLoadError('');
  api<Bootstrap>('/bootstrap').then(value=>{if(active){setData(value);setSelected(current=>initialCustomerId || current || value.customers[0]?.id || '');}}).catch(e=>{if(active)setLoadError(message(e));});
  return ()=>{active=false;};
 },[revision]);
 useEffect(()=>{if(initialCustomerId){setSelected(initialCustomerId);setQuery('');setProduct('');setCollisionsOnly(false);}},[initialCustomerId]);
 const customer = data?.customers.find(c=>c.id===selected);
 useEffect(()=>{
  let active=true; simulationRun.current++; setSimulating(false);setMatches([]);setTarget('');setSimulation(undefined);setSimulationError('');setEvidenceError('');
  if(!customer){setEvidenceLoading(false);return;}
  setEvidenceLoading(true);
  api<{matches:Match[]}>('/duplicates',{method:'POST',body:JSON.stringify({name:customer.name,identifier:customer.identifier,email:customer.email,type:'Customer'})})
   .then(result=>{if(active){const others=result.matches.filter(m=>m.customer.id!==customer.id);setMatches(others);setTarget(others[0]?.customer.id || '');}})
   .catch(e=>{if(active)setEvidenceError(message(e));}).finally(()=>{if(active)setEvidenceLoading(false);});
  return ()=>{active=false;};
 },[customer,revision]);
 const confirmed = useMemo(()=>data?.orders.filter(o=>o.signal==='confirmed') || [],[data]);
 const pairs = useMemo(()=>potentialPairs(data?.customers || []),[data]);
 const collisionIds = useMemo(()=>new Set(pairs.flatMap(p=>[p.source,p.target])),[pairs]);
 const graph = useMemo(()=>{
  if(!data)return {placed:[] as Placed[],links:[] as {a:Placed;b:Placed;evidence:string[]}[],counts:{} as Record<string,number>};
  const units=new Map<string,number>();
  confirmed.filter(o=>!product||o.productId===product).forEach(o=>units.set(o.customerId,(units.get(o.customerId)??0)+o.quantity));
  const visible=data.customers.filter(c=>(!entity||graphEntity(c)===entity)&&(!country||c.country===country)&&(!query||[c.name,c.identifier,c.email,...c.aliases].join(' ').toLowerCase().includes(query.toLowerCase()))&&(!product||units.has(c.id))&&(!collisionsOnly||collisionIds.has(c.id)));
  const max=Math.max(1,...visible.map(c=>units.get(c.id)??0));
  const placed:Placed[]=[]; const counts:Record<string,number>={};
  for(const e of graphEntities){
   const hub=hubs[e];
   // Duplicates go first so they sit on the side facing the other hubs, where their partner is.
   const group=groupGraphCustomers(visible,e).sort((a,b)=>Number(collisionIds.has(b.id))-Number(collisionIds.has(a.id)));
   counts[e]=group.length;
   const a0=Math.atan2(centre.y-hub.y,centre.x-hub.x), R=group.length<=4?100:132;
   group.forEach((c,i)=>{const a=a0+i*2*Math.PI/group.length, u=units.get(c.id)??0;
    placed.push({c,x:hub.x+R*Math.cos(a),y:hub.y+R*Math.sin(a),r:7+13*Math.sqrt(u/max),units:u,dup:collisionIds.has(c.id)});});
  }
  const at=new Map(placed.map(p=>[p.c.id,p]));
  const links=pairs.filter(p=>at.has(p.source)&&at.has(p.target)).map(p=>({a:at.get(p.source)!,b:at.get(p.target)!,evidence:p.evidence}));
  return {placed,links,counts};
 },[data,confirmed,query,country,product,entity,collisionsOnly,pairs,collisionIds]);
 async function simulate(){
  if(!customer||!target||simulating)return;
  const run=++simulationRun.current;setSimulating(true);setSimulation(undefined);setSimulationError('');
  try {const result=await api<Simulation>('/simulate',{method:'POST',body:JSON.stringify({sourceId:customer.id,targetId:target})});if(run===simulationRun.current)setSimulation(result);}
  catch(e){if(run===simulationRun.current)setSimulationError(message(e));}
  finally{if(run===simulationRun.current)setSimulating(false);}
 }
 const selectedOrders=confirmed.filter(o=>o.customerId===selected);
 const conserved=simulation && simulation.before.sourceQuantity+simulation.before.targetQuantity===simulation.after.targetQuantity;
 return <section className="graph-page" aria-label="Relationship graph">
  <div className="page-head"><div><h1>Graph</h1><p>Each customer record, grouped by the entity that created it. Glowing pairs are the same customer entered twice.</p></div>
   {data&&<span className="pill amber"><AlertTriangle size={13}/>{pairs.length} possible duplicate {pairs.length===1?'pair':'pairs'}</span>}</div>
  {loadError?<div className="card empty" role="alert">{loadError} <button className="btn secondary" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14}/> Retry</button></div>:!data?<div className="loading">Loading graph…</div>:
   <>{data.customers.some(c=>graphEntity(c)==='Unassigned')&&<p className="muted small">Records without a recognised business entity are shown as Unassigned. No ownership or stored data has been changed.</p>}<div className="ig-workspace"><div className="card ig-graph-panel">
    <div className="ig-toolbar"><label className="ig-search"><Search size={16}/><input aria-label="Search customers" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, ID or email"/></label>
     <select aria-label="Country" className="input" value={country} onChange={e=>setCountry(e.target.value)}><option value="">All countries</option>{[...new Set(data.customers.map(c=>c.country))].map(c=><option key={c} value={c}>{countryNames[c]||c}</option>)}</select>
     <select aria-label="Product" className="input" value={product} onChange={e=>setProduct(e.target.value)}><option value="">All products</option>{data.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
     <label className="ig-check"><input type="checkbox" checked={collisionsOnly} onChange={e=>setCollisionsOnly(e.target.checked)}/> Duplicates only</label></div>
       <div className="ig-canvas">{graph.placed.length?<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Customers grouped by the business entity that owns each record">
     <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#ffffff10"/></pattern>
      <radialGradient id="glow"><stop offset="0%" stopColor="#f0b25a" stopOpacity=".55"/><stop offset="100%" stopColor="#f0b25a" stopOpacity="0"/></radialGradient>
     </defs>
     <rect width={W} height={H} fill="url(#dots)"/>
     {graph.placed.map(p=>{const h=hubs[graphEntity(p.c)];const lit=hover?.c.id===p.c.id||selected===p.c.id;return <line key={`l${p.c.id}`} x1={h.x} y1={h.y} x2={p.x} y2={p.y} className={`g-spoke ${lit?'lit':''}`}/>;})}
     {graph.links.map(l=>{const mx=(l.a.x+l.b.x)/2,my=(l.a.y+l.b.y)/2-40;return <g key={`d${l.a.c.id}${l.b.c.id}`} className="g-dup">
      <path d={`M${l.a.x},${l.a.y} Q${mx},${my} ${l.b.x},${l.b.y}`}/>
      <text x={mx} y={my+14} textAnchor="middle">Possible duplicate · {graphEntity(l.a.c)} vs {graphEntity(l.b.c)}</text>
     </g>;})}
     {graphEntities.filter(e=>(!entity||e===entity)&&(e!=='Unassigned'||graph.counts[e]>0)).map(e=>{const h=hubs[e];return <g key={e} className={`g-hub ${entity===e?'on':''}`} role="button" tabIndex={0} aria-label={`Show only ${e}`} onClick={()=>setEntity(entity===e?'':e)} onKeyDown={ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();setEntity(entity===e?'':e);}}}>
      <circle cx={h.x} cy={h.y} r={32}/><text x={h.x} y={h.y+1} className="hub-name" style={e==='Unassigned'?{fontSize:9}:undefined}>{e}</text><text x={h.x} y={h.y+16} className="hub-count">{graph.counts[e]} records</text>
     </g>;})}
     {graph.placed.map(p=><g key={p.c.id} className={`g-node ${p.dup?'dup':''} ${selected===p.c.id?'sel':''}`} role="button" tabIndex={0} aria-label={`${p.c.name}, ${graphEntity(p.c)}, ${fmt(p.units)} units`}
      onClick={()=>setSelected(p.c.id)} onKeyDown={ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();setSelected(p.c.id);}}} onMouseEnter={()=>setHover(p)} onMouseLeave={()=>setHover(undefined)} onFocus={()=>setHover(p)} onBlur={()=>setHover(undefined)}>
      {p.dup&&<circle cx={p.x} cy={p.y} r={p.r+16} fill="url(#glow)" className="pulse"/>}
      {selected===p.c.id&&<circle cx={p.x} cy={p.y} r={p.r+6} className="ring"/>}
      <circle cx={p.x} cy={p.y} r={p.r} className="dot"/>
      <text x={p.x} y={p.y+p.r+14} textAnchor="middle">{short(p.c.name)}</text>
     </g>)}
     {hover&&<g className="g-tip" transform={`translate(${Math.min(hover.x+14,W-196)},${Math.max(hover.y-58,8)})`}><rect width="186" height="50" rx="8"/><text x="10" y="20" className="t1">{short(hover.c.name,26)}</text><text x="10" y="38" className="t2">{graphEntity(hover.c)} · {hover.c.country} · {fmt(hover.units)} units</text></g>}
    </svg>:<div className="empty">No customers match. <button className="btn ghost" onClick={()=>{setQuery('');setCountry('');setProduct('');setEntity('');setCollisionsOnly(false);}}>Reset filters</button></div>}
     <div className="g-chips">{['',...graphEntities.filter(e=>e!=='Unassigned'||data.customers.some(c=>graphEntity(c)==='Unassigned'))].map(e=><button key={e||'all'} className={entity===e?'on':''} onClick={()=>setEntity(e)}>{e||'All'}</button>)}</div>
    </div>
    <div className="ig-legend"><span><i className="ig-dot hub"/>Business entity</span><span><i className="ig-dot customer"/>Customer (size = confirmed units)</span><span><i className="ig-dot dup"/>Possible duplicate</span></div>
   </div>
   <aside className="card ig-sidebar" aria-label="Selected record">
    <select aria-label="Customer" className="input" value={customer?.id||''} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Select a customer</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    {customer?<><div><h2>{customer.name}</h2><span className="muted small">{customer.id} · {countryNames[customer.country]||customer.country}</span></div>
    <dl className="kv"><dt>Entity</dt><dd>{customer.entity||'Unassigned'}</dd><dt>Tax ID</dt><dd>{customer.identifier||'–'}</dd><dt>Email</dt><dd>{customer.email||'–'}</dd><dt>Also known as</dt><dd>{customer.aliases.length?customer.aliases.join(', '):'–'}</dd><dt>Confirmed</dt><dd>{fmt(selectedOrders.reduce((n,o)=>n+o.quantity,0))} units · {selectedOrders.length} orders</dd></dl>
    <h3>Possible duplicates</h3>
    <div aria-live="polite">{evidenceLoading?<p className="muted small">Checking…</p>:evidenceError?<div role="alert" className="alert red">{evidenceError}</div>:matches.length?matches.map(m=><button key={m.customer.id} className={`ig-match ${target===m.customer.id?'on':''}`} onClick={()=>{setTarget(m.customer.id);setSimulation(undefined);simulationRun.current++;setSimulating(false);}}><div><strong>{m.customer.name}</strong><span className={`pill ${m.score>=80?'red':'amber'}`}>{m.score}%</span></div><span className="muted small">{m.customer.entity&&customer.entity&&m.customer.entity!==customer.entity?`${customer.entity} vs ${m.customer.entity} · `:''}{m.evidence.join(' · ')}</span></button>):<p className="muted small">None found.</p>}</div>
    {matches.length>0&&<div className="ig-simulation"><h3>Preview a merge</h3><p className="muted small">Read-only. Nothing is changed.</p>
     <button className="btn" disabled={!target||simulating} onClick={simulate}>{simulating?'Calculating…':`Merge into ${data.customers.find(c=>c.id===target)?.name??'…'}`}<ArrowRight size={14}/></button>
     {simulationError&&<p className="alert red" role="alert">{simulationError}</p>}
     {simulation&&<div className="ig-result" role="status"><table><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody><tr><td>Customer records</td><td>{fmt(simulation.before.customerCount)}</td><td>{fmt(simulation.after.customerCount)}</td></tr><tr><td>Units on kept record</td><td>{fmt(simulation.before.targetQuantity)}</td><td>{fmt(simulation.after.targetQuantity)}</td></tr></tbody></table>
      <p className={`small ${conserved?'up':'down'}`}>{conserved?<ShieldCheck size={13}/>:<AlertTriangle size={13}/>} {conserved?`${fmt(simulation.affectedOrders)} orders move over. No units lost or double-counted.`:'Totals do not match. Review needed.'}</p></div>}
    </div>}</>:<p className="muted small">Select a customer.</p>}
   </aside></div></>}
 </section>;
}
