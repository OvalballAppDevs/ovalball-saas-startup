-- Staff communications from the Match Centre.
--
-- Three actions -- attendance reminder, message attendees, message team --
-- and one rule that shapes all of them: THE CLIENT NEVER NAMES A RECIPIENT.
--
-- The browser submits a fixture id, an action, and (for the two message
-- actions) a body. Everything else -- which side of the fixture the sender
-- may act for, which players that covers, which of those still owe a
-- response, and which adults are the legitimate contacts for each player --
-- is derived here, from canonical relationships, under authorization that is
-- re-checked server-side.
--
-- WHY THAT IS THE WHOLE DESIGN
--
-- lib/email/recipients.ts already records what happens when a dispatcher's
-- signature contains `to`: the safeguarding "message the officer" action
-- became an authenticated open mail relay. A "message the team" button is the
-- same hazard with a larger blast radius, so the recipient list is not an
-- input here either. There is no parameter it could arrive in.
--
-- WHAT IS DELIBERATELY *NOT* BUILT
--
-- No Match-Centre email system, no provider. Delivery is the canonical
-- notifications table, whose own BEFORE INSERT trigger
-- (internal.notifications_gate_delivery) applies each recipient's topic
-- preference -- so preferences are honoured by construction rather than by
-- every call site remembering to ask.
--
-- These messages are also deliberately NOT written into fixture_messages.
-- That conversation is the INTER-CLUB staff thread: its participants are the
-- two clubs' staff, and a guardian is told "Fixture messages are currently
-- for club/team staff only". Posting a parent-facing message there would
-- broadcast it to the opposition's staff and still not reach a single parent.
-- One fixture does have one canonical conversation; this simply is not that
-- conversation's audience.

-- ---------------------------------------------------------------------------
-- The audit record
-- ---------------------------------------------------------------------------

create table public.fixture_communications (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,

  action text not null check (action in ('ATTENDANCE_REMINDER', 'MESSAGE_ATTENDEES', 'MESSAGE_TEAM')),

  sent_by uuid not null references auth.users(id),

  -- Explicit outcomes. "Sent" is never reported when nothing was delivered.
  outcome text not null check (outcome in ('SENT', 'PARTIALLY_DELIVERED', 'NO_ELIGIBLE_RECIPIENTS', 'RATE_LIMITED', 'FAILED')),

  -- Counts, not people. Enough to answer "who did this reach" at the level an
  -- operator actually needs, without turning the audit log into a directory
  -- of children's contact details.
  player_count integer not null default 0,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,

  -- The staff-authored body, for the two message actions. Null for a
  -- reminder, which is templated rather than typed.
  body text,

  created_at timestamptz not null default now(),

  constraint fixture_communications_body_shape check (
    (action = 'ATTENDANCE_REMINDER' and body is null)
    or (action <> 'ATTENDANCE_REMINDER' and body is not null and length(trim(body)) > 0)
  )
);

comment on table public.fixture_communications is
  'Audit trail for staff communications sent from a Match Centre. Deliberately stores COUNTS, never recipient identities or addresses -- who received it is always re-derivable from canonical relationships, and storing it here would create a second, staler copy of children''s contact data.';

create index fixture_communications_fixture_idx on public.fixture_communications (fixture_id, action, created_at desc);
create index fixture_communications_sender_idx on public.fixture_communications (sent_by, created_at desc);

alter table public.fixture_communications enable row level security;

-- Readable by someone who could have sent it, so a coach can see that a
-- reminder already went out today. No client writes at all.
create policy fixture_communications_select_staff on public.fixture_communications
  for select to authenticated
  using (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixtures f
      where f.id = fixture_id
        and (
          internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
          or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
        )
    )
  );

revoke all on public.fixture_communications from authenticated, anon;
grant select on public.fixture_communications to authenticated;

create trigger audit_row_change after insert or update or delete on public.fixture_communications
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------------
-- Notification types
-- ---------------------------------------------------------------------------

