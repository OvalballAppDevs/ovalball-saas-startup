-- profiles_select_club_admin (20260831160000_profiles_club_admin_read.sql)
-- fixed the "Unknown everywhere on /people" bug by granting a Club Admin
-- row-level SELECT on any active club member's `profiles` row -- but RLS is
-- a row-level mechanism, not a column-level one. Once a row is readable,
-- every column the `authenticated` role has a GRANT on (which, under
-- Supabase's default schema privileges, is all of them) is readable too --
-- including date_of_birth and the three home-address lines. Nothing in the
-- product needs a Club Admin to see another member's date of birth or home
-- address, and many members of a rugby club are minors: leaving that
-- readable via a direct table query (e.g. from the browser console with a
-- Club Admin's own session, bypassing every page's own narrower select())
-- is broader than the feature ever required. This replaces the row policy
-- with a SECURITY DEFINER function that returns only the four columns any
-- club-administration screen actually uses (name + email), scoped by the
-- same "active Club Admin of an active fellow member's club" relationship
-- as before -- via the existing internal.is_club_admin() helper, so the
-- authorization check itself doesn't drift from every other Club-Admin-
-- gated function in this schema -- plus internal.is_site_admin(), since
-- /people and /teams/[teamId] both already let Site Admin manage any
-- club's people and both callers (people/page.tsx, teams/[teamId]/page.tsx)
-- switch from a direct table select to this function; without that second
-- clause a Site Admin viewing either page would regress to "Unknown" for
-- every name despite still being allowed to edit. The raw `profiles` table
-- no longer grants any cross-member row access at all: self and Site Admin
-- (profiles_select_self_or_admin, unchanged) remain the only row-level
-- readers of the base table.
drop policy profiles_select_club_admin on public.profiles;

create or replace function public.get_club_member_directory(p_club_id uuid)
returns table (user_id uuid, first_name text, surname text, email text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.first_name, p.surname, p.email
  from public.profiles p
  join public.club_memberships target
    on target.user_id = p.id
    and target.club_id = p_club_id
    and target.status = 'active'
  where internal.is_club_admin(p_club_id) or internal.is_site_admin();
$$;

revoke all on function public.get_club_member_directory(uuid) from public;
grant execute on function public.get_club_member_directory(uuid) to authenticated;
