-- =====================================================================
-- AN ANNOUNCEMENT IS NOT A GROUP CHAT
--
-- WHY THIS IS NOT A fixture_messages ROW
--
-- Visibility in fixture_messages is conversation membership: one container,
-- one participant set, and everybody in it can see everybody else. That is
-- exactly right for two clubs arranging a fixture, and exactly wrong for a
-- club telling four hundred families that Saturday is off -- because putting
-- those four hundred people in one container makes the participant list the
-- audience list. Who else got this is not the recipient's business, and in a
-- product holding children's records it is not a detail.
--
-- So an announcement owns its content once, and who received it is recorded
-- one private row at a time. A recipient can read their own row and nothing
-- else. Audience secrecy is then a property of the schema rather than
-- something the UI remembers to hide.
--
-- THREE REPLY MODES, AND THE LIMIT ON THE THIRD
--
--   NO_REPLY          the club is telling you something
--   PRIVATE_REPLY     you may answer, and only they see it
--   GROUP_DISCUSSION  everyone in a bounded group can talk
--
-- GROUP_DISCUSSION is restricted at the database, not in the composer, to
-- team and explicitly-selected bounded groups. A club-wide or platform-wide
-- announcement cannot become a discussion, because a four-hundred-person
-- thread nobody chose to join is not a feature -- and a ten-thousand-person
-- one is an incident. The constraint says so directly, so no future call
-- site can decide otherwise.
--
-- WITHDRAWAL IS NOT DELETION
--
-- A withdrawn announcement keeps its place in the chronology and stops
-- showing its content. The record, the actor, the identity, the audience
-- metadata and every delivery row survive, because "we sent this and then
-- took it back" is precisely the thing an investigation needs to see.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE ANNOUNCEMENT
-- ---------------------------------------------------------------------
create table if not exists public.messenger_announcements (
  id uuid primary key default gen_random_uuid(),

  -- WHO IS SPEAKING, and who actually pressed Send. Both, always.
  actor_user_id uuid not null references auth.users(id),
  sender_identity_type text not null,
  sender_identity_id uuid,

  -- WHERE this reaches. 'selected' is an explicitly chosen bounded group.
  scope text not null,
  scope_id uuid,

  -- WHAT WAS ASKED FOR, as typed criteria -- never a list of user ids, and
  -- never display labels. The resolver reads this; it is a request, not an
  -- answer.
  audience_spec jsonb not null default '{}'::jsonb,
  exclude_u18 boolean not null default false,

  reply_mode text not null default 'NO_REPLY',

  title text,
  body text not null,

  status text not null default 'draft',
  fanout_state text not null default 'pending',
  resolved_recipient_count integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id),

  constraint messenger_announcements_sender_identity_check check (
    (sender_identity_type = 'platform' and sender_identity_id is null)
    or (sender_identity_type in ('team', 'club') and sender_identity_id is not null)
  ),
  constraint messenger_announcements_scope_check check (
    (scope = 'platform' and scope_id is null)
    or (scope in ('team', 'club') and scope_id is not null)
    or (scope = 'selected' and scope_id is null)
  ),
  constraint messenger_announcements_reply_mode_check
    check (reply_mode in ('NO_REPLY', 'PRIVATE_REPLY', 'GROUP_DISCUSSION')),

  -- THE LIMIT, stated where it cannot be argued with.
  constraint messenger_announcements_group_discussion_bounded check (
    reply_mode <> 'GROUP_DISCUSSION' or scope in ('team', 'selected')
  ),

  constraint messenger_announcements_status_check
    check (status in ('draft', 'sending', 'sent', 'withdrawn')),
  constraint messenger_announcements_fanout_check
    check (fanout_state in ('pending', 'in_progress', 'complete', 'failed')),
  constraint messenger_announcements_body_present
    check (btrim(body) <> ''),
  constraint messenger_announcements_withdrawal_consistent
    check ((status = 'withdrawn') = (withdrawn_at is not null))
);

comment on table public.messenger_announcements is
  'One announcement, its content held once. Who received it lives in messenger_announcement_deliveries, one private row each, so no recipient can learn the audience. Withdrawal hides content without destroying the record.';

