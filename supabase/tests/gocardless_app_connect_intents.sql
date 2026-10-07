-- A CLUB CONNECTS GOCARDLESS FROM THE APP (20270750000000) -- the rules the connect intent holds, in the
-- database, without the routes in front of it.
--
--   A. START     only a live session holding finance.gocardless.connect at a club that has agreed the Club
--                Memberships terms; only a return address in the Ovalball app; the begin token is returned
--                once and kept only as its hash
--   B. BEGIN     server-only; single use; three minutes; the address is recorded as a diagnostic and never
--                refused (iCloud Private Relay and IPv4/IPv6 splits made it refuse real people)
--   C. CALLBACK  server-only; a code attaches once, only to a begun, open intent, and mints a one-time return
--                handoff kept only as its hash; a refusal closes the intent
--   D. CLAIM     the person who started it, holding the handoff, once, within five minutes; no handoff waits
--                and changes nothing; a wrong one, or anybody else, voids it; a dead session changes nothing.
--                The forwarded-link attack, end to end: the sender can never claim.
--   E. FINISH    own, claimed intents only, once
--   F. STORAGE   no API role reads or writes the intents; a dead code is not kept
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_app_connect_intents.sql
--
-- Self-contained and rolled back; the last block checks that nothing the run made survived. No GoCardless
-- call is made.

\set ON_ERROR_STOP off
\pset pager off

-- The run's tag, held by the session so the check after the rollback can look for it.
select set_config('gcapp.tag', substr(md5(random()::text || clock_timestamp()::text), 1, 8), false) is not null as tagged;

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ids (k text primary key, v text) on commit drop;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $$ insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.id(p_k text) returns text language sql as $$ select v from ids where k = p_k $$;

create or replace function pg_temp.person(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v, 'Gca', 'Person', p_email, date '1981-02-03')
  on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  return v;
end $$;

