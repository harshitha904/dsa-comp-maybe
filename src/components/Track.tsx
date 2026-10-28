import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, Download, Lock, MessageSquare, X, Zap } from 'lucide-react';
import { api, dateLabel, defaultConfig, errorText, roleLabel, routeOf, type Audit, type Config, type Request, type RequestType, type Role } from '../api';
import './Track.css';

type Filter = 'mine'|'open'|'done';
const DAY = 86400000;
const verbs: Record<string,string> = {created:'Submitted', approve:'Approved', reject:'Rejected', clarify:'Asked for info', resubmit:'Resubmitted', escalate:'Escalated'};

const canAct = (r: Request, role: Role) => r.status === 'Pending' && (role === 'Admin' || r.stage === role);
const canResubmit = (r: Request, role: Role) => (r.status === 'Clarification' || r.status === 'Rejected') && (role === 'Sales' || role === 'Admin');
const overdue = (r: Request) => r.status !== 'Approved' && r.status !== 'Rejected' && new Date(r.deadline).getTime() < Date.now();
const escalated = (r: Request) => r.status === 'Pending' && r.escalatedStage === r.stage;

const unlocksConfig: Record<RequestType, {role: Role; label: string}[]> = {
 Customer: [
  {role: 'Sales', label: 'Quote'},
  {role: 'Finance', label: 'Sell on credit'},
  {role: 'BU Head', label: 'Strategic account approved'}
 ],
 Item: [
  {role: 'Quality', label: 'Deliver (licensed)'},
  {role: 'Finance', label: 'Sell at list price'},
  {role: 'BU Head', label: 'Range approved'}
 ],
 Vendor: [
  {role: 'Finance', label: 'Pay vendor'},
  {role: 'Quality', label: 'Qualified supplier'},
  {role: 'BU Head', label: 'Raise purchase orders'}
 ],
 'Cost Center': [
  {role: 'Finance', label: 'Post transactions'},
  {role: 'BU Head', label: 'Budget owner confirmed'}
 ]
};

const stageFocus: Record<RequestType, Partial<Record<Role, string>>> = {
 Customer: {
  Sales: 'quotation',
  Finance: 'credit terms',
  'BU Head': 'strategic account approval'
 },
 Item: {
  Quality: 'delivery licensing',
  Finance: 'list pricing',
  'BU Head': 'range approval'
 },
 Vendor: {
  Finance: 'payment terms',
  Quality: 'supplier qualification',
  'BU Head': 'purchase order authorization'
 },
 'Cost Center': {
  Finance: 'transaction posting',
  'BU Head': 'budget owner confirmation'
 }
};

function plainStatusSentence(r: Request): string {
 if (r.status === 'Approved') return 'Approved, ready for MDM final check and SAP posting.';
 if (r.status === 'Rejected') return `Rejected by ${roleLabel[r.stage as Role] ?? r.stage}.`;
 if (r.status === 'Clarification') return `${roleLabel[r.stage as Role] ?? r.stage} asked the requester for more information.`;
 const focus = stageFocus[r.type]?.[r.stage as Role];
 const who = roleLabel[r.stage as Role] ?? r.stage;
 if (focus) return `Waiting on ${who} for ${focus}.`;
 return `Waiting on ${who}.`;
}

function statusPill(r: Request) {
 if (r.status === 'Approved') return <span className="pill green">Approved, ready for MDM final check and SAP posting</span>;
 if (r.status === 'Rejected') return <span className="pill red">Rejected</span>;
 if (r.status === 'Clarification') return <span className="pill amber">Needs info</span>;
 return <span className="pill blue">With {roleLabel[r.stage as Role] ?? r.stage}</span>;
}

