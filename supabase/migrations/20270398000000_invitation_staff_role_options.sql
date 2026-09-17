-- =====================================================================================================
-- SLICE 5 (17/n) -- the invite form's options come from the role catalogue
--
-- The People & Access invite form offered "Club Admin / Fixture Secretary" and "Team Admin / Coach /
-- Manager" from lists written in TypeScript, in words that are not role keys. Every one of them then
-- had to be translated back into a canonical role somewhere, and a translation table is a second
-- catalogue: it drifts, and it drifts silently, because nothing fails when it disagrees.
--
-- So the options come from public.role_definitions, narrowed to what O.1 allows a CLUB_STAFF
-- invitation to carry. Two things fall out of that for free. Team Administration disappears from the
-- form, because it is already `visible = false` in the catalogue -- it is a capability bundle held on
-- top of Coach or Team Manager, not a role somebody is invited into. And "Fixture Secretary" becomes
-- "Fixtures Secretary", because that is what the role is actually called.
-- =====================================================================================================

create or replace function public.invitation_staff_role_options()
returns table (role_key text, label text, held_at_team boolean)
language sql stable security definer set search_path = '' as $$
  select rd.role_key, rd.label, rd.scope = 'TEAM'
    from public.role_definitions rd
   where rd.role_key = any (internal.invitation_club_staff_ceiling())
     and rd.visible
   order by (rd.scope = 'TEAM'), rd.label;
$$;

comment on function public.invitation_staff_role_options() is
  'The roles a CLUB_STAFF invitation may carry, from the role catalogue, so the invite form and the '
  'issuer cannot disagree about what a staff invitation can produce.';

revoke all on function public.invitation_staff_role_options() from public, anon;
grant execute on function public.invitation_staff_role_options() to authenticated;

do $$
declare v_n int; v_team int;
begin
  select count(*), count(*) filter (where held_at_team) into v_n, v_team
    from public.invitation_staff_role_options();
  if v_n = 0 then
    raise exception 'Slice 5: the invite form would have no roles to offer.';
  end if;
  if v_team = 0 then
    raise exception 'Slice 5: the invite form would have no team roles to offer.';
  end if;
  if exists (select 1 from public.invitation_staff_role_options() where role_key = 'TEAM_ADMINISTRATION') then
    raise exception 'Slice 5: Team Administration is offered as something to be invited into.';
  end if;
  raise notice 'Slice 5: % staff roles offered, % of them held at a team', v_n, v_team;
end $$;
