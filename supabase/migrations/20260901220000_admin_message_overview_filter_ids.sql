-- admin_message_overview needs raw club_id/team_id columns (not just
-- names) so the Message Management console can filter accurately via a
-- real club/team dropdown rather than matching on display name (which
-- can collide). Appended at the end, same CREATE OR REPLACE VIEW
-- column-order rule as every other view migration in this session.
create or replace view public.admin_message_overview
  with (security_invoker = true) as
select
  coalesce(fm.fixture_id::text, 'req:' || fm.fixture_request_id::text) as conversation_key,
  case when fm.fixture_id is not null then 'fixture' else 'request' end as kind,
  fm.fixture_id,
  fm.fixture_request_id,
  count(*) as message_count,
  max(fm.created_at) as last_activity_at,
  min(fm.created_at) as first_message_at,
  count(*) filter (where fm.report_status = 'open') as open_report_count,
  count(*) filter (where fm.report_status = 'reviewed') as reviewed_report_count,
  bool_or(fm.report_status = 'open') as has_open_report,
  fx_owning_cd.name as fixture_owning_club_name,
  fx_opp_cd.name as fixture_opponent_club_name,
  fx_t.display_name as fixture_owning_team_name,
  req_cd.name as request_requesting_club_name,
  req_opp_cd.name as request_opponent_club_name,
  fx_opp_t.display_name as fixture_opponent_team_name,
  fx_c.logo_storage_path as fixture_owning_club_logo_path,
  fx_opp_c.logo_storage_path as fixture_opponent_club_logo_path,
  req_requesting_t.display_name as request_requesting_team_name,
  req_target_t.display_name as request_target_team_name,
  req_c.logo_storage_path as request_requesting_club_logo_path,
  req_opp_c.logo_storage_path as request_opponent_club_logo_path,
  fx_c.id as fixture_owning_club_id,
  fx_opp_c.id as fixture_opponent_club_id,
  fx_t.id as fixture_owning_team_id,
  fx_opp_t.id as fixture_opponent_team_id,
  req_c.id as request_requesting_club_id,
  req_opp_c.id as request_opponent_club_id,
  req_requesting_t.id as request_requesting_team_id,
  req_target_t.id as request_target_team_id
from public.fixture_messages fm
left join public.fixtures fx on fx.id = fm.fixture_id
left join public.teams fx_t on fx_t.id = fx.owning_team_id
left join public.clubs fx_c on fx_c.id = fx_t.club_id
left join public.club_directory fx_owning_cd on fx_owning_cd.id = fx_c.directory_id
left join public.club_directory fx_opp_cd on fx_opp_cd.id = fx.opponent_directory_id
left join public.teams fx_opp_t on fx_opp_t.id = fx.opponent_team_id
left join public.clubs fx_opp_c on fx_opp_c.id = fx_opp_t.club_id
left join public.fixture_requests freq on freq.id = fm.fixture_request_id
left join public.fixture_request_groups frg on frg.id = freq.group_id
left join public.clubs req_c on req_c.id = frg.requesting_club_id
left join public.club_directory req_cd on req_cd.id = req_c.directory_id
left join public.clubs req_opp_c on req_opp_c.id = frg.opponent_club_id
left join public.club_directory req_opp_cd on req_opp_cd.id = req_opp_c.directory_id
left join public.teams req_requesting_t on req_requesting_t.id = freq.requesting_team_id
left join public.teams req_target_t on req_target_t.id = freq.target_team_id
group by
  fm.fixture_id, fm.fixture_request_id, fx_owning_cd.name, fx_opp_cd.name, fx_t.display_name, fx_opp_t.display_name,
  fx_c.logo_storage_path, fx_opp_c.logo_storage_path,
  req_cd.name, req_opp_cd.name, req_requesting_t.display_name, req_target_t.display_name,
  req_c.logo_storage_path, req_opp_c.logo_storage_path,
  fx_c.id, fx_opp_c.id, fx_t.id, fx_opp_t.id, req_c.id, req_opp_c.id, req_requesting_t.id, req_target_t.id;

grant select on public.admin_message_overview to authenticated;
