# Vercel deployment

The deployment uses a private, project-specific Vercel Blob store for durable
server-side JSON state. Local development continues to use SQLite. No deployment
uses `/tmp` SQLite or falls back to process memory when storage is unavailable.

The API loads an uncached snapshot for each request. A successful mutation is
acknowledged only after a conditional Blob write using the snapshot ETag. A
concurrent modification returns HTTP 409 and asks the caller to refresh and retry;
storage failures return HTTP 503. Transactions update the in-request snapshot
atomically. This preserves the existing synchronous domain/store interface.

This is a small demo data store: every mutation replaces the JSON document. For
larger workloads, migrate to PostgreSQL with row-level transactions. Role selection
is explicitly a demo feature, not authentication; deployed data must stay synthetic.

## Provision and deploy

1. Link a Vercel project named `dsa-comp-maybe` in the intended account.
2. Create a new **private** Blob store specifically for this project and connect it
   to the deployment environments. Use the free allowance; do not select paid plans.
3. Ensure the connection supplies `BLOB_STORE_ID` with OIDC access or a server-only
   `BLOB_READ_WRITE_TOKEN`. Never put either credential in a `VITE_` variable.
4. Use Node.js 24 and deploy with `vercel --prod` from the project root.
5. Verify `/api/bootstrap`, `/api/analytics`, request creation and approval, and SAP
   export. Repeat reads across a second deployment to verify durable persistence.

Secrets and `.vercel/` are ignored by Git and upload exclusions. Source `data/`
SQLite files are excluded. A missing Blob connection fails closed with HTTP 503.

## Provisioned resources and verification

- Production URL: https://dsa-comp-maybe.vercel.app
- Team: Samuel's projects, slug `samuels-projects-871fb3f2`, ID `team_ShA6LOJj2OpH2BaydMEGM4J5`.
- Project: `dsa-comp-maybe`, ID `prj_GfaCh6j5aKR6mWA0xEfsljnEkWXl`.
- Private Blob: `dsa-comp-maybe-state`, ID `store_pkMN1kHXm0K9huOE`, region `sin1`.
- Connection: OIDC, all three environments; no static read/write token provisioned.
- Node runtime: 24.x. No paid plan selected or upgrade performed.

The connector's project-create endpoint returned 403, but the documented CLI
fallback succeeded using the existing CLI login. Resources were created only for
this project. Production was deployed from the working tree; the parent owns the
final Git commit and push. Git integration is connected to `tancysam/dsa-comp-maybe`; subsequent pushes
use Vercel Git deployments. Production branch is `main`.

Validation: 41 tests pass, including raw HTTP success only after durable save,
HTTP 409 on conditional-write conflicts, HTTP 503 on storage failures, missing
credentials failing closed, and snapshot transaction rollback/isolation. Build
passes. A scoped Zod override upgrades the SDK's transitive pinned dependency;
`npm audit --omit=dev` and full installation audit report zero vulnerabilities.

Live verification completed on 2026-10-28: bootstrap and analytics HTTP 200;
synthetic Customer creation HTTP 201; Sales, Finance and BU Head approvals HTTP
200; SAP JSON export HTTP 200. Approved request
`d9d54679-5391-400f-b535-9646fa1ab969` persisted on a fresh read across a subsequent
production deployment. The public executive summary PDF returned HTTP 200 and
matched the local file byte-for-byte (68,805 bytes).

A live-only issue was caught and fixed: private compressed Blob GET responses
return weak ETags (`W/"hash"`), whereas conditional writes require the quoted
origin token (`"hash"`). The adapter normalizes this token; targeted tests cover
that behavior and cold-start read validation. No successful mutation is returned
before the conditional save completes.

## References

- https://vercel.com/docs/vercel-blob/using-blob-sdk (conditional writes with `ifMatch`)
- https://vercel.com/docs/vercel-blob/private-storage (private reads and cache control)
- https://vercel.com/docs/functions/runtimes/node-js

## Final deployment evidence

Production deployment `dpl_8ANSZFor74KBFuxQcurbZsesU6w3` is READY:
https://dsa-comp-maybe-5qkbarnrf-samuels-projects-871fb3f2.vercel.app

Stable public alias: https://dsa-comp-maybe.vercel.app

Source baseline: pushed `origin/main` commit `a7e9e2a`, plus the follow-up optional
storage transport injection and two regression tests (default production behavior
unchanged). Parent owns committing/pushing that follow-up and this document.

Live simultaneous writes returned `[409, 409, 201]`; a fresh bootstrap confirmed
all acknowledged writes were retained. Conflicting requests received explicit
refresh-and-retry errors. The final deployment retained the earlier approved
Customer request. Synthetic verification records intentionally remain in the demo.

The project API confirms GitHub integration `tancysam/dsa-comp-maybe` and production
branch `main`. Subsequent pushes use Vercel's connected Git workflow. No secrets,
local OIDC tokens, `.vercel` mapping, or SQLite files are tracked in Git.

## Repository migration preparation (2026-10-28)

The release repository is `https://github.com/harshitha904/dsa-comp-maybe.git`.
Remote `main`, `harshitha`, and `ui-redesign` were inspected at
`a9fc5e0664084951790a8367c765800c27fe57d9`. This main branch contains the
previous local release commit `3e22a53` and fifteen subsequent commits; preserve
those changes when preparing the release. No force push is required.

The existing Vercel project and private Blob store are retained. Project identity
was confirmed using authenticated CLI 65.4.0 with explicit scope
`samuels-projects-871fb3f2`. Connecting the new GitHub repository failed because
Vercel could not access it. After this attempt the project API reports no Git
link, so automatic deployments from Git pushes are currently unconfigured. The
repository owner must grant the Vercel GitHub integration access before reconnecting
it. CLI production deployment to this existing project remains available.

Use the existing `.vercel/project.json` mapping and verify project and team before
deployment. Do not create another project or store. After releasing, initialize
the lazy workflow migration with a management `/api/users` read carrying the demo
`X-User-Id` header before browser verification. Confirm successful ticket writes
return only after persistence, and verify a fresh read retains the changes.

This preparation did not push commits or deploy a new build. Earlier deployment
evidence above describes the previous release; the parent release task records
the final source commit and live verification for the workflow update.
