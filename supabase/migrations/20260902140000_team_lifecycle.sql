-- Team folding / reactivation / fixture restoration. Reuses public.teams.
-- active (already existed) as the real lifecycle flag rather than adding
-- a parallel status enum -- 'folded' IS active=false, with the timestamped
-- actor/reason columns below recording the CURRENT fold event; the
-- pre-existing generic audit_row_change trigger on teams (already
-- attached, 20260830143512) is the full history mechanism, matching this
-- codebase's own established pattern (club_pitches/scheduling_groups
-- lean on the same trigger rather than a bespoke history table). Never a
-- delete -- teams.id, its permissions, its historical fixtures/results
-- all survive a fold untouched.

alter table public.teams
  add column folded_at timestamptz,
  add column folded_by uuid references auth.users(id),
  add column fold_reason text;

comment on column public.teams.folded_at is
  'Set when active=false via fold_team() -- null means the team has never been folded (or was reactivated). The FULL fold/reactivate history lives in audit_log, not here -- these three columns describe only the current/most-recent event.';

alter table public.fixtures
  add column cancelled_due_to_fold boolean not null default false,
  add column restoration_requested_at timestamptz,
  add column restoration_requested_by uuid references auth.users(id);

comment on column public.fixtures.cancelled_due_to_fold is
  'True only for a fixture the fold_team() workflow itself cancelled -- distinguishes "cancelled because the owning team folded, eligible for the Previously Cancelled Fixtures restoration flow" from any other reason a fixture might be cancelled.';

-- ============================================================
-- fold_team: Club Admin (or Site Admin) only, reason required. Cancels
-- every FUTURE, not-already-cancelled fixture owned by this team --
-- PAST fixtures and every result already recorded are never touched.
-- A real, activated opponent is notified with a real chat system event;
-- an external/unresolved opponent gets no fake notification (there is
-- nobody authenticated to notify), matching the same distinction
-- submit_fixture_result already draws.
-- ============================================================

create or replace function public.fold_team(p_team_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.teams;
  v_affected_count integer := 0;
  r record;
  v_is_external boolean;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found.';
  end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may fold a team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to fold a team.';
  end if;
  if not t.active then
    raise exception 'This team is already folded.';
  end if;

  update public.teams
  set active = false, folded_at = now(), folded_by = auth.uid(), fold_reason = trim(p_reason)
  where id = p_team_id;

  for r in
    select * from public.fixtures
    where owning_team_id = p_team_id
      and kickoff_date >= current_date
      and status <> 'Cancelled'
  loop
    v_is_external := r.opponent_team_id is null
      or not exists (select 1 from public.teams t2 join public.clubs c on c.id = t2.club_id where t2.id = r.opponent_team_id and c.status = 'active');

    update public.fixtures
    set status = 'Cancelled', cancelled_at = now(), cancellation_reason = format('Team folded: %s', trim(p_reason)), cancelled_due_to_fold = true
    where id = r.id;

    if r.mirror_fixture_id is not null then
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(), cancellation_reason = format('Opponent team folded: %s', trim(p_reason)), cancelled_due_to_fold = true
      where id = r.mirror_fixture_id;
    end if;

    if not v_is_external then
      perform internal.fixture_result_system_event(r.id, auth.uid(), format('%s has folded. This fixture has been removed from the active schedule. Club note: %s', t.display_name, trim(p_reason)));
      perform internal.fixture_result_notify(r.id, auth.uid(), 'fixture_cancelled_team_folded', 'Fixture removed -- team folded',
        format('%s has folded and your fixture on %s has been removed from the active schedule. Club note: %s', t.display_name, to_char(r.kickoff_date, 'DD Mon YYYY'), trim(p_reason)));
    end if;

    v_affected_count := v_affected_count + 1;
  end loop;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('event', 'folded', 'reason', p_reason, 'fixtures_affected', v_affected_count));

  return v_affected_count;
end;
$$;

revoke execute on function public.fold_team(uuid, text) from public;
grant execute on function public.fold_team(uuid, text) to authenticated;

-- ============================================================
-- reactivate_team: restores the team identity/calendar for NEW bookings.
-- Deliberately does NOT touch any cancelled fixture -- see
-- request_fixture_restoration below for the separate, reviewed path.
-- ============================================================

create or replace function public.reactivate_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.teams;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found.';
  end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may reactivate a team.' using errcode = '42501';
  end if;
  if t.active then
    raise exception 'This team is not folded.';
  end if;

  update public.teams set active = true where id = p_team_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('event', 'reactivated'));
end;
$$;

revoke execute on function public.reactivate_team(uuid) from public;
grant execute on function public.reactivate_team(uuid) to authenticated;

-- ============================================================
-- list_restorable_fixtures: the "Previously Cancelled Fixtures" list for
-- a reactivated team.
-- ============================================================

