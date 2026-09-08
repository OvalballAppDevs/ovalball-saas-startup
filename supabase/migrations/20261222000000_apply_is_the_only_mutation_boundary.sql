-- Apply is where a season handover actually happens -- and the only place.
--
-- 20261221000000 stopped every decision path from mutating. This is the other
-- half: one server-side operation that takes the whole reviewed decision set
-- and carries it out, in one transaction, once.
--
-- WHY ONE OPERATION AND NOT A LOOP IN THE BROWSER
--
-- A season handover is not a batch of independent edits. Progressing this
-- season's U12 to U13 is what frees the U12 identity for next season's intake;
-- folding U15 B is what makes its players need somewhere else to go. Sequenced
-- from the client, a dropped connection halfway leaves a club with some
-- cohorts moved and some not, and no way to tell which. Inside one
-- transaction, a failure leaves the club exactly as it was.
--
-- ORDERING
--
-- The dependency order the schema actually requires:
--
--   1. lock the handover, revalidate every decision  (§8 -- nothing is trusted)
--   2. end cohorts: graduate, then fold              (frees identities, ends memberships)
--   3. progress continuing teams                     (frees the identities below them)
--   4. create or reactivate planned teams            (into the freed identities)
--   5. record each team's identity in both seasons   (history, and the new season)
--   6. move players, including into teams created in step 4
--   7. record completion
--
-- Steps 2-4 are the U12 collision from the UAT, resolved by order alone: the
-- current U12 becomes U13 before the planned U12 is created, so at no instant
-- do two live teams hold one identity.
--
-- Step 3 is applied by RELAXATION rather than by a sort. A club could adjust a
-- team downward, and any fixed ordering that assumes age grades only rise
-- would deadlock on it. Instead: repeatedly apply every progression whose
-- destination is currently free, until none is left. If a genuine cycle
-- remains -- two teams asked to swap identities -- it is named and the whole
-- Apply is refused, rather than half-performed.

