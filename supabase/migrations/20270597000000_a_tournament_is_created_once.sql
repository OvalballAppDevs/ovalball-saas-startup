-- =====================================================================================================
-- A TOURNAMENT IS CREATED ONCE
-- =====================================================================================================
--
-- Three things, all of which have to be true before Create Tournament can be wired to a button.
--
-- 1. THE COMPETITION IS AN AGE GRADE, NOT A CANONICAL TEAM TYPE.
--
--    `tournament_participants.canonical_team_type_id` was NOT NULL and carried the "which competition"
--    meaning. A canonical type is (category, grade, gender, fixed squad), so it carries a PATHWAY --
--    U12 exists as `u12` (boys) and `girls_u12` (girls), and there is no grade-only type. A club that
--    is not on Ovalball, entered by name with a side called "U12 A", tells the organiser's screen the
--    grade and nothing about the pathway. Storing it against `u12` would record a boys side for what
--    may be a girls one, and Ovalball does not assume a pathway it was never told.
--
--    So the grade becomes the key, which is what the rest of the model already uses:
--    `tournament_age_groups.age_group` is how a tournament names its competitions. The canonical type
--    stays, nullable, for an Ovalball side where the pathway is genuinely known from the team.
--
-- 2. CREATION MUST BE ONE TRANSACTION.
--
--    A tournament, its grades, the host's own entries and every other club's sides took
--    `save_tournament` + `set_tournament_age_groups` + N + M separate calls. Each is its own
--    transaction, so a failure anywhere past the first left a real tournament in the database with
--    some of its teams -- and no way for the organiser to tell which. `create_tournament_with_teams`
--    does the whole thing in one function body, so the whole thing commits or none of it does.
--
-- 3. TWO DEFECTS IN 20270596, FIXED HERE.
--
--    It added `remove_tournament_team_entry(uuid, uuid)` beside the canonical
--    `remove_tournament_team_entry(uuid)` that the website already calls -- two functions for one job,
--    and the new one outside the API perimeter manifest. It is dropped; nothing ever called it.

-- =====================================================================================================
-- 1. THE GRADE IS THE COMPETITION KEY
-- =====================================================================================================

alter table public.tournament_participants
  add column if not exists age_group text;

-- Backfilled from the canonical type every existing row already carries, so no row loses its meaning.
update public.tournament_participants p
set age_group = coalesce(
      (select ctt.age_group from public.canonical_team_types ctt where ctt.id = p.canonical_team_type_id),
      (select t.age_group from public.teams t where t.id = p.team_id)
    )
where p.age_group is null;

-- A senior canonical type has no age grade at all (Men's 1st is not "U-anything"). Those rows keep a
-- stable, honest marker rather than being forced into a youth grade they do not have.
update public.tournament_participants set age_group = 'SENIOR' where age_group is null;

alter table public.tournament_participants alter column age_group set not null;
alter table public.tournament_participants alter column canonical_team_type_id drop not null;

comment on column public.tournament_participants.age_group is
  'WHICH COMPETITION this side is in -- the same vocabulary as tournament_age_groups.age_group. This '
  'is the key, not canonical_team_type_id: a canonical type carries a pathway, and a club that is not '
  'on Ovalball can state its grade without stating one.';

comment on column public.tournament_participants.canonical_team_type_id is
  'The canonical identity of an Ovalball side, where it is genuinely known from the team. NULL for an '
  'external club, which has no team row and was never asked for a pathway.';

drop index if exists public.tournament_participants_one_side_idx;

-- ONE SIDE, ONCE, now keyed on the grade. An Ovalball side is its team; an external one is its label.
create unique index if not exists tournament_participants_one_side_idx
  on public.tournament_participants (
    tournament_id,
    club_directory_id,
    age_group,
    coalesce(team_id::text, squad_label, '')
  );

-- =====================================================================================================
-- 2. THE DUPLICATE OVERLOAD FROM 20270596
-- =====================================================================================================

drop function if exists public.remove_tournament_team_entry(uuid, uuid);

-- `add_tournament_participant_team` learns the grade. An Ovalball team's grade comes from the team
-- itself; an external side's comes from the competition the organiser is filling.
create or replace function public.add_tournament_participant_team(
  p_tournament_id uuid,
  p_club_directory_id uuid,
  p_team_id uuid default null,
  p_canonical_team_type_id uuid default null,
  p_squad_label text default null,
  p_age_group text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_id uuid;
  v_participant_club uuid;
  v_label text;
  v_team_club uuid;
  v_team_type uuid;
  v_grade text;
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

  select c.id into v_participant_club
  from public.club_directory d
  left join public.clubs c on c.directory_id = d.id
  where d.id = p_club_directory_id;

  v_label := nullif(btrim(coalesce(p_squad_label, '')), '');
  v_grade := nullif(btrim(coalesce(p_age_group, '')), '');

  if p_team_id is not null then
    select c.directory_id, t.canonical_team_type_id, t.age_group into v_team_club, v_team_type, v_grade
    from public.teams t join public.clubs c on c.id = t.club_id
    where t.id = p_team_id;
    if v_team_club is null then
      raise exception 'That team could not be found.' using errcode = 'P0002';
    end if;
    if v_team_club <> p_club_directory_id then
      raise exception 'That team does not belong to that club.' using errcode = '22023';
    end if;
    if p_age_group is not null and v_grade is distinct from btrim(p_age_group) then
      raise exception 'That team is not in that age group.' using errcode = '22023';
    end if;
    p_canonical_team_type_id := coalesce(v_team_type, p_canonical_team_type_id);
    v_label := null;
    v_grade := coalesce(v_grade, 'SENIOR');
  end if;

  if v_grade is null then
    raise exception 'An age group is required to add a team.' using errcode = '22023';
  end if;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group,
    status, invited_by, invited_at
  )
  values (
    p_tournament_id, p_club_directory_id, v_participant_club, p_team_id, p_canonical_team_type_id, v_label, v_grade,
    case when v_participant_club is null then 'external_recorded' else 'added' end,
    auth.uid(), now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.tournament_participants
    where tournament_id = p_tournament_id
      and club_directory_id = p_club_directory_id
      and age_group = v_grade
      and coalesce(team_id::text, squad_label, '') = coalesce(p_team_id::text, v_label, '');
  end if;

  return v_id;
end;
$function$;

drop function if exists public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text);

revoke all on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text) from public;
grant execute on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text) to authenticated;