export default function Track({role, selectedId, onSelect, toast, onUpdated}: {role:Role; selectedId?:string; onSelect:(id:string)=>void; toast:(m:string)=>void; onUpdated?:()=>void}) {
 const [data, setData] = useState<{requests:Request[]; audit:Audit[]}>();
 const [error, setError] = useState('');
 const [filter, setFilter] = useState<Filter>('open');
 const [reload, setReload] = useState(0);
 const [config, setConfig] = useState<Config>(defaultConfig);
 const [newlyEscalated, setNewlyEscalated] = useState<string[]>([]);
 // The SLA check runs on open here; in production it would run on a schedule.
 useEffect(() => { api<Config>('/config').then(setConfig).catch(() => {}); api<{escalated:string[]}>('/escalations/run', {method:'POST'}).then(r => r.escalated.length && setNewlyEscalated(r.escalated)).catch(() => {}).finally(() => setReload(n => n + 1)); }, []);
 useEffect(() => { if (reload) api('/bootstrap').then(setData).catch(e => setError(errorText(e))); }, [reload]);

 const requests = useMemo(() => (data?.requests ?? []).slice().sort((a, b) => b.priority - a.priority || a.deadline.localeCompare(b.deadline)), [data]);
 const lists: Record<Filter, Request[]> = {
  mine: requests.filter(r => canAct(r, role) || canResubmit(r, role)),
  open: requests.filter(r => r.status !== 'Approved' && r.status !== 'Rejected'),
  done: requests.filter(r => r.status === 'Approved' || r.status === 'Rejected')
 };
 const shown = lists[filter];
 const selected = requests.find(r => r.id === selectedId) ?? shown[0] ?? requests[0];

 if (error) return <div className="card empty">{error}</div>;
 if (!data) return <div className="loading">Loading requests…</div>;
 return <div className="track">
  <div className="page-head"><div><h1>Track requests</h1><p>Where every request is, and who it’s waiting on.</p></div></div>
  <div className="grid g4">
   <div className="stat"><div className="label">Waiting on you</div><div className="value">{lists.mine.length}</div><div className="sub">as {roleLabel[role]}</div></div>
   <div className="stat"><div className="label">Escalated</div><div className={`value ${requests.some(escalated) ? 'amber' : ''}`}>{requests.filter(escalated).length}</div><div className="sub">no reply in {config.slaHours}h</div></div>
   <div className="stat"><div className="label">Overdue</div><div className={`value ${requests.some(overdue) ? 'down' : ''}`}>{requests.filter(overdue).length}</div><div className="sub">past needed-by date</div></div>
   <div className="stat"><div className="label">Ready for SAP B1</div><div className="value">{requests.filter(r => r.status === 'Approved').length}</div><div className="sub">fully approved</div></div>
  </div>
  {newlyEscalated.length > 0 && <div className="alert amber"><Zap size={15}/>{newlyEscalated.length} request{newlyEscalated.length === 1 ? '' : 's'} passed the {config.slaHours}h limit. Teams reminders sent and escalated.</div>}
  <div className="track-grid">
   <div className="card list">
    <div className="chips">{([['mine', 'Waiting on me'], ['open', 'Open'], ['done', 'Closed']] as const).map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} {lists[k].length}</button>)}</div>
    {shown.length ? shown.map(r => <button key={r.id} className={`req ${selected?.id === r.id ? 'sel' : ''}`} onClick={() => onSelect(r.id)}>
     <div className="req-top"><strong>{r.name}</strong>{escalated(r) ? <span className="pill amber"><Zap size={11}/>Escalated</span> : r.priority === 3 && <span className="pill red">Urgent</span>}</div>
     <span className="muted small">{r.type} · {r.country}{r.entity ? ` · ${r.entity}` : ''}</span>
     <div className="req-top">{statusPill(r)}<span className={`small ${overdue(r) ? 'down' : 'muted'}`}>{overdue(r) ? 'Overdue' : `Due ${dateLabel(r.deadline)}`}</span></div>
    </button>) : <p className="empty small">Nothing here.</p>}
   </div>
   {selected ? <Detail key={selected.id + reload} config={config} r={selected} audit={data.audit.filter(a => a.requestId === selected.id)} role={role} toast={toast} onChanged={() => { setReload(n => n + 1); onUpdated?.(); }}/> : <div className="card empty">No requests yet.</div>}
  </div>
 </div>;
}

