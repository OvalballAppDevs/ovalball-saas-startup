-- Unifies the two-sided fixture conversation. A confirmed fixture is ONE
-- sporting arrangement recorded as two mirror-linked rows (one per club,
-- for owning_team_id/RLS/stats reasons that predate this migration and are
-- staying) -- but until now fixture_messages.fixture_id pinned every
-- message to whichever SPECIFIC row the RPC/insert happened to target, so
-- each club only ever saw messages generated through ITS OWN row. Data
-- (kickoff/pitch/result) was already correctly mirror-synced; only the
-- conversation itself forked into two realities.
--
-- Fix: a stable conversation_id shared by both rows of a mirror pair
-- (a single row's own id for anything with no mirror). fixture_messages
-- gets the same conversation_id, auto-populated by trigger from whichever
-- fixture_id the message was actually inserted against -- so every
-- existing insert call site (there are many, across many migrations)
-- needs zero changes. The one shared authorization primitive,
-- internal.can_access_fixture_conversation(), is redefined to resolve
-- access via conversation_id membership instead of the single row --
-- every downstream consumer (fixture_messages RLS, attachments, document
-- shares, contact-card shares, message policies, admin overview) inherits
-- the fix for free, since they all already call through this one function.

alter table public.fixtures add column conversation_id uuid not null default gen_random_uuid();

comment on column public.fixtures.conversation_id is
  'The ONE conversation identity for this fixture -- shared by both rows of a mirror-linked pair (never two realities), a row''s own id-derived default when there is no mirror (external/unresolved opponent). Never rewritten after creation.';

-- Defends the invariant regardless of HOW mirror_fixture_id gets set --
-- accept_fixture_request() already mints one conversation_id and assigns
-- it explicitly to both rows it creates, but any OTHER path that links
-- two rows (a raw two-step "insert, then update mirror_fixture_id on each
-- side" -- the shape every earlier migration's own test fixtures already
-- use) would otherwise leave each row with its own independent default.
-- This trigger makes the two always converge onto whichever side already
-- has a real conversation_id at the moment mirror_fixture_id is set, so
-- the invariant holds no matter which order the two rows are created or
-- linked in.
create or replace function internal.sync_fixture_conversation_id()
returns trigger
language plpgsql
as $$
declare
  v_mirror_conversation_id uuid;
begin
  if new.mirror_fixture_id is not null then
    select conversation_id into v_mirror_conversation_id from public.fixtures where id = new.mirror_fixture_id;
    if v_mirror_conversation_id is not null then
      new.conversation_id := v_mirror_conversation_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger sync_fixture_conversation_id
  before insert or update of mirror_fixture_id on public.fixtures
  for each row execute function internal.sync_fixture_conversation_id();

-- Backfill: unify existing mirror pairs onto one deterministic value (the
-- lexically-smaller of the two ids -- an existing id is a perfectly good
-- conversation_id, no need to mint a fresh one during backfill).
update public.fixtures f
set conversation_id = least(f.id, f.mirror_fixture_id)
where f.mirror_fixture_id is not null;

create index fixtures_conversation_id_idx on public.fixtures (conversation_id);

alter table public.fixture_messages add column conversation_id uuid;

update public.fixture_messages fm
set conversation_id = f.conversation_id
from public.fixtures f
where fm.fixture_id = f.id and fm.conversation_id is null;

create index fixture_messages_conversation_id_idx on public.fixture_messages (conversation_id) where conversation_id is not null;

-- Every existing (and future) insert into fixture_messages that sets
-- fixture_id keeps working completely unchanged -- this fills in the
-- shared conversation_id automatically, before RLS WITH CHECK evaluates it
-- (Postgres runs BEFORE ROW triggers, then constraint/RLS checks, for the
-- same INSERT).
create or replace function internal.set_fixture_message_conversation_id()
returns trigger
language plpgsql
as $$
begin
  if new.fixture_id is not null and new.conversation_id is null then
    select conversation_id into new.conversation_id from public.fixtures where id = new.fixture_id;
  end if;
  return new;
end;
$$;

create trigger set_fixture_message_conversation_id
  before insert on public.fixture_messages
  for each row execute function internal.set_fixture_message_conversation_id();

-- ============================================================
-- The shared authorization primitive: redefined so the fixture_id branch
-- resolves via conversation_id (any row sharing it), not the single row
-- named in p_fixture_id. Signature unchanged -- every existing caller
-- (fixture_messages RLS, fixture_message_attachments, document/contact-card
-- shares, message_policies, admin message overview) inherits this for free.
-- ============================================================

create or replace function internal.can_access_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_site_admin()
    or (p_fixture_id is not null and exists (
      select 1 from public.fixtures f
      where f.conversation_id = (select conversation_id from public.fixtures where id = p_fixture_id)
        and (internal.can_manage_team(f.owning_team_id)
             or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id))
             or internal.can_manage_club_fixtures((select club_id from public.teams where id = f.owning_team_id))
             or (f.opponent_team_id is not null
                 and internal.can_manage_club_fixtures((select club_id from public.teams where id = f.opponent_team_id))))
    ))
    or (p_fixture_request_id is not null and exists (
      select 1 from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
      where r.id = p_fixture_request_id
        and (internal.can_manage_team(r.requesting_team_id)
             or (r.target_team_id is not null and internal.can_manage_team(r.target_team_id))
             or internal.can_manage_club_fixtures(g.requesting_club_id)
             or (g.opponent_club_id is not null and internal.can_manage_club_fixtures(g.opponent_club_id)))
    ));
$$;

