-- =====================================================================================================
-- SLICE 7 (6/n) -- Users & Access can see the state it can now set.
--
-- site_set_account_state separates SUSPENDED from DISABLED, because they are different capabilities:
-- SITE_SUPPORT may suspend and reinstate, only SITE_FULL may switch an account off. The Users & Access
-- screen reads admin_user_overview, which carried only profiles.account_status -- the two-valued
-- compatibility column that predates account_state and cannot express DISABLED at all.
--
-- Without this the screen would offer Disable Account and then report the account as Active, which is
-- worse than not offering it: an administrator would reasonably conclude the action had failed and do
-- it again. The canonical column is added ALONGSIDE the compatibility one rather than replacing it,
-- because the existing status filters read account_status and that column retires on its own
-- schedule, not on this one's. It is appended last so no existing column's position moves under a
-- consumer doing select *.
-- =====================================================================================================
-- security_invoker = true is RESTATED, not inherited.
--
-- `create or replace view` does not carry the existing reloptions across, so recreating this view
-- without the clause silently turned it into an owner-rights view -- one that reads profiles,
-- site_admins and club_memberships with RLS switched off, for anybody permitted to select from it.
-- The perimeter guard caught it ("owner-rights view that is not a public projection"), which is what
-- that guard is for; it is repeated here because the next person to add a column will use this
-- statement as the template.
create or replace view public.admin_user_overview with (security_invoker = true) as
 SELECT p.id AS user_id,
    p.first_name,
    p.surname,
    p.email,
    p.created_at AS user_created_at,
    sa.user_id IS NOT NULL AS is_site_admin,
    COALESCE(memberships.data, '[]'::jsonb) AS memberships,
    COALESCE(pending.data, '[]'::jsonb) AS pending_requests,
    memberships.club_names,
    memberships.team_names,
    COALESCE(memberships.has_active_membership, false) AS has_active_membership,
    COALESCE(memberships.highest_role, 0) AS highest_role,
    COALESCE(memberships.has_club_admin, false) AS has_club_admin,
    COALESCE(memberships.has_fixtures_admin, false) AS has_fixtures_admin,
    COALESCE(memberships.has_team_admin, false) AS has_team_admin,
    jsonb_array_length(COALESCE(pending.data, '[]'::jsonb)) > 0 AS has_pending_request,
    p.account_status,
    p.account_state
   FROM profiles p
     LEFT JOIN site_admins sa ON sa.user_id = p.id AND sa.status = 'active'::text
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('membershipId', cm.id, 'clubId', c.id, 'directoryId', cd.id, 'clubName', cd.name, 'role', cm.role, 'clubRoleTitle', cm.club_role_title, 'status', cm.status, 'teamRoles', COALESCE(tp.data, '[]'::jsonb)) ORDER BY cm.created_at) AS data,
            string_agg(DISTINCT cd.name, ', '::text) AS club_names,
            string_agg(DISTINCT tp.names, ', '::text) FILTER (WHERE tp.names IS NOT NULL) AS team_names,
            bool_or(cm.status = 'active'::text) AS has_active_membership,
            max(
                CASE cm.role
                    WHEN 'CLUB_ADMIN'::text THEN 3
                    WHEN 'FIXTURE_SECRETARY'::text THEN 2
                    WHEN 'BASIC_USER'::text THEN 1
                    ELSE 0
                END) AS highest_role,
            bool_or(cm.status = 'active'::text AND cm.role = 'CLUB_ADMIN'::text) AS has_club_admin,
            bool_or(cm.status = 'active'::text AND cm.role = 'FIXTURE_SECRETARY'::text) AS has_fixtures_admin,
            bool_or(cm.status = 'active'::text AND (EXISTS ( SELECT 1
                   FROM team_permissions tp3
                  WHERE tp3.membership_id = cm.id AND (tp3.permission = ANY (ARRAY['team_admin'::text, 'coach'::text, 'manager'::text]))))) AS has_team_admin
           FROM club_memberships cm
             JOIN clubs c ON c.id = cm.club_id
             JOIN club_directory cd ON cd.id = c.directory_id
             LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('teamId', t.id, 'teamName', t.display_name, 'permission', tp2.permission)) AS data,
                    string_agg(t.display_name, ', '::text) AS names
                   FROM team_permissions tp2
                     JOIN teams t ON t.id = tp2.team_id
                  WHERE tp2.membership_id = cm.id) tp ON true
          WHERE cm.user_id = p.id AND (cm.state <> ALL (ARRAY['PENDING'::text, 'DECLINED'::text, 'EXPIRED'::text]))) memberships ON true
     LEFT JOIN LATERAL ( SELECT jsonb_agg(sub.x) AS data
           FROM ( SELECT jsonb_build_object('type', 'claim', 'clubName', cd2.name, 'role', cc.claimed_role, 'status', cc.status, 'createdAt', cc.created_at) AS x
                   FROM club_claims cc
                     JOIN club_directory cd2 ON cd2.id = cc.directory_id
                  WHERE cc.claimant_user_id = p.id AND cc.status = 'pending'::text
                UNION ALL
                 SELECT jsonb_build_object('type', 'join_request', 'clubName', cd3.name, 'role', cjr.requested_role, 'status', cjr.status, 'createdAt', cjr.created_at) AS x
                   FROM club_join_requests cjr
                     JOIN clubs c3 ON c3.id = cjr.club_id
                     JOIN club_directory cd3 ON cd3.id = c3.directory_id
                  WHERE cjr.requesting_user_id = p.id AND cjr.status = 'pending'::text) sub) pending ON true;

do $$
begin
  if pg_get_viewdef('public.admin_user_overview'::regclass, true) !~ '\maccount_state\M' then
    raise exception 'Slice 7: admin_user_overview still cannot express a disabled account';
  end if;
  if not exists (select 1 from pg_class
                  where relname = 'admin_user_overview'
                    and reloptions @> array['security_invoker=true']) then
    raise exception 'Slice 7: admin_user_overview is an owner-rights view -- it would read profiles with RLS off';
  end if;
  raise notice 'Slice 7: Users & Access reads the canonical account state';
end $$;
