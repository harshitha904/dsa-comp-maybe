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
final Git commit and push. Git integration is not yet connected, so a push alone
should not be assumed to redeploy.

Validation: 39 tests pass, including raw HTTP success only after durable save,
HTTP 409 on conditional-write conflicts, HTTP 503 on storage failures, missing
credentials failing closed, and snapshot transaction rollback/isolation. Build
passes. A scoped Zod override upgrades the SDK's transitive pinned dependency;
`npm audit --omit=dev` and full installation audit report zero vulnerabilities.

Live API verification and cross-deployment persistence results follow below.

## References

- https://vercel.com/docs/vercel-blob/using-blob-sdk (conditional writes with `ifMatch`)
- https://vercel.com/docs/vercel-blob/private-storage (private reads and cache control)
- https://vercel.com/docs/functions/runtimes/node-js
