-- Season handover: remove the competing progression sources and the assumptions
-- the Colts convergence left dead.
--
-- AUDIT FINDING
--
-- Age-grade progression was being computed in THREE places, and only one of
-- them knew about rugby code:
--
--   public.generate_rollover_proposal        -> next_age_grade_for  (correct)
--   internal.generate_rollover_proposal_core -> next_age_grade      (WRONG)
--   internal.project_team_identity           -> next_age_grade      (WRONG)
--
-- The two wrong ones are not minor. generate_rollover_proposal_core is what
-- internal.process_due_season_transitions calls, so the AUTOMATIC season
-- transition -- the one that runs without anybody watching -- used the
-- code-blind successor while the manual button used the code-aware one. A
-- union Girls U12 cohort would roll to "U13", an identity union does not
-- have, and a league U18 would stop instead of continuing to U19.
--
-- project_team_identity feeds get_team_identity_for_season, which is how
-- fixtures and the calendar project a team's identity into a future season.
-- Same bug, different surface: a future union girls fixture would show the
-- wrong age grade.
--
-- Both now use internal.next_age_grade_for. internal.next_age_grade remains
-- as the gender/code-independent primitive it always was, used only where
-- that is genuinely correct (the U6-U8 mini-rugby band check).
--
-- DEAD COLTS ASSUMPTIONS
--
-- graduate_team gated on (category='colts' and age_group='SeniorColts'). After
-- the convergence no team carries those values, so senior-cohort graduation
-- had silently become impossible. It now gates on the canonical U18 identity.
--
-- LEAGUE GIRLS U16 IS DELIBERATELY LEFT WITHOUT A SUCCESSOR
--
-- The RFL Girls League Competition Rules 2026 list U11, U12, U13, U14, U15,
-- U16 and U18 -- there is no U17 division, and the 2025 edition had one. Rule
-- 4.5 permits a player to enter U18 fixtures only once she "has turned 16",
-- and 4.4 allows play in the true age group or one above. That establishes
-- eligibility for individual players; it does not establish an automatic
-- cohort progression for a whole team, and the conditional cannot be assumed
-- true for every player in a squad. So next_age_grade_for returns null for
-- league girls at U16, which routes the transition to requires_manual_choice.
-- That is the intended NEEDS_ATTENTION outcome, not a gap.

CREATE OR REPLACE FUNCTION internal.generate_rollover_proposal_core(p_club_id uuid, p_rugby_code text, p_to_season_id uuid, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rollover_id uuid;
  v_from_season_id uuid;
  t record;
  v_group record;
  v_would_be_ages text[];
  v_next_age text;
  v_requires_manual boolean;
  v_is_mixed_boundary boolean;
begin
  select id into v_from_season_id from public.seasons where rugby_code = p_rugby_code and ends_on < (select starts_on from public.seasons where id = p_to_season_id) order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, p_created_by)
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'
  loop
    -- Code-aware: union girls step by dual age band, union stops at U18,
    -- league continues to U19. The manual path already did this; this is the
    -- AUTOMATIC path, which was still using the code-blind successor.
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, p_rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed' and v_next_age is not null and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');
    v_requires_manual := v_next_age is null or v_is_mixed_boundary;

    insert into public.age_grade_rollover_team_proposals (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (
      v_rollover_id, t.id, t.age_group,
      case when v_next_age is null then null else v_next_age end,
      v_requires_manual,
      v_is_mixed_boundary
    )
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade(mt.age_group)) into v_would_be_ages
    from public.scheduling_group_members sgm join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id, format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  return v_rollover_id;
end;
$function$;



-- ============================================================
-- 2. The future-season identity projector becomes code-aware.
-- ============================================================

create or replace function internal.project_team_identity(p_age_group text, p_gender text, p_rugby_code text, p_seasons_ahead integer)
returns table(projected_age_group text, is_deterministic boolean)
language plpgsql
immutable
as $function$
declare
  v_age text := p_age_group;
  i integer;
begin
  if p_seasons_ahead <= 0 then
    return query select p_age_group, true;
    return;
  end if;
  if p_age_group is null then
    return query select null::text, false;
    return;
  end if;
  for i in 1..p_seasons_ahead loop
    -- A mixed U11 cohort splits at U12 (mixed rugby ends there in both codes),
    -- so its future identity is a decision, not a projection.
    if coalesce(p_gender, '') = 'mixed' and v_age = 'U11' then
      return query select null::text, false;
      return;
    end if;
    v_age := internal.next_age_grade_for(v_age, p_gender, p_rugby_code);
    if v_age is null then
      return query select null::text, false;
      return;
    end if;
  end loop;
  return query select v_age, true;
end;
$function$;

comment on function internal.project_team_identity(text, text, text, integer) is
  'Projects a youth team''s age identity N seasons ahead, using the CODE-AWARE successor. The previous three-argument form used internal.next_age_grade and so projected union girls single-year instead of by dual age band, and stopped league boys at U18 instead of U19. Returns is_deterministic = false wherever the pathway needs a human decision -- a mixed U11 cohort splitting at U12, a union U18 entering senior rugby, or a league girls U16 with no U17 division to move into.';

