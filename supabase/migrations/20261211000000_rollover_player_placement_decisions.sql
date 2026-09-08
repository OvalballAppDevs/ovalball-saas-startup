-- Deciding a player's next-season placement on the Season Handover board.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY REUSES
--
-- age_grade_rollover_player_proposals already records what Ovalball EXPECTS
-- for each player. It had no way to record what a club DECIDES. This adds that
-- -- and nothing else. No second placement system, no handover-specific
-- dispensation table, no parallel movement rules:
--
--   * the movement decision comes from internal.resolve_player_movement_eligibility
--   * dispensations are the existing player_team_dispensation domain
--   * teams offered are the club's real canonical operational teams
--
-- THE DISTINCTION THAT MATTERS
--
-- Changing a player's SQUAD LETTER at the same age grade is an operational
-- decision a club is entitled to make: U16 B -> U16, or U16 B -> U16 C. It is
-- not an age-grade dispensation and must not be made to feel like one.
--
-- Changing a player's AGE GRADE is different: U16 B -> U15, or U16 B -> U17.
-- That runs the canonical movement resolver, and its answer -- permitted,
-- team approval only, external approval required, not permitted -- decides
-- what happens next. An administrator cannot overrule it from the board.
--
-- WHY MEMBERSHIP IS NOT MOVED ON DECISION
--
-- Players progress with their team by construction: a membership points at a
-- stable team_id, so when U15 B becomes U16 B the player is in U16 B without
-- anything touching the membership. A placement decision only needs to move a
-- membership when the player is going somewhere OTHER than where their team is
-- going, and that is applied separately and explicitly, so a review decision
-- can be revised before it takes effect.

-- ============================================================
-- 1. Record the decision alongside the expectation.
-- ============================================================

alter table public.age_grade_rollover_player_proposals
  add column if not exists selected_team_id uuid references public.teams(id),
  add column if not exists selected_canonical_team_type_id uuid references public.canonical_team_types(id),
  add column if not exists selected_by uuid references auth.users(id),
  add column if not exists selected_at timestamptz,
  add column if not exists override_kind text,
  add column if not exists placement_applied_at timestamptz;

alter table public.age_grade_rollover_player_proposals
  drop constraint if exists rollover_player_proposal_override_kind_check;
alter table public.age_grade_rollover_player_proposals
  add constraint rollover_player_proposal_override_kind_check
  check (override_kind is null or override_kind in ('SAME_AGE_SQUAD', 'AGE_GRADE_CHANGE'));

comment on column public.age_grade_rollover_player_proposals.selected_team_id is
  'The team an authorised reviewer chose, when it differs from what Ovalball expected. Null means the normal placement stands.';
comment on column public.age_grade_rollover_player_proposals.override_kind is
  'SAME_AGE_SQUAD is an operational squad decision the club may make freely. AGE_GRADE_CHANGE goes through the canonical movement resolver and may require approval beyond the club.';

-- ============================================================
-- 2. The teams a reviewer may actually choose from.
-- ============================================================
--
-- Real canonical operational teams, this club, this code, active. No free
-- text, no invented identities.

create or replace function public.rollover_placement_options(p_proposal_id uuid)
returns table (team_id uuid, display_name text, age_group text, squad_designation text, is_normal boolean, is_selected boolean)
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
  select t.id, t.display_name, t.age_group, t.squad_designation,
         t.canonical_team_type_id is not distinct from p.normal_canonical_team_type_id,
         t.id is not distinct from coalesce(p.selected_team_id, p.proposed_team_id)
  from public.teams t
  where t.club_id = r.club_id
    and t.rugby_code = r.rugby_code
    and t.active
    and t.category = 'youth'
  order by t.age_group, coalesce(t.squad_designation, '');
end;
$function$;

-- ============================================================
-- 3. Making the decision.
-- ============================================================

