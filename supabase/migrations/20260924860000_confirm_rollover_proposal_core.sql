-- Bug found live-testing the Automatic Season Transition engine
-- (20260924850000): internal.process_due_season_transitions() called
-- public.confirm_rollover_team_proposal() to auto-confirm the
-- mechanical (non-manual-choice) proposals -- but that function checks
-- internal.can_manage_club_fixtures(...)/is_site_admin() against
-- auth.uid(), which is NULL when the automatic engine runs as a
-- trusted system routine (pg_cron/SECURITY DEFINER, no logged-in
-- user). Every auto-confirm attempt failed with "Not authorized",
-- silently defeating the whole point of the engine. Same fix shape as
-- generate_rollover_proposal_core: extract the real logic into an
-- internal core parameterized by p_decided_by instead of reading
-- auth.uid() internally, pulled byte-for-byte from the live definition
-- (via pg_get_functiondef, including the FUTURE-SEASON snapshot logic
-- added in 20260924810000) so the interactive and automatic paths
-- share exactly one implementation.

create or replace function internal.confirm_rollover_team_proposal_core(p_proposal_id uuid, p_action text, p_age_group text, p_squad_designation text, p_fold_reason text, p_gender text, p_decided_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
  v_team public.teams;
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
        raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).';
    end;

    if r.to_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = p.team_id
      on conflict (team_id, season_id) do nothing;
    end if;

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', p_decided_by, jsonb_build_object('age_group', p.current_age_group), jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals set decision = 'folded', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals set decision = 'deferred', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  end if;
end;
$$;

create or replace function public.confirm_rollover_team_proposal(p_proposal_id uuid, p_action text, p_age_group text default null::text, p_squad_designation text default null::text, p_fold_reason text default null::text, p_gender text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
begin
  select r.club_id into v_club_id
  from public.age_grade_rollover_team_proposals p join public.age_grade_rollovers r on r.id = p.rollover_id
  where p.id = p_proposal_id;
  if v_club_id is null then
    raise exception 'Rollover proposal not found.';
  end if;
  if not (internal.can_manage_club_fixtures(v_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to confirm this rollover proposal.' using errcode = '42501';
  end if;
  perform internal.confirm_rollover_team_proposal_core(p_proposal_id, p_action, p_age_group, p_squad_designation, p_fold_reason, p_gender, auth.uid());
end;
$$;

-- internal.process_due_season_transitions: call the core directly
-- (system-authorized, p_decided_by = null -- honestly recorded as a
-- system action, same convention as generate_rollover_proposal_core's
-- p_created_by) instead of the interactive wrapper.
create or replace function internal.process_due_season_transitions()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_transition public.season_transitions;
  v_current_season_id uuid;
  v_to_season_id uuid;
  v_to_starts_on date;
  v_boundary timestamptz;
  v_warn_at timestamptz;
  v_proposal record;
  v_pending_count integer;
  v_had_error boolean;
begin
  for c in
    select distinct cl.id as club_id, t.rugby_code, cl.timezone
    from public.teams t
    join public.clubs cl on cl.id = t.club_id
    where t.active and t.category = 'youth' and cl.status = 'active'
  loop
    select s.id, s.starts_on into v_to_season_id, v_to_starts_on
    from public.seasons s
    where s.rugby_code = c.rugby_code
      and (s.starts_on::timestamp at time zone c.timezone) <= now() + interval '24 hours'
      and not exists (
        select 1 from public.season_transitions st
        where st.club_id = c.club_id and st.rugby_code = c.rugby_code and st.to_season_id = s.id and st.status = 'completed'
      )
    order by s.starts_on asc limit 1;
    if v_to_season_id is null then
      continue;
    end if;

    select id into v_current_season_id
    from public.seasons
    where rugby_code = c.rugby_code and starts_on < v_to_starts_on
    order by starts_on desc limit 1;

    v_boundary := v_to_starts_on::timestamp at time zone c.timezone;
    v_warn_at := v_boundary - interval '24 hours';

    insert into public.season_transitions (club_id, rugby_code, from_season_id, to_season_id, status)
    values (c.club_id, c.rugby_code, v_current_season_id, v_to_season_id, 'prepared')
    on conflict (club_id, rugby_code, to_season_id) do nothing;

    select * into v_transition from public.season_transitions
    where club_id = c.club_id and rugby_code = c.rugby_code and to_season_id = v_to_season_id
    for update;

    if v_transition.status = 'prepared' and v_transition.rollover_id is null then
      v_transition.rollover_id := internal.generate_rollover_proposal_core(c.club_id, c.rugby_code, v_to_season_id, null);
      update public.season_transitions set rollover_id = v_transition.rollover_id, updated_at = now() where id = v_transition.id;
    end if;

    if v_transition.status = 'prepared' and v_transition.warning_sent_at is null then
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'season_transition_warning', 'Season rollover in about 24 hours',
        format('Teams will automatically roll forward to the next age grade for %s in about 24 hours. Review the proposal now if any team needs a manual choice.', c.rugby_code),
        jsonb_build_object('season_transition_id', v_transition.id, 'to_season_id', v_to_season_id)
      from public.club_memberships cm
      where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

      update public.season_transitions set status = 'ready', warning_sent_at = now(), updated_at = now() where id = v_transition.id;
      v_transition.status := 'ready';
    end if;

    if v_transition.status in ('prepared', 'ready') and now() >= v_boundary then
      update public.season_transitions set status = 'applying', updated_at = now() where id = v_transition.id;
      v_had_error := false;

      for v_proposal in
        select * from public.age_grade_rollover_team_proposals
        where rollover_id = v_transition.rollover_id and decision = 'pending' and not requires_manual_choice
      loop
        begin
          perform internal.confirm_rollover_team_proposal_core(v_proposal.id, 'confirm', null, null, null, null, null);
        exception when others then
          v_had_error := true;
          update public.season_transitions set last_error = sqlerrm, updated_at = now() where id = v_transition.id;
        end;
      end loop;

      select count(*) into v_pending_count from public.age_grade_rollover_team_proposals where rollover_id = v_transition.rollover_id and decision = 'pending';

      if v_had_error or v_pending_count > 0 then
        update public.season_transitions set status = 'needs_attention', updated_at = now() where id = v_transition.id;
        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'season_transition_needs_attention', 'Season rollover needs your attention',
          format('The automatic season rollover has run, but %s team(s) still need a manual decision (or hit an error). Review them in Season Rollover.', v_pending_count),
          jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
        from public.club_memberships cm
        where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
      else
        update public.season_transitions set status = 'completed', applied_at = now(), updated_at = now() where id = v_transition.id;
        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'season_transition_completed', 'Season rollover complete',
          'All eligible teams have automatically rolled forward to the new season.',
          jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
        from public.club_memberships cm
        where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
      end if;
    end if;
  end loop;

  update public.season_transitions st
  set status = 'completed', applied_at = coalesce(st.applied_at, now()), updated_at = now()
  where st.status = 'needs_attention'
    and st.rollover_id is not null
    and not exists (
      select 1 from public.age_grade_rollover_team_proposals p where p.rollover_id = st.rollover_id and p.decision = 'pending'
    );
end;
$$;
