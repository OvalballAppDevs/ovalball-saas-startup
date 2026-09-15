-- IDENTITY FOUNDATION + DATABASE/API PERIMETER (Identity/Auth Slice 1).
--
-- Every check runs as the real database role a caller would have (anon,
-- authenticated with a JWT subject, service_role, or the backend) and reads the
-- database back. Nothing here is "the button is hidden".
--
--   A. Identity lifecycle: every auth identity has exactly one profile, and a
--      profile is never authority.
--   B. Email and account-state authority.
--   C. admin_club_overview and club_directory private columns.
--   D. Competition Match private columns.
--   E. Function execute perimeter.
--   F. Default privileges for objects created from now on.
--   G. Public surfaces still public; private ones still private.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
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

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;

create or replace function pg_temp.new_identity(p_email text, p_provider text default 'email', p_invited boolean default false) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token, invited_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    jsonb_build_object('provider', p_provider), '{}'::jsonb, '', '', '', '', '', '', '', '', case when p_invited then now() end);
  return v_id;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_new uuid; v_social uuid; v_invited uuid; v_other uuid; v_admin uuid; v_member uuid; v_backfilled uuid;
  v_club uuid; v_dir uuid; v_dir2 uuid; v_team uuid;
  v_comp uuid; v_season uuid; v_edition uuid; v_stage uuid; v_p1 uuid; v_p2 uuid; v_match uuid;
  v_fixture uuid;
  v_count integer; v_text text; v_bool boolean; v_err text;
  v_row record;
