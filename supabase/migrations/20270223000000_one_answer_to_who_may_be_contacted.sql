-- =====================================================================
-- ONE ANSWER TO "WHO MAY LEGITIMATELY BE CONTACTED FOR THIS PLAYER?"
--
-- WHAT THE MERGE SURFACED.
--
-- Main and SP4 each grew a recipient-eligibility function, and their
-- safeguarding predicates were byte-for-byte the same rule written twice:
--
--   internal.notifiable_users_for_players(uuid[]) -> (user_id)
--   internal.player_notification_recipients(uuid[]) -> (player_id, user_id, relationship)
--
-- The second is strictly richer: the first is exactly `select distinct
-- user_id` from it. Two copies of a safeguarding rule are not a tidiness
-- problem -- they are two places a future change can land in one of.
--
-- WHAT THE AUDIT SURFACED, WHICH MATTERS MORE.
--
-- Two notification paths never called EITHER of them, and wrote their own
-- recipient rule with no age or consent test at all:
--
--   internal.notify_training_participants
--     -- "Adult self-managed players (own linked account)"
--     select p.user_id from public.players p where p.user_id is not null
--
--   public.approve_player_club_join_request
--     if v_player.user_id is not null then ... notify the player directly
--
-- The comment said "adult". The code said "has a login". A twelve-year-old
-- with their own account was receiving direct club communication about
-- cancelled and rearranged training, and a direct notification when a club
-- accepted them. That is precisely the failure the canonical predicate's own
-- comment warns about: HAVING A LOGIN IS NOT THE TEST.
--
-- Two more paths (approve/reject_pending_team_membership) selected only the
-- FIRST active guardian by created_at, which is not a safeguarding breach but
-- is a third independent recipient rule, and it silently told one parent and
-- not the other.
--
-- THE CANONICAL SHAPE.
--
--   SPORTING IDENTITY
--     -> legitimate communication relationship
--       -> safeguarding / consent eligibility      <-- internal.player_contact_eligibility
--         -> legitimate USER destination
--           -> channel-specific delivery            <-- Notifications, Email, ...
--
-- internal.player_contact_eligibility answers WHO may be contacted, and
-- nothing about HOW. It knows nothing of notifications, email events,
-- preferences, templates or suppression; those all sit above it and may
-- narrow what it returns, never widen it.
--
-- IT ALSO EXPLAINS ITSELF. A player with no legitimate destination gets one
-- row with a null user_id and the reason. That is deliberate: the previous
-- exclusion-reason function re-derived age and consent to work out WHY
-- nobody was eligible, which made it a fourth place the rule was written.
-- Now the reason falls out of the same single evaluation.
-- =====================================================================

