-- ===========================================================================
-- ONE AVAILABILITY QUESTION, HOWEVER IT IS ASKED
-- ===========================================================================
--
-- M6 brought Match Centre and Training Centre to the phone. Doing the
-- archaeology first -- reading what the web product actually does rather than
-- what the notes say it does -- turned up three places where the FIXTURE half
-- of availability is weaker than the TRAINING half, for the same person under
-- the same policy. None of them is a mobile problem. All three would have had
-- to be worked around in React Native, which is precisely the drift a shared
-- product cannot afford, so they are fixed here where both clients inherit the
-- fix.
--
-- ---------------------------------------------------------------------------
-- 1. A CANCELLED FIXTURE ACCEPTED ANSWERS
-- ---------------------------------------------------------------------------
--
-- `respond_to_training_attendance` refuses a cancelled session outright, with
-- 42501 and a sentence. `respond_to_attendance` did not refuse a cancelled
-- FIXTURE at all -- the rule existed only in TypeScript, in the Match Centre
-- resolver, as `canRespond && !f.cancelled_at`. So the web behaved correctly
-- and the boundary was not the database's.
--
-- That is a missing server boundary rather than a cosmetic gap: any other
-- caller -- this app, a future integration, a curl against the RPC -- could
-- record an answer to a match that is not happening, and the club would then
-- read a confident number about a cancelled fixture. The guard moves to where
-- the training one already is.
--
-- DELIBERATELY NOT EXTENDED TO 'Completed'. Answering a match that has already
-- been played changes nothing, and the web does not offer it (the Agenda's own
-- answerability rule excludes a past date). But the Match Centre page DOES
-- still render the control on a completed fixture, so refusing it here would
-- change established product behaviour rather than enforce it. Flagged for the
-- owner instead of decided in a migration.
--
-- ---------------------------------------------------------------------------
-- 2. THE MEMBERSHIP CHECK READ TWO GENERATED COLUMNS THAT ARE OFTEN NULL
-- ---------------------------------------------------------------------------
--
-- `respond_to_attendance` located the fixture's teams like this:
--
--     ptm.team_id in (f.home_team_id, f.away_team_id)
--
-- `home_team_id` and `away_team_id` are GENERATED columns:
--
--     case when home_away = 'Home' then owning_team_id
--          when home_away = 'Away' then opponent_team_id
--          else NULL end
--
-- So for a fixture whose orientation is 'TBD' or 'Not Applicable' -- both real,
-- both settable, and 'To Be Determined' is a canonical fixture status with its
-- own Match Centre state -- BOTH columns are null, the check matches nothing,
-- and a legitimate answer is refused with "This player is not associated with a
-- team involved in this fixture." The page offers three buttons and the database
-- says the child is not on the team.
--
-- It also ignored SCHEDULING GROUPS. Mini-Rugby trains and plays as a group
-- rather than a team, `respond_to_training_attendance` resolves group members,
-- and the Match Centre resolver builds its participant list from group members
-- too -- then the write refused every one of them.
--
-- Both are fixed by asking the canonical question instead of rebuilding it:
-- `internal.fixture_participant_team_ids` already resolves owning team,
-- opponent team and both sides' scheduling group members, independently of
-- orientation. It is what `internal.fixture_attendance_readable_team_ids` and
-- `fixture_availability_summary` already use, so the writer and the readers now
-- agree about who is in a fixture.
--
-- THE ROW LOCK IS KEPT. The original took `for share of ptm` so a concurrent
-- move of the player decides the race one way or the other (R20). That lock has
-- to stay in the WRITER and cannot move into a stable helper, so the membership
-- predicate stays inline here and only the fixture-level rule is shared.
--
-- ---------------------------------------------------------------------------
-- 3. TRAINING HAD A "WHO MAY I ANSWER FOR" RPC AND FIXTURES DID NOT
-- ---------------------------------------------------------------------------
--
-- `get_my_players_for_training_session` answers it in one call. The fixture
-- side had no equivalent, so the Match Centre resolver assembled it in
-- TypeScript: read `guardians`, read `players`, read `player_team_memberships`,
-- read `player_fixture_attendance`, intersect them by hand, then call
-- `get_my_attendance_authority` once per surviving player. Correct, but it is
-- the safeguarding-adjacent shape of "which children am I answering for"
-- written out in a client -- and a second client would have had to write it
-- again, by hand, from the same four tables.
--
-- So `public.get_my_players_for_fixture` is added as the fixture twin of the
-- training function, and BOTH now carry `can_respond` and `denial_reason`
-- inline. The N+1 authority calls disappear from the web resolver, and the app
-- asks one question. The authority itself is unchanged: both call
-- `internal.resolve_attendance_response_source` through the same
-- `get_my_attendance_authority` wrapper the web already used, so no new rule is
-- introduced and none is relaxed. An under-16 answering for themselves is still
-- refused, by the same function, with the same sentence.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The fixture-level rule, in one place
-- ---------------------------------------------------------------------------
--
-- Returns the reason an answer cannot be recorded against this fixture AT ALL,
-- or null when it can. Nothing about WHO is asking: that is the authority
-- resolver's job, and keeping the two apart is what stops a safeguarding rule
-- and a scheduling rule ending up in one condition nobody can read.
create or replace function internal.fixture_accepts_attendance(p_fixture_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return 'This fixture could not be found.';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    return 'This fixture has been cancelled, so no answer is needed.';
  end if;
  return null;
end;
$$;

comment on function internal.fixture_accepts_attendance is
  'The reason an availability answer cannot be recorded against this fixture, or null when it can. Fixture-level only -- says nothing about who is asking, which is internal.resolve_attendance_response_source. Mirrors the cancelled-session refusal respond_to_training_attendance has always had; the fixture writer previously carried no such guard and the rule lived only in the web resolver.';

revoke all on function internal.fixture_accepts_attendance(uuid) from public;

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_refusal text;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  -- The fixture-level rule, shared with the reader so the control is never
  -- offered where the write would refuse.
  v_refusal := internal.fixture_accepts_attendance(p_fixture_id);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  -- The player's place in a team involved in this fixture is locked for the
  -- response, so a concurrent move decides it one way or the other (R20).
  --
  -- Teams come from internal.fixture_participant_team_ids, NOT from the
  -- generated home_team_id/away_team_id columns: those are null for any fixture
  -- whose orientation is 'TBD' or 'Not Applicable', which made every such
  -- fixture unanswerable, and they know nothing about scheduling groups, which
  -- made every Mini-Rugby group fixture unanswerable too.
  perform 1
  from public.player_team_memberships ptm
  where ptm.player_id = p_player_id
    and ptm.state = 'ACTIVE'
    and ptm.team_id in (select team_id from internal.fixture_participant_team_ids(p_fixture_id))
  for share of ptm;
  if not found then
    raise exception 'This player is not associated with a team involved in this fixture.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$$;

comment on function public.respond_to_attendance is
  'Record one availability answer against one fixture. Authority is internal.resolve_attendance_response_source (guardian always; the player themselves at 18+, or 16-17 with recorded guardian consent). Refuses a cancelled fixture, as the training equivalent always has. Participant teams come from internal.fixture_participant_team_ids so orientation-free fixtures (TBD, Not Applicable) and Mini-Rugby scheduling groups are answerable.';

-- ---------------------------------------------------------------------------
-- The readers: who may I answer for, and may I actually answer
-- ---------------------------------------------------------------------------

create or replace function public.get_my_players_for_fixture(p_fixture_id uuid)
returns table (
  player_id uuid,
  first_name text,
  surname text,
  relationship text,
  current_status text,
  can_respond boolean,
  denial_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refusal text;
begin
  if not exists (select 1 from public.fixtures where id = p_fixture_id) then
    raise exception 'Fixture not found.';
  end if;

  -- The SAME fixture-level rule the writer applies, so a client cannot draw a
  -- control the write is going to refuse. A cancelled fixture comes back with
  -- every player present and can_respond false, rather than with an empty list
  -- -- a parent should still be able to see what their child had said.
  v_refusal := internal.fixture_accepts_attendance(p_fixture_id);

  return query
  with mine as (
    select p.id, p.first_name, p.surname, 'guardian'::text as relationship
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
    where ptm.status = 'active'
      and ptm.team_id in (select t.team_id from internal.fixture_participant_team_ids(p_fixture_id) t)
    union
    select p.id, p.first_name, p.surname, 'self'::text
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id and p.user_id = auth.uid()
    where ptm.status = 'active'
      and ptm.team_id in (select t.team_id from internal.fixture_participant_team_ids(p_fixture_id) t)
  )
  select
    m.id,
    m.first_name,
    m.surname,
    m.relationship,
    (select a.status from public.player_fixture_attendance a where a.fixture_id = p_fixture_id and a.player_id = m.id),
    coalesce(auth_row.can_respond, false) and v_refusal is null,
    coalesce(v_refusal, auth_row.denial_reason)
  from mine m
  cross join lateral public.get_my_attendance_authority(m.id) auth_row
  order by m.first_name, m.surname;
end;
$$;

comment on function public.get_my_players_for_fixture is
  'The players this caller may answer availability for on one fixture, their current answer, and whether an answer can actually be recorded. The fixture twin of get_my_players_for_training_session, added because the Match Centre resolver was assembling the same thing in TypeScript from four tables plus one authority call per player -- work a second client would otherwise have had to repeat by hand. Introduces no authority: can_respond is get_my_attendance_authority, which is internal.resolve_attendance_response_source.';

revoke all on function public.get_my_players_for_fixture(uuid) from public;
grant execute on function public.get_my_players_for_fixture(uuid) to authenticated, service_role;

-- The training twin, recreated with the same two authority columns so the two
-- surfaces answer the same question in the same shape. Dropped rather than
-- replaced because the return type changes; every existing caller reads by
-- column NAME, so nothing that worked stops working.
drop function if exists public.get_my_players_for_training_session(uuid);

create function public.get_my_players_for_training_session(p_training_session_id uuid)
returns table (
  player_id uuid,
  first_name text,
  surname text,
  relationship text,
  current_status text,
  can_respond boolean,
  denial_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.training_sessions;
  v_refusal text;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  -- The same sentence respond_to_training_attendance raises, so the control is
  -- never offered where the write would refuse -- and said once rather than
  -- re-derived by each client from `status = 'CANCELLED'`.
  v_refusal := case
    when s.status = 'CANCELLED' then 'This session has been cancelled, so no answer is needed.'
    else null
  end;

  return query
  with mine as (
    select p.id, p.first_name, p.surname, 'guardian'::text as relationship
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
    where ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
    union
    select p.id, p.first_name, p.surname, 'self'::text
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id and p.user_id = auth.uid()
    where ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
  )
  select
    m.id,
    m.first_name,
    m.surname,
    m.relationship,
    (select a.status from public.player_fixture_attendance a where a.training_session_id = p_training_session_id and a.player_id = m.id),
    coalesce(auth_row.can_respond, false) and v_refusal is null,
    coalesce(v_refusal, auth_row.denial_reason)
  from mine m
  cross join lateral public.get_my_attendance_authority(m.id) auth_row
  order by m.first_name, m.surname;
end;
$$;

comment on function public.get_my_players_for_training_session is
  'The players this caller may answer availability for on one training session, their current answer, and whether an answer can actually be recorded. Gained can_respond/denial_reason in M6 so that it matches get_my_players_for_fixture and neither client has to call get_my_attendance_authority once per child.';

revoke all on function public.get_my_players_for_training_session(uuid) from public;
grant execute on function public.get_my_players_for_training_session(uuid) to authenticated, service_role;
