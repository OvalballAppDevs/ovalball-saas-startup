-- Upgrades the mini-rugby scheduling_groups from "shared calendar" to a
-- genuine shared OPERATIONAL fixture identity, per the refined
-- requirement: one shared-team booking is ONE fixture commitment, and a
-- shared group may hold only one match on a given date across ALL of its
-- component teams (never double-booked because U7 and U8 look
-- independently free). The underlying U6/U7/U8 teams are never merged,
-- deleted, or faked into a synthetic "U7/U8" teams row -- fixtures.
-- owning_team_id keeps pointing at one real, existing member team (the
-- group's "lead" team for that booking); owning_scheduling_group_id is
-- purely a metadata tag identifying that the booking was made through the
-- shared group, driving both the capacity check below and the "Scheduled
-- via U7/U8 Shared Team" UI treatment. This is a deliberately narrower
-- schema change than making fixtures.owning_team_id nullable in favour of
-- a first-class shared_team_id foreign key -- owning_team_id touches RLS,
-- stats, and every fixture query in this codebase, and every one of those
-- already works correctly for a real team id; widening the blast radius
-- of that column was judged the wrong trade-off for this pass.

alter table public.fixtures add column owning_scheduling_group_id uuid references public.scheduling_groups(id);

comment on column public.fixtures.owning_scheduling_group_id is
  'Set only when this fixture was booked FOR a shared mini-rugby group rather than one component team directly. owning_team_id still holds a real, existing member team (the group''s lead for this booking) -- age eligibility, RLS, and team_result_stats all keep working unchanged. Never a synthetic team.';

alter table public.fixture_requests add column requesting_scheduling_group_id uuid references public.scheduling_groups(id);

comment on column public.fixture_requests.requesting_scheduling_group_id is
  'Mirrors target_scheduling_group_id -- set when the REQUESTING side is booking as a shared group rather than one specific team.';

-- ============================================================
-- Capacity trigger: a real, unbypassable scheduling boundary. Any fixture
-- whose owning_team_id belongs to an ACTIVE scheduling group (or whose
-- owning_scheduling_group_id names one directly) conflicts with any OTHER
-- fixture, on the SAME kickoff_date, whose owning_team_id is ALSO a
-- member of that same group (or which names that same group). This
-- covers every path a fixture can be created through (accept_fixture_
-- request, CSV import, direct admin creation, a future festival/event
-- flow) -- the check lives on the table, not in one RPC.
-- ============================================================

create or replace function internal.enforce_shared_team_fixture_capacity()
returns trigger
language plpgsql
as $$
declare
  v_group_id uuid;
  v_conflict_count integer;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  for v_group_id in
    select sg.id from public.scheduling_groups sg
    where sg.active
      and (sg.id = new.owning_scheduling_group_id
           or exists (select 1 from public.scheduling_group_members sgm where sgm.group_id = sg.id and sgm.team_id = new.owning_team_id))
  loop
    select count(*) into v_conflict_count
    from public.fixtures f
    where f.id <> new.id
      and f.kickoff_date = new.kickoff_date
      and f.status <> 'Cancelled'
      and (
        f.owning_scheduling_group_id = v_group_id
        or exists (select 1 from public.scheduling_group_members sgm where sgm.group_id = v_group_id and sgm.team_id = f.owning_team_id)
      );

    if v_conflict_count > 0 then
      raise exception 'This shared mini-rugby team already has a fixture commitment on %. A shared group may hold only one match per day across all of its member teams.', new.kickoff_date
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

create trigger enforce_shared_team_fixture_capacity
  before insert or update on public.fixtures
  for each row execute function internal.enforce_shared_team_fixture_capacity();

comment on trigger enforce_shared_team_fixture_capacity on public.fixtures is
  'The real, database-level "one fixture per shared mini-rugby group per day" boundary -- fires on every insert/update regardless of path, matching enforce_fixture_age_eligibility''s own "no bypass" pattern. A genuine multi-team festival/event needs a separate explicit event model, not a normal fixture row -- out of scope for this trigger by design.';

-- ============================================================
-- accept_fixture_request: re-declared with the SAME signature purely to
-- resolve a requesting_scheduling_group_id (mirroring the existing
-- target_scheduling_group_id resolution) into a real lead member team +
-- owning_scheduling_group_id tag on the created fixture row(s). Every
-- other line unchanged from 20260902100000_fixture_mirror_sync.sql.
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
  v_requesting_team_id uuid;
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

  -- Requesting side: a real team id already, or resolve the shared
  -- group's own lead (first by sort order... scheduling_group_members has
  -- no sort_order of its own, so lowest team_id is used purely as a
  -- stable, deterministic tie-break -- never a random pick).
  if v_req.requesting_team_id is not null then
    v_requesting_team_id := v_req.requesting_team_id;
  else
    select min(team_id) into v_requesting_team_id from public.scheduling_group_members where group_id = v_req.requesting_scheduling_group_id;
    if v_requesting_team_id is null then
      raise exception 'This shared calendar has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

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
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    created_by, updated_by
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_req.created_by, auth.uid()
  )
  returning id into v_fixture_id;

  if v_target_team_id is not null then
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id,
      created_by, updated_by
    )
    select v_target_team_id, v_req.target_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_target_venue, 'Booked',
      cd.name, cd.id, v_requesting_team_id,
      auth.uid(), auth.uid()
    from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id
    returning id into v_mirror_fixture_id;

    update public.fixtures set mirror_fixture_id = v_mirror_fixture_id where id = v_fixture_id;
    update public.fixtures set mirror_fixture_id = v_fixture_id where id = v_mirror_fixture_id;
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
  where tp.team_id = v_requesting_team_id;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;
