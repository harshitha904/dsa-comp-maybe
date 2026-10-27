import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  AlertTriangle, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Download,
  Eye, FileJson, FilePlus2, History, Hourglass, Inbox, Info, Landmark, ListChecks, Loader2, Mail,
  MessageSquareWarning, Network, Package, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Truck, UserRound,
  Wand2, X, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../api';
import './Requests.css';

/* ------------------------------------------------------------------ types */

type RequestType = 'Customer' | 'Vendor' | 'Item' | 'Cost Center';
type Status = 'Pending' | 'Clarification' | 'Rejected' | 'Approved';
type Action = 'approve' | 'reject' | 'clarify' | 'resubmit';
type Values = Record<string, string>;

type DetailMap = Record<string, string | number | boolean>;
interface Customer { id: string; name: string; country: string; identifier: string; email: string; aliases: string[] }
interface Req {
  id: string; type: RequestType; name: string; country: string; identifier: string; email: string; details: Record<string, string | number | boolean>;
  requester: string; status: Status; stage: string; approvals: string[]; createdAt: string; deadline: string;
  priority: number; duplicateOverride?: string;
}
interface AuditEntry { id: string; requestId: string; action: string; actor: string; timestamp: string; details: string }
interface Match { customer: Customer; score: number; evidence: string[] }
interface DupInput { name: string; identifier: string; email: string; type: string }
interface DupState { status: 'idle' | 'loading' | 'error' | 'done'; matches: Match[]; error: string }

/* -------------------------------------------------------------- constants */

// Demo roles only. The selected role is sent as the X-Role header; nothing is authenticated.
const ROLES = ['Sales', 'Finance', 'Quality', 'BU Head', 'Admin'] as const;
type Role = typeof ROLES[number];
const ROLE_KEY = 'mastergraph.role';

const COUNTRIES = ['Singapore', 'Malaysia', 'Thailand', 'Indonesia', 'Vietnam'];
const TYPES: RequestType[] = ['Customer', 'Vendor', 'Item', 'Cost Center'];
const STATUSES: Status[] = ['Pending', 'Clarification', 'Rejected', 'Approved'];
const STATUS_ORDER: Record<Status, number> = { Pending: 0, Clarification: 1, Rejected: 2, Approved: 3 };

// Backend accepts integer priority 1-3 (default 2); a HIGHER number is MORE urgent.
const PRIORITY_LABELS: Record<number, string> = { 1: 'Low', 2: 'Normal', 3: 'Urgent' };
const PRIORITY_VALUES = [1, 2, 3];
const HIGH_PRIORITY = 3;

// Approval routing, mirroring server/domain.js `routes`. The server is the authority.
const ROUTES: Record<RequestType, string[]> = {
  Customer: ['Sales', 'Finance', 'BU Head'], Vendor: ['Finance', 'Quality', 'BU Head'],
  Item: ['Quality', 'Finance', 'BU Head'], 'Cost Center': ['Finance', 'BU Head'],
};
const REDACTED = '[redacted]';
const SEES_SENSITIVE: Role[] = ['Finance', 'Admin'];

// Duplicate score bands. Scores are a heuristic 0-100, not a probability. The server only returns
// matches scoring 60+, and requires a written override (10+ chars) when any match scores 80+.
const HIGH_MATCH = 80;
const MEDIUM_MATCH = 60;
const MIN_NOTE = 3;
const MIN_OVERRIDE = 10;

const ACTIONS: Record<Action, { label: string; past: string; icon: LucideIcon; tone: 'ok' | 'warn' | 'danger' | 'neutral'; noteRequired: boolean; blurb: string }> = {
  approve: { label: 'Approve', past: 'approved', icon: CheckCircle2, tone: 'ok', noteRequired: false, blurb: 'Moves the request to the next stage. After the final approval, a simulated SAP payload becomes available to Finance and Admin.' },
  reject: { label: 'Reject', past: 'rejected', icon: XCircle, tone: 'danger', noteRequired: true, blurb: 'Stops the request. The requester sees your note and can resubmit.' },
  clarify: { label: 'Request clarification', past: 'sent back for clarification', icon: MessageSquareWarning, tone: 'warn', noteRequired: true, blurb: 'Sends the request back to the requester with your question.' },
  resubmit: { label: 'Resubmit', past: 'resubmitted', icon: RotateCcw, tone: 'neutral', noteRequired: true, blurb: 'Restarts routing from the first approval stage and clears earlier approvals.' },
};

interface FieldDef { key: string; label: string; kind: 'text' | 'select' | 'number'; options?: string[]; required?: boolean; placeholder?: string; hint?: string; min?: number }
interface Schema { icon: LucideIcon; blurb: string; identifierLabel: string; identifierHint: string; identifierRequired: boolean; emailRequired: boolean; fields: FieldDef[] }

const SCHEMAS: Record<RequestType, Schema> = {
  Customer: {
    icon: Building2, blurb: 'A sold-to account that can place orders.',
    identifierLabel: 'Business registration no.', identifierHint: 'Company registration or tax number, e.g. SG-NUH-001', identifierRequired: true, emailRequired: true,
    fields: [
      { key: 'segment', label: 'Customer segment', kind: 'select', options: ['Distributor', 'Retailer', 'OEM', 'Direct account'], required: true },
      { key: 'terms', label: 'Payment terms', kind: 'select', options: ['Net 30', 'Net 45', 'Net 60', 'Prepaid'], required: true },
      { key: 'credit', label: 'Requested credit limit (USD)', kind: 'number', min: 0, required: true, placeholder: '50000' },
      { key: 'interest', label: 'Product of interest', kind: 'select', options: ['Product A', 'Product B', 'Product C', 'Multiple'] },
    ],
  },
  Vendor: {
    icon: Truck, blurb: 'A supplier or service provider we pay.',
    identifierLabel: 'Vendor registration no.', identifierHint: 'Registration or tax number of the supplying entity', identifierRequired: true, emailRequired: true,
    fields: [
      { key: 'category', label: 'Vendor category', kind: 'select', options: ['Raw materials', 'Packaging', 'Logistics', 'Professional services'], required: true },
      { key: 'terms', label: 'Payment terms', kind: 'select', options: ['Net 30', 'Net 45', 'Net 60'], required: true },
      { key: 'bankCountry', label: 'Bank country', kind: 'select', options: COUNTRIES, required: true },
      { key: 'contact', label: 'Vendor contact person', kind: 'text', required: true, placeholder: 'Full name' },
    ],
  },
  Item: {
    icon: Package, blurb: 'A material or finished good in the product master.',
    identifierLabel: 'Item / material code', identifierHint: 'Proposed SKU or material number, e.g. PA-1042', identifierRequired: false, emailRequired: false,
    fields: [
      { key: 'line', label: 'Product line', kind: 'select', options: ['Product A', 'Product B', 'Product C'], required: true },
      { key: 'uom', label: 'Unit of measure', kind: 'select', options: ['Each', 'Kilogram', 'Litre', 'Box'], required: true },
      { key: 'cost', label: 'Standard cost (USD)', kind: 'number', min: 0.01, required: true, placeholder: '12.50' },
      { key: 'shelf', label: 'Shelf life (months)', kind: 'number', min: 0, placeholder: '24' },
    ],
  },
  'Cost Center': {
    icon: Landmark, blurb: 'A cost collector for budgeting and reporting.',
    identifierLabel: 'Cost center code', identifierHint: 'Proposed code, e.g. CC-SG-2041', identifierRequired: false, emailRequired: false,
    fields: [
      { key: 'owner', label: 'Cost center owner', kind: 'text', required: true, placeholder: 'Full name' },
      { key: 'unit', label: 'Business unit', kind: 'select', options: ['Sales', 'Operations', 'Finance', 'Quality'], required: true },
      { key: 'budget', label: 'Annual budget (USD)', kind: 'number', min: 0, required: true, placeholder: '250000' },
      { key: 'parent', label: 'Parent cost center', kind: 'text', placeholder: 'Optional, e.g. CC-SG-2000' },
    ],
  },
};

