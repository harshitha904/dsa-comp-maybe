import { randomUUID } from 'node:crypto';
export const roles = ['Sales','Finance','Quality','BU Head','Admin'];
export const entities = ['SPD','QTS','QTG'];
export const routes = {Customer:['Sales','Finance','BU Head'],Vendor:['Finance','Quality','BU Head'],Item:['Quality','Finance','BU Head'],'Cost Center':['Finance','BU Head']};
export class ApiError extends Error { constructor(status,message,extra={}) { super(message); this.status=status; Object.assign(this,extra); } }
const clean = value => typeof value === 'string' ? value.trim() : '';
const normalize = value => clean(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
function similarity(a,b) { if(!a || !b) return 0; let prev=Array.from({length:b.length+1},(_,i)=>i); for(let i=1;i<=a.length;i++){const next=[i]; for(let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); prev=next;} return 1-prev[b.length]/Math.max(a.length,b.length); }
function bounded(value, key, max=200) {
  if(value != null && typeof value !== 'string') throw new ApiError(400,`${key} must be text`);
  if((value || '').length > max) throw new ApiError(400,`${key} exceeds ${max} characters`);
  return clean(value);
}
export function duplicates(input, customers, requests=[]) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new ApiError(400,'Duplicate input must be an object');
  for(const key of ['name','identifier','email']) bounded(input[key],key);
  const type=input.type || 'Customer';
  if(!routes[type]) throw new ApiError(400,'Invalid request type');
  const candidates=[...(type==='Customer'?customers:[]),...requests.filter(r=>r.type===type && r.status!=='Rejected').map(r=>({id:r.id,name:r.name,country:r.country,entity:r.entity,identifier:r.identifier,email:r.email,aliases:[]}))];
  const name=normalize(input.name), identifier=normalize(input.identifier), email=normalize(input.email);
  return candidates.map(customer=>{ let score=0; const evidence=[]; const names=[customer.name,...(customer.aliases || [])].map(v=>normalize(clean(v).slice(0,200))); if(identifier && identifier===normalize(customer.identifier)){score=100;evidence.push('Exact identifier');} if(email && email===normalize(customer.email)){score=Math.max(score,95);evidence.push('Exact email');} if(name && names.includes(name)){score=Math.max(score,90);evidence.push('Exact name or alias');} else if(name){const best=Math.max(...names.map(n=>similarity(name,n))); if(best>=0.7){score=Math.max(score,Math.round(best*85));evidence.push('Similar name or alias');}} return {customer,score,evidence}; }).filter(m=>m.score>=60).sort((a,b)=>b.score-a.score);
}
export function createRequest(body, customers, requests=[], config=defaultConfig()) {
  if(!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400,'Request body must be an object');
  for(const key of ['type','name','country','identifier','email','requester','deadline','entity']) bounded(body[key],key);
  bounded(body.duplicateOverride,'duplicateOverride',2000);
  const type=clean(body.type); if(!routes[type]) throw new ApiError(400,'Invalid request type');
  const name=clean(body.name),country=clean(body.country),identifier=clean(body.identifier),email=clean(body.email),requester=clean(body.requester);
  const required=['name','country','requester']; if(type==='Customer'||type==='Vendor') required.push('identifier','email');
  const values={name,country,identifier,email,requester}; for(const key of required) if(!values[key]) throw new ApiError(400,`${key} is required`);
  if(!['Singapore','Malaysia','Thailand','Indonesia','Vietnam'].includes(country)) throw new ApiError(400,'Invalid country');
  const entity=clean(body.entity); if(entity && !entities.includes(entity)) throw new ApiError(400,'Invalid business entity');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400,'Invalid email');
  const route=(config.routes?.[type]?.length ? config.routes[type] : routes[type]);
  const details=parseDetails(body.details, type, config.fields?.[type]);
  const priority=body.priority == null ? 2 : Number(body.priority); if(!Number.isInteger(priority)||priority<1||priority>3) throw new ApiError(400,'priority must be an integer from 1 to 3');
  const matches=duplicates({type,name,identifier,email},customers,requests).filter(m=>m.score>=80); const override=clean(body.duplicateOverride); if(matches.length && override.length<10) throw new ApiError(409,'A duplicate requires an override justification of at least 10 characters',{matches});
  const now=new Date(); const deadline=body.deadline ? new Date(body.deadline) : new Date(now.getTime()+7*86400000); if(Number.isNaN(deadline.getTime())) throw new ApiError(400,'Invalid deadline');
  const request={id:randomUUID(),type,name,country,...(entity?{entity}:{}),identifier,email,details,requester,status:'Pending',stage:route[0],route:[...route],approvals:[],createdAt:now.toISOString(),deadline:deadline.toISOString(),priority,...(override?{duplicateOverride:override}:{})};
  sapPayload(request); // Catch export mapping constraints before entering the approval chain.
  return request;
}
export function act(request, action, note, role) {
  note=bounded(note,'note',2000); if(!['approve','reject','clarify','resubmit'].includes(action)) throw new ApiError(400,'Invalid action');
  if(!roles.includes(role)) throw new ApiError(403,'A valid demo X-Role is required');
  if(action==='resubmit') { if(request.status!=='Clarification' && request.status!=='Rejected') throw new ApiError(409,'Only clarification or rejected requests can be resubmitted'); if(!['Sales','Admin'].includes(role)) throw new ApiError(403,'Sales or Admin must resubmit'); if(!note) throw new ApiError(400,'A note is required'); return {...request,status:'Pending',stage:routeOf(request)[0],approvals:[]}; }
  if(request.status!=='Pending') throw new ApiError(409,'Request is not pending');
  if(role!=='Admin' && role!==request.stage) throw new ApiError(403,`Approval stage requires ${request.stage}`);
  if(action!=='approve' && !note) throw new ApiError(400,'A note is required');
  if(action==='reject') return {...request,status:'Rejected'};
  if(action==='clarify') return {...request,status:'Clarification'};
  const approvals=[...request.approvals,request.stage]; const next=routeOf(request)[approvals.length]; return {...request,approvals,status:next?'Pending':'Approved',stage:next || 'Complete'};
}
const sensitiveDetail = key => /^(bankaccount|bankaccountnumber|creditterms|paymentterms|terms|credit|creditlimit|requestedcreditlimitusd)$/.test(key.toLowerCase().replace(/[^a-z0-9]/g,''));
const schemas = {
  Customer: {segment:'Customer segment',terms:'Payment terms',credit:'Requested credit limit (USD)'},
  Vendor: {category:'Vendor category',terms:'Payment terms',bankCountry:'Bank country',contact:'Vendor contact person'},
  Item: {line:'Product line',uom:'Unit of measure',cost:'Standard cost (USD)'},
  'Cost Center': {owner:'Cost center owner',unit:'Business unit',budget:'Annual budget (USD)'}
};
export function parseDetails(raw, type, fields=defaultFields[type]) {
  let details=raw ?? {};
  if(typeof details==='string') {
    bounded(details,'details',8000);
    details=Object.fromEntries(details.split('\n').filter(s=>s.trim()).map(line=>{
      const i=line.indexOf(':'); if(i<1) throw new ApiError(400,'Details must use Label: value lines');
      return [line.slice(0,i).trim(),line.slice(i+1).trim()];
    }));
  }
  if(typeof details!=='object' || Array.isArray(details) || Object.keys(details).length>30) throw new ApiError(400,'details must be an object or labelled text with at most 30 fields');
  for(const [key,value] of Object.entries(details)) {
    bounded(key,'detail key',100);
    if(!key.trim() || !['string','number','boolean'].includes(typeof value) || (typeof value==='number' && !Number.isFinite(value)) || (typeof value==='string' && !bounded(value,key,2000))) throw new ApiError(400,'Dynamic detail values must be nonempty finite scalar values');
  }
  // Only require the fields the current form actually offers, accepting API keys or UI labels.
  for(const {key,label} of fields) {
    const value=details[key] ?? details[label];
    if(value==null || String(value).trim()==='') throw new ApiError(400,`${label} is required`);
    if(['credit','cost','budget'].includes(key) && (!Number.isFinite(Number(value)) || Number(value)<(key==='cost'?0.01:0))) throw new ApiError(400,`${label} must be a valid nonnegative amount`);
  }
  return details;
}
export function redact(data,role) {
  // Keep the structured contract. Free-text workflow notes are visible to collaborators;
  // sensitive values belong in the explicitly restricted structured fields.
  if(role==='Finance'||role==='Admin') return data;
  const configured=new Set(Object.values(configOf(data).fields).flat().filter(f=>f.sensitive).map(f=>f.key));
  const safeDetails=details=>Object.fromEntries(Object.entries(details || {}).map(([key,value])=>[key,sensitiveDetail(key)||configured.has(key)?'[redacted]':value]));
  return {...data,requests:data.requests.map(r=>({...r,details:safeDetails(r.details)}))};
}
export function sapPayload(item) {
  const name=bounded(item.name,'name',100);
  if(!name) throw new ApiError(400,'SAP name is required');
  const identifier=bounded(item.identifier,'identifier',32);
  const email=bounded(item.email,'email',100);
  let entitySet, data;
  if(item.type==='Customer' || item.type==='Vendor') {
    if(!identifier || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400,'SAP business partner requires a tax identifier and valid email');
    entitySet='BusinessPartners';
    data={CardCode:`${item.type==='Customer'?'C':'V'}-${item.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,13)}`,CardName:name,CardType:item.type==='Customer'?'cCustomer':'cSupplier',FederalTaxID:identifier,EmailAddress:email};
  } else {
    const code=identifier || `SIM-${item.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,4)}`;
    const max=item.type==='Item'?50:8;
    if(code.length>max || !/^[A-Za-z0-9_.\/-]+$/.test(code)) throw new ApiError(400,`SAP code must be 1-${max} letters, digits or code punctuation`);
    if(item.type==='Item') {entitySet='Items';data={ItemCode:code,ItemName:name,InventoryItem:'tYES',SalesItem:'tYES',PurchaseItem:'tYES'};}
    else if(item.type==='Cost Center') {if(name.length>30) throw new ApiError(400,'SAP CenterName exceeds 30 characters');entitySet='ProfitCenters';data={CenterCode:code,CenterName:name,InWhichDimension:1,Active:'tYES'};}
    else throw new ApiError(400,'Invalid SAP request type');
  }
  return {simulated:true,system:'SAP Business One Service Layer (simulated)',requestId:item.id,objectType:item.type,entitySet,serviceLayerPath:`/b1s/v1/${entitySet}`,data,exportedAt:new Date().toISOString()};
}
export function audit(requestId,action,actor,details='') { return {id:randomUUID(),requestId,action,actor,timestamp:new Date().toISOString(),details}; }

