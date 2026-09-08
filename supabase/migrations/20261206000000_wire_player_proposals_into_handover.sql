-- The per-player handover check actually runs.
--
-- WHAT WAS WRONG
--
-- generate_rollover_player_proposals -- the function that resolves every
-- player's regulatory age for the target season, works out the team that age
-- points at, consults an existing dispensation, and flags anyone who cannot
-- simply roll forward -- had NO CALLER. Not in the application, not in the
-- automatic transition processor, not in any other migration. It was reachable
-- only by calling it by hand.
--
-- So the per-player layer existed and never ran. Preparing a handover produced
-- team proposals and nothing else, and a club reviewing its handover saw which
-- TEAMS would move but nothing about which PLAYERS could not move with them --
-- the player with no recorded date of birth, the player whose next age grade
-- is a team this club does not run, the player whose move needs approval
-- beyond the club. Every one of those was computed by code that was never
-- invoked.
--
-- Found by asserting that a completed automatic handover had produced player
-- proposals, and getting none.
--
-- HOW IT IS WIRED
--
-- Into internal.generate_rollover_proposal_core, after the team loop, so BOTH
-- entry points are covered by one change: the manual path (the public wrapper
-- delegates to core) and the automatic path (process_due_season_transitions
-- calls core directly). Player proposals depend on the team proposals for
-- proposed_age_group and requires_manual_choice, so they are generated after
-- them, never before.
--
-- The generator carried its own authorisation check, which the automatic path
-- would fail -- it runs unattended with no authenticated user. It is split the
-- same way the rest of the handover already is: an internal core that does the
-- work, and a public wrapper that authorises and delegates. The public
-- function keeps its signature and its permission check, so nothing that could
-- call it before loses anything.
--
-- Re-running remains safe: the generator inserts on conflict do nothing
-- against (rollover_id, player_id, current_team_id), so preparing a handover
-- again tops up players who have joined since and leaves existing rows alone,
-- matching how team proposals already behave.

-- ============================================================
-- 1. The work, without the authorisation check.
-- ============================================================

