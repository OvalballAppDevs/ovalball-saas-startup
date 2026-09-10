-- THE CANONICAL RECIPIENT + AUDIENCE RESOLUTION ENGINE.
--
-- SECURITY ARCHITECTURE DECISION (see docs/RECIPIENT_AUDIENCE_ENGINE.md for
-- the full comparison). This does NOT impersonate a recipient's session via
-- set_config('request.jwt.claims', ...) to ask "what would Match Centre show
-- user X". That question was the wrong one. The right question -- proven
-- already, in production, by internal.fixture_audience_recipients
-- (20261103000000_fixture_communications.sql) and internal.
-- notify_training_participants (20261011060000) -- is much simpler: "given
-- these specific player_ids, who are the legitimate human recipients",
-- answered by an explicit, parameterised join against guardians/players,
-- reusing internal.player_effective_age and internal.guardian_permission_
-- effective exactly as those two existing resolvers do. AUTHORITY (may this
-- ACTOR address this audience) is checked against the actor's own real
-- session, via internal.has_capability -- never against an impersonated one.
--
-- internal.player_notification_recipients below is the ONE general-purpose
-- version of that join, parameterised by an arbitrary player_id array so it
-- can serve a team, a club, a fixture's participants or a training session's
-- roster alike, rather than each caller re-deriving the age/consent rule.
-- fixture_audience_recipients itself is left untouched -- it is live Main
-- functionality (Match Centre's "message the team"), and rewriting it to
-- call this new primitive is a Main-project change, not an SP4 one. The
-- predicate is the same rule either way; nothing here weakens or duplicates
-- what it decides, only how it is parameterised for a second caller.

-- ---------------------------------------------------------------------------
-- 1. THE CANONICAL PRIMITIVE: player_ids -> legitimate human recipients
-- ---------------------------------------------------------------------------

create or replace function internal.player_notification_recipients(p_player_ids uuid[])
returns table (player_id uuid, user_id uuid, relationship text)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select distinct a.player_id, r.user_id, r.relationship
  from unnest(p_player_ids) as a(player_id)
  cross join lateral (
    select g.guardian_user_id as user_id, 'guardian'::text as relationship
    from public.guardians g
    where g.player_id = a.player_id and g.status = 'active'
    union
    select p.user_id, 'self'::text
    from public.players p
    where p.id = a.player_id
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

comment on function internal.player_notification_recipients(uuid[]) is
  'THE canonical safeguarding-aware recipient resolver for operational communication, general-purpose over any player_id set. Same rule as internal.fixture_audience_recipients and internal.notify_training_participants: every active guardian, plus the player directly only at 18+ or 16-17 with explicit direct_coach_communication consent. Returns DISTINCT (player_id, user_id) pairs -- never a player_id with no destination silently dropped without being counted by the caller (see internal.player_recipient_exclusions for why a player produced zero rows).';

revoke all on function internal.player_notification_recipients(uuid[]) from public, anon;
grant execute on function internal.player_notification_recipients(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. WHY a player produced zero recipient rows -- the outcome vocabulary
-- ---------------------------------------------------------------------------

-- "Silently drop them" is explicitly prohibited by this engine's brief.
-- One row per player with NO eligible recipient, classified. A player who
-- DID resolve at least one recipient never appears here.
create or replace function internal.player_recipient_exclusions(p_player_ids uuid[])
returns table (player_id uuid, outcome text)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select a.player_id,
    case
      when internal.player_effective_age(a.player_id) in (16, 17)
        and exists (select 1 from public.players p where p.id = a.player_id and p.user_id is not null)
        and not internal.guardian_permission_effective(a.player_id, 'direct_coach_communication')
        and not exists (select 1 from public.guardians g where g.player_id = a.player_id and g.status = 'active')
      then 'CONSENT_REQUIRED_NO_GUARDIAN'
      else 'NO_ELIGIBLE_GUARDIAN'
    end as outcome
  from unnest(p_player_ids) as a(player_id)
  where not exists (
    select 1 from internal.player_notification_recipients(array[a.player_id]) r
  );
$$;

comment on function internal.player_recipient_exclusions(uuid[]) is
  'Classifies WHY each player in the input produced no row from player_notification_recipients -- CONSENT_REQUIRED_NO_GUARDIAN (a 16/17 year old with their own login, no consent on record, and no guardian to ask) or NO_ELIGIBLE_GUARDIAN (everyone else with nobody eligible: no guardian recorded, or under 16 with none). Exists so an aggregate "3 excluded" can always be explained, never just dropped.';

revoke all on function internal.player_recipient_exclusions(uuid[]) from public, anon;
grant execute on function internal.player_recipient_exclusions(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AUDIENCE SOURCE: which players does an audience definition cover?
-- ---------------------------------------------------------------------------

-- TEAM — PLAYING GROUP: active roster of one team. Deliberately NOT
-- players.email or any direct player-contact shortcut -- see this file's own
-- header and internal.player_notification_recipients for where a
-- destination actually comes from.
create or replace function internal.team_playing_group_player_ids(p_team_id uuid)
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select ptm.player_id
  from public.player_team_memberships ptm
  where ptm.team_id = p_team_id and ptm.status = 'active';
$$;

revoke all on function internal.team_playing_group_player_ids(uuid) from public, anon;
grant execute on function internal.team_playing_group_player_ids(uuid) to authenticated;

-- CLUB — PLAYING GROUP: the union of every one of the club's own teams'
-- rosters. A player on two teams at the same club is not double-counted --
-- this returns player_ids, and player_notification_recipients already
-- de-duplicates the humans behind them.
create or replace function internal.club_playing_group_player_ids(p_club_id uuid)
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select distinct ptm.player_id
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status = 'active';
$$;

revoke all on function internal.club_playing_group_player_ids(uuid) from public, anon;
grant execute on function internal.club_playing_group_player_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. TEAM AUTHORITY -- capability-checked, never a role string
-- ---------------------------------------------------------------------------

-- CAPABILITY CHOICE, DISCLOSED RATHER THAN GUESSED SILENTLY.
--
-- There is no existing capability key that means "may send this team an
-- operational communication" -- team.manage turned out, on inspection of
-- role_capability_defaults, to be granted to NOBODY by default at either
-- scope (not TEAM_STAFF, not CLUB_ADMIN), so gating on it would have made
-- every real coach/manager unable to address their own team, discovered by
-- testing against a real seeded team_admin permission holder rather than
-- assumed from the capability's English name. team.attendance.view is used
-- instead: it is the closest existing key to "sees and manages this team as
-- a group" (it already gates the Match Centre full-roster section for the
-- same TEAM_STAFF role), and it IS granted to TEAM_STAFF by default. This is
-- a disclosed interim choice, not a perfect semantic fit -- a dedicated
-- team.communication.manage capability is the honest long-term answer and is
-- a Main Project capability-vocabulary decision, not one to invent
-- unilaterally from an email slice.
create or replace function internal.can_address_team_audience(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.is_site_admin()
    or internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = p_team_id), p_team_id)
    or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = p_team_id), null);
