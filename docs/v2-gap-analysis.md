# Lives v2 brief-to-code gap analysis

Source inspection dated 2026-10-28. This matrix distinguishes implemented behavior, intentionally synthetic demonstrations and work still required. Runtime/build/browser verification is recorded separately; this document does not certify deployment or production readiness.

The primary change from MasterGraph is structural: sequential approval stages have become parallel owner sections and explicit capability unlocks. The existing React/Express application and persistence adapters were extended to preserve working behavior and hosting. The requested Python/Tailwind stack was not substituted: the implementation remains Node/Express, React/TypeScript and custom glass CSS.

| Brief area | Current implementation | Boundary / remaining work |
| --- | --- | --- |
| Create now, unlock as you go | Provisional records, quote unlock, parallel Finance/QA/RA sections, final MDM gate and official code | Official creation is local prototype state, not SAP creation |
| Nine personas | Nine seeded people across eight roles, personal tasks and persona switching | Demo header identity; production SSO and server-verified role claims remain |
| Four record classes | Customer, Product, Vendor and Profit Centre code enums; business-facing Item/Cost center labels map onto those enums | Product/Profit Centre remain wire values; validate every SAP field mapping |
| Record-specific unlocks | Vendor procurement unlocks raising a PO; Item standard cost unlocks list-price selling; Cost center Finance structure unlocks transaction posting, alongside BU review | Local capability flags, not authorization changes inside SAP |
| Expert work | Complete, return, requestor resubmission, decline, owner checks, audit; Needs you batch actions | Production attachments, evidence retention and compliance review remain |
| Policy rules | Persisted ownership, required/active flags, unlocks, credit thresholds; creation snapshots sections | Changes affect new tickets. Wizard is a narrow BU approval rule, not a full organizational onboarding system |
| BU configuration | Working scoped wizard creates a required owner section; BU-specific rule matching uses `basics.business_unit` | Free-text BU identity and duplicate handling need controlled reference data; wizard cannot provision users, entities or a new SAP company |
| Automatic clearance | Both SGD 50,000 limit and 30-day term required; synthetic currency table; licence coverage remains expert work when regulated | No live FX, credit service or regulatory verification. Unsupported currencies require review |
| Sensitive data | Non-Finance/Management response filtering for credit/bank fields and scrubbed audit values | Header can impersonate roles; no production security claim |
| Duplicate prevention | Official Customer name/registration matching, top three results at 85%+, activity evidence, explicit reuse or reason | Heuristic score, no trained matching model or source-record merge; wider record-type matching remains |
| Notifications | Bell, toast, in-app tasks, digest, settings, delegate/quiet hours, simulated Teams/Outlook state and previews | No real email/Teams send; preview buttons open application work rather than execute authenticated external card callbacks |
| SLA and escalation | Request-triggered 24/48/72-hour processing, persisted deduplication, daily nudge cap | No background worker: no traffic means no scheduled processing. Production needs durable time-based jobs |
| Analytics data | Separate synthetic fixture: 150 canonical customers plus 13 aliases, five markets, three products, twelve months | Not company data; workflow-created records do not become analytical order history automatically |
| Growth / impact | Latest six months versus previous six; confirmed-demand totals, duplicate impact and concentration views | Consolidation is an analytical preview; financial savings and real-world causal outcomes are unmeasured |
| Forecast | Six rolling holdouts; six-month average versus exponential level/trend; MAE winner, MAPE and empirical range | Zero actuals excluded only from MAPE. Short synthetic history cannot establish real accuracy, seasonality or calibrated interval coverage |
| Actionable insights | Recommendations create owner tasks that can be completed | Suggestions require human validation; task completion does not establish business impact |
| SAP | Official-record payload shape and generic DTW-style CSV download | Simulated only. CSV is not a validated B1 import template; Service Layer connectivity, retries and reconciliation remain |
| Persistence / hosting | Local SQLite; hosted dedicated private Blob snapshots with conditional writes | Snapshot conflicts require refresh/retry; enterprise concurrency, backup recovery and data lifecycle need design |
| Design handoff | Implemented responsive glass UI states | No full Figma frame set was actually created |
| Production Microsoft 365 | Architecture and pilot proposal in production plan | Power Apps, Dataverse, Power Automate, Teams connectors and Power BI are assumptions/proposals, not deployed components |

The hero ticket intentionally remains pending for Finance: THB 500,000 × 0.038 is approximately SGD 19,000, but its 60-day terms exceed 30 days. A low converted amount alone cannot clear it. Order value is separately represented in USD; it is not the credit threshold currency.

Existing graph, legacy routes and historical documents remain compatibility/context artifacts. The earlier executive-summary PDF is not evidence that the revised workflow or production architecture has shipped. Repository source is now intended for `harshitha904/dsa-comp-maybe`; the existing Vercel project name and application address remain in place. Live deployment must be verified independently after publication.
