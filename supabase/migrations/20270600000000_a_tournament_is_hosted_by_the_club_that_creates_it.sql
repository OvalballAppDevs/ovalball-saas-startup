-- -----------------------------------------------------------------------------------------------------
-- A TOURNAMENT IS HOSTED BY THE CLUB THAT CREATES IT, AND SITTING IN A REAL SEASON.
--
-- `tournaments.host_directory_id` is NOT NULL, and `save_tournament` has always accepted
-- `p_host_directory_id` as OPTIONAL -- resolving a null to the creating club's own directory row,
-- because a club running its own festival should not have to restate who it is.
--
-- THAT RESOLUTION WAS LOST. The age-group rewrite (20270594) replaced the function and passed
-- `p_host_directory_id` straight into the insert, so every caller that omitted it -- which is the
-- ordinary case, and what the website's own tournament creation does -- stopped working:
--
--   null value in column "host_directory_id" of relation "tournaments" violates not-null constraint
--
-- It went unnoticed because the mobile create wizard calls `create_tournament_with_teams`, which
-- resolves the directory properly, and the edit path takes the `p_tournament_id is not null` branch
-- where the column is only ever coalesced onto its existing value. Only the CREATE branch of
-- `save_tournament` was broken, and `supabase/tests/tournament_centre.sql` is what caught it.
--
-- The SAME rewrite dropped the season resolution beside it -- `season_id` was likewise passed
-- straight through, so a tournament created without an explicit season was filed under none. Both
-- resolutions are restored here, and nothing else. The function is otherwise byte-identical to the one
-- 20270599 installed, so the competition shapes and the Swiss round count are unchanged.
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
  v_directory uuid;
  v_season uuid;
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

    -- WHOSE GROUND, RESOLVED RATHER THAN DEMANDED. `host_directory_id` is NOT NULL, and almost every
    -- tournament is hosted by the club creating it -- so a caller that does not name a host means
    -- "us", not "nobody". An away festival names the other club's canonical directory identity
    -- explicitly. Never free text, and never a null that the constraint turns into a raw Postgres
    -- error on a screen.
    select coalesce(p_host_directory_id, c.directory_id) into v_directory
    from public.clubs c where c.id = p_club_id;

    if v_directory is null then
      raise exception 'That club has no directory identity, so it cannot host a tournament.' using errcode = 'P0002';
    end if;

    -- THE SEASON COMES FROM THE CANONICAL REGISTER, never from the date with a month boundary written
    -- into this function. The same rewrite that dropped the host resolution dropped this one, so a
    -- tournament created without an explicit season was simply filed under no season at all. If Site
    -- Admin has not recorded a season covering these dates, that is a gap to surface -- a null here --
    -- and never a boundary invented locally.
    v_season := p_season_id;
    if v_season is null then
      select s.id into v_season from public.seasons s
      where s.rugby_code = p_rugby_code and p_starts_on between s.starts_on and s.ends_on
      order by s.starts_on desc limit 1;
    end if;
    insert into public.tournaments (
      host_club_id, name, event_date, ends_on, rugby_code, season_id, host_directory_id,
      venue_id, venue_notes, notes, format, kickoff_time, visibility, swiss_rounds, created_by, updated_by
    ) values (
      p_club_id, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_rugby_code, v_season, v_directory,
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


-- `create_tournament_with_teams` -- the mobile create wizard's one transactional call -- never
-- resolved a season at all. Proven on the local review database: the tournament created through the
-- wizard had a null season_id while the two created through `save_tournament` did not.

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
  v_id uuid; v_directory uuid; v_code text; v_season uuid; v_grade text; v_team record; v_p jsonb;
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

  -- THE SEASON COMES FROM THE CANONICAL REGISTER. This function was written without it, so every
  -- tournament the mobile create wizard made was filed under no season at all -- invisible to any
  -- season-scoped view, and not something the organiser could see was missing. A gap in the register
  -- stays a null rather than becoming a month boundary invented here.
  select s.id into v_season from public.seasons s
  where s.rugby_code = v_code and p_starts_on between s.starts_on and s.ends_on
  order by s.starts_on desc limit 1;

  insert into public.tournaments (
    host_club_id, host_directory_id, name, event_date, ends_on, kickoff_time, rugby_code, season_id,
    venue_id, notes, format, visibility, swiss_rounds, status, created_by, updated_by
  ) values (
    p_club_id, v_directory, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_kickoff_time, v_code, v_season,
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

-- -----------------------------------------------------------------------------------------------------
-- 3. The tournaments already created without one.
--
-- Every tournament made through the wizard while the resolution was missing carries a null season. It
-- is not a season somebody chose -- it is the hole, and it makes the tournament invisible to any
-- season-scoped view. This fills it the same way the function now does: the canonical register's
-- answer for the dates, and nothing where the register has no answer.
--
-- CONDITIONAL BY CONSTRUCTION. It touches only rows whose season is null, so a season anybody set
-- deliberately is never overwritten, and a database with none of these rows is simply unchanged.
-- -----------------------------------------------------------------------------------------------------

update public.tournaments t
set season_id = s.id
from public.seasons s
where t.season_id is null
  and s.rugby_code = t.rugby_code
  and t.event_date between s.starts_on and s.ends_on
  and s.id = (
    select s2.id from public.seasons s2
    where s2.rugby_code = t.rugby_code and t.event_date between s2.starts_on and s2.ends_on
    order by s2.starts_on desc limit 1
  );