// Workflow rules the MDM team can edit without IT. Requests keep the route they
// were created with, so a rule change never strands an in-flight request.
const approverRoles=['Sales','Finance','Quality','BU Head'];
export const defaultFields=Object.fromEntries(Object.entries(schemas).map(([type,fields])=>[type,Object.entries(fields).map(([key,label])=>({key,label,...(sensitiveDetail(key)?{sensitive:true}:{}),...(['credit','cost','budget'].includes(key)?{number:true}:{})}))]));
export const defaultConfig=()=>({id:'workflow',routes:structuredClone(routes),fields:structuredClone(defaultFields),slaHours:48});
export const configOf=data=>data.config?.find(c=>c.id==='workflow') ?? defaultConfig();
const routeOf=request=>request.route?.length ? request.route : routes[request.type];
export function validateConfig(body) {
  if(!body || typeof body!=='object') throw new ApiError(400,'Config must be an object');
  const config=defaultConfig();
  for(const type of Object.keys(routes)) {
    const route=body.routes?.[type];
    if(!Array.isArray(route) || !route.length || route.length>6) throw new ApiError(400,`${type} needs 1-6 approval steps`);
    if(route.some(r=>!approverRoles.includes(r)) || new Set(route).size!==route.length) throw new ApiError(400,`${type} approval steps must be distinct approver roles`);
    config.routes[type]=[...route];
    const fields=body.fields?.[type];
    if(!Array.isArray(fields) || fields.length>15) throw new ApiError(400,`${type} needs at most 15 fields`);
    const keys=new Set();
    config.fields[type]=fields.map(f=>{
      const label=bounded(f?.label,'field label',40); if(!label) throw new ApiError(400,'Field label is required');
      const key=bounded(f.key,'field key',40) || label.toLowerCase().replace(/[^a-z0-9]+(.)?/g,(_,c)=>c?c.toUpperCase():'');
      if(!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || keys.has(key)) throw new ApiError(400,`Field "${label}" needs a unique name`);
      keys.add(key);
      return {key,label,...(f.sensitive?{sensitive:true}:{}),...(f.number?{number:true}:{})};
    });
  }
  const sla=Number(body.slaHours); if(!Number.isInteger(sla) || sla<4 || sla>336) throw new ApiError(400,'Escalation time must be 4-336 hours');
  config.slaHours=sla;
  return config;
}
// Pending requests idle at one stage past the SLA get one escalation per stage.
// In production this would run on a schedule (e.g. Power Automate hourly).
export function escalations(requests, auditLog, config, now=new Date()) {
  const last=new Map(); [...auditLog].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).forEach(a=>last.set(a.requestId,a));
  return requests.filter(r=>r.status==='Pending' && r.escalatedStage!==r.stage).flatMap(r=>{
    const since=Date.parse(last.get(r.id)?.timestamp ?? r.createdAt);
    const hours=(now.getTime()-since)/3600000;
    if(hours<config.slaHours) return [];
    const route=routeOf(r), next=route[route.indexOf(r.stage)+1] ?? 'BU Head';
    const to=next===r.stage ? 'MDM team' : next;
    return [{request:{...r,escalatedStage:r.stage,escalatedTo:to},entry:audit(r.id,'escalate','System',`No response from ${r.stage} in ${config.slaHours}h. Teams reminder sent and escalated to ${to}.`)}];
  });
}
