-- TEAM DOCUMENTS -- Team Profile Section 7, converging on the EXISTING Club Document Library
-- (20260831440000_document_library.sql) rather than a second document system.
--
-- FORENSIC AUDIT (read in full before writing this migration): `club_documents`/`document_folders`
-- have no team_id today -- every document belongs to an activated club or a canonical club_directory
-- row, never a team. `club.documents.view`/`club.documents.manage` are CLUB-SCOPE ONLY capabilities;
-- `club.documents.view` is held by CA/CO/FS/MB/SO/TM/VO (i.e. effectively every club member via the
-- base MEMBER bundle) but NOT by PL (Player) or PG (Guardian) -- so ordinary players/guardians, the
-- exact audience "Parent Information"/"Tour Information" are written for, cannot see the club document
-- library at all today. This migration is additive only: it widens nobody's EXISTING access and
-- narrows nothing; it adds a second, team-scoped path to the SAME rows, for the SAME reasons Squad/
-- Staff/Media already use team.roster.view as "may this viewer see this team's own material".
--
-- TEAM IDENTITY AUDIT -- SEASON HANDOVER: `internal.progress_rollover_planned_team` (the function that
-- applies a planned age-grade progression, 20261222000000_apply_is_the_only_mutation_boundary.sql) does
-- NOT always keep the same teams.id. Reading its body directly: if no existing team row already matches
-- the target (category, age_group, gender, squad_designation) for the club, it INSERTS A NEW teams row
-- with a NEW id (only a PRE-EXISTING inactive match gets reactivated in place). It already carries one
-- kind of continuity forward explicitly -- "Staff follow the cohort": when progressing into a new id,
-- it copies team_permissions rows from `pt.source_team_id` (the predecessor) to the new id. There is no
-- separate permanent "team lineage" table; `source_team_id` -> the new id is the one continuity signal
-- the rollover-apply transaction itself produces, exactly once, at the moment of progression.
--
-- Team Documents follows the EXACT SAME established precedent, in the EXACT SAME function, right next
-- to where staff permissions are already carried over: when a NEW team id is created for a progressing
-- cohort, this team's own club_documents rows are RE-POINTED (team_id updated in place, never copied,
-- matching this domain's own "share by reference, never duplicate" philosophy) from source_team_id to
-- the new id. When an INACTIVE team is instead reactivated, no re-pointing is needed at all -- it is
-- literally the same id, so its documents were never disconnected in the first place.
--
-- FOLD TEAM: internal.fold_team_core does not touch club_documents/document_folders at all, and this
-- migration does not change that -- a folded team's documents stay exactly where they are (team_id
-- unchanged), simply no longer surfaced through active-team browsing, matching the brief's own
-- "documents remain retained/auditable" expectation with zero new code.

-- ---------------------------------------------------------------------------------------------------
-- 1. team_id on club_documents -- virtual/derived team folders (Section 22), never a persisted
--    document_folders row per team. A general club file still uses folder_id as before; a team document
--    has folder_id = null and team_id set instead.
-- ---------------------------------------------------------------------------------------------------
alter table public.club_documents add column team_id uuid references public.teams(id);
create index club_documents_team_id_idx on public.club_documents (team_id) where team_id is not null;

comment on column public.club_documents.team_id is
  'When set, this document belongs to this team (Team Profile Section 7) -- the SAME canonical row Club '
  'Documents presents as that team''s virtual folder. Never both team_id and folder_id: a team document '
  'is never also filed into a general club folder. The stable relationship is document -> team identity '
  '(teams.id) -> current display name, never document -> a name string.';

alter table public.club_documents add constraint club_documents_team_xor_folder
  check (team_id is null or folder_id is null);

-- Extends the existing ownership-enforcement trigger (fires before insert/update on club_documents
-- already) rather than adding a second trigger: a team_id must belong to the SAME club this document
-- belongs to, exactly the same "never move into another club's library" rule this trigger already
-- enforces for folder_id.
create or replace function internal.enforce_document_folder_ownership()
returns trigger
language plpgsql
as $$
declare
  v_parent public.document_folders;
  v_team public.teams;
