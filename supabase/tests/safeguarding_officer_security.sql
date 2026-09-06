-- Safeguarding Officer -- security and tamper matrix.
--
-- The feature's own foundation suite proves the happy paths. This one is
-- adversarial: it assumes the caller lies about every id they can, and
-- checks that the database refuses anyway.
--
-- The recurring theme is that a Safeguarding Officer assignment is a CLUB
-- record. Every id a browser can supply -- officer, club, invitation token,
-- conversation -- must be re-checked against the caller's real authority at
-- the caller's real club, never accepted as a pairing.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin_a uuid := gen_random_uuid();   -- Club Admin, club A
  v_admin_b uuid := gen_random_uuid();   -- Club Admin, club B
  v_coach   uuid := gen_random_uuid();   -- ordinary member, club A
  v_officer uuid := gen_random_uuid();   -- the accepted officer at club A
  v_site    uuid := gen_random_uuid();
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_off_a uuid; v_off_b uuid;
  v_conv uuid; v_token text; v_count int; v_text text; v_uuid uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin_a,'sgadmina@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin_b,'sgadminb@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_coach,  'sgcoach@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_officer,'sgofficer@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_site,   'sgsite@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin_a,'SG','AdminA','sgadmina@ovalball-test.invalid'),
    (v_admin_b,'SG','AdminB','sgadminb@ovalball-test.invalid'),
    (v_coach,'SG','Coach','sgcoach@ovalball-test.invalid'),
    (v_officer,'SG','Officer','sgofficer@ovalball-test.invalid'),
    (v_site,'SG','Site','sgsite@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('SG Test A RUFC','union','England','England','manual','verified','sg-test-a'),
    ('SG Test B RUFC','union','England','England','manual','verified','sg-test-b');
  select id into v_dir_a from public.club_directory where normalized_key='sg-test-a';
  select id into v_dir_b from public.club_directory where normalized_key='sg-test-b';
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'sg-test-a','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'sg-test-b','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN','active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN','active'),
    (v_club_a, v_coach,   'BASIC_USER','active');

  -- =================================================================
  -- A. Nomination is club-scoped authority, not a club_id argument
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated', 'email','sgadmina@ovalball-test.invalid')::text, true);
  perform public.nominate_safeguarding_officer(v_club_a, 'primary', 'Alex Primary', 'alex.primary@ovalball-test.invalid');
  select id into v_off_a from public.club_safeguarding_officers where club_id = v_club_a and officer_type = 'primary';
  if v_off_a is not null then
    raise notice 'PASS 1 (A): a Club Admin can nominate their own club''s officer';
  else
    raise notice 'FAIL 1 (A): nomination did not create an assignment';
  end if;

  -- Club A's admin naming club B in the argument must be refused.
  begin
    perform public.nominate_safeguarding_officer(v_club_b, 'primary', 'Intruder', 'intruder@ovalball-test.invalid');
    raise notice 'FAIL 2 (A): club A nominated an officer at club B';
  exception when others then
    raise notice 'PASS 2 (A): a supplied club_id does not grant authority at that club';
  end;

  -- An ordinary member of the same club cannot nominate at all.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated', 'email','sgcoach@ovalball-test.invalid')::text, true);
  begin
    perform public.nominate_safeguarding_officer(v_club_a, 'deputy', 'Coach Pick', 'coachpick@ovalball-test.invalid');
    raise notice 'FAIL 3 (A): an ordinary member nominated an officer';
  exception when others then
    raise notice 'PASS 3 (A): an ordinary member cannot nominate an officer';
  end;

  -- =================================================================
  -- B. Primary uniqueness, and the person survives deactivation
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated', 'email','sgadmina@ovalball-test.invalid')::text, true);
  begin
    perform public.nominate_safeguarding_officer(v_club_a, 'primary', 'Second Primary', 'second@ovalball-test.invalid');
    select count(*) into v_count from public.club_safeguarding_officers
    where club_id = v_club_a and officer_type = 'primary' and status <> 'inactive';
    if v_count = 1 then
      raise notice 'PASS 4 (B): a club still has exactly one active Primary after a re-nomination';
    else
      raise notice 'FAIL 4 (B): % active Primary assignments', v_count;
    end if;
  exception when others then
    -- Refusing outright is equally correct.
    raise notice 'PASS 4 (B): a second active Primary is refused';
  end;

  -- A deputy is a separate slot, not a competing primary.
  perform public.nominate_safeguarding_officer(v_club_a, 'deputy', 'Dana Deputy', 'dana.deputy@ovalball-test.invalid');
  select count(*) into v_count from public.club_safeguarding_officers
  where club_id = v_club_a and status <> 'inactive';
  if v_count = 2 then
    raise notice 'PASS 5 (B): primary and deputy coexist as distinct assignments';
  else
    raise notice 'FAIL 5 (B): % active assignments', v_count;
  end if;

  -- =================================================================
  -- C. Contact is not authorization
  -- =================================================================
  select id into v_off_a from public.club_safeguarding_officers
  where club_id = v_club_a and officer_type = 'primary' and status <> 'inactive';

  select status, user_id into v_text, v_uuid from public.club_safeguarding_officers where id = v_off_a;
  if v_text <> 'active' and v_uuid is null then
    raise notice 'PASS 6 (C): a nominated officer holds no Ovalball identity and is not active';
  else
    raise notice 'FAIL 6 (C): status=% user=%', v_text, v_uuid;
  end if;

  -- A merely-nominated officer's email address grants that person nothing,
  -- even once they hold an Ovalball account.
  update public.club_safeguarding_officers set contact_email = 'sgofficer@ovalball-test.invalid' where id = v_off_a;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer, 'role','authenticated', 'email','sgofficer@ovalball-test.invalid')::text, true);
  if not internal.has_capability('club.safeguarding.view', 'club', v_club_a) then
    raise notice 'PASS 7 (C): a matching email address alone grants no capability';
  else
    raise notice 'FAIL 7 (C): an email address granted safeguarding authority';
  end if;

  -- =================================================================
  -- D. Invitation lifecycle
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated', 'email','sgadmina@ovalball-test.invalid')::text, true);
  select token into v_token from public.invite_safeguarding_officer(v_off_a);
  if v_token is not null then
    raise notice 'PASS 8 (D): an invitation issues a token';
  else
    raise notice 'FAIL 8 (D): no token issued';
  end if;

  -- A pending invitation still grants nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer, 'role','authenticated', 'email','sgofficer@ovalball-test.invalid')::text, true);
  if not internal.has_capability('club.safeguarding.view', 'club', v_club_a) then
    raise notice 'PASS 9 (D): a pending invitation grants no capability';
  else
    raise notice 'FAIL 9 (D): a pending invitation granted authority';
  end if;

  -- A random token is refused.
  begin
    perform public.accept_safeguarding_officer_invitation('not-a-real-token-000000000000');
    raise notice 'FAIL 10 (D): a random token was accepted';
  exception when others then
    raise notice 'PASS 10 (D): a random token is refused';
  end;

  -- Another club's admin cannot invite against club A's assignment.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated', 'email','sgadminb@ovalball-test.invalid')::text, true);
  begin
    perform public.invite_safeguarding_officer(v_off_a);
    raise notice 'FAIL 11 (D): club B issued an invitation for club A''s officer';
  exception when others then
    raise notice 'PASS 11 (D): a cross-club invitation is refused';
  end;

  -- The wrong signed-in person cannot accept someone else's token.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated', 'email','sgcoach@ovalball-test.invalid')::text, true);
  begin
    perform public.accept_safeguarding_officer_invitation(v_token);
    raise notice 'FAIL 12 (D): the wrong account accepted an invitation';
  exception when others then
    raise notice 'PASS 12 (D): only the invited email may accept';
  end;

  -- The right person accepts, binding the EXISTING canonical user.
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer, 'role','authenticated', 'email','sgofficer@ovalball-test.invalid')::text, true);
  perform public.accept_safeguarding_officer_invitation(v_token);
  select user_id, status into v_uuid, v_text from public.club_safeguarding_officers where id = v_off_a;
  if v_uuid = v_officer and v_text = 'active' then
    raise notice 'PASS 13 (D): acceptance binds the existing canonical user and activates';
  else
    raise notice 'FAIL 13 (D): user=% status=%', v_uuid, v_text;
  end if;

  select count(*) into v_count from public.profiles where email = 'sgofficer@ovalball-test.invalid';
  if v_count = 1 then
    raise notice 'PASS 14 (D): acceptance created no second person';
  else
    raise notice 'FAIL 14 (D): % profiles for the officer', v_count;
  end if;

  -- Replay: the same token cannot be used twice.
  begin
    perform public.accept_safeguarding_officer_invitation(v_token);
    raise notice 'FAIL 15 (D): a used token was accepted again';
  exception when others then
    raise notice 'PASS 15 (D): a used invitation cannot be replayed';
  end;

  -- =================================================================
  -- E. The accepted officer gets ONLY safeguarding authority
  -- =================================================================
  -- Pinning the ACTUAL rule, which is maximally least-privilege: accepting
  -- an invitation grants the ordinary member defaults and nothing else.
  -- Every safeguarding-specific authority is a per-person Site Admin
  -- override. Recorded so that if a future change starts auto-granting an
  -- officer capability on acceptance, that is a deliberate decision which
  -- breaks this test rather than a silent widening.
  --
  -- Product note carried into the report: this also means an accepted
  -- officer cannot open /club/settings/safeguarding until a Site Admin
  -- grants them something. Their message thread stays reachable regardless,
  -- because the conversation RLS keys on officer_user_id, not a capability.
  if internal.has_capability('club.view', 'club', v_club_a)
     and not internal.has_capability('club.safeguarding.view', 'club', v_club_a) then
    raise notice 'PASS 16 (E): acceptance grants ordinary member defaults only, no safeguarding capability';
  else
    raise notice 'FAIL 16 (E): acceptance granted more (or less) than the member defaults';
  end if;

  if not internal.has_capability('club.edit_profile', 'club', v_club_a)
     and not internal.has_capability('club.teams.manage', 'club', v_club_a)
     and not internal.has_capability('club.platform_billing.view', 'club', v_club_a)
     and not internal.has_capability('club.guardians.manage', 'club', v_club_a)
     and not internal.has_capability('club.subscription.view_finance', 'club', v_club_a) then
    raise notice 'PASS 17 (E): an officer receives no club admin, finance or guardian authority';
  else
    raise notice 'FAIL 17 (E): an officer picked up unrelated club authority';
  end if;

  -- And nothing at all at another club.
  if not internal.has_capability('club.safeguarding.view', 'club', v_club_b) then
    raise notice 'PASS 18 (E): an officer at club A has no authority at club B';
  else
    raise notice 'FAIL 18 (E): officer authority leaked across clubs';
  end if;

  -- The per-officer capabilities are NOT automatic -- they are granted
  -- individually by a Site Admin through the override layer.
  if not internal.has_capability('club.dispensation.view', 'club', v_club_a)
     and not internal.has_capability('club.dispensation.notify', 'club', v_club_a) then
    raise notice 'PASS 19 (E): dispensation capabilities are not automatic on acceptance';
  else
    raise notice 'FAIL 19 (E): acceptance auto-granted dispensation capabilities';
  end if;

  -- =================================================================
  -- F. Messaging privacy
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated', 'email','sgadmina@ovalball-test.invalid')::text, true);
  select conversation_id into v_conv
  from public.start_or_get_safeguarding_officer_conversation(v_club_a, v_off_a, 'First safeguarding message.');
  if v_conv is not null then
    raise notice 'PASS 20 (F): an authorized club actor can open a safeguarding conversation';
  else
    raise notice 'FAIL 20 (F): conversation not created';
  end if;

  -- Opening again returns the same thread rather than a duplicate.
  select conversation_id into v_uuid
  from public.start_or_get_safeguarding_officer_conversation(v_club_a, v_off_a, 'Second message.');
  select count(*) into v_count from public.club_safeguarding_officer_conversations
  where club_id = v_club_a and requester_user_id = v_admin_a;
  if v_uuid = v_conv and v_count = 1 then
    raise notice 'PASS 21 (F): re-opening returns the same thread, not a duplicate';
  else
    raise notice 'FAIL 21 (F): % threads exist', v_count;
  end if;

  -- Another club's admin cannot open a thread against club A's officer,
  -- however they shape the arguments.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated', 'email','sgadminb@ovalball-test.invalid')::text, true);
  begin
    perform public.start_or_get_safeguarding_officer_conversation(v_club_a, v_off_a, 'Cross-club probe.');
    raise notice 'FAIL 22 (F): club B opened a thread at club A';
  exception when others then
    raise notice 'PASS 22 (F): a cross-club safeguarding conversation is refused';
  end;

  -- Passing their OWN club id with club A's officer is also refused.
  begin
    perform public.start_or_get_safeguarding_officer_conversation(v_club_b, v_off_a, 'Mismatched pairing.');
    raise notice 'FAIL 23 (F): a mismatched club/officer pairing was accepted';
  exception when others then
    raise notice 'PASS 23 (F): a mismatched club/officer pairing is refused';
  end;

  -- An ordinary member cannot read the thread.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated', 'email','sgcoach@ovalball-test.invalid')::text, true);
  -- `set local role authenticated` matters: as the owning superuser RLS is
  -- bypassed entirely and this would assert nothing at all.
  set local role authenticated;
  select count(*) into v_count from public.club_safeguarding_officer_conversations where id = v_conv;
  reset role;
  if v_count = 0 then
    raise notice 'PASS 24 (F): an ordinary member cannot read a safeguarding thread';
  else
    raise notice 'FAIL 24 (F): an ordinary member read the thread';
  end if;

  -- Club B's admin cannot read it either.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated', 'email','sgadminb@ovalball-test.invalid')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.club_safeguarding_officer_conversations where id = v_conv;
  reset role;
  if v_count = 0 then
    raise notice 'PASS 25 (F): another club cannot read the thread';
  else
    raise notice 'FAIL 25 (F): cross-club thread read succeeded';
  end if;

  -- =================================================================
  -- G. Deactivation removes authority, keeps the person
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated', 'email','sgadmina@ovalball-test.invalid')::text, true);
  perform public.deactivate_safeguarding_officer(v_off_a);

  perform set_config('request.jwt.claims', json_build_object('sub', v_officer, 'role','authenticated', 'email','sgofficer@ovalball-test.invalid')::text, true);
  if not internal.has_capability('club.safeguarding.view', 'club', v_club_a) then
    raise notice 'PASS 26 (G): a deactivated officer loses safeguarding authority';
  else
    raise notice 'FAIL 26 (G): a deactivated officer kept authority';
  end if;

  select count(*) into v_count from public.profiles where id = v_officer;
  if v_count = 1 then
    raise notice 'PASS 27 (G): deactivating an assignment does not delete the person';
  else
    raise notice 'FAIL 27 (G): the person was removed with the assignment';
  end if;

  -- =================================================================
  -- H. No case management schema crept in
  -- =================================================================
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public'
    and (table_name like '%incident%' or table_name like '%allegation%'
      or table_name like '%investigation%' or table_name like '%case_file%'
      or table_name like '%safeguarding_case%' or table_name like '%evidence%');
  if v_count = 0 then
    raise notice 'PASS 28 (H): no safeguarding case-management tables exist';
  else
    raise notice 'FAIL 28 (H): % case-management tables found', v_count;
  end if;

  -- =================================================================
  -- I. Transfer capabilities exist but nothing consumes them
  -- =================================================================
  -- Recorded as an assertion so that the day a real inter-club transfer
  -- event lands, this fails and someone wires the notification up rather
  -- than leaving two dead switches in the Site Admin UI.
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public' and (table_name like '%transfer%' or table_name like '%player_move%');
  if v_count = 0 then
    raise notice 'PASS 29 (I): Main still has no inter-club transfer event -- transfer capabilities remain unconnected by design';
  else
    raise notice 'FAIL 29 (I): % transfer tables now exist -- wire up the safeguarding transfer notification', v_count;
  end if;

  -- =================================================================
  -- J. Dispensation notification authority
  -- =================================================================
  -- The notifier resolves recipients from capability, not from the officer
  -- row alone, so an officer without the notify capability gets nothing.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'notify_club_safeguarding_officers'
    and p.prosrc like '%capability_overrides%';
  if v_count = 1 then
    raise notice 'PASS 30 (J): dispensation notification is gated on an explicit capability grant';
  else
    raise notice 'FAIL 30 (J): the notifier does not consult the capability layer';
  end if;

  -- Approval authority is untouched by safeguarding: the decision RPC is
  -- gated on the dispensation capability, not on being an officer.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'decide_player_dispensation'
    and p.prosrc like '%approve_player_dispensations%';
  if v_count = 1 then
    raise notice 'PASS 31 (J): dispensation decisions still require approve_player_dispensations';
  else
    raise notice 'FAIL 31 (J): dispensation approval authority changed';
  end if;
end;
$$;

rollback;
