-- Versioned terms acceptance. Append-only: acceptance is the presence of a
-- row for the current version, never a permanent boolean.

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, terms_version)
);

comment on table public.terms_acceptances is
  'One row per user per accepted terms version. Never updated, only inserted — signup STEP 4 requires versioned acceptance, not a boolean flag.';

create index terms_acceptances_user_id_idx on public.terms_acceptances (user_id);