-- ---------------------------------------------------------------------------
-- 1. Player proposals understand a planned destination
-- ---------------------------------------------------------------------------

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
  v_planned_id uuid;
  v_planned_label text;
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
           p.date_of_birth, p.playing_pathway, t.rugby_code, t.active as team_active,
           t.display_name as team_name, t.squad_designation,
           tp.proposed_age_group, tp.proposed_to_canonical_team_type_id,
           tp.requires_manual_choice, tp.decision as team_decision
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    join public.players p on p.id = ptm.player_id
    left join public.age_grade_rollover_team_proposals tp
      on tp.rollover_id = r.id and tp.team_id = ptm.team_id
    where t.club_id = r.club_id and t.rugby_code = r.rugby_code
      and ptm.status = 'active' and t.category = 'youth'
      and (t.active or tp.decision = 'folded')
  loop
    v_proposed_team := null; v_proposed_type := m.proposed_to_canonical_team_type_id;
    v_planned_id := null; v_planned_label := null;
    v_review := 'READY'; v_reason := null; v_disp_outcome := null; v_move_req := null;

    -- DOB and playing pathway are read here and nowhere else. Neither is
    -- carried into the row that gets written: consumers receive the decision.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.playing_pathway);

    v_proposed_team := internal.resolve_normal_placement_team(
      r.id, m.team_id, v_norm.canonical_team_type_id);

    -- No live team will be that identity, but the club may already have
    -- decided to run one. A planned team is a real answer to "where does this
    -- child go?" -- it just does not exist yet.
    if v_proposed_team is null and v_norm.canonical_team_type_id is not null then
      v_planned_id := internal.rollover_planned_team_for(r.id, v_norm.canonical_team_type_id, m.squad_designation);
      if v_planned_id is not null then
        select ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end
        into v_planned_label
        from public.age_grade_rollover_planned_teams pt
        join public.canonical_team_types ctt on ctt.id = pt.canonical_team_type_id
        where pt.id = v_planned_id;
      end if;
    end if;

    select * into v_disp
    from public.player_team_dispensation d
    where d.player_id = m.player_id and d.status = 'approved'
      and d.season_id is distinct from r.to_season_id
    order by d.created_at desc
    limit 1;

    if v_disp.id is not null then
      if v_norm.allocation_status = 'NORMAL_PLACEMENT'
         and v_norm.canonical_team_type_id is not null
         and (v_proposed_team is not null or v_planned_id is not null) then
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
    elsif v_norm.allocation_status = 'CLASSIFICATION_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_norm.reason, 'Playing information is needed to confirm next-season placement.');
    elsif m.team_decision = 'folded' and v_planned_id is null and v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('%s is not continuing next season, so this player needs a new place. Their normal age grade for the target season is %s.',
                         m.team_name, coalesce(v_norm.canonical_label, v_reg.regulatory_age_label, 'unresolved'));
    elsif m.team_decision = 'folded' then
      -- Folding a squad moves its children, which is a consequence the club
      -- should see stated -- but it is not an unresolved problem when there is
      -- a proper place for them to go.
      v_review := 'READY';
      v_reason := format('%s is not continuing next season. This player moves to %s, which is their normal age grade.',
                         m.team_name,
                         coalesce(
                           (select ctt.label from public.canonical_team_types ctt where ctt.id = v_norm.canonical_team_type_id),
                           'their normal team'));
    elsif v_norm.allocation_status = 'CLUB_HOLDING' then
      v_review := 'READY';
      v_reason := v_norm.reason;
    elsif v_norm.allocation_status = 'NEEDS_ATTENTION' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := v_norm.reason;
    elsif v_planned_id is not null then
      -- Planned, not live. The wording has to say so: telling a Club Admin the
      -- team "was added" when the handover has not run would be a lie.
      v_review := 'READY';
      v_reason := format('%s will be created when this handover is applied, and this player joins it then.',
                         coalesce(v_planned_label, 'That team'));
    elsif v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('This club does not currently run %s, which is where this player would normally go next season. The club can add that team, or place the player somewhere else.',
                         coalesce(v_norm.canonical_label, 'that team'));
    elsif v_move_req in ('not_permitted','external_approval_required') then
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_move.reason, 'This placement needs approval beyond the club.');
    elsif m.requires_manual_choice and m.team_decision = 'pending' then
      -- Only while the team review is still OPEN. Once the club has decided
      -- what happens to the cohort -- the Mixed split answered, a successor
      -- chosen -- the player is no longer waiting on anything.
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'The team itself has no automatic successor for the target season, so this player''s placement follows that review rather than rolling forward on its own.';
    else
      v_review := 'READY';
    end if;

    insert into public.age_grade_rollover_player_proposals (
      rollover_id, player_id, current_team_id, current_membership_id,
      proposed_team_id, proposed_canonical_team_type_id, planned_team_id,
      regulatory_age_label, regulatory_status, normal_canonical_team_type_id,
      allocation_status, movement_requirement, dispensation_id, dispensation_outcome,
      review_state, reason
    ) values (
      r.id, m.player_id, m.team_id, m.membership_id,
      v_proposed_team, coalesce(v_proposed_type, v_norm.canonical_team_type_id), v_planned_id,
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

-- ---------------------------------------------------------------------------
-- 2. Revalidation -- nothing is trusted because it was valid once
-- ---------------------------------------------------------------------------

create or replace function internal.handover_apply_blockers_core(p_rollover_id uuid)
returns table(kind text, subject text, detail text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v record;
  v_norm record;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;

  -- The canonical season must still be there and still be the one decided on.
  if not exists (select 1 from public.seasons s where s.id = r.to_season_id and s.rugby_code = r.rugby_code) then
    return query select 'season', 'Target season',
      'The season this handover was prepared for is no longer in the canonical Seasons register. Check Site Admin -> Seasons.';
  end if;

  return query
  select 'team', t.display_name,
         'This team has not been decided yet.'
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where p.rollover_id = p_rollover_id and p.decision in ('pending', 'deferred');

  -- Two things planned into one identity. Undecided teams are excluded: they
  -- are a readiness problem, reported above, not a collision.
  return query
  select 'collision',
         ip.label,
         format('More than one team is planned to be %s next season. One of those decisions has to change.', ip.label)
  from internal.rollover_identity_plan(p_rollover_id) ip
  where ip.is_decided
  group by ip.canonical_team_type_id, ip.squad_designation, ip.label
  having count(*) > 1;

  return query
  select 'player',
         coalesce(pl.first_name || ' ' || pl.surname, 'A player'),
         coalesce(pp.reason, 'This placement has not been resolved.')
  from public.age_grade_rollover_player_proposals pp
  join public.players pl on pl.id = pp.player_id
  where pp.rollover_id = p_rollover_id and pp.review_state <> 'READY';

  -- A placement that needs the governing body still needs it. Approval is
  -- never staged or assumed -- it is read from the dispensation domain.
  return query
  select 'dispensation',
         coalesce(pl.first_name || ' ' || pl.surname, 'A player'),
         'This placement requires governing-body approval, and no approved dispensation is recorded for the target season.'
  from public.age_grade_rollover_player_proposals pp
  join public.players pl on pl.id = pp.player_id
  where pp.rollover_id = p_rollover_id
    and pp.movement_requirement = 'external_approval_required'
    and pp.placement_applied_at is null
    and not exists (
      select 1 from public.player_team_dispensation d
      where d.player_id = pp.player_id
        and d.target_team_id = coalesce(pp.selected_team_id, pp.proposed_team_id)
        and d.season_id = r.to_season_id and d.status = 'approved'
        and d.governing_body_reference is not null
    );

  -- Decisions can go stale. A date of birth corrected during review changes
  -- which age grade a child belongs in, and the reviewed answer is then wrong.
  for v in
    select pp.id, pp.player_id, pp.normal_canonical_team_type_id, pp.selected_team_id,
           pl.first_name, pl.surname, pl.date_of_birth, pl.playing_pathway
    from public.age_grade_rollover_player_proposals pp
    join public.players pl on pl.id = pp.player_id
    where pp.rollover_id = p_rollover_id and pp.placement_applied_at is null
  loop
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, v.date_of_birth, v.playing_pathway);
    if v_norm.canonical_team_type_id is distinct from v.normal_canonical_team_type_id
       and v.selected_team_id is null then
      return query select 'stale',
        coalesce(v.first_name || ' ' || v.surname, 'A player'),
        'This player''s age grade for the target season has changed since their placement was reviewed. Regenerate the proposals and review it again.';
    end if;
  end loop;

  -- A team decided into a destination that has since become invalid.
  return query
  select 'team', t.display_name,
         format('The recorded destination (%s) is no longer a valid identity for this team.', p.decided_age_group)
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where p.rollover_id = p_rollover_id and p.decision = 'confirmed'
    and (p.decided_canonical_team_type_id is null or not t.active);
end;
$function$;

create or replace function public.handover_apply_blockers(p_rollover_id uuid)
returns table(kind text, subject text, detail text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_club_id uuid;
begin
  select club_id into v_club_id from public.age_grade_rollovers where id = p_rollover_id;
  if v_club_id is null then return; end if;
  if not (internal.can_manage_club_fixtures(v_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to review this handover.' using errcode = '42501';
  end if;
  return query select * from internal.handover_apply_blockers_core(p_rollover_id);
end;
$function$;

comment on function public.handover_apply_blockers(uuid) is
  'Everything standing between this handover and Apply, recomputed from live state. Apply calls this itself -- a decision being valid when it was made is not evidence it is valid now.';

-- ---------------------------------------------------------------------------
-- 3. Apply
-- ---------------------------------------------------------------------------

create or replace function internal.apply_planned_team(
  p_planned_id uuid, p_actor uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  pt public.age_grade_rollover_planned_teams;
  r public.age_grade_rollovers;
  ctt public.canonical_team_types;
  v_existing public.teams;
  v_label text;
  v_id uuid;
  v_reactivated boolean := false;
  v_staff integer := 0;
begin
  select * into pt from public.age_grade_rollover_planned_teams where id = p_planned_id for update;
  if pt.applied_at is not null then return pt.created_team_id; end if;
  select * into r from public.age_grade_rollovers where id = pt.rollover_id;
  select * into ctt from public.canonical_team_types where id = pt.canonical_team_type_id;

  v_label := ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end;

  -- Adopt before creating. A team the club folded keeps its stable id and
  -- everything attached to it, so reactivating is always better than standing
  -- a second one beside it -- and the identity_key constraint would refuse the
  -- second one anyway.
  select * into v_existing from public.teams
  where club_id = r.club_id and rugby_code = r.rugby_code
    and category = ctt.category and age_group = ctt.age_group
    and gender is not distinct from ctt.gender
    and squad_designation is not distinct from pt.squad_designation
  order by active desc, created_at asc
  limit 1;

  if v_existing.id is not null then
    v_id := v_existing.id;
    if not v_existing.active then
      update public.teams
      set active = true, archived_at = null, archived_by = null,
          folded_at = null, folded_by = null, fold_reason = null,
          display_name = v_label, updated_by = p_actor
      where id = v_id;
      v_reactivated := true;
    end if;
  else
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation,
                              display_name, slug, created_by, updated_by)
    values (r.club_id, r.rugby_code, ctt.category, ctt.age_group, ctt.gender, pt.squad_designation,
            v_label,
            trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(gen_random_uuid()::text, 1, 8),
            p_actor, p_actor)
    returning id into v_id;
  end if;

  -- Staff follow the cohort. A progressing team keeps its own id and so keeps
  -- its staff automatically; a newly created one would start with nobody.
  -- Never into an adult team, and never around a safeguarding check: these are
  -- existing club memberships being given a team assignment, not new people.
  if pt.source_team_id is not null and ctt.category = 'youth' then
    insert into public.team_permissions (membership_id, team_id, permission, assigned_group_id, created_by)
    select tp.membership_id, v_id, tp.permission, tp.assigned_group_id, p_actor
    from public.team_permissions tp
    where tp.team_id = pt.source_team_id
    on conflict (membership_id, team_id) do nothing;
    get diagnostics v_staff = row_count;
  end if;

  update public.age_grade_rollover_planned_teams
  set created_team_id = v_id, reactivated = v_reactivated, applied_at = now()
  where id = p_planned_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_id, case when v_reactivated then 'update' else 'insert' end, p_actor,
    jsonb_build_object('event', case when v_reactivated then 'HANDOVER_TEAM_REACTIVATED' else 'HANDOVER_TEAM_CREATED' end,
                       'rollover_id', r.id, 'planned_team_id', p_planned_id, 'origin', pt.origin,
                       'source_team_id', pt.source_team_id, 'staff_carried_over', v_staff,
                       'target_season_id', r.to_season_id));

  return v_id;
end;
$function$;

-- Folding gains an actor-taking core so the automatic transition can fold a
-- cohort at the boundary. The public entry point is untouched in behaviour:
-- direct Team management still folds immediately, which is correct -- that is
-- not a handover decision, it is an admin doing something now.
create or replace function internal.fold_team_core(p_team_id uuid, p_reason text, p_actor uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  t public.teams;
  v_affected_count integer := 0;
  rec record;
  v_is_external boolean;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to fold a team.';
  end if;
  if not t.active then raise exception 'This team is already folded.'; end if;

  update public.teams
  set active = false, folded_at = now(), folded_by = p_actor, fold_reason = trim(p_reason)
  where id = p_team_id;

  for rec in
    select * from public.fixtures
    where owning_team_id = p_team_id and kickoff_date >= current_date and status <> 'Cancelled'
  loop
    v_is_external := rec.opponent_team_id is null
      or not exists (select 1 from public.teams t2 join public.clubs c on c.id = t2.club_id
                     where t2.id = rec.opponent_team_id and c.status = 'active');

    update public.fixtures
    set status = 'Cancelled', cancelled_at = now(),
        cancellation_reason = format('Team folded: %s', trim(p_reason)), cancelled_due_to_fold = true
    where id = rec.id;

    if rec.mirror_fixture_id is not null then
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(),
          cancellation_reason = format('Opponent team folded: %s', trim(p_reason)), cancelled_due_to_fold = true
      where id = rec.mirror_fixture_id;
    end if;

    if not v_is_external then
      perform internal.fixture_result_system_event(rec.id, p_actor,
        format('%s has folded. This fixture has been removed from the active schedule. Club note: %s', t.display_name, trim(p_reason)));
      perform internal.fixture_result_notify(rec.id, p_actor, 'fixture_cancelled_team_folded', 'Fixture removed -- team folded',
        format('%s has folded and your fixture on %s has been removed from the active schedule. Club note: %s',
               t.display_name, to_char(rec.kickoff_date, 'DD Mon YYYY'), trim(p_reason)));
    end if;

    v_affected_count := v_affected_count + 1;
  end loop;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', p_actor,
    jsonb_build_object('event', 'folded', 'reason', p_reason, 'fixtures_affected', v_affected_count));

  return v_affected_count;
end;
$function$;

create or replace function public.fold_team(p_team_id uuid, p_reason text)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare t public.teams;
begin
  select * into t from public.teams where id = p_team_id;
  if not found then raise exception 'Team not found.'; end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may fold a team.' using errcode = '42501';
  end if;
  return internal.fold_team_core(p_team_id, p_reason, auth.uid());
end;
$function$;

create or replace function internal.apply_season_handover_core(
  p_rollover_id uuid, p_expected_revision integer, p_actor uuid
) returns table(
  already_applied boolean, teams_progressed integer, teams_folded integer,
  teams_graduated integer, teams_created integer, teams_reactivated integer,
  players_moved integer, players_held integer
)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v_blocker record;
  v_blockers integer := 0;
  v_first_blocker text;
  v_p record;
  v_pt record;
  v_team public.teams;
  v_squad text;
  v_gender text;
  v_target uuid;
  v_progressed integer := 0;
  v_folded integer := 0;
  v_graduated integer := 0;
  v_created integer := 0;
  v_reactivated integer := 0;
  v_moved integer := 0;
  v_held integer := 0;
  v_pass integer := 0;
  v_applied_this_pass integer;
  v_remaining integer;
  v_stuck text;
  v_actor uuid := p_actor;
begin
  -- A. Lock the handover. Every decision function takes this same row lock, so
  --    a decision cannot interleave with an Apply that is already reading it.
  select * into r from public.age_grade_rollovers where id = p_rollover_id for update;
  if not found then raise exception 'Handover not found.'; end if;

  -- C. Already done. Idempotent by design: a double click, a retried request
  --    or a resent form gets the same answer and does no work.
  if r.applied_at is not null then
    return query select true, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  -- D. The reviewer read a particular set of decisions. If someone else has
  --    changed one since, applying silently would apply something nobody
  --    reviewed.
  if p_expected_revision is not null and p_expected_revision <> r.decisions_revision then
    raise exception 'These decisions have changed since you reviewed them. Reload the handover and check what is different before applying.'
      using errcode = 'P0001';
  end if;

  -- E. Revalidate everything, from live state.
  for v_blocker in select * from internal.handover_apply_blockers_core(p_rollover_id) loop
    v_blockers := v_blockers + 1;
    if v_first_blocker is null then
      v_first_blocker := v_blocker.subject || ': ' || v_blocker.detail;
    end if;
  end loop;
  if v_blockers > 0 then
    raise exception 'This handover cannot be applied yet -- % item(s) still need resolving. First: %', v_blockers, v_first_blocker
      using errcode = 'P0001';
  end if;

  update public.season_transitions
  set status = 'applying', updated_at = now()
  where rollover_id = p_rollover_id and status <> 'completed';

  -- 2. End the cohorts that are not continuing. Done first: it frees their
  --    canonical identities and closes their memberships before anything
  --    tries to take either.
  for v_p in
    -- Squads before their primary: the schema refuses to deactivate a primary
    -- while a B or C squad at that level is still live.
    select p.* from public.age_grade_rollover_team_proposals p
    join public.teams t on t.id = p.team_id
    where p.rollover_id = p_rollover_id and p.decision = 'graduated' and p.applied_at is null
    order by t.squad_designation desc nulls last
  loop
    select * into v_team from public.teams where id = v_p.team_id;
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;
    if v_team.active then
      perform internal.graduate_team_core(v_p.team_id, v_actor);
    end if;
    update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
    v_graduated := v_graduated + 1;
  end loop;

  for v_p in
    select p.* from public.age_grade_rollover_team_proposals p
    join public.teams t on t.id = p.team_id
    where p.rollover_id = p_rollover_id and p.decision = 'folded' and p.applied_at is null
    order by t.squad_designation desc nulls last
  loop
    select * into v_team from public.teams where id = v_p.team_id;
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;
    if v_team.active then
      perform internal.fold_team_core(v_p.team_id, coalesce(v_p.fold_reason, 'Not continuing next season.'), v_actor);
    end if;
    update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
    v_folded := v_folded + 1;
  end loop;

  -- 3. Progress the continuing teams, by relaxation. See the header: any fixed
  --    ordering assumes age grades only rise, and Adjust can break that.
  loop
    v_pass := v_pass + 1;
    v_applied_this_pass := 0;

    for v_p in
      select * from public.age_grade_rollover_team_proposals
      where rollover_id = p_rollover_id and decision = 'confirmed' and applied_at is null
      order by (decided_squad_designation is null) desc, decided_age_group desc nulls last
    loop
      select * into v_team from public.teams where id = v_p.team_id;
      v_squad := coalesce(v_p.decided_squad_designation, v_team.squad_designation);
      v_gender := coalesce(v_p.decided_gender, v_team.gender);

      -- Is the destination free right now?
      if exists (
        select 1 from public.teams t2
        where t2.club_id = v_team.club_id and t2.active and t2.id <> v_team.id
          and t2.canonical_team_type_id = v_p.decided_canonical_team_type_id
          and coalesce(t2.squad_designation, '') = coalesce(v_squad, '')
      ) then
        continue;
      end if;

      -- A B or C squad cannot become active at a level before its primary is
      -- there. Skipping rather than failing is the point of the relaxation
      -- loop: the primary moves this pass, the squad follows on the next.
      if v_squad in ('B', 'C') and not exists (
        select 1 from public.teams t3
        where t3.club_id = v_team.club_id and t3.active
          and t3.canonical_team_type_id = v_p.decided_canonical_team_type_id
          and t3.squad_designation is null
      ) then
        continue;
      end if;

      if r.from_season_id is not null then
        insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
        values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
        on conflict (team_id, season_id) do nothing;
      end if;

      update public.teams
      set age_group = v_p.decided_age_group,
          squad_designation = v_squad,
          gender = v_gender,
          display_name = internal.compute_team_display_name('youth', v_p.decided_age_group, v_gender, v_squad),
          updated_by = v_actor
      where id = v_p.team_id;

      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = v_p.team_id
      on conflict (team_id, season_id) do nothing;

      insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
      values ('teams', v_p.team_id, 'update', v_actor,
        jsonb_build_object('age_group', v_p.current_age_group, 'gender', v_team.gender),
        jsonb_build_object('event', 'HANDOVER_TEAM_PROGRESSED', 'rollover_id', r.id,
                           'age_group', v_p.decided_age_group, 'gender', v_gender,
                           'squad_designation', v_squad, 'target_season_id', r.to_season_id));

      update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
      v_progressed := v_progressed + 1;
      v_applied_this_pass := v_applied_this_pass + 1;
    end loop;

    select count(*) into v_remaining from public.age_grade_rollover_team_proposals
    where rollover_id = p_rollover_id and decision = 'confirmed' and applied_at is null;

    exit when v_remaining = 0;

    if v_applied_this_pass = 0 then
      select string_agg(t.display_name, ', ') into v_stuck
      from public.age_grade_rollover_team_proposals p
      join public.teams t on t.id = p.team_id
      where p.rollover_id = p_rollover_id and p.decision = 'confirmed' and p.applied_at is null;
      raise exception 'These teams are waiting on each other''s identities and cannot all move: %. Change one of their destinations and apply again -- nothing has been changed.', v_stuck
        using errcode = 'P0001';
    end if;
    if v_pass > 50 then
      raise exception 'The handover could not settle the team progressions. Nothing has been changed.' using errcode = 'P0001';
    end if;
  end loop;

  -- 4. Create the planned teams. The identities they need were vacated in
  --    step 3, which is the whole reason planning existed.
  for v_pt in
    select * from public.age_grade_rollover_planned_teams
    where rollover_id = p_rollover_id and applied_at is null
    order by squad_designation nulls first
  loop
    v_target := internal.apply_planned_team(v_pt.id, v_actor);
    if (select reactivated from public.age_grade_rollover_planned_teams where id = v_pt.id) then
      v_reactivated := v_reactivated + 1;
    else
      v_created := v_created + 1;
    end if;

    insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
    select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
    from public.teams where id = v_target
    on conflict (team_id, season_id) do nothing;

    if v_pt.origin = 'MIXED_SPLIT' and v_pt.source_proposal_id is not null then
      update public.age_grade_rollover_team_proposals
      set girls_team_created = true, girls_team_id = v_target where id = v_pt.source_proposal_id;
    elsif v_pt.origin = 'U6_INTAKE' and v_pt.source_proposal_id is not null then
      update public.age_grade_rollover_team_proposals
      set intake_team_created = true, intake_team_id = v_target where id = v_pt.source_proposal_id;
    end if;
  end loop;

  -- 6. Move the players. The membership pathway guard is authoritative here as
  --    everywhere else -- if a placement is not compatible it raises, and the
  --    whole handover rolls back rather than half-moving a cohort.
  for v_p in
    select * from public.age_grade_rollover_player_proposals
    where rollover_id = p_rollover_id and placement_applied_at is null
    order by player_id
  loop
    if v_p.allocation_status = 'CLUB_HOLDING' then
      -- Youth pathway complete. No adult team is assigned by Ovalball.
      insert into public.player_graduation_queue (player_id, source_team_id, club_id)
      values (v_p.player_id, v_p.current_team_id, r.club_id)
      on conflict do nothing;
      update public.player_team_memberships
      set status = 'ended', ended_at = now(), updated_by = v_actor
      where player_id = v_p.player_id and team_id = v_p.current_team_id and status = 'active';
      v_held := v_held + 1;
    else
      v_target := coalesce(
        v_p.selected_team_id,
        (select created_team_id from public.age_grade_rollover_planned_teams where id = v_p.planned_team_id),
        v_p.proposed_team_id);

      if v_target is not null and v_target is distinct from v_p.current_team_id then
        update public.player_team_memberships
        set status = 'ended', ended_at = now(), updated_by = v_actor
        where player_id = v_p.player_id and team_id = v_p.current_team_id and status = 'active';

        insert into public.player_team_memberships (player_id, team_id, status, created_by)
        values (v_p.player_id, v_target, 'active', v_actor)
        on conflict do nothing;
        v_moved := v_moved + 1;
      end if;
    end if;

    update public.age_grade_rollover_player_proposals
    set placement_applied_at = now() where id = v_p.id;

    insert into public.audit_log (table_name, record_id, action, changed_by, after)
    values ('age_grade_rollover_player_proposals', v_p.id, 'update', v_actor,
      jsonb_build_object('event', 'HANDOVER_PLACEMENT_APPLIED', 'rollover_id', r.id,
                         'player_id', v_p.player_id, 'from_team_id', v_p.current_team_id,
                         'to_team_id', case when v_p.allocation_status = 'CLUB_HOLDING' then null else v_target end,
                         'club_holding', v_p.allocation_status = 'CLUB_HOLDING',
                         'target_season_id', r.to_season_id));
  end loop;

  -- 7. Done.
  update public.age_grade_rollovers
  set applied_at = now(), applied_by = v_actor where id = p_rollover_id;

  update public.season_transitions
  set status = 'completed', applied_at = now(), needs_attention_reason = null, last_error = null, updated_at = now()
  where rollover_id = p_rollover_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollovers', p_rollover_id, 'update', v_actor,
    jsonb_build_object('event', 'SEASON_HANDOVER_APPLIED', 'club_id', r.club_id,
                       'rugby_code', r.rugby_code, 'from_season_id', r.from_season_id,
                       'to_season_id', r.to_season_id,
                       'teams_progressed', v_progressed, 'teams_folded', v_folded,
                       'teams_graduated', v_graduated, 'teams_created', v_created,
                       'teams_reactivated', v_reactivated,
                       'players_moved', v_moved, 'players_held', v_held,
                       'decisions_revision', r.decisions_revision));

  return query select false, v_progressed, v_folded, v_graduated, v_created, v_reactivated, v_moved, v_held;
end;
$function$;

create or replace function public.apply_season_handover(
  p_rollover_id uuid, p_expected_revision integer default null
) returns table(
  already_applied boolean, teams_progressed integer, teams_folded integer,
  teams_graduated integer, teams_created integer, teams_reactivated integer,
  players_moved integer, players_held integer
)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_club_id uuid;
begin
  select club_id into v_club_id from public.age_grade_rollovers where id = p_rollover_id;
  if v_club_id is null then raise exception 'Handover not found.'; end if;

  -- Applying a season handover restructures the club: teams progress, cohorts
  -- are archived, children change team. Held to Club Admin, not to "can manage
  -- fixtures" -- reviewing a handover and running it are different authorities.
  if not (internal.is_club_admin(v_club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may apply a season handover.'
      using errcode = '42501';
  end if;

  return query select * from internal.apply_season_handover_core(p_rollover_id, p_expected_revision, auth.uid());
end;
$function$;

comment on function public.apply_season_handover(uuid, integer) is
  'The single mutation boundary for a season handover. One transaction, revalidated from live state, idempotent, and all-or-nothing: a failure anywhere leaves the club exactly as it was.';

grant execute on function public.apply_season_handover(uuid, integer) to authenticated;
grant execute on function public.handover_apply_blockers(uuid) to authenticated;

-- The per-player apply entry point is gone. Sequencing a season transition one
-- request at a time from a browser is exactly what step 6 exists to replace.
drop function if exists public.apply_rollover_player_placement(uuid);

-- ---------------------------------------------------------------------------
-- 4. The automatic transition uses the same boundary
-- ---------------------------------------------------------------------------
--
-- It used to BE the mutation: a loop calling confirm, which progressed teams
-- one at a time and could leave a club half-moved. Now it decides the
-- unambiguous cohorts and then calls the same Apply a human would.

create or replace function internal.process_due_season_transitions()
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  c record;
  v_transition public.season_transitions;
  v_anchor_starts_on date;
  v_to_season_id uuid;
  v_to_starts_on date;
  v_to_pre_season_starts_on date;
  v_to_season_ref text;
  v_current_season_id uuid;
  v_boundary timestamptz;
  v_proposal record;
  v_blockers integer;
  v_had_error boolean;
  v_error text;
begin
  for c in
    select distinct cl.id as club_id, t.rugby_code, cl.timezone
    from public.teams t
    join public.clubs cl on cl.id = t.club_id
    where t.active and t.category = 'youth' and cl.status = 'active'
  loop
    select s.starts_on into v_anchor_starts_on
    from public.season_transitions st join public.seasons s on s.id = st.to_season_id
    where st.club_id = c.club_id and st.rugby_code = c.rugby_code and st.status = 'completed'
    order by s.starts_on desc limit 1;

    if v_anchor_starts_on is null then
      select starts_on into v_anchor_starts_on
      from public.seasons
      where rugby_code = c.rugby_code and starts_on < current_date
      order by starts_on desc, is_regression_fixture asc, id asc limit 1;
    end if;
    if v_anchor_starts_on is null then continue; end if;

    select s.id, s.starts_on, s.pre_season_starts_on, s.season_ref
      into v_to_season_id, v_to_starts_on, v_to_pre_season_starts_on, v_to_season_ref
    from public.seasons s
    where s.rugby_code = c.rugby_code
      and s.starts_on > v_anchor_starts_on
      and not exists (
        select 1 from public.season_transitions st
        where st.club_id = c.club_id and st.rugby_code = c.rugby_code
          and st.to_season_id = s.id and st.status = 'completed'
      )
    order by s.starts_on asc, is_regression_fixture asc, id asc limit 1;
    if v_to_season_id is null then continue; end if;

    if now() < coalesce(v_to_pre_season_starts_on, v_to_starts_on)::timestamp at time zone c.timezone - interval '24 hours' then
      continue;
    end if;

    select id into v_current_season_id
    from public.seasons
    where rugby_code = c.rugby_code and starts_on <= v_anchor_starts_on
    order by starts_on desc, is_regression_fixture asc, id asc limit 1;

    insert into public.season_transitions (club_id, rugby_code, from_season_id, to_season_id, status)
    values (c.club_id, c.rugby_code, v_current_season_id, v_to_season_id, 'prepared')
    on conflict (club_id, rugby_code, to_season_id) do nothing;

    select * into v_transition from public.season_transitions
    where club_id = c.club_id and rugby_code = c.rugby_code and to_season_id = v_to_season_id
    for update;

    if v_to_pre_season_starts_on is null then
      if v_transition.status <> 'needs_attention' then
        update public.season_transitions
        set status = 'needs_attention',
            needs_attention_reason = format('No pre-season start date is configured for %s -- cannot determine the automatic handover boundary. Configure it in Site Admin -> Seasons, then this will resume automatically.', v_to_season_ref),
            updated_at = now()
        where id = v_transition.id;
      end if;
      continue;
    end if;

    v_boundary := v_to_pre_season_starts_on::timestamp at time zone c.timezone;

    if v_transition.status = 'prepared' and v_transition.rollover_id is null then
      v_transition.rollover_id := internal.generate_rollover_proposal_core(c.club_id, c.rugby_code, v_to_season_id, null);
      update public.season_transitions set rollover_id = v_transition.rollover_id, updated_at = now() where id = v_transition.id;
    end if;

    if v_transition.status = 'prepared' and v_transition.warning_sent_at is null then
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'season_transition_warning', 'Season handover tomorrow',
        format('Ovalball will apply the %s season handover tomorrow. Nothing about your teams changes until it runs, and any cohort still needing a decision will hold the handover until it is reviewed.', v_to_season_ref),
        jsonb_build_object('season_transition_id', v_transition.id, 'to_season_id', v_to_season_id)
      from public.club_memberships cm
      where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

      update public.season_transitions set status = 'ready', warning_sent_at = now(), updated_at = now() where id = v_transition.id;
      v_transition.status := 'ready';
    end if;

    if v_transition.status in ('prepared', 'ready') and now() >= v_boundary then
      v_had_error := false;
      v_error := null;

      -- Decide the unambiguous cohorts on the club's behalf. Anything the
      -- product cannot decide by rule is left for a human.
      for v_proposal in
        select * from public.age_grade_rollover_team_proposals
        where rollover_id = v_transition.rollover_id and decision = 'pending' and not requires_manual_choice
      loop
        begin
          perform internal.decide_rollover_team_proposal(v_proposal.id, 'confirm', null, null, null, null, null);
        exception when others then
          v_had_error := true;
          v_error := sqlerrm;
        end;
      end loop;

      select count(*) into v_blockers from internal.handover_apply_blockers_core(v_transition.rollover_id);

      if v_had_error or v_blockers > 0 then
        update public.season_transitions
        set status = 'needs_attention',
            last_error = v_error,
            needs_attention_reason = case
              when v_had_error then 'An error occurred while deciding one or more teams -- see the technical detail. Nothing has been changed.'
              else format('%s item(s) still need a decision before this handover can be applied. Nothing has been changed yet.', v_blockers) end,
            updated_at = now()
        where id = v_transition.id;

        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'season_transition_needs_attention', 'Season handover needs your attention',
          format('The %s season handover is ready to run, but %s item(s) still need a decision. Nothing about your teams has changed. Review them in Season Handover.', v_to_season_ref, v_blockers),
          jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
        from public.club_memberships cm
        where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
      else
        begin
          perform internal.apply_season_handover_core(v_transition.rollover_id, null, null);
          insert into public.notifications (user_id, type, title, body, data)
          select cm.user_id, 'season_transition_completed', 'Season handover complete',
            format('The %s season handover has been applied.', v_to_season_ref),
            jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
          from public.club_memberships cm
          where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
        exception when others then
          update public.season_transitions
          set status = 'needs_attention', last_error = sqlerrm,
              needs_attention_reason = 'The handover could not be applied. Nothing has been changed -- review the technical detail.',
              updated_at = now()
          where id = v_transition.id;
        end;
      end if;
    end if;
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. One handover, one lifecycle
-- ---------------------------------------------------------------------------
--
-- season_transitions already carried the states the product needs -- prepared,
-- ready, applying, completed, needs_attention -- but only the automatic path
-- ever created a row, so a handover prepared by hand had no lifecycle at all.
-- Rather than invent a second state machine on the rollover, preparing a
-- handover now always registers it with the existing one.

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

  insert into public.season_transitions (club_id, rugby_code, from_season_id, to_season_id, status, rollover_id)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, 'prepared', v_rollover_id)
  on conflict (club_id, rugby_code, to_season_id) do update
    set rollover_id = coalesce(public.season_transitions.rollover_id, excluded.rollover_id),
        updated_at = now();

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null
  loop
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, p_rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed'
      and v_next_age is not null
      and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');

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

-- ---------------------------------------------------------------------------
-- 6. No second model
-- ---------------------------------------------------------------------------
--
-- The old immediate-mutation core and the immediate U6 provisioner are removed
-- outright rather than left reachable. Two confirm paths with different
-- semantics, chosen by caller, is exactly the escape hatch that turns one
-- product rule into two.

drop function if exists internal.confirm_rollover_team_proposal_core(uuid, text, text, text, text, text, uuid);
drop function if exists internal.provision_intake_team(uuid, uuid, text, text, uuid);

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'process_due_season_transitions')
     ~ 'confirm_rollover_team_proposal_core' then
    raise exception 'The automatic transition still progresses teams outside the Apply boundary.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'internal' and p.proname = 'confirm_rollover_team_proposal_core') then
    raise exception 'The immediate-mutation confirm path is still reachable.';
  end if;
end $$;
