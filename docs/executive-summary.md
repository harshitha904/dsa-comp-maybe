# MasterGraph: Executive Summary

Source Markdown for the two-page handout. The rendered PDF is at `output/pdf/executive-summary.pdf`. All data in the prototype is synthetic. Figures are from the prototype fixture, not from a real business.

---

## Page 1 of 2

### The problem

The same customer is often entered more than once. "National University Hospital" and "NUH Singapore" can exist as separate records with different account terms. Approvals move by email, and nobody sees the duplicate, the decision trail and the downstream effect in one place.

### What MasterGraph does

MasterGraph is a working prototype that covers four steps:

1. **Prevent.** A new customer request is checked against existing customer records and against non-rejected requests of the same type before it is saved. Each match shows its evidence: an exact identifier, an exact email, an exact name or alias, or a similar name. A match at score 80 or above needs a written override justification of at least 10 characters.
2. **Investigate.** The graph explorer shows customers, products and countries with confirmed orders. A reviewer selects a record, reads its duplicate evidence and sees its place in the network.
3. **Preview.** A consolidation preview moves one record's orders into a chosen target in a read-only simulation. Combined units are conserved, and nothing is written.
4. **Approve.** Each request type follows a fixed route. A Customer request goes from Sales to Finance to BU Head. The server enforces the route, and every creation and action is written to an audit trail in UTC.

### What is in the prototype

- A React and TypeScript frontend with four working workspaces: control center, graph explorer, MDM workspace and regional intelligence. A demo and methodology page explains the boundaries.
- An Express 5 API backed by SQLite, using Node's built-in SQLite module. Data persists between runs and can be reset to the synthetic fixture.
- Server-side validation, duplicate scoring, approval routing, audit logging and redaction.
- A SAP-shaped payload for approved requests, labelled `simulated: true`. **No live SAP connection exists, and nothing is sent to SAP.**
- 34 automated tests (`npm test`).
- A synthetic fixture: five countries (Singapore, Malaysia, Thailand, Indonesia, Vietnam), three products (A, B, C), 18 customer records, and one deliberate duplicate pair.

### Access and visibility

- Customer identifiers and emails are visible to all roles, because they are synthetic.
- Bank account and credit or payment terms are restricted. Only Finance and Admin see them. Other roles see `[redacted]`.
- Audit notes are visible to all roles on purpose, so collaborators can see why a request was clarified or rejected.

### What it does not do

- It does not authenticate users. The role selector is a demo switch, not a security control.
- It does not connect to SAP, send email, or run on hosted infrastructure.
- It does not yet show a measured benefit. Section 4 of the production plan defines the pilot KPIs. None has been measured.

---

## Page 2 of 2

### Regional intelligence

The regional intelligence page uses confirmed orders only:

- **Demand trend and heatmap:** confirmed units by month and by country, with product filters.
- **Next-month forecast:** two models, compared by walk-forward backtest. The baseline is the historical average. The candidate is a linear trend fitted by ordinary least squares. A candidate is chosen only if it beats the baseline by more than a 2% margin.
- **Results vary by series.** On the current synthetic fixture, the baseline wins for the all-product view, Product A, Product B and Singapore. The linear trend wins for Product C, Thailand, Malaysia, Indonesia and Vietnam. The report shows each winner and its error, so a losing candidate is reported as a loss.
- **Risks:** declining demand, customer concentration, lapsed customers, duplicate master data and overdue requests.
- **Opportunities:** accelerating demand, unconverted enquiry and setup pipeline, and cross-sell from co-purchase patterns. Enquiry and setup signals are shown as pipeline and never counted as demand.

Risks and opportunities are derived from the same confirmed-order data as the charts, so they can be checked against the underlying numbers.

### Controls and their limits

| Control | Current behaviour | Limit |
| --- | --- | --- |
| Duplicate prevention | Enforced on the server at score 80 or above | Scores are heuristic, not probabilities |
| Approval routing | Enforced on the server by stage role | Roles come from a request header, not a login |
| Audit trail | Records creation and each action, with notes | Actor is a demo role, not a verified person |
| Sensitive fields | Bank account and credit or payment terms hidden from non-Finance roles | Restricted field list is fixed in code |
| SAP export | Simulated payload for approved requests; Finance or Admin only | No connection, credentials or reconciliation |
| Consolidation preview | Read-only; combined units conserved | Does not merge anything |

### Path to a pilot

The proposed pilot runs for six weeks in one country and one business entity, using agreed data-handling terms. Week 1 confirms the duplicate rules and baselines with business owners. Weeks 2 to 4 are supervised use. Weeks 5 and 6 measure the KPIs and review them. The pilot does not post to SAP.

**Effort and cost (planning estimate, not a quote):** 12 to 18 person-weeks at SGD 3,000 to 4,000 per person-week, giving **SGD 36,000 to 72,000**. This equals a team of two to three people for six weeks. It excludes hosting, licences, legal review and contingency. The assumptions are in `docs/production-plan.md`.

### Requests for the next step

- Agreement on the pilot country and business entity.
- Named business owners for customer and vendor master-data rules.
- Confirmation of the data-handling terms before any real record is loaded.
- Access to a SAP Business One sandbox if the pilot moves to integration.
