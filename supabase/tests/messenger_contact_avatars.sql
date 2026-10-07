-- MESSAGING CONTACT PICTURES (20270758000000): a picture's location only for people I message or may message.
--   C1 the other adult in my direct conversation   C2 a club-mate I may message
--   C3 a stranger: nothing   C4 a minor: nothing, even in a conversation that exists
--   C5 a block in either direction hides it   C6 never my own, never other fields

\set ON_ERROR_STOP 0
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

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
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
  v_me uuid := gen_random_uuid(); v_friend uuid := gen_random_uuid(); v_mate uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid(); v_minor uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_dir2 uuid; v_club2 uuid; v_n int; v_txt text;
begin
  foreach v_person in array array[v_me, v_friend, v_mate, v_stranger, v_minor] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mca-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth, avatar_storage_path)
    values (v_person, 'Pic', 'Ture', 'mca-' || v_person::text || '@ovalball.test',
            case when v_person = v_minor then (current_date - interval '14 years')::date else (current_date - interval '38 years')::date end,
            v_person::text || '/avatar.jpg')
    on conflict (id) do update set date_of_birth = excluded.date_of_birth, avatar_storage_path = excluded.avatar_storage_path;
  end loop;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mca-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mca-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCA Far ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mca2-' || v_tag) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'mca2-' || v_tag, 'active') returning id into v_club2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_me, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_mate, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_friend, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_stranger, 'BASIC_USER', 'active');
  insert into public.direct_conversations (user_a, user_b, created_by) values (least(v_me, v_friend), greatest(v_me, v_friend), v_me);
  insert into public.direct_conversations (user_a, user_b, created_by) values (least(v_me, v_minor), greatest(v_me, v_minor), v_me);

  perform pg_temp.act('authenticated', v_me);
  perform pg_temp.check(exists (select 1 from public.my_contact_avatars(array[v_friend]) where user_id = v_friend),
    'C1 the other adult in my direct conversation');
  perform pg_temp.check(exists (select 1 from public.my_contact_avatars(array[v_mate]) where user_id = v_mate),
    'C2 a club-mate I may message');
  select count(*) into v_n from public.my_contact_avatars(array[v_stranger]);
  perform pg_temp.check(v_n = 0, 'C3 a stranger: nothing');
  select count(*) into v_n from public.my_contact_avatars(array[v_minor]);
  perform pg_temp.check(v_n = 0, 'C4 a minor: nothing, even where a conversation exists');
  perform pg_temp.act_postgres();
  insert into public.user_message_blocks (blocker_user_id, blocked_user_id) values (v_friend, v_me);
  perform pg_temp.act('authenticated', v_me);
  select count(*) into v_n from public.my_contact_avatars(array[v_friend]);
  perform pg_temp.check(v_n = 0, 'C5 a block in either direction hides it');
  select count(*) into v_n from public.my_contact_avatars(array[v_me]);
  perform pg_temp.check(v_n = 0, 'C6 never my own');
  perform pg_temp.act('anon');
  v_txt := pg_temp.try(format('select * from public.my_contact_avatars(array[%L]::uuid[])', v_mate));
  perform pg_temp.check(v_txt <> 'OK', format('C7 not callable signed out (%s)', v_txt));
end $$;

rollback;
