# Verification record

Checked 28 October 2026 (Singapore time).

- `npm test`: 39/39 passed. Includes API persistence, type validation, duplicate conflicts, approval permissions, redaction, SAP mappings, simulation conservation, forecast holdout isolation and independent MAE recomputation, risk and opportunity evidence, and serverless durable-write acknowledgement/conflict/failure tests.
- `npm run build`: TypeScript and production Vite build passed. Main routes are code-split.
- `git diff --check`: passed.
- Production dependency audit: zero vulnerabilities reported.
- Desktop browser: visually inspected control center, graph explorer, approval workspace and regional forecasting screens.
- Local end-to-end browser: created Demo Meridian Clinic, approved as Sales then Finance then BU Head, inspected and downloaded the simulated BusinessPartners JSON, and checked the resulting audit trail.
- Graph browser: selected NUH, inspected identifier/email/alias evidence, ran consolidation preview; combined all-signal units remained 2,076 before/after and no real merge occurred.
- Mobile 390px DOM/layout: request workspace and analytics had no horizontal overflow. Product C filter selected the trend model; all-products selected historical average. Compact navigation has explicit accessible labels.
- Executive PDF: exactly two A4 pages, both rendered and visually inspected.

## Limits of verification

Touch swiping was not tested on physical hardware. Browser screenshots and recording became intermittently unavailable; recording attempts returned `Preview automation recordingStart timed out after 15000ms.` twice. The fallback in-app browser reported `Browser is not available: iab`. No demo video was fabricated or uploaded to YouTube. Use docs/demo-script.md for a narrated 2–3 minute recording.

Live deployment results and persistence across deployments are recorded separately in docs/deployment.md. Synthetic fixture results demonstrate the algorithms, not measured Lives Group business outcomes.