begin
  -- =================================================================
  -- A. Identity lifecycle
  -- =================================================================
  v_new := pg_temp.new_identity('slice1-new-' || v_tag || '@ovalball.test');
  select count(*) into v_count from public.profiles where id = v_new;
  select * into v_row from public.profiles where id = v_new;
  if v_count = 1 and v_row.setup_state = 'PENDING_DETAILS' and v_row.account_state = 'ACTIVE'
     and v_row.email = 'slice1-new-' || v_tag || '@ovalball.test' and v_row.created_source = 'SELF_SIGNUP' then
    raise notice 'PASS A1: creating an auth identity creates exactly one profile holding a place for the person''s details';
  else
    raise notice 'FAIL A1: identity produced % profile(s) (state %, setup %, source %)', v_count, v_row.account_state, v_row.setup_state, v_row.created_source;
  end if;

  select
    (select count(*) from public.club_memberships where user_id = v_new)
  + (select count(*) from public.guardians where guardian_user_id = v_new)
  + (select count(*) from public.players where user_id = v_new)
  + (select count(*) from public.site_admins where user_id = v_new)
  + (select count(*) from public.capability_overrides where user_id = v_new)
  into v_count;
  if v_count = 0 then
    raise notice 'PASS A2: a new profile carries no club, team, player, parent, override or Site Admin relationship';
  else
    raise notice 'FAIL A2: a new identity came with % relationship row(s)', v_count;
  end if;

  v_social := pg_temp.new_identity('slice1-social-' || v_tag || '@ovalball.test', 'google');
  v_invited := pg_temp.new_identity('slice1-invited-' || v_tag || '@ovalball.test', 'email', true);
  if (select created_source from public.profiles where id = v_social) = 'SOCIAL'
     and (select created_source from public.profiles where id = v_invited) = 'INVITATION' then
    raise notice 'PASS A3: social and invited identities are created the same way and record where they came from';
  else
    raise notice 'FAIL A3: provenance was % / %', (select created_source from public.profiles where id = v_social), (select created_source from public.profiles where id = v_invited);
  end if;

  -- The first profile insert completes the held place.
  perform pg_temp.act('authenticated', v_new);
  insert into public.profiles (id, first_name, surname, date_of_birth) values (v_new, 'slice', 'newcomer', date '1990-02-03');
  perform pg_temp.act_postgres();
  select * into v_row from public.profiles where id = v_new;
  select count(*) into v_count from public.profiles where id = v_new;
  if v_count = 1 and v_row.setup_state = 'COMPLETE' and v_row.first_name = 'Slice' and v_row.date_of_birth = date '1990-02-03' then
    raise notice 'PASS A4: completing signup fills the existing profile rather than creating a second one';
  else
    raise notice 'FAIL A4: % profile row(s), setup %, name %', v_count, v_row.setup_state, v_row.first_name;
  end if;

  -- Repeating the lifecycle is harmless.
  select internal.ensure_profiles_for_identities() into v_count;
  perform internal.ensure_profiles_for_identities();
  if (select count(*) from public.profiles where id in (v_new, v_social, v_invited)) = 3
     and not exists (select 1 from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) then
    raise notice 'PASS A5: the lifecycle and backfill are idempotent: one profile per identity after repeated runs';
  else
    raise notice 'FAIL A5: profile count drifted after repeated runs';
  end if;

  begin
    insert into public.profiles (id, first_name, surname) values (v_new, 'Second', 'Copy');
    raise notice 'FAIL A6: a second profile row was created for a completed identity';
  exception when unique_violation then
    raise notice 'PASS A6: a completed identity can never gain a second profile';
  end;

  -- Backfill of an identity with no profile: exactly what auth justifies.
  v_backfilled := pg_temp.new_identity('slice1-backfill-' || v_tag || '@ovalball.test');
  delete from public.profiles where id = v_backfilled;
  select internal.ensure_profiles_for_identities() into v_count;
  select * into v_row from public.profiles where id = v_backfilled;
  if v_count >= 1 and v_row.id is not null and v_row.setup_state = 'PENDING_DETAILS' and v_row.created_source = 'LEGACY'
     and v_row.email = 'slice1-backfill-' || v_tag || '@ovalball.test' and v_row.first_name = '' and v_row.date_of_birth is null
     and not exists (select 1 from public.club_memberships where user_id = v_backfilled) then
    raise notice 'PASS A7: a profile-less identity is backfilled from auth facts only -- email, pending details, no authority';
  else
    raise notice 'FAIL A7: backfill produced % (setup %, source %)', v_count, v_row.setup_state, v_row.created_source;
  end if;

  -- A browser session cannot complete, or claim, somebody else's identity.
  v_other := pg_temp.new_identity('slice1-other-' || v_tag || '@ovalball.test');
  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_social);
    insert into public.profiles (id, first_name, surname) values (v_other, 'Hijack', 'Attempt');
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select setup_state from public.profiles where id = v_other) = 'PENDING_DETAILS'
     and (select first_name from public.profiles where id = v_other) = '' then
    raise notice 'PASS A8: a user cannot complete or take over another identity''s profile';
  else
    raise notice 'FAIL A8: another identity''s profile was touched (sqlstate %)', v_err;
  end if;

  -- =================================================================
  -- B. Email and account-state authority
  -- =================================================================
  perform pg_temp.act('authenticated', v_social);
  insert into public.profiles (id, first_name, surname) values (v_social, 'Social', 'Person');
  perform pg_temp.act_postgres();

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_social);
    update public.profiles set email = 'victim-' || v_tag || '@ovalball.test' where id = v_social;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select email from public.profiles where id = v_social) = 'slice1-social-' || v_tag || '@ovalball.test' then
    raise notice 'PASS B1: a user cannot rewrite the email their profile carries';
  else
    raise notice 'FAIL B1: profile email writable (sqlstate %)', v_err;
  end if;

  update public.profiles set email = 'planted-' || v_tag || '@ovalball.test' where id = v_invited;
  if (select email from public.profiles where id = v_invited) = 'slice1-invited-' || v_tag || '@ovalball.test' then
    raise notice 'PASS B2: even a backend write cannot plant a profile email different from the authentication identity';
  else
    raise notice 'FAIL B2: a planted email was stored';
  end if;

  update auth.users set email = 'slice1-changed-' || v_tag || '@ovalball.test' where id = v_invited;
  if (select email from public.profiles where id = v_invited) = 'slice1-changed-' || v_tag || '@ovalball.test' then
    raise notice 'PASS B3: an authentication email change reaches the profile in the same transaction';
  else
    raise notice 'FAIL B3: profile email did not follow the identity';
  end if;

  v_bool := true;
  foreach v_text in array array['account_state', 'account_status', 'setup_state', 'created_source', 'state_changed_by', 'date_of_birth', 'email'] loop
    if has_column_privilege('authenticated', 'public.profiles', v_text, 'UPDATE') or has_column_privilege('anon', 'public.profiles', v_text, 'UPDATE') then
      v_bool := false;
    end if;
  end loop;
  if v_bool then
    raise notice 'PASS B4: no browser role holds UPDATE on account state, setup state, provenance, DOB or email';
  else
    raise notice 'FAIL B4: a protected profile column is writable by a browser role';
  end if;

  update public.profiles set account_state = 'SUSPENDED' where id = v_social;
  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_social);
    update public.profiles set account_state = 'ACTIVE', account_status = 'active' where id = v_social;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select account_state from public.profiles where id = v_social) = 'SUSPENDED'
     and (select account_status from public.profiles where id = v_social) = 'suspended' then
    raise notice 'PASS B5: a suspended user cannot restore their own account state, directly or through the compatibility column';
  else
    raise notice 'FAIL B5: self-restoration (sqlstate %)', v_err;
  end if;

  if not internal.is_account_active(v_social) and not internal.is_account_active(null)
     and internal.is_account_active(v_new) then
    raise notice 'PASS B6: only an ACTIVE known identity is active; a suspended or absent identity is not';
  else
    raise notice 'FAIL B6: is_account_active semantics wrong';
  end if;

  delete from public.profiles where id = v_other;
  if not internal.is_account_active(v_other) then
    raise notice 'PASS B7: an identity whose profile is missing is never treated as active';
  else
    raise notice 'FAIL B7: a profile-less identity is treated as active';
  end if;
  perform internal.ensure_profiles_for_identities();

  v_admin := pg_temp.new_identity('slice1-admin-' || v_tag || '@ovalball.test');
  insert into public.profiles (id, first_name, surname) values (v_admin, 'Slice', 'Admin');
  insert into public.site_admins (user_id, status, admin_role) values (v_admin, 'active', 'full');
  perform pg_temp.act('authenticated', v_admin);
  perform public.set_account_status(v_social, 'active');
  perform pg_temp.act_postgres();
  if (select account_state from public.profiles where id = v_social) = 'ACTIVE'
     and (select account_status from public.profiles where id = v_social) = 'active'
     and (select state_changed_by from public.profiles where id = v_social) = v_admin then
    raise notice 'PASS B8: Site Admin account administration owns account_state and records who changed it';
  else
    raise notice 'FAIL B8: set_account_status did not own the state change';
  end if;

  -- =================================================================
  -- C. admin_club_overview / club_directory
  -- =================================================================
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key, notes, official_email)
  values ('Slice One RUFC ' || v_tag, 'union', 'England', 'England', 'manual', 'verified', 'slice1-' || v_tag, 'internal note ' || v_tag, 'secret-' || v_tag || '@club.test')
  returning id into v_dir;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    select count(*) into v_count from public.admin_club_overview;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS C1: an anonymous caller cannot read admin_club_overview at all';
  else
    raise notice 'FAIL C1: anon read admin_club_overview (sqlstate %)', v_err;
  end if;

  perform pg_temp.act('authenticated', v_new);
  select count(*) into v_count from public.admin_club_overview;
  perform pg_temp.act_postgres();
  if v_count = 0 then
    raise notice 'PASS C2: an ordinary signed-in user reads no administrative club data from admin_club_overview';
  else
    raise notice 'FAIL C2: an ordinary signed-in user read % admin overview rows', v_count;
  end if;

  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_count from public.admin_club_overview where directory_id = v_dir and notes = 'internal note ' || v_tag;
  perform pg_temp.act_postgres();
  if v_count = 1 then
    raise notice 'PASS C3: a Site Admin still reads admin_club_overview, including internal notes';
  else
    raise notice 'FAIL C3: the Site Admin lost admin_club_overview (%)', v_count;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    select notes into v_text from public.club_directory where id = v_dir;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  perform pg_temp.act('anon');
  select name into v_text from public.club_directory where id = v_dir;
  perform pg_temp.act_postgres();
  if v_err = '42501' and v_text = 'Slice One RUFC ' || v_tag
     and not has_column_privilege('anon', 'public.club_directory', 'official_email', 'SELECT') then
    raise notice 'PASS C4: anon reads a directory club''s public facts but not its internal notes or official email';
  else
    raise notice 'FAIL C4: directory column exposure (sqlstate %, name %)', v_err, v_text;
  end if;

  -- =================================================================
  -- D. Competition Match private columns
  -- =================================================================
  select id into v_season from public.seasons order by starts_on desc limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('Slice1 ' || v_tag, current_date - 30, current_date + 300, 'union', 2200, 'slice1-' || v_tag) returning id into v_season;
  end if;
  insert into public.competitions (name, slug, normalized_key, rugby_code, active) values ('Slice1 Cup ' || v_tag, 'slice1-cup-' || v_tag, 'slice1-cup-' || v_tag, 'union', true) returning id into v_comp;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active) values (v_comp, v_season, 'union', true) returning id into v_edition;
  insert into public.competition_stages (edition_id, kind, name) values (v_edition, 'league', 'Pool') returning id into v_stage;
  insert into public.competition_participants (edition_id, slot, club_directory_id) values (v_edition, 1, v_dir) returning id into v_p1;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Slice One Opponents ' || v_tag, 'union', 'England', 'England', 'manual', 'verified', 'slice1-opp-' || v_tag) returning id into v_dir2;
  insert into public.competition_participants (edition_id, slot, club_directory_id) values (v_edition, 2, v_dir2) returning id into v_p2;
  insert into public.competition_matches (edition_id, stage_id, home_participant_id, away_participant_id, match_date, status, is_public, home_score, away_score, notes, sync_error)
  values (v_edition, v_stage, v_p1, v_p2, current_date, 'completed', true, 12, 7, 'organiser note ' || v_tag, 'sync failure ' || v_tag)
  returning id into v_match;

  perform pg_temp.act('anon');
  select count(*) into v_count from public.competition_matches where id = v_match and home_score = 12 and away_score = 7 and status = 'completed';
  perform pg_temp.act_postgres();
  if v_count = 1 then
    raise notice 'PASS D1: the public Competition Match schedule and result remain readable anonymously';
  else
    raise notice 'FAIL D1: public competition result not readable (%)', v_count;
  end if;

  foreach v_text in array array['notes', 'sync_error'] loop
    v_err := null;
    begin
      perform pg_temp.act('anon');
      execute format('select %I from public.competition_matches where id = $1', v_text) using v_match;
      perform pg_temp.act_postgres();
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      perform pg_temp.act_postgres();
    end;
    if v_err = '42501' then
      raise notice 'PASS D2: anon cannot retrieve competition_matches.%', v_text;
    else
      raise notice 'FAIL D2: anon retrieved competition_matches.% (sqlstate %)', v_text, v_err;
    end if;
  end loop;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    perform * from public.competition_matches where id = v_match;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS D3: selecting whole Competition Match rows anonymously is refused -- only the public projection is available';
  else
    raise notice 'FAIL D3: anon selected whole rows (sqlstate %)', v_err;
  end if;

  -- =================================================================
  -- E. Function execute perimeter
  -- =================================================================
  select not has_function_privilege('anon', 'public.set_account_status(uuid, text)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.accept_invitation(text)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.approve_guardian_link_request(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.get_club_member_directory(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.has_capability(text, text, uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.site_admin_dashboard_platform()', 'EXECUTE')
  into v_bool;
  if v_bool then
    raise notice 'PASS E1: anon cannot execute privileged RPCs outside the manifest';
  else
    raise notice 'FAIL E1: anon can execute a privileged RPC';
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    perform public.get_club_member_directory(gen_random_uuid());
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS E2: an anonymous call to a member RPC is refused before the function runs';
  else
    raise notice 'FAIL E2: anon member RPC call (sqlstate %)', v_err;
  end if;

  select has_function_privilege('anon', 'public.get_invitation_preview(text)', 'EXECUTE')
     and has_function_privilege('anon', 'public.platform_public_state()', 'EXECUTE')
     and has_function_privilege('anon', 'public.submit_public_support_ticket(text, text, text, text, text, text)', 'EXECUTE')
  into v_bool;
  if v_bool then
    raise notice 'PASS E3: the genuine public entry points remain anonymously executable';
  else
    raise notice 'FAIL E3: a public entry point lost anonymous execute';
  end if;

  select not has_function_privilege('authenticated', 'public.get_gocardless_token_for_payer_subscription(uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.record_gocardless_event(text, text, text, jsonb, uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'internal.ensure_profiles_for_identities()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'internal.create_profile_for_identity()', 'EXECUTE')
  into v_bool;
  if v_bool then
    raise notice 'PASS E4: a signed-in user cannot execute server-only or identity-lifecycle functions';
  else
    raise notice 'FAIL E4: a signed-in user can execute a server-only function';
  end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_count = 0 then
    raise notice 'PASS E5: no application function in public or internal is executable through PUBLIC';
  else
    raise notice 'FAIL E5: % function(s) still executable through PUBLIC', v_count;
  end if;

  -- =================================================================
  -- F. Default privileges for new objects
  -- =================================================================
  execute 'create table public.zz_slice1_default_probe (id uuid primary key default gen_random_uuid(), note text)';
  execute 'create sequence public.zz_slice1_default_probe_seq';
  execute 'create function public.zz_slice1_default_probe_fn() returns int language sql security definer set search_path = '''' as $f$ select 1 $f$';
  select not has_table_privilege('anon', 'public.zz_slice1_default_probe', 'SELECT')
     and not has_table_privilege('anon', 'public.zz_slice1_default_probe', 'INSERT')
     and not has_table_privilege('anon', 'public.zz_slice1_default_probe', 'UPDATE')
     and not has_table_privilege('anon', 'public.zz_slice1_default_probe', 'DELETE')
     and not has_table_privilege('authenticated', 'public.zz_slice1_default_probe', 'INSERT')
     and not has_table_privilege('authenticated', 'public.zz_slice1_default_probe', 'SELECT')
     and not has_table_privilege('authenticated', 'public.zz_slice1_default_probe', 'TRUNCATE')
  into v_bool;
  if v_bool then
    raise notice 'PASS F1: a new table is not readable or writable by anon or authenticated until its migration grants access';
  else
    raise notice 'FAIL F1: a new table inherited browser-role privileges';
  end if;
  select not has_function_privilege('anon', 'public.zz_slice1_default_probe_fn()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.zz_slice1_default_probe_fn()', 'EXECUTE')
     and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = 'public.zz_slice1_default_probe_fn()'::regprocedure and a.grantee = 0)
  into v_bool;
  if v_bool then
    raise notice 'PASS F2: a new SECURITY DEFINER function is not executable by anon, authenticated or PUBLIC by default';
  else
    raise notice 'FAIL F2: a new function is executable by a browser role by default';
  end if;
  select not has_sequence_privilege('anon', 'public.zz_slice1_default_probe_seq', 'USAGE')
     and not has_sequence_privilege('authenticated', 'public.zz_slice1_default_probe_seq', 'USAGE')
  into v_bool;
  if v_bool then
    raise notice 'PASS F3: a new sequence is not usable by browser roles by default';
  else
    raise notice 'FAIL F3: a new sequence is usable by a browser role';
  end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      or has_table_privilege('anon', c.oid, 'TRIGGER') or has_table_privilege('authenticated', c.oid, 'TRIGGER')
      or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('authenticated', c.oid, 'REFERENCES')
      or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  if v_count = 0 then
    raise notice 'PASS F4: no public table grants anon any write, or any browser role TRUNCATE, TRIGGER or REFERENCES';
  else
    raise notice 'FAIL F4: % table(s) still grant a forbidden privilege to a browser role', v_count;
  end if;

  -- =================================================================
  -- G. Public surfaces
  -- =================================================================
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'slice1-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'slice1-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.club_articles (club_id, slug, title, body, status, visibility, published_at)
  values (v_club, 'public-' || v_tag, 'Public Story', 'Hello', 'PUBLISHED', 'PUBLIC', now()),
         (v_club, 'draft-' || v_tag, 'Draft Story', 'Not yet', 'DRAFT', 'PUBLIC', null),
         (v_club, 'members-' || v_tag, 'Members Story', 'Members only', 'PUBLISHED', 'MEMBERS', now());
  insert into public.club_announcements (club_id, title, status, visibility, starts_at, published_at)
  values (v_club, 'Ground open', 'PUBLISHED', 'PUBLIC', now() - interval '1 hour', now()),
         (v_club, 'Members notice', 'PUBLISHED', 'MEMBERS', now() - interval '1 hour', now());
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, home_score, away_score)
  values (v_team, 'Home', 'Friendly Opponents ' || v_tag, current_date + 7, '10:30', 'Booked', 'club_created', 'meet at 9', null, null)
  returning id into v_fixture;

  perform pg_temp.act('anon');
  select count(*) into v_count from public.clubs where id = v_club and slug = 'slice1-' || v_tag;
  perform pg_temp.act_postgres();
  if v_count = 1 then
    raise notice 'PASS G1: the public club home''s club identity is readable anonymously';
  else
    raise notice 'FAIL G1: public club not readable (%)', v_count;
  end if;

  perform pg_temp.act('anon');
  select string_agg(slug, ',' order by slug) into v_text from public.club_articles where club_id = v_club;
  perform pg_temp.act_postgres();
  if v_text = 'public-' || v_tag then
    raise notice 'PASS G2: a PUBLISHED PUBLIC article is public; draft and members-only articles are not';
  else
    raise notice 'FAIL G2: anon article set was %', coalesce(v_text, '(none)');
  end if;

  perform pg_temp.act('anon');
  select string_agg(title, ',') into v_text from public.club_announcements where club_id = v_club;
  perform pg_temp.act_postgres();
  if v_text = 'Ground open' then
    raise notice 'PASS G3: a live PUBLIC announcement is public; a members-only one is not';
  else
    raise notice 'FAIL G3: anon announcements were %', coalesce(v_text, '(none)');
  end if;

  perform pg_temp.act('anon');
  select count(*) into v_count from public.public_club_fixtures where id = v_fixture;
  perform pg_temp.act_postgres();
  select count(*) into v_bool from information_schema.columns
  where table_schema = 'public' and table_name = 'public_club_fixtures'
    and column_name in ('home_score', 'away_score', 'notes', 'meet_time', 'changing_room', 'venue_id');
  if v_count = 1 and not v_bool then
    raise notice 'PASS G4: public fixtures remain public through the narrow projection, which carries no score, note, meet time or changing room';
  else
    raise notice 'FAIL G4: public fixture projection (rows %, forbidden columns present %)', v_count, v_bool;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    select home_score::text into v_text from public.fixtures where id = v_fixture;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS G5: friendly fixture scores and notes are not readable anonymously';
  else
    raise notice 'FAIL G5: anon reached the fixtures table (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    insert into public.club_articles (club_id, slug, title, body) values (v_club, 'anon-' || v_tag, 'Anon Story', 'x');
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS G6: anonymous callers cannot write club news';
  else
    raise notice 'FAIL G6: anon club news write (sqlstate %)', v_err;
  end if;
end $$;

rollback;
