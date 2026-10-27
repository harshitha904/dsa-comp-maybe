# Analytics notes

Owner files: `server/analytics.js`, `tests/analytics.test.js`, `src/components/Analytics.tsx`, `src/components/Analytics.css`.
All data is synthetic and illustrative. Quantities are units, not revenue.

## Integration

- `buildAnalytics({customers, products, orders, requests, audit})` is a named and default export of `server/analytics.js`. It is pure and deterministic (no clock, I/O or randomness) and does not mutate its input. `GET /api/analytics` returns its result as JSON.
- The frontend calls `api('/analytics')` (`src/api.ts`) and renders `default Analytics()` (no props).
- `buildSeedFixture()` (same module) is a deterministic 2025-10…2026-09, five-country, Products A/B/C fixture used by the tests. The backend does not have to use it.
- The engine works on any product ids (the backend uses `p1..p3`, the tests use `A..C`) and takes display names from `products`.

## Payload

```
{ schemaVersion, meta, views, coPurchase }
meta   { months[], firstMonth, lastMonth, nextMonth, referenceDate, countries[] (fixed order),
         products[{id,name,category}], viewKeys[], counts, dataQuality{invalidOrders,unknownSignals,orphanOrders,undeclaredProducts?}, methodology{} }
views  keyed by product subset: 'all', 'p1', 'p1+p2', … (every non-empty subset; singles only if more than 5 products)
  view { key, productIds, totals, monthly[], byProduct[], countries[], forecast, risks[], opportunities[] }
  totals    { confirmedQuantity, confirmedOrders, activeCustomers, latest/previous quantity, momGrowthPct,
              last3Quantity, prior3Quantity, growth3mPct, excluded{enquiry,setup,orders,quantity} }
  country   { country, confirmedQuantity, sharePct, rank, intensity(0-1), series[{month,quantity,intensity}], byProduct[], topCustomers[], excluded, forecast, …growth fields }
  insight   { id, kind, type, priority, title, summary, countries[], productIds[], metrics[], evidence[], customers[], requests[], action }
```

Product filtering is precomputed server-side per subset, so the UI never re-derives numbers. Insights are computed per view, so a filtered view only shows signals computed from that product selection (plus product-independent master-data signals).

## Definitions

- **Demand** = sum of `quantity` for `signal === 'confirmed'`. `enquiry` and `setup` orders are never part of demand, growth or forecasts; they are reported separately as excluded counts (orders and units) at view, country and month level.
- **Growth**: month-over-month (latest vs prior month) and 3-month (latest 3 months vs the 3 before). `null` when the earlier window is zero (never Infinity).
- Invalid rows (bad month, negative or non-numeric quantity, missing product/country) and unknown signals are dropped and counted in `meta.dataQuality`. Orders for unknown customers are kept and counted as orphans.

## Forecast and backtest

Rolling-origin hold-out. For each month from index 6 onward, both models are fit only on earlier months and scored on that month (6 held-out points for 12 months).

- **Baseline**: historical average of all earlier months.
- **Candidate**: ordinary-least-squares linear trend, extrapolated one step, floored at 0.
- **Metric**: MAE in units (also shown as % of mean held-out demand).
- **Selection**: the candidate is used only if its MAE beats the baseline by at least 2%. If the baseline is better by 2% or more, or the models are within 2%, or there are fewer than 3 held-out points, the baseline is used. If the baseline's MAE is exactly 0 and the candidate's is not, the baseline wins (the percentage is undefined, so `improvementPct` is `null`).
- `improvementPct` can be negative and is reported as such. Nothing is tuned to favour the candidate. On the seed, the trend wins for some countries and loses for others, and the test suite asserts the result is mixed.
- Caveats are attached to every forecast. With only 12 months, seasonality cannot be validated, so neither model includes it. The "typical miss" shown is the selected model's held-out MAE, not a confidence interval.

## Risks and opportunities

Every item has `evidence[]` (numbers and record ids derived from the data), `metrics[]`, an explicit `priority`, and a suggested `action`. Thresholds are constants at the top of `server/analytics.js`.

| Type | Trigger |
| --- | --- |
| declining-demand | 3-month growth ≤ −10% and ≥ 30 units in a window (high at ≤ −25%) |
| customer-concentration | top customer ≥ 40% of a country's demand with other customers present (high at ≥ 60%) |
| lapsed-customers | ≥ 3 earlier active months, none in the latest 3 |
| forecast-uncertainty | selected-model MAE ≥ 25% of mean held-out demand |
| duplicate-master-data | customers sharing an identifier or email (masked values such as `[redacted]` are ignored, so they can't merge records) |
| overdue-requests | `Pending`/`Clarification` requests past `deadline`, relative to the latest request/audit timestamp (not the wall clock) |
| accelerating-demand | 3-month growth ≥ 15% |
| unconverted-pipeline | enquiry/setup in the last 6 months with no later confirmed order for that customer and product |
| cross-sell | see below |

### Cross-sell: what it does and does not show

Orders are monthly customer × product aggregates with no basket or invoice id. The cross-sell signal is therefore **customer-level product overlap across the period**, not observed same-basket co-purchase. A pair is raised when at least 3 customers buy the source product, at least 50% of them also buy the target, lift is above 1, and some source buyers lack the target. Lift is overlap divided by the target's penetration among all buying customers. Same-month overlap is reported only as supporting timing evidence. Every card says this in its last evidence line. Small customer base; this is an association, not proof that an offer will convert.

## UI

Product filter chips (multi-select, `aria-pressed`), four headline stats, trend chart (total + forecast, by country, by product, optional excluded overlay), forecast check (MAE bars, verdict, held-out chart and table), clickable country heatmap tiles (volume or 3-month growth), country detail, and risk/opportunity cards with expandable evidence, customer/request lists, country chips and "Copy brief". Loading, error with retry, and empty states are handled.

## Verification

- `npm test` runs `tests/analytics.test.js` (hand-computable fixtures plus the seed): confirmed-only totals and excluded counts, exact growth windows, filter-view reconciliation, forecast edge cases (linear, overshoot, zero-error baseline, ties, thin history, no look-ahead, independent MAE recomputation), insight evidence, masked-identifier handling, co-purchase maths and robustness.
- Browser check was done against the live API through a throwaway harness mounting only `Analytics` (the full App was blocked at the time by another file's syntax error). Narrow-viewport breakpoints were reviewed in CSS but not exercised in a browser.
