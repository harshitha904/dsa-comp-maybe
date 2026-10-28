# Verification — Lives order tickets v2

Verified on 28 October 2026. All data and operational scenarios are synthetic.

## Automated and build verification

- `npm test`: **78 tests passed**, including the newer upstream repository's triage, configurable workflow and forecasting tests.
- `npm run build`: TypeScript and the production Vite build passed for both `index.html` and `legacy.html`.
- Actual Express/SQLite HTTP tests cover T-1042's independent Finance/QA approvals, MDM gating, unauthorized actions, audit actors, notification creation/clearance, duplicate reuse without record growth, policy changes affecting subsequent tickets, and reset preserving audit history.
- Hosted-handler HTTP tests cover durable initialization, CSV responses, save-before-success, rejected mutations without writes, unchanged notification polls without writes, and a platform-provided JSON helper that bypasses Express's `send` method.
- Analytics tests independently recompute growth and ranking conservation, check preceding-month-only holdouts, exclude enquiries and MDM signals from confirmed demand, handle zero actuals, verify conversion evidence, and derive the sell-ready timing proxy from workflow timestamps.

## Browser verification

The integrated application was exercised through the collaborative browser:

1. Management saw T-1042 with quote ready and Finance/QA work pending.
2. Finance's inbox put the $48,000 T-1042 first. Completing its review reduced the queue from nine to eight and displayed a success message.
3. QA/RA entered a Thailand licence reference and completed the independent review.
4. Switching to Priya displayed exactly one unread actionable notification, a new-task toast and the final-check task. The simulated Teams card and Outlook digest contained T-1042 and its waiting order value.
5. MDM completed the official action. A fresh read showed all four capabilities unlocked, code C-1042, and actual Finance/QA/MDM audit actors. Somchai received the completion notification.
6. Marcus entered “National Univ Hospital”, saw NUH matching evidence, chose the existing record and opened a completed ticket linked to C-1001.
7. Insights displayed computed six-month growth, duplicate rank changes and both model scores. Main content had no page-level horizontal overflow at desktop and 390px width; the wide heat table scrolls inside its own container.
8. The preserved `/legacy.html` workspace loaded its request/email-triage screen after the upstream merge. Its existing tests also passed.

## Live deployment

Consult [deployment.md](deployment.md) for the final deployment identifier and live durability evidence. An initial v2 deployment revealed that the platform's own JSON helper could bypass a `res.send`-only persistence hook. The adapter now intercepts both response methods and commits once before acknowledgement; this has a dedicated regression test. A READY build alone is not accepted as evidence of successful state persistence.

## Boundaries

The role selector is not authentication. Teams/Outlook are simulated, SLA processing is triggered by requests, and SAP output is a simulated import handoff. No real SAP write, financial verification, externally delivered notification, actual first-sale timestamp or real-world forecast accuracy is claimed. Four workflow states are implemented in the application; no separate editable Figma document was produced. Earlier executive-summary artifacts describe the earlier product vision and should not be used as release evidence for this revision.