function Detail({r, config, audit, role, toast, onChanged}: {r:Request; config:Config; audit:Audit[]; role:Role; toast:(m:string)=>void; onChanged:()=>void}) {
 const [action, setAction] = useState<'reject'|'clarify'|'resubmit'|null>(null);
 const [note, setNote] = useState('');
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [sap, setSap] = useState<any>();
 const [teams, setTeams] = useState(false);
 const history = audit.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
 // Time at the current stage: escalation notices don't reset the clock.
 const stageEvents = history.filter(a => a.action !== 'escalate');
 const since = stageEvents.length ? new Date(stageEvents[stageEvents.length - 1].timestamp).getTime() : new Date(r.createdAt).getTime();
 const days = Math.max(0, Math.floor((Date.now() - since) / DAY));
 const route = routeOf(r, config);
 const steps = ['Submitted', ...route.map(x => roleLabel[x]), 'SAP B1'];
 const stepState = (i: number) => {
  if (i === 0) return 'done';
  if (i === steps.length - 1) return r.status === 'Approved' ? 'current' : 'todo';
  const roleAt = route[i - 1];
  if (r.approvals.includes(roleAt) || r.status === 'Approved') return 'done';
  if (roleAt === r.stage) return r.status === 'Pending' ? 'current' : 'blocked';
  return 'todo';
 };
 const waiting = r.status === 'Approved' ? 'Approved, ready for MDM final check and SAP posting.'
  : r.status === 'Rejected' ? `Rejected by ${roleLabel[r.stage as Role] ?? r.stage}.`
  : r.status === 'Clarification' ? `${roleLabel[r.stage as Role] ?? r.stage} asked the requester for more info.`
  : escalated(r) ? `No reply from ${roleLabel[r.stage as Role]} in ${config.slaHours}h. Escalated to ${roleLabel[r.escalatedTo as Role] ?? r.escalatedTo}.`
  : `Waiting on ${roleLabel[r.stage as Role]} ${days === 0 ? 'since today' : `for ${days} day${days === 1 ? '' : 's'}`}.`;

 const ticketId = 'T-' + (r.id.startsWith('REQ-') ? r.id.slice(4, 8) : r.id.slice(0, 4));
 const plainStatus = plainStatusSentence(r);
 const unlocks = unlocksConfig[r.type] || [];
 const isSapUnlocked = r.status === 'Approved';

 async function act(kind: 'approve'|'reject'|'clarify'|'resubmit', as?: Role, text = note) {
  setBusy(true); setError('');
  try { await api(`/requests/${r.id}/action`, {method:'POST', body:JSON.stringify({action:kind, note:text}), ...(as ? {headers:{'X-Role':as}} : {})}); toast(`${verbs[kind]}${as ? ` in Teams by ${roleLabel[as]}` : ''}: ${r.name}`); onChanged(); }
  catch (e) { setError(errorText(e)); setBusy(false); }
 }
 async function loadSap() {
  try { setSap(await api(`/requests/${r.id}/sap`)); } catch (e) { setError(errorText(e)); }
 }
 function download() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(sap, null, 2)], {type:'application/json'}));
  Object.assign(document.createElement('a'), {href:url, download:`${r.id}-sap-b1.json`}).click(); URL.revokeObjectURL(url);
 }

 return <div className="detail-pane">
  <div className="card ticket-card">
   <div className="ticket-top">
    <div className="ticket-meta">
     <span className="ticket-id">{ticketId}</span>
     <span className="ticket-type-country">{r.type} · {r.country}</span>
    </div>
    {statusPill(r)}
   </div>
   <div className="ticket-headline">
    <h2 className="ticket-name">{r.name}</h2>
    <p className="ticket-status">{plainStatus}</p>
   </div>
   <div className="ticket-unlocks">
    <div className="unlocks-head">
     <span className="unlocks-title">Policy unlocks</span>
    </div>
    <div className="chips unlock-chips">
     {unlocks.map(u => {
      const unlocked = r.approvals.includes(u.role) || r.status === 'Approved';
      return <span key={u.label} className={`chip unlock-chip ${unlocked ? 'unlocked' : 'locked'}`} title={`${u.label} (${roleLabel[u.role] ?? u.role}): ${unlocked ? 'Unlocked' : 'Locked'}`}>
       {unlocked ? <Check size={12} className="unlock-icon up"/> : <Lock size={12} className="unlock-icon muted"/>}
       <span className="unlock-name">{u.label}</span>
       <span className="unlock-role muted">({roleLabel[u.role] ?? u.role})</span>
      </span>;
     })}
     <span className={`chip unlock-chip ${isSapUnlocked ? 'unlocked' : 'locked'}`} title={`Official SAP B1 record: ${isSapUnlocked ? 'Unlocked' : 'Locked'}`}>
      {isSapUnlocked ? <Check size={12} className="unlock-icon up"/> : <Lock size={12} className="unlock-icon muted"/>}
      <span className="unlock-name">Official SAP B1 record</span>
     </span>
    </div>
   </div>
   <p className="ticket-note muted small">Illustrative: unlocks are a proposed policy, not enforced by this prototype.</p>
  </div>

  <div className="card detail">
   <div className="detail-head">
    <div><h2>Workflow &amp; actions</h2><span className="muted small">Requested by {r.requester} on {dateLabel(r.createdAt)}</span></div>
   </div>

   <ol className="stepper">{steps.map((s, i) => { const st = stepState(i); return <li key={s} className={st}>
    <span className="dot">{st === 'done' ? <Check size={13}/> : st === 'blocked' ? '!' : i + 1}</span><span className="name">{s}</span>
   </li>; })}</ol>

   <div className="status-row">
    <div className={`alert ${r.status === 'Approved' ? 'green' : r.status === 'Pending' && !escalated(r) && days < 3 ? 'green' : 'amber'}`}>{waiting} Needed by {dateLabel(r.deadline)}{new Date(r.deadline).getTime() < Date.now() && r.status !== 'Approved' ? ' (overdue)' : ''}.</div>
    {r.status === 'Pending' && <button className="btn secondary" onClick={() => setTeams(true)}><MessageSquare size={14}/>Teams card</button>}
   </div>

   {(canAct(r, role) || canResubmit(r, role) || r.status === 'Approved') && <div className="actions">
    {canAct(r, role) && <>
     <button className="btn" disabled={busy} onClick={() => act('approve')}><Check size={15}/>Approve as {roleLabel[role]}</button>
     <button className="btn secondary" disabled={busy} onClick={() => setAction('clarify')}>Ask for info</button>
     <button className="btn danger" disabled={busy} onClick={() => setAction('reject')}>Reject</button>
    </>}
    {canResubmit(r, role) && <button className="btn" onClick={() => setAction('resubmit')}>Answer and resubmit</button>}
    {r.status === 'Approved' && (role === 'Finance' || role === 'Admin'
     ? <button className="btn" onClick={loadSap}>Send to SAP B1</button>
     : <span className="muted small"><Lock size={12}/> Switch to Finance or MDM team to send to SAP B1.</span>)}
   </div>}
   {action && <div className="note-box">
    <textarea className="input" rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder={action === 'resubmit' ? 'What changed?' : 'Reason (shared with the requester)'}/>
    <div className="row-end gap"><button className="btn secondary" onClick={() => { setAction(null); setNote(''); }}>Cancel</button><button className={`btn ${action === 'reject' ? 'danger' : ''}`} disabled={!note.trim() || busy} onClick={() => act(action)}>{action === 'reject' ? 'Reject' : action === 'clarify' ? 'Send question' : 'Resubmit'}</button></div>
   </div>}
   {error && <div className="alert red">{error}</div>}

   <div className="detail-cols">
    <div>
     <h3>Details</h3>
     <dl className="kv">
      <dt>{r.type === 'Customer' || r.type === 'Vendor' ? 'Tax ID' : 'Code'}</dt><dd>{r.identifier || '–'}</dd>
      {r.email && <><dt>Email</dt><dd>{r.email}</dd></>}
      {Object.entries(r.details).map(([k, v]) => <FragmentKV key={k} label={config.fields[r.type].find(f => f.key === k)?.label ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} value={v}/>)}
      {r.duplicateOverride && <><dt>Duplicate note</dt><dd>{r.duplicateOverride}</dd></>}
     </dl>
    </div>
    <div>
     <h3>History</h3>
     <ul className="history">{history.map(a => <li key={a.id}><span className="h-dot"/><div><strong>{verbs[a.action] ?? a.action}</strong> <span className="muted">by {roleLabel[a.actor as Role] ?? a.actor} · {new Date(a.timestamp).toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})}</span>{a.details && !/^(Synthetic|Request created)/.test(a.details) && <p className="small muted">“{a.details}”</p>}</div></li>)}</ul>
    </div>
   </div>

   {teams && <TeamsCard r={r} days={days} sla={config.slaHours} onClose={() => setTeams(false)} onRemind={() => { setTeams(false); toast(`Reminder sent to ${roleLabel[r.stage as Role]} in Teams (simulated)`); }} onAct={(kind, text) => { setTeams(false); act(kind, r.stage as Role, text); }}/>}
   {sap && <div className="modal-backdrop" onClick={() => setSap(undefined)}><div className="modal wide" onClick={e => e.stopPropagation()}>
    <div className="modal-head"><h2>SAP B1 payload</h2><button className="icon-btn" aria-label="Close" onClick={() => setSap(undefined)}><X size={18}/></button></div>
    <p className="muted small">POST {sap.serviceLayerPath} · simulated, nothing is sent.</p>
    <pre className="code">{JSON.stringify(sap.data, null, 2)}</pre>
    <div className="row-end"><button className="btn" onClick={download}><Download size={14}/>Download JSON</button></div>
   </div></div>}
  </div>
 </div>;
}

