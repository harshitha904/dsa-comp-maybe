export type Role = 'Sales'|'Finance'|'Quality'|'BU Head'|'Admin';
export const roles: Role[] = ['Sales','Finance','Quality','BU Head','Admin'];
export const roleLabel: Record<Role,string> = {Sales:'Sales',Finance:'Finance',Quality:'Quality / Regulatory','BU Head':'BU Head',Admin:'MDM team'};

// Demo role switcher only: the server reads X-Role, nothing is authenticated.
let currentRole: Role = 'Sales';
export const setApiRole = (role: Role) => { currentRole = role; };

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
 let res: Response;
 try { res = await fetch('/api' + path, {...options, headers: {'Content-Type':'application/json','X-Role':currentRole, ...options.headers}}); }
 catch { throw new Error('Cannot reach the API. Check that the server is running.'); }
 const raw = await res.text();
 let data: any;
 try { data = JSON.parse(raw); } catch { throw new Error('The API returned an incomplete response.'); }
 if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), {status: res.status, matches: data.matches});
 return data;
}
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const compact = (n: number) => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
export const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
export const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
export const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';

// Mirrors server/domain.js so the form can show the route and required fields up front.
export type RequestType = 'Customer'|'Vendor'|'Item'|'Cost Center';
export const routes: Record<RequestType, Role[]> = {Customer:['Sales','Finance','BU Head'],Vendor:['Finance','Quality','BU Head'],Item:['Quality','Finance','BU Head'],'Cost Center':['Finance','BU Head']};
export type Field = {key:string;label:string;sensitive?:boolean;number?:boolean};
export const detailFields: Record<RequestType, Field[]> = {
 Customer:[{key:'segment',label:'Customer segment'},{key:'terms',label:'Payment terms',sensitive:true},{key:'credit',label:'Credit limit (USD)',sensitive:true,number:true}],
 Vendor:[{key:'category',label:'Vendor category'},{key:'terms',label:'Payment terms',sensitive:true},{key:'bankCountry',label:'Bank country'},{key:'contact',label:'Contact person'}],
 Item:[{key:'line',label:'Product line'},{key:'uom',label:'Unit of measure'},{key:'cost',label:'Standard cost (USD)',number:true}],
 'Cost Center':[{key:'owner',label:'Owner'},{key:'unit',label:'Business unit'},{key:'budget',label:'Annual budget (USD)',number:true}]
};
export const countries = ['Singapore','Malaysia','Thailand','Indonesia','Vietnam'];
export const entities = ['SPD','QTS','QTG'];
export const countryCode: Record<string,string> = {Singapore:'SG',Malaysia:'MY',Thailand:'TH',Indonesia:'ID',Vietnam:'VN'};

export type Request = {id:string;entity?:string;type:RequestType;name:string;country:string;identifier:string;email:string;details:Record<string,string|number|boolean>;requester:string;status:'Pending'|'Approved'|'Rejected'|'Clarification';stage:string;route?:Role[];escalatedStage?:string;escalatedTo?:string;approvals:string[];createdAt:string;deadline:string;priority:number;duplicateOverride?:string};
export type Audit = {id:string;requestId:string;action:string;actor:string;timestamp:string;details:string};
export type Customer = {id:string;entity?:string;name:string;country:string;identifier:string;email:string;aliases:string[]};
export type Match = {customer:Customer;score:number;evidence:string[]};

export type Config = {routes:Record<RequestType, Role[]>; fields:Record<RequestType, Field[]>; slaHours:number};
export const defaultConfig: Config = {routes, fields:detailFields, slaHours:48};
export const routeOf = (r: Request, config?: Config) => r.route?.length ? r.route : (config ?? defaultConfig).routes[r.type];
