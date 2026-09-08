-- A missing Gender can be supplied by the people entitled to supply it.
--
-- THE GAP THIS CLOSES
--
-- The Season Handover board correctly refuses to guess. A player with no
-- recorded playing pathway lands in Needs Attention with an honest sentence,
-- and the handover holds until somebody answers. But nobody could: there was
-- no route anywhere in Ovalball for setting it on an existing player, so the
-- only remedy was an UPDATE against the database. A blocker with no in-app
-- answer is not a safeguard, it is a dead end.
--
-- WHO MAY ANSWER IT, AND WHO MAY NOT
--
-- Gender is protected identity information about a child. The people entitled
-- to record it are the ones who already hold that relationship:
--
--   * an active guardian of the player
--   * an adult player, for themselves
--   * a Full Site Admin, which is existing deliberate authority
--
-- Deliberately NOT internal.can_manage_player. That function answers "does
-- this person run a team or club this player belongs to", which is a
-- fixture-and-roster authority. Letting a coach or fixture secretary record a
-- child's gender because they can pick the team would widen staff authority
-- over protected identity, which is exactly what must not happen here.
--
-- A Club Admin is not left helpless: they can ask. request_player_playing_pathway
-- notifies the player's guardians and records nothing about the child.

create or replace function internal.may_complete_player_profile(p_player_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select internal.is_active_player_guardian(p_player_id)
      or exists (select 1 from public.players p where p.id = p_player_id and p.user_id = auth.uid())
      or internal.is_full_site_admin();
$function$;

comment on function internal.may_complete_player_profile(uuid) is
  'Who may record protected identity information for a player: an active guardian, the adult player themselves, or a Full Site Admin. Deliberately not club or team staff.';

create or replace function public.set_player_playing_pathway(
  p_player_id uuid, p_playing_pathway text
) returns table(review_state text, reason text, resolved boolean)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_player public.players;
  r record;
  v_state text;
  v_reason text;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found.'; end if;

  if not internal.may_complete_player_profile(p_player_id) then
    raise exception 'Only this player''s guardian, the player themselves, or a Full Site Admin may record this information.'
      using errcode = '42501';
  end if;

  if p_playing_pathway is null or p_playing_pathway not in ('MALE', 'FEMALE') then
    raise exception 'Choose Boys or Girls. Rugby runs separate boys'' and girls'' age grades from Under-12, and Ovalball must never assume which one a player is registered in.'
      using errcode = '23514';
  end if;

  update public.players
  set playing_pathway = p_playing_pathway, updated_by = auth.uid(), updated_at = now()
  where id = p_player_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('players', p_player_id, 'update', auth.uid(),
    jsonb_build_object('playing_pathway_was_recorded', v_player.playing_pathway is not null),
    jsonb_build_object('event', 'PLAYER_PLAYING_PATHWAY_RECORDED'));

  -- Anything that was waiting on this answer is recalculated now, so the
  -- person who supplied it sees the result rather than being told to go and
  -- look somewhere else. Only handovers that have not run, and only the
  -- proposals nobody has decided.
  for r in
    select distinct ro.id
    from public.age_grade_rollovers ro
    join public.age_grade_rollover_player_proposals pp on pp.rollover_id = ro.id
    where pp.player_id = p_player_id and ro.applied_at is null and pp.placement_applied_at is null
  loop
    perform internal.refresh_rollover_player_proposals(r.id);
  end loop;

  select pp.review_state, pp.reason into v_state, v_reason
  from public.age_grade_rollover_player_proposals pp
  join public.age_grade_rollovers ro on ro.id = pp.rollover_id
  where pp.player_id = p_player_id and ro.applied_at is null
  order by pp.created_at desc
  limit 1;

  return query select v_state, v_reason, v_state = 'READY';
end;
$function$;

comment on function public.set_player_playing_pathway(uuid, text) is
  'Records a player''s playing pathway and recalculates whatever was waiting on it, returning the resolved handover outcome so the person who answered sees what it settled.';

create or replace function public.request_player_playing_pathway(p_player_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_player public.players;
  v_sent integer := 0;
begin
  select * into v_player from public.players where id = p_player_id;
  if not found then raise exception 'Player not found.'; end if;

  -- The club may ASK. It may not answer.
  if not (internal.can_manage_player(p_player_id) or internal.is_site_admin()) then
    raise exception 'Not authorised to contact this player''s guardians.' using errcode = '42501';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select g.guardian_user_id, 'player_information_requested', 'Playing information needed',
    format('%s''s club needs to know which playing pathway %s is registered in before next season''s teams can be confirmed. You can add it from Your Children.',
           v_player.first_name, v_player.first_name),
    jsonb_build_object('player_id', p_player_id)
  from public.guardians g
  where g.player_id = p_player_id and g.status = 'active';
  get diagnostics v_sent = row_count;

  return v_sent;
end;
$function$;

comment on function public.request_player_playing_pathway(uuid) is
  'Lets a club ask a player''s guardians for missing playing information. The club never records it -- asking is the whole of the club''s authority here.';

grant execute on function public.set_player_playing_pathway(uuid, text) to authenticated;
grant execute on function public.request_player_playing_pathway(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The board can point at the person who needs completing
-- ---------------------------------------------------------------------------
--
-- A Needs Attention row that names a player but carries no id leaves the
-- reader to go and find them. subject_id is the stable handle the board links
-- with; it is never a display string.

-- Both are dropped first: adding subject_id changes the row type, which
-- Postgres will not do in place.
drop function if exists public.handover_apply_blockers(uuid);
drop function if exists public.rollover_readiness(uuid);
drop function if exists public.handover_state(uuid);
drop function if exists internal.handover_apply_blockers_core(uuid);

create or replace function internal.handover_apply_blockers_core(p_rollover_id uuid)
returns table(kind text, subject text, detail text, subject_id uuid)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v record;
  v_norm record;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;

  if not exists (select 1 from public.seasons s where s.id = r.to_season_id and s.rugby_code = r.rugby_code) then
    return query select 'season', 'Target season',
      'The season this handover was prepared for is no longer in the canonical Seasons register. Check Site Admin -> Seasons.',
      null::uuid;
  end if;

  return query
  select 'team', t.display_name, 'This team has not been decided yet.', t.id
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where p.rollover_id = p_rollover_id and p.decision in ('pending', 'deferred');

  return query
  select 'collision', ip.label,
         format('More than one team is planned to be %s next season. One of those decisions has to change.', ip.label),
         null::uuid
  from internal.rollover_identity_plan(p_rollover_id) ip
  where ip.is_decided
  group by ip.canonical_team_type_id, ip.squad_designation, ip.label
  having count(*) > 1;

  return query
  select 'player', coalesce(pl.first_name || ' ' || pl.surname, 'A player'),
         coalesce(pp.reason, 'This placement has not been resolved.'), pl.id
  from public.age_grade_rollover_player_proposals pp
  join public.players pl on pl.id = pp.player_id
  where pp.rollover_id = p_rollover_id and pp.review_state <> 'READY';

  return query
  select 'dispensation', coalesce(pl.first_name || ' ' || pl.surname, 'A player'),
         'This placement requires governing-body approval, and no approved dispensation is recorded for the target season.',
         pl.id
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
        'This player''s age grade for the target season has changed since their placement was reviewed. Regenerate the proposals and review it again.',
        v.player_id;
    end if;
  end loop;

  return query
  select 'team', t.display_name,
         format('The recorded destination (%s) is no longer a valid identity for this team.', p.decided_age_group),
         t.id
  from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where p.rollover_id = p_rollover_id and p.decision = 'confirmed'
    and (p.decided_canonical_team_type_id is null or not t.active);
end;
$function$;

create or replace function public.handover_apply_blockers(p_rollover_id uuid)
returns table(kind text, subject text, detail text, subject_id uuid)
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

grant execute on function public.handover_apply_blockers(uuid) to authenticated;

-- Rebuilt unchanged: both read the blocker function, so both had to be dropped
-- to let its row type change.
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

grant execute on function public.handover_state(uuid) to authenticated;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_player_playing_pathway') ~ 'can_manage_player' then
    raise exception 'Recording protected player identity has been opened to club or team staff.';
  end if;
end $$;