-- As somebody, the way the API calls a function: their claims, then their role, then back. A session id that
-- names no session is how a signed-out (or suspended, or revoked) person's still-valid token looks.
create or replace function pg_temp.claims(p_role text, p_sub uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', p_role, 'session_id', p_session))::text, true);
end $$;

create or replace function pg_temp.val_as(p_role text, p_sub uuid, p_sql text, p_session uuid default null) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(p_role, p_sub, p_session);
  execute 'set local role ' || quote_ident(p_role);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

create or replace function pg_temp.state_as(p_role text, p_sub uuid, p_sql text, p_session uuid default null) returns text language plpgsql as $$
declare v_state text;
begin
  perform pg_temp.claims(p_role, p_sub, p_session);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

-- The refusal itself: 'SQLSTATE|hint|message'.
create or replace function pg_temp.refusal_as(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_hint text; v_msg text;
begin
  perform pg_temp.claims(p_role, p_sub, null);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_state || '|' || coalesce(v_hint, '') || '|' || coalesce(v_msg, '');
end $$;

-- Start as somebody; answers 'intent|token'.
create or replace function pg_temp.start(p_user uuid, p_club uuid, p_return text, p_ip text) returns text language plpgsql as $$
begin
  return pg_temp.val_as('authenticated', p_user, format(
    $q$select s.intent_id || '|' || s.begin_token from public.start_gocardless_connect_intent(%L::uuid, %L, %L) s$q$, p_club, p_return, p_ip));
end $$;

create or replace function pg_temp.consume(p_token text, p_ip text) returns text language plpgsql as $$
begin
  return pg_temp.val_as('service_role', null, format(
    $q$select c.outcome || '|' || coalesce(c.state, '') || '|' || coalesce(c.club_id::text, '') from public.consume_gocardless_connect_begin(%L, %L) c$q$, p_token, p_ip));
end $$;

-- Attach; answers 'outcome|intent|return_url|handoff'.
create or replace function pg_temp.attach(p_state text, p_code text) returns text language plpgsql as $$
begin
  return coalesce(pg_temp.val_as('service_role', null, format(
    $q$select a.outcome || '|' || coalesce(a.intent_id::text, '') || '|' || coalesce(a.return_url, '') || '|' || coalesce(a.handoff, '') from public.attach_gocardless_connect_code(%L, %L) a$q$, p_state, p_code)), '');
end $$;

-- Claim; answers 'outcome|code|club|reason'.
create or replace function pg_temp.claim(p_user uuid, p_intent uuid, p_handoff text default null, p_session uuid default null) returns text language plpgsql as $$
begin
  return pg_temp.val_as('authenticated', p_user, format(
    $q$select c.outcome || '|' || coalesce(c.code, '') || '|' || coalesce(c.club_id::text, '') || '|' || coalesce(c.reason, '') from public.claim_gocardless_connect_code(%L::uuid, %L) c$q$, p_intent, p_handoff), p_session);
end $$;

create or replace function pg_temp.intent(p_id uuid) returns internal.gocardless_connect_intents language sql as $$
  select * from internal.gocardless_connect_intents where id = p_id
$$;

-- An intent all the way to GoCardless's answer: started, begun from the starting address, code attached.
-- Answers 'intent|handoff'.
create or replace function pg_temp.returned(p_user uuid, p_club uuid, p_return text, p_code text) returns text language plpgsql as $$
declare v text; v_intent uuid; v_state text; v_attached text;
begin
  v := pg_temp.start(p_user, p_club, p_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid;
  perform pg_temp.consume(split_part(v, '|', 2), '203.0.113.10');
  v_state := (pg_temp.intent(v_intent)).state;
  v_attached := pg_temp.attach(v_state, p_code);
  return v_intent || '|' || split_part(v_attached, '|', 4);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- The world: a club and its admin (terms agreed), a club the admin runs that has not agreed the terms, a
-- second club the admin does not run, and an outsider.
-- -----------------------------------------------------------------------------------------------------
do $$
declare v_tag text := current_setting('gcapp.tag'); v_dir uuid; v_club uuid; v_dir2 uuid; v_club2 uuid; v_dir3 uuid; v_club3 uuid; v_ca uuid; v_out uuid;
begin
  insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('GCA Club ' || v_tag, 'union', 'England', 'England', 'manual', 'gcapp-club-' || v_tag, 'verified') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'gcapp-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('GCA Other ' || v_tag, 'union', 'England', 'England', 'manual', 'gcapp-other-' || v_tag, 'verified') returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'gcapp-o-' || v_tag, 'active') returning id into v_club2;
  insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('GCA Unagreed ' || v_tag, 'union', 'England', 'England', 'manual', 'gcapp-terms-' || v_tag, 'verified') returning id into v_dir3;
  insert into public.clubs (directory_id, slug, status) values (v_dir3, 'gcapp-t-' || v_tag, 'active') returning id into v_club3;

  v_ca := pg_temp.person('gcapp.ca.' || v_tag || '@ovalball.test');
  v_out := pg_temp.person('gcapp.outsider.' || v_tag || '@ovalball.test');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_ca, 'CLUB_ADMIN', 'active'), (v_club3, v_ca, 'CLUB_ADMIN', 'active');
  -- The terms, agreed the way the product agrees them: by the admin, to the version shown.
  perform pg_temp.val_as('authenticated', v_ca, format($q$select public.accept_club_membership_terms(%L::uuid, %L)::text$q$, v_club, internal.club_membership_terms_version()));

  perform pg_temp.put('tag', v_tag);
  perform pg_temp.put('club', v_club::text); perform pg_temp.put('club2', v_club2::text); perform pg_temp.put('club3', v_club3::text);
  perform pg_temp.put('ca', v_ca::text); perform pg_temp.put('out', v_out::text);
  perform pg_temp.put('return', 'ovalball-dev://admin/subscriptions/' || v_tag);
end $$;

-- =========================================================================================================
-- A. START
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_return text := pg_temp.id('return');
  v text; v_intent uuid; v_token text; i internal.gocardless_connect_intents; v_ok int := 0; v_url text; v_refused int := 0;
begin
  v := pg_temp.start(v_ca, v_club, v_return, '::ffff:203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  i := pg_temp.intent(v_intent);
  perform pg_temp.put('a_intent', v_intent::text); perform pg_temp.put('a_token', v_token); perform pg_temp.put('a_state', i.state);

  perform pg_temp.check(i.club_id = v_club and i.user_id = v_ca and i.return_url = v_return and i.state ~ '^[0-9a-f]{48}$'
      and i.begin_expires_at = now() + interval '3 minutes' and i.begin_used_at is null and i.code is null and i.requester_ip = '203.0.113.10'
      and i.return_handoff_hash is null and i.begin_same_address is null,
    'AC1 a Club Admin starts a connection: the intent is for their club and them, with a fresh state, three minutes to begin, and their address in one spelling');
  perform pg_temp.check(v_token ~ '^[A-Za-z0-9_-]{43}$' and i.begin_token_hash = extensions.digest(v_token, 'sha256')
      and position(v_token in row_to_json(i)::text) = 0,
    'AC2 the begin token is 256 bits, returned once, and kept only as its SHA-256');

  foreach v_url in array array['ovalball://admin/subscriptions', 'ovalball-dev://admin/subscriptions', 'ovalball-staging://admin/subscriptions',
                                'exp://192.168.1.5:8081/--/admin/subscriptions', 'exps://u.expo.dev/--/admin/subscriptions', 'OVALBALL://admin/subscriptions/setup'] loop
    if pg_temp.state_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, v_club, v_url)) = 'OK' then
      v_ok := v_ok + 1;
    end if;
  end loop;
  perform pg_temp.check(v_ok = 6, 'AC3 every Ovalball app scheme, and Expo Go''s, is a return address, on any path (' || v_ok || ' of 6)');

  foreach v_url in array array['https://evil.example/steal', 'http://localhost:3000/club', 'javascript://alert(1)', 'data://text/html,x',
                                'mailto://a@b.c', '/admin/subscriptions', '', 'ovalball-dev://admin/sub scriptions', 'ovalball-dev://admin/subscriptions#x',
                                'ovalball-dev://admin/' || repeat('a', 520), 'ovalball-devx://admin', 'ovalball-dev:admin/subscriptions'] loop
    if pg_temp.refusal_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, v_club, v_url))
         = '22023|return_address|That return address is not one the Ovalball app uses.' then
      v_refused := v_refused + 1;
    end if;
  end loop;
  perform pg_temp.check(v_refused = 12, 'AC4 a website, a bare path, a near-miss scheme, whitespace, a fragment and an over-long address are all refused, and say so (' || v_refused || ' of 12)');

  perform pg_temp.check(
    pg_temp.state_as('authenticated', pg_temp.id('out')::uuid, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, v_club, v_return)) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, pg_temp.id('club2'), v_return)) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(null, %L, null)$q$, v_return)) = '42501',
    'AC5 somebody without the permission, the admin at a club they do not run, and no club at all are refused');
  perform pg_temp.check(
    pg_temp.state_as('anon', null, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, v_club, v_return)) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, v_club, v_return), gen_random_uuid()) = '42501',
    'AC6 nobody signed out, and no dead session (a token whose session is gone), can start one');
  perform pg_temp.check(
    (select count(*) from internal.gocardless_connect_intents where user_id = pg_temp.id('out')::uuid or club_id = pg_temp.id('club2')::uuid) = 0,
    'AC7 a refused start leaves no intent behind');

  -- TERMS FIRST.
  perform pg_temp.check(
    pg_temp.refusal_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, pg_temp.id('club3'), v_return))
      = '22023|membership_terms|Agree to Ovalball''s terms for Club Memberships before connecting GoCardless.'
    and (select count(*) from internal.gocardless_connect_intents where club_id = pg_temp.id('club3')::uuid) = 0,
    'AC8 the admin of a club that has not agreed the Club Memberships terms is refused, told why, and no intent exists');
  perform pg_temp.val_as('authenticated', v_ca, format($q$select public.accept_club_membership_terms(%L::uuid, %L)::text$q$, pg_temp.id('club3'), internal.club_membership_terms_version()));
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select * from public.start_gocardless_connect_intent(%L::uuid, %L, null)$q$, pg_temp.id('club3'), v_return)) = 'OK',
    'AC9 once the club agrees the terms, its admin can start');