create or replace function public.set_rollover_player_placement(p_proposal_id uuid, p_target_team_id uuid)
returns table (override_kind text, movement_requirement text, review_state text, reason text, dispensation_required boolean)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  v_target public.teams;
  v_dob date;
  v_normal_age text;
  v_move record;
  v_kind text;
  v_req text;
  v_review text;
  v_reason text;
  v_disp boolean := false;
  v_has_disp boolean;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide placements for this club.' using errcode = '42501';
  end if;
  if p.placement_applied_at is not null then
    raise exception 'This placement has already been applied and cannot be changed here.' using errcode = 'P0001';
  end if;

  select * into v_target from public.teams where id = p_target_team_id;
  if v_target.id is null or not v_target.active then
    raise exception 'That team is not an active team.' using errcode = '23514';
  end if;
  if v_target.club_id is distinct from r.club_id then
    raise exception 'A player can only be placed on a team at their own club.' using errcode = '23514';
  end if;
  if v_target.rugby_code is distinct from r.rugby_code then
    raise exception 'Union and League age grades are separate frameworks -- a player cannot be placed across codes here.' using errcode = '23514';
  end if;

  select date_of_birth into v_dob from public.players where id = p.player_id;
  select age_group into v_normal_age from public.canonical_team_types where id = p.normal_canonical_team_type_id;

  if v_normal_age is not null and v_target.age_group is not distinct from v_normal_age then
    -- SAME AGE GRADE, different squad. An ordinary club decision: the squad
    -- letter is an operational slot within one canonical identity, not a
    -- separate age grade, so no governing approval is implied.
    v_kind := 'SAME_AGE_SQUAD';
    v_req := null;
    v_review := 'READY';
    v_reason := format('Squad placement chosen by the club: %s. Same age grade as the normal placement, so this is an operational squad decision.', v_target.display_name);
  else
    -- DIFFERENT AGE GRADE. The canonical resolver decides, not the board.
    --
    -- The move being judged is "instead of the team this player would normally
    -- be in NEXT season, put them here" -- so the source is the normal
    -- next-season team, not the team they sit in today. Judging it from
    -- today's team asks the wrong question: a U15 B player whose normal next
    -- season is U16 looks like an ordinary same-age move into U15, when what
    -- is actually being decided is keeping a U16-age player down in U15.
    -- Where the club does not run the normal team there is nothing to compare
    -- against, so the current team is the honest fallback.
    v_kind := 'AGE_GRADE_CHANGE';
    select * into v_move from internal.resolve_player_movement_eligibility(
      r.rugby_code, current_date, v_dob,
      coalesce(p.proposed_team_id, p.current_team_id), p_target_team_id);
    v_req := v_move.requirement;

    if v_req = 'permitted' then
      v_review := 'READY';
      v_reason := coalesce(v_move.reason, 'This placement is permitted.');
    elsif v_req = 'team_approval_only' then
      v_review := 'READY';
      v_reason := coalesce(v_move.reason, 'This placement requires the appropriate team approval.');
    elsif v_req = 'external_approval_required' then
      v_disp := true;
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = p.player_id and d.target_team_id = p_target_team_id
          and d.season_id = r.to_season_id and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_disp;
      if v_has_disp then
        v_review := 'READY';
        v_reason := 'Governing-body approval for this placement is recorded for the target season.';
      else
        v_review := 'NEEDS_ATTENTION';
        v_reason := coalesce(v_move.reason, 'This placement requires governing-body approval.');
      end if;
    else
      v_review := 'BLOCKED';
      v_reason := coalesce(v_move.reason, 'This placement is not permitted under the current rules.');
    end if;
  end if;

  update public.age_grade_rollover_player_proposals
  set selected_team_id = p_target_team_id,
      selected_canonical_team_type_id = v_target.canonical_team_type_id,
      selected_by = auth.uid(),
      selected_at = now(),
      override_kind = case when p_target_team_id is not distinct from p.proposed_team_id then null else v_kind end,
      movement_requirement = v_req,
      review_state = v_review,
      reason = v_reason
  where id = p_proposal_id;

  -- Stable identifiers only. Never a team display string as authority.
  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('age_grade_rollover_player_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('selected_team_id', p.selected_team_id, 'proposed_team_id', p.proposed_team_id,
                       'review_state', p.review_state, 'movement_requirement', p.movement_requirement),
    jsonb_build_object('event', 'HANDOVER_PLACEMENT_DECIDED', 'rollover_id', r.id, 'player_id', p.player_id,
                       'target_season_id', r.to_season_id, 'selected_team_id', p_target_team_id,
                       'selected_canonical_team_type_id', v_target.canonical_team_type_id,
                       'normal_canonical_team_type_id', p.normal_canonical_team_type_id,
                       'override_kind', v_kind, 'movement_requirement', v_req,
                       'review_state', v_review, 'dispensation_required', v_disp));

  return query select v_kind, v_req, v_review, v_reason, v_disp;
