-- Fixture negotiation, kept deliberately separate from `fixtures` (the
-- calendar's authoritative record): a request is a proposal that may be
-- accepted, declined, counter-proposed, cancelled, or expire without ever
-- becoming a real fixture. Accepting one creates the real fixtures row(s)
-- via accept_fixture_request() below -- fixtures itself never gains a
-- negotiation state machine of its own.
--
-- One group per date+partner negotiation a Fixture Secretary/Team Admin
-- initiates; one fixture_requests row per team within it, so "U12 A HOME,
-- U13 A AWAY, U15 B EITHER" from one multi-team ask are three independently
-- trackable, independently answerable rows, never one record standing in
-- for all three (requirement: "do not model one giant fixture record
-- representing five teams").

create table public.fixture_request_groups (
  id uuid primary key default gen_random_uuid(),
  requesting_club_id uuid not null references public.clubs(id),
  -- Same opponent-resolution shape as fixtures.{raw_opposition_text,
  -- opponent_directory_id, opponent_team_id} -- raw text always present,
  -- resolved fields populated only as far as known. opponent_club_id is
  -- null until/unless that club has activated on Ovalball; see
  -- reconcile_new_club_fixture_requests() for what happens when it does.
  raw_opponent_text text not null,
  opponent_directory_id uuid references public.club_directory(id),
  opponent_club_id uuid references public.clubs(id),
  proposed_date date not null,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fixture_request_groups is
  'One requesting club''s multi-team ask for one date against one opponent. See fixture_requests for the independently-trackable per-team rows underneath it.';

create index fixture_request_groups_requesting_club_id_idx on public.fixture_request_groups (requesting_club_id);
create index fixture_request_groups_opponent_club_id_idx on public.fixture_request_groups (opponent_club_id);
create index fixture_request_groups_opponent_directory_id_idx on public.fixture_request_groups (opponent_directory_id);

create table public.fixture_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.fixture_request_groups(id) on delete cascade,
  requesting_team_id uuid not null references public.teams(id),
  -- Set at creation if a specific opposing team is already known (e.g. from
  -- browsing a partner club's shared calendar), otherwise filled in by the
  -- responding side when they accept -- see accept_fixture_request().
  target_team_id uuid references public.teams(id),
  venue_preference text not null check (venue_preference in ('home', 'away', 'either')),
  preferred_kickoff_time time,
  note text,
  status text not null default 'sent' check (status in ('draft', 'sent', 'accepted', 'declined', 'counter_proposed', 'cancelled', 'expired')),
  resulting_fixture_id uuid references public.fixtures(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fixture_requests is
  'One team''s slot within a fixture_request_groups ask. Independently trackable -- U12 A being accepted never implies anything about U13 A in the same group.';

create index fixture_requests_group_id_idx on public.fixture_requests (group_id);
create index fixture_requests_requesting_team_id_idx on public.fixture_requests (requesting_team_id, status);
create index fixture_requests_target_team_id_idx on public.fixture_requests (target_team_id, status);

alter table public.fixture_request_groups enable row level security;
alter table public.fixture_requests enable row level security;

create policy fixture_request_groups_select_scoped on public.fixture_request_groups for select
  using (
    internal.is_site_admin()
    or internal.can_manage_club_fixtures(requesting_club_id)
    or (opponent_club_id is not null and internal.can_manage_club_fixtures(opponent_club_id))
  );
create policy fixture_request_groups_insert_scoped on public.fixture_request_groups for insert
  with check (internal.is_site_admin() or internal.can_manage_club_fixtures(requesting_club_id));
create policy fixture_request_groups_update_scoped on public.fixture_request_groups for update
  using (internal.is_site_admin() or internal.can_manage_club_fixtures(requesting_club_id));

create policy fixture_requests_select_scoped on public.fixture_requests for select
  using (
    internal.is_site_admin()
    or internal.can_manage_team(requesting_team_id)
    or (target_team_id is not null and internal.can_manage_team(target_team_id))
    or exists (
      select 1 from public.fixture_request_groups g
      where g.id = group_id
        and (internal.can_manage_club_fixtures(g.requesting_club_id)
             or (g.opponent_club_id is not null and internal.can_manage_club_fixtures(g.opponent_club_id)))
    )
  );
-- Creation authority mirrors fixtures_insert_scoped (can_manage_team) --
-- requesting a fixture for a team is the same trust level as adding one
-- directly to that team's calendar.
create policy fixture_requests_insert_scoped on public.fixture_requests for insert
  with check (internal.is_site_admin() or internal.can_manage_team(requesting_team_id));
-- Update covers both sides: the requester (cancel/counter-propose) and the
-- responder (accept/decline) -- accept_fixture_request() below is the only
-- path that also writes fixtures, but a plain status-only decline/cancel
-- can go through this policy directly without a dedicated function.
create policy fixture_requests_update_scoped on public.fixture_requests for update
  using (
    internal.is_site_admin()
    or internal.can_manage_team(requesting_team_id)
    or (target_team_id is not null and internal.can_manage_team(target_team_id))
    or exists (
      select 1 from public.fixture_request_groups g
      where g.id = group_id
        and (internal.can_manage_club_fixtures(g.requesting_club_id)
             or (g.opponent_club_id is not null and internal.can_manage_club_fixtures(g.opponent_club_id)))
    )
  );

create trigger set_updated_at before update on public.fixture_request_groups for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.fixture_requests for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.fixture_request_groups for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.fixture_requests for each row execute function internal.audit_row_change();

-- Notify the responding side (target team's officials if known, else the
-- opponent club's fixture-management officials) the moment a request is
-- sent -- 'fixture_request_received' from the brief's notification list.
create function internal.notify_fixture_request_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.fixture_request_groups;
  v_requesting_club_name text;
begin
  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then
    return new;
  end if;

  select * into v_group from public.fixture_request_groups where id = new.group_id;
  select cd.name into v_requesting_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = v_group.requesting_club_id;

  if new.target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.target_team_id and tp.permission in ('team_admin', 'coach', 'manager');
  elsif v_group.opponent_club_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.club_memberships cm
    where cm.club_id = v_group.opponent_club_id
      and cm.status = 'active'
      and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return new;
end;
$$;

create trigger fixture_requests_notify_recipients
  after insert or update on public.fixture_requests
  for each row execute function internal.notify_fixture_request_recipients();

-- The only path from an accepted request to a real fixtures row. Creates
-- one fixtures row for the requesting team (their own calendar entry) and,
-- when the opponent is a resolvable Ovalball team, a mirrored row for that
-- team too -- each club keeps its own independently-editable fixture row
-- for the same real-world match, matching how the two source CSVs already
-- represent the same fixture once from each side.
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
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_mirror_fixture_id uuid;
  v_target_club_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
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

  insert into public.fixtures (
    owning_team_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    created_by, updated_by
  )
  values (
    v_req.requesting_team_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_req.created_by, auth.uid()
  )
  returning id into v_fixture_id;

  if v_target_team_id is not null then
    insert into public.fixtures (
      owning_team_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id,
      created_by, updated_by
    )
    select v_target_team_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_target_venue, 'Booked',
      cd.name, cd.id, v_req.requesting_team_id,
      auth.uid(), auth.uid()
    from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id
    returning id into v_mirror_fixture_id;
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
  where tp.team_id = v_req.requesting_team_id;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;
