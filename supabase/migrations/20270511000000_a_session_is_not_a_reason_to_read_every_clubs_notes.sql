-- =====================================================================================================
-- CONVERGENCE STEP 6 (4/n) -- L17: authentication alone is not authority over every club's private
-- directory columns.
--
-- WHAT WAS MEASURED, at the end of Step 5 and again at the start of Step 6:
--
--   authenticated  has_table_privilege  club_directory SELECT          -> true
--                  has_column_privilege club_directory.notes           -> true
--                  has_column_privilege club_directory.official_email  -> true
--   anon           has_column_privilege club_directory.notes           -> false
--
-- `anon` was already column-restricted to 17 public directory facts, and `authenticated` carries the
-- SAME 17-column grant -- plus a TABLE-level SELECT that makes it moot. The intent was recorded in the
-- grants and then overridden by a wider one on the same table.
--
-- RLS is not the gap and is not changed. club_directory_select already reads
-- `active = true OR internal.has_site_capability('site.directory.manage')`, and the write policies are
-- capability-gated. RLS scopes ROWS; it cannot scope columns, which is the whole of this defect.
--
-- WHAT `notes` ACTUALLY HOLDS, recovered rather than assumed: 1,385 of 1,395 rows, all governing-body
-- research provenance -- "Official WRU 2026/27 community amateur competition participant", "Club name
-- and listed location verified against the official Scottish Rugby fixture list". Not personal data and
-- not private club administration. So the CURRENT exposure is low severity. The column is nonetheless
-- free text a Site Admin writes, so its classification follows the writer's licence rather than today's
-- sample, and `official_email` is a contact address on 29 rows.
--
-- WHAT CHANGES
--
--   1. The table-level SELECT goes. The column grant that was always there becomes effective.
--   2. Three columns join it: latitude, longitude, geocode_status. These are read by ORDINARY
--      authenticated surfaces -- Ovie opponent search, the competitions workspace, the Partner Clubs
--      map -- and a revoke without them would have broken real features to close a notes leak.
--   3. admin_club_overview becomes an OWNER-RIGHTS view. It already carries
--      `WHERE internal.has_site_capability('site.clubs.view')` as its only gate, so the capability --
--      not the reader's column privileges -- is what decides. This is the same "definer read behind a
--      capability" shape Slice 7e used for site_player_team_memberships, expressed as a view because
--      one already existed and re-deriving it as an RPC would have been a second projection of the
--      same rows.
--
-- WHY NOT SIMPLY GRANT notes TO authenticated AGAIN: that is the defect. And why not drop notes from
-- the view: the Site Admin list reads it with select("*"), and a view that omits a column the editor
-- needs would push the detail page back onto the base table.
-- =====================================================================================================

-- 1 + 2. The base table stops being readable column-wide by every session.
revoke select on public.club_directory from authenticated;

grant select (
  -- the 17 public directory facts, unchanged, matching anon's own grant
  id, name, rugby_code, country, nation, region, county, town, home_ground, postcode,
  website, logo_storage_path, bio, facebook_url, active, verification_status, constituent_body,
  -- plus the three an ordinary signed-in surface genuinely reads
  latitude, longitude, geocode_status
) on public.club_directory to authenticated;

-- 3. The Site Admin projection answers to the capability, not to column privileges.
alter view public.admin_club_overview set (security_invoker = false);

comment on view public.admin_club_overview is
  'Site Admin club projection. OWNER-RIGHTS by design (Step 6, L17): its WHERE clause is '
  'internal.has_site_capability(''site.clubs.view''), which is the boundary, so the private '
  'club_directory columns it projects stay reachable for a Site Admin after the base table stopped '
  'being column-wide readable by every session.';

do $$
declare v_missing text := '';
begin
  -- The exposure is closed.
  if has_column_privilege('authenticated', 'public.club_directory', 'notes', 'SELECT') then
    raise exception 'STEP 6 L17: authenticated can still read club_directory.notes';
  end if;
  if has_column_privilege('authenticated', 'public.club_directory', 'official_email', 'SELECT') then
    raise exception 'STEP 6 L17: authenticated can still read club_directory.official_email';
  end if;
  if has_table_privilege('authenticated', 'public.club_directory', 'SELECT') then
    raise exception 'STEP 6 L17: a table-level SELECT still overrides the column grant';
  end if;

  -- And nothing legitimate was taken away.
  foreach v_missing in array array['id','name','rugby_code','country','nation','region','county','town',
                                   'home_ground','postcode','website','logo_storage_path','bio',
                                   'facebook_url','active','verification_status','constituent_body',
                                   'latitude','longitude','geocode_status']
  loop
    if not has_column_privilege('authenticated', 'public.club_directory', v_missing, 'SELECT') then
      raise exception 'STEP 6 L17: authenticated lost a column it legitimately reads: %', v_missing;
    end if;
  end loop;

  -- anon is untouched, and still narrower.
  if has_column_privilege('anon', 'public.club_directory', 'notes', 'SELECT')
     or has_column_privilege('anon', 'public.club_directory', 'latitude', 'SELECT') then
    raise exception 'STEP 6 L17: the anonymous grant was widened';
  end if;

  -- The Site Admin path still works, and still answers to the capability.
  if (select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.admin_club_overview'::regclass) like '%security_invoker=true%' then
    raise exception 'STEP 6 L17: admin_club_overview is still security_invoker and would lose the private columns';
  end if;
  if pg_get_viewdef('public.admin_club_overview'::regclass, true) !~ 'site\.clubs\.view' then
    raise exception 'STEP 6 L17: admin_club_overview lost its capability gate, which is now its only boundary';
  end if;

  raise notice 'Step 6 L17: a session is no longer a reason to read every club''s notes';
end $$;
