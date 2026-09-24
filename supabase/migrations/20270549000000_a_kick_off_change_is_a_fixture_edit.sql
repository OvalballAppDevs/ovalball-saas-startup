-- A KICK-OFF CHANGE IS A FIXTURE EDIT (CA-M7.1, ledger H24).
--
-- THE DEFECT. Every mutation that changes WHEN and WHERE a fixture is played -- the kick-off date and
-- time (`update_fixture_kickoff`), the whole schedule (`update_fixture_schedule`), the meet time, the
-- pitch, the venue, answering a proposed kick-off change, and the free-text ground on
-- `update_fixture_details` -- asked `internal.can_submit_fixture_result`: the RESULT-RECORDING key,
-- `fixture.result.record`. The read model that tells an editor which fields it may touch
-- (`fixture_editable_fields.schedule`) asked the same. So a Club Admin who withheld
-- `fixture.fixture.edit` from a Team Manager at team scope stopped `update_fixture_details` and every
-- other scheduling change still went through; and a person allowed only to record results could move a
-- kick-off. CA-M7's authority suite found it (TO-B7) and left the assertion out until this migration.
--
-- THE MODEL, UNCHANGED. VIEW -> fixture view keys. CREATE -> fixture.fixture.create. EDIT, including
-- kick-off, date, time, venue, pitch and meet time -> fixture.fixture.edit. CANCEL ->
-- fixture.fixture.cancel. RECORD RESULT -> fixture.result.record. Distinct jobs, distinct keys; neither
-- implies the other.
--
-- THE SHAPE, UNCHANGED. Scheduling was always an EITHER-SIDE question -- the away club records the
-- ground for an away fixture, and either club proposes or answers a kick-off change -- and it stays
-- one. `internal.caller_fixture_club_id` already answers "which side holds fixture.fixture.edit here";
-- `internal.can_edit_fixture_schedule` is that answer as a boolean, plus the site fixture-support
-- override every one of these functions already honoured. Nothing else in any function body changes:
-- the definitions below are the live ones with exactly the gate line swapped, so the negotiation cycle,
-- the mirror updates, the notifications and the validation are as they were.
--
-- Forward-only. No earlier migration is touched.

