-- Lets an existing fixture-conversation participant explicitly add a
-- fellow member of their OWN club into that specific conversation --
-- additive to the existing role-derived access (Club Admin/Fixture
-- Secretary/Team Admin/Coach/Manager), never a replacement for it, and
-- never able to reach into the opponent's club or an unrelated one.

create table public.fixture_conversation_participants (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid references public.fixtures(id),
  fixture_request_id uuid references public.fixture_requests(id),
  user_id uuid not null references public.profiles(id),
  added_by uuid not null references public.profiles(id),
  added_at timestamptz not null default now(),
  check (num_nonnulls(fixture_id, fixture_request_id) = 1)
);

comment on table public.fixture_conversation_participants is
  'Explicit, deliberate grants of conversation access on top of the normal role-derived boundary (can_access_fixture_conversation) -- someone added here can read/post in this ONE conversation, nothing else. Never grants club-wide or team-wide standing.';

-- NULLs are not guaranteed distinct for a plain UNIQUE constraint, so two
-- partial indexes (one per conversation type) are the reliable way to
-- prevent duplicate grants for the same person.
create unique index fixture_conversation_participants_fixture_user_key
  on public.fixture_conversation_participants (fixture_id, user_id) where fixture_id is not null;
create unique index fixture_conversation_participants_request_user_key
  on public.fixture_conversation_participants (fixture_request_id, user_id) where fixture_request_id is not null;

alter table public.fixture_conversation_participants enable row level security;

create policy fixture_conversation_participants_select on public.fixture_conversation_participants for select
  using (internal.can_access_fixture_conversation(fixture_id, fixture_request_id));

-- Writes are RPC-only (add_fixture_conversation_participant below) -- no
-- insert/update/delete policy for any role.

-- Extend the shared access boundary every fixture-conversation surface
-- (messages, document sharing, contact cards, presence) already uses --
-- an explicitly-added participant gets real access everywhere that
-- boundary is checked, not a second parallel permission system.
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
      where f.id = p_fixture_id
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
    ))
    or (auth.uid() is not null and exists (
      select 1 from public.fixture_conversation_participants p
      where p.user_id = auth.uid()
        and ((p_fixture_id is not null and p.fixture_id = p_fixture_id)
             or (p_fixture_request_id is not null and p.fixture_request_id = p_fixture_request_id))
    ));
$$;

-- Read-only: my own club's active members I could add -- callers with no
-- real standing on this fixture get an empty list (can_access_fixture_
-- conversation is checked first), never a directory of unrelated clubs.
create or replace function public.list_addable_club_members(p_fixture_id uuid, p_fixture_request_id uuid)
returns table(user_id uuid, name text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
begin
  if auth.uid() is null or not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    return;
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
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;

  if v_my_club_id is null then
    return;
  end if;

  return query
    select p.id, p.first_name || ' ' || p.surname
    from public.club_memberships cm
    join public.profiles p on p.id = cm.user_id
    where cm.club_id = v_my_club_id and cm.status = 'active'
    order by p.first_name, p.surname;
end;
$$;

create or replace function public.add_fixture_conversation_participant(p_fixture_id uuid, p_fixture_request_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
  v_target_display text;
  v_actor_display text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to add participants to this conversation.' using errcode = '42501';
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
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;
  if v_my_club_id is null and not internal.is_site_admin() then
    raise exception 'You do not have a club to add participants from on this fixture.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.club_memberships cm
    where cm.user_id = p_user_id and cm.club_id = v_my_club_id and cm.status = 'active'
  ) then
    raise exception 'That person is not an active member of your club.' using errcode = '42501';
  end if;

  insert into public.fixture_conversation_participants (fixture_id, fixture_request_id, user_id, added_by)
  values (p_fixture_id, p_fixture_request_id, p_user_id, auth.uid())
  on conflict do nothing;

  select p.first_name || ' ' || p.surname into v_target_display from public.profiles p where p.id = p_user_id;
  select p.first_name || ' ' || p.surname into v_actor_display from public.profiles p where p.id = auth.uid();

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s added %s to the conversation', v_actor_display, v_target_display), 'system_event');
end;
$$;

revoke execute on function public.list_addable_club_members(uuid, uuid) from public;
grant execute on function public.list_addable_club_members(uuid, uuid) to authenticated;
revoke execute on function public.add_fixture_conversation_participant(uuid, uuid, uuid) from public;
grant execute on function public.add_fixture_conversation_participant(uuid, uuid, uuid) to authenticated;