end $$;

-- =========================================================================================================
-- B. BEGIN
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_return text := pg_temp.id('return');
  v text; v2 text; v_intent uuid; v_token text; i internal.gocardless_connect_intents;
begin
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select * from public.consume_gocardless_connect_begin(%L, '203.0.113.10')$q$, pg_temp.id('a_token'))) = '42501'
    and pg_temp.state_as('anon', null, format($q$select * from public.consume_gocardless_connect_begin(%L, '203.0.113.10')$q$, pg_temp.id('a_token'))) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select * from public.attach_gocardless_connect_code(%L, 'c')$q$, pg_temp.id('a_state'))) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select * from public.fail_gocardless_connect_intent(%L, 'x')$q$, pg_temp.id('a_state'))) = '42501'
    and pg_temp.state_as('anon', null, format($q$select * from public.fail_gocardless_connect_intent(%L, 'x')$q$, pg_temp.id('a_state'))) = '42501',
    'AB1 no browser role can present a begin token, attach a code or close an intent: those are the server''s');
  perform pg_temp.check((pg_temp.intent(pg_temp.id('a_intent')::uuid)).begin_used_at is null,
    'AB2 and those refused attempts did not spend the token');

  v := pg_temp.consume(pg_temp.id('a_token'), '203.0.113.10');
  i := pg_temp.intent(pg_temp.id('a_intent')::uuid);
  perform pg_temp.check(v = 'ok|' || pg_temp.id('a_state') || '|' || v_club and i.begin_used_at is not null and i.failed_at is null and i.begin_same_address,
    'AB3 the token opens the intent: its state and club, it is spent, and the begin is recorded as from the starting address (in another spelling)');
  v := pg_temp.consume(pg_temp.id('a_token'), '203.0.113.10');
  i := pg_temp.intent(pg_temp.id('a_intent')::uuid);
  perform pg_temp.check(v = 'used||' and i.failed_at is null,
    'AB4 a second presentation learns nothing, and does not disturb the journey the first one began');

  -- Expired.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  update internal.gocardless_connect_intents set begin_expires_at = now() - interval '1 second' where id = v_intent;
  v := pg_temp.consume(v_token, '203.0.113.10');
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'expired||' and i.failed_at is not null and i.failure_reason = 'begin_expired' and i.begin_used_at is not null,
    'AB5 a token past its three minutes opens nothing, and its intent is closed');

  -- Another address: Safari behind iCloud Private Relay, or the other IP family. It begins; it is noted.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  v := pg_temp.consume(v_token, '198.51.100.7');
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'ok|' || i.state || '|' || v_club and i.failed_at is null and i.begin_same_address = false,
    'AB6 a token presented from another address opens the intent all the same, and the difference is recorded, not refused');

  -- A begin request that carried no address.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  v := pg_temp.consume(v_token, null);
  perform pg_temp.check(v like 'ok|%' and (pg_temp.intent(v_intent)).begin_same_address is null,
    'AB7 a begin request with no address begins, and whether it matched is unknown rather than guessed');

  -- The same address however it is spelt; a neighbour is a different address.
  v := pg_temp.start(v_ca, v_club, v_return, '2001:db8::1');
  v_intent := split_part(v, '|', 1)::uuid;
  v2 := pg_temp.consume(split_part(v, '|', 2), '[2001:0db8:0::1]:443');
  perform pg_temp.check(v2 like 'ok|%' and (pg_temp.intent(v_intent)).begin_same_address,
    'AB8 the same IPv6 address, bracketed with a port and spelt longer, is recorded as the same');
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid;
  v2 := pg_temp.consume(split_part(v, '|', 2), '203.0.113.11');
  perform pg_temp.check(v2 like 'ok|%' and (pg_temp.intent(v_intent)).begin_same_address = false,
    'AB9 the neighbouring address is recorded as a different one, and still begins');

  -- Started with no address known.
  v := pg_temp.start(v_ca, v_club, v_return, null);
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  perform pg_temp.check((pg_temp.intent(v_intent)).requester_ip is null and pg_temp.consume(v_token, '198.51.100.99') like 'ok|%'
      and (pg_temp.intent(v_intent)).begin_same_address is null,
    'AB10 an intent whose start carried no address begins from anywhere, recorded as unknown');

  perform pg_temp.check(pg_temp.consume('x' || pg_temp.id('a_token'), '203.0.113.10') = 'not_found||'
      and pg_temp.consume('not a token', '203.0.113.10') = 'not_found||' and pg_temp.consume(null, null) = 'not_found||',
    'AB11 an unknown or malformed token finds nothing');
