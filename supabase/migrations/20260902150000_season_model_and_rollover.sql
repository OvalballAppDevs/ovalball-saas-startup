-- Rugby-code-specific season windows (reusing the existing public.seasons
-- table, not a new one), fixture-level team-identity snapshots (so a
-- historical fixture's team label never silently changes when the
-- current cohort ages up), and the age-grade rollover review workflow.

-- ============================================================
-- 1. Season windows. seasons already existed (name/starts_on/ends_on) --
--    widened with rugby_code (nullable: existing/legacy rows without a
--    code stay valid) and pre_season_starts_on, since Union and League
--    genuinely run different campaigns rather than one shared calendar.
-- ============================================================

alter table public.seasons
  add column rugby_code text check (rugby_code in ('union', 'league')),
  add column pre_season_starts_on date;

comment on column public.seasons.pre_season_starts_on is
  'Where this campaign''s pre-season begins (main season is starts_on..ends_on as already defined) -- null means no pre-season window is modelled for this row. Union: pre-season 1 Jun, main season 1 Sep-31 May. League: pre-season 1 Nov, main season 1 Mar-31 Oct (including the Feb leap-year boundary, handled by storing real dates, never a hard-coded day count).';

create index seasons_rugby_code_idx on public.seasons (rugby_code) where rugby_code is not null;