const TYPE_ICON: Record<RequestType, LucideIcon> = { Customer: Building2, Vendor: Truck, Item: Package, 'Cost Center': Landmark };

const SAMPLE_EMAIL = `From: Mei Lin Tan <meilin.tan@example.com>
To: master-data@example.com
Subject: New customer account request - urgent

Hi team,

Please set up a new customer account.

Company name: Straits Coastal Trading Pte Ltd
Registration no: SG-STC-2041
Country: Singapore
Email: accounts@straitscoastal.example
Needed by: 2026-11-20

They are a new distributor for Product A and have asked for Net 45 terms.

Regards,
Mei Lin Tan`;

/* ---------------------------------------------------------------- helpers */

const shortId = (id: string) => (id.length > 12 ? id.slice(0, 8) : id);
const isHidden = (v: unknown) => v === REDACTED;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/. ]{3,}$/;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };

function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(s: string) {
  const d = parseDay(s);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : s || '—';
}
function fmtStamp(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const isFinal = (r: Req) => r.status === 'Approved' || r.status === 'Rejected';

function dueInfo(r: Req): { text: string; tone: 'warn' | 'ok' | 'muted' } | null {
  if (isFinal(r)) return null;
  const d = parseDay(r.deadline);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `Overdue by ${-days}d`, tone: 'warn' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  if (days <= 2) return { text: `Due in ${days}d`, tone: 'warn' };
  return { text: `Due in ${days}d`, tone: 'muted' };
}

// Mirrors server `act`: only the stage role (or Admin) may decide a Pending request,
// and only Sales or Admin may resubmit a Clarification/Rejected one.
const canDecide = (r: Req, role: Role) => r.status === 'Pending' && (role === 'Admin' || role === r.stage);
const canResubmitAs = (r: Req, role: Role) => (r.status === 'Clarification' || r.status === 'Rejected') && (role === 'Sales' || role === 'Admin');
const needsRole = (r: Req, role: Role) => canDecide(r, role) || (r.status === 'Clarification' && canResubmitAs(r, role));

function compareReq(role: Role) {
  return (a: Req, b: Req) => {
    const na = needsRole(a, role) ? 0 : 1, nb = needsRole(b, role) ? 0 : 1;
    if (na !== nb) return na - nb;
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (parseDay(a.deadline)?.getTime() ?? 0) - (parseDay(b.deadline)?.getTime() ?? 0);
  };
}

const statusIcon = (s: Status) => (s === 'Approved' ? CheckCircle2 : s === 'Rejected' ? XCircle : s === 'Clarification' ? MessageSquareWarning : Hourglass);
const statusClass = (s: Status) => (s === 'Approved' ? 'badge success' : s === 'Pending' ? 'badge' : s === 'Rejected' ? 'badge rq-danger' : 'badge warning');

function matchBand(score: number) {
  return score >= HIGH_MATCH ? { key: 'high', label: 'High match' } : score >= MEDIUM_MATCH ? { key: 'medium', label: 'Possible match' } : { key: 'low', label: 'Weak match' };
}

const AUDIT_LABEL: Record<string, string> = { created: 'Request created', approve: 'Approved', reject: 'Rejected', clarify: 'Clarification requested', resubmit: 'Resubmitted' };

function auditIcon(action: string): LucideIcon {
  const a = action.toLowerCase();
  if (a.includes('approv')) return CheckCircle2;
  if (a.includes('reject')) return XCircle;
  if (a.includes('clarif')) return MessageSquareWarning;
  if (a.includes('resubmit')) return RotateCcw;
  if (a.includes('creat') || a.includes('submit')) return FilePlus2;
  return History;
}

// The API takes `details` as an object of nonempty scalar values.
function composeDetails(type: RequestType, v: Values): DetailMap {
  const out: DetailMap = {};
  for (const f of SCHEMAS[type].fields) {
    const val = (v[f.key] ?? '').trim();
    if (val) out[f.label] = f.kind === 'number' ? Number(val) : val;
  }
  out['Business justification'] = v.justification.trim();
  return out;
}

function validate(v: Values, highMatch: boolean): Values {
  const e: Values = {};
  const s = SCHEMAS[v.type as RequestType];
  if (v.name.trim().length < 2) e.name = 'Enter the legal or master-data name (at least 2 characters).';
  if (!v.country) e.country = 'Select a country.';
  const idv = v.identifier.trim();
  if (!idv && s.identifierRequired) e.identifier = `${s.identifierLabel} is required for ${v.type} requests.`;
  else if (idv && !ID_RE.test(idv)) e.identifier = 'Use 4+ characters: letters, digits, - _ / .';
  const em = v.email.trim();
  if (!em && s.emailRequired) e.email = 'A contact email is required for this request type.';
  else if (em && !EMAIL_RE.test(em)) e.email = 'Enter a valid email address.';
  if (v.requester.trim().length < 2) e.requester = 'Enter the requester’s name.';
  if (!v.deadline) e.deadline = 'Pick a deadline.';
  else if (v.deadline < isoDate(new Date())) e.deadline = 'The deadline cannot be in the past.';
  if (v.justification.trim().length < 10) e.justification = 'Explain the business need (at least 10 characters).';
  for (const f of s.fields) {
    const val = (v[f.key] ?? '').trim();
    if (!val) { if (f.required) e[f.key] = f.kind === 'select' ? 'Choose an option.' : 'This field is required.'; continue; }
    if (f.kind === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n)) e[f.key] = 'Enter a number.';
      else if (f.min !== undefined && n < f.min) e[f.key] = f.min > 0 ? 'Must be greater than zero.' : `Must be ${f.min} or more.`;
    }
  }
  if (highMatch && v.override.trim().length < MIN_OVERRIDE) e.override = `A high-confidence duplicate exists. Justify why this is a different entity (at least ${MIN_OVERRIDE} characters).`;
  return e;
}

/* --------------------------------------------------------- email intake */

interface Parsed { values: Values; found: { label: string; value: string }[]; missing: string[] }

const LABELS: Record<string, string[]> = {
  name: ['name', 'company name', 'company', 'customer name', 'customer', 'vendor name', 'vendor', 'supplier', 'supplier name', 'item name', 'item', 'account name', 'legal name', 'cost center name'],
  identifier: ['identifier', 'registration no', 'registration number', 'registration', 'reg no', 'uen', 'ssm', 'npwp', 'tax id', 'tax no', 'vat', 'sku', 'material code', 'item code', 'cost center code', 'code'],
  email: ['email', 'e-mail', 'contact email'],
  country: ['country', 'market'],
  requester: ['requester', 'requested by', 'contact person', 'contact'],
  deadline: ['deadline', 'due', 'due date', 'needed by', 'required by'],
};
const COUNTRY_NAME: [string, RegExp, RegExp][] = [
  ['Singapore', /\bsingapore\b/i, /\bSG\b/], ['Malaysia', /\bmalaysia\b/i, /\bMY\b/], ['Thailand', /\bthailand\b/i, /\bTH\b/],
  ['Indonesia', /\bindonesia\b/i, /\bID\b/], ['Vietnam', /\bviet ?nam\b/i, /\bVN\b/],
];