begin
  if new.folder_id is not null then
    select * into v_parent from public.document_folders where id = new.folder_id;
    if not found then
      raise exception 'Folder not found.';
    end if;
    if v_parent.club_id is distinct from new.club_id or v_parent.directory_id is distinct from new.directory_id then
      raise exception 'A document cannot be moved into another club''s folder.' using errcode = '42501';
    end if;
  end if;
  if new.team_id is not null then
    select * into v_team from public.teams where id = new.team_id;
    if not found then
      raise exception 'Team not found.';
    end if;
    if v_team.club_id is distinct from new.club_id then
      raise exception 'A document cannot be attached to another club''s team.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. RLS -- additive only. The existing club-scope policies (club.documents.view/manage) are untouched;
--    a new OR-branch admits a team-scoped viewer/manager for exactly the documents tagged to their own
--    team, reusing team.roster.view / team.team.manage / club.profile.edit -- the SAME pair Squad,
--    Staff, Media and Team Details already use, never a new capability key.
-- ---------------------------------------------------------------------------------------------------
drop policy club_documents_select_owner on public.club_documents;
create policy club_documents_select_owner on public.club_documents for select
  using (
    (select internal.has_site_capability('site.clubs.view')) or
    club_id in (select unnest(internal.club_ids_with('club.documents.view'))) or
    (team_id is not null and internal.has_capability('team.roster.view', 'team', club_id, team_id))
  );

drop policy club_documents_insert on public.club_documents;
create policy club_documents_insert on public.club_documents for insert
  with check (
    (select internal.has_site_capability('site.clubs.profile.manage')) or
    club_id in (select unnest(internal.club_ids_with('club.documents.manage'))) or
    (team_id is not null and (
      internal.has_capability('team.team.manage', 'team', club_id, team_id)
      or internal.has_capability('club.profile.edit', 'club', club_id, null)
    ))
  );

drop policy club_documents_update on public.club_documents;
create policy club_documents_update on public.club_documents for update
  using (
    (select internal.has_site_capability('site.clubs.profile.manage')) or
    club_id in (select unnest(internal.club_ids_with('club.documents.manage'))) or
    (team_id is not null and (
      internal.has_capability('team.team.manage', 'team', club_id, team_id)
      or internal.has_capability('club.profile.edit', 'club', club_id, null)
    ))
  );

drop policy club_documents_delete on public.club_documents;
create policy club_documents_delete on public.club_documents for delete
  using (
    (select internal.has_site_capability('site.clubs.profile.manage')) or
    club_id in (select unnest(internal.club_ids_with('club.documents.manage'))) or
    (team_id is not null and (
      internal.has_capability('team.team.manage', 'team', club_id, team_id)
      or internal.has_capability('club.profile.edit', 'club', club_id, null)
    ))
  );

-- ---------------------------------------------------------------------------------------------------
-- 3. Storage: the SAME private club-documents bucket, extended to a second, team-scoped path shape --
--    "{club_id}/{team_id}/{uuid}.{ext}" -- alongside the existing "{club_id-or-directory_id}/{uuid}.{ext}"
--    general-file shape, which is completely unchanged below. The bucket's own allow-list
--    (20260831440000) only covered PDF/JPEG/PNG/WEBP; Team Documents needs Word documents too (the
--    brief's own example set includes "Team Rules & Code of Conduct.pdf" alongside ordinary club
--    paperwork that legitimately arrives as .doc/.docx), so the allow-list is widened here, in the same
--    additive spirit as everything else in this migration -- nothing existing is narrowed.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'club-documents';

