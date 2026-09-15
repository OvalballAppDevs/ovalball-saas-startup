-- AUDIT IMMUTABILITY (Identity/Auth Slice 1, Phase 2 Y.14/Y.15, AO B1 and B3).
--
-- audit_log and security_events are append-only history. Every check runs as
-- the database role a caller would really have and reads the database back:
--
--   H. Nobody rewrites history: anon, a signed-in user, a Full Site Admin,
--      service_role, a definer function reached through the API, and postgres
--      itself outside an operator maintenance session.
--   I. Nobody forges history: no browser or server role may insert, and the
--      actor on a row is the request's identity whatever the writer supplied.
--   J. Audit images are redacted before storage.
--   K. Coverage and the guard's own wiring.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.new_identity(p_email text) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    '{"provider":"email"}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  return v_id;
end $$;

-- A privileged database function an API caller can reach: it runs as the
-- owner and even turns the maintenance setting on before rewriting.
create or replace function pg_temp.definer_rewrite_audit(p_id uuid) returns void
language plpgsql security definer as $$
begin
  perform set_config('ovalball.maintenance', 'on', true);
  update public.audit_log set changed_by = null, after = '{"rewritten":true}'::jsonb where id = p_id;
  perform set_config('ovalball.maintenance', 'off', true);
end $$;

create or replace function pg_temp.definer_insert_audit(p_actor uuid) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into public.audit_log (table_name, record_id, action, changed_by, actor_user_id, effective_person_id, after)
  values ('slice1_probe', gen_random_uuid(), 'update', p_actor, p_actor, p_actor, '{}'::jsonb)
  returning id into v_id;
  return v_id;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.definer_rewrite_audit(uuid) to public;
grant execute on function pg_temp.definer_insert_audit(uuid) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_user uuid; v_other uuid; v_admin uuid;
  v_audit uuid; v_event bigint; v_id uuid; v_ids uuid[];
  v_count integer; v_text text; v_err text; v_bool boolean;
  v_row record;
  v_role text;
