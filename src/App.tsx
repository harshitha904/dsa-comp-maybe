import { lazy, Suspense, useEffect, useState } from 'react';
import { CircleHelp, Moon, Network, Sun, X } from 'lucide-react';
import { api, errorText, roleLabel, roles, setApiRole, type Role } from './api';
const RequestPage = lazy(() => import('./components/RequestPage'));
const Track = lazy(() => import('./components/Track'));
const Regional = lazy(() => import('./components/Regional'));
const Graph = lazy(() => import('./components/Graph'));
const Rules = lazy(() => import('./components/Rules'));
const Impact = lazy(() => import('./components/Impact'));

type Page = 'request'|'track'|'regional'|'graph'|'rules'|'impact';
const pages: {id:Page;name:string}[] = [{id:'request',name:'Request'},{id:'track',name:'Track'},{id:'regional',name:'Regional view'},{id:'graph',name:'Graph'},{id:'rules',name:'Rules'},{id:'impact',name:'Impact'}];
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
 const [theme, setTheme] = useState<'light'|'dark'>(() => {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') {
   return 'dark';
  }
  return 'light';
 });
 useEffect(() => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (e: MediaQueryListEvent) => {
   try {
    if (!localStorage.getItem('mg-theme')) {
     const next = e.matches ? 'dark' : 'light';
     setTheme(next);
     document.documentElement.dataset.theme = next;
     const meta = document.querySelector('meta[name="theme-color"]');
     if (meta) meta.setAttribute('content', next === 'dark' ? '#0E0F10' : '#f7f7f4');
    }
   } catch {}
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
 }, []);
 const toggleTheme = () => {
  const next = theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  document.documentElement.dataset.theme = next;
  try {
   localStorage.setItem('mg-theme', next);
   const meta = document.querySelector('meta[name="theme-color"]');
   if (meta) meta.setAttribute('content', next === 'dark' ? '#0E0F10' : '#f7f7f4');
  } catch {}
 };
 useEffect(() => { const fn = () => { const h = fromHash(); setPage(h.page); if (h.id) setTrackId(h.id); }; addEventListener('hashchange', fn); return () => removeEventListener('hashchange', fn); }, []);
 useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);
 const go = (p: Page, id?: string) => { location.hash = id ? `${p}/${id}` : p; setPage(p); if (p === 'track') setTrackId(id); scrollTo(0, 0); };
 const setRole = (r: Role) => { setApiRole(r); setRoleState(r); setVersion(v => v + 1); };
 const openCustomer = (id: string) => { setCustomerId(id); go('graph'); };
 async function reset() {
  try { await api('/reset', {method:'POST', headers:{'X-Role':'Admin'}}); setVersion(v => v + 1); setAbout(false); setToast('Demo data reset'); }
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
    <button className="icon-btn theme-toggle" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
    <button className="icon-btn" aria-label="How it works" onClick={() => setAbout(true)}><CircleHelp size={18}/></button>
   </div>
  </header>
  <main className="page">
   <Suspense fallback={<div className="loading">Loading…</div>}>
    {page === 'request' && <RequestPage key={version} role={role} onCreated={id => { setToast('Request submitted'); go('track', id); }} onOpenCustomer={openCustomer} toast={setToast}/>}
    {page === 'track' && <Track key={version} role={role} selectedId={trackId} onSelect={id => go('track', id)} toast={setToast}/>}
    {page === 'regional' && <Regional key={version} onOpenCustomer={openCustomer} onOpenRequest={id => go('track', id)}/>}
    {page === 'graph' && <Graph key={version} initialCustomerId={customerId}/>}
    {page === 'rules' && <Rules key={version} role={role} toast={setToast}/>}
    {page === 'impact' && <Impact key={version}/>}
   </Suspense>
  </main>
  {about && <div className="modal-backdrop" onClick={() => setAbout(false)}>
   <div className="modal wide" role="dialog" aria-label="How it works" onClick={e => e.stopPropagation()}>
    <div className="modal-head"><h2>How it works</h2><button className="icon-btn" aria-label="Close" onClick={() => setAbout(false)}><X size={18}/></button></div>
    <a href="/process-flow.svg" target="_blank" rel="noreferrer" title="Open full size"><img className="flow-img" src="/process-flow.svg" alt="Process flow: request by email or form, sorted, duplicate-checked, one complete form, approvals in Teams with escalation, approved (ready for MDM final check and SAP posting), created in SAP B1 via the Service Layer, and clean records feeding the regional view."/></a>
    <h3>Not in version 1</h3>
    <ul className="plain">
     <li>Live SAP B1 connection (payload is simulated)</li>
     <li>Real sign-in (role switcher is for the demo)</li>
     <li>Seasonal forecasting (needs more than 12 months of data)</li>
     <li>Automatic merging of duplicates (preview only)</li>
    </ul>
    <h3>Data &amp; assumptions</h3>
    <ul className="plain small">
     <li><strong>All data is synthetic.</strong> No dataset was provided, so the app generates one: 18 customer records across 3 entities (SPD, QTS, QTG), 3 products, 5 countries, 415 orders, Oct 2025 – Sep 2026.</li>
     <li><strong>Planted on purpose</strong> to reflect the brief: National University Hospital exists under SPD and again as NUH Singapore under QTS; Johor Distribution stops ordering after June; Vietnam grows each month; Siam Hospital Group dominates Thailand; some customers buy only Product A.</li>
     <li><strong>Demand</strong> = confirmed purchase orders, in units. Enquiries and MDM setup requests are tracked but excluded.</li>
     <li><strong>Growth</strong> = confirmed units in the last 3 months vs the 3 months before.</li>
     <li><strong>Forecast</strong>: the 6–12 month average, a linear trend and Holt’s smoothing are each tested on the last 6 months, per country. A newer method is used only if it beats the average.</li>
     <li><strong>Early warning</strong>: customers still ordering whose last 3 months are 15%+ below the 3 before.</li>
     <li><strong>Email sorting</strong>: rule-based, and shows the phrases it used (PO number, quantity, quote request, setup fields).</li>
     <li><strong>Costs</strong>: staff hour and build cost on the Impact page are assumptions to replace with Lives Group’s figures.</li>
     <li><strong>Impact</strong>: 18 days is from the brief. MasterGraph timing assumes each approver acts within a day; savings use the slider assumptions on the Impact page.</li>
    </ul>
    <button className="btn secondary" onClick={reset}>Reset demo data</button>
   </div>
  </div>}
  {toast && <div className="toast" role="status">{toast}</div>}
 </div>;
}
