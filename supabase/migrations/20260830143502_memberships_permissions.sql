-- Club membership and team-scoped permissions. Placed after teams (deviating
-- from the example ordering list) because team_permissions.team_id
-- references teams.id.

create table public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  user_id uuid not null references auth.users(id),
  -- BASIC_USER is the explicit default named in the Claim Workflow sheet
  -- (step 7: "Membership may initially remain BASIC_USER"); CLUB_ADMIN is
  -- the role a successful claim/join approval grants.
  role text not null default 'BASIC_USER' check (role in ('BASIC_USER', 'CLUB_ADMIN')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, user_id)
);

comment on table public.club_memberships is
  'A user''s relationship to a club. Site Admin rights are never inferred from any row here.';

create index club_memberships_user_id_idx on public.club_memberships (user_id);

create table public.team_permissions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.club_memberships(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  -- Only "manage" is evidenced by the source material ("explicit team
  -- permissions determine which teams they can manage"); left as open text
  -- rather than a restrictive check constraint, since no fuller permission
  -- taxonomy was defined to normalize against yet.
  permission text not null default 'manage',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (membership_id, team_id)
);

comment on table public.team_permissions is
  'Explicit per-team management grants for a BASIC_USER membership (e.g. Team Manager access to one specific team).';
