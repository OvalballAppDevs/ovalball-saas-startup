-- =====================================================================================================
-- A TOURNAMENT HAS A COMPETITION SHAPE
-- =====================================================================================================
--
-- `tournaments.format` allowed three values -- league, knockout, hybrid -- and the approved product now
-- names five competition shapes. Two of them do not exist in the old set at all, and one of the old
-- names describes a shape by the wrong word.
--
--   round_robin   everybody plays everybody
--   tri_fixture   exactly three teams, each playing the other two
--   swiss         a DEFINED NUMBER OF ROUNDS, pairing teams by standing rather than playing everybody
--   knockout      single elimination
--   hybrid        a group stage, then knockout
--
-- LEAGUE BECOMES ROUND_ROBIN, AS A RENAME RATHER THAN AN ADDITION. Its own label already read "All
-- teams play in a group format", which is round robin described in other words; keeping both would
-- leave two values meaning one thing and an organiser guessing which to pick. Every existing row is
-- carried across, so nothing loses its shape.
--
-- SWISS IS THE ONE SHAPE A NAME CANNOT STATE ON ITS OWN. "Everybody plays everybody" is fully
-- described by round_robin, and "three teams" by tri_fixture -- but a Swiss competition is defined by
-- how many rounds it runs, and without that number the format is a word that cannot be acted on. So
-- `swiss_rounds` arrives with it, and a check constraint makes the two inseparable: swiss must carry a
-- round count, and nothing else may carry one.
--
-- TRI-FIXTURE'S "EXACTLY THREE" IS DELIBERATELY NOT A DATABASE CONSTRAINT. An organiser building a
-- tri-fixture passes through one team and two teams on the way to three, and a constraint that refuses
-- the second team makes the tournament impossible to set up. It is a rule about a competition being
-- READY to plan, which is where Planning will enforce it.

-- -----------------------------------------------------------------------------------------------------
-- 1. The vocabulary
-- -----------------------------------------------------------------------------------------------------

alter table public.tournaments drop constraint if exists tournaments_format_check;

update public.tournaments set format = 'round_robin' where format = 'league';

