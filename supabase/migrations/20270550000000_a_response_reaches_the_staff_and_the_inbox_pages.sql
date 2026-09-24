-- =====================================================================================================
-- CA-M8 — NOTIFICATIONS, INBOX & ACTION CENTRE
--
-- A RESPONSE REACHES THE STAFF, AND THE INBOX PAGES.
--
-- Two things the canonical notification domain lacked, found by the CA-M8 forensic audit and confirmed
-- against CA-M7's own finding (docs/mobile/CA_M7_TEAM_OPERATIONS_MAP.md, "availability response emits
-- nothing"):
--
--   1. When a guardian or an adult player answers "can you make it?", the people running the side heard
--      nothing. The register showed the answer, but only to somebody already looking at it. This adds
--      ONE emitter, called from the two canonical response operations, whose recipients are resolved by
--      the CANONICAL CAPABILITY DECISION (team.attendance.view at team scope) -- never by a role label
--      list of its own -- and which never stacks: an unread notification about the same person and the
--      same event is settled when the answer changes, so a family that changes its mind four times
--      leaves one unread row, carrying the current answer.
--
--   2. The bell's feed had no page after the first: my_bell_notifications returns the newest fifty and
--      stops. A phone that scrolls needs a cursor, and both clients need one way to mark a row read,
--      unread, or all read -- the website reached into the table directly; the app had no way at all.
--      my_notifications is the same membership rule as the bell (decided by the registry's topic) with
--      keyset pagination and an unread-only filter; the three mark_* operations are the read mutation.
--
-- WHAT THIS DOES NOT DO. It adds no table. There is no mobile inbox, no action-item store and no
-- "resolved" flag on a notification: whether a job is still open is read from the domain that owns it,
-- and a notification being read says only that somebody looked. It changes nothing about messaging,
-- safeguarding, finance or family authority; the response operations keep every check they had and
-- gain one call after the write.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. Two registered types, in the topics whose preference already governs them.
-- -----------------------------------------------------------------------------------------------------
insert into public.notification_types (type_key, topic_key)
values
  ('fixture_availability_responded', 'fixture_updates'),
  ('training_availability_responded', 'calendar_training_updates')
on conflict (type_key) do nothing;

-- -----------------------------------------------------------------------------------------------------
-- 2. Who is told: everybody the canonical engine says may see this team's attendance.
--
-- The candidate set is bounded -- people with a standing at the club or on the team from which the
-- capability could follow -- and the ANSWER is internal.capability_decision for each of them, exactly
-- the decision the register itself asks. A withheld capability (CA-M4) therefore also withholds the
-- notification, and a folded team or a lapsed membership answers false here as it does everywhere.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.availability_notification_recipients(p_team_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    -- A club role that can hold the capability by default, at club or team scope.
    select cm.user_id
    from public.club_memberships cm
    join public.teams t on t.club_id = cm.club_id
    where t.id = p_team_id
      and cm.status = 'active'
      and cm.role in (
        select d.role_key from public.role_capability_defaults d
        where d.capability_key = 'team.attendance.view'
      )
    union
    -- Anybody holding a team permission on this team (a manager, a coach, a permission group).
    select cm.user_id
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id
    where tp.team_id = p_team_id
      and cm.status = 'active'
    union
    -- Anybody granted the capability explicitly, at this team or its club.
    select o.user_id
    from public.capability_overrides o
    join public.teams t on t.id = p_team_id
    where o.capability_key = 'team.attendance.view'
      and o.status = 'active'
      and o.effect = 'grant'
      and (o.team_id = p_team_id or (o.team_id is null and o.club_id = t.club_id))
  )
  select distinct c.user_id
  from candidates c
  cross join lateral internal.capability_decision(
    c.user_id, 'team.attendance.view', 'team', null, p_team_id, null, false, false
  ) d
  where d.allowed;
$$;

revoke all on function internal.availability_notification_recipients(uuid) from public;

-- -----------------------------------------------------------------------------------------------------
-- 3. The emitter. One person's answer about one event, told once to the people who run that side.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.notify_availability_response(
  p_fixture_id uuid,
  p_training_session_id uuid,
  p_player_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_player_name text;
  v_team_id uuid;
  v_club_id uuid;
  v_when text;
  v_what text;
  v_title text;
  v_body text;
  v_answer text;
  v_data jsonb;
  v_inserted integer := 0;
  f record;
  s record;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    return 0;
  end if;

  select btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, ''))
    into v_player_name
  from public.players p where p.id = p_player_id;
  if v_player_name is null or v_player_name = '' then
    v_player_name := 'A player';
  end if;

  v_answer := case p_status
    when 'ATTENDING' then 'can make it'
    when 'CANNOT_ATTEND' then 'cannot make it'
    else 'is not sure yet'
  end;

  if p_fixture_id is not null then
    v_type := 'fixture_availability_responded';
    -- The opposition is named as a club and a side ("Preston Grasshoppers RFC Under 12 Boys"), because a
    -- side's name alone ("Under 12 Boys") is what the reader's own side is called too.
    select fx.id, fx.kickoff_date, fx.kickoff_time,
           fx.owning_team_id, fx.opponent_team_id,
           coalesce(fx.owning_team_display_name_snapshot, ot.display_name, 'Your team') as owning_label,
           nullif(btrim(concat_ws(' ', coalesce(ocd.name, cd.name), coalesce(fx.opponent_team_display_name_snapshot, opt.display_name))), '') as opponent_label
      into f
    from public.fixtures fx
    left join public.teams ot on ot.id = fx.owning_team_id
    left join public.teams opt on opt.id = fx.opponent_team_id
    left join public.clubs oc on oc.id = opt.club_id
    left join public.club_directory ocd on ocd.id = oc.directory_id
    left join public.club_directory cd on cd.id = fx.opponent_directory_id
    where fx.id = p_fixture_id;
    if f.id is null then
      return 0;
    end if;

    -- The side THIS player is on, among the teams involved -- a squad player of the owning team is
    -- told to the owning team's staff, never to the opposition's.
    select ptm.team_id into v_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = p_player_id
      and ptm.state = 'ACTIVE'
      and ptm.team_id in (select team_id from internal.fixture_participant_team_ids(p_fixture_id))
    order by case when ptm.team_id = f.owning_team_id then 0 else 1 end
    limit 1;

    v_what := f.owning_label || case when f.opponent_label is not null then ' v ' || f.opponent_label else '' end;
    v_when := to_char(f.kickoff_date, 'FMDay FMDD FMMonth')
      || coalesce(', kick-off ' || to_char(f.kickoff_time, 'HH24:MI'), '');
    v_data := jsonb_build_object('fixture_id', p_fixture_id, 'player_id', p_player_id, 'status', p_status);
  elsif p_training_session_id is not null then
    v_type := 'training_availability_responded';
    select ts.id, ts.session_date, ts.start_time, ts.team_id, ts.scheduling_group_id, ts.training_plan_id,
           coalesce(t.display_name, 'Your team') as team_label
      into s
    from public.training_sessions ts
    left join public.teams t on t.id = ts.team_id
    where ts.id = p_training_session_id;
    if s.id is null then
      return 0;
    end if;

    select ptm.team_id into v_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = p_player_id
      and ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null
            and ptm.team_id in (select sgm.team_id from public.scheduling_group_members sgm where sgm.group_id = s.scheduling_group_id))
      )
    order by case when ptm.team_id = s.team_id then 0 else 1 end
    limit 1;

    v_what := s.team_label || ' training';
    v_when := to_char(s.session_date, 'FMDay FMDD FMMonth')
      || coalesce(', ' || to_char(s.start_time, 'HH24:MI'), '');
    v_data := jsonb_build_object('training_session_id', p_training_session_id, 'training_plan_id', s.training_plan_id,
                                 'player_id', p_player_id, 'status', p_status);
  else
    return 0;
  end if;

  if v_team_id is null then
    return 0;
  end if;
  select t.club_id into v_club_id from public.teams t where t.id = v_team_id;
  v_data := v_data || jsonb_build_object('team_id', v_team_id, 'club_id', v_club_id);

  v_title := v_player_name || ' ' || v_answer;
  v_body := v_what || ', ' || v_when || '.';

  -- ONE UNREAD ROW PER PERSON PER EVENT. An earlier answer nobody has read yet is superseded by this
  -- one, and is settled rather than left to contradict it -- the same treatment a withdrawn message
  -- gets. A row already read stays as it was: it was true when it was read.
  update public.notifications n
     set read_at = now()
   where n.type = v_type
     and n.read_at is null
     and n.data->>'player_id' = p_player_id::text
     and coalesce(n.data->>'fixture_id', n.data->>'training_session_id')
         = coalesce(p_fixture_id::text, p_training_session_id::text);

  insert into public.notifications (user_id, type, title, body, data)
  select r.user_id, v_type, v_title, v_body, v_data
  from internal.availability_notification_recipients(v_team_id) r
  -- The person answering is not told about their own answer, even when they also run the side.
  where r.user_id is distinct from auth.uid();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function internal.notify_availability_response(uuid, uuid, uuid, text) from public;