create or replace function internal.player_contact_eligibility(p_player_ids uuid[])
returns table (player_id uuid, user_id uuid, relationship text, outcome text)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  with asked as (
    select distinct a.player_id from unnest(coalesce(p_player_ids, array[]::uuid[])) as a(player_id)
  ),
  eligible as (
    select distinct a.player_id, r.user_id, r.relationship
    from asked a
    cross join lateral (
      -- EVERY ACTIVE GUARDIAN. Active is the operative word: a pending
      -- guardian-link request grants nothing, and an ended relationship is
      -- not a relationship. Every active guardian is returned, not the
      -- earliest one -- both parents are the child's guardians.
      select g.guardian_user_id as user_id, 'guardian'::text as relationship
      from public.guardians g
      where g.player_id = a.player_id and g.status = 'active'

      union

      -- THE PLAYER THEMSELVES, only where the canonical consent domain
      -- already allows a young person to be dealt with directly. HAVING A
      -- LOGIN IS NOT THE TEST: a 12-year-old with their own account is still
      -- a 12-year-old.
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
    where r.user_id is not null
  )
  select e.player_id, e.user_id, e.relationship, 'ELIGIBLE'::text
  from eligible e

  union all

  -- NOBODY. The reason comes from the same evaluation rather than a second
  -- age lookup somewhere else, and the row exists so a caller can say what
  -- happened instead of silently sending to a shorter list.
  select a.player_id, null::uuid, null::text,
    case
      when internal.player_effective_age(a.player_id) in (16, 17)
        and exists (select 1 from public.players p where p.id = a.player_id and p.user_id is not null)
        and not internal.guardian_permission_effective(a.player_id, 'direct_coach_communication')
      then 'CONSENT_REQUIRED_NO_GUARDIAN'
      else 'NO_ELIGIBLE_GUARDIAN'
    end
  from asked a
  where not exists (select 1 from eligible e where e.player_id = a.player_id);
$$;

comment on function internal.player_contact_eligibility(uuid[]) is
  'THE canonical safeguarding recipient predicate. Answers who may legitimately be contacted for these players, and why nobody may where that is the answer. Channel-neutral: Notifications, Email and any future channel consume this and may only narrow it.';

revoke all on function internal.player_contact_eligibility(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- PROJECTIONS OVER THE ONE RESULT
-- ---------------------------------------------------------------------
-- Different callers need different shapes. None of them re-states the rule.

create or replace function internal.player_recipient_exclusions(p_player_ids uuid[])
returns table (player_id uuid, outcome text)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  select e.player_id, e.outcome
  from internal.player_contact_eligibility(p_player_ids) e
  where e.user_id is null;
$$;

-- ---------------------------------------------------------------------
-- MAIN'S AUDIENCE PROJECTIONS
-- ---------------------------------------------------------------------

create or replace function internal.fixture_audience_recipients(p_fixture_id uuid, p_audience text)
returns table (user_id uuid)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  select distinct e.user_id
  from internal.player_contact_eligibility(
    array(select player_id from internal.fixture_audience_players(p_fixture_id, p_audience))
  ) e
  where e.user_id is not null;
$$;

create or replace function internal.training_audience_recipients(p_training_session_id uuid, p_audience text)
returns table (user_id uuid)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  select distinct e.user_id
  from internal.player_contact_eligibility(
    array(select p.player_id from internal.training_audience_players(p_training_session_id, p_audience) p)
  ) e
  where e.user_id is not null;
$$;

-- ---------------------------------------------------------------------
-- SP4'S AUDIENCE PROJECTIONS
-- ---------------------------------------------------------------------
-- Bodies repointed at the canonical primitive; every authority check,
-- signature and return shape is unchanged.

create or replace function public.team_playing_group_recipients(p_team_id uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_team_audience(p_team_id) then
    raise exception 'You are not authorized to address this team''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.team_playing_group_player_ids(p_team_id);
  return query
    select distinct e.user_id
    from internal.player_contact_eligibility(coalesce(v_player_ids, array[]::uuid[])) e
    where e.user_id is not null;
end;
$$;

create or replace function public.team_playing_group_recipient_context(p_team_id uuid)
returns table (user_id uuid, player_id uuid, relationship text)
language plpgsql stable security definer set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_team_audience(p_team_id) then
    raise exception 'You are not authorized to address this team''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.team_playing_group_player_ids(p_team_id);
  -- ONE ROW PER (recipient, player), deliberately not deduplicated to the
  -- user: a guardian of three children on this audience is three rows, which
  -- is what stops a scalar template variable from silently meaning the first
  -- child. See lib/email/audience/recipient-relative-context.ts.
  return query
    select e.user_id, e.player_id, e.relationship
    from internal.player_contact_eligibility(coalesce(v_player_ids, array[]::uuid[])) e
    where e.user_id is not null;
end;
$$;

create or replace function public.club_playing_group_recipients(p_club_id uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.can_address_club_audience(p_club_id) then
    raise exception 'You are not authorized to address this club''s audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.club_playing_group_player_ids(p_club_id);
  return query
    select distinct e.user_id
    from internal.player_contact_eligibility(coalesce(v_player_ids, array[]::uuid[])) e
    where e.user_id is not null;
end;
$$;

create or replace function public.platform_eligible_recipients()
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may resolve the platform-wide audience.' using errcode = '42501';
  end if;
  select array_agg(player_id) into v_player_ids from internal.platform_playing_group_player_ids();
  return query
    select distinct e.user_id
    from internal.player_contact_eligibility(coalesce(v_player_ids, array[]::uuid[])) e
    where e.user_id is not null;
end;
$$;

-- ---------------------------------------------------------------------
-- THE SUMMARIES
-- ---------------------------------------------------------------------
-- Same repoint, same signatures, same "return nulls rather than raise" shape
-- for an unauthorised caller. These count what the audience resolves to, so
-- they must count exactly what the send path would reach -- which is only
-- true while both read the same primitive.

create or replace function public.team_playing_group_summary(p_team_id uuid)
returns table (source_player_count integer, eligible_recipient_count integer, guardian_destination_count integer, self_destination_count integer, excluded_count integer)
language plpgsql stable security definer set search_path = public, internal, pg_temp
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
    (select count(distinct e.user_id)::integer from internal.player_contact_eligibility(v_player_ids) e where e.user_id is not null),
    (select count(*)::integer from internal.player_contact_eligibility(v_player_ids) e where e.relationship = 'guardian'),
    (select count(*)::integer from internal.player_contact_eligibility(v_player_ids) e where e.relationship = 'self'),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

create or replace function public.club_playing_group_summary(p_club_id uuid)
returns table (source_player_count integer, eligible_recipient_count integer, guardian_destination_count integer, self_destination_count integer, excluded_count integer)
language plpgsql stable security definer set search_path = public, internal, pg_temp
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
    (select count(distinct e.user_id)::integer from internal.player_contact_eligibility(v_player_ids) e where e.user_id is not null),
    (select count(*)::integer from internal.player_contact_eligibility(v_player_ids) e where e.relationship = 'guardian'),
    (select count(*)::integer from internal.player_contact_eligibility(v_player_ids) e where e.relationship = 'self'),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

create or replace function public.platform_eligible_audience_summary()
returns table (source_club_count integer, source_player_count integer, eligible_recipient_count integer, excluded_count integer)
language plpgsql stable security definer set search_path = public, internal, pg_temp
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
    (select count(distinct e.user_id)::integer from internal.player_contact_eligibility(v_player_ids) e where e.user_id is not null),
    (select count(*)::integer from internal.player_recipient_exclusions(v_player_ids));
end;
$$;

-- ---------------------------------------------------------------------
-- THE ATTENDANCE INVITATION SWEEP
-- ---------------------------------------------------------------------
-- Byte-for-byte the function it replaces apart from where the eligible users
-- come from. The dedupe against already-sent invitations, the on-conflict, the
-- wording and the counting are all untouched.

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
      select distinct e.user_id
      from internal.player_contact_eligibility(
        array(select player_id from internal.fixture_outstanding_players(v_fixture.id))
      ) e
      where e.user_id is not null
        and not exists (
          select 1 from public.fixture_attendance_invitations i
          where i.fixture_id = v_fixture.id and i.user_id = e.user_id
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

-- ---------------------------------------------------------------------
-- TRAINING COMMUNICATION -- THE REAL FIX
-- ---------------------------------------------------------------------
-- The audience question ("which players?") and the safeguarding question
-- ("who may be contacted for them?") are now answered in different places,
-- by the functions that own each. This one used to answer both, and got the
-- second one wrong.
--
-- WHICH PLAYERS: every player active on the session's team, or on any team in
-- its scheduling group -- unchanged from what this function already did.
-- WHO MAY BE CONTACTED: internal.player_contact_eligibility, the same
-- predicate the Fixture path, the Training communication path, the Email
-- audience engine and the platform audience all now use.

create or replace function internal.notify_training_participants(
  p_training_session_id uuid,
  p_type text,
  p_title text,
  p_body text
) returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  s public.training_sessions;
  v_player_ids uuid[];
begin
  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    return;
  end if;

  select array_agg(ptm.player_id) into v_player_ids
  from public.player_team_memberships ptm
  where ptm.status = 'active'
    and (
      (s.team_id is not null and ptm.team_id = s.team_id)
      or (s.scheduling_group_id is not null
          and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
    );

  -- DISTINCT USER, not distinct relationship: one human who represents three
  -- children on this squad gets one message about the session, not three.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct e.user_id, p_type, p_title, p_body,
         jsonb_build_object('training_session_id', p_training_session_id, 'training_plan_id', s.training_plan_id)
  from internal.player_contact_eligibility(coalesce(v_player_ids, array[]::uuid[])) e
  where e.user_id is not null;
end;
$$;

-- ---------------------------------------------------------------------
-- THE OTHER THREE PATHS THAT CHOSE THEIR OWN RECIPIENTS
-- ---------------------------------------------------------------------

create or replace function public.approve_player_club_join_request(p_request_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  r public.player_club_join_requests;
  v_team public.teams;
  v_player public.players;
  v_club_name text;
begin
  -- The lock is the whole mechanism. Two managers on the same request serialise
  -- here, and the second one finds it no longer pending.
  select * into r from public.player_club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0001';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null or v_team.club_id <> r.club_id then
    raise exception 'Choose one of this club''s own teams.' using errcode = '23514';
  end if;
  if not v_team.active then
    raise exception 'That team is not active.' using errcode = '23514';
  end if;

  if not internal.may_resolve_join_request(r.club_id, p_team_id) then
    raise exception 'You are not authorized to resolve this request.' using errcode = '42501';
  end if;

  -- Nobody resolves their own request, whatever else they hold.
  select * into v_player from public.players where id = r.player_id;
  if v_player.user_id = auth.uid()
     or exists (select 1 from public.guardians g where g.player_id = r.player_id
                and g.guardian_user_id = auth.uid() and g.status = 'active') then
    raise exception 'You cannot approve a request for your own player.' using errcode = '42501';
  end if;

  -- The membership is created through the ordinary table, so the central
  -- compatibility guard runs exactly as it does everywhere else. Approval is
  -- not a way round it: a manager cannot place a player into a team the
  -- governing rules do not permit.
  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (r.player_id, p_team_id, 'active', auth.uid());

  update public.player_club_join_requests
  set status = 'approved', placed_team_id = p_team_id, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_club_join_requests', p_request_id, 'update', auth.uid(),
          jsonb_build_object('status', 'approved', 'placed_team_id', p_team_id));

  select cd.name into v_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = r.club_id;

  -- TELL WHOEVER MAY LEGITIMATELY BE TOLD. This used to notify the player
  -- directly whenever they had a login, with no age or consent test -- so a
  -- child who asked to join a club heard back directly from it. The wording
  -- is recipient-relative, because "You have been accepted" and "Priya has
  -- been accepted" are the same fact told to two different people.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'club_join_approved',
         case when e.relationship = 'self' then 'You have been accepted' else 'Join request accepted' end,
         case when e.relationship = 'self'
              then format('%s have accepted you. You are now in %s.', v_club_name, v_team.display_name)
              else format('%s has been accepted into %s.', v_player.first_name, v_team.display_name) end,
         jsonb_build_object('player_id', r.player_id, 'team_id', p_team_id)
  from internal.player_contact_eligibility(array[r.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$$;

create or replace function public.approve_pending_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to approve this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships set status = 'active' where id = p_membership_id;

  select p.first_name into v_player_first_name from public.players p where p.id = m.player_id;

  -- EVERY legitimate recipient, not the earliest-created guardian. One parent
  -- being told and the other not was never a decision anybody made -- it was
  -- an `order by created_at asc limit 1` nobody revisited.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_approved', 'Team join confirmed',
         case when e.relationship = 'self'
              then 'You have been confirmed onto the team.'
              else v_player_first_name || ' has been confirmed onto the team.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$$;

create or replace function public.reject_pending_team_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to reject this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships set status = 'ended', ended_at = now() where id = p_membership_id;

  select p.first_name into v_player_first_name from public.players p where p.id = m.player_id;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_declined', 'Team join declined',
         case when e.relationship = 'self'
              then 'Your team join request was declined by the club.'
              else v_player_first_name || '''s team join request was declined by the club.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$$;

-- ---------------------------------------------------------------------
-- RETIRE THE TWO DUPLICATES
-- ---------------------------------------------------------------------
-- Every production caller now reads the canonical primitive. Leaving either
-- of these behind would leave a second safeguarding predicate for the next
-- person to find first -- and a function with no callers is exactly how the
-- duplication happened in the first place.

drop function if exists internal.notifiable_users_for_players(uuid[]);
drop function if exists internal.player_notification_recipients(uuid[]);
