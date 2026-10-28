# MasterGraph: 2–3 Minute Demo Script

Narration is written to be read aloud. Timings are targets; the whole run is about 3:00. All data is synthetic.

## Before you record

```bash
npm install
npm run dev
```

1. Open http://127.0.0.1:5173. It opens on **Request**.
2. Click **ⓘ** (top right), then **Reset demo data**. This also restores the default rules.
3. Set **Acting as** (top right) to **Sales**.
4. Rehearse once: the Request scene now has two sample emails.

Numbers quoted below are from the current seed. If yours differ, read what is on screen.

---

## Scene 1: Request – sort the email, stop duplicates (0:00–0:40)

**Do:** Type **National University Hosp** in the search box.

> "A requester searches first, and finds this hospital already exists twice, under two names."

**Do:** Click **Or paste a request email**, **Sample: Order**, **Read email**.

> "Emails still work. This one has a PO number and quantities, so it's an order: it counts as demand and never reaches the MDM team."

**Do:** Click **Sample: Setup**, **Read email**, **Fill the form**, then **Submit request**. It opens Track.

> "This one asks for a new customer, so the form fills itself, shows who approves it, and keeps credit terms Finance-only."

---

## Scene 2: Track – status, Teams and escalation (0:40–1:15)

**Point at** the yellow banner and the **Escalated** count.

> "Three older requests got no reply in 48 hours, so the system already reminded the approver in Teams and escalated them. Nobody had to chase."

**Point at** the progress bar on Saigon Heart Clinic.

> "Amy's question, 'where is my request?', is answered here: who has it, for how long, and when it's due."

**Do:** Click **Approve as Sales**. Click **Teams card**, then **Approve** in the card.

> "Approvers don't need to open another tool. Finance gets this card in Teams and approves from there."

**Do:** Click **Teams card** again and **Approve** as BU Head. Switch **Acting as** to **Finance**, click **Send to SAP B1**, then close the window.

> "Every step is in the history. Once approved, it goes to SAP B1 with no retyping. Here the call is simulated."

---

## Scene 3: Rules – change the process without IT (1:15–1:35)

**Do:** Open **Rules**. Switch **Acting as** to **MDM team**. Click **Example: add a new business unit**, then **Save rules**.

> "Marcus's new unit sells to licensed labs. The MDM team adds a licence field and a Quality check themselves, with no IT ticket. New requests pick it up immediately, and requests already in flight keep their route."

---

## Scene 4: Graph – fix existing duplicates (1:35–1:50)

**Do:** Open **Graph**. Click **Merge into NUH Singapore**.

> "Existing duplicates show as orange lines. A read-only merge preview: 18 records become 17 and no units are lost or counted twice."

---

## Scene 5: Regional view – demand, forecast, actions (1:50–2:30)

**Do:** Open **Regional view**. Point at the bubble map.

> "Confirmed orders only, five countries, 12 months. Size is volume, colour is three-month growth: Malaysia is down by half, Vietnam is up 18%."

**Do:** Scroll to *Which forecast is more accurate?*

> "Instead of one moving average, we test three methods on the last six months for each country and use the most accurate. Here Holt's smoothing wins overall; Singapore keeps the simple average."

**Do:** Scroll to *Early warning*.

> "And we catch drop-off early: Selangor is still ordering but down 20%. Call them before they stop, like Johor already has."

---

## Scene 6: Impact (2:30–2:50)

**Do:** Open **Impact**. Scroll down to *Cost and payback*.

> "Amy's request took 18 days by email; here it's about three and a half. On our assumptions that's around S$35,000 a year in staff time, paying back a small pilot in about 16 months. Lives Group can drag in their own numbers."

---

## Close (2:50–3:00)

> "Clean master data at the start, approvals in Teams, and regional insight on top. Next step: a one-country pilot."

---

## Likely questions

**How does escalation work in production?**
A scheduled flow (for example Power Automate, hourly) runs the same check. Here it runs when Track opens.

**Is the email sorting AI?**
It's rule-based on purpose: every label shows the phrases that triggered it, so the MDM team can trust and correct it. A language model could replace the rules later behind the same screen.

**Why not just use the newest forecasting model?**
Because it isn't always better. Each country's model must beat the simple average on months it hasn't seen. Singapore stays on the average because nothing beat it.

**Are the Impact numbers measured?**
No. The 18 days comes from the brief; MasterGraph timing assumes each approver acts within a day. Savings use the assumptions on the sliders. The pilot would measure them.

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
