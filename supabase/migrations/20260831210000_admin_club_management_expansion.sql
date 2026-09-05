-- Expands the Site Admin Club Management slice (20260831200000) into the
-- authoritative control plane for canonical/activated clubs: manual
-- canonical creation, a persisted real-world club-role field, safe
-- dependency-checked hard delete, and a few more data-quality signals.
-- Every write path here still goes through club_directory/clubs/
-- club_memberships directly (or a SECURITY DEFINER function re-checking
-- is_site_admin(), same pattern as approve_club_claim) -- no shadow table,
-- no admin-only mirror of canonical data.

-- ============================================================
-- 1. source_url becomes optional. A club_directory row created by a
--    Site Admin by hand (source = 'site_admin_manual') genuinely has no
--    governing-body source URL -- forcing a placeholder would fabricate
--    provenance data, exactly what this project's own external_id
--    handling already refuses to do ("if external_id is unknown, keep it
--    null rather than inventing one").
-- ============================================================

alter table public.club_directory alter column source_url drop not null;

-- ============================================================
-- 2. club_memberships.club_role_title -- the persisted real-world club
--    role (e.g. "Club Secretary"), as distinct from club_memberships.role
--    (the Ovalball permission: BASIC_USER/CLUB_ADMIN/FIXTURE_SECRETARY).
--    Until now the real-world title was only ever recorded transiently at
--    claim/join/invite time (club_claims.claimed_role,
--    club_join_requests.requested_role, invitations.declared_role) and
--    never persisted against the resulting membership, so there was
--    nothing for a Site Admin (or anyone) to review or correct later.
--    This is the same table the product already uses for membership
--    state, not a new admin-only mirror.
-- ============================================================

alter table public.club_memberships add column club_role_title text;

comment on column public.club_memberships.club_role_title is
  'The member''s real-world club role (e.g. "Club Secretary", "Head Coach") -- descriptive only, never mapped to an Ovalball permission (see club_memberships.role for that, and its own comment for the same separation). Backfilled once below from whatever role was declared at claim/join/invite time; a Site Admin can correct it afterward via Club Management.';

update public.club_memberships cm
set club_role_title = sub.role_title
from (
  select distinct on (user_id, club_id) user_id, club_id, role_title
  from (
    select cc.claimant_user_id as user_id, c.id as club_id, cc.claimed_role as role_title, cc.decided_at as ts
    from public.club_claims cc
    join public.clubs c on c.directory_id = cc.directory_id
    where cc.status = 'verified' and cc.claimed_role is not null

    union all

    select cjr.requesting_user_id, cjr.club_id, cjr.requested_role, cjr.decided_at
    from public.club_join_requests cjr
    where cjr.status = 'approved' and cjr.requested_role is not null

    union all

    select i.accepted_by, i.club_id, i.declared_role, i.accepted_at
    from public.invitations i
    where i.status = 'accepted' and i.declared_role is not null and i.accepted_by is not null
  ) combined
  order by user_id, club_id, ts desc nulls last
) sub
where cm.user_id = sub.user_id and cm.club_id = sub.club_id and cm.club_role_title is null;

-- ============================================================
-- 3. club_directory DELETE policy. Site Admin only, matching the existing
--    select/insert/update policies -- the real dependency-safety check
--    lives in delete_canonical_club() below (SECURITY DEFINER, so it
--    doesn't strictly need this policy to function), but every other
--    command on this table already has an explicit policy and this keeps
--    that consistent for defense in depth / dashboard access.
-- ============================================================

create policy club_directory_delete_admin on public.club_directory for delete
  using (internal.is_site_admin());

-- ============================================================
-- 4. delete_canonical_club: the ONLY path that may permanently remove a
--    club_directory row. Never a raw client-side DELETE (never "DELETE
--    WHERE name = ..." -- always by stable id, and this function is the
--    sole gate). Blocks whenever real Ovalball history exists:
--
--    - any `clubs` row for this directory (i.e. it was ever activated) --
--      which transitively covers every dependency that can only exist
--      once a clubs row does (memberships, teams, fixtures, fixture
--      requests, calendar/partner relationships, messages, notifications,
--      invitations, media): clubs.directory_id is unique and only ever
--      created by approve_club_claim, so if none of those can exist
--      without a clubs row, checking for the clubs row alone is sufficient.
--    - any `club_claims` row (pending, verified, or rejected) -- a claim
--      attempt is itself meaningful history, and clubs.directory_id being
--      unique + only created by approve_club_claim means a verified claim
--      always implies a clubs row anyway; checking claims directly also
--      catches a still-pending or rejected claim, which a bare clubs-row
--      check would miss.
--
--    Confirmation is by exact club name match (a UX safeguard, "type the
--    club name to confirm"), never used as the deletion predicate itself
--    -- the actual DELETE below is always `where id = p_directory_id`.
-- ============================================================

create or replace function public.delete_canonical_club(p_directory_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_directory public.club_directory;
  v_has_clubs boolean;
  v_has_claims boolean;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may permanently delete a canonical club record.' using errcode = '42501';
  end if;

  select * into v_directory from public.club_directory where id = p_directory_id for update;
  if not found then
    raise exception 'Club not found.';
  end if;

  if v_directory.name <> p_confirm_name then
    raise exception 'Confirmation text did not match the club name exactly.';
  end if;

  select exists(select 1 from public.clubs where directory_id = p_directory_id) into v_has_clubs;
  select exists(select 1 from public.club_claims where directory_id = p_directory_id) into v_has_claims;

  if v_has_clubs or v_has_claims then
    raise exception 'This club cannot be permanently deleted because it has existing Ovalball history. Deactivate it instead.';
  end if;

  delete from public.club_directory where id = p_directory_id;
end;
$$;

comment on function public.delete_canonical_club(uuid, text) is
  'The only path that may permanently remove a club_directory row. Re-checks is_site_admin() itself (never trusts RLS alone). Blocks whenever any clubs or club_claims row references this directory id -- see the function body for why that is a sufficient dependency check. Deletes strictly by id; p_confirm_name is a UX safeguard only, never the delete predicate.';

revoke execute on function public.delete_canonical_club(uuid, text) from public;
grant execute on function public.delete_canonical_club(uuid, text) to authenticated;

-- ============================================================
-- 5. admin_club_overview: three more data-quality signals, appended after
--    the existing columns (CREATE OR REPLACE VIEW can only add columns at
--    the end, never reorder/remove -- every existing column stays
--    byte-for-byte identical here).
-- ============================================================

create or replace view public.admin_club_overview
  with (security_invoker = true) as
select
  cd.id as directory_id,
  cd.name,
  cd.rugby_code,
  cd.country,
  cd.nation,
  cd.region,
  cd.county,
  cd.town,
  cd.postcode,
  cd.home_ground,
  cd.address,
  cd.website as directory_website,
  cd.official_email,
  cd.source,
  cd.external_id,
  cd.source_url,
  cd.source_updated_at,
  cd.active as directory_active,
  cd.verification_status,
  cd.notes,
  cd.constituent_body,
  cd.normalized_key,
  cd.updated_at as directory_updated_at,
  cd.created_at as directory_created_at,
  c.id as club_id,
  c.slug,
  c.status as club_status,
  c.bio,
  c.website as club_website,
  c.facebook_url,
  c.address_display,
  c.logo_storage_path,
  c.legacy_logo_path,
  c.created_at as activated_at,
  c.updated_at as club_updated_at,
  (c.id is not null) as is_activated,
  coalesce(admin_counts.club_admin_count, 0) as club_admin_count,
  (cd.postcode is null or cd.postcode = '') as flag_missing_postcode,
  (cd.town is null or cd.town = '') as flag_missing_town,
  (cd.rugby_code is null or cd.rugby_code = '') as flag_missing_rugby_code,
  (dup_key.key_count > 1) as flag_duplicate_normalized_key,
  (cd.external_id is not null and dup_ext.ext_count > 1) as flag_duplicate_external_id,
  (cd.verification_status not ilike '%verified%') as flag_unverified,
  (cd.active = false) as flag_inactive,
  (coalesce(cd.website, c.website) is null or coalesce(cd.website, c.website) = '') as flag_missing_website,
  (c.id is not null and c.logo_storage_path is null and c.legacy_logo_path is null) as flag_missing_logo,
  (c.id is not null and (c.bio is null or c.bio = '')) as flag_no_public_profile,
  (pending_claim.has_pending) as flag_pending_claim
from public.club_directory cd
left join public.clubs c on c.directory_id = cd.id
left join lateral (
  select count(*) as club_admin_count
  from public.club_memberships cm
  where cm.club_id = c.id and cm.role = 'CLUB_ADMIN' and cm.status = 'active'
) admin_counts on true
left join lateral (
  select count(*) as key_count
  from public.club_directory cd2
  where cd2.normalized_key = cd.normalized_key
) dup_key on true
left join lateral (
  select count(*) as ext_count
  from public.club_directory cd3
  where cd3.source = cd.source and cd3.external_id = cd.external_id
) dup_ext on true
left join lateral (
  select exists(
    select 1 from public.club_claims cc where cc.directory_id = cd.id and cc.status = 'pending'
  ) as has_pending
) pending_claim on true;

grant select on public.admin_club_overview to authenticated;
