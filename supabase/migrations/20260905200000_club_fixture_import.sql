-- Club-level fixture CSV import/export (Master Fixture Registry mega-spec
-- Section BE: "Club Admin / properly-authorised Fixtures Secretary should
-- be able to Import Fixtures"). The staged upload -> parse -> validate ->
-- resolve -> review -> authorise -> commit workflow already exists in
-- full (20260831250000_fixture_management.sql's fixture_import_batches/
-- fixture_import_rows/publish_import_row), built Site-Admin-only. This
-- migration widens that SAME engine to a club-scoped variant rather than
-- building a second one -- one CSV contract, one staging table, one
-- publish path, matching the mega-spec's "no architectural shortcuts /
-- one CSV schema" requirement (Section BC/DL).

-- ============================================================
-- 1. club_id: null means the existing Site-Admin global import
--    (completely unchanged, backward compatible); non-null means a
--    club-scoped import, restricted to that one club's own teams as the
--    home side -- never another club's.
-- ============================================================

alter table public.fixture_import_batches
  add column club_id uuid references public.clubs(id);

comment on column public.fixture_import_batches.club_id is
  'NULL = Site Admin global import (original behaviour, unchanged). Set = a club-scoped import, gated by internal.can_manage_club_fixtures(club_id) instead of is_site_admin() -- every row in this batch may only resolve its home team to a team belonging to this exact club (enforced in the app-layer matching AND re-checked by publish_import_row before writing).';

-- ============================================================
-- 2. RLS: widen from Site-Admin-only to "Site Admin OR the real fixture
--    authority for this batch's own club" -- the SAME can_manage_club_
--    fixtures() check every other club-scoped fixture write in this app
--    already uses (Club Admin, or FIXTURE_SECRETARY at that club).
-- ============================================================

drop policy if exists fixture_import_batches_all_admin on public.fixture_import_batches;
create policy fixture_import_batches_admin_or_club on public.fixture_import_batches for all
  using (internal.is_site_admin() or (club_id is not null and internal.can_manage_club_fixtures(club_id)))
  with check (internal.is_site_admin() or (club_id is not null and internal.can_manage_club_fixtures(club_id)));

drop policy if exists fixture_import_rows_all_admin on public.fixture_import_rows;
create policy fixture_import_rows_admin_or_club on public.fixture_import_rows for all
  using (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixture_import_batches b
      where b.id = batch_id and b.club_id is not null and internal.can_manage_club_fixtures(b.club_id)
    )
  )
  with check (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixture_import_batches b
      where b.id = batch_id and b.club_id is not null and internal.can_manage_club_fixtures(b.club_id)
    )
  );

