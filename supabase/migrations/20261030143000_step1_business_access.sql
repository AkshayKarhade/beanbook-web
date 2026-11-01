-- Step 1: Foundation access rules.
-- REVIEW AND APPLY ONLY TO A SEPARATE TEST PROJECT after installing the
-- existing BeanBook base schema. Never run this automatically on production.
-- No production data modifications are part of this branch.

begin;

alter table public.admin_users
  add column if not exists role text not null default 'staff';

alter table public.admin_users
  drop constraint if exists admin_users_role_check;
alter table public.admin_users
  add constraint admin_users_role_check check (role in ('owner', 'staff'));

alter table public.brands enable row level security;
alter table public.admin_users enable row level security;

-- Existing public brand-name reads remain intact for the legacy checkout;
-- ownership is required for editing business settings.
drop policy if exists "Business owners can update their brand" on public.brands;
create policy "Business owners can update their brand"
on public.brands for update to authenticated
using (exists (
  select 1 from public.admin_users au
  where au.brand_id = brands.id
    and au.supabase_user_id = (select auth.uid())
    and au.role = 'owner'
))
with check (exists (
  select 1 from public.admin_users au
  where au.brand_id = brands.id
    and au.supabase_user_id = (select auth.uid())
    and au.role = 'owner'
));

-- No direct client insert or update of admin memberships. Memberships must
-- be created by an authorized platform operator using server-side admin tools.
revoke insert, update, delete on public.admin_users from anon, authenticated;

grant select on public.admin_users to authenticated;
grant select, update on public.brands to authenticated;

-- Clients can only see their own membership, enforced by pre-existing
-- admin_users "Users can see their own admin_users row" policy.
commit;
