-- =====================================================================================================================
-- AN INVITATION BELONGS TO ITS CONVERSATION (locked owner policy, 8 Oct 2026)
--
-- A conversation's invited participants belong to that conversation, not to whichever opponent currently occupies the
-- fixture. When a fixture's opposition changes (20270757000000 gives it a new conversation; 20270763000000 keeps the
-- earlier one readable by the sides it was between and read-only):
--   * the earlier conversation and its history stay, read-only;
--   * the people invited into it can still READ it -- unless their invitation was explicitly revoked, or their
--     account is no longer active;
--   * invitations are NOT carried into the new conversation: joining it takes a new, explicit invitation;
--   * the new opponent reaches nothing of the earlier conversation (763);
--   * an explicit revocation removes the invitation to every conversation of the fixture, so it overrides history.
--
-- WHAT CHANGES. An invitation row now records the conversation it was given for (`conversation_id`, set when it is
-- created and backfilled for existing rows). The fixture-thread check admits an invited person only to that
-- conversation; the earlier-conversation check admits them alongside the conversation's parties; new-message
-- notifications reach an invited person only for messages in their own conversation. A request thread's invitations
-- are untouched. The one-invitation-per-person rule is per conversation, so re-inviting into the new conversation is
-- possible -- and deliberate.
-- =====================================================================================================================

alter table public.fixture_conversation_participants add column if not exists conversation_id uuid;

-- THE BACKFILL MUST NOT TRANSFER. An invitation written before this migration is stamped with its fixture's CURRENT
-- conversation. If that fixture's opposition had already changed -- its messages sit in more than one conversation --
-- the stamp would quietly carry the invitation into the new opponent's thread. Then nothing is guessed: stop.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.fixture_conversation_participants p
    join public.fixtures f on f.id = p.fixture_id
   where p.conversation_id is null
     and (exists (select 1 from public.fixture_messages m
                   where m.fixture_id = f.id and m.conversation_id is distinct from f.conversation_id)
          -- or an audited change of the fixture's opposition after the invitation was made
          or exists (select 1 from public.audit_log a
                      where a.table_name = 'fixtures' and a.record_id = f.id and a.action = 'update'
                        and a.changed_at > p.added_at
                        and ((a.before ->> 'opponent_team_id') is distinct from (a.after ->> 'opponent_team_id')
                             or (a.before ->> 'opponent_directory_id') is distinct from (a.after ->> 'opponent_directory_id')
                             or (a.before ->> 'raw_opposition_text') is distinct from (a.after ->> 'raw_opposition_text')
                             or (a.before ->> 'owning_team_id') is distinct from (a.after ->> 'owning_team_id'))));
  if v_n > 0 then
    raise exception '% invitation(s) belong to a fixture whose opposition already changed; assign their conversations by hand.', v_n;
  end if;
end $$;

update public.fixture_conversation_participants p
   set conversation_id = f.conversation_id
  from public.fixtures f
 where f.id = p.fixture_id and p.conversation_id is null;

create or replace function internal.stamp_fixture_participant_conversation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if new.fixture_id is not null and new.conversation_id is null then
    select f.conversation_id into new.conversation_id from public.fixtures f where f.id = new.fixture_id;
  end if;
  return new;
end;
$function$;
revoke all on function internal.stamp_fixture_participant_conversation() from public, anon, authenticated;

drop trigger if exists stamp_fixture_participant_conversation on public.fixture_conversation_participants;
create trigger stamp_fixture_participant_conversation
  before insert on public.fixture_conversation_participants
  for each row execute function internal.stamp_fixture_participant_conversation();

