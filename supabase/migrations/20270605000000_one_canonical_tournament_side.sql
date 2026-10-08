-- =====================================================================================================
-- ONE CANONICAL TOURNAMENT SIDE, AND A GAME BETWEEN ANY TWO OF THEM.
--
-- THE DEFECT, PROVEN BEFORE THIS WAS WRITTEN:
--
--   tournament_games.entry_id  -> tournament_team_entries  (NOT NULL)
--   tournament_games.opponent_id -> tournament_entry_opponents (NOT NULL)
--
-- and `add_tournament_team_entry` refuses another club's team outright ("That team belongs to another
-- club. Add it as a participating club instead."). All ten entry rows are the host's. So EVERY game
-- had to have the host on one end, and "Burnley U12 A v Preston U12" -- the ordinary case in a round
-- robin between visiting clubs -- was structurally impossible. Planning cannot be built on that.
--
-- THE SIDE WAS SPLIT ACROSS TWO TABLES, which is the whole cause:
--
--   tournament_team_entries   the HOST's own teams      team_id NOT NULL, club_id NOT NULL
--   tournament_participants   everybody else's sides    directory-backed, team_id nullable
--
-- `tournament_participants` already represents three of the four cases the product needs -- a visiting
-- Ovalball team, an unclaimed directory club with an age group and an optional alias, and a genuine
-- manual fallback. The ONLY thing it could not hold was the host, and only because one rule said so.
--
-- SO THE SMALLEST COHERENT CORRECTION IS TO DELETE THAT RULE, not to invent a third side concept.
-- `tournament_participants` becomes the one canonical side table; a game references two rows of it.
--
-- `tournament_team_entries` BECOMES A VIEW over the host's own sides. Thirteen database functions and
-- twelve source files read it, and they keep working unchanged -- but there is now exactly one place a
-- side lives. Keeping it as a real table beside the participants table is the broken abstraction this
-- migration exists to remove.
--
-- WHAT A GAME NOW CARRIES:
--   side_a_id, side_b_id   any two participants, same tournament, same competition, not each other
--   age_group              the competition it belongs to, enforced rather than inferred
--   game_date              a day inside the tournament's own range, enforced
--
-- That last pair is what makes multi-day planning possible later: a two-day festival can run U9 and
-- U10 on the Saturday and U11 and U12 on the Sunday, and a game outside 12-13 June is refused by the
-- database rather than by a date picker.
--
-- NOT IN THIS MIGRATION: any schedule generation. This is the foundation Planning will later use.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 0. Refuse to run against data this migration cannot map unambiguously.
--
-- Every existing game is read through the OLD shape and must resolve to two real sides at one grade,
-- on a date inside its tournament. If any row cannot, the migration stops and names it rather than
-- inventing a side or guessing a competition.
-- -----------------------------------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- RE-RUNNABLE. Stage 7 drops `entry_id`, so on a second pass there is no old shape left to check and
  -- nothing to migrate. A migration that cannot be re-run is one nobody can safely retry after a
  -- mid-way failure, and this one failed mid-way while being written.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tournament_games' and column_name='entry_id'
  ) then
    return;
  end if;

  select string_agg(g.id::text, ', ') into v_bad
  from public.tournament_games g
  left join public.tournament_team_entries te on te.id = g.entry_id
  left join public.teams tm on tm.id = te.team_id
  left join public.tournament_entry_opponents o on o.id = g.opponent_id
  left join public.tournament_participants p on p.id = o.participant_id
  left join public.tournaments t on t.id = g.tournament_id
  where te.id is null
     or p.id is null
     or tm.age_group is null
     or p.age_group is distinct from tm.age_group
     or g.game_date is null
     or g.game_date < t.event_date
     or g.game_date > coalesce(t.ends_on, t.event_date);

  if v_bad is not null then
    raise exception 'These tournament games cannot be migrated unambiguously: %. Resolve them before running this migration.', v_bad;
  end if;
end $$;

-- -----------------------------------------------------------------------------------------------------
-- 1. The host stops being a special case.
--
-- The exclusion lived in two writers. It was right while entries were a separate table; now it is the
-- thing preventing one side model.
-- -----------------------------------------------------------------------------------------------------

