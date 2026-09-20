-- =====================================================================
-- HOW MANY HAVE ANSWERED, WITHOUT A SCREEN LEARNING TO COUNT
--
-- `public.player_fixture_attendance` has held ATTENDING / CANNOT_ATTEND /
-- UNSURE since the attendance work, and a player who has not answered is the
-- absence of a row. Fixture Operations has never been able to say so: the
-- Control Centre shows a fixture's date, teams, venue and result, and cannot
-- tell a fixture secretary on a Thursday that four of twenty-two have replied.
--
-- WHY THIS IS AN RPC AND NOT A VIEW OR A CLIENT-SIDE COUNT.
--
-- A count read through RLS is the most dangerous shape available here. RLS
-- filters ROWS, so a caller with no attendance authority does not get an
-- error -- they get zero rows, and a screen that counts them renders an
-- authoritative "0 of 22 have replied" that is not false-ish, it is simply
-- false. Convergence Step 6 closed an assertion of exactly this class (an
-- UPDATE that matched no row and reported success), and the rule it left is
-- the one applied here: where the absence of authority and the absence of
-- data look identical, say which it is.
--
-- So a fixture whose attendance the caller may not read is simply ABSENT from
-- the result. Not a zero, and not a row of nulls either: absence is the only
-- answer that says nothing at all, including nothing about whether the fixture
-- exists. The UI renders nothing for a fixture it has no summary for, which is
-- the same thing it does for a fixture with no squad recorded.
--
-- WHICH AUTHORITY.
--
-- `team.attendance.view`, at team or club scope, which is the SAME capability
-- `player_fixture_attendance`'s own RLS policies answer. It is deliberately
-- not `can_manage_fixture_side`, even though that is the authority the Control
-- Centre's other actions use: a definer function that authorises on a
-- different capability from the data it reads is how a caller ends up able to
-- count what they may not see. (Slice 7e closed the mirror image of this --
-- a Site Admin who could change a roster placement they could not read.)
--
-- WHOSE PLAYERS.
--
-- Only the teams the caller actually holds that capability for. A fixture has
-- two sides, and a club administrator's authority over their own squad is not
-- authority over the opposition's: counting every participant would turn a
-- summary into a disclosure of how many of another club's players have said
-- they cannot travel. So the count is restricted to the caller's own
-- authorised teams, and a caller authorised for both sides -- a Site Admin, or
-- one club fielding both -- legitimately sees both.
--
-- THE DENOMINATOR IS THE CANONICAL SQUAD.
--
-- Active `player_team_memberships` on a participating team, plus approved
-- call-ups, which is exactly what `internal.fixture_outstanding_players`
-- already means by "who should answer". No second idea of who is in a squad.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The teams on this fixture whose attendance THIS caller may read.
-- Separate from the summary so the rule is stated once and can be asserted
-- on its own, rather than being buried inside an aggregate.
-- ---------------------------------------------------------------------
create or replace function internal.fixture_attendance_readable_team_ids(p_fixture_id uuid)
returns table(team_id uuid)
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
  select pt.team_id
  from internal.fixture_participant_team_ids(p_fixture_id) pt
  join public.teams t on t.id = pt.team_id
  where internal.has_site_capability('site.fixtures.view')
     or internal.has_capability('team.attendance.view', 'team', t.club_id, t.id)
     or internal.has_capability('team.attendance.view', 'club', t.club_id, null);
$$;

comment on function internal.fixture_attendance_readable_team_ids(uuid) is
  'The participating teams on a fixture whose attendance the caller may read, answered by team.attendance.view -- the same capability player_fixture_attendance RLS answers.';