// Plain keyword/regex rules. No model, no network: what it cannot match is reported as missing.
function parseEmail(text: string): Parsed {
  const lines = text.replace(/\r/g, '').split('\n');
  const labelled = new Map<string, string>();
  const headers = new Map<string, string>();
  const consumed = new Set<number>();
  lines.forEach((line, i) => {
    const m = /^\s*([A-Za-z][A-Za-z .\-/]{0,30}?)\s*[:=]\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    const k = m[1].toLowerCase().trim();
    if (['from', 'to', 'cc', 'subject', 'date', 'sent'].includes(k)) { headers.set(k, m[2]); consumed.add(i); return; }
    if (!labelled.has(k)) labelled.set(k, m[2]);
    if (Object.values(LABELS).some(syn => syn.includes(k))) consumed.add(i);
  });
  const pick = (field: string) => { for (const s of LABELS[field]) { const v = labelled.get(s); if (v) return v; } return ''; };

  const body = lines.filter((_, i) => !consumed.has(i)).join('\n');
  const haystack = `${headers.get('subject') ?? ''}\n${text}`;
  const out: Values = {};

  const typeRules: [RequestType, RegExp][] = [['Cost Center', /cost[\s-]?cent(er|re)/i], ['Vendor', /\b(vendor|supplier)\b/i], ['Item', /\b(item|material|sku|product code)\b/i], ['Customer', /\b(customer|client|account|distributor)\b/i]];
  const type = typeRules.find(([, re]) => re.test(haystack))?.[0];
  if (type) out.type = type;

  const name = pick('name'); if (name) out.name = name;
  const id = pick('identifier'); if (id) out.identifier = id;

  const from = headers.get('from') ?? '';
  const fromAddr = /<([^>]+)>/.exec(from)?.[1] ?? (EMAIL_RE.test(from.trim()) ? from.trim() : '');
  const emailLabel = pick('email');
  const anyEmail = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@.]+/.exec(body)?.[0];
  const email = emailLabel || anyEmail || fromAddr; if (email) out.email = email;

  let country = pick('country');
  let cName = COUNTRY_NAME.find(([n, re, code]) => re.test(country) || code.test(country) || n === country)?.[0];
  if (!cName) cName = COUNTRY_NAME.find(([, re, code]) => re.test(text) || code.test(text))?.[0];
  if (cName) out.country = cName;

  let requester = pick('requester') || from.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  if (!requester) {
    const sign = lines.findIndex(l => /^(regards|thanks|thank you|best|cheers|sincerely)[,.!]?\s*$/i.test(l.trim()));
    if (sign >= 0) requester = (lines.slice(sign + 1).find(l => l.trim()) ?? '').trim();
  }
  if (requester) out.requester = requester;

  const dl = /\b(\d{4}-\d{2}-\d{2})\b/.exec(pick('deadline')) ?? /\b(?:by|before|deadline|due)\b[^\n\d]{0,12}(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (dl) out.deadline = dl[1];

  if (/\b(urgent|asap|immediately|critical)\b/i.test(haystack)) out.priority = '3';
  else if (/\blow priority\b/i.test(haystack)) out.priority = '1';

  const subject = headers.get('subject');
  const cleaned = body
    .split('\n').filter(l => !/^\s*(hi|hello|dear)\b.*[,!]?\s*$/i.test(l.trim()) || l.trim().length > 40)
    .filter(l => !/^\s*(regards|thanks|thank you|best|cheers|sincerely)[,.!]?\s*$/i.test(l.trim()) && l.trim() !== requester)
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const just = [subject ? `Email subject: ${subject}` : '', cleaned].filter(Boolean).join('\n');
  if (just) out.justification = `${just}\n[Captured from email by rule-based intake; reviewed by requester]`;

  const nice: Record<string, string> = { type: 'Type', name: 'Name', identifier: 'Identifier', email: 'Email', country: 'Country', requester: 'Requester', deadline: 'Deadline', priority: 'Priority', justification: 'Justification' };
  const found = Object.keys(nice).filter(k => out[k]).map(k => ({ label: nice[k], value: k === 'justification' ? `${out[k].split('\n')[0].slice(0, 60)}…` : k === 'priority' ? `${out[k]} · ${PRIORITY_LABELS[+out[k]]}` : out[k] }));
  const missing = ['type', 'name', 'identifier', 'email', 'country', 'requester', 'deadline'].filter(k => !out[k]).map(k => nice[k]);
  return { values: out, found, missing };
}

/* ----------------------------------------------------------- shared hooks */

