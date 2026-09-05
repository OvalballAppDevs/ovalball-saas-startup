-- ============================================================
-- Reconciliation pass, complaint 7: "Home side must ALSO be properly
-- editable." Home Club, Home Team, Away Club, Away Team must be editable
-- as separate structural operations: change home team / change away team
-- / swap sides -- not conflated into one thing.
--
-- The existing pieces before this migration:
--   - update_fixture_opposition (20260905000000): edits the OPPONENT side
--     (opponent_team_id / opponent_directory_id / raw_opposition_text) --
--     whichever of Home/Away that currently is, driven by home_away.
--   - swap_fixture_home_away (20260905000000): atomically flips which
--     already-resolved side is Home vs Away, keeping score orientation
--     correct.
-- Missing: any way to correct the OWNING side's team identity (i.e. "we
-- created this fixture under the wrong one of our own teams" -- e.g.
-- picked Under 12 when it should have been Under 13). That's what this
-- migration adds. Reassigning the owning side to a DIFFERENT CLUB is
-- deliberately not offered here -- owning_team_id anchors which club's
-- roster, RLS, and negotiation history this fixture belongs to, so a
-- cross-club reassignment is not a safe "edit," it's really a new
-- fixture. Team Directory / real Team Directory identity is not
-- involved here either -- the new owning team must be one of the SAME
-- CLUB's own real, active teams (never a Team Directory row that club
-- doesn't operate), mirroring the same "Your Team" invariant Create
-- Fixture already enforces (complaint 4).
-- ============================================================

create or replace function public.update_fixture_owning_team(p_fixture_id uuid, p_new_owning_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_current_team public.teams;
  v_new_team public.teams;
  v_before jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  if not (internal.is_site_admin()
          or internal.can_manage_team(v_fixture.owning_team_id)
          or internal.can_manage_club_fixtures((select club_id from public.teams where id = v_fixture.owning_team_id))) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;

  select * into v_current_team from public.teams where id = v_fixture.owning_team_id;

  select * into v_new_team from public.teams where id = p_new_owning_team_id;
  if not found then raise exception 'That team does not exist.'; end if;
  if not v_new_team.active then raise exception 'That team is not currently active.'; end if;
  if v_new_team.club_id is distinct from v_current_team.club_id then
    raise exception 'The home team can only be changed to another active team at the same club -- reassigning a fixture to a different club is not supported as an edit.' using errcode = 'P0001';
  end if;
  if v_new_team.rugby_code is distinct from v_current_team.rugby_code then
    raise exception 'That team plays a different rugby code to this fixture.' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object('owning_team_id', v_fixture.owning_team_id);

  update public.fixtures
  set owning_team_id = p_new_owning_team_id,
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), v_before, jsonb_build_object('owning_team_id', p_new_owning_team_id));
end;
$$;

revoke execute on function public.update_fixture_owning_team(uuid, uuid) from public;
grant execute on function public.update_fixture_owning_team(uuid, uuid) to authenticated;

comment on function public.update_fixture_owning_team is
  'Corrects WHICH of a club''s own real, active teams owns this fixture record -- distinct from update_fixture_opposition (which corrects the opponent side) and swap_fixture_home_away (which flips which resolved side is Home). Never crosses clubs; that would be a new fixture, not an edit.';