$$;

comment on function internal.can_address_team_audience(uuid) is
  'Whether the CALLER may address this team''s playing-group audience. Uses team.attendance.view -- see this function''s own inline comment for why team.manage was tried first and rejected as granted to nobody by default. A forged team_id resolves club_id as null and every has_capability check fails closed.';

revoke all on function internal.can_address_team_audience(uuid) from public, anon;
grant execute on function internal.can_address_team_audience(uuid) to authenticated;

create or replace function internal.can_address_club_audience(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.is_site_admin() or internal.is_club_admin(p_club_id);
$$;

comment on function internal.can_address_club_audience(uuid) is
  'Whole-club audiences require actual Club Admin authority (internal.is_club_admin, the same predicate clubs'' own RLS uses) -- team-level management authority (can_address_team_audience) never implies this, by construction: it is a different function reading a different relationship, not a wider check on the same one.';

revoke all on function internal.can_address_club_audience(uuid) from public, anon;
grant execute on function internal.can_address_club_audience(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. TEAM PLAYING GROUP -- summary (safe preview) and raw set (send-time)
-- ---------------------------------------------------------------------------

create or replace function public.team_playing_group_summary(p_team_id uuid)
returns table (
  source_player_count integer,
  eligible_recipient_count integer,
  guardian_destination_count integer,
  self_destination_count integer,
  excluded_count integer
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_team_audience(p_team_id) then
    return query select null::integer, null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  select array_agg(player_id) into v_player_ids from internal.team_playing_group_player_ids(p_team_id);
  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);

  return query
  select
    array_length(v_player_ids, 1),
    (select count(distinct user_id)::integer from internal.player_notification_recipients(v_player_ids)),
    (select count(*)::integer from internal.player_notification_recipients(v_player_ids) where relationship = 'guardian'),
    (select count(*)::integer from internal.player_notification_recipients(v_player_ids) where relationship = 'self'),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

comment on function public.team_playing_group_summary(uuid) is
  'Safe preview: aggregate counts only, never a recipient list. Returns every column NULL (never zero) for a caller without team.manage authority on this team, matching public.fixture_communication_counts'' own "absent, not a confident zero" rule.';

revoke all on function public.team_playing_group_summary(uuid) from public, anon;
grant execute on function public.team_playing_group_summary(uuid) to authenticated;

create or replace function public.team_playing_group_recipients(p_team_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_team_audience(p_team_id) then
    raise exception 'You are not authorized to address this team''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.team_playing_group_player_ids(p_team_id);
  return query select distinct r.user_id from internal.player_notification_recipients(coalesce(v_player_ids, array[]::uuid[])) r;
end;
$$;

comment on function public.team_playing_group_recipients(uuid) is
  'The RESOLVED RECIPIENT SET for actually sending -- raw user_ids, only for the authorized server-side send path, never returned to a browser preview. This engine ends here: no provider is called from this function or anywhere in this migration.';

revoke all on function public.team_playing_group_recipients(uuid) from public, anon;
grant execute on function public.team_playing_group_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. CLUB — WHOLE PLAYING GROUP
-- ---------------------------------------------------------------------------

create or replace function public.club_playing_group_summary(p_club_id uuid)
returns table (
  source_player_count integer,
  eligible_recipient_count integer,
  guardian_destination_count integer,
  self_destination_count integer,
  excluded_count integer
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_club_audience(p_club_id) then
    return query select null::integer, null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  select array_agg(player_id) into v_player_ids from internal.club_playing_group_player_ids(p_club_id);
  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);

  return query
  select
    array_length(v_player_ids, 1),
    (select count(distinct user_id)::integer from internal.player_notification_recipients(v_player_ids)),
    (select count(*)::integer from internal.player_notification_recipients(v_player_ids) where relationship = 'guardian'),
    (select count(*)::integer from internal.player_notification_recipients(v_player_ids) where relationship = 'self'),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

revoke all on function public.club_playing_group_summary(uuid) from public, anon;
grant execute on function public.club_playing_group_summary(uuid) to authenticated;

create or replace function public.club_playing_group_recipients(p_club_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_club_audience(p_club_id) then
    raise exception 'You are not authorized to address this club''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.club_playing_group_player_ids(p_club_id);
  return query select distinct r.user_id from internal.player_notification_recipients(coalesce(v_player_ids, array[]::uuid[])) r;
end;
$$;

revoke all on function public.club_playing_group_recipients(uuid) from public, anon;
grant execute on function public.club_playing_group_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. PLATFORM — ELIGIBLE USERS (Full Site Admin only)
-- ---------------------------------------------------------------------------

-- The audience: every ACTIVE club's whole playing group, deduplicated.
-- club_directory is never the source -- an unclaimed directory entry has no
-- clubs row and nobody on Ovalball to receive anything (see
-- docs/EMAIL_DATA_AND_AUDIENCE_ARCHITECTURE.md's own Club Directory rule).
create or replace function internal.platform_playing_group_player_ids()
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select distinct ptm.player_id
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  join public.clubs c on c.id = t.club_id
  where ptm.status = 'active' and c.status = 'active';
$$;

revoke all on function internal.platform_playing_group_player_ids() from public, anon;
grant execute on function internal.platform_playing_group_player_ids() to authenticated;

create or replace function public.platform_eligible_audience_summary()
returns table (
  source_club_count integer,
  source_player_count integer,
  eligible_recipient_count integer,
  excluded_count integer
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  -- PLATFORM-WIDE IS FULL SITE ADMIN ONLY. Not is_site_admin() (which also
  -- admits a narrower admin_role) -- presentation context proves nothing;
  -- this is the same authority Email Configuration itself requires.
  if not internal.is_full_site_admin() then
    return query select null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  select array_agg(player_id) into v_player_ids from internal.platform_playing_group_player_ids();
  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);

  return query
  select
    (select count(distinct c.id)::integer from public.clubs c where c.status = 'active'),
    array_length(v_player_ids, 1),
    (select count(distinct user_id)::integer from internal.player_notification_recipients(v_player_ids)),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

revoke all on function public.platform_eligible_audience_summary() from public, anon;
grant execute on function public.platform_eligible_audience_summary() to authenticated;

create or replace function public.platform_eligible_recipients()
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may resolve the platform-wide audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.platform_playing_group_player_ids();
  return query select distinct r.user_id from internal.player_notification_recipients(coalesce(v_player_ids, array[]::uuid[])) r;
end;
$$;

revoke all on function public.platform_eligible_recipients() from public, anon;
grant execute on function public.platform_eligible_recipients() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RECIPIENT-RELATIVE CONTEXT: which player(s) does each recipient relate to?
-- ---------------------------------------------------------------------------

-- team_playing_group_recipients above answers "who do I send to" (DISTINCT
-- user_id -- one send per human, never one per relationship). This answers
-- the different question personalisation needs: for THIS ONE recipient, which
-- player(s) is the communication actually about. A guardian of three children
-- on the audience gets ONE email, but this is how the send path knows it
-- relates to three players rather than guessing or picking the first one --
-- see docs/RECIPIENT_AUDIENCE_ENGINE.md ("Recipient-relative variables") for
-- the rule this feeds: a scalar variable becomes unavailable, never an
-- arbitrary first pick, when a recipient maps to more than one player.
create or replace function public.team_playing_group_recipient_context(p_team_id uuid)
returns table (user_id uuid, player_id uuid, relationship text)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_team_audience(p_team_id) then
    raise exception 'You are not authorized to address this team''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.team_playing_group_player_ids(p_team_id);
  return query select r.user_id, r.player_id, r.relationship from internal.player_notification_recipients(coalesce(v_player_ids, array[]::uuid[])) r;
end;
$$;

comment on function public.team_playing_group_recipient_context(uuid) is
  'The un-deduplicated (user_id, player_id, relationship) rows behind team_playing_group_recipients -- for building recipient-relative template data, never for deciding how many emails to send (use the DISTINCT-user_id function for that).';

revoke all on function public.team_playing_group_recipient_context(uuid) from public, anon;
grant execute on function public.team_playing_group_recipient_context(uuid) to authenticated;
