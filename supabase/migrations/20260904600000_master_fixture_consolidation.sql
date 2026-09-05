-- Master Fixture Registry: makes a confirmed two-sided fixture genuinely
-- ONE row with ONE stable fixture_id, not two "mirror-linked" rows (one
-- per club, accept_fixture_request's own historical design -- see
-- 20260902100000_fixture_mirror_sync.sql's comment, which states plainly
-- "A confirmed two-sided fixture has always been TWO fixtures rows").
-- 20260903100000_unified_fixture_conversation.sql already fixed the
-- MESSAGING half of this (a shared conversation_id) but left the fixture
-- identity itself split -- Burnley's Calendar and Rossendale's Calendar
-- read different `fixtures.id` values for what is the same real match,
-- and Site Admin Fixture Management (admin_fixture_overview has no
-- dedup) visibly shows the same match as two separate rows today.
--
-- Fix, scoped precisely: `accept_fixture_request` is the ONLY currently-
-- live code path that creates a mirror pair (confirmed by a full-repo
-- grep of every "mirror_fixture_id" reference -- team_lifecycle.sql,
-- fixture_kickoff_chat.sql, and fixture_result_24h_and_unverified.sql
-- only ever PROPAGATE a write to an existing mirror_fixture_id, they
-- never create one; shared_team_fixture_capacity.sql and
-- partnership_automation.sql's own mirror-creating bodies are earlier,
-- fully-superseded `create or replace function public.accept_fixture_
-- request` definitions, not separate functions). Redefining that one
-- function to insert a single row is therefore sufficient to stop new
-- duplication -- every "if mirror_fixture_id is not null, also update
-- the mirror row" block elsewhere becomes a harmless dead branch for
-- every NEW fixture (mirror_fixture_id stays null) while continuing to
-- correctly serve existing historical mirror pairs completely unchanged,
-- exactly the "do not destroy historical data while normalizing"
-- requirement -- no destructive backfill of old rows is needed or
-- attempted here.
--
-- A single row already carries everything needed to represent BOTH
-- sides (owning_team_id/opponent_team_id/opponent_directory_id/
-- home_away) -- proven by the pre-existing "external/unactivated
-- opponent" fixture shape, which has always been one row. Every write
-- RPC (submit_fixture_result, update_fixture_pitch, etc.) already
-- authorizes via internal.can_submit_fixture_result, which already
-- checks BOTH owning_team_id and opponent_team_id -- so a single row
-- already supports both clubs acting on it with zero RPC changes.

-- ============================================================
-- 1. home_team_id / away_team_id -- real, explicit columns (never just
--    inferred ad hoc per call site), but GENERATED from the existing
--    owning_team_id/opponent_team_id/home_away rather than a second,
--    independently-writable pair -- there is no new write path to drift
--    out of sync with the fields that already fully determine them.
--    TBD/Not Applicable fixtures (no determined side yet) leave both
--    null rather than guessing.
-- ============================================================

alter table public.fixtures
  add column home_team_id uuid generated always as (
    case when home_away = 'Home' then owning_team_id
         when home_away = 'Away' then opponent_team_id
         else null end
  ) stored,
  add column away_team_id uuid generated always as (
    case when home_away = 'Home' then opponent_team_id
         when home_away = 'Away' then owning_team_id
         else null end
  ) stored;

comment on column public.fixtures.home_team_id is
  'The home side''s team, generated from owning_team_id/opponent_team_id/home_away -- never a second independently-writable identity. Null for opponent_team_id-unresolved or TBD/Not Applicable fixtures.';
comment on column public.fixtures.away_team_id is
  'The away side''s team, generated the same way as home_team_id.';

create index fixtures_home_team_id_idx on public.fixtures (home_team_id) where home_team_id is not null;
create index fixtures_away_team_id_idx on public.fixtures (away_team_id) where away_team_id is not null;

