-- What this handover will do, and afterwards what it did.
--
-- Staged decisions need a language the old model never had to speak. Before
-- Apply, everything on the board is in the future tense: "U15 B will become
-- U16 B", "U12 will be created when this handover is applied". After Apply the
-- same facts are history. Both readings come from one place so the board
-- cannot describe a club's teams one way and its audit trail another.
--
-- Nothing here mutates. These are the read surfaces the board is built on.

-- The trigger that fills in canonical ids predates gendered and squad-level
-- decisions, and resolved a destination using the team's CURRENT gender. That
-- was survivable while Confirm mutated the team first; staged, the Mixed split
-- would have resolved its Boys destination against a Mixed team.
create or replace function internal.set_rollover_proposal_canonical_ids()
returns trigger
language plpgsql
as $function$
declare v_gender text; v_squad text;
begin
  select gender, squad_designation into v_gender, v_squad from public.teams where id = new.team_id;

  if new.from_canonical_team_type_id is null and new.current_age_group is not null then
    new.from_canonical_team_type_id := internal.resolve_canonical_team_type('youth', new.current_age_group, v_gender, null);
  end if;
  if new.proposed_to_canonical_team_type_id is null and new.proposed_age_group is not null then
    new.proposed_to_canonical_team_type_id := internal.resolve_canonical_team_type('youth', new.proposed_age_group, v_gender, null);
  end if;
  if new.decided_canonical_team_type_id is null and new.decided_age_group is not null then
    new.decided_canonical_team_type_id := internal.resolve_canonical_team_type(
      'youth', new.decided_age_group, coalesce(new.decided_gender, v_gender), coalesce(new.decided_squad_designation, v_squad));
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Readiness
-- ---------------------------------------------------------------------------
--
-- READY now means every decision exists and every one of them still stands up
-- against live state. It has never meant "some of it already happened", and
-- since the staged model it cannot.

drop function if exists public.rollover_readiness(uuid);

create or replace function public.rollover_readiness(p_rollover_id uuid)
returns table(
  teams_total integer, teams_decided integer, teams_progressing integer,
  teams_folding integer, teams_graduating integer, teams_pending integer,
  new_intake_teams integer, planned_teams integer,
  players_total integer, players_ready integer, players_needs_attention integer,
  players_blocked integer, players_club_holding integer, players_missing_dob integer,
  dispensations_pending integer, blocker_count integer,
  is_ready boolean, is_applied boolean, decisions_revision integer
)
language sql stable security definer set search_path to 'public'
as $function$
  select
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id)::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision not in ('pending','deferred'))::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'confirmed')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'folded')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision = 'graduated')::int,
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id and decision in ('pending','deferred'))::int,
    (select count(*) from public.age_grade_rollover_planned_teams where rollover_id = p_rollover_id and origin = 'U6_INTAKE')::int,
    (select count(*) from public.age_grade_rollover_planned_teams where rollover_id = p_rollover_id)::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id)::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'READY')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'NEEDS_ATTENTION')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and review_state = 'BLOCKED')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and allocation_status = 'CLUB_HOLDING')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and allocation_status = 'DOB_REQUIRED')::int,
    (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = p_rollover_id and movement_requirement = 'external_approval_required' and review_state <> 'READY')::int,
    (select count(*) from internal.handover_apply_blockers_core(p_rollover_id))::int,
    (select count(*) = 0 from internal.handover_apply_blockers_core(p_rollover_id)),
    (select applied_at is not null from public.age_grade_rollovers where id = p_rollover_id),
    (select decisions_revision from public.age_grade_rollovers where id = p_rollover_id);
$function$;

comment on function public.rollover_readiness(uuid) is
  'Where this handover stands. is_ready means every decision exists and still holds against live state -- never that part of it has already been carried out.';

-- ---------------------------------------------------------------------------
-- The lifecycle, read from the one state machine that already existed
-- ---------------------------------------------------------------------------

create or replace function public.handover_state(p_rollover_id uuid)
returns text
language sql stable security definer set search_path to 'public'
as $function$
  select case
    when (select applied_at from public.age_grade_rollovers where id = p_rollover_id) is not null then 'COMPLETED'
    when (select status from public.season_transitions where rollover_id = p_rollover_id) = 'applying' then 'APPLYING'
    when not exists (select 1 from public.age_grade_rollover_team_proposals where rollover_id = p_rollover_id) then 'PREPARING'
    when exists (select 1 from internal.handover_apply_blockers_core(p_rollover_id)) then 'REVIEW_REQUIRED'
    else 'READY'
  end;
$function$;

comment on function public.handover_state(uuid) is
  'PREPARING / REVIEW_REQUIRED / READY / APPLYING / COMPLETED, derived from the decisions and season_transitions rather than from a second state machine.';

