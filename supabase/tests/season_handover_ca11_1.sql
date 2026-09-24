-- SEASON HANDOVER ON THE PHONE (CA-M11.1) -- THE AUTHORITY THE MOBILE SCREENS DEPEND ON, PROVED WHERE IT IS ENFORCED.
--
-- The phone consumes the website's handover board through the shared contract and offers each control on
-- a server capability. Nothing on either client decides authority. This suite proves the boundaries the
-- screens rely on, as real authenticated users:
--
--   SH-A  a member without team.handover.prepare cannot prepare (42501)
--   SH-B  a holder of prepare (the Club Admin) prepares, and the preview functions the board reads --
--         handover_state, rollover_readiness, handover_apply_blockers, handover_consequences,
--         handover_audit, handover_team_labels -- run for a Fixture Secretary and mutate nothing
--   SH-C  a Fixture Secretary may decide a team (prepare) but is refused apply_season_handover (42501),
--         and the refusal changes nothing
--   SH-D  a member without any handover capability is refused apply (42501)
--   SH-E  a Club Admin applying against a stale decisions revision is refused (P0001) and nothing changes
--   SH-F  my_capabilities -- the one probe both clients read -- says prepare for both, apply for the CA only
--   SH-G  the Club Admin applies with the reviewed revision: the side progresses; a second apply reports
--         already_applied and does no work
--
-- Self-seeding and rolled back. No persistent review club is touched; the target season is read from the
-- canonical register and only a regression-flagged season is created when the register has none.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

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

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.try_msg(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg; end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sh-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email)
  values (v, 'Sh', p_label, 'sh-' || v::text || '@ovalball.test')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SH ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sh-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'sh-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.try_msg(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_team uuid; v_to uuid;
  v_admin uuid; v_fixsec uuid; v_basic uuid;
  v_rollover uuid; v_proposal uuid;
  v_state text; v_msg text; v_n bigint; v_rev int; v_text text;
  v_age text; v_applied timestamptz; v_ready boolean; v_blockers bigint;
  v_r record;
