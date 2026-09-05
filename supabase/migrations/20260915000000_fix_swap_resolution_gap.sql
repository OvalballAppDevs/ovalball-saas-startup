-- Reconciliation fix: admin_fixture_overview's resolved/name/directory-id
-- expressions for the opponent side only ever checked opponent_directory_id
-- (a directory-only, unclaimed-club identity) and never fell back to a real
-- resolved team (opponent_team_id -> teams -> clubs), even though the
-- schema has always allowed a resolved opponent to have a real team and no
-- directory id at all (see the original architectural comment on
-- swap_fixture_home_away: "the new opponent ... is always a real resolved
-- team, never directory-only"). swap_fixture_home_away exploits exactly
-- that by nulling opponent_directory_id on swap -- which the view then
-- misread as "unresolved", producing "Unresolved Club Name" for a
-- genuinely resolved participant. Fix: treat a side as resolved, and name
-- it, from EITHER the directory join OR the team-derived club join, never
-- directory-only.

drop view public.admin_fixture_overview;

create view public.admin_fixture_overview as
select
  f.id,
  f.owning_team_id,
  f.home_away,
  f.kickoff_date,
  f.kickoff_time,
  f.game_type,
  f.status,
  f.source,
  f.venue_id,
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
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  coalesce(opp_cd.name, opp_c_cd.name) as opponent_club_name,
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
  f.competition_edition_id,
  f.pitch_id,
  f.season_id,
  case when f.home_away = 'Away' then coalesce(opp_cd.name, opp_c_cd.name, f.raw_opposition_text) else cd.name end as home_club_name,
  case when f.home_away = 'Away' then opp_t.display_name else t.display_name end as home_team_name,
  case when f.home_away = 'Away' then cd.name else coalesce(opp_cd.name, opp_c_cd.name, f.raw_opposition_text) end as away_club_name,
  case when f.home_away = 'Away' then t.display_name else opp_t.display_name end as away_team_name,
  case when f.home_away = 'Away' then opp_t.category else t.category end as home_team_category,
  case when f.home_away = 'Away' then opp_t.age_group else t.age_group end as home_team_age_group,
  case when f.home_away = 'Away' then opp_t.gender else t.gender end as home_team_gender,
  case when f.home_away = 'Away' then opp_t.squad_designation else t.squad_designation end as home_team_squad_designation,
  case when f.home_away = 'Away' then t.category else opp_t.category end as away_team_category,
  case when f.home_away = 'Away' then t.age_group else opp_t.age_group end as away_team_age_group,
  case when f.home_away = 'Away' then t.gender else opp_t.gender end as away_team_gender,
  case when f.home_away = 'Away' then t.squad_designation else opp_t.squad_designation end as away_team_squad_designation,
  opp_t.category as opponent_team_category,
  opp_t.age_group as opponent_team_age_group,
  opp_t.gender as opponent_team_gender,
  opp_t.squad_designation as opponent_team_squad_designation,
  opp_t.rugby_code as opponent_team_rugby_code,
  f.home_team_id,
  f.away_team_id,
  case when f.home_away = 'Away' then coalesce(f.opponent_directory_id, opp_c_cd.id) else cd.id end as home_club_directory_id,
  case when f.home_away = 'Away' then cd.id else coalesce(f.opponent_directory_id, opp_c_cd.id) end as away_club_directory_id,
  s.name as season_canonical_name,
  cp.display_name as pitch_name,
  f.mirror_fixture_id,
  (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id) as is_primary_mirror,
  case when f.home_away = 'Away' then (opp_cd.id is not null or opp_c.id is not null) else true end as home_club_resolved,
  case when f.home_away = 'Away' then true else (opp_cd.id is not null or opp_c.id is not null) end as away_club_resolved
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.club_directory opp_c_cd on opp_c_cd.id = opp_c.directory_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id
left join public.seasons s on s.id = f.season_id
left join public.club_pitches cp on cp.id = f.pitch_id;

grant select on public.admin_fixture_overview to authenticated, anon;
