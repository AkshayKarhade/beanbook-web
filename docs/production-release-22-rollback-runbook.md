# PR #22 — CRAG production preservation and rollback runbook

Status: **HOLD — do not merge or deploy until CRAG regression checks and rollback prerequisites pass.**

## Recorded source baseline (2026-11-01)
- Repository: `AkshayKarhade/beanbook-web`
- Production source branch: `main`
- Pre-merge `main` commit: `5ef3b7984b2ea8c149d859a70a5d14beaf247cdb`
- Candidate branch: `BeanBook-MVP-1`; release PR: https://github.com/AkshayKarhade/beanbook-web/pull/22
- Existing CRAG route: `/beanbook/order/crag-fridge` (verify complete production URL before deployment).
- **Netlify site ID, currently published deploy ID, domain, environment variables and Razorpay live configuration have NOT been captured or verified.** Obtain these from Netlify before merging; do not put secret values in this document.
- Database: Supabase project `ensndmoitnkuuxlxmugn` (BeanBook, ap-south-1). Record a fresh database backup/PITR restore point before any further schema changes.

## Database findings
- Current live database already has most MVP migrations applied (business access, products, menus, counter orders, order state and bill email).
- Existing tables `orders` and `order_items` were altered with new order-state columns, triggers and permissions. In particular, `mvp1_live_orders_backend_foundation` revokes `INSERT/UPDATE/DELETE` on both from `anon` and `authenticated`. This is a potential legacy-checkout compatibility risk; verify the CRAG server-side payment flow against it.
- The new `business_invitations.pilot_tier` column is **not yet present**. The candidate activation flow requires it. Apply its additive migration only after verification and backup.
- Git revert and Netlify rollback do not revert database schema, permissions, stored data, payments or inventory movements.

## Mandatory pre-release evidence
1. Record production Netlify site ID, published deploy ID, build commit, deployment branch, and restore/publish-deploy availability.
2. Record current public CRAG URL, screenshots and exact displayed catalogue, prices, stock quantities and checkout behavior.
3. Record Razorpay environment **mode** and key identifier only (never secrets), payment endpoint configuration and webhook destinations.
4. Verify build and CI checks for PR #22; compare Netlify routing and functions, especially CRAG checkout and payment verification.
5. Validate a real-equivalent test payment through the complete CRAG flow, including verification and exactly-once inventory decrement, in a safe test environment. Never create fake production payments.
6. Verify database backup and recovery process; review RLS, triggers and grants affecting legacy orders.
7. Confirm new pilot-tier migration is applied before inviting a pilot owner.

## Release
- Merge PR #22 only after all above checks pass and with explicit approval.
- Record merge commit SHA, Netlify deploy ID and release timestamp in this file.
- Smoke-test CRAG URL, catalogue, live-mode Razorpay checkout, order persistence, payment verification and inventory decrement immediately.

## Incident rollback — in order
1. **Stop further deployment** and record symptoms, time, failed order/payment IDs and logs; avoid repeated charge attempts.
2. In Netlify Deploys, republish the exact recorded last-known-good deployment (not merely the latest successful build). Verify that routing and functions were restored. Record restored deploy ID.
3. If source rollback is needed, use GitHub's Revert on PR #22 (or revert its merge commit on a branch, review, merge). Do not force-reset `main`; avoid automatic redeployment of broken code.
4. **Do not blindly roll back the database.** Determine whether a schema/RLS/trigger fix is needed. Prefer forward-compatible corrective migration. Restore a database backup only with a reviewed data-loss/reconciliation plan because new paid orders may exist.
5. Reconcile Razorpay payment events with Supabase orders and stock movements before reopening checkout.
6. Re-test CRAG URL, Razorpay mode and end-to-end paid order/stock flow. Announce recovery only after successful checks.

## Definition of exact recovery
- Original public URL and branding, original prices/stock visibility, correct Razorpay live integration, payment verification and inventory behavior, and no missing/duplicated paid orders.
- An exact prior database snapshot cannot be restored without potentially discarding transactions since that snapshot; payment and stock reconciliation is mandatory.
