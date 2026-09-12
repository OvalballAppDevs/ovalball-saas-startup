-- =====================================================================
-- A DIRECT CONVERSATION IS TWO PEOPLE
--
-- Everything Messenger holds today is organisational: a fixture, a request,
-- two clubs, a team, a safeguarding channel, an announcement. Six containers,
-- and not one of them is "these two people are talking". allow_direct_messaging
-- has existed as a policy flag since 20270243000000 with nothing to govern.
--
-- WHY A NEW CONTAINER AND NOT A NEW STORE
--
-- The messages themselves stay in fixture_messages. That table is already the
-- one canonical store -- moderation, reporting, soft delete, attachments,
-- sender identity and the content-type discriminator all live there -- and a
-- second store would mean a second copy of every one of those, with the copy
-- that gets forgotten being the one that lets a deleted message stay visible.
-- So this adds a SEVENTH container column and keeps the existing
-- "exactly one container" CHECK intact.
--
-- What is genuinely new is the conversation's IDENTITY, because a direct
-- conversation is identified by its two people rather than by an event.
--
-- THE PAIR IS THE KEY, AND THE DATABASE ENFORCES IT
--
-- Two people must never end up with two threads. Application-level
-- "select, then insert if missing" loses that race the first time both press
-- Message at once. So the pair is stored in a canonical order --
-- least(a,b), greatest(a,b) -- with a UNIQUE constraint on it, and the
-- opener is an upsert. Concurrent starts converge on one row by construction
-- rather than by luck.
--
-- WHO MAY START ONE
--
-- Ovalball is not a people directory and must not become one. Direct contact
-- is permitted only where the server can already prove a relationship:
-- shared team staffing, shared club staffing, both sides of a real fixture,
-- or a conversation that already exists. Every one of those is read from
-- canonical membership and capability data -- never from a club name, never
-- from a display string, never from anything the browser supplied.
--
-- AND IT IS STAFF-TO-STAFF
--
-- This path deliberately cannot reach a player or a guardian. Safeguarding
-- contact has one canonical answer -- internal.player_contact_eligibility --
-- and it routes an adult to a child through a guardian for reasons that a
-- convenient 1:1 inbox must not quietly undo. "Direct messaging exists" must
-- never become "a coach can message a twelve-year-old". Both parties here
-- must hold a staff position, and that is checked server-side on every send,
-- not merely when the thread is created.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE CONVERSATION
-- ---------------------------------------------------------------------
create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),

  -- CANONICALLY ORDERED. user_a is always the smaller uuid, so the pair has
  -- one representation and the unique index below actually means "one thread
  -- per pair" rather than "one thread per direction".
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,

  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Denormalised so the inbox can sort without touching the message table.
  last_message_at timestamptz,

  constraint direct_conversations_ordered_pair check (user_a < user_b)
);

create unique index if not exists direct_conversations_pair_idx
  on public.direct_conversations (user_a, user_b);

create index if not exists direct_conversations_user_a_idx
  on public.direct_conversations (user_a, last_message_at desc nulls last);
create index if not exists direct_conversations_user_b_idx
  on public.direct_conversations (user_b, last_message_at desc nulls last);

comment on table public.direct_conversations is
  'One thread per pair of people, keyed by the ordered pair so concurrent opens converge on a single row. Messages live in fixture_messages like every other conversation; only the identity is held here.';

alter table public.direct_conversations enable row level security;

-- ---------------------------------------------------------------------
-- 2. THE SEVENTH CONTAINER
-- ---------------------------------------------------------------------
alter table public.fixture_messages
  add column if not exists direct_conversation_id uuid
  references public.direct_conversations(id) on delete cascade;

alter table public.fixture_messages drop constraint if exists fixture_messages_check;
alter table public.fixture_messages
  add constraint fixture_messages_check check (
    num_nonnulls(
      fixture_request_id, fixture_id, club_conversation_id,
      team_conversation_id, safeguarding_conversation_id, announcement_id,
      direct_conversation_id
    ) = 1
  );

create index if not exists fixture_messages_direct_idx
  on public.fixture_messages (direct_conversation_id, created_at desc)
  where direct_conversation_id is not null;

