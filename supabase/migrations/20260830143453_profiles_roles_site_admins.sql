-- Person-level signup profile, and the global Site Admin role grant table.
-- No RLS/policies here — enabled in the final migration, once every table
-- this migration set creates exists and the is_site_admin() helper can be
-- defined.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  surname text not null,
  date_of_birth date,
  address_line_1 text,
  address_line_2 text,
  address_line_3 text,
  town text,
  county text,
  country text,
  postcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Person-level signup profile data, one row per auth.users id. Never holds club data (per STEP 2 of the approved signup flow).';

-- Global platform admin grants. Membership here — never club membership — is
-- the only source of Site Admin authority. Multiple active rows are
-- supported (multiple Site Admin accounts, as required).
create table public.site_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_admins is
  'Global platform admin grants. Never infer Site Admin rights from club membership.';