function useDuplicates(input: DupInput | null, delay = 450) {
  const [state, setState] = useState<DupState>({ status: 'idle', matches: [], error: '' });
  const [nonce, setNonce] = useState(0);
  const key = input ? JSON.stringify(input) : '';
  useEffect(() => {
    if (!input) { setState({ status: 'idle', matches: [], error: '' }); return; }
    let cancelled = false;
    setState(s => ({ ...s, status: 'loading', error: '' }));
    const t = setTimeout(async () => {
      try {
        const r = await api<{ matches: Match[] }>('/duplicates', { method: 'POST', body: JSON.stringify(input) });
        if (!cancelled) setState({ status: 'done', matches: [...(r.matches ?? [])].sort((a, b) => b.score - a.score), error: '' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', matches: [], error: errMsg(e) });
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, delay]);
  return { ...state, retry: () => setNonce(n => n + 1) };
}

/* ---------------------------------------------------------- small widgets */

function Spinner({ label }: { label: string }) {
  return <span className="rq-inline-status" role="status"><Loader2 className="rq-spin" size={16} aria-hidden="true" />{label}</span>;
}

function ErrorBox({ message, onRetry, title = 'Something went wrong' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div className="rq-error" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div><strong>{title}</strong><p>{message}</p></div>
      {onRetry && <button type="button" className="button secondary rq-sm" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Retry</button>}
    </div>
  );
}

// Matches can be customer-master records or earlier same-type requests. Only real customer IDs can be
// opened in the graph, and a request never matches itself (selfId).
function MatchList({ dup, onInvestigate, emptyText, customerIds, selfId }: {
  dup: DupState & { retry: () => void }; onInvestigate?: (id: string) => void; emptyText: string; customerIds: Set<string>; selfId?: string;
}) {
  const matches = dup.matches.filter(m => m.customer && m.customer.id !== selfId);
  if (dup.status === 'idle') return <p className="muted rq-hint">{emptyText}</p>;
  if (dup.status === 'error') return <ErrorBox title="Duplicate check unavailable" message={dup.error} onRetry={dup.retry} />;
  if (dup.status === 'loading' && !matches.length) return <Spinner label="Screening existing customers…" />;
  if (!matches.length) return <p className="rq-clear"><ShieldCheck size={16} aria-hidden="true" />No similar records found.</p>;
  return (
    <div aria-busy={dup.status === 'loading'}>
      <p className="muted rq-hint">Scores are a heuristic from 0–100 based on the evidence shown, not a probability.</p>
      <ul className="rq-matches">
        {matches.map(m => {
          const band = matchBand(m.score);
          const isCustomer = customerIds.has(m.customer.id);
          return (
            <li key={m.customer.id} className={`rq-match rq-${band.key}`}>
              <div className="rq-match-head">
                <div>
                  <strong>{m.customer.name}</strong>
                  <span className="muted"> · {m.customer.country}</span>
                  <span className="rq-source">{isCustomer ? 'Customer record' : `Earlier request ${shortId(m.customer.id)}`}</span>
                </div>
                <span className={`badge ${band.key === 'high' ? 'warning' : ''}`}>{band.label}</span>
              </div>
              <div className="rq-score" role="img" aria-label={`Match score ${Math.round(m.score)} out of 100`}>
                <span className="rq-score-bar"><span style={{ width: `${Math.max(2, Math.min(100, m.score))}%` }} /></span>
                <span className="rq-score-num">{Math.round(m.score)}</span>
              </div>
              {m.evidence?.length > 0 && (
                <ul className="rq-evidence" aria-label="Evidence">
                  {m.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                </ul>
              )}
              <div className="rq-match-foot">
                <span className="muted">{isHidden(m.customer.identifier) ? 'Identifier and email hidden for this role' : [m.customer.identifier, m.customer.email].filter(Boolean).join(' · ') || 'No identifier on record'}</span>
                {onInvestigate && isCustomer && (
                  <button type="button" className="button secondary rq-sm" onClick={() => onInvestigate(m.customer.id)} aria-label={`Open ${m.customer.name} in the graph`}>
                    <Network size={14} aria-hidden="true" />Open in graph
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Scalar({ v }: { v: unknown }) {
  if (isHidden(v)) return <span className="rq-redacted">Hidden for this role</span>;
  if (typeof v === 'boolean') return <>{v ? 'Yes' : 'No'}</>;
  return <>{String(v ?? '—') || '—'}</>;
}

function DetailsView({ details }: { details: DetailMap }) {
  const entries = Object.entries(details ?? {});
  if (!entries.length) {
    return (
      <p className="muted rq-hint">
        No type-specific details were supplied for this request.
      </p>
    );
  }
  return (
    <dl className="rq-kv rq-details">
      {entries.map(([k, v]) => <div key={k} className={typeof v === 'string' && v.length > 60 ? 'rq-wide' : ''}><dt>{k}</dt><dd><Scalar v={v} /></dd></div>)}
    </dl>
  );
}

function Modal({ titleId, onClose, busy, children }: { titleId: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
    (root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rq-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="rq-modal panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>{children}</div>
    </div>
  );
}

function ActionDialog({ req, action, role, onCancel, onConfirm }: { req: Req; action: Action; role: Role; onCancel: () => void; onConfirm: (note: string) => Promise<void> }) {
  const meta = ACTIONS[action];
  const uid = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const Icon = meta.icon;
  const trimmed = note.trim();
  const invalid = meta.noteRequired ? trimmed.length < MIN_NOTE : false;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (invalid) return;
    setBusy(true); setError('');
    try { await onConfirm(trimmed); } catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  return (
    <Modal titleId={`${uid}-t`} onClose={onCancel} busy={busy}>
      <form onSubmit={submit} noValidate>
        <div className={`rq-modal-head rq-tone-${meta.tone}`}>
          <span className="rq-modal-icon"><Icon size={20} aria-hidden="true" /></span>
          <div>
            <h2 id={`${uid}-t`}>{meta.label}: {req.name}</h2>
            <p className="muted">{shortId(req.id)} · {req.type} · acting as <strong>{role}</strong> (demo role)</p>
          </div>
        </div>
        <p className="rq-modal-blurb">{meta.blurb}</p>
        <div className="field rq-field">
          <label htmlFor={`${uid}-n`}>Note {meta.noteRequired ? <span className="rq-req">required</span> : <span className="muted">optional</span>}</label>
          <textarea id={`${uid}-n`} rows={4} value={note} onChange={e => setNote(e.target.value)} onBlur={() => setTouched(true)} data-autofocus
            aria-invalid={touched && invalid} aria-describedby={touched && invalid ? `${uid}-e` : undefined}
            placeholder={action === 'approve' ? 'Add context for the audit trail (optional)' : 'Explain your decision so the next person can act on it'} />
          {touched && invalid && <p className="rq-err" id={`${uid}-e`}><AlertTriangle size={14} aria-hidden="true" />Add a note of at least {MIN_NOTE} characters.</p>}
        </div>
        {error && <ErrorBox message={error} title="The action was not applied" />}
        <div className="rq-modal-actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={`button rq-confirm rq-${meta.tone}`} disabled={busy}>
            {busy ? <Loader2 className="rq-spin" size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
            Confirm {meta.label.toLowerCase()}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ request form */

function Wrap({ id, label, required, hint, error, children, wide }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`field rq-field ${wide ? 'rq-wide' : ''}`}>
      <label htmlFor={id}>{label} {required ? <span className="rq-req" aria-label="required">*</span> : <span className="muted">optional</span>}</label>
      {children}
      <p className="rq-hint muted" id={`${id}-hint`}>{hint ?? ''}</p>
      {error && <p className="rq-err" id={`${id}-err`}><AlertTriangle size={14} aria-hidden="true" />{error}</p>}
    </div>
  );
}


const FIELD_ORDER = ['type', 'name', 'country', 'identifier', 'email', 'requester', 'deadline', 'priority'];

function initialValues(): Values {
  return { type: 'Customer', name: '', country: '', identifier: '', email: '', requester: '', deadline: addDays(14), priority: '2', justification: '', override: '' };
}

function RequestForm({ role, customerIds, onCreated, onInvestigate }: { role: Role; customerIds: Set<string>; onCreated: (res: any) => void; onInvestigate?: (id: string) => void }) {
  const uid = useId();
  const [v, setV] = useState<Values>(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [forceOverride, setForceOverride] = useState(false);
  const [email, setEmail] = useState({ open: false, text: '', parsed: null as Parsed | null });
  const formRef = useRef<HTMLFormElement>(null);

  const type = v.type as RequestType;
  const schema = SCHEMAS[type];

  const dupInput = useMemo<DupInput | null>(() => {
    const name = v.name.trim(), identifier = v.identifier.trim(), em = v.email.trim();
    if (name.length < 3 && identifier.length < 4 && !EMAIL_RE.test(em)) return null;
    return { name, identifier, email: em, type };
  }, [v.name, v.identifier, v.email, type]);
  const dup = useDuplicates(dupInput);
  const hasMatches = dup.matches.length > 0;
  const highMatch = dup.matches.some(m => m.score >= HIGH_MATCH);
  const overrideNeeded = highMatch || forceOverride;

  const errors = validate(v, overrideNeeded);
  const show = (k: string) => (touched[k] || submitted ? errors[k] : undefined);
  const set = (k: string, val: string) => { setV(p => ({ ...p, [k]: val })); setServerError(''); };

  const ctl = (k: string) => ({
    id: `${uid}-${k}`, name: k, value: v[k] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value),
    onBlur: () => setTouched(t => ({ ...t, [k]: true })),
    'aria-invalid': show(k) ? true : undefined,
    'aria-describedby': [show(k) ? `${uid}-${k}-err` : '', `${uid}-${k}-hint`].join(' ').trim(),
  });
  const wp = (k: string) => ({ id: `${uid}-${k}`, error: show(k) });
  const renderControl = (f: FieldDef) => {
    if (f.kind === 'select') return (
      <select {...ctl(f.key)} required={f.required}>
        <option value="">Select…</option>
        {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    return <input {...ctl(f.key)} type={f.kind === 'number' ? 'number' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} min={f.min} step="any" placeholder={f.placeholder} required={f.required} />;
  };

  const applyEmail = () => {
    const parsed = email.parsed; if (!parsed) return;
    setV(p => ({ ...p, ...parsed.values }));
    setTouched({}); setSubmitted(false);
    setEmail(e => ({ ...e, open: false }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSubmitted(true); setServerError('');
    const keys = [...FIELD_ORDER, ...schema.fields.map(f => f.key), 'justification', 'override'];
    const bad = keys.find(k => errors[k]);
    if (bad) { (formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-${bad}`)}`))?.focus(); return; }
    if (dup.status === 'loading') { setServerError('The duplicate check is still running. Try again in a moment.'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        type, name: v.name.trim(), country: v.country, identifier: v.identifier.trim(), email: v.email.trim(),
        details: composeDetails(type, v), requester: v.requester.trim(), deadline: v.deadline, priority: Number(v.priority),
      };
      if (v.override.trim() && (hasMatches || forceOverride)) body.duplicateOverride = v.override.trim();
      const res = await api('/requests', { method: 'POST', headers: { 'X-Role': role }, body: JSON.stringify(body) });
      setV(initialValues()); setTouched({}); setSubmitted(false); setForceOverride(false); setEmail({ open: false, text: '', parsed: null });
      onCreated(res);
    } catch (err) {
      const m = errMsg(err);
      if (/duplicate|override/i.test(m)) setForceOverride(true);
      setServerError(m);
    } finally { setBusy(false); }
  };

  const errorList = submitted ? Object.entries(errors) : [];
  const TypeIcon = schema.icon;

  return (
    <form className="rq-form" ref={formRef} onSubmit={submit} noValidate aria-label="New master data request">
      <div className="rq-form-main">
        <section className="panel rq-section" aria-labelledby={`${uid}-h-type`}>
          <h2 id={`${uid}-h-type`}>1. What are you requesting?</h2>
          <div className="rq-type-grid" role="radiogroup" aria-label="Request type">
            {TYPES.map(t => {
              const Icon = TYPE_ICON[t];
              return (
                <label key={t} className={`rq-type ${type === t ? 'is-on' : ''}`}>
                  <input type="radio" name={`${uid}-type`} id={t === 'Customer' ? `${uid}-type` : undefined} checked={type === t} onChange={() => { set('type', t); setForceOverride(false); }} />
                  <Icon size={20} aria-hidden="true" />
                  <span><strong>{t}</strong><small>{SCHEMAS[t].blurb}</small></span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="panel rq-section" aria-labelledby={`${uid}-h-intake`}>
          <div className="rq-section-head">
            <h2 id={`${uid}-h-intake`}><Mail size={18} aria-hidden="true" />Start from an email <span className="badge">Rule-based</span></h2>
            <button type="button" className="button secondary rq-sm" aria-expanded={email.open} onClick={() => setEmail(s => ({ ...s, open: !s.open }))}>{email.open ? 'Hide' : 'Paste email'}</button>
          </div>
          {!email.open && <p className="muted rq-hint">Optional. Paste a request email and fixed keyword/label rules will pre-fill the form. No AI is involved, and you review everything before submitting.</p>}
          {email.open && (
            <div className="rq-intake">
              <div className="field rq-field">
                <label htmlFor={`${uid}-email-text`}>Email text</label>
                <textarea id={`${uid}-email-text`} rows={8} value={email.text} onChange={e => setEmail(s => ({ ...s, text: e.target.value, parsed: null }))}
                  placeholder={'Subject: New vendor request\nCompany name: …\nCountry: …\nEmail: …'} />
                <p className="rq-hint muted">Recognises lines like <code>Company name:</code>, <code>Registration no:</code>, <code>Country:</code>, <code>Email:</code>, <code>Needed by: 2026-11-20</code>, plus the From header and keywords such as “vendor” or “urgent”.</p>
              </div>
              <div className="rq-row">
                <button type="button" className="button secondary rq-sm" onClick={() => setEmail(s => ({ ...s, text: SAMPLE_EMAIL, parsed: null }))}>Load sample</button>
                <button type="button" className="button rq-sm" disabled={!email.text.trim()} onClick={() => setEmail(s => ({ ...s, parsed: parseEmail(s.text) }))}><Wand2 size={14} aria-hidden="true" />Extract fields</button>
              </div>
              {email.parsed && (
                <div className="rq-parsed" role="status">
                  {email.parsed.found.length === 0
                    ? <p><AlertTriangle size={16} aria-hidden="true" />Nothing could be matched. Add labelled lines such as “Country: Malaysia”.</p>
                    : <>
                      <p><strong>{email.parsed.found.length} fields matched</strong> by rules (review before use):</p>
                      <ul>{email.parsed.found.map(f => <li key={f.label}><span className="muted">{f.label}</span> {f.value}</li>)}</ul>
                      {email.parsed.missing.length > 0 && <p className="rq-warn-text"><AlertTriangle size={14} aria-hidden="true" />Not found: {email.parsed.missing.join(', ')}</p>}
                      <button type="button" className="button rq-sm" onClick={applyEmail}><Check size={14} aria-hidden="true" />Apply to form</button>
                    </>}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel rq-section" aria-labelledby={`${uid}-h-core`}>
          <h2 id={`${uid}-h-core`}><TypeIcon size={18} aria-hidden="true" />2. {type} details</h2>
          <div className="rq-grid">
            <Wrap {...wp('name')} label={`${type} name`} required hint="Legal or master-data name as it should appear in SAP"><input {...ctl('name')} type="text" autoComplete="off" required /></Wrap>
            <Wrap {...wp('country')} label="Country" required><select {...ctl('country')} required><option value="">Select…</option>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></Wrap>
            <Wrap {...wp('identifier')} label={schema.identifierLabel} required={schema.identifierRequired} hint={schema.identifierHint}><input {...ctl('identifier')} type="text" autoComplete="off" required /></Wrap>
            <Wrap {...wp('email')} label="Contact email" required={schema.emailRequired} hint={schema.emailRequired ? 'Required; also used for duplicate screening' : 'Add one if there is a responsible contact'}><input {...ctl('email')} type="email" autoComplete="off" /></Wrap>
            {schema.fields.map(f => <Wrap key={f.key} {...wp(f.key)} label={f.label} required={f.required} hint={f.hint}>{renderControl(f)}</Wrap>)}
          </div>
        </section>

        <section className="panel rq-section" aria-labelledby={`${uid}-h-req`}>
          <h2 id={`${uid}-h-req`}>3. Request context</h2>
          <div className="rq-grid">
            <Wrap {...wp('requester')} label="Requester" required hint="Who answers clarification questions"><input {...ctl('requester')} type="text" autoComplete="name" required /></Wrap>
            <Wrap {...wp('deadline')} label="Needed by" required><input {...ctl('deadline')} type="date" min={isoDate(new Date())} required /></Wrap>
            <Wrap {...wp('priority')} label="Priority" required hint="3 is the most urgent; urgent items are reviewed first"><select {...ctl('priority')}>{PRIORITY_VALUES.map(p => <option key={p} value={p}>{p} · {PRIORITY_LABELS[p]}</option>)}</select></Wrap>
            <Wrap {...wp('justification')} label="Business justification" required wide hint="Why is this needed and what happens if it is delayed?"><textarea {...ctl('justification')} rows={4} required /></Wrap>
          </div>
        </section>
      </div>

      <aside className="rq-form-side" aria-label="Duplicate screening and submission">
        <section className={`panel rq-section ${highMatch ? 'rq-section-warn' : ''}`} aria-labelledby={`${uid}-h-dup`}>
          <h2 id={`${uid}-h-dup`}><ShieldCheck size={18} aria-hidden="true" />Duplicate screening</h2>
              <div aria-live="polite">
                {highMatch && <p className="rq-warn-text"><AlertTriangle size={16} aria-hidden="true" />A high-confidence match exists. Submission needs a written override.</p>}
              </div>
              <MatchList dup={dup} onInvestigate={onInvestigate} customerIds={customerIds} emptyText={`Enter a name, identifier or email to screen against existing ${type === 'Customer' ? 'customers and customer requests' : `${type.toLowerCase()} requests`}.`} />
              {(hasMatches || forceOverride) && (
                <div className="field rq-field">
                  <label htmlFor={`${uid}-override`}>Override justification {overrideNeeded ? <span className="rq-req" aria-label="required">*</span> : <span className="muted">optional</span>}</label>
                  <textarea {...ctl('override')} id={`${uid}-override`} rows={3} placeholder="Why is this a different legal entity, branch or account?" />
                  <p className="rq-hint muted" id={`${uid}-override-hint`}>Recorded on the request and in the audit trail.</p>
                  {show('override') && <p className="rq-err" id={`${uid}-override-err`}><AlertTriangle size={14} aria-hidden="true" />{errors.override}</p>}
                </div>
              )}
        </section>

        <section className="panel rq-section" aria-labelledby={`${uid}-h-sub`}>
          <h2 id={`${uid}-h-sub`}>Submit</h2>
          {errorList.length > 0 && (
            <div className="rq-error" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div><strong>{errorList.length} {errorList.length === 1 ? 'field needs' : 'fields need'} attention</strong>
                <ul>{errorList.slice(0, 6).map(([k, m]) => <li key={k}>{m}</li>)}</ul></div>
            </div>
          )}
          {serverError && <ErrorBox title="The server rejected this request" message={serverError} />}
          <p className="muted rq-hint">Submitting as <strong>{role}</strong> (demo role, not authentication). Anyone may raise a request; routing starts at {ROUTES[type][0]}.</p>
          <button type="submit" className="button rq-block" disabled={busy}>
            {busy ? <Loader2 className="rq-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </section>
      </aside>
    </form>
  );
}

/* ----------------------------------------------------------- request card */

function RequestCard({ r, active, needs, onSelect }: { r: Req; active: boolean; needs: boolean; onSelect: () => void }) {
  const Icon = TYPE_ICON[r.type] ?? ClipboardList;
  const due = dueInfo(r);
  const SIcon = statusIcon(r.status);
  return (
    <li>
      <button type="button" className={`rq-card ${active ? 'is-active' : ''} ${needs ? 'is-needs' : ''}`} data-req={r.id} aria-current={active ? 'true' : undefined} onClick={onSelect}>
        <span className="rq-card-icon"><Icon size={18} aria-hidden="true" /></span>
        <span className="rq-card-main">
          <span className="rq-card-top">
            <strong>{r.name}</strong>
            <span className={`rq-prio ${r.priority >= HIGH_PRIORITY ? 'is-high' : ''}`} title={`Priority ${r.priority}${PRIORITY_LABELS[r.priority] ? ` · ${PRIORITY_LABELS[r.priority]}` : ''}`}>P{r.priority}</span>
          </span>
          <span className="muted rq-card-sub">{shortId(r.id)} · {r.type} · {r.country}</span>
          <span className="rq-card-meta">
            <span className={statusClass(r.status)}><SIcon size={12} aria-hidden="true" /> {r.status}</span>
            {needs && <span className="badge rq-needs">Needs you</span>}
            {due && <span className={`rq-due rq-due-${due.tone}`}><Clock size={12} aria-hidden="true" />{due.text}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ---------------------------------------------------------- request detail */

function RequestDetail({ req, audit, role, customerIds, index, total, onPrev, onNext, onAct, onInvestigate }: {
  req: Req; audit: AuditEntry[]; role: Role; customerIds: Set<string>; index: number; total: number;
  onPrev: () => void; onNext: () => void; onAct: (a: Action) => void; onInvestigate?: (id: string) => void;
}) {
  // Redacted identifier/email are not real values, so they are not sent for matching.
  const dup = useDuplicates({ name: req.name, identifier: isHidden(req.identifier) ? '' : req.identifier, email: isHidden(req.email) ? '' : req.email, type: req.type }, 0);
  const [sap, setSap] = useState<{ status: 'idle' | 'loading' | 'error' | 'done'; data: unknown; error: string; open: boolean }>({ status: 'idle', data: null, error: '', open: false });
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const due = dueInfo(req);
  const needs = needsRole(req, role);
  const SIcon = statusIcon(req.status);
  const Icon = TYPE_ICON[req.type] ?? ClipboardList;
  const timeline = useMemo(() => audit.filter(a => a.requestId === req.id).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()), [audit, req.id]);

  const fetchSap = async () => {
    setSap(s => ({ ...s, status: 'loading', error: '' }));
    try {
      const data = await api(`/requests/${encodeURIComponent(req.id)}/sap`, { headers: { 'X-Role': role } });
      setSap(s => ({ ...s, status: 'done', data }));
      return data;
    } catch (e) { setSap(s => ({ ...s, status: 'error', error: errMsg(e) })); return null; }
  };
  const download = async () => {
    const data = sap.status === 'done' ? sap.data : await fetchSap();
    if (data == null) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `sap-${req.id}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const togglePreview = async () => {
    if (sap.open) { setSap(s => ({ ...s, open: false })); return; }
    setSap(s => ({ ...s, open: true }));
    if (sap.status !== 'done') await fetchSap();
  };

  const onPointerDown = (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') return; swipe.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipe.current; swipe.current = null; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) (dx < 0 ? onNext : onPrev)();
  };

  const canResubmit = req.status === 'Clarification' || req.status === 'Rejected';
  const decide = req.status === 'Pending';
  const mayDecide = canDecide(req, role);
  const mayResubmit = canResubmitAs(req, role);
  const maySap = SEES_SENSITIVE.includes(role);

  return (
    <article className="panel rq-detail" aria-labelledby="rq-detail-title" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}>
      <div className="rq-pager">
        <button type="button" className="button secondary rq-sm" onClick={onPrev} disabled={index <= 0} aria-label="Previous request"><ChevronLeft size={16} aria-hidden="true" />Prev</button>
        <span className="muted" aria-live="polite">{index >= 0 ? `Request ${index + 1} of ${total}` : `Outside current filter · ${total} shown`}</span>
        <button type="button" className="button secondary rq-sm" onClick={onNext} disabled={index >= 0 && index >= total - 1} aria-label="Next request">Next<ChevronRight size={16} aria-hidden="true" /></button>
      </div>

      <header className="rq-detail-head">
        <span className="rq-card-icon rq-lg"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <h2 id="rq-detail-title">{req.name}</h2>
          <p className="muted">{shortId(req.id)} · {req.type} request · raised by {req.requester || 'unknown'}</p>
          <div className="rq-card-meta">
            <span className={statusClass(req.status)}><SIcon size={12} aria-hidden="true" /> {req.status}</span>
            <span className={`rq-prio ${req.priority >= HIGH_PRIORITY ? 'is-high' : ''}`}>P{req.priority}{PRIORITY_LABELS[req.priority] ? ` · ${PRIORITY_LABELS[req.priority]}` : ''}</span>
            {needs && <span className="badge rq-needs">Needs {role}</span>}
            {due && <span className={`rq-due rq-due-${due.tone}`}><Clock size={12} aria-hidden="true" />{due.text}</span>}
          </div>
        </div>
      </header>

      {req.duplicateOverride && (
        <div className="rq-override" role="note">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><strong>Submitted with a duplicate override</strong><p>{isHidden(req.duplicateOverride) ? <span className="rq-redacted">Hidden for this role</span> : req.duplicateOverride}</p></div>
        </div>
      )}

      <dl className="rq-kv">
        <div><dt>Country</dt><dd>{req.country}</dd></div>
        <div><dt>Identifier</dt><dd>{req.identifier ? <Scalar v={req.identifier} /> : '—'}</dd></div>
        <div><dt>Email</dt><dd>{req.email ? <Scalar v={req.email} /> : '—'}</dd></div>
        <div><dt>Needed by</dt><dd>{fmtDate(req.deadline)}</dd></div>
        <div><dt>Submitted</dt><dd>{fmtDate(req.createdAt)}</dd></div>
        <div><dt>Current stage</dt><dd>{req.stage || '—'}</dd></div>
      </dl>

      <section aria-labelledby="rq-h-chain">
        <h3 id="rq-h-chain"><ListChecks size={16} aria-hidden="true" />Approval chain</h3>
        <ol className="rq-chain">
          {ROUTES[req.type].map((step, i) => {
            const done = req.approvals.includes(step);
            const current = !done && req.stage === step && req.status !== 'Approved';
            const state = done ? 'is-done' : current ? (req.status === 'Pending' ? 'is-now' : 'is-stop') : '';
            const StepIcon = done ? Check : current ? (req.status === 'Pending' ? Hourglass : req.status === 'Rejected' ? XCircle : MessageSquareWarning) : Clock;
            return (
              <li key={`${step}-${i}`} className={state}>
                <StepIcon size={13} aria-hidden="true" />{step}
                <span className="rq-sr">{done ? ' approved' : current ? ` ${req.status === 'Pending' ? 'awaiting decision' : req.status.toLowerCase()}` : ' not yet reached'}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="rq-h-det">
        <h3 id="rq-h-det">Request details</h3>
        <DetailsView details={req.details} />
      </section>

      <section aria-labelledby="rq-h-match">
        <h3 id="rq-h-match"><ShieldCheck size={16} aria-hidden="true" />Similar records</h3>
        <MatchList dup={dup} onInvestigate={onInvestigate} customerIds={customerIds} selfId={req.id} emptyText="" />
      </section>

      <section className="rq-actions" aria-labelledby="rq-h-act">
        <h3 id="rq-h-act">Decision</h3>
        <p className="muted rq-hint"><UserRound size={13} aria-hidden="true" /> Acting as <strong>{role}</strong>. This is a demo role switch, not authentication; the server validates each action.</p>
        {decide && (
          <>
            <div className="rq-row">
              <button type="button" className="button rq-ok" disabled={!mayDecide} onClick={() => onAct('approve')}><CheckCircle2 size={16} aria-hidden="true" />Approve</button>
              <button type="button" className="button secondary rq-warn" disabled={!mayDecide} onClick={() => onAct('clarify')}><MessageSquareWarning size={16} aria-hidden="true" />Request clarification</button>
              <button type="button" className="button secondary rq-danger-btn" disabled={!mayDecide} onClick={() => onAct('reject')}><XCircle size={16} aria-hidden="true" />Reject</button>
            </div>
            {!mayDecide && <p className="rq-warn-text"><Info size={14} aria-hidden="true" />Waiting on <strong>{req.stage}</strong>. Switch the demo role to {req.stage} or Admin to decide.</p>}
          </>
        )}
        {canResubmit && (
          <div className="rq-row">
            <button type="button" className="button" disabled={!mayResubmit} onClick={() => onAct('resubmit')}><RotateCcw size={16} aria-hidden="true" />Resubmit</button>
            <span className="muted rq-hint">{mayResubmit ? (req.status === 'Clarification' ? 'Answer the clarification and restart routing.' : 'Address the rejection and restart routing.') : 'Only Sales or Admin can resubmit. Switch the demo role to continue.'}</span>
          </div>
        )}
        {req.status === 'Approved' && (
          <div className="rq-sap">
            <p><FileJson size={16} aria-hidden="true" />Approved. A <strong>simulated</strong> SAP master-data payload is available to Finance and Admin. Nothing is sent to a real system.</p>
            {!maySap && <p className="rq-warn-text"><Info size={14} aria-hidden="true" />Switch the demo role to Finance or Admin to export.</p>}
            <div className="rq-row">
              <button type="button" className="button" onClick={download} disabled={!maySap || sap.status === 'loading'}>
                {sap.status === 'loading' ? <Loader2 className="rq-spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}Download SAP JSON
              </button>
              <button type="button" className="button secondary" onClick={togglePreview} aria-expanded={sap.open} disabled={!maySap}><Eye size={16} aria-hidden="true" />{sap.open ? 'Hide preview' : 'Preview'}</button>
            </div>
            {sap.status === 'error' && <ErrorBox title="Could not load the SAP payload" message={sap.error} onRetry={fetchSap} />}
            {sap.open && sap.status === 'done' && <pre className="rq-json" tabIndex={0} aria-label="SAP JSON preview">{JSON.stringify(sap.data, null, 2)}</pre>}
          </div>
        )}
      </section>

      <section aria-labelledby="rq-h-audit">
        <h3 id="rq-h-audit"><History size={16} aria-hidden="true" />Audit timeline</h3>
        {timeline.length === 0
          ? <p className="muted">No audit entries recorded for this request yet.</p>
          : <ol className="rq-timeline">
            {timeline.map(a => {
              const AIcon = auditIcon(a.action);
              return (
                <li key={a.id}>
                  <span className="rq-dot"><AIcon size={14} aria-hidden="true" /></span>
                  <div>
                    <p><strong>{AUDIT_LABEL[a.action] ?? a.action}</strong> <span className="muted">by {a.actor}</span></p>
                    {a.details && (isHidden(a.details) ? <p className="rq-tl-details"><span className="rq-redacted">Note hidden for this role</span></p> : <p className="rq-tl-details">{a.details}</p>)}
                    <time className="muted" dateTime={a.timestamp}>{fmtStamp(a.timestamp)}</time>
                  </div>
                </li>
              );
            })}
          </ol>}
      </section>
    </article>
  );
}

/* ------------------------------------------------------------------- main */

type Filter = 'All' | Status;

export default function Requests({ onInvestigate }: { onInvestigate?: (id: string) => void }) {
  const [role, setRole] = useState<Role>(() => {
    try { const s = localStorage.getItem(ROLE_KEY); if (s && (ROLES as readonly string[]).includes(s)) return s as Role; } catch { /* storage unavailable */ }
    return 'Sales';
  });
  const roleRef = useRef(role); roleRef.current = role;
  const [data, setData] = useState<{ requests: Req[]; audit: AuditEntry[]; customerIds: Set<string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'queue' | 'new'>('queue');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ req: Req; action: Action } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [synced, setSynced] = useState<Date | null>(null);
  const inflight = useRef(false);
  const load = useCallback(async (silent = false) => {
    if (inflight.current) return;
    inflight.current = true;
    if (!silent) setLoading(true);
    try {
      const d = await api<{ requests: Req[]; audit: AuditEntry[]; customers?: Customer[] }>('/bootstrap', { headers: { 'X-Role': roleRef.current } });
      setData({ requests: (d.requests ?? []).map(r => ({ ...r, approvals: r.approvals ?? [] })), audit: d.audit ?? [], customerIds: new Set((d.customers ?? []).map(c => c.id)) });
      setLoadError(''); setSynced(new Date());
    } catch (e) { setLoadError(errMsg(e)); } finally { inflight.current = false; setLoading(false); }
  }, []);
  const loadedRef = useRef(false);
  useEffect(() => { void load(loadedRef.current).then(() => { loadedRef.current = true; }); }, [load, role]); // redaction depends on role, so reload when it changes
  // Background refresh keeps drafts, the open dialog and the selection intact: only `data` is replaced.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(true); };
    const t = setInterval(tick, 20000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [load]);
  useEffect(() => { try { localStorage.setItem(ROLE_KEY, role); } catch { /* ignore */ } }, [role]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  const all = data?.requests ?? [];
  const sorter = useMemo(() => compareReq(role), [role]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: all.length, Pending: 0, Clarification: 0, Rejected: 0, Approved: 0 };
    all.forEach(r => { c[r.status] += 1; });
    return c;
  }, [all]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(r => (filter === 'All' || r.status === filter) && (!q || [r.id, r.name, r.type, r.country, r.requester, isHidden(r.identifier) ? '' : r.identifier, r.stage].some(s => (s ?? '').toLowerCase().includes(q)) ))
      .sort(sorter);
  }, [all, filter, query, sorter]);
  const mine = useMemo(() => all.filter(r => needsRole(r, role)).length, [all, role]);
  const overdue = useMemo(() => all.filter(r => dueInfo(r)?.text.startsWith('Overdue')).length, [all]);

  const selected = all.find(r => r.id === selectedId) ?? visible[0] ?? null;
  const index = selected ? visible.findIndex(r => r.id === selected.id) : -1;

  const go = useCallback((delta: number) => {
    if (!visible.length) return;
    const i = index < 0 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, index + delta));
    setSelectedId(visible[i].id);
  }, [visible, index]);

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector<HTMLElement>(`[data-req="${CSS.escape(selected.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onQueueKey = (e: ReactKeyboardEvent) => {
    if (dialog || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(-1); }
  };

  const confirmAction = async (note: string) => {
    if (!dialog) return;
    const { req, action } = dialog;
    await api(`/requests/${encodeURIComponent(req.id)}/action`, { method: 'POST', headers: { 'X-Role': role }, body: JSON.stringify({ action, note }) });
    setDialog(null);
    setToast({ text: `${req.name} (${shortId(req.id)}) ${ACTIONS[action].past} as ${role}.`, tone: 'ok' });
    await load(true);
  };

  const onCreated = async (res: any) => {
    const id: string | undefined = res?.id ?? res?.request?.id;
    setToast({ text: id ? `Request ${shortId(id)} submitted. It is now with ${res?.stage ?? 'the first approver'}.` : 'Request submitted.', tone: 'ok' });
    setFilter('All'); setQuery('');
    if (id) setSelectedId(id);
    setTab('queue');
    await load(true);
  };

  const onTabKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'queue' : e.key === 'End' ? 'new' : tab === 'queue' ? 'new' : 'queue';
    setTab(next); tabRefs.current[next]?.focus();
  };

  return (
    <div className="rq-root">
      <header className="page-header">
        <div>
          <p className="eyebrow">Master data governance</p>
          <h1>Requests &amp; approvals</h1>
          <p className="muted">Raise customer, vendor, item and cost center requests, screen them for duplicates and move them through approval.</p>
        </div>
        <div className="rq-sync">
          {synced && <span className="muted" title="The queue also refreshes every 20 seconds and when the window regains focus">Synced {synced.toLocaleTimeString('en-GB')}</span>}
          <button type="button" className="button secondary" onClick={() => void load(true)} aria-label="Refresh requests"><RefreshCw size={16} aria-hidden="true" />Refresh</button>
        </div>
      </header>

      <fieldset className="panel rq-role">
        <legend>Acting as</legend>
        <div className="rq-role-options">
          {ROLES.map(r => (
            <label key={r} className={`rq-role-opt ${role === r ? 'is-on' : ''}`}>
              <input type="radio" name="rq-role" value={r} checked={role === r} onChange={() => setRole(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        <p className="rq-role-note"><Info size={14} aria-hidden="true" />Demo role switcher only. It is <strong>not authentication</strong>: your choice is sent as the <code>X-Role</code> header so you can see each approver’s view.</p>
      </fieldset>

      <div className="rq-toast-slot" aria-live="polite">
        {toast && (
          <div className={`rq-toast rq-toast-${toast.tone}`}>
            <CheckCircle2 size={18} aria-hidden="true" /><span>{toast.text}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setToast(null)}><X size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {loading && !data && (
        <div className="panel rq-skeleton" role="status" aria-busy="true">
          <Spinner label="Loading requests…" />
          <div className="rq-skel-row" /><div className="rq-skel-row" /><div className="rq-skel-row short" />
        </div>
      )}
      {!data && !loading && loadError && <div className="panel"><ErrorBox title="Could not load requests" message={loadError} onRetry={() => void load()} /></div>}

      {data && (
        <>
          {loadError && <ErrorBox title="Showing the last loaded data" message={`Refresh failed: ${loadError}`} onRetry={() => void load(true)} />}
          <div className="rq-stats">
            <div className="rq-stat rq-stat-accent"><span>Needs {role}</span><strong>{mine}</strong></div>
            <div className="rq-stat"><span>Pending</span><strong>{counts.Pending}</strong></div>
            <div className="rq-stat"><span>Clarification</span><strong>{counts.Clarification}</strong></div>
            <div className="rq-stat"><span>Approved</span><strong>{counts.Approved}</strong></div>
            <div className={`rq-stat ${overdue ? 'rq-stat-warn' : ''}`}><span>Overdue</span><strong>{overdue}</strong></div>
          </div>

          <div className="rq-tabs" role="tablist" aria-label="Requests workspace" onKeyDown={onTabKey}>
            <button type="button" role="tab" id="rq-tab-queue" aria-selected={tab === 'queue'} aria-controls="rq-panel-queue" tabIndex={tab === 'queue' ? 0 : -1} ref={el => { tabRefs.current.queue = el; }} onClick={() => setTab('queue')}><Inbox size={16} aria-hidden="true" />Approval queue <span className="rq-count">{all.length}</span></button>
            <button type="button" role="tab" id="rq-tab-new" aria-selected={tab === 'new'} aria-controls="rq-panel-new" tabIndex={tab === 'new' ? 0 : -1} ref={el => { tabRefs.current.new = el; }} onClick={() => setTab('new')}><FilePlus2 size={16} aria-hidden="true" />New request</button>
          </div>

          <div role="tabpanel" id="rq-panel-queue" aria-labelledby="rq-tab-queue" hidden={tab !== 'queue'}>
            {all.length === 0
              ? <div className="panel empty-state"><Inbox size={28} aria-hidden="true" /><h2>No requests yet</h2><p className="muted">Create the first request to see it flow through approval.</p><button type="button" className="button" onClick={() => setTab('new')}>New request</button></div>
              : (
                <div className="rq-queue" onKeyDown={onQueueKey}>
                  <section className="panel rq-list" aria-label="Approval cards, highest priority first">
                    <div className="rq-search">
                      <Search size={16} aria-hidden="true" />
                      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, ID, country, stage…" aria-label="Search requests" />
                    </div>
                    <div className="rq-chips" role="group" aria-label="Filter by status">
                      {(['All', ...STATUSES] as Filter[]).map(f => (
                        <button key={f} type="button" className={`rq-chip ${filter === f ? 'is-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f} <span>{counts[f]}</span></button>
                      ))}
                    </div>
                    <p className="muted rq-hint rq-keys">Ordered by who is needed, then status, priority and deadline. Use <kbd>←</kbd> <kbd>→</kbd> to move between requests; swipe on touch screens.</p>
                    {visible.length === 0
                      ? <div className="empty-state"><Search size={24} aria-hidden="true" /><p>No requests match this filter.</p><button type="button" className="button secondary rq-sm" onClick={() => { setFilter('All'); setQuery(''); }}>Clear filters</button></div>
                      : <ul className="rq-cards" ref={listRef}>{visible.map(r => <RequestCard key={r.id} r={r} active={selected?.id === r.id} needs={needsRole(r, role)} onSelect={() => setSelectedId(r.id)} />)}</ul>}
                  </section>
                  {selected
                    ? <RequestDetail key={selected.id} req={selected} audit={data.audit} role={role} customerIds={data.customerIds} index={index} total={visible.length} onPrev={() => go(-1)} onNext={() => go(1)} onAct={a => setDialog({ req: selected, action: a })} onInvestigate={onInvestigate} />
                    : <div className="panel empty-state"><ClipboardList size={28} aria-hidden="true" /><p>Select a request to review.</p></div>}
                </div>
              )}
          </div>

          <div role="tabpanel" id="rq-panel-new" aria-labelledby="rq-tab-new" hidden={tab !== 'new'}>
            <RequestForm role={role} customerIds={data.customerIds} onCreated={onCreated} onInvestigate={onInvestigate} />
          </div>
        </>
      )}

      {dialog && <ActionDialog req={dialog.req} action={dialog.action} role={role} onCancel={() => setDialog(null)} onConfirm={confirmAction} />}
    </div>
  );
}
