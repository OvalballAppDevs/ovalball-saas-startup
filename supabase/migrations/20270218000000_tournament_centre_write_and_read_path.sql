-- =====================================================================
-- TOURNAMENT CENTRE -- THE WRITE PATH AND THE ONE READ
--
-- Every mutation is a SECURITY DEFINER RPC because the authority split is
-- not expressible as a single row policy: changing the occasion needs
-- authority over every team attending, changing one team's day needs
-- authority over that team. The tables carry SELECT policies and no write
-- policies at all, so a crafted PostgREST insert has nothing to land on.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. THE PARENT CONSTRAINT THAT ASSUMED ONE HOST TEAM
-- ---------------------------------------------------------------------
-- tournaments_host_confirmed_requires_team demanded a host_club_id AND a
-- host_team_id on every confirmed tournament. That was right when a
-- tournament was one host team inviting others. It is wrong now for two
-- ordinary cases: a club attending a festival at an off-platform ground
-- (there is no host club on Ovalball to name), and a club hosting with two
-- of its own teams (there is no single host team). Which of our teams are
-- attending is now tournament_team_entries' job.
--
-- What remains genuinely true is narrower, and is kept: a host TEAM implies
-- a host CLUB.
alter table public.tournaments drop constraint if exists tournaments_host_confirmed_requires_team;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_host_team_implies_club') then
    alter table public.tournaments
      add constraint tournaments_host_team_implies_club check (host_team_id is null or host_club_id is not null);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. CREATE / EDIT THE OCCASION
