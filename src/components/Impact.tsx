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

type Inputs = {requests:number; followups:number; followupMin:number; keyingMin:number; dupRate:number; fixHours:number; hourCost:number; build:number};
const start: Inputs = {requests:60, followups:4, followupMin:10, keyingMin:15, dupRate:5, fixHours:3, hourCost:45, build:45000};
const sliders: {key:keyof Inputs; label:string; min:number; max:number; step:number; unit:string}[] = [
 {key:'requests', label:'Master data requests a month', min:10, max:200, step:5, unit:''},
 {key:'followups', label:'Email follow-ups per request today', min:0, max:10, step:1, unit:''},
 {key:'followupMin', label:'Minutes per follow-up', min:2, max:30, step:1, unit:' min'},
 {key:'keyingMin', label:'Minutes to key a record into SAP', min:5, max:45, step:5, unit:' min'},
 {key:'dupRate', label:'Requests that are duplicates today', min:0, max:20, step:1, unit:'%'},
 {key:'fixHours', label:'Hours to clean up one duplicate later', min:1, max:10, step:1, unit:' h'},
];
const costSliders: typeof sliders = [
 {key:'hourCost', label:'Cost of a staff hour (S$)', min:20, max:120, step:5, unit:''},
 {key:'build', label:'One-off pilot build (S$)', min:10000, max:150000, step:5000, unit:''},
];
const options = [
 {name:'Keep email + Excel template', cost:'None', dup:'No', status:'No', fit:'Today’s 18-day process'},
 {name:'SharePoint list + Power Automate', cost:'Low', dup:'Exact match only', status:'Basic', fit:'Cheap, but no duplicate search or regional view'},
 {name:'MasterGraph on Microsoft 365 + SAP B1', cost:'Low–medium', dup:'Fuzzy, before submit', status:'Live + Teams', fit:'Chosen: fixes intake, approvals and analytics together', chosen:true},
 {name:'Enterprise MDM suite (e.g. SAP MDG)', cost:'High', dup:'Yes', status:'Yes', fit:'Built for SAP S/4HANA scale, overkill for SAP B1'},
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
   <div className="stat"><div className="label">Duplicate customers found</div><div className="value">{dupIds.size}</div><div className="sub">same hospital, under SPD and QTS</div></div>
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

  <div className="card cost">
   <div className="card-head"><h2>Cost and payback</h2><span className="muted small">Estimates, not quotes</span></div>
   <div className="cost-grid">
    <div className="est-inputs">{costSliders.map(s => <label key={s.key} className="slider"><span>{s.label}<strong>{fmt(inputs[s.key])}</strong></span>
     <input type="range" min={s.min} max={s.max} step={s.step} value={inputs[s.key]} onChange={e => setInputs(v => ({...v, [s.key]:Number(e.target.value)}))}/></label>)}
     <ul className="plain small muted">
      <li><strong>MDM team does it themselves:</strong> fields, approval steps, escalation time (Rules screen)</li>
      <li><strong>Lean team, 2 people × 6 weeks:</strong> Microsoft 365 sign-in, Teams cards via Power Automate, SAP B1 Service Layer link</li>
      <li><strong>Outside help:</strong> a few SAP B1 partner days for Service Layer access and testing</li>
      <li><strong>Running cost:</strong> hosting only; Teams, Outlook and SAP B1 are already licensed</li>
     </ul>
    </div>
    <div className="est-out">
     <div><span className="muted small">Saved per year</span><strong>S${fmt((hours + dupHours) * 12 * inputs.hourCost)}</strong><span className="muted small">{fmt((hours + dupHours) * 12)} staff hours × S${inputs.hourCost}</span></div>
     <div><span className="muted small">Payback</span><strong>{(inputs.build / Math.max(1, (hours + dupHours) * inputs.hourCost)).toFixed(0)} months</strong><span className="muted small">before counting faster onboarding and cleaner forecasts</span></div>
    </div>
   </div>
  </div>

  <div className="card">
   <div className="card-head"><h2>Why this over the alternatives</h2></div>
   <div className="table-wrap"><table className="options">
    <thead><tr><th>Option</th><th>Cost</th><th>Stops duplicates</th><th>Live status</th><th>Verdict</th></tr></thead>
    <tbody>{options.map(o => <tr key={o.name} className={o.chosen ? 'chosen' : ''}><td><strong>{o.name}</strong></td><td>{o.cost}</td><td>{o.dup}</td><td>{o.status}</td><td>{o.fit}</td></tr>)}</tbody>
   </table></div>
  </div>

  <div className="card">
   <div className="card-head"><h2>Getting people to use it instead of email</h2></div>
   <div className="adopt">
    {[['Approvers never leave Teams', 'Approve or ask a question from the Teams card. No new app to open.'],
      ['Email still works', 'The MDM mailbox auto-replies with the form link, and pasted emails are sorted and pre-filled.'],
      ['Requesters stop chasing', 'They see who has it and for how long, so “any update?” emails disappear.'],
      ['Start small', '6-week pilot: one country, one entity. Measure cycle time, duplicates caught and % of requests through MasterGraph, then expand.']]
      .map(([t, d], i) => <div key={t}><span className="n">{i + 1}</span><strong>{t}</strong><p className="muted small">{d}</p></div>)}
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
