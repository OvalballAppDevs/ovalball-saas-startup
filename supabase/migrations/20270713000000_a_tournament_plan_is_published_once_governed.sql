-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE F+G(partial): the governed tournament publication path,
-- plus the application/decision/cancellation notification producers the audit found entirely
-- missing. No RPC wrote tournament_plans.publication_state before this; the website's own test
-- fixtures faked it with a raw UPDATE. Mirrors the existing publish_regulatory_content_set shape
-- (20261029020000), the one other publish-RPC precedent in this codebase, and reuses
-- internal.can_manage_tournament -- the SAME authority every sibling tournament-planning RPC already
-- uses -- rather than inventing a host-only rule.

create or replace function public.publish_tournament_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_tournament_id uuid;
  v_age_group text;
begin
  select tournament_id, age_group into v_tournament_id, v_age_group
  from public.tournament_plans where id = p_plan_id;

  if v_tournament_id is null then
    raise exception 'Tournament plan not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_tournament(v_tournament_id) then
    raise exception 'You do not have permission to publish this tournament plan.' using errcode = '42501';
  end if;

  -- THE ONE READINESS GATE: nothing holistic existed to reuse (only per-field triggers), and "at
  -- least one game exists" is the natural minimum -- generation is what makes a plan real; publishing
  -- an empty plan would tell every participating side there is a schedule when there is none.
  if not exists (select 1 from public.tournament_games where plan_id = p_plan_id) then
    raise exception 'This plan has no games yet. Generate fixtures before publishing.' using errcode = '22023';
  end if;

  update public.tournament_plans
  set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(),
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id and publication_state = 'DRAFT';

  if not found then
    raise exception 'That plan is not in draft, or no longer exists.' using errcode = '22023';
  end if;

  perform internal.notify_tournament_participants(
    v_tournament_id, v_age_group, auth.uid(),
    'tournament_schedule_published',
    'Tournament schedule published',
    'The schedule for your tournament has been published.',
    jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
  );
end;
$function$;

revoke all on function public.publish_tournament_plan(uuid) from public;
grant execute on function public.publish_tournament_plan(uuid) to authenticated;

-- ===================================================================================================
-- THE SHARED BROADCAST HELPER: every currently-participating side's staff, resolved through the same
-- capability the write path itself checks -- `fixture.result.record`, the established "this person is
-- this side's fixture/tournament contact" rule used throughout the tournament domain
-- (internal.notify_tournament_result). p_age_group null means every age group in the tournament
-- (cancellation); a specific age_group scopes to one plan's own participants (publication, future
-- draw/schedule-change notifications). p_exclude_user lets the actor skip their own notification.
-- ===================================================================================================
create or replace function internal.notify_tournament_participants(
  p_tournament_id uuid,
  p_age_group text,
  p_exclude_user uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_host_club_id uuid;
begin
  select host_club_id into v_host_club_id from public.tournaments where id = p_tournament_id;
  if v_host_club_id is null then return; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct r.user_id, p_type, p_title, p_body, p_data
  from (
    select cm.user_id
    from public.tournament_participants tp
    join public.club_memberships cm on cm.club_id = tp.club_id and cm.status = 'active'
    where tp.tournament_id = p_tournament_id
      and (p_age_group is null or tp.age_group = p_age_group)
      and tp.status in ('added', 'accepted')
      and tp.club_id is not null
      and (coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'club',
                                                 tp.club_id, null, null, false, false)).allowed, false)
           or (tp.team_id is not null
               and coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'team',
                                                          tp.club_id, tp.team_id, null, false, false)).allowed, false)))
    union
    select ra.user_id
    from public.role_assignments ra
    where ra.club_id = v_host_club_id and ra.team_id is null
      and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') and ra.state = 'ACTIVE'
  ) r
  where r.user_id is not null
    and (p_exclude_user is null or r.user_id <> p_exclude_user)
    and internal.is_account_active(r.user_id);
end;
$function$;

revoke all on function internal.notify_tournament_participants(uuid, text, uuid, text, text, text, jsonb) from public;

-- ===================================================================================================
-- APPLICATION RECEIVED / DECIDED: apply_to_tournament and decide_tournament_application had no
-- notification of any kind -- an organiser could sit on an application forever with nothing telling
-- them it existed, and an applicant club was never told the outcome.
-- ===================================================================================================

