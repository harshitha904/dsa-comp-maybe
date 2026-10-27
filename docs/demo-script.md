# MasterGraph: 2–3 Minute Demo Script

Narration is written to be read aloud. Timings are targets; the whole run is about 2:45. All data is synthetic.

## Before you record

```bash
npm install
npm run dev
```

1. Open http://127.0.0.1:5173. It opens on **Request**.
2. Click the **ⓘ** button (top right), then **Reset demo data**.
3. Set **Acting as** (top right) to **Sales**.

Numbers quoted below are from the current seed. If yours differ, read what is on screen.

---

## Scene 1: Request – stop duplicates at the start (0:00–0:45)

**Show:** the Request screen, "What do you need set up?"

> "Today a new customer starts as a free-text email, and nobody checks whether the customer already exists. In MasterGraph, the requester searches first."

**Do:** Type **National University Hosp** in the search box.

> "Before anything is created, it finds National University Hospital and NUH Singapore, the same hospital under two names. The requester picks the existing record instead of creating a third one."

**Do:** Click **Or paste a request email**, then **Use sample**, then **Fill the form**.

> "If the request is still an email, they paste it. The fields are pulled out automatically, and the requester checks them."

**Point at** the **Approval route** panel and a **Finance only** field.

> "They can see who approves it before they submit: Sales, Finance, BU Head, a final MDM check, then SAP B1. Payment terms and credit limit are Finance-only."

**Do:** Click **Submit request**. It opens Track.

---

## Scene 2: Track – everyone sees where it is (0:45–1:30)

**Show:** the progress bar on Saigon Heart Clinic.

> "This answers Amy's question from the brief: where is my request? It's with Sales, it's been waiting since today, and it's due on the needed-by date. Slow approver? Nudge them in Teams."

**Do:** Click **Approve as Sales**. Switch **Acting as** to **Finance**.

> "Now it's in Finance's *Waiting on me* list, and only Finance sees the credit terms."

**Do:** Approve as **Finance**. Switch to **BU Head** and approve. Switch back to **Finance**.

> "Every step is in the history: who approved, and when."

**Do:** Click **Send to SAP B1**.

> "Once approved, it goes to SAP B1 in the Service Layer format, with no retyping. Here the call is simulated."

**Do:** Close the payload window.

---

## Scene 3: Graph – fix the duplicates you already have (1:30–1:55)

**Do:** Open **Graph**. National University Hospital is selected.

> "Duplicates that already exist show up as orange dashed lines. NUH Singapore matches National University Hospital on tax ID, email and name."

**Do:** Click **Merge into NUH Singapore**.

> "The merge preview is read-only. It goes from 18 customer records to 17, and 25 orders move over without losing or double-counting any units."

---

## Scene 4: Regional view – demand, forecast, actions (1:55–2:35)

**Do:** Open **Regional view**.

> "Confirmed orders for Products A, B and C, five countries, 12 months. Enquiries and setup requests are kept out of demand."

**Point at** the country × product table.

> "Growth is the last three months against the three before. Malaysia stands out: Products A and B are down by more than half."

**Point at** *Which forecast is more accurate?*

> "Instead of assuming one forecast method, we test both on the last six months. Here the simple average was slightly more accurate than the trend, so it's used."

**Point at** *What to do next.*

> "Each signal comes with an action: call the Malaysian customer who stopped ordering, cut the dependence on one big buyer in Thailand, and offer Product B to customers who only buy Product A."

---

## Scene 5: Close (2:35–2:45)

> "One flow, from request to approval to SAP to regional insight, built on clean master data. It's a prototype: sign-in, live SAP and seasonal forecasting come next, in a one-country pilot."

---

## Likely questions

**Is the role switch real sign-in?**
No. It shows the server enforcing each approval stage. Production would use Microsoft 365 single sign-on.

**How is the duplicate score calculated?**
Rules, not a trained model. An exact identifier scores 100, an exact email 95, an exact name or alias 90, and a similar name up to 85. At 80 or above, the requester must write a reason to continue.

**Does it talk to SAP?**
Not yet. The payload is in the SAP B1 Service Layer format but marked simulated. A live link needs a sandbox and credentials.

**Why does the simple average win?**
The synthetic history is only 12 months and fairly flat. The point is the method: both models are scored on held-out months, and the more accurate one is used for each series.

**What would the pilot prove?**
Fewer duplicate records, a shorter approval cycle, and whether the chosen forecast beats the current average on real data. None of these has been measured yet.

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
