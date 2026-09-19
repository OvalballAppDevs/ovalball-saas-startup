-- =====================================================================================================
-- SLICE 7e (3/n) -- the is_site_admin disposition, and the last thing that was waiting for it.
--
-- WHERE THIS CAME FROM. supabase/security/perimeter-manifest.json has carried this as a declared legacy
-- bypass since Slice 1:
--
--   "internal.is_site_admin() in RLS and definer functions (Phase 1: 140 policies)
--      -- retire in Slice 7 with explicit site capabilities."
--   "admin_club_overview row gate uses internal.is_site_admin() -- replace with site.clubs.view in Slice 7."
--
-- Slices 4 and 7a-7d did almost all of it: policies referencing it are now 0, and so are functions.
-- One reference survived, in a place nobody was looking -- the WHERE clause of a VIEW -- and it survived
-- precisely because the guards that drove the retirement count policies and function bodies.
--
-- WHY IT MATTERS RATHER THAN BEING TIDY. internal.is_site_admin() answers "is there an active row in
-- site_admins for this person". It is true for a Read-Only Site Admin, a Message Moderator and a Club
-- Data Admin alike, which is exactly the undifferentiated authority Slice 7 exists to replace: the whole
-- point of the seven profiles is that holding one does not imply holding another's reads.
-- site.clubs.view is a capability a profile either has or has not.
--
-- AND THEN THE FUNCTION GOES. With the view fixed there are zero references anywhere -- no policy, no
-- function, no view, no application code. A zero-caller authority helper is not harmless here: the
-- standing rule on this project is that the next person to need an answer may find the old helper
-- before they find the canonical resolver. So it is dropped rather than left as a convenience.
-- =====================================================================================================

do $$
begin
  if not exists (select 1 from public.capabilities where key = 'site.clubs.view') then
    raise exception 'SLICE 7e: site.clubs.view does not exist; the view gate cannot be replaced with it';
  end if;
end $$;

create or replace view public.admin_club_overview
with (security_invoker = true) as
 SELECT cd.id AS directory_id,
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
    cd.website AS directory_website,
    cd.official_email,
    cd.source,
    cd.external_id,
    cd.source_url,
    cd.source_updated_at,
    cd.active AS directory_active,
    cd.verification_status,
    cd.notes,
    cd.constituent_body,
    cd.normalized_key,
    cd.updated_at AS directory_updated_at,
    cd.created_at AS directory_created_at,
    c.id AS club_id,
    c.slug,
    c.status AS club_status,
    c.bio,
    c.website AS club_website,
    c.facebook_url,
    c.address_display,
    c.logo_storage_path,
    c.legacy_logo_path,
    c.created_at AS activated_at,
    c.updated_at AS club_updated_at,
    c.id IS NOT NULL AS is_activated,
    COALESCE(admin_counts.club_admin_count, 0::bigint) AS club_admin_count,
    cd.postcode IS NULL OR cd.postcode = ''::text AS flag_missing_postcode,
    cd.town IS NULL OR cd.town = ''::text AS flag_missing_town,
    cd.rugby_code IS NULL OR cd.rugby_code = ''::text AS flag_missing_rugby_code,
    dup_key.key_count > 1 AS flag_duplicate_normalized_key,
    cd.external_id IS NOT NULL AND dup_ext.ext_count > 1 AS flag_duplicate_external_id,
    cd.verification_status !~~* '%verified%'::text AS flag_unverified,
    cd.active = false AS flag_inactive,
    COALESCE(cd.website, c.website) IS NULL OR COALESCE(cd.website, c.website) = ''::text AS flag_missing_website,
    c.logo_storage_path IS NULL AND c.legacy_logo_path IS NULL AND cd.logo_storage_path IS NULL AS flag_missing_logo,
    c.id IS NOT NULL AND (c.bio IS NULL OR c.bio = ''::text) AS flag_no_public_profile,
    pending_claim.has_pending AS flag_pending_claim,
    cd.logo_storage_path AS directory_logo_storage_path
   FROM club_directory cd
     LEFT JOIN clubs c ON c.directory_id = cd.id
     LEFT JOIN LATERAL ( SELECT count(*) AS club_admin_count
           FROM club_memberships cm
          WHERE cm.club_id = c.id AND cm.role = 'CLUB_ADMIN'::text AND cm.status = 'active'::text) admin_counts ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS key_count
           FROM club_directory cd2
          WHERE cd2.normalized_key = cd.normalized_key) dup_key ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS ext_count
           FROM club_directory cd3
          WHERE cd3.source = cd.source AND cd3.external_id = cd.external_id) dup_ext ON true
     LEFT JOIN LATERAL ( SELECT (EXISTS ( SELECT 1
                   FROM club_claims cc
                  WHERE cc.directory_id = cd.id AND cc.status = 'pending'::text)) AS has_pending) pending_claim ON true
  WHERE internal.has_site_capability('site.clubs.view');

comment on view public.admin_club_overview is
  'Site Admin club list. Slice 7e replaced the internal.is_site_admin() row gate with the explicit '
  'site.clubs.view capability: being in site_admins is not an answer to what a Read-Only or Message '
  'Moderator profile may read.';

-- The helper now has nothing left that calls it, so it goes rather than waiting to be found.
drop function if exists internal.is_site_admin();

do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where (coalesce(qual,'') || coalesce(with_check,'')) ~ '\mis_site_admin\s*\(';
  if n <> 0 then raise exception 'SLICE 7e: % policies still reference is_site_admin', n; end if;

  select count(*) into n from pg_proc p
   where p.prokind = 'f' and p.prosrc ~ '\mis_site_admin\s*\(';
  if n <> 0 then raise exception 'SLICE 7e: % functions still reference is_site_admin', n; end if;

  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'internal' and p.proname = 'is_site_admin') then
    raise exception 'SLICE 7e: internal.is_site_admin still exists';
  end if;

  if pg_get_viewdef('public.admin_club_overview'::regclass, true) !~ 'site\.clubs\.view' then
    raise exception 'SLICE 7e: admin_club_overview is not gated on site.clubs.view';
  end if;

  raise notice 'Slice 7e: is_site_admin is retired -- 0 policies, 0 functions, 0 views, and the helper is gone';
end $$;
