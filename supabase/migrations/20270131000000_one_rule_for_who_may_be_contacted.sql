-- ===========================================================================
-- ONE RULE FOR WHO MAY BE CONTACTED ABOUT A PLAYER
-- ===========================================================================
--
-- The two-week invitation job runs on a schedule. It has no caller, so
-- auth.uid() is null inside it.
--
-- internal.fixture_communication_team_ids is deliberately CALLER-SCOPED: it
-- answers "which teams in this fixture may THIS person message", via
-- internal.can_manage_fixture_side. That is exactly right for a coach pressing
-- Send, and exactly wrong for a scheduled job -- with no caller it resolves to
-- zero teams, so the job would run every day, report success, and invite
-- nobody. Silent, and only discoverable by noticing that families were never
-- asked.
--
-- The fix is NOT to loosen the staff resolver, and NOT to copy the
-- safeguarding rule into the job. It is to separate two questions that were
-- previously answered by one function chain:
--
--   1. WHICH PLAYERS is this about?   -- differs by context. A coach messages
--      their own side. A platform job asking about availability is about
--      everyone playing in the fixture, on both sides, because it is the
--      fixture that is happening, not one club's half of it.
--
--   2. WHO MAY BE CONTACTED about those players?  -- must NEVER differ. Active
--      guardians always; the player themselves only at 18+, or 16-17 where
--      guardians have granted direct_coach_communication. That rule is
--      safeguarding, and a second copy of it is a second thing to get wrong.
--
-- So (2) moves into one function that both paths call, and (1) gains a
-- system-scoped sibling alongside the existing caller-scoped one. The staff
-- path's observable behaviour is unchanged -- it is rewritten to call the
-- shared rule rather than to restate it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (2) The safeguarding rule -- now stated exactly once
-- ---------------------------------------------------------------------------
create or replace function internal.notifiable_users_for_players(p_player_ids uuid[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select distinct r.user_id
  from (
    -- Every ACTIVE guardian. Active is the operative word: a pending
    -- guardian-link request grants nothing, and an ended relationship is not
    -- a relationship.
    select g.guardian_user_id as user_id
    from public.guardians g
    where g.player_id = any(p_player_ids)
      and g.status = 'active'
    union
    -- The player themselves, only where the canonical consent domain already
    -- allows a young person to be dealt with directly. HAVING A LOGIN IS NOT
    -- THE TEST: a 12-year-old with their own account is still a 12-year-old.
    select p.user_id
    from public.players p
    where p.id = any(p_player_ids)
      and p.user_id is not null
      and (
        internal.player_effective_age(p.id) >= 18
        or (
          internal.player_effective_age(p.id) in (16, 17)
          and internal.guardian_permission_effective(p.id, 'direct_coach_communication')
        )
      )
  ) r
  where r.user_id is not null;
$$;

comment on function internal.notifiable_users_for_players is
  'THE rule for who may be contacted about a set of players: every active guardian, plus the player themselves only at 18+ or at 16-17 with direct_coach_communication consent. Called by both the staff fixture communication path and the scheduled attendance-invitation job so that the safeguarding boundary exists in exactly one place. Returns DISTINCT user ids, so one adult who guardians two children in the same audience is contacted once.';

revoke all on function internal.notifiable_users_for_players(uuid[]) from public;
grant execute on function internal.notifiable_users_for_players(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The staff path, rewritten to CALL the rule rather than restate it
-- ---------------------------------------------------------------------------
-- Behaviour is unchanged; this is the same rule, read from one place. The
-- caller-scoped player resolution above it is untouched, so a coach still
-- reaches only the side they manage.
create or replace function internal.fixture_audience_recipients(p_fixture_id uuid, p_audience text)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select r.user_id
  from internal.notifiable_users_for_players(
    array(select player_id from internal.fixture_audience_players(p_fixture_id, p_audience))
  ) r;
$$;

comment on function internal.fixture_audience_recipients is
  'Which PEOPLE represent the players in a staff-selected audience for this fixture. Player selection stays caller-scoped (a coach reaches only the side they manage); who may be contacted about those players comes from internal.notifiable_users_for_players, the single safeguarding rule shared with the scheduled invitation job.';

revoke all on function internal.fixture_audience_recipients(uuid, text) from public;
grant execute on function internal.fixture_audience_recipients(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (1) System-scoped: who is actually playing in this fixture?
-- ---------------------------------------------------------------------------
--
-- Both sides, because one physical fixture is one match and both squads turn
-- up to it. Where the opposition is an unclaimed directory entry there simply
-- are no teams on that side, and nothing is invented for it.
--
-- This function answers a question about the FIXTURE, not about a viewer, so
-- it takes no account of who is asking. It is never reachable from the
-- browser: revoked from public and not granted to authenticated. The only
-- caller is the scheduled job below it, which runs as a definer with no user.
create or replace function internal.fixture_participant_team_ids(p_fixture_id uuid)
returns table (team_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with f as (select * from public.fixtures where id = p_fixture_id)
  select distinct t.team_id
  from f
  cross join lateral (
    select f.owning_team_id as team_id where f.owning_team_id is not null
    union
    select f.opponent_team_id where f.opponent_team_id is not null
    union
    select sgm.team_id
    from public.scheduling_group_members sgm
    where f.owning_scheduling_group_id is not null and sgm.group_id = f.owning_scheduling_group_id
    union
    select sgm.team_id
    from public.scheduling_group_members sgm
    where f.opponent_scheduling_group_id is not null and sgm.group_id = f.opponent_scheduling_group_id
  ) t
  where t.team_id is not null;
$$;

comment on function internal.fixture_participant_team_ids is
  'Every team genuinely playing in this fixture, on BOTH sides, including every component team of a Mini-Rugby group. Caller-independent by design -- this is a fact about the fixture, not about a viewer -- and therefore never granted to authenticated. Contrast internal.fixture_communication_team_ids, which is caller-scoped on purpose so a coach messages only the side they manage.';

revoke all on function internal.fixture_participant_team_ids(uuid) from public;

-- Players in the fixture with no canonical response yet. Same definition of
-- "outstanding" the staff reminder uses -- attending, cannot attend and unsure
-- are all answers, and somebody who has given one is not chased.
create or replace function internal.fixture_outstanding_players(p_fixture_id uuid)
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with team_ids as (
    select team_id from internal.fixture_participant_team_ids(p_fixture_id)
  ),
  participants as (
    select distinct ptm.player_id
    from public.player_team_memberships ptm
    join team_ids ti on ti.team_id = ptm.team_id
    where ptm.status = 'active'
    union
    select distinct c.player_id
    from public.fixture_player_call_up c
    join team_ids ti on ti.team_id = c.target_team_id
    where c.fixture_id = p_fixture_id and c.status = 'approved'
  )
  select p.player_id
  from participants p
  where not exists (
    select 1 from public.player_fixture_attendance a
    where a.fixture_id = p_fixture_id and a.player_id = p.player_id
  );
$$;

comment on function internal.fixture_outstanding_players is
  'Players in this fixture -- both sides, permanent members plus approved call-ups -- who have not yet given any attendance response. Caller-independent, for the scheduled invitation job.';

revoke all on function internal.fixture_outstanding_players(uuid) from public;

-- ---------------------------------------------------------------------------
-- The job, now resolving its own audience
-- ---------------------------------------------------------------------------
create or replace function internal.send_due_fixture_attendance_invitations()
returns integer
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_sent integer := 0;
  v_fixture record;
  v_inserted integer;
begin
  for v_fixture in
    select f.id,
           f.kickoff_date,
           f.kickoff_time,
           coalesce(t.display_name, 'Your team') as team_label
    from public.fixtures f
    join internal.fixtures_due_attendance_invitation() d on d.fixture_id = f.id
    left join public.teams t on t.id = f.owning_team_id
  loop
    with eligible as (
      select u.user_id
      from internal.notifiable_users_for_players(
        array(select player_id from internal.fixture_outstanding_players(v_fixture.id))
      ) u
      where not exists (
        select 1 from public.fixture_attendance_invitations i
        where i.fixture_id = v_fixture.id and i.user_id = u.user_id
      )
    ),
    recorded as (
      insert into public.fixture_attendance_invitations (fixture_id, user_id)
      select v_fixture.id, e.user_id from eligible e
      on conflict do nothing
      returning user_id
    )
    insert into public.notifications (user_id, type, title, body, data)
    select
      rec.user_id,
      'fixture_attendance_invitation',
      'Can you make the match?',
      v_fixture.team_label
        || ' play on '
        || to_char(v_fixture.kickoff_date, 'FMDay FMDD FMMonth')
        || coalesce(', kick-off ' || to_char(v_fixture.kickoff_time, 'HH24:MI'), '')
        || '. Let the club know if you can make it.',
      jsonb_build_object('fixture_id', v_fixture.id)
    from recorded rec;

    get diagnostics v_inserted = row_count;
    v_sent := v_sent + v_inserted;
  end loop;

  return v_sent;
end;
$$;

comment on function internal.send_due_fixture_attendance_invitations is
  'Asks everyone legitimately entitled to answer for an outstanding player in each fixture inside the two-week window, once each. Player selection is system-scoped (internal.fixture_outstanding_players -- both sides, because one fixture is one match); who may be contacted comes from internal.notifiable_users_for_players, the same safeguarding rule the staff reminder uses. Idempotent per person per fixture via public.fixture_attendance_invitations, so somebody who becomes eligible later is still asked while everybody already asked is not asked twice. The notification carries the canonical fixture_id and deep-links to that fixture''s one shared Match Centre.';

revoke all on function internal.send_due_fixture_attendance_invitations() from public;
