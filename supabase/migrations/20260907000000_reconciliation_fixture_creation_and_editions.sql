-- Reconciliation pass (complaints 3, 12, 13): the Calendar Create Fixture
-- popup was missing a Pitch/Venue field, and there was NO app-level way
-- for a Site Admin to create a competition_editions row -- meaning a
-- newly-created competition could never appear in any fixture dropdown,
-- for any club, ever. Both fixed here.

-- ============================================================
-- 1. fixture_requests gains pitch_id -- proposed per-team (like
--    venue_preference already is), only meaningful when that team's
--    venue_preference resolves to Home in the final fixture (a club can
--    only meaningfully offer ITS OWN pitch, never the opponent's).
--    accept_fixture_request below carries it onto the resulting fixtures
--    row only in that case; otherwise it's silently left for the normal
--    post-creation PitchInline flow, exactly like every other fixture
--    that doesn't set a pitch up front.
-- ============================================================

alter table public.fixture_requests
  add column pitch_id uuid references public.club_pitches(id);

comment on column public.fixture_requests.pitch_id is
  'Proposed by the requesting team, only when their venue_preference is Home -- carried onto the resulting fixtures row by accept_fixture_request when that side does end up Home. Never implies anything about the opponent''s pitch.';

-- ============================================================
-- 2. accept_fixture_request: identical to 20260905100000's definition,
--    with pitch_id now flowing from the request onto the resulting
--    fixtures row when the requesting side ends up Home.
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
  v_pitch_id uuid;
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

  -- The requester's proposed pitch only ever applies when THEY end up
  -- Home -- their pitch has no meaning for an Away or TBD fixture.
  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;

  insert into public.fixtures (
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    game_type, competition_edition_id, pitch_id,
    created_by, updated_by
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_group.game_type, v_group.competition_edition_id, v_pitch_id,
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

-- ============================================================
-- 3. create_competition_edition: the missing piece. competition_editions
--    (one run of one competition in one season -- 20260830143505) had
--    ZERO app-level creation path anywhere: create_competition only ever
--    inserted into competitions, so a newly-created global competition
--    could never appear in ANY fixture/calendar dropdown, for any club,
--    in any season, because zero editions existed for it and nothing
--    could create one. Every existing competition_editions row was
--    inserted directly by regression-test SQL, never through an RPC.
--    Mirrors create_competition's own gating/shape exactly.
-- ============================================================

create or replace function public.create_competition_edition(p_competition_id uuid, p_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_competition public.competitions;
  v_season public.seasons;
begin
  if not internal.can_manage_competitions() then
    raise exception 'Only a Site Admin with Competition management access may add a competition edition.' using errcode = '42501';
  end if;

  select * into v_competition from public.competitions where id = p_competition_id;
  if not found then raise exception 'Competition not found.'; end if;
  if not v_competition.active then raise exception 'Cannot add an edition to a deactivated competition.'; end if;

  select * into v_season from public.seasons where id = p_season_id;
  if not found then raise exception 'Season not found.'; end if;
  if v_season.rugby_code <> v_competition.rugby_code then
    raise exception 'A % competition cannot have an edition in a % season.', v_competition.rugby_code, v_season.rugby_code using errcode = '23514';
  end if;

  begin
    insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
    values (p_competition_id, p_season_id, v_competition.rugby_code, true, auth.uid(), auth.uid())
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception '% already has an edition in %.', v_competition.name, v_season.name using errcode = 'P0001';
  end;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('competition_editions', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('competition_id', p_competition_id, 'season_id', p_season_id));

  return v_new_id;
end;
$$;

revoke execute on function public.create_competition_edition(uuid, uuid) from public;
grant execute on function public.create_competition_edition(uuid, uuid) to authenticated;

comment on function public.create_competition_edition is
  'Site Admin (manage_competitions capability) only. The one and only way a competition becomes selectable in any fixture-creation dropdown -- see Calendar''s and Site Admin Fixture Management''s competition_editions queries. Duplicate (competition_id, season_id) pairs are rejected by competition_editions_competition_id_season_id_key.';

create or replace function public.deactivate_competition_edition(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.competition_editions;
begin
  if not internal.can_manage_competitions() then
    raise exception 'Only a Site Admin with Competition management access may deactivate a competition edition.' using errcode = '42501';
  end if;

  select * into v_before from public.competition_editions where id = p_id for update;
  if not found then raise exception 'Competition edition not found.'; end if;
  if not v_before.active then raise exception 'This edition is already deactivated.'; end if;

  update public.competition_editions set active = false, updated_by = auth.uid(), updated_at = now() where id = p_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('competition_editions', p_id, 'deactivate', auth.uid(), jsonb_build_object('active', true), jsonb_build_object('active', false));
end;
$$;

revoke execute on function public.deactivate_competition_edition(uuid) from public;
grant execute on function public.deactivate_competition_edition(uuid) to authenticated;

comment on function public.deactivate_competition_edition is
  '"Deactivate", never "Delete" -- a fixture''s existing competition_edition_id reference is untouched; the edition simply disappears from new-fixture selection. Never touches the parent competition.';

-- ============================================================
-- 4. RLS: competition_editions' write policies were left at the original
--    blanket internal.is_site_admin() (ANY Site Admin profile) when the
--    Competition Directory migration narrowed competitions itself --
--    close that same gap here now that a real write RPC exists. The RPCs
--    above are SECURITY DEFINER and bypass RLS themselves; this closes
--    the direct-table-write path for any caller that skips them.
-- ============================================================

drop policy if exists competition_editions_write_admin on public.competition_editions;
drop policy if exists competition_editions_update_admin on public.competition_editions;
create policy competition_editions_write_admin on public.competition_editions for insert
  with check (internal.can_manage_competitions());
create policy competition_editions_update_admin on public.competition_editions for update
  using (internal.can_manage_competitions());
