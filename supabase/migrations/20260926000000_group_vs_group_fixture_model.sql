-- GROUP-VS-GROUP CANONICAL FIXTURE DATA MODEL
--
-- Prior limitation (confirmed by inspection, not assumed): a fixture's
-- OWNING side has always been able to be a Mini-Rugby Group
-- (owning_team_id as a real anchor/representative member + owning_
-- scheduling_group_id as the group truth, expanded by internal.
-- expand_scheduling_group / public.get_effective_fixture_team_ids). The
-- OPPONENT side has never had an equivalent column at all -- fixtures has
-- opponent_team_id/opponent_directory_id only. accept_fixture_request
-- (20260904600000, last redefined 20260914000000) already lets a
-- REQUEST name a target_scheduling_group_id, but only ever uses it to
-- auto-match ONE eligible member team, then discards the group identity
-- entirely -- if more than one member is eligible it refuses to proceed
-- ("select the real team before accepting"). So even ordinary TEAM vs
-- GROUP has never actually been representable on a fixture row; it has
-- always silently collapsed to TEAM vs TEAM at acceptance time.
--
-- This migration extends the SAME canonical row/columns rather than
-- introducing a second architecture: adds the opponent-side mirror of
-- owning_scheduling_group_id, extends the existing group-validity and
-- same-day-capacity triggers to cover it, and updates accept_fixture_
-- request so a target group is preserved rather than discarded. The
-- Master Fixture Registry invariant (one confirmed match = one fixtures
-- row, per 20260904600000's consolidation -- mirror_fixture_id is
-- legacy-only, that code path has not created a new pair since) is
-- untouched: this migration adds no new fixture-creation path and no
-- second row shape.

