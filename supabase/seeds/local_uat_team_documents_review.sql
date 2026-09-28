-- Local UAT data for TEAM PROFILE DOCUMENTS PHYSICAL REVIEW (Section 7).
--
-- WHY THIS FILE IS A GUARD, NOT A LOADER
--
-- Real team documents need a real object in the private `club-documents` Storage bucket, exactly like
-- `local_uat_team_media_review.sql` already explains for Team Gallery photos -- a club_documents row
-- pointing at a storage_path with nothing behind it is a broken reference (a signed URL that resolves
-- to nothing), and Storage objects cannot be created from a plain SQL seed (`supabase db reset` only
-- runs `sql_paths`, which talk to Postgres, never the separate Storage service).
--
-- So the four review documents for Under 12 Boys (Ovalball UAT RUFC) --
-- "Team Rules & Code of Conduct", "Tour Information", "Parent Information", "Training Plan 2026/27" --
-- were created once, outside this file, by generating four genuine tiny PDFs and uploading them
-- through the Storage REST API (`POST /storage/v1/object/club-documents/{club_id}/{team_id}/{uuid}.pdf`
-- with the local service-role key) followed by a matching insert into `club_documents` with that exact
-- storage_path, club_id and team_id -- the same shape `add_team_document` itself would produce. That is
-- real, idempotent local review data: genuine PDF bytes, genuine club_documents rows, no fake seeded
-- React cards.
--
-- After a `supabase db reset`, that Storage-side upload does not replay (Storage bucket contents are
-- not part of `sql_paths`), so this guard only checks whether the four documents are still present and
-- says plainly what to do if they are not, rather than silently inserting a second, broken set of rows.

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Team Documents review UAT seed is local-only.';
  end if;
end $$;

do $$
declare
  v_u12_team uuid := '5f868069-b6ca-4bcd-8306-f73d234031d9'; -- Under 12 Boys, Ovalball UAT RUFC
  v_present integer;
begin
  if not exists (select 1 from public.teams where id = v_u12_team) then
    return; -- the exact review team this seed enriches doesn't exist in this database; nothing to check.
  end if;

  select count(*) into v_present
  from public.club_documents
  where team_id = v_u12_team
    and title in ('Team Rules & Code of Conduct', 'Tour Information', 'Parent Information', 'Training Plan 2026/27')
    and archived_at is null;

  if v_present < 4 then
    raise notice 'Team Documents review data for Under 12 Boys is incomplete (% of 4 present). Re-run the '
      'four-document Storage upload (see this file''s own header comment) to restore it -- a plain SQL '
      'insert cannot recreate the real PDF bytes those rows point at.', v_present;
  end if;
end $$;
