-- Two real gaps found live during the closure verification pass:
--
-- 1. The resolver's "ordinary one-grade-up progression" branch checked
--    only category/age_group, never gender/pathway -- a Boys U12 to
--    Girls U13 movement (a genuine cross-pathway change, never an
--    ordinary progression) was incorrectly classified team_approval_
--    only instead of external_approval_required. Fixed by requiring
--    the same gender/pathway match this function's own "same age
--    group" branch already required.
--
-- 2. revoke_player_dispensation() could revoke an already-APPROVED
--    dispensation without touching a call-up that had already been
--    unblocked (status = 'requested') on the strength of that now-
--    revoked approval -- the source team could still approve it for
--    real. Fixed by rejecting any linked call-up that has not YET
--    received its own final approval; a call-up that is already
--    'approved' (the fixture has already been committed to) is
--    deliberately left untouched here -- unwinding an already-approved
--    physical commitment is a distinct, bigger real-world question
--    this fix does not attempt to silently resolve.
create or replace function internal.resolve_player_movement_eligibility(
  p_rugby_code text,
  p_reference_date date,
  p_player_dob date,
  p_source_team_id uuid,
  p_target_team_id uuid
)
returns table(requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
language plpgsql
stable
as $$
declare
  v_source public.teams;
  v_target public.teams;
  v_age integer;
begin
  select * into v_source from public.teams where id = p_source_team_id;
  select * into v_target from public.teams where id = p_target_team_id;

  if v_source.id is null or v_target.id is null then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'Source or target team could not be found.';
    return;
  end if;

  if v_source.club_id <> v_target.club_id then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams belong to different clubs. This needs an inter-club arrangement, which Ovalball does not model as a call-up or dispensation.';
    return;
  end if;

  if v_source.category = 'youth' and v_target.category = 'youth'
     and v_source.age_group = v_target.age_group and coalesce(v_source.gender, '') = coalesce(v_target.gender, '') then
    return query select 'permitted', null::text, null::text, null::text, null::text, 'Same canonical age group -- an ordinary team-to-team request.';
    return;
  end if;

  if v_target.category = 'senior' then
    if p_player_dob is null then
      return query select 'not_permitted', null::text, null::text, null::text, null::text,
        'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby.';
      return;
    end if;
    v_age := extract(year from age(p_reference_date, p_player_dob))::integer;

    if v_age >= 18 then
      return query select 'permitted', null::text, null::text, null::text, null::text, 'This player is 18 or over -- an ordinary adult player.';
      return;
    end if;

    if p_rugby_code = 'union' then
      if v_age >= 17 then
        return query select
          'external_approval_required', 'RFU', 'RFU Regulation 15 (age-grade continuum)',
          'Club approval for a 17-year-old to play adult rugby, individual player assessment, Club Safeguarding Officer approval, Constituent Body approval, and individual adult registration.',
          'No contested-scrum front row before age 18.',
          'This player is 17 and the destination is an adult Rugby Union team. RFU approval is required before they can participate in adult rugby.';
        return;
      else
        return query select 'not_permitted', 'RFU', 'RFU Regulation 15 (age-grade continuum)', null::text, null::text,
          'Under the RFU age-grade continuum, a player must be at least 17 before playing any adult rugby.';
        return;
      end if;
    else
      return query select
        'external_approval_required', 'RFL', 'RFL Player Dispensation Policy (community game)',
        'League/club dispensation for a player moving into adult rugby league below the ordinary age.',
        null::text,
        'This player is under 18 and the destination is an adult Rugby League team. Confirm the current age threshold and required approval with your league''s Player Dispensation Policy before this can proceed.';
      return;
    end if;
  end if;

  -- Gender/pathway match is required for an "ordinary" progression to
  -- apply -- a same-age-boundary crossing that ALSO changes pathway
  -- (e.g. boys -> girls) is never ordinary, regardless of age_group.
  if v_source.category = 'youth' and v_target.category = 'youth'
     and internal.next_age_grade(v_source.age_group) = v_target.age_group
     and coalesce(v_source.gender, '') = coalesce(v_target.gender, '') then
    return query select 'team_approval_only', null::text, null::text, null::text, null::text,
      format('Ordinary age-grade progression (%s -> %s) -- the source team''s own approval is sufficient.', v_source.age_group, v_target.age_group);
    return;
  end if;
  if v_source.category = 'colts' and v_source.age_group = 'JuniorColts' and v_target.category = 'colts' and v_target.age_group = 'SeniorColts' then
    return query select 'team_approval_only', null::text, null::text, null::text, null::text, 'Progressing within the Colts pathway -- the source team''s own approval is sufficient.';
    return;
  end if;

  return query select 'external_approval_required', null::text, null::text, null::text, null::text,
    format('Moving from %s to %s does not match an ordinary age-grade progression -- a recorded age-grade dispensation is required.',
      coalesce(v_source.age_group, v_source.category), coalesce(v_target.age_group, v_target.category));
end;
$$;

create or replace function public.revoke_player_dispensation(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  if d.status <> 'approved' then
    raise exception 'Only an approved dispensation can be revoked (current status: %).', d.status;
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;
  if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to revoke this dispensation -- only this club''s Club Admin may revoke.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to revoke a dispensation.';
  end if;

  update public.player_team_dispensation
  set status = 'revoked', decision_reason = p_reason, updated_at = now()
  where id = p_id;

  with blocked as (
    update public.fixture_player_call_up
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_reason = format('The linked age-grade approval was revoked: %s', p_reason)
    where eligibility_requirement_id = d.id and status in ('requested', 'awaiting_eligibility')
    returning id, requested_by
  )
  insert into public.notifications (user_id, type, title, body, data)
  select blocked.requested_by, 'fixture_call_up_decided', 'Call-up blocked',
    format('The age-grade approval for %s was revoked, so the linked call-up request can no longer proceed.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
    jsonb_build_object('dispensation_id', d.id, 'call_up_id', blocked.id)
  from blocked
  where blocked.requested_by is not null;
end;
$$;
