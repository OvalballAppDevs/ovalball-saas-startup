-- Closes the gap HANDOFF.md flagged at the end of the last session: "no
-- admin-facing screen yet to approve/reject a claim and actually create/
-- promote the club_memberships row -- today that would have to be done by
-- hand via SQL/dashboard." This migration adds the missing pieces:
--
-- 1. profiles.email, denormalized from auth.users at signup, so Site Admin
--    review (and any future email-sending) never needs the Admin API or a
--    service-role key just to display/collect an email address. auth.users
--    remains the only real authentication source of truth.
-- 2. The permission vocabulary the authenticated product actually needs
--    (club_memberships.role gains FIXTURE_SECRETARY; team_permissions gains
--    a real check constraint in place of the Phase 1 freetext default).
-- 3. approve_club_claim / reject_club_claim / approve_club_join_request /
--    reject_club_join_request / approve_directory_request /
--    reject_directory_request: SECURITY DEFINER functions that are the only
--    path from a pending request to real club/membership state. Each
--    independently re-checks the caller's authority inside the function
--    body (never trusts RLS alone for something this consequential), so
--    calling one as a non-admin fails regardless of what the client sends.

-- ============================================================
-- 1. profiles.email
-- ============================================================

alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

comment on column public.profiles.email is
  'Denormalized from auth.users.email at signup (see lib/signup/complete-signup.ts). Display/reference only -- authentication always goes through auth.users/the session JWT, never this column.';

-- ============================================================
-- 2. Role vocabulary
-- ============================================================

alter table public.club_memberships drop constraint club_memberships_role_check;
alter table public.club_memberships add constraint club_memberships_role_check
  check (role in ('BASIC_USER', 'CLUB_ADMIN', 'FIXTURE_SECRETARY'));

comment on column public.club_memberships.role is
  'Club-wide Ovalball permission. FIXTURE_SECRETARY has club-wide fixture/calendar authority without full CLUB_ADMIN rights (cannot manage roles, invitations, or the club profile). Team-scoped authority lives in team_permissions, not here. Never the person''s real-world title -- that is recorded separately (club_claims.claimed_role, club_join_requests.requested_role, invitations.declared_role) and never auto-mapped to a permission.';

alter table public.team_permissions alter column permission drop default;
alter table public.team_permissions add constraint team_permissions_permission_check
  check (permission in ('team_admin', 'coach', 'manager', 'view_only'));

comment on column public.team_permissions.permission is
  'Team-scoped Ovalball permission. team_admin/coach/manager all carry write authority for this team today (kept as distinct values because the product distinguishes them in the UI and may separate their write scope later, not because they differ yet); view_only (parents/players) never gets a write policy anywhere it is checked. Renamed from the Phase 1 placeholder value ''manage'' -- no existing rows to migrate (table is empty in every environment as of this migration).';

-- can_manage_team referenced the old 'manage' value; CREATE OR REPLACE keeps
-- every existing RLS policy that calls it working unchanged (Postgres
-- resolves policy references by the function's OID, not by re-reading its
-- body), matching how 20260830155339_advisory_hardening.sql already relies
-- on this same property when moving these functions between schemas.
create or replace function internal.can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_site_admin()
    or internal.is_club_admin((select club_id from public.teams where id = p_team_id))
    or exists (
      select 1
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and tp.permission in ('team_admin', 'coach', 'manager')
    );
$$;

-- New helper: club-wide fixture/calendar authority without full club-admin
-- rights. Used by fixture_requests/fixture_messages/club_partnerships RLS
-- added in later migrations of this set.
create or replace function internal.can_manage_club_fixtures(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_site_admin()
    or internal.is_club_admin(p_club_id)
    or exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role = 'FIXTURE_SECRETARY'
    );
$$;

comment on function internal.can_manage_club_fixtures(uuid) is
  'True for Site Admin, that club''s CLUB_ADMIN, or an active FIXTURE_SECRETARY membership at that club. Deliberately does NOT grant club-profile/role-management authority -- see can_manage_club_admin-equivalent checks (is_site_admin/is_club_admin) for that.';

grant execute on function internal.can_manage_club_fixtures(uuid) to anon, authenticated;

-- ============================================================
-- 3. Collision-safe club slugs (Public Club Page requirement)
-- ============================================================

create or replace function internal.generate_club_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix int := 0;
begin
  v_base := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then
    v_base := 'club';
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.clubs where slug = v_candidate) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix::text;
  end loop;
  return v_candidate;
end;
$$;

comment on function internal.generate_club_slug(text) is
  'Slugifies a club_directory.name into a unique clubs.slug (appending -2, -3, ... on collision). Generated once at activation and then stable -- a later display-name change never touches an existing slug, so /club/{slug} links never break.';

