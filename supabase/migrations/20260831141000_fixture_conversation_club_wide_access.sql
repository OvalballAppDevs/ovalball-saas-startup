-- internal.can_access_fixture_conversation's fixture_request_id branch
-- (20260831093000_partner_clubs_and_fixture_messages.sql) explicitly ORs in
-- can_manage_club_fixtures on both clubs -- so a Fixture Secretary (club-
-- wide fixture authority, but not CLUB_ADMIN and not necessarily holding a
-- direct team_permissions row) can read/send in a still-negotiating
-- request's conversation. Its fixture_id branch only checked
-- can_manage_team, which covers CLUB_ADMIN (baked into can_manage_team
-- itself) but NOT FIXTURE_SECRETARY. Found by testing the "Club Admin /
-- Fixture Secretary may access relevant club-wide fixture conversations"
-- requirement against an ACCEPTED request's resulting fixture, not just a
-- pending request -- a Fixture Secretary lost conversation access the
-- moment a request they could see got accepted, if they weren't also
-- separately assigned to that specific team. Brings the fixture_id branch
-- into the same shape as the fixture_request_id branch; grants nothing new
-- to anyone who wasn't already covered on the request side.
create or replace function internal.can_access_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_site_admin()
    or (p_fixture_id is not null and exists (
      select 1 from public.fixtures f
      where f.id = p_fixture_id
        and (internal.can_manage_team(f.owning_team_id)
             or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id))
             or internal.can_manage_club_fixtures((select club_id from public.teams where id = f.owning_team_id))
             or (f.opponent_team_id is not null
                 and internal.can_manage_club_fixtures((select club_id from public.teams where id = f.opponent_team_id))))
    ))
    or (p_fixture_request_id is not null and exists (
      select 1 from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
      where r.id = p_fixture_request_id
        and (internal.can_manage_team(r.requesting_team_id)
             or (r.target_team_id is not null and internal.can_manage_team(r.target_team_id))
             or internal.can_manage_club_fixtures(g.requesting_club_id)
             or (g.opponent_club_id is not null and internal.can_manage_club_fixtures(g.opponent_club_id)))
    ));
$$;
