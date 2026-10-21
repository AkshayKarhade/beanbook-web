# BeanBook paid-order email alerts

A notification is generated for every **successfully captured Razorpay payment**, for every event (including Mixing Bowl Collective). Both the payment-verification route and the Razorpay webhook call the same best-effort notification code after `finalize_paid_order`. Pending/failed orders do not generate email.

Recipient (set via Netlify environment): `ORDER_EMAIL_TO=the8thcoffeebean@gmail.com`.

## Deploy safely

1. Apply `supabase/migrations/20261021143000_paid_order_email_notifications.sql` to the production BeanBook Supabase database through your standard managed migration process. The migration creates the notification outbox, the idempotent claim RPC, and an aggregate function for event preparation totals.
2. Verify a sending domain with [Resend](https://resend.com/domains) and create an API key. Do not use an unverified From address.
3. Configure **Netlify environment variables** for the site running `mvp/razorpay-checkout`:
   - `RESEND_API_KEY`: Resend secret, server-side only.
   - `ORDER_EMAIL_FROM`: verified sender, e.g. `BeanBook <orders@your-verified-domain>`.
   - `ORDER_EMAIL_TO`: `the8thcoffeebean@gmail.com`.
4. Merge into the **actual production branch** `mvp/razorpay-checkout` after reviewing the pull request. Confirm Netlify deploys this commit. Do not deploy to `main` and assume the production website is updated.
5. Use an authorized controlled live-payment test after deploying, and verify that exactly one alert reaches your inbox. Also replay the Razorpay payment webhook to verify no duplicate delivery and verify an abandoned/pending checkout produces no email.

## Email

Subject includes order number, event, and total. Body includes line items, quantity, price, customer contact where recorded, delivery address where applicable, event-level paid-order count, and total product quantities. `paid_stock_issue` orders have a prominent warning because money was received but stock finalization had a problem.

## Reliability

- The SQL unique `order_id` key and conditional claim prevent duplicate submissions when checkout confirmation and webhooks race.
- `Idempotency-Key` additionally protects against provider-level duplicate sends on retries.
- Failure to send never reverses or fails a paid checkout. Failed attempts are recorded in `order_email_notifications`; repeated payment confirmation can retry a failed message. Old in-progress claims become eligible for retry after 10 minutes.
- A webhook does not guarantee that a live endpoint can be invoked repeatedly by hand. For production-grade delivery recovery, add a scheduled outbox worker to retry failed notifications; the current implementation does **not** include a scheduled retry.
- Sent email does **not** constitute proof of fulfilment. Refer to BeanBook paid-order records for the source of truth.

## Operational checklist

Inspect `public.order_email_notifications` for `failed` and stale `sending` rows. Never expose this table to the anonymous REST API. Do not store `RESEND_API_KEY` in Git or `VITE_*` variables.

**Current status:** this is code prepared for review, not an enabled production email integration until the DB migration, sender credentials, deployment, and real send verification succeed.