-- ============================================================
-- 2b. fixture_id-based update detection (Section BN/BD/DX: "if CSV
--    contains an existing valid fixture_id and user has permission,
--    stage it as Update existing fixture"). The existing 'conflict'
--    status means something different (an AMBIGUOUS same-team-same-date
--    collision the CSV never named on purpose) -- an explicit fixture_id
--    match is never ambiguous, so it gets its own status and its own
--    publish behaviour (UPDATE the row, never INSERT a new one).
--    matched_fixture_id is intentionally a separate column from the
--    pre-existing conflicting_fixture_id -- they can never both be set
--    for the same row (an explicit fixture_id match short-circuits the
--    date/team collision check entirely in the app-layer matcher).
-- ============================================================

alter table public.fixture_import_rows
  add column matched_fixture_id uuid references public.fixtures(id);

comment on column public.fixture_import_rows.matched_fixture_id is
  'Set when the CSV row explicitly named an existing fixture_id the importing user has permission to edit -- publish_import_row() UPDATEs this row''s scheduling fields (date/kickoff/game_type/notes) instead of inserting a new fixtures row. Never guessed -- only ever set from a literal fixture_id column value that resolved and passed the same club-authority check as everything else in this batch.';

alter table public.fixture_import_rows drop constraint fixture_import_rows_status_check;
alter table public.fixture_import_rows add constraint fixture_import_rows_status_check
  check (status in ('pending', 'ready', 'needs_review', 'conflict', 'update', 'invalid', 'excluded', 'published'));

-- ============================================================
-- 3. publish_import_row: widen the internal authority check the same
--    way. Re-ordered to fetch the batch (needed to know club_id) before
--    checking authority, since the original Site-Admin-only version had
--    no reason to look at the batch that early. Also handles the new
--    'update' status (2b above).
-- ============================================================

create or replace function public.publish_import_row(p_row_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fixture_import_rows;
  v_batch public.fixture_import_batches;
  v_new_fixture_id uuid;
begin
  select * into v_row from public.fixture_import_rows where id = p_row_id for update;
  if not found then
    raise exception 'Import row not found.';
  end if;

  select * into v_batch from public.fixture_import_batches where id = v_row.batch_id;

  if not (internal.is_site_admin() or (v_batch.club_id is not null and internal.can_manage_club_fixtures(v_batch.club_id))) then
    raise exception 'You are not authorised to publish this import.' using errcode = '42501';
  end if;

  -- 'update' short-circuits the whole create/conflict path below: the row
  -- named an existing, permitted fixture_id explicitly, so this UPDATEs
  -- that row's scheduling fields (never its team/opponent identity --
  -- bulk-reassigning who a fixture is between is not something a CSV
  -- update row does) rather than inserting a second fixture for the same
  -- real-world match.
  if v_row.status = 'update' then
    if v_row.matched_fixture_id is null then
      raise exception 'Row has no matched fixture to update.';
    end if;
    if v_batch.club_id is not null then
      if not exists (
        select 1 from public.fixtures f join public.teams t on t.id = f.owning_team_id
        where f.id = v_row.matched_fixture_id and t.club_id = v_batch.club_id
      ) then
        raise exception 'This row''s matched fixture does not belong to the importing club.' using errcode = '23514';
      end if;
    end if;
    update public.fixtures
    set kickoff_date = coalesce(v_row.fixture_date, kickoff_date),
        kickoff_time = v_row.kickoff_time,
        game_type = coalesce(v_row.normalized_game_type, game_type),
        notes = coalesce(v_row.notes, notes),
        updated_by = auth.uid()
    where id = v_row.matched_fixture_id
    returning id into v_new_fixture_id;

    update public.fixture_import_rows
    set status = 'published', published_fixture_id = v_new_fixture_id, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_row_id;

    return v_new_fixture_id;
  end if;

  if v_row.status not in ('ready', 'conflict') then
    raise exception 'Row is not in a publishable state (current status: %).', v_row.status;
  end if;
  if v_row.resolved_home_team_id is null then
    raise exception 'Row has no resolved home team -- cannot publish.';
  end if;
  if v_row.fixture_date is null then
    raise exception 'Row has no fixture date -- cannot publish as a scheduled fixture.';
  end if;

  -- Defense in depth: even if a row's home team was somehow resolved
  -- outside this batch's own club (should never happen given the
  -- app-layer matching restricts the search itself), a club-scoped batch
  -- can never publish a fixture owned by a different club.
  if v_batch.club_id is not null then
    if not exists (select 1 from public.teams t where t.id = v_row.resolved_home_team_id and t.club_id = v_batch.club_id) then
      raise exception 'This row''s home team does not belong to the importing club.' using errcode = '23514';
    end if;
  end if;

  if v_row.status = 'conflict' then
    if v_row.conflict_decision is null then
      raise exception 'Row has an unresolved conflict -- choose a decision before publishing.';
    end if;
    if v_row.conflict_decision = 'keep_existing' then
      update public.fixture_import_rows set status = 'excluded', reviewed_by = auth.uid(), reviewed_at = now() where id = p_row_id;
      return null;
    end if;
    if v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') and v_row.conflicting_fixture_id is not null then
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
          cancellation_reason = 'Replaced by CSV import (' || coalesce(v_batch.filename, 'import') || ')'
      where id = v_row.conflicting_fixture_id;

      if v_row.conflict_decision = 'replace_and_notify' then
        insert into public.fixture_messages (fixture_id, sender_user_id, body)
        values (v_row.conflicting_fixture_id, auth.uid(), 'This fixture has been cancelled and replaced by a newly published fixture from a CSV import.');
      end if;
    end if;
  end if;

  insert into public.fixtures (
    owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
    kickoff_date, kickoff_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id
  )
  values (
    v_row.resolved_home_team_id, 'Home', v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.normalized_game_type, 'Booked', v_row.notes,
    case when v_batch.club_id is not null then 'club_created' else 'csv_import' end,
    v_row.batch_id,
    case when v_row.status = 'conflict' and v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') then v_row.conflicting_fixture_id else null end
  )
  returning id into v_new_fixture_id;

  if v_row.source_reference is not null and v_row.source_reference <> '' then
    insert into public.fixture_source_refs (fixture_id, source_system, source_id, import_batch_id)
    values (v_new_fixture_id, 'csv_import', v_row.source_reference, v_row.batch_id)
    on conflict (source_system, source_id) do nothing;
  end if;

  update public.fixture_import_rows
  set status = 'published', published_fixture_id = v_new_fixture_id, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_row_id;

  return v_new_fixture_id;
end;
$$;

comment on function public.publish_import_row(uuid) is
  'The only path that turns a staged fixture_import_rows row into a real fixtures row. Atomic per row. Authorises either Site Admin (batch.club_id null, the original global import) or the real fixture authority for the batch''s own club (Club Admin/FIXTURE_SECRETARY, via internal.can_manage_club_fixtures) -- a club-scoped import always publishes with source=''club_created'', a Site Admin global import keeps source=''csv_import'', matching each path''s own real provenance.';
