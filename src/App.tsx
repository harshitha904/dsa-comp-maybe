import { lazy, Suspense, useEffect, useState } from 'react';
import { CircleHelp, Network, X } from 'lucide-react';
import { api, errorText, roleLabel, roles, setApiRole, type Role } from './api';
const RequestPage = lazy(() => import('./components/RequestPage'));
const Track = lazy(() => import('./components/Track'));
const Regional = lazy(() => import('./components/Regional'));
const Graph = lazy(() => import('./components/Graph'));

type Page = 'request'|'track'|'regional'|'graph';
const pages: {id:Page;name:string}[] = [{id:'request',name:'Request'},{id:'track',name:'Track'},{id:'regional',name:'Regional view'},{id:'graph',name:'Graph'}];
const isPage = (p: string): p is Page => pages.some(x => x.id === p);

export default function App() {
 const fromHash = () => { const [p, id] = location.hash.slice(1).split('/'); return {page: isPage(p) ? p : 'request' as Page, id}; };
 const [page, setPage] = useState<Page>(() => fromHash().page);
 const [trackId, setTrackId] = useState<string|undefined>(() => fromHash().id);
 const [customerId, setCustomerId] = useState<string>();
 const [role, setRoleState] = useState<Role>('Sales');
 const [version, setVersion] = useState(0);
 const [about, setAbout] = useState(false);
 const [toast, setToast] = useState('');
 useEffect(() => { const fn = () => { const h = fromHash(); setPage(h.page); if (h.id) setTrackId(h.id); }; addEventListener('hashchange', fn); return () => removeEventListener('hashchange', fn); }, []);
 useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);
 const go = (p: Page, id?: string) => { location.hash = id ? `${p}/${id}` : p; setPage(p); if (p === 'track') setTrackId(id); scrollTo(0, 0); };
 const setRole = (r: Role) => { setApiRole(r); setRoleState(r); setVersion(v => v + 1); };
 const openCustomer = (id: string) => { setCustomerId(id); go('graph'); };
 async function reset() {
  try { await api('/reset', {method:'POST'}); setVersion(v => v + 1); setAbout(false); setToast('Demo data reset'); }
  catch (e) { setToast(errorText(e)); }
 }
 return <div className="app">
  <header className="nav">
   <a className="brand" href="#request" onClick={() => go('request')}><span className="brand-mark"><Network size={16}/></span>MasterGraph</a>
   <nav aria-label="Main">{pages.map(p => <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => go(p.id)}>{p.name}</button>)}</nav>
   <div className="nav-right">
    <label className="role-select" title="Demo only: switch who you are acting as">
     <span>Acting as</span>
     <select value={role} onChange={e => setRole(e.target.value as Role)}>{roles.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
    </label>
    <button className="icon-btn" aria-label="How it works" onClick={() => setAbout(true)}><CircleHelp size={18}/></button>
   </div>
  </header>
  <main className="page">
   <Suspense fallback={<div className="loading">Loading…</div>}>
    {page === 'request' && <RequestPage key={version} role={role} onCreated={id => { setToast('Request submitted'); go('track', id); }} onOpenCustomer={openCustomer}/>}
    {page === 'track' && <Track key={version} role={role} selectedId={trackId} onSelect={id => go('track', id)} toast={setToast}/>}
    {page === 'regional' && <Regional key={version} onOpenCustomer={openCustomer} onOpenRequest={id => go('track', id)}/>}
    {page === 'graph' && <Graph key={version} initialCustomerId={customerId}/>}
   </Suspense>
  </main>
  {about && <div className="modal-backdrop" onClick={() => setAbout(false)}>
   <div className="modal" role="dialog" aria-label="How it works" onClick={e => e.stopPropagation()}>
    <div className="modal-head"><h2>How it works</h2><button className="icon-btn" aria-label="Close" onClick={() => setAbout(false)}><X size={18}/></button></div>
    <ol className="flow">
     {['Requestor searches, then submits one form','Duplicate check runs before an approver sees it','Approvers act in order; everyone sees the stage','MDM team does the final check','Record is pushed to SAP B1 (Service Layer)'].map((s, i) => <li key={i}><span>{i + 1}</span>{s}</li>)}
    </ol>
    <h3>Not in version 1</h3>
    <ul className="plain">
     <li>Live SAP B1 connection (payload is simulated)</li>
     <li>Real sign-in (role switcher is for the demo)</li>
     <li>Seasonal forecasting (needs more than 12 months of data)</li>
     <li>Automatic merging of duplicates (preview only)</li>
    </ul>
    <p className="muted small">All data is synthetic.</p>
    <button className="btn secondary" onClick={reset}>Reset demo data</button>
   </div>
  </div>}
  {toast && <div className="toast" role="status">{toast}</div>}
 </div>;
}
