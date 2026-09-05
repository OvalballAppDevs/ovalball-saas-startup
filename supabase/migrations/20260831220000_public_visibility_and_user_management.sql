-- Closes out the Club Management slice (public-profile visibility controls)
-- and lays the read model for the new Site Admin User Management slice.
-- No new authorization tables -- User Management operates on exactly the
-- same club_memberships/team_permissions/site_admins rows the rest of the
-- product already reads and enforces via RLS.

-- ============================================================
-- 1. Public-profile visibility controls on `clubs` (the Ovalball profile,
--    never club_directory -- these are presentation choices about an
--    activated club's own public page, not canonical facts). Defaults are
--    privacy-conscious: website/home ground are the same low-sensitivity
--    info already shown unconditionally today (no regression), but the
--    previously-always-shown address_display becomes opt-in, and postcode
--    (never shown publicly before this migration) defaults hidden too.
--    Public phone/email already have a finer-grained existing mechanism
--    (club_contacts.is_public per named contact) and are deliberately not
--    duplicated here.
-- ============================================================

alter table public.clubs add column show_website boolean not null default true;
alter table public.clubs add column show_home_ground boolean not null default true;
alter table public.clubs add column show_address boolean not null default false;
alter table public.clubs add column show_postcode boolean not null default false;

comment on column public.clubs.show_website is 'Whether the public club page displays clubs.website. Defaults true (already unconditionally shown before this migration -- no behavior change by default).';
comment on column public.clubs.show_address is 'Whether the public club page displays clubs.address_display. Defaults false -- previously always shown; this migration makes it opt-in, a deliberate privacy improvement for clubs whose training address is not appropriate to publish.';
comment on column public.clubs.show_postcode is 'Whether the public club page displays club_directory.postcode. Defaults false; postcode was never shown publicly before this migration.';
comment on column public.clubs.show_home_ground is 'Whether the public club page displays club_directory.home_ground. Defaults true (already unconditionally shown before this migration -- no behavior change by default).';

-- ============================================================
-- 2. admin_user_overview: one row per profile, Site Admin's read model
--    for User Management -- mirrors admin_club_overview's own reasoning
--    (a view, not a duplicate store; security_invoker so it is exactly as
--    permissive as profiles/club_memberships/team_permissions' own RLS
--    already is). profiles_select_self_or_admin already restricts SELECT
--    to `id = auth.uid() or is_site_admin()`, so a non-Site-Admin querying
--    this view only ever sees their own single row (and only their own
--    joined memberships, since every join is correlated by that same row).
--    Deliberately excludes date_of_birth/address_*/postcode/county/town/
--    country from `profiles` -- those stay behind a separate, explicit
--    per-user query on the detail page, never in this list-page view.
-- ============================================================

create view public.admin_user_overview
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
  (jsonb_array_length(coalesce(pending.data, '[]'::jsonb)) > 0) as has_pending_request
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

grant select on public.admin_user_overview to authenticated;

comment on view public.admin_user_overview is
  'Site Admin User Management read model. One row per profiles row, with memberships/team scope/pending requests aggregated as JSON. Never exposes date_of_birth/address/postcode -- those stay behind a separate per-user detail query, gated the same way (Site Admin or self) but never in this list view.';