-- Registered against EXISTING topics rather than inventing new ones.
--
-- This matters more than it looks: should_deliver_notification() defaults an
-- UNREGISTERED type to "always deliver". A new notification type that skipped
-- this table would silently bypass every recipient's preferences -- so
-- registering is what makes preferences apply, not what disables them.
--
-- Both are OPERATIONAL, never marketing. An attendance reminder is match
-- logistics for a child the recipient is responsible for, and it sits under
-- "Fixture updates", alongside kickoff and pitch changes. A staff message
-- sits under "Messages". Neither topic is mandatory, so a recipient who has
-- switched that topic off is respected.
insert into public.notification_types (type_key, topic_key) values
  ('fixture_attendance_reminder', 'fixture_updates'),
  ('fixture_staff_message', 'messages')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------------
-- Which side of the fixture may this actor speak for?
-- ---------------------------------------------------------------------------

-- A fixture has two sides and a sender manages one of them. Resolving the
-- side is what stops "message team" from reaching the opposition's families:
-- the effective team ids returned here are only those the CALLER can manage.
--
-- For a Mini-Rugby group fixture, a side is a scheduling group, so the
-- effective ids are its component teams -- which is also why the recipient
-- query below must deduplicate: one child can be reachable through more than
-- one component team.
create or replace function internal.fixture_communication_team_ids(p_fixture_id uuid)
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
    -- Owning side, when the caller manages it.
    select f.owning_team_id as team_id
    where f.owning_team_id is not null
      and internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
    union
    select sgm.team_id
    from public.scheduling_group_members sgm
    where f.owning_scheduling_group_id is not null
      and sgm.group_id = f.owning_scheduling_group_id
      and internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
    union
    -- Opponent side, when the caller manages THAT instead.
    select f.opponent_team_id
    where f.opponent_team_id is not null
      and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)
    union
    select sgm.team_id
    from public.scheduling_group_members sgm
    where f.opponent_scheduling_group_id is not null
      and sgm.group_id = f.opponent_scheduling_group_id
      and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)
  ) t
  where t.team_id is not null;
$$;

revoke all on function internal.fixture_communication_team_ids(uuid) from public;
grant execute on function internal.fixture_communication_team_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Which players does an audience cover?
-- ---------------------------------------------------------------------------

