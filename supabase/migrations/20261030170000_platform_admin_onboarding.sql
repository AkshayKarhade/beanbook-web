-- BeanBook platform admin design. Apply only after review and backup.
-- Existing production auth and sales tables are preserved.
begin;

create table if not exists public.platform_admins (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  username text not null unique check (username = 'admin'),
  auth_email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.platform_settings (
  id integer primary key check (id = 1),
  sender_name text not null,
  sender_email text not null,
  reply_to_email text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','accepted')),
  auth_user_id uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  unique(brand_id,email)
);
create table if not exists public.platform_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  brand_id uuid references public.brands(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;
alter table public.business_invitations enable row level security;
alter table public.platform_audit enable row level security;
revoke all on public.platform_admins, public.platform_settings,
  public.business_invitations, public.platform_audit from anon, authenticated;

-- Membership roles used by the business console; only privileged server
-- administration can insert owner/staff membership records.
alter table public.admin_users add column if not exists role text not null default 'staff';
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner','staff'));
revoke insert, update, delete on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

-- Owner-driven brand naming conflicts with the new sole-platform-admin
-- configuration policy: disable owner-side mutations until reworked.
drop policy if exists "Business owners can update their brand" on public.brands;
revoke update on public.brands from anon, authenticated;

-- Preserve existing public brand-name read policies used by legacy checkout.
grant select on public.brands to authenticated;

commit;
