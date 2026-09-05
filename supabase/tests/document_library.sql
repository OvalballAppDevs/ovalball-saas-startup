-- Manual verification for the Club Document Library (20260831440000):
-- upload-once/store-once/share-by-reference, private-by-default club
-- libraries, canonical (pre-activation) directory ownership, cross-club
-- folder/document move prevention, and archive-vs-hard-delete semantics.
-- NOT a migration -- run AFTER permission_matrix.sql and
-- partner_clubs_and_messaging.sql (reuses Leigh RUFC, 0011, as the
-- unrelated-club negative case).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1/2. Authorized Club Admin (Burnley) uploads a PDF and an image
--      under 10MB.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_doc_id uuid;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('club-documents', '10000000-0000-0000-0000-000000000001/att-1.pdf', '00000000-0000-0000-0000-000000000002');
  insert into public.club_documents (club_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Visitor Guide 2026', 'visitor_guide', 'Visitor Guide.pdf', '10000000-0000-0000-0000-000000000001/att-1.pdf', 'application/pdf', 500000, '00000000-0000-0000-0000-000000000002')
  returning id into v_doc_id;
  perform set_config('test.visitor_guide_id', v_doc_id::text, false);
  raise notice 'PASS 1: Burnley Club Admin uploaded a PDF document under 10MB';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. >10MB rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.club_documents (club_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Too Big', 'huge.pdf', '10000000-0000-0000-0000-000000000001/huge.pdf', 'application/pdf', 11000000, '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 3: a >10MB document was accepted';
exception when others then
  raise notice 'PASS 3: a >10MB document is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. HTML rejected (MIME allowlist).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.club_documents (club_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Hostile', 'page.html', '10000000-0000-0000-0000-000000000001/page.html', 'text/html', 1000, '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 4: an HTML document was accepted';
exception when others then
  raise notice 'PASS 4: HTML is rejected by the MIME allowlist (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7/8. An unrelated club (Leigh) cannot browse Burnley's library or
--      access the un-shared document directly.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.club_documents where club_id = '10000000-0000-0000-0000-000000000001';
  if v_count = 0 then
    raise notice 'PASS 7: Leigh cannot browse Burnley''s document library (0 rows)';
  else
    raise notice 'FAIL 7: Leigh saw % of Burnley''s documents', v_count;
  end if;
end $$;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('club-documents', '10000000-0000-0000-0000-000000000001/exploit.pdf', '00000000-0000-0000-0000-000000000011');
    raise notice 'FAIL 8: Leigh uploaded into Burnley''s document storage path';
  exception when others then
    raise notice 'PASS 8: Leigh cannot upload into Burnley''s document storage path (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. View Only (Parent, 0007) cannot upload a document.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  insert into public.club_documents (club_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Unauthorized', 'x.pdf', '10000000-0000-0000-0000-000000000001/view-only-attempt.pdf', 'application/pdf', 1000, '00000000-0000-0000-0000-000000000007');
  raise notice 'FAIL 9: View Only (Parent) uploaded a document';
exception when others then
  raise notice 'PASS 9: View Only (Parent) cannot upload a document (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. A suspended user (temporarily, Burnley U12 admin 0004) cannot
--     upload, even for their own club.
-- ------------------------------------------------------------
begin;
update public.profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  insert into public.club_documents (club_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Unauthorized', 'x.pdf', '10000000-0000-0000-0000-000000000001/suspended-attempt.pdf', 'application/pdf', 1000, '00000000-0000-0000-0000-000000000004');
  raise notice 'FAIL 10: a suspended user uploaded a document';
exception when others then
  raise notice 'PASS 10: a suspended user cannot upload a document (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 15/16. Sharing the visitor guide into a fixture conversation creates a
--        REFERENCE, never a second Storage object.
-- ------------------------------------------------------------
do $$
declare
  v_storage_count_before int;
begin
  select count(*) into v_storage_count_before from storage.objects where bucket_id = 'club-documents';
  perform set_config('test.storage_count_before', v_storage_count_before::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_message_id uuid;
begin
  v_message_id := public.share_fixture_document('b0000000-0000-0000-0000-000000000001', null, current_setting('test.visitor_guide_id')::uuid, 'Visitor info for Saturday.');
  perform set_config('test.shared_message_id', v_message_id::text, false);
  raise notice 'PASS 15: Burnley shared the Visitor Guide into a fixture conversation';
exception when others then
  raise notice 'FAIL 15: %', sqlerrm;
end $$;
commit;

do $$
declare
  v_storage_count_after int;
begin
  select count(*) into v_storage_count_after from storage.objects where bucket_id = 'club-documents';
  if v_storage_count_after::text = current_setting('test.storage_count_before') then
    raise notice 'PASS 16: sharing created a reference only -- no new Storage object (still % objects)', v_storage_count_after;
  else
    raise notice 'FAIL 16: storage object count changed from % to %', current_setting('test.storage_count_before'), v_storage_count_after;
  end if;
end $$;

-- ------------------------------------------------------------
-- 17/18. Rossendale (the authorized opponent on THIS fixture) can access
--        the shared document but still cannot browse the rest of
--        Burnley's library.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_title text;
begin
  select title into v_title from public.club_documents where id = current_setting('test.visitor_guide_id')::uuid;
  if v_title = 'Visitor Guide 2026' then
    raise notice 'PASS 17: authorized opponent (Rossendale) can access the shared document';
  else
    raise notice 'FAIL 17: Rossendale could not read the shared document';
  end if;
end $$;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.club_documents where club_id = '10000000-0000-0000-0000-000000000001';
  if v_count = 1 then
    raise notice 'PASS 18: Rossendale sees ONLY the one shared document, not the rest of Burnley''s library';
  else
    raise notice 'FAIL 18: Rossendale saw % of Burnley''s documents', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19. A second Burnley document that was never shared remains
--     inaccessible to Rossendale.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('club-documents', '10000000-0000-0000-0000-000000000001/pitch-map.png', '00000000-0000-0000-0000-000000000002');
  insert into public.club_documents (club_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values ('10000000-0000-0000-0000-000000000001', 'Internal Pitch Map', 'pitch-map.png', '10000000-0000-0000-0000-000000000001/pitch-map.png', 'image/png', 200000, '00000000-0000-0000-0000-000000000002')
  returning id into v_id;
  perform set_config('test.unshared_doc_id', v_id::text, false);
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.club_documents where id = current_setting('test.unshared_doc_id')::uuid;
  if v_count = 0 then
    raise notice 'PASS 19: the unshared Pitch Map remains inaccessible to Rossendale';
  else
    raise notice 'FAIL 19: Rossendale can see the unshared document';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 20. The same document can be referenced by a SECOND fixture message
--     (a second disposable fixture) with zero additional Storage writes.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Away', 'Rossendale RUFC', current_date + 14, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_storage_before int;
  v_storage_after int;
begin
  select count(*) into v_storage_before from storage.objects where bucket_id = 'club-documents';
  perform public.share_fixture_document('b0000000-0000-0000-0000-000000000002', null, current_setting('test.visitor_guide_id')::uuid, null);
  select count(*) into v_storage_after from storage.objects where bucket_id = 'club-documents';
  if v_storage_after = v_storage_before then
    raise notice 'PASS 20: the same document was referenced by a second fixture conversation with zero new Storage objects';
  else
    raise notice 'FAIL 20: storage count changed from % to %', v_storage_before, v_storage_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 21. Archiving a referenced document does not break the historical
--     fixture-message reference (still resolvable).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  update public.club_documents set archived_at = now() where id = current_setting('test.visitor_guide_id')::uuid;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_title text;
begin
  select d.title into v_title
  from public.fixture_message_document_refs r
  join public.club_documents d on d.id = r.document_id
  where r.message_id = current_setting('test.shared_message_id')::uuid;
  if v_title = 'Visitor Guide 2026' then
    raise notice 'PASS 21: an archived document remains accessible through its existing historical fixture-message reference';
  else
    raise notice 'FAIL 21: archived document reference no longer resolves';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 22. Hard delete of a referenced document is blocked -- archive is the
--     only path.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.delete_club_document(current_setting('test.visitor_guide_id')::uuid);
  raise notice 'FAIL 22: a document shared in 2 fixture conversations was hard-deleted';
exception when others then
  raise notice 'PASS 22: hard delete of a referenced document is blocked -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 23. An unreferenced disposable document CAN be hard-deleted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.delete_club_document(current_setting('test.unshared_doc_id')::uuid);
  raise notice 'PASS 23: an unreferenced, disposable document can be safely hard-deleted';
exception when others then
  raise notice 'FAIL 23: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 6/canonical. Site Admin can create a folder/document for a canonical
--    (unactivated) club directly on club_directory -- the same crest-style
--    fix, applied to the document library -- and an ordinary user cannot.
-- ------------------------------------------------------------
do $$
declare
  v_unactivated_directory_id uuid;
begin
  select cd.id into v_unactivated_directory_id
  from public.club_directory cd
  left join public.clubs c on c.directory_id = cd.id
  where c.id is null
  limit 1;
  perform set_config('test.unactivated_directory_id', v_unactivated_directory_id::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- Full Site Admin
do $$
declare
  v_folder_id uuid;
begin
  insert into public.document_folders (directory_id, name, created_by)
  values (current_setting('test.unactivated_directory_id')::uuid, 'Match Day', '00000000-0000-0000-0000-000000000001')
  returning id into v_folder_id;
  insert into storage.objects (bucket_id, name, owner)
  values ('club-documents', current_setting('test.unactivated_directory_id') || '/canonical-doc.pdf', '00000000-0000-0000-0000-000000000001');
  insert into public.club_documents (directory_id, folder_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (current_setting('test.unactivated_directory_id')::uuid, v_folder_id, 'Ground Info', 'ground.pdf', current_setting('test.unactivated_directory_id') || '/canonical-doc.pdf', 'application/pdf', 100000, '00000000-0000-0000-0000-000000000001');
  raise notice 'PASS 6a: Full Site Admin can create a folder + document for a canonical unactivated club';
exception when others then
  raise notice 'FAIL 6a: %', sqlerrm;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; -- Burnley Club Admin, unrelated club
do $$
begin
  insert into public.document_folders (directory_id, name, created_by)
  values (current_setting('test.unactivated_directory_id')::uuid, 'Exploit', '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 6b: an ordinary Club Admin created a folder in an unrelated canonical club''s library';
exception when others then
  raise notice 'PASS 6b: an ordinary Club Admin cannot manage a canonical (unactivated) club''s document library (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- Cross-club folder ownership + cycle prevention.
-- ------------------------------------------------------------
do $$
declare
  v_burnley_folder uuid;
  v_rossendale_folder uuid;
begin
  insert into public.document_folders (id, club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Burnley Root', '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing
  returning id into v_burnley_folder;
  insert into public.document_folders (id, club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Rossendale Root', '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing
  returning id into v_rossendale_folder;
end $$;

do $$
begin
  update public.document_folders set parent_folder_id = 'c0000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001';
  raise notice 'FAIL 24: a Burnley folder was moved into Rossendale''s library';
exception when others then
  raise notice 'PASS 24: a folder cannot be moved into another club''s library (%)', sqlerrm;
end $$;

do $$
begin
  update public.document_folders set parent_folder_id = 'c0000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000001';
  raise notice 'FAIL 25: a folder was moved into itself';
exception when others then
  raise notice 'PASS 25: a folder cannot be moved into itself (%)', sqlerrm;
end $$;

do $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from public.document_folders where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');
  delete from public.club_documents where directory_id = current_setting('test.unactivated_directory_id')::uuid;
  delete from public.document_folders where directory_id = current_setting('test.unactivated_directory_id')::uuid;
  delete from public.fixture_message_document_refs where document_id in (current_setting('test.visitor_guide_id')::uuid);
  delete from public.club_documents where id = current_setting('test.visitor_guide_id')::uuid;
  delete from public.fixture_messages where fixture_id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
  delete from public.fixtures where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
  delete from storage.objects where bucket_id = 'club-documents' and name like '10000000-0000-0000-0000-000000000001/%';
exception when others then null;
end $$;
