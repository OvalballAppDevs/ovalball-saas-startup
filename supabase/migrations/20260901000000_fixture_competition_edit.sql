-- Competition becomes a real, editable field on a fixture -- Club
-- Admin/Fixtures Secretary at the owning club (or Site Admin) can select
-- which competition_edition a fixture belongs to, matching the same
-- "operational field, real RPC boundary" pattern already used for pitch
-- allocation (update_fixture_pitch).

-- admin_fixture_overview already exposed the joined competition_name but
-- never the raw competition_edition_id an edit control needs to know the
-- current selection -- appended at the end, CREATE OR REPLACE VIEW
-- requires every existing column to keep its original position.
create or replace view public.admin_fixture_overview
  with (security_invoker = true) as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.status,
  f.game_type,
  f.source,
  f.import_batch_id,
  f.replaces_fixture_id,
  f.raw_opposition_text,
  f.opponent_directory_id,
  f.opponent_team_id,
  f.season_label,
  f.notes,
  f.cancelled_at,
  f.cancellation_reason,
  f.created_at,
  f.updated_at,
  t.id as owning_team_id,
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  opp_cd.name as opponent_club_name,
  opp_t.display_name as opponent_team_name,
  comp.name as competition_name,
  v.name as venue_name,
  (select count(*) from public.fixture_messages fm where fm.fixture_id = f.id) as message_count,
  c.logo_storage_path as owning_club_logo_path,
  opp_c.id as opponent_club_id,
  opp_c.logo_storage_path as opponent_club_logo_path,
  f.pitch_allocation,
  f.home_score,
  f.away_score,
  f.result_status,
  f.result_submitted_at,
  f.result_confirmed_at,
  f.result_amendment_proposed_home_score,
  f.result_amendment_proposed_away_score,
  f.competition_edition_id
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id;

-- Same participating-club-official boundary as update_fixture_pitch, but
-- deliberately narrower to the OWNING club only (can_submit_fixture_result
-- also grants the opponent side, which is right for a bilateral pitch
-- allocation but wrong here -- competition classification is the owning
-- club's call, same as who created the fixture in the first place).
create or replace function public.update_fixture_competition(p_fixture_id uuid, p_competition_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_owning_club_id uuid;
  v_team_rugby_code text;
  v_edition_rugby_code text;
begin
  select owning_team_id into v_owning_team_id from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  select club_id, rugby_code into v_owning_club_id, v_team_rugby_code from public.teams where id = v_owning_team_id;

  if not (internal.can_manage_club_fixtures(v_owning_club_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to set the competition for this fixture.' using errcode = '42501';
  end if;

  if p_competition_edition_id is not null then
    select rugby_code into v_edition_rugby_code from public.competition_editions where id = p_competition_edition_id and active = true;
    if v_edition_rugby_code is null then
      raise exception 'Competition not found.';
    end if;
    if v_edition_rugby_code <> v_team_rugby_code then
      raise exception 'That competition is for a different code (%) than this fixture (%).', v_edition_rugby_code, v_team_rugby_code;
    end if;
  end if;

  update public.fixtures set competition_edition_id = p_competition_edition_id where id = p_fixture_id;
end;
$$;

revoke execute on function public.update_fixture_competition(uuid, uuid) from public;
grant execute on function public.update_fixture_competition(uuid, uuid) to authenticated;
