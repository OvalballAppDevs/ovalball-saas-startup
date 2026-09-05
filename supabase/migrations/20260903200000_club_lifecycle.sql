-- Club deactivation as safe lifecycle, never destructive deletion, and
-- NEVER a fixture-cancellation event. Reuses clubs.status (already
-- existed, already checked by every fixture RPC's own "external/
-- unactivated opponent" detection via `c.status = 'active'` joins) --
-- widened with a distinct 'deactivated' value (kept separate from the
-- pre-existing, still-unused 'suspended' value, which this migration does
-- not touch or repurpose).
--
-- Product correction from this pass's first attempt: a deactivated club
-- is an Ovalball ACCOUNT lifecycle fact, not a rugby FIXTURE lifecycle
-- fact. A deactivated club behaves exactly like a canonical club that has
-- never activated -- its real opponents' fixtures stay exactly as they
-- are (never auto-cancelled), and simply become "operationally external"
-- from that point on: every fixture RPC already treats the OTHER side as
-- external the instant `c.status <> 'active'` for the opponent's club (a
-- direct-edit path, no negotiation expected), because that check has
-- always been about "is there a real, active Ovalball account on the
-- other end to negotiate with" -- true for both "never claimed" and "no
-- longer active." Only a genuine, separate fixture-cancellation workflow
-- ever sets a fixture to Cancelled.
--
-- club_directory (canonical rugby-club identity) is never touched.
-- Historical fixtures/results/messages/teams/pitches/documents/
-- competitions/seasons/audit are all untouched rows, never deleted.
--
-- What DOES change while a club is deactivated: its own members' WRITE
-- authority (is_club_admin/can_manage_club_fixtures/can_manage_team all
-- gate on the club being active) -- and, on reactivation, that authority
-- does NOT silently return. club_memberships gets a real
-- authority_suspended flag, set for every active membership the instant
-- the club deactivates, and cleared only one membership at a time via the
-- explicit restore_club_membership_authority() review below -- never as a
-- side effect of the club itself becoming active again.

alter table public.clubs drop constraint clubs_status_check;
alter table public.clubs add constraint clubs_status_check check (status in ('active', 'suspended', 'deactivated'));

alter table public.clubs
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references auth.users(id),
  add column deactivation_reason text,
  add column reactivated_at timestamptz,
  add column reactivated_by uuid references auth.users(id);

comment on column public.clubs.deactivated_at is
  'Set when status moves to ''deactivated'' via deactivate_club() -- null means never deactivated (or reactivated since). The full history lives in audit_log, not here -- these columns describe only the current/most-recent event, matching teams.folded_at''s own convention. Never implies any fixture was cancelled -- see the migration header.';

alter table public.club_memberships
  add column authority_suspended boolean not null default false,
  add column authority_suspended_at timestamptz,
  add column authority_restored_at timestamptz,
  add column authority_restored_by uuid references auth.users(id);

comment on column public.club_memberships.authority_suspended is
  'True while this membership''s real authority is paused because its club deactivated. Set for every active membership at deactivate_club() time; reactivate_club() deliberately does NOT clear it -- only restore_club_membership_authority(), one membership at a time, does. The membership row itself (role, history) is never touched -- this is purely an authority gate, matching "preserve historical membership records, but require deliberate restoration."';

-- ============================================================
-- internal.is_club_active: the one place "is this club currently allowed
-- to operate on Ovalball" is decided. is_club_admin/can_manage_club_
-- fixtures/can_manage_team are redefined below to require it (and to
-- exclude a suspended membership even once the club is active again) --
-- every downstream consumer inherits both automatically.
-- ============================================================

create or replace function internal.is_club_active(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.clubs where id = p_club_id and status = 'active');
$$;

grant execute on function internal.is_club_active(uuid) to authenticated;

