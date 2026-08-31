-- Calendar-sharing relationships between clubs, and fixture-scoped
-- conversations. Neither is public/generic: a partnership is an explicit,
-- revocable, two-sided agreement (never public calendar exposure), and a
-- conversation only exists attached to a specific fixture or fixture
-- request between two sides who are actually party to it (never a generic
-- inbox or arbitrary club-to-club cold messaging).

create table public.club_partnerships (
  id uuid primary key default gen_random_uuid(),
  requesting_club_id uuid not null references public.clubs(id),
  partner_club_id uuid not null references public.clubs(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requesting_club_id <> partner_club_id)
);

comment on table public.club_partnerships is
  'An explicit, revocable calendar-sharing agreement between two clubs. Existence + status = the only thing either side can infer about the other from this table; browsing actual availability goes through get_partner_team_availability(), which returns busy/free per date, never raw fixture details.';

-- Direction-independent: re-requesting after a revoked partnership is
-- allowed (excluded below), but only one pending/active row may exist for
-- a given pair regardless of who initiated.
create unique index club_partnerships_unique_active_pair_idx on public.club_partnerships
  (least(requesting_club_id, partner_club_id), greatest(requesting_club_id, partner_club_id))
  where status <> 'revoked';

create index club_partnerships_requesting_club_id_idx on public.club_partnerships (requesting_club_id);
create index club_partnerships_partner_club_id_idx on public.club_partnerships (partner_club_id);

alter table public.club_partnerships enable row level security;

create policy club_partnerships_select_scoped on public.club_partnerships for select
  using (internal.is_site_admin() or internal.can_manage_club_fixtures(requesting_club_id) or internal.can_manage_club_fixtures(partner_club_id));
create policy club_partnerships_insert_scoped on public.club_partnerships for insert
  with check (internal.is_site_admin() or internal.can_manage_club_fixtures(requesting_club_id));

create trigger set_updated_at before update on public.club_partnerships for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update on public.club_partnerships for each row execute function internal.audit_row_change();

-- No generic UPDATE policy: responding (accept) and revoking both have
-- side-specific rules a single USING clause can't express (accepting must
-- come from the NON-requesting side; revoking may come from either side)
-- -- both go through functions below instead.

create or replace function public.respond_to_club_partnership(p_partnership_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.club_partnerships;
begin
  select * into v_p from public.club_partnerships where id = p_partnership_id for update;
  if not found then raise exception 'Partnership request not found.'; end if;
  if v_p.status <> 'pending' then raise exception 'Partnership is not pending (current status: %).', v_p.status; end if;

  if not (internal.is_site_admin() or internal.can_manage_club_fixtures(v_p.partner_club_id)) then
    raise exception 'Only the invited club may respond to this partnership request.' using errcode = '42501';
  end if;

  update public.club_partnerships
  set status = case when p_approve then 'active' else 'revoked' end,
      responded_by = auth.uid(), responded_at = now()
  where id = p_partnership_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id,
    case when p_approve then 'calendar_share_approved' else 'calendar_share_declined' end,
    case when p_approve then 'Calendar sharing agreed' else 'Calendar sharing request declined' end,
    'Your partner club request has been ' || (case when p_approve then 'accepted.' else 'declined.' end),
    jsonb_build_object('partnership_id', p_partnership_id)
  from public.club_memberships cm
  where cm.club_id = v_p.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
end;
$$;

revoke execute on function public.respond_to_club_partnership(uuid, boolean) from public;
grant execute on function public.respond_to_club_partnership(uuid, boolean) to authenticated;

create or replace function public.revoke_club_partnership(p_partnership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.club_partnerships;
begin
  select * into v_p from public.club_partnerships where id = p_partnership_id for update;
  if not found then raise exception 'Partnership not found.'; end if;
  if v_p.status = 'revoked' then return; end if;

  if not (internal.is_site_admin() or internal.can_manage_club_fixtures(v_p.requesting_club_id) or internal.can_manage_club_fixtures(v_p.partner_club_id)) then
    raise exception 'You are not authorised to revoke this partnership.' using errcode = '42501';
  end if;

  update public.club_partnerships set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where id = p_partnership_id;
end;
$$;

revoke execute on function public.revoke_club_partnership(uuid) from public;
grant execute on function public.revoke_club_partnership(uuid) to authenticated;

-- Narrow availability read: busy/free per date for one partner team, never
-- raw fixture rows (opponent, notes, venue address, etc. stay private).
-- Requires an active partnership between the caller's club and the team's
-- club -- checked inside the function, not via a broad RLS SELECT grant on
-- fixtures (which would otherwise have to expose every column to anyone
-- with any partnership, one club at a time, forever).
create or replace function public.get_partner_team_availability(p_team_id uuid, p_from date, p_to date)
returns table(fixture_date date, availability text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_partner_club_id uuid;
  v_caller_club_id uuid;
begin
  select club_id into v_partner_club_id from public.teams where id = p_team_id;
  if v_partner_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      and ((cp.requesting_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.partner_club_id))
        or (cp.partner_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.requesting_club_id)))
  ) and not internal.is_site_admin() then
    raise exception 'No active calendar-sharing agreement with this club.' using errcode = '42501';
  end if;

  return query
  select f.kickoff_date, 'unavailable'::text
  from public.fixtures f
  where f.owning_team_id = p_team_id
    and f.kickoff_date between p_from and p_to
    and f.status not in ('Cancelled');
end;
$$;

revoke execute on function public.get_partner_team_availability(uuid, date, date) from public;
grant execute on function public.get_partner_team_availability(uuid, date, date) to authenticated;

comment on function public.get_partner_team_availability(uuid, date, date) is
  'Every date in range not returned here is implicitly available/potentially-available -- the UI treats "not in this list" as bookable, this function only ever discloses which dates are already taken.';

-- ============================================================
-- Fixture-scoped conversations
-- ============================================================

create table public.fixture_messages (
  id uuid primary key default gen_random_uuid(),
  fixture_request_id uuid references public.fixture_requests(id),
  fixture_id uuid references public.fixtures(id),
  sender_user_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(fixture_request_id, fixture_id) = 1)
);

comment on table public.fixture_messages is
  'One conversation per fixture or fixture_request -- never a generic inbox. Exactly one of fixture_request_id/fixture_id is set. Sender identity is shown in the UI as their Ovalball role at their club (see the app layer), never their raw email.';

create index fixture_messages_fixture_request_id_idx on public.fixture_messages (fixture_request_id, created_at);
create index fixture_messages_fixture_id_idx on public.fixture_messages (fixture_id, created_at);

alter table public.fixture_messages enable row level security;

create function internal.can_access_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
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
             or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id)))
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
  'True for a team official of either side of the fixture/request, or a club-level (Club Admin/Fixture Secretary) official of either club -- the exact "team-scoped or club-level, only with a legitimate fixture relationship" rule from the messaging requirement, in one place both fixture_messages policies below share.';

grant execute on function internal.can_access_fixture_conversation(uuid, uuid) to anon, authenticated;

create policy fixture_messages_select_scoped on public.fixture_messages for select
  using (internal.can_access_fixture_conversation(fixture_id, fixture_request_id));
create policy fixture_messages_insert_scoped on public.fixture_messages for insert
  with check (sender_user_id = (select auth.uid()) and internal.can_access_fixture_conversation(fixture_id, fixture_request_id));

-- Immutable log: no update/delete policy for any role, matching how the
-- messaging requirement asks for an audit/moderation-capable record, not
-- an editable chat history.