begin
  v_user := pg_temp.new_identity('audit-user-' || v_tag || '@ovalball.test');
  v_other := pg_temp.new_identity('audit-other-' || v_tag || '@ovalball.test');
  v_admin := pg_temp.new_identity('audit-admin-' || v_tag || '@ovalball.test');
  insert into public.profiles (id, first_name, surname) values (v_user, 'Audit', 'User'), (v_other, 'Audit', 'Other'), (v_admin, 'Audit', 'Admin');
  insert into public.site_admins (user_id, status, admin_role) values (v_admin, 'active', 'full');

  -- A real history row about v_user, attributed to v_user.
  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('slice1_history', v_user, 'update', v_user, '{"state":"original"}'::jsonb)
  returning id into v_audit;
  v_event := internal.emit_security_event('user.setup_completed', v_user, 'SUCCESS', null, '{"probe":"original"}'::jsonb);

  -- =================================================================
  -- H. Nobody rewrites history
  -- =================================================================
  v_err := null;
  begin
    perform pg_temp.act('anon');
    update public.audit_log set after = '{"state":"forged"}'::jsonb where id = v_audit;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS H1: anon cannot update audit history';
  else
    raise notice 'FAIL H1: anon audit update (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('anon');
    delete from public.audit_log where id = v_audit;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS H2: anon cannot delete audit history';
  else
    raise notice 'FAIL H2: anon audit delete (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_user);
    update public.audit_log set after = '{"state":"forged"}'::jsonb where id = v_audit;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select after->>'state' from public.audit_log where id = v_audit) = 'original' then
    raise notice 'PASS H3: a signed-in user cannot alter audit history about themselves';
  else
    raise notice 'FAIL H3: signed-in audit update (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_user);
    delete from public.audit_log where id = v_audit;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and exists (select 1 from public.audit_log where id = v_audit) then
    raise notice 'PASS H4: a signed-in user cannot delete audit history';
  else
    raise notice 'FAIL H4: signed-in audit delete (sqlstate %)', v_err;
  end if;

  v_bool := true;
  foreach v_text in array array['update', 'delete'] loop
    v_err := null;
    begin
      perform pg_temp.act('authenticated', v_admin);
      if v_text = 'update' then
        update public.audit_log set after = '{"state":"admin"}'::jsonb where id = v_audit;
      else
        delete from public.audit_log where id = v_audit;
      end if;
      perform pg_temp.act_postgres();
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      perform pg_temp.act_postgres();
    end;
    if v_err is distinct from '42501' then v_bool := false; end if;
  end loop;
  if v_bool and internal.site_admin_role(v_admin) = 'full'
     and (select after->>'state' from public.audit_log where id = v_audit) = 'original' then
    raise notice 'PASS H5: Full Site Admin authority does not include rewriting or deleting audit history';
  else
    raise notice 'FAIL H5: a Full Site Admin''s rewrite or delete of audit history was not refused (state now %)', (select after->>'state' from public.audit_log where id = v_audit);
  end if;

  v_bool := true;
  foreach v_text in array array['audit update', 'audit delete', 'audit truncate', 'event update', 'event delete'] loop
    v_err := null;
    begin
      perform pg_temp.act('service_role');
      case v_text
        when 'audit update' then update public.audit_log set after = '{}'::jsonb where id = v_audit;
        when 'audit delete' then delete from public.audit_log where id = v_audit;
        when 'audit truncate' then truncate public.audit_log;
        when 'event update' then update public.security_events set reason = 'rewritten' where id = v_event;
        else delete from public.security_events where id = v_event;
      end case;
      perform pg_temp.act_postgres();
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      perform pg_temp.act_postgres();
    end;
    if v_err is distinct from '42501' then
      v_bool := false;
      raise notice 'service_role % sqlstate %', v_text, v_err;
    end if;
  end loop;
  if v_bool then
    raise notice 'PASS H6: the server key (service_role) cannot update, delete or truncate audit or security history';
  else
    raise notice 'FAIL H6: service_role was not refused changing history';
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_admin);
    perform pg_temp.definer_rewrite_audit(v_audit);
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' and (select after->>'state' from public.audit_log where id = v_audit) = 'original' then
    raise notice 'PASS H7: a privileged definer function reached through the API cannot rewrite history, even after switching maintenance on';
  else
    raise notice 'FAIL H7: definer rewrite through the API (sqlstate %)', v_err;
  end if;

  v_bool := true;
  foreach v_text in array array['audit update', 'audit delete', 'audit truncate', 'event update', 'event delete', 'event truncate'] loop
    v_err := null;
    begin
      case v_text
        when 'audit update' then update public.audit_log set after = '{}'::jsonb where id = v_audit;
        when 'audit delete' then delete from public.audit_log where id = v_audit;
        when 'audit truncate' then truncate public.audit_log;
        when 'event update' then update public.security_events set reason = 'rewritten' where id = v_event;
        when 'event delete' then delete from public.security_events where id = v_event;
        else truncate public.security_events;
      end case;
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
    end;
    if v_err is distinct from '42501' then
      v_bool := false;
      raise notice 'postgres % sqlstate %', v_text, v_err;
    end if;
  end loop;
  if v_bool and (select after->>'state' from public.audit_log where id = v_audit) = 'original'
     and (select metadata->>'probe' from public.security_events where id = v_event) = 'original' then
    raise notice 'PASS H8: the database owner cannot update, delete or truncate either store outside a maintenance session';
  else
    raise notice 'FAIL H8: postgres was not refused changing history without maintenance';
  end if;

  -- Positive control: the operator maintenance path the retention job will
  -- use does work (inside this rolled-back transaction).
  v_err := null;
  begin
    perform set_config('ovalball.maintenance', 'on', true);
    update public.security_events set reason = 'maintenance' where id = v_event;
    perform set_config('ovalball.maintenance', 'off', true);
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform set_config('ovalball.maintenance', 'off', true);
  end;
  if v_err is null and (select reason from public.security_events where id = v_event) = 'maintenance' then
    raise notice 'PASS H9: an operator session (not an API role) can maintain history only with ovalball.maintenance on';
  else
    raise notice 'FAIL H9: the maintenance path is unusable (sqlstate %)', v_err;
  end if;

  -- =================================================================
  -- I. Nobody forges history
  -- =================================================================
  v_err := null;
  begin
    perform pg_temp.act('anon');
    insert into public.audit_log (table_name, record_id, action, changed_by, after)
    values ('profiles', v_other, 'update', v_other, '{"forged":true}'::jsonb);
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS I1: anon cannot insert forged audit history';
  else
    raise notice 'FAIL I1: anon audit insert (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_user);
    insert into public.audit_log (table_name, record_id, action, changed_by, actor_user_id, after)
    values ('profiles', v_other, 'update', v_other, v_other, '{"forged":true}'::jsonb);
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS I2: a signed-in user cannot write audit rows directly, so cannot attribute one to another person';
  else
    raise notice 'FAIL I2: signed-in audit insert (sqlstate %)', v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('service_role');
    insert into public.audit_log (table_name, record_id, action, after) values ('profiles', v_other, 'update', '{}'::jsonb);
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err = '42501' then
    raise notice 'PASS I3: service_role cannot append audit rows directly; only trusted database functions do';
  else
    raise notice 'FAIL I3: service_role audit insert (sqlstate %)', v_err;
  end if;

  perform pg_temp.act('authenticated', v_user);
  v_id := pg_temp.definer_insert_audit(v_other);
  perform pg_temp.act_postgres();
  select * into v_row from public.audit_log where id = v_id;
  if v_row.actor_user_id = v_user and v_row.effective_person_id = v_user and v_row.impersonation_session_id is null then
    raise notice 'PASS I4: a trusted writer that supplies another person as actor is overridden: the actor is the request''s identity';
  else
    raise notice 'FAIL I4: stored actor % (request identity %, forged %)', v_row.actor_user_id, v_user, v_other;
  end if;

  insert into public.audit_log (table_name, record_id, action, actor_user_id, after)
  values ('slice1_probe', gen_random_uuid(), 'update', v_other, '{}'::jsonb) returning id into v_id;
  if (select actor_user_id from public.audit_log where id = v_id) is null then
    raise notice 'PASS I5: a backend write with no request identity cannot name an actor';
  else
    raise notice 'FAIL I5: a backend write planted an actor';
  end if;

  v_bool := true;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_text in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.audit_log', v_text) or has_table_privilege(v_role, 'public.security_events', v_text) then
        v_bool := false;
        raise notice '% holds % on a history store', v_role, v_text;
      end if;
    end loop;
  end loop;
  if v_bool and not has_table_privilege('anon', 'public.audit_log', 'SELECT') and not has_table_privilege('anon', 'public.security_events', 'SELECT') then
    raise notice 'PASS I6: no browser or server API role holds any write privilege on audit_log or security_events, and anon cannot read them';
  else
    raise notice 'FAIL I6: a history store is writable (or anon-readable) through the API';
  end if;

  -- =================================================================
  -- J. Redaction (AO B3)
  -- =================================================================
  -- Every row in this transaction shares one changed_at, so the row this
  -- update writes is found by exclusion rather than by time.
  v_ids := array(select id from public.audit_log where table_name = 'profiles' and record_id = v_user);
  update public.profiles
  set date_of_birth = date '1984-07-19', address_line_1 = '12 Secret Lane ' || v_tag, postcode = 'ZZ9 9ZZ', phone_number = '07700 900' || substr(v_tag, 1, 3)
  where id = v_user;
  select count(*) into v_count from public.audit_log
  where table_name = 'profiles' and record_id = v_user and action = 'update' and id <> all (v_ids);
  select * into v_row from public.audit_log
  where table_name = 'profiles' and record_id = v_user and action = 'update' and id <> all (v_ids);
  if v_count = 1 and v_row.redacted
     and v_row.after->>'date_of_birth' = '[redacted]' and v_row.after->>'address_line_1' = '[redacted]'
     and v_row.after->>'postcode' = '[redacted]' and v_row.after->>'phone_number' = '[redacted]'
     and position('1984-07-19' in coalesce(v_row.before::text, '') || v_row.after::text) = 0
     and position('Secret Lane' in coalesce(v_row.before::text, '') || v_row.after::text) = 0
     and v_row.after->>'first_name' = 'Audit' then
    raise notice 'PASS J1: updating a profile''s DOB, address and phone stores redacted images, and the rest of the row stays readable';
  else
    raise notice 'FAIL J1: profile audit image was not redacted (redacted %, dob %)', v_row.redacted, v_row.after->>'date_of_birth';
  end if;

  insert into public.audit_log (table_name, record_id, action, after)
  values ('invitations', gen_random_uuid(), 'insert', jsonb_build_object('token', 'tok-' || v_tag, 'email', 'x@y.test'))
  returning id into v_id;
  select * into v_row from public.audit_log where id = v_id;
  if v_row.after->>'token' = 'sha256:' || encode(sha256(convert_to('tok-' || v_tag, 'UTF8')), 'hex')
     and position('tok-' || v_tag in v_row.after::text) = 0 and v_row.redacted then
    raise notice 'PASS J2: an invitation token written by any trusted path is stored only as a hash';
  else
    raise notice 'FAIL J2: token stored as %', v_row.after->>'token';
  end if;

  insert into public.audit_log (table_name, record_id, action, after)
  values ('some_future_table', gen_random_uuid(), 'insert',
          jsonb_build_object('reset_password', 'pw-' || v_tag, 'lookup_hmac', 'h-' || v_tag, 'refresh_token', 'rt-' || v_tag, 'token_expires_at', '2030-01-01'))
  returning id into v_id;
  select * into v_row from public.audit_log where id = v_id;
  if position('pw-' || v_tag in v_row.after::text) = 0 and position('h-' || v_tag in v_row.after::text) = 0
     and position('rt-' || v_tag in v_row.after::text) = 0 and v_row.after->>'token_expires_at' = '2030-01-01' then
    raise notice 'PASS J3: a secret-shaped column with no rule yet is still hashed, so a new table cannot leak one into history';
  else
    raise notice 'FAIL J3: unruled secret stored: %', v_row.after;
  end if;

  insert into public.audit_log (table_name, record_id, action, after)
  values ('fixture_messages', gen_random_uuid(), 'insert', jsonb_build_object('body', 'private words ' || v_tag, 'sender_id', v_user))
  returning id into v_id;
  select * into v_row from public.audit_log where id = v_id;
  if not (v_row.after ? 'body') and v_row.after->>'sender_id' = v_user::text then
    raise notice 'PASS J4: message bodies are dropped from audit images';
  else
    raise notice 'FAIL J4: message body stored';
  end if;

  select count(*) into v_count
  from (select distinct tgrelid from pg_trigger where tgfoid = 'internal.audit_row_change()'::regprocedure) t
  join pg_attribute a on a.attrelid = t.tgrelid and a.attnum > 0 and not a.attisdropped
  join pg_class c on c.oid = t.tgrelid
  where a.attname ~* '(token|_hmac$|_sha256$|password|secret|date_of_birth)'
    and a.attname !~* '_at$'
    and not exists (select 1 from public.audit_redaction_rules r where r.table_name = c.relname and r.column_name = a.attname);
  if v_count = 0 then
    raise notice 'PASS J5: every secret-bearing or date-of-birth column on an audited table has an explicit redaction rule';
  else
    raise notice 'FAIL J5: % audited secret/DOB column(s) have no explicit rule', v_count;
  end if;

  -- =================================================================
  -- K. Coverage and wiring
  -- =================================================================
  select count(*) into v_count
  from unnest(array['capabilities', 'tournaments', 'club_events', 'competition_matches', 'gocardless_payments', 'payment_refunds',
                    'membership_obligations', 'club_message_blocks', 'user_message_blocks', 'site_admin_diagnostic_sessions',
                    'guardians', 'site_admins', 'capability_overrides', 'invitations', 'profiles']) t(name)
  where not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = ('public.' || t.name)::regclass and tg.tgfoid = 'internal.audit_row_change()'::regprocedure and tg.tgenabled <> 'D'
  );
  if v_count = 0 then
    raise notice 'PASS K1: every existing security-relevant table Y.15 names is audited';
  else
    raise notice 'FAIL K1: % security table(s) unaudited', v_count;
  end if;

  select count(*) into v_count
  from (values ('public.audit_log', 'audit_log_append_only'), ('public.audit_log', 'audit_log_no_truncate'),
               ('public.security_events', 'security_events_append_only'), ('public.security_events', 'security_events_no_truncate'),
               ('public.audit_log', 'a_audit_log_facts'), ('public.security_events', 'a_security_event_facts')) g(rel, name)
  where not exists (select 1 from pg_trigger tg where tg.tgrelid = g.rel::regclass and tg.tgname = g.name and tg.tgenabled in ('O', 'A'));
  if v_count = 0 then
    raise notice 'PASS K2: the append-only guards and attribution triggers are installed and enabled on both stores';
  else
    raise notice 'FAIL K2: % guard trigger(s) missing or disabled', v_count;
  end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal'
    and p.proname in ('emit_security_event', 'security_event_facts', 'refuse_history_rewrite', 'audit_log_facts', 'redact_audit_image', 'emit_profile_state_events', 'jsonb_has_secret_key')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'));
  if v_count = 0 and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal'
      and p.proname in ('emit_security_event', 'security_event_facts', 'refuse_history_rewrite', 'audit_log_facts', 'redact_audit_image', 'emit_profile_state_events', 'jsonb_has_secret_key')) = 7 then
    raise notice 'PASS K3: the history functions are executable by no API role and pin an empty search_path';
  else
    raise notice 'FAIL K3: % history function(s) exposed or with a mutable search_path', v_count;
  end if;
end $$;

rollback;
