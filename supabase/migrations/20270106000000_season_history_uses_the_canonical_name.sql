-- Season history is recorded in the same words the rest of the site uses.
--
-- TWO THINGS WERE WRONG WITH WHAT THE HANDOVER WROTE DOWN
--
-- 1. It named a progressed team without its rugby code, so a Rugby League
--    side would be renamed the Rugby Union way by its own handover.
--
-- 2. team_season_identity -- the record of what a team WAS in a past season --
--    carried whatever the team row held at the moment of Apply. Rows written
--    before a team always carried its pathway therefore have no gender, and
--    rows written before the naming standard hold the compact form ("U8"),
--    so Mini-Rugby Groups and every other season-aware surface described a
--    26/27 arrangement as "Under 8, Under 8 B" while the same club's Teams
--    page said "Under 8 Mixed".
--
-- The age grade in those rows is genuine history and is not touched. The
-- pathway is not a per-season fact -- a boys team was a boys team in every
-- season it existed -- and display_name is a derived label, not an
-- independent one. Both are reconciled with the canonical presentation, which
-- is the whole point of having one.

CREATE OR REPLACE FUNCTION internal.apply_season_handover_core(p_rollover_id uuid, p_expected_revision integer, p_actor uuid)
 RETURNS TABLE(already_applied boolean, teams_progressed integer, teams_folded integer, teams_graduated integer, teams_created integer, teams_reactivated integer, players_moved integer, players_held integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          -- The team's own code, not the union default: a Rugby League side
          -- progressed by the handover must not come out named the union way.
          display_name = internal.compute_team_display_name('youth', v_p.decided_age_group, v_gender, v_squad, v_team.rugby_code),
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

comment on function internal.apply_season_handover_core(uuid, integer, uuid) is
  'The single transactional mutation boundary for a season handover. Names every progressed team through internal.compute_team_display_name WITH the team''s own rugby code.';

-- ---------------------------------------------------------------------------
-- The history already written down
-- ---------------------------------------------------------------------------

do $$
declare v_gender int; v_name int;
begin
  -- The pathway a team plays in does not change from season to season, so the
  -- team's own canonical identity is the right source for a row that never
  -- recorded one.
  update public.team_season_identity tsi
  set gender = t.gender
  from public.teams t
  where t.id = tsi.team_id and tsi.gender is null and t.gender is not null;
  get diagnostics v_gender = row_count;

  -- And the label is recomputed from the row's OWN structured fields -- the
  -- historical age grade, not today's -- so the season record reads in the
  -- same words as everything else without inventing any history.
  update public.team_season_identity tsi
  set display_name = internal.compute_team_display_name(
        tsi.category, tsi.age_group, tsi.gender, tsi.squad_designation, t.rugby_code)
  from public.teams t
  where t.id = tsi.team_id
    and tsi.display_name is distinct from internal.compute_team_display_name(
        tsi.category, tsi.age_group, tsi.gender, tsi.squad_designation, t.rugby_code);
  get diagnostics v_name = row_count;

  raise notice 'Season history: % row(s) gained the pathway they always played in, % row(s) now read in the canonical name.', v_gender, v_name;
end $$;
