-- Fixture Management (Phase C). Reuses the existing fixtures/
-- fixture_source_refs/unresolved_names architecture rather than building
-- a parallel one -- fixture_source_refs already exists specifically for
-- idempotent-import dedup (unique on source_system+source_id) and
-- unresolved_names already exists as a generic club/team review queue.
-- What's genuinely missing, and what this migration adds, is the
-- PRE-PUBLISH staging layer (a CSV upload isn't safe to write straight
-- into `fixtures` -- see the brief's own staged-import requirement) and
-- fixture-level provenance/cancellation tracking.

-- ============================================================
-- 1. Fixture provenance and cancellation tracking.
-- ============================================================

alter table public.fixtures add column source text not null default 'club_created' check (source in ('club_created', 'site_admin_manual', 'csv_import', 'competition_import'));
-- Genuinely new: fixtures.status is a scheduling/confirmation STATE
-- (Planned/Booked/Cancelled/Completed/...), not a game-type CATEGORY --
-- there is no existing column this maps onto. Nullable: every fixture
-- created before this migration has no game type on record rather than a
-- guessed one.
alter table public.fixtures add column game_type text check (game_type in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match'));
comment on column public.fixtures.game_type is
  'Friendly / League Fixture / Cup Fixture / Scheduled Match -- a category, independent of fixtures.status (which tracks scheduling/confirmation state, not game type). Nullable for fixtures predating this column.';
alter table public.fixtures add column cancelled_at timestamptz;
alter table public.fixtures add column cancelled_by uuid references auth.users(id);
alter table public.fixtures add column cancellation_reason text;
alter table public.fixtures add column replaces_fixture_id uuid references public.fixtures(id);

comment on column public.fixtures.source is
  'Where this fixture record came from -- club_created (the normal club-facing flow), site_admin_manual, csv_import, or competition_import. Provenance only, never editable identity.';
comment on column public.fixtures.replaces_fixture_id is
  'Set when this fixture was published as the deliberate replacement for a cancelled one during CSV import conflict resolution (Section 41''s "Replace/cancel existing + notify" decision) -- traceability, not a foreign authority.';

-- ============================================================
-- 2. Staged CSV import: batch + row. Nothing here writes to `fixtures`
--    until an explicit publish action runs (Section 44's "approval before
--    publish"). Site Admin only end to end.
-- ============================================================

create table public.fixture_import_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references auth.users(id),
  filename text not null,
  row_count integer not null default 0,
  state text not null default 'uploaded' check (state in ('uploaded', 'processing', 'needs_review', 'ready_to_publish', 'publishing', 'completed', 'completed_with_exclusions', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id)
);

comment on table public.fixture_import_batches is
  'One row per CSV upload. state tracks the staged workflow (uploaded -> processing -> needs_review/ready_to_publish -> publishing -> completed[_with_exclusions]/failed) -- never a fake instantaneous "completed".';

alter table public.fixtures add column import_batch_id uuid references public.fixture_import_batches(id);

comment on column public.fixtures.import_batch_id is
  'Which fixture_import_batches upload published this fixture, if any -- traceability only, set by publish_import_row().';

create table public.fixture_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fixture_import_batches(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'needs_review', 'conflict', 'invalid', 'excluded', 'published')),
  errors jsonb not null default '[]'::jsonb,
  resolved_home_team_id uuid references public.teams(id),
  resolved_away_team_id uuid references public.teams(id),
  resolved_away_directory_id uuid references public.club_directory(id),
  resolved_venue_id uuid references public.venues(id),
  raw_opposition_text text,
  normalized_game_type text check (normalized_game_type in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match')),
  fixture_date date,
  kickoff_time time,
  source_reference text,
  notes text,
  conflicting_fixture_id uuid references public.fixtures(id),
  conflict_decision text check (conflict_decision in ('replace_and_notify', 'override_no_notify', 'keep_existing', 'keep_both')),
  published_fixture_id uuid references public.fixtures(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

comment on table public.fixture_import_rows is
  'One row per staged CSV line. status tracks readiness (pending -> ready/needs_review/conflict/invalid, then excluded or published) -- publish only ever moves a row from ready/conflict(resolved) to published, one row at a time, so a partial-batch failure is always precisely visible in this table rather than silently lost.';

create index fixture_import_rows_batch_id_idx on public.fixture_import_rows (batch_id);
create index fixture_import_rows_status_idx on public.fixture_import_rows (batch_id, status);

-- ============================================================
-- 3. Duplicate-import protection: a row fingerprint over the fields that
--    identify "the same real-world fixture" (owning team + opponent text
--    + date + time + source_reference), unique per batch upload attempt
--    checked at match time (app layer, not a DB constraint -- two
--    different batches legitimately might re-describe the same fixture
--    on a genuine correction re-upload, which must still be reviewable,
--    not silently blocked).
-- ============================================================

alter table public.fixture_source_refs add column import_batch_id uuid references public.fixture_import_batches(id);

comment on column public.fixture_source_refs.import_batch_id is
  'Which fixture_import_batches upload created this idempotency record, if any -- lets a re-upload of the same file recognise its own previously-published rows via the existing (source_system, source_id) unique constraint, rather than duplicating them.';

-- ============================================================
-- RLS: Site Admin only, end to end -- Fixture Management is explicitly
-- not a club-facing surface (club-side fixture tools keep their own
-- existing team/club-scoped RLS, entirely unchanged by this migration).
-- ============================================================

alter table public.fixture_import_batches enable row level security;
alter table public.fixture_import_rows enable row level security;

create policy fixture_import_batches_all_admin on public.fixture_import_batches for all
  using (internal.is_site_admin()) with check (internal.is_site_admin());
create policy fixture_import_rows_all_admin on public.fixture_import_rows for all
  using (internal.is_site_admin()) with check (internal.is_site_admin());

create trigger set_updated_at before update on public.fixture_import_batches for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.fixture_import_batches for each row execute function internal.audit_row_change();

-- ============================================================
-- 4. admin_fixture_overview: Site Admin's read model, mirroring
--    admin_club_overview / admin_user_overview's own reasoning -- a view,
--    not a duplicate store, security_invoker so it is exactly as
--    permissive as fixtures/teams/clubs' own RLS already is (which is
--    fully public -- fixtures_select_all grants anon read on the whole
--    table already; this view is purely a join convenience, not a new
--    grant of anything).
-- ============================================================

create view public.admin_fixture_overview
  with (security_invoker = true) as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.status,
  f.game_type,
  f.source,
  f.import_batch_id,
  f.replaces_fixture_id,
  f.raw_opposition_text,
  f.opponent_directory_id,
  f.opponent_team_id,
  f.season_label,
  f.notes,
  f.cancelled_at,
  f.cancellation_reason,
  f.created_at,
  f.updated_at,
  t.id as owning_team_id,
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  opp_cd.name as opponent_club_name,
  opp_t.display_name as opponent_team_name,
  comp.name as competition_name,
  v.name as venue_name,
  (select count(*) from public.fixture_messages fm where fm.fixture_id = f.id) as message_count
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id;

grant select on public.admin_fixture_overview to authenticated, anon;

-- ============================================================
-- 5. publish_import_row: the only path that turns one staged
--    fixture_import_rows into a real fixtures row. Atomic per row (one
--    Postgres transaction), not per batch -- so a large import's partial
--    completion is always precisely visible per row in
--    fixture_import_rows.status, never a silent "first 50 succeeded".
--    Handles all four conflict decisions from the review UI:
--      keep_existing        -> row excluded, nothing published.
--      replace_and_notify    -> existing fixture cancelled (with a
--                               fixture_messages note), new one published,
--                               linked via replaces_fixture_id.
--      override_no_notify    -> same cancellation, no message.
--      keep_both / no conflict -> new fixture published alongside
--                               whatever else already exists.
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
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may publish an import row.' using errcode = '42501';
  end if;

  select * into v_row from public.fixture_import_rows where id = p_row_id for update;
  if not found then
    raise exception 'Import row not found.';
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

  select * into v_batch from public.fixture_import_batches where id = v_row.batch_id;

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
        values (v_row.conflicting_fixture_id, auth.uid(), 'This fixture has been cancelled and replaced by a newly published fixture from a Site Admin import.');
      end if;
    end if;
    -- keep_both falls through to publishing the new fixture without
    -- touching the existing one at all.
  end if;

  insert into public.fixtures (
    owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
    kickoff_date, kickoff_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id
  )
  values (
    v_row.resolved_home_team_id, 'Home', v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.normalized_game_type, 'Booked', v_row.notes, 'csv_import', v_row.batch_id,
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

-- ============================================================
-- 4b. delete_fixture: the only path that may permanently remove a
--    fixtures row. Blocks whenever any fixture_messages or
--    fixture_requests row references it -- prefer cancel_fixture
--    (a plain status update, no RPC needed) for anything with real
--    activity. Mirrors delete_canonical_club / delete_permission_group's
--    own dependency-check pattern: never rely on the app layer alone.
-- ============================================================

create or replace function public.delete_fixture(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_count int;
  v_request_count int;
  v_import_row_count int;
  v_replaced_by_count int;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may permanently delete a fixture.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.fixtures where id = p_fixture_id) then
    raise exception 'Fixture not found.';
  end if;

  select count(*) into v_message_count from public.fixture_messages where fixture_id = p_fixture_id;
  select count(*) into v_request_count from public.fixture_requests where resulting_fixture_id = p_fixture_id;
  -- fixture_import_rows.published_fixture_id has no ON DELETE behavior --
  -- a fixture published via CSV import must be excluded here, or the
  -- DELETE below would fail with a raw, unhandled foreign-key violation
  -- instead of this function's own friendly error (found via live
  -- verification: attempting to delete a CSV-imported fixture surfaced
  -- exactly that raw Postgres error in the UI).
  select count(*) into v_import_row_count from public.fixture_import_rows where published_fixture_id = p_fixture_id;
  -- Another fixture's replaces_fixture_id pointing at this one (this
  -- fixture was itself cancelled-and-replaced by a later import) is the
  -- same kind of real history worth preserving.
  select count(*) into v_replaced_by_count from public.fixtures where replaces_fixture_id = p_fixture_id;

  if v_message_count > 0 or v_request_count > 0 or v_import_row_count > 0 or v_replaced_by_count > 0 then
    raise exception 'This fixture cannot be permanently deleted because it has messages, a fixture request, an import record, or a replacement fixture linked to it. Cancel it instead.';
  end if;

  delete from public.fixtures where id = p_fixture_id;
end;
$$;

comment on function public.delete_fixture(uuid) is
  'The only path that may permanently remove a fixtures row. Blocks whenever any fixture_messages, fixture_requests, fixture_import_rows (published_fixture_id), or another fixtures row (replaces_fixture_id) references it -- the import-row check exists because fixture_import_rows.published_fixture_id has no ON DELETE behavior, so skipping it would surface a raw foreign-key violation instead of this function''s own friendly error. Re-checks is_site_admin() itself; deletes strictly by id.';

revoke execute on function public.delete_fixture(uuid) from public;
grant execute on function public.delete_fixture(uuid) to authenticated;

comment on function public.publish_import_row(uuid) is
  'The only path that turns a staged fixture_import_rows row into a real fixtures row. Atomic per row -- a batch publish loops this one row at a time from the app, so partial completion is always precisely visible in fixture_import_rows.status rather than silently lost. Re-checks is_site_admin() itself.';

revoke execute on function public.publish_import_row(uuid) from public;
grant execute on function public.publish_import_row(uuid) to authenticated;

comment on view public.admin_fixture_overview is
  'Site Admin Fixture Management read model. security_invoker so it carries exactly fixtures/teams/clubs'' own RLS (already fully public via fixtures_select_all) -- the Fixture Management page itself is gated at the page level (ctx.isSiteAdmin), matching admin_club_overview/admin_user_overview''s own convention.';