comment on column public.fixture_messages.direct_conversation_id is
  'The 1:1 conversation this message belongs to. One of seven mutually exclusive containers -- a direct message is an ordinary message and is moderated, reported and deleted by the same machinery as any other.';

-- ---------------------------------------------------------------------
-- 3. IS THIS PERSON STAFF AT ALL?
-- ---------------------------------------------------------------------
-- The gate that keeps this path away from children. A player or guardian
-- holds neither a club role nor a team permission, so they are never a
-- direct-message target and never a direct-message sender.
create or replace function internal.is_messaging_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.club_memberships cm
    where cm.user_id = p_user_id and cm.status = 'active'
      and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  ) or exists (
    select 1
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id
    where cm.user_id = p_user_id and cm.status = 'active'
      and tp.permission in ('team_admin', 'coach', 'manager')
  );
$$;

comment on function internal.is_messaging_staff(uuid) is
  'Does this person hold a club or team staff position? Direct messaging is staff-to-staff only: a player or guardian is reached through the canonical safeguarding path, never through a 1:1 thread.';

revoke all on function internal.is_messaging_staff(uuid) from public, anon;
grant execute on function internal.is_messaging_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. THE CONTACT-AUTHORITY RESOLVER
-- ---------------------------------------------------------------------
-- One function, consulted by discovery, by thread creation and by every
-- send. A picker that used different logic would eventually offer somebody
-- the send path then refuses.
create or replace function internal.may_direct_message(p_other_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_policy record;
  v_club_id uuid;
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return false;
  end if;

  -- BOTH SIDES MUST BE STAFF. Checked before anything else, so no other
  -- clause can accidentally open a route to a child.
  if not internal.is_messaging_staff(v_me) or not internal.is_messaging_staff(p_other_user_id) then
    return false;
  end if;

  -- A PERSONAL BLOCK CLOSES IT IN BOTH DIRECTIONS. Asked from both sides
  -- because a block stops the pair talking, not just one of them.
  if internal.is_personally_blocked(v_me, p_other_user_id)
     or internal.is_personally_blocked(p_other_user_id, v_me) then
    return false;
  end if;

  -- THE POLICY, resolved against MY club. A club that has switched direct
  -- messaging off has switched it off for its own people.
  select cm.club_id into v_club_id
  from public.club_memberships cm
  where cm.user_id = v_me and cm.status = 'active'
  limit 1;

  select * into v_policy from public.get_effective_message_policy(v_club_id);
  if not coalesce(v_policy.allow_direct_messaging, true) then
    return false;
  end if;

  -- RELATIONSHIP 1: we already have a thread. Listed first because an
  -- existing conversation must keep working even as rosters change -- see
  -- the lifecycle note at the end of this migration.
  if exists (
    select 1 from public.direct_conversations d
    where (d.user_a = least(v_me, p_other_user_id) and d.user_b = greatest(v_me, p_other_user_id))
  ) then
    return true;
  end if;

  -- RELATIONSHIP 2: same club, both staff.
  if exists (
    select 1
    from public.club_memberships a
    join public.club_memberships b on b.club_id = a.club_id
    where a.user_id = v_me and a.status = 'active'
      and b.user_id = p_other_user_id and b.status = 'active'
  ) then
    return true;
  end if;

  -- RELATIONSHIP 3: staff on the same team, even across clubs.
  if exists (
    select 1
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = v_me and ca.status = 'active'
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.user_id = p_other_user_id and cb.status = 'active'
  ) then
    return true;
  end if;

  -- RELATIONSHIP 4: opposite sides of a real fixture, inside its window.
  -- THE WINDOW IS THE PRODUCT DECISION HERE. A fixture creates a bounded
  -- working relationship -- arranging kit, pitches, postponements -- that
  -- starts when it is scheduled and does not last forever. Playing a club
  -- once must not grant permanent access to its staff. 60 days after
  -- kickoff covers result disputes and follow-up; anything older requires a
  -- new fixture or another relationship. See the note at the foot of this
  -- file: this boundary is stated here so it can be argued with, rather than
  -- left implicit.
  if exists (
    select 1
    from public.fixtures f
    join public.teams t_home on t_home.id = f.owning_team_id
    join public.teams t_away on t_away.id = f.opponent_team_id
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and (
        (internal.staffs_team(v_me, f.owning_team_id) and internal.staffs_team(p_other_user_id, f.opponent_team_id))
        or
        (internal.staffs_team(v_me, f.opponent_team_id) and internal.staffs_team(p_other_user_id, f.owning_team_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function internal.may_direct_message(uuid) is
  'May the caller open or continue a 1:1 conversation with this person? The one authority for direct contact: staff-to-staff only, never across a personal block, never when the club has switched direct messaging off, and only where a shared club, shared team, live fixture or existing thread already proves a relationship.';

revoke all on function internal.may_direct_message(uuid) from public, anon;
grant execute on function internal.may_direct_message(uuid) to authenticated;

-- Does this person staff this team? Extracted so the fixture clause above
-- reads as the rule it is, rather than as two more joins.
create or replace function internal.staffs_team(p_user_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select p_team_id is not null and (
    exists (
      select 1 from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id
      where cm.user_id = p_user_id and cm.status = 'active'
        and tp.team_id = p_team_id
        and tp.permission in ('team_admin', 'coach', 'manager')
    )
    or exists (
      -- A club's fixture officials act for every team the club runs.
      select 1 from public.club_memberships cm
      join public.teams t on t.club_id = cm.club_id
      where cm.user_id = p_user_id and cm.status = 'active'
        and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        and t.id = p_team_id
    )
  );
$$;

revoke all on function internal.staffs_team(uuid, uuid) from public, anon;
grant execute on function internal.staffs_team(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
-- You can see a thread you are in. Nothing else, ever -- there is no admin
-- clause here: a 1:1 conversation is not club property, and an administrator
-- who needs one for moderation goes through the audited Support path that
-- already exists for exactly that.
drop policy if exists direct_conversations_select_own on public.direct_conversations;
create policy direct_conversations_select_own on public.direct_conversations
  for select using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

-- Messages in a direct thread follow the same rule.
create or replace function internal.can_view_direct_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.direct_conversations d
    where d.id = p_conversation_id
      and (d.user_a = auth.uid() or d.user_b = auth.uid())
  );
$$;

revoke all on function internal.can_view_direct_conversation(uuid) from public, anon;
grant execute on function internal.can_view_direct_conversation(uuid) to authenticated;

drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
  for select using (
    internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
    or (team_conversation_id is not null and internal.can_view_team_conversation(team_conversation_id))
    or (safeguarding_conversation_id is not null and internal.can_view_safeguarding_conversation(safeguarding_conversation_id))
    or (announcement_id is not null and internal.can_view_announcement_reply(announcement_id, sender_user_id))
    -- READING IS MEMBERSHIP OF THE THREAD, not current authority to send.
    -- A blocked or lapsed relationship stops new messages; it does not
    -- retrospectively confiscate a conversation somebody already had.
    or (direct_conversation_id is not null and internal.can_view_direct_conversation(direct_conversation_id))
  );

-- Sending is the stricter question, and it is asked on every insert.
drop policy if exists fixture_messages_insert_scoped on public.fixture_messages;
create policy fixture_messages_insert_scoped on public.fixture_messages
  for insert with check (
    sender_user_id = auth.uid()
    and (
      (team_conversation_id is not null and internal.can_send_team_conversation(team_conversation_id))
      or (safeguarding_conversation_id is not null and internal.can_send_safeguarding_conversation(safeguarding_conversation_id))
      or (
        direct_conversation_id is not null
        and internal.can_view_direct_conversation(direct_conversation_id)
        -- THE LIVE AUTHORITY CHECK. Re-asked here rather than trusted from
        -- thread creation, so a block, a policy change or a lapsed
        -- relationship stops the next message rather than only the next
        -- thread.
        and internal.may_direct_message(
          (select case when d.user_a = auth.uid() then d.user_b else d.user_a end
           from public.direct_conversations d where d.id = direct_conversation_id))
      )
      or (
        team_conversation_id is null
        and safeguarding_conversation_id is null
        and announcement_id is null
        and direct_conversation_id is null
        and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
        and (
          club_conversation_id is null
          or (select cc.status from public.club_conversations cc
              where cc.id = fixture_messages.club_conversation_id) = 'accepted'
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- 6. OPENING A THREAD
-- ---------------------------------------------------------------------
-- Idempotent by construction: the same pair always produces the same row,
-- and two simultaneous callers both end up with it.
create or replace function public.open_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.may_direct_message(p_other_user_id) then
    -- DELIBERATELY ONE MESSAGE for every reason: no relationship, a block in
    -- either direction, policy off, or not staff. Distinguishing them would
    -- tell the caller which, and "they blocked you" is precisely the thing
    -- that must never be inferable.
    raise exception 'This conversation isn''t available.' using errcode = '42501';
  end if;

  v_a := least(v_me, p_other_user_id);
  v_b := greatest(v_me, p_other_user_id);

  insert into public.direct_conversations (user_a, user_b, created_by)
  values (v_a, v_b, v_me)
  on conflict (user_a, user_b) do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.open_direct_conversation(uuid) is
  'Opens the 1:1 conversation with this person, creating it only if the server can prove a relationship. Idempotent: the same pair always resolves to the same thread, including under concurrent opens.';

revoke all on function public.open_direct_conversation(uuid) from public, anon;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

-- Keep the inbox sort column current without every reader touching messages.
create or replace function internal.touch_direct_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if new.direct_conversation_id is not null then
    update public.direct_conversations
    set last_message_at = new.created_at, updated_at = now()
    where id = new.direct_conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists fixture_messages_touch_direct on public.fixture_messages;
create trigger fixture_messages_touch_direct
  after insert on public.fixture_messages
  for each row execute function internal.touch_direct_conversation();

-- =====================================================================
-- LIFECYCLE, STATED RATHER THAN ASSUMED
--
-- READING and SENDING are separated on purpose. Membership of the thread
-- grants reading, for as long as the thread exists; sending additionally
-- requires may_direct_message to still be true. So:
--
--   fixture cancelled or older than 60 days  -> no NEW pair may start, but a
--                                               thread already opened keeps
--                                               working (clause 1)
--   coach leaves the team / club             -> is_messaging_staff fails, so
--                                               sending stops in both
--                                               directions; history remains
--                                               readable to both
--   person blocked                           -> sending stops both ways,
--                                               history remains
--   direct messaging switched off            -> sending stops, history remains
--
-- The "existing thread keeps working" clause is the one that deserves
-- challenge: it means a relationship that has lapsed still permits messages
-- while the thread survives. That is deliberate -- two people mid-conversation
-- about a postponed fixture should not be cut off at midnight on day 60 --
-- but it is a product decision, not a technical necessity, and it is flagged
-- in the report for explicit approval.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 7. WHO CAN I MESSAGE, AND WHY
-- ---------------------------------------------------------------------
-- The discovery side of may_direct_message. It returns people the caller may
-- already contact, each carrying the REASON they are reachable, because
-- "Wigan U12 - Fixture contact" is the difference between a list a person
-- understands and a list of strangers.
--
-- It is not a search over users. Every row originates in a relationship the
-- caller already holds, so there is no query shape that returns somebody
-- they are not entitled to see. Name resolution happens here, inside a
-- SECURITY DEFINER boundary, precisely so that profiles can stay
-- self-or-admin to everybody else.
create or replace function public.my_direct_message_candidates()
returns table (
  user_id uuid,
  display_name text,
  context_label text,
  context_detail text
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with me as (select auth.uid() as id),
  -- SAME CLUB
  club_mates as (
    select distinct b.user_id, 'Your club'::text as label, d.name as detail
    from public.club_memberships a
    join public.club_memberships b on b.club_id = a.club_id and b.status = 'active'
    join public.clubs c on c.id = a.club_id
    join public.club_directory d on d.id = c.directory_id
    where a.user_id = (select id from me) and a.status = 'active'
  ),
  -- SAME TEAM
  team_mates as (
    select distinct cb.user_id, 'Your team'::text, t.display_name
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = (select id from me) and ca.status = 'active'
    join public.teams t on t.id = ta.team_id
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.status = 'active'
  ),
  -- THE OTHER SIDE OF A FIXTURE. The label names the opposing TEAM, not the
  -- person's club role, because "Under 12 Girls - Fixture contact" is what
  -- makes an unfamiliar name make sense.
  fixture_contacts as (
    select distinct cm.user_id, 'Fixture contact'::text, opp.display_name
    from public.fixtures f
    join public.teams mine on mine.id in (f.owning_team_id, f.opponent_team_id)
    join public.teams opp on opp.id in (f.owning_team_id, f.opponent_team_id) and opp.id <> mine.id
    join public.club_memberships cm on cm.club_id = opp.club_id and cm.status = 'active'
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and internal.staffs_team((select id from me), mine.id)
      and internal.staffs_team(cm.user_id, opp.id)
  ),
  everyone as (
    select * from club_mates
    union all select * from team_mates
    union all select * from fixture_contacts
  ),
  -- One row per person. Where somebody qualifies twice -- a colleague who is
  -- also on your team -- the more specific relationship is the useful one.
  ranked as (
    select e.user_id, e.label, e.detail,
           row_number() over (
             partition by e.user_id
             order by case e.label when 'Your team' then 1 when 'Your club' then 2 else 3 end
           ) as rn
    from everyone e
  )
  select r.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         r.label,
         r.detail
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
    -- THE SAME AUTHORITY THE SEND PATH APPLIES, so the picker can never
    -- offer somebody open_direct_conversation would then refuse. This also
    -- removes blocked pairs and anyone the policy excludes, in both
    -- directions, without the list ever saying which.
    and internal.may_direct_message(r.user_id)
  order by 2;
$$;

comment on function public.my_direct_message_candidates() is
  'People the caller may start a 1:1 with, each labelled by the relationship that makes them reachable. Built only from relationships the caller already holds -- it is not a search over users and cannot return anybody outside them.';

revoke all on function public.my_direct_message_candidates() from public, anon;
grant execute on function public.my_direct_message_candidates() to authenticated;

-- ---------------------------------------------------------------------
-- 8. THE OTHER PERSON IS TOLD -- ON THE MESSENGER BADGE, NOT THE BELL
-- ---------------------------------------------------------------------
-- Registered under topic 'messages', so a direct message counts where a
-- message should count. A DM is not an "event that happened to you"; it is
-- somebody talking to you, and the bell is not for that.
insert into public.notification_types (type_key, topic_key) values
  ('new_direct_message', 'messages')
on conflict (type_key) do nothing;

-- A separate trigger rather than another branch inside
-- notify_fixture_message_recipients: that function is a tangle of fixture,
-- request and club-conversation recipient resolution, and a direct
-- conversation's recipient is simply "the other one". Bolting it on would
-- make the hard function harder for no gain.
create or replace function internal.notify_direct_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_other uuid;
  v_sender_name text;
begin
  if new.direct_conversation_id is null then
    return new;
  end if;

  select case when d.user_a = new.sender_user_id then d.user_b else d.user_a end
  into v_other
  from public.direct_conversations d where d.id = new.direct_conversation_id;

  if v_other is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), '')
  into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  -- A PERSON's name, because a direct message is from a person. Sender
  -- identity is never organisational here -- see the check below.
  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_other,
    'new_direct_message',
    coalesce(v_sender_name, 'Ovalball user'),
    case when new.content_type = 'image' and coalesce(btrim(new.body), '') = ''
         then 'Sent a photo' else left(coalesce(new.body, ''), 140) end,
    jsonb_build_object(
      'direct_conversation_id', new.direct_conversation_id,
      'message_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists fixture_messages_notify_direct on public.fixture_messages;
create trigger fixture_messages_notify_direct
  after insert on public.fixture_messages
  for each row execute function internal.notify_direct_message_recipient();

-- A DIRECT MESSAGE IS ALWAYS FROM A PERSON. An organisational identity in a
-- 1:1 thread would let a club admin appear to be having a private
-- conversation as "Ovalball" or as the club, which is precisely the
-- masquerade the actor/identity split exists to prevent.
create or replace function internal.enforce_direct_sender_is_personal()
returns trigger
language plpgsql
as $$
begin
  if new.direct_conversation_id is not null and new.sender_identity_type <> 'person' then
    raise exception 'A direct message is always from a person.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fixture_messages_direct_personal_sender on public.fixture_messages;
create trigger fixture_messages_direct_personal_sender
  before insert on public.fixture_messages
  for each row execute function internal.enforce_direct_sender_is_personal();

-- ---------------------------------------------------------------------
-- 9. THE INBOX ROW
-- ---------------------------------------------------------------------
-- Direct threads belong in the same inbox as everything else, so they need
-- the same shape: who it is with, what was said last, when, and how many are
-- unread. Unread is counted from notifications, exactly as every other
-- Messenger row counts it, so the badge and the list cannot disagree.
create or replace function public.my_direct_conversations(p_limit integer default 50)
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_display_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_from_me boolean,
  unread integer
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with mine as (
    select d.id,
           case when d.user_a = auth.uid() then d.user_b else d.user_a end as other_id,
           d.last_message_at
    from public.direct_conversations d
    where d.user_a = auth.uid() or d.user_b = auth.uid()
  ),
  latest as (
    select distinct on (m.direct_conversation_id)
           m.direct_conversation_id, m.body, m.content_type, m.deleted_at, m.sender_user_id
    from public.fixture_messages m
    where m.direct_conversation_id in (select id from mine)
    order by m.direct_conversation_id, m.created_at desc
  ),
  unread as (
    select (n.data ->> 'direct_conversation_id')::uuid as cid, count(*)::integer as c
    from public.notifications n
    where n.user_id = auth.uid() and n.read_at is null and n.type = 'new_direct_message'
    group by 1
  )
  select
    mine.id,
    mine.other_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    mine.last_message_at,
    case
      when l.deleted_at is not null then 'Message deleted'
      when l.content_type = 'image' and coalesce(btrim(l.body), '') = '' then 'Photo'
      else l.body
    end,
    l.sender_user_id = auth.uid(),
    coalesce(u.c, 0)
  from mine
  join public.profiles p on p.id = mine.other_id
  left join latest l on l.direct_conversation_id = mine.id
  left join unread u on u.cid = mine.id
  order by mine.last_message_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.my_direct_conversations(integer) is
  'The caller''s 1:1 conversations as inbox rows. Scoped to threads they are in, so it can never list anybody else''s; unread comes from the same notification rows the Messenger badge counts.';

revoke all on function public.my_direct_conversations(integer) from public, anon;
grant execute on function public.my_direct_conversations(integer) to authenticated;

-- Reading a direct conversation clears its unread, the same way every other
-- Messenger surface clears its own.
create or replace function public.mark_direct_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public, internal, pg_temp
as $$
  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and type = 'new_direct_message'
    and (data ->> 'direct_conversation_id') = p_conversation_id::text
    and read_at is null;
$$;

revoke all on function public.mark_direct_conversation_read(uuid) from public, anon;
grant execute on function public.mark_direct_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. THE THREAD HEADER
-- ---------------------------------------------------------------------
-- One call for "who is this with, and may I still write to them".
--
-- It resolves the name from the CONVERSATION rather than from the candidate
-- list, which matters: a blocked or lapsed thread drops out of discovery, and
-- if the name came from there the header of a blocked conversation would read
-- "Ovalball user". You are always entitled to know who you were talking to.
create or replace function public.direct_conversation_header(p_conversation_id uuid)
returns table (
  other_user_id uuid,
  other_display_name text,
  can_send boolean
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_other uuid;
begin
  select case when d.user_a = auth.uid() then d.user_b else d.user_a end
  into v_other
  from public.direct_conversations d
  where d.id = p_conversation_id
    and (d.user_a = auth.uid() or d.user_b = auth.uid());

  -- Not a member: nothing at all, so a guessed id cannot confirm a thread.
  if v_other is null then
    return;
  end if;

  return query
  select v_other,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         internal.may_direct_message(v_other)
  from public.profiles p
  where p.id = v_other;
end;
$$;

comment on function public.direct_conversation_header(uuid) is
  'Who a 1:1 thread is with, and whether the caller may still send into it. Returns nothing to anybody who is not in the thread. The name survives a block or a lapsed relationship: you are entitled to know who you were talking to even when you can no longer write to them.';

revoke all on function public.direct_conversation_header(uuid) from public, anon;
grant execute on function public.direct_conversation_header(uuid) to authenticated;
