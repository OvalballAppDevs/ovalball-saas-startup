-- =====================================================================
-- A COACH CAN TELL THE SQUAD ABOUT TRAINING
--
-- Training Centre could show a coach that nine players had not answered and
-- then offer no way to ask them. Match Centre has had a full communication
-- path since it was built; training had none at all, so the coach's next move
-- was to leave the product and open WhatsApp -- which is the outcome Ovalball
-- exists to replace.
--
-- THIS IS NOT A SECOND MESSAGING SYSTEM. Every part below is the fixture
-- path's own shape, reusing its own pieces:
--
--   internal.notifiable_users_for_players   THE safeguarding rule, shared
--                                           verbatim with fixtures. Active
--                                           guardians always; the player only
--                                           at 18+, or 16-17 with recorded
--                                           direct_coach_communication consent.
--   public.notifications                    the one delivery table, which
--                                           passes through
--                                           notifications_gate_delivery so a
--                                           recipient's own topic preferences
--                                           still decide.
--   the same outcome vocabulary             SENT / PARTIALLY_DELIVERED /
--                                           NO_ELIGIBLE_RECIPIENTS /
--                                           RATE_LIMITED / FAILED
--
-- WHAT IS DELIBERATELY DIFFERENT: nothing about authority. A training
-- communication is a training-management act, exactly as
-- send_fixture_communication records that a fixture communication is a
-- fixture-management act -- so it resolves through internal.can_manage_training
-- and inherits the capability separation made in 20270209000000. A guardian or
-- player never satisfies it, however legitimately they can open the session.
--
-- AUDIENCES ARE CATEGORIES, NEVER LISTS. The browser sends a word. The server
-- resolves the people. There is no parameter through which a caller can name a
-- recipient.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The log. Same columns as fixture_communications, for the same reasons:
-- rate limiting needs history, and "we sent it" needs to be a fact rather
-- than a memory.
-- ---------------------------------------------------------------------
create table if not exists public.training_communications (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  action text not null,
  sent_by uuid not null references auth.users(id),
  outcome text not null,
  player_count integer not null default 0,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  body text,
  created_at timestamptz not null default now(),
  constraint training_communications_action_check
    check (action in ('ATTENDANCE_REMINDER', 'MESSAGE_ATTENDEES', 'MESSAGE_AWAITING', 'MESSAGE_TEAM')),
  constraint training_communications_outcome_check
    check (outcome in ('SENT', 'PARTIALLY_DELIVERED', 'NO_ELIGIBLE_RECIPIENTS', 'RATE_LIMITED', 'FAILED')),
  constraint training_communications_body_length check (body is null or char_length(body) <= 2000)
);

create index if not exists training_communications_session_idx
  on public.training_communications (training_session_id, created_at desc);

alter table public.training_communications enable row level security;

-- No select policy, deliberately: this is an audit trail read by the
-- SECURITY DEFINER functions below, not a table any browser enumerates.

-- ---------------------------------------------------------------------
-- WHO IS IN THE SESSION, and which of them the audience wants.
--
-- Participation resolves exactly as get_training_register and
-- respond_to_training_attendance already resolve it: the session's team, or
-- every member team of its scheduling group. No new participation model.
-- ---------------------------------------------------------------------
create or replace function internal.training_audience_players(p_training_session_id uuid, p_audience text)
returns table(player_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with s as (select * from public.training_sessions where id = p_training_session_id),
  participants as (
    select distinct ptm.player_id
    from public.player_team_memberships ptm, s
    where ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (
          s.scheduling_group_id is not null
          and ptm.team_id in (select sgm.team_id from public.scheduling_group_members sgm where sgm.group_id = s.scheduling_group_id)
        )
      )
  ),
  responses as (
    select a.player_id, a.status
    from public.player_fixture_attendance a
    where a.training_session_id = p_training_session_id
  )
  select p.player_id
  from participants p
  left join responses r on r.player_id = p.player_id
  where case p_audience
    -- Outstanding means NO canonical response exists. Attending, cannot
    -- attend and unsure are all answers, and somebody who has answered must
    -- not be chased.
    when 'ATTENDANCE_REMINDER' then r.status is null
    when 'MESSAGE_AWAITING'    then r.status is null
    when 'MESSAGE_ATTENDEES'   then r.status = 'ATTENDING'
    when 'MESSAGE_TEAM'        then true
    else false
  end;
