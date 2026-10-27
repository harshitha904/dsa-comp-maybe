# MasterGraph: 2–3 Minute Narrated Demo Script

Narration is written to be read aloud. Timings are targets. Keep the whole demo under three minutes. Use only synthetic data.

## Before you record

```bash
npm install
npm run dev
```

1. Open http://127.0.0.1:5173.
2. Click **Reset demo data** in the sidebar, so the fixture and requests start from the seed.
3. Keep Finance and Admin ready for approvals. The role switch ("Acting as") is at the top of the MDM workspace.

**Fallback if the browser is unavailable:** run the same story with the API (see the end of this script). It needs `jq`.

---

## Scene 1: Control center (0:00–0:20)

**Show:** Control center tiles and the regional country strip.

> "This is MasterGraph, a prototype for keeping customer and vendor master data clean. The tiles summarise confirmed purchase volume, connected customer records, requests waiting for action, and enquiry or setup signals that we keep out of the forecast. Everything here is synthetic, so no real customer is involved."

---

## Scene 2: Graph explorer and duplicate evidence (0:20–0:55)

**Do:** Open **Graph explorer**. Select **National University Hospital** (c1) from the record picker.

> "The graph shows customers, products and countries from confirmed orders. The record inspector shows the customer's identifier, email and aliases. These identifiers are synthetic and visible to every role."

**Point at** the duplicate evidence panel.

> "The panel shows **NUH Singapore** with a score of 100, because the identifier and email match exactly. The score is rule-based evidence, not a probability. A person still decides what to do with it."

**Do:** Click **Use as simulation target** on NUH Singapore, then **Simulate consolidation**.

> "This is a preview only. It moves source orders to the target in memory. Combined units stay the same, and nothing is written. The simulation says so explicitly."

---

## Scene 3: Prevent a duplicate, then approve (0:55–1:50)

**Do:** Open **MDM workspace**. Start a new **Customer** request with:

- Name: NUH Singapore
- Country: Singapore
- Identifier: SG-NUH-001
- Email: procurement@nuh.example
- Requester: Demo Sales
- Customer segment: Direct account
- Payment terms: Net 30
- Requested credit limit (USD): 25000

**Show:** the duplicate warning before submission.

> "Before the request is saved, the system checks it against existing customers and against requests that have not been rejected. It finds an exact match on identifier and email, so it asks for a written reason. This is prevention at intake, not clean-up after the fact."

**Do:** Enter an override of at least ten characters, for example "Separate legal entity, confirmed with procurement." Submit.

> "The override is recorded on the request, with the actor and time in the audit trail."

**Do:** Approve the request as the stage role, then as Finance, then as BU Head. Use **Admin** for a quick pass if you need to.

> "Approvals are enforced by the server. Each stage has a required role. When I switch to a different role and try to approve out of turn, the server refuses it."

**Do:** Switch to **Quality** and try to approve a Sales-stage request. Show the refusal message.

**Do:** Once the request is approved, switch to **Finance** and download the SAP payload.

> "This is a Business One Service Layer shape, marked simulated. It contains the business partner fields we would map. Nothing is sent to SAP. Only Finance and Admin can produce it."

**Point at** the restricted fields.

> "Payment terms and credit limits are hidden from roles outside Finance. Switch to Sales and they show as redacted. Clarification and rejection notes stay visible to every role on purpose."

---

## Scene 4: Regional intelligence (1:50–2:30)

**Do:** Open **Regional intelligence**. Show the demand trend, then the country heatmap. Select one country, for example **Vietnam**, then return to all markets.

> "This page uses confirmed orders only. Enquiries and setup signals are shown as pipeline and are never counted as demand."

**Do:** Open the forecast check for the all-market view, then open the detail for a second country and read its next-month forecast.

> "We compare two models on held-out months. The baseline is a historical average. The candidate is a linear trend. The system chooses a model only when it beats the baseline by more than a fixed margin."