comment on function internal.can_access_fixture_conversation(uuid, uuid) is
  'True for a team official or club-level official of EITHER side of the fixture''s conversation (resolved via conversation_id, so both mirror rows of one real fixture always agree), or either side of a still-negotiating request. The one shared authorization primitive every fixture-conversation-adjacent policy (messages, attachments, document/contact-card shares, admin overview) calls through.';

-- fixture_messages' own SELECT policy already calls can_access_fixture_
-- conversation(fixture_id, fixture_request_id) -- re-declared here only so
-- this migration is the readable source of truth for the behavior change;
-- the policy body itself is identical to before, the function it calls is
-- what changed.
drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages for select
  using (internal.can_access_fixture_conversation(fixture_id, fixture_request_id));

-- ============================================================
-- accept_fixture_request: re-declared with the SAME signature purely to
-- mint ONE conversation_id and assign it to both created rows explicitly
-- (rather than relying on two independent gen_random_uuid() defaults,
-- which would give each row its own conversation_id and defeat the whole
-- point). Every other line unchanged from 20260902130000.
-- ============================================================

create or replace function public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_mirror_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_conversation_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if v_req.requesting_team_id is not null then
    v_requesting_team_id := v_req.requesting_team_id;
  else
    select min(team_id) into v_requesting_team_id from public.scheduling_group_members where group_id = v_req.requesting_scheduling_group_id;
    if v_requesting_team_id is null then
      raise exception 'This shared calendar has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      elsif v_eligible_member_count = 1 then
        v_target_team_id := v_auto_resolved_team_id;
      else
        raise exception 'More than one team in this shared calendar is eligible -- select the real team before accepting.' using errcode = 'P0001';
      end if;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
  end if;

  if v_target_team_id is not null then
    select club_id into v_target_club_id from public.teams where id = v_target_team_id;
  else
    v_target_club_id := v_group.opponent_club_id;
  end if;

  if not (internal.is_site_admin()
          or (v_target_team_id is not null and internal.can_manage_team(v_target_team_id))
          or (v_target_club_id is not null and internal.can_manage_club_fixtures(v_target_club_id))) then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  v_requesting_club_venue := case v_req.venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_req.venue_preference
    when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end;

  v_conversation_id := gen_random_uuid();

  insert into public.fixtures (
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    created_by, updated_by, conversation_id
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_req.created_by, auth.uid(), v_conversation_id
  )
  returning id into v_fixture_id;

  if v_target_team_id is not null then
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id,
      created_by, updated_by, conversation_id
    )
    select v_target_team_id, v_req.target_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_target_venue, 'Booked',
      cd.name, cd.id, v_requesting_team_id,
      auth.uid(), auth.uid(), v_conversation_id
    from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id
    returning id into v_mirror_fixture_id;

    update public.fixtures set mirror_fixture_id = v_mirror_fixture_id where id = v_fixture_id;
    update public.fixtures set mirror_fixture_id = v_fixture_id where id = v_mirror_fixture_id;
  end if;

  update public.fixture_requests
  set status = 'accepted', target_team_id = v_target_team_id,
      resulting_fixture_id = v_fixture_id, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_requesting_team_id;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;

-- ============================================================
-- Live refresh: broadcast-from-database. Every fixture_messages insert
-- (human message, or any of the many system events -- pitch/kickoff/
-- result/amendment/fold/etc.) pushes a lightweight event onto the SAME
-- private Realtime channel already used for presence (topic
-- presence:f:<conversation_id>) -- both sides of a mirror pair already
-- join that one channel together since it's keyed by conversation_id, not
-- a single row. The client payload carries no message content (the
-- channel is authorized by realtime.messages RLS same as presence, but
-- keeping the broadcast payload minimal means there is nothing sensitive
-- to leak even if that were ever misconfigured) -- the client's job on
-- receiving it is simply to refetch, never to trust the payload as the
-- source of truth.
-- ============================================================

create or replace function internal.broadcast_fixture_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is not null then
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'kind', new.kind),
      'fixture_message_inserted',
      'presence:f:' || new.conversation_id::text,
      true
    );
  end if;
  return new;
end;
$$;

create trigger broadcast_fixture_message
  after insert on public.fixture_messages
  for each row execute function internal.broadcast_fixture_message();

-- ============================================================
-- Presence/broadcast channel topic now carries conversation_id, not a raw
-- fixture row id -- so both sides of a mirror pair join the SAME private
-- Realtime channel (previously presence:f:<row-id> forked exactly like
-- the messages did). can_access_conversation is a new, dedicated check
-- (distinct from can_access_fixture_conversation, which takes a real
-- fixtures.id and resolves conversation_id FROM it) since the topic now
-- carries the conversation_id itself, not an id to look one up from.
-- ============================================================

create or replace function internal.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_site_admin()
    or exists (
      select 1 from public.fixtures f
      where f.conversation_id = p_conversation_id
        and (internal.can_manage_team(f.owning_team_id)
             or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id))
             or internal.can_manage_club_fixtures((select club_id from public.teams where id = f.owning_team_id))
             or (f.opponent_team_id is not null
                 and internal.can_manage_club_fixtures((select club_id from public.teams where id = f.opponent_team_id))))
    );
$$;

grant execute on function internal.can_access_conversation(uuid) to authenticated;

create or replace function internal.can_access_fixture_presence_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
begin
  v_parts := regexp_split_to_array(p_topic, ':');
  if array_length(v_parts, 1) <> 3 or v_parts[1] <> 'presence' then
    return false;
  end if;
  if v_parts[2] = 'f' then
    return internal.can_access_conversation(v_parts[3]::uuid);
  elsif v_parts[2] = 'r' then
    return internal.can_access_fixture_conversation(null, v_parts[3]::uuid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;
