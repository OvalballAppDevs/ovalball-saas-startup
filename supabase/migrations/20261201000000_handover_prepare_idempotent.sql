-- One season handover per club per target season.
--
-- THE DEFECT THIS CLOSES
--
-- generate_rollover_proposal inserted a NEW age_grade_rollovers row on every
-- call, with nothing -- no lookup, no constraint -- stopping a club from
-- holding several concurrent handovers to the SAME target season. The
-- `on conflict (rollover_id, team_id) do nothing` guard inside it only ever
-- protected against duplicate proposals WITHIN one rollover, which is the
-- wrong scope: it cannot see a second rollover at all.
--
-- Demonstrated live against the real RPCs, not reasoned about:
--
--   START            team age = U16
--   AFTER rollover 1 team age = U17
--   NEW rollover proposes U17 -> U18
--   AFTER rollover 2 team age = U18
--   rollovers for this club+season = 3
--
-- A club admin who runs the season handover twice for 27/28 advances every
-- youth team TWO age grades. U16s become U18s. That is a safeguarding-adjacent
-- outcome, not a cosmetic one: it puts children in the wrong age band, and it
-- happens through the ordinary UI with no error shown.
--
-- It also splits the record. team_season_identity is written once, on the
-- first apply, so the Handover Register showed U17 for the target season while
-- teams.age_group said U18 -- the register a club reads to check what happened
-- disagreed with what actually happened.
--
-- The per-proposal idempotency already proven (a repeated confirm of the SAME
-- proposal is rejected with 'This proposal has already been decided') is real
-- but does not help here, because the second apply targets a DIFFERENT
-- proposal row belonging to a different rollover.
--
-- WHAT CHANGES
--
-- A handover to a given season is one event, so it gets one row. Re-running
-- prepare now returns the SAME rollover, topping up proposals for teams
-- created since. Because the existing per-team `do nothing` leaves decided
-- proposals untouched, that also makes prepare RESUMABLE: a half-applied
-- handover can be re-prepared and picked up where it stopped, rather than
-- restarted into a second parallel handover.
--
-- The uniqueness is enforced by a database constraint, not only by the
-- function body, so a second code path (or a direct insert) cannot reintroduce
-- the split.
--
-- The wrapper also stops carrying its own copy of the proposal logic and
-- delegates to internal.generate_rollover_proposal_core. The two copies had
-- already drifted apart once, which is exactly how the code-blind successor
-- survived in the automatic path after the manual path was fixed.

-- ============================================================
-- 1. Merge any duplicate rollovers that already exist.
-- ============================================================
--
-- Oldest row per (club, code, target season) wins. Children move across where
-- the destination is free; where both sides hold a proposal for the same team,
-- a DECIDED decision is promoted onto the keeper so an applied handover is
-- never downgraded back to pending by the merge.

do $$
declare d record; k uuid;
begin
  for d in
    select r.id, r.club_id, r.rugby_code, r.to_season_id,
           first_value(r.id) over (
             partition by r.club_id, r.rugby_code, r.to_season_id
             order by r.created_at, r.id
           ) as keeper_id
    from public.age_grade_rollovers r
  loop
    k := d.keeper_id;
    continue when d.id = k;

    -- Promote a decision the keeper does not already have.
    update public.age_grade_rollover_team_proposals keep
    set decision = dup.decision,
        decided_at = dup.decided_at,
        decided_by = dup.decided_by
    from public.age_grade_rollover_team_proposals dup
    where dup.rollover_id = d.id
      and keep.rollover_id = k
      and keep.team_id = dup.team_id
      and keep.decision = 'pending'
      and dup.decision <> 'pending';

    -- Move rows the keeper has no counterpart for.
    update public.age_grade_rollover_team_proposals dup
    set rollover_id = k
    where dup.rollover_id = d.id
      and not exists (
        select 1 from public.age_grade_rollover_team_proposals keep
        where keep.rollover_id = k and keep.team_id = dup.team_id
      );

    update public.age_grade_rollover_player_proposals dup
    set rollover_id = k
    where dup.rollover_id = d.id
      and not exists (
        select 1 from public.age_grade_rollover_player_proposals keep
        where keep.rollover_id = k
          and keep.player_id = dup.player_id
          and keep.current_team_id is not distinct from dup.current_team_id
      );

    update public.age_grade_rollover_group_flags dup
    set rollover_id = k
    where dup.rollover_id = d.id
      and not exists (
        select 1 from public.age_grade_rollover_group_flags keep
        where keep.rollover_id = k and keep.scheduling_group_id = dup.scheduling_group_id
      );

    update public.season_transitions set rollover_id = k where rollover_id = d.id;

    delete from public.age_grade_rollovers where id = d.id;  -- leftovers cascade
  end loop;
end $$;

-- ============================================================
-- 2. Make the split impossible at the database level.
-- ============================================================

create unique index if not exists age_grade_rollovers_one_per_club_season_idx
  on public.age_grade_rollovers (club_id, rugby_code, to_season_id);

comment on index public.age_grade_rollovers_one_per_club_season_idx is
  'A handover to a given season is a single event. Without this, running prepare twice created parallel rollovers whose applies each advanced every team one grade, turning U16s into U18s in one season.';

-- ============================================================
-- 3. Prepare becomes reuse-or-create.
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

  -- Reuse the club's existing handover to this season rather than opening a
  -- parallel one. `do update` (not `do nothing`) so the row is returned even
  -- when it already exists.
  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, p_created_by)
  on conflict (club_id, rugby_code, to_season_id)
    do update set club_id = excluded.club_id
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'
  loop
    -- Code-aware: union girls step by dual age band, union stops at U18,
    -- league continues to U19.
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, p_rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed'
      and v_next_age is not null
      and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');
    v_requires_manual := v_next_age is null or v_is_mixed_boundary;

    -- A team that already has a proposal in this handover keeps it, decided or
    -- not. That is what makes a re-prepare resume rather than restart.
    insert into public.age_grade_rollover_team_proposals
      (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (v_rollover_id, t.id, t.age_group, v_next_age, v_requires_manual, v_is_mixed_boundary)
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg
    where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade(mt.age_group)) into v_would_be_ages
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

  return v_rollover_id;
end;
$function$;

-- The wrapper is now authorisation plus delegation. One copy of the logic.
create or replace function public.generate_rollover_proposal(
  p_club_id uuid, p_rugby_code text, p_to_season_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not (internal.can_manage_club_fixtures(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  return internal.generate_rollover_proposal_core(p_club_id, p_rugby_code, p_to_season_id, auth.uid());
end;
$function$;

comment on function public.generate_rollover_proposal(uuid, text, uuid) is
  'Prepares (or resumes) the club''s single season handover to the target season. Idempotent: repeat calls return the same rollover, top up proposals for newly created teams, and leave already-decided proposals alone.';

-- ============================================================
-- 4. Prove it, rather than assert it.
-- ============================================================

do $$
declare v_dupes text;
begin
  select string_agg(club_id::text || '/' || to_season_id::text, ', ') into v_dupes
  from (
    select club_id, rugby_code, to_season_id
    from public.age_grade_rollovers
    group by club_id, rugby_code, to_season_id
    having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'Duplicate rollovers survived the merge: %', v_dupes;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'age_grade_rollovers_one_per_club_season_idx'
  ) then
    raise exception 'The one-handover-per-season index was not created.';
  end if;

  -- The wrapper must no longer carry its own copy of the progression logic.
  if pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'generate_rollover_proposal')
     ) like '%next_age_grade_for%' then
    raise exception 'public.generate_rollover_proposal still duplicates the proposal logic instead of delegating to core.';
  end if;
end $$;