do $$
declare v_def text; v_marker text;
begin
  v_marker := 'The host club is entered through its own teams, not as a participating club.';

  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'add_tournament_participant_team';
  if v_def is null then
    raise exception 'add_tournament_participant_team is missing -- this migration has nothing to update.';
  end if;
  -- RE-RUNNABLE. The exclusion being absent means a previous run already removed it, which is a normal
  -- state for a migration that failed later and is being retried -- not a reason to refuse.
  if position(v_marker in v_def) > 0 then
  v_def := replace(
    v_def,
    'if v_dir = v_host_dir then
    raise exception ''The host club is entered through its own teams, not as a participating club.'' using errcode = ''22023'';
  end if;',
    '-- THE HOST IS A SIDE LIKE ANY OTHER. It used to be refused here and kept in a separate table,
  -- which is exactly why a game could not be played between two visiting clubs.'
  );
  execute v_def;
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'create_tournament_with_teams';
  if v_def is null then
    raise exception 'create_tournament_with_teams is missing -- this migration has nothing to update.';
  end if;
  if position(v_marker in v_def) > 0 then
  v_def := replace(
    v_def,
    'if v_dir = v_directory then
       raise exception ''The host club is entered through its own teams, not as a participating club.'' using errcode = ''22023'';
     end if;',
    '-- The host is a side like any other; see 20270605000000.'
  );
  execute v_def;
  end if;
end $$;

-- The same rule was ALSO enforced by a trigger on the table, which is where it actually bit. Found by
-- running this migration: the two function edits above passed and the insert below was still refused by
-- `internal.validate_tournament_participant_not_host`. The rule is retired in all three places or in
-- none -- a half-removed invariant is worse than either.
drop trigger if exists tournament_participants_validate_not_host on public.tournament_participants;
drop function if exists internal.validate_tournament_participant_not_host();

-- -----------------------------------------------------------------------------------------------------
-- 2. Every host entry becomes a participant row -- the host's sides join the one side table.
--
-- `club_directory_id` is the host club's own canonical directory identity, `team_id` the real team, and
-- the grade comes from the team itself rather than being typed. Status `added`: the host did not apply
-- to its own tournament and has nothing to answer.
-- -----------------------------------------------------------------------------------------------------

insert into public.tournament_participants (
  tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status, invited_by, invited_at, created_at
)
select te.tournament_id, c.directory_id, te.club_id, te.team_id, tm.canonical_team_type_id,
       coalesce(tm.age_group, 'SENIOR'), 'added', te.created_by, te.created_at, te.created_at
from public.tournament_team_entries te
join public.clubs c on c.id = te.club_id
join public.teams tm on tm.id = te.team_id
on conflict do nothing;

-- -----------------------------------------------------------------------------------------------------
-- 3. The game gains two sides, a competition and a day inside its tournament.
--
-- Added alongside the old columns first so the mapping below can be written and checked before anything
-- is dropped.
-- -----------------------------------------------------------------------------------------------------

alter table public.tournament_games add column if not exists side_a_id uuid references public.tournament_participants(id) on delete cascade;
alter table public.tournament_games add column if not exists side_b_id uuid references public.tournament_participants(id) on delete cascade;
alter table public.tournament_games add column if not exists age_group text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tournament_games' and column_name='entry_id'
  ) then
    return;
  end if;

  execute $m$
update public.tournament_games g
set side_a_id = ha.id,
    side_b_id = o_p.id,
    age_group = ha.age_group
from public.tournament_team_entries te
join public.teams tm on tm.id = te.team_id
join public.clubs hc on hc.id = te.club_id
join public.tournament_participants ha
  on ha.tournament_id = te.tournament_id
 and ha.team_id = te.team_id
join public.tournament_entry_opponents o on true
join public.tournament_participants o_p on o_p.id = o.participant_id
where te.id = g.entry_id
  and o.id = g.opponent_id
  and g.side_a_id is null;
  $m$;
end $$;

do $$
declare v_unmapped int;
begin
  select count(*) into v_unmapped from public.tournament_games where side_a_id is null or side_b_id is null or age_group is null;
  if v_unmapped > 0 then
    raise exception '% tournament game(s) did not map onto the new side model. Nothing has been dropped; investigate before re-running.', v_unmapped;
  end if;
end $$;

alter table public.tournament_games alter column side_a_id set not null;
alter table public.tournament_games alter column side_b_id set not null;
alter table public.tournament_games alter column age_group set not null;

