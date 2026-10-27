import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Inbox, Lock, Mail, Search } from 'lucide-react';
import { api, countries, defaultConfig, entities, detailFields, errorText, roleLabel, type Config, type Match, type RequestType, type Role } from '../api';
import './RequestPage.css';

const types: RequestType[] = ['Customer', 'Vendor', 'Item', 'Cost Center'];
const idLabel: Record<RequestType, string> = {Customer:'Tax / registration ID', Vendor:'Tax / registration ID', Item:'Item code', 'Cost Center':'Cost center code'};
const sample = `From: Linh Nguyen <linh.nguyen@lives.example>
Subject: New customer account - urgent

Hi MDM team,

Please set up a new customer account for SPD.
Name: Saigon Heart Clinic
Country: Vietnam
Tax ID: VN-0312-8841
Email: purchasing@saigonheart.example
Customer segment: Private hospital
Payment terms: Net 30
Credit limit: 20000

Thanks,
Linh Nguyen`;
const samples: {label:string; text:string}[] = [
 {label:'Setup', text:sample},
 {label:'Order', text:`From: Aisha Lim <aisha.lim@penangmedical.example>
Subject: PO 4500-1182 - Product A

Hi team,

Please supply 40 boxes of Product A to Penang Medical Centre.
Delivery by 15 Nov.

Regards,
Aisha Lim`},
 {label:'Enquiry', text:`From: Minh Tran <minh.tran@hanoihealth.example>
Subject: Product C

Hello,

We are interested in Product C for our Hanoi labs. Could you share a quotation and the current lead time?

Thanks,
Minh Tran`},
];
type Triage = {label:'order'|'enquiry'|'setup'|'unclear'; confidence:number; reasons:string[]};
const triageText: Record<Triage['label'], {title:string; pill:string; note:string}> = {
 setup:{title:'New record setup', pill:'green', note:'Goes to the MDM form below.'},
 order:{title:'Purchase order', pill:'blue', note:'Not a master-data request. It goes to the sales order desk and counts as confirmed demand.'},
 enquiry:{title:'General enquiry', pill:'amber', note:'Logged as pipeline. Kept out of demand and forecasts until it becomes an order.'},
 unclear:{title:'Not sure', pill:'grey', note:'No clear signals. Choose what it is.'},
};

type Values = Record<string, string>;
const blank = (type: RequestType, name = ''): Values => ({type, name, entity:'', country:'', identifier:'', email:'', requester:'', deadline:'', priority:'2'});