function FragmentKV({label, value}: {label:string; value:string|number|boolean}) {
 const hidden = value === '[redacted]';
 return <><dt>{label}</dt><dd className={hidden ? 'locked' : ''}>{hidden ? <><Lock size={12}/>Finance only</> : String(value)}</dd></>;
}

// Mock of the Adaptive Card an approver receives in Microsoft Teams. Buttons act as that approver.
function TeamsCard({r, days, sla, onClose, onRemind, onAct}: {r:Request; days:number; sla:number; onClose:()=>void; onRemind:()=>void; onAct:(kind:'approve'|'clarify', note:string)=>void}) {
 const [asking, setAsking] = useState(false);
 const [note, setNote] = useState('');
 const who = roleLabel[r.stage as Role] ?? r.stage;
 const facts = [['Type', r.type], ['Country', r.country], ['Requested by', r.requester], ['Needed by', dateLabel(r.deadline)], ['Waiting', days === 0 ? 'Since today' : `${days} day${days === 1 ? '' : 's'}`]];
 return <div className="modal-backdrop" onClick={onClose}><div className="teams" onClick={e => e.stopPropagation()}>
  <div className="teams-bar"><span className="teams-logo">T</span>Microsoft Teams · Chat with MasterGraph<button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16}/></button></div>
  <div className="teams-body">
   <div className="teams-msg"><span className="bot">MG</span><div><strong>MasterGraph</strong> <span className="muted small">to {who}</span>
    <div className="adaptive">
     <div className="ac-head"><Bell size={14}/>Approval needed{r.escalatedStage === r.stage && <span className="pill amber">Reminder · {sla}h passed</span>}</div>
     <div className="ac-title">{r.type}: {r.name}</div>
     <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
     {asking ? <><textarea className="input" rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="Your question for the requester"/>
      <div className="ac-actions"><button className="ac-btn primary" disabled={!note.trim()} onClick={() => onAct('clarify', note)}>Send</button><button className="ac-btn" onClick={() => setAsking(false)}>Cancel</button></div></>
     : <div className="ac-actions"><button className="ac-btn primary" onClick={() => onAct('approve', '')}>Approve</button><button className="ac-btn" onClick={() => setAsking(true)}>Ask for info</button><button className="ac-btn" onClick={onClose}>Open in MasterGraph</button></div>}
    </div></div></div>
  </div>
  <div className="teams-foot"><span className="muted small">Simulated. Buttons act as {who}.</span><button className="btn ghost" onClick={onRemind}>Send reminder</button></div>
 </div></div>;
}
