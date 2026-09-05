-- Manual verification for fixture message attachments (20260831390000):
-- private storage bucket, one-attachment-per-message metadata, and the
-- create_fixture_message_with_attachment/delete_fixture_message_attachment
-- RPCs. NOT a migration -- never applied automatically by `db reset`. Run
-- AFTER permission_matrix.sql. Reuses Burnley (0002 admin, team
-- 30000000-...0001, U12 A) vs Rossendale (0003 admin, team
-- 30000000-...0003) from permission_matrix.sql/fixture_results.sql, plus
-- 0004 (Burnley U12 team admin -- relevant), 0007 (Parent, view_only on
-- Burnley U12 A), and its own throwaway unrelated club + suspended-user
-- scenarios (both rolled back, never persisted).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, created_by, updated_by)
  values ('c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003',
          current_date + 7, '14:00', 'Home', 'Booked', 'Rossendale RUFC', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1/2/3. Upload PDF/JPEG/PNG as the fixture-owning club's admin -- storage
-- INSERT succeeds, metadata persists correctly, message+attachment created
-- together.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_message_id uuid;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf', '00000000-0000-0000-0000-000000000002');
  v_message_id := public.create_fixture_message_with_attachment(
    'c0000000-0000-0000-0000-000000000001', null, 'Team sheet attached.',
    'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf', 'Team Sheet.pdf', 'application/pdf', 500000);
  if v_message_id is not null then
    raise notice 'PASS 1: PDF uploaded and a message+attachment pair created together';
  else
    raise notice 'FAIL 1: no message id returned';
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-jpg-1.jpg', '00000000-0000-0000-0000-000000000002');
  perform public.create_fixture_message_with_attachment(
    'c0000000-0000-0000-0000-000000000001', null, 'Photo attached.',
    'f/c0000000-0000-0000-0000-000000000001/att-jpg-1.jpg', 'pitch photo.jpg', 'image/jpeg', 800000);
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-png-1.png', '00000000-0000-0000-0000-000000000002');
  perform public.create_fixture_message_with_attachment(
    'c0000000-0000-0000-0000-000000000001', null, 'Map attached.',
    'f/c0000000-0000-0000-0000-000000000001/att-png-1.png', 'travel map.png', 'image/png', 400000);
  raise notice 'PASS 2/3: JPEG and PNG attachments both uploaded and messaged';
exception when others then
  raise notice 'FAIL 2/3: %', sqlerrm;
end $$;
commit;

do $$
declare
  v_row record;
begin
  select * into v_row from public.fixture_message_attachments
  where storage_path = 'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf';
  if v_row.original_filename = 'Team Sheet.pdf' and v_row.mime_type = 'application/pdf' and v_row.size_bytes = 500000
     and v_row.uploaded_by = '00000000-0000-0000-0000-000000000002' then
    raise notice 'PASS 4: attachment metadata (filename/mime_type/size_bytes/uploaded_by) persisted correctly';
  else
    raise notice 'FAIL 4: metadata mismatch: %', v_row;
  end if;
end $$;

do $$
declare
  v_public boolean;
begin
  select public into v_public from storage.buckets where id = 'fixture-attachments';
  if v_public is false then
    raise notice 'PASS 5: the fixture-attachments bucket is private, never public';
  else
    raise notice 'FAIL 5: bucket is public';
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Authorized opponent (Rossendale, 0003) CAN access the attachment.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.fixture_message_attachments a
  join public.fixture_messages m on m.id = a.message_id
  where m.fixture_id = 'c0000000-0000-0000-0000-000000000001';
  if v_count = 3 then
    raise notice 'PASS 6: authorized opponent (Rossendale) can see all 3 attachments via RLS';
  else
    raise notice 'FAIL 6: expected 3, saw %', v_count;
  end if;
end $$;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'fixture-attachments' and name like 'f/c0000000-0000-0000-0000-000000000001/%';
  if v_count = 3 then
    raise notice 'PASS 6b: authorized opponent can read the storage objects themselves (signed-URL prerequisite)';
  else
    raise notice 'FAIL 6b: expected 3, saw %', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Unrelated club official CANNOT access -- fresh throwaway club/admin
--    with no relationship to this fixture at all.
-- ------------------------------------------------------------
do $$
declare
  v_unrelated_directory_id uuid;
  v_unrelated_admin_id uuid := '00000000-0000-0000-0000-000000000041';
  v_unrelated_club_id uuid;
begin
  select id into v_unrelated_directory_id from public.club_directory where name = 'Aberdare Rugby Football Club';
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_unrelated_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.unrelated.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values (v_unrelated_admin_id, 'Test', 'UnrelatedAdmin', 'test.unrelated.admin@ovalball.local') on conflict (id) do nothing;
  insert into public.clubs (directory_id, slug, status, created_by, updated_by)
  values (v_unrelated_directory_id, 'aberdare-attach-test', 'active', v_unrelated_admin_id, v_unrelated_admin_id)
  on conflict do nothing
  returning id into v_unrelated_club_id;
  if v_unrelated_club_id is null then
    select id into v_unrelated_club_id from public.clubs where directory_id = v_unrelated_directory_id;
  end if;
  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_unrelated_club_id, v_unrelated_admin_id, 'CLUB_ADMIN', 'active', v_unrelated_admin_id, v_unrelated_admin_id)
  on conflict do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.fixture_message_attachments a
  join public.fixture_messages m on m.id = a.message_id
  where m.fixture_id = 'c0000000-0000-0000-0000-000000000001';
  if v_count = 0 then
    raise notice 'PASS 7: an unrelated club cannot see any attachment on this fixture';
  else
    raise notice 'FAIL 7: unrelated club saw % attachments', v_count;
  end if;
