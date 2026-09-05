-- Manual verification for fixture-conversation Contact Cards
-- (20260901020000): self-only identity resolution, real club/team role
-- snapshotting, no-phone rejection, unrelated-club rejection, no direct
-- table write, and historic-snapshot immutability across a later profile
-- phone-number change. NOT a migration -- run AFTER permission_matrix.sql
-- and partner_clubs_and_messaging.sql (reuses Leigh RUFC, 0011, as the
-- unrelated-club negative case).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('e0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. No phone number on profile yet -> rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.share_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  raise notice 'FAIL 1: a card was shared with no phone number on profile';
exception when others then
  raise notice 'PASS 1: no phone number on profile is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- Set Burnley and Rossendale admins' phone numbers (committed, real
-- self-row updates via profiles_update_self_or_admin).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
update public.profiles set phone_number = '07100000002' where id = '00000000-0000-0000-0000-000000000002';
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
update public.profiles set phone_number = '07100000003' where id = '00000000-0000-0000-0000-000000000003';
commit;

-- ------------------------------------------------------------
-- 2. Burnley Club Admin shares their own card -> correct snapshot.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_msg_id uuid;
  v_role text;
  v_club text;
  v_phone text;
begin
  v_msg_id := public.share_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  perform set_config('test.burnley_card_1_message_id', v_msg_id::text, false);
  select role_snapshot, club_name_snapshot, telephone_snapshot into v_role, v_club, v_phone
  from public.fixture_message_contact_cards where message_id = v_msg_id;
  if v_role = 'Club Admin' and v_club = 'Burnley RUFC' and v_phone = '07100000002' then
    raise notice 'PASS 2: Burnley Club Admin''s card snapshot is correct (% / % / %)', v_role, v_club, v_phone;
  else
    raise notice 'FAIL 2: snapshot is % / % / %', v_role, v_club, v_phone;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. Unrelated club (Leigh) cannot share a card into this conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$
begin
  perform public.share_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  raise notice 'FAIL 3: an unrelated club shared a contact card';
exception when others then
  raise notice 'PASS 3: an unrelated club cannot share a contact card (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Opponent (Rossendale) can share their OWN card on the same fixture.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_msg_id uuid;
  v_club text;
  v_phone text;
begin
  v_msg_id := public.share_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  select club_name_snapshot, telephone_snapshot into v_club, v_phone from public.fixture_message_contact_cards where message_id = v_msg_id;
  if v_club = 'Rossendale RUFC' and v_phone = '07100000003' then
    raise notice 'PASS 4: Rossendale (opponent side) shared their own card correctly (% / %)', v_club, v_phone;
  else
    raise notice 'FAIL 4: snapshot is % / %', v_club, v_phone;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. No direct table write -- an authenticated user cannot INSERT a card
--    for themselves (or anyone) bypassing the RPC.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_message_contact_cards (message_id, shared_by_user_id, display_name_snapshot, role_snapshot, club_name_snapshot, telephone_snapshot)
  values (current_setting('test.burnley_card_1_message_id')::uuid, '00000000-0000-0000-0000-000000000002', 'Spoofed Name', 'Chairman', 'Burnley RUFC', '07999999999');
  raise notice 'FAIL 5: a direct table insert into fixture_message_contact_cards succeeded';
exception when others then
  raise notice 'PASS 5: direct table writes are blocked, RPC is the only path (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6/7. Historic snapshot immutability: changing the profile phone number
--    later must NOT rewrite the already-shared card, and a NEW share must
--    use the updated number.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
update public.profiles set phone_number = '07200000002' where id = '00000000-0000-0000-0000-000000000002';
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_old_phone text;
begin
  select telephone_snapshot into v_old_phone from public.fixture_message_contact_cards where message_id = current_setting('test.burnley_card_1_message_id')::uuid;
  if v_old_phone = '07100000002' then
    raise notice 'PASS 6: the historic card still shows the OLD phone number after a profile change (%)', v_old_phone;
  else
    raise notice 'FAIL 6: the historic card changed to %', v_old_phone;
  end if;
end $$;
do $$
declare
  v_msg_id uuid;
  v_new_phone text;
begin
  v_msg_id := public.share_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  select telephone_snapshot into v_new_phone from public.fixture_message_contact_cards where message_id = v_msg_id;
  if v_new_phone = '07200000002' then
    raise notice 'PASS 7: a newly-shared card uses the UPDATED phone number (%)', v_new_phone;
  else
    raise notice 'FAIL 7: new card shows %', v_new_phone;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. Preview never writes anything -- calling it repeatedly creates no
--    rows, and it returns the same identity the real share would use.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_role text;
  v_club text;
  v_phone text;
  v_count_before int;
  v_count_after int;
begin
  select count(*) into v_count_before from public.fixture_message_contact_cards;
  select role_label, club_name, telephone into v_role, v_club, v_phone
  from public.preview_my_fixture_contact_card('e0000000-0000-0000-0000-000000000001', null);
  select count(*) into v_count_after from public.fixture_message_contact_cards;
  if v_role = 'Club Admin' and v_club = 'Burnley RUFC' and v_phone = '07200000002' and v_count_before = v_count_after then
    raise notice 'PASS 8: preview matches the real identity and writes nothing (% / % / %, % rows before/after)', v_role, v_club, v_phone, v_count_before;
  else
    raise notice 'FAIL 8: preview % / % / %, rows % -> %', v_role, v_club, v_phone, v_count_before, v_count_after;
  end if;
end $$;
commit;

do $$
begin
  delete from public.fixture_message_contact_cards where message_id in (
    select id from public.fixture_messages where fixture_id = 'e0000000-0000-0000-0000-000000000001'
  );
  delete from public.fixture_messages where fixture_id = 'e0000000-0000-0000-0000-000000000001';
  delete from public.fixtures where id = 'e0000000-0000-0000-0000-000000000001';
  update public.profiles set phone_number = null where id in ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');
exception when others then null;
end $$;