create or replace function public.list_restorable_fixtures(p_team_id uuid)
returns setof public.fixtures
language sql
stable
security definer
set search_path = public
as $$
  select * from public.fixtures
  where owning_team_id = p_team_id
    and cancelled_due_to_fold = true
    and restoration_requested_at is null
    and (internal.can_manage_team(p_team_id) or internal.is_site_admin())
  order by kickoff_date;
$$;

grant execute on function public.list_restorable_fixtures(uuid) to authenticated;

-- ============================================================
-- request_fixture_restoration: real opponent -> a fresh fixture_request
-- (never silently reinstated); external/unresolved opponent -> restored
-- directly to the active calendar, since there is nobody in-app to
-- approve. Both paths run a real conflict check first -- a date that is
-- now double-booked is rejected, never silently restored.
-- ============================================================

create or replace function public.request_fixture_restoration(p_fixture_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  t public.teams;
  v_is_external boolean;
  v_conflict_count integer;
  v_group_id uuid;
  v_new_request_group_id uuid;
  v_new_request_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  select * into t from public.teams where id = f.owning_team_id;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may request fixture restoration.' using errcode = '42501';
  end if;
  if not t.active then
    raise exception 'Reactivate the team before restoring its fixtures.';
  end if;
  if not f.cancelled_due_to_fold then
    raise exception 'This fixture was not cancelled by a team fold.';
  end if;
  if f.restoration_requested_at is not null then
    raise exception 'Restoration has already been requested for this fixture.';
  end if;

  -- Conflict check: the owning team's own calendar.
  select count(*) into v_conflict_count
  from public.fixtures
  where owning_team_id = f.owning_team_id and kickoff_date = f.kickoff_date and status <> 'Cancelled' and id <> f.id;
  if v_conflict_count > 0 then
    raise exception 'This team already has another fixture on %s -- restoring would double-book it. Resolve the conflict first.', f.kickoff_date;
  end if;

  -- Shared-team capacity: any group this team belongs to.
  for v_group_id in
    select sg.id from public.scheduling_groups sg
    join public.scheduling_group_members sgm on sgm.group_id = sg.id and sgm.team_id = f.owning_team_id
    where sg.active
  loop
    select count(*) into v_conflict_count
    from public.fixtures f2
    where f2.kickoff_date = f.kickoff_date and f2.status <> 'Cancelled' and f2.id <> f.id
      and (f2.owning_scheduling_group_id = v_group_id
           or exists (select 1 from public.scheduling_group_members sgm2 where sgm2.group_id = v_group_id and sgm2.team_id = f2.owning_team_id));
    if v_conflict_count > 0 then
      raise exception 'This team''s shared calendar already has a commitment on %s -- restoring would double-book it. Resolve the conflict first.', f.kickoff_date;
    end if;
  end loop;

  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t2 join public.clubs c on c.id = t2.club_id where t2.id = f.opponent_team_id and c.status = 'active');

  update public.fixtures set restoration_requested_at = now(), restoration_requested_by = auth.uid() where id = p_fixture_id;

  if v_is_external then
    update public.fixtures set status = 'Booked', cancelled_at = null, cancellation_reason = null, cancelled_due_to_fold = false where id = p_fixture_id;
    return p_fixture_id;
  end if;

  -- A real, activated opponent -- a fresh, reviewable request, never a
  -- silent reinstatement into their calendar.
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, notes, created_by)
  values (t.club_id, f.raw_opposition_text, f.opponent_directory_id, (select club_id from public.teams where id = f.opponent_team_id), f.kickoff_date,
    'Restoration request -- this fixture was previously cancelled when the owning team folded and has since been reactivated.', auth.uid())
  returning id into v_new_request_group_id;

  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_new_request_group_id, f.owning_team_id, f.opponent_team_id, case f.home_away when 'Home' then 'home' when 'Away' then 'away' else 'either' end, 'sent', auth.uid())
  returning id into v_new_request_id;

  return v_new_request_id;
end;
$$;

revoke execute on function public.request_fixture_restoration(uuid) from public;
grant execute on function public.request_fixture_restoration(uuid) to authenticated;

-- ============================================================
-- A folded team must not be able to accept a brand-new fixture commitment
-- -- matching enforce_fixture_age_eligibility's own "no bypass, fires at
-- the database boundary regardless of path" pattern. Deliberately exempts
-- a write TO 'Cancelled' (fold_team's own cancellation pass) and any
-- write once the team is active again (request_fixture_restoration
-- already checks t.active itself before restoring).
-- ============================================================

create or replace function internal.enforce_active_owning_team_for_fixture()
returns trigger
language plpgsql
as $$
declare
  v_active boolean;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  select active into v_active from public.teams where id = new.owning_team_id;
  if v_active is false then
    raise exception 'This team has folded and cannot accept a fixture booking. Reactivate the team first.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_active_owning_team_for_fixture
  before insert or update on public.fixtures
  for each row execute function internal.enforce_active_owning_team_for_fixture();

comment on trigger enforce_active_owning_team_for_fixture on public.fixtures is
  'A folded (inactive) team cannot accept a new fixture commitment -- the real database-level boundary, not a UI-only guard.';