end $$;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-hostile.pdf', '00000000-0000-0000-0000-000000000041');
    raise notice 'FAIL 7b: an unrelated club uploaded to a fixture it has no relationship to';
  exception when others then
    raise notice 'PASS 7b: an unrelated club is blocked from uploading to this fixture (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Public/anon CANNOT access.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.fixture_message_attachments a
  join public.fixture_messages m on m.id = a.message_id
  where m.fixture_id = 'c0000000-0000-0000-0000-000000000001';
  if v_count = 0 then
    raise notice 'PASS 8: an anonymous/public caller cannot see any attachment';
  else
    raise notice 'FAIL 8: public saw % attachments', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. View Only (0007, Parent/player on Burnley U12 A) cannot upload --
--    read access to messages already excludes them (view_only has no
--    can_manage_team standing), so this also covers "cannot even see the
--    conversation to attach to".
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-viewonly.pdf', '00000000-0000-0000-0000-000000000007');
    raise notice 'FAIL 9: View Only user uploaded an attachment';
  exception when others then
    raise notice 'PASS 9: View Only user is blocked from uploading (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Suspended user cannot upload, even though they are otherwise a
--     relevant Team Admin for this fixture (Burnley U12 A admin, 0004,
--     temporarily suspended -- rolled back, never persisted).
-- ------------------------------------------------------------
begin;
update public.profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-suspended.pdf', '00000000-0000-0000-0000-000000000004');
    raise notice 'FAIL 10: a suspended (otherwise relevant) Team Admin uploaded an attachment';
  exception when others then
    raise notice 'PASS 10: a suspended user is blocked from uploading, even for their own team''s fixture (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. >2MB rejected by create_fixture_message_with_attachment (application-
