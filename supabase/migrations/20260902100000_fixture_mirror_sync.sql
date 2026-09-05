-- Foundational fix, required before chat-driven kickoff/result operations
-- can genuinely be "the same canonical fixture record" for both clubs.
--
-- A confirmed two-sided fixture has always been TWO fixtures rows (one per
-- owning_team_id, see accept_fixture_request) -- each club's calendar/
-- Fixture Management/dashboard queries strictly by `owning_team_id in
-- (my teams)`, so Burnley sees only Burnley's row and Rossendale sees
-- only Rossendale's row for the SAME real match. The two rows were never
-- linked (accept_fixture_request captured v_mirror_fixture_id locally but
-- never stored it), so nothing could keep them in sync. This migration:
--   1. adds the missing link,
--   2. backfills it for already-accepted pairs (best-effort, additive,
--      never destructive -- a pair that can't be confidently matched is
--      simply left unlinked, never guessed),
--   3. updates accept_fixture_request to link new pairs at creation time,
--   4. re-declares update_fixture_pitch and submit_fixture_result /
--      resolve_fixture_result_dispute to also propagate the SAME field
--      values to a linked mirror row -- never swapped, since home_score/
--      away_score/kickoff/pitch describe the literal match, identical
--      from either side's row.

alter table public.fixtures add column mirror_fixture_id uuid references public.fixtures(id);

comment on column public.fixtures.mirror_fixture_id is
  'The OTHER club''s own fixtures row for this same real match (accept_fixture_request creates one row per side) -- null for a fixture with no resolved/activated opponent, since there is no second row to link. Kept reciprocal: each side''s mirror_fixture_id points at the other. Every RPC that changes a shared field (kickoff, pitch, result) must write both rows so neither club ever sees stale data for what is the same match.';

-- Best-effort backfill: match pairs by (owning_team_id <-> opponent_team_id
-- reversed) + same kickoff_date, only when exactly one candidate exists on
-- each side (an ambiguous match -- e.g. two fixtures the same day between
-- the same two clubs -- is left unlinked rather than guessed).
do $$
declare
  r record;
begin
  for r in
    select a.id as a_id, b.id as b_id
    from public.fixtures a
    join public.fixtures b
      on b.owning_team_id = a.opponent_team_id
     and b.opponent_team_id = a.owning_team_id
     and b.kickoff_date = a.kickoff_date
    where a.mirror_fixture_id is null
      and b.mirror_fixture_id is null
      and a.opponent_team_id is not null
      and a.id <> b.id
      and (
        select count(*) from public.fixtures c
        where c.owning_team_id = a.opponent_team_id and c.opponent_team_id = a.owning_team_id and c.kickoff_date = a.kickoff_date
      ) = 1
      and (
        select count(*) from public.fixtures c
        where c.owning_team_id = a.owning_team_id and c.opponent_team_id = a.opponent_team_id and c.kickoff_date = a.kickoff_date
      ) = 1
  loop
    update public.fixtures set mirror_fixture_id = r.b_id where id = r.a_id;
    update public.fixtures set mirror_fixture_id = r.a_id where id = r.b_id;
  end loop;
end $$;

-- ============================================================
-- accept_fixture_request: re-declared with the SAME signature purely to
-- link mirror_fixture_id reciprocally when creating the pair -- every
-- other line unchanged from 20260901230000_scheduling_groups.sql (which
-- itself only added scheduling-group resolution on top of the original).
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
  where tp.team_id = v_req.requesting_team_id;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;

-- ============================================================
-- update_fixture_pitch: re-declared purely to also write the SAME pitch
-- fields to a linked mirror row -- every other line unchanged from
-- 20260901180000_club_pitches.sql.
-- ============================================================

create or replace function public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid default null, p_pitch_text text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;

  if p_pitch_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;
    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = f.mirror_fixture_id;
  end if;

  if (coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id) and f.opponent_team_id is not null then
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
      case when v_new_pitch_text is null then 'Pitch allocation removed.'
           else format('Pitch allocated: %s', v_new_pitch_text) end);
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$$;

revoke execute on function public.update_fixture_pitch(uuid, uuid, text) from public;
grant execute on function public.update_fixture_pitch(uuid, uuid, text) to authenticated;