-- ============================================================
-- 4. review_notes on the three request tables (REQUEST MORE INFORMATION /
--    rejection reason, per the Site Admin claim-approval requirement)
-- ============================================================

alter table public.club_claims add column review_notes text;
alter table public.club_join_requests add column review_notes text;
alter table public.directory_requests add column review_notes text;

-- ============================================================
-- 5. Claim approval / rejection
-- ============================================================

create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.club_claims;
  v_club_id uuid;
  v_club_name text;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim is not pending (current status: %).', v_claim.status;
  end if;

  select c.id, cd.name into v_club_id, v_club_name from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.directory_id = v_claim.directory_id;

  if v_club_id is null then
    select cd.name into v_club_name from public.club_directory cd where cd.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, internal.generate_club_slug(v_club_name), 'active', auth.uid(), auth.uid())
    returning id into v_club_id;
  end if;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_club_id, v_claim.claimant_user_id, 'CLUB_ADMIN', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set role = 'CLUB_ADMIN', status = 'active', updated_by = auth.uid();

  update public.club_claims
  set status = 'verified', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_approved',
    'Club claim approved',
    format('Your access to %s has been approved.', v_club_name),
    jsonb_build_object('club_id', v_club_id, 'claim_id', p_claim_id)
  );

  return v_club_id;
end;
$$;

comment on function public.approve_club_claim(uuid, text) is
  'The only path from a pending club_claims row to a real clubs row + CLUB_ADMIN club_memberships row. Re-checks is_site_admin() itself rather than trusting the caller -- calling this as a non-admin fails regardless of what the client sends. clubs.directory_id is unique, so re-approving after a clubs row already exists for that directory entry reuses it rather than erroring.';

revoke execute on function public.approve_club_claim(uuid, text) from public;
grant execute on function public.approve_club_claim(uuid, text) to authenticated;

create or replace function public.reject_club_claim(p_claim_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.club_claims;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may reject a club claim.' using errcode = '42501';
  end if;
  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if v_claim.status <> 'pending' then raise exception 'Claim is not pending (current status: %).', v_claim.status; end if;

  update public.club_claims
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_rejected',
    'Club claim update',
    coalesce(p_notes, 'Your club claim was not approved this time.'),
    jsonb_build_object('claim_id', p_claim_id)
  );
end;
$$;

revoke execute on function public.reject_club_claim(uuid, text) from public;
grant execute on function public.reject_club_claim(uuid, text) to authenticated;

-- ============================================================
-- 6. Join-request approval / rejection (same shape of gap, same fix).
--    Approval intentionally grants BASIC_USER, not the requester's declared
--    real-world role -- an existing Club Admin elevates them afterwards via
--    People/Roles if warranted. Callable by that club's own admin, not only
--    Site Admin.
-- ============================================================

create or replace function public.approve_club_join_request(p_request_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.club_join_requests;
begin
  select * into v_request from public.club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Join request not found.'; end if;
  if not (internal.is_site_admin() or internal.is_club_admin(v_request.club_id)) then
    raise exception 'Only that club''s admin or a Site Admin may approve a join request.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Join request is not pending (current status: %).', v_request.status;
  end if;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_request.club_id, v_request.requesting_user_id, 'BASIC_USER', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set status = 'active', updated_by = auth.uid();

  update public.club_join_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_request.requesting_user_id,
    'club_claim_approved',
    'Club access approved',
    'Your request to join has been approved.',
    jsonb_build_object('club_id', v_request.club_id, 'join_request_id', p_request_id)
  );
end;
$$;

revoke execute on function public.approve_club_join_request(uuid, text) from public;
grant execute on function public.approve_club_join_request(uuid, text) to authenticated;

create or replace function public.reject_club_join_request(p_request_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.club_join_requests;
begin
  select * into v_request from public.club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Join request not found.'; end if;
  if not (internal.is_site_admin() or internal.is_club_admin(v_request.club_id)) then
    raise exception 'Only that club''s admin or a Site Admin may reject a join request.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Join request is not pending (current status: %).', v_request.status;
  end if;

  update public.club_join_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_request.requesting_user_id,
    'club_claim_rejected',
    'Club access request update',
    coalesce(p_notes, 'Your request to join was not approved this time.'),
    jsonb_build_object('join_request_id', p_request_id)
  );
end;
$$;

revoke execute on function public.reject_club_join_request(uuid, text) from public;
grant execute on function public.reject_club_join_request(uuid, text) to authenticated;

-- ============================================================
-- 7. Directory-request approval / rejection (creates a NEW club_directory
--    row, never a clubs row -- a validated directory entry still has to be
--    separately claimed like any other, through the same claim workflow).
-- ============================================================

