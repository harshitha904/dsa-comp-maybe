# MasterGraph

MasterGraph is a local prototype for regional master-data control. It checks new customer requests for duplicates before they are saved, shows customer and product relationships as a graph, routes requests through role-based approvals with an audit trail, previews a customer consolidation without changing data, exports approved requests as a simulated SAP Business One payload, and reports regional demand, forecast, risks and cross-sell candidates.

All data is **synthetic**. Customers, orders, requests and outcomes are illustrative. The app sends nothing to external systems.

## What is in the prototype

| Area | Where | What it does |
| --- | --- | --- |
| Control center | `src/App.tsx` | Summary tiles for confirmed units, customer records, pending requests and kept-out signals |
| Graph explorer | `src/components/Intelligence.tsx` | Customer, product and country graph; record inspector; duplicate evidence; read-only consolidation preview |
| MDM workspace | `src/components/Requests.tsx` | Request intake with duplicate check, approval actions, audit history, simulated SAP payload download |
| Regional intelligence | `src/components/Analytics.tsx` | Demand trend, country heatmap, country detail, next-month forecast, forecast accuracy check, risks and opportunities |
| Demo and methodology | `src/App.tsx` | Walkthrough and stated prototype boundaries |
| API | `server/index.js` | Express 5 routes listed below |
| Domain rules | `server/domain.js` | Duplicate scoring, request validation, approval routing, redaction, simulated SAP payload |
| Analytics | `server/analytics.js` | Demand totals, growth windows, forecast backtest, risk and opportunity rules, co-purchase |
| Storage | `server/db.js` | SQLite through Node's built-in `node:sqlite` |
| Synthetic fixture | `server/seed.js` | Five countries, three products, 18 customer records, 415 orders, four seeded requests |

## Requirements

- Node.js 24. Developed and tested on Node v24.21.0 with npm 11.19.0. `package.json` has no `engines` field.
- No external services, accounts or API keys.

## Install and run

```bash
npm install
npm run dev
```

- UI: http://127.0.0.1:5173 (Vite)
- API: http://127.0.0.1:3001 (Vite proxies `/api` to it)

`npm run dev` starts `node --watch server/index.js` and Vite together.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with file watching on port 3001, and Vite on port 5173 |
| `npm test` | Runs `node --test tests/*.test.js` (34 tests) |
| `npm run build` | Runs `tsc -b`, then `vite build` into `dist/` |
| `npm start` | Runs the API on port 3001 (set `PORT` to change it) and serves `dist/` as the UI |

`npm start` serves the UI from `dist/`, so run `npm run build` first if you want the UI from that command.

## Data location, seeding and reset

- **File:** `data/mastergraph.sqlite` in the project root. Set `DB_PATH` to use another file. The `data/` folder is gitignored and created on start.
- **Structure:** one `records` table with `(collection, id, value)`. Collections are `customers`, `products`, `orders`, `requests` and `audit`. Values are JSON.
- **First start:** if the table is empty, the server seeds the synthetic fixture from `server/seed.js`. The current seed produces 18 customers, 3 products, 415 orders and 4 requests.
- **Reset** restores the fixture and deletes all records, including requests and audit entries. Either:
  - Sidebar **Reset demo data** in the UI, which sends `POST /api/reset` with `X-Role: Admin`.
  - `POST /api/reset` directly. This endpoint does not check the role.
- **Seed changes do not migrate.** A database file created before a seed change keeps its old records until you reset or delete `data/mastergraph.sqlite`.
- **Synthetic identifiers:** customer identifiers use `DEMO-n` or the synthetic codes in `seed.js`. Emails use `.example` or `.test` domains.

## Demo roles (not authentication)

Requests carry an `X-Role` header with one of `Sales`, `Finance`, `Quality`, `BU Head` or `Admin`. A missing header is treated as `Sales`.

- The header is a demo selector. It shows how the server enforces workflow permissions. **Nothing is authenticated**, and any client can send any role.
- Approval routes:
  - Customer: Sales, then Finance, then BU Head
  - Vendor: Finance, then Quality, then BU Head
  - Item: Quality, then Finance, then BU Head
  - Cost Center: Finance, then BU Head
- The stage role or Admin can approve, clarify or reject a pending request. Clarify and reject need a note. Sales or Admin can resubmit a clarification or rejected request with a note, which restarts the route.
- SAP export requires Finance or Admin.

### What each role sees

