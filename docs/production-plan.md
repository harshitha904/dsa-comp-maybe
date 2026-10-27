# MasterGraph: Pilot and Production Plan

Planning document. Status as of 2026-10-28. All effort and cost figures are **illustrative planning estimates, not quotes**. They are not based on any vendor price list. Replace the rate assumptions with your own rate card before using them for approval.

## 1. Starting point

The working prototype is described in `README.md`. In summary:

- Working in the prototype: duplicate check at intake, graph explorer, approval routing with audit trail, read-only consolidation preview, simulated SAP payload, regional analytics with forecast backtest, and 34 passing automated tests.
- Not in the prototype: authentication, live SAP connection, hosting, a production database, and any measured results.

The plan is staged. A six-week pilot comes first and produces the evidence needed to size a production build. Production work beyond the pilot is **not estimated here**.

## 2. Six-week pilot

### Scope

- One country and one business entity, chosen by the business.
- Customer and vendor requests, and the approval routes in `README.md`.
- Data-handling terms agreed before any real record is loaded. Until then, the pilot uses synthetic or fixture data only.
- No SAP writes. The simulated payload is used to check mapping, and any integration decision is recorded for later.
- The pilot hosts the prototype in an environment the business chooses. Hosting is not selected here.

### Week-by-week

| Week | Work | Output |
| --- | --- | --- |
| 1 | Confirm pilot country, entity, data-handling terms and steward owners. Record current-process baselines for the KPIs in section 4. | Signed scope note; baseline sheet |
| 2 | Business rules workshop: duplicate evidence, override policy, approval routes, restricted fields. Configure the pilot environment. | Agreed rule sheet; running pilot instance |
| 3 to 4 | Supervised use by request owners and stewards. Log every flagged match and steward decision. Fix defects found in use. | Review log; defect list |
| 5 | Pull KPI data from audit records, analytics and the review log. Check the KPI definitions against what was captured. | KPI data pack |
| 6 | Readout to business owners. Decide: extend, change scope, or stop. | Decision record |

### Exit criteria for the pilot

Thresholds are set by the business in week 1. None is set here. The pilot is judged on whether each KPI in section 4 was measured, and whether the decision at week 6 follows from the measured values.

## 3. Effort and cost assumptions

### Basis

- **Pilot effort:** 12 to 18 person-weeks.
- **Team:** two to three people for six weeks. Two people for six weeks is 12 person-weeks. Three people for six weeks is 18 person-weeks.
- **Rate assumption:** SGD 3,000 to 4,000 per person-week, blended, fully loaded. This is a planning assumption, not a quote, and not a vendor price.

### Estimate

| Item | Low | High |
| --- | --- | --- |
| Effort (person-weeks) | 12 | 18 |
| Rate assumption (SGD per person-week) | 3,000 | 4,000 |
| **Planning estimate (SGD)** | **36,000** | **72,000** |

Formula: person-weeks × rate per person-week. Each person-week added or removed moves the estimate by SGD 3,000 to 4,000.

### Effort split inside the 12 to 18 person-weeks

| Activity | Person-weeks (low to high) |
| --- | --- |
| Pilot setup, rules workshop and data-handling checklist | 1 to 2 |
| Pilot hardening: environment, configuration, backups, logging | 3 to 4 |
| Pilot support: steward review, defect fixes, user questions | 4 to 6 |
| Measurement and readout | 2 to 3 |
| Coordination and reporting | 2 to 3 |
| **Total** | **12 to 18** |

### Not included in the estimate

- Hosting and cloud usage. Obtain from the chosen provider's own calculator.
- Software licences, including any single sign-on and monitoring tools.
- SAP Business One sandbox access and any SAP-side consultant time.
- Legal and privacy review of the data-handling terms.
- Business-side time for steward review and data preparation. Estimate it separately with the business.
- Taxes, travel and contingency. Add these according to your own policy.

### After the pilot