create or replace function internal.generate_rollover_player_proposals_core(p_rollover_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  m record;
  v_reg record;
  v_norm record;
  v_move record;
  v_disp record;
  v_proposed_team uuid;
  v_proposed_type uuid;
  v_review text;
  v_reason text;
  v_disp_outcome text;
  v_move_req text;
  v_count integer := 0;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then raise exception 'Rollover not found.'; end if;

  for m in
    select ptm.id as membership_id, ptm.player_id, ptm.team_id,
           p.date_of_birth, t.gender, t.rugby_code,
           tp.proposed_age_group, tp.proposed_to_canonical_team_type_id, tp.requires_manual_choice
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    join public.players p on p.id = ptm.player_id
    left join public.age_grade_rollover_team_proposals tp
      on tp.rollover_id = r.id and tp.team_id = ptm.team_id
    where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
      and ptm.status = 'active' and t.category = 'youth'
  loop
    v_proposed_team := null; v_proposed_type := m.proposed_to_canonical_team_type_id;
    v_review := 'READY'; v_reason := null; v_disp_outcome := null; v_move_req := null;

    -- 1. Regulatory age for the TARGET season. DOB is read here and nowhere
    --    else; it is not carried into the row that gets written.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);

    -- 2. The normal operational identity for that age.
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.gender);

    -- 3. Does the club already run the team that identity points at?
    if v_norm.canonical_team_type_id is not null then
      select t2.id into v_proposed_team
      from public.teams t2
      where t2.club_id = r.club_id and t2.rugby_code = r.rugby_code
        and t2.canonical_team_type_id = v_norm.canonical_team_type_id and t2.active
      order by t2.squad_designation nulls first
      limit 1;
    end if;

    -- 4. An existing dispensation is consulted, never renewed. The table is
    --    season-scoped, so one written for this season does not carry.
    select * into v_disp
    from public.player_team_dispensation d
    where d.player_id = m.player_id and d.status = 'approved'
      and d.season_id is distinct from r.to_season_id
    order by d.created_at desc
    limit 1;

    if v_disp.id is not null then
      if v_norm.allocation_status = 'NORMAL_PLACEMENT'
         and v_norm.canonical_team_type_id is not null
         and v_proposed_team is not null then
        v_disp_outcome := 'NO_LONGER_REQUIRED';
      else
        v_disp_outcome := 'EXPIRES_AT_SEASON_BOUNDARY';
      end if;
    end if;

    -- 5. Movement decision, where both ends are known.
    if v_proposed_team is not null and v_proposed_team is distinct from m.team_id then
      select * into v_move from internal.resolve_player_movement_eligibility(
        r.rugby_code, current_date, m.date_of_birth, m.team_id, v_proposed_team);
      v_move_req := v_move.requirement;
    end if;

    -- 6. Classify.
    if v_norm.allocation_status = 'DOB_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'This player has no recorded date of birth, so their age grade for the target season cannot be established. It must never be inferred from the team they currently play for. Obtain the date of birth through the normal protected profile process.';
    elsif v_norm.allocation_status = 'NEEDS_ATTENTION' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := v_norm.reason;
    elsif v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('The normal team for this player next season is %s, but this club does not currently run it. Activate that team, or place the player through the ordinary workflow.',
                         coalesce(v_norm.canonical_label, 'unresolved'));
    elsif v_move_req in ('not_permitted','external_approval_required') then
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_move.reason, 'This placement needs approval beyond the club.');
    elsif m.requires_manual_choice then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'The team itself has no automatic successor for the target season, so this player''s placement follows that review rather than rolling forward on its own.';
    else
      v_review := 'READY';
    end if;

    insert into public.age_grade_rollover_player_proposals (
      rollover_id, player_id, current_team_id, current_membership_id,
      proposed_team_id, proposed_canonical_team_type_id,
      regulatory_age_label, regulatory_status, normal_canonical_team_type_id,
      allocation_status, movement_requirement, dispensation_id, dispensation_outcome,
      review_state, reason
    ) values (
      r.id, m.player_id, m.team_id, m.membership_id,
      v_proposed_team, coalesce(v_proposed_type, v_norm.canonical_team_type_id),
      v_reg.regulatory_age_label, v_reg.status, v_norm.canonical_team_type_id,
      v_norm.allocation_status, v_move_req, v_disp.id, v_disp_outcome,
      v_review, v_reason
    )
    on conflict (rollover_id, player_id, current_team_id) do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$function$;

-- ============================================================
-- 2. The public entry point: authorise, then delegate.
-- ============================================================

create or replace function public.generate_rollover_player_proposals(p_rollover_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r public.age_grade_rollovers;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then raise exception 'Rollover not found.'; end if;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to generate player proposals for this club.' using errcode = '42501';
  end if;

  return internal.generate_rollover_player_proposals_core(p_rollover_id);
end;
$function$;

-- ============================================================
-- 3. Run it as part of preparing a handover.
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
  -- parallel one.
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

    -- U6 is offered, never assumed: progressing the cohort and running U6 as a
    -- standing intake group are both legitimate, and only the club knows which
    -- it does.
    v_requires_manual := v_next_age is null or v_is_mixed_boundary or t.age_group = 'U6';

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

  -- The per-player check. Runs after the team proposals because it reads
  -- proposed_age_group and requires_manual_choice from them. Before this, the
  -- function below had no caller at all and the whole player layer never ran.
  perform internal.generate_rollover_player_proposals_core(v_rollover_id);

  return v_rollover_id;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'generate_rollover_proposal_core';
  if v_def !~ 'generate_rollover_player_proposals_core' then
    raise exception 'Preparing a handover still does not generate player proposals.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_rollover_player_proposals';
  if v_def !~ 'Not authorized' then
    raise exception 'The public player-proposal entry point lost its permission check.';
  end if;
end $$;