begin
  -- =====================================================================================
  -- SEED. One club with a U16 side; a Club Admin, a Fixture Secretary, an ordinary member.
  -- =====================================================================================
  v_club := pg_temp.club('Handover');
  v_team := pg_temp.team(v_club, 'u16', 'U16', 'Under 16 Boys');
  v_admin := pg_temp.person('Admin');
  v_fixsec := pg_temp.person('FixSec');
  v_basic := pg_temp.person('Basic');
  perform pg_temp.member(v_club, v_admin, 'CLUB_ADMIN');
  perform pg_temp.member(v_club, v_fixsec, 'FIXTURE_SECRETARY');
  perform pg_temp.member(v_club, v_basic, 'BASIC_USER');

  -- The target season is the canonical register's next Union season. Only when the register has none is
  -- a regression-flagged one created, and the transaction is rolled back regardless.
  select id into v_to from public.seasons
  where rugby_code = 'union' and not is_regression_fixture and starts_on > current_date
  order by starts_on limit 1;
  if v_to is null then
    insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
    values ('SH 27/28', '2027-09-01', '2028-06-30', true, 'union', 2027, '27/28', true, '2027-08-01') returning id into v_to;
  end if;
  perform pg_temp.check(v_club is not null and v_team is not null and v_to is not null, 'SH-0 seeded: a club, a U16 side, three people and a target season from the register');

  -- =====================================================================================
  -- SH-A. No prepare capability: no prepare.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_basic);
  v_state := pg_temp.try(format('select public.generate_rollover_proposal(%L, %L, %L)', v_club, 'union', v_to));
  perform pg_temp.check(v_state = '42501', 'SH-A an ordinary member is refused generate_rollover_proposal with 42501 (' || v_state || ')');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.age_grade_rollovers where club_id = v_club;
  perform pg_temp.check(v_n = 0, 'SH-A and the refusal wrote no handover');

  -- =====================================================================================
  -- SH-B. The Club Admin prepares; the board's reads run for a Fixture Secretary and mutate nothing.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_admin);
  v_rollover := public.generate_rollover_proposal(v_club, 'union', v_to);
  perform pg_temp.act_postgres();
  select id into v_proposal from public.age_grade_rollover_team_proposals where rollover_id = v_rollover and team_id = v_team;
  select decisions_revision into v_rev from public.age_grade_rollovers where id = v_rollover;
  perform pg_temp.check(v_rollover is not null and v_proposal is not null, 'SH-B the Club Admin prepared the handover and the side has a proposal');

  perform pg_temp.act('authenticated', v_fixsec);
  v_state := pg_temp.try(format('select public.handover_state(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B handover_state answers a prepare holder (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.rollover_readiness(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B rollover_readiness answers a prepare holder (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.handover_apply_blockers(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B handover_apply_blockers answers a prepare holder (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.handover_consequences(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B handover_consequences answers a prepare holder (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.handover_audit(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B handover_audit answers a prepare holder (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.handover_team_labels(%L)', v_rollover));
  perform pg_temp.check(v_state = 'OK', 'SH-B handover_team_labels answers a prepare holder (' || v_state || ')');
  perform pg_temp.act_postgres();
  select age_group into v_age from public.teams where id = v_team;
  select applied_at into v_applied from public.age_grade_rollovers where id = v_rollover;
  select decisions_revision into v_n from public.age_grade_rollovers where id = v_rollover;
  perform pg_temp.check(v_age = 'U16' and v_applied is null and v_n = v_rev, 'SH-B the preview reads mutated nothing: side still U16, not applied, revision unchanged');

  -- The board reads the preview for a stranger with no capability: refused, not leaked.
  perform pg_temp.act('authenticated', v_basic);
  v_state := pg_temp.try(format('select * from public.handover_consequences(%L)', v_rollover));
  perform pg_temp.check(v_state = '42501', 'SH-B an ordinary member is refused handover_consequences with 42501 (' || v_state || ')');
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- SH-C. The Fixture Secretary may decide (prepare) but may not apply.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_fixsec);
  v_state := pg_temp.try(format('select public.confirm_rollover_team_proposal(%L, %L, %L, null, null, null)', v_proposal, 'confirm', 'U17'));
  perform pg_temp.check(v_state = 'OK', 'SH-C a Fixture Secretary records a team decision (team.handover.prepare) (' || v_state || ')');
  v_state := pg_temp.try(format('select * from public.apply_season_handover(%L, null)', v_rollover));
  v_msg := pg_temp.try_msg(format('select * from public.apply_season_handover(%L, null)', v_rollover));
  perform pg_temp.check(v_state = '42501' and v_msg like '%Club Admin%', 'SH-C a Fixture Secretary is refused apply_season_handover with 42501 and the server''s own sentence (' || v_state || ')');
  perform pg_temp.act_postgres();
  select age_group into v_age from public.teams where id = v_team;
  select applied_at into v_applied from public.age_grade_rollovers where id = v_rollover;
  select decision into v_text from public.age_grade_rollover_team_proposals where id = v_proposal;
  perform pg_temp.check(v_age = 'U16' and v_applied is null and v_text = 'confirmed', 'SH-C the refused apply changed nothing: side still U16, decision still recorded, not applied');

  -- =====================================================================================
  -- SH-D. No handover capability at all: no apply.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_basic);
  v_state := pg_temp.try(format('select * from public.apply_season_handover(%L, null)', v_rollover));
  perform pg_temp.check(v_state = '42501', 'SH-D an ordinary member is refused apply_season_handover with 42501 (' || v_state || ')');
  v_state := pg_temp.try(format('select public.undo_rollover_team_decision(%L)', v_proposal));
  perform pg_temp.check(v_state = '42501', 'SH-D and refused undo_rollover_team_decision with 42501 (' || v_state || ')');
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- SH-E. A stale revision is refused: what the reviewer saw is what is applied, or nothing is.
  -- =====================================================================================
  select decisions_revision into v_rev from public.age_grade_rollovers where id = v_rollover;
  perform pg_temp.act('authenticated', v_admin);
  v_state := pg_temp.try(format('select * from public.apply_season_handover(%L, %s)', v_rollover, v_rev + 7));
  v_msg := pg_temp.try_msg(format('select * from public.apply_season_handover(%L, %s)', v_rollover, v_rev + 7));
  perform pg_temp.check(v_state = 'P0001' and v_msg like '%changed since%', 'SH-E a Club Admin applying against a stale revision is refused (' || v_state || ': ' || left(v_msg, 60) || ')');
  perform pg_temp.act_postgres();
  select age_group into v_age from public.teams where id = v_team;
  select applied_at into v_applied from public.age_grade_rollovers where id = v_rollover;
  perform pg_temp.check(v_age = 'U16' and v_applied is null, 'SH-E and the stale apply changed nothing');
