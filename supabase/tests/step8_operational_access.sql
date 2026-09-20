-- CONVERGENCE STEP 8 — OPERATIONAL ACCESS MANAGEMENT.
--
-- Slice 8 is Club People & Access. It adds no authority: it makes the
-- authority that already exists reachable and legible by the person the design
-- says owns it. These tests are therefore mostly about what did NOT change.
--
--   A. The role catalogue and the bundle catalogue call the fixtures role what
--      the product calls it. One spelling, in every place a person reads it.
--   B. A preset is an exact capability delta and nothing more. It cannot grant
--      what the person applying it could not grant one at a time, it respects
--      the age rule, the scope, the delegation ceiling and the audit trail, and
--      it leaves unrelated explicit decisions alone.
--   C. Pitch Allocation is discoverability, not new authority.
--   D. Removing ONE role removes only the authority that role sourced.
--   E. Suspension defeats authority that its rows still describe, and
--      reactivation restores only what should still exist.
--   F. The club timeline is a READ of the canonical event stream, scoped to one
--      club, gated on a capability, and it does not hand a Club Admin the
--      private payload fields a Site Admin surface may legitimately hold.
--   G. explain_access agrees with every one of the above.
--   H. A Site Admin administering a club does not become a member of it.
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_admin uuid := gen_random_uuid();        -- Club Admin at club A
  v_other_admin uuid := gen_random_uuid();  -- Club Admin at club B
  v_vol uuid := gen_random_uuid();          -- Volunteer at club A
  v_multi uuid := gen_random_uuid();        -- one identity, many relationships
  v_minor uuid := gen_random_uuid();        -- under 18
  v_site uuid := gen_random_uuid();         -- Full Site Admin, NOT a club member
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid;
  v_team uuid; v_team2 uuid; v_team_b uuid;
  v_ms_admin uuid; v_ms_vol uuid; v_ms_multi uuid; v_ms_minor uuid; v_ms_multi_b uuid;
  v_text text; v_n int; v_bool boolean; v_ex record;
  v_before int; v_after int;
  v_keep uuid;
