-- CLUBHOUSE PROGRAMME SECTION 5 -- PARTNERS: THE CANONICAL, AUTHORITY-SAFE TEAM-CONTEXT READ.
--
-- Sections 1/2 found and documented a real defect: club_partnerships_select_scoped RLS only returns
-- rows to a caller holding club.partners.manage at CLUB scope. A legitimate Team-context Coach or Team
-- Manager -- who genuinely needs to know "is this opposition club one of our club's partners" to
-- coordinate a fixture -- never holds that capability (club.partners.manage's own valid_scopes is
-- {club} only, confirmed live; it cannot even be granted at team scope). Section 2 made the resulting
-- silence honest ("unknown", never a false "not partnered"); this migration closes it properly rather
-- than leaving "unknown" as the permanent answer for a whole class of legitimate staff.
--
-- READ != MANAGE. This function answers exactly one narrow question -- "what is my club's partnership
-- state against each of these other clubs" -- for a caller who holds real fixture authority
-- (fixture.request.create or fixture.request.respond) at the named TEAM. It never grants
-- club.partners.manage, never lets the caller accept/decline/revoke (those RPCs re-check their own
-- authority independently and are entirely unchanged by this migration), and never returns anything
-- beyond the same four columns the existing club-scope RLS path already exposes to a club.partners.
-- manage holder (id, requesting_club_id, partner_club_id, status) -- no requester name, no contact
-- email, no internal notes, no timestamps beyond what the caller could already infer from status.
--
-- THE CLUB IS DERIVED FROM THE TEAM SERVER-SIDE, NEVER TRUSTED FROM THE CLIENT. Exactly the same
-- pattern get_partner_team_availability and my_capabilities(scope_type='team') already use: the caller
-- supplies a team id, the function looks up that team's own club_id, and authority is checked against
-- the caller's REAL membership at that specific team -- a client-supplied club id is never treated as
-- proof of anything.
create or replace function public.get_team_club_partnerships(p_team_id uuid)
returns table(id uuid, requesting_club_id uuid, partner_club_id uuid, status text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_club_id uuid;
begin
  select t.club_id into v_club_id from public.teams t where t.id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not (
    internal.can('fixture.request.create', 'team', v_club_id, p_team_id, null)
    or internal.can('fixture.request.respond', 'team', v_club_id, p_team_id, null)
  ) then
    raise exception 'You do not have fixture authority for this team.' using errcode = '42501';
  end if;

  return query
  select cp.id, cp.requesting_club_id, cp.partner_club_id, cp.status
  from public.club_partnerships cp
  where cp.status <> 'revoked'
    and (cp.requesting_club_id = v_club_id or cp.partner_club_id = v_club_id);
end;
$$;

revoke execute on function public.get_team_club_partnerships(uuid) from public;
grant execute on function public.get_team_club_partnerships(uuid) to authenticated;

comment on function public.get_team_club_partnerships(uuid) is
  'Clubhouse Programme Section 5: the canonical partnership READ for a Team-context viewer who holds real fixture authority (fixture.request.create/.respond) at the named team, but not club.partners.manage. Returns the same minimal shape club_partnerships_select_scoped already exposes to a club.partners.manage holder -- never a second, richer projection. Management stays exclusively on respond_to_club_partnership/revoke_club_partnership, both unchanged and independently authority-checked.';
