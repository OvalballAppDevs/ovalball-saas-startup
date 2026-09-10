-- Fixture Management can see, and therefore set, the meet time.
--
-- Meet time is a canonical property of the fixture -- fixtures.meet_time, with
-- its own CHECK constraints and its own RPC -- and Fixture Management is its
-- editing authority. The overview this surface reads simply never carried the
-- column, so the control had nowhere to read its current value from and lived
-- on the Match Centre instead, making the page the whole club READS a fixture
-- on the one place that could CHANGE this one field.
--
-- Purely additive: meet_time is appended as the final column, and every
-- existing column, expression and join is byte-identical to the definition it
-- replaces (generated from the live view rather than retyped).

create or replace view public.admin_fixture_overview as
 SELECT f.id,
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
    owning_ident.display_name AS owning_team_name,
    t.rugby_code,
    owning_ident.category AS owning_team_category,
    c.id AS owning_club_id,
    cd.id AS owning_directory_id,
    cd.name AS owning_club_name,
    COALESCE(opp_cd.name, opp_c_cd.name) AS opponent_club_name,
    opp_ident.display_name AS opponent_team_name,
    comp.name AS competition_name,
    v.name AS venue_name,
    ( SELECT count(*) AS count
           FROM fixture_messages fm
          WHERE fm.fixture_id = f.id) AS message_count,
    c.logo_storage_path AS owning_club_logo_path,
    opp_c.id AS opponent_club_id,
    opp_c.logo_storage_path AS opponent_club_logo_path,
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
        CASE
            WHEN f.home_away = 'Away'::text THEN COALESCE(opp_cd.name, opp_c_cd.name, f.raw_opposition_text)
            ELSE cd.name
        END AS home_club_name,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_ident.display_name
            ELSE owning_ident.display_name
        END AS home_team_name,
        CASE
            WHEN f.home_away = 'Away'::text THEN cd.name
            ELSE COALESCE(opp_cd.name, opp_c_cd.name, f.raw_opposition_text)
        END AS away_club_name,
        CASE
            WHEN f.home_away = 'Away'::text THEN owning_ident.display_name
            ELSE opp_ident.display_name
        END AS away_team_name,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_ident.category
            ELSE owning_ident.category
        END AS home_team_category,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_ident.age_group
            ELSE owning_ident.age_group
        END AS home_team_age_group,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_ident.gender
            ELSE owning_ident.gender
        END AS home_team_gender,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_ident.squad_designation
            ELSE owning_ident.squad_designation
        END AS home_team_squad_designation,
        CASE
            WHEN f.home_away = 'Away'::text THEN owning_ident.category
            ELSE opp_ident.category
        END AS away_team_category,
        CASE
            WHEN f.home_away = 'Away'::text THEN owning_ident.age_group
            ELSE opp_ident.age_group
        END AS away_team_age_group,
        CASE
            WHEN f.home_away = 'Away'::text THEN owning_ident.gender
            ELSE opp_ident.gender
        END AS away_team_gender,
        CASE
            WHEN f.home_away = 'Away'::text THEN owning_ident.squad_designation
            ELSE opp_ident.squad_designation
        END AS away_team_squad_designation,
    opp_ident.category AS opponent_team_category,
    opp_ident.age_group AS opponent_team_age_group,
    opp_ident.gender AS opponent_team_gender,
    opp_ident.squad_designation AS opponent_team_squad_designation,
    opp_t.rugby_code AS opponent_team_rugby_code,
    f.home_team_id,
    f.away_team_id,
        CASE
            WHEN f.home_away = 'Away'::text THEN COALESCE(f.opponent_directory_id, opp_c_cd.id)
            ELSE cd.id
        END AS home_club_directory_id,
        CASE
            WHEN f.home_away = 'Away'::text THEN cd.id
            ELSE COALESCE(f.opponent_directory_id, opp_c_cd.id)
        END AS away_club_directory_id,
    s.name AS season_canonical_name,
    cp.display_name AS pitch_name,
    f.mirror_fixture_id,
    f.mirror_fixture_id IS NULL OR f.id < f.mirror_fixture_id AS is_primary_mirror,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_cd.id IS NOT NULL OR opp_c.id IS NOT NULL
            ELSE true
        END AS home_club_resolved,
        CASE
            WHEN f.home_away = 'Away'::text THEN true
            ELSE opp_cd.id IS NOT NULL OR opp_c.id IS NOT NULL
        END AS away_club_resolved,
    f.owning_scheduling_group_id,
    f.opponent_scheduling_group_id,
        CASE
            WHEN f.home_away = 'Away'::text THEN opp_t.rugby_code
            ELSE t.rugby_code
        END AS home_team_rugby_code,
        CASE
            WHEN f.home_away = 'Away'::text THEN t.rugby_code
            ELSE opp_t.rugby_code
        END AS away_team_rugby_code,
    f.meet_time
   FROM fixtures f
     JOIN teams t ON t.id = f.owning_team_id
     JOIN clubs c ON c.id = t.club_id
     JOIN club_directory cd ON cd.id = c.directory_id
     LEFT JOIN club_directory opp_cd ON opp_cd.id = f.opponent_directory_id
     LEFT JOIN teams opp_t ON opp_t.id = f.opponent_team_id
     LEFT JOIN clubs opp_c ON opp_c.id = opp_t.club_id
     LEFT JOIN club_directory opp_c_cd ON opp_c_cd.id = opp_c.directory_id
     LEFT JOIN competition_editions ce ON ce.id = f.competition_edition_id
     LEFT JOIN competitions comp ON comp.id = ce.competition_id
     LEFT JOIN venues v ON v.id = f.venue_id
     LEFT JOIN seasons s ON s.id = f.season_id
     LEFT JOIN club_pitches cp ON cp.id = f.pitch_id
     LEFT JOIN LATERAL get_team_identity_for_season(t.id, f.season_id) owning_ident(category, age_group, squad_designation, gender, display_name, is_projected) ON true
     LEFT JOIN LATERAL get_team_identity_for_season(opp_t.id, f.season_id) opp_ident(category, age_group, squad_designation, gender, display_name, is_projected) ON true;
