-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: training attendance
-- (Section 19-25, 68, 96) -- extends the EXISTING canonical
-- public.player_fixture_attendance table (Side Project 1's fixture
-- attendance foundation, already present in this fork) into a polymorphic
-- activity-attendance table rather than building a second, parallel
-- attendance system. Chosen over a separate companion table (option B in
-- Section 20) because the extension is purely additive/relaxing --
-- fixture_id becomes nullable, one new nullable column is added, one
-- constraint is widened -- with zero risk to existing fixture attendance
-- rows or behaviour, and it means every existing piece of the domain
-- (status values, response_source values, RLS shape, the age/consent
-- resolver) is shared by construction rather than re-declared.
--
-- Naming decision, disclosed rather than silently done: the table keeps
-- its existing name `player_fixture_attendance` rather than being renamed
-- to something activity-agnostic. A rename would require updating every
-- existing fixture-attendance call site across the app for a purely
-- cosmetic gain; the real risk of that (in an already-large extension
-- pass) was judged higher than the cosmetic naming mismatch. Documented
-- again in docs/TRAINING_MANAGEMENT_ARCHITECTURE.md.

-- =====================================================================
-- PART A: polymorphic schema (Section 20 option A, safely additive).
-- =====================================================================
alter table public.player_fixture_attendance
  alter column fixture_id drop not null,
  add column training_session_id uuid references public.training_sessions(id);

alter table public.player_fixture_attendance
  add constraint player_fixture_attendance_activity_check check (num_nonnulls(fixture_id, training_session_id) = 1);