-- -----------------------------------------------------------------------------------------------------
-- 4. The invariants, at the database boundary.
--
-- A game is between two DIFFERENT sides, both in THIS tournament, both in the SAME competition, on a
-- day the tournament actually runs. None of this is left to the client: a round robin generator will
-- later write these rows in bulk, and a generator with an off-by-one is exactly what a constraint is
-- for. Expressed as a trigger rather than CHECKs because every rule needs another row to confirm it.
-- -----------------------------------------------------------------------------------------------------

create or replace function internal.validate_tournament_game_sides()
returns trigger
language plpgsql
as $$
declare
  a record;
  b record;
  v_start date;
  v_end date;
begin
  if new.side_a_id = new.side_b_id then
    raise exception 'A side cannot play itself.' using errcode = '23514';
  end if;

  select tournament_id, age_group into a from public.tournament_participants where id = new.side_a_id;
  select tournament_id, age_group into b from public.tournament_participants where id = new.side_b_id;

  if a.tournament_id is null or b.tournament_id is null then
    raise exception 'Both sides of a game must be sides entered in a tournament.' using errcode = 'P0002';
  end if;
  if a.tournament_id <> new.tournament_id or b.tournament_id <> new.tournament_id then
    raise exception 'A game can only be played between sides in its own tournament.' using errcode = '23514';
  end if;
  if a.age_group <> b.age_group then
    raise exception 'A game cannot be played between two different age groups (% and %).', a.age_group, b.age_group using errcode = '23514';
  end if;
  if new.age_group is distinct from a.age_group then
    raise exception 'A game belongs to the competition its sides are entered in (%), not %.', a.age_group, new.age_group using errcode = '23514';
  end if;
  if not exists (select 1 from public.tournament_age_groups g where g.tournament_id = new.tournament_id and g.age_group = new.age_group) then
    raise exception 'This tournament does not run a % competition.', new.age_group using errcode = '23514';
  end if;

  -- THE DAY MUST BE A DAY THE TOURNAMENT RUNS. A two-day festival is 12-13 June; 11 or 14 June is not
  -- a tournament day, and a date picker hiding them is not an invariant.
  select event_date, coalesce(ends_on, event_date) into v_start, v_end
  from public.tournaments where id = new.tournament_id;
  if new.game_date is null or new.game_date < v_start or new.game_date > v_end then
    raise exception 'A game must be played on a day the tournament runs (% to %).', v_start, v_end using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_games_validate_sides on public.tournament_games;
create trigger tournament_games_validate_sides
before insert or update on public.tournament_games
for each row execute function internal.validate_tournament_game_sides();

create index if not exists tournament_games_side_a_idx on public.tournament_games (side_a_id);
create index if not exists tournament_games_side_b_idx on public.tournament_games (side_b_id);
create index if not exists tournament_games_competition_idx on public.tournament_games (tournament_id, age_group, game_date);

comment on column public.tournament_games.side_a_id is
  'One of the two sides, as a tournament_participants row. Deliberately NOT "our team": either side may '
  'be the host, a visiting club, an unclaimed directory club or a manually recorded side. Before '
  '20270605000000 this was entry_id, which could only be the host, so a game between two visiting clubs '
  'could not be expressed at all.';
comment on column public.tournament_games.age_group is
  'The age-group competition this game belongs to. Enforced to match both sides and to be a competition '
  'the tournament actually runs -- never inferred from a name.';

-- -----------------------------------------------------------------------------------------------------
-- 5. The scores stop being "ours" and "theirs".
--
-- `our_score` / `opponent_score` only make sense when one side is always the host. With two symmetric
-- sides they become side A's and side B's.
-- -----------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='tournament_games' and column_name='our_score') then
    alter table public.tournament_games rename column our_score to side_a_score;
    alter table public.tournament_games rename column opponent_score to side_b_score;
  end if;
end $$;

-- -----------------------------------------------------------------------------------------------------
-- 6. Scheduling a game is the ORGANISER's job, not a team's.
--
-- Authority used to be `can_manage_tournament_entry(entry_id)` -- permission over the host's own entry.
-- A game between two visiting clubs has no host entry, and the person who schedules it is the
-- tournament organiser, so authority is now over the TOURNAMENT.
-- -----------------------------------------------------------------------------------------------------

drop function if exists public.save_tournament_game(uuid, uuid, date, uuid, time without time zone, integer, uuid, text, integer, integer);

