-- SIDE PROJECT 2 -- CALENDAR FIXTURE LIFECYCLE + MESSAGE CLUB HARDENING
-- (extension of Training Management, never a second fixture store).
--
-- Section A's rule stays true throughout: one fixture is one canonical
-- fixtures row (a two-sided confirmed fixture is genuinely TWO rows, one
-- per owning_team_id, reciprocally linked by mirror_fixture_id -- this
-- migration extends that exact, pre-existing shape rather than inventing
-- a parallel one). Every action here mutates the same fixtures row every
-- other surface (Fixture Management, Pitch Allocation, messaging, results,
-- Parent/Player consumption, exports, audit) already reads.

-- ============================================================
-- Part A: archive/soft-delete fields. Orthogonal to `status` -- an
-- archived fixture is a per-club "take this off my normal operational
-- views" housekeeping decision, never a mutual "this match didn't happen"
-- fact (that is what Cancel already means, and Cancel already exists).
-- Naming mirrors fixtures' own existing cancelled_at/cancelled_by/
-- cancellation_reason triple exactly, one step removed.
-- ============================================================

alter table public.fixtures
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id),
  add column archival_reason text;

comment on column public.fixtures.archived_at is
  'Set by archive_fixture() -- "Delete Fixture" in the product. Never a physical row delete (delete_fixture() remains the separate, narrower, Site-Admin-only hard-delete path for genuinely orphaned rows with zero activity). Null means not archived. Orthogonal to status: archiving does not itself cancel a fixture, and cancelling does not archive one -- Calendar/Fixture Management/Pitch Allocation must check BOTH independently.';
comment on column public.fixtures.archived_by is 'Actor who archived this fixture -- server-derived (auth.uid()), never client-submitted.';
comment on column public.fixtures.archival_reason is 'Required, non-blank reason captured at archive time (matches deactivate_training_plan''s own required-reason convention).';

create index fixtures_archived_at_idx on public.fixtures (archived_at) where archived_at is not null;

-- ============================================================
-- Part B: cancel_fixture -- the first genuinely callable, safe path for
-- an ordinary Club Admin/Team Admin/Coach/Manager to cancel a fixture.
-- Reuses the EXACT SAME authority boundary as every other fixture
-- mutation (internal.can_submit_fixture_result: team official or
-- club-level official of EITHER side) -- this is not new authority, it is
-- the same status flip the Edit panel's Status dropdown already allowed
-- unsafely, now made safe (required reason, mirror sync, system-event,
-- notification, all in one transaction). Mirrors fold_team()'s own
-- mirror-propagation precedent exactly.
-- ============================================================

create or replace function public.cancel_fixture(p_fixture_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to cancel this fixture.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a fixture.';
  end if;

  if f.status = 'Cancelled' then
    raise exception 'This fixture is already cancelled.';
  end if;

  if f.archived_at is not null then
    raise exception 'This fixture has been archived -- restore it before cancelling.';
  end if;

  update public.fixtures
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
  where id = p_fixture_id;

  if f.mirror_fixture_id is not null then
    update public.fixtures
    set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        cancellation_reason = format('Cancelled by the opposing club: %s', trim(p_reason))
    where id = f.mirror_fixture_id and status <> 'Cancelled';
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('This fixture has been cancelled. Reason: %s', trim(p_reason)));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_cancelled', 'Fixture cancelled',
    format('The fixture on %s has been cancelled. Reason: %s', to_char(f.kickoff_date, 'DD Mon YYYY'), trim(p_reason)));
end;
$$;

comment on function public.cancel_fixture(uuid, text) is
  'The safe, guided path to cancel a fixture from Calendar -- same authority boundary as every other fixture mutation (can_submit_fixture_result), required reason, propagates to the mirror row exactly like fold_team() already does, posts a system-event message into the shared conversation, and notifies both sides'' officials. Never used for the Status dropdown''s other values -- Cancelled is deliberately unreachable there once this exists (see fixture-actions.ts).';

revoke execute on function public.cancel_fixture(uuid, text) from public;
grant execute on function public.cancel_fixture(uuid, text) to authenticated;

-- ============================================================
-- Part C: archive_fixture -- "Delete Fixture" in the product. Narrower
-- authority than Cancel (Club Admin/Fixtures Secretary of THIS row's own
-- owning club only, matching the spec's role matrix where Team Admin/
-- Coach/Manager do not get this by default) and single-row-scoped --
-- deliberately does NOT touch the mirror row, because archiving is this
-- club's own operational housekeeping decision about its own calendar,
-- not a declaration about the real-world match (Cancel already covers
-- that, and does propagate). Does not require prior cancellation --
-- an admin may directly archive a clearly-erroneous or long-stale entry.
-- ============================================================