create or replace function internal.can_access_document_storage_path(p_object_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_owner_id uuid;
  v_team_id uuid;
begin
  v_parts := storage.foldername(p_object_name);
  v_owner_id := v_parts[1]::uuid;

  if array_length(v_parts, 1) = 2 then
    v_team_id := v_parts[2]::uuid;
    if not exists (select 1 from public.teams t where t.id = v_team_id and t.club_id = v_owner_id) then
      return false;
    end if;
    if p_write then
      return internal.can_manage_document_library(v_owner_id, null)
          or internal.has_capability('team.team.manage', 'team', v_owner_id, v_team_id)
          or internal.has_capability('club.profile.edit', 'club', v_owner_id, null);
    end if;
    return internal.can_view_document_library(v_owner_id, null)
        or internal.has_capability('team.roster.view', 'team', v_owner_id, v_team_id);
  end if;

  if p_write then
    return internal.can_manage_document_library(
      (select id from public.clubs where id = v_owner_id),
      (select id from public.club_directory where id = v_owner_id)
    );
  end if;
  return internal.can_view_document_library(
    (select id from public.clubs where id = v_owner_id),
    (select id from public.club_directory where id = v_owner_id)
  )
  or exists (
    select 1 from public.club_documents d
    join public.fixture_message_document_refs r on r.document_id = d.id
    join public.fixture_messages m on m.id = r.message_id
    where d.storage_path = p_object_name and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
  );
exception when invalid_text_representation then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. add_team_document / read_team_documents -- the same reader/writer shape team_media already
--    established (Section 5): read raises 42501 outright when refused, never a silent empty list.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.add_team_document(
  p_team_id uuid, p_storage_path text, p_title text, p_original_filename text, p_mime_type text, p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
  v_id uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if v_title is null then
    raise exception 'A document needs a title.' using errcode = '23514';
  end if;

  if not (
    internal.can_manage_document_library(v_club_id, null)
    or internal.has_capability('team.team.manage', 'team', v_club_id, p_team_id)
    or internal.has_capability('club.profile.edit', 'club', v_club_id, null)
  ) then
    raise exception 'Not authorized to add documents to this team.' using errcode = '42501';
  end if;

  if p_storage_path !~ ('^' || v_club_id::text || '/' || p_team_id::text || '/[0-9a-f-]{36}\.[a-z0-9]+$') then
    raise exception 'That file was not uploaded for this team.' using errcode = '22023';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'Use a PDF, Word document or image.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'That file is too large -- documents are limited to 10MB.' using errcode = '22023';
  end if;

  insert into public.club_documents (club_id, team_id, folder_id, title, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (v_club_id, p_team_id, null, v_title, p_original_filename, p_storage_path, p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_team_document(uuid, text, text, text, text, integer) to authenticated;

create or replace function public.read_team_documents(p_team_id uuid)
returns table(
  id uuid, title text, original_filename text, storage_path text, mime_type text, size_bytes integer,
  uploaded_by uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where teams.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not (
    internal.can_view_document_library(v_club_id, null)
    or internal.has_capability('team.roster.view', 'team', v_club_id, p_team_id)
  ) then
    raise exception 'Not authorized to view this team''s documents.' using errcode = '42501';
  end if;

  return query
  select d.id, d.title, d.original_filename, d.storage_path, d.mime_type, d.size_bytes, d.uploaded_by, d.created_at
  from public.club_documents d
  where d.team_id = p_team_id and d.archived_at is null
  order by d.created_at desc;
end;
$$;

grant execute on function public.read_team_documents(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. internal.apply_planned_team extended, in place -- documents follow the cohort through Season
--    Handover exactly the way staff already do (the block immediately below), re-pointing rather than
--    copying (this domain's own "share by reference, never duplicate" philosophy). Everything else in
--    this function is copied byte-for-byte from 20261222000000_apply_is_the_only_mutation_boundary.sql
--    -- only the new "Documents follow the cohort" block and the widened audit payload are added.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.apply_planned_team(
  p_planned_id uuid, p_actor uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  pt public.age_grade_rollover_planned_teams;
  r public.age_grade_rollovers;
  ctt public.canonical_team_types;
  v_existing public.teams;
  v_label text;
  v_id uuid;
  v_reactivated boolean := false;
  v_staff integer := 0;
  v_documents integer := 0;
begin
  select * into pt from public.age_grade_rollover_planned_teams where id = p_planned_id for update;
  if pt.applied_at is not null then return pt.created_team_id; end if;
  select * into r from public.age_grade_rollovers where id = pt.rollover_id;
  select * into ctt from public.canonical_team_types where id = pt.canonical_team_type_id;

  v_label := ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end;

  select * into v_existing from public.teams
  where club_id = r.club_id and rugby_code = r.rugby_code
    and category = ctt.category and age_group = ctt.age_group
    and gender is not distinct from ctt.gender
    and squad_designation is not distinct from pt.squad_designation
  order by active desc, created_at asc
  limit 1;

  if v_existing.id is not null then
    v_id := v_existing.id;
    if not v_existing.active then
      update public.teams
      set active = true, archived_at = null, archived_by = null,
          folded_at = null, folded_by = null, fold_reason = null,
          display_name = v_label, updated_by = p_actor
      where id = v_id;
      v_reactivated := true;
    end if;
  else
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation,
                              display_name, slug, created_by, updated_by)
    values (r.club_id, r.rugby_code, ctt.category, ctt.age_group, ctt.gender, pt.squad_designation,
            v_label,
            trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(gen_random_uuid()::text, 1, 8),
            p_actor, p_actor)
    returning id into v_id;
  end if;

  -- Staff follow the cohort. A progressing team keeps its own id and so keeps
  -- its staff automatically; a newly created one would start with nobody.
  -- Never into an adult team, and never around a safeguarding check: these are
  -- existing club memberships being given a team assignment, not new people.
  --
  -- PRE-EXISTING BUG FIXED IN PLACE, out of Section 7's own scope but inside the exact function this
  -- migration already redefines: `team_permissions` is a compatibility VIEW (with an INSTEAD OF trigger,
  -- internal.legacy_team_permission_write), not a table, so `on conflict (membership_id, team_id)` here
  -- could never plan -- Postgres has no arbiter index to check against a view, and this statement threw
  -- unconditionally whenever a youth-category planned team had a source_team_id, breaking Season Handover
  -- apply entirely for that (very common) case. Confirmed pre-existing: the untouched original in
  -- 20261222000000_apply_is_the_only_mutation_boundary.sql has the identical clause, and the pre-existing
  -- supabase/tests/handover_successor_teams.sql already failed on it before this migration touched
  -- anything. The fix is simply to drop the now-redundant ON CONFLICT: the trigger itself is already
  -- idempotent per row (it looks up an existing ACTIVE/SUSPENDED role_assignment for that membership/team/
  -- role before creating one), so a duplicate source row was never actually going to double-assign a role
  -- either way.
  if pt.source_team_id is not null and ctt.category = 'youth' then
    insert into public.team_permissions (membership_id, team_id, permission, assigned_group_id, created_by)
    select tp.membership_id, v_id, tp.permission, tp.assigned_group_id, p_actor
    from public.team_permissions tp
    where tp.team_id = pt.source_team_id;
    get diagnostics v_staff = row_count;
  end if;

  -- Documents follow the cohort (Team Profile Section 7). A progressing team that kept its own id (the
  -- reactivation branch above) already keeps its documents -- nothing to do. Only a genuinely NEW id
  -- needs its predecessor's documents re-pointed, and re-pointed rather than copied: the SAME canonical
  -- rows simply now belong to the continuing team, never a second, disconnected set.
  if pt.source_team_id is not null and v_id <> pt.source_team_id and not v_reactivated then
    update public.club_documents
    set team_id = v_id
    where team_id = pt.source_team_id;
    get diagnostics v_documents = row_count;
  end if;

  update public.age_grade_rollover_planned_teams
  set created_team_id = v_id, reactivated = v_reactivated, applied_at = now()
  where id = p_planned_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_id, case when v_reactivated then 'update' else 'insert' end, p_actor,
    jsonb_build_object('event', case when v_reactivated then 'HANDOVER_TEAM_REACTIVATED' else 'HANDOVER_TEAM_CREATED' end,
                       'rollover_id', r.id, 'planned_team_id', p_planned_id, 'origin', pt.origin,
                       'source_team_id', pt.source_team_id, 'staff_carried_over', v_staff,
                       'documents_carried_over', v_documents,
                       'target_season_id', r.to_season_id));

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------
-- 6. delete_club_document extended, in place -- the ONE canonical delete path, never a second one for
--    team documents. Adds the same team-scoped OR-branch RLS already gained; behaviour (hard delete,
--    refused if shared in a fixture conversation) is completely unchanged for every existing caller.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.delete_club_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.club_documents;
  v_ref_count integer;
begin
  select * into v_doc from public.club_documents where id = p_document_id;
  if not found then
    raise exception 'Document not found.';
  end if;
  if not (
    internal.can_manage_document_library(v_doc.club_id, v_doc.directory_id)
    or (v_doc.team_id is not null and (
      internal.has_capability('team.team.manage', 'team', v_doc.club_id, v_doc.team_id)
      or internal.has_capability('club.profile.edit', 'club', v_doc.club_id, null)
    ))
  ) then
    raise exception 'You are not authorized to delete this document.' using errcode = '42501';
  end if;

  select count(*) into v_ref_count from public.fixture_message_document_refs where document_id = p_document_id;
  if v_ref_count > 0 then
    raise exception 'This document has been shared in % fixture conversation(s) and cannot be permanently deleted -- archive it instead.', v_ref_count;
  end if;

  delete from public.club_documents where id = p_document_id;
end;
$$;