alter table public.tournaments
  add constraint tournaments_format_check
  check (format in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid'));

alter table public.tournaments alter column format set default 'round_robin';

comment on column public.tournaments.format is
  'The competition shape: round_robin (everybody plays everybody), tri_fixture (exactly three teams), '
  'swiss (a defined number of rounds), knockout (single elimination) or hybrid (groups then knockout). '
  'Renamed from league in 20270599 -- league and round robin were one shape under two names.';

-- -----------------------------------------------------------------------------------------------------
-- 2. The one shape that needs a number
-- -----------------------------------------------------------------------------------------------------

alter table public.tournaments
  add column if not exists swiss_rounds integer;

comment on column public.tournaments.swiss_rounds is
  'How many rounds a Swiss competition runs. Required for swiss and forbidden for every other shape: '
  'a Swiss tournament without a round count is a word rather than a plan, and a round count on a '
  'knockout is a number nothing reads.';

alter table public.tournaments drop constraint if exists tournaments_swiss_rounds_shape;
alter table public.tournaments
  add constraint tournaments_swiss_rounds_shape
  check (
    (format = 'swiss' and swiss_rounds is not null and swiss_rounds between 2 and 12)
    or (format <> 'swiss' and swiss_rounds is null)
  );

-- -----------------------------------------------------------------------------------------------------
-- 3. The functions that name the shapes
-- -----------------------------------------------------------------------------------------------------

create or replace function public.save_tournament(
  p_club_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_rugby_code text,
  p_tournament_id uuid default null,
  p_season_id uuid default null,
  p_host_directory_id uuid default null,
  p_venue_id uuid default null,
  p_venue_notes text default null,
  p_notes text default null,
  p_format text default null,
  p_kickoff_time time without time zone default null,
  p_visibility text default null,
  p_swiss_rounds integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_format text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to manage this club''s tournaments.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.';
  end if;
  if p_format is not null and p_format not in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid') then
    raise exception 'Unknown tournament format.';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'private') then
    raise exception 'Unknown tournament visibility.';
  end if;

  if p_tournament_id is null then
    v_format := coalesce(p_format, 'round_robin');
    insert into public.tournaments (
      host_club_id, name, event_date, ends_on, rugby_code, season_id, host_directory_id,
      venue_id, venue_notes, notes, format, kickoff_time, visibility, swiss_rounds, created_by, updated_by
    ) values (
      p_club_id, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_rugby_code, p_season_id, p_host_directory_id,
      p_venue_id, p_venue_notes, p_notes, v_format, p_kickoff_time,
      coalesce(p_visibility, 'private'),
      case when v_format = 'swiss' then coalesce(p_swiss_rounds, 4) else null end,
      auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    select coalesce(p_format, format) into v_format from public.tournaments where id = p_tournament_id;

    update public.tournaments
    set name = btrim(p_name),
        event_date = p_starts_on,
        ends_on = coalesce(p_ends_on, p_starts_on),
        rugby_code = p_rugby_code,
        season_id = coalesce(p_season_id, season_id),
        host_directory_id = coalesce(p_host_directory_id, host_directory_id),
        venue_id = p_venue_id,
        venue_notes = p_venue_notes,
        notes = p_notes,
        format = v_format,
        kickoff_time = coalesce(p_kickoff_time, kickoff_time),
        visibility = coalesce(p_visibility, visibility),
        -- THE ROUND COUNT FOLLOWS THE SHAPE. Changing away from Swiss clears it rather than leaving a
        -- number behind that the constraint would then refuse; changing TO Swiss without supplying one
        -- takes the sensible default rather than failing the save.
        swiss_rounds = case
          when v_format = 'swiss' then coalesce(p_swiss_rounds, swiss_rounds, 4)
          else null
        end,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_tournament_id and host_club_id = p_club_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Tournament not found for this club.' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$function$;

drop function if exists public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text);

revoke all on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer) from public;
grant execute on function public.save_tournament(uuid, text, date, date, text, uuid, uuid, uuid, uuid, text, text, text, time without time zone, text, integer) to authenticated;

