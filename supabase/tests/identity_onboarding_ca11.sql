-- IDENTITY, PROFILE, SECURITY & ONBOARDING (CA-M11) -- THE PERSON'S JOURNEY, PROVED WHERE IT IS ENFORCED.
--
-- The phone's entrance, invitation, security and context surfaces consume server decisions and cannot
-- widen them. This suite proves the boundaries those surfaces depend on:
--
--   IO-A  preview: a link or a code says what it opens and who sent it -- never who was invited, never an
--         id; an unknown secret is an empty answer, not an error; no secret at all is refused
--   IO-B  wrong account: the invited address is compared to the confirmed session address; a mismatch is
--         one generic refusal that consumes nothing and grants nothing
--   IO-C  right account: acceptance lands the stored outcome, a second acceptance is idempotent, and the
--         stored token or code hash is never readable through the admin read model
--   IO-D  expired and revoked invitations are refused generically and consume nothing
--   IO-E  a team code never grants access: it creates a pending join request, decided by the club
--   IO-F  sign out other devices demands a recent second factor; with one, only the current session stays
--   IO-G  a security change is one of the named kinds; a native password change stamps the same column
--   IO-H  a person sees only their own sessions
--   IO-I  authority is never in user metadata: a self-declared role in raw_user_meta_data grants nothing
--   IO-J  redemption is rate-limited before any lookup: a burst of guesses refuses even the right token
--   IO-K  a person edits their own profile and nobody else's, and cannot touch their own account state
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date, p_meta jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'io-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, p_meta, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Io', p_label, 'io-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.session(p_user uuid, p_aal text default 'aal1', p_recent boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), p_aal::auth.aal_level);
  if p_recent then
    insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v, 'totp', now(), now());
  end if;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'io-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'io-' || v_tag, 'active') returning id into v_club;
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

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_team uuid;
  v_admin uuid; v_invited uuid; v_stranger uuid; v_minor uuid; v_meta uuid;
  v_admin_sess uuid; v_invited_sess uuid; v_stranger_sess uuid; v_stranger_sess2 uuid; v_meta_sess uuid;
  v_inv record; v_code record; v_expired record; v_revoked record;
  v_json jsonb; v_state text; v_n bigint; v_m bigint; v_text text; v_ts timestamptz;
  v_pw_before timestamptz;
