-- Reconciliation complaint 32: the Site Admin master directory must
-- present one real rugby match as one logical row, never showing a
-- legacy mirror pair (two fixtures rows, one per club, linked by
-- fixtures.mirror_fixture_id, from before the Master Fixture Registry
-- consolidation) as two separate visible rows. admin_fixture_overview
-- never exposed mirror_fixture_id at all, so the app-layer query had
-- nothing to filter a pair down to one row with. This is presentation-
-- layer plumbing only -- the underlying mirror sync RPCs and both
-- fixtures rows are completely untouched.
--
-- is_primary_mirror is a computed boolean (true for an unmirrored
-- fixture, or the lexicographically-smaller id of a pair -- an arbitrary
-- but deterministic and stable rule) so the app can filter with a plain
-- .eq('is_primary_mirror', true) that stays correct across pagination,
-- rather than an in-memory per-page filter that could split a pair
-- across two pages.
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
  f.competition_edition_id,
  f.pitch_id,
  f.season_id,
  case when f.home_away = 'Away' then coalesce(opp_cd.name, f.raw_opposition_text) else cd.name end as home_club_name,
  case when f.home_away = 'Away' then opp_t.display_name else t.display_name end as home_team_name,
  case when f.home_away = 'Away' then cd.name else coalesce(opp_cd.name, f.raw_opposition_text) end as away_club_name,
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
  case when f.home_away = 'Away' then f.opponent_directory_id else cd.id end as home_club_directory_id,
  case when f.home_away = 'Away' then cd.id else f.opponent_directory_id end as away_club_directory_id,
  s.name as season_canonical_name,
  cp.display_name as pitch_name,
  f.mirror_fixture_id,
  (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id) as is_primary_mirror
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id
left join public.seasons s on s.id = f.season_id
left join public.club_pitches cp on cp.id = f.pitch_id;

comment on view public.admin_fixture_overview is
  'The Master Fixture Registry''s Site Admin read model -- ONE row per real fixture. home_club_name/home_team_name/away_club_name/away_team_name are a display fallback for unresolved opponents; home_team_category/age_group/gender/squad_designation (and the away_ equivalents) are the structured fields the app runs through fullTeamLabel (lib/teams/compact-label.ts) to render the true canonical name whenever a real team is resolved -- never the raw, sometimes-stale teams.display_name. season_canonical_name/pitch_name are the human-readable companions to season_id/pitch_id for CSV export (Reconciliation complaints 20-25); home_team_id/away_team_id/home_club_directory_id/away_club_directory_id are the stable ids the same export round-trips on. mirror_fixture_id/is_primary_mirror (Reconciliation complaint 32) are set only on the small number of legacy pre-consolidation fixtures that still exist as a mirror pair -- the app-layer query filters on is_primary_mirror so the main Site Admin table presents just one side of each pair, never both; the other side stays reachable from the fixture detail page.';
