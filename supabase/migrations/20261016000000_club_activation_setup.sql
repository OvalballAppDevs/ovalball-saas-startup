-- Club activation -- the first-run setup lifecycle.
--
-- A newly approved club previously landed in the full application with no
-- logo, no venue, no pitch and no confirmed team list, and nothing asked it
-- to fix that. This adds the lifecycle that does.
--
-- ONBOARDING IS ORCHESTRATION, NOT OWNERSHIP. The only thing stored here is
-- how far setup has got. The club's profile lives in `clubs`, its logo in
-- storage, its kit in `club_kits`, its venues in `venues`, its pitches in
-- `club_pitches` and its teams in `teams` -- exactly where they lived
-- before, and exactly where they are edited afterwards. Deleting every row
-- in `club_setup_state` would lose progress and no operational data.
--
-- Three parts:
--   1. structured venue address (the gap the last pass recorded)
--   2. the setup lifecycle itself
--   3. safe team removal during setup

-- =====================================================================
-- 1. Structured venue address
-- =====================================================================

-- `venues.address` was one opaque text line while `profiles` and
-- `club_directory` both carry proper structured fields. Cementing a new
-- mandatory setup flow onto the weaker model would have been the wrong
-- moment to leave it.
--
-- Additive only. The legacy column is KEPT and keeps its meaning: it is the
-- display/legacy line, still written by every existing caller, still read by
-- every existing surface. Nothing is rewritten and no structured component
-- is invented by parsing an old string -- guessing that "Coal Clough Lane,
-- Burnley" splits into a line and a town is exactly the fabrication the
-- brief forbids. Old venues keep an opaque address until a human edits them.
alter table public.venues add column if not exists address_line_1 text;
alter table public.venues add column if not exists address_line_2 text;
alter table public.venues add column if not exists town text;
alter table public.venues add column if not exists county text;
alter table public.venues add column if not exists country text;

-- The provider's own reference for the selected address. Useful for
-- re-resolution; never the venue's identity, which is and stays venues.id.
alter table public.venues add column if not exists address_provider_ref text;

comment on column public.venues.address is
  'LEGACY/display address line. Retained deliberately: every pre-existing venue has only this, and no structured component is ever fabricated from it. New and edited venues populate address_line_1..country alongside it.';
comment on column public.venues.address_provider_ref is
  'The address provider''s reference for the selected result. A convenience for re-resolution -- never the venue''s identity, which is venues.id.';