-- ---------------------------------------------------------------------------
-- Consequences
-- ---------------------------------------------------------------------------
--
-- One row per thing this handover will do -- or, once applied, did. The board's
-- Overview, its Teams section and the Apply confirmation all read this, so the
-- three cannot drift apart, and the wording stays in the right tense because
-- the tense is decided here rather than in three components.

create or replace function public.handover_consequences(p_rollover_id uuid)
returns table(
  kind text, subject_team_id uuid, planned_id uuid, proposal_id uuid,
  from_label text, to_label text, note text, is_applied boolean, sort_key text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare r public.age_grade_rollovers;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to view this handover.' using errcode = '42501';
  end if;

  -- Teams carrying on. The same cohort, the same team id, a new age grade
  -- around it -- never a delete and a create.
  return query
  select 'progress', p.team_id, null::uuid, p.id,
         coalesce(fi.display_name, t.display_name),
         internal.compute_team_display_name('youth', p.decided_age_group,
           coalesce(p.decided_gender, t.gender), coalesce(p.decided_squad_designation, t.squad_designation)),
         null::text, p.applied_at is not null,
         coalesce(p.current_age_group, '') || coalesce(t.squad_designation, '')
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  left join lateral (
    select tsi.display_name from public.team_season_identity tsi
    where tsi.team_id = p.team_id and tsi.season_id = r.from_season_id
  ) fi on true
  where p.rollover_id = p_rollover_id and p.decision = 'confirmed';

  return query
  select 'graduate', p.team_id, null::uuid, p.id,
         coalesce(fi.display_name, t.display_name), null::text,
         'Youth pathway complete. These players move to the club''s holding list -- Ovalball never assigns a senior team automatically.',
         p.applied_at is not null,
         coalesce(p.current_age_group, '')
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  left join lateral (
    select tsi.display_name from public.team_season_identity tsi
    where tsi.team_id = p.team_id and tsi.season_id = r.from_season_id
  ) fi on true
  where p.rollover_id = p_rollover_id and p.decision = 'graduated';

  return query
  select 'fold', p.team_id, null::uuid, p.id,
         coalesce(fi.display_name, t.display_name), null::text,
         coalesce(p.fold_reason, 'Not continuing next season.'),
         p.applied_at is not null,
         coalesce(p.current_age_group, '')
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  left join lateral (
    select tsi.display_name from public.team_season_identity tsi
    where tsi.team_id = p.team_id and tsi.season_id = r.from_season_id
  ) fi on true
  where p.rollover_id = p_rollover_id and p.decision = 'folded';

  -- Teams the club has decided to run. Nothing exists yet, and the wording has
  -- to keep saying so until Apply.
  return query
  select case when pt.applied_at is not null and pt.reactivated then 'reactivated'
              when pt.applied_at is not null then 'created'
              else 'plan' end,
         pt.created_team_id, pt.id, pt.source_proposal_id,
         null::text,
         ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end,
         case pt.origin
           when 'U6_INTAKE' then 'The new intake needs a team once this season''s U6 cohort has moved up.'
           when 'MIXED_SPLIT' then 'The girls in the Mixed cohort need their own side from this age grade on.'
           else 'Players need a team at this age grade that the club does not currently run.'
         end,
         pt.applied_at is not null,
         coalesce(ctt.age_group, '') || coalesce(pt.squad_designation, '')
  from public.age_grade_rollover_planned_teams pt
  join public.canonical_team_types ctt on ctt.id = pt.canonical_team_type_id
  where pt.rollover_id = p_rollover_id;
end;
$function$;

comment on function public.handover_consequences(uuid) is
  'One row per thing this handover will do -- or, once applied, did. The board''s Overview, Teams and Apply surfaces all read this so they cannot describe the same club differently.';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function public.handover_audit(p_rollover_id uuid)
returns table(
  at timestamptz, event text, actor_name text, detail jsonb
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare r public.age_grade_rollovers;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to view this handover.' using errcode = '42501';
  end if;

  return query
  select al.changed_at,
         coalesce(al.after->>'event', al.action),
         coalesce(nullif(trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'')), ''), 'Ovalball'),
         al.after
  from public.audit_log al
  left join public.profiles pr on pr.id = al.changed_by
  where al.after->>'rollover_id' = p_rollover_id::text
  order by al.changed_at asc;
end;
$function$;

comment on function public.handover_audit(uuid) is
  'Every decision and every consequence recorded against this handover, in the order they happened.';

grant execute on function public.handover_state(uuid) to authenticated;
grant execute on function public.handover_consequences(uuid) to authenticated;
grant execute on function public.handover_audit(uuid) to authenticated;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rollover_readiness') !~ 'handover_apply_blockers_core' then
    raise exception 'Readiness is not computed from live revalidation.';
  end if;
end $$;
