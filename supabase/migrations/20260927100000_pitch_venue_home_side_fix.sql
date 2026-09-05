-- Real, pre-existing bug found while auditing Pitch Allocation's mutation
-- boundary for the group-vs-group pass (unrelated to Mini-Rugby groups
-- specifically -- reproduced first with a plain ordinary team fixture):
-- update_fixture_schedule's venue/pitch sections gated on `f.home_away <>
-- 'Home'` and resolved the "home club" from `f.owning_team_id` UNCONDITIONALLY
-- -- both wrong whenever the OPPONENT side is the genuine physical host
-- (home_away = 'Away' from the owning/requesting side's own perspective,
-- exactly what accept_fixture_request produces when the requester's own
-- venue_preference is 'away'). A real fixture like that could never have
-- a pitch or venue allocated at all: "A named pitch can only be set on a
-- home fixture" fired even though the fixture genuinely has a home side,
-- it just isn't the owning/requesting one.
--
-- data.ts (Pitch Allocation's own canonical read layer) has always
-- correctly used the GENERATED home_team_id column for exactly this
-- reason ("a fixture where this club is the accepting/opponent side but
-- genuinely playing at home is still correctly included") -- this
-- migration makes the WRITE path agree with the READ path's own already-
-- correct model, rather than leaving the two subtly disagreeing about
-- what "home" means for the exact same row. Also directly relevant to
-- this pass: a fixture whose home side is a Mini-Rugby Group stored on
-- the OPPONENT column would hit this identical bug.
--
-- Fix: both sections now gate on `f.home_team_id is null` (the real "no
-- genuine home side yet" case -- TBD/Not Applicable fixtures) and resolve
-- the home club from `f.home_team_id`, never `f.owning_team_id`. Every
-- other line is unchanged verbatim.
create or replace function public.update_fixture_schedule(
  p_fixture_id uuid,
  p_kickoff_date date,
  p_kickoff_time time default null,
  p_venue_id uuid default null,
  p_pitch_id uuid default null,
  p_pitch_text text default null,
  p_source text default null
)
returns table(applied_kickoff_date date, applied_kickoff_time time, applied_venue_id uuid, applied_pitch_id uuid, kickoff_proposed boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.fixtures;
  v_final public.fixtures;
  v_home_club_id uuid;
  v_caller_club_id uuid;
  v_is_external boolean;
  v_old_pitch_text text;
  v_new_pitch_text text;
  v_venue_changing boolean;
  v_pitch_changing boolean;
  v_kickoff_changing boolean;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  v_venue_changing := p_venue_id is distinct from f.venue_id;
  v_pitch_changing := (p_pitch_id is distinct from f.pitch_id)
    or (p_pitch_id is null and coalesce(nullif(trim(p_pitch_text), ''), '') is distinct from coalesce(f.pitch_allocation, ''));
  v_kickoff_changing := (p_kickoff_date is distinct from f.kickoff_date)
    or (p_kickoff_time is distinct from f.kickoff_time)
    or f.kickoff_amendment_proposed_date is not null;

  -- ===== VENUE =====
  if v_venue_changing then
    if p_venue_id is not null then
      if f.home_team_id is null then
        raise exception 'A venue can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_home_club_id and v.active) then
        raise exception 'That venue does not belong to this fixture''s home club, or is archived.';
      end if;
    end if;
    update public.fixtures set venue_id = p_venue_id where id = p_fixture_id;
  end if;

  -- ===== PITCH =====
  if v_pitch_changing then
    if p_pitch_id is not null then
      if f.home_team_id is null then
        raise exception 'A named pitch can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
        raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
      end if;
      select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
    else
      v_new_pitch_text := nullif(trim(p_pitch_text), '');
    end if;
    v_old_pitch_text := f.pitch_allocation;

    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = f.mirror_fixture_id;
    end if;

    if (coalesce(v_old_pitch_text, '') <> coalesce(v_new_pitch_text, '') or f.pitch_id is distinct from p_pitch_id) and f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
        case when v_new_pitch_text is null then 'Pitch allocation removed.'
             else format('Pitch allocated: %s', v_new_pitch_text) end);
      if auth.uid() is not null then
        perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
          case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
               else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
      end if;
    end if;
  end if;

  -- ===== KICKOFF (unchanged verbatim -- already either-side-aware) =====
  if v_kickoff_changing then
    if p_kickoff_date is null then
      raise exception 'A kick-off date is required.';
    end if;
    if f.status = 'Cancelled' then
      raise exception 'This fixture is cancelled -- its kick-off cannot be changed.';
    end if;

    v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
    v_is_external := f.opponent_team_id is null
      or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

    if f.kickoff_date = p_kickoff_date and f.kickoff_time is not distinct from p_kickoff_time and f.kickoff_amendment_proposed_date is null then
      null;
    elsif v_is_external or internal.is_site_admin() then
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
        perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off changed: %s %s -> %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      end if;
    elsif f.kickoff_amendment_proposed_date is null then
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
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change proposed: %s %s -> %s %s. Awaiting the other club''s agreement.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off change proposed',
        format('A change to %s %s has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    elsif v_caller_club_id = f.kickoff_amendment_proposed_by_club_id then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
    elsif p_kickoff_date = f.kickoff_amendment_proposed_date and p_kickoff_time is not distinct from f.kickoff_amendment_proposed_time then
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
    else
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
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values (
    'fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', f.venue_id, 'pitch_id', f.pitch_id, 'pitch_allocation', f.pitch_allocation, 'kickoff_date', f.kickoff_date, 'kickoff_time', f.kickoff_time),
    jsonb_build_object('source', p_source, 'venue_id', p_venue_id, 'pitch_id', p_pitch_id, 'kickoff_date', p_kickoff_date, 'kickoff_time', p_kickoff_time)
  );

  select * into v_final from public.fixtures where id = p_fixture_id;
  return query select v_final.kickoff_date, v_final.kickoff_time, v_final.venue_id, v_final.pitch_id, v_final.kickoff_amendment_proposed_date is not null;
end;
$$;

comment on function public.update_fixture_schedule is
  'Section 9-11 (atomic schedule mutation) + a real bug fix discovered auditing Pitch Allocation for group-vs-group: venue/pitch assignment now gates on f.home_team_id (the GENERATED, always-correct home side) rather than f.home_away <> ''Home''/f.owning_team_id, which incorrectly rejected pitch/venue allocation whenever the genuine host was the opponent/accepting side rather than the owning/requesting one -- a real, pre-existing gap unrelated to Mini-Rugby groups, but one that would also have blocked a group fixture whose home side is stored on the opponent column.';
