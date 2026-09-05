-- Age-grade classification terminology and the U11 Mixed -> U12 structural
-- transition.
--
-- Terminology: age-grade (youth) rugby uses Boys/Girls/Mixed. Senior rugby
-- uses Men's/Women's. These are DIFFERENT vocabularies for different
-- rugby contexts -- never interchangeable, never a global find/replace.
-- Product rule: U6-U11 may be Boys, Girls, or Mixed. U12 and above must be
-- Boys or Girls (never Mixed). Senior teams must be Men's or Women's
-- (never Boys/Girls/Mixed).
--
-- Normal age-grade progression (U12 Boys A -> U13 Boys A -> ...) already
-- keeps the SAME team_id via confirm_rollover_team_proposal's plain UPDATE
-- -- that was correct from the first version of this migration and needs
-- no change. What was wrong: a U11 Mixed team crossing into U12 was
-- treated as an open "pick any age+gender" choice. The real product
-- behaviour is narrower: the existing cohort continues as U12 Boys under
-- its OWN stable team_id (never forced into a Boys-or-Girls fork), and a
-- SEPARATE, explicit, un-defaulted Yes/No question governs whether a
-- genuinely NEW U12 Girls team (its own team_id, zero inherited history)
-- should also be created.

-- ============================================================
-- 1. Gender/category-aware constraint (replaces the plain value-domain
--    check plus the first version's age-grade-only check with one rule
--    that also fixes the vocabulary: senior stays mens/womens; youth
--    stays boys/girls/mixed, with mixed only inside U6-U11).
-- ============================================================

alter table public.teams drop constraint teams_gender_check;