exception when others then
  raise notice 'FAIL SH-A..E aborted: % (%)', sqlerrm, sqlstate;
end $$;

-- SH-F and SH-G in their own block so a probe signature surprise cannot mask the earlier results.
do $$
declare
  v_club uuid; v_team uuid; v_rollover uuid; v_admin uuid; v_fixsec uuid;
  v_prepare boolean; v_apply boolean; v_rev int; v_age text; v_applied timestamptz; v_r record; v_state text;
begin
  select c.id into v_club from public.clubs c join public.club_directory d on d.id = c.directory_id where d.name like 'SH Handover RUFC %' order by c.created_at desc limit 1;
  select id into v_team from public.teams where club_id = v_club limit 1;
  select id, decisions_revision into v_rollover, v_rev from public.age_grade_rollovers where club_id = v_club limit 1;
  select user_id into v_admin from public.club_memberships where club_id = v_club and role = 'CLUB_ADMIN' limit 1;
  select user_id into v_fixsec from public.club_memberships where club_id = v_club and role = 'FIXTURE_SECRETARY' limit 1;

  perform pg_temp.act('authenticated', v_admin);
  select coalesce(bool_or(capability_key = 'team.handover.prepare' and allowed), false), coalesce(bool_or(capability_key = 'team.handover.apply' and allowed), false)
    into v_prepare, v_apply
  from public.my_capabilities(p_scope_type => 'club', p_club_id => v_club);
  perform pg_temp.check(v_prepare and v_apply, 'SH-F my_capabilities: the Club Admin holds team.handover.prepare and team.handover.apply');

  perform pg_temp.act('authenticated', v_fixsec);
  select coalesce(bool_or(capability_key = 'team.handover.prepare' and allowed), false), coalesce(bool_or(capability_key = 'team.handover.apply' and allowed), false)
    into v_prepare, v_apply
  from public.my_capabilities(p_scope_type => 'club', p_club_id => v_club);
  perform pg_temp.check(v_prepare and not v_apply, 'SH-F my_capabilities: the Fixture Secretary holds prepare and NOT apply -- the phone offers Apply on this answer');
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- SH-G. The Club Admin applies with the reviewed revision. The side progresses; a second apply is a no-op.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_rev from public.handover_apply_blockers(v_rollover);
  perform pg_temp.check(v_rev = 0, 'SH-G no blockers stand before apply (' || v_rev || ')');
  select decisions_revision into v_rev from public.age_grade_rollovers where id = v_rollover;
  select * into v_r from public.apply_season_handover(v_rollover, v_rev);
  perform pg_temp.check(v_r.already_applied = false and v_r.teams_progressed = 1, 'SH-G the Club Admin applied the handover: 1 team progressed (' || v_r.teams_progressed || ')');
  perform pg_temp.act_postgres();
  select age_group into v_age from public.teams where id = v_team;
  select applied_at into v_applied from public.age_grade_rollovers where id = v_rollover;
  perform pg_temp.check(v_age = 'U17' and v_applied is not null, 'SH-G the side is now U17 and the handover is stamped applied');

  perform pg_temp.act('authenticated', v_admin);
  select * into v_r from public.apply_season_handover(v_rollover, null);
  perform pg_temp.check(v_r.already_applied = true and v_r.teams_progressed = 0, 'SH-G a second apply reports already_applied and does no work');
  v_state := pg_temp.try(format('select public.undo_rollover_team_decision(%L)', (select id from public.age_grade_rollover_team_proposals where rollover_id = v_rollover limit 1)));
  perform pg_temp.check(v_state <> 'OK', 'SH-G decisions are read-only once the handover has run (' || v_state || ')');
  perform pg_temp.act_postgres();
  select age_group into v_age from public.teams where id = v_team;
  perform pg_temp.check(v_age = 'U17', 'SH-G and the side did not age twice');
exception when others then
  raise notice 'FAIL SH-F/G aborted: % (%)', sqlerrm, sqlstate;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
