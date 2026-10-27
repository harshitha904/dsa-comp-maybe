# Backend integration notes

The API runs on port 3001 and persists records in `data/mastergraph.sqlite` (override with `DB_PATH`). `npm start` also serves the built `dist` frontend. Node 24 is required for built-in SQLite. Reset restores the enriched fixture; existing databases retain their data until an explicit reset.

## Demonstration roles
`X-Role` selects Sales, Finance, Quality, BU Head or Admin; missing headers default to Sales. This is a demonstration role mechanism, not authentication. Identifiers and emails in the synthetic dataset remain available for matching. Structured bank-account, payment-term and credit fields are redacted outside Finance/Admin. Operational fields remain visible to Quality. Workflow notes and override justifications are visible to collaborators so they can respond to clarification; sensitive financial values belong in the restricted structured fields rather than free text. SAP export requires Finance/Admin.

## Request contract
Creation accepts `type`, `name`, `country`, `requester`, `identifier`, `email`, `details`, optional `priority` (1 Low, 2 Normal, 3 High), `deadline` and `duplicateOverride`. Name, country and requester are always required. Identifier/email are required for Customer/Vendor. Dynamic required fields are Customer segment/terms/credit; Vendor category/terms/bankCountry/contact; Item line/uom/cost; Cost Center owner/unit/budget. Supported countries: Singapore, Malaysia, Thailand, Indonesia, Vietnam.

`details` is stored and returned as an object of scalar values. Legacy labelled text is accepted on input only. Invalid or empty values and excessively long strings are rejected. Known simulated SAP mapping constraints are checked on creation before approval.

Duplicate matching compares identifiers, email, normalized names/aliases and edit-distance similarity. Customer candidates include master customer records and request history; other types use non-Rejected requests of the same type. Matches scoring 80+ require an override justification of at least 10 characters. Scores are heuristic, not probabilities. Request-history matches preserve the `matches[].customer` shape but are not graph customer nodes. Conflict responses include `error` and `matches`.

## Workflow
Customer: Sales → Finance → BU Head. Vendor: Finance → Quality → BU Head. Item: Quality → Finance → BU Head. Cost Center: Finance → BU Head. Only the current stage role or Admin may approve, clarify or reject a Pending request. Clarification/rejection require a note. Sales/Admin may resubmit Clarification/Rejected requests with a note; routing restarts and earlier approvals are cleared. Actions and creation are atomically persisted with UTC audit events. Resubmission currently supplies a clarification note, not a field-edit form.

## Simulation and analytics
`POST /api/simulate` previews source-to-target customer reconciliation without writing any data. It reports customer count, affected source order count and combined quantity across **all signals**. The graph and demand forecasts use **confirmed orders only**; the UI labels this difference.

`GET /api/analytics` calls `buildAnalytics({customers,products,orders,requests,audit})` from `server/analytics.js`. Its payload and methodology are documented in analytics-notes.md. The seed contains 18 customer records (including one deliberate NUH pair), 12 months from October 2025 through September 2026, three products, five countries and four workflow requests. Queue deadlines are relative to fixture creation/reset; purchase history is deterministic.

## SAP boundary
Approved records export a simulated Service Layer envelope for `BusinessPartners`, `Items` or `ProfitCenters`. No external call occurs. Production needs tenant-specific field mappings, code allocation, authentication, idempotency, retries and reconciliation. The prototype does not create real SAP masters or merge customers. Non-customer reference masters are represented by request history rather than dedicated master collections.
