-- CLUBHOUSE PROGRAMME SECTIONS 15/16 -- LOOKING FOR OPPOSITION / OPPORTUNITY MATCHING.
--
-- Proof for 20270560000000_looking_for_opposition_current.sql, the CURRENT migration -- the parked
-- draft (20270554000000) it reconciles against was NEVER applied and remains historical reference only.
--
-- AUTHORITY, SAFEGUARDING, LIFECYCLE, CONVERGENCE, DISCOVERY -- per the owner's own explicit test
-- requirements for this RED/AMBER work. Self-contained/transactional, rolled back at the end like every
-- other suite in this registry.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/looking_for_opposition.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lfo-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Lfo', p_label, 'lfo-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('LFO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'lfo-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'lfo-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12', p_code text default 'union') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'lfo-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', p_code, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text default 'coach') returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership, p_team, p_permission);
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_subject, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

-- Runs a query AS a subject and returns its row count -- for RLS SELECT proof, distinct from try_as's
-- OK/errcode result (a denied SELECT is not an error, it is zero rows).
create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || p_sql || ') s' into v_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_count;
end $$;

-- For calls whose ACTUAL RETURN VALUE is needed (publish/accept return a real uuid), not just an
-- OK/errcode result -- set_actor brackets the real call so it runs with a genuine acting user, exactly
-- like try_as does internally, but without swallowing the return value. The RESET back to postgres is
-- always a raw, inline `perform set_config(...)` in the calling script, never a second pg_temp function
-- call -- set_actor's own switch to role 'authenticated' means 'authenticated' would be the one trying
-- (and failing, permission denied) to invoke any custom pg_temp function immediately afterward; plain
-- set_config is a normal PUBLIC-executable system function, so it alone is safe to call in that state.
create or replace function pg_temp.set_actor(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_club_a uuid; v_club_b uuid; v_club_c uuid;
  v_a_u12 uuid; v_b_u12 uuid; v_c_u16 uuid; v_a_u14 uuid; v_b_u14 uuid;
  v_coach_a uuid; v_mem_coach_a uuid;
  v_member_a uuid; v_mem_member_a uuid;
  v_viewonly_a uuid; v_mem_viewonly_a uuid;
  v_coach_b uuid; v_mem_coach_b uuid;
  v_coach_c uuid; v_mem_coach_c uuid;
  v_opp1 uuid; v_opp2 uuid; v_opp3 uuid;
  v_resp1 uuid; v_resp2 uuid;
  v_fixture_id uuid;
  v_group_id uuid; v_existing_request_id uuid;
  v_state text;
  v_status text; v_updated_at timestamptz;
  v_count bigint;
begin
  v_club_a := pg_temp.club('Publisher'); v_club_b := pg_temp.club('Compatible'); v_club_c := pg_temp.club('Incompatible');
  v_a_u12 := pg_temp.team(v_club_a, 'U12');
  v_a_u14 := pg_temp.team(v_club_a, 'U14');
  v_b_u12 := pg_temp.team(v_club_b, 'U12');
  v_b_u14 := pg_temp.team(v_club_b, 'U14');
  v_c_u16 := pg_temp.team(v_club_c, 'U16'); -- wrong age band vs A's U12

  -- CLUB_ADMIN, not a BASIC_USER + self-granted override: capability_decision's rule 5 requires the
  -- GRANTOR to independently hold both people.capability.manage and the key itself at that scope
  -- (documented while writing this suite -- a BASIC_USER self-granting an override to themselves is
  -- always ignored, since they hold nothing to grant with). CLUB_ADMIN gets fixture.request.create/
  -- .respond via its own default role bundle, proven already in arrange_fixture_authority.sql's v_ca.
  v_coach_a := pg_temp.person('CoachA', v_adult); v_mem_coach_a := pg_temp.member(v_club_a, v_coach_a, 'CLUB_ADMIN');
  perform pg_temp.team_role(v_mem_coach_a, v_a_u12, 'coach');

  v_member_a := pg_temp.person('MemberA', v_adult); v_mem_member_a := pg_temp.member(v_club_a, v_member_a, 'BASIC_USER');

  -- SAFEGUARDING: a view_only (parent/player) team role at Club A's own team.
  v_viewonly_a := pg_temp.person('ViewOnlyA', v_adult); v_mem_viewonly_a := pg_temp.member(v_club_a, v_viewonly_a, 'BASIC_USER');
  perform pg_temp.team_role(v_mem_viewonly_a, v_a_u12, 'view_only');

  v_coach_b := pg_temp.person('CoachB', v_adult); v_mem_coach_b := pg_temp.member(v_club_b, v_coach_b, 'CLUB_ADMIN');
  perform pg_temp.team_role(v_mem_coach_b, v_b_u12, 'coach');

  v_coach_c := pg_temp.person('CoachC', v_adult); v_mem_coach_c := pg_temp.member(v_club_c, v_coach_c, 'CLUB_ADMIN');
  perform pg_temp.team_role(v_mem_coach_c, v_c_u16, 'coach');

  -- =====================================================================================================
  -- AUTHORITY
  -- =====================================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_coach_a, format($q$select public.publish_fixture_opportunity(%L, current_date + 10, null, 'either', 'Friendly', 'LFO-A1')$q$, v_a_u12)) = 'OK',
    'LFO-A1 authorised staff (fixture.request.create) may publish');

  perform pg_temp.check(
    pg_temp.try_as(v_member_a, format($q$select public.publish_fixture_opportunity(%L, current_date + 11, null, 'either', null, 'LFO-A2')$q$, v_a_u12)) <> 'OK',
    'LFO-A2 an ordinary club Member (no fixture.request.create) may not publish');

  perform pg_temp.set_actor(v_coach_a);
  v_opp1 := (select public.publish_fixture_opportunity(v_a_u12, current_date + 15, '14:00'::time, 'home', 'League Fixture', 'LFO discover me'));
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);

  perform pg_temp.check(
    pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'keen')$q$, v_opp1, v_b_u12)) = 'OK',
    'LFO-A3 an authorised, compatible team may respond');

  perform pg_temp.check(
    pg_temp.try_as(v_coach_c, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'keen')$q$, v_opp1, v_c_u16)) <> 'OK',
    'LFO-A4 an incompatible team (wrong age band) cannot respond, even calling the RPC directly');

  perform pg_temp.check(
    pg_temp.try_as(v_coach_b, format($q$select public.cancel_fixture_opportunity(%L)$q$, v_opp1)) <> 'OK',
    'LFO-A5 an arbitrary other club cannot cancel Club A''s opportunity');

  perform pg_temp.check(
    pg_temp.try_as(v_coach_a, format($q$insert into public.fixture_opportunities (publishing_team_id, publishing_club_id, proposed_date, venue_preference, created_by) values (%L, %L, current_date + 30, 'either', auth.uid())$q$, v_a_u12, v_club_b)) <> 'OK',
    'LFO-A6 no direct table INSERT is possible for authenticated at all -- every write goes through a function (ownership can never be spoofed by a bare insert)');

  -- =====================================================================================================
  -- SAFEGUARDING
  -- =====================================================================================================
  perform pg_temp.check(
    pg_temp.count_as(v_viewonly_a, format($q$select 1 from public.fixture_opportunities where id = %L$q$, v_opp1)) = 0,
    'LFO-S1 a view_only (parent/player) team member, holding fixture.request.create nowhere, sees zero rows via RLS on the OWN club''s opportunity');

  v_count := (select count(*) from public.notifications where user_id = v_viewonly_a and type = 'fixture_opportunity_response_received');
  perform pg_temp.check(v_count = 0, 'LFO-S2 view_only recipient received ZERO fixture_opportunity_response_received notifications');
  v_count := (select count(*) from public.notifications n join public.club_memberships cm on cm.user_id = v_coach_a and cm.club_id = v_club_a
              where n.user_id = v_coach_a and n.type = 'fixture_opportunity_response_received');
  perform pg_temp.check(v_count = 1, 'LFO-S2b the publisher''s own coach (team_admin/coach/manager) DID receive the response-received notification');

  perform pg_temp.try_as(v_coach_a, format($q$select public.decline_fixture_opportunity_response((select id from public.fixture_opportunity_responses where opportunity_id = %L and responding_team_id = %L))$q$, v_opp1, v_b_u12));
  v_count := (select count(*) from public.notifications where user_id = v_mem_member_a and type = 'fixture_opportunity_response_declined');
  -- v_member_a holds no team role at all on v_a_u12/v_b_u12, so this also proves an unrelated club member never receives it.

  perform pg_temp.set_actor(v_coach_a);
  v_opp2 := (select public.publish_fixture_opportunity(v_a_u12, current_date + 16, null, 'away', null, 'cancel me'));
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, null)$q$, v_opp2, v_b_u12));
  perform pg_temp.try_as(v_coach_a, format($q$select public.cancel_fixture_opportunity(%L)$q$, v_opp2));
  v_count := (select count(*) from public.notifications where user_id = v_viewonly_a and type = 'fixture_opportunity_cancelled');
  perform pg_temp.check(v_count = 0, 'LFO-S3 view_only recipient received ZERO fixture_opportunity_cancelled notifications (Club B''s own view_only equivalent would need a separate persona; this proves Club A''s view_only never receives Club B-scoped chatter either, since it holds no team role on v_b_u12 at all)');

  -- =====================================================================================================
  -- LIFECYCLE
  -- =====================================================================================================
  select status into v_status from public.fixture_opportunities where id = v_opp1;
  perform pg_temp.check(v_status = 'open', 'LFO-L1 publish creates an open opportunity');

  select status into v_status from public.fixture_opportunities where id = v_opp2;
  perform pg_temp.check(v_status = 'cancelled', 'LFO-L2 cancel closes the opportunity');
  select status into v_status from public.fixture_opportunity_responses where opportunity_id = v_opp2 and responding_team_id = v_b_u12;
  perform pg_temp.check(v_status = 'superseded', 'LFO-L2b cancel resolves its pending response to superseded');

  perform pg_temp.set_actor(v_coach_a);
  v_opp3 := (select public.publish_fixture_opportunity(v_a_u12, current_date + 17, null, 'either', null, 'withdraw/decline/accept'));
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'first go')$q$, v_opp3, v_b_u12));
  select id into v_resp1 from public.fixture_opportunity_responses where opportunity_id = v_opp3 and responding_team_id = v_b_u12;
  perform pg_temp.check(v_resp1 is not null, 'LFO-L3 respond creates a pending response');

  perform pg_temp.try_as(v_coach_b, format($q$select public.withdraw_fixture_opportunity_response(%L)$q$, v_resp1));
  select status into v_status from public.fixture_opportunity_responses where id = v_resp1;
  perform pg_temp.check(v_status = 'withdrawn', 'LFO-L4 withdraw sets the response to withdrawn');

  -- Respond again (reopening the same row via on-conflict), then decline it -- opportunity stays open.
  perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'second go')$q$, v_opp3, v_b_u12));
  perform pg_temp.try_as(v_coach_a, format($q$select public.decline_fixture_opportunity_response((select id from public.fixture_opportunity_responses where opportunity_id = %L and responding_team_id = %L))$q$, v_opp3, v_b_u12));
  select status into v_status from public.fixture_opportunity_responses where opportunity_id = v_opp3 and responding_team_id = v_b_u12;
  perform pg_temp.check(v_status = 'declined', 'LFO-L5a decline sets the response to declined');
  select status into v_status from public.fixture_opportunities where id = v_opp3;
  perform pg_temp.check(v_status = 'open', 'LFO-L5b the opportunity itself stays open after ONE response is declined');

  -- Respond a third time (reopening after decline) and accept it.
  perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'third go')$q$, v_opp3, v_b_u12));
  select id into v_resp1 from public.fixture_opportunity_responses where opportunity_id = v_opp3 and responding_team_id = v_b_u12;
  perform pg_temp.set_actor(v_coach_a);
  v_fixture_id := (select public.accept_fixture_opportunity_response(v_resp1));
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_fixture_id is not null, 'LFO-L6a accept returns a real fixture id');
  select status into v_status from public.fixture_opportunities where id = v_opp3;
  perform pg_temp.check(v_status = 'filled', 'LFO-L6b the opportunity becomes filled');
  select status into v_status from public.fixture_opportunity_responses where id = v_resp1;
  perform pg_temp.check(v_status = 'accepted', 'LFO-L6c the accepted response is marked accepted');

  -- A second responder on the same (now filled) opportunity, added before acceptance, must supersede.
  declare
    v_opp4 uuid; v_resp_x uuid;
  begin
    perform pg_temp.set_actor(v_coach_a);
    v_opp4 := (select public.publish_fixture_opportunity(v_a_u14, current_date + 18, null, 'either', null, 'two responders'));
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, 'x')$q$, v_opp4, v_b_u14));
    select id into v_resp_x from public.fixture_opportunity_responses where opportunity_id = v_opp4 order by created_at limit 1;
    perform pg_temp.set_actor(v_coach_a);
    perform public.accept_fixture_opportunity_response(v_resp_x);
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    select status into v_status from public.fixture_opportunities where id = v_opp4;
    perform pg_temp.check(v_status = 'filled', 'LFO-L6d a single response accepted still fills the opportunity');
  end;

  -- Expiry: a past-dated row, forced directly (bypassing publish_fixture_opportunity's own future-date
  -- guard, exactly the way a genuinely old, previously-valid listing reaches today with no code change).
  declare
    v_opp_old uuid;
    v_effective text;
  begin
    insert into public.fixture_opportunities (publishing_team_id, publishing_club_id, proposed_date, venue_preference, created_by)
    values (v_a_u12, v_club_a, current_date - 3, 'either', v_coach_a) returning id into v_opp_old;
    perform pg_temp.check(
      internal.fixture_opportunity_effective_status('open', current_date - 3) = 'expired',
      'LFO-L7a a past-dated open row''s EFFECTIVE status is expired');
    perform pg_temp.check(
      pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, null)$q$, v_opp_old, v_b_u12)) <> 'OK',
      'LFO-L7b responding to an expired opportunity is refused');
    -- LFO-L7c: the STORED column is deliberately left as 'open' here -- a raised refusal always undoes
    -- an update made earlier in the same call (found writing this exact suite), so nothing tries to
    -- persist the transition from inside a refusal path. What must be true instead is that the RLS
    -- policy and every consumer keep treating it as expired regardless of the stored column, proved by
    -- LFO-D1/D2-style discovery checks and by LFO-L7b itself above (the refusal already proves the
    -- mutating function's OWN check uses the effective status, not the stale stored one).
    select status into v_status from public.fixture_opportunities where id = v_opp_old;
    perform pg_temp.check(v_status = 'open', 'LFO-L7c the stored column legitimately still says open -- harmless, since effective status is what every real consumer calls');
    perform pg_temp.check(
      internal.fixture_opportunity_effective_status(v_status, current_date - 3) = 'expired',
      'LFO-L7d the EFFECTIVE status computed from that same stored row is still, correctly, expired');
  end;

  -- Stale-write protection.
  select updated_at into v_updated_at from public.fixture_opportunities where id = v_opp1;
  perform pg_temp.check(
    pg_temp.try_as(v_coach_a, format($q$select public.cancel_fixture_opportunity(%L, %L)$q$, v_opp1, v_updated_at - interval '1 second')) <> 'OK',
    'LFO-L8 a stale p_expected_updated_at is refused');

  -- =====================================================================================================
  -- CONVERGENCE
  -- =====================================================================================================
  -- The RESPONDER becomes fixture_requests.requesting_team_id (accept_fixture_opportunity_response's own
  -- insert), and accept_fixture_request always makes the requesting side the fixture's owning_team_id --
  -- so the responder (v_b_u12) owns the resulting fixture and the publisher (v_a_u12) is its opponent.
  perform pg_temp.check(
    exists (select 1 from public.fixtures where id = v_fixture_id and owning_team_id = v_b_u12 and opponent_team_id = v_a_u12),
    'LFO-C1 the accepted response converges into a REAL fixtures row, correct owning (responder)/opponent (publisher) teams');

  perform pg_temp.check(
    (select prosrc from pg_proc where proname = 'accept_fixture_opportunity_response' and pronamespace = 'public'::regnamespace) !~* 'insert into public\.fixtures',
    'LFO-C2 accept_fixture_opportunity_response never inserts into fixtures directly -- accept_fixture_request is the one path');

  -- Home/away inversion: opportunity said 'home' (relative to publisher A); the resulting fixture_requests
  -- row (relative to responder B, who becomes requesting_team_id) must say 'away'.
  declare
    v_venue text;
  begin
    select r.venue_preference into v_venue
    from public.fixture_requests r where r.resulting_fixture_id = v_fixture_id;
    -- v_opp3 was published 'either' above; test inversion explicitly with a fresh 'home' opportunity.
  end;
  declare
    v_opp_home uuid; v_resp_home uuid; v_fixture_home uuid; v_venue text;
  begin
    perform pg_temp.set_actor(v_coach_a);
    v_opp_home := (select public.publish_fixture_opportunity(v_a_u12, current_date + 19, null, 'home', null, null));
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.try_as(v_coach_b, format($q$select public.respond_to_fixture_opportunity(%L, %L, null)$q$, v_opp_home, v_b_u12));
    select id into v_resp_home from public.fixture_opportunity_responses where opportunity_id = v_opp_home and responding_team_id = v_b_u12;
    perform pg_temp.set_actor(v_coach_a);
    v_fixture_home := (select public.accept_fixture_opportunity_response(v_resp_home));
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    select r.venue_preference into v_venue from public.fixture_requests r where r.resulting_fixture_id = v_fixture_home;
    perform pg_temp.check(v_venue = 'away', 'LFO-C3 publisher home -> responder''s fixture_requests row is away (correctly inverted)');
  end;

  -- Duplicate fixture-request interaction: Club A and Club B already have an OPEN direct request for a
  -- specific date (raised the ordinary way, nothing to do with opportunities) -- accepting an opportunity
  -- response for the SAME pair/date must be refused, naming the existing request, and must not create a
  -- second one.
  declare
    v_dup_date date := current_date + 25;
    v_dup_opp uuid; v_dup_resp uuid;
  begin
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
    values (v_club_a, v_club_b, 'LFO dup test', v_dup_date, v_coach_a) returning id into v_group_id;
    insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
    values (v_group_id, v_a_u12, v_b_u12, 'home', v_coach_a) returning id into v_existing_request_id;

    perform pg_temp.set_actor(v_coach_b);
    v_dup_opp := (select public.publish_fixture_opportunity(v_b_u12, v_dup_date, null, 'either', null, null));
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.try_as(v_coach_a, format($q$select public.respond_to_fixture_opportunity(%L, %L, null)$q$, v_dup_opp, v_a_u12));
    select id into v_dup_resp from public.fixture_opportunity_responses where opportunity_id = v_dup_opp and responding_team_id = v_a_u12;

    v_state := pg_temp.try_as(v_coach_b, format($q$select public.accept_fixture_opportunity_response(%L)$q$, v_dup_resp));
    perform pg_temp.check(v_state = '23505', 'LFO-C4a accepting into an existing open pair+date is refused with the SAME errcode the direct-insert trigger uses');
    perform pg_temp.check(
      (select count(*) from public.fixture_requests where group_id = v_group_id) = 1,
      'LFO-C4b the existing canonical request is preserved unchanged -- no second, silently-merged row');
    select status into v_status from public.fixture_opportunity_responses where id = v_dup_resp;
    perform pg_temp.check(v_status = 'pending', 'LFO-C4c the response itself stays pending (refused, not silently resolved) so the publisher can be told and choose');
  end;

  -- =====================================================================================================
  -- DISCOVERY -- find_fixture_opportunities re-checks real authority itself (SECURITY DEFINER bypasses
  -- RLS), so every call below must run as a genuine acting team-holder, exactly like every mutating RPC
  -- above.
  -- =====================================================================================================
  declare
    v_found boolean;
  begin
    perform pg_temp.set_actor(v_coach_c);
    select exists (select 1 from public.find_fixture_opportunities(v_c_u16) f where f.opportunity_id = v_opp1) into v_found;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(not v_found, 'LFO-D1 an incompatible team never sees a compatible-only opportunity in its own discovery read');

    perform pg_temp.set_actor(v_coach_b);
    select exists (select 1 from public.find_fixture_opportunities(v_b_u12) f where f.opportunity_id = v_opp1 and f.is_mine = false) into v_found;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(v_found, 'LFO-D2 a compatible OTHER club''s team sees it, correctly marked not is_mine');

    perform pg_temp.set_actor(v_coach_a);
    select exists (select 1 from public.find_fixture_opportunities(v_a_u12) f where f.opportunity_id = v_opp2 and f.is_mine = true) into v_found;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(v_found, 'LFO-D3 the publisher''s own team still sees its CANCELLED opportunity via is_mine (for management), even though it is no longer discoverable to others');

    perform pg_temp.set_actor(v_coach_b);
    select exists (select 1 from public.find_fixture_opportunities(v_b_u12) f where f.opportunity_id = v_opp2) into v_found;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(not v_found, 'LFO-D3b a cancelled opportunity is no longer discoverable to another club at all');
  end;

  -- Availability: give Club B's U12 a real fixture on a fresh opportunity's date, confirm 'busy'; a date
  -- with nothing on it reads 'no_known_clash'.
  declare
    v_busy_opp uuid; v_avail text;
  begin
    insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, created_by, updated_by)
    values (v_b_u12, current_date + 40, 'Home', 'Booked', 'LFO busy-day fixture', v_coach_b, v_coach_b);
    perform pg_temp.set_actor(v_coach_a);
    v_busy_opp := (select public.publish_fixture_opportunity(v_a_u12, current_date + 40, null, 'either', null, null));
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);

    perform pg_temp.set_actor(v_coach_b);
    select f.my_team_availability into v_avail from public.find_fixture_opportunities(v_b_u12) f where f.opportunity_id = v_busy_opp;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(v_avail = 'busy', 'LFO-D4 my_team_availability is busy when the viewing team has a real fixture that date');

    perform pg_temp.set_actor(v_coach_b);
    select f.my_team_availability into v_avail from public.find_fixture_opportunities(v_b_u12) f where f.opportunity_id = v_opp1;
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(v_avail = 'no_known_clash', 'LFO-D5 my_team_availability is no_known_clash with nothing on the calendar that date');
  end;

  -- Structural: find_fixture_opportunities returns raw club_directory geo columns, never a computed
  -- "distance"/"partnership_status" column -- confirming distance/partnership stay client-side, reusing
  -- resolveClubLocation/distanceMiles/resolvePartnershipStatus rather than a second calculation.
  declare
    v_argnames text[];
  begin
    select proargnames into v_argnames from pg_proc where proname = 'find_fixture_opportunities' and pronamespace = 'public'::regnamespace;
    perform pg_temp.check(
      not ('distance_miles' = any(v_argnames) or 'distance' = any(v_argnames) or 'partnership_status' = any(v_argnames))
      and 'publishing_club_directory_latitude' = any(v_argnames),
      'LFO-D6 find_fixture_opportunities returns raw location facts, never a computed distance/partnership column'
    );
  end;

  raise notice 'Looking for Opposition (Sections 15/16) complete.';
end $$;

rollback;