-- The old three-argument form is kept for any caller not yet migrated, and
-- delegates with a null code so it degrades to the shared default rather than
-- silently asserting a code it does not know.
create or replace function internal.project_team_identity(p_age_group text, p_gender text, p_seasons_ahead integer)
returns table(projected_age_group text, is_deterministic boolean)
language sql
immutable
as $function$
  select * from internal.project_team_identity(p_age_group, p_gender, null::text, p_seasons_ahead);
$function$;

comment on function internal.project_team_identity(text, text, integer) is
  'DEPRECATED three-argument form. Delegates to the code-aware version with a null rugby code, which falls through to the shared single-year default. Use the four-argument form; a projection that does not know the rugby code cannot be correct for union girls or for league later youth.';

-- get_team_identity_for_season has the team in hand, so it knows the code.
create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table(category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql
stable
as $function$
declare
  v_team public.teams;
  v_current_season_id uuid;
  v_current_starts_on date;
  v_target_starts_on date;
  v_seasons_ahead integer;
  v_projected_age text;
  v_is_deterministic boolean;
  v_projected_display_name text;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then return; end if;

  -- A stored season identity always wins: it is the historical record of what
  -- this team actually was in that season, and must never be re-derived.
  return query
    select tsi.category, tsi.age_group, tsi.squad_designation, tsi.gender, tsi.display_name, false
    from public.team_season_identity tsi
    where tsi.team_id = p_team_id and tsi.season_id = p_season_id;
  if found then return; end if;

  select id into v_current_season_id
  from public.seasons
  where rugby_code = v_team.rugby_code and starts_on < current_date
  order by starts_on desc, is_regression_fixture asc, id asc limit 1;

  if v_current_season_id is null or v_current_season_id = p_season_id or v_team.category <> 'youth' or v_team.age_group is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select starts_on into v_current_starts_on from public.seasons where id = v_current_season_id;
  select starts_on into v_target_starts_on from public.seasons where id = p_season_id;
  if v_current_starts_on is null or v_target_starts_on is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_seasons_ahead := (extract(year from age(v_target_starts_on, v_current_starts_on)))::integer;
  if v_seasons_ahead <= 0 then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  -- Code-aware projection. Passing v_team.rugby_code is the whole fix.
  select p.projected_age_group, p.is_deterministic into v_projected_age, v_is_deterministic
  from internal.project_team_identity(v_team.age_group, v_team.gender, v_team.rugby_code, v_seasons_ahead) p;

  if not coalesce(v_is_deterministic, false) or v_projected_age is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_projected_display_name := internal.compute_team_display_name(v_team.category, v_projected_age, v_team.gender, v_team.squad_designation, v_team.team_number);
  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender, v_projected_display_name, true;
end;
$function$;

-- ============================================================
-- 3. graduate_team: the Colts gate is dead, and the girls gate was code-blind.
-- ============================================================

create or replace function public.graduate_team(p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.teams;
  v_season_name text;
  v_archive_label text;
  v_queued_count integer := 0;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may graduate a cohort.' using errcode = '42501';
  end if;
  if not t.active then raise exception 'This team is already inactive.'; end if;

  -- A cohort may be graduated exactly where its pathway genuinely ends -- i.e.
  -- where the code-aware successor returns nothing. Previously this gated on
  -- (category='colts' and age_group='SeniorColts'), which no team has carried
  -- since Colts converged onto U18, so senior graduation had quietly become
  -- impossible; and on Girls U16 for BOTH codes, which is wrong for union,
  -- where the U16/U15 band progresses to the U18/U17 band.
  if internal.next_age_grade_for(t.age_group, t.gender, t.rugby_code) is not null then
    raise exception 'This cohort still has a next age grade (%). Use the ordinary Season Rollover decision (Confirm/Adjust/Fold/Defer) instead of graduating it.',
      internal.next_age_grade_for(t.age_group, t.gender, t.rugby_code)
      using errcode = 'P0001';
  end if;
  if t.category <> 'youth' then
    raise exception 'Only a youth cohort can be graduated. Senior teams persist season to season.' using errcode = 'P0001';
  end if;

  select name into v_season_name from public.seasons where id = internal.resolve_season_for_date(t.rugby_code, current_date);
  v_archive_label := trim(t.display_name) || coalesce(' (' || v_season_name || ')', '') || ' Archive';

  update public.teams
  set active = false, archived_at = now(), archived_by = auth.uid(), display_name = v_archive_label
  where id = p_team_id;

  insert into public.player_graduation_queue (player_id, source_team_id, club_id)
  select ptm.player_id, t.id, t.club_id
  from public.player_team_memberships ptm
  where ptm.team_id = t.id and ptm.status = 'active'
  on conflict do nothing;
  get diagnostics v_queued_count = row_count;

  return v_queued_count;
end;
$function$;

comment on function public.graduate_team(uuid) is
  'Archives a youth cohort whose pathway has ended and queues its players for placement. The gate is now derived rather than hardcoded: a cohort may be graduated exactly where internal.next_age_grade_for returns no successor for its age, gender and rugby code -- union U18, league U19, and league girls U16 (the 2026 Girls League has no U17 division). This replaces a gate on SeniorColts, which no team has carried since the Colts convergence, and on Girls U16 for both codes, which was wrong for union.';

-- Guards are consolidated at the end of this migration, after every
-- redefinition has been applied.

-- ============================================================
-- 5. League later-youth progression is MALE-only.
--
--    Caught by the guard above. The league steps added earlier
--    (U16->U17->U18->U19) were written without a gender test, so they applied
--    to girls too -- inferring a Girls U17 progression from the boys pathway,
--    which is precisely what the evidence forbids.
--
--    RFL Girls League Competition Rules 2026 list U11, U12, U13, U14, U15,
--    U16 and U18. There is no U17 division, and the 2025 edition had one, so
--    the absence is a deliberate change rather than an omission. Rule 4.5
--    permits a player into U18 fixtures only once she "has turned 16" and 4.4
--    allows the true age group or one above -- that establishes eligibility
--    for an individual, not an automatic successor for a whole cohort, and
--    the condition cannot be assumed of every player in a squad.
--
--    So league girls stop at U16 with no successor, which routes the
--    transition to NEEDS_ATTENTION. That is the designed outcome.
-- ============================================================

create or replace function internal.next_age_grade_for(p_age_group text, p_gender text, p_rugby_code text)
returns text
language sql
immutable
as $$
  select case
    -- Union girls move band to band; U18 is the last before adult women's.
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group in ('U12','U14','U16','U18') then
      case p_age_group when 'U12' then 'U14' when 'U14' then 'U16' when 'U16' then 'U18' else null end
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group = 'U11' then 'U12'

    -- League girls: single-year to U16, then STOP. The 2026 Girls League has
    -- no U17 division, and jumping U16 -> U18 is not established for a cohort.
    when p_gender = 'girls' and p_rugby_code = 'league' and p_age_group = 'U16' then null

    -- Union later youth stops at U18: the step into senior rugby is a
    -- decision, not a mechanical roll.
    when p_rugby_code = 'union' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U16' then 'U17'
    when p_rugby_code = 'union' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U17' then 'U18'
    when p_rugby_code = 'union' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U18' then null

    -- League male later youth runs one grade further before Open Age.
    when p_rugby_code = 'league' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U16' then 'U17'
    when p_rugby_code = 'league' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U17' then 'U18'
    when p_rugby_code = 'league' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U18' then 'U19'
    when p_rugby_code = 'league' and coalesce(p_gender,'') <> 'girls' and p_age_group = 'U19' then null

    else internal.next_age_grade(p_age_group)
  end;
$$;

comment on function internal.next_age_grade_for(text, text, text) is
  'Code- AND gender-specific age-grade succession. Union girls step U12->U14->U16->U18 (RFU Regulation 15.6 dual age bands). Union males run U16->U17->U18 and stop, because entering senior rugby is a decision. League males run U16->U17->U18->U19 and stop before Open Age. LEAGUE GIRLS STOP AT U16: the RFL Girls League Competition Rules 2026 have no U17 division (2025 did), and no automatic cohort successor is established -- that transition must reach a human. Returning null here is what produces NEEDS_ATTENTION, and is a feature.';

do $$
begin
  if (select is_deterministic from internal.project_team_identity('U16','girls','league',1)) then
    raise exception 'League girls U16 still projects forward.';
  end if;
  if internal.next_age_grade_for('U16','boys','league') <> 'U17'
     or internal.next_age_grade_for('U18','boys','league') <> 'U19' then
    raise exception 'League male later-youth progression was broken by the gender guard.';
  end if;
  if internal.next_age_grade_for('U16','boys','union') <> 'U17'
     or internal.next_age_grade_for('U18','boys','union') is not null then
    raise exception 'Union male later-youth progression was broken by the gender guard.';
  end if;
  if internal.next_age_grade_for('U16','girls','union') <> 'U18' then
    raise exception 'Union girls band progression was broken by the gender guard.';
  end if;
  if internal.next_age_grade_for('U15','girls','league') <> 'U16' then
    raise exception 'League girls single-year progression below U16 was broken.';
  end if;

  -- And the future-season projector must agree with the successor function,
  -- since they are now the same source of truth rather than two.
  if (select projected_age_group from internal.project_team_identity('U12','girls','union',1)) <> 'U14' then
    raise exception 'Future-season projection still steps union girls single-year.';
  end if;
  if (select projected_age_group from internal.project_team_identity('U18','boys','league',1)) <> 'U19' then
    raise exception 'Future-season projection stops league boys before U19.';
  end if;
  if (select is_deterministic from internal.project_team_identity('U18','boys','union',1)) then
    raise exception 'Union U18 is being projected forward; entering senior rugby is a decision.';
  end if;
end $$;