-- ---------------------------------------------------------------------
create or replace function public.save_tournament(
  p_tournament_id uuid,
  p_club_id       uuid,
  p_name          text,
  p_starts_on     date,
  p_ends_on       date,
  p_rugby_code    text,
  p_season_id     uuid default null,
  p_host_directory_id uuid default null,
  p_venue_id      uuid default null,
  p_venue_notes   text default null,
  p_notes         text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_club_directory uuid;
  v_host_directory uuid;
  v_host_club uuid;
  v_season uuid;
  v_club_code text;
begin
  if p_tournament_id is null then
    -- CREATING. Authority is the club's, because entering a club into a
    -- tournament commits that club's teams, pitches and Saturday.
    if not (internal.is_site_admin() or internal.has_capability('calendar.manage', 'club', p_club_id, null)) then
      raise exception 'You do not have permission to create a tournament for this club.' using errcode = '42501';
    end if;
  else
    if not internal.can_manage_tournament(p_tournament_id) then
      raise exception 'You do not have permission to change this tournament.' using errcode = '42501';
    end if;
    if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
      raise exception 'This tournament has been cancelled and can no longer be changed.' using errcode = '42501';
    end if;
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'A tournament cannot finish before it starts.' using errcode = '22023';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'A tournament must be Rugby Union or Rugby League.' using errcode = '22023';
  end if;

  select c.directory_id into v_club_directory from public.clubs c where c.id = p_club_id;
  if v_club_directory is null then
    raise exception 'That club does not exist.' using errcode = '23503';
  end if;

  -- RUGBY CODE ISOLATION at the door: a club plays one code, and a tournament
  -- in the other code is not a filter problem, it is a different sport.
  select cd.rugby_code into v_club_code from public.club_directory cd where cd.id = v_club_directory;
  if v_club_code is not null and v_club_code <> p_rugby_code then
    raise exception 'This club plays % -- it cannot run a % tournament.', v_club_code, p_rugby_code using errcode = '23514';
  end if;

  -- WHOSE GROUND. Default to this club's own; an away festival names the
  -- canonical directory identity of the club hosting it. Never free text.
  v_host_directory := coalesce(p_host_directory_id, v_club_directory);
  select c.id into v_host_club from public.clubs c where c.directory_id = v_host_directory;

  -- THE SEASON COMES FROM THE CANONICAL REGISTER, never from the date with a
  -- month boundary written into this function. If Site Admin has not recorded
  -- a season covering these dates, that is a gap to surface, not to invent.
  v_season := p_season_id;
  if v_season is null then
    select s.id into v_season from public.seasons s
    where s.rugby_code = p_rugby_code and p_starts_on between s.starts_on and s.ends_on
    order by s.starts_on desc limit 1;
  end if;

  if p_tournament_id is null then
    insert into public.tournaments (
      name, host_directory_id, host_club_id, rugby_code, season_id,
      event_date, ends_on, venue_id, venue_notes, notes, status, created_by, updated_by
    ) values (
      btrim(p_name), v_host_directory, v_host_club, p_rugby_code, v_season,
      p_starts_on, p_ends_on, p_venue_id, p_venue_notes, p_notes, 'confirmed', auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.tournaments set
      name = btrim(p_name),
      host_directory_id = v_host_directory,
      host_club_id = v_host_club,
      rugby_code = p_rugby_code,
      season_id = v_season,
      event_date = p_starts_on,
      ends_on = p_ends_on,
      venue_id = p_venue_id,
      venue_notes = p_venue_notes,
      notes = p_notes,
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_tournament_id
    returning id into v_id;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. OUR TEAMS
-- ---------------------------------------------------------------------
create or replace function public.add_tournament_team_entry(
  p_tournament_id uuid,
  p_team_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
  v_id uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'That team does not exist.' using errcode = '23503';
  end if;
  -- ENTERING A TEAM IS THAT TEAM'S DECISION. Club-scope authority enters any
  -- of the club's teams; team-scope authority enters exactly its own. This is
  -- what stops a U12 manager entering U13.
  if not (
    internal.is_site_admin()
    or internal.has_capability('calendar.manage', 'club', v_club, null)
    or internal.has_capability('calendar.manage', 'team', v_club, p_team_id)
  ) then
    raise exception 'You do not have permission to enter that team into a tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;

  insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by, updated_by)
  values (p_tournament_id, p_team_id, v_club, auth.uid(), auth.uid())
  on conflict (tournament_id, team_id) do update set updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_tournament_team_entry(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not internal.can_manage_tournament_entry(p_entry_id) then
    raise exception 'You do not have permission to withdraw that team.' using errcode = '42501';
  end if;
  delete from public.tournament_team_entries where id = p_entry_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. WHO THAT TEAM PLAYS
-- ---------------------------------------------------------------------
-- Records an opposition identity against ONE of our teams. The identity
-- itself lives where it always has -- tournament_participants -- so there is
-- no second opponent model to disagree with the first. Recording who we
-- played is our own club's business and needs only entry authority;
-- INVITING another Ovalball club (which notifies them) remains the host's
-- action through the existing invite_tournament_participant.
create or replace function public.record_tournament_opponent(
  p_entry_id uuid,
  p_club_directory_id uuid,
  p_canonical_team_type_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tournament uuid;
  v_participant uuid;
  v_club uuid;
  v_dir_code text;
  v_tournament_code text;
  v_id uuid;
begin
  if not internal.can_manage_tournament_entry(p_entry_id) then
    raise exception 'You do not have permission to change that team''s opponents.' using errcode = '42501';
  end if;
  select e.tournament_id into v_tournament from public.tournament_team_entries e where e.id = p_entry_id;
  if v_tournament is null then
    raise exception 'That tournament entry does not exist.' using errcode = '23503';
  end if;

  select t.rugby_code into v_tournament_code from public.tournaments t where t.id = v_tournament;
  select cd.rugby_code into v_dir_code from public.club_directory cd where cd.id = p_club_directory_id;
  if v_dir_code is null then
    raise exception 'That club is not in the Club Directory.' using errcode = '23503';
  end if;
  if v_dir_code <> v_tournament_code then
    raise exception 'A % club cannot be an opponent in a % tournament.', v_dir_code, v_tournament_code using errcode = '23514';
  end if;

  -- Reuse the existing participant row where the host already invited them,
  -- so an accepted invitation and "who we played" are the same record.
  select tp.id into v_participant from public.tournament_participants tp
  where tp.tournament_id = v_tournament
    and tp.club_directory_id = p_club_directory_id
    and tp.canonical_team_type_id = p_canonical_team_type_id;

  if v_participant is null then
    -- NEVER A FAKE CLUBS ROW. club_id is filled only where that directory
    -- entry is genuinely an activated Ovalball club; otherwise the canonical
    -- directory identity alone is the truth.
    select c.id into v_club from public.clubs c where c.directory_id = p_club_directory_id and c.status = 'active';
    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, canonical_team_type_id, status, invited_by
    ) values (
      v_tournament, p_club_directory_id, v_club, p_canonical_team_type_id, 'external_recorded', auth.uid()
    ) returning id into v_participant;
  end if;

  insert into public.tournament_entry_opponents (entry_id, participant_id, sort_order)
  values (p_entry_id, v_participant,
          coalesce((select max(sort_order) + 1 from public.tournament_entry_opponents where entry_id = p_entry_id), 0))
  on conflict (entry_id, participant_id) do update set sort_order = tournament_entry_opponents.sort_order
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_tournament_opponent(p_opponent_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  select o.entry_id into v_entry from public.tournament_entry_opponents o where o.id = p_opponent_id;
  if v_entry is null then return; end if;
  if not internal.can_manage_tournament_entry(v_entry) then
    raise exception 'You do not have permission to change that team''s opponents.' using errcode = '42501';
  end if;
  delete from public.tournament_entry_opponents where id = p_opponent_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. THAT TEAM'S GAMES
-- ---------------------------------------------------------------------
create or replace function public.save_tournament_game(
  p_game_id uuid,
  p_entry_id uuid,
  p_opponent_id uuid,
  p_game_date date,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_pitch_id uuid default null,
  p_status text default 'SCHEDULED',
  p_our_score integer default null,
  p_opponent_score integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tournament uuid;
  v_id uuid;
  v_existing_entry uuid;
begin
  if p_game_id is not null then
    select g.entry_id into v_existing_entry from public.tournament_games g where g.id = p_game_id;
    if v_existing_entry is null then
      raise exception 'That game does not exist.' using errcode = '23503';
    end if;
    -- Authority over the game as it stands AND as it would become, so a game
    -- can never be moved out of one team's day into another's by somebody who
    -- only holds one of the two.
    if not internal.can_manage_tournament_entry(v_existing_entry) then
      raise exception 'You do not have permission to change that team''s schedule.' using errcode = '42501';
    end if;
  end if;
  if not internal.can_manage_tournament_entry(p_entry_id) then
    raise exception 'You do not have permission to change that team''s schedule.' using errcode = '42501';
  end if;

  select e.tournament_id into v_tournament from public.tournament_team_entries e where e.id = p_entry_id;
  if v_tournament is null then
    raise exception 'That tournament entry does not exist.' using errcode = '23503';
  end if;
  if exists (select 1 from public.tournaments t where t.id = v_tournament and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  if p_status not in ('SCHEDULED', 'CANCELLED', 'PLAYED') then
    raise exception 'That is not a valid game status.' using errcode = '22023';
  end if;

  if p_game_id is null then
    insert into public.tournament_games (
      tournament_id, entry_id, opponent_id, game_date, start_time, duration_minutes,
      pitch_id, status, sort_order, our_score, opponent_score, created_by, updated_by
    ) values (
      v_tournament, p_entry_id, p_opponent_id, p_game_date, p_start_time, p_duration_minutes,
      p_pitch_id, p_status,
      coalesce((select max(sort_order) + 1 from public.tournament_games where entry_id = p_entry_id), 0),
      p_our_score, p_opponent_score, auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.tournament_games set
      tournament_id = v_tournament,
      entry_id = p_entry_id,
      opponent_id = p_opponent_id,
      game_date = p_game_date,
      start_time = p_start_time,
      duration_minutes = p_duration_minutes,
      pitch_id = p_pitch_id,
      status = p_status,
      our_score = p_our_score,
      opponent_score = p_opponent_score,
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_game_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_tournament_game(p_game_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  select g.entry_id into v_entry from public.tournament_games g where g.id = p_game_id;
  if v_entry is null then return; end if;
  if not internal.can_manage_tournament_entry(v_entry) then
    raise exception 'You do not have permission to change that team''s schedule.' using errcode = '42501';
  end if;
  delete from public.tournament_games where id = p_game_id;
end $$;

-- ---------------------------------------------------------------------
-- 5. THE PITCHES THE OCCASION HOLDS
-- ---------------------------------------------------------------------
-- PARENT authority, not entry authority. Holding Pitch 2 from 09:30 to 14:00
-- takes it away from every other team at the club, so it is never one
-- attending team's decision.
create or replace function public.reserve_tournament_pitch(
  p_tournament_id uuid,
  p_pitch_id uuid,
  p_reserved_on date,
  p_start_time time,
  p_end_time time
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to reserve pitches for this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (p_tournament_id, p_pitch_id, p_reserved_on, p_start_time, p_end_time, auth.uid())
  on conflict (tournament_id, pitch_id, reserved_on, start_time)
    do update set end_time = excluded.end_time
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.release_tournament_pitch(p_reservation_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tournament uuid;
begin
  select tp.tournament_id into v_tournament from public.tournament_pitches tp where tp.id = p_reservation_id;
  if v_tournament is null then return; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to release this tournament''s pitches.' using errcode = '42501';
  end if;
  delete from public.tournament_pitches where id = p_reservation_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. CANCELLATION
-- ---------------------------------------------------------------------
-- History is kept and shown as cancelled; it is never deleted. Future pitch
-- reservations ARE released, because a cancelled tournament is not using the
-- pitch and leaving it held would block a Saturday nobody is playing on.
create or replace function public.cancel_tournament(p_tournament_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
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

  delete from public.tournament_pitches
  where tournament_id = p_tournament_id and reserved_on >= current_date;
end $$;

-- ---------------------------------------------------------------------
-- 7. THE ONE READ
-- ---------------------------------------------------------------------
-- ONE round trip for the whole surface. Tournament Centre is one shared
-- role-aware surface, so the ROLE is resolved here, server-side, and arrives
-- as capability flags on the payload -- the components never assemble
-- authority themselves, and never receive data the viewer may not see.
-- Bounded by construction: no query per opponent, game, pitch or team.
create or replace function public.get_tournament_centre(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_can_manage boolean;
begin
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;
  v_can_manage := internal.can_manage_tournament(p_tournament_id);

  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'rugbyCode', t.rugby_code,
    'startsOn', t.event_date,
    'endsOn', t.ends_on,
    'status', t.status,
    'cancelledAt', t.cancelled_at,
    'cancellationReason', t.cancellation_reason,
    'notes', t.notes,
    'venueNotes', t.venue_notes,
    'seasonName', (select s.name from public.seasons s where s.id = t.season_id),
    'hostName', (select cd.name from public.club_directory cd where cd.id = t.host_directory_id),
    'hostClubId', t.host_club_id,
    'venue', (
      select jsonb_build_object('id', ve.id, 'name', ve.name, 'address', ve.address, 'postcode', ve.postcode)
      from public.venues ve where ve.id = t.venue_id
    ),
    'canManageTournament', v_can_manage,
    'entries', coalesce((
      select jsonb_agg(entry order by entry->>'teamName')
      from (
        select jsonb_build_object(
          'id', e.id,
          'teamId', e.team_id,
          'clubId', e.club_id,
          'teamName', tm.display_name,
          'ageGroup', tm.age_group,
          'clubName', cd.name,
          -- RAW STORAGE PATHS, resolved to public URLs by the one canonical
          -- lib/app-context/club-logo.ts rule (a club's own upload wins over
          -- the Club Directory's seed logo). The database does not invent a
          -- second answer to "which crest is this club's".
          'clubLogoPath', c.logo_storage_path,
          'directoryLogoPath', cd.logo_storage_path,
          'canManageEntry', internal.can_manage_tournament_entry(e.id),
          'opponents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'participantId', tp.id,
              'clubName', ocd.name,
              'clubLogoPath', (select oc.logo_storage_path from public.clubs oc where oc.id = tp.club_id),
              'directoryLogoPath', ocd.logo_storage_path,
              'teamTypeLabel', ctt.label,
              'status', tp.status
            ) order by o.sort_order, ocd.name)
            from public.tournament_entry_opponents o
            join public.tournament_participants tp on tp.id = o.participant_id
            join public.club_directory ocd on ocd.id = tp.club_directory_id
            join public.canonical_team_types ctt on ctt.id = tp.canonical_team_type_id
            where o.entry_id = e.id
          ), '[]'::jsonb),
          'games', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id,
              'opponentId', g.opponent_id,
              'opponentClubName', gcd.name,
              'gameDate', g.game_date,
              'startTime', g.start_time,
              'durationMinutes', g.duration_minutes,
              'pitchId', g.pitch_id,
              'pitchName', gp.display_name,
              'status', g.status,
              'ourScore', g.our_score,
              'opponentScore', g.opponent_score
            ) order by g.game_date, g.start_time nulls last, g.sort_order)
            from public.tournament_games g
            join public.tournament_entry_opponents go on go.id = g.opponent_id
            join public.tournament_participants gtp on gtp.id = go.participant_id
            join public.club_directory gcd on gcd.id = gtp.club_directory_id
            left join public.club_pitches gp on gp.id = g.pitch_id
            where g.entry_id = e.id
          ), '[]'::jsonb)
        ) as entry
        from public.tournament_team_entries e
        join public.teams tm on tm.id = e.team_id
        join public.clubs c on c.id = e.club_id
        join public.club_directory cd on cd.id = c.directory_id
        where e.tournament_id = t.id
      ) entries
    ), '[]'::jsonb),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id,
        'pitchId', tp.pitch_id,
        'pitchName', cp.display_name,
        'reservedOn', tp.reserved_on,
        'startTime', tp.start_time,
        'endTime', tp.end_time
      ) order by tp.reserved_on, tp.start_time, cp.display_name)
      from public.tournament_pitches tp
      join public.club_pitches cp on cp.id = tp.pitch_id
      where tp.tournament_id = t.id
    ), '[]'::jsonb)
  ) into v
  from public.tournaments t
  where t.id = p_tournament_id;

  return v;