-- -----------------------------------------------------------------------------------------------------
-- 4. The two response operations, re-created with ONE addition each: the previous answer is read
--    before the write, and the emitter is called only when the answer actually changed. Every check
--    they had -- live session, fixture accepting responses, the guardian/self/age rule, the player's
--    place on an involved team, the row lock -- is exactly as it was.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_refusal text;
  v_previous text;
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

  select pfa.status into v_previous
  from public.player_fixture_attendance pfa
  where pfa.fixture_id = p_fixture_id and pfa.player_id = p_player_id;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();

  -- CA-M8: the side's staff hear the answer -- once per change, never for a repeat of the same answer.
  if v_previous is distinct from p_status then
    perform internal.notify_availability_response(p_fixture_id, null, p_player_id, p_status);
  end if;
end;
$$;

create or replace function public.respond_to_training_attendance(p_training_session_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  s public.training_sessions;
  v_source text;
  v_involved boolean;
  v_previous text;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  -- Section 25: a cancelled session is read-only -- no new response needed or accepted.
  if s.status = 'CANCELLED' then
    raise exception 'This training session has been cancelled -- no attendance response is needed.' using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  select exists (
    select 1 from public.player_team_memberships ptm
    where ptm.player_id = p_player_id and ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
  ) into v_involved;
  if not v_involved then
    raise exception 'This player is not associated with the team training in this session.' using errcode = '42501';
  end if;

  select pfa.status into v_previous
  from public.player_fixture_attendance pfa
  where pfa.training_session_id = p_training_session_id and pfa.player_id = p_player_id;

  insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
  values (p_training_session_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (training_session_id, player_id) where training_session_id is not null do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();

  -- CA-M8: the side's staff hear the answer -- once per change, never for a repeat of the same answer.
  if v_previous is distinct from p_status then
    perform internal.notify_availability_response(null, p_training_session_id, p_player_id, p_status);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 5. The feed, paged. The SAME membership rule as my_bell_notifications and my_unread_counts -- what
--    Messenger and Support own is theirs -- so the page a person scrolls and the badge they tapped
--    cannot disagree. Keyset on (created_at, id): a row inserted while somebody scrolls shifts nothing.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.my_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_unread_only boolean default false
)
returns table(
  id uuid,
  type text,
  topic_key text,
  title text,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = 'public', 'internal', 'pg_temp'
as $$
  select n.id, n.type, t.topic_key, n.title, n.body, n.data, n.read_at, n.created_at
  from public.notifications n
  left join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    and coalesce(t.topic_key, '') <> 'messages'
    and n.type <> 'support_ticket_update'
    and (not coalesce(p_unread_only, false) or n.read_at is null)
    and (
      p_before_created_at is null
      or n.created_at < p_before_created_at
      or (n.created_at = p_before_created_at and p_before_id is not null and n.id < p_before_id)
    )
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.my_notifications(integer, timestamptz, uuid, boolean) from public;
grant execute on function public.my_notifications(integer, timestamptz, uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 6. The read mutation. Self-only, read_at only -- the same boundary the table's own policy and the
--    read-only trigger already draw -- offered as three named operations so that both clients say the
--    same thing. Unread is a real state the storage holds (read_at is null), so marking unread is a
--    real operation, not a client-side pretence. None of these touches the thing the notification
--    was about: READ IS NOT RESOLVED.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'internal', 'pg_temp'
as $$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set read_at = now()
   where n.id = p_id and n.user_id = auth.uid() and n.read_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.mark_notification_unread(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'internal', 'pg_temp'
as $$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set read_at = null
   where n.id = p_id and n.user_id = auth.uid() and n.read_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Marks the BELL's rows read: what the Notifications screen lists. Messenger and Support keep their
-- own unread state and their own way of clearing it.
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = 'public', 'internal', 'pg_temp'
as $$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set read_at = now()
   where n.user_id = auth.uid()
     and n.read_at is null
     and coalesce((select t.topic_key from public.notification_types t where t.type_key = n.type), '') <> 'messages'
     and n.type <> 'support_ticket_update';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_notification_unread(uuid) from public;
revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_notification_unread(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 7. Self-check: the pieces exist, the types are registered in the right topics, and the response
--    operations call the emitter.
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.notification_types
      where (type_key, topic_key) in (('fixture_availability_responded', 'fixture_updates'),
                                      ('training_availability_responded', 'calendar_training_updates'))) <> 2 then
    raise exception 'CA-M8: the availability response types are not registered where expected';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'internal' and p.proname = 'notify_availability_response') then
    raise exception 'CA-M8: the availability emitter is missing';
  end if;
  if pg_get_functiondef('public.respond_to_attendance(uuid,uuid,text)'::regprocedure) not like '%notify_availability_response%'
     or pg_get_functiondef('public.respond_to_training_attendance(uuid,uuid,text)'::regprocedure) not like '%notify_availability_response%' then
    raise exception 'CA-M8: a response operation does not tell the staff';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('my_notifications', 'mark_notification_read', 'mark_notification_unread', 'mark_all_notifications_read')
                 group by n.nspname having count(*) = 4) then
    raise exception 'CA-M8: the inbox read model or a read mutation is missing';
  end if;
end $$;
