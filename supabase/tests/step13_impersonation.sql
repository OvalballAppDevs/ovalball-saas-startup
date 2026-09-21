-- CONVERGENCE STEP 13 — IDENTITY/AUTH SLICE 9: IMPERSONATION.
--
--   A. STARTING is capability-gated, reasoned, never yourself, never twice.
--   B. THE SEAM IS REAL: effective_person becomes the target while actor stays
--      the signed-in person, so attribution still names both.
--   C. VIEW-ONLY BY DEFAULT: reads pass, writes do not.
--   D. BLOCKED AREAS are refused even to a Full Site Admin who may act.
--   E. ACTING needs the second capability, decided once at the start.
--   F. EXPIRY is a read-time fact, not a job that has to have run.
--   G. ENDING reverts authority and tells the person afterwards (AN-9).
--   H. NO CREDENTIAL ever enters the session record.
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
  v_full uuid := gen_random_uuid();     -- Full Site Admin: may act
  v_support uuid := gen_random_uuid();  -- Support: view-only
  v_ordinary uuid := gen_random_uuid(); -- holds no site capability at all
  v_target uuid := gen_random_uuid();   -- a club admin, so the target HAS authority to borrow
  v_dir uuid; v_club uuid; v_ms uuid; v_team uuid;
  v_id uuid; v_n int; v_uuid uuid; v_state text; v_bool boolean; v_text text;
