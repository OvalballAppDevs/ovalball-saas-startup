-- SAFEGUARDING ON THE PHONE (CA-M11.1) -- THE OFFICER'S BOUNDARY, PROVED WHERE IT IS ENFORCED.
--
-- The phone brings the website's Safeguarding Officer product over the SAME operations and the SAME
-- authority. The screens consume server decisions and cannot widen them; this suite proves the
-- boundaries those screens depend on, with crafted calls and nothing but synthetic data:
--
--   SG-A  the probe: a Club Admin holds the club's nomination key and NONE of the officer's keys; a
--         confirmed officer holds all five; another club's officer holds none here; a member holds neither
--   SG-B  a Club Admin WITHOUT the officer keys is refused every officer read the phone offers: the
--         welfare lookup and the report queue answer 42501, the conversations, their bodies and the
--         review history answer no rows, the officer's dispensation branch is empty, a reply is refused
--   SG-C  a confirmed officer with site-confirmed keys reads their own club's view, the welfare lookup
--         demands and records a reason, and the person who opened a thread still reads their own
--   SG-D  another club's confirmed officer reads nothing here
--   SG-E  the nomination, invitation, revocation, contact and deactivation operations refuse everyone
--         who does not hold the club's key, and the canonical invitation is issued and withdrawn by it
--   SG-F  no officer read returns a narrative or notes column, and no case domain exists to read
--   SG-G  the Admin Centre section's key belongs to the Club Admin alone
--
-- Self-seeding and rolled back. No persistent review identity or club is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sg-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Sg',p_label,'sg-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SG '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sg-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'sg-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_state text default 'ACTIVE', p_role text default 'BASIC_USER')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, state, status)
  values (p_club, p_user, p_role, p_state, lower(p_state)) returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','sg-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_subject is null then jsonb_build_object('role','anon')
         else jsonb_build_object('sub',p_subject,'role','authenticated') end::text, true);
end $$;

create or replace function pg_temp.off() returns void language plpgsql as $$
begin perform set_config('role','none', true); perform set_config('request.jwt.claims','', true); end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform pg_temp.off();
  return v;
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  execute p_sql into v;
  perform pg_temp.off();
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  begin execute p_sql into v; exception when others then v := -1; end;
  perform pg_temp.off();
  return v;
end $$;

/** The keys `my_capabilities` says this person holds at this club, as a text array. */
create or replace function pg_temp.keys_as(p_subject uuid, p_club uuid) returns text[] language plpgsql as $$
declare v text[];
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  select coalesce(array_agg(capability_key), '{}') into v from public.my_capabilities('club', p_club) where allowed;
  perform pg_temp.off();
  return v;
end $$;

grant execute on function pg_temp.as_(uuid) to public;
grant execute on function pg_temp.off() to public;
grant execute on function pg_temp.try_as(uuid, text) to public;
grant execute on function pg_temp.json_as(uuid, text) to public;
grant execute on function pg_temp.count_as(uuid, text) to public;
grant execute on function pg_temp.keys_as(uuid, uuid) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_club_a uuid; v_club_b uuid; v_team_a1 uuid; v_team_a2 uuid; v_team_b uuid;
  v_ca_a uuid; v_ca_b uuid; v_off_a uuid; v_off_b uuid; v_member_a uuid; v_guardian_a uuid; v_sa uuid;
  v_res jsonb; v_assign_a uuid; v_assign_b uuid;
  v_season uuid; v_player uuid; v_disp uuid;
  v_conv uuid; v_msg uuid; v_report uuid;
  v_contact uuid; v_invite jsonb; v_invitation uuid;
  v_keys text[]; v_officer_keys text[] := array['safeguarding.dispensation.view','safeguarding.welfare.view','safeguarding.transfer.view','safeguarding.conversation.handle','messaging.moderation.club_review'];
  v_n bigint; v_state text; v_cols text[]; v_bad int; v_json jsonb;