create or replace function public.save_tournament_game(
  p_tournament_id uuid,
  p_side_a_id uuid,
  p_side_b_id uuid,
  p_age_group text,
  p_game_date date,
  p_game_id uuid default null,
  p_start_time time without time zone default null,
  p_duration_minutes integer default null,
  p_pitch_id uuid default null,
  p_status text default 'SCHEDULED',
  p_side_a_score integer default null,
  p_side_b_score integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  if p_status not in ('SCHEDULED', 'CANCELLED', 'PLAYED') then
    raise exception 'That is not a valid game status.' using errcode = '22023';
  end if;

  -- Every other rule -- same tournament, same competition, not itself, a day the tournament runs -- is
  -- enforced by `internal.validate_tournament_game_sides`, so a bulk writer gets them too.
  if p_game_id is null then
    insert into public.tournament_games (
      tournament_id, side_a_id, side_b_id, age_group, game_date, start_time, duration_minutes,
      pitch_id, status, sort_order, side_a_score, side_b_score, created_by, updated_by
    ) values (
      p_tournament_id, p_side_a_id, p_side_b_id, p_age_group, p_game_date, p_start_time, p_duration_minutes,
      p_pitch_id, p_status,
      coalesce((select max(sort_order) + 1 from public.tournament_games where tournament_id = p_tournament_id and age_group = p_age_group), 0),
      p_side_a_score, p_side_b_score, auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.tournament_games set
      side_a_id = p_side_a_id, side_b_id = p_side_b_id, age_group = p_age_group,
      game_date = p_game_date, start_time = p_start_time, duration_minutes = p_duration_minutes,
      pitch_id = p_pitch_id, status = p_status,
      side_a_score = p_side_a_score, side_b_score = p_side_b_score,
      updated_by = auth.uid(), updated_at = now()
    where id = p_game_id and tournament_id = p_tournament_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That game does not exist in this tournament.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $function$;

revoke all on function public.save_tournament_game(uuid, uuid, uuid, text, date, uuid, time without time zone, integer, uuid, text, integer, integer) from public, anon;
grant execute on function public.save_tournament_game(uuid, uuid, uuid, text, date, uuid, time without time zone, integer, uuid, text, integer, integer) to authenticated;

create or replace function public.delete_tournament_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid;
begin
  select tournament_id into v_tournament from public.tournament_games where id = p_game_id;
  if v_tournament is null then
    raise exception 'That game does not exist.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  delete from public.tournament_games where id = p_game_id;
end $function$;

revoke all on function public.delete_tournament_game(uuid) from public, anon;
grant execute on function public.delete_tournament_game(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 7. The old host-centric columns go.
--
-- Keeping them nullable "just in case" would leave two answers to "who is playing", which is the defect
-- rather than a softer version of it.
-- -----------------------------------------------------------------------------------------------------

drop trigger if exists tournament_games_validate on public.tournament_games;
drop function if exists internal.validate_tournament_game() cascade;
alter table public.tournament_games drop column if exists entry_id;
alter table public.tournament_games drop column if exists opponent_id;


-- -----------------------------------------------------------------------------------------------------
-- 8. The Tournament Centre read model follows the sides.
--
-- `get_tournament_centre` projected games as "our entry versus an opponent", reading the two columns
-- this migration drops. It now finds the games either of whose sides IS this entry, and names the other
-- one. The OUTPUT SHAPE IS UNCHANGED -- `opponentId`, `ourScore`, `opponentScore` -- because within one
-- entry's view there genuinely is an "us"; what changed is that "us" is now resolved per game rather
-- than being baked into the table. The web Tournament Centre therefore needs no edit.
-- -----------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_tournament_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', tp.id,
        'clubName', icd.name,
        'teamTypeLabel', ictt.label,
        'status', tp.status
      ) order by icd.name)
      from public.tournament_participants tp
      join public.club_directory icd on icd.id = tp.club_directory_id
      join public.canonical_team_types ictt on ictt.id = tp.canonical_team_type_id
      where tp.tournament_id = t.id
        and tp.status = 'pending'
        and ((tp.team_id is not null and internal.can('calendar.event.manage', 'team', tp.club_id, tp.team_id, null))
             or (tp.club_id is not null and internal.can('tournament.tournament.manage', 'club', tp.club_id, null, null)))
    ), '[]'::jsonb),

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
          'clubLogoPath', c.logo_storage_path,
          'directoryLogoPath', cd.logo_storage_path,
          'canManageEntry', internal.can_manage_tournament_entry(e.id),
          -- WHOSE TEAM THIS IS, from the viewer's point of view. Presentation
          -- only: it chooses the tab that opens, and hides nothing.
          'isMine', (
            internal.can('calendar.event.manage', 'team', e.club_id, e.team_id, null)
            or exists (
              select 1 from public.player_team_memberships ptm
              where ptm.team_id = e.team_id
                and ptm.status = 'active'
                and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
            )
          ),
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
              'opponentId', other.id,
              'opponentClubName', gcd.name,
              'gameDate', g.game_date,
              'startTime', g.start_time,
              'durationMinutes', g.duration_minutes,
              'pitchId', g.pitch_id,
              'pitchName', gp.display_name,
              'status', g.status,
              'ourScore', case when g.side_a_id = mine.id then g.side_a_score else g.side_b_score end,
              'opponentScore', case when g.side_a_id = mine.id then g.side_b_score else g.side_a_score end
            ) order by g.game_date, g.start_time nulls last, g.sort_order)
            from public.tournament_participants mine
            join public.tournament_games g on (g.side_a_id = mine.id or g.side_b_id = mine.id)
            join public.tournament_participants other
              on other.id = case when g.side_a_id = mine.id then g.side_b_id else g.side_a_id end
            join public.club_directory gcd on gcd.id = other.club_directory_id
            left join public.club_pitches gp on gp.id = g.pitch_id
            where mine.tournament_id = t.id and mine.team_id = e.team_id
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
end $function$