end $$;

revoke all on function public.save_tournament(uuid, uuid, text, date, date, text, uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.add_tournament_team_entry(uuid, uuid) from public, anon;
revoke all on function public.remove_tournament_team_entry(uuid) from public, anon;
revoke all on function public.record_tournament_opponent(uuid, uuid, uuid) from public, anon;
revoke all on function public.remove_tournament_opponent(uuid) from public, anon;
revoke all on function public.save_tournament_game(uuid, uuid, uuid, date, time, integer, uuid, text, integer, integer) from public, anon;
revoke all on function public.delete_tournament_game(uuid) from public, anon;
revoke all on function public.reserve_tournament_pitch(uuid, uuid, date, time, time) from public, anon;
revoke all on function public.release_tournament_pitch(uuid) from public, anon;
revoke all on function public.cancel_tournament(uuid, text) from public, anon;
revoke all on function public.get_tournament_centre(uuid) from public, anon;

grant execute on function public.save_tournament(uuid, uuid, text, date, date, text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.add_tournament_team_entry(uuid, uuid) to authenticated;
grant execute on function public.remove_tournament_team_entry(uuid) to authenticated;
grant execute on function public.record_tournament_opponent(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_tournament_opponent(uuid) to authenticated;
grant execute on function public.save_tournament_game(uuid, uuid, uuid, date, time, integer, uuid, text, integer, integer) to authenticated;
grant execute on function public.delete_tournament_game(uuid) to authenticated;
grant execute on function public.reserve_tournament_pitch(uuid, uuid, date, time, time) to authenticated;
grant execute on function public.release_tournament_pitch(uuid) to authenticated;
grant execute on function public.cancel_tournament(uuid, text) to authenticated;
grant execute on function public.get_tournament_centre(uuid) to authenticated;
