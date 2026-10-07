-- RECOVERY RECONCILIATION (Phase A). The crash-recovery session's migration-backlog attempt
-- applied two abandoned drafts (20270594, 20270595) on top of a live schema that had already been
-- built further forward directly against the database. Doing so regressed two functions back to
-- an earlier, less complete body. This migration restores only the lost behaviour, ported onto
-- the REAL live architecture -- participants keyed by age_group, never canonical_team_type_id (that
-- design was abandoned before 20270596-599 ever ran, which is why 20270598 is not simply reapplied
-- here).
--
-- 1. SET_TOURNAMENT_AGE_GROUPS: a dropped grade must take its sides with it. A host's own side and
--    a visiting club's side are the same kind of row in tournament_participants --
--    tournament_team_entries is a VIEW over those rows (filtered to the host's own team, with an
--    INSTEAD OF DELETE trigger that deletes the underlying tournament_participants row), so one
--    delete by age_group is the whole fix. No second table to cascade into.
--
-- 2. DECIDE_TOURNAMENT_APPLICATION: a settled application decided a second time (a double tap, a
--    retry) must not try to add the same side twice. tournament_participants_one_side_idx already
--    says what "the same side" means -- (tournament_id, club_directory_id, age_group,
--    coalesce(team_id, squad_label)) -- so the insert agrees with it via ON CONFLICT DO NOTHING
--    instead of letting the constraint surface as a raw, uncaught error.

create or replace function public.set_tournament_age_groups(
  p_tournament_id uuid,
  p_age_groups text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_dropped text[];
begin
  select host_club_id into v_club from public.tournaments where id = p_tournament_id;
  if v_club is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_club, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;

  select array_agg(g.age_group) into v_dropped
  from public.tournament_age_groups g
  where g.tournament_id = p_tournament_id
    and g.age_group <> all (coalesce(p_age_groups, '{}'::text[]));

  if v_dropped is not null then
    delete from public.tournament_participants
    where tournament_id = p_tournament_id and age_group = any(v_dropped);
  end if;

  delete from public.tournament_age_groups
  where tournament_id = p_tournament_id
    and age_group <> all (coalesce(p_age_groups, '{}'::text[]));

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select p_tournament_id, ag, auth.uid()
  from unnest(coalesce(p_age_groups, '{}'::text[])) as ag
  on conflict (tournament_id, age_group) do nothing;
end;
$function$;

revoke all on function public.set_tournament_age_groups(uuid, text[]) from public;
grant execute on function public.set_tournament_age_groups(uuid, text[]) to authenticated;

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
begin
  select a.tournament_id, t.host_club_id, a.club_id into v_tournament, v_host, v_club
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
    -- One participant per team the club put forward; status 'added' because by this point the
    -- organiser HAS agreed -- the request is answered and the row is an ordinary participant.
    -- ON CONFLICT DO NOTHING: deciding the same application accepted twice must not try to add the
    -- same side twice.
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, status, invited_by, invited_at)
    select v_tournament, v_directory, v_club, at.team_id, 'added', auth.uid(), now()
    from public.tournament_application_teams at
    where at.application_id = p_application_id
    on conflict (tournament_id, club_directory_id, age_group, (coalesce(team_id::text, squad_label, ''::text))) do nothing;
  end if;
end;
$function$;

revoke all on function public.decide_tournament_application(uuid, boolean) from public;
grant execute on function public.decide_tournament_application(uuid, boolean) to authenticated;
