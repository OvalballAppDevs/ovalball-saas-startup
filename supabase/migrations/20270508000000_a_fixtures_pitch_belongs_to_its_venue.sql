-- =====================================================================================================
-- CONVERGENCE STEP 6 (1/n) -- a fixture's pitch must be at the fixture's ground.
--
-- THIS INVARIANT IS NOT NEW. It is already written, in these words, in the training path:
--
--   create_training_session    'The selected pitch does not belong to the selected venue.'
--   override_training_session  'The selected pitch does not belong to the selected venue.'
--
-- The fixture path never had it. Both fixture writers check that the pitch (or venue) belongs to the
-- fixture's HOME CLUB, which is a different question, and neither looks at the other column:
--
--   update_fixture_pitch   validated club ownership, archived state and home-only -- never the venue
--   update_fixture_venue   set venue_id and did not read pitch_id at all
--
-- So for any club with two grounds:
--
--   1. venue := Ground A, pitch := Pitch A1          accepted, and correct
--   2. venue := Ground B                             accepted
--   3. the fixture is now at Ground B, on a pitch that physically exists at Ground A
--
-- Nothing errored and nothing reconciled. Somebody travels to the wrong ground, or the pitch allocation
-- grid double-books a pitch the fixture was never really on.
--
-- WHY THIS CANNOT BE A CONSTRAINT. The rule spans two columns of one fixture row and a third table, so
-- it is not expressible as a foreign key, and RLS is row-scoped and cannot express it either. That is
-- the same reason set_club_pitch_venue exists for the sibling case (20261017000000): when the rule
-- cannot live in the schema, it lives in the one function that writes the column.
--
-- WHY REFUSE RATHER THAN SILENTLY CLEAR. Dropping the pitch when the venue moves would be a write the
-- administrator did not ask for, and the pitch allocation is somebody's actual plan. The refusal names
-- the two ways out instead, which is what the training path already does.
--
-- Deliberately NOT changed: mirror semantics. update_fixture_pitch propagates the pitch to the mirror
-- fixture and update_fixture_venue does not propagate the venue, because a venue may only be set on a
-- home fixture and the mirror is the away row. The correlation check is therefore conditional on the
-- row actually having a venue, exactly as the training check is.
-- =====================================================================================================

create or replace function public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid default null::uuid, p_pitch_text text default null::text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.has_site_capability('site.fixtures.support')) then
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

create or replace function public.update_fixture_venue(p_fixture_id uuid, p_venue_id uuid default null::uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  f public.fixtures;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.has_site_capability('site.fixtures.support')) then
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

do $$
declare v_missing text[] := '{}';
begin
  -- The point of the migration, asserted rather than assumed: all four writers of a venue/pitch pair
  -- now carry the same rule. If a fifth is added without it, extend this list and this guard.
  if position('does not belong to the selected venue' in pg_get_functiondef('public.update_fixture_pitch'::regproc)) = 0 then
    v_missing := v_missing || 'update_fixture_pitch';
  end if;
  if position('not at that venue' in pg_get_functiondef('public.update_fixture_venue'::regproc)) = 0 then
    v_missing := v_missing || 'update_fixture_venue';
  end if;
  if position('does not belong to the selected venue' in pg_get_functiondef('public.create_training_session'::regproc)) = 0 then
    v_missing := v_missing || 'create_training_session';
  end if;
  if position('does not belong to the selected venue' in pg_get_functiondef('public.override_training_session'::regproc)) = 0 then
    v_missing := v_missing || 'override_training_session';
  end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'STEP 6: these writers do not enforce pitch-belongs-to-venue: %', array_to_string(v_missing, ', ');
  end if;
  raise notice 'Step 6: a fixture''s pitch must be at the fixture''s ground, as training already required';
end $$;
