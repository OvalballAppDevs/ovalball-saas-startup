-- U6 at season handover: the cohort progresses, and a new intake team is
-- created for the incoming starters.
--
-- PRODUCT RULE (product owner, superseding earlier behaviour)
--
--   existing U6 cohort  -> U7
--   AND a NEW U6 operational team is created for the incoming intake
--
-- This is deterministic. The cohort must not be left at U6, must not be
-- skipped, and the ordinary U6 progression must not be routed to a manual
-- decision.
--
-- Two earlier behaviours were both wrong. The original handover excluded U6
-- outright, silently choosing "it stays U6". The replacement offered U6 as a
-- decision for the club, which shipped an unresolved product question into the
-- product as if it were a feature. The rule was never the club's to make.
--
-- THE SHAPE OF IT
--
--   OLD TEAM  stable team_id, current identity U6, next identity U7
--   NEW TEAM  new stable team_id, next identity U6, the new intake
--
-- The old cohort is never mutated back to U6. Two stable team ids exist
-- afterwards, and they are different cohorts that happen to have shared a
-- label a season apart -- which is exactly why fixture history and access must
-- follow the stable id rather than the age label.
--
-- IDEMPOTENCE
--
-- Applying twice must not leave two indistinguishable active U6 teams. Three
-- guards, in order of preference:
--
--   1. The proposal records the intake team it produced (intake_team_id), so
--      a repeat apply of the same proposal is a no-op. This mirrors how the
--      Mixed U11 -> U12 split already records girls_team_id.
--   2. If the club already has an ACTIVE primary team at the U6 identity, it
--      is adopted rather than duplicated.
--   3. If a FOLDED U6 primary exists, it is reactivated rather than replaced,
--      so its history and stable id are kept.
--
-- Underneath all three, teams_active_canonical_identity_idx makes a second
-- active primary U6 impossible at the database level regardless of code path.
--
-- No B or C squad is created for the intake team. A club that wants one adds
-- it through the ordinary squad workflow, where the primary-before-B-before-C
-- rules apply.

-- ============================================================
-- 1. Record what the handover produced.
-- ============================================================

alter table public.age_grade_rollover_team_proposals
  add column if not exists intake_team_created boolean not null default false,
  add column if not exists intake_team_id uuid references public.teams(id);

comment on column public.age_grade_rollover_team_proposals.intake_team_created is
  'True once this proposal has produced (or adopted) the new-season intake team. Applying the proposal again must not create a second one.';
comment on column public.age_grade_rollover_team_proposals.intake_team_id is
  'The stable team id of the intake team created for the season this handover enters. A different cohort from the team this proposal progressed, despite sharing the age label a season apart.';

-- ============================================================
-- 2. Prepare: U6 progresses automatically, like every other age.
-- ============================================================

create or replace function internal.generate_rollover_proposal_core(
  p_club_id uuid, p_rugby_code text, p_to_season_id uuid, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
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
  select id into v_from_season_id
  from public.seasons
  where rugby_code = p_rugby_code
    and ends_on < (select starts_on from public.seasons where id = p_to_season_id)
  order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, p_created_by)
  on conflict (club_id, rugby_code, to_season_id)
    do update set club_id = excluded.club_id
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null
  loop
    -- Code-aware: union girls step by dual age band, union stops at U18,
    -- league continues to U19.
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, p_rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed'
      and v_next_age is not null
      and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');

    -- U6 -> U7 is ordinary automatic progression. A manual choice here would
    -- be Ovalball asking the club to decide a rule the product already has.
    v_requires_manual := v_next_age is null or v_is_mixed_boundary;

    insert into public.age_grade_rollover_team_proposals
      (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (v_rollover_id, t.id, t.age_group, v_next_age, v_requires_manual, v_is_mixed_boundary)
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg
    where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade_for(mt.age_group, mt.gender, mt.rugby_code))
      into v_would_be_ages
    from public.scheduling_group_members sgm
    join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id,
        format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  perform internal.generate_rollover_player_proposals_core(v_rollover_id);

  return v_rollover_id;
end;
$function$;

-- ============================================================
-- 3. Creating (or adopting) the intake team.
-- ============================================================