> "The result differs by series. On the current synthetic data, the baseline wins for the all-market view and Singapore. The linear trend wins for Vietnam and Malaysia. We show each winner and its error. A candidate that loses is reported as a loss."

**Do:** Scroll to **Risks and opportunities**. Read one risk and one opportunity.

> "Risks include declining demand and customer concentration. Opportunities include accelerating demand and cross-sell from co-purchase patterns. They are generated from the same numbers as the charts."

---

## Scene 5: Close (2:30–2:50)

> "What you saw is a working prototype with server-side rules, an audit trail and a simulated SAP handoff. What it does not have yet is authentication, a live SAP connection, hosting or measured results. The proposed next step is a six-week pilot in one country and one entity, with success measured by the KPIs in the production plan. Nothing in this demo is a measured outcome."

---

## Likely questions

**Is the role switch authentication?**
No. It is a demo header that shows the server enforcing workflow rules. Any client can send any role. Production needs single sign-on and server-verified identity.

**How is the duplicate score calculated?**
Rules, not a trained model. An exact identifier scores 100, an exact email 95, an exact name or alias 90, and a similar name up to 85. Matches at 80 or above need an override. Scores are not probabilities, and the pilot would measure how often flagged matches are confirmed.

**Does MasterGraph talk to SAP?**
No. The export is a payload shape, marked simulated. Live integration needs sandbox access, credentials, idempotency and reconciliation.

**Why do the forecast models disagree?**
They fit different series. The report chooses per series and shows the error. The synthetic history is short, so the backtest shows the method, not real accuracy.

**What would the pilot prove?**
Whether duplicate prevention is precise enough to trust, whether approval cycle time falls, and whether the forecast beats the baseline on the pilot's own data. The pilot would measure each, and the production plan defines them. None has been measured yet.

---

## Fallback: API-only run (about 90 seconds)

Requires the API on port 3001 (`npm run dev` or `npm start`) and `jq`. Run these against a database you have just reset.

```bash
# 1. Duplicate evidence for NUH Singapore
curl -s -X POST localhost:3001/api/duplicates -H 'Content-Type: application/json' \
  -d '{"name":"NUH Singapore","identifier":"SG-NUH-001","email":"procurement@nuh.example","type":"Customer"}' \
  | jq '.matches[0] | {name:.customer.name, score, evidence}'

# 2. Forecast models and selection for the all-market view
curl -s localhost:3001/api/analytics -H 'X-Role: Finance' \
  | jq '.views.all.forecast | {baselineModel, candidateModel, selected}'

# 3. Approve the seeded Cost Center request as Admin (its route ends at BU Head)
curl -s -X POST localhost:3001/api/requests/REQ-1004/action \
  -H 'Content-Type: application/json' -H 'X-Role: Admin' -d '{"action":"approve"}' \
  | jq -c '{status,stage,approvals}'

# 4. Simulated SAP payload: Finance allowed, Sales refused
curl -s localhost:3001/api/requests/REQ-1004/sap -H 'X-Role: Finance' \
  | jq -c '{simulated,system,entitySet}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/requests/REQ-1004/sap -H 'X-Role: Sales'

# 5. Consolidation preview: no records change
curl -s -X POST localhost:3001/api/simulate -H 'Content-Type: application/json' \
  -d '{"sourceId":"c1","targetId":"c2"}' | jq -c '{before,after,totalQuantity}'
```

Expected results, as checked against a local API on a fresh database:

- Step 1 returns NUH with score 100, evidence "Exact identifier" and "Exact email".
- Step 2 returns the baseline and linear-trend model names, with `selected: "baseline"` on the current fixture.
- Step 3 returns `status: "Approved"`.
- Step 4 returns `simulated: true` with `entitySet: "ProfitCenters"`, and `403` for Sales.
- Step 5 returns the before and after counts. Customer count drops from 18 to 17 in the response only.

These are the expected results for the current code. They are not a recorded browser run.
