-- =====================================================================================================
-- SITE ADMIN USERS & ACCESS -- THE CLOSURE (Identity/Auth Slice 7e; Phase 2 AB.1, AB.3, AB.4, S7-8)
--
-- Deterministic and self-seeding. Nothing here depends on the persistent UAT world.
--
-- WHAT SLICE 7e CLOSED, AND WHAT THEREFORE HAS TO BE PROVED.
--
--   AB.3  `site_search_users` did not exist. The screen assembled a PostgREST filter expression out of
--         a typed value. The new RPC must authorise FIRST, take every filter as data, and refuse a sort
--         it does not recognise rather than quietly defaulting it -- a sort that silently becomes
--         something else is how a paginated export ends up incomplete with nobody noticing.
--
--   AB.1  A Site Admin could CHANGE a player's team placement and could not READ one, because the
--         roster's RLS answers to team.roster.view at TEAM scope. The fix had to be a narrow per-person
--         read, NOT a wider policy -- so this suite asserts the policy is still narrow as well as
--         asserting the read works.
--
--   S7-3  `internal.is_site_admin()` was carried as a declared legacy bypass since Slice 1. Policies and
--         functions reached 0 during Slices 4 and 7a-7d; the last reference hid in a VIEW's WHERE
--         clause, which the counting guards do not look at. It is gone, and stays gone.
--
-- Every refusal below is paired with a positive control in which the same call, with the same
-- arguments, under an administrator who does hold the capability, is shown NOT to be refused. A suite
-- that only asserts refusal passes just as happily against a function that refuses everybody.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'S7E',p_label,p_email,(current_date - interval '37 years')::date,'ACTIVE');
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

-- site_admins is not writable by any browser role, so the fixture writes it as the owner. The harness
-- admits what it is: seeding state, not exercising the path under test.
create or replace function pg_temp.admin(p_user uuid, p_profile text) returns void language plpgsql as $$
begin
  insert into public.site_admins (user_id, status, profile_key)
  values (p_user, 'active', p_profile)
  on conflict (user_id) do update set status = 'active', profile_key = excluded.profile_key;
end $$;

/** Runs one statement as one person and returns the SQLSTATE, or OK. */
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    execute p_sql;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns int language plpgsql as $$
declare v int;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v, -1);
end $$;

do $$
declare
  v_tag      text := substr(gen_random_uuid()::text, 1, 8);
  v_full     uuid;
  v_mod      uuid;
  v_nobody   uuid;
  v_subject  uuid;
  v_guardian uuid;
  v_club     uuid;
  v_dir      uuid;
  v_team     uuid;
  v_player   uuid;
  v_n        int;
  v_total    bigint;
  v_rc       text;
  v_first    uuid;
  v_second   uuid;
