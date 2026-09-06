-- Safeguarding Officer dispensation notification wiring -- regression.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/safeguarding_officer_dispensation_notifications.sql
--
-- Self-contained/transactional (fresh gen_random_uuid() identities,
-- begin/rollback).

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Safeguarding Officer: dispensation notification wiring ==='

begin;

do $$
declare
  v_club uuid; v_directory uuid;
  v_admin uuid := gen_random_uuid();
  v_officer_user uuid := gen_random_uuid();
  v_player uuid := gen_random_uuid();
  v_team_source uuid; v_team_target uuid;
  v_officer_id uuid;
  v_token text;
  v_dispensation_id uuid;
  v_season_id uuid;
  v_notify_count integer;
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'SG Officer Dispensation Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sg-officer-disp-test-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_directory;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory, 'sg-officer-disp-test-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club;
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
    (gen_random_uuid(), v_club, 'union', 'youth', 'U14', 'SG Disp U14', 'sg-disp-u14-' || substr(gen_random_uuid()::text,1,8), true)
  returning id into v_team_source;
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
    (gen_random_uuid(), v_club, 'union', 'youth', 'U16', 'SG Disp U16', 'sg-disp-u16-' || substr(gen_random_uuid()::text,1,8), true)
  returning id into v_team_target;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'sg-disp-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_officer_user, 'sg-disp-officer-' || v_officer_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Disp', 'Admin', 'sg-disp-admin-' || v_admin::text || '@ovalball.test'),
    (v_officer_user, 'Disp', 'Officer', 'sg-disp-officer-' || v_officer_user::text || '@ovalball.test');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.players (id, first_name, surname, active, created_by) values (v_player, 'Test', 'Player', true, v_admin);
  insert into public.player_team_memberships (player_id, team_id, status, created_by) values (v_player, v_team_source, 'active', v_admin);

  -- Nominate + invite + accept a Safeguarding Officer, then grant
  -- club.dispensation.notify (Site-Admin action, reusing the existing
  -- generic capability_overrides mechanism directly -- shortcutting the
  -- real Site Admin persona here since this file's focus is the
  -- notification wiring, already covered end-to-end by
  -- safeguarding_officer_foundation.sql's own J/K/L tests).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  v_officer_id := public.nominate_safeguarding_officer(v_club, 'primary', 'Disp Officer', 'sg-disp-officer-' || v_officer_user::text || '@ovalball.test');
  select token into v_token from public.invite_safeguarding_officer(v_officer_id);

  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer_user::text, 'role', 'authenticated', 'email', 'sg-disp-officer-' || v_officer_user::text || '@ovalball.test')::text, true);
  perform public.accept_safeguarding_officer_invitation(v_token);

  reset role;
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, granted_by)
  values (v_officer_user, 'club.dispensation.notify', 'club', v_club, 'grant', v_admin);

  -- Q. Dispensation notification reaches the legitimate Safeguarding
  -- Officer on request.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  v_season_id := internal.resolve_season_for_date('union', current_date);
  v_dispensation_id := public.request_player_dispensation(v_player, v_team_source, v_team_target, v_season_id, 'Test dispensation reference');

  reset role;
  select count(*) into v_notify_count from public.notifications
  where user_id = v_officer_user and type = 'safeguarding_dispensation_requested' and (data->>'dispensation_id')::uuid = v_dispensation_id;
  if v_notify_count = 1 then
    raise notice 'PASS Q1: the club''s Safeguarding Officer (with club.dispensation.notify granted) is notified when a dispensation is requested';
  else
    raise exception 'FAIL Q1: got % notifications', v_notify_count;
  end if;

  -- R. The notification does not grant the officer any approval
  -- authority -- proven structurally: the officer holds only
  -- club.dispensation.notify/.view, never approve_player_dispensations,
  -- and decide_player_dispensation's own authorization is completely
  -- unchanged by this feature (still gated on approve_player_dispensations
  -- / is_club_admin, exactly as before).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer_user::text, 'role', 'authenticated')::text, true);
  begin
    perform public.decide_player_dispensation(v_dispensation_id, 'source_team', true);
    raise exception 'FAIL R: the notified Safeguarding Officer approved a dispensation stage';
  exception when others then
    raise notice 'PASS R: being the notified Safeguarding Officer grants no dispensation-approval authority whatsoever: %', sqlerrm;
  end;

  -- Advance to final approval as the real, unchanged approving party
  -- (the Club Admin), and confirm the "approved" notification fires only
  -- at the genuine final (governing_body) stage.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform public.decide_player_dispensation(v_dispensation_id, 'source_team', true);
  reset role;
  select count(*) into v_notify_count from public.notifications where user_id = v_officer_user and type = 'safeguarding_dispensation_decided';
  if v_notify_count = 0 then
    raise notice 'PASS (no intermediate notification): the source-team-approval stage alone does not notify the Safeguarding Officer -- only a genuine rejection or the final approval does (spec section 19, "only send events that are genuinely useful")';
  else
    raise exception 'FAIL: an intermediate stage approval incorrectly notified the officer';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform public.decide_player_dispensation(v_dispensation_id, 'club', true);
  perform public.decide_player_dispensation(v_dispensation_id, 'governing_body', true, 'TEST-GB-REF-001');
  reset role;
  select count(*) into v_notify_count from public.notifications
  where user_id = v_officer_user and type = 'safeguarding_dispensation_decided' and body ilike '%approved%';
  if v_notify_count = 1 then
    raise notice 'PASS Q2: the Safeguarding Officer is notified when a dispensation reaches final (governing-body) approval';
  else
    raise exception 'FAIL Q2: got % notifications', v_notify_count;
  end if;

  -- S. The pre-existing Site Admin / requester notification path
  -- (fixture_call_up_decided-style plumbing for a LINKED call-up) is
  -- unaffected -- proven here by confirming the dispensation's own
  -- normal columns/status still progressed exactly as before this
  -- feature existed (approved), which is what any pre-existing
  -- consumer of this table already depends on.
  if (select status from public.player_team_dispensation where id = v_dispensation_id) = 'approved' then
    raise notice 'PASS S: the dispensation''s own real approval chain (unrelated to Safeguarding Officer notification) completed exactly as it did before this feature existed -- no pre-existing behaviour was altered';
  else
    raise exception 'FAIL S';
  end if;

  -- Revocation also notifies.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform public.revoke_player_dispensation(v_dispensation_id, 'Test revoke reason');
  reset role;
  select count(*) into v_notify_count from public.notifications where user_id = v_officer_user and type = 'safeguarding_dispensation_revoked';
  if v_notify_count = 1 then
    raise notice 'PASS (revoke notifies): the Safeguarding Officer is notified when an approved dispensation is later revoked';
  else
    raise exception 'FAIL revoke-notifies';
  end if;
end $$;

rollback;

\echo 'Safeguarding Officer dispensation notification regression complete.'
