import { useEffect, useState } from 'react';
import { api, defaultConfig, fmt, type Audit, type Config, type Customer, type Request } from '../api';
import './Impact.css';

type Segment = {from:number; to:number; label:string; tone:'wait'|'work'|'bad'};
// Amy's item request from the brief's "day in the life" (18 days end to end).
const today: Segment[] = [
 {from:0, to:2, label:'Email sits in shared inbox', tone:'wait'},
 {from:2, to:7, label:'Missing regulatory field, back to Amy', tone:'bad'},
 {from:7, to:10, label:'Quality / Regulatory', tone:'wait'},
 {from:10, to:13, label:'BU Head', tone:'wait'},
 {from:13, to:16, label:'Business Support', tone:'wait'},
 {from:16, to:18, label:'Keyed into SAP by hand', tone:'work'},
];
const DAYS = 18;

type Inputs = {requests:number; followups:number; followupMin:number; keyingMin:number; dupRate:number; fixHours:number};
const start: Inputs = {requests:60, followups:4, followupMin:10, keyingMin:15, dupRate:5, fixHours:3};
const sliders: {key:keyof Inputs; label:string; min:number; max:number; step:number; unit:string}[] = [
 {key:'requests', label:'Master data requests a month', min:10, max:200, step:5, unit:''},
 {key:'followups', label:'Email follow-ups per request today', min:0, max:10, step:1, unit:''},
 {key:'followupMin', label:'Minutes per follow-up', min:2, max:30, step:1, unit:' min'},
 {key:'keyingMin', label:'Minutes to key a record into SAP', min:5, max:45, step:5, unit:' min'},
 {key:'dupRate', label:'Requests that are duplicates today', min:0, max:20, step:1, unit:'%'},
 {key:'fixHours', label:'Hours to clean up one duplicate later', min:1, max:10, step:1, unit:' h'},
];

export default function Impact() {
 const [config, setConfig] = useState<Config>(defaultConfig);
 const [data, setData] = useState<{customers:Customer[]; orders:{customerId:string;quantity:number;signal:string}[]; requests:Request[]; audit:Audit[]}>();
 const [inputs, setInputs] = useState<Inputs>(start);
 useEffect(() => { api<Config>('/config').then(setConfig).catch(() => {}); api('/bootstrap').then(setData).catch(() => {}); }, []);

 // MasterGraph path for the same Item request: one complete form, one approver a day via Teams, then SAP.
 const route = config.routes.Item;
 const next: Segment[] = [...route.map((r, i) => ({from:i, to:i + 1, label:r === 'Quality' ? 'Quality / Reg' : r, tone:'wait' as const})), {from:route.length, to:route.length + 0.5, label:'MDM check + SAP', tone:'work'}];
 const typical = route.length + 0.5;
 const worst = route.length * config.slaHours / 24 + 0.5;

 const hours = inputs.requests * (inputs.followups * inputs.followupMin + inputs.keyingMin) / 60;
 const dupsPerYear = inputs.requests * 12 * inputs.dupRate / 100;
 const dupHours = dupsPerYear * inputs.fixHours / 12;

 const dupIds = new Set<string>(), seen = new Map<string, string>();
 data?.customers.forEach(c => [c.identifier, c.email].filter(Boolean).forEach(k => { const o = seen.get(k); if (o && o !== c.id) { dupIds.add(o); dupIds.add(c.id); } else seen.set(k, c.id); }));
 const splitUnits = data?.orders.filter(o => o.signal === 'confirmed' && dupIds.has(o.customerId)).reduce((n, o) => n + o.quantity, 0) ?? 0;
 const keptOut = data?.orders.filter(o => o.signal !== 'confirmed').length ?? 0;
 const escalations = data?.audit.filter(a => a.action === 'escalate').length ?? 0;

 return <div className="impact">
  <div className="page-head"><div><h1>Impact</h1><p>Amy’s item request from the brief, before and after.</p></div></div>

  <div className="card">
   <div className="headline">
    <div><span className="muted small">Today, by email</span><strong className="down">{DAYS} days</strong></div>
    <span className="arrow">→</span>
    <div><span className="muted small">With MasterGraph</span><strong className="up">~{typical} days</strong><span className="muted small">at most {worst.toFixed(1)} with {config.slaHours}h escalation</span></div>
   </div>
   <Lane title="Today" segments={today}/>
   <Lane title="MasterGraph" segments={next} caption={`${route.map(r => r === 'Quality' ? 'Quality' : r).join(' → ')} → SAP B1, via Teams`}/>
   <div className="axis">{Array.from({length:DAYS / 3 + 1}, (_, i) => <span key={i} style={{left:`${i * 3 / DAYS * 100}%`}}>Day {i * 3}</span>)}</div>
   <p className="muted small foot">MasterGraph timing assumes each approver acts within a day of the Teams card. The form blocks the missing regulatory field, so there is no back-and-forth.</p>
  </div>

  <div className="grid g4">
   <div className="stat"><div className="label">Duplicate customers found</div><div className="value">{dupIds.size}</div><div className="sub">records for the same hospital</div></div>
   <div className="stat"><div className="label">Units split across them</div><div className="value">{fmt(splitUnits)}</div><div className="sub">now counted as one customer</div></div>
   <div className="stat"><div className="label">Kept out of the forecast</div><div className="value">{keptOut}</div><div className="sub">enquiries and setup requests</div></div>
   <div className="stat"><div className="label">Auto-escalations sent</div><div className="value">{escalations}</div><div className="sub">instead of manual chasing</div></div>
  </div>
  <p className="muted small live-note">These four come from the demo data in this prototype.</p>

  <div className="card estimator">
   <div className="est-inputs">
    <h2>Estimate the savings</h2>
    <p className="muted small">Our assumptions. Drag to try Lives Group’s real numbers.</p>
    {sliders.map(s => <label key={s.key} className="slider"><span>{s.label}<strong>{inputs[s.key]}{s.unit}</strong></span>
     <input type="range" min={s.min} max={s.max} step={s.step} value={inputs[s.key]} onChange={e => setInputs(v => ({...v, [s.key]:Number(e.target.value)}))}/></label>)}
    <button className="btn ghost" onClick={() => setInputs(start)}>Reset assumptions</button>
   </div>
   <div className="est-out">
    <div><span className="muted small">Staff time saved</span><strong>{fmt(hours + dupHours)} h / month</strong><span className="muted small">{fmt(hours)} h of chasing and keying, {fmt(dupHours)} h of duplicate clean-up</span></div>
    <div><span className="muted small">Duplicate records avoided</span><strong>{fmt(dupsPerYear)} / year</strong><span className="muted small">caught at the search box, before an approver sees them</span></div>
    <div><span className="muted small">Faster per request</span><strong>{(DAYS - typical).toFixed(1)} days</strong><span className="muted small">{DAYS} → ~{typical} days for a 3-step request</span></div>
   </div>
  </div>
 </div>;
}

function Lane({title, segments, caption}: {title:string; segments:Segment[]; caption?:string}) {
 const end = Math.max(...segments.map(s => s.to));
 return <div className="lane"><span className="lane-title">{title}</span><div className="track-bar">
  {segments.map((s, i) => <div key={i} className={`seg ${s.tone}`} style={{left:`${s.from / DAYS * 100}%`, width:`${(s.to - s.from) / DAYS * 100}%`}} title={s.label}>{!caption && <span>{s.label}</span>}</div>)}
  {caption && <span className="lane-caption" style={{left:`calc(${end / DAYS * 100}% + 10px)`}}>{caption}</span>}
 </div></div>;
}