-- ============================================================
-- 2. Historical snapshot symmetry (section J/I of the brief): the owning
--    side has always had owning_team_age_group_snapshot/owning_team_
--    display_name_snapshot (capture_fixture_team_snapshot, INSERT-only).
--    The opponent side never did -- add the same pair, captured by the
--    same trigger, same INSERT-only scope (matching the existing side's
--    own limitation, not a new one).
-- ============================================================

alter table public.fixtures
  add column opponent_team_age_group_snapshot text,
  add column opponent_team_display_name_snapshot text;

create or replace function internal.capture_fixture_team_snapshot() returns trigger
language plpgsql
as $$
declare
  v_age_group text;
  v_display_name text;
  v_rugby_code text;
  v_opp_age_group text;
  v_opp_display_name text;
begin
  select age_group, display_name, rugby_code into v_age_group, v_display_name, v_rugby_code
  from public.teams where id = new.owning_team_id;
  new.owning_team_age_group_snapshot := v_age_group;
  new.owning_team_display_name_snapshot := v_display_name;

  if new.opponent_team_id is not null then
    select age_group, display_name into v_opp_age_group, v_opp_display_name
    from public.teams where id = new.opponent_team_id;
    new.opponent_team_age_group_snapshot := v_opp_age_group;
    new.opponent_team_display_name_snapshot := v_opp_display_name;
  end if;

  if new.season_id is null and v_rugby_code is not null then
    new.season_id := internal.resolve_season_for_date(v_rugby_code, new.kickoff_date);
  end if;
  return new;
end;
$$;

comment on function internal.capture_fixture_team_snapshot is
  'BEFORE INSERT: captures both sides'' age_group/display_name as they were at fixture creation (stable team_ids roll forward through rollover, so today''s U14 may have been U12 when this fixture was played) and auto-resolves season_id from the owning team''s rugby_code + kickoff_date when not explicitly set.';

-- ============================================================
-- 3. fixtures_update_scoped RLS: widened to match the SAME "either side"
--    pattern every write RPC''s own authorization check already uses
--    (internal.can_submit_fixture_result, internal.caller_fixture_club_
--    id) -- defense in depth for the one raw non-RPC update path
--    (admin/fixtures/actions.ts''s Site-Admin status change), and correct
--    now that a single row genuinely represents both clubs.
-- ============================================================

drop policy if exists fixtures_update_scoped on public.fixtures;
create policy fixtures_update_scoped on public.fixtures for update
  using (
    internal.can_manage_team(owning_team_id)
    or (opponent_team_id is not null and internal.can_manage_team(opponent_team_id))
  );

-- ============================================================
-- 4. accept_fixture_request: the actual fix -- ONE insert, never two.
--    Every other line is unchanged from the prior (20260903100000)
--    definition; conversation_id keeps its column default (gen_random_
--    uuid()), never explicitly minted here now that there is no second
--    row to keep it in sync with.
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
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_both_clubs_active boolean;
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

  -- The target side gets notified too now (impossible before: it had no
  -- row of its own to be "about"; v_target_venue described what its row
  -- WOULD have been). Skipped for an unresolved/unactivated opponent
  -- (nobody on Ovalball to notify) or a still-ambiguous shared-calendar
  -- target (ineligible to resolve automatically -- handled above, would
  -- already have raised).
  if v_target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
      format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_target_team_id;
  end if;

  -- Phase D: automatic Partnership Request between two distinct, ACTIVE
  -- Ovalball clubs, if not already partners and no pending request
  -- exists between them (20260903500000_partnership_automation.sql).
  -- Unchanged by this migration -- reproduced verbatim so this
  -- redefinition doesn't silently drop it.
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
        null; -- a concurrent request/response won the race -- never abort the fixture acceptance over it
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;

comment on function public.accept_fixture_request is
  'Creates exactly ONE fixtures row for the confirmed match -- both clubs reference the SAME fixture_id from this point on (Master Fixture Registry). Historical mirror pairs created by earlier versions of this function are left completely untouched (mirror_fixture_id-propagation in submit_fixture_result/update_fixture_pitch/update_fixture_kickoff etc. still works for them); this function itself never creates a new pair again.';
