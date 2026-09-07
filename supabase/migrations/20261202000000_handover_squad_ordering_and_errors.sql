-- Season handover: B/C squad ordering, and error messages that name the real
-- problem.
--
-- TWO DEFECTS, FOUND BY RUNNING THE APPLY PATH RATHER THAN READING IT
--
-- A club running "U16" and "U16 B" prepares its handover and gets a proposal
-- for each. Nothing in the product says the order matters. Confirming the B
-- squad first produced:
--
--   B-FIRST REJECTED: That destination age group/gender combination is not
--   valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).
--
-- 1. THE MESSAGE IS WRONG. Nothing about the gender combination was invalid.
--    internal.validate_team_squad_structure had refused the write, because at
--    that instant no primary team existed at U17 -- the U16 team had not moved
--    yet. That guard raises errcode 23514, and the apply path mapped EVERY
--    check_violation to a hardcoded sentence about Mixed age bands. So the one
--    club-facing message a Club Admin gets points at the wrong thing entirely,
--    and the correct action (confirm the other team first) appears nowhere.
--
--    Any of the four check constraints on teams could reach that handler; all
--    four reported the gender message.
--
-- 2. THE ORDER MATTERS AND NOTHING SAYS SO. Confirming the primary first
--    works; confirming the squad first does not. The handover lists both
--    proposals with no indication of a dependency between them.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
-- The dependency itself is kept: a B or C squad genuinely cannot sit at a
-- level where the club has no primary team, and that is the invariant the
-- guard exists to protect. What changes is that the handover now states the
-- dependency before it trips, and names the team to confirm first.
--
-- What this does NOT do is cascade -- confirming the primary does not silently
-- move its squads. A Club Admin is allowed to progress the primary and FOLD
-- the B squad, and auto-deciding the squad's proposal would take that choice
-- away. Making the squads follow their primary automatically is a product
-- decision about what the handover screen offers, not a defect fix, so it is
-- left to be decided rather than assumed here.

-- ============================================================
-- Apply path: check the dependency up front, and stop guessing
-- at the cause of a check violation.
-- ============================================================

create or replace function internal.confirm_rollover_team_proposal_core(
  p_proposal_id uuid, p_action text, p_age_group text, p_squad_designation text,
  p_fold_reason text, p_gender text, p_decided_by uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
  v_team public.teams;
  v_squad text;
  v_dest_type uuid;
  v_primary_name text;
  v_constraint text;
  v_message text;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if p.is_mixed_boundary then
    raise exception 'This is a Mixed U11 -> U12 structural transition. Use the dedicated Girls-team decision flow, not the ordinary Confirm/Adjust path.' using errcode = 'P0001';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%).', p.decision;
  end if;
  if p_action not in ('confirm', 'adjust', 'fold', 'defer') then
    raise exception 'Unknown rollover action: %', p_action;
  end if;
  if p_gender is not null and p_gender not in ('boys', 'girls') then
    raise exception 'gender must be boys or girls for a youth rollover destination.';
  end if;

  if p_action = 'confirm' or p_action = 'adjust' then
    v_final_age_group := coalesce(p_age_group, p.proposed_age_group);
    if v_final_age_group is null then
      raise exception 'A destination age group is required -- this team''s rollover has no automatic mapping and needs an explicit choice.';
    end if;
    select * into v_team from public.teams where id = p.team_id;

    -- A B or C squad cannot land at a level where the club has no primary
    -- team. Say so BEFORE the write fails, and name the team to confirm
    -- first -- previously this surfaced as an unrelated gender error.
    v_squad := coalesce(p_squad_designation, v_team.squad_designation);
    if v_team.category = 'youth' and v_squad in ('B', 'C') then
      v_dest_type := internal.resolve_canonical_team_type(
        v_team.category, v_final_age_group, coalesce(p_gender, v_team.gender), v_squad);

      if not exists (
        select 1 from public.teams pt
        where pt.club_id = v_team.club_id
          and pt.canonical_team_type_id = v_dest_type
          and pt.squad_designation is null
          and pt.active
          and pt.id <> v_team.id
      ) then
        -- Is the primary simply waiting its turn in this same handover?
        select t.display_name into v_primary_name
        from public.age_grade_rollover_team_proposals pp
        join public.teams t on t.id = pp.team_id
        where pp.rollover_id = p.rollover_id
          and pp.decision = 'pending'
          and t.club_id = v_team.club_id
          and t.squad_designation is null
          and t.active
          and t.canonical_team_type_id = v_team.canonical_team_type_id
        limit 1;

        if v_primary_name is not null then
          raise exception 'Confirm % first. A % squad moves up with its primary team, so % has to reach % before this squad can.',
            v_primary_name, v_squad, v_primary_name, v_final_age_group
            using errcode = 'P0001';
        else
          raise exception 'This club has no primary team at %. A % squad cannot sit at a level on its own -- roll the primary team up to % first, or use Adjust to move this squad somewhere it has one.',
            v_final_age_group, v_squad, v_final_age_group
            using errcode = 'P0001';
        end if;
      end if;
    end if;

    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;

    begin
      update public.teams
      set age_group = v_final_age_group,
          squad_designation = coalesce(p_squad_designation, squad_designation),
          gender = coalesce(p_gender, gender)
      where id = p.team_id;
    exception
      when unique_violation then
        raise exception 'This club already has a team at % with the same squad designation and gender. Use Adjust and choose a different squad letter (e.g. a "B" squad) to roll this team forward.', v_final_age_group;
      when check_violation then
        -- Report what actually failed. Mapping every check violation to the
        -- gender sentence sent Club Admins looking at the wrong field.
        get stacked diagnostics
          v_constraint = constraint_name,
          v_message = message_text;
        if v_constraint = 'teams_gender_category_check' then
          raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).';
        elsif v_constraint = 'teams_age_group_check' then
          raise exception '% is not an age group Ovalball recognises.', v_final_age_group;
        elsif v_constraint = 'teams_active_squad_designation_valid' then
          raise exception 'A squad letter is only valid on a youth team, and only B or C.';
        elsif v_constraint is null or v_constraint = '' then
          -- A guard trigger raised this; its own message is already club-facing.
          raise exception '%', v_message using errcode = 'P0001';
        else
          raise exception 'That destination is not valid for this team (%).', v_constraint;
        end if;
    end;

    if r.to_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = p.team_id
      on conflict (team_id, season_id) do nothing;
    end if;

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', p_decided_by,
      jsonb_build_object('age_group', p.current_age_group),
      jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals
      set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = p_decided_by, decided_at = now()
      where id = p_proposal_id;
  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals
      set decision = 'folded', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals
      set decision = 'deferred', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  end if;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'confirm_rollover_team_proposal_core';

  if v_def !~ 'get stacked diagnostics' then
    raise exception 'The apply path still guesses at the cause of a check violation.';
  end if;
  if v_def !~ 'moves up with its primary team' then
    raise exception 'The apply path does not state the B/C squad dependency.';
  end if;
end $$;
