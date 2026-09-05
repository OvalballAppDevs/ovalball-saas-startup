-- Bug found live-testing the future-fixture identity acceptance test
-- (Section 5/32): for a club's very FIRST-EVER transition (no
-- season_transitions history yet), the fallback anchor used
-- internal.resolve_season_for_date(rugby_code, yesterday) -- the SAME
-- resolver Calendar/Fixture display correctly use, which treats a
-- season as "current" the moment its PRE-SEASON starts. If the due
-- target season's own pre-season had already started by the time this
-- engine ever ran for that club, resolve_season_for_date would
-- immediately report the TARGET season itself as "current", making the
-- "next season after the anchor" search skip straight past it to look
-- for the season after THAT one -- the exact season that should have
-- been transitioned into was silently never selected.
--
-- Fixed by giving the first-run fallback its own, narrower query: the
-- most recent season whose MAIN season (never pre-season) has already
-- started -- correctly representing "which season this club's teams
-- are still structurally in until a real transition moves them",
-- distinct from resolve_season_for_date's calendar-display semantics.
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
      -- First-ever transition for this club: anchor to the most recent
      -- season whose MAIN season start has already occurred, never
      -- resolve_season_for_date's pre-season-aware "current" (which
      -- would wrongly treat an already-started-pre-season target as
      -- already current, skipping past it).
      select starts_on into v_anchor_starts_on
      from public.seasons
      where rugby_code = c.rugby_code and starts_on <= current_date
      order by starts_on desc limit 1;
    end if;
    if v_anchor_starts_on is null then
      continue;
    end if;

    -- The next season IN SEQUENCE (by main-season start ordering -- this
    -- is about which season comes next, unaffected by whether its
    -- pre-season date happens to be configured) that this engine has not
    -- already completed a transition for. Found unconditionally, not
    -- filtered by a due-window here, so a season missing
    -- pre_season_starts_on is never silently skipped forever -- it is
    -- evaluated below and explicitly flagged instead.
    select s.id, s.starts_on, s.pre_season_starts_on, s.season_ref into v_to_season_id, v_to_starts_on, v_to_pre_season_starts_on, v_to_season_ref
    from public.seasons s
    where s.rugby_code = c.rugby_code
      and s.starts_on > v_anchor_starts_on
      and not exists (
        select 1 from public.season_transitions st
        where st.club_id = c.club_id and st.rugby_code = c.rugby_code and st.to_season_id = s.id and st.status = 'completed'
      )
    order by s.starts_on asc limit 1;
    if v_to_season_id is null then
      continue;
    end if;

    -- Look-ahead: only start creating/advancing a transition record once
    -- we are genuinely approaching it -- using pre_season_starts_on when
    -- configured (the real boundary), or main-season start as the
    -- OUTER bound purely to decide WHEN to start paying attention and
    -- surface the missing-configuration problem, never as a substitute
    -- transition trigger.
    v_lookahead_at := coalesce(v_to_pre_season_starts_on, v_to_starts_on)::timestamp at time zone c.timezone;
    if now() < v_lookahead_at - interval '24 hours' then
      continue;
    end if;

    select id into v_current_season_id
    from public.seasons
    where rugby_code = c.rugby_code and starts_on <= v_anchor_starts_on
    order by starts_on desc limit 1;

    insert into public.season_transitions (club_id, rugby_code, from_season_id, to_season_id, status)
    values (c.club_id, c.rugby_code, v_current_season_id, v_to_season_id, 'prepared')
    on conflict (club_id, rugby_code, to_season_id) do nothing;

    select * into v_transition from public.season_transitions
    where club_id = c.club_id and rugby_code = c.rugby_code and to_season_id = v_to_season_id
    for update;

    -- Structural gap: no pre-season boundary configured for the target
    -- season. Never treated as "use main-season start instead" -- parked
    -- at needs_attention with the reason stated, and left there (the
    -- self-healing sweep at the end of this function only clears
    -- needs_attention once every pending PROPOSAL is decided, which
    -- never happens here since none was ever generated -- a Site Admin
    -- configuring the missing pre_season_starts_on and this function's
    -- next tick is what actually resolves this).
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