create index if not exists messenger_announcements_scope_idx
  on public.messenger_announcements (scope, scope_id, created_at desc);
create index if not exists messenger_announcements_fanout_idx
  on public.messenger_announcements (fanout_state, created_at)
  where fanout_state in ('pending', 'in_progress');

alter table public.messenger_announcements enable row level security;

-- ---------------------------------------------------------------------
-- 2. THE DELIVERIES -- ONE PRIVATE ROW EACH
-- ---------------------------------------------------------------------
create table if not exists public.messenger_announcement_deliveries (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.messenger_announcements(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,

  status text not null default 'pending',
  delivered_at timestamptz,
  read_at timestamptz,

  -- HOW this person was reached, straight from the canonical safeguarding
  -- answer. A guardian receiving something about a child is a different fact
  -- from an adult receiving it about themselves, and the difference has to
  -- survive into the record.
  safeguarding_route text,
  concerning_player_id uuid references public.players(id),

  -- Fan-out identity. One logical recipient, one delivery, however many
  -- times the worker runs.
  idempotency_key text not null,
  attempts integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),

  constraint messenger_announcement_deliveries_status_check
    check (status in ('pending', 'delivered', 'failed')),
  constraint messenger_announcement_deliveries_route_check
    check (safeguarding_route is null or safeguarding_route in ('direct', 'guardian')),
  constraint messenger_announcement_deliveries_delivered_consistent
    check ((status = 'delivered') = (delivered_at is not null)),
  -- Read implies delivered. A message cannot be read before it exists.
  constraint messenger_announcement_deliveries_read_after_delivery
    check (read_at is null or delivered_at is not null)
);

comment on table public.messenger_announcement_deliveries is
  'One row per recipient per announcement, readable only by that recipient and the sending side. This is what makes audience membership private: there is no query an ordinary recipient can run that returns anybody else.';

create unique index if not exists messenger_announcement_deliveries_idem_idx
  on public.messenger_announcement_deliveries (idempotency_key);
create unique index if not exists messenger_announcement_deliveries_pair_idx
  on public.messenger_announcement_deliveries (announcement_id, recipient_user_id);
-- The unread lookup, shaped like the notifications one it sits beside.
create index if not exists messenger_announcement_deliveries_unread_idx
  on public.messenger_announcement_deliveries (recipient_user_id)
  where read_at is null and status = 'delivered';

alter table public.messenger_announcement_deliveries enable row level security;

-- ---------------------------------------------------------------------
-- 2a. THE TWO PREDICATES, AS FUNCTIONS RATHER THAN AS CROSS-REFERENCES
-- ---------------------------------------------------------------------
-- The announcement and its deliveries each need to ask a question about the
-- other: "am I a recipient of this?" and "am I the sender of this?". Written
-- as EXISTS clauses inside the two policies, that is mutually recursive --
-- each policy's subquery re-enters the other policy, and Postgres refuses
-- with "infinite recursion detected in policy". It is not a corner case; it
-- fires on the first ordinary read.
--
-- SECURITY DEFINER is the fix rather than a shortcut. These functions run as
-- the owner, so RLS does not re-enter, and each answers exactly one boolean
-- about the CALLER. Neither returns a row, an id, or a count, so neither can
-- be used to enumerate an audience -- which is the whole property this
-- migration exists to protect.
create or replace function internal.is_announcement_recipient(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.messenger_announcement_deliveries d
    where d.announcement_id = p_announcement_id
      and d.recipient_user_id = auth.uid()
  );
$$;

create or replace function internal.is_announcement_sender(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.messenger_announcements a
    where a.id = p_announcement_id
      and (a.actor_user_id = auth.uid()
           or internal.may_send_as(a.sender_identity_type, a.sender_identity_id))
  );
$$;

comment on function internal.is_announcement_recipient(uuid) is
  'Did this announcement reach the caller? Answers one boolean about the caller only, never who else received it.';
comment on function internal.is_announcement_sender(uuid) is
  'Is the caller the sending side of this announcement -- the actor, or someone who may currently speak as that identity?';

