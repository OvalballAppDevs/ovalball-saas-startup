-- Phase A close-out: genuine account active/suspended state for Site
-- Admin's User Management. Enforced centrally, not as a shadow flag --
-- every one of the four authorization helper functions every meaningful
-- RLS write policy in this project already funnels through
-- (is_site_admin, is_club_admin, can_manage_team, can_manage_club_fixtures)
-- is wrapped to also require an active account. CREATE OR REPLACE keeps
-- every existing policy working unchanged (Postgres resolves policy
-- references by function OID, not by re-reading the body), the same
-- property 20260831090000_role_vocabulary_and_claim_approval.sql already
-- relied on when widening can_manage_team.

alter table public.profiles add column account_status text not null default 'active' check (account_status in ('active', 'suspended'));

comment on column public.profiles.account_status is
  'Site Admin-controlled Ovalball access, separate from auth.users (no service-role key is available to this app to disable login itself). Suspended blocks every RLS write path that already funnels through is_site_admin/is_club_admin/can_manage_team/can_manage_club_fixtures -- see internal.is_account_active().';

create function internal.is_account_active(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select account_status = 'active' from public.profiles where id = p_user_id),
    true -- no profile row yet (e.g. mid-signup) is not itself a suspension
  );
$$;

comment on function internal.is_account_active(uuid) is
  'True unless this user''s profiles.account_status is explicitly suspended. Composed into the core authorization helpers below so a suspension takes effect everywhere those helpers already gate access, not just in a new check bolted on somewhere.';

grant execute on function internal.is_account_active(uuid) to anon, authenticated;

create or replace function internal.is_site_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.site_admins sa
    where sa.user_id = auth.uid() and sa.status = 'active'
  );
$$;

create or replace function internal.is_club_admin(p_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = auth.uid()
      and cm.role = 'CLUB_ADMIN'
      and cm.status = 'active'
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
      or exists (
        select 1
        from public.team_permissions tp
        join public.club_memberships cm on cm.id = tp.membership_id
        where tp.team_id = p_team_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and tp.permission in ('team_admin', 'coach', 'manager')
      )
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
      or exists (
        select 1 from public.club_memberships cm
        where cm.club_id = p_club_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and cm.role = 'FIXTURE_SECRETARY'
      )
    );
$$;

comment on function internal.can_manage_club_fixtures(uuid) is
  'True for Site Admin, that club''s CLUB_ADMIN, or an active FIXTURE_SECRETARY membership at that club -- and, as of this migration, only while the account itself is active. Deliberately does NOT grant club-profile/role-management authority -- see can_manage_club_admin-equivalent checks (is_site_admin/is_club_admin) for that.';

-- admin_user_overview (20260831220000): append account_status -- CREATE OR
-- REPLACE VIEW can only add columns at the end, never reorder/remove, so
-- every existing column stays byte-for-byte identical here.
create or replace view public.admin_user_overview
  with (security_invoker = true) as
select
  p.id as user_id,
  p.first_name,
  p.surname,
  p.email,
  p.created_at as user_created_at,
  (sa.user_id is not null) as is_site_admin,
  coalesce(memberships.data, '[]'::jsonb) as memberships,
  coalesce(pending.data, '[]'::jsonb) as pending_requests,
  memberships.club_names,
  memberships.team_names,
  coalesce(memberships.has_active_membership, false) as has_active_membership,
  coalesce(memberships.highest_role, 0) as highest_role,
  coalesce(memberships.has_club_admin, false) as has_club_admin,
  coalesce(memberships.has_fixtures_admin, false) as has_fixtures_admin,
  coalesce(memberships.has_team_admin, false) as has_team_admin,
  (jsonb_array_length(coalesce(pending.data, '[]'::jsonb)) > 0) as has_pending_request,
  p.account_status
from public.profiles p
left join public.site_admins sa on sa.user_id = p.id and sa.status = 'active'
left join lateral (
  select
    jsonb_agg(jsonb_build_object(
      'membershipId', cm.id,
      'clubId', c.id,
      'directoryId', cd.id,
      'clubName', cd.name,
      'role', cm.role,
      'clubRoleTitle', cm.club_role_title,
      'status', cm.status,
      'teamRoles', coalesce(tp.data, '[]'::jsonb)
    ) order by cm.created_at) as data,
    string_agg(distinct cd.name, ', ') as club_names,
    string_agg(distinct tp.names, ', ') filter (where tp.names is not null) as team_names,
    bool_or(cm.status = 'active') as has_active_membership,
    max(case cm.role when 'CLUB_ADMIN' then 3 when 'FIXTURE_SECRETARY' then 2 when 'BASIC_USER' then 1 else 0 end) as highest_role,
    bool_or(cm.status = 'active' and cm.role = 'CLUB_ADMIN') as has_club_admin,
    bool_or(cm.status = 'active' and cm.role = 'FIXTURE_SECRETARY') as has_fixtures_admin,
    bool_or(cm.status = 'active' and exists (
      select 1 from public.team_permissions tp3
      where tp3.membership_id = cm.id and tp3.permission in ('team_admin', 'coach', 'manager')
    )) as has_team_admin
  from public.club_memberships cm
  join public.clubs c on c.id = cm.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object('teamId', t.id, 'teamName', t.display_name, 'permission', tp2.permission)) as data,
      string_agg(t.display_name, ', ') as names
    from public.team_permissions tp2
    join public.teams t on t.id = tp2.team_id
    where tp2.membership_id = cm.id
  ) tp on true
  where cm.user_id = p.id
) memberships on true
left join lateral (
  select jsonb_agg(x) as data from (
    select jsonb_build_object('type', 'claim', 'clubName', cd2.name, 'role', cc.claimed_role, 'status', cc.status, 'createdAt', cc.created_at) as x
    from public.club_claims cc join public.club_directory cd2 on cd2.id = cc.directory_id
    where cc.claimant_user_id = p.id and cc.status = 'pending'
    union all
    select jsonb_build_object('type', 'join_request', 'clubName', cd3.name, 'role', cjr.requested_role, 'status', cjr.status, 'createdAt', cjr.created_at) as x
    from public.club_join_requests cjr
    join public.clubs c3 on c3.id = cjr.club_id
    join public.club_directory cd3 on cd3.id = c3.directory_id
    where cjr.requesting_user_id = p.id and cjr.status = 'pending'
  ) sub
) pending on true;
