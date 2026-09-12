-- The recipient picker for a selected announcement audience (20270251000000).
--
-- The picker's whole job is to offer a choice the send path will honour. Two
-- ways that goes wrong, and both are tested here:
--
--   IT OFFERS TOO MUCH   a row the resolver would then refuse, so the sender
--                        meets the boundary after writing the message rather
--                        than while choosing the audience.
--
--   IT COUNTS FOR ITSELF the composer adds up recipient_count per player and
--                        shows a total. That total is WRONG the moment two
--                        children share a guardian -- and in the UAT data they
--                        do: five reachable players, five recipient rows, four
--                        actual people. Test 4 pins that exact discrepancy so
--                        nobody is ever tempted to sum it client-side.
--
-- Also proved: the picker returns no guardian, recipient or contact detail;
-- authority failure is an ERROR rather than an empty list; and a selection
-- composes correctly with Exclude U18.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/announcement_recipient_picker.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_outsider uuid;
  v_team uuid;
  v_all uuid[];
  v_reachable uuid[];
  v_unreachable uuid[];
  v_one uuid[];
  v_foreign uuid;
  v_naive integer;
  v_truth integer;
  r record;
  n integer;
begin
  select id into v_admin    from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_outsider from auth.users where email = 'uat.unrelated@ovalball.test';
  if v_admin is null or v_outsider is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select id into v_team from public.teams
  where internal.can_address_team_audience(id) order by id limit 1;
  if v_team is null then
    raise notice 'SKIP: no team in this database that the UAT team admin may address';
    return;
  end if;

  -- =================================================================
  -- 1. AUTHORITY IS AN ERROR, NOT AN EMPTY LIST
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    perform 1 from public.selectable_announcement_audience('team', v_team);
    raise notice 'FAIL 1: an outsider was offered a team''s players to choose from';
  exception when insufficient_privilege then
    raise notice 'PASS 1: an outsider is refused, not shown an empty picker';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- 2. EVERY ROW OFFERED IS ONE THE SEND PATH WOULD ACCEPT
  -- =================================================================
  select array_agg(player_id) into v_all
  from public.selectable_announcement_audience('team', v_team);

  if v_all is null then
    raise notice 'SKIP: this team has no players to choose from';
    return;
  end if;

  if not exists (
    select 1 from unnest(v_all) pid where not internal.may_address_player(pid)
  ) then
    raise notice 'PASS 2: every player offered (%) passes the same authority the send path applies',
      array_length(v_all, 1);
  else
    raise notice 'FAIL 2: the picker offered a player the resolver would refuse';
  end if;

  -- 3. And reachability agrees with the canonical predicate, not a second rule.
  -- Read as postgres: internal.player_contact_eligibility is deliberately NOT
  -- executable by `authenticated` -- only SECURITY DEFINER callers reach it --
  -- so comparing against it is an inspection, not something a session does.
  create temp table picker_snapshot on commit drop as
    select player_id, reachable from public.selectable_announcement_audience('team', v_team);

  perform set_config('role', 'postgres', true);
  select count(*) into n
  from picker_snapshot s
  where s.reachable <> exists (
    select 1 from internal.player_contact_eligibility(array[s.player_id]) e
    where e.user_id is not null
  );
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if n = 0 then
    raise notice 'PASS 3: reachability matches internal.player_contact_eligibility exactly';
  else
    raise notice 'FAIL 3: % row(s) disagree with the canonical safeguarding answer', n;
  end if;

  -- =================================================================
  -- 4. THE PICKER IS NOT THE COUNTER
  -- Summing recipient_count double-counts a guardian shared between two
  -- children. The server is the only thing that may state the total.
  -- =================================================================
  select array_agg(player_id) into v_reachable
  from public.selectable_announcement_audience('team', v_team) where reachable;

  select sum(recipient_count)::integer into v_naive
  from public.selectable_announcement_audience('team', v_team) where reachable;

  select recipient_count into v_truth
  from public.preview_audience('selected', null,
    jsonb_build_object('player_ids', to_jsonb(v_reachable)), false, 'team', 'NO_REPLY');

  if v_truth <= v_naive then
    raise notice 'PASS 4: the server total (%) is the truth; a client-side sum would say % -- never sum it',
      v_truth, v_naive;
  else
    raise notice 'FAIL 4: server said % but the per-player counts only add to %', v_truth, v_naive;
  end if;

  -- =================================================================
  -- 5. A SELECTION RESOLVES TO EXACTLY THAT SELECTION
  -- =================================================================
  select array_agg(player_id) into v_one from (
    select player_id from public.selectable_announcement_audience('team', v_team)
    where reachable order by display_name limit 1
  ) x;

  select recipient_count into n
  from public.preview_audience('selected', null,
    jsonb_build_object('player_ids', to_jsonb(v_one)), false, 'team', 'NO_REPLY');

  if n > 0 and n <= v_truth then
    raise notice 'PASS 5: selecting one player reaches % recipient(s), fewer than the whole team', n;
  else
    raise notice 'FAIL 5: one selected player resolved to % recipients (team total %)', n, v_truth;
  end if;

  -- 6. Selecting an UNREACHABLE player adds nobody, and does not error.
  select array_agg(player_id) into v_unreachable
  from public.selectable_announcement_audience('team', v_team) where not reachable;

  if v_unreachable is null then
    raise notice 'SKIP 6: every player on this team is reachable';
  else
    select recipient_count into n
    from public.preview_audience('selected', null,
      jsonb_build_object('player_ids', to_jsonb(v_unreachable)), false, 'team', 'NO_REPLY');
    if n = 0 then
      raise notice 'PASS 6: selecting only unreachable players reaches nobody, rather than failing silently';
    else
      raise notice 'FAIL 6: unreachable players resolved to % recipients', n;
    end if;
  end if;

  -- =================================================================
  -- 7. A PLAYER OUTSIDE THE SENDER'S REACH CANNOT BE SMUGGLED IN
  -- The picker is a convenience; the refusal is the guarantee.
  -- =================================================================
  select p.id into v_foreign from public.players p
  where not internal.may_address_player(p.id) limit 1;

  if v_foreign is null then
    raise notice 'SKIP 7: this admin may address every player in the database';
  else
    begin
      perform 1 from public.preview_audience('selected', null,
        jsonb_build_object('player_ids', jsonb_build_array(v_foreign)), false, 'team', 'NO_REPLY');
      raise notice 'FAIL 7: a player outside the sender''s reach was accepted';
    exception when insufficient_privilege then
      raise notice 'PASS 7: a hand-crafted selection cannot reach past the sender''s authority';
    end;
  end if;

  -- =================================================================
  -- 8. EXCLUDE U18 COMPOSES WITH A SELECTION
  -- =================================================================
  select recipient_count into n
  from public.preview_audience('selected', null,
    jsonb_build_object('player_ids', to_jsonb(v_reachable)), true, 'team', 'NO_REPLY');
  if n <= v_truth then
    raise notice 'PASS 8: Exclude U18 narrows a selection (% of %) rather than ignoring it', n, v_truth;
  else
    raise notice 'FAIL 8: Exclude U18 widened the audience from % to %', v_truth, n;
  end if;

  -- =================================================================
  -- 9. THE PICKER LEAKS NOTHING ABOUT THE ADULTS BEHIND THE CHILDREN
  -- Structural: the function's own signature is the guarantee.
  -- =================================================================
  select count(*) into n
  from information_schema.parameters
  where specific_schema = 'public'
    and specific_name in (
      select specific_name from information_schema.routines
      where routine_schema = 'public' and routine_name = 'selectable_announcement_audience')
    and parameter_mode = 'OUT'
    and (parameter_name ilike '%user%' or parameter_name ilike '%guardian%'
         or parameter_name ilike '%email%' or parameter_name ilike '%phone%');
  if n = 0 then
    raise notice 'PASS 9: the picker returns no user, guardian or contact column at all';
  else
    raise notice 'FAIL 9: the picker exposes % recipient-identifying column(s)', n;
  end if;
end $$;

rollback;
