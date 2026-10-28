# Order tickets v2 implementation contract
Preserve current React/Vite + Express + local SQLite / hosted private Blob persistence. All new routes /api. Keep legacy graph/analytics endpoints and existing tests. New workflow stored as a `workflow` collection with single id `lives-v2` document (users, tickets, records, sections, unlocks, audit_log, rules, notifications, tasks). Migrate missing collection lazily, preserving existing records. Backend owns implementation of durable initialization. New analytics independent deterministic fixture exposed through workflow router. No live SAP/email/auth claims.

## Shared frontend contract
`src/tickets/types.ts` and `src/tickets/api.ts` owned by parent. `ticketApi(path,userId,options)` sends X-User-Id; JSON API errors throw Error with `details` payload. All timestamps ISO. Roles: Sales, Product Manager, Procurement, Finance, QA/RA, BU Head, MDM, Management. IDs amy, marcus, somchai, kenji, wei, nurul, daniel, priya, management.
User: {id,name,role,entity,country,settings:{digest_time,quiet_start,quiet_end,delegate_id,away}}.
Ticket: {id,code,source,order_ref,record_type,record_id,title,entity,country,amount_usd,raised_by,status,created_at,product,units,auto_cleared?}.
Record: {id,type,provisional_code,official_code,name,entity,country,fields,state,created_at}.
Section: {id,ticket_id,key,title,owner_role,country?,required,status,fields,completed_by,completed_at,note,age_hours,at_risk,stuck,value_waiting_usd}; status pending/done/auto/returned/not_required. Done includes auto/not_required.
Unlock: {id,ticket_id,key,label,requires_sections,unlocked,unlocked_at}.
Audit: {id,ticket_id,actor,action,field,before,after,at}.
TicketDetail: {ticket,record,sections,unlocks,audit,duplicates:[],sap_payload?}.
Task: {id,ticket_id,ticket_code,title,section_key,section_title,owner_role,amount_usd,value_waiting_usd,age_hours,stuck,at_risk,status,country,entity,fields,note,kind?}.
Notification: {id,user_id,ticket_id,section_key,kind,priority,text,channel,created_at,delivered_at,read,acted,delivery_status?}.
Rule: {id,record_type,section_key,title,owner_role,unlocks_key,auto_policy,active,required}; auto_policy object.

GET /users -> User[]
GET /tickets?status=&role= -> Ticket[] (include waiting_on array and age_hours)
GET /tickets/:id -> TicketDetail (id or code e.g T-1042)
POST /tickets {record_type,source,order_ref,name,entity,country,amount_usd,product,units,basics:{...},raised_by?,duplicate_choice?,duplicate_reason?,existing_record_id?} -> TicketDetail. duplicate unresolved returns409 {error,candidates,ticket_id?}. No new record until resolved. 
POST /tickets/duplicate-check {name,registration_number?} -> {candidates:[{id,code,name,entity,country,score,units_12m}]}
POST /tickets/:id/confirm-new {reason} -> TicketDetail
POST /tickets/:id/use-existing {record_id} -> TicketDetail
POST /tickets/:id/sections/:key/complete {fields,note?} -> TicketDetail
POST /tickets/:id/sections/:key/return {reason} -> TicketDetail
POST /tickets/:id/sections/:key/decline {reason} -> TicketDetail
POST /tickets/:id/nudge {section_key} -> {ok:true}
POST /tickets/:id/official -> TicketDetail (MDM only; Management read-all does not bypass expert actions)
GET /tickets/:id/sap-payload -> envelope {simulated:true,phase,resource,payload}
GET /exports/dtw.csv -> CSV string
GET /users/:id/tasks and /waiting -> Task[]
GET /users/:id/notifications -> Notification[]
GET /users/:id/digest -> {task_count,value_waiting_usd,oldest_hours,text,items:Task[]}
PUT /users/:id/settings {digest_time,quiet_start,quiet_end,delegate_id,away} -> User
POST /notifications/:id/read -> {ok:true}
GET /alerts -> alerts[]
GET /rules -> Rule[]; PUT /rules/:id partial Rule -> Rule; POST /rules -> Rule (MDM/Management only).
POST /demo/reset -> {ok:true} resets v2 seed, preserve append-only audit by append reset event (no deleting prior audit).
POST /analytics/actions/:id/task -> {ok:true,task} converts recommendation to assigned in-app task (backend coordinate with analytics export).

## Hero requirements
T-1042 default Management; Bangkok Central Lab, QTS Thailand, order PO-5521,200 Product B,$48000,Somchai. Customer credit THB500000/60 days (do NOT compare raw THB to SGD threshold; use documented synthetic FX). Bundled regulated item Thailand licence. basics done, credit_terms Finance pending, licence_TH QA/RA pending, final_check MDM pending (but blocked until experts complete). quote ready; sell_on_credit, deliver_in_Thailand,official_record locked. Finance and QA independently parallel. MDM notification/task ONLY when all expert required sections done. Approval4step view 1created,2experts,3official,4complete. final_check completed through official action. Each requestor notified completion. Only own role can action; masked bank/credit other roles. Deterministic10% sample lowrisk final check; MDM official gate always.

## Ownership
Backend agent: server/ticket-engine.js, ticket-seed.js, ticket-routes.js, tests/tickets.test.js; modify server/db.js,index.js,blob-store.js for integration.
Analytics agent: server/ticket-analytics.js,server/ticket-analytics-seed.js,tests/ticket-analytics.test.js,src/tickets/Insights.tsx,Insights.css. Export buildRegional(),buildDuplicateImpact(),buildForecast({country,product}),buildActions(),getAnalyticsFixture(). Backend imports for routes. Agent chooses exact analytics response; UI owned same agent.
Hero agent: src/tickets/TicketPage.tsx,TicketPage.css,NeedsYou.tsx,NeedsYou.css. Props TicketPage {user:User,ticketId:string,onChange:()=>void,onNavigate:(ticketId:string)=>void}; NeedsYou same except ticketId omitted. Shared api/types parent. TicketPage fetch own data, refresh on user/ticket props; call onChange after mutation, show own toast. NeedsYou task fetch, expand form, actions. Export default each.
Workspace agent: src/tickets/NewRequest.tsx,TicketsList.tsx,Rules.tsx,Workspace.css. Props {user:User,onNavigate:(ticketId:string)=>void,onChange:()=>void}. Own API fetch/actions. No global files.
Parent: App.tsx/styles.css shell,shared API/types, notifications/persona UI,docs/deploy/integration.