end $$;

-- =========================================================================================================
-- C. CALLBACK
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_return text := pg_temp.id('return');
  v text; v_intent uuid; v_token text; v_state text; v_handoff text; i internal.gocardless_connect_intents;
begin
  v := pg_temp.attach(pg_temp.id('a_state'), 'code-one');
  v_handoff := split_part(v, '|', 4);
  i := pg_temp.intent(pg_temp.id('a_intent')::uuid);
  perform pg_temp.put('a_handoff', v_handoff);
  perform pg_temp.check(split_part(v, '|', 1) = 'attached' and split_part(v, '|', 2) = pg_temp.id('a_intent') and split_part(v, '|', 3) = v_return
      and i.code = 'code-one' and i.code_received_at = now(),
    'AT1 GoCardless''s code attaches to the begun intent the state names, which answers with its id and return address -- never the code');
  perform pg_temp.check(v_handoff ~ '^[A-Za-z0-9_-]{43}$' and i.return_handoff_hash = extensions.digest(v_handoff, 'sha256')
      and position(v_handoff in row_to_json(i)::text) = 0,
    'AT2 and with a one-time return handoff for the browser: 256 bits, kept only as its SHA-256');
  v := pg_temp.attach(pg_temp.id('a_state'), 'code-two');
  i := pg_temp.intent(pg_temp.id('a_intent')::uuid);
  perform pg_temp.check(v like 'closed|%' and split_part(v, '|', 4) = '' and i.code = 'code-one' and i.return_handoff_hash = extensions.digest(v_handoff, 'sha256'),
    'AT3 a second code for the same state is refused, mints no handoff, and the first code and handoff are untouched');

  -- Not begun yet.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_state := (pg_temp.intent(v_intent)).state;
  v := pg_temp.attach(v_state, 'code-early');
  perform pg_temp.check(v like 'closed|%' and (pg_temp.intent(v_intent)).code is null and (pg_temp.intent(v_intent)).return_handoff_hash is null,
    'AT4 a code for an intent whose link was never opened is refused');

  perform pg_temp.check(pg_temp.attach(repeat('0', 48), 'c') = 'not_found|||' and pg_temp.attach('nonsense', 'c') = 'not_found|||',
    'AT5 an unknown state finds nothing');

  -- A refusal from GoCardless closes the intent; then nothing can attach to it.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2); v_state := (pg_temp.intent(v_intent)).state;
  perform pg_temp.consume(v_token, '203.0.113.10');
  v := pg_temp.val_as('service_role', null, format($q$select f.intent_id || '|' || f.return_url from public.fail_gocardless_connect_intent(%L, 'drop table x;') f$q$, v_state));
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = v_intent || '|' || v_return and i.failed_at is not null and i.failure_reason = 'provider_error',
    'AT6 a refusal closes the intent and answers where to send the browser; a reason that is not a plain token is not stored');
  perform pg_temp.check(pg_temp.attach(v_state, 'late-code') like 'closed|%' and (pg_temp.intent(v_intent)).code is null,
    'AT7 nothing attaches to a closed intent');
  perform pg_temp.check(pg_temp.attach(v_state, '') like 'closed|%',
    'AT8 an empty code is never stored');

  -- Long after the browser began: the cookie is gone, and so is the intent.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2); v_state := (pg_temp.intent(v_intent)).state;
  perform pg_temp.consume(v_token, '203.0.113.10');
  update internal.gocardless_connect_intents set begin_used_at = now() - interval '21 minutes' where id = v_intent;
  perform pg_temp.check(pg_temp.attach(v_state, 'very-late') like 'closed|%' and (pg_temp.intent(v_intent)).failure_reason = 'returned_too_late',
    'AT9 a code arriving twenty minutes after the link was opened is refused, and closes the intent');
