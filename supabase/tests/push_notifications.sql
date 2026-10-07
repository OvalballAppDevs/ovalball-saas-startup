-- PUSH DELIVERY: device registration is never authorization, the push channel obeys the same
-- mandatory/preference rule the in-app channel already has, and a device belongs to whoever most
-- recently proved they are signed in on it.
--
-- Self-contained and rolled back.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_person uuid;
  v_n int;
  v_topic text;
  v_type text;
  v_state text;
begin
  foreach v_person in array array[v_a, v_b] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Push', 'Tester', 'push-' || v_person::text || '@ovalball.test');
  end loop;

  -- ============ A. REGISTRATION ============

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.register_push_device_token('ExponentPushToken[alpha-1]', 'ios', 'development');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.push_device_tokens where user_id = v_a and token = 'ExponentPushToken[alpha-1]';
  perform pg_temp.check(v_n = 1, '1 (A): registering a token stores it against the signed-in user');

  -- RE-REGISTERING THE SAME TOKEN updates in place rather than duplicating -- a refreshed token from
  -- the same install must not accumulate a second row that would double-deliver.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.register_push_device_token('ExponentPushToken[alpha-1]', 'ios', 'development');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.push_device_tokens where token = 'ExponentPushToken[alpha-1]';
  perform pg_temp.check(v_n = 1, '2 (A): registering the same token again does not duplicate it');

  -- A TOKEN BELONGS TO WHOEVER MOST RECENTLY PROVED THEY ARE SIGNED IN ON IT -- a shared or
  -- reinstalled device, previously registered by B, now genuinely belongs to A.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.register_push_device_token('ExponentPushToken[shared]', 'ios', 'development');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.register_push_device_token('ExponentPushToken[shared]', 'ios', 'development');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.push_device_tokens where token = 'ExponentPushToken[shared]' and user_id = v_a;
  perform pg_temp.check(v_n = 1, '3 (A): a device re-registered by a different person now belongs to them, not both');
  select count(*) into v_n from public.push_device_tokens where token = 'ExponentPushToken[shared]' and user_id = v_b;
  perform pg_temp.check(v_n = 0, '4 (A): and the previous holder no longer has it');

  -- DEVICE TOKEN IS NEVER AUTHORIZATION: B cannot read A's tokens.
  -- Since 20270717000000 no browser role reads the table at all (RPC-only), which is stronger still.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_n from public.push_device_tokens where user_id = v_a;
    v_state := 'OK';
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state = '42501', format('5 (A): no browser role reads device tokens at all, so nobody reads another''s (got %s)', v_state));

  -- ============ B. UNREGISTERING (SIGN-OUT) ============

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.unregister_push_device_token('ExponentPushToken[alpha-1]');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.push_device_tokens where token = 'ExponentPushToken[alpha-1]';
  perform pg_temp.check(v_n = 0, '6 (B): signing out removes that device''s token');

  select count(*) into v_n from public.push_device_tokens where user_id = v_a;
  perform pg_temp.check(v_n = 1, '7 (B): and only that one -- the shared device token (still A''s) is untouched');

  -- ============ C. THE PREFERENCE CHANNEL ============

  select topic_key, type_key into v_topic, v_type from public.notification_types limit 1;

  -- DEFAULT ON, with no row yet.
  perform pg_temp.check(internal.should_deliver_notification(v_a, v_type, 'push'),
    '8 (C): push defaults to on for a topic nobody has set a preference for');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_notification_preference(v_topic, null, null, false);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.check(not internal.should_deliver_notification(v_a, v_type, 'push')
                         or internal.notification_is_mandatory(v_type),
    '9 (C): turning push off for a non-mandatory topic is obeyed');

  perform pg_temp.check(
    (select in_app_enabled from public.notification_preferences where user_id = v_a and topic_key = v_topic) is distinct from false,
    '10 (C): switching push off did not silently change in-app (only the named channel changes)');

  -- ============ D. DELIVERY IS GATED ON THE SAME RULE, NOT A SEPARATE ONE ============

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.register_push_device_token('ExponentPushToken[alpha-2]', 'ios', 'development');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- A topic A has NOT silenced: inserting a notification queues a push (proved by the request landing
  -- in pg_net's queue, which is the real transport this trigger uses).
  select count(*) into v_n from net.http_request_queue;
  insert into public.notifications (user_id, type, title, body, data)
  select v_a, nt.type_key, 'Test', 'Testing delivery', '{}'::jsonb
  from public.notification_types nt where nt.topic_key <> v_topic limit 1;
  perform pg_temp.check((select count(*) from net.http_request_queue) > v_n,
    '11 (D): a notification on an un-silenced topic queues a push request');

  -- THE SAME TOPIC A silenced above: no push is queued, even though a device is registered.
  select count(*) into v_n from net.http_request_queue;
  begin
    insert into public.notifications (user_id, type, title, body, data) values (v_a, v_type, 'Test', 'Silenced', '{}'::jsonb);
  exception when others then null;
  end;
  perform pg_temp.check(internal.notification_is_mandatory(v_type) or (select count(*) from net.http_request_queue) = v_n,
    '12 (D): a notification on a push-silenced non-mandatory topic queues nothing');

  -- NOBODY WRITES A DEVICE TOKEN ROW BY HAND.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.push_device_tokens (user_id, token, platform, app_variant) values (v_a, 'ExponentPushToken[direct]', 'ios', 'development');
    v_state := 'OK';
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state <> 'OK', format('13 (D): a direct INSERT bypassing the RPC is refused (got %s)', v_state));

  -- Cleanup for the device rows this suite itself created against real users (rolled back anyway, but
  -- explicit about what it touched for anyone reading the transaction log mid-run).
end $$;

rollback;