create or replace function public.archive_fixture(p_fixture_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_owning_club_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  if not (internal.can_manage_club_fixtures(v_owning_club_id) or internal.is_site_admin()) then
    raise exception 'Only this fixture''s own Club Admin or Fixtures Secretary may delete it.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to delete a fixture.';
  end if;

  if f.archived_at is not null then
    raise exception 'This fixture has already been deleted.';
  end if;

  update public.fixtures
  set archived_at = now(), archived_by = auth.uid(), archival_reason = trim(p_reason)
  where id = p_fixture_id;
end;
$$;

comment on function public.archive_fixture(uuid, text) is
  'Soft-delete ("Delete Fixture" in the product) -- never a physical row delete. Sets archived_at/archived_by/archival_reason only; does not mutate status and does not propagate to a mirror row (per-club housekeeping, not a mutual match fact). Gated to can_manage_club_fixtures on the fixture''s OWN owning club -- narrower than cancel_fixture, matching the product''s Team Admin/Coach/Manager "not by default" role matrix.';

revoke execute on function public.archive_fixture(uuid, text) from public;
grant execute on function public.archive_fixture(uuid, text) to authenticated;

-- ============================================================
-- Part D: restore_fixture -- the minimal safe reuse of an existing
-- canonical pattern (reactivate_training_plan already established that
-- "undo an archive/deactivation, nothing more" is a legitimate, small,
-- one-column-group RPC in this codebase). Reverses ONLY the archive step
-- -- a fixture that was also cancelled before being archived comes back
-- restored-but-still-cancelled, exactly mirroring how reactivating a
-- training plan never silently un-cancels an individually-overridden
-- session. Same narrow authority as archive_fixture.
-- ============================================================

create or replace function public.restore_fixture(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_owning_club_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  if not (internal.can_manage_club_fixtures(v_owning_club_id) or internal.is_site_admin()) then
    raise exception 'Only this fixture''s own Club Admin or Fixtures Secretary may restore it.' using errcode = '42501';
  end if;

  if f.archived_at is null then
    raise exception 'This fixture is not deleted.';
  end if;

  update public.fixtures
  set archived_at = null, archived_by = null, archival_reason = null
  where id = p_fixture_id;
end;
$$;

comment on function public.restore_fixture(uuid) is
  'Reverses archive_fixture() only -- never touches status/cancellation, matching reactivate_training_plan''s own precedent of undoing exactly its own prior action and nothing else. Same authority boundary as archive_fixture.';

revoke execute on function public.restore_fixture(uuid) from public;
grant execute on function public.restore_fixture(uuid) to authenticated;

-- ============================================================
-- Part E: Deleted Calendar Events -- a normalized READ projection over
-- archived fixtures and deactivated/cancelled training, per Section H/R:
-- never merges the two canonical domain tables, exposes a stable
-- canonical_id + event_type so a consumer can always resolve back to the
-- real fixtures/training_sessions/training_plans row. security_invoker so
-- it carries exactly the same RLS the underlying tables already have --
-- a plain view is not itself a new authorization surface.
-- ============================================================

create view public.deleted_calendar_events
  with (security_invoker = true) as
select
  'fixture'::text as event_type,
  f.id as canonical_id,
  f.owning_team_id as team_id,
  t.display_name as team_name,
  f.raw_opposition_text as opponent_label,
  f.kickoff_date as event_date,
  f.kickoff_time as event_time,
  v.name as venue_name,
  f.status as original_status,
  f.archived_at as deleted_at,
  f.archived_by as deleted_by,
  f.archival_reason as deleted_reason,
  c.id as club_id
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
left join public.venues v on v.id = f.venue_id
where f.archived_at is not null
union all
select
  'training'::text as event_type,
  ts.id as canonical_id,
  ts.team_id,
  t.display_name as team_name,
  null as opponent_label,
  ts.occurrence_date as event_date,
  ts.start_time as event_time,
  v.name as venue_name,
  case when ts.cancelled_at is not null then 'CANCELLED' else 'PLANNED' end as original_status,
  ts.cancelled_at as deleted_at,
  ts.cancelled_by as deleted_by,
  ts.cancellation_reason as deleted_reason,
  c.id as club_id
from public.training_sessions ts
join public.teams t on t.id = ts.team_id
join public.clubs c on c.id = t.club_id
left join public.venues v on v.id = ts.venue_id
where ts.cancelled_at is not null
  and (
    ts.training_plan_id is null
    or exists (select 1 from public.training_plans tp where tp.id = ts.training_plan_id and tp.status = 'INACTIVE')
    or ts.is_overridden = true
  );

comment on view public.deleted_calendar_events is
  'Back-office-only normalized READ projection (Section H) over archived fixtures (fixtures.archived_at) and genuinely-removed training (individually-cancelled sessions, or any session belonging to a deactivated plan) -- never a merged table, never mutated directly. Each row carries event_type + canonical_id so a consumer resolves back to the one real fixtures/training_sessions row. security_invoker: carries exactly the underlying tables'' own RLS, so a caller only ever sees rows for clubs they can already manage.';

grant select on public.deleted_calendar_events to authenticated;