create or replace function internal.is_club_admin(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and internal.is_club_active(p_club_id) and exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = auth.uid()
      and cm.role = 'CLUB_ADMIN'
      and cm.status = 'active'
      and cm.authority_suspended = false
  );
$$;

create or replace function internal.can_manage_club_fixtures(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_account_active(auth.uid()) and (
      internal.is_site_admin()
      or internal.is_club_admin(p_club_id)
      or (
        internal.is_club_active(p_club_id) and exists (
          select 1 from public.club_memberships cm
          where cm.club_id = p_club_id
            and cm.user_id = auth.uid()
            and cm.status = 'active'
            and cm.authority_suspended = false
            and cm.role = 'FIXTURE_SECRETARY'
        )
      )
    );
$$;

create or replace function internal.can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_account_active(auth.uid()) and (
      internal.is_site_admin()
      or internal.is_club_admin((select club_id from public.teams where id = p_team_id))
      or (
        internal.is_club_active((select club_id from public.teams where id = p_team_id)) and exists (
          select 1
          from public.team_permissions tp
          join public.club_memberships cm on cm.id = tp.membership_id
          where tp.team_id = p_team_id
            and cm.user_id = auth.uid()
            and cm.status = 'active'
            and cm.authority_suspended = false
            and tp.permission in ('team_admin', 'coach', 'manager')
        )
      )
    );
$$;

comment on function internal.is_club_admin(uuid) is
  'Site Admin is a SEPARATE function (is_site_admin) and deliberately never routes through this one -- Site Admin must keep acting on a deactivated club (to reactivate it, restore access, resolve disputes) even though every real club-side authority is gated off the instant the club is not active OR the specific membership''s authority is still suspended post-reactivation.';

-- ============================================================
-- deactivate_club: Site Admin only, reason required. Touches ONLY the
-- club''s own account state and its members'' authority -- NEVER a
-- fixture. Fixtures stay exactly as they are; every fixture RPC''s
-- existing external-opponent detection (c.status <> 'active') already
-- makes an active opponent treat this club as external from this moment
-- on, with zero additional code needed here.
-- ============================================================

create or replace function public.deactivate_club(p_club_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clubs;
  v_suspended_count integer;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may deactivate a club.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to deactivate a club.';
  end if;

  select * into c from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'Club not found.';
  end if;
  if c.status = 'deactivated' then
    raise exception 'This club is already deactivated.';
  end if;

  update public.clubs
  set status = 'deactivated', deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = trim(p_reason),
      reactivated_at = null, reactivated_by = null
  where id = p_club_id;

  update public.club_memberships
  set authority_suspended = true, authority_suspended_at = now(), authority_restored_at = null, authority_restored_by = null
  where club_id = p_club_id and status = 'active' and authority_suspended = false;
  get diagnostics v_suspended_count = row_count;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('clubs', p_club_id, 'update', auth.uid(), jsonb_build_object('event', 'deactivated', 'reason', p_reason, 'memberships_suspended', v_suspended_count));

  return v_suspended_count;
end;
$$;

revoke execute on function public.deactivate_club(uuid, text) from public;
grant execute on function public.deactivate_club(uuid, text) to authenticated;

comment on function public.deactivate_club(uuid, text) is
  'Never sets a fixture to Cancelled -- that remains a separate, explicit fixture-cancellation workflow. Returns the number of memberships whose authority was suspended.';

-- ============================================================
-- reactivate_club: Site Admin only. Restores the SAME club identity and
-- ALL retained operational data. Deliberately does NOT clear any
-- membership''s authority_suspended flag -- data returns, privileged
-- authority does not silently return with it. See
-- restore_club_membership_authority() below for the explicit,
-- one-membership-at-a-time review path.
-- ============================================================

create or replace function public.reactivate_club(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clubs;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may reactivate a club.' using errcode = '42501';
  end if;

  select * into c from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'Club not found.';
  end if;
  if c.status = 'active' then
    raise exception 'This club is not deactivated.';
  end if;

  update public.clubs set status = 'active', reactivated_at = now(), reactivated_by = auth.uid() where id = p_club_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('clubs', p_club_id, 'update', auth.uid(), jsonb_build_object('event', 'reactivated'));
end;
$$;

revoke execute on function public.reactivate_club(uuid) from public;
grant execute on function public.reactivate_club(uuid) to authenticated;

-- ============================================================
-- Previous Club Access review: list every membership still suspended at
-- an ACTIVE club, and restore one at a time. Site Admin only for this
-- pass (the same authority level that deactivates/reactivates the club
-- itself) -- deliberately not opened up to a newly-restored Club Admin
-- restoring others in this pass, to keep the review path single-throated
-- and auditable while the mechanism is new.
-- ============================================================

create or replace function public.list_suspended_club_memberships(p_club_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  role text,
  authority_suspended_at timestamptz,
  first_name text,
  surname text
)
language sql
stable
security definer
set search_path = public
as $$
  select cm.id, cm.user_id, cm.role, cm.authority_suspended_at, p.first_name, p.surname
  from public.club_memberships cm
  join public.profiles p on p.id = cm.user_id
  where cm.club_id = p_club_id and cm.status = 'active' and cm.authority_suspended = true
  order by cm.role, p.surname;
$$;

revoke execute on function public.list_suspended_club_memberships(uuid) from public;
grant execute on function public.list_suspended_club_memberships(uuid) to authenticated;

create or replace function internal.can_review_club_access(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_site_admin();
$$;

create or replace function public.restore_club_membership_authority(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cm public.club_memberships;
begin
  select * into cm from public.club_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership not found.';
  end if;
  if not internal.can_review_club_access(cm.club_id) then
    raise exception 'Only a Site Admin may restore club access.' using errcode = '42501';
  end if;
  if not internal.is_club_active(cm.club_id) then
    raise exception 'Reactivate the club before restoring member access.';
  end if;
  if cm.authority_suspended = false then
    raise exception 'This member''s access is not suspended.';
  end if;

  update public.club_memberships
  set authority_suspended = false, authority_restored_at = now(), authority_restored_by = auth.uid()
  where id = p_membership_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('club_memberships', p_membership_id, 'update', auth.uid(), jsonb_build_object('event', 'authority_restored'));
end;
$$;

revoke execute on function public.restore_club_membership_authority(uuid) from public;
grant execute on function public.restore_club_membership_authority(uuid) to authenticated;

-- ============================================================
-- Reconciliation summary: fixtures involving this club (either side)
-- created or changed since it last deactivated -- read-only, no
-- notification, so browsing history never spams anyone (only a genuine
-- fixture-level notification, e.g. a real kickoff change, already does
-- that on its own). Reviewable by this club''s own (now-restored) Club
-- Admin or a Site Admin.
-- ============================================================

create or replace function public.list_fixtures_since_deactivation(p_club_id uuid)
returns setof public.fixtures
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if not (internal.is_club_admin(p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to review this club''s fixtures.' using errcode = '42501';
  end if;
  select deactivated_at into v_since from public.clubs where id = p_club_id;
  if v_since is null then
    return;
  end if;
  return query
    select f.* from public.fixtures f
    where (f.owning_team_id in (select id from public.teams where club_id = p_club_id)
           or f.opponent_team_id in (select id from public.teams where club_id = p_club_id))
      and (f.created_at >= v_since or f.updated_at >= v_since)
    order by f.kickoff_date;
end;
$$;

revoke execute on function public.list_fixtures_since_deactivation(uuid) from public;
grant execute on function public.list_fixtures_since_deactivation(uuid) to authenticated;

comment on function public.list_fixtures_since_deactivation(uuid) is
  'Read-only review list, never a notification -- "N future fixtures were recorded involving this club while it was inactive," surfaced for deliberate review, never presented as previously accepted through Ovalball.';