end;
$function$;

-- ============================================================
-- 4. Applying a placement that actually moves someone.
-- ============================================================

create or replace function public.apply_rollover_player_placement(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  v_target uuid;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to apply placements for this club.' using errcode = '42501';
  end if;
  if p.placement_applied_at is not null then
    raise exception 'This placement has already been applied.' using errcode = 'P0001';
  end if;

  -- The gate. An unresolved review is never quietly applied, never dropped,
  -- and never turned back into the normal placement.
  if p.review_state <> 'READY' then
    raise exception 'This placement still needs attention and cannot be applied yet: %', coalesce(p.reason, 'unresolved review')
      using errcode = 'P0001';
  end if;

  v_target := coalesce(p.selected_team_id, p.proposed_team_id);
  if v_target is null then
    raise exception 'No target team has been chosen for this player.' using errcode = '23514';
  end if;

  -- Players travel with their team by construction, so a placement that lands
  -- where the player already is needs no membership change at all.
  if v_target is distinct from p.current_team_id then
    update public.player_team_memberships
    set status = 'ended', ended_at = now(), updated_by = auth.uid()
    where player_id = p.player_id and team_id = p.current_team_id and status = 'active';

    insert into public.player_team_memberships (player_id, team_id, status, created_by)
    values (p.player_id, v_target, 'active', auth.uid())
    on conflict do nothing;
  end if;

  update public.age_grade_rollover_player_proposals
  set placement_applied_at = now() where id = p_proposal_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollover_player_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('event', 'HANDOVER_PLACEMENT_APPLIED', 'rollover_id', r.id, 'player_id', p.player_id,
                       'from_team_id', p.current_team_id, 'to_team_id', v_target));
end;
$function$;

-- ============================================================
-- 5. What the Apply area needs to know.
-- ============================================================

create or replace function public.rollover_readiness(p_rollover_id uuid)
returns table (
  teams_total integer, teams_decided integer, teams_progressing integer,
  teams_folding integer, teams_graduating integer, teams_pending integer,
  new_intake_teams integer,
  players_total integer, players_ready integer, players_needs_attention integer,
  players_blocked integer, players_club_holding integer, players_missing_dob integer,
  dispensations_pending integer,
  is_ready boolean
)
language sql stable security definer set search_path to 'public'
as $function$
  select
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id)::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision <> 'pending')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'confirmed')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'folded')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'graduated')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'pending')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and intake_team_created)::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id)::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'READY')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'NEEDS_ATTENTION')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'BLOCKED')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and allocation_status = 'CLUB_HOLDING')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and allocation_status = 'DOB_REQUIRED')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and movement_requirement = 'external_approval_required' and review_state <> 'READY')::int,
    (select not exists (
       select 1 from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'pending'
       union all
       select 1 from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state <> 'READY'
     ));
$function$;

comment on function public.rollover_readiness(uuid) is
  'Counts the Apply area needs, and whether anything is still unresolved. is_ready is false while any team decision is pending or any player review is unresolved.';

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='set_rollover_player_placement') then
    raise exception 'The placement decision function was not created.';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='set_rollover_player_placement')
     !~ 'resolve_player_movement_eligibility' then
    raise exception 'A different-age placement does not consult the canonical movement resolver.';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='apply_rollover_player_placement')
     !~ 'review_state <> ''READY''' then
    raise exception 'The placement apply path has no gate on an unresolved review.';
  end if;
end $$;