A production build is a separate decision. It would be estimated from pilot evidence, not from this document. Likely cost drivers, to check during the pilot, are:

- Identity and role model, if the business needs per-person accountability
- Production database and migration from the current JSON-document store
- Live SAP integration: mapping, idempotency, error handling and reconciliation
- Hosting, backup, support and security review

## 4. Pilot KPIs

Each KPI has a definition, a data source and a measurement method. The baseline is recorded in week 1 from the current process. **No KPI has been measured or achieved.** The prototype's fixture data is not evidence for any of them.

| # | KPI | Definition | Data source | Measured by |
| --- | --- | --- | --- | --- |
| K1 | Intake duplicate flag rate | Customer requests with a match at score 80 or above, divided by all Customer requests submitted | Request records (`duplicateOverride` present) and duplicate responses | Pilot team, weekly |
| K2 | Duplicate precision | Flagged matches the steward confirms as the same entity, divided by flagged matches the steward reviews | Steward review log (manual, kept during the pilot) | Steward and pilot team |
| K3 | Override rate and quality | Overrides divided by flagged submissions; share of overrides the steward disagrees with on review | Request records and steward review log | Steward |
| K4 | Approval cycle time | Median hours from `created` to `Approved` per request type | Audit records (timestamps) | Pilot team, weekly |
| K5 | Rework rate | Share of requests with at least one clarify or reject; mean resubmissions per request | Audit records (actions) | Pilot team, weekly |
| K6 | SAP payload readiness | Share of approved requests whose simulated payload builds without error | Responses from `GET /api/requests/:id/sap` on each approved request | Pilot team, per approval |
| K7 | Forecast accuracy against baseline | Per series: held-out error (MAE) of the selected model, and of the baseline; count of series where the linear-trend candidate beats the baseline | Backtest section of `/api/analytics` | Pilot team, at week 5 |
| K8 | Open duplicate-data risk | Count of open duplicate master-data risks per country, tracked weekly | Analytics risks output | Pilot team, weekly |
| K9 | Adoption by role | Audit actions per role per week, and number of roles active | Audit records (actor) | Pilot team, weekly |

Notes on the measurements:

- **K1 and K2** are the core test of prevention. A high flag rate with low precision creates review burden. A low flag rate may mean the rules miss real duplicates. Both need to be read together.
- **K4** depends on audit timestamps. Approval times include waiting time for people, so report it as a cycle time, not as a measure of reviewer speed.
- **K7** uses short histories, and the number of backtest points is small. Report the error and the count, and do not extrapolate beyond the pilot's data.
- **K9** counts actions by role because the prototype does not identify people. Per-person adoption needs an identity model first.

## 5. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Heuristic duplicate scores generate false positives | Reviewers lose trust and override too often | Measure K2 and K3 from week 3; adjust rules at the week 4 review |
| Pilot data is loaded before terms are agreed | Compliance exposure | Gate real data behind the week 1 data-handling sign-off |
| No authentication during the pilot | Roles can be spoofed | Keep the pilot inside an environment the business controls; plan identity for production |
| SAP sandbox access arrives late | Integration decision is delayed | Pilot does not depend on SAP; K6 checks mapping only |
| Forecast over-read on short history | Wrong planning decisions | Report errors and counts (K7); state the limit in the readout |
| Scope creep into production features | Pilot slips past six weeks | Hold scope at the week 1 scope note; log requests for later |

## 6. Dependencies on the business

- A named pilot country and business entity.
- Named steward owners for customer and vendor master data, with time allocated.
- Agreed data-handling terms before real records are loaded.
- A decision on where the pilot runs.
- SAP sandbox access, only if the pilot moves toward integration.

## 7. Related documents

- `README.md`: final-state behaviour, scripts, data and reset, roles and redaction
- `docs/executive-summary.md`: two-page summary, with the same cost basis
- `docs/demo-script.md`: 2 to 3 minute narrated demo and API fallback