-- ============================================================
-- 1. opponent_scheduling_group_id -- the exact mirror of owning_
--    scheduling_group_id on the opponent side. opponent_team_id remains
--    the required real anchor/representative team (same compatibility
--    pattern the owning side already uses -- every existing consumer
--    that reads opponent_team_id alone keeps seeing a real team, never
--    null-because-it's-actually-a-group); opponent_scheduling_group_id
--    is the group truth a caller must additionally consult (via the new
--    resolver in step 5) to get the full component set. Mutually
--    exclusive with opponent_directory_id (an unclaimed external club
--    can never have an Ovalball Mini-Rugby Group -- see step 3) and
--    requires opponent_team_id to be set (no group without a real
--    anchor member).
-- ============================================================

alter table public.fixtures
  add column opponent_scheduling_group_id uuid references public.scheduling_groups(id);

alter table public.fixtures
  add constraint fixtures_opponent_group_requires_team
  check (opponent_scheduling_group_id is null or opponent_team_id is not null);

alter table public.fixtures
  add constraint fixtures_opponent_group_excludes_directory
  check (opponent_scheduling_group_id is null or opponent_directory_id is null);

create index fixtures_opponent_scheduling_group_id_idx on public.fixtures (opponent_scheduling_group_id) where opponent_scheduling_group_id is not null;

comment on column public.fixtures.opponent_scheduling_group_id is
  'Group-vs-group model: the opponent side''s Mini-Rugby Group, when the opponent is a shared group rather than one operational team. Mirrors owning_scheduling_group_id exactly. opponent_team_id stays populated with one real member of this group (the anchor/representative, always a genuine member -- enforced by enforce_fixture_group_participant_validity) so every existing consumer of opponent_team_id continues to see a real team unchanged. Null for an ordinary single-team or unclaimed-club opponent.';

-- ============================================================
-- 2. internal.fixture_side_effective_team_ids: the one shared building
--    block behind both the group-validity trigger below and the new
--    public resolver in step 5 -- given an anchor team_id and an
--    optional group_id, returns the real component team_ids for that
--    side. Identical rule to internal.expand_scheduling_group /
--    effectiveTeamIdsForFixtureSide (lib/mini-rugby/effective-teams.ts):
--    no group -> [anchor]; group with members -> exactly those members;
--    group somehow empty -> [anchor] (never a silent "everyone this
--    age" wildcard).
-- ============================================================

create or replace function internal.fixture_side_effective_team_ids(p_anchor_team_id uuid, p_group_id uuid)
returns uuid[]
language sql
stable
as $$
  select case
    when p_group_id is null then array[p_anchor_team_id]
    else (
      select case when array_length(m, 1) > 0 then m else array[p_anchor_team_id] end
      from (select internal.expand_scheduling_group(p_group_id) as m) x
    )
  end;
$$;

comment on function internal.fixture_side_effective_team_ids is
  'Shared building block: real component team_ids for ONE fixture side (anchor team + optional group). Used by both the group-validity/self-conflict trigger and the canonical get_effective_fixture_participants resolver so the two never drift apart.';

-- ============================================================
-- 3. internal.validate_fixture_group_participant: real, season-bound
--    group validity (Section 5) -- group exists, belongs to the SAME
--    club as its anchor team (never a cross-club participant
--    substitution), the anchor is itself a genuine member (never an
--    arbitrary team standing in for a group it doesn't belong to), the
--    group is active (never a closed/historical group silently reused),
--    the kickoff date falls within the group's own season window (never
--    a future fixture on a current-season group or vice versa -- date-
--    range containment against the group's real season row, not a
--    fragile equality check against fixtures.season_id, which is
--    resolved by a separate trigger with no guaranteed ordering against
--    this one), and every current member is still an active team (a
--    team folded after joining the group must not silently keep
--    committing it to fixtures -- same principle as the Player Request
--    domain's folded-source-team check).
-- ============================================================

create or replace function internal.validate_fixture_group_participant(p_anchor_team_id uuid, p_group_id uuid, p_kickoff_date date, p_side text)
returns void
language plpgsql
stable
as $$
declare
  g public.scheduling_groups;
  v_season public.seasons;
  v_anchor_club uuid;
  v_is_member boolean;
  v_inactive_member_count integer;
begin
  select * into g from public.scheduling_groups where id = p_group_id;
  if not found then
    raise exception '% Mini-Rugby Group could not be found.', p_side using errcode = '23514';
  end if;

  select club_id into v_anchor_club from public.teams where id = p_anchor_team_id;
  if v_anchor_club is null or v_anchor_club <> g.club_id then
    raise exception '% Mini-Rugby Group does not belong to the same club as its anchor team.', p_side using errcode = '23514';
  end if;

  select exists(select 1 from public.scheduling_group_members where group_id = p_group_id and team_id = p_anchor_team_id) into v_is_member;
  if not v_is_member then
    raise exception '% fixture anchor team is not actually a member of the referenced Mini-Rugby Group.', p_side using errcode = '23514';
  end if;

  if not g.active then
    raise exception '% Mini-Rugby Group is closed/inactive and cannot be used for a new fixture.', p_side using errcode = '23514';
  end if;

  select * into v_season from public.seasons where id = g.season_id;
  if not found or p_kickoff_date < coalesce(v_season.pre_season_starts_on, v_season.starts_on) or p_kickoff_date > v_season.ends_on then
    raise exception '% Mini-Rugby Group belongs to a different season than this fixture''s kickoff date -- a historical or future group cannot be silently reused.', p_side using errcode = '23514';
  end if;

  select count(*) into v_inactive_member_count
  from public.scheduling_group_members sgm join public.teams t on t.id = sgm.team_id
  where sgm.group_id = p_group_id and not t.active;
  if v_inactive_member_count > 0 then
    raise exception '% Mini-Rugby Group has a folded/inactive component team and cannot be used for a new fixture until its composition is reviewed.', p_side using errcode = '23514';
  end if;
end;
$$;

comment on function internal.validate_fixture_group_participant is
  'Section 5: real, season-bound Mini-Rugby Group validity for a fixture side. Raises with the side label (Home/Away/Owning/Opponent, as passed by the caller) so a rejection is diagnosable. STABLE, no writes -- called from the BEFORE INSERT/UPDATE trigger below.';

-- ============================================================
-- 4. enforce_fixture_group_participant_validity: the trigger wiring
--    step 3 to both real fixture sides, PLUS the same-effective-team-
--    both-sides invariant (Section 7). Named to sort alphabetically
--    after enforce_fixture_age_eligibility and before enforce_shared_
--    team_fixture_capacity among fixtures' existing BEFORE INSERT
--    triggers, so a structurally invalid group reference is rejected
--    before the (also being extended, step 6) capacity/conflict check
--    ever runs against it.
-- ============================================================

create or replace function internal.enforce_fixture_group_participant_validity()
returns trigger
language plpgsql
as $$
declare
  v_owning_ids uuid[];
  v_opponent_ids uuid[];
begin
  if new.owning_scheduling_group_id is not null then
    perform internal.validate_fixture_group_participant(new.owning_team_id, new.owning_scheduling_group_id, new.kickoff_date, 'Owning');
  end if;

  if new.opponent_scheduling_group_id is not null then
    perform internal.validate_fixture_group_participant(new.opponent_team_id, new.opponent_scheduling_group_id, new.kickoff_date, 'Opponent');
  end if;

  -- Section 7: reject an impossible self-conflict. Compared by stable
  -- team_id, never by age-group label -- two different clubs' groups
  -- can share an identical label (both have "U6/U7") without ever
  -- overlapping in real team_ids, and that must remain permitted.
  if new.opponent_team_id is not null then
    v_owning_ids := internal.fixture_side_effective_team_ids(new.owning_team_id, new.owning_scheduling_group_id);
    v_opponent_ids := internal.fixture_side_effective_team_ids(new.opponent_team_id, new.opponent_scheduling_group_id);
    if v_owning_ids && v_opponent_ids then
      raise exception 'This fixture cannot have the same team on both sides (%). A group vs group fixture is only valid when the two sides share no component team.',
        (select display_name from public.teams where id = (select unnest(v_owning_ids) intersect select unnest(v_opponent_ids) limit 1))
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_fixture_group_participant_validity on public.fixtures;
create trigger enforce_fixture_group_participant_validity
  before insert or update of owning_team_id, owning_scheduling_group_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date
  on public.fixtures
  for each row execute function internal.enforce_fixture_group_participant_validity();

comment on function internal.enforce_fixture_group_participant_validity is
  'Section 5+7: validates BOTH sides'' group references (previously only ever checked implicitly/never for the owning side, not at all for the opponent side, since it could not exist) and rejects a fixture where the two sides'' effective team sets intersect. Fires on kickoff_date changes too, since a date edit can move a group fixture outside its group''s season window.';

-- ============================================================
-- 5. get_effective_fixture_participants: THE canonical, side-preserving
--    resolver (Section 6/14) -- the contract Side Project 1 and any
--    future Calendar/Pitch Allocation consumer should read. Returns
--    home_team_ids/away_team_ids separately (derived from the fixture's
--    OWN home_away + owning/opponent columns, not from which club is
--    asking), plus a deduplicated all_team_ids for callers that only
--    need "who is committed today". SECURITY INVOKER (the default) --
--    grants no visibility beyond ordinary fixtures RLS. The pre-existing
--    public.get_effective_fixture_team_ids(fixture_id) -- owning side
--    only, flat array -- is left completely unchanged for any existing
--    caller; this is an ADDITIVE sibling, not a replacement.
-- ============================================================

create or replace function public.get_effective_fixture_participants(p_fixture_id uuid)
returns table(home_team_ids uuid[], away_team_ids uuid[], all_team_ids uuid[])
language plpgsql
stable
as $$
declare
  f public.fixtures;
  v_owning_ids uuid[];
  v_opponent_ids uuid[];
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return query select array[]::uuid[], array[]::uuid[], array[]::uuid[];
    return;
  end if;

  v_owning_ids := internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id);
  v_opponent_ids := case when f.opponent_team_id is null then array[]::uuid[]
    else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end;

  return query select
    case when f.home_away = 'Home' then v_owning_ids when f.home_away = 'Away' then v_opponent_ids else array[]::uuid[] end,
    case when f.home_away = 'Home' then v_opponent_ids when f.home_away = 'Away' then v_owning_ids else array[]::uuid[] end,
    (select coalesce(array_agg(distinct t), array[]::uuid[]) from unnest(v_owning_ids || v_opponent_ids) t);
end;
$$;

comment on function public.get_effective_fixture_participants is
  'Section 6/14: THE canonical side-preserving effective-team contract. home_team_ids/away_team_ids are empty for a TBD/Not Applicable fixture (home_away undetermined -- never guessed); all_team_ids is always populated from both sides regardless. TEAM vs TEAM -> singleton arrays; GROUP vs TEAM / TEAM vs GROUP -> one side expands; GROUP vs GROUP -> both expand, still correctly split by home/away. This is the one entry point Side Project 1 (Player/Guardian/attendance) and any future Calendar/Pitch Allocation consumer should call -- never re-derive group membership inline.';

grant execute on function public.get_effective_fixture_participants(uuid) to authenticated;

-- ============================================================
-- 6. enforce_shared_team_fixture_capacity: extended to the opponent
--    side. The prior version (20260924920000) only ever expanded and
--    compared OWNING-side team sets -- a real, pre-existing gap
--    (unrelated to group-vs-group) where a team named only as
--    opponent_team_id on one fixture could still be booked as
--    owning_team_id on a second, conflicting fixture the same day with
--    no rejection at all. Necessary to fix now regardless: Section 8
--    requires proving conflicts for GROUP vs GROUP, and that is
--    impossible without first considering each existing fixture's own
--    opponent-side commitments too.
-- ============================================================

create or replace function internal.enforce_shared_team_fixture_capacity()
returns trigger
language plpgsql
as $$
declare
  v_new_ids uuid[];
  v_conflict_count integer;
  v_conflicting_team_name text;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  v_new_ids := internal.fixture_side_effective_team_ids(new.owning_team_id, new.owning_scheduling_group_id)
    || case when new.opponent_team_id is null then array[]::uuid[]
       else internal.fixture_side_effective_team_ids(new.opponent_team_id, new.opponent_scheduling_group_id) end;

  select count(*), max(t2.display_name) into v_conflict_count, v_conflicting_team_name
  from public.fixtures f
  join public.teams t2 on t2.id = f.owning_team_id
  where f.id <> new.id
    and f.kickoff_date = new.kickoff_date
    and f.status <> 'Cancelled'
    and (
      internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id)
      || case when f.opponent_team_id is null then array[]::uuid[]
         else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end
    ) && v_new_ids;

  if v_conflict_count > 0 then
    raise exception '% already has a fixture commitment on %. A team (or a Mini-Rugby Group''s component team) may hold only one match per day.', coalesce(v_conflicting_team_name, 'A team involved in this fixture'), new.kickoff_date
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function internal.enforce_shared_team_fixture_capacity is
  'Section 8: same-day capacity, now considering BOTH sides of BOTH the new and every existing same-day fixture -- covers team-v-team, group-v-team, team-v-group, and group-v-group uniformly via internal.fixture_side_effective_team_ids, closing a pre-existing gap where a team named only as an opponent was never checked.';

-- ============================================================
-- 7. accept_fixture_request: preserve a target_scheduling_group_id as a
--    genuine group opponent (Section 12) instead of discarding it.
--    Behavior change, not a bug fix: previously, more than one
--    age-eligible member in the target group forced the caller to pin
--    one specific team ("select the real team before accepting") --
--    there was structurally no way to accept against the whole group.
--    Now: an explicit p_target_team_id still pins one specific team
--    exactly as before (opponent_scheduling_group_id stays null --
--    accepting one named member out of a shared calendar, not the
--    whole group, is still a real, distinct, supported action); when no
--    explicit team is pinned, ANY age-eligible member becomes the
--    required real anchor and the group itself is preserved as
--    opponent_scheduling_group_id, producing one genuine GROUP vs
--    (TEAM|GROUP) fixture row -- never a mirrored/duplicated row.
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
  v_target_group_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_both_clubs_active boolean;
  v_pitch_id uuid;
  v_venue_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

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
      v_target_group_id := null;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      end if;
      -- One or more eligible members: accept against the WHOLE group
      -- (the auto-resolved member is only the required real anchor).
      v_target_team_id := v_auto_resolved_team_id;
      v_target_group_id := v_req.target_scheduling_group_id;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
    v_target_group_id := null;
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

  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;
  v_venue_id := case when v_requesting_club_venue = 'Home' then v_req.venue_id else null end;

  insert into public.fixtures (
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id, opponent_scheduling_group_id,
    game_type, competition_edition_id, pitch_id, venue_id,
    created_by, updated_by
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id, v_target_group_id,
    v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id,
    v_req.created_by, auth.uid()
  )
  returning id into v_fixture_id;

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

  if v_target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
      format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_target_team_id;
  end if;

  if v_target_club_id is not null and v_group.requesting_club_id <> v_target_club_id then
    select (select status from public.clubs where id = v_group.requesting_club_id) = 'active'
           and (select status from public.clubs where id = v_target_club_id) = 'active'
      into v_both_clubs_active;

    if v_both_clubs_active and not exists (
      select 1 from public.club_partnerships cp
      where cp.status <> 'revoked'
        and least(cp.requesting_club_id, cp.partner_club_id) = least(v_group.requesting_club_id, v_target_club_id)
        and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(v_group.requesting_club_id, v_target_club_id)
    ) then
      begin
        insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by, source_fixture_id)
        values (v_group.requesting_club_id, v_target_club_id, v_req.created_by, v_fixture_id);
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;

