-- The three request/workflow tables from the approved Claim Workflow:
-- claiming an unclaimed directory club, requesting to join an already-claimed
-- club, and requesting a missing club be added to the directory.

create table public.club_claims (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid not null references public.club_directory(id),
  claimant_user_id uuid not null references auth.users(id),
  claimed_role text not null,
  authority_declaration text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  verification_method text check (verification_method in ('official_email', 'admin_review')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_claims is
  'Claim Workflow step 5: submitted when a user claims an unclaimed directory club. Approval is a Site Admin action (or official-email verification) that separately creates the clubs row.';

create index club_claims_directory_id_idx on public.club_claims (directory_id);

create table public.club_join_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  requesting_user_id uuid not null references auth.users(id),
  requested_role text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_join_requests is
  'Claim Workflow step 6: created when a user selects an already-claimed directory club. Approved/rejected by an existing verified Club Admin (or Site Admin).';

create index club_join_requests_club_id_idx on public.club_join_requests (club_id);

create table public.directory_requests (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references auth.users(id),
  club_name text not null,
  bio text,
  postcode text,
  address_line_1 text,
  address_line_2 text,
  address_line_3 text,
  town text,
  county text,
  country text,
  phone text,
  email text,
  logo_upload_ref text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_directory_id uuid references public.club_directory(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.directory_requests is
  'Claim Workflow "missing club" path / signup STEP 3 "Can''t find your club?". Site Admin validates against an authoritative source before it becomes a canonical club_directory row.';