-- One canonical writer for a structured venue address, so onboarding, Club
-- Settings and Site Admin cannot drift into three shapes.
create or replace function public.set_venue_address(
  p_venue_id uuid,
  p_line1 text,
  p_line2 text,
  p_town text,
  p_county text,
  p_postcode text,
  p_country text default 'United Kingdom',
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_provider_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.venues where id = p_venue_id;
  if v_club is null then
    raise exception 'No such venue.';
  end if;

  if not (internal.has_capability('club.venues.manage', 'club', v_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to change this venue.' using errcode = '42501';
  end if;

  update public.venues
  set address_line_1 = nullif(btrim(p_line1), ''),
      address_line_2 = nullif(btrim(p_line2), ''),
      town = nullif(btrim(p_town), ''),
      county = nullif(btrim(p_county), ''),
      postcode = nullif(btrim(p_postcode), ''),
      country = coalesce(nullif(btrim(p_country), ''), 'United Kingdom'),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      address_provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), address_provider_ref),
      -- The display line is regenerated from the structured parts, so the
      -- legacy column stays truthful rather than becoming stale.
      address = nullif(concat_ws(', ',
        nullif(btrim(p_line1), ''), nullif(btrim(p_line2), ''),
        nullif(btrim(p_town), ''), nullif(btrim(p_county), '')), ''),
      updated_by = auth.uid()
  where id = p_venue_id;
end;
$$;

revoke execute on function public.set_venue_address(uuid, text, text, text, text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.set_venue_address(uuid, text, text, text, text, text, text, numeric, numeric, text) to authenticated;

-- =====================================================================
-- 2. The setup lifecycle
-- =====================================================================

create table if not exists public.club_setup_state (
  club_id uuid primary key references public.clubs(id) on delete cascade,

  status text not null default 'NOT_STARTED',

  -- Which step the club is on. Presentation/resume position only: what
  -- actually gates completion is re-derived from canonical data every time
  -- (see club_setup_requirements), never trusted from here.
  current_step int not null default 1,

  -- The ONE piece of step state that is not derivable from canonical data.
  -- "The team list is correct" is a human judgement -- a club with the right
  -- teams already in place is indistinguishable from one that has never
  -- looked, and Step 3 must not pass merely because rows happen to exist.
  teams_confirmed_at timestamptz,
  teams_confirmed_by uuid references auth.users(id),

  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_setup_state_status_check check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  constraint club_setup_state_step_check check (current_step between 1 and 3),
  constraint club_setup_state_completed_has_time check (status <> 'COMPLETED' or completed_at is not null)
);

comment on table public.club_setup_state is
  'How far a club has got through first-run activation. Owns completion state ONLY -- profile, logo, kit, venues, pitches and teams live in their canonical tables and are unaffected by anything here. current_step is a resume position, never an authorization or a completion proof.';

alter table public.club_setup_state enable row level security;

-- Anyone who can see the club can see whether it is still setting up: the
-- shell needs it to decide what to render for every role, including the
-- bounded "a Club Admin needs to finish this" state shown to a coach.
drop policy if exists club_setup_state_select on public.club_setup_state;
create policy club_setup_state_select on public.club_setup_state
  for select using (
    internal.is_site_admin()
    or exists (
      select 1 from public.club_memberships cm
      where cm.club_id = club_setup_state.club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )
    or exists (
      select 1 from public.team_permissions tp
      join public.club_memberships cm2 on cm2.id = tp.membership_id
      where cm2.user_id = auth.uid() and cm2.club_id = club_setup_state.club_id
    )
  );

-- No write policy: every transition is a function.

drop trigger if exists set_updated_at on public.club_setup_state;
create trigger set_updated_at
  before update on public.club_setup_state
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.club_setup_state;
create trigger audit_row_change
  after insert or update or delete on public.club_setup_state
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- Grandfathering, and what a NEW club gets
-- ---------------------------------------------------------------------

-- Every club that already exists is marked COMPLETED. They have been
-- operating for real -- with fixtures, teams and members -- since before
-- activation setup existed, and gating them into a wizard would lock working
-- clubs out of their own application to satisfy a lifecycle introduced after
-- the fact. Their profile gaps are ordinary Club Settings work, not
-- activation.
insert into public.club_setup_state (club_id, status, current_step, completed_at, started_at)
select c.id, 'COMPLETED', 3, now(), c.created_at
from public.clubs c
on conflict (club_id) do nothing;

comment on column public.club_setup_state.completed_at is
  'When setup finished. For clubs that pre-date this lifecycle it is the migration time -- they were grandfathered as COMPLETED rather than retrospectively gated.';

-- A club approved from here on starts at NOT_STARTED. Re-declared from
-- 20261016 (this file) upward from 20261012000000's version, with one line
-- added; everything else is carried over verbatim.
create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_club_id uuid;
  v_club_name text;
  v_rugby_code text;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim is not pending (current status: %).', v_claim.status;
  end if;

  select c.id, cd.name, cd.rugby_code into v_club_id, v_club_name, v_rugby_code from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.directory_id = v_claim.directory_id;

  if v_club_id is null then
    select cd.name, cd.rugby_code into v_club_name, v_rugby_code from public.club_directory cd where cd.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, internal.generate_club_slug(v_club_name), 'active', auth.uid(), auth.uid())
    returning id into v_club_id;

    -- A genuinely new club has not been set up yet. An existing club being
    -- re-claimed keeps whatever state it already had.
    insert into public.club_setup_state (club_id, status, current_step)
    values (v_club_id, 'NOT_STARTED', 1)
    on conflict (club_id) do nothing;
  end if;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_club_id, v_claim.claimant_user_id, 'CLUB_ADMIN', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set role = 'CLUB_ADMIN', status = 'active', updated_by = auth.uid();

  perform internal.seed_teams_from_proposal(v_club_id, v_rugby_code, v_claim.proposed_teams);

  perform internal.reconcile_partner_invitations(v_claim.directory_id, v_club_id, v_claim.created_at);

  perform internal.begin_club_platform_trial(v_club_id);

  update public.club_claims
  set status = 'verified', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_approved',
    'Club claim approved',
    format('Your access to %s has been approved.', v_club_name),
    jsonb_build_object('club_id', v_club_id, 'claim_id', p_claim_id)
  );

  return v_club_id;
