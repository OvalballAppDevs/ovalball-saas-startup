-- profiles_select_self_or_admin (20260830143512_rls_policies_and_triggers.sql)
-- only ever let a user read their own profile, or Site Admin read any --
-- no clause let a Club Admin read the profiles of their own club's other
-- members. That's not hypothetical: found via an actual live walkthrough
-- of /people, whose entire purpose is "who has access to this club" --
-- every single person's name rendered as "Unknown" because the page's own
-- profiles query returned nothing for anyone but the viewer. Scoped as
-- narrowly as the bug requires: a Club Admin sees the profile of someone
-- only when that person is an ACTIVE member of a club the viewer actively
-- administers -- never a general "any authenticated user reads any
-- profile" grant, and deliberately not extended to Fixture Secretary
-- (reading member names for people-management purposes stays behind the
-- same CLUB_ADMIN boundary as the rest of /people).
create policy profiles_select_club_admin on public.profiles for select
  using (
    exists (
      select 1
      from public.club_memberships viewer
      join public.club_memberships target
        on target.club_id = viewer.club_id
        and target.user_id = profiles.id
        and target.status = 'active'
      where viewer.user_id = (select auth.uid())
        and viewer.role = 'CLUB_ADMIN'
        and viewer.status = 'active'
    )
  );