alter table public.teams add constraint teams_gender_category_check
  check (
    gender is null
    or (category = 'senior' and gender in ('mens', 'womens'))
    or (category = 'youth' and gender in ('boys', 'girls'))
    or (category = 'youth' and gender = 'mixed' and (age_group is null or age_group in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11')))
  );

comment on constraint teams_gender_category_check on public.teams is
  'Senior teams: mens/womens only (never Boys/Girls/Mixed -- that vocabulary belongs to age-grade rugby). Youth teams: boys/girls at any age, mixed only for U6-U11. The one structural enforcement point every create/edit/import path already writes through.';

-- ============================================================
-- 2. identity_key must include gender. Without this, "U12 Boys A" and a
--    parallel "U12 Girls A" collide on (club_id, identity_key) the moment
--    a club wants the same squad letter for both -- exactly the shape the
--    U11-Mixed-boundary Girls-team creation below produces. Drop and
--    recreate (Postgres has no ALTER on a GENERATED ALWAYS AS expression).
-- ============================================================

alter table public.teams drop constraint teams_club_id_identity_key_key;
alter table public.teams drop column identity_key;
alter table public.teams add column identity_key text generated always as (
  coalesce(rugby_code, '') || ':' ||
  category || ':' ||
  coalesce(age_group, '') || ':' ||
  coalesce(team_number::text, '') || ':' ||
  coalesce(squad_designation, '') || ':' ||
  coalesce(gender, '')
) stored;
alter table public.teams add constraint teams_club_id_identity_key_key unique (club_id, identity_key);

-- ============================================================
-- 3. internal.teams_can_play_fixture: the girls-youth flexible-age rule
--    now keys on gender = 'girls' (was 'womens', which is the senior
--    vocabulary and never a real youth value going forward). Senior
--    branch is untouched -- mens/womens matching is still correct there.
-- ============================================================

create or replace function internal.teams_can_play_fixture(p_team_a uuid, p_team_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a record;
  b record;
begin
  select rugby_code, category, age_group, gender into a from public.teams where id = p_team_a;
  select rugby_code, category, age_group, gender into b from public.teams where id = p_team_b;
  if a.rugby_code is null or b.rugby_code is null then
    return true;
  end if;
  if a.rugby_code <> b.rugby_code or a.category <> b.category then
    return false;
  end if;
  if a.category <> 'youth' then
    return a.gender is null or b.gender is null or a.gender = b.gender;
  end if;
  if a.gender = 'girls' and b.gender = 'girls' then
    return true;
  end if;
  return internal.age_fixture_band(a.age_group) is not null and internal.age_fixture_band(a.age_group) = internal.age_fixture_band(b.age_group);
end;
$$;

comment on function internal.teams_can_play_fixture(uuid, uuid) is
  'Girls youth rugby is deliberately flexible on strict age-band matching (gender=''girls''). Boys/Mixed youth: U6-U8 form one tag-rugby band, U9-U16 are each their own strict band. Senior: rugby_code+category+gender must match, team_number never blocks a match.';

-- ============================================================
-- 4. Rollover proposals: two new columns distinguishing the genuine
--    U11-Mixed structural boundary from the ordinary U16 no-mapping case
--    -- both set requires_manual_choice=true (neither is a plain-Confirm
--    row), but only the mixed boundary has an automatic proposed_age_group
--    (U12, via the continuing team defaulting to Boys) and the separate
--    Girls-team decision recorded once answered.
-- ============================================================

alter table public.age_grade_rollover_team_proposals
  add column is_mixed_boundary boolean not null default false,
  add column girls_team_created boolean,
  add column girls_team_id uuid references public.teams(id);

comment on column public.age_grade_rollover_team_proposals.is_mixed_boundary is
  'True only for a Mixed team crossing out of the U6-U11 band (in practice, U11 Mixed -> U12). requires_manual_choice is also true for this row, but unlike the U16 case, proposed_age_group is NOT null -- it names the automatic Boys continuation. The row must still go through confirm_mixed_boundary_rollover(), never the plain confirm/adjust path, because the Girls-team question requires an explicit answer regardless of the Boys side being automatic.';

-- ============================================================
-- 5. generate_rollover_proposal: the mixed-boundary case now proposes
--    U12 automatically (the default Boys continuation) instead of null --
--    only the genuinely-unmappable U16 case keeps proposed_age_group null.
-- ============================================================

create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if not (internal.can_manage_club_fixtures(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select id into v_from_season_id from public.seasons where rugby_code = p_rugby_code and ends_on < (select starts_on from public.seasons where id = p_to_season_id) order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, auth.uid())
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'
  loop
    v_next_age := internal.next_age_grade(t.age_group);
    -- U16 (no mechanical mapping): manual choice, no proposal.
    -- A Mixed team crossing out of U6-U11 (in practice U11 -> U12): the
    -- ONLY mixed-boundary shape that exists, since next_age_grade tops
    -- out at U16 and mixed is never valid past U11 anyway -- still routed
    -- to the special manual flow, but WITH an automatic proposal (the
    -- Boys continuation), never a bare null.
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
$$;

revoke execute on function public.generate_rollover_proposal(uuid, text, uuid) from public;
grant execute on function public.generate_rollover_proposal(uuid, text, uuid) to authenticated;

-- ============================================================
-- 6. confirm_rollover_team_proposal: unchanged shape (confirm/adjust/fold/
--    defer), but now explicitly REFUSES a mixed-boundary row -- that row
--    must go through confirm_mixed_boundary_rollover() below, which is
--    the only path that can answer its Girls-team question. p_gender
--    stays available for 'adjust' on an ordinary (non-mixed-boundary) row
--    where a Club Admin wants a different destination gender than the
--    team's own current one (e.g. correcting a mis-set Boys/Girls team).
-- ============================================================

create or replace function public.confirm_rollover_team_proposal(
  p_proposal_id uuid, p_action text, p_age_group text default null, p_squad_designation text default null,
  p_fold_reason text default null, p_gender text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if p.is_mixed_boundary then
    raise exception 'This is a Mixed U11 -> U12 structural transition. Use the dedicated Girls-team decision flow, not the ordinary Confirm/Adjust path.' using errcode = 'P0001';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to confirm this rollover proposal.' using errcode = '42501';
  end if;
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
        raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).';
    end;
    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', auth.uid(), jsonb_build_object('age_group', p.current_age_group), jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals set decision = 'folded', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals set decision = 'deferred', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  end if;
end;
$$;

revoke execute on function public.confirm_rollover_team_proposal(uuid, text, text, text, text, text) from public;
grant execute on function public.confirm_rollover_team_proposal(uuid, text, text, text, text, text) to authenticated;

drop function if exists public.confirm_rollover_team_proposal(uuid, text, text, text, text);

-- ============================================================
-- 7. confirm_mixed_boundary_rollover: the ONLY path that resolves a
--    U11-Mixed structural transition. Always applies the Boys
--    continuation to the SAME team_id (same history, same fixtures, same
--    settings/staff). p_create_girls_team has NO default -- a caller must
--    pass an explicit boolean, never silently assumed. When true, checks
--    for an existing active or folded U12 Girls team FIRST (never a
--    duplicate) before creating a genuinely new team row with zero
--    inherited fixtures/results. One transaction: if the Girls-team
--    insert fails (e.g. a concurrent creation raced it), the whole call
--    raises and nothing -- not even the Boys continuation -- is applied.
-- ============================================================

create or replace function public.confirm_mixed_boundary_rollover(
  p_proposal_id uuid,
  p_create_girls_team boolean,
  p_boys_squad_designation text default null,
  p_girls_squad_designation text default null
)
returns table(boys_team_id uuid, girls_team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  t public.teams;
  v_final_boys_squad text;
  v_existing_girls_id uuid;
  v_existing_girls_active boolean;
  v_new_girls_id uuid;
  v_girls_squad text;
  v_girls_display_name text;
  v_girls_slug text;
begin
  if p_create_girls_team is null then
    raise exception 'You must explicitly answer whether to create a new U12 Girls team (Yes or No) -- it cannot be left unanswered.';
  end if;

  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if not p.is_mixed_boundary then
    raise exception 'This proposal is not a Mixed structural boundary -- use confirm_rollover_team_proposal instead.';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to confirm this rollover proposal.' using errcode = '42501';
  end if;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%).', p.decision;
  end if;

  select * into t from public.teams where id = p.team_id;

  -- The continuing cohort: SAME team_id, becomes Boys at the proposed age
  -- group. History, settings, staff relationships all survive untouched
  -- because nothing about the row's identity changes except these fields.
  v_final_boys_squad := coalesce(p_boys_squad_designation, t.squad_designation);
  update public.teams set age_group = p.proposed_age_group, gender = 'boys', squad_designation = v_final_boys_squad where id = p.team_id;
  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('teams', p.team_id, 'update', auth.uid(),
    jsonb_build_object('age_group', p.current_age_group, 'gender', 'mixed'),
    jsonb_build_object('age_group', p.proposed_age_group, 'gender', 'boys', 'rollover_id', r.id, 'event', 'mixed_boundary_boys_continuation'));

  if p_create_girls_team then
    select id, active into v_existing_girls_id, v_existing_girls_active
    from public.teams
    where club_id = r.club_id and category = 'youth' and age_group = p.proposed_age_group and gender = 'girls'
    limit 1;

    if v_existing_girls_id is not null then
      raise exception 'A U12 Girls team already exists (%) -- review that team instead of creating another.',
        case when v_existing_girls_active then 'active' else 'folded' end
        using errcode = 'P0001';
    end if;

    v_girls_squad := nullif(coalesce(p_girls_squad_designation, ''), '');
    -- "Girls" always comes first ("Girls U12", never "U12 Girls") --
    -- matches this app's display-name philosophy: Girls is the one
    -- identity-distinguishing case and is always the lead word.
    v_girls_display_name := 'Girls ' || p.proposed_age_group || case when v_girls_squad is null then '' else ' ' || v_girls_squad end;
    v_girls_slug := trim(both '-' from regexp_replace(lower(v_girls_display_name), '[^a-z0-9]+', '-', 'g'));

    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
    values (r.club_id, t.rugby_code, 'youth', p.proposed_age_group, 'girls', v_girls_squad, v_girls_display_name, v_girls_slug, auth.uid(), auth.uid())
    returning id into v_new_girls_id;

    insert into public.audit_log (table_name, record_id, action, changed_by, after)
    values ('teams', v_new_girls_id, 'insert', auth.uid(),
      jsonb_build_object('display_name', v_girls_display_name, 'age_group', p.proposed_age_group, 'gender', 'girls',
        'event', 'mixed_boundary_girls_team_created', 'created_from_rollover_id', r.id, 'continuing_team_id', p.team_id));
  end if;

  update public.age_grade_rollover_team_proposals
  set decision = 'confirmed', decided_age_group = p.proposed_age_group, decided_by = auth.uid(), decided_at = now(),
      girls_team_created = p_create_girls_team, girls_team_id = v_new_girls_id
  where id = p_proposal_id;

  return query select p.team_id, v_new_girls_id;
end;
$$;

revoke execute on function public.confirm_mixed_boundary_rollover(uuid, boolean, text, text) from public;
grant execute on function public.confirm_mixed_boundary_rollover(uuid, boolean, text, text) to authenticated;