end $$;

-- =========================================================================================================
-- D. CLAIM
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_out uuid := pg_temp.id('out'); v_return text := pg_temp.id('return');
  v text; v_intent uuid; v_handoff text; v_token text; v_state text; v_before text; i internal.gocardless_connect_intents;
begin
  v_intent := pg_temp.id('a_intent')::uuid; v_handoff := pg_temp.id('a_handoff');

  -- A dead session changes nothing.
  v_before := row_to_json(pg_temp.intent(v_intent))::text;
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select * from public.claim_gocardless_connect_code(%L::uuid, %L)$q$, v_intent, v_handoff), gen_random_uuid()) = '42501'
    and row_to_json(pg_temp.intent(v_intent))::text = v_before,
    'AK1 a dead session cannot claim, and its refusal leaves the intent exactly as it was');
  perform pg_temp.check(
    pg_temp.state_as('anon', null, format($q$select * from public.claim_gocardless_connect_code(%L::uuid, %L)$q$, v_intent, v_handoff)) = '42501',
    'AK2 nobody signed out can claim');

  -- No handoff: wait, and change nothing.
  perform pg_temp.check(pg_temp.claim(v_ca, v_intent) = 'awaiting_return|||awaiting_return'
      and pg_temp.claim(v_ca, v_intent, '') = 'awaiting_return|||awaiting_return'
      and row_to_json(pg_temp.intent(v_intent))::text = v_before,
    'AK3 the person who started it, without the handoff, is told the return has not reached them -- and nothing at all changes');

  -- With it: the code and the club, once.
  v := pg_temp.claim(v_ca, v_intent, v_handoff);
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'claimed|code-one|' || v_club || '|' and i.code is null and i.return_handoff_hash is null and i.claimed_at is not null,
    'AK4 with the handoff the return carried, they claim GoCardless''s code and the club, and both secrets are erased from the intent');
  perform pg_temp.check(pg_temp.claim(v_ca, v_intent, v_handoff) = 'closed|||claimed' and pg_temp.claim(v_ca, v_intent) = 'closed|||claimed',
    'AK5 it cannot be claimed twice, handoff or not');

  -- A wrong handoff voids it.
  v := pg_temp.returned(v_ca, v_club, v_return, 'code-wrong');
  v_intent := split_part(v, '|', 1)::uuid; v_handoff := split_part(v, '|', 2);
  v := pg_temp.claim(v_ca, v_intent, rpad('A', 43, 'A'));
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'closed|||handoff_mismatch' and i.failed_at is not null and i.failure_reason = 'handoff_mismatch'
      and i.code is null and i.return_handoff_hash is null,
    'AK6 a wrong handoff voids the intent and erases the code -- nothing is handed over');
  perform pg_temp.check(pg_temp.claim(v_ca, v_intent, v_handoff) = 'closed|||handoff_mismatch',
    'AK7 and the right handoff, presented afterwards, finds the intent closed');

  -- Somebody else: refused, and the intent is void for everybody -- even holding the right handoff.
  v := pg_temp.returned(v_ca, v_club, v_return, 'code-stolen');
  v_intent := split_part(v, '|', 1)::uuid; v_handoff := split_part(v, '|', 2);
  v := pg_temp.claim(v_out, v_intent, v_handoff);
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'refused|||' and i.failed_at is not null and i.failure_reason = 'claimed_by_another_account' and i.code is null,
    'AK8 a different signed-in person is refused even with the handoff, is given nothing, and the intent is voided with its code erased');
  perform pg_temp.check(pg_temp.claim(v_ca, v_intent, v_handoff) = 'closed|||claimed_by_another_account',
    'AK9 so the person who started it cannot finish it either, and is told why');
  perform pg_temp.check(pg_temp.claim(v_out, gen_random_uuid()) = 'refused|||',
    'AK10 an id that names no intent gets exactly the same answer as somebody else''s');

  -- Past GoCardless's five minutes.
  v := pg_temp.returned(v_ca, v_club, v_return, 'code-stale');
  v_intent := split_part(v, '|', 1)::uuid; v_handoff := split_part(v, '|', 2);
  update internal.gocardless_connect_intents set code_received_at = now() - interval '5 minutes 1 second' where id = v_intent;
  v := pg_temp.claim(v_ca, v_intent, v_handoff);
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v = 'expired|||code_expired' and i.code is null and i.return_handoff_hash is null and i.failure_reason = 'code_expired',
    'AK11 a code older than five minutes is not handed over, handoff or not; it is erased and the intent closed');

  -- Begun, never returned: the person closed the browser.
  v := pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  perform pg_temp.consume(v_token, '203.0.113.10');
  v := pg_temp.claim(v_ca, v_intent);
  perform pg_temp.check(v = 'not_returned|||not_returned' and (pg_temp.intent(v_intent)).failure_reason = 'not_returned'
      and pg_temp.attach((pg_temp.intent(v_intent)).state, 'too-late') like 'closed|%',
    'AK12 an intent GoCardless never returned to is closed when the app asks, and no code can arrive after');
