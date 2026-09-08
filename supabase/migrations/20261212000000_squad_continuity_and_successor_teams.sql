-- Players travel with their squad, and a missing successor squad can be created.
--
-- THREE CONNECTED CORRECTIONS
--
-- 1. NORMAL PLACEMENT LOST THE SQUAD
--
-- A player in U15 B whose regulatory age next season is U16 was given a normal
-- placement of U16 -- the club's PRIMARY U16 team -- because the lookup took
-- the first team at the canonical type with `order by squad_designation nulls
-- first`. That collapses the two things the architecture deliberately keeps
-- apart: U16 is the player's REGULATORY AGE IDENTITY; U16 B is their
-- OPERATIONAL SQUAD PLACEMENT.
--
-- It is also just wrong about what happens. The U15 B team does not disappear
-- at handover -- it becomes U16 B, keeping its stable team_id. The player's
-- membership points at that id, so they are in U16 B whatever any proposal
-- says. Telling the club "normal placement: U16" described a move that was
-- not going to happen, to a team the player was not going to join.
--
-- Normal placement now follows the squad: if the player's own team is
-- progressing to the canonical identity their age calls for, that team IS the
-- normal placement. Failing that, a team at the right identity carrying the
-- same squad letter. Only then the primary.
--
-- 2. A MISSING SUCCESSOR SQUAD WAS A DEAD END
--
-- When no team exists at the player's normal identity, the proposal said
-- "Not available" and stopped. But the club can simply run that squad -- the
-- same way the handover already provisions the new U6 intake team. So the gap
-- becomes an offered action rather than a wall.
--
-- It is OFFERED, never automatic. The U6 intake is deterministic product rule;
-- this is not. A club that has just folded U15 B has said something, and
-- silently recreating it as U16 B would overrule them.
--
-- STAFF TRAVEL WITH THE TEAM. When a team progresses, its team_permissions
-- rows need no attention: the team_id is stable, so the coaches and managers
-- are already there. It is only a NEWLY CREATED team that would otherwise
-- start with nobody, so provisioning copies the source squad's staff across.
-- A cohort's coaches are attached to that cohort, not to an age label.
--
-- 3. FOLDING A SQUAD LEFT ITS PLAYERS UNTOUCHED
--
-- Player proposals were generated once, at prepare, and never revisited. Fold
-- U15 B afterwards and its players still read "Ready -> U16 B", pointing at a
-- decision the club had just reversed. Worse, the generator only looked at
-- ACTIVE teams, so regenerating would have dropped those players from the
-- board entirely -- their placement work would have become invisible rather
-- than wrong.
--
-- Team decisions now refresh the player proposals they affect, and the
-- generator includes players whose team has been folded, so folding a squad
-- visibly creates the player work it really creates. Decisions a human has
-- already made are never recalculated away.

-- ============================================================
-- 1. Where a player's squad is actually going.
-- ============================================================

create or replace function internal.resolve_normal_placement_team(
  p_rollover_id uuid, p_current_team_id uuid, p_normal_type_id uuid
) returns uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v_cur public.teams;
  v_proposed_age text;
  v_becomes uuid;
  v_team uuid;
begin
  if p_normal_type_id is null then return null; end if;
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  select * into v_cur from public.teams where id = p_current_team_id;

  -- 1. The player's own squad, if it is heading for the identity their age
  --    calls for. The team keeps its id through the handover, so this is not
  --    a move at all -- it is the player staying exactly where they are while
  --    the team around them changes name.
  if v_cur.id is not null then
    select tp.proposed_age_group into v_proposed_age
    from public.age_grade_rollover_team_proposals tp
    where tp.rollover_id = p_rollover_id and tp.team_id = p_current_team_id
      and tp.decision in ('pending', 'confirmed');
    if v_proposed_age is not null then
      v_becomes := internal.resolve_canonical_team_type(
        v_cur.category, v_proposed_age, v_cur.gender, v_cur.squad_designation);
      if v_becomes = p_normal_type_id then
        return v_cur.id;
      end if;
    end if;
  end if;

  -- 2. A team already at that identity carrying the same squad letter.
  select t.id into v_team
  from public.teams t
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and t.canonical_team_type_id = p_normal_type_id
    and t.squad_designation is not distinct from v_cur.squad_designation
  limit 1;
  if v_team is not null then return v_team; end if;

  -- 3. The primary at that identity.
  select t.id into v_team
  from public.teams t
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and t.canonical_team_type_id = p_normal_type_id
  order by t.squad_designation nulls first
  limit 1;
  return v_team;
