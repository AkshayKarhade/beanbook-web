# BeanBook Step 1 — Platform foundation / preview

Status: source implementation and migration staged on a PR; **do not merge** into main until approved.

## Scope delivered in this change
- Business-neutral responsive admin application at /beanbook/admin.
- Invitation-only sign-in; **no public self-registration**.
- A user has access only if their Supabase Auth user ID has a matching admin_users membership.
- Authenticated business profile view; owner-only business-name update.
- Explicit Step 2–5 placeholders instead of fabricated data.
- Separate admin Supabase environment configuration; intentionally **no production fallback**.
- Test-only SQL migration file, not applied remotely.

## Important limitations / required setup
1. **Create a separate Supabase test project.** The repo does not yet contain a complete baseline migration for the existing production schema. Restore a validated schema-only baseline before running the Step 1 migration. Do **not** run it on the live database.
2. In the Netlify Deploy Preview environment set:
   - VITE_BEANBOOK_ADMIN_SUPABASE_URL = test project URL
   - VITE_BEANBOOK_ADMIN_SUPABASE_PUBLISHABLE_KEY = test project publishable key
   Do not copy a service-role or secret key into any VITE_ variable.
3. Supabase Auth URL configuration must allow the actual Netlify Deploy Preview URL in redirect URL allow-list. Invitations require an admin-operated workflow: create/invite user using the Supabase dashboard or protected service role, then insert the user's auth UUID, matching brand ID, email and role in admin_users from the trusted admin side. No public-facing account creation, invitation-sending admin UI, or production provisioning is included yet.
4. This first preview does **not** expose live payments, customer data or a production admin fallback. If preview env vars are absent, it deliberately shows "Preview setup required."
5. The current repository uses the existing production Supabase variables for legacy ordering. To ensure no preview code can touch production during tests, do not copy production VITE_SUPABASE_* or server-side SUPABASE_* secrets into the preview deploy environment. Existing ordering routes should not be exercised until a fully isolated test environment is verified.
6. The preview may build even when the test backend has not been prepared. A preview link is therefore **not equivalent to a passed security test**.

## Acceptance tests (required before proceeding to Step 2)
- A valid invited user with an admin_users membership can log in and view their own business.
- An Auth user without membership is refused business-console access.
- An unauthenticated browser cannot see the business console.
- Business A staff cannot read or update Business B settings, orders or customers; verify through direct data queries as well as UI.
- Staff cannot update the business name; owner can, and changed name is persisted.
- Anonymous users cannot insert their own admin_users membership.
- Reload, logout, small-screen layout, no-config failure state and invalid login all work.
- Existing The 8th Coffee Bean ordering is unaffected by this preview-only change.

## Deployment mechanics
Open one draft PR into main and use Netlify's Deploy Preview. Never push this Step 1 branch directly to main. Each later approved step gets its own commit and immutable deploy permalink.

No customer or brand names are hard-coded into the admin UI or authorization logic.
