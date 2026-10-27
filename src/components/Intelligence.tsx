import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MarkerType, type Node, type Edge } from '@xyflow/react';
import { Search, Network, ArrowRight, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import '@xyflow/react/dist/style.css';
import './Intelligence.css';

type Customer = { id:string; name:string; country:string; identifier:string; email:string; aliases:string[] };
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
const message = (e:unknown) => e instanceof Error ? e.message : 'Unable to load data. Please retry.';

export default function Intelligence({ initialCustomerId }: { initialCustomerId?:string }) {
 const [data,setData] = useState<Bootstrap>();
 const [loadError,setLoadError] = useState('');
 const [revision,setRevision] = useState(0);
 const [selected,setSelected] = useState('');
 const [query,setQuery] = useState('');
 const [country,setCountry] = useState('Singapore');
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
  api<Bootstrap>('/bootstrap').then(value=>{if(active){setData(value);setSelected(current=>initialCustomerId || current || value.customers.find(c=>['Singapore','SG'].includes(c.country))?.id || value.customers[0]?.id || '');setCountry(current=>initialCustomerId?value.customers.find(c=>c.id===initialCustomerId)?.country || current:current==='Singapore'&&!value.customers.some(c=>c.country==='Singapore')&&value.customers.some(c=>c.country==='SG')?'SG':current);}}).catch(e=>{if(active)setLoadError(message(e));});
  return ()=>{active=false;};
 },[revision]);
 useEffect(()=>{if(initialCustomerId){setSelected(initialCustomerId);setQuery('');setProduct('');setCollisionsOnly(false);}},[initialCustomerId]);
 useEffect(()=>{if(initialCustomerId&&data){const record=data.customers.find(c=>c.id===initialCustomerId);if(record)setCountry(record.country);}},[initialCustomerId,data]);
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
  if(!data)return {nodes:[] as Node[],edges:[] as Edge[],customers:[] as Customer[]};
  const visible=data.customers.filter(c=>(!country||c.country===country)&&(!query||[c.name,c.identifier,c.email,...c.aliases].join(' ').toLowerCase().includes(query.toLowerCase()))&&(!product||confirmed.some(o=>o.customerId===c.id&&o.productId===product))&&(!collisionsOnly||collisionIds.has(c.id)));
  const ids=new Set(visible.map(c=>c.id));
  const orders=confirmed.filter(o=>ids.has(o.customerId)&&(!product||o.productId===product));
  const products=data.products.filter(p=>(!product||p.id===product)&&orders.some(o=>o.productId===p.id));
  const countries=[...new Set(visible.map(c=>c.country))];
  // The focused country stays in three readable relationship lanes. Regional
  // exploration wraps customers instead of growing one 2,160px column.
  const columns=country?1:Math.min(3,Math.ceil(Math.sqrt(visible.length)) || 1);
  const customerPosition=(i:number)=>({x:250+(i%columns)*250,y:Math.floor(i/columns)*125});
  const productX=250+columns*250+60;
  const nodes:Node[]=[...countries.map((c,i)=>({id:`country:${c}`,position:{x:0,y:countries.length===1?Math.max(0,(Math.ceil(visible.length/columns)-1)*125/2):i*135},data:{label:<><span className="ig-node-type">COUNTRY</span><strong>{countryNames[c]||c}</strong></>},className:'ig-country'})),...visible.map((c,i)=>({id:`customer:${c.id}`,position:customerPosition(i),selected:selected===c.id,data:{label:<><span className="ig-node-type">CUSTOMER {collisionIds.has(c.id)?' · REVIEW':''}</span><strong>{c.name}</strong><span>{c.id} · {countryNames[c.country]||c.country}</span></>},className:`ig-customer ${collisionIds.has(c.id)?'ig-collision':''}`})),...products.map((p,i)=>({id:`product:${p.id}`,position:{x:productX,y:i*165+30},data:{label:<><span className="ig-node-type">PRODUCT</span><strong>{p.name}</strong><span>{p.category}</span></>},className:'ig-product'}))];
  const edges:Edge[]=visible.map(c=>({id:`location:${c.id}`,source:`country:${c.country}`,target:`customer:${c.id}`,style:{stroke:'#c2d3ce'},ariaLabel:`${c.name} located in ${countryNames[c.country]||c.country}`}));
  const totals=new Map<string,{customerId:string;productId:string;quantity:number;count:number}>();
  orders.forEach(o=>{const key=JSON.stringify([o.customerId,o.productId]);const old=totals.get(key);totals.set(key,{customerId:o.customerId,productId:o.productId,quantity:(old?.quantity||0)+o.quantity,count:(old?.count||0)+1});});
  totals.forEach((o,key)=>edges.push({id:`order:${key}`,source:`customer:${o.customerId}`,target:`product:${o.productId}`,label:`${fmt(o.quantity)} units · ${o.count} orders`,style:{stroke:'#288e83',strokeWidth:2},labelStyle:{fill:'#32625a',fontSize:11},labelBgStyle:{fill:'#fff'},markerEnd:{type:MarkerType.ArrowClosed,color:'#288e83'}}));
  pairs.filter(p=>ids.has(p.source)&&ids.has(p.target)).forEach(p=>edges.push({id:`duplicate:${p.source}:${p.target}`,source:`customer:${p.source}`,target:`customer:${p.target}`,label:'Potential duplicate',ariaLabel:`Potential duplicate: ${p.evidence.join('; ')}`,type:'smoothstep',style:{stroke:'#df8b34',strokeWidth:2,strokeDasharray:'6 5'},labelStyle:{fill:'#a35a18',fontSize:11},labelBgStyle:{fill:'#fff7e9'}}));
  return {nodes,edges,customers:visible};
 },[data,confirmed,query,country,product,collisionsOnly,pairs,collisionIds,selected]);
 function activateNode(id:string){
  if(id.startsWith('customer:'))setSelected(id.slice(9));
  else if(id.startsWith('country:'))setCountry(id.slice(8));
  else if(id.startsWith('product:'))setProduct(id.slice(8));
 }
 async function simulate(){
  if(!customer||!target||simulating)return;
  const run=++simulationRun.current;setSimulating(true);setSimulation(undefined);setSimulationError('');
  try {const result=await api<Simulation>('/simulate',{method:'POST',body:JSON.stringify({sourceId:customer.id,targetId:target})});if(run===simulationRun.current)setSimulation(result);}
  catch(e){if(run===simulationRun.current)setSimulationError(message(e));}
  finally{if(run===simulationRun.current)setSimulating(false);}
 }
 const selectedOrders=confirmed.filter(o=>o.customerId===selected);
 const conserved=simulation && simulation.before.sourceQuantity+simulation.before.targetQuantity===simulation.after.targetQuantity;
 return <section className="intelligence" aria-label="Customer intelligence">
  <header className="page-header ig-header"><div><div className="eyebrow">CONNECTED MASTER DATA</div><h1>Intelligence graph</h1><p className="muted">Follow relationships. Surface collisions. Understand the impact.</p></div><span className="ig-live"><span/> Synthetic data explorer</span></header>
  {loadError?<div className="panel ig-state" role="alert">{loadError}<button className="button secondary" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16}/> Retry loading</button></div>:!data?<div className="panel ig-state" role="status">Loading customer relationships…</div>:<>
   <div className="ig-summary"><span><Network size={18}/><strong>{data.customers.length}</strong> customers</span><span><strong>{data.products.length}</strong> products</span><span><strong>{confirmed.length}</strong> confirmed orders</span><span className="ig-review-count"><AlertTriangle size={16}/>{collisionIds.size?`${collisionIds.size} records · ${pairs.length} potential ${pairs.length===1?'pair':'pairs'}`:'No potential collisions detected'}</span></div>
   <div className="ig-workspace"><div className="panel ig-graph-panel">
    <div className="ig-toolbar"><label className="ig-search"><Search size={17}/><span className="ig-sr">Search customers</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, ID or email…"/></label><label><span className="ig-filter-label">Country</span><select value={country} onChange={e=>setCountry(e.target.value)}><option value="">All countries</option>{[...new Set(data.customers.map(c=>c.country))].map(c=><option key={c} value={c}>{countryNames[c]||c}</option>)}</select></label><label><span className="ig-sr">Product</span><select value={product} onChange={e=>setProduct(e.target.value)}><option value="">All products</option>{data.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <div className="ig-graph-meta"><label><input type="checkbox" checked={collisionsOnly} onChange={e=>setCollisionsOnly(e.target.checked)}/> Potential collisions only</label><span><strong className="ig-scope">{countryNames[country]||country||'All countries'}</strong> · {graph.customers.length} customers shown <button className="ig-text-button" onClick={()=>{setQuery('');setCountry('');setProduct('');setCollisionsOnly(false);}}>Reset filters</button></span></div>
    <div className="ig-canvas" aria-label="Relationship graph" onKeyDownCapture={event=>{if(event.key==='Enter'||event.key===' '){const node=(event.target as HTMLElement).closest('.react-flow__node');const id=node?.getAttribute('data-id');if(id){event.preventDefault();event.stopPropagation();activateNode(id);}}}}>{graph.nodes.length?<ReactFlow key={`${query}:${country}:${product}:${collisionsOnly}:${revision}`} nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{padding:0.2}} minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node)=>activateNode(node.id)} onSelectionChange={({nodes})=>{const node=nodes.find(n=>n.id.startsWith('customer:'));if(node)setSelected(node.id.slice(9));}} proOptions={{hideAttribution:false}}><Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd8d3"/><Controls showInteractive={false}/></ReactFlow>:<div className="ig-state">No customers match these filters. Try resetting them.</div>}</div>
    <div className="ig-legend"><span><i className="ig-dot customer"/>Customer</span><span><i className="ig-dot product"/>Product</span><span><i className="ig-dot country"/>Country</span><span><i className="ig-line"/>Confirmed orders</span><span><i className="ig-line collision"/>Potential duplicate</span></div>
    <p className="ig-hint">Select a customer to inspect evidence; select a country or product to filter. Enter / Space activates a focused node. Drag the canvas to pan; use + / − to zoom. Graph nodes support keyboard selection.</p>
   </div>
   <aside className="panel ig-sidebar" aria-label="Selection evidence"><div className="eyebrow">RECORD INSPECTOR</div><label className="ig-record-picker">Customer<select value={customer?.id||''} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Select a customer</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {customer?<><div className="ig-record-heading"><span className="ig-record-icon"><Network size={22}/></span><div><h2>{customer.name}</h2><span className="muted">{customer.id} · {countryNames[customer.country]||customer.country}</span></div></div>
    <dl className="ig-details"><dt>Identifier</dt><dd>{customer.identifier||'Not supplied'}</dd><dt>Email</dt><dd>{customer.email||'Not supplied'}</dd><dt>Aliases</dt><dd>{customer.aliases.length?customer.aliases.join(', '):'None recorded'}</dd><dt>Confirmed demand</dt><dd>{fmt(selectedOrders.reduce((n,o)=>n+o.quantity,0))} units · {selectedOrders.length} orders</dd></dl>
    <div className="ig-section-heading"><h3>Duplicate evidence</h3><span className="badge warning">Heuristic</span></div><p className="ig-note">Scores indicate rule-based similarity from 0–100, not a probability or a confirmed identity. Review the evidence before deciding.</p>
    <div aria-live="polite">{evidenceLoading?<p className="muted">Checking record similarity…</p>:evidenceError?<div role="alert" className="ig-error">{evidenceError}<button className="ig-text-button" onClick={()=>setRevision(n=>n+1)}>Retry evidence</button></div>:matches.length?matches.map(m=><div className="ig-match" key={m.customer.id}><div><strong>{m.customer.name}</strong><span className="ig-score">{m.score}/100</span></div><small>{m.customer.id}</small><ul>{m.evidence.map((e,i)=><li key={i}>{e}</li>)}</ul><button className="ig-text-button" onClick={()=>{setTarget(m.customer.id);setSimulation(undefined);simulationRun.current++;setSimulating(false);}}>Use as simulation target <ArrowRight size={13}/></button></div>):<p className="ig-note">No other duplicate candidates returned for this record.</p>}</div>
    <div className="ig-simulation"><h3>Preview a consolidation</h3><p className="ig-note">Move this customer's orders into a target record in a read-only simulation. No records are changed. Simulation quantities include all order signals; graph edges show confirmed orders only.</p><label className="ig-record-picker">Keep target record<select value={target} onChange={e=>{setTarget(e.target.value);setSimulation(undefined);setSimulationError('');simulationRun.current++;setSimulating(false);}}><option value="">Choose a target…</option>{data.customers.filter(c=>c.id!==customer.id).map(c=><option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}</select></label><button className="button ig-simulate-button" disabled={!target||simulating} onClick={simulate}>{simulating?'Simulating…':'Simulate consolidation'}<ArrowRight size={16}/></button>
    {simulationError&&<p className="ig-error" role="alert">{simulationError}</p>}{simulation&&<div className="ig-result" role="status"><div className="ig-conservation">{conserved?<ShieldCheck size={18}/>:<AlertTriangle size={18}/>} {conserved?'Quantity conserved':'Conservation mismatch — review required'}</div><table><caption>Simulation: before and after · all signals</caption><thead><tr><th scope="col">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody><tr><th scope="row">Customer records</th><td>{fmt(simulation.before.customerCount)}</td><td>{fmt(simulation.after.customerCount)}</td></tr><tr><th scope="row">Target units (all signals)</th><td>{fmt(simulation.before.targetQuantity)}</td><td>{fmt(simulation.after.targetQuantity)}</td></tr><tr><th scope="row">Combined units (all signals)</th><td>{fmt(simulation.before.sourceQuantity+simulation.before.targetQuantity)}</td><td>{fmt(simulation.after.targetQuantity)}</td></tr></tbody></table><p>{fmt(simulation.before.sourceQuantity)} source units (all signals) · {fmt(simulation.affectedOrders)} affected orders</p><p>Total quantity reported (all signals): {fmt(simulation.totalQuantity)} units.</p><p>{simulation.explanation}</p></div>}</div></>:<p className="muted">Select a customer to see evidence and simulate consolidation.</p>}
   </aside></div></>}
 </section>;
}