create or replace function internal.provision_intake_team(
  p_proposal_id uuid, p_club_id uuid, p_rugby_code text, p_gender text, p_actor uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_type uuid;
  v_existing public.teams;
  v_new_id uuid;
begin
  v_type := internal.resolve_canonical_team_type('youth', 'U6', p_gender, null);
  if v_type is null then
    raise exception 'There is no canonical U6 identity for this code and gender, so no intake team can be created.'
      using errcode = 'P0001';
  end if;

  -- Adopt an existing primary U6 rather than stand a second one beside it.
  select * into v_existing from public.teams
  where club_id = p_club_id and rugby_code = p_rugby_code
    and canonical_team_type_id = v_type and squad_designation is null
  order by active desc, created_at asc
  limit 1;

  if v_existing.id is not null then
    if not v_existing.active then
      -- Reactivate rather than replace: the folded team keeps its stable id
      -- and everything attached to it.
      update public.teams set active = true, archived_at = null, archived_by = null
      where id = v_existing.id;
      insert into public.audit_log (table_name, record_id, action, changed_by, after)
      values ('teams', v_existing.id, 'update', p_actor,
        jsonb_build_object('event', 'U6_INTAKE_TEAM_REACTIVATED', 'rollover_proposal_id', p_proposal_id));
    end if;
    return v_existing.id;
  end if;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, created_by, updated_by)
  values (p_club_id, p_rugby_code, 'youth', 'U6', p_gender,
          'U6', 'u6-' || substr(gen_random_uuid()::text, 1, 8), p_actor, p_actor)
  returning id into v_new_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_new_id, 'insert', p_actor,
    jsonb_build_object('event', 'U6_INTAKE_TEAM_CREATED', 'rollover_proposal_id', p_proposal_id));

  return v_new_id;
end;
$function$;

comment on function internal.provision_intake_team(uuid, uuid, text, text, uuid) is
  'Creates, adopts or reactivates the club''s primary U6 team for the season a handover enters. Never produces a second indistinguishable active U6.';

-- ============================================================
-- 4. Apply: progress the cohort, then provision the intake.
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
  v_intake_id uuid;
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
    -- team. Say so BEFORE the write fails, and name the team to confirm first.
    v_squad := coalesce(p_squad_designation, v_team.squad_designation);
    v_dest_type := internal.resolve_canonical_team_type(
      v_team.category, v_final_age_group, coalesce(p_gender, v_team.gender), v_squad);

    if v_team.category = 'youth' and v_squad in ('B', 'C') then
      if not exists (
        select 1 from public.teams pt
        where pt.club_id = v_team.club_id
          and pt.canonical_team_type_id = v_dest_type
          and pt.squad_designation is null
          and pt.active
          and pt.id <> v_team.id
      ) then
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
        -- The destination is occupied. If the occupant is itself waiting its
        -- turn in this same handover, the club does not need a different squad
        -- letter -- it needs to confirm that team first. Telling a club to put
        -- its U6 cohort into a "U7 B squad" because the U7s have not moved yet
        -- is wrong advice, and the U6 intake rule makes that collision
        -- unavoidable every season for the whole mini-rugby ladder.
        select t.display_name into v_primary_name
        from public.age_grade_rollover_team_proposals pp
        join public.teams t on t.id = pp.team_id
        where pp.rollover_id = p.rollover_id
          and pp.decision = 'pending'
          and t.club_id = v_team.club_id
          and t.active
          and t.id <> v_team.id
          and t.canonical_team_type_id = v_dest_type
          and coalesce(t.squad_designation, '') = coalesce(v_squad, '')
        limit 1;

        if v_primary_name is not null then
          raise exception 'Confirm % first. It still holds the % place and has not moved up yet -- once it does, this team can take it.',
            v_primary_name, v_final_age_group using errcode = 'P0001';
        end if;

        raise exception 'This club already has a team at % with the same squad designation and gender. Use Adjust and choose a different squad letter (e.g. a "B" squad) to roll this team forward.', v_final_age_group;
      when check_violation then
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
          raise exception '%', v_message using errcode = 'P0001';
        else
          raise exception 'That destination is not valid for this team (%).', v_constraint;
        end if;
    end;

    -- PRODUCT RULE: a U6 cohort that has moved up leaves the intake slot
    -- empty, and the incoming starters need a team. Runs after the update so
    -- the old cohort has already vacated the U6 identity.
    if p.current_age_group = 'U6'
       and v_final_age_group <> 'U6'
       and v_team.squad_designation is null
       and not p.intake_team_created then
      v_intake_id := internal.provision_intake_team(
        p_proposal_id, v_team.club_id, v_team.rugby_code, v_team.gender, p_decided_by);

      update public.age_grade_rollover_team_proposals
      set intake_team_created = true, intake_team_id = v_intake_id
      where id = p_proposal_id;

      if r.to_season_id is not null then
        insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
        select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
        from public.teams where id = v_intake_id
        on conflict (team_id, season_id) do nothing;
      end if;
    end if;

    if r.to_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = p.team_id
      on conflict (team_id, season_id) do nothing;
    end if;

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', p_decided_by,
      jsonb_build_object('age_group', p.current_age_group),
      jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id,
                         'intake_team_id', v_intake_id));
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
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'generate_rollover_proposal_core';
  if v_def ~ 'age_group = ''U6''' then
    raise exception 'Prepare still routes the ordinary U6 progression to a manual decision.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'confirm_rollover_team_proposal_core';
  if v_def !~ 'provision_intake_team' then
    raise exception 'Apply does not provision the new U6 intake team.';
  end if;
  if v_def !~ 'not p.intake_team_created' then
    raise exception 'The intake provisioning is not guarded against a repeat apply.';
  end if;
  if v_def !~ 'It still holds the' then
    raise exception 'A collision with a team still waiting its turn is not explained.';
  end if;
end $$;