;

-- -----------------------------------------------------------------------------------------------------
-- 9. `tournament_team_entries` becomes a VIEW over the host's own sides.
--
-- This is the point of the whole migration: ONE place a side lives. Thirteen database functions and
-- twelve source files read this name and keep working, but there is no longer a second side table
-- behind it that can drift from the first.
--
-- `tournament_entry_opponents` pointed at the old table's ids, so it is remapped onto the host's
-- participant rows first -- same meaning (which opponents this host side has lined up), expressed
-- against the one side table.
-- -----------------------------------------------------------------------------------------------------

alter table public.tournament_entry_opponents add column if not exists entry_participant_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tournament_entry_opponents' and column_name='entry_participant_id'
  ) then
    return;
  end if;
  execute $m$
update public.tournament_entry_opponents o
set entry_participant_id = p.id
from public.tournament_team_entries e
join public.tournament_participants p
  on p.tournament_id = e.tournament_id and p.team_id = e.team_id
where e.id = o.entry_id and o.entry_participant_id is null;
  $m$;
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.tournament_entry_opponents where entry_participant_id is null;
  if v_n > 0 then
    raise exception '% opponent row(s) could not be remapped onto a host side. Nothing dropped; investigate.', v_n;
  end if;
end $$;

-- The row-level policy reads `entry_id`, so it is dropped and re-stated against the one side table
-- rather than CASCADE-ing it away silently. Same rule, same visibility: you may read an opponent row
-- if you may see its tournament.
drop policy if exists tournament_entry_opponents_select on public.tournament_entry_opponents;

alter table public.tournament_entry_opponents drop constraint if exists tournament_entry_opponents_entry_id_participant_id_key;
alter table public.tournament_entry_opponents drop column entry_id;
alter table public.tournament_entry_opponents rename column entry_participant_id to entry_id;
alter table public.tournament_entry_opponents alter column entry_id set not null;
alter table public.tournament_entry_opponents
  add constraint tournament_entry_opponents_entry_id_fkey
  foreign key (entry_id) references public.tournament_participants(id) on delete cascade;
alter table public.tournament_entry_opponents
  add constraint tournament_entry_opponents_entry_id_participant_id_key unique (entry_id, participant_id);

create policy tournament_entry_opponents_select on public.tournament_entry_opponents
for select to authenticated
using (
  exists (
    select 1 from public.tournament_participants p
    where p.id = tournament_entry_opponents.entry_id
      and internal.tournament_visible_row(p.tournament_id)
  )
);