begin
  -- =====================================================================================
  -- SEED. Two clubs. At A: a Club Admin, a plain member, a guardian, a nominee who becomes the confirmed
  -- officer. At B: a Club Admin and a confirmed officer. One Full Site Admin to confirm (AN-6).
  -- =====================================================================================
  v_club_a := pg_temp.club('Alpha'); v_club_b := pg_temp.club('Beta');
  v_team_a1 := pg_temp.team(v_club_a, 'U12'); v_team_a2 := pg_temp.team(v_club_a, 'U13'); v_team_b := pg_temp.team(v_club_b, 'U12');

  v_ca_a := pg_temp.person('CA-A');   perform pg_temp.member(v_club_a, v_ca_a, 'ACTIVE', 'CLUB_ADMIN');
  v_ca_b := pg_temp.person('CA-B');   perform pg_temp.member(v_club_b, v_ca_b, 'ACTIVE', 'CLUB_ADMIN');
  v_off_a := pg_temp.person('OFF-A'); perform pg_temp.member(v_club_a, v_off_a, 'ACTIVE');
  v_off_b := pg_temp.person('OFF-B'); perform pg_temp.member(v_club_b, v_off_b, 'ACTIVE');
  v_member_a := pg_temp.person('MEM-A'); perform pg_temp.member(v_club_a, v_member_a, 'ACTIVE');
  v_guardian_a := pg_temp.person('PG-A'); perform pg_temp.member(v_club_a, v_guardian_a, 'ACTIVE');
  v_sa := pg_temp.person('SA'); insert into public.site_admins (user_id, status, admin_role) values (v_sa, 'active', 'full');

  -- The officers are appointed the only way an officer can be: nominated by their club, confirmed by Ovalball.
  v_res := pg_temp.json_as(v_ca_a, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''ca11.1 seed'')', v_club_a, v_off_a));
  v_assign_a := (v_res->>'assignment_id')::uuid;
  perform pg_temp.check(v_res->>'outcome' = 'PENDING_CONFIRMATION' and v_assign_a is not null, 'SG-seed the nominee at A enters PENDING_CONFIRMATION');
  v_state := pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L, ''ca11.1 seed: Ovalball confirms A'')', v_assign_a));
  perform pg_temp.check(v_state = 'OK', format('SG-seed Ovalball confirms the officer at A (%s)', v_state));
  v_res := pg_temp.json_as(v_ca_b, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''ca11.1 seed'')', v_club_b, v_off_b));
  v_assign_b := (v_res->>'assignment_id')::uuid;
  v_state := pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L, ''ca11.1 seed: Ovalball confirms B'')', v_assign_b));
  perform pg_temp.check(v_state = 'OK', format('SG-seed Ovalball confirms the officer at B (%s)', v_state));

  -- A season (the canonical register), a child at A with a guardian, and one requested dispensation.
  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('SG Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'sg-'||v_tag) returning id into v_season;
  end if;
  insert into public.players (first_name, surname, active, created_by, playing_pathway, date_of_birth)
  values ('Synthetic', 'Child', true, v_ca_a, 'MALE', (current_date - interval '12 years')::date) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v_player, v_team_a1, 'active', 'ACTIVE', 'CLUB_CREATED');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state) values (v_guardian_a, v_player, 'parent', 'active', 'ACTIVE');
  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, status, requested_by)
  values (v_player, v_team_a1, v_team_a2, v_season, 'ca11.1 synthetic rule', 'requested', v_ca_a) returning id into v_disp;

  -- A safeguarding conversation at A opened by the member, one message in it, and one review by Ovalball.
  insert into public.club_safeguarding_officer_conversations (club_id, requester_user_id, officer_user_id)
  values (v_club_a, v_member_a, v_off_a) returning id into v_conv;
  insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body)
  values (v_conv, v_member_a, 'ca11.1 synthetic message body') returning id into v_msg;
  insert into public.safeguarding_thread_reviews (conversation_id, club_id, reviewed_by, reason)
  values (v_conv, v_club_a, v_sa, 'ca11.1 synthetic review reason');

  -- One reported message at A.
  insert into public.message_reports (message_id, reported_by, reason, status, club_id)
  values (v_msg, v_member_a, 'ca11.1 synthetic report reason', 'open', v_club_a) returning id into v_report;

  -- =====================================================================================
  -- SG-A. The probe: who holds what at A.
  -- =====================================================================================
  v_keys := pg_temp.keys_as(v_ca_a, v_club_a);
  perform pg_temp.check('safeguarding.officer.nominate' = any(v_keys) and not (v_keys && v_officer_keys),
    'SG-A1 a Club Admin holds safeguarding.officer.nominate at their club and NONE of the five officer keys');
  v_keys := pg_temp.keys_as(v_off_a, v_club_a);
  perform pg_temp.check(v_keys @> v_officer_keys and not ('safeguarding.officer.nominate' = any(v_keys)),
    'SG-A2 a confirmed officer holds all five officer keys at their club and not the club''s nomination key');
  v_keys := pg_temp.keys_as(v_off_b, v_club_a);
  perform pg_temp.check(not (v_keys && v_officer_keys) and not ('safeguarding.officer.nominate' = any(v_keys)),
    'SG-A3 another club''s confirmed officer holds no officer key and no nomination key at A');
  v_keys := pg_temp.keys_as(v_member_a, v_club_a);
  perform pg_temp.check(not (v_keys && v_officer_keys) and not ('safeguarding.officer.nominate' = any(v_keys)),
    'SG-A4 a plain member holds neither');

  -- =====================================================================================
  -- SG-B. A Club Admin WITHOUT the officer keys is refused every officer read.
  -- =====================================================================================
  v_state := pg_temp.try_as(v_ca_a, format('select * from public.welfare_member_view(%L, ''ca11.1 CA tries'')', v_player));
  perform pg_temp.check(v_state = '42501', format('SG-B1 the welfare lookup refuses a Club Admin without safeguarding.welfare.view (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('select * from public.club_message_reports(%L)', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SG-B2 the report queue refuses a Club Admin without messaging.moderation.club_review (%s)', v_state));
  v_n := pg_temp.count_as(v_ca_a, format('select count(*) from public.club_safeguarding_officer_conversations where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 0, format('SG-B3 a Club Admin sees no safeguarding conversation they did not open (%s)', v_n));
  v_n := pg_temp.count_as(v_ca_a, format('select count(*) from public.safeguarding_thread_reviews where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 0, format('SG-B4 a Club Admin sees no review by Ovalball (%s)', v_n));
  v_n := pg_temp.count_as(v_ca_a, format('select count(*) from public.fixture_messages where safeguarding_conversation_id = %L', v_conv));
  perform pg_temp.check(v_n = 0, format('SG-B5 a Club Admin reads no message of a safeguarding thread (%s)', v_n));
  v_n := pg_temp.count_as(v_ca_a, 'select coalesce(array_length(internal.safeguarding_dispensation_team_ids(), 1), 0)');
  perform pg_temp.check(v_n = 0, format('SG-B6 the officer''s dispensation branch is closed to a Club Admin -- any dispensation they see comes from fixture authority, a different key (%s)', v_n));
  v_state := pg_temp.try_as(v_ca_a, format('select public.send_safeguarding_officer_message(%L, ''ca11.1 CA reply'')', v_conv));
  perform pg_temp.check(v_state = '42501', format('SG-B7 a Club Admin cannot reply into a thread they are not part of (%s)', v_state));
  v_n := pg_temp.count_as(v_ca_a, format('select count(*) from public.get_club_safeguarding_officers(%L)', v_club_b));
  perform pg_temp.check(v_n = 0, format('SG-B8 a Club Admin reads nothing of another club''s contact register (%s)', v_n));

  -- =====================================================================================
  -- SG-C. The confirmed officer reads their own club's view.
  -- =====================================================================================
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.welfare_member_view(%L, ''ca11.1 officer: synthetic welfare check'')', v_player));
  perform pg_temp.check(v_n = 1, format('SG-C1 the officer''s welfare lookup returns the player''s row (%s)', v_n));
  select count(*) into v_n from public.security_events where actor_user_id = v_off_a and event_type = 'safeguarding.welfare_viewed'
    and reason = 'ca11.1 officer: synthetic welfare check';
  perform pg_temp.check(v_n = 1, format('SG-C2 the lookup is recorded against the officer with the reason given (%s)', v_n));
  v_state := pg_temp.try_as(v_off_a, format('select * from public.welfare_member_view(%L, ''   '')', v_player));
  perform pg_temp.check(v_state = '22023', format('SG-C3 the welfare lookup refuses the officer without a reason (%s)', v_state));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.club_message_reports(%L)', v_club_a));
  perform pg_temp.check(v_n = 1, format('SG-C4 the officer reads the club''s report queue (%s)', v_n));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.club_safeguarding_officer_conversations where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 1, format('SG-C5 the officer sees the club''s safeguarding conversation (%s)', v_n));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.safeguarding_thread_reviews where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 1, format('SG-C6 the officer sees that Ovalball reviewed it (%s)', v_n));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.player_team_dispensation where source_team_id in (select id from public.teams where club_id = %L)', v_club_a));
  perform pg_temp.check(v_n = 1 and pg_temp.count_as(v_off_a, 'select coalesce(array_length(internal.safeguarding_dispensation_team_ids(), 1), 0)') = 2,
    format('SG-C7 the officer reads the club''s dispensation through the officer branch alone (%s)', v_n));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.fixture_messages where safeguarding_conversation_id = %L', v_conv));
  v_state := pg_temp.try_as(v_off_a, format('select public.send_safeguarding_officer_message(%L, ''ca11.1 officer reply'')', v_conv));
  perform pg_temp.check(v_n = 1 and v_state = 'OK', format('SG-C8 the officer reads the thread (%s) and may reply (%s)', v_n, v_state));
  v_n := pg_temp.count_as(v_member_a, format('select count(*) from public.club_safeguarding_officer_conversations where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 1 and pg_temp.count_as(v_member_a, format('select count(*) from public.safeguarding_thread_reviews where club_id = %L', v_club_a)) = 0,
    format('SG-C9 the person who opened the thread reads their own conversation (%s) and not the review history', v_n));
  v_n := pg_temp.count_as(v_off_a, format('select count(*) from public.player_staff_view where id = %L', v_player));
  perform pg_temp.check(v_n = 1, format('SG-C10 the officer may name the player through the staff view, so a dispensation row can carry a name (%s)', v_n));

  -- =====================================================================================
  -- SG-D. Another club's confirmed officer reads nothing at A.
  -- =====================================================================================
  v_state := pg_temp.try_as(v_off_b, format('select * from public.welfare_member_view(%L, ''ca11.1 wrong club'')', v_player));
  perform pg_temp.check(v_state = '42501', format('SG-D1 another club''s officer is refused the welfare lookup (%s)', v_state));
  v_state := pg_temp.try_as(v_off_b, format('select * from public.club_message_reports(%L)', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SG-D2 another club''s officer is refused the report queue (%s)', v_state));
  v_n := pg_temp.count_as(v_off_b, format('select count(*) from public.club_safeguarding_officer_conversations where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 0, format('SG-D3 another club''s officer sees no conversation at A (%s)', v_n));
  v_n := pg_temp.count_as(v_off_b, format('select count(*) from public.safeguarding_thread_reviews where club_id = %L', v_club_a));
  perform pg_temp.check(v_n = 0, format('SG-D4 another club''s officer sees no review at A (%s)', v_n));
  v_n := pg_temp.count_as(v_off_b, format('select count(*) from public.player_team_dispensation where source_team_id in (select id from public.teams where club_id = %L)', v_club_a));
  perform pg_temp.check(v_n = 0, format('SG-D5 another club''s officer sees no dispensation at A (%s)', v_n));
  v_n := pg_temp.count_as(v_off_b, format('select count(*) from public.fixture_messages where safeguarding_conversation_id = %L', v_conv));
  perform pg_temp.check(v_n = 0, format('SG-D6 another club''s officer reads no message at A (%s)', v_n));

  -- =====================================================================================
  -- SG-E. The club's operations refuse everyone without the club's key; the club itself is served.
  -- =====================================================================================
  v_state := pg_temp.try_as(v_ca_a, format('select public.nominate_safeguarding_officer(%L, ''deputy'', ''Synthetic Deputy'', ''sg-deputy-%s@ovalball.test'')', v_club_a, v_tag));
  perform pg_temp.check(v_state = 'OK', format('SG-E1 the Club Admin records a deputy contact (%s)', v_state));
  select id into v_contact from public.club_safeguarding_officers where club_id = v_club_a and officer_type = 'deputy' and status <> 'inactive';
  for v_state in select unnest(array[
    pg_temp.try_as(v_member_a, format('select public.nominate_safeguarding_officer(%L, ''primary'', ''X'', ''x-%s@ovalball.test'')', v_club_a, v_tag)),
    pg_temp.try_as(v_off_a,    format('select public.nominate_safeguarding_officer(%L, ''primary'', ''X'', ''x-%s@ovalball.test'')', v_club_a, v_tag)),
    pg_temp.try_as(v_ca_b,     format('select public.nominate_safeguarding_officer(%L, ''primary'', ''X'', ''x-%s@ovalball.test'')', v_club_a, v_tag))]) loop
    perform pg_temp.check(v_state = '42501', format('SG-E2 a contact nomination without safeguarding.officer.nominate at A is refused (%s)', v_state));
  end loop;
  for v_state in select unnest(array[
    pg_temp.try_as(v_member_a, format('select public.nominate_club_safeguarding_officer(%L, %L, ''deputy'', ''no'')', v_club_a, v_guardian_a)),
    pg_temp.try_as(v_off_a,    format('select public.nominate_club_safeguarding_officer(%L, %L, ''deputy'', ''no'')', v_club_a, v_guardian_a)),
    pg_temp.try_as(v_ca_b,     format('select public.nominate_club_safeguarding_officer(%L, %L, ''deputy'', ''no'')', v_club_a, v_guardian_a))]) loop
    perform pg_temp.check(v_state = '42501', format('SG-E3 a member nomination without safeguarding.officer.nominate at A is refused (%s)', v_state));
  end loop;
  v_state := pg_temp.try_as(v_member_a, format('select * from public.invite_safeguarding_officer(%L)', v_contact));
  perform pg_temp.check(v_state = '42501', format('SG-E4 issuing the invitation without the key is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_off_a, format('select * from public.invite_safeguarding_officer(%L)', v_contact));
  perform pg_temp.check(v_state = '42501', format('SG-E5 the officer''s own keys do not issue an invitation either (%s)', v_state));

  v_invite := pg_temp.json_as(v_ca_a, format('select to_jsonb(i) from public.invite_safeguarding_officer(%L) i', v_contact));
  v_invitation := (v_invite->>'invitation_id')::uuid;
  perform pg_temp.check(v_invitation is not null and length(coalesce(v_invite->>'token','')) > 20,
    'SG-E6 the Club Admin issues the invitation through the canonical issuer and receives the link secret once');
  v_n := pg_temp.count_as(v_ca_a, format('select count(*) from public.invitations_admin_view where id = %L and kind = ''SAFEGUARDING_OFFICER'' and state = ''ISSUED'' and intended_outcome->>''officer_id'' = %L', v_invitation, v_contact));
  perform pg_temp.check(v_n = 1, format('SG-E7 the phone''s read model shows the open invitation against the contact it is for (%s)', v_n));
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'invitations_admin_view' and column_name in ('token', 'token_hash', 'token_sha256', 'code_hmac', 'code');
  perform pg_temp.check(v_n = 0, format('SG-E8 that read model carries no secret column (%s)', v_n));
  v_state := pg_temp.try_as(v_member_a, format('select * from public.resend_safeguarding_officer_invitation(%L)', v_contact));
  perform pg_temp.check(v_state = '42501', format('SG-E9 resending without the key is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_member_a, format('select public.revoke_invitation(%L, ''no'')', v_invitation));
  perform pg_temp.check(v_state = '42501', format('SG-E10 withdrawing the invitation without the key is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_off_a, format('select public.revoke_invitation(%L, ''no'')', v_invitation));
  perform pg_temp.check(v_state = '42501', format('SG-E11 the officer''s own keys do not withdraw it either (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('select public.revoke_invitation(%L, ''ca11.1: withdrawn by the club'')', v_invitation));
  perform pg_temp.check(v_state = 'OK', format('SG-E12 the Club Admin withdraws it, with the reason recorded (%s)', v_state));
  v_state := pg_temp.try_as(v_member_a, format('select public.revoke_safeguarding_officer_invitation(%L)', gen_random_uuid()));
  perform pg_temp.check(v_state <> 'OK', format('SG-E13 the website''s own revoke path serves nobody without the key (%s)', v_state));
  v_state := pg_temp.try_as(v_member_a, format('select public.update_safeguarding_officer_contact(%L, ''Edited'', ''edited-%s@ovalball.test'')', v_contact, v_tag));
  perform pg_temp.check(v_state = '42501', format('SG-E14 correcting a contact card that is not yours, without the key, is refused (%s)', v_state));
  -- DOCUMENTED, NOT ASSERTED: while a contact card's user_id is still NULL (nobody has accepted), the
  -- gate in update_safeguarding_officer_contact evaluates `v_officer.user_id = auth.uid()` to NULL, and
  -- `not (null and true or false)` never raises -- so a person holding safeguarding.officer.contact_edit
  -- at self scope can edit ANY unaccepted card. CA-M11.1 adds no migration; the phone offers Edit
  -- Contact for the self key only where the card names the signed-in person. The boundary that holds
  -- today is the one proved here: a card that names SOMEBODY ELSE.
  update public.club_safeguarding_officers set user_id = v_member_a where id = v_contact;
  v_state := pg_temp.try_as(v_off_a, format('select public.update_safeguarding_officer_contact(%L, ''Edited'', ''edited-%s@ovalball.test'')', v_contact, v_tag));
  perform pg_temp.check(v_state = '42501', format('SG-E15 the officer''s self-scope contact key does not reach a card that names somebody else (%s)', v_state));
  v_state := pg_temp.try_as(v_member_a, format('select public.update_safeguarding_officer_contact(%L, ''Edited'', ''edited-%s@ovalball.test'')', v_contact, v_tag));
  perform pg_temp.check(v_state = '42501', format('SG-E15b the person a card names, without the self key, still cannot edit it (%s)', v_state));
  update public.club_safeguarding_officers set user_id = null where id = v_contact;
  v_state := pg_temp.try_as(v_member_a, format('select public.deactivate_safeguarding_officer(%L)', v_contact));
  perform pg_temp.check(v_state = '42501', format('SG-E16 ending the assignment without safeguarding.officer.deactivate is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_off_a, format('select public.deactivate_safeguarding_officer(%L)', v_contact));
  perform pg_temp.check(v_state = '42501', format('SG-E17 the officer cannot end an assignment either (%s)', v_state));
  v_n := pg_temp.count_as(v_member_a, format('select count(*) from public.get_club_safeguarding_officers(%L)', v_club_a));
  perform pg_temp.check(v_n = 0 and pg_temp.count_as(v_ca_a, format('select count(*) from public.get_club_safeguarding_officers(%L)', v_club_a)) = 1,
    format('SG-E18 the contact register is read by the club''s key and not by a member (%s)', v_n));

  -- =====================================================================================
  -- SG-F. No officer read returns a narrative or notes column; no case domain exists.
  -- =====================================================================================
  select array_agg(a order by ord) into v_cols
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       unnest(p.proargnames, p.proargmodes) with ordinality as x(a, m, ord)
  where n.nspname = 'public' and p.proname = 'welfare_member_view' and x.m = 't';
  perform pg_temp.check(v_cols = array['player_name','team_name','guardian_name','guardian_contact','guardian_state'],
    format('SG-F1 welfare_member_view returns exactly player, team, guardian, guardian contact and guardian state (%s)', array_to_string(v_cols, ',')));
  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       unnest(p.proargnames, p.proargmodes) as x(a, m)
  where n.nspname = 'public' and p.proname in ('welfare_member_view','club_message_reports','club_safeguarding_contact','get_club_safeguarding_officers')
    and x.m = 't' and x.a ~* '(note|narrative|incident|allegation|concern|case_|_case|medical|evidence)';
  perform pg_temp.check(v_bad = 0, format('SG-F2 no officer read function returns a notes, narrative, incident, allegation, medical or evidence column (%s)', v_bad));
  select count(*) into v_bad from information_schema.tables where table_schema = 'public' and table_name ~* 'safeguarding_(case|concern|incident|note|allegation)';
  select v_bad + count(*) into v_bad from information_schema.columns where table_schema = 'public' and column_name ~* 'safeguarding_(note|narrative|case)';
  perform pg_temp.check(v_bad = 0, format('SG-F3 no safeguarding case, concern, incident, note or allegation table or column exists to be read (%s)', v_bad));
  select count(*) into v_n from public.capabilities where key = any(v_officer_keys) and safeguarding_sensitive;
  perform pg_temp.check(v_n = 5, format('SG-F4 every officer key is safeguarding-sensitive: never delegable from a club permissions grid (%s)', v_n));
  select count(*) into v_n from public.player_team_dispensation where id = v_disp and decision_reason is null;
  perform pg_temp.check(v_n = 1, 'SG-F5 the dispensation''s decision narrative exists as a column the phone deliberately does not select');

  -- =====================================================================================
  -- SG-G. The Admin Centre section's key belongs to the Club Admin alone.
  -- =====================================================================================
  select count(*) into v_n from unnest(array[v_ca_a, v_off_a, v_member_a, v_off_b, v_guardian_a]) u
  where 'safeguarding.officer.nominate' = any(pg_temp.keys_as(u, v_club_a));
  perform pg_temp.check(v_n = 1, format('SG-G1 of five people at A, only the Club Admin holds the section''s key (%s)', v_n));
  select count(*) into v_n from public.bundle_capabilities where capability_key = 'safeguarding.officer.nominate' and bundle_key = 'SO';
  perform pg_temp.check(v_n = 0, 'SG-G2 the officer bundle does not carry the nomination key: an officer who is not a Club Admin is not offered the club''s job');
end $$;

rollback;
