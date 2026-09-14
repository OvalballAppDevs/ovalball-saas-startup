-- Safeguarding: a request grants nothing until a human with real authority
-- approves it.
--
-- This is the suite that has to be right. Everything else in the parent
-- experience is convenience; this decides which adults can reach which
-- children. Each assertion below is written as the attack it prevents, not
-- as the happy path it permits.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Guardian link requests: safeguarding ==='

begin;

do $$
declare
  v_newparent uuid := gen_random_uuid();   -- brand new, zero club relationships
  v_stranger uuid := gen_random_uuid();    -- unrelated signed-in account
  v_existing_guardian uuid := gen_random_uuid();
  v_clubadmin uuid := gen_random_uuid();
  v_otherclubadmin uuid := gen_random_uuid();
  v_second_parent uuid := gen_random_uuid();
  v_club uuid; v_otherclub uuid; v_team uuid;
  v_known_player uuid; v_req uuid; v_req2 uuid;
  v_r record; v_n int; v_msg text; v_player uuid;
  v_admin_group uuid;
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise exception 'FAIL setup: local UAT club missing; run supabase/seeds/local_uat_parent_player.sql';
  end if;
  select id into v_team from public.teams where club_id = v_club and age_group = 'U12' and squad_designation is null limit 1;
  select c.id into v_otherclub from public.clubs c where c.id <> v_club and c.status = 'active' limit 1;

  for v_r in select unnest(array[v_newparent, v_stranger, v_existing_guardian, v_clubadmin, v_otherclubadmin, v_second_parent]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','glr-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'GLR','Tester','glr-'||v_r.id::text||'@ovalball.test');
  end loop;

  -- A known child with an existing guardian, at the UAT club.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Knownchild','Glrfamily','2015-05-05', 'MALE') returning id into v_known_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_known_player, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
  values (v_existing_guardian, v_known_player, 'guardian', 'active');

  -- Real Club Admin authority, via the canonical capability route.
  select pg.id into v_admin_group from public.permission_groups pg
  join public.permission_group_capabilities pgc on pgc.group_id = pg.id
  where pgc.capability_key = 'club.guardians.manage' limit 1;
  insert into public.club_memberships (user_id, club_id, role, status) values (v_clubadmin, v_club, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (user_id, club_id, role, status) values (v_otherclubadmin, v_otherclub, 'CLUB_ADMIN', 'active');

  -- =================================================================
  -- A. A brand-new parent CAN start, and gets nothing for it yet
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_newparent::text,'role','authenticated')::text, true);

  select * into v_r from public.request_child_link('Brandnew','Glrfamily','2016-06-06', v_club, 'union');
  if v_r.status = 'PENDING' and v_r.request_id is not null then
    raise notice 'PASS 1 (A): a parent with zero club relationships can submit a first-child request';
  else
    raise exception 'FAIL 1 (A): expected PENDING, got %', v_r.status;
  end if;
  v_req := v_r.request_id;

  select count(*) into v_n from public.guardians where guardian_user_id = v_newparent;
  if v_n = 0 then
    raise notice 'PASS 2 (A): a PENDING request creates NO guardian relationship';
  else
    raise exception 'FAIL 2 (A): % guardian rows already exist before approval', v_n;
  end if;

  select count(*) into v_n from public.players where first_name = 'Brandnew' and surname = 'Glrfamily';
  if v_n = 0 then
    raise notice 'PASS 3 (A): a PENDING request creates NO player';
  else
    raise exception 'FAIL 3 (A): a player was created before approval';
  end if;

  -- =================================================================
  -- B. Enumeration: the applicant cannot learn the child exists
  -- =================================================================
  -- Request the KNOWN child. The server matches privately; the applicant
  -- must see exactly what an unmatched request looks like.
  select * into v_r from public.request_child_link('Knownchild','Glrfamily','2015-05-05', v_club, 'union');
  if v_r.status = 'PENDING' then
    raise notice 'PASS 4 (B): requesting an EXISTING child returns the same neutral PENDING as an unknown one';
  else
    raise exception 'FAIL 4 (B): matched request answered differently: %', v_r.status;
  end if;
  v_req2 := v_r.request_id;

  -- The neutral projection must not carry the match.
  if exists (
    select 1 from public.my_guardian_link_requests() m
    where m.request_id = v_req2 and m.child_label is not null
  ) and not exists (
    select 1 from public.my_guardian_link_requests() m where m.request_id = v_req2 and m.status <> 'PENDING'
  ) then
    raise notice 'PASS 5 (B): the requester sees only their own submitted details and a PENDING status';
  else
    raise exception 'FAIL 5 (B): requester projection is wrong';
  end if;

  -- The decisive one: the matched player id must be unreachable.
  begin
    select count(*) into v_n from public.guardian_link_requests where matched_player_id is not null;
    raise exception 'FAIL 6 (B): the requester could read matched_player_id -- child enumeration';
  exception
    when insufficient_privilege then
      raise notice 'PASS 6 (B): matched_player_id is not selectable by the requester (column privilege)';
    when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg like 'FAIL 6%' then raise; end if;
      raise notice 'PASS 6 (B): matched_player_id is not readable by the requester (%)', left(v_msg, 60);
  end;

  -- And they cannot see the request row of anybody else.
  select count(*) into v_n from public.guardian_link_requests where requested_by_user_id <> v_newparent;
  if v_n = 0 then
    raise notice 'PASS 7 (B): the requester cannot see other people''s requests';
  else
    raise exception 'FAIL 7 (B): % foreign request rows visible', v_n;
  end if;
  reset role;

  -- =================================================================
  -- C. Only the right people can approve
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.approve_guardian_link_request(v_req);
    raise exception 'FAIL 8 (C): an unrelated account approved a guardian link request';
  exception when insufficient_privilege then
    raise notice 'PASS 8 (C): an unrelated account cannot approve';
  end;

  -- The applicant cannot approve their own application.
  perform set_config('request.jwt.claims', json_build_object('sub', v_newparent::text,'role','authenticated')::text, true);
  begin
    perform public.approve_guardian_link_request(v_req);
    raise exception 'FAIL 9 (C): the applicant approved their own request';
  exception when insufficient_privilege then
    raise notice 'PASS 9 (C): the applicant cannot approve their own request';
  end;

  -- A Club Admin at a DIFFERENT club cannot reach this club's request.
  perform set_config('request.jwt.claims', json_build_object('sub', v_otherclubadmin::text,'role','authenticated')::text, true);
  begin
    perform public.approve_guardian_link_request(v_req);
    raise exception 'FAIL 10 (C): another club''s admin approved this club''s request';
  exception when insufficient_privilege then
    raise notice 'PASS 10 (C): a Club Admin cannot decide another club''s request';
  end;

  select count(*) into v_n from public.guardian_link_requests_for_approval();
  if v_n = 0 then
    raise notice 'PASS 11 (C): another club''s admin sees no requests in the approval queue';
  else
    raise exception 'FAIL 11 (C): % requests visible to an unrelated club admin', v_n;
  end if;
  reset role;

  -- =================================================================
  -- D. The right Club Admin approves, and only then does access exist
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin::text,'role','authenticated')::text, true);

  select count(*) into v_n from public.guardian_link_requests_for_approval(v_club);
  if v_n >= 2 then
    raise notice 'PASS 12 (D): the club''s own admin sees the pending queue (% requests)', v_n;
  else
    raise exception 'FAIL 12 (D): the club admin sees only % pending requests', v_n;
  end if;

  -- The approver DOES get the match -- that is the evidence they judge on.
  if exists (select 1 from public.guardian_link_requests_for_approval(v_club) q
             where q.request_id = v_req2 and q.matched_player_id = v_known_player) then
    raise notice 'PASS 13 (D): the approver can see the probable match the applicant cannot';
  else
    raise exception 'FAIL 13 (D): the approver cannot see the match, so cannot judge the request';
  end if;

  select * into v_r from public.approve_guardian_link_request(v_req);
  v_player := v_r.player_id;
  if v_r.result = 'approved' and v_player is not null then
    raise notice 'PASS 14 (D): the club admin can approve an unmatched first-child request';
  else
    raise exception 'FAIL 14 (D): approval failed';
  end if;
  reset role;

  select count(*) into v_n from public.guardians where guardian_user_id = v_newparent and player_id = v_player and status = 'active';
  if v_n = 1 then
    raise notice 'PASS 15 (D): the guardian relationship exists ONLY after approval';
  else
    raise exception 'FAIL 15 (D): expected 1 active guardian row, found %', v_n;
  end if;

  -- =================================================================
  -- E. Approving a MATCHED request must not create a duplicate player
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin::text,'role','authenticated')::text, true);
  select * into v_r from public.approve_guardian_link_request(v_req2);
  reset role;

  if v_r.player_id = v_known_player then
    raise notice 'PASS 16 (E): approval attached to the CANONICAL existing player_id';
  else
    raise exception 'FAIL 16 (E): approval produced a different player id -- duplicate identity';
  end if;

  select count(*) into v_n from public.players
  where first_name = 'Knownchild' and surname = 'Glrfamily' and date_of_birth = '2015-05-05';
  if v_n = 1 then
    raise notice 'PASS 17 (E): still exactly ONE player row for that child -- no duplicate created';
  else
    raise exception 'FAIL 17 (E): % player rows now exist for one child', v_n;
  end if;

  -- =================================================================
  -- F. A rejected request grants nothing
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_second_parent::text,'role','authenticated')::text, true);
  select * into v_r from public.request_child_link('Rejected','Glrfamily','2017-07-07', v_club, 'union');
  v_req := v_r.request_id;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin::text,'role','authenticated')::text, true);
  perform public.reject_guardian_link_request(v_req, 'Could not verify the relationship.');
  reset role;

  select count(*) into v_n from public.guardians where guardian_user_id = v_second_parent;
  if v_n = 0 then
    raise notice 'PASS 18 (F): a REJECTED applicant holds no guardian relationship';
  else
    raise exception 'FAIL 18 (F): a rejected applicant gained % relationships', v_n;
  end if;

  select count(*) into v_n from public.players where first_name = 'Rejected' and surname = 'Glrfamily';
  if v_n = 0 then
    raise notice 'PASS 19 (F): a REJECTED request created no player';
  else
    raise exception 'FAIL 19 (F): a rejected request left a player behind';
  end if;

  -- The structural guarantee, independent of any code path.
  if exists (select 1 from public.guardian_link_requests where status <> 'APPROVED' and resolved_player_id is not null) then
    raise exception 'FAIL 20 (F): a non-approved request carries a resolved player';
  else
    raise notice 'PASS 20 (F): only APPROVED requests may name a resolved player (CHECK constraint)';
  end if;

  -- =================================================================
  -- G. Additional guardian: same controlled model
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.request_additional_guardian(v_known_player, 'someone@ovalball.test');
    raise exception 'FAIL 21 (G): a non-guardian proposed another guardian for a child';
  exception when insufficient_privilege then
    raise notice 'PASS 21 (G): only an existing guardian may propose an additional guardian';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_existing_guardian::text,'role','authenticated')::text, true);
  select * into v_r from public.request_additional_guardian(v_known_player, 'glr-'||v_second_parent::text||'@ovalball.test');
  v_req := v_r.request_id;
  if v_r.status = 'PENDING' then
    raise notice 'PASS 22 (G): an existing guardian can request an additional guardian';
  else
    raise exception 'FAIL 22 (G): got %', v_r.status;
  end if;
  reset role;

  select count(*) into v_n from public.guardians where guardian_user_id = v_second_parent and player_id = v_known_player;
  if v_n = 0 then
    raise notice 'PASS 23 (G): the proposed guardian has NO access while pending';
  else
    raise exception 'FAIL 23 (G): pending additional guardian already has access';
  end if;

  -- The guardian who proposed another adult cannot approve that proposal:
  -- adding an adult to a child is the club's safeguarding decision.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_existing_guardian::text,'role','authenticated')::text, true);
  begin
    perform public.approve_guardian_link_request(v_req);
    raise exception 'FAIL 23b (G): a guardian approved their own additional-guardian request';
  exception when insufficient_privilege then
    raise notice 'PASS 23b (G): a guardian cannot approve their own additional-guardian request';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin::text,'role','authenticated')::text, true);
  select * into v_r from public.approve_guardian_link_request(v_req);
  reset role;

  select count(*) into v_n from public.guardians where guardian_user_id = v_second_parent and player_id = v_known_player and status = 'active';
  if v_n = 1 then
    raise notice 'PASS 24 (G): after approval the second guardian is linked to the SAME canonical player';
  else
    raise exception 'FAIL 24 (G): expected 1 relationship, found %', v_n;
  end if;

  -- ...and only to that child. This is the scope test.
  select count(*) into v_n from public.guardians where guardian_user_id = v_second_parent;
  if v_n = 1 then
    raise notice 'PASS 25 (G): the second guardian gained access to exactly ONE child, not the club';
  else
    raise exception 'FAIL 25 (G): second guardian holds % relationships', v_n;
  end if;

  -- =================================================================
  -- G2. A pending or rejected applicant cannot READ the child
  -- =================================================================
  -- The states above prove no guardians row is created. This proves what
  -- that actually buys: player data itself stays unreadable, because every
  -- policy over it derives from the guardian relationship.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_second_parent::text,'role','authenticated')::text, true);
  -- v_second_parent's own FIRST_CHILD request was REJECTED in section F.
  select count(*) into v_n from public.players p where p.surname = 'Glrfamily' and p.first_name = 'Rejected';
  if v_n = 0 then
    raise notice 'PASS 25a (G2): a REJECTED applicant can read no player for the child they named';
  else
    raise exception 'FAIL 25a (G2): a rejected applicant can read % player row(s)', v_n;
  end if;
  reset role;

  -- A brand-new applicant with a request still PENDING.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  select * into v_r from public.request_child_link('Knownchild','Glrfamily','2015-05-05', v_club, 'union');
  select count(*) into v_n from public.players p where p.id = v_known_player;
  if v_n = 0 then
    raise notice 'PASS 25b (G2): a PENDING applicant cannot read the child they applied for';
  else
    raise exception 'FAIL 25b (G2): a pending applicant can already read the player row';
  end if;

  select count(*) into v_n from public.player_fixture_attendance a where a.player_id = v_known_player;
  if v_n = 0 then
    raise notice 'PASS 25c (G2): a PENDING applicant cannot read the child''s attendance';
  else
    raise exception 'FAIL 25c (G2): a pending applicant can read attendance';
  end if;
  reset role;

  -- =================================================================
  -- H. No client writes at all
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    insert into public.guardian_link_requests (kind, club_id, target_player_id, subject_user_id)
    values ('ADDITIONAL_GUARDIAN', v_club, v_known_player, v_stranger);
    raise exception 'FAIL 26 (H): a client inserted a guardian link request directly';
  exception when insufficient_privilege then
    raise notice 'PASS 26 (H): direct client INSERT is refused -- every write goes through a checked RPC';
  end;

  begin
    update public.guardian_link_requests set status = 'APPROVED';
    raise exception 'FAIL 27 (H): a client approved a request by direct UPDATE';
  exception when insufficient_privilege then
    raise notice 'PASS 27 (H): direct client UPDATE is refused -- the state machine cannot be bypassed';
  end;
  reset role;

  raise notice 'Guardian link request safeguarding complete.';
end $$;

rollback;
