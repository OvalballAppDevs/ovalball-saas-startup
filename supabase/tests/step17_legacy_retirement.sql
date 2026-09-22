-- CONVERGENCE STEP 17 — IDENTITY/AUTH SLICE 10, THE PART THAT IS DUE.
--
-- Slice 10 is LEGACY RETIREMENT. Its acceptance is "zero references in CI; full runner, clean boot and
-- all browser suites green; production usage telemetry zero for 30 days before each drop", and measured
-- against that NO DROP IS DUE -- every compatibility target still has references, and two of the three
-- preconditions cannot be met in a sprint at all.
--
-- So what this proves is the part that IS due, and that nothing was broken to get it:
--
--   A. NO BROWSER ROLE CAN REACH A PLAINTEXT LEGACY INVITATION SECRET -- by read or by write.
--   B. The legacy `invitations` table is no longer writable from a browser, and its scoping survives.
--   C. The partner-invitation readers keep every column they need, and not the secret.
--   D. NOTHING WAS DROPPED. Every compatibility bridge still stands.
--   E. A LIVE legacy invitation keeps its token; a terminal one loses it (Phase 2 O.5).
--   F. The canonical invitation system is untouched and still hashes.
--   G. The capability engine, the context model and the organisation-scope refusal are untouched.
--
-- Self-seeding and rolled back. No persistent review identity is touched, and the one live legacy
-- guardian invitation -- which belongs to a real person -- is read but never written.
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
  v_club_admin uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_ref uuid; v_inv uuid; v_token text;
  v_n int; v_state text; v_txt text; v_bool boolean;