-- =====================================================================================================
-- 3. ONE TRANSACTIONAL CREATION PATH
-- =====================================================================================================
--
-- `p_participants` is a JSON array, one object per side, exactly as the Review screen holds it:
--
--   [{ "directory_id": uuid | null, "club_name": text, "team_id": uuid | null,
--      "age_group": text, "squad_label": text | null }]
--
-- A null `directory_id` with a `club_name` is a club the organiser typed in that has no directory row.
-- It gets one, marked as organiser-entered, because a participant must point at a club identity and
-- inventing a `clubs` account for a club that is not on Ovalball would be far worse.
--
-- NOTHING IS SCHEDULED HERE. No fixtures, games, pitch reservations or draws: this creates the
-- tournament and who is in it, and planning is a separate, later decision.

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
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_directory uuid;
  v_code text;
  v_grade text;
  v_team record;
  v_p jsonb;
  v_dir uuid;
  v_name text;
  v_team_id uuid;
  v_grade_p text;
  v_label text;
  v_type uuid;
  v_participant_club uuid;
  v_filled int;
begin
  -- ---------------------------------------------------------------------------------------------
  -- AUTHORITY FIRST, exactly as every other tournament write checks it.
  -- ---------------------------------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------------------------------
  -- THE DRAFT IS RE-VALIDATED SERVER SIDE. The screen checks the same things, but the screen is not
  -- the boundary: a draft can go stale while it is open, and a client is never the guarantee.
  -- ---------------------------------------------------------------------------------------------
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.' using errcode = '22023';
  end if;
  if coalesce(p_format, 'league') not in ('league', 'knockout', 'hybrid') then
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

  -- EVERY COMPETITION MUST HAVE SOMEBODY IN IT. A grade with no teams is not a competition, and
  -- creating one would leave the organiser a tournament with an empty section they cannot see is empty.
  foreach v_grade in array p_age_groups loop
    select count(*) into v_filled
    from public.teams t
    where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[])) and t.age_group = v_grade;
    if v_filled = 0 then
      select count(*) into v_filled
      from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) e
      where e->>'age_group' = v_grade;
    end if;
    if v_filled = 0 then
      raise exception '% has no teams. Add at least one team to every age group.', v_grade using errcode = '22023';
    end if;
  end loop;

  -- ---------------------------------------------------------------------------------------------
  -- THE TOURNAMENT. `ends_on` is NOT NULL on the table, and a one-day tournament ends the day it
  -- starts -- so a null from the client means "one day", never "unknown".
  -- ---------------------------------------------------------------------------------------------
  insert into public.tournaments (
    host_club_id, host_directory_id, name, event_date, ends_on, kickoff_time, rugby_code,
    venue_id, notes, format, visibility, status, created_by, updated_by
  ) values (
    p_club_id, v_directory, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_kickoff_time, v_code,
    p_venue_id, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_format, 'league'), coalesce(p_visibility, 'private'),
    'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_id;

  -- ---------------------------------------------------------------------------------------------
  -- THE COMPETITIONS IT RUNS.
  -- ---------------------------------------------------------------------------------------------
  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select v_id, ag, auth.uid()
  from unnest(p_age_groups) as ag
  on conflict (tournament_id, age_group) do nothing;

  -- ---------------------------------------------------------------------------------------------
  -- THE HOST'S OWN SIDES. Checked to belong to this club: an entry is the host entering itself, and
  -- another club's team arriving here would be filed as though the host owned it.
  -- ---------------------------------------------------------------------------------------------
  for v_team in
    select t.id, t.club_id, t.age_group from public.teams t where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[]))
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

  -- ---------------------------------------------------------------------------------------------
  -- EVERY OTHER CLUB'S SIDES. `added` for a club on Ovalball, `external_recorded` for one that is
  -- not. Neither is an invitation: nothing here is pending, and nobody is asked to respond.
  -- ---------------------------------------------------------------------------------------------
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

    -- A CLUB THE ORGANISER TYPED IN gets a directory row, not a fabricated Ovalball account. It is
    -- recorded as manually entered and unverified, so it is never mistaken for a club that joined.
    if v_dir is null then
      if v_name is null then
        raise exception 'An external club needs a name.' using errcode = '22023';
      end if;
      select id into v_dir from public.club_directory
      where lower(btrim(name)) = lower(v_name) and rugby_code = v_code and active
      limit 1;
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
    -- The same side twice in one payload is a person tapping twice, not an error. The unique index
    -- still makes a second row impossible.
    on conflict do nothing;
  end loop;

  return v_id;
end;
$function$;

revoke all on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb) from public;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb) to authenticated;