-- internal.season_phase: 'pre_season' | 'main_season' | 'out_of_season' for
-- a given date within a given season row -- the one place this
-- calculation lives (training-event validation and any future calendar
-- filter both call this, never re-deriving the window boundaries).
create or replace function internal.season_phase(p_season_id uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_date between s.starts_on and s.ends_on then 'main_season'
    when s.pre_season_starts_on is not null and p_date >= s.pre_season_starts_on and p_date < s.starts_on then 'pre_season'
    else 'out_of_season'
  end
  from public.seasons s where s.id = p_season_id;
$$;

grant execute on function internal.season_phase(uuid, date) to authenticated;

-- internal.resolve_season_for_date: the season row (of the given rugby
-- code) whose pre-season-or-main window contains this date, if any.
create or replace function internal.resolve_season_for_date(p_rugby_code text, p_date date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.seasons
  where rugby_code = p_rugby_code
    and p_date >= coalesce(pre_season_starts_on, starts_on) and p_date <= ends_on
  order by starts_on desc
  limit 1;
$$;

grant execute on function internal.resolve_season_for_date(text, date) to authenticated;

-- ============================================================
-- 2. Fixture-level team-identity snapshot. A fixture is itself the
--    historical record of what a team was called at the time it was
--    played -- capturing the snapshot ON the fixture row (rather than a
--    separate season-registration join every existing fixture query
--    would need to be rewritten to use) means every fixture already ever
--    created is automatically historically correct, and no existing read
--    path needs to change to stay correct going forward.
-- ============================================================

alter table public.fixtures
  add column owning_team_age_group_snapshot text,
  add column owning_team_display_name_snapshot text,
  add column season_id uuid references public.seasons(id);

comment on column public.fixtures.owning_team_age_group_snapshot is
  'The owning team''s age_group AT THE TIME this fixture was created -- never updated afterward, even if the team later rolls over to a new age grade. A 2026/27 U12 A fixture stays historically U12 A regardless of what that cohort is called today.';

create or replace function internal.capture_fixture_team_snapshot()
returns trigger
language plpgsql
as $$
declare
  v_age_group text;
  v_display_name text;
  v_rugby_code text;
begin
  select age_group, display_name, rugby_code into v_age_group, v_display_name, v_rugby_code
  from public.teams where id = new.owning_team_id;
  new.owning_team_age_group_snapshot := v_age_group;
  new.owning_team_display_name_snapshot := v_display_name;
  if new.season_id is null and v_rugby_code is not null then
    new.season_id := internal.resolve_season_for_date(v_rugby_code, new.kickoff_date);
  end if;
  return new;
end;
$$;

create trigger capture_fixture_team_snapshot
  before insert on public.fixtures
  for each row execute function internal.capture_fixture_team_snapshot();

comment on trigger capture_fixture_team_snapshot on public.fixtures is
  'Fires once, at creation -- deliberately BEFORE INSERT only (not UPDATE), since a snapshot that could be silently rewritten on every edit would defeat its own purpose.';

-- ============================================================
-- 3. Rollover workflow. Nothing here mutates a real team until a Club
--    Admin explicitly confirms each proposal -- generate_rollover_
--    proposal only ever reads teams and writes to the two proposal
--    tables below.
-- ============================================================

create table public.age_grade_rollovers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  from_season_id uuid references public.seasons(id),
  to_season_id uuid not null references public.seasons(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.age_grade_rollover_team_proposals (
  id uuid primary key default gen_random_uuid(),
  rollover_id uuid not null references public.age_grade_rollovers(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  current_age_group text not null,
  -- Null when the boundary requires an explicit Club Admin choice (U16 --
  -- "do not invent the club's pathway") rather than a mechanical +1.
  proposed_age_group text,
  requires_manual_choice boolean not null default false,
  decision text not null default 'pending' check (decision in ('pending', 'confirmed', 'folded', 'deferred')),
  decided_age_group text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rollover_id, team_id)
);

create table public.age_grade_rollover_group_flags (
  id uuid primary key default gen_random_uuid(),
  rollover_id uuid not null references public.age_grade_rollovers(id) on delete cascade,
  scheduling_group_id uuid not null references public.scheduling_groups(id),
  reason text not null,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rollover_id, scheduling_group_id)
);

comment on table public.age_grade_rollover_group_flags is
  'A shared mini-rugby group (e.g. U7/U8) whose member-team rollover would carry it outside the U6-U8 band (e.g. one member proposed to U9) -- flagged for explicit Club Admin reconfiguration, NEVER silently rolled forward as an invalid combination like U8/U9.';

alter table public.age_grade_rollovers enable row level security;
alter table public.age_grade_rollover_team_proposals enable row level security;
alter table public.age_grade_rollover_group_flags enable row level security;

create policy age_grade_rollovers_select on public.age_grade_rollovers for select using (internal.can_manage_club_fixtures(club_id) or internal.is_site_admin());
create policy age_grade_rollover_team_proposals_select on public.age_grade_rollover_team_proposals for select
  using (exists (select 1 from public.age_grade_rollovers r where r.id = rollover_id and (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin())));
create policy age_grade_rollover_group_flags_select on public.age_grade_rollover_group_flags for select
  using (exists (select 1 from public.age_grade_rollovers r where r.id = rollover_id and (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin())));

-- Writes are RPC-only below.

-- Deterministic +1 age-grade mapping, U6 through U15 -> next age. U16 is
-- deliberately absent (returns null) -- see requires_manual_choice above.
create or replace function internal.next_age_grade(p_age_group text)
returns text
language sql
immutable
as $$
  select case p_age_group
    when 'U6' then 'U7' when 'U7' then 'U8' when 'U8' then 'U9' when 'U9' then 'U10'
    when 'U10' then 'U11' when 'U11' then 'U12' when 'U12' then 'U13' when 'U13' then 'U14'
    when 'U14' then 'U15' when 'U15' then 'U16'
    else null
  end;
$$;

create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rollover_id uuid;
  v_from_season_id uuid;
  t record;
  v_group record;
  v_would_be_ages text[];
begin
  if not (internal.can_manage_club_fixtures(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select id into v_from_season_id from public.seasons where rugby_code = p_rugby_code and ends_on < (select starts_on from public.seasons where id = p_to_season_id) order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, auth.uid())
  returning id into v_rollover_id;

  for t in
    select id, age_group from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'  -- U6 has no younger feed-in to roll from within this club's own rollover; it stays U6 or is handled as a fresh intake, out of scope here
  loop
    insert into public.age_grade_rollover_team_proposals (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice)
    values (
      v_rollover_id, t.id, t.age_group, internal.next_age_grade(t.age_group),
      internal.next_age_grade(t.age_group) is null
    )
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg where sg.club_id = p_club_id and sg.active
  loop
    -- Aliased "mt" (member team), not "t" -- the loop variable "t" above
    -- stays in scope for the rest of the function and collides with a
    -- same-named SQL alias here (PL/pgSQL raises "column reference is
    -- ambiguous" since "t.id" could mean either), so a second, distinct
    -- alias is required rather than reusing "t".
    select array_agg(distinct internal.next_age_grade(mt.age_group)) into v_would_be_ages
    from public.scheduling_group_members sgm join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id, format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  return v_rollover_id;
end;
$$;

revoke execute on function public.generate_rollover_proposal(uuid, text, uuid) from public;
grant execute on function public.generate_rollover_proposal(uuid, text, uuid) to authenticated;

-- ============================================================
-- confirm_rollover_team_proposal: the ONLY path that actually mutates a
-- real team's age_group -- nothing in generate_rollover_proposal above
-- ever does. 'confirm' applies the mechanical proposal (or a Club-Admin-
-- adjusted destination); 'fold' calls the existing fold_team(); 'defer'
-- records the decision without changing the team at all.
-- ============================================================

create or replace function public.confirm_rollover_team_proposal(
  p_proposal_id uuid, p_action text, p_age_group text default null, p_squad_designation text default null, p_fold_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to confirm this rollover proposal.' using errcode = '42501';
  end if;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%).', p.decision;
  end if;
  if p_action not in ('confirm', 'adjust', 'fold', 'defer') then
    raise exception 'Unknown rollover action: %', p_action;
  end if;

  if p_action = 'confirm' or p_action = 'adjust' then
    v_final_age_group := coalesce(p_age_group, p.proposed_age_group);
    if v_final_age_group is null then
      raise exception 'A destination age group is required -- this team''s rollover has no automatic mapping and needs an explicit choice.';
    end if;
    begin
      update public.teams set age_group = v_final_age_group, squad_designation = coalesce(p_squad_designation, squad_designation) where id = p.team_id;
    exception when unique_violation then
      -- The club already has a distinct team at that exact category/age/
      -- squad combination (e.g. a returning "U13 A" already exists when
      -- last year's "U12 A" tries to roll forward into it) -- a real,
      -- expected collision, not a bug: surface it as an actionable
      -- instruction rather than the raw constraint name.
      raise exception 'This club already has a team at % with the same squad designation. Use Adjust and choose a different squad letter (e.g. a "B" squad) to roll this team forward.', v_final_age_group;
    end;
    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', auth.uid(), jsonb_build_object('age_group', p.current_age_group), jsonb_build_object('age_group', v_final_age_group, 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals set decision = 'folded', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals set decision = 'deferred', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  end if;
end;
$$;

revoke execute on function public.confirm_rollover_team_proposal(uuid, text, text, text, text) from public;
grant execute on function public.confirm_rollover_team_proposal(uuid, text, text, text, text) to authenticated;

create or replace function public.resolve_rollover_group_flag(p_flag_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.age_grade_rollover_group_flags;
  r public.age_grade_rollovers;
begin
  select * into f from public.age_grade_rollover_group_flags where id = p_flag_id for update;
  if not found then raise exception 'Rollover group flag not found.'; end if;
  select * into r from public.age_grade_rollovers where id = f.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to resolve this rollover flag.' using errcode = '42501';
  end if;
  -- Marking resolved is an acknowledgement that the Club Admin has
  -- separately reconfigured the shared group''s membership (via
  -- set_scheduling_group_members, or deactivated it) -- this RPC never
  -- reconfigures the group itself, matching "require Club Admin to choose
  -- the valid new structure" rather than guessing one.
  update public.age_grade_rollover_group_flags set resolved = true, resolved_by = auth.uid(), resolved_at = now() where id = p_flag_id;
end;
$$;

revoke execute on function public.resolve_rollover_group_flag(uuid) from public;
grant execute on function public.resolve_rollover_group_flag(uuid) to authenticated;