-- An invitation's conversation never changes after the fact: re-pointing one would be the silent transfer this policy
-- forbids.
create or replace function internal.freeze_fixture_participant_conversation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  -- The one exception: when two threads of the same opposing pair are merged (757's merge), an invitation follows its
  -- conversation into the merged one -- the same people, the same pair.
  if current_setting('ovalball.conversation_merge', true) = 'on' and new.fixture_id is not distinct from old.fixture_id then
    return new;
  end if;
  if new.conversation_id is distinct from old.conversation_id or new.fixture_id is distinct from old.fixture_id then
    raise exception 'An invitation belongs to the conversation it was given for.' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function internal.freeze_fixture_participant_conversation() from public, anon;

drop trigger if exists freeze_fixture_participant_conversation on public.fixture_conversation_participants;
create trigger freeze_fixture_participant_conversation
  before update on public.fixture_conversation_participants
  for each row execute function internal.freeze_fixture_participant_conversation();

do $$
begin
  if exists (select 1 from public.fixture_conversation_participants where fixture_id is not null and conversation_id is null) then
    raise exception 'A fixture invitation could not be tied to its conversation.';
  end if;
end $$;
alter table public.fixture_conversation_participants drop constraint if exists fixture_conversation_participants_conversation_check;
alter table public.fixture_conversation_participants add constraint fixture_conversation_participants_conversation_check
  check (fixture_id is null or conversation_id is not null);

drop index if exists public.fixture_conversation_participants_fixture_user_key;
create unique index if not exists fixture_conversation_participants_conversation_user_key
  on public.fixture_conversation_participants (fixture_id, conversation_id, user_id) where fixture_id is not null;
create index if not exists fixture_conversation_participants_conversation_idx
  on public.fixture_conversation_participants (conversation_id, user_id) where conversation_id is not null;


-- SAFEGUARDING AUTHORITY OVERRIDES AN INVITATION. An active, unexpired explicit withhold of
-- `messaging.fixture_conversation.participate` -- at site scope, or at the club or team of either side the
-- conversation was between -- ends what an invitation would otherwise admit, current or earlier. (Capability-based
-- access already obeys such a withhold through internal.can; an invitation is not a capability, so it is checked here.)
create or replace function internal.invitee_participation_denied_for(p_user uuid, p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  -- Scoped as the canonical resolver scopes a withhold: site; a club withhold for either side's club; a team withhold
  -- for either side's team. A withhold on some other team of the same club does not reach this conversation.
  select p_user is not null and exists (
    select 1 from public.capability_overrides o
    where o.user_id = p_user
      and o.capability_key = 'messaging.fixture_conversation.participate'
      and o.effect = 'deny' and o.status = 'active'
      and (o.expires_at is null or o.expires_at > now())
      and (o.scope_type = 'site'
           or (o.scope_type = 'club' and o.club_id in (
                 select t.club_id from internal.fixture_conversation_parties pt
                   join public.teams t on t.id = pt.team_id where pt.conversation_id = p_conversation_id))
           or (o.scope_type = 'team' and o.team_id in (
                 select pt.team_id from internal.fixture_conversation_parties pt where pt.conversation_id = p_conversation_id)))
  );
$function$;
revoke all on function internal.invitee_participation_denied_for(uuid, uuid) from public, anon, authenticated;

create or replace function internal.invitee_participation_denied(p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select internal.invitee_participation_denied_for(auth.uid(), p_conversation_id);
$function$;
revoke all on function internal.invitee_participation_denied(uuid) from public, anon;
grant execute on function internal.invitee_participation_denied(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The fixture thread admits an invited person only to the conversation they were invited to.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.can_access_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- NOTHING ASKED, NOTHING ANSWERED. With both identifiers null there is no fixture conversation
  -- under discussion, so the honest answer is false. Without this line the site branch below fires
  -- on a question about nothing, and because fixture_messages_select_scoped evaluates
  -- can_access_any_conversation as its FIRST term on every row, that "yes" reaches rows belonging
  -- to team, direct and safeguarding threads -- exactly the blanket read J.10 line 511 removes,
  -- arriving through the back of the same policy it was removed from the front of.
  --
  -- It is also where the slice's read-path cost was going: EXPLAIN on a 300-message team
  -- conversation showed every row paying a full capability decision to answer a question with no
  -- subject. The guard is one boolean and it removes that entirely.
  select (p_fixture_id is not null or p_fixture_request_id is not null) and (
    internal.has_site_capability('site.messages.moderate')
    or (p_fixture_id is not null and exists (
      select 1 from public.fixtures f
      where f.conversation_id = (select conversation_id from public.fixtures where id = p_fixture_id)
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = f.owning_team_id), f.owning_team_id, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = f.opponent_team_id), f.opponent_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club',
                             (select club_id from public.teams where id = f.owning_team_id), null, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club',
                                  (select club_id from public.teams where id = f.opponent_team_id), null, null)))
    ))
    or (p_fixture_request_id is not null and exists (
      select 1 from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
      where r.id = p_fixture_request_id
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = r.requesting_team_id), r.requesting_team_id, null)
             or (r.target_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = r.target_team_id), r.target_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club', g.requesting_club_id, null, null)
             or (g.opponent_club_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club', g.opponent_club_id, null, null)))
    ))
    -- KEPT, and its absence was a bug in the first draft of this function. Someone explicitly added
    -- to a conversation by public.add_fixture_conversation_participant reaches it because they were
    -- invited to, not because of any capability they hold -- a referee or a neutral-ground contact
    -- has no club or team standing here at all. Rewriting the capability branches quietly removed
    -- this one, which would have locked every named participant out of the thread they were added
    -- to. The table is empty in development, so nothing failed; the performance work is what put
    -- the old body side by side with the new one and made the missing branch visible.
    --
    -- This is not new invitation machinery and does not touch D-S4-2: the table, both RPCs and this
    -- branch all predate Slice 4 and are restored exactly as they were.
    or (auth.uid() is not null and exists (
      select 1 from public.fixture_conversation_participants p
      where p.user_id = auth.uid()
        and ((p_fixture_id is not null
              -- An invitation is to a CONVERSATION (20270764000000): it admits to this fixture's thread while that is
              -- the conversation it was given for -- whichever fixture of the pair (a mirror) it was given through --
              -- and never to the conversation a new opponent starts.
              and p.conversation_id = (select f.conversation_id from public.fixtures f where f.id = p_fixture_id)
              -- an invitation is honoured only for a live session, and never against an explicit withhold
              and internal.session_ok()
              and not internal.invitee_participation_denied(p.conversation_id))
             or (p_fixture_request_id is not null and p.fixture_request_id = p_fixture_request_id))
    )));
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The earlier conversation admits the people invited into it, alongside the sides it was between. Revocation deletes
-- the invitation, so it ends this too; a dead session, an inactive account or an explicit withhold is refused --
-- including where a definer lookup (the storage policy's file check) is not covered by the tables' session gate.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.is_fixture_conversation_party(p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p_conversation_id is not null and (
    internal.has_site_capability('site.messages.moderate')
    or exists (
      select 1 from internal.fixture_conversation_parties pt
      join public.teams t on t.id = pt.team_id
      where pt.conversation_id = p_conversation_id
        and (internal.can('messaging.fixture_conversation.participate', 'team', t.club_id, t.id, null)
             or internal.can('messaging.fixture_conversation.participate', 'club', t.club_id, null, null))
    )
    or (auth.uid() is not null
        and internal.session_ok()
        and not internal.invitee_participation_denied(p_conversation_id)
        and exists (
          select 1 from public.fixture_conversation_participants p
          where p.conversation_id = p_conversation_id and p.user_id = auth.uid()
        ))
  );
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- A new message notifies an invited person only in the conversation they were invited to.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.notify_fixture_message_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fixture public.fixtures;
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_cc public.club_conversations;
  v_sender_name text;
  v_snippet text;
begin
  -- A SYSTEM NOTE IS NOT A MESSAGE. The change it records has already sent its own, specific
  -- notification; announcing the note as a "new message" as well told everybody twice.
  if coalesce(new.kind, 'message') = 'system_event' then
    return new;
  end if;

  select coalesce(p.first_name || ' ' || p.surname, 'Someone') into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  v_snippet := case
    when coalesce(btrim(new.body), '') = '' and new.content_type = 'image' then 'Sent a photo'
    when new.content_type = 'audio' then 'Sent a voice note'
    when coalesce(btrim(new.body), '') = '' then 'Sent an attachment'
    else '“' || left(btrim(new.body), 140) || case when length(btrim(new.body)) > 140 then '…' else '' end || '”'
  end;

  if new.fixture_id is not null then
    select * into v_fixture from public.fixtures where id = new.fixture_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · %s\n%s', v_sender_name, coalesce(internal.fixture_notice_label(new.fixture_id), 'a fixture'), v_snippet),
      jsonb_build_object('fixture_id', new.fixture_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      join public.teams t on t.club_id = cm.club_id
      where t.id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_id = new.fixture_id
        and p.conversation_id is not distinct from new.conversation_id
        and not internal.invitee_participation_denied_for(p.user_id, new.conversation_id)
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_id = new.fixture_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );

  elsif new.fixture_request_id is not null then
    select * into v_req from public.fixture_requests where id = new.fixture_request_id;
    select * into v_group from public.fixture_request_groups where id = v_req.group_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · a fixture request\n%s', v_sender_name, v_snippet),
      jsonb_build_object('fixture_request_id', new.fixture_request_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_req.requesting_team_id, v_req.target_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      where cm.club_id in (v_group.requesting_club_id, v_group.opponent_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_request_id = new.fixture_request_id
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_request_id = new.fixture_request_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );

  elsif new.club_conversation_id is not null then
    select * into v_cc from public.club_conversations where id = new.club_conversation_id;

    -- Only relevant while the conversation is actually usable -- the
    -- pending-state first message and the accepted system event both fire
    -- this trigger too, but "you have a new message" would be a strange
    -- thing to tell someone about their own just-sent first message
    -- (already covered by the dedicated club_message_request_received
    -- notification) or about a system event they'll see the moment they
    -- open the now-accepted conversation.
    if v_cc.status = 'accepted' and new.kind = 'message' then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct cm.user_id, 'new_fixture_message', 'New message',
        format('%s sent a club message.', v_sender_name),
        jsonb_build_object('club_conversation_id', new.club_conversation_id, 'message_id', new.id)
      from public.club_memberships cm
      where cm.club_id in (v_cc.requesting_club_id, v_cc.recipient_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        and cm.user_id <> new.sender_user_id;
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Invitation rows are visible as their conversation is: the current conversation's to its current readers, an
-- earlier one's to that conversation's own parties -- never an old invitee list to a new opponent.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists fixture_conversation_participants_select on public.fixture_conversation_participants;
create policy fixture_conversation_participants_select on public.fixture_conversation_participants
for select
using (
  (fixture_request_id is not null and internal.can_access_fixture_conversation(null, fixture_request_id))
  or (fixture_id is not null and internal.fixture_message_readable(fixture_id, null, null, conversation_id))
);

-- ---------------------------------------------------------------------------------------------------------------------
-- When two threads of one opposing pair are merged (757's merge, if it is ever run again), an invitation follows its
-- conversation into the merged one; an opposition change (no merge flag) never moves it.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function internal.carry_invitations_through_merge()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if current_setting('ovalball.conversation_merge', true) is distinct from 'on'
     or new.conversation_id is not distinct from old.conversation_id then
    return new;
  end if;
  delete from public.fixture_conversation_participants p
   where p.fixture_id = new.id and p.conversation_id = old.conversation_id
     and exists (select 1 from public.fixture_conversation_participants q
                  where q.fixture_id = new.id and q.conversation_id = new.conversation_id and q.user_id = p.user_id);
  update public.fixture_conversation_participants
     set conversation_id = new.conversation_id
   where fixture_id = new.id and conversation_id = old.conversation_id;
  return new;
end;
$function$;
revoke all on function internal.carry_invitations_through_merge() from public, anon, authenticated;

-- ...and when the merge moves a conversation's messages and no fixture uses that conversation any more (history kept
-- with an earlier opponent of a fixture that left it), its invitations follow the messages.
create or replace function internal.carry_invitations_with_merged_messages()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if current_setting('ovalball.conversation_merge', true) is distinct from 'on'
     or old.conversation_id is null or new.conversation_id is not distinct from old.conversation_id
     or exists (select 1 from public.fixtures f where f.conversation_id = old.conversation_id) then
    return new;
  end if;
  delete from public.fixture_conversation_participants p
   where p.conversation_id = old.conversation_id
     and exists (select 1 from public.fixture_conversation_participants q
                  where q.fixture_id = p.fixture_id and q.conversation_id = new.conversation_id and q.user_id = p.user_id);
  update public.fixture_conversation_participants
     set conversation_id = new.conversation_id
   where conversation_id = old.conversation_id;
  return new;
end;
$function$;
revoke all on function internal.carry_invitations_with_merged_messages() from public, anon, authenticated;

drop trigger if exists carry_invitations_with_merged_messages on public.fixture_messages;
create trigger carry_invitations_with_merged_messages
  after update of conversation_id on public.fixture_messages
  for each row execute function internal.carry_invitations_with_merged_messages();

drop trigger if exists carry_invitations_through_merge on public.fixtures;
create trigger carry_invitations_through_merge
  after update of conversation_id on public.fixtures
  for each row execute function internal.carry_invitations_through_merge();

-- The conversation-level check (realtime topics, marking a conversation read) admits its invitees too.
CREATE OR REPLACE FUNCTION internal.can_access_conversation(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select internal.has_site_capability('site.messages.moderate')
    -- An invitee of this conversation, while a fixture is using it (20270764000000).
    or (auth.uid() is not null
        and internal.session_ok()
        and not internal.invitee_participation_denied(p_conversation_id)
        and exists (select 1 from public.fixture_conversation_participants p
                     where p.conversation_id = p_conversation_id and p.user_id = auth.uid())
        and exists (select 1 from public.fixtures f where f.conversation_id = p_conversation_id))
    or exists (
      select 1 from public.fixtures f
      where f.conversation_id = p_conversation_id
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = f.owning_team_id), f.owning_team_id, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = f.opponent_team_id), f.opponent_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club',
                             (select club_id from public.teams where id = f.owning_team_id), null, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club',
                                  (select club_id from public.teams where id = f.opponent_team_id), null, null)))
    );