begin
  foreach v_person in array array[v_club_admin, v_site] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's17-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Seventeen', 's17-' || v_person::text || '@ovalball.test', (current_date - interval '45 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role, profile_key) values (v_site, 'active', 'full', 'SITE_FULL');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S17 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's17-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's17-' || v_tag, 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');

  -- =====================================================================
  -- A. NO BROWSER ROLE REACHES A PLAINTEXT LEGACY INVITATION SECRET
  -- =====================================================================
  perform pg_temp.act_postgres();
  select string_agg(table_name || '.' || column_name || ' ' || privilege_type || '->' || grantee, ', ')
    into v_txt from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and column_name ~ 'token|secret' and column_name !~ 'token_sha256|code_hmac|code_hint';
  perform pg_temp.check(v_txt is null,
    format('A1 no browser role holds any privilege on a plaintext invitation secret column (%s)', coalesce(v_txt, 'none')));

  -- Asserted table by table as well, because "none at all" is the claim being made.
  foreach v_txt in array array['invitations', 'guardian_invitations', 'player_account_invitations',
                               'site_admin_invitations', 'club_safeguarding_officer_invitations',
                               'club_ovalball_invitations'] loop
    select count(*) into v_n from information_schema.column_privileges
     where table_schema = 'public' and table_name = v_txt and column_name = 'token'
       and grantee in ('anon', 'authenticated');
    perform pg_temp.check(v_n = 0, format('A2 %s.token is unreachable from a browser (%s grant(s))', v_txt, v_n));
  end loop;

  -- =====================================================================
  -- B. THE LEGACY INVITATIONS TABLE IS NOT WRITABLE FROM A BROWSER
  -- =====================================================================
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format(
    'insert into public.invitations (club_id, invited_email, created_by) values (%L, %L, %L)',
    v_club, 's17-legacy-' || v_tag || '@ovalball.test', v_club_admin)) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('B1 a Club Admin holding people.invitation.create cannot write a legacy invitation (%s)', v_state));
  select pg_temp.try('update public.invitations set status = ''revoked''') into v_state;
  perform pg_temp.check(v_state = '42501', format('B2 nor update one (%s)', v_state));

  perform pg_temp.act('authenticated', v_site);
  select pg_temp.try(format(
    'insert into public.invitations (club_id, invited_email, created_by) values (%L, %L, %L)',
    v_club, 's17-legacy-site-' || v_tag || '@ovalball.test', v_site)) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('B3 and neither can a Full Site Admin -- the grant is gone, not merely the policy (%s)', v_state));

  -- THE SCOPING RULE SURVIVES. The policies are unreachable, not deleted: a grant is checked before RLS,
  -- and throwing the club-scoping away would leave nothing to restore if this table were ever made
  -- writable again for a migration.
  perform pg_temp.act_postgres();
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'invitations' and cmd in ('INSERT', 'UPDATE');
  perform pg_temp.check(v_n = 2, format('B4 the club-scoped INSERT and UPDATE policies are retained, not dropped (%s)', v_n));

  -- =====================================================================
  -- C. THE PARTNER-INVITATION READERS KEEP WHAT THEY NEED
  -- =====================================================================
  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (v_club, v_dir, 'S17 Contact', 's17-partner-' || v_tag || '@ovalball.test', v_club_admin)
  returning id into v_ref;

  perform pg_temp.act('authenticated', v_site);
  select pg_temp.try(format('select id, contact_email, inviting_club_id from public.club_ovalball_invitations where id = %L', v_ref)) into v_state;
  perform pg_temp.check(v_state = 'OK',
    format('C1 the columns the two live readers ask for are still readable (%s)', v_state));
  select pg_temp.try(format('select token from public.club_ovalball_invitations where id = %L', v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('C2 and the secret beside them is not -- this was the last client-readable legacy token (%s)', v_state));
  select pg_temp.try(format('select * from public.club_ovalball_invitations where id = %L', v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('C3 including through select * , which is how a column grant differs from a policy (%s)', v_state));

  -- =====================================================================
  -- D. NOTHING WAS DROPPED
  --
  -- Slice 10's acceptance is unmet for every drop target, and the release bridge must survive.
  -- =====================================================================
  perform pg_temp.act_postgres();
  foreach v_txt in array array['accept_invitation', 'get_invitation_preview', 'accept_guardian_invitation',
                               'get_guardian_invitation_preview', 'accept_player_account_invitation',
                               'get_player_account_invitation_preview', 'accept_site_admin_invitation',
                               'invite_player_account', 'send_replacement_guardian_invitation',
                               'link_guardian_to_existing_player', 'create_player_for_guardian'] loop
    perform pg_temp.check(
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = v_txt),
      format('D1 %s survives -- no drop is due, and the release bridge needs it', v_txt));
  end loop;
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name in
     ('invitations','invitation_teams','guardian_invitations','player_account_invitations',
      'site_admin_invitations','club_ovalball_invitations','club_safeguarding_officer_invitations');
  perform pg_temp.check(v_n = 7, format('D2 all seven legacy invitation tables survive (%s)', v_n));
  perform pg_temp.check(
    exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'team_permissions'),
    'D3 and so does the team_permissions compatibility view');

  -- =====================================================================
  -- E. A LIVE LEGACY INVITATION KEEPS ITS TOKEN; A TERMINAL ONE LOSES IT
  --
  -- Phase 2 O.5. This is why the one real pending guardian invitation was left exactly as it is: a person
  -- is holding that link, and clearing it would invalidate something legitimate.
  -- =====================================================================
  insert into public.invitations (club_id, invited_email, club_role, token, created_by, expires_at, status)
  values (v_club, 's17-live-' || v_tag || '@ovalball.test', 'FIXTURE_SECRETARY', 'legacy-live-' || v_tag,
          v_club_admin, now() + interval '3 days', 'pending')
  returning id into v_inv;
  perform internal.null_legacy_invitation_tokens();
  select token is not null into v_bool from public.invitations where id = v_inv;
  perform pg_temp.check(v_bool, 'E1 a LIVE pending legacy invitation keeps its token -- somebody is holding that link');
  update public.invitations set status = 'revoked' where id = v_inv;
  perform internal.null_legacy_invitation_tokens();
  select token is null into v_bool from public.invitations where id = v_inv;
  perform pg_temp.check(v_bool, 'E2 and the moment it becomes terminal the secret goes');

  -- =====================================================================
  -- F. THE CANONICAL SYSTEM IS UNTOUCHED, AND STILL HASHES
  -- =====================================================================
  perform pg_temp.act('authenticated', v_site);
  select invitation_id, token into v_inv, v_token from public.issue_invitation(
    p_kind => 'SITE_ADMIN', p_email => 's17-canonical-' || v_tag || '@ovalball.test',
    p_intended_outcome => jsonb_build_object('admin_role', 'read_only'));
  perform pg_temp.check(v_inv is not null and v_token is not null, 'F1 the canonical issuer still issues');
  perform pg_temp.act_postgres();
  select (token_sha256 = internal.invitation_token_hash(v_token)) into v_bool
    from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_bool, 'F2 storing only the hash, never the secret');
  select count(*) into v_n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'access_invitations'
     and column_name in ('token_sha256', 'code_hmac') and grantee in ('anon', 'authenticated');
  perform pg_temp.check(v_n = 0, format('F3 and no browser role reaches even the hash (%s)', v_n));

  -- =====================================================================
  -- G. THE BOUNDARIES SLICE 10 DOES NOT OWN
  -- =====================================================================
  perform pg_temp.check(
    (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'SCOPE_NOT_IMPLEMENTED',
    'G1 the organisation capability scope is still refused -- Slice 10 does not own implementing it');
  perform pg_temp.check(
    (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') !~ 'p_organisation|p_body',
    'G2 and capability_decision grew no organisation parameter');
  -- The context model, including Step 16's governing body, is untouched.
  perform pg_temp.check(
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'constituent_body_roles'),
    'G3 the governing body context added at Step 16 survives Slice 10');
  perform pg_temp.check(
    exists (select 1 from internal.invitation_kind_spec('GOVERNING_BODY_OFFICER')),
    'G4 and so does its canonical invitation kind');
  -- No second anything: this is a retirement slice.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ 'issue_invitation|redeem_invitation';
  perform pg_temp.check(v_n = 2, format('G5 there is still exactly one issuer and one redeemer (%s)', v_n));
end $$;

rollback;
