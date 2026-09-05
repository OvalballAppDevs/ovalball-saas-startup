-- Manual verification for Message Management capability policy
-- (20260901200000): global/club inheritance, non-overridable restrictions,
-- enforcement inside create_fixture_message_with_attachment/
-- share_fixture_document/share_fixture_contact_card/
-- add_fixture_conversation_participant, admin_message_analytics accuracy,
-- and the metadata-only guarantee on admin_message_overview. NOT a
-- migration -- run AFTER permission_matrix.sql and message_management.sql
-- (reuses Burnley/Rossendale from the former, the Full/Moderator/ClubData
-- Site Admin trio 0020-0022 from the latter):
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/message_management.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/message_policies.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Burnley U12 A (owning, Home) vs Rossendale U12 A (opponent) -- a real
  -- fixture conversation to send real attachments/shares into.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('91000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 10, 'Booked', 'club_created')
  on conflict (id) do nothing;

  update public.profiles set phone_number = '07700900123' where id = '00000000-0000-0000-0000-000000000002';

  insert into public.document_folders (id, club_id, name) values
    ('91000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Match Day')
  on conflict (id) do nothing;
  insert into public.club_documents (id, club_id, folder_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('91000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 'Ground directions', 'ground_pitch_information', 'directions.pdf', 'c/10000000-0000-0000-0000-000000000001/directions.pdf', 'application/pdf', 50000, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Default state: get_effective_message_policy(Burnley) reports every
--    capability as global_default, all true (the seeded default).
-- ------------------------------------------------------------
do $$
declare
  v_allow boolean; v_origin text;
begin
  select allow_direct_attachments, allow_direct_attachments_origin into v_allow, v_origin
  from public.get_effective_message_policy('10000000-0000-0000-0000-000000000001');
  if v_allow = true and v_origin = 'global_default' then
    raise notice 'PASS 1: default effective policy is global_default/true';
  else
    raise notice 'FAIL 1: allow=%, origin=%', v_allow, v_origin;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Only a Full Site Admin may update the global policy -- Message
--    Moderator (0021) is rejected even though it is a Site Admin role.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';
do $$
begin
  perform public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
  raise notice 'FAIL 2: Message Moderator changed the global policy';
exception when others then
  raise notice 'PASS 2: Message Moderator cannot change the global policy (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Full Site Admin (0020) turns Direct Attachments OFF globally and
--    disallows club override for it, but leaves Document Library Sharing
--    ON with club override allowed.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(
  false, true, true, true, true,
  false, true, true, true, true,
  2097152, array['application/pdf','image/jpeg','image/png','image/webp']
);
commit;

do $$
declare v_allow boolean;
begin
  select allow_direct_attachments into v_allow from public.get_effective_message_policy(null);
  if v_allow = false then
    raise notice 'PASS 3: global Direct Attachments is now OFF';
  else
    raise notice 'FAIL 3: global allow_direct_attachments = %', v_allow;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Non-overridable restriction: Burnley's Club Admin cannot re-enable
--    Direct Attachments for their own club, since the global row marked it
--    non-overridable in test 3.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.update_club_message_policy(
    '10000000-0000-0000-0000-000000000001',
    false, true,   -- override direct attachments -> true (should be refused)
    true, null, true, null, true, null, true, null
  );
  raise notice 'FAIL 4: Burnley overrode a non-overridable restriction';
exception when others then
  raise notice 'PASS 4: a non-overridable restriction cannot be overridden by a club (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Override obedience: Document Library Sharing IS overridable --
--    Burnley's Club Admin can turn it OFF for their own club while the
--    global default stays ON.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.update_club_message_policy(
  '10000000-0000-0000-0000-000000000001',
  true, null,
  false, false,   -- override document library sharing -> false
  true, null, true, null, true, null
);
commit;

do $$
declare v_allow boolean; v_origin text; v_global boolean;
begin
  select allow_document_library_sharing, allow_document_library_sharing_origin into v_allow, v_origin
  from public.get_effective_message_policy('10000000-0000-0000-0000-000000000001');
  select allow_document_library_sharing into v_global from public.get_effective_message_policy(null);
  if v_allow = false and v_origin = 'club_override' and v_global = true then
    raise notice 'PASS 5: Burnley''s club override (Document Library Sharing = OFF) is honoured while the global default stays ON';
  else
    raise notice 'FAIL 5: burnley_allow=%, origin=%, global=%', v_allow, v_origin, v_global;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Cross-club isolation: Rossendale's effective policy is unaffected by
--    Burnley's own club-level override from test 5.
-- ------------------------------------------------------------
do $$
declare v_allow boolean; v_origin text;
begin
  select allow_document_library_sharing, allow_document_library_sharing_origin into v_allow, v_origin
  from public.get_effective_message_policy('10000000-0000-0000-0000-000000000002');
  if v_allow = true and v_origin = 'global_default' then
    raise notice 'PASS 6: Rossendale is unaffected by Burnley''s own club override (cross-club isolation)';
  else
    raise notice 'FAIL 6: rossendale allow=%, origin=%', v_allow, v_origin;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. Club Admin scope limit: Burnley's Club Admin cannot set Rossendale's
--    club policy.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.update_club_message_policy(
    '10000000-0000-0000-0000-000000000002',
    true, null, false, false, true, null, true, null, true, null
  );
  raise notice 'FAIL 7: Burnley''s Club Admin changed Rossendale''s messaging policy';
exception when others then
  raise notice 'PASS 7: a Club Admin cannot change another club''s messaging policy (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Live enforcement: Burnley's Coach (0006, team_permissions on U12 A)
--    tries to share a document on the Burnley/Rossendale fixture -- blocked
--    by the club override set in test 5.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
begin
  perform public.share_fixture_document('91000000-0000-0000-0000-000000000001', null, '91000000-0000-0000-0000-000000000003', null);
  raise notice 'FAIL 8: document sharing succeeded despite the club override turning it off';
exception when others then
  raise notice 'PASS 8: document sharing is blocked by Burnley''s club override (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Live enforcement, direct attachments: still globally OFF and
--    non-overridable (test 3) -- Burnley's admin cannot attach a file.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_fixture_message_with_attachment('91000000-0000-0000-0000-000000000001', null, 'See attached.', 'f/91000000-0000-0000-0000-000000000001/test.pdf', 'test.pdf', 'application/pdf', 1000);
  raise notice 'FAIL 9: a direct attachment was accepted while globally OFF';
exception when others then
  raise notice 'PASS 9: direct attachments are blocked while globally OFF (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Turn Direct Attachments back ON globally (restore a normal state)
--     and prove a real attachment now succeeds end-to-end (a genuine
--     storage.objects row owned by the sender).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into storage.objects (bucket_id, name, owner)
values ('fixture-attachments', 'f/91000000-0000-0000-0000-000000000001/test.pdf', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
do $$
declare v_message_id uuid;
begin
  v_message_id := public.create_fixture_message_with_attachment('91000000-0000-0000-0000-000000000001', null, 'See attached.', 'f/91000000-0000-0000-0000-000000000001/test.pdf', 'test.pdf', 'application/pdf', 50000);
  if v_message_id is not null then
    raise notice 'PASS 10: a direct attachment succeeds end-to-end once the policy is ON again';
  else
    raise notice 'FAIL 10: create_fixture_message_with_attachment returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 11. Image vs non-image split: allow_image_uploads OFF blocks an image
--     even though allow_direct_attachments is ON.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, false, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into storage.objects (bucket_id, name, owner)
values ('fixture-attachments', 'f/91000000-0000-0000-0000-000000000001/photo.jpg', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
do $$
begin
  perform public.create_fixture_message_with_attachment('91000000-0000-0000-0000-000000000001', null, 'A photo.', 'f/91000000-0000-0000-0000-000000000001/photo.jpg', 'photo.jpg', 'image/jpeg', 50000);
  raise notice 'FAIL 11: an image upload succeeded while allow_image_uploads is OFF';
exception when others then
  raise notice 'PASS 11: image uploads are blocked independently of direct attachments (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. A PDF still succeeds in the same state (image OFF, direct ON) --
--     proves the two capabilities are genuinely independent, not one
--     toggle controlling both.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into storage.objects (bucket_id, name, owner)
values ('fixture-attachments', 'f/91000000-0000-0000-0000-000000000001/test2.pdf', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
do $$
declare v_message_id uuid;
begin
  v_message_id := public.create_fixture_message_with_attachment('91000000-0000-0000-0000-000000000001', null, 'Another PDF.', 'f/91000000-0000-0000-0000-000000000001/test2.pdf', 'test2.pdf', 'application/pdf', 50000);
  if v_message_id is not null then
    raise notice 'PASS 12: a PDF attachment still succeeds while only image uploads are OFF (independent toggles)';
  else
    raise notice 'FAIL 12: PDF attachment unexpectedly failed';
  end if;
end $$;
commit;

-- Restore image uploads ON for the remaining tests.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

-- ------------------------------------------------------------
-- 13. Max attachment size: Full Site Admin tightens the global max below
--     2MB -- an otherwise-valid PDF over the new (lower) limit is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 10000, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into storage.objects (bucket_id, name, owner)
values ('fixture-attachments', 'f/91000000-0000-0000-0000-000000000001/big.pdf', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
do $$
begin
  perform public.create_fixture_message_with_attachment('91000000-0000-0000-0000-000000000001', null, 'Too big.', 'f/91000000-0000-0000-0000-000000000001/big.pdf', 'big.pdf', 'application/pdf', 50000);
  raise notice 'FAIL 13: a 50KB attachment was accepted under a 10KB policy limit';
exception when others then
  raise notice 'PASS 13: a tightened global max_attachment_size_bytes is enforced (%)', sqlerrm;
end $$;
rollback;

-- Restore the max back to 2MB for the remaining tests.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

-- ------------------------------------------------------------
-- 14. Contact card sharing gate: OFF globally blocks
--     share_fixture_contact_card even for an otherwise-eligible sender.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, false, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.share_fixture_contact_card('91000000-0000-0000-0000-000000000001', null);
  raise notice 'FAIL 14: a contact card was shared while allow_contact_card_sharing is OFF';
exception when others then
  raise notice 'PASS 14: contact card sharing is blocked while OFF (%)', sqlerrm;
end $$;
rollback;

-- Restore contact cards ON.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

-- ------------------------------------------------------------
-- 15. Participant management gate: OFF globally blocks
--     add_fixture_conversation_participant for a club with no override.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, false, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.add_fixture_conversation_participant('91000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000006');
  raise notice 'FAIL 15: a participant was added while allow_participant_management is OFF';
exception when others then
  raise notice 'PASS 15: adding a participant is blocked while OFF (%)', sqlerrm;
end $$;
rollback;

-- Restore participant management ON.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
select public.update_global_message_policy(true, true, true, true, true, true, true, true, true, true, 2097152, array['application/pdf','image/jpeg','image/png','image/webp']);
commit;

-- ------------------------------------------------------------
-- 16. admin_message_analytics: only a Site Admin may call it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  perform public.admin_message_analytics(null, null, null, null, null);
  raise notice 'FAIL 16: a non-Site-Admin called admin_message_analytics';
exception when others then
  raise notice 'PASS 16: admin_message_analytics is Site-Admin-only (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 17. admin_message_analytics: club filter accuracy and no
--     storage-double-counting -- Burnley's scoped attachment_storage_bytes
--     equals the real sum of ONLY fixture_message_attachments rows (the
--     document share from test 8 was blocked/rolled back, so this counts
--     the two successful PDF attachments from tests 10 and 12: 50000+50000).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';
do $$
declare
  v_bytes bigint;
  v_direct bigint;
  v_real_sum bigint;
begin
  select attachment_storage_bytes, direct_attachment_count into v_bytes, v_direct
  from public.admin_message_analytics(null, null, '10000000-0000-0000-0000-000000000001', null, null);

  select coalesce(sum(a.size_bytes), 0) into v_real_sum
  from public.fixture_message_attachments a
  join public.fixture_messages m on m.id = a.message_id
  where m.fixture_id = '91000000-0000-0000-0000-000000000001';

  if v_bytes = v_real_sum and v_direct = 2 then
    raise notice 'PASS 17: attachment_storage_bytes (%) matches the real sum with no double-counting, direct_attachment_count = %', v_bytes, v_direct;
  else
    raise notice 'FAIL 17: reported bytes=%, real sum=%, direct_attachment_count=%', v_bytes, v_real_sum, v_direct;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 18. admin_message_overview never exposes message content -- querying a
--     `body` column against the view itself fails (the view genuinely has
--     no such column, not merely an app-layer convention).
-- ------------------------------------------------------------
do $$
begin
  perform 1 from public.admin_message_overview where false;
  begin
    execute 'select body from public.admin_message_overview limit 1';
    raise notice 'FAIL 18: admin_message_overview exposes a body column';
  exception when undefined_column then
    raise notice 'PASS 18: admin_message_overview has no body column -- metadata-only at the schema level';
  end;
end $$;
