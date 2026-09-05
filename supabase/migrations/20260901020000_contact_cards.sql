-- Fixture-conversation Contact Cards: an intentional, one-at-a-time
-- self-disclosure of a caller's own name/real-world club role/telephone
-- number into a fixture conversation they're already authorized in --
-- never a directory of every participant's phone number, never something
-- another user can construct on someone else's behalf.

alter table public.profiles add column phone_number text;

create table public.fixture_message_contact_cards (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.fixture_messages(id) on delete cascade,
  shared_by_user_id uuid not null references public.profiles(id),
  display_name_snapshot text not null,
  role_snapshot text not null,
  club_name_snapshot text not null,
  team_name_snapshot text,
  telephone_snapshot text not null,
  shared_at timestamptz not null default now()
);

comment on table public.fixture_message_contact_cards is
  'A deliberate snapshot, not a live reference -- if the sharer later changes their profile phone number, historic cards must keep showing what was actually shared at the time (snapshot semantics, matching the brief). Only fields the sharer intentionally disclosed are copied here -- never DOB/address/email/auth data.';

alter table public.fixture_message_contact_cards enable row level security;

-- Same conversation-readability boundary as fixture_message_document_refs
-- -- if you can read the message, you can read the card attached to it.
create policy fixture_message_contact_cards_select on public.fixture_message_contact_cards for select
  using (
    exists (
      select 1 from public.fixture_messages m
      where m.id = message_id and internal.can_access_fixture_conversation(m.fixture_id, m.fixture_request_id)
    )
  );

-- Writes are RPC-only (share_fixture_contact_card below) -- no insert/
-- update/delete policy for any role, so even a Site Admin cannot construct
-- a card containing someone else's phone number via a direct write.

-- ============================================================
-- share_fixture_contact_card: resolves the caller's OWN identity and
-- real-world club/team role entirely server-side from auth.uid() --
-- never accepts a target user, a role, or a phone number as input, so a
-- caller can never spoof another person's card or invent their own role.
-- ============================================================

create or replace function public.share_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
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

  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select p.first_name || ' ' || p.surname, p.phone_number into v_display_name, v_phone
  from public.profiles p where p.id = auth.uid();
  if v_phone is null or trim(v_phone) = '' then
    raise exception 'Your profile does not have a telephone number yet.' using errcode = 'P0001';
  end if;

  -- Team-scoped role first (Team Admin/Coach/Manager on either side).
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

  -- Else club-wide role (Club Admin/Fixture Secretary at either club).
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

revoke execute on function public.share_fixture_contact_card(uuid, uuid) from public;
grant execute on function public.share_fixture_contact_card(uuid, uuid) to authenticated;