end $$;

-- =========================================================================================================
-- D2. THE FORWARDED LINK, END TO END
--
-- A Club Admin starts a connection, keeps the begin link and forwards it to another organisation's
-- GoCardless admin. Their browser -- another network -- begins, and their consent sends GoCardless's answer
-- back to THEIR browser, with the handoff. The sender holds everything else: their own session, the
-- intent id, all the time GoCardless allows.
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_sender uuid := pg_temp.id('ca'); v_return text := pg_temp.id('return');
  v text; v_intent uuid; v_token text; v_state text; v_victims_handoff text; v_guesses int := 0; v_claims text := ''; i internal.gocardless_connect_intents;
begin
  v := pg_temp.start(v_sender, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid; v_token := split_part(v, '|', 2);
  -- The other organisation's browser opens the forwarded link, from its own network.
  v := pg_temp.consume(v_token, '192.0.2.77');
  v_state := split_part(v, '|', 2);
  -- GoCardless sends ITS browser back; the handoff goes there and nowhere else.
  v_victims_handoff := split_part(pg_temp.attach(v_state, 'code-other-org'), '|', 4);
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(v like 'ok|%' and i.begin_same_address = false and i.code = 'code-other-org' and v_victims_handoff ~ '^[A-Za-z0-9_-]{43}$',
    'AX1 the forwarded link begins from the other organisation''s network and their consent attaches a code (the address is noted, not refused)');

  -- The sender, without the handoff, gets nothing however often they ask -- and their asking changes nothing.
  for v_guesses in 1..3 loop
    v_claims := v_claims || pg_temp.claim(v_sender, v_intent) || ';';
  end loop;
  perform pg_temp.check(v_claims = repeat('awaiting_return|||awaiting_return;', 3) and (pg_temp.intent(v_intent)).code = 'code-other-org'
      and (pg_temp.intent(v_intent)).claimed_at is null,
    'AX2 the sender cannot claim without the handoff, however often they ask');

  -- Guessing burns the intent.
  v := pg_temp.claim(v_sender, v_intent, replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '/', '_'));
  i := pg_temp.intent(v_intent);
  perform pg_temp.check(split_part(v, '|', 1) = 'closed' and split_part(v, '|', 2) = '' and i.code is null and i.failure_reason = 'handoff_mismatch',
    'AX3 a guessed handoff voids the intent, and the other organisation''s code is erased unclaimed');
  perform pg_temp.check(pg_temp.claim(v_sender, v_intent, v_victims_handoff) = 'closed|||handoff_mismatch',
    'AX4 nothing the sender could later obtain reopens it');

  -- Or the sender simply waits: GoCardless's five minutes run out with the code unclaimed.
  v := pg_temp.start(v_sender, v_club, v_return, '203.0.113.10');
  v_intent := split_part(v, '|', 1)::uuid;
  v_state := split_part(pg_temp.consume(split_part(v, '|', 2), '192.0.2.77'), '|', 2);
  perform pg_temp.attach(v_state, 'code-other-org-2');
  perform pg_temp.check(pg_temp.claim(v_sender, v_intent) = 'awaiting_return|||awaiting_return', 'AX5 waiting holds nothing open for the sender beyond GoCardless''s window');
  update internal.gocardless_connect_intents set code_received_at = now() - interval '5 minutes 1 second' where id = v_intent;
  perform pg_temp.check(pg_temp.claim(v_sender, v_intent) = 'expired|||code_expired' and (pg_temp.intent(v_intent)).code is null,
    'AX6 after five minutes the code is erased unclaimed: the sender never had it');