create or replace function public.approve_directory_request(p_request_id uuid, p_rugby_code text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.directory_requests;
  v_directory_id uuid;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may approve a directory request.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select * into v_request from public.directory_requests where id = p_request_id for update;
  if not found then raise exception 'Directory request not found.'; end if;
  if v_request.status <> 'pending' then
    raise exception 'Directory request is not pending (current status: %).', v_request.status;
  end if;

  insert into public.club_directory (
    name, rugby_code, town, county, country, postcode, active, created_by, updated_by
  )
  values (
    v_request.club_name, p_rugby_code, v_request.town, v_request.county, v_request.country,
    v_request.postcode, true, auth.uid(), auth.uid()
  )
  returning id into v_directory_id;

  update public.directory_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = p_notes, created_directory_id = v_directory_id
  where id = p_request_id;

  if v_request.submitted_by is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_request.submitted_by,
      'club_claim_approved',
      'Your club is now on Ovalball',
      format('%s has been added to the Ovalball directory. You can now claim it.', v_request.club_name),
      jsonb_build_object('directory_id', v_directory_id, 'directory_request_id', p_request_id)
    );
  end if;

  return v_directory_id;
end;
$$;

revoke execute on function public.approve_directory_request(uuid, text, text) from public;
grant execute on function public.approve_directory_request(uuid, text, text) to authenticated;

create or replace function public.reject_directory_request(p_request_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.directory_requests;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may reject a directory request.' using errcode = '42501';
  end if;
  select * into v_request from public.directory_requests where id = p_request_id for update;
  if not found then raise exception 'Directory request not found.'; end if;
  if v_request.status <> 'pending' then
    raise exception 'Directory request is not pending (current status: %).', v_request.status;
  end if;

  update public.directory_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_notes
  where id = p_request_id;

  if v_request.submitted_by is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_request.submitted_by,
      'club_claim_rejected',
      'Club listing update',
      coalesce(p_notes, format('%s was not added to the directory this time.', v_request.club_name)),
      jsonb_build_object('directory_request_id', p_request_id)
    );
  end if;
end;
$$;

revoke execute on function public.reject_directory_request(uuid, text) from public;
grant execute on function public.reject_directory_request(uuid, text) to authenticated;

-- ============================================================
-- 8. Index the new review queues' hot path (Site Admin "pending" filter).
-- ============================================================

create index club_claims_status_idx on public.club_claims (status);
create index club_join_requests_status_idx on public.club_join_requests (status);
create index directory_requests_status_idx on public.directory_requests (status);

-- ============================================================
-- 9. Notify every active Site Admin (in-app) the moment a claim/join/
--    directory request is submitted, so the review queue isn't something
--    they only discover by remembering to check it. The separate due-
--    diligence EMAIL to the configured Site Admin notification destination
--    is an application-layer concern (lib/email/), not this trigger --
--    see that module for why it stays out of SQL.
-- ============================================================

create function internal.notify_site_admins_of_new_request(p_type text, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select sa.user_id, p_type, p_title, p_body, p_data
  from public.site_admins sa
  where sa.status = 'active';
end;
$$;

create function internal.notify_site_admins_club_claim_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_name text;
begin
  select name into v_club_name from public.club_directory where id = new.directory_id;
  perform internal.notify_site_admins_of_new_request(
    'club_claim_submitted',
    'New club claim',
    format('A claim on %s is awaiting review.', coalesce(v_club_name, 'a club')),
    jsonb_build_object('claim_id', new.id, 'directory_id', new.directory_id)
  );
  return new;
end;
$$;

create trigger club_claims_notify_site_admins
  after insert on public.club_claims
  for each row execute function internal.notify_site_admins_club_claim_submitted();

create function internal.notify_site_admins_directory_request_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.notify_site_admins_of_new_request(
    'directory_request_submitted',
    'New club listing request',
    format('%s has been proposed for the directory.', new.club_name),
    jsonb_build_object('directory_request_id', new.id)
  );
  return new;
end;
$$;

create trigger directory_requests_notify_site_admins
  after insert on public.directory_requests
  for each row execute function internal.notify_site_admins_directory_request_submitted();

-- club_join_requests notifies that club's own admins (Club Admin/Fixture
-- Secretary don't decide these, only Club Admin/Site Admin do per RLS
-- above, so only CLUB_ADMIN members are notified) rather than Site Admin.
create function internal.notify_club_admins_join_request_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'club_join_request_submitted', 'New join request',
    'Someone has asked to join your club on Ovalball.',
    jsonb_build_object('join_request_id', new.id, 'club_id', new.club_id)
  from public.club_memberships cm
  where cm.club_id = new.club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active';
  return new;
end;
$$;

create trigger club_join_requests_notify_club_admins
  after insert on public.club_join_requests
  for each row execute function internal.notify_club_admins_join_request_submitted();