$$;

-- The people to actually notify, through the shared safeguarding rule.
create or replace function internal.training_audience_recipients(p_training_session_id uuid, p_audience text)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id
  from internal.notifiable_users_for_players(
    array(select p.player_id from internal.training_audience_players(p_training_session_id, p_audience) p)
  ) r;
$$;

comment on function internal.training_audience_recipients(uuid, text) is
  'Training communication recipients. Delegates entirely to internal.notifiable_users_for_players, so training and fixtures cannot drift apart on who a child may be contacted through.';

-- ---------------------------------------------------------------------
-- What the composer shows before anything is sent.
--
-- Counts only. A recipient LIST is never returned to a browser: staff need to
-- know how many people a message reaches, not the contact details of other
-- people's children.
-- ---------------------------------------------------------------------
create or replace function public.training_communication_counts(p_training_session_id uuid)
returns table(
  team_count integer, attending_count integer, awaiting_count integer,
  team_recipients integer, attending_recipients integer, awaiting_recipients integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    return query select null::int, null::int, null::int, null::int, null::int, null::int;
    return;
  end if;
  -- NULLs for a caller without the authority, rather than an authoritative
  -- zero -- the same choice fixture_communication_counts makes.
  if not internal.can_manage_training(s.club_id, s.team_id) then
    return query select null::int, null::int, null::int, null::int, null::int, null::int;
    return;
  end if;
  return query select
    (select count(*)::int from internal.training_audience_players(p_training_session_id, 'MESSAGE_TEAM')),
    (select count(*)::int from internal.training_audience_players(p_training_session_id, 'MESSAGE_ATTENDEES')),
    (select count(*)::int from internal.training_audience_players(p_training_session_id, 'ATTENDANCE_REMINDER')),
    (select count(*)::int from internal.training_audience_recipients(p_training_session_id, 'MESSAGE_TEAM')),
    (select count(*)::int from internal.training_audience_recipients(p_training_session_id, 'MESSAGE_ATTENDEES')),
    (select count(*)::int from internal.training_audience_recipients(p_training_session_id, 'ATTENDANCE_REMINDER'));
end;
$$;

-- ---------------------------------------------------------------------
-- The send.
-- ---------------------------------------------------------------------
create or replace function public.send_training_communication(
  p_training_session_id uuid,
  p_action text,
  p_body text default null
)
returns table(outcome text, player_count integer, recipient_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.training_sessions;
  v_actor uuid := auth.uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_players integer := 0;
  v_recipients integer := 0;
  v_recent integer;
  v_today integer;
  v_delivered integer;
  v_type text;
  v_title text;
  v_notify_body text;
  v_outcome text;
  v_label text;
  v_venue text;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_action not in ('ATTENDANCE_REMINDER', 'MESSAGE_ATTENDEES', 'MESSAGE_AWAITING', 'MESSAGE_TEAM') then
    raise exception 'Unknown communication action.';
  end if;

  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    -- Same message for "no such session" and "not yours", so the id space
    -- cannot be probed.
    raise exception 'This training session is not available.' using errcode = '42501';
  end if;
  if s.status = 'CANCELLED' then
    raise exception 'This training session has been cancelled.' using errcode = '42501';
  end if;

  -- AUTHORITY: a training communication is a training-management act. Resolves
  -- through can_manage_training, which since 20270209000000 means
  -- club.training.manage or team.training.manage -- never fixture.create.
  if not internal.can_manage_training(s.club_id, s.team_id) then
    raise exception 'You are not authorized to send communications for this training session.' using errcode = '42501';
  end if;

  if p_action <> 'ATTENDANCE_REMINDER' and v_body is null then
    raise exception 'Write a message before sending.';
  end if;
  if v_body is not null and length(v_body) > 2000 then
    raise exception 'That message is too long. Please keep it under 2000 characters.';
  end if;

  -- ---- rate / duplicate protection, same shape as fixtures ----
  select count(*) into v_recent
  from public.training_communications tc
  where tc.training_session_id = p_training_session_id and tc.action = p_action and tc.sent_by = v_actor
    and tc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and tc.created_at > now() - interval '10 minutes';
  if v_recent > 0 then
    insert into public.training_communications (training_session_id, action, sent_by, outcome, body)
    values (p_training_session_id, p_action, v_actor, 'RATE_LIMITED', v_body);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  select count(*) into v_today
  from public.training_communications tc
  where tc.training_session_id = p_training_session_id and tc.action = p_action
    and tc.outcome in ('SENT', 'PARTIALLY_DELIVERED')
    and tc.created_at > now() - interval '24 hours';
  if v_today >= 12 then
    insert into public.training_communications (training_session_id, action, sent_by, outcome, body)
    values (p_training_session_id, p_action, v_actor, 'RATE_LIMITED', v_body);
    return query select 'RATE_LIMITED'::text, 0, 0;
    return;
  end if;

  -- ---- audience, resolved here and only here ----
  select count(*) into v_players from internal.training_audience_players(p_training_session_id, p_action);
  select count(*) into v_recipients from internal.training_audience_recipients(p_training_session_id, p_action);

  if v_recipients = 0 then
    insert into public.training_communications (training_session_id, action, sent_by, outcome, player_count, recipient_count, body)
    values (p_training_session_id, p_action, v_actor, 'NO_ELIGIBLE_RECIPIENTS', v_players, 0, v_body);
    return query select 'NO_ELIGIBLE_RECIPIENTS'::text, v_players, 0;
    return;
  end if;

  -- ---- content, built from canonical facts AT SEND TIME ----
  -- Nothing about the session is copied into a stored model; if the venue
  -- changed an hour ago, the message says the new one.
  select coalesce(t.display_name, sg.display_tag, 'your team') into v_label
  from public.training_sessions ts
  left join public.teams t on t.id = ts.team_id
  left join public.scheduling_groups sg on sg.id = ts.scheduling_group_id
  where ts.id = p_training_session_id;

  select v.name into v_venue from public.venues v where v.id = s.venue_id;

  if p_action = 'ATTENDANCE_REMINDER' then
    v_type := 'training_attendance_reminder';
    v_title := 'Training response needed: ' || v_label;
    v_notify_body :=
      to_char(s.session_date, 'Day DD Mon') ||
      coalesce(', ' || to_char(s.start_time, 'HH24:MI'), '') ||
      coalesce('. ' || v_venue, '') ||
      '. Please let the coaches know if your player can make training.';
  else
    v_type := 'training_staff_message';
    v_title := v_label || ' training, ' || to_char(s.session_date, 'DD Mon');
    -- Carried as TEXT into a text column and rendered as text. Nothing here
    -- builds HTML, so there is nothing to escape into.
    v_notify_body := v_body;
  end if;

  -- ---- deliver through the ONE notifications table ----
  insert into public.notifications (user_id, type, title, body, data)
  select r.user_id, v_type, v_title, v_notify_body,
         jsonb_build_object('training_session_id', p_training_session_id, 'action', p_action)
  from internal.training_audience_recipients(p_training_session_id, p_action) r;

  get diagnostics v_delivered = row_count;

  v_outcome := case
    when v_delivered = 0 then 'FAILED'
    when v_delivered < v_recipients then 'PARTIALLY_DELIVERED'
    else 'SENT'
  end;

  insert into public.training_communications
    (training_session_id, action, sent_by, outcome, player_count, recipient_count, delivered_count, body)
  values (p_training_session_id, p_action, v_actor, v_outcome, v_players, v_recipients, v_delivered, v_body);

  return query select v_outcome, v_players, v_recipients;
end;
$$;

revoke execute on function public.send_training_communication(uuid, text, text) from public, anon;
grant execute on function public.send_training_communication(uuid, text, text) to authenticated;
grant execute on function public.training_communication_counts(uuid) to authenticated;