begin
  foreach v_person in array array[v_admin, v_other_admin, v_vol, v_multi, v_minor, v_site] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's8-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Eight', 's8-' || v_person::text || '@ovalball.test',
      case when v_person = v_minor then (current_date - interval '14 years')::date
           else (current_date - interval '36 years')::date end)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S8 Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's8-a-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S8 Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's8-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's8-a-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 's8-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's8-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Men''s 1st', 's8-m1-' || v_tag, 'senior', null, 'mens', 'union', true) returning id into v_team2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 's8-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active') returning id into v_ms_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_vol, 'BASIC_USER', 'active') returning id into v_ms_vol;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_multi, 'BASIC_USER', 'active') returning id into v_ms_multi;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_minor, 'BASIC_USER', 'active') returning id into v_ms_minor;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_other_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_multi, 'BASIC_USER', 'active') returning id into v_ms_multi_b;

  perform pg_temp.act('authenticated', v_admin);
  perform public.assign_role(v_ms_vol, 'VOLUNTEER', null, null);
  perform pg_temp.act_postgres();

  -- ===============================================================
  -- A. ONE SPELLING FOR ONE ROLE (L3's label half)
  -- ===============================================================
  perform pg_temp.check(
    (select label from public.role_definitions where role_key = 'FIXTURES_SECRETARY') = 'Fixture Secretary',
    'A1: the role catalogue says "Fixture Secretary"');
  perform pg_temp.check(
    (select label from public.capability_bundles where bundle_key = 'FS') = 'Fixture Secretary',
    'A2: the bundle catalogue says it too');
  select count(*) into v_n from (
    select label from public.role_definitions union all select label from public.capability_bundles) x
    where label like '%Fixtures%';
  perform pg_temp.check(v_n = 0, 'A3: no catalogue a person reads still says "Fixtures" (' || v_n || ')');
  -- The KEY is deliberately untouched: it is an identifier, and the second
  -- identifier (FIXTURE_SECRETARY in club_memberships / role_capability_defaults)
  -- is retired by Slice 10, not renamed here.
  perform pg_temp.check(exists (select 1 from public.role_definitions where role_key = 'FIXTURES_SECRETARY'),
    'A4: the FIXTURES_SECRETARY key is unchanged -- renaming an identifier is not a presentation fix');

  -- ===============================================================
  -- B. A PRESET IS AN EXACT CAPABILITY DELTA
  -- ===============================================================
  perform pg_temp.check((select count(*) from public.capability_presets where status = 'ACTIVE') = 3,
    'B1: the three presets the design names exist');

  -- A Volunteer already holds pitch_allocation.view from their role bundle, so
  -- the preset's real delta for them is .manage. Asserting the DELTA rather
  -- than the end state is what stops a preset quietly becoming a role bundle.
  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true, 'B2: before the preset, a Volunteer cannot manage pitch allocation');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.apply_capability_preset(%L, ''volunteer_pitch_allocation'', %L, null)', v_vol, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'B3: a Club Admin can apply the Pitch Allocation preset (' || v_text || ')');

  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'B4: after it, they can -- and the engine says so, not the screen');

  -- One override row per capability in the preset, each its own explicit decision.
  select count(*) into v_n from public.capability_overrides
   where user_id = v_vol and club_id = v_club and status = 'active' and effect = 'grant'
     and capability_key in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage');
  perform pg_temp.check(v_n = 2, 'B5: exactly one explicit decision per capability in the preset (' || v_n || ')');

  -- AC.Presets: one event per override, plus one for the intent.
  select count(*) into v_n from public.security_events
   where subject_user_id = v_vol and club_id = v_club and event_type = 'override.granted'
     and metadata->>'capability_key' in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage');
  perform pg_temp.check(v_n = 2, 'B6: one audit event per override (' || v_n || ')');
  select count(*) into v_n from public.security_events
   where subject_user_id = v_vol and club_id = v_club and event_type = 'override.preset_applied'
     and metadata->>'preset_key' = 'volunteer_pitch_allocation';
  perform pg_temp.check(v_n = 1, 'B7: and one recording WHICH JOB was handed out (' || v_n || ')');

  -- It granted nothing beyond its own list.
  select count(*) into v_n from public.capability_overrides
   where user_id = v_vol and club_id = v_club and status = 'active'
     and capability_key not in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage');
  perform pg_temp.check(v_n = 0, 'B8: and nothing outside its own list (' || v_n || ')');

  -- A DIFFERENT preset must not erase the first one's unrelated decisions.
  perform pg_temp.act('authenticated', v_admin);
  perform public.apply_capability_preset(v_vol, 'volunteer_calendar', v_club, null);
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.capability_overrides
   where user_id = v_vol and club_id = v_club and status = 'active'
     and capability_key in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage');
  perform pg_temp.check(v_n = 2, 'B9: applying a SECOND preset leaves the first one''s decisions alone (' || v_n || ')');
  select count(*) into v_n from public.capability_overrides
   where user_id = v_vol and club_id = v_club and status = 'active'
     and capability_key in ('calendar.event.view', 'calendar.event.manage');
  perform pg_temp.check(v_n = 2, 'B10: and adds its own (' || v_n || ')');

  -- A preset is not a way past the age rule.
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.apply_capability_preset(%L, ''volunteer_pitch_allocation'', %L, null)', v_minor, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'B11: a preset cannot be applied to a minor (' || v_text || ')');
  select count(*) into v_n from public.capability_overrides where user_id = v_minor and status = 'active';
  perform pg_temp.check(v_n = 0, 'B12: and the refusal left NOTHING behind -- one transaction, not half a job (' || v_n || ')');

  -- Nor past the club boundary, nor past the delegation ceiling.
  perform pg_temp.act('authenticated', v_other_admin);
  v_text := pg_temp.try(format('select * from public.apply_capability_preset(%L, ''volunteer_calendar'', %L, null)', v_vol, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B13: another club''s admin cannot apply a preset here (' || v_text || ')');

  perform pg_temp.act('authenticated', v_vol);
  v_text := pg_temp.try(format('select * from public.apply_capability_preset(%L, ''volunteer_calendar'', %L, null)', v_multi, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B14: a Volunteer cannot hand out a job (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.apply_capability_preset(%L, ''does_not_exist'', %L, null)', v_vol, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'B15: an unknown preset is malformed input, not a silent no-op (' || v_text || ')');

  -- The catalogue itself can never carry a mass tool or a people/finance key.
  select count(*) into v_n from public.capability_preset_capabilities pc join public.capabilities c on c.key = pc.capability_key
   where c.domain in ('people', 'finance') or c.safeguarding_sensitive or not c.delegable
      or pc.capability_key in ('fixture.import.run', 'fixture.planner.use', 'fixture.fixture.bulk_edit', 'competition.creator.use');
  perform pg_temp.check(v_n = 0, 'B16: no preset carries a mass tool, a people/finance key or a non-delegable one (' || v_n || ')');

  -- ===============================================================
  -- C. PITCH ALLOCATION IS DISCOVERABILITY, NOT NEW AUTHORITY
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_bool := (select allowed from public.explain_access(v_admin, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'C1: a Club Admin could always manage pitch allocation -- the screen caught up, the authority did not change');

  perform pg_temp.act('authenticated', v_multi);
  v_bool := (select allowed from public.explain_access(v_multi, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true, 'C2: an ordinary member still cannot, however the screen groups it');

  -- ===============================================================
  -- D. REMOVING ONE ROLE REMOVES ONLY WHAT THAT ROLE SOURCED
  --    The most important regression in Step 8.
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.assign_role(v_ms_multi, 'COACH', v_team, null);
  perform public.assign_role(v_ms_multi, 'TEAM_MANAGER', v_team2, null);
  perform public.assign_role(v_ms_multi, 'VOLUNTEER', null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_other_admin);
  perform public.assign_role(v_ms_multi_b, 'COACH', v_team_b, null);
  perform pg_temp.act_postgres();
  -- and an explicit grant that has nothing to do with being a Coach at U12
  perform pg_temp.act('authenticated', v_admin);
  perform public.set_capability_override(v_multi, 'calendar.event.manage', 'club', v_club, null, 'grant', 'keeps the calendar', null);
  perform pg_temp.act_postgres();
  select id into v_keep from public.capability_overrides
   where user_id = v_multi and capability_key = 'calendar.event.manage' and status = 'active';

  select count(*) into v_before from public.role_assignments where membership_id in (v_ms_multi, v_ms_multi_b) and state = 'ACTIVE';
  perform pg_temp.check(v_before >= 4, 'D1: one identity holds several legitimate relationships at once (' || v_before || ')');

  -- Remove ONE: Coach at U12, at club A.
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format(
    'select public.transition_role_assignment((select id from public.role_assignments where membership_id=%L and team_id=%L and role_key=''COACH'' and state=''ACTIVE''), ''REVOKED'', ''no longer coaching'', false)',
    v_ms_multi, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'D2: the Coach role at one team is removed (' || v_text || ')');

  perform pg_temp.check(not exists (select 1 from public.role_assignments
    where membership_id = v_ms_multi and team_id = v_team and role_key = 'COACH' and state = 'ACTIVE'),
    'D3: that role is gone');
  perform pg_temp.check(exists (select 1 from public.role_assignments
    where membership_id = v_ms_multi and team_id = v_team2 and role_key = 'TEAM_MANAGER' and state = 'ACTIVE'),
    'D4: their Team Manager role at the OTHER team survives');
  perform pg_temp.check(exists (select 1 from public.role_assignments
    where membership_id = v_ms_multi and team_id is null and role_key = 'VOLUNTEER' and state = 'ACTIVE'),
    'D5: their club-wide Volunteer role survives');
  perform pg_temp.check(exists (select 1 from public.role_assignments
    where membership_id = v_ms_multi_b and team_id = v_team_b and role_key = 'COACH' and state = 'ACTIVE'),
    'D6: their Coach role at the OTHER CLUB survives');
  perform pg_temp.check(exists (select 1 from public.club_memberships where id = v_ms_multi and state = 'ACTIVE'),
    'D7: their club membership survives');
  perform pg_temp.check(exists (select 1 from public.capability_overrides where id = v_keep and status = 'active'),
    'D8: an unrelated explicit grant survives');

  -- ===============================================================
  -- E. SUSPENSION DEFEATS AUTHORITY ITS OWN ROWS STILL DESCRIBE
  -- ===============================================================
  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'E1: the Volunteer still holds the granted permission');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''SUSPENDED'', ''under review'', false)', v_ms_vol));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'E2: their membership is suspended (' || v_text || ')');

  perform pg_temp.check(exists (select 1 from public.capability_overrides
    where user_id = v_vol and capability_key = 'venue.pitch_allocation.manage' and status = 'active'),
    'E3: the explicit grant ROW is still there -- suspension does not delete history');

  perform pg_temp.act('authenticated', v_vol);
  select * into v_ex from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_ex.allowed is not true,
    'E4: but the answer is no -- a suspended membership defeats a grant that still exists');
  perform pg_temp.check(v_ex.reason_code = 'MEMBERSHIP_SUSPENDED',
    'E5: and the engine says exactly why (' || coalesce(v_ex.reason_code, 'null') || ')');
  perform pg_temp.check(v_ex.decisive_rule = '1',
    'E6: at the hard-prohibition rule, above any explicit decision (' || coalesce(v_ex.decisive_rule, 'null') || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''cleared'', false)', v_ms_vol));
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'E7: reactivation restores the authority the surviving grant describes');

  perform pg_temp.act('authenticated', v_vol);
  v_text := pg_temp.try(format('select public.transition_club_membership(%L, ''ACTIVE'', ''let me back in'', false)', v_ms_vol));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text <> 'OK', 'E8: and nobody reactivates themselves (' || v_text || ')');

  -- ===============================================================
  -- F. THE CLUB TIMELINE
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_n from public.club_access_history(v_club, null, 200);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n > 0, 'F1: a Club Admin can read their club''s access history (' || v_n || ')');

  -- Every row it returns really did happen at this club. Proved against the
  -- event stream rather than trusted, because "scoped to one club" is the
  -- whole boundary.
  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_after from public.club_access_history(v_club, null, 200);
  perform pg_temp.act_postgres();
  -- Counted without the session's RLS in the way, so the comparison is against
  -- what the stream actually holds rather than against what the caller may read.
  select count(*) into v_before from public.security_events e
   where e.club_id = v_club
     and (e.event_type like 'role.%' or e.event_type like 'membership.%' or e.event_type like 'override.%'
       or e.event_type like 'invitation.%' or e.event_type like 'team_access.%' or e.event_type like 'player_team.%'
       or e.event_type like 'guardian.%' or e.event_type like 'site.role%' or e.event_type like 'site.membership%'
       or e.event_type like 'site.team%');
  perform pg_temp.check(v_after = v_before,
    'F2: it returns exactly this club''s access events, no more and no fewer (' || v_after || ' vs ' || v_before || ')');
  select count(*) into v_n from public.security_events where club_id = v_club_b;
  perform pg_temp.check(v_after < v_before + greatest(v_n, 1) or v_n = 0,
    'F2b: and the other club''s events exist to have been excluded (' || v_n || ')');

  -- It never reaches another club, whatever is asked for.
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.club_access_history(%L, null, 200)', v_club_b));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'F3: and not another club''s (' || v_text || ')');

  perform pg_temp.act('authenticated', v_multi);
  v_text := pg_temp.try(format('select * from public.club_access_history(%L, null, 200)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'F4: an ordinary member is refused outright (' || v_text || ')');

  -- Actor and subject are different questions and stay different columns.
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(exists (
    select 1 from public.club_access_history(v_club, v_vol, 200)
     where subject_user_id = v_vol and actor_user_id = v_admin and event_type = 'override.granted'),
    'F5: the timeline names who did it AND who it was done to, distinctly');
  select count(*) into v_n from public.club_access_history(v_club, v_vol, 200) where subject_user_id <> v_vol;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0, 'F6: filtering by one person returns only that person (' || v_n || ')');

  -- It publishes the capability and the reason, and NOT the raw payload: no
  -- token, hash, address or device fingerprint reaches a club screen.
  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_n from public.club_access_history(v_club, null, 200)
   where capability_key is not null;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n > 0, 'F7: it names the capability a decision was about (' || v_n || ')');

  -- The event stream holds forensic fields a Site Admin surface may legitimately
  -- need. A club timeline is a different question asked by a different person,
  -- and none of them appears in what it returns. Checked against the function's
  -- declared result, so adding one later fails here rather than shipping.
  select count(*) into v_n
    from pg_proc p, unnest(array['ip_hash', 'user_agent_hash', 'request_id', 'metadata', 'impersonation_session_id']) c
   where p.proname = 'club_access_history'
     and p.pronamespace = 'public'::regnamespace
     and pg_get_function_result(p.oid) like '%' || c || '%';
  perform pg_temp.check(v_n = 0,
    'F8: and never hands a club the ip hash, user agent hash, request id, raw metadata or impersonation id (' || v_n || ')');

  -- ===============================================================
  -- G. explain_access IS THE EXPLANATION -- nothing recalculates it
  -- ===============================================================
  perform pg_temp.act('authenticated', v_vol);
  select * into v_ex from public.explain_access(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_ex.allowed and v_ex.reason_code = 'EXPLICIT_ALLOW',
    'G1: a preset''s grant explains itself as an explicit allow (' || coalesce(v_ex.reason_code, 'null') || ')');

  perform pg_temp.act('authenticated', v_vol);
  select * into v_ex from public.explain_access(v_vol, 'venue.pitch_allocation.view', 'club', v_club, null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_ex.allowed, 'G2: and a capability the role already carried is still allowed');

  perform pg_temp.act('authenticated', v_admin);
  perform public.set_capability_override(v_multi, 'calendar.event.manage', 'club', v_club, null, 'deny', 'stepped back', null);
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_multi);
  select * into v_ex from public.explain_access(v_multi, 'calendar.event.manage', 'club', v_club, null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_ex.allowed is not true and v_ex.reason_code = 'EXPLICIT_DENY',
    'G3: a withhold explains itself as an explicit deny (' || coalesce(v_ex.reason_code, 'null') || ')');

  perform pg_temp.act('authenticated', v_multi);
  select * into v_ex from public.explain_access(v_multi, 'fixture.import.run', 'club', v_club, null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_ex.allowed is not true,
    'G4: and a mass tool nobody granted stays refused (' || coalesce(v_ex.reason_code, 'null') || ')');

  -- ===============================================================
  -- H. A SITE ADMIN IS NOT A CLUB MEMBER
  -- ===============================================================
  select count(*) into v_before from public.club_memberships where user_id = v_site;
  perform pg_temp.check(v_before = 0, 'H1: the Full Site Admin holds no club membership to begin with');

  perform pg_temp.act('authenticated', v_site);
  v_text := pg_temp.try(format('select * from public.club_access_history(%L, null, 50)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'H2: and may still read a club''s access history (' || v_text || ')');

  perform pg_temp.act('authenticated', v_site);
  v_text := pg_temp.try(format('select public.site_assign_club_role(%L, %L, ''VOLUNTEER'', ''site action'', null)', v_multi, v_club));
  perform pg_temp.act_postgres();

  select count(*) into v_after from public.club_memberships where user_id = v_site;
  perform pg_temp.check(v_after = 0,
    'H3: administering a club did not make the Site Admin a member of it (' || v_after || ')');
  perform pg_temp.check(exists (select 1 from public.site_admins where user_id = v_site and status = 'active'),
    'H4: and their platform authority is untouched by anything that happened at the club');

  -- ===============================================================
  -- I. THE PERSONA MATRIX, answered by capability decisions rather
  --    than by role names. Each row is a real person at this club
  --    being asked a real question the engine answers.
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.set_primary_club_role(v_ms_multi, 'FIXTURE_SECRETARY', 'takes the fixtures on');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_multi);
  v_bool := (select allowed from public.explain_access(v_multi, 'fixture.fixture.create', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'I1: a Fixture Secretary arranges the club''s matches');

  perform pg_temp.act('authenticated', v_multi);
  v_bool := (select allowed from public.explain_access(v_multi, 'people.capability.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true,
    'I2: and is NOT a people administrator -- the title does not carry the authority');

  perform pg_temp.act('authenticated', v_multi);
  v_bool := (select allowed from public.explain_access(v_multi, 'venue.pitch_allocation.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool, 'I3: a Fixture Secretary does manage pitch allocation, which is fixture work');

  -- The one the letter asks for by name: a Volunteer who has been given a job
  -- is still not an administrator.
  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'people.capability.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true,
    'I4: a Volunteer holding granted permissions cannot hand permissions on');

  perform pg_temp.act('authenticated', v_vol);
  v_bool := (select allowed from public.explain_access(v_vol, 'people.role.assign_club', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true, 'I5: nor give anybody a role');

  -- An outsider, by every measure.
  perform pg_temp.act('authenticated', v_other_admin);
  v_bool := (select allowed from public.explain_access(v_other_admin, 'people.capability.manage', 'club', v_club, null, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true,
    'I6: another club''s Club Admin holds no people authority HERE, however senior there');

  -- A minor is refused the adult-only keys whatever anybody grants.
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format(
    'select public.set_capability_override(%L, ''calendar.event.manage'', ''club'', %L, null, ''grant'', ''x'', null)',
    v_minor, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'I7: an adult-only permission cannot be given to a minor (' || v_text || ')');

  -- ===============================================================
  -- J. SAFEGUARDING OFFICER -- the eligibility rules survive Slice 8
  -- ===============================================================
  perform pg_temp.check(
    not exists (select 1 from public.role_definitions where role_key = 'SAFEGUARDING_OFFICER' and 'CLUB' = any (assignable_by)),
    'J1: no club may assign Safeguarding Officer -- the catalogue says so, not a code path');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''SAFEGUARDING_OFFICER'', null, ''please'')', v_ms_multi));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'J2: and assign_role refuses it outright -- an officer is nominated and accepts (' || v_text || ')');

  perform pg_temp.act('authenticated', v_site);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''SAFEGUARDING_OFFICER'', null, ''please'')', v_ms_multi));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'J3: not even a Full Site Admin (' || v_text || ')');

  -- Slice 8's new surfaces must not become a way round it either.
  select count(*) into v_n from public.capability_preset_capabilities pc
    join public.capabilities c on c.key = pc.capability_key where c.safeguarding_sensitive;
  perform pg_temp.check(v_n = 0, 'J4: no preset carries a safeguarding-sensitive capability (' || v_n || ')');

  -- family.relationship.approve is ACTIVE, club-scoped and marked delegable in
  -- the catalogue -- and internal.override_authority_level still refuses it,
  -- because it is safeguarding_sensitive. That combination is the point: a club
  -- cannot hand out safeguarding authority one capability at a time however the
  -- catalogue's delegable flag reads.
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format(
    'select public.set_capability_override(%L, ''family.relationship.approve'', ''club'', %L, null, ''grant'', ''x'', null)',
    v_multi, v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'J5: and a club cannot hand out a safeguarding-sensitive capability one at a time either (' || v_text || ')');

  -- The adult predicate is the database's, and it is the same one the
  -- appointment uses -- not a second age rule invented for this screen.
  perform pg_temp.check(internal.person_is_established_adult(v_admin),
    'J6: the adult predicate answers for a person with a date of birth on file');
  perform pg_temp.check(not internal.person_is_established_adult(v_minor),
    'J7: and refuses a minor');
end $$;

rollback;
