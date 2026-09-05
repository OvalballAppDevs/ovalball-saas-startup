-- Third bug found live-testing the Automatic Season Transition engine:
-- the previous migration's anchor fix used resolve_season_for_date(
-- rugby_code, current_date) as the fallback anchor for a club with no
-- season_transitions history yet -- but that has the EXACT SAME
-- instability as the original bug this whole engine exists to fix:
-- the instant today's date reaches a season's starts_on,
-- resolve_season_for_date correctly starts reporting THAT season as
-- current, which made the anchor and the transition target
-- indistinguishable at exactly the boundary moment this engine most
-- needs to catch (a club with no history whose very first tracked
-- boundary is today would never generate a transition at all, since
-- the "next season after the anchor" query would find nothing after
-- itself).
--
-- Fixed by resolving the fallback anchor against YESTERDAY instead of
-- today: yesterday is never ambiguous with a boundary starting at
-- today's midnight (no season in this product is ever less than a day
-- long), so the anchor stays stable exactly when it matters, while
-- still correctly reflecting "whatever season this club's teams have
-- actually been in" for every other day of the year.
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
  v_current_season_id uuid;
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
    select s.starts_on into v_anchor_starts_on
    from public.season_transitions st join public.seasons s on s.id = st.to_season_id
    where st.club_id = c.club_id and st.rugby_code = c.rugby_code and st.status = 'completed'
    order by s.starts_on desc limit 1;

    if v_anchor_starts_on is null then
      select starts_on into v_anchor_starts_on
      from public.seasons where id = internal.resolve_season_for_date(c.rugby_code, current_date - 1);
    end if;
    if v_anchor_starts_on is null then
      continue;
    end if;

    select s.id, s.starts_on into v_to_season_id, v_to_starts_on
    from public.seasons s
    where s.rugby_code = c.rugby_code
      and s.starts_on > v_anchor_starts_on
      and (s.starts_on::timestamp at time zone c.timezone) <= now() + interval '24 hours'
    order by s.starts_on asc limit 1;
    if v_to_season_id is null then
      continue;
    end if;

    select id into v_current_season_id
    from public.seasons
    where rugby_code = c.rugby_code and starts_on <= v_anchor_starts_on
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
