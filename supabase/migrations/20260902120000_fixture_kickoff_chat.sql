-- Kick-off time as a real, chat-driven operational fixture field --
-- extends the exact same pattern pitch allocation already established
-- (one canonical field, one RPC boundary, a chat system event, a
-- notification to the other side). A material kick-off change on an
-- already-resolved two-sided fixture becomes a proposed amendment the
-- opponent must accept -- mirrors the result_amendment_* shape already
-- used for post-match result corrections, never a silent one-sided edit
-- of an agreed schedule.

alter table public.fixtures
  add column kickoff_amendment_proposed_date date,
  add column kickoff_amendment_proposed_time time,
  add column kickoff_amendment_proposed_by uuid references auth.users(id),
  add column kickoff_amendment_proposed_by_club_id uuid references public.clubs(id),
  add column kickoff_amendment_proposed_at timestamptz;

comment on column public.fixtures.kickoff_amendment_proposed_date is
  'A pending kick-off change awaiting the OTHER club''s agreement -- set only for a fixture with a real, activated opponent (an external/unresolved opponent has nobody to agree with, so those fixtures are edited directly, see update_fixture_kickoff). Null whenever there is no pending change.';

-- ============================================================
-- update_fixture_kickoff: the one canonical write path for kickoff_date/
-- kickoff_time, matching update_fixture_pitch''s own established
-- authorization boundary (can_submit_fixture_result -- a participating
-- club official on either side, or Site Admin).
-- ============================================================

create or replace function public.update_fixture_kickoff(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_caller_club_id uuid;
  v_is_external boolean;
  v_old_date date;
  v_old_time time;
begin
  if p_kickoff_date is null then
    raise exception 'A kick-off date is required.';
  end if;
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to change the kick-off for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if f.status = 'Cancelled' then
    raise exception 'This fixture is cancelled -- its kick-off cannot be changed.';
  end if;

  v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');
  v_old_date := f.kickoff_date;
  v_old_time := f.kickoff_time;

  -- Nothing actually changing (including a caller merely re-confirming
  -- the current value) is a harmless no-op, not a fresh proposal cycle.
  if v_old_date = p_kickoff_date and v_old_time is not distinct from p_kickoff_time and f.kickoff_amendment_proposed_date is null then
    return;
  end if;

  if v_is_external or internal.is_site_admin() then
    -- No real opponent to agree with (or a Site Admin override) -- apply
    -- directly. Site Admin is deliberately exempt from the negotiation
    -- cycle, matching resolve_fixture_result_dispute's own override
    -- authority for results.
    update public.fixtures
    set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
        kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = f.mirror_fixture_id;
    end if;
    if f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off changed: %s %s -> %s %s.', v_old_date, coalesce(v_old_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    end if;
    return;
  end if;

  -- A real, activated opponent -- material changes need agreement.
  if f.kickoff_amendment_proposed_date is null then
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
        kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change proposed: %s %s -> %s %s. Awaiting the other club''s agreement.', v_old_date, coalesce(v_old_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off change proposed',
      format('A change to %s %s has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    return;
  end if;

  if v_caller_club_id = f.kickoff_amendment_proposed_by_club_id then
    -- The proposing side revising their own still-pending proposal.
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    return;
  end if;

  if p_kickoff_date = f.kickoff_amendment_proposed_date and p_kickoff_time is not distinct from f.kickoff_amendment_proposed_time then
    -- The other side proposing back exactly the pending value IS acceptance.
    update public.fixtures
    set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
        kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off confirmed: %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off confirmed',
      format('The kick-off for your fixture is now %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    return;
  end if;

  -- A genuinely different value from the other side -- a counter-proposal,
  -- replacing the pending one (never silently applied).
  update public.fixtures
  set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
      kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
        kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
    where id = f.mirror_fixture_id;
  end if;
  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off counter-proposed: %s %s (was proposing %s %s).', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)'), f.kickoff_amendment_proposed_date, coalesce(f.kickoff_amendment_proposed_time::text, '(no time)')));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off counter-proposed',
    format('A different kick-off (%s %s) has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
end;
$$;

revoke execute on function public.update_fixture_kickoff(uuid, date, time) from public;
grant execute on function public.update_fixture_kickoff(uuid, date, time) to authenticated;

-- ============================================================
-- reject_fixture_kickoff_change: an explicit decline, so a pending
-- proposal never sits unresolved forever with no way out except a
-- matching counter-proposal.
-- ============================================================

create or replace function public.reject_fixture_kickoff_change(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to respond to this fixture''s kick-off change.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if f.kickoff_amendment_proposed_date is null then
    raise exception 'There is no pending kick-off change to decline.';
  end if;

  update public.fixtures
  set kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
      kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = f.mirror_fixture_id;
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change declined -- the fixture stays at %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)')));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_declined', 'Kick-off change declined',
    format('Your proposed kick-off change was declined -- the fixture stays at %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)')));
end;
$$;

revoke execute on function public.reject_fixture_kickoff_change(uuid) from public;
grant execute on function public.reject_fixture_kickoff_change(uuid) to authenticated;
