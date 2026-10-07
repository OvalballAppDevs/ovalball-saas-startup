-- A NOTIFICATION CAN BE DISMISSED -- proved where it is enforced (20270715000000).
--
--   ND-1  the recipient dismisses their own notification; a second dismiss is a quiet no-op
--   ND-2  a dismissed row is gone everywhere its owner looks: the read policy, the paged feed, the
--         unread-only page and the bell's count
--   ND-3  dismissing does not touch read_at -- a dismissed unread row is still unread underneath
--   ND-4  restore puts it back exactly: visible, still unread, counted again
--   ND-5  somebody else's notification id is not a permission: a stranger can neither dismiss nor
--         restore it, and nothing about it changes
--   ND-6  anon cannot reach either operation
--   ND-7  what a notification SAYS is still unchangeable by its owner, dismissed or not
--   ND-8  mark-all-read leaves a dismissed row alone
--
-- Self-seeding and rolled back. No persistent review identity is touched.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nd-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Nd', p_label, 'nd-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname;
  return v;
end $$;

do $$
declare
  v_owner uuid := pg_temp.person('Owner');
  v_stranger uuid := pg_temp.person('Stranger');
  v_owner_session uuid := gen_random_uuid();
  v_stranger_session uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_bool boolean;
  v_bool2 boolean;
  v_n int;
  v_feed int;
  v_unread_page int;
  v_count int;
  v_count_before int;
  v_state text;
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_owner_session, v_owner, now(), now(), 'aal1');
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_stranger_session, v_stranger, now(), now(), 'aal1');

  insert into public.notifications (id, user_id, type, title, body, data)
  values (v_id, v_owner, 'fixture_pitch_changed', 'Fixture updated', 'The pitch for your fixture has been set to Pitch 2.', '{}'::jsonb),
         (v_other, v_owner, 'fixture_pitch_changed', 'Fixture updated', 'A second, undismissed row.', '{}'::jsonb);

  -- ---- ND-1 / ND-2 / ND-3: the owner dismisses ------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'session_id', v_owner_session)::text, true);
  perform set_config('role', 'authenticated', true);
  select (select notifications from public.my_unread_counts()) into v_count_before;
  select public.dismiss_notification(v_id) into v_bool;
  select public.dismiss_notification(v_id) into v_bool2;
  select count(*) into v_n from public.notifications where id = v_id;
  select count(*) into v_feed from public.my_notifications(50) where id = v_id;
  select count(*) into v_unread_page from public.my_notifications(50, null, null, true) where id = v_id;
  select (select notifications from public.my_unread_counts()) into v_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.check(v_bool, 'ND-1 the recipient dismisses their own notification');
  perform pg_temp.check(not v_bool2, 'ND-1 a second dismiss of the same row is a quiet no-op');
  perform pg_temp.check(v_n = 0, 'ND-2 the read policy no longer shows it to its owner');
  perform pg_temp.check(v_feed = 0 and v_unread_page = 0, 'ND-2 the paged feed and the unread-only page leave it out');
  perform pg_temp.check(v_count = v_count_before - 1, format('ND-2 the bell''s count drops by one (%s -> %s)', v_count_before, v_count));
  perform pg_temp.check((select read_at is null and dismissed_at is not null from public.notifications where id = v_id), 'ND-3 dismissing leaves read_at untouched');

  -- ---- ND-5 / ND-6: a stranger, and anon ------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated', 'session_id', v_stranger_session)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.restore_notification(v_id) into v_bool;
  select public.dismiss_notification(v_other) into v_bool2;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(not v_bool and not v_bool2, 'ND-5 another person''s notification id is not a permission to dismiss or restore it');
  perform pg_temp.check((select dismissed_at is not null from public.notifications where id = v_id)
    and (select dismissed_at is null from public.notifications where id = v_other), 'ND-5 and neither row changed');

  perform set_config('role', 'anon', true);
  begin
    perform public.dismiss_notification(v_other);
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_state = '42501', format('ND-6 anon cannot dismiss (%s)', v_state));

  -- ---- ND-8 / ND-4 / ND-7: mark-all, restore, and the content guard ----------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'session_id', v_owner_session)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.mark_all_notifications_read();
  perform set_config('role', 'none', true);
  perform pg_temp.check((select read_at is null from public.notifications where id = v_id), 'ND-8 mark-all-read leaves a dismissed row alone');
  update public.notifications set read_at = null where id = v_other;

  perform set_config('role', 'authenticated', true);
  select public.restore_notification(v_id) into v_bool;
  select count(*) into v_feed from public.my_notifications(50, null, null, true) where id = v_id;
  select (select notifications from public.my_unread_counts()) into v_count;
  begin
    update public.notifications set title = 'Edited' where id = v_id;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_bool and v_feed = 1, 'ND-4 restore puts it back, still unread');
  perform pg_temp.check(v_count = v_count_before, format('ND-4 and counted again (%s)', v_count));
  perform pg_temp.check(v_state <> 'OK' and (select title from public.notifications where id = v_id) = 'Fixture updated',
    format('ND-7 what a notification says still cannot be edited by its owner (%s)', v_state));
end $$;

rollback;