comment on function public.accept_fixture_request is
  'Creates exactly ONE fixtures row (Master Fixture Registry, unchanged). Now preserves a target_scheduling_group_id as a genuine opponent_scheduling_group_id when the caller does not pin one specific p_target_team_id, producing real GROUP vs GROUP / TEAM vs GROUP rows instead of always collapsing the target side to one team.';

-- ============================================================
-- 8. Authorization: internal.can_manage_fixture_side -- a component-
--    team admin of a GROUP that is genuinely one side of a fixture must
--    be able to help manage that fixture (they hold real fixture
--    authority for their own committed team), without gaining any
--    authority over the GROUP'S OWN COMPOSITION (manage_mini_rugby_
--    groups stays a completely separate capability, untouched here --
--    Section 9's "keep capabilities distinct").
-- ============================================================

create or replace function internal.can_manage_fixture_side(p_anchor_team_id uuid, p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.can_manage_team(p_anchor_team_id)
    or (p_group_id is not null and exists (
      select 1 from public.scheduling_group_members sgm where sgm.group_id = p_group_id and internal.can_manage_team(sgm.team_id)
    ));
$$;

comment on function internal.can_manage_fixture_side is
  'Section 9: fixture-management authority for one side (team or group), never group-COMPOSITION authority (that stays gated by the separate manage_mini_rugby_groups capability). A group fixture is manageable by ANY genuine component team''s own admin/coach/manager, or the club, not only whichever single team happens to be stored as the anchor.';

drop policy if exists fixtures_insert_scoped on public.fixtures;
create policy fixtures_insert_scoped on public.fixtures for insert
  with check (internal.can_manage_fixture_side(owning_team_id, owning_scheduling_group_id));

drop policy if exists fixtures_update_scoped on public.fixtures;
create policy fixtures_update_scoped on public.fixtures for update
  using (
    internal.can_manage_fixture_side(owning_team_id, owning_scheduling_group_id)
    or (opponent_team_id is not null and internal.can_manage_fixture_side(opponent_team_id, opponent_scheduling_group_id))
  );
