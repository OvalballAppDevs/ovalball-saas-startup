-- Mini-Rugby Shared Calendars: a SCHEDULING/CALENDAR GROUP concept, never
-- a merge of real teams. U6/U7/U8 remain stable canonical team entities --
-- fixtures, stats, results, and age-grade identity all still belong to the
-- real team. A scheduling_group is purely a discovery/booking convenience:
-- "these teams share one advertised calendar" -- resolving to a real
-- team_id is still mandatory before a normal recordable fixture is
-- confirmed (see accept_fixture_request below).
--
-- internal.age_fixture_band() already collapses U6/U7/U8 into one
-- compatible tag-rugby band at the DB trigger level (enforce_fixture_age_
-- eligibility, unchanged by this migration) -- U9 and above, and the
-- strict U9-U16 same-age rule, are completely untouched.

create table public.scheduling_groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  -- Auto-generated from the member teams' distinct age_group values
  -- (e.g. "U6/U7", "U7/U8", "U6/U7/U8") -- never a name typed by a user,
  -- so it can never drift from what the group actually contains.
  display_tag text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.scheduling_groups is
  'A shared-availability advertising group for mini-rugby (U6-U8 only) -- never a replacement team. See scheduling_group_members for its real, independently-tracked member teams.';

create table public.scheduling_group_members (
  group_id uuid not null references public.scheduling_groups(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (group_id, team_id)
);

comment on table public.scheduling_group_members is
  'The real, canonical teams a scheduling group advertises together. Never a substitute for the team_id a confirmed fixture actually needs.';

create index scheduling_groups_club_id_idx on public.scheduling_groups (club_id);
create index scheduling_group_members_team_id_idx on public.scheduling_group_members (team_id);

alter table public.scheduling_groups enable row level security;
alter table public.scheduling_group_members enable row level security;

-- Read: broad, like club_pitches -- an opposing club needs to see the tag
-- and member teams to make sense of a search result / booking request.
create policy scheduling_groups_select on public.scheduling_groups for select using (true);
create policy scheduling_group_members_select on public.scheduling_group_members for select using (true);

-- Write: RPC-only (create_scheduling_group / set_scheduling_group_members /
-- set_scheduling_group_active below) -- no direct table insert/update
-- policy, matching club_pitches' own "one RPC surface, no parallel path"
-- reasoning, and letting every write centrally re-validate the U6-U8-only
-- combination rule.

create trigger set_updated_at before update on public.scheduling_groups
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update on public.scheduling_groups
  for each row execute function internal.audit_row_change();

-- ============================================================
-- internal.mini_rugby_display_tag: computes the auto-generated tag from a
-- set of team_ids -- the SAME logic used by both create and edit, so the
-- displayed tag can never drift from the actual membership.
-- ============================================================

create or replace function internal.mini_rugby_display_tag(p_team_ids uuid[])
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(age_group, '/' order by
    case age_group when 'U6' then 1 when 'U7' then 2 when 'U8' then 3 end
  )
  from (select distinct age_group from public.teams where id = any(p_team_ids)) t;
$$;

-- ============================================================
-- internal.validate_mini_rugby_team_set: shared validation for create and
-- edit -- every team belongs to the given club, every age_group is one of
-- U6/U7/U8 (never U9+, matching "never crossing into unrelated ages"), and
-- at least 2 DISTINCT ages are represented (the whole point of a shared
-- calendar is combining different mini-rugby ages -- U6-8 only, this is
-- content ADVERTISING, not a same-age squad list).
-- ============================================================

create or replace function internal.validate_mini_rugby_team_set(p_club_id uuid, p_team_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bad_club_count integer;
  v_bad_age_count integer;
  v_distinct_age_count integer;
begin
  if array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) < 1 then
    raise exception 'Select at least one team.';
  end if;

  select count(*) into v_bad_club_count from public.teams where id = any(p_team_ids) and club_id <> p_club_id;
  if v_bad_club_count > 0 then
    raise exception 'Every team in a shared calendar must belong to this club.';
  end if;

  if (select count(*) from public.teams where id = any(p_team_ids)) <> array_length(p_team_ids, 1) then
    raise exception 'One or more selected teams could not be found.';
  end if;

  select count(*) into v_bad_age_count from public.teams where id = any(p_team_ids) and age_group not in ('U6', 'U7', 'U8');
  if v_bad_age_count > 0 then
    raise exception 'Mini-rugby shared calendars only support U6, U7, and U8 -- never U9 or above.';
  end if;

  select count(distinct age_group) into v_distinct_age_count from public.teams where id = any(p_team_ids);
  if v_distinct_age_count < 2 then
    raise exception 'A shared calendar must combine at least two different ages within U6-U8 (e.g. U7/U8).';
  end if;
end;
$$;

-- ============================================================
-- create_scheduling_group / set_scheduling_group_members /
-- set_scheduling_group_active -- same can_manage_club_fixtures authority
-- as club_pitches, and the same "audit_row_change already covers it, no
-- bespoke audit table" reasoning.
-- ============================================================

create or replace function public.create_scheduling_group(p_club_id uuid, p_team_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tag text;
begin
  if not internal.can_manage_club_fixtures(p_club_id) then
    raise exception 'Not authorized to manage this club''s shared calendars.' using errcode = '42501';
  end if;
  perform internal.validate_mini_rugby_team_set(p_club_id, p_team_ids);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  insert into public.scheduling_groups (club_id, display_tag, created_by)
  values (p_club_id, v_tag, auth.uid())
  returning id into v_id;

  insert into public.scheduling_group_members (group_id, team_id)
  select v_id, unnest(p_team_ids);

  return v_id;
end;
$$;

create or replace function public.set_scheduling_group_members(p_group_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_tag text;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Shared calendar not found.';
  end if;
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s shared calendars.' using errcode = '42501';
  end if;
  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  delete from public.scheduling_group_members where group_id = p_group_id;
  insert into public.scheduling_group_members (group_id, team_id)
  select p_group_id, unnest(p_team_ids);

  update public.scheduling_groups set display_tag = v_tag, updated_by = auth.uid() where id = p_group_id;
end;
$$;

create or replace function public.set_scheduling_group_active(p_group_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Shared calendar not found.';
  end if;
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s shared calendars.' using errcode = '42501';
  end if;

  update public.scheduling_groups set active = p_active, updated_by = auth.uid() where id = p_group_id;
end;
$$;

revoke execute on function public.create_scheduling_group(uuid, uuid[]) from public;
revoke execute on function public.set_scheduling_group_members(uuid, uuid[]) from public;
revoke execute on function public.set_scheduling_group_active(uuid, boolean) from public;
grant execute on function public.create_scheduling_group(uuid, uuid[]) to authenticated;
grant execute on function public.set_scheduling_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.set_scheduling_group_active(uuid, boolean) to authenticated;

-- ============================================================
-- search_scheduling_groups: discovery -- ACTIVE shared calendars whose
-- member teams are eligible against the caller's own requesting team (the
-- same internal.teams_can_play_fixture the DB trigger itself enforces, so
-- a search result can never promise a match the real confirm step would
-- then reject), excluding the requester's own club.
-- ============================================================

create or replace function public.search_scheduling_groups(p_requesting_team_id uuid)
returns table(
  group_id uuid,
  club_id uuid,
  club_name text,
  display_tag text,
  member_team_id uuid,
  member_team_name text,
  member_age_group text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_my_club_id uuid;
begin
  select t.club_id into v_my_club_id from public.teams t where t.id = p_requesting_team_id;
  if v_my_club_id is null then
    raise exception 'Team not found.';
  end if;

  return query
  select sg.id, sg.club_id, cd.name, sg.display_tag, t.id, t.display_name, t.age_group
  from public.scheduling_groups sg
  join public.clubs c on c.id = sg.club_id
  join public.club_directory cd on cd.id = c.directory_id
  join public.scheduling_group_members sgm on sgm.group_id = sg.id
  join public.teams t on t.id = sgm.team_id
  where sg.active
    and sg.club_id <> v_my_club_id
    and exists (
      select 1 from public.scheduling_group_members sgm2
      join public.teams t2 on t2.id = sgm2.team_id
      where sgm2.group_id = sg.id and internal.teams_can_play_fixture(p_requesting_team_id, t2.id)
    )
  order by cd.name, sg.display_tag, t.age_group;
end;
$$;

grant execute on function public.search_scheduling_groups(uuid) to authenticated;

comment on function public.search_scheduling_groups(uuid) is
  'One row per (group, member team) so the caller can render "Club / Tag / Shared calendar: A + B" and also has each real member team on hand for later resolution -- never returns a fake combined team.';

-- ============================================================
-- get_scheduling_group_availability: same partnership-gated shape as
-- get_partner_team_availability, but a date is "unavailable" only if
-- EVERY member team is booked that day (the calendar aggregates
-- availability across members -- one member being free is enough to book
-- against the shared calendar).
-- ============================================================

create or replace function public.get_scheduling_group_availability(p_group_id uuid, p_from date, p_to date)
returns table(fixture_date date, availability text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_partner_club_id uuid;
  v_member_count integer;
begin
  select club_id into v_partner_club_id from public.scheduling_groups where id = p_group_id and active;
  if v_partner_club_id is null then
    raise exception 'Shared calendar not found.';
  end if;

  if not exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      and ((cp.requesting_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.partner_club_id))
        or (cp.partner_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.requesting_club_id)))
  ) and not internal.is_site_admin() then
    raise exception 'No active calendar-sharing agreement with this club.' using errcode = '42501';
  end if;

  select count(*) into v_member_count from public.scheduling_group_members where group_id = p_group_id;

  return query
  select f.kickoff_date, 'unavailable'::text
  from public.fixtures f
  join public.scheduling_group_members sgm on sgm.team_id = f.owning_team_id and sgm.group_id = p_group_id
  where f.kickoff_date between p_from and p_to
    and f.status not in ('Cancelled')
  group by f.kickoff_date
  having count(distinct f.owning_team_id) >= v_member_count;
end;
$$;

grant execute on function public.get_scheduling_group_availability(uuid, date, date) to authenticated;

-- ============================================================
-- fixture_requests gains a nullable target_scheduling_group_id, parallel
-- to the existing nullable target_team_id -- a request may name a real
-- team (unchanged), a shared calendar (new), or neither (unchanged
-- "unknown opponent, resolve on accept" flow).
-- ============================================================

alter table public.fixture_requests add column target_scheduling_group_id uuid references public.scheduling_groups(id);

comment on column public.fixture_requests.target_scheduling_group_id is
  'Set when this request was made against a shared mini-rugby calendar rather than one specific team -- accept_fixture_request() still requires resolving to a real member team_id before the fixture is confirmed (auto-resolves only when exactly one member is eligible).';

-- ============================================================
-- accept_fixture_request: re-declared with the SAME signature purely to
-- add scheduling-group resolution -- every other line is unchanged from
-- 20260831092000_fixture_requests.sql. A group-targeted request can never
-- be accepted without landing on a real team_id: auto-resolve only when
-- exactly one member is eligible against the requesting team, otherwise
-- the caller must pass p_target_team_id explicitly (never guessed).
-- ============================================================

create or replace function public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_mirror_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  -- A group-targeted request (target_team_id still null, a shared
  -- calendar named instead) must resolve through the scheduling-group
  -- rules below FIRST -- an explicit p_target_team_id is only trusted
  -- once it has been verified as a real, eligible member of that group.
  -- Only once resolved does this fall back to the plain-team coalesce a
  -- non-group request has always used.
  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_req.requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_req.requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      elsif v_eligible_member_count = 1 then
        v_target_team_id := v_auto_resolved_team_id;
      else
        raise exception 'More than one team in this shared calendar is eligible -- select the real team before accepting.' using errcode = 'P0001';
      end if;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
  end if;

  if v_target_team_id is not null then
    select club_id into v_target_club_id from public.teams where id = v_target_team_id;
  else
    v_target_club_id := v_group.opponent_club_id;
  end if;

  if not (internal.is_site_admin()
          or (v_target_team_id is not null and internal.can_manage_team(v_target_team_id))
          or (v_target_club_id is not null and internal.can_manage_club_fixtures(v_target_club_id))) then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  v_requesting_club_venue := case v_req.venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_req.venue_preference
    when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end;

  insert into public.fixtures (
    owning_team_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    created_by, updated_by
  )
  values (
    v_req.requesting_team_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_req.created_by, auth.uid()
  )
  returning id into v_fixture_id;

  if v_target_team_id is not null then
    insert into public.fixtures (
      owning_team_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id,
      created_by, updated_by
    )
    select v_target_team_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_target_venue, 'Booked',
      cd.name, cd.id, v_req.requesting_team_id,
      auth.uid(), auth.uid()
    from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id
    returning id into v_mirror_fixture_id;
  end if;

  update public.fixture_requests
  set status = 'accepted', target_team_id = v_target_team_id,
      resulting_fixture_id = v_fixture_id, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_req.requesting_team_id;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;
