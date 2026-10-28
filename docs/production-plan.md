# Lives Group pilot and production plan

Planning assumptions dated 2026-10-28. The current deliverable is a synthetic React/Express prototype with local SQLite or hosted private Blob storage. Microsoft 365, SAP connectivity, business savings and production controls below are proposed work, not implemented outcomes.

## Intended operating model

A requestor creates a provisional record from a manual request or order. Expert teams complete independent sections; capabilities unlock when their prerequisites are satisfied. MDM performs the final check after required sections finish. SAP remains the operational system of record. Early quotation must use an explicitly approved provisional-record process agreed with business owners and SAP administrators.

For a Microsoft 365 production option, assess Power Apps for intake and owner work, Dataverse for tickets/sections/rules/audit, Power Automate for durable scheduling and delivery, Teams adaptive cards and Outlook digests for notifications, and Power BI for regional reporting. These choices assume suitable tenant licensing, security policies, connector access and support ownership; validate those assumptions before estimating costs or committing to the platform. The React/Express prototype is not already a Power Platform deployment.

## Integration phases

1. Agree a canonical schema and map Customer/Vendor to BusinessPartners, Product/Item to Items, and Profit Centre/Cost Center to ProfitCenters. Confirm company/entity keys, numbering, mandatory fields, tax, currency, dimensions and ownership in a SAP sandbox.
2. Begin with reviewed DTW files and an explicit import/reconciliation procedure. The current generic CSV illustrates an export boundary; it requires validated SAP templates and trial imports before operational use.
3. Add Service Layer only after approved credentials, supported connectivity, idempotency keys, retry handling, reconciliation and failure ownership exist. Store SAP identifiers and import results; do not mark a record synchronized merely because a payload was generated.

## Pilot sequence and exit criteria

Start with one entity, one market and Customer requests, then add record types and markets after process owners accept the evidence. Timeboxes and staffing should be estimated after discovery; no cost or duration here is a commitment.

| Phase | Work | Exit evidence |
| --- | --- | --- |
| Discovery | Confirm parallel unlock policy, authority matrix, mandatory data, regulatory needs, SAP mapping and provisional usage | Signed process and field mapping; business owner for every section |
| Secure foundation | Entra identity, server-verified roles, least-privilege field access, environment separation and audit retention | Positive/negative access tests using real identity claims; approved retention rules |
| Workflow pilot | Real request intake with human review; versioned rules; controlled FX source and BU reference data | Reconciled ticket sample covering returns, declines, auto-policy boundaries and final gate |
| Delivery pilot | Durable scheduler, authenticated card callbacks, queue/retry/dead-letter handling, quiet hours and delegates | Evidence of delivery, callback authorization, overdue escalation and outage recovery |
| SAP validation | DTW sandbox templates and reconciliation, followed by optional Service Layer | Imported records match approved inputs; safe retries and failure recovery demonstrated |
| Analytics validation | Reconcile canonical customers/orders, exclude enquiries, define time windows and run held-out evaluation | Reproducible source totals and forecast comparison on real eligible data |
| Operate and expand | Monitoring, support ownership, backups, restoration tests, capacity and privacy review | Runbook exercised and pilot metrics accepted before widening scope |

## Measures to collect

Baseline and pilot periods must use comparable cohorts. Exclude synthetic fixture outcomes from every business KPI.

- **Cycle time:** elapsed time from request creation to official record; report median and p90, with returned/requestor-wait time shown separately.
- **Expert response time:** elapsed time from a section becoming actionable to completion, by owner role; track returned cases separately.
- **Duplicate prevention precision:** confirmed duplicates divided by reviewed flagged candidates. Track false positives and sampled missed duplicates independently.
- **Automatic-clearance quality:** audited exceptions divided by sampled auto-cleared requests; log the policy version and FX rate used. Sampling must be designed and reviewed, not assumed effective from the prototype's deterministic sample.
- **Delivery reliability:** acknowledged deliveries and authenticated completed actions, failed/queued messages, escalation lag and scheduler health.
- **SAP quality:** successful reconciled imports divided by attempted imports, rejected records and duplicate retry incidents.
- **Forecast quality:** rolling held-out MAE and MAPE versus the same baseline; report zero-actual exclusions, coverage and series-level failures. Keep confirmed demand separate from enquiry scenarios.
- **Business effect:** measure actual delayed order release, rework effort and any realized savings from auditable operational records. “Value waiting” is exposure, not revenue saved or realized benefit.

Set numeric acceptance targets with owners after observing baseline performance; the prototype does not establish achievable improvements.

## Controls and open decisions

Production requires durable transactional storage appropriate to concurrency, environment-specific secrets, immutable or tamper-evident audit retention, backup recovery, monitored background jobs and operational support. The hosted private Blob adapter persists demo state with conflict checks; it is not an enterprise transactional database. Real identity security must replace the freely selectable persona header.

Resolve credit currencies and FX freshness, country-specific licence evidence, attachment retention, who can change rules, rule-version approval, BU onboarding, dual-control requirements and whether a returned or rejected request can be reopened. Agree which unlocks permit actual commercial activity before relying on them in SAP.

The source architecture intentionally retains React/Express and custom CSS. A Python rewrite, Tailwind conversion or full Power Platform migration requires its own business justification, parity criteria and deployment plan; none is necessary to demonstrate the parallel workflow. Full Figma frames remain a separate design handoff task. The historical executive-summary PDF should be revised separately if needed for a current external presentation.