end;
$$;

revoke execute on function public.approve_club_claim(uuid, text) from public;

-- ---------------------------------------------------------------------
-- Requirements -- re-derived from canonical data, never stored
-- ---------------------------------------------------------------------

-- The single source of "is this club set up". Completion, gating and the
-- wizard's own progress display all call THIS, so they cannot disagree, and
-- a requirement that stops being met after a step was passed is noticed.
create or replace function public.club_setup_requirements(p_club_id uuid)
returns table (
  has_logo boolean,
  has_primary_kit boolean,
  has_default_venue boolean,
  default_venue_has_address boolean,
  default_venue_has_pitch boolean,
  teams_confirmed boolean,
  step1_complete boolean,
  step2_complete boolean,
  step3_complete boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_default uuid;
  v_logo boolean;
  v_kit boolean;
  v_addr boolean;
  v_pitch boolean;
  v_teams boolean;
begin
  -- Readable by anyone who can see the club: the shell renders a different
  -- bounded state for a non-admin, and needs to know why.
  if not (internal.is_site_admin() or exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
  )) then
    raise exception 'Not authorized to read this club''s setup state.' using errcode = '42501';
  end if;

  select (c.logo_storage_path is not null and btrim(c.logo_storage_path) <> '')
  into v_logo from public.clubs c where c.id = p_club_id;

  select exists (
    select 1 from public.club_kits k where k.club_id = p_club_id and k.variant = 'primary'
  ) into v_kit;

  select v.id into v_default
  from public.venues v
  where v.club_id = p_club_id and v.is_default_home = true and v.active = true
  limit 1;

  -- A structured address OR a legacy display line both count: an existing
  -- club whose venue predates the structured columns must not be told its
  -- address is missing.
  select v_default is not null and exists (
    select 1 from public.venues v
    where v.id = v_default
      and coalesce(nullif(btrim(v.postcode), ''), '') <> ''
      and (
        coalesce(nullif(btrim(v.address_line_1), ''), '') <> ''
        or coalesce(nullif(btrim(v.address), ''), '') <> ''
      )
  ) into v_addr;

  select v_default is not null and exists (
    select 1 from public.club_pitches p
    where p.venue_id = v_default and p.active = true
  ) into v_pitch;

  select s.teams_confirmed_at is not null into v_teams
  from public.club_setup_state s where s.club_id = p_club_id;

  has_logo := coalesce(v_logo, false);
  has_primary_kit := coalesce(v_kit, false);
  has_default_venue := v_default is not null;
  default_venue_has_address := coalesce(v_addr, false);
  default_venue_has_pitch := coalesce(v_pitch, false);
  teams_confirmed := coalesce(v_teams, false);

  step1_complete := has_logo and has_primary_kit;
  step2_complete := has_default_venue and default_venue_has_address and default_venue_has_pitch;
  step3_complete := teams_confirmed;

  return next;
end;
$$;

revoke execute on function public.club_setup_requirements(uuid) from public, anon;
grant execute on function public.club_setup_requirements(uuid) to authenticated;

comment on function public.club_setup_requirements is
  'The single source of truth for whether a club is set up. Every requirement is re-derived from canonical data on each call -- nothing is cached in club_setup_state, so a venue deactivated after Step 2 was passed is noticed at completion.';