-- `create_tournament_with_teams` validates the same vocabulary; its old list would now refuse every
-- new shape and accept one that no longer exists.
create or replace function public.create_tournament_with_teams(
  p_club_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_kickoff_time time without time zone,
  p_format text,
  p_visibility text,
  p_venue_id uuid,
  p_notes text,
  p_age_groups text[],
  p_our_team_ids uuid[],
  p_participants jsonb default '[]'::jsonb,
  p_swiss_rounds integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_directory uuid; v_code text; v_grade text; v_team record; v_p jsonb;
  v_dir uuid; v_name text; v_team_id uuid; v_grade_p text; v_label text; v_type uuid;
  v_participant_club uuid; v_filled int; v_format text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to manage this club''s tournaments.' using errcode = '42501';
  end if;

  select c.directory_id, d.rugby_code into v_directory, v_code
  from public.clubs c join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;
  if v_directory is null then
    raise exception 'That club could not be found.' using errcode = 'P0002';
  end if;

  v_format := coalesce(p_format, 'round_robin');

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.' using errcode = '22023';
  end if;
  if v_format not in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid') then
    raise exception 'Unknown tournament format.' using errcode = '22023';
  end if;
  if coalesce(p_visibility, 'private') not in ('public', 'private') then
    raise exception 'Unknown tournament visibility.' using errcode = '22023';
  end if;
  if p_venue_id is null then
    raise exception 'A tournament needs a venue.' using errcode = '22023';
  end if;
  if p_age_groups is null or array_length(p_age_groups, 1) is null then
    raise exception 'A tournament needs at least one age group.' using errcode = '22023';
  end if;

  foreach v_grade in array p_age_groups loop
    select count(*) into v_filled from public.teams t
    where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[])) and t.age_group = v_grade;
    if v_filled = 0 then
      select count(*) into v_filled from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) e
      where e->>'age_group' = v_grade;
    end if;
    if v_filled = 0 then
      raise exception '% has no teams. Add at least one team to every age group.', v_grade using errcode = '22023';
    end if;
  end loop;

  insert into public.tournaments (
    host_club_id, host_directory_id, name, event_date, ends_on, kickoff_time, rugby_code,
    venue_id, notes, format, visibility, swiss_rounds, status, created_by, updated_by
  ) values (
    p_club_id, v_directory, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_kickoff_time, v_code,
    p_venue_id, nullif(btrim(coalesce(p_notes, '')), ''), v_format, coalesce(p_visibility, 'private'),
    case when v_format = 'swiss' then coalesce(p_swiss_rounds, 4) else null end,
    'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_id;

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select v_id, ag, auth.uid() from unnest(p_age_groups) as ag
  on conflict (tournament_id, age_group) do nothing;

  for v_team in select t.id, t.club_id, t.age_group from public.teams t where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[]))
  loop
    if v_team.club_id <> p_club_id then
      raise exception 'A team that is not this club''s cannot be entered as one of its own.' using errcode = '22023';
    end if;
    if v_team.age_group is not null and not (v_team.age_group = any(p_age_groups)) then
      raise exception 'A team was entered at an age group this tournament does not run.' using errcode = '22023';
    end if;
    insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by)
    values (v_id, v_team.id, v_team.club_id, auth.uid())
    on conflict (tournament_id, team_id) do nothing;
  end loop;

  for v_p in select * from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    v_dir := nullif(v_p->>'directory_id', '')::uuid;
    v_name := nullif(btrim(coalesce(v_p->>'club_name', '')), '');
    v_team_id := nullif(v_p->>'team_id', '')::uuid;
    v_grade_p := nullif(btrim(coalesce(v_p->>'age_group', '')), '');
    v_label := nullif(btrim(coalesce(v_p->>'squad_label', '')), '');

    if v_grade_p is null or not (v_grade_p = any(p_age_groups)) then
      raise exception 'A team was added at an age group this tournament does not run.' using errcode = '22023';
    end if;

    if v_dir is null then
      if v_name is null then
        raise exception 'An external club needs a name.' using errcode = '22023';
      end if;
      select id into v_dir from public.club_directory
      where lower(btrim(name)) = lower(v_name) and rugby_code = v_code and active limit 1;
      if v_dir is null then
        insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key, created_by)
        values (v_name, v_code, 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry',
                'tme-' || substr(md5(lower(v_name) || v_code), 1, 16), auth.uid())
        returning id into v_dir;
      end if;
    end if;

    if v_dir = v_directory then
      raise exception 'The host club is entered through its own teams, not as a participating club.' using errcode = '22023';
    end if;

    select c.id into v_participant_club from public.clubs c where c.directory_id = v_dir;

    v_type := null;
    if v_team_id is not null then
      select t.canonical_team_type_id, t.age_group into v_type, v_grade_p
      from public.teams t join public.clubs c on c.id = t.club_id
      where t.id = v_team_id and c.directory_id = v_dir;
      if not found then
        raise exception 'A team was added under a club it does not belong to.' using errcode = '22023';
      end if;
      v_label := null;
    end if;

    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group,
      status, invited_by, invited_at
    ) values (
      v_id, v_dir, v_participant_club, v_team_id, v_type, v_label, v_grade_p,
      case when v_participant_club is null then 'external_recorded' else 'added' end,
      auth.uid(), now()
    )
    on conflict do nothing;
  end loop;

  return v_id;
end;
$function$;

drop function if exists public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb);

revoke all on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer) from public;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer) to authenticated;
