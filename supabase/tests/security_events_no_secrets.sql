-- SECURITY EVENTS (Identity/Auth Slice 1, Phase 2 Y.14, AE, AO B2 and B4).
--
--   S. The trusted paths append the expected event, in the same transaction
--      as the change, and a rollback leaves nothing behind.
--   T. The actor is server-derived; nobody can supply or forge one.
--   U. No secret-shaped metadata is ever stored.
--   V. Who can read events, and that nobody can write them through the API.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'aal', case when p_sub is not null then 'aal1' end))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.new_identity(p_email text, p_provider text default 'email') returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    jsonb_build_object('provider', p_provider), '{}'::jsonb, '', '', '', '', '', '', '', '');
  return v_id;
end $$;

create or replace function pg_temp.events(p_subject uuid, p_type text) returns integer
language sql as $$
  select count(*)::int from public.security_events where subject_user_id = p_subject and event_type = p_type;
$$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.events(uuid, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_target uuid; v_admin uuid; v_ua_admin uuid; v_bystander uuid; v_social uuid;
  v_event bigint; v_count integer; v_before integer; v_text text; v_err text; v_bool boolean;
  v_row record;
begin
  -- =================================================================
  -- S. Trusted paths append the expected event
  -- =================================================================
  v_target := pg_temp.new_identity('events-target-' || v_tag || '@ovalball.test');
  select * into v_row from public.security_events where subject_user_id = v_target and event_type = 'user.created';
  if pg_temp.events(v_target, 'user.created') = 1 and v_row.actor_user_id is null and v_row.outcome = 'SUCCESS'
     and v_row.metadata = '{"created_source":"SELF_SIGNUP"}'::jsonb then
    raise notice 'PASS S1: creating an authentication identity records user.created for it, with its provenance and no actor';
  else
    raise notice 'FAIL S1: user.created events %, metadata %', pg_temp.events(v_target, 'user.created'), v_row.metadata;
  end if;

  perform pg_temp.act('authenticated', v_target);
  insert into public.profiles (id, first_name, surname, date_of_birth) values (v_target, 'events', 'target', date '1991-04-05');
  perform pg_temp.act_postgres();
  select * into v_row from public.security_events where subject_user_id = v_target and event_type = 'user.setup_completed';
  if pg_temp.events(v_target, 'user.setup_completed') = 1 and v_row.actor_user_id = v_target and v_row.aal = 'aal1'
     and position('1991' in row_to_json(v_row)::text) = 0 then
    raise notice 'PASS S2: completing the held profile records user.setup_completed, attributed to the person, without their details';
  else
    raise notice 'FAIL S2: setup_completed events %, actor %', pg_temp.events(v_target, 'user.setup_completed'), v_row.actor_user_id;
  end if;

  v_admin := pg_temp.new_identity('events-admin-' || v_tag || '@ovalball.test');
  v_ua_admin := pg_temp.new_identity('events-ua-' || v_tag || '@ovalball.test');
  v_bystander := pg_temp.new_identity('events-bystander-' || v_tag || '@ovalball.test');
  insert into public.profiles (id, first_name, surname) values (v_admin, 'Events', 'Admin'), (v_ua_admin, 'Events', 'Access'), (v_bystander, 'Events', 'Bystander');
  insert into public.site_admins (user_id, status, admin_role) values (v_admin, 'active', 'full'), (v_ua_admin, 'active', 'user_access');

  perform pg_temp.act('authenticated', v_admin);
  perform public.set_account_status(v_target, 'suspended');
  perform pg_temp.act_postgres();
  select * into v_row from public.security_events where subject_user_id = v_target and event_type = 'account.suspended';
  if pg_temp.events(v_target, 'account.suspended') = 1 and v_row.actor_user_id = v_admin and v_row.effective_person_id = v_admin
     and v_row.impersonation_session_id is null
     and v_row.metadata = '{"from_state":"ACTIVE","to_state":"SUSPENDED"}'::jsonb and v_row.occurred_at = now() then
    raise notice 'PASS S3: set_account_status records account.suspended with the Site Admin as actor, the person as subject, in the same transaction';
  else
    raise notice 'FAIL S3: suspended events %, actor %, metadata %', pg_temp.events(v_target, 'account.suspended'), v_row.actor_user_id, v_row.metadata;
  end if;

  perform pg_temp.act('authenticated', v_admin);
  perform public.set_account_status(v_target, 'active');
  perform pg_temp.act_postgres();
  if pg_temp.events(v_target, 'account.restored') = 1
     and (select actor_user_id from public.security_events where subject_user_id = v_target and event_type = 'account.restored') = v_admin then
    raise notice 'PASS S4: restoring the account records account.restored';
  else
    raise notice 'FAIL S4: restored events %', pg_temp.events(v_target, 'account.restored');
  end if;

  update public.profiles set account_state = 'DISABLED' where id = v_bystander;
  update public.profiles set account_status = 'active' where id = v_bystander;
  if pg_temp.events(v_bystander, 'account.disabled') = 1 and pg_temp.events(v_bystander, 'account.restored') = 1 then
    raise notice 'PASS S5: a state change by any trusted path, including the compatibility column, is recorded';
  else
    raise notice 'FAIL S5: disabled % restored %', pg_temp.events(v_bystander, 'account.disabled'), pg_temp.events(v_bystander, 'account.restored');
  end if;

  update auth.users set email = 'events-moved-' || v_tag || '@ovalball.test' where id = v_bystander;
  select * into v_row from public.security_events where subject_user_id = v_bystander and event_type = 'email.changed';
  if pg_temp.events(v_bystander, 'email.changed') = 1 and position('@' in row_to_json(v_row)::text) = 0 then
    raise notice 'PASS S6: an email change records email.changed without storing either address';
  else
    raise notice 'FAIL S6: email.changed events %', pg_temp.events(v_bystander, 'email.changed');
  end if;

  -- AO B4: a rollback leaves no event.
  v_before := (select count(*) from public.security_events where subject_user_id = v_target);
  begin
    perform pg_temp.act('authenticated', v_admin);
    perform public.set_account_status(v_target, 'suspended');
    perform pg_temp.act_postgres();
    raise exception 'roll this back' using errcode = 'P0001';
  exception when others then
    perform pg_temp.act_postgres();
  end;
  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_bystander);
    perform public.set_account_status(v_target, 'suspended');
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select count(*) from public.security_events where subject_user_id = v_target) = v_before
     and (select account_state from public.profiles where id = v_target) = 'ACTIVE' then
    raise notice 'PASS S7: a rolled-back status change and a refused one leave no event behind';
  else
    raise notice 'FAIL S7: events after rollback % (before %), refusal sqlstate %', (select count(*) from public.security_events where subject_user_id = v_target), v_before, v_err;
  end if;

  -- =================================================================
  -- T. The actor is server-derived
  -- =================================================================
  if not exists (
    select 1 from pg_proc p, unnest(p.proargnames) a
    where p.oid = 'internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid)'::regprocedure and a ~* 'actor|effective|impersonat|aal'
  ) then
    raise notice 'PASS T1: the event writer takes no actor, effective-person, impersonation or AAL argument';
  else
    raise notice 'FAIL T1: the event writer accepts caller-supplied attribution';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_bystander, 'role', 'authenticated')::text, true);
  insert into public.security_events (event_type, subject_user_id, actor_user_id, effective_person_id, impersonation_session_id, aal, occurred_at)
  values ('account.details_corrected', v_target, v_admin, v_admin, gen_random_uuid(), 'aal2', now() - interval '3 years')
  returning id into v_event;
  perform pg_temp.act_postgres();
  select * into v_row from public.security_events where id = v_event;
  if v_row.actor_user_id = v_bystander and v_row.effective_person_id = v_bystander and v_row.impersonation_session_id is null
     and v_row.aal is null and v_row.occurred_at = now() then
    raise notice 'PASS T2: even a direct owner insert cannot plant an actor, impersonation session, AAL or back-dated time';
  else
    raise notice 'FAIL T2: stored actor %, impersonation %, aal %, time %', v_row.actor_user_id, v_row.impersonation_session_id, v_row.aal, v_row.occurred_at;
  end if;

  v_event := internal.emit_security_event('session.revoked', v_target, 'SUCCESS', 'Support request');
  if (select actor_user_id from public.security_events where id = v_event) is null then
    raise notice 'PASS T3: an event from a backend session with no request identity has no actor rather than a guessed one';
  else
    raise notice 'FAIL T3: backend event carried an actor';
  end if;

  -- =================================================================
  -- U. No secrets (AO B2)
  -- =================================================================
  v_bool := true;
  foreach v_text in array array[
    '{"password":"x"}', '{"access_token":"x"}', '{"refreshToken":"x"}', '{"client_secret":"x"}', '{"recovery_code":"x"}',
    '{"otp":"123456"}', '{"factor_secret":"x"}', '{"context":{"provider_token":"x"}}', '{"attempts":[{"PASSWORD_HASH":"x"}]}'
  ] loop
    v_err := null;
    begin
      perform internal.emit_security_event('mfa.factor_added', v_target, 'SUCCESS', null, v_text::jsonb);
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
    end;
    if v_err is distinct from '22023' then
      v_bool := false;
      raise notice 'metadata % accepted (sqlstate %)', v_text, v_err;
    end if;
  end loop;
  if v_bool and pg_temp.events(v_target, 'mfa.factor_added') = 0 then
    raise notice 'PASS U1: secret-shaped metadata keys are refused at any depth and in any case';
  else
    raise notice 'FAIL U1: a secret-shaped metadata key was stored';
  end if;

  v_err := null;
  begin
    insert into public.security_events (event_type, subject_user_id, metadata) values ('mfa.factor_added', v_target, '{"session":{"refresh_token":"x"}}');
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
  end;
  if v_err = '22023' and pg_temp.events(v_target, 'mfa.factor_added') = 0 then
    raise notice 'PASS U2: the table itself refuses secret-shaped metadata, whichever path inserts';
  else
    raise notice 'FAIL U2: direct insert with secret metadata (sqlstate %)', v_err;
  end if;

  v_event := internal.emit_security_event('mfa.factor_added', v_target, 'SUCCESS', null, '{"factor_type":"totp","friendly_name":"Phone"}'::jsonb);
  if (select metadata->>'factor_type' from public.security_events where id = v_event) = 'totp' then
    raise notice 'PASS U3: ordinary structured metadata is stored';
  else
    raise notice 'FAIL U3: safe metadata was not stored';
  end if;

  v_bool := true;
  foreach v_text in array array['no.such_event', 'bad outcome'] loop
    v_err := null;
    begin
      if v_text = 'no.such_event' then
        perform internal.emit_security_event(v_text, v_target);
      else
        perform internal.emit_security_event('session.revoked', v_target, 'MAYBE');
      end if;
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
    end;
    if v_err is null then v_bool := false; end if;
  end loop;
  if v_bool then
    raise notice 'PASS U4: an uncatalogued event type or an invalid outcome is refused';
  else
    raise notice 'FAIL U4: an invalid event was stored';
  end if;

  select count(*) into v_count from public.security_events e
  where e.subject_user_id in (v_target, v_admin, v_ua_admin, v_bystander)
    and (internal.jsonb_has_secret_key(e.metadata) or row_to_json(e)::text ~* '(@ovalball\.test|encrypted_password|refresh|bearer)');
  if v_count = 0 then
    raise notice 'PASS U5: none of the events this run produced carries an email address, credential or secret-shaped key';
  else
    raise notice 'FAIL U5: % event(s) carry sensitive values', v_count;
  end if;

  -- =================================================================
  -- V. Reading and writing through the API
  -- =================================================================
  perform pg_temp.act('authenticated', v_target);
  select count(*) into v_count from public.security_events;
  select count(*) into v_before from public.security_events where subject_user_id <> v_target;
  perform pg_temp.act_postgres();
  if v_count >= 3 and v_before = 0 then
    raise notice 'PASS V1: a person reads their own account events and nobody else''s';
  else
    raise notice 'FAIL V1: own events %, others visible %', v_count, v_before;
  end if;

  perform pg_temp.act('authenticated', v_bystander);
  select count(*) into v_count from public.security_events where subject_user_id = v_target;
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_ua_admin);
  select count(*) into v_before from public.security_events where subject_user_id = v_target;
  perform pg_temp.act_postgres();
  if v_count = 0 and v_before = 0 then
    raise notice 'PASS V2: another member, and a Site Admin without Full authority, cannot read someone else''s security events';
  else
    raise notice 'FAIL V2: bystander saw %, User Access admin saw %', v_count, v_before;
  end if;

  perform pg_temp.act('authenticated', v_admin);
  select count(*) into v_count from public.security_events where subject_user_id = v_target;
  perform pg_temp.act_postgres();
  if v_count >= 3 then
    raise notice 'PASS V3: a Full Site Admin can read security events (read only)';
  else
    raise notice 'FAIL V3: Full Site Admin saw % events', v_count;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    select count(*) into v_count from public.security_events;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS V4: anonymous callers cannot read security events';
  else
    raise notice 'FAIL V4: anon read security events (sqlstate %)', v_err;
  end if;

  v_bool := true;
  foreach v_text in array array['anon', 'authenticated', 'admin', 'service_role'] loop
    v_err := null;
    begin
      if v_text = 'admin' then
        perform pg_temp.act('authenticated', v_admin);
      elsif v_text = 'authenticated' then
        perform pg_temp.act('authenticated', v_target);
      else
        perform pg_temp.act(v_text);
      end if;
      insert into public.security_events (event_type, subject_user_id, actor_user_id) values ('account.restored', v_target, v_bystander);
      perform pg_temp.act_postgres();
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      perform pg_temp.act_postgres();
    end;
    if v_err is distinct from '42501' then
      v_bool := false;
      raise notice '% inserted an event (sqlstate %)', v_text, v_err;
    end if;
  end loop;
  if v_bool and pg_temp.events(v_target, 'account.restored') = 1 then
    raise notice 'PASS V5: no API role (anon, member, Full Site Admin, service_role) can write an event directly';
  else
    raise notice 'FAIL V5: an API role wrote a security event';
  end if;

  if not has_function_privilege('anon', 'internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('service_role', 'internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid)', 'EXECUTE')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~* 'emit_security_event') then
    raise notice 'PASS V6: the event writer is not executable by any API role and no public RPC wraps it';
  else
    raise notice 'FAIL V6: the event writer is reachable through the API';
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_target);
    update public.security_events set reason = 'mine now' where subject_user_id = v_target;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and not exists (select 1 from public.security_events where reason = 'mine now') then
    raise notice 'PASS V7: a person cannot rewrite their own security history';
  else
    raise notice 'FAIL V7: subject rewrote an event (sqlstate %)', v_err;
  end if;

  select count(*) into v_count from public.security_event_types;
  if v_count >= 80 and exists (select 1 from public.security_event_types where event_type = 'account.suspended' and subject_visible and requires_reason and not club_visible)
     and exists (select 1 from public.security_event_types where event_type = 'invitation.issued' and club_visible) then
    raise notice 'PASS V8: the Phase 2 event catalogue is seeded with its visibility and reason flags (% types)', v_count;
  else
    raise notice 'FAIL V8: catalogue has % types', v_count;
  end if;
end $$;

rollback;
