-- Correction: "any active club member" was too broad for the addable-
-- participant picker -- parents and players (a plain BASIC_USER
-- membership, or a team_permissions row with permission = 'view_only')
-- must never be offered or addable. Only club-wide officials (Club Admin/
-- Fixture Secretary) or team officials (Team Admin/Coach/Manager) on one
-- of the fixture's own teams are real operational contacts for a fixture
-- conversation -- "mainly just coaches for that age", per the brief.

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
    select distinct p.id, p.first_name || ' ' || p.surname
    from public.club_memberships cm
    join public.profiles p on p.id = cm.user_id
    where cm.club_id = v_my_club_id and cm.status = 'active'
      and (
        cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        or exists (
          select 1 from public.team_permissions tp
          where tp.membership_id = cm.id
            and tp.permission in ('team_admin', 'coach', 'manager')
            and tp.team_id in (v_owning_team_id, v_opponent_team_id)
        )
      )
    order by 2;
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

  -- Operational contacts only -- a plain club membership (parent/player,
  -- BASIC_USER with no officiating role, or an explicit view_only team
  -- permission) is never addable, regardless of who is asking.
  if not exists (
    select 1 from public.club_memberships cm
    where cm.user_id = p_user_id and cm.club_id = v_my_club_id and cm.status = 'active'
      and (
        cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        or exists (
          select 1 from public.team_permissions tp
          where tp.membership_id = cm.id
            and tp.permission in ('team_admin', 'coach', 'manager')
            and tp.team_id in (v_owning_team_id, v_opponent_team_id)
        )
      )
  ) then
    raise exception 'Only coaches and club/fixtures officials can be added to a fixture conversation.' using errcode = '42501';
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