revoke all on function internal.is_announcement_recipient(uuid) from public, anon;
revoke all on function internal.is_announcement_sender(uuid) from public, anon;
-- Granted to authenticated because a POLICY evaluates as the querying role:
-- without this the predicate raises "permission denied" and the table reads
-- as empty rather than as forbidden. Same grant the other policy predicates
-- in this schema carry.
grant execute on function internal.is_announcement_recipient(uuid) to authenticated;
grant execute on function internal.is_announcement_sender(uuid) to authenticated;

-- The people entitled to see the announcement itself are the ones who sent
-- it: the actor, and anyone who may currently speak as that identity. That
-- last clause is what makes the record survive staff turnover -- the next
-- secretary can see what the club sent, without the previous one's account.
-- Recipients see it too, because they were sent it.
drop policy if exists messenger_announcements_select_sender on public.messenger_announcements;
create policy messenger_announcements_select_sender on public.messenger_announcements
  for select using (
    actor_user_id = (select auth.uid())
    or internal.may_send_as(sender_identity_type, sender_identity_id)
    or internal.is_announcement_recipient(id)
  );

-- THE WHOLE PRIVACY MODEL, in one predicate: your own row, or you are the
-- sending side. There is deliberately no "everyone on this announcement"
-- clause for recipients.
drop policy if exists messenger_announcement_deliveries_select_own on public.messenger_announcement_deliveries;
create policy messenger_announcement_deliveries_select_own on public.messenger_announcement_deliveries
  for select using (
    recipient_user_id = (select auth.uid())
    or internal.is_announcement_sender(announcement_id)
  );

-- Marking your own copy read is the only write an ordinary recipient makes.
drop policy if exists messenger_announcement_deliveries_update_own on public.messenger_announcement_deliveries;
create policy messenger_announcement_deliveries_update_own on public.messenger_announcement_deliveries
  for update using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3. WITHDRAWAL
-- ---------------------------------------------------------------------
create or replace function public.withdraw_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare a public.messenger_announcements;
begin
  select * into a from public.messenger_announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement not found.';
  end if;
  if not (a.actor_user_id = auth.uid()
          or internal.may_send_as(a.sender_identity_type, a.sender_identity_id)
          or internal.is_full_site_admin()) then
    raise exception 'You are not authorised to withdraw this announcement.' using errcode = '42501';
  end if;
  if a.status = 'withdrawn' then
    return;
  end if;

  -- Status and timestamps only. The body is untouched: withdrawal stops it
  -- being shown, and the readers below are what enforce that. Erasing it
  -- here would destroy the evidence of what was withdrawn.
  update public.messenger_announcements
  set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(), updated_at = now()
  where id = p_announcement_id;
end;
$$;

revoke all on function public.withdraw_announcement(uuid) from public, anon;
grant execute on function public.withdraw_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. WHAT A RECIPIENT ACTUALLY READS
-- ---------------------------------------------------------------------
-- Ordinary reading goes through this, never through a direct table select,
-- so withdrawal is applied in one place and cannot be forgotten by a caller.
create or replace function public.my_announcements(p_limit integer default 30)
returns table (
  announcement_id uuid,
  title text,
  body text,
  sender_identity_type text,
  sender_identity_id uuid,
  reply_mode text,
  withdrawn boolean,
  delivered_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    a.id,
    case when a.status = 'withdrawn' then null else a.title end,
    -- The content is replaced for ordinary readers, exactly as a deleted
    -- message's body is. The row keeps it; this view does not return it.
    case when a.status = 'withdrawn'
         then 'This announcement has been withdrawn.'
         else a.body end,
    a.sender_identity_type,
    a.sender_identity_id,
    a.reply_mode,
    a.status = 'withdrawn',
    d.delivered_at,
    d.read_at
  from public.messenger_announcement_deliveries d
  join public.messenger_announcements a on a.id = d.announcement_id
  where d.recipient_user_id = auth.uid()
    and d.status = 'delivered'
  order by d.delivered_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

comment on function public.my_announcements(integer) is
  'The announcements delivered to the caller. Scoped to their own deliveries, so it can never return another recipient. A withdrawn announcement keeps its place and returns the withdrawal notice instead of its content.';

revoke all on function public.my_announcements(integer) from public, anon;
grant execute on function public.my_announcements(integer) to authenticated;