// Rule-based extraction from labelled lines; the requester still reviews every field.
function parseEmail(text: string, allFields: Config['fields'] = detailFields): Values {
 const out: Values = {};
 const label = new Map<string, string>();
 for (const line of text.split('\n')) { const m = /^\s*([A-Za-z][A-Za-z ()/.-]{0,30}?)\s*:\s*(.+?)\s*$/.exec(line); if (m && !label.has(m[1].toLowerCase())) label.set(m[1].toLowerCase(), m[2]); }
 const pick = (...keys: string[]) => keys.map(k => label.get(k)).find(Boolean) ?? '';
 const subject = pick('subject');
 const type = [['Cost Center', /cost[\s-]?cent/i], ['Vendor', /vendor|supplier/i], ['Item', /\bitem\b|material|sku/i], ['Customer', /customer|account|hospital|clinic/i]].find(([, re]) => (re as RegExp).test(subject + '\n' + text))?.[0];
 if (type) out.type = type as string;
 out.name = pick('name', 'customer name', 'vendor name', 'item name', 'company');
 out.identifier = pick('tax id', 'registration id', 'identifier', 'item code', 'code', 'uen');
 out.email = pick('email', 'e-mail') || (/[\w.+-]+@[\w-]+\.[\w.]+/.exec(text.split('\n').filter(l => !/^from:/i.test(l)).join('\n'))?.[0] ?? '');
 out.country = countries.find(c => c.toLowerCase() === pick('country').toLowerCase()) ?? countries.find(c => text.includes(c)) ?? '';
 out.requester = pick('from').replace(/<.*>/, '').trim();
 out.entity = entities.find(x => new RegExp(`\\b${x}\\b`).test(pick('entity', 'business entity') || text)) ?? '';
 if (/urgent|asap/i.test(subject + text)) out.priority = '3';
 for (const fields of Object.values(allFields)) for (const f of fields) { const plain = f.label.toLowerCase().replace(/ \(usd\)/, ''); const v = pick(f.label.toLowerCase(), plain, plain.replace(/^requested /, ''), f.key.toLowerCase()); if (v && !out[f.key]) out[f.key] = v.replace(/[$,]/g, f.number ? '' : '$&'); }
 return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

export default function RequestPage({role, onCreated, onOpenCustomer, toast}: {role:Role; onCreated:(id:string)=>void; onOpenCustomer:(id:string)=>void; toast:(m:string)=>void}) {
 const [type, setType] = useState<RequestType>('Customer');
 const [query, setQuery] = useState('');
 const [matches, setMatches] = useState<Match[]>([]);
 const [checking, setChecking] = useState(false);
 const [step, setStep] = useState<'search'|'form'>('search');
 const [mode, setMode] = useState<'form'|'email'>('form');
 const [email, setEmail] = useState('');
 const [sorted, setSorted] = useState<Triage>();
 const [values, setValues] = useState<Values>(blank('Customer'));
 const [override, setOverride] = useState('');
 const [blocked, setBlocked] = useState<Match[]>([]);
 const [error, setError] = useState('');
 const [saving, setSaving] = useState(false);
 const [config, setConfig] = useState<Config>(defaultConfig);
 useEffect(() => { api<Config>('/config').then(setConfig).catch(() => {}); }, []);

 useEffect(() => {
  if (query.trim().length < 3) { setMatches([]); return; }
  let live = true; setChecking(true);
  const t = setTimeout(() => api<{matches:Match[]}>('/duplicates', {method:'POST', body:JSON.stringify({type, name:query})})
   .then(r => live && setMatches(r.matches)).catch(() => live && setMatches([])).finally(() => live && setChecking(false)), 250);
  return () => { live = false; clearTimeout(t); };
 }, [query, type]);

 const t = (values.type || type) as RequestType;
 const fields = config.fields[t];
 const required = ['name', 'entity', 'country', 'requester', ...(t === 'Customer' || t === 'Vendor' ? ['identifier', 'email'] : []), ...fields.map(f => f.key)];
 const missing = required.filter(k => !String(values[k] ?? '').trim());
 const set = (k: string, v: string) => setValues(s => ({...s, [k]: v}));
 const route = useMemo(() => config.routes[t], [config, t]);

 function startForm(prefill: Values = {}) {
  setValues({...blank(type, query), ...prefill}); setStep('form'); setBlocked([]); setOverride(''); setError('');
 }
 function fromEmail() {
  const parsed = parseEmail(email, config.fields);
  if (parsed.type) setType(parsed.type as RequestType);
  setQuery(parsed.name ?? ''); setValues({...blank((parsed.type as RequestType) ?? type), ...parsed}); setMode('form'); setStep('form'); setBlocked([]); setError('');
 }
 async function submit() {
  setSaving(true); setError('');
  const details = Object.fromEntries(fields.map(f => [f.key, f.number ? Number(values[f.key]) : values[f.key]]));
  const body = {type:t, name:values.name, entity:values.entity, country:values.country, identifier:values.identifier, email:values.email, requester:values.requester, priority:Number(values.priority), details, ...(values.deadline ? {deadline:values.deadline} : {}), ...(override ? {duplicateOverride:override} : {})};
  try { const created = await api<{id:string}>('/requests', {method:'POST', body:JSON.stringify(body)}); onCreated(created.id); }
  catch (e: any) { if (e.status === 409 && e.matches) setBlocked(e.matches); else setError(errorText(e)); }
  finally { setSaving(false); }
 }

 const strong = matches.filter(m => m.score >= 80);
 return <div className="request-page">
  <section className="ask">
   <h1>What do you need set up?</h1>
   <div className="chips center">{types.map(x => <button key={x} className={`chip ${type === x ? 'on' : ''}`} onClick={() => { setType(x); setValues(v => ({...v, type:x})); }}>{x}</button>)}</div>
   <label className="search-box"><Search size={18}/><input autoFocus value={query} onChange={e => { setQuery(e.target.value); setStep('search'); }} placeholder={`Search ${type.toLowerCase()} name before creating it…`}/>{checking && <span className="muted small">Checking…</span>}</label>
   <button className="link-btn" onClick={() => setMode(m => m === 'email' ? 'form' : 'email')}><Mail size={14}/>{mode === 'email' ? 'Hide email paste' : 'Or paste a request email'}</button>
  </section>

  {mode === 'email' && <section className="card narrow">
   <div className="card-head"><h2>Paste the email</h2><div className="chips">{samples.map(x => <button key={x.label} className="chip" onClick={() => { setEmail(x.text); setSorted(undefined); }}>Sample: {x.label}</button>)}</div></div>
   <textarea className="input" rows={9} value={email} onChange={e => { setEmail(e.target.value); setSorted(undefined); }} placeholder="Paste the email text here"/>
   {!sorted ? <div className="row-end"><button className="btn" disabled={!email.trim()} onClick={() => api<Triage>('/triage', {method:'POST', body:JSON.stringify({text:email})}).then(setSorted).catch(e => toast(errorText(e)))}><Inbox size={15}/>Read email</button></div>
   : <div className="triage">
    <div className="triage-head"><span className={`pill ${triageText[sorted.label].pill}`}>{triageText[sorted.label].title}</span>{sorted.reasons.length > 0 && <span className="muted small">because: {sorted.reasons.join(', ')}</span>}</div>
    <p className="small">{triageText[sorted.label].note}</p>
    <div className="row-end gap">
     {sorted.label === 'setup' && <button className="btn" onClick={fromEmail}>Fill the form <ArrowRight size={15}/></button>}
     {sorted.label === 'order' && <><button className="btn ghost" onClick={fromEmail}>It’s a setup request</button><button className="btn" onClick={() => { toast('Sent to the sales order desk (simulated)'); setEmail(''); setSorted(undefined); }}>Send to order desk</button></>}
     {sorted.label === 'enquiry' && <><button className="btn ghost" onClick={fromEmail}>It’s a setup request</button><button className="btn" onClick={() => { toast('Logged as an enquiry (simulated)'); setEmail(''); setSorted(undefined); }}>Log enquiry</button></>}
     {sorted.label === 'unclear' && <><button className="btn secondary" onClick={() => { toast('Logged as an enquiry (simulated)'); setSorted(undefined); setEmail(''); }}>Enquiry</button><button className="btn" onClick={fromEmail}>Setup request</button></>}
    </div>
   </div>}
  </section>}

  {step === 'search' && query.trim().length >= 3 && !checking && <section className="narrow results">
   {matches.length ? <>
    <div className={`alert ${strong.length ? 'red' : 'amber'}`}><AlertTriangle size={16}/>{strong.length ? 'This looks like it already exists.' : 'Similar records found. Check before creating.'}</div>
    {matches.slice(0, 3).map(m => <div key={m.customer.id} className="card match">
     <div><div className="match-name"><strong>{m.customer.name}</strong><span className={`pill ${m.score >= 80 ? 'red' : 'amber'}`}>{m.score}% match</span></div>
      <span className="muted small">{m.customer.id} · {m.customer.entity ? `${m.customer.entity} · ` : ''}{m.customer.country}{m.customer.identifier ? ` · ${m.customer.identifier}` : ''} · {m.evidence.join(', ')}</span></div>
     {!m.customer.id.startsWith('REQ') && <button className="btn" onClick={() => onOpenCustomer(m.customer.id)}>Use this record</button>}
    </div>)}
    <button className="btn secondary" onClick={() => startForm()}>It’s a different {type.toLowerCase()} – continue</button>
   </> : <div className="card match"><div><strong>No existing record found</strong><div className="muted small">Safe to create “{query}”.</div></div><button className="btn" onClick={() => startForm()}>Create request <ArrowRight size={15}/></button></div>}
  </section>}

  {step === 'form' && <section className="form-grid">
   <div className="card">
    <div className="card-head"><h2>New {t.toLowerCase()} request</h2>{missing.length ? <span className="pill amber">{missing.length} to fill</span> : <span className="pill green"><Check size={12}/>Complete</span>}</div>
    <div className="fields">
     <Field label="Name" k="name" values={values} set={set} missing={missing}/>
     <label className="field">Business entity<select value={values.entity} onChange={e => set('entity', e.target.value)} className={missing.includes('entity') ? 'need' : ''}><option value="">Select…</option>{entities.map(x => <option key={x}>{x}</option>)}</select></label>
     <label className="field">Country<select value={values.country} onChange={e => set('country', e.target.value)} className={missing.includes('country') ? 'need' : ''}><option value="">Select…</option>{countries.map(c => <option key={c}>{c}</option>)}</select></label>
     <Field label={idLabel[t]} k="identifier" values={values} set={set} missing={missing}/>
     <Field label="Contact email" k="email" values={values} set={set} missing={missing} type="email"/>
     {fields.map(f => <Field key={f.key} label={f.label} k={f.key} values={values} set={set} missing={missing} type={f.number ? 'number' : 'text'} sensitive={f.sensitive}/>)}
     <Field label="Requested by" k="requester" values={values} set={set} missing={missing}/>
     <label className="field">Needed by<input type="date" value={values.deadline} onChange={e => set('deadline', e.target.value)}/></label>
     <label className="field">Priority<select value={values.priority} onChange={e => set('priority', e.target.value)}><option value="1">Low</option><option value="2">Normal</option><option value="3">Urgent</option></select></label>
    </div>
    {blocked.length > 0 && <div className="override">
     <div className="alert red"><AlertTriangle size={16}/><div>Possible duplicate of <strong>{blocked.map(m => `${m.customer.name} (${m.score}%)`).join(', ')}</strong>. Explain why this is a new record to continue.</div></div>
     <textarea className="input" rows={2} value={override} onChange={e => setOverride(e.target.value)} placeholder="e.g. Separate legal entity with its own tax ID"/>
    </div>}
    {error && <div className="alert red"><AlertTriangle size={16}/>{error}</div>}
    <div className="row-end"><button className="btn" disabled={missing.length > 0 || saving || (blocked.length > 0 && override.trim().length < 10)} onClick={submit}>{saving ? 'Submitting…' : 'Submit request'}</button></div>
   </div>
   <aside className="card side">
    <h3>Approval route</h3>
    <ol className="route">{[...route.map(r => roleLabel[r]), 'MDM final check', 'Created in SAP B1'].map((r, i) => <li key={r}><span>{i + 1}</span>{r}</li>)}</ol>
    <p className="muted small">Each approver gets a Teams card when it’s their turn. No reply in {config.slaHours}h escalates it.</p>
    {fields.some(f => f.sensitive) && <p className="muted small lock-note"><Lock size={12}/>Locked fields are visible to Finance and the MDM team only.{role !== 'Finance' && role !== 'Admin' ? ' You can enter them but not view them later.' : ''}</p>}
   </aside>
  </section>}
 </div>;
}

function Field({label, k, values, set, missing, type = 'text', sensitive}: {label:string; k:string; values:Values; set:(k:string, v:string)=>void; missing:string[]; type?:string; sensitive?:boolean}) {
 return <label className="field"><span>{label}{sensitive && <span className="lock"> <Lock size={11}/>Finance only</span>}</span>
  <input type={type} value={values[k] ?? ''} onChange={e => set(k, e.target.value)} className={missing.includes(k) ? 'need' : ''}/></label>;
}