-- The pre-existing (fixture_id, player_id) unique constraint stays exactly
-- as-is (still enforced whenever fixture_id is set); a parallel unique
-- index makes the SAME "one response per player per occurrence" invariant
-- hold for the training case (Section 19: "tied to training_session_id +
-- player_id, not team_id + date").
create unique index player_fixture_attendance_training_unique
  on public.player_fixture_attendance (training_session_id, player_id)
  where training_session_id is not null;

create index player_fixture_attendance_training_session_id_idx
  on public.player_fixture_attendance (training_session_id) where training_session_id is not null;

comment on table public.player_fixture_attendance is 'Canonical activity-attendance table (Side Project 1 foundation, extended for Training Management): despite its name, one row is a player''s response to EITHER a fixture (fixture_id set) OR a training session (training_session_id set), never both -- num_nonnulls(fixture_id, training_session_id) = 1. Kept under its original name rather than renamed, to avoid touching every existing fixture-attendance call site for a cosmetic gain (see migration 20260930200000''s own header comment for the full rationale).';
comment on column public.player_fixture_attendance.training_session_id is 'Set for a training-session response; fixture_id is then null. Section 25: when the session is CANCELLED, no new response may be recorded (enforced in respond_to_training_attendance) -- existing rows are never deleted or altered by cancellation.';

-- =====================================================================
-- PART B: additive RLS -- a NEW policy for the training case, the
-- existing fixture-scoped policy is completely untouched (RLS SELECT
-- policies are OR'd, per this codebase's own established convention).
-- =====================================================================
create policy player_fixture_attendance_select_training_scoped on public.player_fixture_attendance
  for select using (
    training_session_id is not null and (
      internal.is_site_admin()
      or internal.is_active_player_guardian(player_id)
      or internal.is_own_linked_player(player_id)
      or exists (
        select 1 from public.training_sessions ts
        where ts.id = training_session_id
          and (
            internal.has_capability('team.attendance.view', 'team', ts.club_id, ts.team_id)
            or internal.has_capability('team.attendance.view', 'club', ts.club_id, null)
            or internal.can_manage_training(ts.club_id, ts.team_id)
          )
      )
    )
  );

-- =====================================================================
-- PART C: shared eligibility resolver (Section 20/24 -- "do not duplicate
-- age logic, call the existing resolver"). Extracted verbatim from
-- respond_to_attendance's own guardian/self/age/consent logic -- that
-- function is refactored below to call this instead of re-declaring it,
-- so fixture and training attendance are provably running the exact same
-- rule, not two copies that could quietly drift apart.
-- =====================================================================
create or replace function internal.resolve_attendance_response_source(p_player_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_is_guardian boolean;
  v_is_self boolean;
  v_age int;
begin
  v_is_guardian := exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = auth.uid() and status = 'active');
  v_is_self := exists (select 1 from public.players where id = p_player_id and user_id = auth.uid());

  if v_is_guardian then
    return 'guardian';
  elsif v_is_self then
    v_age := internal.player_effective_age(p_player_id);
    if v_age is null then
      raise exception 'Age could not be verified for self-service attendance.' using errcode = '42501';
    elsif v_age >= 18 then
      return 'player';
    elsif v_age in (16, 17) then
      if not internal.guardian_permission_effective(p_player_id, 'approve_own_attendance') then
        raise exception 'Guardian consent for self-attendance is not currently granted.' using errcode = '42501';
      end if;
      return 'player';
    else
      raise exception 'Players under 16 cannot respond to their own attendance.' using errcode = '42501';
    end if;
  else
    raise exception 'You are not authorized to respond to attendance for this player.' using errcode = '42501';
  end if;
end;
$function$;

comment on function internal.resolve_attendance_response_source is 'The ONE canonical age/consent/guardian eligibility resolver for activity attendance (Section 24: "do not invent a more permissive training rule... call the existing resolver"). Used identically by respond_to_attendance (fixture) and respond_to_training_attendance (training) -- under-16 blocked, 16-17 requires the existing approve_own_attendance consent grant, 18+ self-service, an active guardian always eligible.';

-- Refactor respond_to_attendance to call the shared resolver -- identical
-- external signature and behaviour, zero change for existing callers.
create or replace function public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source text;
  v_involved boolean;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  select exists (
    select 1 from public.fixtures f
    join public.player_team_memberships ptm on ptm.player_id = p_player_id and ptm.status = 'active'
    where f.id = p_fixture_id and ptm.team_id in (f.home_team_id, f.away_team_id)
  ) into v_involved;
  if not v_involved then
    raise exception 'This player is not associated with a team involved in this fixture.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$function$;

-- =====================================================================
-- PART D: respond_to_training_attendance -- the training-session
-- equivalent, same shared resolver, same table, own involvement check
-- (team_id direct match, or a Mini-Rugby-Group session's real component
-- teams via scheduling_group_members -- never a fabricated membership).
-- =====================================================================
create or replace function public.respond_to_training_attendance(p_training_session_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
  v_source text;
  v_involved boolean;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  -- Section 25: a cancelled session is read-only -- no new response needed or accepted.
  if s.status = 'CANCELLED' then
    raise exception 'This training session has been cancelled -- no attendance response is needed.' using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  select exists (
    select 1 from public.player_team_memberships ptm
    where ptm.player_id = p_player_id and ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
  ) into v_involved;
  if not v_involved then
    raise exception 'This player is not associated with the team training in this session.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
  values (p_training_session_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (training_session_id, player_id) where training_session_id is not null do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$function$;

revoke all on function public.respond_to_training_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.respond_to_training_attendance(uuid, uuid, text) to authenticated;

-- =====================================================================
-- PART E: the one canonical register per training_session_id (Section
-- 21, 47, 77) -- staff-authority-gated (team.attendance.view or
-- can_manage_training), same authority tier as the existing fixture
-- attendance summary panel. Eligible players are every active roster
-- member of the session's team (or every real component team of its
-- Mini-Rugby Group).
-- =====================================================================
create or replace function public.get_training_register(p_training_session_id uuid)
returns table (
  player_id uuid, first_name text, surname text,
  status text, response_source text, responded_by_user_id uuid, responded_at timestamptz
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not (
    internal.is_site_admin()
    or internal.has_capability('team.attendance.view', 'team', s.club_id, s.team_id)
    or internal.has_capability('team.attendance.view', 'club', s.club_id, null)
    or internal.can_manage_training(s.club_id, s.team_id)
  ) then
    raise exception 'You are not authorized to view this training register.' using errcode = '42501';
  end if;

  return query
  select p.id, p.first_name, p.surname, a.status, a.response_source, a.responded_by_user_id, a.updated_at
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  left join public.player_fixture_attendance a on a.training_session_id = p_training_session_id and a.player_id = p.id
  where ptm.status = 'active'
    and (
      (s.team_id is not null and ptm.team_id = s.team_id)
      or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
    )
  order by p.surname, p.first_name;
end;
$function$;

revoke all on function public.get_training_register(uuid) from public, anon;
grant execute on function public.get_training_register(uuid) to authenticated;