-- ---------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------

create or replace function internal.assert_club_setup_authority(p_club_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- club.edit_profile is CLUB_ADMIN-only in the capability engine, which is
  -- exactly the authority club setup needs. A Team Admin, coach, parent or
  -- player holds it nowhere, and no context selection confers it.
  if not (internal.has_capability('club.edit_profile', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Only a Club Admin can complete club setup.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function internal.assert_club_setup_authority(uuid) from public, anon, authenticated;

create or replace function public.advance_club_setup(p_club_id uuid, p_step int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.assert_club_setup_authority(p_club_id);

  if p_step is null or p_step < 1 or p_step > 3 then
    raise exception 'Unknown setup step: %.', p_step;
  end if;

  insert into public.club_setup_state (club_id, status, current_step, started_at)
  values (p_club_id, 'IN_PROGRESS', p_step, now())
  on conflict (club_id) do update
  set status = case when public.club_setup_state.status = 'COMPLETED' then 'COMPLETED' else 'IN_PROGRESS' end,
      -- Furthest point reached, so going Back does not lose progress.
      current_step = greatest(public.club_setup_state.current_step, excluded.current_step),
      started_at = coalesce(public.club_setup_state.started_at, now());
end;
$$;

revoke execute on function public.advance_club_setup(uuid, int) from public, anon;
grant execute on function public.advance_club_setup(uuid, int) to authenticated;

-- Step 3's explicit human judgement. Idempotent: confirming twice keeps the
-- first confirmation rather than moving the timestamp.
create or replace function public.confirm_club_teams(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.assert_club_setup_authority(p_club_id);

  insert into public.club_setup_state (club_id, status, current_step, teams_confirmed_at, teams_confirmed_by, started_at)
  values (p_club_id, 'IN_PROGRESS', 3, now(), auth.uid(), now())
  on conflict (club_id) do update
  set teams_confirmed_at = coalesce(public.club_setup_state.teams_confirmed_at, now()),
      teams_confirmed_by = coalesce(public.club_setup_state.teams_confirmed_by, auth.uid()),
      current_step = greatest(public.club_setup_state.current_step, 3),
      status = case when public.club_setup_state.status = 'COMPLETED' then 'COMPLETED' else 'IN_PROGRESS' end;
end;
$$;

revoke execute on function public.confirm_club_teams(uuid) from public, anon;
grant execute on function public.confirm_club_teams(uuid) to authenticated;

-- Completion re-checks EVERYTHING. The client saying "I finished step 3" is
-- not evidence: a venue may have been deactivated, a logo removed or a kit
-- deleted between steps, possibly by a second admin, and completing on a
-- stale step number would activate a club that is not actually set up.
create or replace function public.complete_club_setup(p_club_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_status text;
  v_missing text[] := '{}';
begin
  perform internal.assert_club_setup_authority(p_club_id);

  select status into v_status from public.club_setup_state where club_id = p_club_id for update;

  -- Idempotent: a double-clicked Finish, or a retried request, returns the
  -- same answer instead of failing or completing twice.
  if v_status = 'COMPLETED' then
    return 'already_complete';
  end if;

  select * into r from public.club_setup_requirements(p_club_id);

  if not r.has_logo then v_missing := v_missing || 'a club logo'::text; end if;
  if not r.has_primary_kit then v_missing := v_missing || 'a home kit'::text; end if;
  if not r.has_default_venue then v_missing := v_missing || 'a default home venue'::text; end if;
  if r.has_default_venue and not r.default_venue_has_address then v_missing := v_missing || 'an address for the home venue'::text; end if;
  if r.has_default_venue and not r.default_venue_has_pitch then v_missing := v_missing || 'at least one pitch at the home venue'::text; end if;
  if not r.teams_confirmed then v_missing := v_missing || 'confirmation of the team list'::text; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Club setup is not finished. Still needed: %.', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  insert into public.club_setup_state (club_id, status, current_step, completed_at, completed_by, started_at)
  values (p_club_id, 'COMPLETED', 3, now(), auth.uid(), now())
  on conflict (club_id) do update
  set status = 'COMPLETED',
      current_step = 3,
      completed_at = coalesce(public.club_setup_state.completed_at, now()),
      completed_by = coalesce(public.club_setup_state.completed_by, auth.uid());

  return 'completed';
end;
$$;

revoke execute on function public.complete_club_setup(uuid) from public, anon;
grant execute on function public.complete_club_setup(uuid) to authenticated;

comment on function public.complete_club_setup is
  'Finishes club activation. Re-validates every requirement from canonical data first -- a stale step number or a client claim is never sufficient. Idempotent: completing an already-complete club returns ''already_complete'' rather than failing.';

-- =====================================================================
-- 3. Safe team removal during setup
-- =====================================================================

-- Classifies a team as PRISTINE or REFERENCED by scanning every foreign key
-- that points at public.teams -- dynamically, from the catalogue, rather
-- than from a hand-written list. There are 31 such columns today and a
-- future migration will add more; a list would silently stop protecting the
-- table the moment someone forgot to update it.
create or replace function public.classify_team_removal(p_team_id uuid)
returns table (classification text, blocking_references jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_club uuid;
  r record;
  v_count bigint;
  v_refs jsonb := '{}'::jsonb;
begin
  select club_id into v_club from public.teams where id = p_team_id;
  if v_club is null then
    raise exception 'No such team.';
  end if;

  perform internal.assert_club_setup_authority(v_club);

  for r in
    select con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.contype = 'f'
      and con.confrelid = 'public.teams'::regclass
      -- team_season_identity is a projection OF the team, not evidence that
      -- anything happened to it: it is regenerated per season and would
      -- otherwise make every team look referenced from the moment it exists.
      and con.conrelid <> 'public.team_season_identity'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col)
      into v_count using p_team_id;
    if v_count > 0 then
      v_refs := v_refs || jsonb_build_object(r.tbl || '.' || r.col, v_count);
    end if;
  end loop;

  classification := case when v_refs = '{}'::jsonb then 'pristine' else 'referenced' end;
  blocking_references := v_refs;
  return next;
end;
$$;

revoke execute on function public.classify_team_removal(uuid) from public, anon;
grant execute on function public.classify_team_removal(uuid) to authenticated;

-- Removes a team during setup, choosing the safe operation for its actual
-- state. The UI says "Remove"; the server decides what that means.
--
-- A genuinely pristine team -- created moments ago by team seeding, touched
-- by nothing -- can be deleted outright, because there is no history to
-- lose. Anything with a single reference is folded instead. Onboarding never
-- becomes a route to cascade-delete fixtures, memberships or attendance.
create or replace function public.remove_setup_team(p_team_id uuid, p_reason text default 'Removed during club setup')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
  v_class text;
begin
  select club_id into v_club from public.teams where id = p_team_id;
  if v_club is null then
    raise exception 'No such team.';
  end if;

  perform internal.assert_club_setup_authority(v_club);

  select classification into v_class from public.classify_team_removal(p_team_id);

  if v_class = 'pristine' then
    delete from public.teams where id = p_team_id;
    return 'deleted';
  end if;

  update public.teams
  set active = false,
      folded_at = coalesce(folded_at, now()),
      folded_by = coalesce(folded_by, auth.uid()),
      fold_reason = coalesce(fold_reason, p_reason),
      updated_by = auth.uid()
  where id = p_team_id;

  return 'folded';
end;
$$;

revoke execute on function public.remove_setup_team(uuid, text) from public, anon;
grant execute on function public.remove_setup_team(uuid, text) to authenticated;

comment on function public.remove_setup_team is
  'Removes a team during club setup. Hard-deletes ONLY a team with no reference from any foreign key pointing at public.teams (scanned from the catalogue, so new references are covered automatically); anything else is folded through the canonical lifecycle. Onboarding never cascade-deletes sporting history.';
