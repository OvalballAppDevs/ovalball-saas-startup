-- Real gap found live during the closure verification pass: fold_team()
-- sets teams.active = false but never touches player_team_memberships
-- (a fixture/roster history decision, not a bug in fold_team itself --
-- membership history must survive a fold). The resolver and the call-up
-- RPC never checked team.active at all, so a player whose only
-- membership was on a now-folded team could still be named as a call-up
-- source, and the fold's own active/inactive state carried no weight.
-- Fixed at the one canonical resolver, so every consumer (the request
-- RPC, the client-side preview) inherits the same answer.
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

  if not v_source.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The source team has folded and can no longer lend a player.';
    return;
  end if;
  if not v_target.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The target team has folded and cannot receive a player.';
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
