-- Preview support for Contact Cards: the UI must show the caller a real
-- preview of their own name/role/club/team/phone and require a deliberate
-- confirm click BEFORE anything is posted (never fire-and-share on a
-- single click) -- factor the identity-resolution logic out of
-- share_fixture_contact_card into a shared, read-only internal helper so
-- the preview and the real share can never disagree.

create or replace function internal.resolve_my_fixture_contact_role(p_fixture_id uuid, p_fixture_request_id uuid)
returns table(role_label text, club_name text, team_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_role text;
  v_club_name text;
  v_team_name text;
begin
  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select
    case tp.permission when 'team_admin' then 'Team Admin' when 'coach' then 'Coach' when 'manager' then 'Manager' end,
    t.display_name,
    cd.name
  into v_role, v_team_name, v_club_name
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
  join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
  join public.clubs c on c.id = t.club_id
  join public.club_directory cd on cd.id = c.directory_id
  limit 1;

  if v_role is null then
    select
      case cm.role when 'CLUB_ADMIN' then 'Club Admin' when 'FIXTURE_SECRETARY' then 'Fixture Secretary' end,
      cd.name
    into v_role, v_club_name
    from public.club_memberships cm
    join public.clubs c on c.id = cm.club_id
    join public.club_directory cd on cd.id = c.directory_id
    where cm.user_id = auth.uid() and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      and c.id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
    limit 1;
  end if;

  return query select v_role, v_club_name, v_team_name;
end;
$$;

create or replace function public.share_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_display_name text;
  v_role text;
  v_club_name text;
  v_team_name text;
  v_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  select p.first_name || ' ' || p.surname, p.phone_number into v_display_name, v_phone
  from public.profiles p where p.id = auth.uid();
  if v_phone is null or trim(v_phone) = '' then
    raise exception 'Your profile does not have a telephone number yet.' using errcode = 'P0001';
  end if;

  select role_label, club_name, team_name into v_role, v_club_name, v_team_name
  from internal.resolve_my_fixture_contact_role(p_fixture_id, p_fixture_request_id);
  if v_role is null then
    raise exception 'You do not have a club role on this fixture to share a contact card from.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s shared a contact card', v_display_name))
  returning id into v_message_id;

  insert into public.fixture_message_contact_cards
    (message_id, shared_by_user_id, display_name_snapshot, role_snapshot, club_name_snapshot, team_name_snapshot, telephone_snapshot)
  values (v_message_id, auth.uid(), v_display_name, v_role, v_club_name, v_team_name, v_phone);

  return v_message_id;
end;
$$;

-- Read-only preview -- same authorization/role resolution, but never
-- writes anything and returns the phone number for THIS caller's own
-- confirmation screen only (not stored, not shared with anyone until the
-- real share_fixture_contact_card call).
create or replace function public.preview_my_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns table(display_name text, role_label text, club_name text, team_name text, telephone text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to view this conversation.' using errcode = '42501';
  end if;

  return query
    select p.first_name || ' ' || p.surname, r.role_label, r.club_name, r.team_name, p.phone_number
    from public.profiles p
    cross join internal.resolve_my_fixture_contact_role(p_fixture_id, p_fixture_request_id) r
    where p.id = auth.uid();
end;
$$;

revoke execute on function public.share_fixture_contact_card(uuid, uuid) from public;
grant execute on function public.share_fixture_contact_card(uuid, uuid) to authenticated;
revoke execute on function public.preview_my_fixture_contact_card(uuid, uuid) from public;
grant execute on function public.preview_my_fixture_contact_card(uuid, uuid) to authenticated;