begin
  -- ---------------------------------------------------------------------------------------------
  -- SEED
  -- ---------------------------------------------------------------------------------------------
  v_full     := pg_temp.person('Full',     's7e.full.'     || v_tag || '@ovalball.test');
  v_mod      := pg_temp.person('Mod',      's7e.mod.'      || v_tag || '@ovalball.test');
  v_nobody   := pg_temp.person('Nobody',   's7e.nobody.'   || v_tag || '@ovalball.test');
  v_subject  := pg_temp.person('Subject',  's7e.subject.'  || v_tag || '@ovalball.test');
  v_guardian := pg_temp.person('Guardian', 's7e.guardian.' || v_tag || '@ovalball.test');
  perform pg_temp.admin(v_full, 'SITE_FULL');

  -- THE NEGATIVE CONTROL, AND THE TWO WRONG ONES IT REPLACED.
  --
  -- The first draft used a Message Moderator, assuming a narrow profile would not hold
  -- site.users.view. Every one of the seven site profiles holds it: seeing the platform is the
  -- baseline of being a Site Admin and only ACTING is profile-specific. Asserting otherwise would
  -- have been asserting a product decision nobody made.
  --
  -- The second draft wrote a site-scope DENY override on site.users.view, which changed nothing --
  -- and should not have. K.3 is explicit in internal.capability_decision: at site scope only rule 7
  -- can allow, and overrides are never consulted. public.set_capability_override refuses a site.*
  -- capability for exactly that reason, so the draft had used a raw INSERT to manufacture a state the
  -- product cannot create, and then read the engine's correct behaviour as a failure.
  --
  -- What is left is the state that is both real and reachable: somebody whose Site Admin access has
  -- been REVOKED. The row is still in site_admins, so this distinguishes "answers the capability"
  -- from "answers the existence of a row" without inventing anything.
  perform pg_temp.admin(v_mod, 'SITE_MOD');
  update public.site_admins set status = 'revoked', revoked_at = now() where user_id = v_mod;

  insert into public.club_directory (name, normalized_key, source, rugby_code, country, nation, verification_status, active)
  values ('Slice 7e Test RFC ' || v_tag, 's7e-test-rfc-' || v_tag, 'MANUAL', 'union', 'England', 'England', 'unverified', true)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug) values (v_dir, 's7e-club-' || v_tag) returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's7e-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true)
  returning id into v_team;

  insert into public.players (first_name, surname, date_of_birth, user_id, active, playing_pathway)
  values ('Seven', 'Eplayer', (current_date - interval '11 years')::date, v_subject, true, 'MALE')
  returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status)
  values (v_player, v_team, 'active');
  insert into public.guardians (player_id, guardian_user_id, relationship_type, status, state, source, verification_state)
  values (v_player, v_guardian, 'parent', 'active', 'ACTIVE', 'SITE_ADMIN_ASSIGNMENT', 'SITE_VERIFIED');

  -- ---------------------------------------------------------------------------------------------
  -- A. AB.3 -- site_search_users exists, and is the boundary rather than a convenience.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    to_regprocedure('public.site_search_users(text,text,text,text,int,int)') is not null,
    'S7E-01 AB.3 public.site_search_users exists (the reconciliation recorded it MISSED)');

  perform pg_temp.check(
    not has_function_privilege('anon', 'public.site_search_users(text,text,text,text,int,int)', 'EXECUTE'),
    'S7E-02 and anon cannot search every account on the platform');

  v_rc := pg_temp.try_as(v_nobody, 'select * from public.site_search_users()');
  perform pg_temp.check(v_rc = '42501',
    'S7E-03 somebody who is not a Site Admin at all is refused (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_mod, 'select * from public.site_search_users()');
  perform pg_temp.check(v_rc = '42501',
    'S7E-04 and so is somebody whose Site Admin access was revoked but whose site_admins row is still '
    'there -- the search asks the capability, not whether a row exists (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_full, 'select * from public.site_search_users()');
  perform pg_temp.check(v_rc = 'OK',
    'S7E-05 POSITIVE CONTROL: the same call by an administrator holding site.users.view is not refused, '
    'so S7E-03/04 are the capability and not a broken function (' || v_rc || ')');

  -- The sort is a closed set. An unrecognised one is REFUSED, not defaulted.
  v_rc := pg_temp.try_as(v_full, $q$select * from public.site_search_users(null,'all','all','user_id; drop table public.clubs')$q$);
  perform pg_temp.check(v_rc = '22023',
    'S7E-06 an unrecognised sort is refused rather than quietly becoming the default (' || v_rc || ')');
  v_rc := pg_temp.try_as(v_full, $q$select * from public.site_search_users(null,'not_a_filter')$q$);
  perform pg_temp.check(v_rc = '22023', 'S7E-07 and so is an unrecognised access filter (' || v_rc || ')');
  v_rc := pg_temp.try_as(v_full, $q$select * from public.site_search_users(null,'all','not_a_status')$q$);
  perform pg_temp.check(v_rc = '22023', 'S7E-08 and an unrecognised status filter (' || v_rc || ')');

  -- It actually searches.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_full, 'role', 'authenticated')::text, true);
  select count(*), max(total_count) into v_n, v_total
    from public.site_search_users('s7e.subject.' || v_tag, 'all', 'all', 'name-asc', 25, 0);
  perform pg_temp.check(v_n = 1 and v_total = 1,
    'S7E-09 a search by email finds exactly the one person, and total_count agrees with the page '
    '(rows ' || v_n || ', total ' || coalesce(v_total, -1) || ')');

  select count(*) into v_n from public.site_search_users('s', 'all', 'all', 'name-asc', 25, 0);
  select count(*) into v_total from public.site_search_users(null, 'all', 'all', 'name-asc', 25, 0);
  perform pg_temp.check(v_n = v_total,
    'S7E-10 a one-character search is treated as no search, so it cannot match most of the platform by '
    'accident (' || v_n || ' vs ' || v_total || ')');

  -- A page is capped, and the pages do not overlap.
  select count(*) into v_n from public.site_search_users(null, 'all', 'all', 'name-asc', 5000, 0);
  perform pg_temp.check(v_n <= 100, 'S7E-11 one call can never return more than 100 rows (' || v_n || ')');

  select user_id into v_first from public.site_search_users(null, 'all', 'all', 'name-asc', 1, 0);
  select user_id into v_second from public.site_search_users(null, 'all', 'all', 'name-asc', 1, 1);
  perform pg_temp.check(v_first is distinct from v_second,
    'S7E-12 the ordering has a stable tiebreak, so page two cannot repeat a row page one already showed');

  -- The filters mean what they say.
  select count(*) into v_n from public.site_search_users(null, 'site_admin', 'all', 'name-asc', 100, 0);
  perform pg_temp.check(
    v_n = (select count(*) from public.admin_user_overview where is_site_admin),
    'S7E-13 the site_admin filter returns exactly the Site Admins (' || v_n || ')');
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------------------------------------
  -- B. AB.1 -- the roster a Site Admin can change is now one they can read, WITHOUT widening the policy.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    to_regprocedure('public.site_player_team_memberships(uuid)') is not null,
    'S7E-20 the per-person roster read exists');

  v_n := pg_temp.count_as(v_full, format('select count(*) from public.player_team_memberships where team_id = %L', v_team));
  perform pg_temp.check(v_n = 0,
    'S7E-21 THE ASYMMETRY IS REAL: a Full Site Admin still cannot read the roster table directly -- the '
    'fix was a narrow read, not a wider policy (' || v_n || ' rows)');

  perform pg_temp.check(
    not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'player_team_memberships'
                   and coalesce(qual, '') like '%has_site_capability%'),
    'S7E-22 and player_team_memberships_select carries no site clause, so no roster on the platform was '
    'handed to every administrator with any site read capability');

  v_n := pg_temp.count_as(v_full, format('select count(*) from public.site_player_team_memberships(%L)', v_subject));
  perform pg_temp.check(v_n = 1,
    'S7E-23 but the subject''s own placement is readable through the definer read (' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format('select count(*) from public.site_player_team_memberships(%L)', v_guardian));
  perform pg_temp.check(v_n = 1,
    'S7E-24 and so is a child the subject actively guards (' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format('select count(*) from public.site_player_team_memberships(%L)', v_nobody));
  perform pg_temp.check(v_n = 0,
    'S7E-25 and somebody unrelated to the player gets nothing -- it answers about one person, so it '
    'cannot become a roster export by being called in a loop (' || v_n || ')');

  v_n := pg_temp.count_as(v_mod, format('select count(*) from public.site_player_team_memberships(%L)', v_subject));
  perform pg_temp.check(v_n = 0,
    'S7E-26 and a revoked Site Admin reads nothing from it either, so the roster read asks the '
    'capability rather than trusting the row (' || v_n || ')');

  perform pg_temp.check(
    not has_function_privilege('anon', 'public.site_player_team_memberships(uuid)', 'EXECUTE'),
    'S7E-27 and anon cannot call it at all');

  -- A site capability is never a permission decision, and the door is shut at the RPC as well as in
  -- the engine -- which is why the Capability Overrides tab does not offer one. Found while writing
  -- the negative control above, and pinned so that a future picker cannot quietly start offering it.
  v_rc := pg_temp.try_as(v_full, format(
    $q$select public.site_set_capability_override(%L,'site.users.view','site',null,null,'deny','A site capability is not a permission decision.')$q$,
    v_subject));
  perform pg_temp.check(v_rc = '22023',
    'S7E-28 a site.* capability cannot be granted or denied as a per-person override -- site authority '
    'comes from the Site Admin profile (' || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- C. S7-3 -- is_site_admin is retired, including where the counting guards do not look.
  -- ---------------------------------------------------------------------------------------------
  select count(*) into v_n from pg_policies
   where (coalesce(qual, '') || coalesce(with_check, '')) ~ '\mis_site_admin\s*\(';
  perform pg_temp.check(v_n = 0, 'S7E-30 no policy references is_site_admin (' || v_n || ')');

  select count(*) into v_n from pg_proc p where p.prokind = 'f' and p.prosrc ~ '\mis_site_admin\s*\(';
  perform pg_temp.check(v_n = 0, 'S7E-31 no function references it (' || v_n || ')');

  select count(*) into v_n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'v'
     and pg_get_viewdef(c.oid, true) ~ '\minternal\.is_site_admin\s*\(';
  perform pg_temp.check(v_n = 0,
    'S7E-32 AND NO VIEW DOES EITHER -- admin_club_overview''s WHERE clause is where the last one hid, '
    'because policy and function counts do not look inside a view (' || v_n || ')');

  perform pg_temp.check(
    not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'internal' and p.proname = 'is_site_admin'),
    'S7E-33 and the helper itself is dropped, not left for the next person to find before the canonical '
    'resolver');

  perform pg_temp.check(
    pg_get_viewdef('public.admin_club_overview'::regclass, true) ~ 'site\.clubs\.view',
    'S7E-34 admin_club_overview is gated on the explicit site.clubs.view capability');

  v_n := pg_temp.count_as(v_full, 'select count(*) from public.admin_club_overview');
  perform pg_temp.check(v_n > 0,
    'S7E-35 POSITIVE CONTROL: an administrator holding site.clubs.view still reads the club list, so '
    'S7E-34 replaced the gate rather than closing the door (' || v_n || ')');

  v_n := pg_temp.count_as(v_nobody, 'select count(*) from public.admin_club_overview');
  perform pg_temp.check(v_n = 0, 'S7E-36 and somebody with no site capability reads none of it (' || v_n || ')');

  -- ---------------------------------------------------------------------------------------------
  -- CC. The provenance timelines can see the events their own slice writes.
  --
  -- Found by the browser suite: site_add_club_membership emits `site.membership_added` and
  -- site_membership_history matched `site.club_%`, so the timeline built to explain a membership could
  -- not see one being added. Seven of the sixteen master-control event types were displayed by nothing.
  -- These assertions are written against real emitted rows rather than against the function bodies,
  -- because the bug was that the two agreed with nobody.
  -- ---------------------------------------------------------------------------------------------
  insert into public.security_events (event_type, subject_user_id, actor_user_id, outcome, reason, club_id)
  values ('site.membership_added', v_subject, v_full, 'SUCCESS', 'Slice 7e timeline coverage', v_club);
  insert into public.security_events (event_type, subject_user_id, actor_user_id, outcome, reason, club_id, team_id)
  values ('site.role_revoked', v_subject, v_full, 'SUCCESS', 'Slice 7e timeline coverage', v_club, v_team);
  insert into public.security_events (event_type, subject_user_id, actor_user_id, outcome, reason)
  values ('session.revoked_by_admin', v_subject, v_full, 'SUCCESS', 'Slice 7e timeline coverage');
  insert into public.security_events (event_type, subject_user_id, actor_user_id, outcome, reason, player_id)
  values ('site.guardian_linked', v_subject, v_full, 'SUCCESS', 'Slice 7e timeline coverage', v_player);

  v_n := pg_temp.count_as(v_full, format(
    $q$select count(*) from public.site_membership_history(%L) where entry = 'site.membership_added'$q$, v_subject));
  perform pg_temp.check(v_n = 1,
    'S7E-50 a membership being ADDED appears on the Membership History timeline -- it did not, because '
    'the emitter and the reader used different names (' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format(
    $q$select count(*) from public.site_team_history(%L) where entry = 'site.role_revoked'$q$, v_subject));
  perform pg_temp.check(v_n = 1,
    'S7E-51 a role revoked FOR A TEAM lands on Team History, because the timelines discriminate on the '
    'scope column rather than on the shape of the event name (' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format(
    $q$select count(*) from public.site_membership_history(%L) where entry = 'site.role_revoked'$q$, v_subject));
  perform pg_temp.check(v_n = 0,
    'S7E-52 and does NOT also land on Membership History, so a team decision is not reported twice '
    '(' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format(
    $q$select count(*) from public.site_account_history(%L) where entry = 'session.revoked_by_admin'$q$, v_subject));
  perform pg_temp.check(v_n = 1,
    'S7E-53 ending somebody''s sessions is visible on the account timeline -- account, session and Site '
    'Admin decisions were previously shown by nothing at all (' || v_n || ')');

  v_n := pg_temp.count_as(v_full, format(
    $q$select count(*) from public.site_family_history(%L) where entry = 'site.guardian_linked'$q$, v_subject));
  perform pg_temp.check(v_n = 1, 'S7E-54 and a family link is still on the family timeline (' || v_n || ')');

  v_n := pg_temp.count_as(v_mod, format($q$select count(*) from public.site_account_history(%L)$q$, v_subject));
  perform pg_temp.check(v_n = 0,
    'S7E-55 the new account timeline answers site.users.view like the other three (' || v_n || ')');

  -- ---------------------------------------------------------------------------------------------
  -- D. The two-administrator rule the UI now reaches (S7-8) still refuses what it always refused.
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_full, format('select public.site_request_site_admin_grant(%L, %L, %L)',
                                        v_full, 'SITE_FULL', 'Raising this for myself, which must fail.'));
  perform pg_temp.check(v_rc <> 'OK',
    'S7E-40 an administrator still cannot raise a Site Admin grant for themselves, now that a screen '
    'can ask (' || v_rc || ')');

  perform pg_temp.check(
    exists (select 1 from pg_constraint
             where conrelid = 'public.site_admin_grant_requests'::regclass
               and conname = 'site_admin_grant_requests_decider_not_requester'),
    'S7E-41 and the decider-is-not-the-requester constraint is still on the table, not only in the RPC');

  raise notice '--- Slice 7e closure suite complete ---';
end $$;

rollback;
