-- Venue integration gap: tournaments had pitch_id/venue_notes (free text)
-- but no structured venue_id -- the host got no Venue selector/default the
-- way ordinary fixture creation already does, and there was no way to
-- change a tournament's venue after creation with accepted participants
-- correctly notified. Mirrors fixtures.venue_id and the existing
-- pitch-belongs-to-host trigger pattern exactly (section 3 of
-- 20260904900000).

alter table public.tournaments
  add column venue_id uuid references public.venues(id);

comment on column public.tournaments.venue_id is
  'The host club''s chosen venue for this tournament -- defaults to the host''s default_home venue in the UI, always overridable. One master value on the tournament event itself, never copied per participant.';

-- ============================================================
-- Venue-belongs-to-host guard, identical in shape to
-- internal.validate_tournament_pitch_ownership.
-- ============================================================

create or replace function internal.validate_tournament_venue_ownership() returns trigger
language plpgsql
as $$
begin
  if new.venue_id is not null then
    if new.host_club_id is null then
      raise exception 'A venue can only be set once the host club is confirmed.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.venues v where v.id = new.venue_id and v.club_id = new.host_club_id) then
      raise exception 'That venue does not belong to this tournament''s host club.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_validate_venue_ownership on public.tournaments;
create trigger tournaments_validate_venue_ownership
  before insert or update of venue_id, host_club_id on public.tournaments
  for each row execute function internal.validate_tournament_venue_ownership();

-- ============================================================
-- create_tournament gains p_venue_id -- identical shape to
-- 20260904900000's definition, appended as the last optional parameter
-- so no existing caller needs to change. `create or replace function`
-- does NOT replace a function whose parameter list differs -- it creates
-- a second overload, leaving the original 7-arg signature callable
-- alongside this new 8-arg one and making every 2-6-arg call (every
-- existing caller that relies on the trailing defaults) genuinely
-- ambiguous ("function ... is not unique"), confirmed by the regression
-- suite. The old signature must be dropped explicitly first.
-- ============================================================

drop function if exists public.create_tournament(uuid, date, time, uuid, uuid, text, text);

create or replace function public.create_tournament(
  p_host_team_id uuid, p_event_date date, p_kickoff_time time default null,
  p_pitch_id uuid default null, p_competition_edition_id uuid default null,
  p_venue_notes text default null, p_notes text default null, p_venue_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_club_id uuid;
  v_host_directory_id uuid;
  v_rugby_code text;
  v_tournament_id uuid;
begin
  select t.club_id, t.rugby_code into v_host_club_id, v_rugby_code from public.teams t where t.id = p_host_team_id;
  if v_host_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not internal.can_manage_team(p_host_team_id) then
    raise exception 'You are not authorised to create a tournament for this team.' using errcode = '42501';
  end if;

  select c.directory_id into v_host_directory_id from public.clubs c where c.id = v_host_club_id;

  insert into public.tournaments (
    host_club_id, host_team_id, host_directory_id, rugby_code, event_date, kickoff_time,
    pitch_id, venue_id, competition_edition_id, venue_notes, notes, status, created_by, updated_by
  )
  values (
    v_host_club_id, p_host_team_id, v_host_directory_id, v_rugby_code, p_event_date, p_kickoff_time,
    p_pitch_id, p_venue_id, p_competition_edition_id, p_venue_notes, p_notes, 'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournaments', v_tournament_id, 'insert', auth.uid(), jsonb_build_object('host_team_id', p_host_team_id, 'event_date', p_event_date));

  return v_tournament_id;
end;
$$;

revoke execute on function public.create_tournament(uuid, date, time, uuid, uuid, text, text, uuid) from public;
grant execute on function public.create_tournament(uuid, date, time, uuid, uuid, text, text, uuid) to authenticated;

-- ============================================================
-- update_tournament_venue: the host may change the venue after creation
-- (Section 29 of the Venue instruction) -- same master tournaments row,
-- never a new tournament. Every currently-ACCEPTED participant's Club
-- Admins/Fixtures Secretaries get a notification, mirroring the existing
-- fixture_request_accepted notification's own club_memberships lookup
-- pattern (20260831140000).
-- ============================================================

create or replace function public.update_tournament_venue(p_tournament_id uuid, p_venue_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.tournaments;
  v_venue_name text;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found.'; end if;

  if not (internal.is_site_admin()
          or (v_t.host_club_id is not null and internal.can_manage_club_fixtures(v_t.host_club_id))
          or (v_t.host_team_id is not null and internal.can_manage_team(v_t.host_team_id))) then
    raise exception 'Only the host club may change this tournament''s venue.' using errcode = '42501';
  end if;

  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and club_id = v_t.host_club_id and active) then
    raise exception 'That venue does not belong to this tournament''s host club, or is not active.' using errcode = '23514';
  end if;

  update public.tournaments set venue_id = p_venue_id, updated_by = auth.uid(), updated_at = now() where id = p_tournament_id;

  select name into v_venue_name from public.venues where id = p_venue_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('tournaments', p_tournament_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', v_t.venue_id), jsonb_build_object('venue_id', p_venue_id));

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_venue_changed', 'Tournament venue changed',
    format('The venue for the tournament on %s has changed%s.', to_char(v_t.event_date, 'DD Mon YYYY'),
      case when v_venue_name is not null then format(' to %s', v_venue_name) else '' end),
    jsonb_build_object('tournament_id', p_tournament_id, 'venue_id', p_venue_id)
  from public.tournament_participants tp
  join public.club_memberships cm on cm.club_id = tp.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  where tp.tournament_id = p_tournament_id and tp.status = 'accepted' and tp.club_id is not null;
end;
$$;

revoke execute on function public.update_tournament_venue(uuid, uuid) from public;
grant execute on function public.update_tournament_venue(uuid, uuid) to authenticated;

-- ============================================================
-- club_visible_tournaments re-issued, unchanged, so its `select distinct
-- t.*` re-expands to include the new venue_id column -- a bare `alter
-- table add column` does NOT retroactively widen an existing view's
-- already-expanded `*` (Postgres freezes the column list at view
-- creation/replace time), confirmed directly against this exact view.
-- ============================================================

create or replace view public.club_visible_tournaments
  with (security_invoker = true) as
select distinct t.*
from public.tournaments t
where t.status in ('confirmed', 'completed')
  and (
    (t.host_club_id is not null and internal.can_manage_club_fixtures(t.host_club_id))
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = t.id and tp.status = 'accepted'
        and ((tp.team_id is not null and internal.can_manage_team(tp.team_id))
             or (tp.club_id is not null and internal.can_manage_club_fixtures(tp.club_id)))
    )
  );
