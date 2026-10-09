-- SENSITIVE FIXTURE AND CLUB FIELDS CHANGE ONLY THROUGH CONTROLLED ACTIONS; A WELFARE LOOKUP STAYS IN ITS OWN CLUB.
--
-- Blueprint batch B0 (owner decisions D-001, D-002, D-004), migration 20270766000000. Proves:
--
--   SF-F  no signed-in user -- the owning club, the opposing club or a stranger -- can write public.fixtures
--         directly; the owning club still edits through update_fixture_details, the opposing club cannot; a Site
--         Admin's status control and cancel work through update_fixture_details and cancel_fixture
--   SF-C  a Club Admin cannot write a club's status, slug, directory link, timezone or deactivation record
--         directly, still writes the profile and image columns of their own club only; the Active/Suspended
--         setting is a Site Admin action that never touches a deactivated club
--   SF-W  for a child registered at two clubs, each club's confirmed Safeguarding Officer sees only their own
--         club's team, is never refused because of row order, records one event against their own club only;
--         a Club Admin without the key, and an officer whose club the child is not in, are refused
--   SF-P  the perimeter itself: no UPDATE privilege on fixtures, only the profile and image columns on clubs,
--         fixtures_update_scoped gone
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
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sf-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Sf',p_label,'sf-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SF '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sf-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'sf-'||v_tag,'active') returning id into v_club;
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
  values (p_club,'Under '||substr(p_age,2)||' Boys','sf-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
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

/** Rows an UPDATE touched as this person, or -1 when it was refused. */
create or replace function pg_temp.rows_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_(p_subject);
  perform set_config('role','authenticated', true);
  begin execute p_sql; get diagnostics v = row_count; exception when others then v := -1; end;
  perform pg_temp.off();
  return v;
end $$;

grant execute on function pg_temp.as_(uuid) to public;
grant execute on function pg_temp.off() to public;
grant execute on function pg_temp.try_as(uuid, text) to public;
grant execute on function pg_temp.json_as(uuid, text) to public;
grant execute on function pg_temp.rows_as(uuid, text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club_a uuid; v_club_b uuid; v_club_c uuid; v_dir_b uuid; v_team_a uuid; v_team_b uuid; v_team_c uuid;
  v_ca_a uuid; v_ca_b uuid; v_off_a uuid; v_off_b uuid; v_off_c uuid; v_ca_c uuid; v_stranger uuid; v_sa uuid; v_guardian uuid;
  v_res jsonb; v_assign uuid; v_player uuid; v_fx uuid; v_fx2 uuid;
  v_state text; v_n bigint; v_row record; v_a_before bigint; v_b_before bigint; v_season uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  -- =====================================================================================
  -- SEED. Clubs A and B play each other; club C is unrelated. A confirmed officer at each club, appointed the
  -- only way an officer can be (nominated by their club, confirmed by Ovalball). One Full Site Admin.
  -- =====================================================================================
  v_club_a := pg_temp.club('Alpha'); v_club_b := pg_temp.club('Beta'); v_club_c := pg_temp.club('Gamma');
  select directory_id into v_dir_b from public.clubs where id = v_club_b;
  v_team_a := pg_temp.team(v_club_a); v_team_b := pg_temp.team(v_club_b); v_team_c := pg_temp.team(v_club_c);

  v_ca_a := pg_temp.person('CA-A');  perform pg_temp.member(v_club_a, v_ca_a, 'ACTIVE', 'CLUB_ADMIN');
  v_ca_b := pg_temp.person('CA-B');  perform pg_temp.member(v_club_b, v_ca_b, 'ACTIVE', 'CLUB_ADMIN');
  v_ca_c := pg_temp.person('CA-C');  perform pg_temp.member(v_club_c, v_ca_c, 'ACTIVE', 'CLUB_ADMIN');
  v_off_a := pg_temp.person('OFF-A'); perform pg_temp.member(v_club_a, v_off_a, 'ACTIVE');
  v_off_b := pg_temp.person('OFF-B'); perform pg_temp.member(v_club_b, v_off_b, 'ACTIVE');
  v_off_c := pg_temp.person('OFF-C'); perform pg_temp.member(v_club_c, v_off_c, 'ACTIVE');
  v_stranger := pg_temp.person('STRANGER');
  v_guardian := pg_temp.person('PG');  perform pg_temp.member(v_club_a, v_guardian, 'ACTIVE');
  v_sa := pg_temp.person('SA'); insert into public.site_admins (user_id, status, profile_key) values (v_sa, 'active', 'SITE_FULL');

  v_res := pg_temp.json_as(v_ca_a, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''sf seed'')', v_club_a, v_off_a));
  v_assign := (v_res->>'assignment_id')::uuid;
  v_state := pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L, ''sf seed: Ovalball confirms A'')', v_assign));
  perform pg_temp.check(v_state = 'OK', format('SF-seed officer at A confirmed (%s)', v_state));
  v_res := pg_temp.json_as(v_ca_b, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''sf seed'')', v_club_b, v_off_b));
  v_assign := (v_res->>'assignment_id')::uuid;
  v_state := pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L, ''sf seed: Ovalball confirms B'')', v_assign));
  perform pg_temp.check(v_state = 'OK', format('SF-seed officer at B confirmed (%s)', v_state));
  v_res := pg_temp.json_as(v_ca_c, format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''sf seed'')', v_club_c, v_off_c));
  v_assign := (v_res->>'assignment_id')::uuid;
  v_state := pg_temp.try_as(v_sa, format('select public.confirm_safeguarding_officer(%L, ''sf seed: Ovalball confirms C'')', v_assign));
  perform pg_temp.check(v_state = 'OK', format('SF-seed officer at C confirmed (%s)', v_state));

  -- A fixture owned by A against B, and one owned by A for the cancel proof.
  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_team_a, v_team_b, v_dir_b, current_date + 10, 'Home', 'SF Beta') returning id into v_fx;
  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_team_a, v_team_b, v_dir_b, current_date + 17, 'Home', 'SF Beta') returning id into v_fx2;

  -- A current union season (the age guard on squad places needs one), and distinct team names so a lookup that
  -- returned the wrong club's team could not pass.
  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('SF Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'sf-'||v_tag) returning id into v_season;
  end if;
  update public.teams set display_name = 'SF Alpha Under 12 '||v_tag where id = v_team_a;
  update public.teams set display_name = 'SF Beta Under 12 '||v_tag where id = v_team_b;
  perform pg_temp.check((select count(distinct display_name) from public.teams where id in (v_team_a, v_team_b)) = 2,
    'SF-seed the two clubs'' teams carry distinguishable names');

  -- A child registered at A AND B, with one guardian.
  insert into public.players (first_name, surname, active, created_by, playing_pathway, date_of_birth)
  values ('Synthetic', 'Dual', true, v_ca_a, 'MALE', (current_date - interval '12 years')::date) returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v_player, v_team_a, 'active', 'ACTIVE', 'CLUB_CREATED');
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v_player, v_team_b, 'active', 'ACTIVE', 'CLUB_CREATED');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state) values (v_guardian, v_player, 'parent', 'active', 'ACTIVE');

  -- =====================================================================================
  -- SF-P. The perimeter.
  -- =====================================================================================
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.fixtures', 'UPDATE'),
    'SF-P1 signed-in users hold no UPDATE privilege on public.fixtures');
  perform pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fixtures' and policyname = 'fixtures_update_scoped'),
    'SF-P2 the either-side fixtures_update_scoped policy is gone');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.clubs', 'UPDATE'),
    'SF-P3 signed-in users hold no table-wide UPDATE on public.clubs');
  perform pg_temp.check(
    (select array_agg(c order by c) from unnest(array['status','slug','directory_id','timezone','deactivated_at','deactivated_by',
       'deactivation_reason','reactivated_at','reactivated_by','latitude','longitude','created_by','legacy_logo_path','established_year']) c
     where has_column_privilege('authenticated', 'public.clubs', c, 'UPDATE')) is null,
    'SF-P4 no sensitive club column is writable by a signed-in user');
  perform pg_temp.check(
    (select bool_and(has_column_privilege('authenticated', 'public.clubs', c, 'UPDATE')) from unnest(array['bio','website','facebook_url',
       'address_display','show_website','show_home_ground','show_address','show_postcode','logo_storage_path','cover_storage_path']) c),
    'SF-P5 the profile and image columns the clients write stay writable');

  -- =====================================================================================
  -- SF-F. Fixtures.
  -- =====================================================================================
  v_state := pg_temp.try_as(v_ca_a, format('update public.fixtures set status = ''Booked'' where id = %L', v_fx));
  perform pg_temp.check(v_state = '42501', format('SF-F1 the owning club cannot write the status directly (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('update public.fixtures set kickoff_date = current_date + 40 where id = %L', v_fx));
  perform pg_temp.check(v_state = '42501', format('SF-F2 nor the kick-off (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_b, format('update public.fixtures set kickoff_date = current_date + 40, status = ''Cancelled'' where id = %L', v_fx));
  perform pg_temp.check(v_state = '42501', format('SF-F3 the opposing club cannot write the fixture directly (%s)', v_state));
  v_state := pg_temp.try_as(v_stranger, format('update public.fixtures set notes = ''x'' where id = %L', v_fx));
  perform pg_temp.check(v_state = '42501', format('SF-F4 nor can an unrelated signed-in user (%s)', v_state));
  select * into v_row from public.fixtures where id = v_fx;
  perform pg_temp.check(v_row.status is distinct from 'Cancelled' and v_row.kickoff_date = current_date + 10,
    'SF-F5 nothing the refused writes tried took effect');

  v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('notes', 'SF bring the spare kit')));
  perform pg_temp.check(v_state = 'OK' and (select notes from public.fixtures where id = v_fx) = 'SF bring the spare kit',
    format('SF-F6 the owning club still edits details through update_fixture_details (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_b, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('notes', 'SF opponent edit')));
  perform pg_temp.check(v_state = '42501', format('SF-F7 the opposing club cannot edit details through it either (D-002) (%s)', v_state));

  v_state := pg_temp.try_as(v_stranger, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('status', 'Booked')));
  perform pg_temp.check(v_state = '42501', format('SF-F8 a stranger cannot use the Site Admin status path (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('status', 'Booked')));
  perform pg_temp.check(v_state = 'OK' and (select status from public.fixtures where id = v_fx) = 'Booked',
    format('SF-F9 the Site Admin status control works through update_fixture_details (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, jsonb_build_object('status', 'Cancelled')));
  perform pg_temp.check(v_state = '23514', format('SF-F10 a bare status write can never cancel (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.cancel_fixture(%L, ''SF Site Admin support cancel'')', v_fx2));
  perform pg_temp.check(v_state = 'OK' and (select status = 'Cancelled' and cancellation_reason = 'SF Site Admin support cancel' and cancelled_by = v_sa
                                            from public.fixtures where id = v_fx2),
    format('SF-F11 the Site Admin cancel works through cancel_fixture, with its reason and who (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.cancel_fixture(%L, ''  '')', v_fx));
  perform pg_temp.check(v_state <> 'OK' and (select status from public.fixtures where id = v_fx) = 'Booked',
    format('SF-F12 and still needs a reason (%s)', v_state));

  -- =====================================================================================
  -- SF-C. Clubs.
  -- =====================================================================================
  v_state := pg_temp.try_as(v_ca_a, format('update public.clubs set status = ''suspended'' where id = %L', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C1 a Club Admin cannot write their club''s status directly (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('update public.clubs set status = ''deactivated'', deactivated_at = now() where id = %L', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C2 nor deactivate it around deactivate_club (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('update public.clubs set slug = ''sf-hijack'' where id = %L', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C3 nor change its web address (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('update public.clubs set directory_id = %L where id = %L', v_dir_b, v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C4 nor its directory link (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('update public.clubs set timezone = ''UTC'' where id = %L', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C5 nor its timezone (%s)', v_state));
  perform pg_temp.check((select status = 'active' and slug like 'sf-%' and slug <> 'sf-hijack' from public.clubs where id = v_club_a),
    'SF-C6 nothing the refused writes tried took effect');

  v_n := pg_temp.rows_as(v_ca_a, format('update public.clubs set bio = ''SF our club'', logo_storage_path = ''sf/crest.png'' where id = %L', v_club_a));
  perform pg_temp.check(v_n = 1 and (select bio = 'SF our club' and logo_storage_path = 'sf/crest.png' from public.clubs where id = v_club_a),
    format('SF-C7 a Club Admin still edits their club''s profile and crest (%s row)', v_n));
  v_n := pg_temp.rows_as(v_ca_b, format('update public.clubs set bio = ''SF hijack'' where id = %L', v_club_a));
  perform pg_temp.check(v_n = 0 and (select bio from public.clubs where id = v_club_a) = 'SF our club',
    format('SF-C8 but not another club''s (%s rows)', v_n));

  v_state := pg_temp.try_as(v_ca_a, format('select public.set_club_public_status(%L, ''suspended'')', v_club_a));
  perform pg_temp.check(v_state = '42501', format('SF-C9 the Active/Suspended setting is not a Club Admin action (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.set_club_public_status(%L, ''suspended'')', v_club_a));
  perform pg_temp.check(v_state = 'OK' and (select status from public.clubs where id = v_club_a) = 'suspended',
    format('SF-C10 a Site Admin suspends the public page (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.set_club_public_status(%L, ''active'')', v_club_a));
  perform pg_temp.check(v_state = 'OK' and (select status from public.clubs where id = v_club_a) = 'active',
    format('SF-C11 and restores it (%s)', v_state));
  v_state := pg_temp.try_as(v_sa, format('select public.set_club_public_status(%L, ''deactivated'')', v_club_a));
  perform pg_temp.check(v_state = '22023', format('SF-C12 it cannot deactivate: that is deactivate_club (%s)', v_state));
  update public.clubs set status = 'deactivated' where id = v_club_c;
  v_state := pg_temp.try_as(v_sa, format('select public.set_club_public_status(%L, ''active'')', v_club_c));
  perform pg_temp.check(v_state = '22023' and (select status from public.clubs where id = v_club_c) = 'deactivated',
    format('SF-C13 nor reopen a deactivated club around reactivate_club (%s)', v_state));
  update public.clubs set status = 'active' where id = v_club_c;

  -- =====================================================================================
  -- SF-W. The welfare lookup stays in the caller's own club (D-004).
  -- =====================================================================================
  select count(*) filter (where club_id = v_club_a), count(*) filter (where club_id = v_club_b) into v_a_before, v_b_before
  from public.security_events where event_type = 'safeguarding.welfare_viewed' and actor_user_id = v_off_a;
  v_res := pg_temp.json_as(v_off_a, format('select coalesce(jsonb_agg(to_jsonb(w)), ''[]''::jsonb) from public.welfare_member_view(%L, ''SF officer A synthetic check'') w', v_player));
  perform pg_temp.check(jsonb_array_length(v_res) = 1,
    format('SF-W1 Club A''s officer sees one row: the child''s Club A team only, not Club B''s (%s rows)', jsonb_array_length(v_res)));
  perform pg_temp.check((v_res->0->>'guardian_contact') is not null and (v_res->0->>'team_name') = (select display_name from public.teams where id = v_team_a),
    'SF-W2 with the guardian contact the officer is authorised to see for their club');
  perform pg_temp.check(
    (select count(*) from public.security_events where event_type = 'safeguarding.welfare_viewed' and actor_user_id = v_off_a and club_id = v_club_a) = v_a_before + 1
    and (select count(*) from public.security_events where event_type = 'safeguarding.welfare_viewed' and actor_user_id = v_off_a and club_id = v_club_b) = v_b_before,
    'SF-W3 the lookup is recorded once, against Club A, and never against Club B');

  v_res := pg_temp.json_as(v_off_b, format('select coalesce(jsonb_agg(to_jsonb(w)), ''[]''::jsonb) from public.welfare_member_view(%L, ''SF officer B synthetic check'') w', v_player));
  perform pg_temp.check(jsonb_array_length(v_res) = 1 and (v_res->0->>'team_name') = (select display_name from public.teams where id = v_team_b),
    format('SF-W4 Club B''s officer is not refused by row order and sees only the Club B team (%s rows)', jsonb_array_length(v_res)));

  v_state := pg_temp.try_as(v_off_c, format('select public.welfare_member_view(%L, ''SF officer C synthetic check'')', v_player));
  perform pg_temp.check(v_state = '42501', format('SF-W5 an officer at a club the child is not in is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_ca_a, format('select public.welfare_member_view(%L, ''SF club admin tries'')', v_player));
  perform pg_temp.check(v_state = '42501', format('SF-W6 a Club Admin without the officer key is refused (%s)', v_state));
  v_state := pg_temp.try_as(v_off_a, format('select public.welfare_member_view(%L, ''   '')', v_player));
  perform pg_temp.check(v_state = '22023', format('SF-W7 a reason is still required (%s)', v_state));
end $$;

rollback;