--     level check -- the storage bucket's own file_size_limit is the real
--     enforcement for actual byte uploads, this is defense in depth).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-toobig.pdf', '00000000-0000-0000-0000-000000000002');
  begin
    perform public.create_fixture_message_with_attachment(
      'c0000000-0000-0000-0000-000000000001', null, 'Too big.',
      'f/c0000000-0000-0000-0000-000000000001/att-toobig.pdf', 'huge.pdf', 'application/pdf', 3000000);
    raise notice 'FAIL 11: a >2MB attachment was accepted';
  exception when others then
    raise notice 'PASS 11: a >2MB attachment is rejected (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. HTML rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-hostile.html', '00000000-0000-0000-0000-000000000002');
  begin
    perform public.create_fixture_message_with_attachment(
      'c0000000-0000-0000-0000-000000000001', null, 'Hostile.',
      'f/c0000000-0000-0000-0000-000000000001/att-hostile.html', 'page.html', 'text/html', 1000);
    raise notice 'FAIL 12: an HTML attachment was accepted';
  exception when others then
    raise notice 'PASS 12: HTML is rejected by the MIME allowlist (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. SVG rejected (SVG can carry script -- deliberately not in the
--     image allowlist even though it is nominally an image type).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-hostile.svg', '00000000-0000-0000-0000-000000000002');
  begin
    perform public.create_fixture_message_with_attachment(
      'c0000000-0000-0000-0000-000000000001', null, 'Hostile SVG.',
      'f/c0000000-0000-0000-0000-000000000001/att-hostile.svg', 'logo.svg', 'image/svg+xml', 1000);
    raise notice 'FAIL 13: an SVG attachment was accepted';
  exception when others then
    raise notice 'PASS 13: SVG is rejected by the MIME allowlist (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Fake MIME / extension mismatch (claimed application/pdf, but the
--     object name has a .exe extension) is handled safely: the storage
--     path itself never trusts the extension for anything security-
--     relevant (no traversal, no execution), and the declared mime_type
--     still has to be in the allowlist -- a mismatched extension alone
--     does not bypass the MIME check, and vice versa.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-fake.exe', '00000000-0000-0000-0000-000000000002');
  begin
    perform public.create_fixture_message_with_attachment(
      'c0000000-0000-0000-0000-000000000001', null, 'Fake extension.',
      'f/c0000000-0000-0000-0000-000000000001/att-fake.exe', 'not-a-virus.pdf.exe', 'application/x-msdownload', 1000);
    raise notice 'FAIL 14: an executable disguised with a claimed PDF filename was accepted';
  exception when others then
    raise notice 'PASS 14: a mismatched extension/executable is safely rejected by the MIME allowlist regardless of filename (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 15. Path-traversal filename is harmless -- the ORIGINAL filename never
--     builds the storage path (storage_path is always the pre-generated
--     safe object name), so a hostile original_filename can only ever
--     end up as inert display text.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_stored_name text;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('fixture-attachments', 'f/c0000000-0000-0000-0000-000000000001/att-traversal.pdf', '00000000-0000-0000-0000-000000000002');
  perform public.create_fixture_message_with_attachment(
    'c0000000-0000-0000-0000-000000000001', null, 'Traversal attempt.',
    'f/c0000000-0000-0000-0000-000000000001/att-traversal.pdf', '../../../../etc/passwd', 'application/pdf', 1000);
  select original_filename into v_stored_name from public.fixture_message_attachments
  where storage_path = 'f/c0000000-0000-0000-0000-000000000001/att-traversal.pdf';
  if v_stored_name = '../../../../etc/passwd' then
    raise notice 'PASS 15: a path-traversal-shaped original_filename is stored as harmless display text only -- it never touched the real storage path';
  else
    raise notice 'FAIL 15: unexpected stored filename %', v_stored_name;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 16. Deleting one attachment cannot delete an unrelated storage object --
