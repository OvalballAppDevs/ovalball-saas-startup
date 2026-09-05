-- Training calendar entries -- a real event/calendar model, never faked
-- as a fixture (no opponent, no result, exactly one of team_id/
-- scheduling_group_id so a shared U7/U8 group's training is ONE entry
-- blocking its shared resource, never duplicated into two independent
-- team sessions). Uses the same canonical club_pitches system fixtures
-- already use, so a pitch double-booked between a fixture and a training
-- session is at least visible on one shared pitch identity.

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  team_id uuid references public.teams(id),
  scheduling_group_id uuid references public.scheduling_groups(id),
  session_date date not null,
  start_time time,
  end_time time,
  pitch_id uuid references public.club_pitches(id),
  notes text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(team_id, scheduling_group_id) = 1),
  check (end_time is null or start_time is null or end_time > start_time)
);

comment on table public.training_sessions is
  'A real calendar/event entry, never a fake fixture -- no opponent, no result fields, no age-eligibility check (training is not a match). Exactly one of team_id/scheduling_group_id: an individual team''s own session, or ONE session for a shared mini-rugby group (never duplicated per member team).';

create index training_sessions_club_id_idx on public.training_sessions (club_id, session_date);
create index training_sessions_team_id_idx on public.training_sessions (team_id) where team_id is not null;
create index training_sessions_scheduling_group_id_idx on public.training_sessions (scheduling_group_id) where scheduling_group_id is not null;

alter table public.training_sessions enable row level security;

create policy training_sessions_select on public.training_sessions for select using (true);

create trigger set_updated_at before update on public.training_sessions
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update on public.training_sessions
  for each row execute function internal.audit_row_change();

-- Writes are RPC-only below.

create or replace function internal.can_manage_training(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select internal.is_site_admin()
    or internal.can_manage_club_fixtures(p_club_id)
    or (p_team_id is not null and internal.can_manage_team(p_team_id));
$$;

grant execute on function internal.can_manage_training(uuid, uuid) to authenticated;

create or replace function public.create_training_session(
  p_club_id uuid, p_team_id uuid, p_scheduling_group_id uuid, p_session_date date,
  p_start_time time default null, p_end_time time default null, p_pitch_id uuid default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not internal.can_manage_training(p_club_id, p_team_id) then
    raise exception 'Not authorized to schedule training for this club.' using errcode = '42501';
  end if;
  if num_nonnulls(p_team_id, p_scheduling_group_id) <> 1 then
    raise exception 'Training must belong to exactly one team or one shared mini-rugby group, never both.';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id) then
    raise exception 'That team does not belong to this club.';
  end if;
  if p_scheduling_group_id is not null and not exists (select 1 from public.scheduling_groups where id = p_scheduling_group_id and club_id = p_club_id and active) then
    raise exception 'That shared mini-rugby group does not belong to this club, or is not active.';
  end if;
  if p_pitch_id is not null and not exists (select 1 from public.club_pitches where id = p_pitch_id and club_id = p_club_id and active) then
    raise exception 'That pitch does not belong to this club, or is archived.';
  end if;

  insert into public.training_sessions (club_id, team_id, scheduling_group_id, session_date, start_time, end_time, pitch_id, notes, created_by, updated_by)
  values (p_club_id, p_team_id, p_scheduling_group_id, p_session_date, p_start_time, p_end_time, p_pitch_id, nullif(trim(p_notes), ''), auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_training_session(uuid, uuid, uuid, date, time, time, uuid, text) from public;
grant execute on function public.create_training_session(uuid, uuid, uuid, date, time, time, uuid, text) to authenticated;

create or replace function public.cancel_training_session(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) then
    raise exception 'Not authorized to cancel this training session.' using errcode = '42501';
  end if;

  update public.training_sessions set cancelled_at = now(), cancellation_reason = nullif(trim(p_reason), ''), updated_by = auth.uid() where id = p_session_id;
end;
$$;

revoke execute on function public.cancel_training_session(uuid, text) from public;
grant execute on function public.cancel_training_session(uuid, text) to authenticated;