create or replace function internal.can_edit_fixture_schedule(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select internal.caller_fixture_club_id(p_fixture_id) is not null
      or internal.has_site_capability('site.fixtures.support');
$$;

revoke all on function internal.can_edit_fixture_schedule(uuid) from public;

comment on function internal.can_edit_fixture_schedule(uuid) is
  'True where the caller holds fixture.fixture.edit at either side of the fixture (its team or that team''s club), or site fixture support. The gate for every scheduling change: kick-off, date, time, venue, pitch, meet time, and answering a proposed kick-off change. Never fixture.result.record.';

CREATE OR REPLACE FUNCTION public.update_fixture_kickoff(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
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

  if v_is_external or internal.has_site_capability('site.fixtures.support') then
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
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_schedule(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
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
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
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
    elsif v_is_external or internal.has_site_capability('site.fixtures.support') then
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

CREATE OR REPLACE FUNCTION public.update_fixture_meet_time(p_fixture_id uuid, p_meet_time time without time zone)
 RETURNS time without time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  f public.fixtures;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  -- Checked here as well as in the CHECK constraints so the caller gets a
  -- sentence they can act on rather than a constraint-violation string.
  if p_meet_time is not null then
    if f.kickoff_time is null then
      raise exception 'Set a kick-off time before adding a meet time.';
    end if;
    if p_meet_time > f.kickoff_time then
      raise exception 'The meet time must be at or before kick-off.';
    end if;
  end if;

  update public.fixtures
  set meet_time = p_meet_time, updated_by = auth.uid(), updated_at = now()
  where id = p_fixture_id;

  return p_meet_time;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;

  if p_pitch_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;

    -- STEP 6: and it has to be a pitch at the ground the fixture is actually being played at.
    select cp.venue_id into v_pitch_venue_id from public.club_pitches cp where cp.id = p_pitch_id;
    if f.venue_id is not null and v_pitch_venue_id is distinct from f.venue_id then
      raise exception 'The selected pitch does not belong to the selected venue. Choose a pitch at this fixture''s ground, or change the fixture''s venue first.'
        using errcode = '23514';
    end if;

    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = f.mirror_fixture_id;
  end if;

  if (coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id) and f.opponent_team_id is not null then
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
      case when v_new_pitch_text is null then 'Pitch allocation removed.'
           else format('Pitch allocated: %s', v_new_pitch_text) end);
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_venue(p_fixture_id uuid, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to set the venue for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  if p_venue_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A venue can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_home_club_id and v.active) then
      raise exception 'That venue does not belong to this fixture''s home club, or is archived.';
    end if;

    -- STEP 6: moving the ground must not leave last week's pitch attached to it. Refused rather than
    -- silently cleared, because the pitch allocation is somebody's plan and dropping it would be a
    -- write nobody asked for.
    if f.pitch_id is not null then
      select cp.venue_id into v_pitch_venue_id from public.club_pitches cp where cp.id = f.pitch_id;
      if v_pitch_venue_id is distinct from p_venue_id then
        raise exception 'The pitch currently set on this fixture is not at that venue. Clear the pitch first, or choose a pitch at the new ground.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  update public.fixtures set venue_id = p_venue_id where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), jsonb_build_object('venue_id', f.venue_id), jsonb_build_object('venue_id', p_venue_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_fixture_kickoff_change(p_fixture_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_details(p_fixture_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_after public.fixtures;
  v_status text;
  v_home_away text;
  v_game_type text;
  v_swap boolean;
  v_opponent_club uuid;
  v_owning_club_name text;
  v_venue_text text;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if not internal.can_edit_fixture_details(f.id) then
    raise exception 'Only the owning club can change this fixture''s details.' using errcode = '42501';
  end if;

  if p_patch ? 'status' then
    v_status := nullif(p_patch->>'status', '');
    if v_status = 'Cancelled' then
      raise exception 'Cancel a fixture with Cancel Fixture, so the other side and the players are told why.' using errcode = '23514';
    end if;
    if v_status is not null and v_status not in ('Planned', 'Booked', 'To Be Determined', 'Completed') then
      raise exception 'That is not a fixture status that can be set here.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_status is distinct from 'Cancelled' then
      raise exception 'This fixture is cancelled. Restore it before changing its status.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'home_away' then
    v_home_away := nullif(p_patch->>'home_away', '');
    if v_home_away not in ('Home', 'Away', 'TBD', 'Not Applicable') then
      raise exception 'Home, Away, TBD or Not Applicable.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_home_away is distinct from f.home_away then
      raise exception 'This fixture is cancelled.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'game_type' then
    v_game_type := nullif(p_patch->>'game_type', '');
    if v_game_type is not null and v_game_type not in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match') then
      raise exception 'That is not a fixture type.' using errcode = '23514';
    end if;
  end if;

  -- An away ground at a club that is not on Ovalball has no venue record; its
  -- name is kept as text. Only an away fixture with no venue record takes
  -- one, and only from someone who may change the venue.
  if p_patch ? 'venue_text' then
    v_venue_text := nullif(trim(coalesce(p_patch->>'venue_text', '')), '');
    if not (internal.can_edit_fixture_schedule(f.id)) then
      raise exception 'Only the two clubs'' fixture staff can change the venue.' using errcode = '42501';
    end if;
    if coalesce(v_home_away, f.home_away) <> 'Away' or (f.venue_id is not null and not (p_patch ? 'home_away' and v_home_away is distinct from f.home_away)) then
      raise exception 'A ground name is only recorded for an away fixture without a venue.' using errcode = '23514';
    end if;
  end if;

  v_swap := p_patch ? 'home_away' and f.home_away in ('Home', 'Away') and v_home_away in ('Home', 'Away') and v_home_away <> f.home_away;

  update public.fixtures
  set status = case when p_patch ? 'status' then coalesce(v_status, status) else status end,
      home_away = case when p_patch ? 'home_away' then v_home_away else home_away end,
      game_type = case when p_patch ? 'game_type' then v_game_type else game_type end,
      notes = case when p_patch ? 'notes' then nullif(trim(coalesce(p_patch->>'notes', '')), '') else notes end,
      home_score = case when v_swap then away_score else home_score end,
      away_score = case when v_swap then home_score else away_score end,
      -- The venue and pitch belong to the home club; when the home side
      -- changes they no longer apply.
      venue_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else venue_id end,
      pitch_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else pitch_id end,
      venue_address = case
        when p_patch ? 'venue_text' then v_venue_text
        when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null
        else venue_address end,
      updated_by = auth.uid()
  where id = f.id
  returning * into v_after;

  if f.opponent_team_id is not null
     and (v_after.home_away is distinct from f.home_away or v_after.status is distinct from f.status) then
    select club_id into v_opponent_club from public.teams where id = f.opponent_team_id;
    -- The recipient is the opposition: name the club that made the change, not them.
    select d.name into v_owning_club_name from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory d on d.id = c.directory_id where t.id = f.owning_team_id;
    insert into public.notifications (user_id, type, title, body, data)
    select distinct cm.user_id, 'fixture_details_changed', 'Fixture updated',
      format('Your fixture against %s on %s is now %s%s.',
        coalesce(v_owning_club_name, 'the other club'),
        to_char(f.kickoff_date, 'DD Mon YYYY'),
        case when v_after.home_away is distinct from f.home_away
          then case v_after.home_away when 'Home' then 'at their ground' when 'Away' then 'at your ground' else lower(v_after.home_away) end
          else lower(v_after.status) end,
        ''),
      jsonb_build_object('fixture_id', f.id)
    from public.club_memberships cm
    where cm.status = 'active' and cm.user_id is distinct from auth.uid()
      and (
        (cm.club_id = v_opponent_club and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY'))
        or exists (select 1 from public.team_permissions tp where tp.membership_id = cm.id and tp.team_id = f.opponent_team_id and tp.permission in ('team_admin', 'coach', 'manager'))
      );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fixture_editable_fields(p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_schedule boolean;
  v_owning_side boolean;
  v_competition_name text;
  v_cancelled boolean;
  v_locked text;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;
  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  v_cancelled := f.status = 'Cancelled';
  v_schedule := internal.can_edit_fixture_schedule(f.id);
  v_owning_side := internal.can_edit_fixture_details(f.id);

  select c.name into v_competition_name
  from public.competition_match_fixtures l
  join public.competition_matches m on m.id = l.match_id
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where l.fixture_id = f.id;
  v_locked := case when v_competition_name is not null then format('Set by the competition "%s". Ask the organiser to change it.', v_competition_name) end;

  return jsonb_build_object(
    'schedule', jsonb_build_object('editable', v_schedule and not v_cancelled and v_locked is null,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the date and kick-off.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'meetTime', jsonb_build_object('editable', v_schedule and not v_cancelled,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the meet time.' when v_cancelled then 'This fixture is cancelled.' end),
    -- Away with no Ovalball home team: the ground is recorded by name, by the owning club.
    'venue', jsonb_build_object('editable', not v_cancelled and ((v_schedule and f.home_team_id is not null) or (v_owning_side and f.home_away = 'Away' and f.home_team_id is null)),
      'reason', case when v_cancelled then 'This fixture is cancelled.'
        when f.home_team_id is null and f.home_away = 'Away' and not v_owning_side then 'Only the owning club records the other club''s ground.'
        when f.home_team_id is null and f.home_away <> 'Away' then 'Choose Home or Away first -- the venue belongs to the home club.'
        when not v_schedule then 'Only the two clubs'' fixture staff can change the venue.' end),
    'competition', jsonb_build_object('editable', (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) and v_locked is null,
      'reason', case when not (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) then 'Only the club''s fixture administrators can set the competition.' else v_locked end),
    'opposition', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change the opposition.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'ourTeam', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change its team.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'homeAway', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change Home or Away.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    -- The result: the same rule submit_fixture_result enforces.
    'result', jsonb_build_object('editable', internal.can_submit_fixture_result(f.id) and internal.fixture_result_eligible(f.id),
      'reason', case when not internal.can_submit_fixture_result(f.id) then 'Only the two clubs'' fixture staff can record the result.'
        when v_cancelled then 'A cancelled fixture has no result.'
        when not internal.fixture_result_eligible(f.id) then 'The result can be recorded once the match has kicked off.' end),
    'details', jsonb_build_object('editable', v_owning_side,
      'reason', case when not v_owning_side then 'Only the owning club can change the fixture type, status and notes.' end),
    'competitionName', v_competition_name
  );
end;
$function$;

-- The functions keep their existing grants (create or replace preserves them). Self-check: no scheduling
-- mutation asks the result key any more; the read model asks it only for the result field.
do $$
declare v text; f text;
begin
  foreach f in array array['update_fixture_kickoff','update_fixture_schedule','update_fixture_meet_time','update_fixture_pitch','update_fixture_venue','reject_fixture_kickoff_change','update_fixture_details'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if v ~ 'can_submit_fixture_result' then
      raise exception '% still asks the result key for a scheduling change', f;
    end if;
    if v !~ 'can_edit_fixture_schedule' then
      raise exception '% does not ask the fixture-edit schedule gate', f;
    end if;
  end loop;
  select pg_get_functiondef('public.fixture_editable_fields(uuid)'::regprocedure) into v;
  if v !~ 'v_schedule := internal.can_edit_fixture_schedule' then
    raise exception 'fixture_editable_fields.schedule does not follow fixture.fixture.edit';
  end if;
  if (length(v) - length(replace(v, 'can_submit_fixture_result', ''))) / length('can_submit_fixture_result') <> 2 then
    raise exception 'fixture_editable_fields must ask the result key for the result field only';
  end if;
  select pg_get_functiondef('internal.can_edit_fixture_schedule(uuid)'::regprocedure) into v;
  if v !~ 'caller_fixture_club_id' or v ~ 'result' then
    raise exception 'can_edit_fixture_schedule must be the either-side fixture.fixture.edit answer';
  end if;
  raise notice 'H24 closed: a kick-off change, and every other scheduling change, is a fixture edit.';
end $$;
