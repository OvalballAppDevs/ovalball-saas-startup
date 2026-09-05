-- Found live while re-running the acceptance suite repeatedly:
-- season_transition_future_fixture.sql became genuinely FLAKY (passed
-- most runs, intermittently failed PASS 2) specifically when run after
-- season_transitions.sql + season_transition_boundary.sql. Root cause
-- had nothing to do with those two files' own (correctly rolled-back)
-- data: this test's own synthetic target season (starts_on = current_date
-- + 200) lands on EXACTLY the same date as a genuinely PERSISTENT
-- leftover regression-fixture row from tournaments.sql ("[TEST] Rugby
-- Union 99/00", also current_date + 200, by that file's own design of
-- never rolling back). internal.process_due_season_transitions()'s
-- "what is the next due season" query, and public.get_team_identity_
-- for_season()'s "what is the current anchor season" query, both pick
-- their row via `order by starts_on [asc|desc] limit 1` with NO
-- secondary sort key -- a genuine tie between two seasons on the exact
-- same starts_on is resolved by whatever physical scan/plan Postgres
-- happens to choose, which is not guaranteed stable across invocations
-- (and visibly was not, here, across repeated identical-content runs).
--
-- This is a real robustness gap independent of any one test file: two
-- seasons of the same rugby_code sharing a starts_on is already
-- possible today (the overlap-prevention trigger added in
-- 20260924940000 exempts regression-fixture rows on purpose, so a
-- persistent test season and a real or another test season CAN
-- collide on date). Rather than changing what counts as eligible
-- (removing the is_regression_fixture exemption would break the many
-- existing isolated tests that rely on the engine finding THEIR OWN
-- synthetic season), this adds a deterministic tiebreaker that always
-- prefers a REAL season over a regression-fixture one on an exact date
-- tie, then falls back to id for full determinism. This cannot change
-- any currently-passing scenario's outcome (there is no tie unless two
-- rows already share a starts_on), and it removes the specific failure
-- mode of "which of two same-dated seasons wins" ever being
-- plan-dependent again.
create or replace function internal.process_due_season_transitions()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_warn_at timestamptz;
  v_lookahead_at timestamptz;
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
    if v_anchor_starts_on is null then
      continue;
    end if;

    select s.id, s.starts_on, s.pre_season_starts_on, s.season_ref into v_to_season_id, v_to_starts_on, v_to_pre_season_starts_on, v_to_season_ref
    from public.seasons s
    where s.rugby_code = c.rugby_code
      and s.starts_on > v_anchor_starts_on
      and not exists (
        select 1 from public.season_transitions st
        where st.club_id = c.club_id and st.rugby_code = c.rugby_code and st.to_season_id = s.id and st.status = 'completed'
      )
    order by s.starts_on asc, is_regression_fixture asc, id asc limit 1;
    if v_to_season_id is null then
      continue;
    end if;

    v_lookahead_at := coalesce(v_to_pre_season_starts_on, v_to_starts_on)::timestamp at time zone c.timezone;
    if now() < v_lookahead_at - interval '24 hours' then
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
      if v_transition.status not in ('needs_attention') then
        update public.season_transitions
        set status = 'needs_attention', needs_attention_reason = format('No pre-season start date is configured for %s -- cannot determine the automatic team/cohort transition boundary. Configure it in Site Admin -> Seasons, then this will resume automatically.', v_to_season_ref), updated_at = now()
        where id = v_transition.id;
      end if;
      continue;
    end if;

    v_boundary := v_to_pre_season_starts_on::timestamp at time zone c.timezone;
    v_warn_at := v_boundary - interval '24 hours';

    if v_transition.status = 'prepared' and v_transition.rollover_id is null then
      v_transition.rollover_id := internal.generate_rollover_proposal_core(c.club_id, c.rugby_code, v_to_season_id, null);
      update public.season_transitions set rollover_id = v_transition.rollover_id, updated_at = now() where id = v_transition.id;
    end if;

    if v_transition.status = 'prepared' and v_transition.warning_sent_at is null then
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'season_transition_warning', 'Season handover tomorrow',
        format('Ovalball will automatically progress eligible age-grade teams into the %s season tomorrow. Teams requiring a decision will remain unchanged until reviewed.', v_to_season_ref),
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
        update public.season_transitions
        set status = 'needs_attention', needs_attention_reason = case when v_had_error then 'An error occurred while auto-confirming one or more teams -- see the technical detail.' else format('%s team(s) still need a manual decision. Review them in Season Rollover.', v_pending_count) end, updated_at = now()
        where id = v_transition.id;
        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'season_transition_needs_attention', 'Season handover needs your attention',
          format('The automatic season handover has run, but %s team(s) still need a manual decision (or hit an error). Review them in Season Handover.', v_pending_count),
          jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
        from public.club_memberships cm
        where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
      else
        update public.season_transitions set status = 'completed', applied_at = now(), needs_attention_reason = null, updated_at = now() where id = v_transition.id;
        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'season_transition_completed', 'Season handover complete',
          format('All eligible teams have automatically progressed into the %s season.', v_to_season_ref),
          jsonb_build_object('season_transition_id', v_transition.id, 'rollover_id', v_transition.rollover_id)
        from public.club_memberships cm
        where cm.club_id = c.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
      end if;
    end if;
  end loop;

  update public.season_transitions st
  set status = 'completed', applied_at = coalesce(st.applied_at, now()), needs_attention_reason = null, updated_at = now()
  where st.status = 'needs_attention'
    and st.rollover_id is not null
    and not exists (
      select 1 from public.age_grade_rollover_team_proposals p where p.rollover_id = st.rollover_id and p.decision = 'pending'
    );
end;
$$;

create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table(category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql
stable
as $$
declare
  v_team public.teams;
  v_current_season_id uuid;
  v_current_starts_on date;
  v_target_starts_on date;
  v_seasons_ahead integer;
  v_projected_age text;
  v_is_deterministic boolean;
  v_projected_display_name text;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    return;
  end if;

  return query
    select tsi.category, tsi.age_group, tsi.squad_designation, tsi.gender, tsi.display_name, false
    from public.team_season_identity tsi
    where tsi.team_id = p_team_id and tsi.season_id = p_season_id;
  if found then
    return;
  end if;

  select id into v_current_season_id
  from public.seasons
  where rugby_code = v_team.rugby_code and starts_on < current_date
  order by starts_on desc, is_regression_fixture asc, id asc limit 1;

  if v_current_season_id is null or v_current_season_id = p_season_id or v_team.category <> 'youth' or v_team.age_group is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select starts_on into v_current_starts_on from public.seasons where id = v_current_season_id;
  select starts_on into v_target_starts_on from public.seasons where id = p_season_id;

  if v_target_starts_on is null or v_current_starts_on is null or v_target_starts_on <= v_current_starts_on then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select count(*) into v_seasons_ahead
  from public.seasons
  where rugby_code = v_team.rugby_code
    and starts_on > v_current_starts_on and starts_on <= v_target_starts_on
    and (is_regression_fixture = false or id = p_season_id);

  select p.projected_age_group, p.is_deterministic
  into v_projected_age, v_is_deterministic
  from internal.project_team_identity(v_team.age_group, v_team.gender, v_seasons_ahead) p;

  if not v_is_deterministic or v_projected_age is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_projected_display_name := case when v_team.gender = 'girls' then 'Girls ' || v_projected_age else v_projected_age end
    || case when v_team.squad_designation is not null then ' ' || v_team.squad_designation else '' end;

  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender, v_projected_display_name, true;
end;
$$;