-- MESSAGE_TEAM is the fixture's EFFECTIVE PARTICIPANT population: active
-- members of the caller's involved teams, plus approved call-ups for this
-- fixture. A called-up player is playing in this match and needs the same
-- logistics as everyone else; excluding them because their permanent
-- membership sits elsewhere would be a technicality a parent would
-- experience as being forgotten. Nothing here mutates membership -- the
-- call-up remains a fixture-scoped overlay on the same player_id.
create or replace function internal.fixture_audience_players(p_fixture_id uuid, p_audience text)
returns table (player_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with team_ids as (
    select team_id from internal.fixture_communication_team_ids(p_fixture_id)
  ),
  participants as (
    -- Permanent members of the caller's involved teams.
    select distinct ptm.player_id
    from public.player_team_memberships ptm
    join team_ids ti on ti.team_id = ptm.team_id
    where ptm.status = 'active'
    union
    -- Approved call-ups INTO one of those teams for this fixture.
    select distinct c.player_id
    from public.fixture_player_call_up c
    join team_ids ti on ti.team_id = c.target_team_id
    where c.fixture_id = p_fixture_id
      and c.status = 'approved'
  ),
  responses as (
    select a.player_id, a.status
    from public.player_fixture_attendance a
    where a.fixture_id = p_fixture_id
  )
  select p.player_id
  from participants p
  left join responses r on r.player_id = p.player_id
  where case p_audience
    -- Outstanding means NO canonical response exists. Attending, cannot
    -- attend and unsure are all answers, and a parent who has given one must
    -- not be chased.
    when 'ATTENDANCE_REMINDER' then r.status is null
    when 'MESSAGE_ATTENDEES' then r.status = 'ATTENDING'
    when 'MESSAGE_TEAM' then true
    else false
  end;
$$;

revoke all on function internal.fixture_audience_players(uuid, text) from public;
grant execute on function internal.fixture_audience_players(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Which PEOPLE represent those players?
-- ---------------------------------------------------------------------------

-- The safeguarding core of this phase.
--
-- For every player in the audience:
--
--   * every ACTIVE guardian receives it. Active is the operative word --
--     a pending guardian-link request grants nothing (Phase 2B), and a
--     rejected or ended relationship is not a relationship. This matches
--     internal.notify_training_participants, which is the canonical
--     precedent for operational fanout to families.
--
--   * the PLAYER receives it directly only where the canonical consent
--     domain already allows a young person to be dealt with directly:
--     18+, or 16-17 where guardians have granted
--     'direct_coach_communication'. Having a login is explicitly NOT the
--     test. A 12-year-old with their own account is still a 12-year-old,
--     and internal.resolve_attendance_response_source already draws this
--     line for attendance -- the same line is drawn here rather than a
--     second, looser one being invented for messages.
--
-- Returns DISTINCT user ids, so one adult who guardians two children in the
-- same audience, or one child reachable through two Mini-Rugby component
-- teams, is contacted once.
create or replace function internal.fixture_audience_recipients(p_fixture_id uuid, p_audience text)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with audience as (
    select player_id from internal.fixture_audience_players(p_fixture_id, p_audience)
  )
  select distinct r.user_id
  from (
    select g.guardian_user_id as user_id
    from audience a
    join public.guardians g on g.player_id = a.player_id
    where g.status = 'active'
    union
    select p.user_id
    from audience a
    join public.players p on p.id = a.player_id
    where p.user_id is not null
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

revoke all on function internal.fixture_audience_recipients(uuid, text) from public;
grant execute on function internal.fixture_audience_recipients(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Counts for the staff panel
-- ---------------------------------------------------------------------------

-- Counts describe the PLAYER population, not the number of adults resolved
-- behind it -- "12 attending" is what a coach understands, and publishing
-- "19 recipients" would leak family structure (which children have two
-- separated guardians) to anyone who can read a squad list.
--
-- Returns NULL, never zero, for a caller without the capability. Phase 2A's
-- own defect was showing an authoritative "0" for data the viewer was not
-- entitled to inspect; a confident zero is worse than an absent metric,
-- because it reads as an answer.
create or replace function public.fixture_communication_counts(p_fixture_id uuid)
returns table (outstanding_count integer, attending_count integer, team_count integer)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if not exists (
    select 1 from public.fixtures f
    where f.id = p_fixture_id
      and (
        internal.is_site_admin()
        or internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
        or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
      )
  ) then
    return query select null::integer, null::integer, null::integer;
    return;
  end if;

  return query
  select
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'ATTENDANCE_REMINDER')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_ATTENDEES')),
    (select count(*)::integer from internal.fixture_audience_players(p_fixture_id, 'MESSAGE_TEAM'));
end;
$$;

revoke all on function public.fixture_communication_counts(uuid) from public;
grant execute on function public.fixture_communication_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

-- RATE / DUPLICATE POLICY, stated once here because it is a product rule:
--
--   * the same actor may not repeat the SAME action on the SAME fixture
--     within 10 minutes. That covers a double click, a browser retry and an
--     impatient second press, without ever suppressing a legitimate reminder
--     sent hours or days later -- which the brief explicitly protects.
--
--   * at most 12 sends of one action per fixture per 24 hours, across all
--     staff. A fixture genuinely needs a handful of communications; twelve is
--     already generous, and it stops one account (or one loop) from becoming
--     a notification flood for families.
--
-- Both are enforced HERE, in the database, not in the browser.
create or replace function public.send_fixture_communication(
  p_fixture_id uuid,
  p_action text,
  p_body text default null
)
returns table (outcome text, player_count integer, recipient_count integer)
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  f public.fixtures;
  v_actor uuid := auth.uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_players integer := 0;
  v_recipients integer := 0;
  v_recent integer;
  v_today integer;
  v_type text;
  v_title text;
  v_notify_body text;
  v_outcome text;
  v_team_label text;
  v_opponent text;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_action not in ('ATTENDANCE_REMINDER', 'MESSAGE_ATTENDEES', 'MESSAGE_TEAM') then
    raise exception 'Unknown communication action.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    -- Same message for "no such fixture" and "not yours", so the id space
    -- cannot be probed for fixtures the caller cannot see.
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;

  -- AUTHORITY. Deliberately the same check the Match Centre's own
  -- canManageFixture flag uses -- a staff communication is a fixture
  -- management act, not a new kind of permission. A guardian or player never
  -- satisfies this, however legitimately they can see the fixture.
  if not (
    internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
    or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
  ) then
    raise exception 'You are not authorized to send communications for this fixture.' using errcode = '42501';
  end if;

  if p_action <> 'ATTENDANCE_REMINDER' and v_body is null then
    raise exception 'Write a message before sending.';
  end if;
  if v_body is not null and length(v_body) > 2000 then
    raise exception 'That message is too long. Please keep it under 2000 characters.';
  end if;

  -- ---- rate / duplicate protection ----
  select count(*) into v_recent
  from public.fixture_communications fc
  where fc.fixture_id = p_fixture_id and fc.action = p_action and fc.sent_by = v_actor
    and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and fc.created_at > now() - interval '10 minutes';
  if v_recent > 0 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, body)
    values (p_fixture_id, p_action, v_actor, 'RATE_LIMITED', v_body);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  select count(*) into v_today
  from public.fixture_communications fc
  where fc.fixture_id = p_fixture_id and fc.action = p_action
    and fc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and fc.created_at > now() - interval '24 hours';
  if v_today >= 12 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, body)
    values (p_fixture_id, p_action, v_actor, 'RATE_LIMITED', v_body);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  -- ---- audience ----
  select count(*) into v_players from internal.fixture_audience_players(p_fixture_id, p_action);
  select count(*) into v_recipients from internal.fixture_audience_recipients(p_fixture_id, p_action);

  if v_recipients = 0 then
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, player_count, recipient_count, body)
    values (p_fixture_id, p_action, v_actor, 'NO_ELIGIBLE_RECIPIENTS', v_players, 0, v_body);
    return query select 'NO_ELIGIBLE_RECIPIENTS'::text, v_players, 0;
    return;
  end if;

  -- ---- content, resolved from canonical facts at send time ----
  -- Nothing about the fixture is copied into a stored reminder model; the
  -- notification is built from the fixture as it is right now.
  select t.display_name into v_team_label from public.teams t where t.id = f.owning_team_id;
  v_opponent := coalesce(
    (select t2.display_name from public.teams t2 where t2.id = f.opponent_team_id),
    f.raw_opposition_text,
    'opposition to be confirmed'
  );

  if p_action = 'ATTENDANCE_REMINDER' then
    v_type := 'fixture_attendance_reminder';
    v_title := 'Attendance needed: ' || coalesce(v_team_label, 'your team') || ' v ' || v_opponent;
    v_notify_body :=
      to_char(f.kickoff_date, 'Day DD Mon') ||
      coalesce(', kick-off ' || to_char(f.kickoff_time, 'HH24:MI'), '') ||
      coalesce(', meet ' || to_char(f.meet_time, 'HH24:MI'), '') ||
      coalesce('. ' || (select v.name from public.venues v where v.id = f.venue_id), '') ||
      '. Please let the team know if your player can make it.';
  else
    v_type := 'fixture_staff_message';
    v_title := coalesce(v_team_label, 'Your team') || ' v ' || v_opponent;
    -- The staff body is carried as TEXT in a text column and rendered as
    -- text. Nothing here builds HTML, so there is nothing to escape into.
    v_notify_body := v_body;
  end if;

  -- ---- deliver ----
  -- The insert passes through internal.notifications_gate_delivery, which
  -- drops rows for recipients who have switched the topic off. So
  -- delivered_count can legitimately be lower than recipient_count, and that
  -- is the difference between SENT and PARTIALLY_DELIVERED.
  insert into public.notifications (user_id, type, title, body, data)
  select r.user_id, v_type, v_title, v_notify_body,
         jsonb_build_object('fixture_id', p_fixture_id, 'action', p_action)
  from internal.fixture_audience_recipients(p_fixture_id, p_action) r;

  get diagnostics v_today = row_count;

  v_outcome := case
    when v_today = 0 then 'FAILED'
    when v_today < v_recipients then 'PARTIALLY_DELIVERED'
    else 'SENT'
  end;

  insert into public.fixture_communications (fixture_id, action, sent_by, outcome, player_count, recipient_count, delivered_count, body)
  values (p_fixture_id, p_action, v_actor, v_outcome, v_players, v_recipients, v_today, v_body);

  return query select v_outcome, v_players, v_recipients;
end;
$$;

revoke all on function public.send_fixture_communication(uuid, text, text) from public;
grant execute on function public.send_fixture_communication(uuid, text, text) to authenticated;