end $$;

-- =========================================================================================================
-- E. FINISH
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_out uuid := pg_temp.id('out'); v_return text := pg_temp.id('return');
  v text; v_intent uuid; v_handoff text;
begin
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_out, format($q$select public.finish_gocardless_connect_intent(%L::uuid, true, null)$q$, pg_temp.id('a_intent'))) = '42501'
    and pg_temp.state_as('anon', null, format($q$select public.finish_gocardless_connect_intent(%L::uuid, true, null)$q$, pg_temp.id('a_intent'))) = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$select public.finish_gocardless_connect_intent(%L::uuid, true, null)$q$, pg_temp.id('a_intent')), gen_random_uuid()) = '42501',
    'AF1 nobody but the person who started it, in a live session, records how it ended');
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select public.finish_gocardless_connect_intent(%L::uuid, true, null)$q$, pg_temp.id('a_intent'))) = 'OK'
    and (pg_temp.intent(pg_temp.id('a_intent')::uuid)).completed_at is not null,
    'AF2 the person who claimed it records it completed');
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select public.finish_gocardless_connect_intent(%L::uuid, false, 'x')$q$, pg_temp.id('a_intent'))) = '55000'
    and (pg_temp.intent(pg_temp.id('a_intent')::uuid)).failed_at is null,
    'AF3 an ending is recorded once and never rewritten');

  v := pg_temp.returned(v_ca, v_club, v_return, 'code-fail');
  v_intent := split_part(v, '|', 1)::uuid; v_handoff := split_part(v, '|', 2);
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select public.finish_gocardless_connect_intent(%L::uuid, true, null)$q$, v_intent)) = '55000'
    and (pg_temp.intent(v_intent)).completed_at is null,
    'AF4 an intent nobody has claimed cannot be recorded as completed');
  perform pg_temp.claim(v_ca, v_intent, v_handoff);
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, format($q$select public.finish_gocardless_connect_intent(%L::uuid, false, 'Not A Reason!')$q$, v_intent)) = 'OK'
    and (pg_temp.intent(v_intent)).failure_reason = 'failed',
    'AF5 a failure is recorded with a plain token for a reason, never free text');
end $$;

-- =========================================================================================================
-- F. STORAGE
-- =========================================================================================================
do $$
declare
  v_club uuid := pg_temp.id('club'); v_ca uuid := pg_temp.id('ca'); v_return text := pg_temp.id('return');
  v text; v_intent uuid;
