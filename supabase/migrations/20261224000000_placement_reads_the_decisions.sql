-- Where a player goes is decided by the club's decisions, not by a projection.
--
-- WHAT STAGING BROKE, AND WHY IT WAS ALWAYS FRAGILE
--
-- resolve_normal_placement_team judged candidate teams through
-- get_team_identity_for_season, which returns a stored season identity if
-- there is one and otherwise projects the team's age forward by date
-- arithmetic. Under the old immediate model that worked by accident: Confirm
-- wrote the stored identity as part of mutating the team, so by the time
-- anything asked, the answer was already recorded.
--
-- Staged, nothing is recorded until Apply, so every lookup fell through to the
-- projection -- and a projection cannot know that this Mixed U11 was decided
-- to become BOYS U12, or that this U16 was ADJUSTED to U15 rather than rolled
-- to U17. The child in the smoke test was told his club did not run a U12,
-- while the club's own decision said his team was about to become one.
--
-- THE FIX
--
-- internal.rollover_team_target_identity already answers "what will this team
-- BE once this handover applies", reading the decision itself. Placement now
-- asks that, the same resolver collision detection and Apply use. A date
-- projection is still right for teams outside the handover and is still what
-- Calendar and Match Centre use; it is simply not the authority on a decision
-- somebody has already made.

create or replace function internal.resolve_normal_placement_team(
  p_rollover_id uuid, p_current_team_id uuid, p_normal_type_id uuid
) returns uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v_cur public.teams;
  v_cur_gender text;
  v_normal_gender text;
  v_self record;
  v_team uuid;
begin
  if p_normal_type_id is null then return null; end if;
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  select * into v_cur from public.teams where id = p_current_team_id;

  select ctt.gender into v_cur_gender
  from public.canonical_team_types ctt where ctt.id = v_cur.canonical_team_type_id;
  select ctt.gender into v_normal_gender
  from public.canonical_team_types ctt where ctt.id = p_normal_type_id;

  -- 1. The player's own squad, where it is genuinely carrying them forward --
  --    not a move at all, just the team changing name around them. Skipped at
  --    a Mixed to Boys/Girls split, where the team has one successor and its
  --    children have two.
  if v_cur.id is not null
     and not (v_cur_gender = 'mixed' and v_normal_gender is distinct from 'mixed') then
    select * into v_self from internal.rollover_team_target_identity(p_rollover_id, p_current_team_id);
    if coalesce(v_self.continues, false) and v_self.canonical_team_type_id = p_normal_type_id then
      return v_cur.id;
    end if;
  end if;

  -- 2/3. Every other candidate is judged by the identity the club has decided
  --      it will hold next season. Same squad letter first, then the primary.
  select t.id into v_team
  from public.teams t
  cross join lateral internal.rollover_team_target_identity(p_rollover_id, t.id) i
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and i.continues and i.canonical_team_type_id = p_normal_type_id
  order by (t.squad_designation is not distinct from v_cur.squad_designation) desc,
           t.squad_designation nulls first
  limit 1;

  return v_team;
end;
$function$;

comment on function internal.resolve_normal_placement_team(uuid, uuid, uuid) is
  'The operational team a player normally lands in, judged by what each team has been DECIDED to become next season. A date projection cannot know about a decision, and a stored season identity does not exist until Apply.';

-- ---------------------------------------------------------------------------
-- The placement chooser offers planned teams too
-- ---------------------------------------------------------------------------
--
-- A club that has decided to run a Girls U12 next season should be able to put
-- a girl in it during review, even though it will not exist until Apply. It is
-- offered as what it is -- planned -- and never as though it were already there.

drop function if exists public.rollover_placement_options(uuid);

