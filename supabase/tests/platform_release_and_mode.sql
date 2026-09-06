-- Phase C -- release history and platform mode.
--
-- The invariants: platform mode history is append-only and cannot be
-- forged; only an authorised Site Admin may change the mode; and the
-- Ovalball-charges-clubs domain stays entirely separate from the
-- club-charges-its-members domain.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_nobody uuid := gen_random_uuid();
  v_event uuid;
  v_release uuid;
  v_mode text;
  v_prev text;
  v_count int;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_admin,  'sysadmin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_nobody, 'nobody@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status)
  values (v_admin, 'full', 'active');

  -- ---------- 1. the genesis event exists and reads as Beta ----------
  select mode into v_mode from public.current_platform_mode();
  if v_mode = 'beta' then
    raise notice 'PASS 1: platform mode reads as beta from the genesis event';
  else
    raise notice 'FAIL 1: expected beta, got %', coalesce(v_mode, '<null>');
  end if;

  -- ---------- 2. a stranger cannot change the mode ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_mode('live', 'should not work');
    raise notice 'FAIL 2: a non-admin changed the platform mode';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Not authorized%' then
      raise notice 'PASS 2: a non-admin cannot change the platform mode';
    else
      raise notice 'FAIL 2: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 3. a stranger cannot record a release ----------
  begin
    perform public.record_platform_release('9.9.9');
    raise notice 'FAIL 3: a non-admin recorded a release';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Not authorized%' then
      raise notice 'PASS 3: a non-admin cannot record a release';
    else
      raise notice 'FAIL 3: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 4. an authorised admin can transition beta -> live ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_event := public.set_platform_mode('live', 'Phase C test transition');
  select previous_mode into v_prev from public.platform_mode_events where id = v_event;
  select mode into v_mode from public.current_platform_mode();
  if v_event is not null and v_prev = 'beta' and v_mode = 'live' then
    raise notice 'PASS 4: beta -> live recorded, previous_mode derived as beta';
  else
    raise notice 'FAIL 4: event=%, previous=%, mode=%', v_event, coalesce(v_prev, '<null>'), coalesce(v_mode, '<null>');
  end if;

  -- ---------- 5. asking for the current mode again is a no-op ----------
  select count(*) into v_count from public.platform_mode_events;
  if public.set_platform_mode('live', 'repeat') is null then
    if (select count(*) from public.platform_mode_events) = v_count then
      raise notice 'PASS 5: setting the mode Ovalball is already in records nothing';
    else
      raise notice 'FAIL 5: a phantom transition row was written';
    end if;
  else
    raise notice 'FAIL 5: a repeated set_platform_mode returned an event id';
  end if;

  -- ---------- 6. history is append-only: UPDATE ----------
  begin
    update public.platform_mode_events set reason = 'rewritten' where id = v_event;
    raise notice 'FAIL 6: a mode event was updated';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%append-only%' then
      raise notice 'PASS 6: mode history cannot be updated';
    else
      raise notice 'FAIL 6: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 7. history is append-only: DELETE ----------
  begin
    delete from public.platform_mode_events where id = v_event;
    raise notice 'FAIL 7: a mode event was deleted';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%append-only%' then
      raise notice 'PASS 7: mode history cannot be deleted';
    else
      raise notice 'FAIL 7: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 8. previous_mode is derived, never accepted from the caller ----------
  -- Current mode is 'live'. Claim the transition came from 'live' as well
  -- as declaring a bogus predecessor; the trigger must overwrite it.
  insert into public.platform_mode_events (previous_mode, new_mode, reason)
  values ('beta', 'beta', 'forged predecessor')
  returning id into v_event;
  select previous_mode into v_prev from public.platform_mode_events where id = v_event;
  if v_prev = 'live' then
    raise notice 'PASS 8: previous_mode is derived from history, not from the caller';
  else
    raise notice 'FAIL 8: caller-supplied previous_mode survived as %', coalesce(v_prev, '<null>');
  end if;

  -- ---------- 9. only one genesis row is possible ----------
  begin
    insert into public.platform_mode_events (previous_mode, new_mode, reason)
    values (null, 'live', 'second genesis');
    -- The trigger will fill previous_mode from history, so this becomes an
    -- ordinary transition rather than a genesis row. Confirm no second row
    -- with a null predecessor exists by any route.
    select count(*) into v_count from public.platform_mode_events where previous_mode is null;
    if v_count = 1 then
      raise notice 'PASS 9: exactly one genesis event exists';
    else
      raise notice 'FAIL 9: % genesis events exist', v_count;
    end if;
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    raise notice 'FAIL 9: unexpected error -- %', v_err;
  end;

  -- ---------- 10. a release can be recorded and starts as a draft ----------
  v_release := public.record_platform_release('0.0.1-test', 'abc1234', 'Phase C test release', 'Notes.', 'production', false);
  select count(*) into v_count from public.platform_releases where id = v_release and status = 'draft';
  if v_count = 1 then
    raise notice 'PASS 10: a recorded release starts as a draft';
  else
    raise notice 'FAIL 10: release not recorded as a draft';
  end if;

  -- ---------- 11. the two payment domains share nothing ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prokind = 'f'
      and (p.proname like 'gocardless%' or p.proname like '%club_subscription%' or p.proname like '%member_price%')
      and pg_get_functiondef(p.oid) like '%platform\_%'
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 11: no club-charges-members function references the platform_ domain';
  else
    raise notice 'FAIL 11: a club-charges-members function references platform_';
  end if;

  -- ---------- 12. and nothing platform_ reaches into that domain ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prokind = 'f'
      and p.proname like '%platform_mode%'
      and (pg_get_functiondef(p.oid) like '%gocardless%'
        or pg_get_functiondef(p.oid) like '%club_subscription%')
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 12: platform mode never reads the club-charges-members domain';
  else
    raise notice 'FAIL 12: platform mode reaches into the club-charges-members domain';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