- **Finance and Admin:** all request detail fields.
- **Other roles:** request detail fields with these keys replaced by `[redacted]`: `terms`, `paymentTerms`, `credit`, `creditTerms`, `creditLimit`, `requestedCreditLimitUSD`, `bankAccount` and `bankAccountNumber`. All other detail fields are visible.
- **All roles:** customer identifiers and emails are visible. These are synthetic in this prototype.
- **All roles:** audit notes are visible. Clarification and rejection notes are intentionally shared with every role so collaborators can see why a request moved.

## Duplicate check

- `POST /api/duplicates` scores a candidate against customer records and against non-rejected requests of the same type.
- Scores: exact identifier 100; exact email 95; exact name or alias 90; fuzzy name similarity from 0.70 scaled to at most 85.
- Scores are heuristic evidence, not probabilities.
- Creating a Customer request (`POST /api/requests`) with a match at score 80 or above returns `409` with the matches. Send the request again with a `duplicateOverride` of at least 10 characters to save it. The approval `resubmit` action does not repeat this check.

## Consolidation preview

`POST /api/simulate` takes `sourceId` and `targetId` and returns before and after customer counts and quantities. It shows that combined units are conserved. It never writes data.

## SAP export (simulated)

`GET /api/requests/:id/sap` returns a Business One Service Layer-shaped payload for an approved request, marked `"simulated": true`.

- Customer and Vendor map to `BusinessPartners`.
- Item maps to `Items`.
- Cost Center maps to `ProfitCenters`.

Nothing is sent to SAP. Only approved requests can be exported (`409` otherwise), and only Finance or Admin can export (`403` otherwise).

## Analytics

`GET /api/analytics` returns `{ schemaVersion, meta, views, coPurchase }`. `views` contains one view per product selection and an `all` view. Each view includes:

- `countries`: five country tiles
- `forecast`: next-month forecast from two models, with a walk-forward backtest
- `risks`: declining demand, customer concentration, lapsed customers, duplicate master data, overdue requests
- `opportunities`: accelerating demand, unconverted pipeline, cross-sell

**Forecast models:** the baseline is the historical average. The candidate is a linear trend by ordinary least squares. A backtest compares them on held-out months. A candidate must beat the baseline by more than a 2% tie margin to be selected. The result varies by series. On the current seed, the baseline wins for the all-product view, Product A, Product B and Singapore. The candidate wins for Product C, Thailand, Malaysia, Indonesia and Vietnam. The report states each series' winner and its error.

Enquiry and setup signals are shown as pipeline and never counted as demand.

## API overview

| Method and path | Purpose |
| --- | --- |
| `GET /api/bootstrap` | Customers, products, orders, requests and audit, redacted for the role |
| `GET /api/analytics` | Analytics views (see above) |
| `GET /api/graph` | Nodes and edges for the graph (the UI derives its graph from bootstrap) |
| `POST /api/duplicates` | Matches for `name`, `identifier`, `email` and `type` |
| `POST /api/requests` | Create a request; duplicate override required at score 80 or above |
| `POST /api/requests/:id/action` | `approve`, `reject`, `clarify` or `resubmit`, with `note` where required |
| `GET /api/requests/:id/sap` | Simulated SAP payload for approved requests |
| `POST /api/simulate` | Read-only consolidation preview |
| `POST /api/reset` | Restore the synthetic fixture |

Errors return JSON `{ "error": "..." }` with an HTTP status. Malformed JSON returns `400`.

## Tests

```bash
npm test
```

- `tests/backend.test.js` exercises the persistent API: validation, duplicate handling, approvals, role checks, redaction, SAP gating and non-mutating simulation.
- `tests/analytics.test.js` covers demand totals, growth windows, forecast backtests, risk and opportunity rules, co-purchase and bad-input handling.

The current suite has 34 tests. Passing tests show that the implemented logic behaves as specified. They are not a browser test.

## Project layout

```
server/      Express API, SQLite store, domain rules, analytics, seed data
src/         React 19 and TypeScript frontend
tests/       node:test suites for the API and analytics
docs/        Contract notes, executive summary source, demo script, production plan
output/pdf/  Rendered PDF of the executive summary
data/        Local SQLite file (gitignored)
```

## Limits

- Synthetic data only. Do not load real customer, vendor or financial records.
- No authentication, no real authorisation beyond the demo header, no TLS, no rate limiting.
- Single-process SQLite with JSON-document storage. No migrations, backups or multi-user concurrency testing.
- SAP output is a payload shape. No connection, credentials or reconciliation exists.
- Forecasts use short synthetic histories. Backtests show the evaluation method, not real forecast accuracy.
- No hosted deployment and no uploaded demo video.