end;
$function$;

comment on function internal.resolve_normal_placement_team(uuid, uuid, uuid) is
  'The operational team a player normally lands in: their own squad where it is progressing to the right identity, else the same squad letter, else the primary. Regulatory age says WHICH identity; this says WHICH TEAM.';

-- ============================================================
-- 2. Generating proposals, including for folded squads.
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
           p.date_of_birth, t.gender, t.rugby_code, t.active as team_active,
           t.display_name as team_name,
           tp.proposed_age_group, tp.proposed_to_canonical_team_type_id,
           tp.requires_manual_choice, tp.decision as team_decision
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    join public.players p on p.id = ptm.player_id
    left join public.age_grade_rollover_team_proposals tp
      on tp.rollover_id = r.id and tp.team_id = ptm.team_id
    where t.club_id = r.club_id and t.rugby_code = r.rugby_code
      and ptm.status = 'active' and t.category = 'youth'
      -- A folded squad's players still hold active memberships, and their
      -- placement is now the club's most urgent work. Excluding inactive teams
      -- made that work disappear instead of surfacing it.
      and (t.active or tp.decision = 'folded')
  loop
    v_proposed_team := null; v_proposed_type := m.proposed_to_canonical_team_type_id;
    v_review := 'READY'; v_reason := null; v_disp_outcome := null; v_move_req := null;

    -- DOB is read here and nowhere else; it is not carried into the row.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.gender);

    -- The squad-aware answer: which TEAM, not just which identity.
    v_proposed_team := internal.resolve_normal_placement_team(
      r.id, m.team_id, v_norm.canonical_team_type_id);

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

    if v_proposed_team is not null and v_proposed_team is distinct from m.team_id then
      select * into v_move from internal.resolve_player_movement_eligibility(
        r.rugby_code, current_date, m.date_of_birth, m.team_id, v_proposed_team);
      v_move_req := v_move.requirement;
    end if;

    if v_norm.allocation_status = 'DOB_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'This player has no recorded date of birth, so their age grade for the target season cannot be established. It must never be inferred from the team they currently play for. Obtain the date of birth through the normal protected profile process.';
    elsif m.team_decision = 'folded' then
      -- Checked before the ordinary branches: the club has just decided this
      -- squad does not continue, so wherever the player was going, that
      -- decision is now theirs to make again.
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('%s is not continuing next season, so this player needs a new place. Their normal age grade for the target season is %s.',
                         m.team_name, coalesce(v_norm.canonical_label, v_reg.regulatory_age_label, 'unresolved'));
    elsif v_norm.allocation_status = 'CLUB_HOLDING' then
      v_review := 'READY';
      v_reason := v_norm.reason;
    elsif v_norm.allocation_status = 'NEEDS_ATTENTION' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := v_norm.reason;
    elsif v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('This club does not currently run %s, which is where this player would normally go next season. The club can add that team, or place the player somewhere else.',
                         coalesce(v_norm.canonical_label, 'that team'));
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
-- 3. Keeping proposals honest after a team decision.
-- ============================================================