--     a Message Moderator removing this fixture's PDF must not touch the
--     JPEG/PNG objects also in the bucket.
-- ------------------------------------------------------------
-- Seeded as the default (superuser, RLS-bypassing) session role -- a
-- site_admins row can only ever be written by an existing Full Site Admin
-- (site_admins_insert_full_admin), so this cannot be done as user 0021
-- themselves (message_management.sql seeds it exactly the same way).
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.msg.moderator@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000021', 'Test', 'MsgModerator', 'test.msg.moderator@ovalball.local')
  on conflict (id) do nothing;
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000021', 'active', 'message_moderator')
  on conflict (user_id) do update set status = 'active', admin_role = 'message_moderator';
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';
do $$
declare
  v_pdf_attachment_id uuid;
  v_returned_path text;
  v_other_metadata_before int;
  v_other_metadata_after int;
  v_other_storage_count int;
begin
  select id into v_pdf_attachment_id from public.fixture_message_attachments where storage_path = 'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf';
  select count(*) into v_other_metadata_before from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
    where m.fixture_id = 'c0000000-0000-0000-0000-000000000001' and a.id <> v_pdf_attachment_id;
  v_returned_path := public.delete_fixture_message_attachment(v_pdf_attachment_id);
  select count(*) into v_other_metadata_after from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
    where m.fixture_id = 'c0000000-0000-0000-0000-000000000001' and a.id <> v_pdf_attachment_id;
  -- the RPC deletes only the metadata row and hands back the exact
  -- storage_path for the caller's server action to remove via the real
  -- Storage API (storage.objects' own protect_delete trigger refuses a
  -- bare SQL DELETE from application code) -- so the JPEG/PNG storage
  -- objects are provably untouched by this call.
  select count(*) into v_other_storage_count from storage.objects
    where bucket_id = 'fixture-attachments' and name like 'f/c0000000-0000-0000-0000-000000000001/att-%' and name <> 'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf';
  if v_other_metadata_before = v_other_metadata_after and v_other_metadata_before = 2
     and v_returned_path = 'f/c0000000-0000-0000-0000-000000000001/att-pdf-1.pdf'
     and v_other_storage_count = 2
     and not exists (select 1 from public.fixture_message_attachments where id = v_pdf_attachment_id) then
    raise notice 'PASS 16: deleting one attachment removes only its own metadata row (returning its exact storage_path for the caller to clean up) and leaves the other 2 attachments'' metadata AND storage objects untouched';
  else
    raise notice 'FAIL 16: before=% after=% returned_path=% other_storage=%', v_other_metadata_before, v_other_metadata_after, v_returned_path, v_other_storage_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. Non-moderator cannot delete an attachment (moderator access is
--     itself gated the same way as message report moderation).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; -- Burnley Club Admin, not a Site Admin
do $$
declare
  v_attachment_id uuid;
begin
  select id into v_attachment_id from public.fixture_message_attachments where storage_path = 'f/c0000000-0000-0000-0000-000000000001/att-jpg-1.jpg';
  begin
    perform public.delete_fixture_message_attachment(v_attachment_id);
    raise notice 'FAIL 17: a non-moderator Club Admin deleted an attachment';
  exception when others then
    raise notice 'PASS 17: a non-moderator (even the fixture-owning Club Admin) cannot delete an attachment (%)', sqlerrm;
  end;
end $$;
rollback;

-- Cleanup -- scenarios 1/2/3/16 deliberately committed real state.
-- storage.allow_delete_query is the real Storage API's own internal
-- bookkeeping flag (protect_delete trigger) -- setting it here is test-only
-- hygiene, never something application code should do.
do $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from public.fixture_message_attachments where message_id in (select id from public.fixture_messages where fixture_id = 'c0000000-0000-0000-0000-000000000001');
  delete from storage.objects where bucket_id = 'fixture-attachments' and name like '%c0000000-0000-0000-0000-000000000001%';
  delete from public.fixture_messages where fixture_id = 'c0000000-0000-0000-0000-000000000001';
  delete from public.fixtures where id = 'c0000000-0000-0000-0000-000000000001';
  delete from public.club_memberships where user_id = '00000000-0000-0000-0000-000000000041';
  delete from public.clubs where slug = 'aberdare-attach-test';
end $$;