-- ---------------------------------------------------------------------
-- The summary itself, for many fixtures at once.
--
-- Batched by design: a Control Centre page renders up to a hundred rows, and
-- a per-row call would be a hundred round trips to put one line on each card.
-- The array is bounded so a caller cannot turn the batch into a scan.
-- ---------------------------------------------------------------------
create or replace function public.fixture_availability_summary(p_fixture_ids uuid[])
returns table(
  fixture_id uuid,
  squad_count integer,
  attending_count integer,
  unavailable_count integer,
  unsure_count integer,
  awaiting_count integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_ids uuid[];
begin
  if p_fixture_ids is null or cardinality(p_fixture_ids) = 0 then
    return;
  end if;
  if cardinality(p_fixture_ids) > 200 then
    raise exception 'Too many fixtures requested at once.' using errcode = '22023';
  end if;

  -- A ROW IS RETURNED ONLY WHERE THE CALLER HOLDS ATTENDANCE AUTHORITY.
  --
  -- The first version of this function filtered the requested ids with
  -- `select ... from public.fixtures where id = any(...)` and treated the
  -- survivors as "the fixtures this caller can see". That was vacuous: the
  -- function is SECURITY DEFINER, so it runs as the owner and RLS never
  -- applied to that read -- every id came back, including fixtures belonging
  -- to clubs the caller has nothing to do with. The permanent test caught it,
  -- which is the argument for the test; the lesson is the one Step 6 kept
  -- meeting, that a definer function does not get to ask RLS a question by
  -- accident.
  --
  -- The condition is now the authority itself, which is both narrower and
  -- simpler: holding `team.attendance.view` on a participating team implies
  -- being able to see the fixture, so one check does both jobs. A caller with
  -- no such authority gets NO ROW -- not a row of zeroes, and not a row of
  -- nulls either, so the function cannot even be used to learn that a fixture
  -- id exists.
  select array_agg(f.id) into v_ids
  from unnest(p_fixture_ids) as f(id)
  where exists (select 1 from internal.fixture_attendance_readable_team_ids(f.id));

  if v_ids is null then
    return;
  end if;

  return query
  with readable as (
    select f.id as fixture_id, r.team_id
    from unnest(v_ids) as f(id)
    join lateral internal.fixture_attendance_readable_team_ids(f.id) r on true
  ),
  squad as (
    select distinct rd.fixture_id, ptm.player_id
    from readable rd
    join public.player_team_memberships ptm on ptm.team_id = rd.team_id and ptm.status = 'active'
    union
    select distinct rd.fixture_id, c.player_id
    from readable rd
    join public.fixture_player_call_up c
      on c.target_team_id = rd.team_id and c.fixture_id = rd.fixture_id and c.status = 'approved'
  ),
  answered as (
    select s.fixture_id, s.player_id, a.status
    from squad s
    left join public.player_fixture_attendance a
      on a.fixture_id = s.fixture_id and a.player_id = s.player_id
  )
  select
    f.id,
    (select count(*)::integer from answered an where an.fixture_id = f.id),
    (select count(*)::integer from answered an where an.fixture_id = f.id and an.status = 'ATTENDING'),
    (select count(*)::integer from answered an where an.fixture_id = f.id and an.status = 'CANNOT_ATTEND'),
    (select count(*)::integer from answered an where an.fixture_id = f.id and an.status = 'UNSURE'),
    (select count(*)::integer from answered an where an.fixture_id = f.id and an.status is null)
  from unnest(v_ids) as f(id);
end;
$$;

comment on function public.fixture_availability_summary(uuid[]) is
  'Availability counts over the squads whose attendance the caller may read, answered by team.attendance.view. A fixture on which the caller holds no such authority is ABSENT from the result -- never a row of zeroes, and never a row at all -- so an unauthorised viewer gets no metric, and cannot learn that a fixture id exists.';

revoke all on function public.fixture_availability_summary(uuid[]) from public;
grant execute on function public.fixture_availability_summary(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- The guard the whole migration exists to keep.
--
-- If a later change ever authorises this function on anything other than
-- team.attendance.view (or the site read), it stops being a summary of what
-- the caller may already read. Asserted at migration time rather than left to
-- a comment.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('internal.fixture_attendance_readable_team_ids(uuid)'::regprocedure);
begin
  if position('team.attendance.view' in v_def) = 0 then
    raise exception 'fixture_attendance_readable_team_ids must authorise on team.attendance.view';
  end if;
  if position('can_manage_fixture_side' in v_def) > 0 then
    raise exception 'attendance readability must not be answered by fixture-management authority';
  end if;
end;
$$;
