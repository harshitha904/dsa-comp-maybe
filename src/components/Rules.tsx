import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, Sparkles, X } from 'lucide-react';
import { api, errorText, roleLabel, type Config, type Field, type RequestType, type Role } from '../api';
import './Rules.css';

const types: RequestType[] = ['Customer', 'Vendor', 'Item', 'Cost Center'];
const approvers: Role[] = ['Sales', 'Finance', 'Quality', 'BU Head'];

export default function Rules({role, toast}: {role:Role; toast:(m:string)=>void}) {
 const [saved, setSaved] = useState<Config>();
 const [draft, setDraft] = useState<Config>();
 const [type, setType] = useState<RequestType>('Item');
 const [label, setLabel] = useState('');
 const [sensitive, setSensitive] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => { api<Config>('/config').then(c => { setSaved(c); setDraft(structuredClone(c)); }).catch(e => setError(errorText(e))); }, []);
 if (!draft || !saved) return error ? <div className="card empty">{error}</div> : <div className="loading">Loading rules…</div>;

 const canEdit = role === 'Admin';
 const route = draft.routes[type], fields = draft.fields[type];
 const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
 const update = (fn: (c: Config) => void) => setDraft(d => { const c = structuredClone(d!); fn(c); return c; });
 const move = (i: number, by: number) => update(c => { const r = c.routes[type]; [r[i], r[i + by]] = [r[i + by], r[i]]; });
 function addField() {
  if (!label.trim()) return;
  update(c => { c.fields[type].push({key:'', label:label.trim(), ...(sensitive ? {sensitive:true} : {})} as Field); });
  setLabel(''); setSensitive(false);
 }
 // Marcus's new business unit sells to licensed labs: customers need a licence number and a Quality check.
 function example() {
  setType('Customer');
  update(c => {
   if (!c.fields.Customer.some(f => f.label === 'Lab licence no.')) c.fields.Customer.push({key:'', label:'Lab licence no.'} as Field);
   if (!c.routes.Customer.includes('Quality')) c.routes.Customer.splice(1, 0, 'Quality');
  });
 }
 async function save() {
  setError('');
  try { const c = await api<Config>('/config', {method:'PUT', body:JSON.stringify(draft)}); setSaved(c); setDraft(structuredClone(c)); toast('Rules saved. New requests use them now.'); }
  catch (e) { setError(errorText(e)); }
 }

 return <div className="rules">
  <div className="page-head">
   <div><h1>Rules</h1><p>Change fields and approval steps without IT. Applies to new requests only.</p></div>
   {canEdit && <button className="btn secondary" onClick={example}><Sparkles size={14}/>Example: add a new business unit</button>}
  </div>
  {!canEdit && <div className="alert amber"><Lock size={15}/>View only. Switch “Acting as” to MDM team to edit.</div>}

  <div className="chips">{types.map(t => <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t}</button>)}</div>

  <div className="grid g2">
   <div className="card">
    <div className="card-head"><h2>Approval steps</h2><span className="muted small">in order</span></div>
    <ol className="steps">{route.map((r, i) => <li key={r}>
     <span className="n">{i + 1}</span><span className="grow">{roleLabel[r]}</span>
     {canEdit && <>
      <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15}/></button>
      <button className="icon-btn" aria-label="Move down" disabled={i === route.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15}/></button>
      <button className="icon-btn" aria-label="Remove" disabled={route.length === 1} onClick={() => update(c => { c.routes[type].splice(i, 1); })}><X size={15}/></button>
     </>}
    </li>)}
     <li className="fixed"><span className="n">✓</span><span className="grow">Approved, ready for MDM final check and SAP posting</span></li>
    </ol>
    {canEdit && approvers.some(a => !route.includes(a)) && <div className="add-row">
     <select className="input" value="" onChange={e => update(c => { c.routes[type].push(e.target.value as Role); })}>
      <option value="">+ Add approval step…</option>{approvers.filter(a => !route.includes(a)).map(a => <option key={a} value={a}>{roleLabel[a]}</option>)}
     </select>
    </div>}
   </div>

   <div className="card">
    <div className="card-head"><h2>Required fields</h2><span className="muted small">plus name, country, requester</span></div>
    <ul className="field-list">{fields.map((f, i) => <li key={i}>
     <span className="grow">{f.label}{!f.key && <span className="pill blue">new</span>}</span>
     <label className={`toggle ${f.sensitive ? 'on' : ''}`}><input type="checkbox" disabled={!canEdit} checked={!!f.sensitive} onChange={e => update(c => { c.fields[type][i].sensitive = e.target.checked || undefined; })}/><Lock size={12}/>Finance only</label>
     {canEdit && <button className="icon-btn" aria-label="Remove field" onClick={() => update(c => { c.fields[type].splice(i, 1); })}><X size={15}/></button>}
    </li>)}</ul>
    {canEdit && <div className="add-row">
     <input className="input" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addField()} placeholder="New field, e.g. Lab licence no."/>
     <label className="toggle"><input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)}/><Lock size={12}/>Finance only</label>
     <button className="btn secondary" disabled={!label.trim()} onClick={addField}><Plus size={14}/>Add</button>
    </div>}
   </div>
  </div>

  <div className="card sla">
   <div><h2>Escalation</h2><p className="muted small">If an approver doesn’t respond, they get a Teams reminder and the request escalates to the next approver.</p></div>
   <label className="sla-input">Escalate after<input className="input" type="number" min={4} max={336} disabled={!canEdit} value={draft.slaHours} onChange={e => update(c => { c.slaHours = Number(e.target.value); })}/>hours</label>
  </div>

  {error && <div className="alert red">{error}</div>}
  {canEdit && <div className="save-bar">
   <span className="muted small">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
   <button className="btn secondary" disabled={!dirty} onClick={() => setDraft(structuredClone(saved))}>Discard</button>
   <button className="btn" disabled={!dirty} onClick={save}>Save rules</button>
  </div>}
 </div>;
}
