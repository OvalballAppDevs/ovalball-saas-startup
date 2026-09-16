-- Slice 4B (teams and roster) -- part 3 of 3: move the roster and team-identity row
-- policies onto the canonical capability decision, and retire the legacy team.view key.
--
-- Contract step. This is the migration that changes what people can read, so it lands
-- AFTER the application release that already reads the canonical keys (Phase 2 AL.2
-- expand/contract, proven by the 4B compatibility matrix).
--
-- The intended change of behaviour, and the only one:
--
--   A Fixtures Secretary can no longer read team rosters.
--
-- That is Phase 2 attack AI #70 ("Fixtures Secretary reads team rosters/family graph"
-- -> DENY, layer: bundle, test: roster_authority_matrix) and it is the worked example
-- the shadow comparison gives for an intended mismatch (AA.4). A Fixtures Secretary
-- holds team.team.view, so they still see that a team exists and what it is called;
-- they do not hold team.roster.view, so they no longer see who is in it. Seeing a
-- fixture has never required seeing the squad's family graph.
--
-- Everything else is preserved: a player reads their own place, an active guardian
-- reads their child's, and a site answer arrives through the canonical decision at
-- rule 7 SITE_CAPABILITY rather than through an is_site_admin() bypass.

-- 1. A player's place in a team ----------------------------------------------------------
drop policy if exists player_team_memberships_select on public.player_team_memberships;
create policy player_team_memberships_select on public.player_team_memberships
for select
using (
  internal.can('team.roster.view', 'team',
               (select t.club_id from public.teams t where t.id = player_team_memberships.team_id),
               player_team_memberships.team_id, null)
  or internal.is_own_linked_player(player_id)
  or internal.is_active_player_guardian(player_id)
);

comment on policy player_team_memberships_select on public.player_team_memberships is
  'Slice 4B: reading a team''s roster is team.roster.view, answered by the canonical decision at the team''s '
  'scope or inherited from the club. A player still reads their own place and an active guardian their '
  'child''s. The Fixtures Secretary branch is deliberately gone (AI #70): fixture authority is not roster '
  'authority.';

-- 2. What a team was called in a season that has happened ---------------------------------
drop policy if exists team_season_identity_select on public.team_season_identity;
create policy team_season_identity_select on public.team_season_identity
for select
using (
  internal.can('team.team.view', 'team',
               (select t.club_id from public.teams t where t.id = team_season_identity.team_id),
               team_season_identity.team_id, null)
);

comment on policy team_season_identity_select on public.team_season_identity is
  'Slice 4B: a team''s recorded identity for a past season is a team.team.view question -- identity and name, '
  'never the roster. The Fixtures Secretary holds team.team.view and so keeps reading it. Historical rows stay '
  'historical and are not re-spelled by this change.';

-- 3. Retire the legacy team.view key ------------------------------------------------------
--
-- team.view was renamed to team.team.view in the Slice 3 catalogue (J.6 line 418), and
-- the adapter row in capability_key_map has been answering legacy calls ever since. The
-- application no longer calls it, so the adapter row and the dead default rows go.
--
-- role_capability_defaults is not a table and holds nothing of its own: it is a derived
-- compatibility VIEW over capability_key_map, capabilities and bundle_capabilities, and it
-- only ever showed a "club default" for team.view because the adapter row existed. Removing
-- the adapter row is therefore the whole removal -- the club default disappears from the view
-- with it, and there is nothing to delete separately. The view is dropped in Slice 10 with
-- the other compatibility objects.
--
-- internal.has_capability reads neither: since Slice 3 it resolves legacy keys through
-- capability_key_map and delegates to internal.can. A caller passing 'team.view' after this
-- migration gets no adapter row and is answered on 'team.view' itself, which is DEPRECATED
-- and therefore refused by rule 1 -- fail closed, not a silent allow.

delete from public.capability_key_map where legacy_key = 'team.view';

update public.capabilities set status = 'DEPRECATED' where key = 'team.view';

-- The club default is gone because the adapter row is gone. Proven here rather than assumed.
do $$
declare v_rows int;
begin
  select count(*) into v_rows from public.role_capability_defaults where capability_key = 'team.view';
  if v_rows <> 0 then
    raise exception 'team.view still yields % club/team default row(s) after removing its adapter row.', v_rows;
  end if;
end $$;