-- THE TABLE GOES; THE NAME STAYS, as a projection of the one side table.
--
-- DROP WHAT IT ACTUALLY IS. `drop table if exists` on something that is now a view, and
-- `drop view if exists` on something that is still a table, are BOTH hard errors in PostgreSQL -- the
-- `if exists` only forgives absence, not a different kind of object. So the two cases cannot simply be
-- written one after the other, which is how this first went wrong: the pair read as belt and braces and
-- was in fact guaranteed to fail one way or the other.
--
--   on a FIRST run (a clean boot)     the name is a TABLE   -> drop table
--   on a SECOND run (already applied) the name is a VIEW    -> drop view
--
-- Found by booting the chain from empty, where it had always been a table and `drop view if exists`
-- refused it with "tournament_team_entries is not a view".
do $$
declare v_kind char;
begin
  select c.relkind into v_kind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'tournament_team_entries';

  if v_kind = 'v' then
    drop view public.tournament_team_entries;
  elsif v_kind = 'r' then
    drop table public.tournament_team_entries;
  elsif v_kind is not null then
    raise exception 'tournament_team_entries is a % and this migration only knows how to replace a table or a view.', v_kind;
  end if;
end $$;

-- CALLER'S RIGHTS FROM THE MOMENT IT EXISTS (release readiness, 8 Oct 2026). Created owner-rights, this view let
-- any signed-in user read every host side of every tournament -- private ones included -- past the base tables'
-- row level security, until 20270608000000 switched it. 608's own `alter view ... set (security_invoker = true)`
-- and its assertion still run and are now idempotent; the intermediate state between the two no longer exists.
create view public.tournament_team_entries with (security_invoker = true) as
select
  p.id,
  p.tournament_id,
  p.team_id,
  p.club_id,
  null::text          as notes,
  p.invited_by        as created_by,
  p.invited_by        as updated_by,
  p.created_at,
  p.updated_at
from public.tournament_participants p
join public.tournaments t on t.id = p.tournament_id
where p.team_id is not null
  and p.club_id is not null
  and p.club_id = t.host_club_id;

comment on view public.tournament_team_entries is
  'The HOST club''s own sides, as a projection of public.tournament_participants -- which since '
  '20270605000000 is the one canonical tournament side table. This was a separate table, and that '
  'split was the reason a tournament game could only ever have the host on one end. Readers kept this '
  'name; writers go through add_tournament_team_entry / remove_tournament_team_entry, which now write '
  'participants.';

grant select on public.tournament_team_entries to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 10. Writing through the view.
--
-- Four functions write host entries: add_tournament_team_entry, remove_tournament_team_entry,
-- create_tournament_with_teams and set_tournament_age_groups. They keep their existing statements and
-- these triggers put the row in the one side table -- so there is a single write path to one table,
-- reached by the name those functions already use.
-- -----------------------------------------------------------------------------------------------------

create or replace function internal.tournament_team_entry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dir uuid;
  v_grade text;
  v_type uuid;
  v_id uuid;
begin
  select c.directory_id into v_dir from public.clubs c where c.id = new.club_id;
  select coalesce(t.age_group, 'SENIOR'), t.canonical_team_type_id into v_grade, v_type
  from public.teams t where t.id = new.team_id;
  if v_dir is null or v_grade is null then
    raise exception 'That team could not be entered -- its club or age group could not be resolved.' using errcode = 'P0002';
  end if;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status, invited_by, invited_at
  ) values (
    new.tournament_id, v_dir, new.club_id, new.team_id, v_type, v_grade, 'added', coalesce(new.created_by, auth.uid()), now()
  )
  on conflict do nothing
  returning id into v_id;

  -- Entering the same team twice is one entry, which is what the old table's unique index said too.
  if v_id is null then
    select id into v_id from public.tournament_participants
    where tournament_id = new.tournament_id and team_id = new.team_id;
  end if;

  new.id := v_id;
  return new;
end;
$$;

create or replace function internal.tournament_team_entry_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tournament_participants where id = old.id;
  return old;
end;
$$;

drop trigger if exists tournament_team_entries_insert on public.tournament_team_entries;
create trigger tournament_team_entries_insert
instead of insert on public.tournament_team_entries
for each row execute function internal.tournament_team_entry_insert();

drop trigger if exists tournament_team_entries_delete on public.tournament_team_entries;
create trigger tournament_team_entries_delete
instead of delete on public.tournament_team_entries
for each row execute function internal.tournament_team_entry_delete();