create or replace function public.rollover_placement_options(p_proposal_id uuid)
returns table(
  team_id uuid, planned_id uuid, display_name text, age_group text,
  squad_designation text, is_normal boolean, is_selected boolean, is_planned boolean
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare p public.age_grade_rollover_player_proposals; r public.age_grade_rollovers;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id;
  if not found then return; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to view placement options for this club.' using errcode = '42501';
  end if;

  return query
  select t.id, null::uuid,
         coalesce(i.label, t.display_name),
         coalesce(i.age_group, t.age_group),
         coalesce(i.squad_designation, t.squad_designation),
         i.canonical_team_type_id is not distinct from p.normal_canonical_team_type_id,
         t.id is not distinct from coalesce(p.selected_team_id, p.proposed_team_id),
         false
  from public.teams t
  cross join lateral internal.rollover_team_target_identity(p.rollover_id, t.id) i
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code
    and t.active and t.category = 'youth' and i.continues

  union all

  select null::uuid, pt.id,
         ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end,
         ctt.age_group, pt.squad_designation,
         pt.canonical_team_type_id is not distinct from p.normal_canonical_team_type_id,
         pt.id is not distinct from p.planned_team_id,
         true
  from public.age_grade_rollover_planned_teams pt
  join public.canonical_team_types ctt on ctt.id = pt.canonical_team_type_id
  where pt.rollover_id = p.rollover_id and pt.applied_at is null

  order by 4, 5 nulls first;
end;
$function$;

create or replace function public.set_rollover_player_planned_placement(
  p_proposal_id uuid, p_planned_id uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  pt public.age_grade_rollover_planned_teams;
  v_label text;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide placements for this club.' using errcode = '42501';
  end if;
  if p.placement_applied_at is not null or r.applied_at is not null then
    raise exception 'This placement has already been applied and cannot be changed here.' using errcode = 'P0001';
  end if;

  select * into pt from public.age_grade_rollover_planned_teams where id = p_planned_id;
  if pt.id is null or pt.rollover_id is distinct from p.rollover_id then
    raise exception 'That team is not planned as part of this handover.' using errcode = '23514';
  end if;

  select ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end
  into v_label from public.canonical_team_types ctt where ctt.id = pt.canonical_team_type_id;

  -- A planned team is only ever offered at an identity the club has decided to
  -- run, so the age-grade question is the same one a live team would face.
  if pt.canonical_team_type_id is distinct from p.normal_canonical_team_type_id then
    raise exception 'A planned team can only be chosen where it is this player''s normal age grade. Choose an existing team, or plan the right one.'
      using errcode = '23514';
  end if;

  update public.age_grade_rollover_player_proposals
  set planned_team_id = p_planned_id, selected_team_id = null,
      selected_canonical_team_type_id = pt.canonical_team_type_id,
      selected_by = auth.uid(), selected_at = now(), override_kind = null,
      movement_requirement = null, review_state = 'READY',
      reason = format('%s will be created when this handover is applied, and this player joins it then.', v_label)
  where id = p_proposal_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollover_player_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('event', 'HANDOVER_PLACEMENT_DECIDED_PLANNED', 'rollover_id', r.id,
                       'player_id', p.player_id, 'planned_team_id', p_planned_id,
                       'target_season_id', r.to_season_id));

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = r.id;
end;
$function$;

grant execute on function public.set_rollover_player_planned_placement(uuid, uuid) to authenticated;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'resolve_normal_placement_team')
     !~ 'rollover_team_target_identity' then
    raise exception 'Placement still ignores the club''s own handover decisions.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A human decision survives a refresh, however it was expressed
-- ---------------------------------------------------------------------------
--
-- The refresh recomputes undecided placements whenever a team decision
-- changes. It recognised a decision by selected_team_id, which misses a
-- reviewer who chose a PLANNED team -- there is no team id to record yet, so
-- their choice was deleted and silently recalculated. selected_at is the
-- honest marker: it is set when a person decided, and never by generation.

create or replace function internal.refresh_rollover_player_proposals(p_rollover_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from public.age_grade_rollover_player_proposals
  where rollover_id = p_rollover_id
    and selected_team_id is null
    and selected_at is null
    and placement_applied_at is null;

  perform internal.generate_rollover_player_proposals_core(p_rollover_id);
end;
$function$;

comment on function internal.refresh_rollover_player_proposals(uuid) is
  'Recomputes only the placements nobody has decided. A reviewer''s choice is never recalculated away -- including a choice of a team that does not exist yet.';
