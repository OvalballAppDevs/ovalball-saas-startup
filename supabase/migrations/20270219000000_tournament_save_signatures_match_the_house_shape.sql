-- =====================================================================
-- SAVE FUNCTIONS PUT THE OPTIONAL ID LAST, LIKE THE REST OF THE PRODUCT
--
-- public.save_club_event -- the established shape for a create-or-update RPC
-- in this codebase -- takes its required fields first and p_event_id last with
-- a default, so "create" is simply the call that omits it. save_tournament and
-- save_tournament_game took the id FIRST and required, which forced every
-- caller to pass an explicit null and made the generated TypeScript declare a
-- required string for a value that is null on every create.
--
-- Postgres cannot reorder arguments with CREATE OR REPLACE, so these are
-- dropped and recreated. Bodies are unchanged apart from the signature.
-- =====================================================================

drop function if exists public.save_tournament(uuid, uuid, text, date, date, text, uuid, uuid, uuid, text, text);
drop function if exists public.save_tournament_game(uuid, uuid, uuid, date, time, integer, uuid, text, integer, integer);

create function public.save_tournament(
  p_club_id       uuid,
  p_name          text,
  p_starts_on     date,
  p_ends_on       date,
  p_rugby_code    text,
  p_tournament_id uuid default null,
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

  select cd.rugby_code into v_club_code from public.club_directory cd where cd.id = v_club_directory;
  if v_club_code is not null and v_club_code <> p_rugby_code then
    raise exception 'This club plays % -- it cannot run a % tournament.', v_club_code, p_rugby_code using errcode = '23514';
  end if;

  v_host_directory := coalesce(p_host_directory_id, v_club_directory);
  select c.id into v_host_club from public.clubs c where c.directory_id = v_host_directory;

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

create function public.save_tournament_game(
  p_entry_id uuid,
  p_opponent_id uuid,
  p_game_date date,
  p_game_id uuid default null,
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

revoke all on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.save_tournament_game(uuid, uuid, date, uuid, time, integer, uuid, text, integer, integer) from public, anon;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.save_tournament_game(uuid, uuid, date, uuid, time, integer, uuid, text, integer, integer) to authenticated;