create or replace function public.apply_to_tournament(p_tournament_id uuid, p_club_id uuid, p_age_group text, p_team_ids uuid[] DEFAULT NULL::uuid[], p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visibility text;
  v_id uuid;
  v_host_club_id uuid;
  v_applicant_name text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to enter this club into a tournament.' using errcode = '42501';
  end if;

  select visibility, host_club_id into v_visibility, v_host_club_id from public.tournaments where id = p_tournament_id;
  if v_visibility is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if v_visibility <> 'public' then
    raise exception 'This tournament is invite only.' using errcode = '42501';
  end if;

  insert into public.tournament_applications (tournament_id, club_id, age_group, applied_by, note)
  values (p_tournament_id, p_club_id, p_age_group, auth.uid(), p_note)
  on conflict (tournament_id, club_id, age_group)
    do update set status = 'pending', applied_by = auth.uid(), applied_at = now(), decided_by = null, decided_at = null, note = excluded.note, updated_at = now()
  returning id into v_id;

  delete from public.tournament_application_teams where application_id = v_id;
  insert into public.tournament_application_teams (application_id, team_id)
  select v_id, tid from unnest(coalesce(p_team_ids, '{}'::uuid[])) as tid
  on conflict do nothing;

  select cd.name into v_applicant_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id;

  insert into public.notifications (user_id, type, title, body, data)
  select ra.user_id, 'tournament_application_received', 'A club has applied to your tournament',
    format('%s has applied to enter age group %s.', coalesce(v_applicant_name, 'A club'), p_age_group),
    jsonb_build_object('tournament_id', p_tournament_id, 'tournament_application_id', v_id)
  from public.role_assignments ra
  where ra.club_id = v_host_club_id and ra.team_id is null
    and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') and ra.state = 'ACTIVE'
    and ra.user_id <> auth.uid()
    and internal.is_account_active(ra.user_id);

  return v_id;
end;
$function$;

create or replace function public.decide_tournament_application(p_application_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament uuid;
  v_host uuid;
  v_club uuid;
  v_directory uuid;
  v_age_group text;
  v_tournament_name text;
begin
  select a.tournament_id, t.host_club_id, a.club_id, a.age_group into v_tournament, v_host, v_club, v_age_group
  from public.tournament_applications a
  join public.tournaments t on t.id = a.tournament_id
  where a.id = p_application_id;

  if v_tournament is null then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_host, null, null) then
    raise exception 'Only the organiser can decide an application.' using errcode = '42501';
  end if;

  update public.tournament_applications
  set status = case when p_accept then 'accepted' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_application_id;

  if p_accept then
    select directory_id into v_directory from public.clubs where id = v_club;
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, status, invited_by, invited_at)
    select v_tournament, v_directory, v_club, at.team_id, 'added', auth.uid(), now()
    from public.tournament_application_teams at
    where at.application_id = p_application_id
    on conflict (tournament_id, club_directory_id, age_group, (coalesce(team_id::text, squad_label, ''::text))) do nothing;
  end if;

  select name into v_tournament_name from public.tournaments where id = v_tournament;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_application_decided',
    case when p_accept then 'Your tournament application was accepted' else 'Your tournament application was declined' end,
    format('Your application to %s (age group %s) was %s.', coalesce(v_tournament_name, 'the tournament'), v_age_group, case when p_accept then 'accepted' else 'declined' end),
    jsonb_build_object('tournament_id', v_tournament, 'tournament_application_id', p_application_id)
  from public.club_memberships cm
  where cm.club_id = v_club and cm.status = 'active'
    and (coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'club', v_club, null, null, false, false)).allowed, false))
    and cm.user_id <> auth.uid()
    and internal.is_account_active(cm.user_id);
end;
$function$;

-- ===================================================================================================
-- TOURNAMENT CANCELLED: mandatory, the same treatment fixture_cancelled already gets -- nobody should
-- be able to silence "the tournament you were travelling to is off".
-- ===================================================================================================
create or replace function public.cancel_tournament(p_tournament_id uuid, p_reason text DEFAULT NULL::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament_name text;
begin
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to cancel this tournament.' using errcode = '42501';
  end if;
  update public.tournaments set
    status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, now()),
    cancellation_reason = p_reason,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_tournament_id and cancelled_at is null;

  if not found then return; end if;

  delete from public.tournament_pitches
  where tournament_id = p_tournament_id and reserved_on >= current_date;

  select name into v_tournament_name from public.tournaments where id = p_tournament_id;

  perform internal.notify_tournament_participants(
    p_tournament_id, null, auth.uid(),
    'tournament_cancelled',
    'Tournament cancelled',
    format('%s has been cancelled.%s', coalesce(v_tournament_name, 'The tournament'), case when p_reason is not null then ' ' || p_reason else '' end),
    jsonb_build_object('tournament_id', p_tournament_id)
  );
end $function$;

-- ===================================================================================================
-- THE CATALOGUE
-- ===================================================================================================
insert into public.notification_types (type_key, topic_key, event_key) values
  ('tournament_schedule_published', 'tournaments', 'schedule_published'),
  ('tournament_application_received', 'tournaments', 'applications'),
  ('tournament_application_decided', 'tournaments', 'application_decisions');

insert into public.notification_types (type_key, topic_key, mandatory_override) values
  ('tournament_cancelled', 'tournaments', true);
