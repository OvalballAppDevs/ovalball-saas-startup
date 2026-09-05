-- PLAYER REQUESTS, AGE-GRADE APPROVALS & DISPENSATIONS
-- Reconciles the existing fixture_player_call_up and player_team_
-- dispensation domains (both already accepted foundation -- neither is
-- duplicated here) behind ONE canonical eligibility resolver, so a
-- fixture request and a regulatory approval are LINKED but never
-- flattened into one record, and no eligibility rule is ever
-- hardcoded inline in a request/decide RPC.
--
-- Design notes (kept here rather than scattered across every call
-- site, per "one canonical eligibility resolver/service with
-- provenance"):
--   * A player's real age is always computed from players.date_of_birth
--     at the reference date -- never assumed from a team's age_group
--     label, which is a squad convenience name, not a birth record.
--   * Rugby Union's 17-year-old / adult pathway is encoded exactly as
--     specified (RFU Regulation 15 / continuum; club + Constituent
--     Body approval; no contested-scrum front row before 18) --
--     content the product owner supplied directly.
--   * Rugby League's adult crossing is NOT modelled on the Union
--     pathway. No specific RFL regulation number or exact age band is
--     asserted here, because none was supplied and none should be
--     invented -- the resolver always routes a League youth-to-adult
--     move through the same external-approval record, labelled as the
--     club's own Player Dispensation Policy for that governing body,
--     so a real, current age threshold can be confirmed by the club
--     rather than silently guessed by Ovalball.
--   * Anything else that doesn't match a known, deliberately-encoded
--     shape (skipping grades, moving down an age grade, an unusual
--     pathway/gender combination) defaults to EXTERNAL_APPROVAL_REQUIRED,
--     never to PERMITTED -- Ovalball only ever declares something
--     permitted when it actually knows the rule, and never blocks
--     outright (NOT_PERMITTED) except where age itself makes the
--     movement impossible (too young for adult rugby, or age unknown).
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

  -- Same canonical age group, same pathway: the base team-to-team case.
  if v_source.category = 'youth' and v_target.category = 'youth'
     and v_source.age_group = v_target.age_group and coalesce(v_source.gender, '') = coalesce(v_target.gender, '') then
    return query select 'permitted', null::text, null::text, null::text, null::text, 'Same canonical age group -- an ordinary team-to-team request.';
    return;
  end if;

  -- Adult (senior) target: age itself governs, per rugby code. This
  -- takes precedence over the "one grade up" / "skipped grades" checks
  -- below, since crossing into adult rugby is never just an ordinary
  -- age-grade progression regardless of which youth/colts team a
  -- player is coming from.
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
      -- Rugby League: no specific age threshold or regulation number is
      -- asserted here -- only the club's real, current Player
      -- Dispensation Policy determines this, and Ovalball only ever
      -- records that outcome.
      return query select
        'external_approval_required', 'RFL', 'RFL Player Dispensation Policy (community game)',
        'League/club dispensation for a player moving into adult rugby league below the ordinary age.',
        null::text,
        'This player is under 18 and the destination is an adult Rugby League team. Confirm the current age threshold and required approval with your league''s Player Dispensation Policy before this can proceed.';
      return;
    end if;
  end if;

  -- Ordinary one-grade progression within youth, or Junior Colts ->
  -- Senior Colts within the Colts pathway: the source team's own
  -- consent is sufficient, but this is a resolved, provable fact
  -- (visible in this row) rather than a silent assumption baked into
  -- the request/decide RPCs.
  if v_source.category = 'youth' and v_target.category = 'youth' and internal.next_age_grade(v_source.age_group) = v_target.age_group then
    return query select 'team_approval_only', null::text, null::text, null::text, null::text,
      format('Ordinary age-grade progression (%s -> %s) -- the source team''s own approval is sufficient.', v_source.age_group, v_target.age_group);
    return;
  end if;
  if v_source.category = 'colts' and v_source.age_group = 'JuniorColts' and v_target.category = 'colts' and v_target.age_group = 'SeniorColts' then
    return query select 'team_approval_only', null::text, null::text, null::text, null::text, 'Progressing within the Colts pathway -- the source team''s own approval is sufficient.';
    return;
  end if;

  -- Anything else (skipped grades, a downward move, an unusual
  -- pathway/gender combination) always needs a real, recorded
  -- decision -- never silently permitted, never outright blocked
  -- purely on shape.
  return query select 'external_approval_required', null::text, null::text, null::text, null::text,
    format('Moving from %s to %s does not match an ordinary age-grade progression -- a recorded age-grade dispensation is required.',
      coalesce(v_source.age_group, v_source.category), coalesce(v_target.age_group, v_target.category));
end;
$$;