$function$;

-- The people list names this conversation's invitees, not every invitee the fixture has ever had.
CREATE OR REPLACE FUNCTION public.conversation_people(p_conversation_id uuid DEFAULT NULL::uuid, p_fixture_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, first_name text, surname text, avatar_storage_path text, last_active_at timestamp with time zone, club_id uuid, club_name text, role_kind text, role_key text, left_conversation boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club_conversation uuid;
  v_fixture uuid;
  v_clubs uuid[] := '{}';
  v_teams uuid[] := '{}';
begin
  perform internal.require_live_session();

  if p_fixture_request_id is not null then
    if not internal.can_access_fixture_conversation(null, p_fixture_request_id) then
      return;
    end if;
    select array_remove(array[r.requesting_team_id, r.target_team_id], null),
           array_remove(array[g.requesting_club_id, g.opponent_club_id], null)
      into v_teams, v_clubs
      from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
     where r.id = p_fixture_request_id;
  elsif p_conversation_id is not null then
    select cc.id into v_club_conversation from public.club_conversations cc where cc.id = p_conversation_id;
    if v_club_conversation is not null then
      if not internal.can_access_any_conversation(null, null, v_club_conversation) then
        return;
      end if;
      select array_remove(array[cc.requesting_club_id, cc.recipient_club_id], null)
        into v_clubs
        from public.club_conversations cc
       where cc.id = v_club_conversation;
    else
      -- A fixture thread is keyed by the conversation both mirror rows share; either row answers access.
      select f.id into v_fixture from public.fixtures f where f.conversation_id = p_conversation_id order by f.id limit 1;
      if v_fixture is null or not internal.can_access_fixture_conversation(v_fixture, null) then
        return;
      end if;
      select coalesce(array_agg(distinct t.team_id), '{}')
        into v_teams
        from public.fixtures f
        cross join lateral (values (f.owning_team_id), (f.opponent_team_id)) as t(team_id)
       where f.conversation_id = p_conversation_id
         and t.team_id is not null;
    end if;
  else
    return;
  end if;

  -- The teams' clubs complete the parties, as the device always derived them.
  select coalesce(array_agg(distinct c), '{}')
    into v_clubs
    from unnest(v_clubs || coalesce((select array_agg(t.club_id) from public.teams t where t.id = any(v_teams)), '{}')) as c
   where c is not null;

  return query
  with officials as (
    -- The club's officials: the canonical club-scoped assignments, at a club this conversation is between.
    select distinct on (ra.user_id, ra.club_id)
           ra.user_id, ra.club_id, 'club'::text as role_kind, ra.role_key, 1 as rank
      from public.role_assignments ra
      join public.club_memberships m on m.id = ra.membership_id and m.status = 'active'
     where ra.club_id = any(v_clubs)
       and ra.team_id is null
       and ra.state = 'ACTIVE'
       and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY')
     order by ra.user_id, ra.club_id, case ra.role_key when 'CLUB_ADMIN' then 1 else 2 end
  ), staff as (
    -- The teams' officials, through the canonical team-role projection (most senior role first).
    select distinct on (tra.user_id)
           tra.user_id, tra.club_id, 'team'::text, tra.role_key, 2
      from internal.team_role_assignments tra
      join public.club_memberships m on m.id = tra.membership_id and m.status = 'active'
     where tra.team_id = any(v_teams)
     order by tra.user_id, case tra.role_key when 'TEAM_ADMINISTRATION' then 1 when 'TEAM_MANAGER' then 2 else 3 end
  ), added as (
    select p.user_id,
           (select m.club_id from public.club_memberships m
             where m.user_id = p.user_id and m.club_id = any(v_clubs) and m.status = 'active'
             order by m.created_at limit 1),
           'added'::text, null::text, 3
      from public.fixture_conversation_participants p
     where (v_fixture is not null and p.conversation_id = p_conversation_id)
        or (p_fixture_request_id is not null and p.fixture_request_id = p_fixture_request_id)
  ), everyone as (
    select distinct on (x.user_id) x.user_id, x.club_id, x.role_kind, x.role_key
      from (select * from officials union all select * from staff union all select * from added) x
     order by x.user_id, x.rank
  )
  select e.user_id,
         pr.first_name,
         pr.surname,
         pr.avatar_storage_path,
         pr.last_active_at,
         e.club_id,
         cd.name,
         e.role_kind,
         e.role_key,
         exists (
           select 1 from public.fixture_conversation_subscriptions s
            where s.user_id = e.user_id
              and s.left_at is not null
              and ((v_fixture is not null and s.fixture_id in (select f.id from public.fixtures f where f.conversation_id = p_conversation_id))
                   or (p_fixture_request_id is not null and s.fixture_request_id = p_fixture_request_id))
         )
    from everyone e
    join public.profiles pr on pr.id = e.user_id
    left join public.clubs cl on cl.id = e.club_id
    left join public.club_directory cd on cd.id = cl.directory_id;
end;
$function$;


/** A fixture and its mirror rows (each side's own record of the same match), for revocation's reach. */
create or replace function internal.fixture_and_mirrors(p_fixture_id uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p_fixture_id
  union
  select f.mirror_fixture_id from public.fixtures f where f.id = p_fixture_id and f.mirror_fixture_id is not null
  union
  select f.id from public.fixtures f where f.mirror_fixture_id = p_fixture_id;
$function$;
revoke all on function internal.fixture_and_mirrors(uuid) from public, anon, authenticated;

-- Revocation reaches every invitation the person holds through this fixture, and is possible for a previous opponent's invitee.
CREATE OR REPLACE FUNCTION public.remove_fixture_conversation_participant(p_fixture_id uuid, p_fixture_request_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
  v_target_club_id uuid;
  v_target_display text;
  v_actor_display text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use Leave Conversation to remove yourself.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to manage participants in this conversation.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select c.club_id into v_my_club_id
  from public.club_memberships c
  where c.user_id = auth.uid() and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  if v_my_club_id is null then
    select t.club_id into v_my_club_id
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;
  if v_my_club_id is null and not internal.has_site_capability('site.fixtures.support') then
    raise exception 'You do not have a club to manage participants from on this fixture.' using errcode = '42501';
  end if;

  select c.club_id into v_target_club_id
  from public.club_memberships c
  where c.user_id = p_user_id and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  -- A previous opponent's invitee (invited to an EARLIER conversation of this fixture, not to its current one) belongs to
  -- no current side; the current sides may still revoke them, or that invitation could never be withdrawn.
  if (v_target_club_id is null or (v_target_club_id <> v_my_club_id and not internal.has_site_capability('site.fixtures.support')))
     and not (p_fixture_id is not null
              and exists (select 1 from public.fixture_conversation_participants p
                           where p.fixture_id in (select internal.fixture_and_mirrors(p_fixture_id)) and p.user_id = p_user_id)
              and not exists (select 1 from public.fixture_conversation_participants p
                               where p.fixture_id in (select internal.fixture_and_mirrors(p_fixture_id)) and p.user_id = p_user_id
                                 and p.conversation_id = (select f.conversation_id from public.fixtures f where f.id = p_fixture_id))) then
    raise exception 'You can only manage participants from your own club''s side of this fixture.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    insert into public.fixture_conversation_subscriptions (fixture_id, user_id, left_at)
    values (p_fixture_id, p_user_id, now())
    on conflict (fixture_id, user_id) where fixture_id is not null
      do update set left_at = now(), updated_at = now();
  else
    insert into public.fixture_conversation_subscriptions (fixture_request_id, user_id, left_at)
    values (p_fixture_request_id, p_user_id, now())
    on conflict (fixture_request_id, user_id) where fixture_request_id is not null
      do update set left_at = now(), updated_at = now();
  end if;

  -- REVOCATION OVERRIDES HISTORY: every invitation the person holds through this fixture -- its current conversation and
  -- every earlier one, including the same conversations reached through a mirror fixture -- and the message excerpts
  -- their notifications stored.
  if p_fixture_id is not null then
    with convs as (
      select p.conversation_id from public.fixture_conversation_participants p
       where p.fixture_id in (select internal.fixture_and_mirrors(p_fixture_id)) and p.user_id = p_user_id and p.conversation_id is not null
      union
      select f.conversation_id from public.fixtures f where f.id = p_fixture_id and f.conversation_id is not null
    )
    delete from public.notifications n
     where n.user_id = p_user_id and n.type = 'new_fixture_message'
       and (n.data ->> 'fixture_id') in (
         select f.id::text from public.fixtures f where f.id = p_fixture_id or f.conversation_id in (select conversation_id from convs)
         union
         select p.fixture_id::text from public.fixture_conversation_participants p
          where p.user_id = p_user_id and p.conversation_id in (select conversation_id from convs));
    with convs as (
      select p.conversation_id from public.fixture_conversation_participants p
       where p.fixture_id in (select internal.fixture_and_mirrors(p_fixture_id)) and p.user_id = p_user_id and p.conversation_id is not null
      union
      select f.conversation_id from public.fixtures f where f.id = p_fixture_id and f.conversation_id is not null
    )
    delete from public.fixture_conversation_participants p
     where p.user_id = p_user_id
       and (p.fixture_id in (select internal.fixture_and_mirrors(p_fixture_id)) or p.conversation_id in (select conversation_id from convs));
  else
    delete from public.fixture_conversation_participants
    where user_id = p_user_id and fixture_request_id = p_fixture_request_id;
  end if;

  select p.first_name || ' ' || p.surname into v_target_display from public.profiles p where p.id = p_user_id;
  select p.first_name || ' ' || p.surname into v_actor_display from public.profiles p where p.id = auth.uid();
  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s removed %s from the conversation', v_actor_display, v_target_display), 'system_event');
end;
$function$;

-- An earlier conversation is read-only: no tombstoning there either.
CREATE OR REPLACE FUNCTION public.soft_delete_own_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sender uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select sender_user_id into v_sender from public.fixture_messages where id = p_message_id;
  if v_sender is null then
    raise exception 'Message not found.';
  end if;
  if v_sender <> auth.uid() then
    raise exception 'You can only delete your own messages.' using errcode = '42501';
  end if;
  -- An earlier conversation of a fixture is read-only for everyone, its authors included (20270764000000).
  if exists (select 1 from public.fixture_messages m
              where m.id = p_message_id and m.fixture_id is not null
                and m.club_conversation_id is null and m.team_conversation_id is null
                and m.safeguarding_conversation_id is null and m.direct_conversation_id is null and m.announcement_id is null
                and not internal.fixture_message_in_current_thread(m.fixture_id, m.conversation_id)) then
    raise exception 'That conversation is closed.' using errcode = '42501';
  end if;

  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'sender'
  where id = p_message_id and deleted_at is null;
end;
$function$;