create or replace function internal.refresh_rollover_player_proposals(p_rollover_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- Only what nobody has decided. A reviewer's chosen placement, and anything
  -- already applied, is never recalculated away underneath them.
  delete from public.age_grade_rollover_player_proposals
  where rollover_id = p_rollover_id
    and selected_team_id is null
    and placement_applied_at is null;

  perform internal.generate_rollover_player_proposals_core(p_rollover_id);
end;
$function$;

comment on function internal.refresh_rollover_player_proposals(uuid) is
  'Recomputes undecided player proposals after a team decision changes what is true. Decided and applied placements are left alone.';

-- ============================================================
-- 4. Adding the squad a player needs, with its staff.
-- ============================================================

create or replace function public.provision_missing_placement_team(p_proposal_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  v_cur public.teams;
  v_type public.canonical_team_types;
  v_squad text;
  v_new_id uuid;
  v_label text;
  v_staff integer := 0;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;

  -- Creating a team is a club-structural act, held to the same authority as
  -- creating one anywhere else -- not merely "can manage fixtures".
  if not (internal.is_club_admin(r.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may add a team.' using errcode = '42501';
  end if;

  if p.normal_canonical_team_type_id is null then
    raise exception 'This player has no normal age grade for the target season, so there is no team to add. Resolve their age grade first.'
      using errcode = 'P0001';
  end if;
  if p.proposed_team_id is not null then
    raise exception 'This player already has a normal team to go to.' using errcode = 'P0001';
  end if;

  select * into v_type from public.canonical_team_types where id = p.normal_canonical_team_type_id;
  select * into v_cur from public.teams where id = p.current_team_id;

  -- The squad letter travels with the player where it can. A B squad's players
  -- landing in a newly created B squad keeps the cohort together; but a B
  -- squad cannot exist without its primary, so fall back to the primary when
  -- the club has none at that level.
  v_squad := v_cur.squad_designation;
  if v_squad is not null and not exists (
    select 1 from public.teams t
    where t.club_id = r.club_id and t.canonical_team_type_id = v_type.id
      and t.squad_designation is null and t.active
  ) then
    v_squad := null;
  end if;

  v_label := v_type.label || case when v_squad is null then '' else ' ' || v_squad end;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation,
                            display_name, slug, created_by, updated_by)
  values (r.club_id, r.rugby_code, v_type.category, v_type.age_group, v_type.gender, v_squad,
          v_label, trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 8),
          auth.uid(), auth.uid())
  returning id into v_new_id;

  -- Staff follow the cohort. A progressing team keeps its own team_id and so
  -- keeps its staff automatically; a newly created one would start with
  -- nobody, so the source squad's coaches and managers come across.
  insert into public.team_permissions (membership_id, team_id, permission, assigned_group_id, created_by)
  select tp.membership_id, v_new_id, tp.permission, tp.assigned_group_id, auth.uid()
  from public.team_permissions tp
  where tp.team_id = p.current_team_id
  on conflict (membership_id, team_id) do nothing;
  get diagnostics v_staff = row_count;

  if r.to_season_id is not null then
    insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
    select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
    from public.teams where id = v_new_id
    on conflict (team_id, season_id) do nothing;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('event', 'SUCCESSOR_TEAM_CREATED_AT_HANDOVER', 'rollover_id', r.id,
                       'from_team_id', p.current_team_id, 'player_proposal_id', p_proposal_id,
                       'canonical_team_type_id', v_type.id, 'staff_carried_over', v_staff));

  -- Every player who was waiting on this team now has somewhere to go.
  perform internal.refresh_rollover_player_proposals(r.id);

  return v_new_id;
end;
$function$;

comment on function public.provision_missing_placement_team(uuid) is
  'Adds the operational team a player normally belongs in when the club does not run it, carrying the source squad''s staff across. Offered, never automatic: a club that has just folded a squad has said something.';

-- ============================================================
-- 5. A team decision refreshes the players it affects.
-- ============================================================
--
-- Done as a trigger on the decision itself rather than inside
-- confirm_rollover_team_proposal_core, so every route that decides a team is
-- covered by construction: the manual board, the automatic transition
-- processor, and anything added later. There is no recursion risk -- the
-- refresh only writes player proposals.

create or replace function internal.team_decision_refreshes_players()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.decision is distinct from old.decision then
    perform internal.refresh_rollover_player_proposals(new.rollover_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists team_decision_refreshes_players on public.age_grade_rollover_team_proposals;
create trigger team_decision_refreshes_players
  after update of decision on public.age_grade_rollover_team_proposals
  for each row execute function internal.team_decision_refreshes_players();

do $$
declare v_def text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'team_decision_refreshes_players') then
    raise exception 'A team decision does not refresh the player proposals it affects.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'refresh_rollover_player_proposals';
  if v_def !~ 'selected_team_id is null' then
    raise exception 'The refresh would discard placements a human has already decided.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'generate_rollover_player_proposals_core';
  if v_def !~ 'tp.decision = ''folded''' then
    raise exception 'A folded squad''s players are still excluded from the board.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'provision_missing_placement_team';
  if v_def !~ 'team_permissions' then
    raise exception 'Creating a successor team does not carry its staff across.';
  end if;
  if v_def !~ 'is_club_admin' then
    raise exception 'Creating a team is not held to Club Admin authority.';
  end if;
end $$;