begin
  -- =====================================================================================
  -- SEED. One club with a side; a Club Admin (recently verified); the invited person; a stranger.
  -- =====================================================================================
  v_club := pg_temp.club('Onboarding');
  v_team := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_admin := pg_temp.person('Admin');
  v_invited := pg_temp.person('Invited');
  v_stranger := pg_temp.person('Stranger');
  v_meta := pg_temp.person('Metadata', (current_date - interval '35 years')::date, jsonb_build_object('role', 'CLUB_ADMIN', 'club_id', v_club, 'isSiteAdmin', true));
  perform pg_temp.member(v_club, v_admin, 'CLUB_ADMIN');
  v_admin_sess := pg_temp.session(v_admin, 'aal2', true);
  v_invited_sess := pg_temp.session(v_invited, 'aal1', false);
  v_stranger_sess := pg_temp.session(v_stranger, 'aal1', false);
  v_meta_sess := pg_temp.session(v_meta, 'aal1', false);

  select email into v_text from auth.users where id = v_invited;
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, v_text, '{"roles":["VOLUNTEER"]}'::jsonb, null, null, null);
  select * into v_expired from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'io-expired-' || substr(v_club::text, 1, 8) || '@ovalball.test', '{"roles":["VOLUNTEER"]}'::jsonb, null, null, null);
  select * into v_revoked from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'io-revoked-' || substr(v_club::text, 1, 8) || '@ovalball.test', '{"roles":["VOLUNTEER"]}'::jsonb, null, null, null);
  select * into v_code from public.issue_invitation('TEAM_JOIN_CODE', null, v_team, null, null, null, null, '{}'::jsonb, null, null, null);
  perform public.revoke_invitation(v_revoked.invitation_id, 'CA-M11 suite: withdrawn');
  perform pg_temp.act_postgres();
  update public.access_invitations set expires_at = now() - interval '1 hour' where id = v_expired.invitation_id;
  perform pg_temp.check(v_inv.token is not null and v_code.code is not null and v_expired.token is not null, 'IO-0 seeded: a staff invitation, a team code, an expired and a revoked invitation');

  -- =====================================================================================
  -- IO-A. Preview: what it opens, who sent it -- never who it was for.
  -- =====================================================================================
  perform pg_temp.act('anon');
  select count(*) into v_n from public.preview_invitation(v_inv.token, null);
  select count(*) into v_m from public.preview_invitation('not-a-real-token-' || gen_random_uuid()::text, null);
  perform pg_temp.check(v_n = 1 and v_m = 0, format('IO-A1 an anonymous holder previews a real link (%s row) and an unknown one is an empty answer (%s rows)', v_n, v_m));
  select state into v_state from public.preview_invitation(v_inv.token, null);
  perform pg_temp.check(v_state = 'usable', format('IO-A2 the live invitation previews as usable (%s)', v_state));
  select state into v_state from public.preview_invitation(null, v_code.code);
  perform pg_temp.check(v_state = 'usable', format('IO-A3 a typed team code previews the same way (%s)', v_state));
  select pg_get_function_result(p.oid) into v_text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'preview_invitation';
  perform pg_temp.check(v_text !~* 'email|user_id|player|invited|intended', format('IO-A4 the preview shape carries no email, no user id, no player and no intended outcome (%s)', v_text));
  v_state := pg_temp.try('select * from public.preview_invitation(null, null)');
  perform pg_temp.check(v_state = '22023', format('IO-A5 no link and no code is refused, not guessed (%s)', v_state));
  select state into v_state from public.preview_invitation(v_expired.token, null);
  perform pg_temp.check(v_state = 'expired', format('IO-A6 an expired invitation previews as expired (%s)', v_state));
  select state into v_state from public.preview_invitation(v_revoked.token, null);
  perform pg_temp.check(v_state = 'revoked', format('IO-A7 a withdrawn invitation previews as revoked (%s)', v_state));

  -- =====================================================================================
  -- IO-B. Wrong account: generic refusal, nothing consumed, nothing granted.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  v_json := public.redeem_invitation(v_inv.token, null);
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED' and v_json->>'reason' is null and v_json->>'message' !~* '@', format('IO-B1 the wrong account is refused generically, with no reason and no address (%s)', v_json->>'outcome'));
  perform pg_temp.act_postgres();
  select state, use_count into v_state, v_n from public.access_invitations where id = v_inv.invitation_id;
  select count(*) into v_m from public.club_memberships where user_id = v_stranger and club_id = v_club;
  perform pg_temp.check(v_state = 'ISSUED' and v_n = 0 and v_m = 0, format('IO-B2 the invitation is still ISSUED and unspent (%s/%s), and the stranger holds nothing (%s)', v_state, v_n, v_m));

  -- =====================================================================================
  -- IO-C. Right account: the stored outcome lands; a second acceptance is idempotent; no secret readable.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_invited, v_invited_sess);
  v_json := public.redeem_invitation(v_inv.token, null);
  perform pg_temp.check(v_json->>'outcome' = 'MEMBERSHIP_ACTIVE', format('IO-C1 the invited person is in (%s)', v_json->>'outcome'));
  v_json := public.redeem_invitation(v_inv.token, null);
  perform pg_temp.check(v_json->>'outcome' = 'ALREADY_REDEEMED', format('IO-C2 accepting twice is idempotent (%s)', v_json->>'outcome'));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.club_memberships where user_id = v_invited and club_id = v_club and state = 'ACTIVE';
  select count(*) into v_m from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id where m.user_id = v_invited and ra.role_key = 'VOLUNTEER' and ra.state = 'ACTIVE';
  perform pg_temp.check(v_n = 1 and v_m = 1, format('IO-C3 one active membership and the stored VOLUNTEER role -- the ceiling the issuer set, not what the client asked (%s/%s)', v_n, v_m));
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invitations_admin_view' and column_name in ('token', 'token_sha256', 'code', 'code_hmac')), 'IO-C4 the admin read model carries no secret');
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_state := pg_temp.try('select token_sha256 from public.access_invitations limit 1');
  perform pg_temp.check(v_state <> 'OK', format('IO-C5 the hash columns are not selectable by a signed-in administrator (%s)', v_state));
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- IO-D. Expired and revoked: refused generically, consuming nothing.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  v_json := public.redeem_invitation(v_expired.token, null);
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED' and v_json->>'reason' is null, format('IO-D1 an expired invitation is refused generically (%s)', v_json->>'outcome'));
  v_json := public.redeem_invitation(v_revoked.token, null);
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED' and v_json->>'reason' is null, format('IO-D2 a withdrawn invitation is refused generically (%s)', v_json->>'outcome'));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.club_memberships where user_id = v_stranger;
  perform pg_temp.check(v_n = 0, format('IO-D3 neither refusal granted anything (%s)', v_n));

  -- =====================================================================================
  -- IO-E. A team code never grants access.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  v_json := public.redeem_invitation(null, v_code.code);
  perform pg_temp.check(v_json->>'outcome' = 'JOIN_REQUEST_PENDING', format('IO-E1 a team code produces a pending request (%s)', v_json->>'outcome'));
  select count(*) into v_n from public.my_capabilities('team', v_club, v_team) where allowed;
  perform pg_temp.act_postgres();
  select count(*) into v_m from public.club_join_requests where requesting_user_id = v_stranger and club_id = v_club and status = 'pending' and source_invitation_id = v_code.invitation_id;
  perform pg_temp.check(v_m = 1 and v_n = 0, format('IO-E2 one pending join request for the club to decide (%s), and no team capability yet (%s)', v_m, v_n));
  select count(*) into v_n from public.club_memberships where user_id = v_stranger and club_id = v_club and state = 'ACTIVE';
  perform pg_temp.check(v_n = 0, format('IO-E3 no membership was created by the code (%s)', v_n));

  -- =====================================================================================
  -- IO-F. Sign out other devices: a recent second factor, then only the current session stays.
  -- =====================================================================================
  v_stranger_sess2 := pg_temp.session(v_stranger, 'aal1', false);
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  v_state := pg_temp.try('select public.sign_out_my_other_devices()');
  perform pg_temp.check(v_state = '42501', format('IO-F1 without a recent second factor the operation is refused (%s)', v_state));
  perform pg_temp.act_postgres();
  select count(*) into v_n from auth.sessions where user_id = v_stranger;
  perform pg_temp.check(v_n = 2, format('IO-F2 both sessions survive the refusal (%s)', v_n));
  update auth.sessions set aal = 'aal2' where id = v_stranger_sess;
  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v_stranger_sess, 'totp', now(), now());
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  select public.sign_out_my_other_devices() into v_n;
  perform pg_temp.act_postgres();
  select count(*) into v_m from auth.sessions where user_id = v_stranger;
  perform pg_temp.check(v_n = 1 and v_m = 1 and exists (select 1 from auth.sessions where id = v_stranger_sess), format('IO-F3 with one, the other session goes (%s revoked) and this one stays (%s left)', v_n, v_m));

  -- =====================================================================================
  -- IO-G. A security change is one of the named kinds.
  -- =====================================================================================
  select password_set_at into v_pw_before from public.account_security_state where user_id = v_stranger;
  perform pg_temp.act('authenticated', v_stranger, v_stranger_sess);
  v_state := pg_temp.try('select public.record_my_security_change(''NONSENSE'')');
  perform pg_temp.check(v_state = '22023', format('IO-G1 an unknown change kind is refused (%s)', v_state));
  perform public.record_my_security_change('PASSWORD_SET');
  perform pg_temp.act_postgres();
  select password_set_at into v_ts from public.account_security_state where user_id = v_stranger;
  perform pg_temp.check(v_ts is not null and (v_pw_before is null or v_ts > v_pw_before), 'IO-G2 a native password change stamps the same column the website stamps');
  select count(*) into v_n from public.security_events where actor_user_id = v_stranger and event_type = 'password.set';
  perform pg_temp.check(v_n >= 1, format('IO-G3 and appears in the same security history (%s)', v_n));

  -- =====================================================================================
  -- IO-H. A person sees only their own sessions.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_invited, v_invited_sess);
  select count(*) into v_n from public.my_sessions();
  select count(*) into v_m from public.my_sessions() where is_current;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1 and v_m = 1, format('IO-H1 one session, and it is the current one (%s/%s) -- nobody else''s', v_n, v_m));

  -- =====================================================================================
  -- IO-I. Authority is never in user metadata.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_meta, v_meta_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed;
  select count(*) into v_m from public.my_capabilities('team', v_club, v_team) where allowed;
  v_state := pg_temp.try(format('select public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, ''io-meta@ovalball.test'', ''{"roles":["VOLUNTEER"]}''::jsonb, null, null, null)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0 and v_m = 0 and v_state = '42501', format('IO-I1 a self-declared CLUB_ADMIN in raw_user_meta_data holds nothing at the club (%s) or the team (%s) and cannot invite (%s)', v_n, v_m, v_state));
  perform pg_temp.check(not exists (select 1 from public.site_admins where user_id = v_meta), 'IO-I2 and "isSiteAdmin" in metadata makes nobody a site admin');

  -- =====================================================================================
  -- IO-J. Redemption is rate-limited before any lookup.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_meta, v_meta_sess);
  for v_n in 1..5 loop
    v_json := public.redeem_invitation('guess-' || gen_random_uuid()::text, null);
  end loop;
  v_json := public.redeem_invitation(v_inv.token, null);
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.security_events where actor_user_id = v_meta and event_type = 'invitation.attempts_throttled';
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED' and v_n >= 1, format('IO-J1 after a burst of guesses even a real link is refused (%s) and the throttle is recorded (%s)', v_json->>'outcome', v_n));

  -- =====================================================================================
  -- IO-K. Profile: own row only; never the account state.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_invited, v_invited_sess);
  update public.profiles set phone_number = '07700 900000' where id = v_invited;
  get diagnostics v_n = row_count;
  update public.profiles set phone_number = '07700 900001' where id = v_stranger;
  get diagnostics v_m = row_count;
  v_state := pg_temp.try(format('update public.profiles set account_state = ''SUSPENDED'' where id = %L', v_invited));
  v_text := pg_temp.try(format('update public.profiles set date_of_birth = current_date - interval ''50 years'' where id = %L', v_invited));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1 and v_m = 0, format('IO-K1 a person updates their own profile (%s) and nobody else''s (%s)', v_n, v_m));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('IO-K2 the account state (%s) and the date of birth (%s) are not the person''s to change', v_state, v_text));
end $$;

rollback;
