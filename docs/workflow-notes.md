# Requests workflow

`Requests({ onInvestigate?: (id: string) => void })` (`src/components/Requests.tsx`, `Requests.css`) covers intake, duplicate screening, role-based approval, resubmission, audit and the simulated SAP export. It was written against the actual `server/domain.js` and `server/index.js`, not only the contract.

## Demo role
A pill selector sets the `X-Role` header on every call (Sales, Finance, Quality, BU Head, Admin; stored in `localStorage`). It is labelled as a demo role switcher, not authentication. Changing role reloads data because the server redacts per role.

## Approval queue
- Cards are ordered by: requests the current role can act on, then status (Pending, Clarification, Rejected, Approved), then priority (3 is most urgent), then deadline. Priority is an integer 1-3, default 2. Stat tiles are derived from the loaded requests.
- Prev/Next buttons, `←` `→` (also `↑` `↓`, `j` `k`) and a touch swipe move through the filtered list. Keys are ignored while typing or when a dialog is open.
- The approval chain is drawn from the server routes (Customer Sales → Finance → BU Head; Vendor Finance → Quality → BU Head; Item Quality → Finance → BU Head; Cost Center Finance → BU Head). Approve, Clarify and Reject are enabled only for the stage role or Admin; Resubmit only for Sales or Admin on Clarification/Rejected. The server stays authoritative and its error text is shown.
- Every action opens a confirmation dialog (focus trap, Esc, focus restore). Clarify, Reject and Resubmit require a note; Approve takes an optional one.
- The audit timeline comes from `audit` in `/api/bootstrap`, filtered by `requestId`.
- Approved requests offer **Download SAP JSON** and a preview (`GET /api/requests/:id/sap`). The server allows Finance and Admin only, so the buttons are disabled for other roles. The payload is a simulation; nothing leaves the app.
- Data refreshes every 20 s, on window focus and on the Refresh button. Only fetched data is replaced, so drafts, an open dialog and the selection are kept. The header shows the last sync time.
- Dates: `YYYY-MM-DD` strings are local calendar days; full ISO timestamps are converted to the viewer's local day before computing "due in / overdue".

## New request
- Fields depend on the type. `details` is sent as an **object** of nonempty scalars keyed by the server's labels (for example `Payment terms`, `Requested credit limit (USD)`, `Standard cost (USD)`), plus `Business justification`. Numeric fields are sent as numbers. Required fields mirror `parseDetails`.
- Client validation mirrors the server and SAP pre-validation: name, country and requester always; identifier and email for Customer and Vendor; name up to 100 characters (30 for Cost Center); Customer/Vendor identifier up to 32; Item code up to 50 and Cost Center code up to 8 using `A-Za-z0-9_./-`; priority 1-3. Inline errors, an error summary, and focus on the first invalid field.
- Duplicate screening (`POST /api/duplicates`, debounced) runs for every type. Candidates are customer records (Customer type) and earlier same-type requests. Scores are a 0-100 heuristic, not a probability. A score of 80+ requires an override justification of 10+ characters (the server returns 409 otherwise). A 409 reveals the override field even if the client did not predict it.
- **Open in graph** calls `onInvestigate(customer.id)` only for IDs present in `bootstrap.customers`. Request-history candidates cannot be opened. In a request's detail view, the request's own record is filtered out of the matches.
- Optional rule-based email intake: paste an email, or load the sample, and fixed label/keyword rules pre-fill fields (labelled lines such as `Company name:`, the `From` header, country names, ISO dates, "urgent"). No AI or network call is involved. Matched and missing fields are listed and nothing is applied until the user confirms.

## Redaction
The UI renders any value equal to `[redacted]` as "Hidden for this role", per field. It does not assume which fields are hidden, so it follows the server's current policy. Redacted identifier/email values are not sent to the duplicate service. Seeded requests keyed by short names (`segment`, `terms`) are shown with the form labels.

## Verification
- `tsc -b` and `vite build` pass; `node --test tests/*.test.js` passed (34/34) when last run.
- Against the real server on a temporary database: creation without an override returned 409, a short override 409, a valid override 201; an Item request without an identifier succeeded; a Cost Center with a 15-character code failed with the SAP-code error; Finance could not approve a Sales-stage request (403); Sales → Finance → BU Head approvals completed; SAP export returned 403 for Sales and the simulated Service Layer payload for Finance.
- In the browser (DOM-level checks): role switch reloads and re-sorts; keyboard navigation moves the selection; an empty form submit shows the error summary and focuses the first invalid field; duplicate screening showed two customer records and one earlier request with the override field; the Quality role approved a Pending vendor and the chain and audit timeline updated; the confirmation dialog traps focus, requires a note for Reject and closes on Esc; SAP buttons were disabled for Sales and worked for Finance; a 390 px frame collapses to one column without horizontal overflow.
- Not verified: screenshots (the preview snapshot tool timed out), the file download itself in a browser (the payload fetch was verified), touch swipe on a real device, and the 20 s auto-refresh timer (not observed running).
