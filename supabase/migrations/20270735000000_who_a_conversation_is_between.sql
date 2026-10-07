-- =====================================================================================================
-- WHO A CONVERSATION IS BETWEEN, ANSWERED BY THE SERVER
--
-- A fixture, request or club conversation belongs to two clubs and, for a fixture or a request, to the two
-- teams playing. Its People list and the role beside every message were assembled on the device from
-- membership and team-role rows a person may read only for their own club, and mostly only their own row. So
-- a coach opening the thread with the other club saw herself and nobody else: not the other club's coach who
-- had just written, not even her own Club Admin. Every message from the other side was labelled "Member" of
-- "Ovalball" (integration audit, Journey 2: Message Staff).
--
-- Roles are read from the CANONICAL assignments (`role_assignments`, `internal.team_role_assignments`) and
-- returned as canonical role keys, which the clients name with the one role vocabulary -- never the legacy
-- membership role column or team-permission view Slice 10 is retiring.
--
-- `conversation_people` answers it once, for anybody the conversation admits
-- (`internal.can_access_fixture_conversation` / `internal.can_access_any_conversation`, unchanged): the
-- Club Admins and Fixture Secretaries of the clubs party to it, the officials of the teams party to it, and
-- anybody explicitly added -- the same people the device was trying to list, now read past the RLS that
-- hid them. Somebody who left is still returned, marked, because a message they wrote earlier still needs
-- its name; the People list leaves them out. A caller the conversation does not admit gets nothing, never
-- an error that would confirm the fixture exists.
-- =====================================================================================================

create or replace function public.conversation_people(p_conversation_id uuid default null, p_fixture_request_id uuid default null)
returns table (
  user_id uuid,
  first_name text,
  surname text,
  avatar_storage_path text,
  last_active_at timestamptz,
  club_id uuid,
  club_name text,
  role_kind text,
  role_key text,
  left_conversation boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
     where (v_fixture is not null and p.fixture_id in (select f.id from public.fixtures f where f.conversation_id = p_conversation_id))
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

revoke all on function public.conversation_people(uuid, uuid) from public, anon;
grant execute on function public.conversation_people(uuid, uuid) to authenticated;
comment on function public.conversation_people(uuid, uuid) is
  'Who a fixture, request or club conversation is between -- officials of its clubs, officials of its teams and anybody added -- with names and roles, for anybody the conversation admits. Nothing for anybody else.';