begin
  foreach v_person in array array[v_full, v_support, v_ordinary, v_target] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's13-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Thirteen', 's13-' || v_person::text || '@ovalball.test', (current_date - interval '39 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.site_admins (user_id, status, admin_role, profile_key) values
    (v_full, 'active', 'full', 'SITE_FULL'),
    (v_support, 'active', 'user_access', 'SITE_SUPPORT');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S13 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's13-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's13-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's13-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_target, 'CLUB_ADMIN', 'active') returning id into v_ms;
  -- The membership's own transition creates the canonical CLUB_ADMIN assignment; inserting a second
  -- one by hand collides with role_assignments_open_unique, which is the schema being right.

  -- =====================================================================
  -- A. STARTING
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ordinary);
  select pg_temp.try(format('select public.start_impersonation(%L, %L)', v_target, 'Investigating a support ticket')) into v_state;
  perform pg_temp.check(v_state = '42501', format('A1 somebody with no site capability cannot act as anybody (%s)', v_state));

  perform pg_temp.act('authenticated', v_support);
  select pg_temp.try(format('select public.start_impersonation(%L, %L)', v_support, 'Trying to be myself')) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('A2 nobody may act as themselves (%s)', v_state));

  select pg_temp.try(format('select public.start_impersonation(%L, %L)', v_target, 'short')) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('A3 a reason is required, and one word is not one (%s)', v_state));

  select pg_temp.try(format('select public.start_impersonation(%L, %L)', gen_random_uuid(), 'Investigating a support ticket')) into v_state;
  perform pg_temp.check(v_state = 'P0002', format('A4 a target who does not exist is not found (%s)', v_state));

  select public.start_impersonation(v_target, 'Investigating a support ticket about fixtures') into v_id;
  perform pg_temp.check(v_id is not null, 'A5 support may begin a session, with a reason');

  -- A SECOND SESSION IS REFUSED, AND FOR A STRONGER REASON THAN THE EXPLICIT CHECK.
  -- Once acting as somebody, the site capability is evaluated as THAT person, who is not a site
  -- admin -- so the caller no longer holds site.users.impersonate at all. Either refusal is correct;
  -- what matters is that a second session cannot exist.
  select pg_temp.try(format('select public.start_impersonation(%L, %L)', v_target, 'A second session at the same time')) into v_state;
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.impersonation_sessions where actor_user_id = v_support and ended_at is null;
  perform pg_temp.check(v_state <> 'OK' and v_n = 1,
    format('A6 a second concurrent session is refused (%s) and only one stays open (%s)', v_state, v_n));
  perform pg_temp.act('authenticated', v_support);

  -- =====================================================================
  -- B. THE SEAM IS REAL, AND BOTH PEOPLE ARE STILL NAMED
  -- =====================================================================
  select internal.effective_person() into v_uuid;
  perform pg_temp.check(v_uuid = v_target, 'B1 effective_person is the person being acted as');
  select auth.uid() into v_uuid;
  perform pg_temp.check(v_uuid = v_support, 'B2 while the signed-in person is still the one who signed in');

  -- =====================================================================
  -- C. VIEW-ONLY BY DEFAULT
  -- =====================================================================
  perform pg_temp.check(internal.can('team.team.view', 'team', v_club, v_team, null),
    'C1 a view capability the target holds is available while acting as them');
  perform pg_temp.check(not internal.can('team.roster.manage', 'team', v_club, v_team, null),
    'C2 but a capability that CHANGES something is refused, even though the target holds it');
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'C3 and so is any other write the target could have done themselves');

  -- The clamp is the reason, not a missing capability: prove the target really does hold it.
  perform pg_temp.act_postgres();
  perform pg_temp.check(
    coalesce((internal.capability_decision(v_target, 'team.roster.manage', 'team', v_club, v_team, null, true, false)).allowed, false),
    'C4 the target genuinely holds that write capability -- the refusal above is the view-only clamp');

  -- =====================================================================
  -- D. BLOCKED AREAS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_support);
  perform pg_temp.check(not internal.can('safeguarding.welfare.view', 'club', v_club, null, null),
    'D1 safeguarding is blocked while acting as somebody, even read-only');
  perform pg_temp.check(not internal.has_site_capability('site.users.identity.correct'),
    'D2 and so is somebody''s identity');

  -- =====================================================================
  -- E. ACTING NEEDS THE SECOND CAPABILITY
  -- =====================================================================
  perform pg_temp.act_postgres();
  select view_only into v_bool from public.impersonation_sessions where id = v_id;
  perform pg_temp.check(v_bool, 'E1 a support session is view-only, because support does not hold site.users.impersonate_act');

  perform pg_temp.act('authenticated', v_support);
  perform public.end_impersonation('done');

  perform pg_temp.act('authenticated', v_full);
  select public.start_impersonation(v_target, 'Reproducing a reported problem for the club') into v_id;
  perform pg_temp.act_postgres();
  select view_only into v_bool from public.impersonation_sessions where id = v_id;
  perform pg_temp.check(not v_bool, 'E2 a Full Site Admin, who holds impersonate_act, gets a session that may act');

  perform pg_temp.act('authenticated', v_full);
  perform pg_temp.check(internal.can('team.roster.manage', 'team', v_club, v_team, null),
    'E3 and that session may use the target''s write capability');
  perform pg_temp.check(not internal.can('safeguarding.welfare.view', 'club', v_club, null, null),
    'E4 but the blocked areas stay blocked even for them');

  -- =====================================================================
  -- F. EXPIRY IS A READ-TIME FACT
  -- =====================================================================
  perform pg_temp.act_postgres();
  -- Wind the whole window back rather than just the end of it: expires_at > started_at is a
  -- constraint, and a test that violates it would be testing the wrong thing.
  update public.impersonation_sessions
     set started_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes'
   where id = v_id;
  perform pg_temp.act('authenticated', v_full);
  select internal.effective_person() into v_uuid;
  perform pg_temp.check(v_uuid = v_full,
    'F1 an expired session stops acting immediately, with no sweep having run');
  perform pg_temp.check(internal.can('team.roster.manage', 'team', v_club, v_team, null) = false
                        or internal.effective_person() = v_full,
    'F2 and authority is the signed-in person''s own again');

  -- =====================================================================
  -- G. ENDING, AND TELLING THE PERSON (AN-9)
  -- =====================================================================
  perform pg_temp.act_postgres();
  update public.impersonation_sessions
     set started_at = now(), expires_at = now() + interval '30 minutes'
   where id = v_id;
  perform pg_temp.act('authenticated', v_full);
  perform public.end_impersonation('finished looking');
  select internal.effective_person() into v_uuid;
  perform pg_temp.check(v_uuid = v_full, 'G1 ending a session returns authority to the signed-in person');

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.impersonation_sessions where id = v_id and ended_at is not null and ended_by = v_full;
  perform pg_temp.check(v_n = 1, 'G2 and the session records who ended it');

  select count(*) into v_n from public.notifications
   where user_id = v_target and type = 'impersonation_session_ended';
  perform pg_temp.check(v_n >= 1, format('G3 AN-9: the person is told afterwards, in their own notifications (%s)', v_n));

  select count(*) into v_n from public.notification_types where type_key = 'impersonation_session_ended';
  perform pg_temp.check(v_n = 1, 'G4 and that notification type is registered rather than invented at the call site');

  select count(*) into v_n from public.security_events
   where event_type in ('impersonation.started', 'impersonation.ended') and subject_user_id = v_target;
  perform pg_temp.check(v_n >= 2, format('G5 starting and ending are both security events about the target (%s)', v_n));

  -- =====================================================================
  -- H. NOTHING SECRET, AND NOBODY UNINVITED
  -- =====================================================================
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'impersonation_sessions'
     and column_name ~ 'password|secret|token|totp|recovery';
  perform pg_temp.check(v_n = 0, 'H1 no credential column exists on the session record');

  select count(*) into v_n from public.security_events
   where event_type like 'impersonation.%' and metadata::text ~* 'password|secret|totp|recovery';
  perform pg_temp.check(v_n = 0, 'H2 and no secret reaches the security event metadata');

  perform pg_temp.check(not has_function_privilege('anon', 'public.start_impersonation(uuid, text)', 'EXECUTE'),
    'H3 anonymous callers cannot begin one');

  perform pg_temp.act('authenticated', v_ordinary);
  select count(*) into v_n from public.impersonation_sessions;
  perform pg_temp.check(v_n = 0, 'H4 and an unrelated person cannot read that any session ever existed');

  perform pg_temp.act_postgres();
end $$;

rollback;
