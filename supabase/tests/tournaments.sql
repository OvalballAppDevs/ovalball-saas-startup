-- Manual verification for Tournament architecture
-- (20260904900000_tournament_architecture.sql). NOT a migration -- run
-- AFTER permission_matrix.sql (reuses Burnley/Rossendale, their U12 teams,
-- and seasons/club_pitches fixtures created there and in season_rollover.sql
-- -- actually self-contained for season, see below).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/tournaments.sql

\set ON_ERROR_STOP off
\pset pager off

-- Self-contained season + a third club used only for the "external/
-- unactivated participant" scenario (deliberately never given a `clubs`
-- row -- that IS the point).
do $$
begin
  -- Explicit season_year_start sentinel (never the auto-derived real
  -- calendar year of current_date + 200, which can land in the same year
  -- as a genuine canonical season and collide with 20260924930000's
  -- (rugby_code, season_year_start) uniqueness constraint) plus
  -- is_regression_fixture, so this never masquerades as -- or blocks --
  -- a real canonical Rugby Union season.
  insert into public.seasons (id, name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('93000000-0000-0000-0000-000000000001', 'Tournament Test Season', current_date + 200, current_date + 500, 'union', 2199, true)
  on conflict (id) do nothing;

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('93000000-0000-0000-0000-000000000002', 'Colne Water RUFC (Test, Unactivated)', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'colne-water-rufc-test-93000000')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Host creates a tournament directly (Burnley U12).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
begin
  v_tournament_id := public.create_tournament('30000000-0000-0000-0000-000000000001', current_date + 30);
  if v_tournament_id is not null then
    raise notice 'PASS 1: Burnley''s Club Admin creates a tournament hosted by Burnley U12 directly';
  else
    raise notice 'FAIL 1: create_tournament returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2/3. Host invites two registered Ovalball teams -- one tournament ID,
-- participants are separate rows, both notified.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_u12_type_id uuid;
begin
  select id into v_tournament_id from public.tournaments where host_team_id = '30000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  select id into v_u12_type_id from public.canonical_team_types where key = 'u12';

  perform public.invite_tournament_participant(v_tournament_id, (select id from public.club_directory where name = 'Rossendale RUFC'), v_u12_type_id);

  if (select count(distinct tournament_id) from public.tournament_participants where tournament_id = v_tournament_id) = 1 then
    raise notice 'PASS 2: inviting Rossendale U12 stays under the SAME tournament_id -- one event, participants separate';
  else
    raise notice 'FAIL 2: unexpected tournament_id fanout';
  end if;

  if exists (
    select 1 from public.tournament_participants tp
    join public.teams t on t.id = tp.team_id
    where tp.tournament_id = v_tournament_id and t.club_id = '10000000-0000-0000-0000-000000000002' and tp.status = 'pending'
  ) then
    raise notice 'PASS 3: Rossendale U12 is a real, resolved, pending participant (team_id set)';
  else
    raise notice 'FAIL 3: Rossendale participant not resolved as expected';
  end if;
end $$;
commit;

-- Notification check runs as postgres (notifications is self-select-only
-- by RLS -- Burnley's own session above could never see a notification
-- addressed to Rossendale's admin).
do $$
begin
  if exists (
    select 1 from public.notifications n
    join public.club_memberships cm on cm.user_id = n.user_id
    where n.type = 'tournament_invitation_received' and cm.club_id = '10000000-0000-0000-0000-000000000002' and cm.role = 'CLUB_ADMIN'
  ) then
    raise notice 'PASS 3b: Rossendale''s Club Admin was notified of the invitation';
  else
    raise notice 'FAIL 3b: no notification found for Rossendale';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Rossendale accepts -- shows Accepted; host and Rossendale query the
-- SAME tournament_id.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_participant_id uuid;
  v_tournament_id uuid;
begin
  select tp.id, tp.tournament_id into v_participant_id, v_tournament_id
  from public.tournament_participants tp
  where tp.team_id = '30000000-0000-0000-0000-000000000003' and tp.status = 'pending';

  perform public.respond_tournament_invitation(v_participant_id, true);

  if (select status from public.tournament_participants where id = v_participant_id) = 'accepted' then
    raise notice 'PASS 4: Rossendale (Club Admin) accepts the invitation -- status is now accepted';
  else
    raise notice 'FAIL 4: accept did not stick';
  end if;
end $$;
commit;

-- Visibility must be checked from EACH side's own real session -- a
-- security_invoker view answers "what can THIS caller see", so host
-- visibility is asserted as Burnley and participant visibility as
-- Rossendale, never as postgres (which holds no club authority at all).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_host_visible boolean;
begin
  select tournament_id into v_tournament_id from public.tournament_participants where team_id = '30000000-0000-0000-0000-000000000003' and status = 'accepted';
  select exists(select 1 from public.club_visible_tournaments where id = v_tournament_id and host_team_id = '30000000-0000-0000-0000-000000000001') into v_host_visible;
  if v_host_visible then
    raise notice 'PASS 5a: the host (Burnley) sees the tournament in club_visible_tournaments';
  else
    raise notice 'FAIL 5a: host cannot see its own tournament';
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_participant_visible boolean;
begin
  select tournament_id into v_tournament_id from public.tournament_participants where team_id = '30000000-0000-0000-0000-000000000003' and status = 'accepted';
  select exists(select 1 from public.club_visible_tournaments where id = v_tournament_id) into v_participant_visible;
  if v_participant_visible then
    raise notice 'PASS 5b: the now-accepted participant (Rossendale) sees the SAME tournament (one id) in club_visible_tournaments';
  else
    raise notice 'FAIL 5b: accepted participant cannot see the tournament';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Invite a canonical-but-unactivated club -- external_recorded
-- immediately, no fake request/notification.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_u12_type_id uuid;
  v_participant_id uuid;
begin
  select id into v_tournament_id from public.tournaments where host_team_id = '30000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  select id into v_u12_type_id from public.canonical_team_types where key = 'u12';

  v_participant_id := public.invite_tournament_participant(v_tournament_id, '93000000-0000-0000-0000-000000000002', v_u12_type_id);

  if (select status from public.tournament_participants where id = v_participant_id) = 'external_recorded' then
    raise notice 'PASS 6: an unactivated canonical club is recorded external_recorded immediately -- never a fake pending Ovalball request';
  else
    raise notice 'FAIL 6: unexpected status for unactivated club invite';
  end if;

  if not exists (select 1 from public.notifications where (data->>'participant_id')::uuid = v_participant_id) then
    raise notice 'PASS 6b: no notification was created for the external/unactivated club -- nobody to notify';
  else
    raise notice 'FAIL 6b: a notification was unexpectedly created for an unactivated club';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Duplicate invite (same club_directory_id + canonical_team_type_id)
-- rejected by a real database constraint.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_u12_type_id uuid;
begin
  select id into v_tournament_id from public.tournaments where host_team_id = '30000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  select id into v_u12_type_id from public.canonical_team_types where key = 'u12';

  perform public.invite_tournament_participant(v_tournament_id, (select id from public.club_directory where name = 'Rossendale RUFC'), v_u12_type_id);
  raise notice 'FAIL 7: inviting Rossendale U12 a second time to the same tournament unexpectedly succeeded';
exception when unique_violation then
  raise notice 'PASS 7: duplicate invite (same club + team identity, same tournament) rejected by a real database uniqueness constraint';
end $$;
commit;

-- ------------------------------------------------------------
-- 8/9. Away-initiated: Burnley proposes a tournament AT Rossendale before
-- Rossendale has done anything. Before claim, Burnley cannot manage
-- Rossendale's (host) participant list. Rossendale claims -> gains
-- organiser authority -> can add more teams. Burnley remains a
-- participant.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
begin
  v_tournament_id := public.propose_tournament_at_host(
    (select id from public.club_directory where name = 'Rossendale RUFC'),
    '30000000-0000-0000-0000-000000000001', -- Burnley U12, proposing
    current_date + 45
  );

  if (select status from public.tournaments where id = v_tournament_id) = 'pending_host_confirmation' then
    raise notice 'PASS 8: Burnley proposes "Tournament at Rossendale" -- status is pending_host_confirmation, host_team_id still null';
  else
    raise notice 'FAIL 8: unexpected status after proposal';
  end if;

  if exists (select 1 from public.tournament_participants where tournament_id = v_tournament_id and team_id = '30000000-0000-0000-0000-000000000001' and status = 'accepted') then
    raise notice 'PASS 8b: Burnley (the proposer) is recorded as an already-accepted participant of its own proposal';
  else
    raise notice 'FAIL 8b: proposing team not recorded as accepted participant';
  end if;
end $$;
commit;

-- Before claim: Burnley cannot invite further participants to a
-- tournament it does not (yet) host.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_u12_type_id uuid;
begin
  select id into v_tournament_id from public.tournaments where status = 'pending_host_confirmation' and rugby_code = 'union' order by created_at desc limit 1;
  select id into v_u12_type_id from public.canonical_team_types where key = 'u12';

  perform public.invite_tournament_participant(v_tournament_id, (select id from public.club_directory where name = 'Leigh RUFC'), v_u12_type_id);
  raise notice 'FAIL 9: Burnley (the proposer, not the host) unexpectedly added a participant before Rossendale claimed host authority';
exception when others then
  if sqlerrm like '%confirmed host%' or sqlerrm like '%Only the host club%' then
    raise notice 'PASS 9: Burnley cannot manage the host participant list before Rossendale claims the tournament (%)', sqlerrm;
  else
    raise notice 'FAIL 9: blocked, but for an unexpected reason: %', sqlerrm;
  end if;
end $$;
commit;

-- Rossendale claims host authority.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
begin
  select id into v_tournament_id from public.tournaments where status = 'pending_host_confirmation' and rugby_code = 'union' order by created_at desc limit 1;
  perform public.claim_tournament_host(v_tournament_id, '30000000-0000-0000-0000-000000000003');

  if (select status from public.tournaments where id = v_tournament_id) = 'confirmed'
     and (select host_team_id from public.tournaments where id = v_tournament_id) = '30000000-0000-0000-0000-000000000003' then
    raise notice 'PASS 10: Rossendale claims the tournament -- status confirmed, host_team_id is Rossendale U12, organiser authority is now theirs';
  else
    raise notice 'FAIL 10: claim did not resolve as expected';
  end if;
end $$;
commit;

-- Now Rossendale (the real host) CAN add more teams.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_u12_type_id uuid;
begin
  select id into v_tournament_id from public.tournaments where status = 'confirmed' and host_team_id = '30000000-0000-0000-0000-000000000003' order by created_at desc limit 1;
  select id into v_u12_type_id from public.canonical_team_types where key = 'u12';

  perform public.invite_tournament_participant(v_tournament_id, (select id from public.club_directory where name = 'Leigh RUFC'), v_u12_type_id);
  raise notice 'PASS 11: after claiming, Rossendale (the real host) can add further participants -- Burnley (the original proposer) remains a participant, not host';
exception when others then
  raise notice 'FAIL 11: host could not add a participant after claiming: %', sqlerrm;
end $$;
commit;

do $$
declare
  v_tournament_id uuid;
begin
  select id into v_tournament_id from public.tournaments where status = 'confirmed' and host_team_id = '30000000-0000-0000-0000-000000000003' order by created_at desc limit 1;
  if exists (select 1 from public.tournament_participants where tournament_id = v_tournament_id and team_id = '30000000-0000-0000-0000-000000000001' and status = 'accepted') then
    raise notice 'PASS 12: Burnley (the original proposer) remains an accepted PARTICIPANT of the tournament it no longer hosts';
  else
    raise notice 'FAIL 12: Burnley''s original participant row is missing/changed';
  end if;
end $$;

-- ------------------------------------------------------------
-- 13. Invited club's admin cannot modify another participant or
-- host-side fields (server-side rejection, not just UI absence).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_leigh_participant_id uuid;
  v_tournament_id uuid;
begin
  select id into v_tournament_id from public.tournaments where status = 'confirmed' and host_team_id = '30000000-0000-0000-0000-000000000003' order by created_at desc limit 1;
  select id into v_leigh_participant_id from public.tournament_participants where tournament_id = v_tournament_id and club_directory_id = (select id from public.club_directory where name = 'Leigh RUFC');

  begin
    perform public.remove_tournament_participant(v_leigh_participant_id);
    raise notice 'FAIL 13: Burnley (a participant, not host) unexpectedly removed a DIFFERENT participant (Leigh)';
  exception when others then
    raise notice 'PASS 13: Burnley (a participant, not host) cannot remove another participant -- host-only action rejected server-side (%)', sqlerrm;
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 14. A tournament pitch cannot point at a different club's pitch.
-- ------------------------------------------------------------
do $$
begin
  insert into public.club_pitches (id, club_id, display_name)
  values ('93000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Rossendale Test Pitch')
  on conflict (id) do nothing;
end $$;

do $$
begin
  update public.tournaments
  set pitch_id = '93000000-0000-0000-0000-000000000003'
  where host_team_id = '30000000-0000-0000-0000-000000000001'
    and host_club_id = '10000000-0000-0000-0000-000000000001';
  raise notice 'FAIL 14: Burnley''s own tournament was unexpectedly pointed at Rossendale''s private pitch';
exception when others then
  raise notice 'PASS 14: a tournament cannot be pointed at a pitch belonging to a different club (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 15. A tournament venue cannot point at a different club's venue --
-- venue-ownership trigger, identical shape to test 14's pitch check.
-- ------------------------------------------------------------
do $$
begin
  insert into public.venues (id, club_id, name, slug)
  values ('94000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Burnley Test Venue', 'burnley-test-venue-94000001'),
         ('94000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Rossendale Test Venue', 'rossendale-test-venue-94000002')
  on conflict (id) do nothing;
end $$;

do $$
begin
  update public.tournaments
  set venue_id = '94000000-0000-0000-0000-000000000002'
  where host_team_id = '30000000-0000-0000-0000-000000000001'
    and host_club_id = '10000000-0000-0000-0000-000000000001';
  raise notice 'FAIL 15: Burnley''s own tournament was unexpectedly pointed at Rossendale''s private venue';
exception when others then
  raise notice 'PASS 15: a tournament cannot be pointed at a venue belonging to a different club (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 16. Host changes the tournament's venue to its own real venue --
-- update_tournament_venue succeeds and notifies the accepted
-- participant (Rossendale, from tests 5a/5b), same master tournament id.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_tournament_id uuid;
  v_before_id uuid;
begin
  select tournament_id into v_tournament_id from public.tournament_participants where team_id = '30000000-0000-0000-0000-000000000003' and status = 'accepted';
  perform public.update_tournament_venue(v_tournament_id, '94000000-0000-0000-0000-000000000001');
  select id into v_before_id from public.tournaments where id = v_tournament_id and venue_id = '94000000-0000-0000-0000-000000000001';
  if v_before_id = v_tournament_id then
    raise notice 'PASS 16a: host changed the venue on the SAME master tournament id (%)', v_tournament_id;
  else
    raise notice 'FAIL 16a: venue change did not land on the expected tournament';
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_notified boolean;
begin
  select exists(
    select 1 from public.notifications
    where user_id = '00000000-0000-0000-0000-000000000003' and type = 'tournament_venue_changed'
  ) into v_notified;
  if v_notified then
    raise notice 'PASS 16b: the accepted participant (Rossendale) received a tournament_venue_changed notification';
  else
    raise notice 'FAIL 16b: no venue-change notification found for the accepted participant';
  end if;
end $$;
commit;
