-- CANONICAL FIXTURE MANAGEMENT / PITCH SYNC pass, Sections 11/12/16:
-- centralizes the ONE place a fixture's status ever reacts to its own
-- scheduling completeness -- inside the one RPC every pitch/venue/kickoff
-- mutation across the whole app already funnels through (manual drag,
-- Auto Allocate's apply, the fixture detail page's pitch control). Never
-- scattered into a React component as `status: "Booked"`.
--
-- Rule (deliberately narrow -- only the three ordinary ACTIVE scheduling
-- states ever move here; Cancelled/Completed/the three legacy CSV values
-- are always left exactly as they are by an ordinary pitch/kickoff edit):
--   * A named pitch AND a kickoff time both become set on a fixture whose
--     status is Planned or To Be Determined -> Booked. This is what
--     "Pitch Allocation completed" means in this product: a genuine
--     public.club_pitches row assigned, not merely a card being opened.
--   * A fixture's named pitch is cleared while its status is Booked ->
--     reverts to To Be Determined (its home/away side itself is still
--     genuinely undetermined -- home_away = 'TBD', the same existing
--     marker this schema already uses for that case) or otherwise Planned
--     (the ordinary "no pitch assigned yet" state). Never left falsely
--     Booked with no pitch.
create or replace function public.update_fixture_schedule(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS TABLE(applied_kickoff_date date, applied_kickoff_time time without time zone, applied_venue_id uuid, applied_pitch_id uuid, kickoff_proposed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_new_status text;
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

  select * into v_final from public.fixtures where id = p_fixture_id;

  -- ===== STATUS LIFECYCLE (Sections 11/12/16) =====
  if v_final.status in ('Planned', 'Booked', 'To Be Determined') then
    if v_final.pitch_id is not null and v_final.kickoff_time is not null then
      v_new_status := 'Booked';
    elsif v_final.status = 'Booked' then
      -- Was Booked, but its pitch (or kickoff time) is no longer set --
      -- no longer satisfies this product's definition of "booked", so it
      -- must not stay falsely Booked. home_away = 'TBD' is this schema's
      -- own existing marker for a genuinely undetermined side; anything
      -- else reverts to the ordinary "scheduled, no pitch yet" state.
      v_new_status := case when v_final.home_away = 'TBD' then 'To Be Determined' else 'Planned' end;
    else
      v_new_status := v_final.status;
    end if;

    if v_new_status is distinct from v_final.status then
      update public.fixtures set status = v_new_status where id = p_fixture_id;
      if v_final.mirror_fixture_id is not null then
        update public.fixtures set status = v_new_status where id = v_final.mirror_fixture_id;
      end if;
      v_final.status := v_new_status;
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values (
    'fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', f.venue_id, 'pitch_id', f.pitch_id, 'pitch_allocation', f.pitch_allocation, 'kickoff_date', f.kickoff_date, 'kickoff_time', f.kickoff_time, 'status', f.status),
    jsonb_build_object('source', p_source, 'venue_id', p_venue_id, 'pitch_id', p_pitch_id, 'kickoff_date', p_kickoff_date, 'kickoff_time', p_kickoff_time, 'status', v_final.status)
  );

  return query select v_final.kickoff_date, v_final.kickoff_time, v_final.venue_id, v_final.pitch_id, v_final.kickoff_amendment_proposed_date is not null;
end;
$function$;

comment on function public.update_fixture_schedule is
  'The one RPC every pitch/venue/kickoff mutation funnels through (manual Pitch Allocation drag, Auto Allocate apply, the fixture detail page pitch control). Also the one place status auto-transitions to/from Booked based on genuine scheduling completeness (pitch_id + kickoff_time both set) -- never set as a UI-local `status: "Booked"` literal. Only Planned/Booked/To Be Determined ever move; Cancelled, Completed, and the three legacy CSV-import statuses are always left untouched by an ordinary schedule edit.';
