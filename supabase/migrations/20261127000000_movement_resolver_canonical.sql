-- The player-movement resolver joins the one canonical progression graph.
--
-- TWO DEFECTS, ONE OF THEM LIVE
--
-- 1. DEAD LEGACY. The resolver carried a hardcoded branch:
--
--      source colts/JuniorColts -> target colts/SeniorColts => team_approval_only
--
--    No team has carried those values since the Colts convergence, so the
--    branch can never fire. Removed rather than left as decoration.
--
-- 2. WRONG ANSWERS TODAY. Ordinary progression was tested with
--    internal.next_age_grade -- the gender- and code-blind primitive. So a
--    union Girls U12 player moving to Girls U14, which is the RFU's own dual
--    age band and about as ordinary a move as exists, did NOT match
--    (next_age_grade('U12') is 'U13'), fell through to the catch-all, and was
--    classified external_approval_required. Ovalball was telling clubs that a
--    normal band progression needed a recorded dispensation.
--
--    The same fell out for league males: U18 -> U19 did not match either.
--
--    Both now use internal.next_age_grade_for, the same successor the season
--    rollover and the future-identity projector use. One progression graph,
--    consulted everywhere.
--
-- A cross-code guard is also added. teams.rugby_code is constrained to the
-- club's own code so a mismatch should be impossible, but a movement decision
-- is exactly the wrong place to rely on "should be".

create or replace function internal.resolve_player_movement_eligibility(p_rugby_code text, p_reference_date date, p_player_dob date, p_source_team_id uuid, p_target_team_id uuid)
returns table(requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
language plpgsql
stable
as $function$
declare
  v_source public.teams;
  v_target public.teams;
  v_age integer;
  v_code text;
  v_next text;
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

  -- Codes must match. Union and League do not share an age-grade framework,
  -- so a cross-code move is not a dispensation question -- it is meaningless.
  if v_source.rugby_code is distinct from v_target.rugby_code then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams are in different rugby codes. Union and League age grades are separate frameworks and a player cannot move between them as an age-grade progression.';
    return;
  end if;

  -- Trust the teams' own code over the caller's argument.
  v_code := coalesce(v_source.rugby_code, p_rugby_code);

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

    if v_code = 'union' then
      if v_age >= 17 then
        return query select
          'external_approval_required', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)',
          'Club approval for a 17-year-old to play adult rugby, individual player assessment, Club Safeguarding Officer approval, Constituent Body approval, and individual adult registration.',
          'No contested-scrum front row before age 18.',
          'This player is 17 and the destination is an adult Rugby Union team. RFU approval is required before they can participate in adult rugby.';
        return;
      else
        return query select 'not_permitted', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)', null::text, null::text,
          'Under RFU Regulation 15.7 a player must have reached their 17th birthday before playing any adult rugby.';
        return;
      end if;
    else
      -- RFL Operational Rules 2026 C2:5:1 -- Open Age from the 17th birthday,
      -- or as a true-age Under 17 from the March in a Season.
      if v_age >= 17 then
        return query select
          'external_approval_required', 'RFL', 'RFL Operational Rules 2026 C2:5:1 and C2:5:2',
          'Adult registration, plus a parent or guardian signature acknowledging that some sections of the RFL Safeguarding Policy do not apply to Adult Rugby League.',
          'A player may only play for the Adult team if their own age group can fulfil its fixtures that week.',
          'This player has reached 17 and the destination is an adult Rugby League team. Adult registration and the under-18 guardian acknowledgement are required.';
        return;
      end if;
      return query select
        'external_approval_required', 'RFL', 'RFL Player Dispensation Policy (Operational Rules 2026, Section F14)',
        'A dispensation decided by the RFL Dispensation Panel.',
        null::text,
        'This player is under 17 and the destination is an adult Rugby League team. RFL Operational Rules C2:5:1 set the Open Age threshold at the 17th birthday, so this needs a dispensation rather than an ordinary registration.';
      return;
    end if;
  end if;

  -- Ordinary progression, resolved against the ONE canonical graph. This is
  -- what makes a union Girls U12 -> U14 band move read as ordinary rather
  -- than as something needing a dispensation.
  if v_source.category = 'youth' and v_target.category = 'youth'
     and coalesce(v_source.gender, '') = coalesce(v_target.gender, '') then
    v_next := internal.next_age_grade_for(v_source.age_group, v_source.gender, v_code);
    if v_next is not null and v_next = v_target.age_group then
      return query select 'team_approval_only', null::text, null::text, null::text, null::text,
        format('Ordinary age-grade progression (%s -> %s) -- the source team''s own approval is sufficient.', v_source.age_group, v_target.age_group);
      return;
    end if;
  end if;

  return query select 'external_approval_required', null::text, null::text, null::text, null::text,
    format('Moving from %s to %s does not match an ordinary age-grade progression -- a recorded age-grade dispensation is required.',
      coalesce(v_source.age_group, v_source.category), coalesce(v_target.age_group, v_target.category));
end;
$function$;

comment on function internal.resolve_player_movement_eligibility(text, date, date, uuid, uuid) is
  'Classifies a player movement between two teams of the same club. Ordinary age-grade progression is tested against internal.next_age_grade_for -- the SAME successor the season rollover and the future-identity projector use -- so a union girls dual-age-band move reads as ordinary rather than as requiring a dispensation. The former hardcoded JuniorColts -> SeniorColts branch is gone: no team has carried those values since the Colts convergence. Cross-code moves are refused outright, because Union and League do not share an age-grade framework.';

do $$
begin
  if regexp_replace(
       (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='internal' and p.proname='resolve_player_movement_eligibility'),
       '--[^\n]*', '', 'g') ~* '(JuniorColts|SeniorColts)' then
    raise exception 'The movement resolver still keys off Colts age groups.';
  end if;
end $$;
