export interface User { id:string; name:string; role:string; entity:string; country:string; settings:{digest_time:string;quiet_start:string;quiet_end:string;delegate_id:string;away:boolean} }
export interface Ticket {id:string;code:string;source:string;order_ref:string;record_type:string;record_id:string;title:string;entity:string;country:string;amount_usd:number;raised_by:string;status:string;created_at:string;product:string;units:number;auto_cleared?:boolean;waiting_on?:string[];age_hours?:number}
export interface MasterRecord {id:string;type:string;provisional_code:string;official_code:string|null;name:string;entity:string;country:string;fields:Record<string,any>;state:string;created_at:string}
export interface Section {id:string;ticket_id:string;key:string;title:string;owner_role:string;country?:string;required:boolean;status:string;fields:Record<string,any>;completed_by:string|null;completed_at:string|null;note:string;age_hours:number;at_risk:boolean;stuck:boolean;value_waiting_usd:number}
export interface Unlock {id:string;ticket_id:string;key:string;label:string;requires_sections:string[];unlocked:boolean;unlocked_at:string|null}
export interface Audit {id:string;ticket_id:string;actor:string;action:string;field:string;before:any;after:any;at:string}
export interface Duplicate {id:string;code:string;name:string;entity:string;country:string;score:number;units_12m:number}
export interface TicketDetail {ticket:Ticket;record:MasterRecord;sections:Section[];unlocks:Unlock[];audit:Audit[];duplicates:Duplicate[];sap_payload?:any}
export interface Task {id:string;ticket_id:string;ticket_code:string;title:string;section_key:string;section_title:string;owner_role:string;amount_usd:number;value_waiting_usd:number;age_hours:number;stuck:boolean;at_risk:boolean;status:string;country:string;entity:string;fields:Record<string,any>;note:string;kind?:string}
export interface Notification {id:string;user_id:string;ticket_id:string;section_key:string;kind:string;priority:string;text:string;channel:string;created_at:string;delivered_at:string|null;read:boolean;acted:boolean;delivery_status?:string}
export interface Rule {id:string;record_type:string;section_key:string;title:string;owner_role:string;unlocks_key:string;auto_policy:Record<string,any>;active:boolean;required:boolean}
export interface Digest {task_count:number;value_waiting_usd:number;oldest_hours:number;text:string;items:Task[]}
export interface WorkspaceProps {user:User;onNavigate:(ticketId:string)=>void;onChange:()=>void}
