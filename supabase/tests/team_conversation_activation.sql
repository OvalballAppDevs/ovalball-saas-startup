-- Activating a team's standing conversation (20270247000000).
--
-- The defect this file pins down first: before this migration,
-- can_send_team_conversation returned true for staff BEFORE checking whether
-- the conversation was switched on. A coach could therefore post into a
-- conversation that had never been enabled, and the families -- who fail the
-- same `active` check -- would never see it. Test 1 asserts the corrected
-- order directly: no conversation, no sending, whoever is asking.
--
-- Then: only the community capability may switch it on, the club's messaging
-- policy governs switching it ON but never OFF, and turning it on genuinely
-- opens it to the people the existing safeguarding-aware predicates admit.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/team_conversation_activation.sql
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
  v_club uuid;
  v_state record;
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

  select t.id, t.club_id into v_team, v_club from public.teams t
  where internal.has_capability('team.community.manage', 'team', t.club_id, t.id)
     or internal.has_capability('team.community.manage', 'club', t.club_id, null)
  order by t.id limit 1;

  if v_team is null then
    raise notice 'SKIP: the UAT team admin holds team.community.manage on no team here';
    return;
  end if;

  -- Start from a known-off state without destroying anything: the row may
  -- not exist at all, which is itself the "never switched on" case.
  perform set_config('role', 'postgres', true);
  delete from public.team_conversations where team_id = v_team;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- 1. THE DEFECT: STAFF CANNOT POST INTO A CONVERSATION THAT IS OFF
  -- =================================================================
  if not internal.can_send_team_conversation(v_team) then
    raise notice 'PASS 1: staff cannot post into a team conversation that was never switched on';
  else
    raise notice 'FAIL 1: staff could post into a switched-off conversation -- the families would never see it';
  end if;

  -- =================================================================
  -- 2. AUTHORITY TO SWITCH IT ON
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    perform public.set_team_conversation_active(v_team, true);
    raise notice 'FAIL 2: somebody without the community capability switched a team conversation on';
  exception when insufficient_privilege then
    raise notice 'PASS 2: only the team community capability switches a team conversation on';
  end;

  -- =================================================================
  -- 3. SWITCHING IT ON RECORDS WHO AND WHEN
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_team_conversation_active(v_team, true);

  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.team_conversations
             where team_id = v_team and active
               and enabled_by = v_admin and enabled_at is not null) then
    raise notice 'PASS 3: switching it on records the decision, the person and the moment';
  else
    raise notice 'FAIL 3: the conversation was enabled without recording who decided';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  if internal.can_send_team_conversation(v_team) then
    raise notice 'PASS 4: with the conversation open, staff may post in it';
  else
    raise notice 'FAIL 4: the conversation was switched on and staff still cannot post';
  end if;

  -- =================================================================
  -- 5. ONE READ THE UI CAN TRUST
  -- =================================================================
  select * into v_state from public.team_conversation_state(v_team);
  if v_state.active and v_state.allowed_by_policy and v_state.may_manage and v_state.may_send then
    raise notice 'PASS 5: the state read agrees with the predicates behind it';
  else
    raise notice 'FAIL 5: state read active=% policy=% manage=% send=%',
      v_state.active, v_state.allowed_by_policy, v_state.may_manage, v_state.may_send;
  end if;

  -- =================================================================
  -- 6. THE FEATURE POLICY GOVERNS OPENING, NEVER CLOSING
  -- =================================================================
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_team_conversations = false where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  if not internal.can_send_team_conversation(v_team) then
    raise notice 'PASS 6: switching the feature off stops new messages immediately';
  else
    raise notice 'FAIL 6: a switched-off feature still accepted messages';
  end if;

  -- Closing an open conversation must keep working even now: otherwise a
  -- club could be left with a conversation it cannot shut.
  begin
    perform public.set_team_conversation_active(v_team, false);
    raise notice 'PASS 7: a club can always close a conversation it has already opened';
  exception when others then
    raise notice 'FAIL 7: closing an open conversation was refused (%)', sqlerrm;
  end;

  begin
    perform public.set_team_conversation_active(v_team, true);
    raise notice 'FAIL 8: a conversation was opened while the feature was switched off';
  exception when insufficient_privilege then
    raise notice 'PASS 8: a conversation cannot be opened while the feature is switched off';
  end;

  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_team_conversations = true where club_id is null;

  if exists (select 1 from public.team_conversations
             where team_id = v_team and not active and disabled_by = v_admin and disabled_at is not null) then
    raise notice 'PASS 9: closing it records who closed it and when, rather than deleting the record';
  else
    raise notice 'FAIL 9: closing the conversation did not record the decision';
  end if;
end $$;

rollback;
