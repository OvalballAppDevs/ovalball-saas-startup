-- RESUME SEASON HANDOVER Section 6 fixture-surface audit finding:
-- admin_fixture_overview (powers both Fixture Detail and Site Admin
-- Fixture Management) computed its structured team-identity columns
-- (home/away/owning/opponent category, age_group, gender,
-- squad_designation, display_name) by joining directly to the LIVE
-- teams table. That is NOT season-aware: the instant a team's live row
-- progresses (automatic handover, a manual rollover, a Mini-Rugby
-- re-grouping), every historical AND future fixture on these two
-- surfaces would silently relabel itself with today's identity instead
-- of the identity that actually applied for that fixture's own season
-- -- exactly the class of bug the canonical get_team_identity_for_season
-- resolver (team_season_identity snapshot -> projection -> live
-- fallback) exists to prevent, and which Calendar/Fixture Management
-- already avoid by consuming that resolver.
--
-- Fixed by joining through public.get_team_identity_for_season(team_id,
-- fixture.season_id) instead of the live teams row directly, for both
-- the owning team and the opponent team. This is not a second resolver:
-- it is the same canonical function every other season-aware surface
-- already calls. A LEFT JOIN LATERAL ... ON true degrades correctly
-- when there is no opponent team (recreational/opposition-text-only
-- fixtures) or no season_id (the column is nullable, even though no
-- real row currently has one) -- the function itself already falls
-- back to the live team row in both of those cases, so this migration
-- introduces no new null-handling logic of its own.
create or replace view public.admin_fixture_overview as
select f.id,
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
    owning_ident.display_name as owning_team_name,
    t.rugby_code,
    owning_ident.category as owning_team_category,
    c.id as owning_club_id,
    cd.id as owning_directory_id,
    cd.name as owning_club_name,
    coalesce(opp_cd.name, opp_c_cd.name) as opponent_club_name,
    opp_ident.display_name as opponent_team_name,
    comp.name as competition_name,
    v.name as venue_name,
    (select count(*) from fixture_messages fm where fm.fixture_id = f.id) as message_count,
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
    case when f.home_away = 'Away' then opp_ident.display_name else owning_ident.display_name end as home_team_name,
    case when f.home_away = 'Away' then cd.name else coalesce(opp_cd.name, opp_c_cd.name, f.raw_opposition_text) end as away_club_name,
    case when f.home_away = 'Away' then owning_ident.display_name else opp_ident.display_name end as away_team_name,
    case when f.home_away = 'Away' then opp_ident.category else owning_ident.category end as home_team_category,
    case when f.home_away = 'Away' then opp_ident.age_group else owning_ident.age_group end as home_team_age_group,
    case when f.home_away = 'Away' then opp_ident.gender else owning_ident.gender end as home_team_gender,
    case when f.home_away = 'Away' then opp_ident.squad_designation else owning_ident.squad_designation end as home_team_squad_designation,
    case when f.home_away = 'Away' then owning_ident.category else opp_ident.category end as away_team_category,
    case when f.home_away = 'Away' then owning_ident.age_group else opp_ident.age_group end as away_team_age_group,
    case when f.home_away = 'Away' then owning_ident.gender else opp_ident.gender end as away_team_gender,
    case when f.home_away = 'Away' then owning_ident.squad_designation else opp_ident.squad_designation end as away_team_squad_designation,
    opp_ident.category as opponent_team_category,
    opp_ident.age_group as opponent_team_age_group,
    opp_ident.gender as opponent_team_gender,
    opp_ident.squad_designation as opponent_team_squad_designation,
    opp_t.rugby_code as opponent_team_rugby_code,
    f.home_team_id,
    f.away_team_id,
    case when f.home_away = 'Away' then coalesce(f.opponent_directory_id, opp_c_cd.id) else cd.id end as home_club_directory_id,
    case when f.home_away = 'Away' then cd.id else coalesce(f.opponent_directory_id, opp_c_cd.id) end as away_club_directory_id,
    s.name as season_canonical_name,
    cp.display_name as pitch_name,
    f.mirror_fixture_id,
    f.mirror_fixture_id is null or f.id < f.mirror_fixture_id as is_primary_mirror,
    case when f.home_away = 'Away' then opp_cd.id is not null or opp_c.id is not null else true end as home_club_resolved,
    case when f.home_away = 'Away' then true else opp_cd.id is not null or opp_c.id is not null end as away_club_resolved
   from fixtures f
     join teams t on t.id = f.owning_team_id
     join clubs c on c.id = t.club_id
     join club_directory cd on cd.id = c.directory_id
     left join club_directory opp_cd on opp_cd.id = f.opponent_directory_id
     left join teams opp_t on opp_t.id = f.opponent_team_id
     left join clubs opp_c on opp_c.id = opp_t.club_id
     left join club_directory opp_c_cd on opp_c_cd.id = opp_c.directory_id
     left join competition_editions ce on ce.id = f.competition_edition_id
     left join competitions comp on comp.id = ce.competition_id
     left join venues v on v.id = f.venue_id
     left join seasons s on s.id = f.season_id
     left join club_pitches cp on cp.id = f.pitch_id
     left join lateral public.get_team_identity_for_season(t.id, f.season_id) as owning_ident on true
     left join lateral public.get_team_identity_for_season(opp_t.id, f.season_id) as opp_ident on true;