begin
  perform pg_temp.check(
    pg_temp.state_as('authenticated', v_ca, 'select count(*) from internal.gocardless_connect_intents') = '42501'
    and pg_temp.state_as('anon', null, 'select count(*) from internal.gocardless_connect_intents') = '42501'
    and pg_temp.state_as('service_role', null, 'select count(*) from internal.gocardless_connect_intents') = '42501'
    and pg_temp.state_as('authenticated', v_ca, format($q$update internal.gocardless_connect_intents set user_id = %L::uuid$q$, v_ca)) = '42501',
    'AS1 no API role -- not even the service role -- reads or writes the intents except through their functions');

  -- A code nobody claimed is dead at GoCardless after five minutes, and is not kept -- nor is its handoff.
  v := pg_temp.returned(v_ca, v_club, v_return, 'code-abandoned');
  v_intent := split_part(v, '|', 1)::uuid;
  update internal.gocardless_connect_intents set code_received_at = now() - interval '11 minutes' where id = v_intent;
  perform pg_temp.start(v_ca, v_club, v_return, '203.0.113.10');
  perform pg_temp.check((pg_temp.intent(v_intent)).code is null and (pg_temp.intent(v_intent)).return_handoff_hash is null,
    'AS2 an abandoned code, and its handoff, are erased by the next start, whoever makes it');

  perform pg_temp.check(
    (select bool_and(p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                     and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('start_gocardless_connect_intent', 'consume_gocardless_connect_begin', 'attach_gocardless_connect_code',
                                                   'fail_gocardless_connect_intent', 'claim_gocardless_connect_code', 'finish_gocardless_connect_intent'))
    and to_regprocedure('public.claim_gocardless_connect_code(uuid)') is null,
    'AS3 all six are owner-rights functions with an empty search path, and the claim without a handoff no longer exists');
end $$;

-- The run's people and clubs, carried past the rollback in a psql variable (a setting made inside the
-- transaction would be rolled back with it).
select coalesce(string_agg(v, ',' order by k), '') as gcapp_ids from ids where k in ('ca', 'out', 'club', 'club2', 'club3') \gset

rollback;

-- =========================================================================================================
-- NOTHING SURVIVES -- including what the real functions and triggers wrote on the run's behalf: audit,
-- security events, finance audit, terms, connections and intents.
-- =========================================================================================================
select set_config('gcapp.ids', :'gcapp_ids', false) is not null as recorded;

do $$
declare
  -- The ids are the evidence; the tag only widens the search when it is known. (Run inside an outer
  -- transaction -- as the mutation proofs run it -- the tag setting is rolled back too, and an empty tag must
  -- not turn "this run's rows" into "every row".)
  v_tag text := nullif(current_setting('gcapp.tag', true), '');
  v_ids uuid[] := string_to_array(nullif(current_setting('gcapp.ids'), ''), ',')::uuid[];
  v_left int;
begin
  select (select count(*) from auth.users where (v_tag is not null and email like 'gcapp.%.' || v_tag || '@ovalball.test') or id = any(v_ids))
       + (select count(*) from public.profiles where id = any(v_ids))
       + (select count(*) from public.clubs where (v_tag is not null and slug in ('gcapp-' || v_tag, 'gcapp-o-' || v_tag, 'gcapp-t-' || v_tag)) or id = any(v_ids))
       + (select count(*) from public.club_directory where v_tag is not null and normalized_key like 'gcapp-%-' || v_tag)
       + (select count(*) from public.club_memberships where club_id = any(v_ids) or user_id = any(v_ids))
       + (select count(*) from public.club_membership_terms_acceptances where club_id = any(v_ids))
       + (select count(*) from internal.gocardless_connect_intents where (v_tag is not null and return_url like '%' || v_tag) or club_id = any(v_ids) or user_id = any(v_ids))
       + (select count(*) from public.gocardless_merchant_connections where club_id = any(v_ids))
       + (select count(*) from public.finance_audit_log where club_id = any(v_ids) or actor_user_id = any(v_ids))
       + (select count(*) from public.security_events where club_id = any(v_ids) or actor_user_id = any(v_ids) or subject_user_id = any(v_ids))
       + (select count(*) from public.audit_log where record_id = any(v_ids) or changed_by = any(v_ids) or actor_user_id = any(v_ids))
    into v_left;
  if v_left = 0 and coalesce(array_length(v_ids, 1), 0) = 5 then
    raise notice 'PASS AZ1 nothing the run made survives it -- people, clubs, terms, intents, connections, audit or security events';
  else
    raise notice 'FAIL AZ1 % row(s) the run made survived it (% ids carried out)', v_left, coalesce(array_length(v_ids, 1), 0);
  end if;
end $$;