-- -----------------------------------------------------------------------------------------------------
-- 11. The host-entry writers target the side table directly.
--
-- `add_tournament_team_entry` used `on conflict (tournament_id, team_id)`, and a view has no unique
-- index to conflict on. Rather than hide that behind the INSTEAD OF trigger, the two functions that
-- own host entries now write `tournament_participants` explicitly: one write path, visible in the
-- function that performs it, with the view left as what it is -- a read projection.
--
-- The INSTEAD OF triggers stay for any other writer that reaches the old name.
-- -----------------------------------------------------------------------------------------------------

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'add_tournament_team_entry';
  if v_def is null then
    raise exception 'add_tournament_team_entry is missing.';
  end if;
  if position('insert into public.tournament_team_entries' in v_def) > 0 then
    v_def := replace(
      v_def,
      'insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by)
  values (p_tournament_id, p_team_id, v_team_club, auth.uid())
  on conflict (tournament_id, team_id) do nothing
  returning id into v_id;',
      'insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status, invited_by, invited_at
  )
  select p_tournament_id, c.directory_id, v_team_club, p_team_id, t.canonical_team_type_id,
         coalesce(t.age_group, ''SENIOR''), ''added'', auth.uid(), now()
  from public.teams t join public.clubs c on c.id = t.club_id
  where t.id = p_team_id
  on conflict do nothing
  returning id into v_id;'
    );
    execute v_def;
  end if;
end $$;

-- `remove_tournament_team_entry` deletes by id; the view's id IS the participant id, so a delete
-- against the side table is the same row. Restated explicitly for the same reason as above.
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'remove_tournament_team_entry';
  if v_def is not null and position('delete from public.tournament_team_entries' in v_def) > 0 then
    v_def := replace(v_def, 'delete from public.tournament_team_entries', 'delete from public.tournament_participants');
    execute v_def;
  end if;
end $$;

-- `create_tournament_with_teams` writes the host's own sides during creation, with the same ON CONFLICT
-- a view cannot offer. Pointed at the side table for the same reason as the two functions above.
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'create_tournament_with_teams';
  if v_def is null then
    raise exception 'create_tournament_with_teams is missing.';
  end if;
  if position('insert into public.tournament_team_entries' in v_def) > 0 then
    v_def := replace(
      v_def,
      'insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by)
    values (v_id, v_team.id, v_team.club_id, auth.uid())
    on conflict (tournament_id, team_id) do nothing;',
      'insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status, invited_by, invited_at
    )
    select v_id, hc.directory_id, v_team.club_id, v_team.id, ht.canonical_team_type_id,
           coalesce(ht.age_group, ''SENIOR''), ''added'', auth.uid(), now()
    from public.teams ht join public.clubs hc on hc.id = ht.club_id
    where ht.id = v_team.id
    on conflict do nothing;'
    );
    execute v_def;
  end if;
end $$;

-- =====================================================================================================
-- A GAME'S PITCH IS THE HOST'S OR THE TOURNAMENT'S (release readiness, 8 Oct 2026).
--
-- `internal.validate_tournament_game()` (20270217000000), dropped above with the host-centric columns, was the
-- only place that refused a pitch neither owned by the host club nor reserved by the tournament -- and the side
-- validator that replaced it checks sides, age group and date but not the pitch, while `save_tournament_game`
-- and `save_tournament_plan_schedule` accept a caller-supplied pitch. This is that rule again, word for word, on
-- its own trigger so no later rewrite of the side validator can drop it. It is a rule about which pitch a game
-- may stand on, not about who may place it: arranging pitches stays `venue.pitch_allocation.manage`, and the
-- authority to save a game stays the tournament's own.
-- =====================================================================================================
create or replace function internal.validate_tournament_game_pitch()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host_club uuid;
  v_pitch_club uuid;
begin
  if new.pitch_id is null then
    return new;
  end if;
  select tr.host_club_id into v_host_club from public.tournaments tr where tr.id = new.tournament_id;
  select cp.club_id into v_pitch_club from public.club_pitches cp where cp.id = new.pitch_id;
  if not exists (
    select 1 from public.tournament_pitches tp
    where tp.tournament_id = new.tournament_id and tp.pitch_id = new.pitch_id
  ) and (v_host_club is null or v_pitch_club is distinct from v_host_club) then
    raise exception 'That pitch is neither reserved by this tournament nor owned by the host club.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function internal.validate_tournament_game_pitch() from public, anon, authenticated;

drop trigger if exists tournament_games_validate_pitch on public.tournament_games;
create trigger tournament_games_validate_pitch
  before insert or update of pitch_id, tournament_id on public.tournament_games
  for each row execute function internal.validate_tournament_game_pitch();
