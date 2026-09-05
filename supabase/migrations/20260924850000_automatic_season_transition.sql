-- AUTOMATIC SEASON TRANSITION (Mini-Rugby / Team Administration /
-- Season Handover brief, amendment): replaces a Club Admin having to
-- remember to open Season Rollover and confirm every team by hand with
-- a deterministic, idempotent, staged engine that runs on the club's
-- OWN business timezone (never a browser's local clock), warns 24
-- hours ahead, and only auto-confirms the teams the existing rollover
-- engine itself already treats as mechanical (requires_manual_choice =
-- false) -- a Mixed U11->U12 boundary or a U16-with-no-mapping team
-- still needs a human, exactly as it does today.

alter table public.clubs add column timezone text not null default 'Europe/London';
comment on column public.clubs.timezone is
  'IANA timezone this club''s season boundaries and other date-sensitive automation are evaluated in -- deliberately a real per-club column (not a hardcoded constant) even though every club in this product is currently UK-based, so a future non-UK club needs no schema change.';

-- A system-generated rollover (created by the automatic engine, not an
-- interactive Club Admin) has no real auth.uid() -- honestly recorded
-- as NULL rather than misattributed to whichever admin happens to be
-- logged in, or to a fabricated system user.
alter table public.age_grade_rollovers alter column created_by drop not null;

create table public.season_transitions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  from_season_id uuid references public.seasons(id),
  to_season_id uuid not null references public.seasons(id),
  status text not null default 'prepared' check (status in ('prepared', 'ready', 'applying', 'completed', 'needs_attention')),
  rollover_id uuid references public.age_grade_rollovers(id),
  warning_sent_at timestamptz,
  applied_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, rugby_code, to_season_id)
);

comment on table public.season_transitions is
  'One row per (club, rugby_code, to_season) automatic rollover attempt -- the unique constraint IS the idempotency guard: internal.process_due_season_transitions() can run as often as pg_cron likes without ever double-preparing, double-warning, or double-applying the same transition. status is a strict forward staged lifecycle: prepared (proposals generated) -> ready (24h warning sent) -> applying (boundary crossed, auto-confirming) -> completed (nothing left pending) or needs_attention (a manual-choice team, or an error, still needs a human) -- and needs_attention can still self-heal back to completed once a human finishes the outstanding proposals, without ever re-running the auto-confirm step on rows already decided.';

alter table public.season_transitions enable row level security;

create policy season_transitions_select on public.season_transitions
  for select using (internal.can_manage_club_fixtures(club_id) or internal.is_site_admin());

-- internal.generate_rollover_proposal_core: the REAL proposal-generation
-- logic, extracted byte-for-byte from the live public.generate_rollover_
-- proposal (pulled via pg_get_functiondef before writing this migration)
-- with the interactive authorization check and auth.uid() read replaced
-- by an explicit p_created_by parameter -- so the automatic engine and
-- the interactive "Generate proposal" button call the exact same
-- progression logic, never two maintained copies of it.
create or replace function internal.generate_rollover_proposal_core(p_club_id uuid, p_rugby_code text, p_to_season_id uuid, p_created_by uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
  select id into v_from_season_id from public.seasons where rugby_code = p_rugby_code and ends_on < (select starts_on from public.seasons where id = p_to_season_id) order by ends_on desc limit 1;

  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, p_created_by)
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null and age_group <> 'U6'
  loop
    v_next_age := internal.next_age_grade(t.age_group);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed' and v_next_age is not null and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');
    v_requires_manual := v_next_age is null or v_is_mixed_boundary;

    insert into public.age_grade_rollover_team_proposals (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (
      v_rollover_id, t.id, t.age_group,
      case when v_next_age is null then null else v_next_age end,
      v_requires_manual,
      v_is_mixed_boundary
    )
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade(mt.age_group)) into v_would_be_ages
    from public.scheduling_group_members sgm join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id, format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  return v_rollover_id;
end;
$$;

-- public.generate_rollover_proposal: unchanged signature/behaviour for
-- every existing caller (the interactive "Generate proposal" button) --
-- now just a thin authorization wrapper around the shared core above.
create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (internal.can_manage_club_fixtures(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;
  return internal.generate_rollover_proposal_core(p_club_id, p_rugby_code, p_to_season_id, auth.uid());
end;
$$;

-- internal.process_due_season_transitions: the automatic engine's one
-- entry point. Deliberately re-runnable on any schedule (pg_cron below
-- runs it every 15 minutes) -- every write it makes is guarded by
-- either the season_transitions unique constraint, a status check, or
-- confirm_rollover_team_proposal's own "already decided" guard, so
-- calling it twice in the same tick, or missing a tick entirely and
-- catching up on the next one, produces the same end state.
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
    -- Deliberately NOT "whatever resolve_season_for_date says is
    -- current, then the season after it": the instant the real
    -- calendar date reaches a season's starts_on, resolve_season_for_
    -- date (correctly, for every OTHER caller) starts reporting that
    -- NEW season as current -- which would make "current" and "to"
    -- collide at exactly the boundary moment this engine most needs to
    -- catch. Instead, walk the season chain directly: the transition
    -- to process is the EARLIEST season boundary that is due (starts
    -- within the next 24h, or has already passed) and not yet marked
    -- completed for this club -- correct whether this tick catches it
    -- right at the boundary, hours early, or days late after a missed
    -- cron run.
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
          perform public.confirm_rollover_team_proposal(v_proposal.id, 'confirm');
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

  -- Self-healing sweep: a transition parked at needs_attention because
  -- a Mixed/U16 team needed a human is not stuck forever -- once that
  -- human finishes deciding every outstanding proposal through the
  -- ordinary Season Rollover UI, the NEXT tick of this function
  -- (whenever it next runs) notices nothing is pending anymore and
  -- promotes the transition to completed, with no need to re-run the
  -- auto-confirm step on rows already decided.
  update public.season_transitions st
  set status = 'completed', applied_at = coalesce(st.applied_at, now()), updated_at = now()
  where st.status = 'needs_attention'
    and st.rollover_id is not null
    and not exists (
      select 1 from public.age_grade_rollover_team_proposals p where p.rollover_id = st.rollover_id and p.decision = 'pending'
    );
end;
$$;

-- Manual/test trigger -- a site admin can run the exact same engine on
-- demand (verifying it, or catching up a club that missed its window)
-- without needing to wait for or fake pg_cron's own clock.
create or replace function public.run_season_transition_check()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may manually trigger the season transition check.' using errcode = '42501';
  end if;
  perform internal.process_due_season_transitions();
end;
$$;

grant execute on function public.run_season_transition_check() to authenticated;

-- Local-only scheduling: on the real deployed system, provisioning
-- pg_cron (or an external scheduler calling an equivalent Edge
-- Function) on the REMOTE Supabase project is a deployment step for
-- whoever operates that project -- this migration only ever touches
-- the local database, consistent with this whole feature's standing
-- "no remote Supabase" constraint.
create extension if not exists pg_cron;
select cron.schedule('process-due-season-transitions', '*/15 * * * *', $$select internal.process_due_season_transitions()$$);
