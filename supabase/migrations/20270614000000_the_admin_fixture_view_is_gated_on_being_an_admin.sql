-- =====================================================================================================
-- THE SITE ADMIN FIXTURE VIEW IS GATED ON BEING A SITE ADMIN.
--
-- `admin_fixture_overview` is an OWNER-RIGHTS view over `fixtures`, granted to `authenticated`, whose
-- only filtering was its joins. Owner-rights means the base table's policies are never consulted, so
-- the grant was the whole boundary -- and the grant is "anybody signed in".
--
-- MEASURED, in one session, in one transaction:
--
--   a signed-in stranger reads   0 rows from public.fixtures          (correct: RLS refuses them)
--   the same stranger reads     26 rows from admin_fixture_overview   (every fixture on the platform)
--
-- Kick-off dates, venues, opponents, statuses and message counts for every club in Ovalball, from any
-- account. `fixtures` itself was never weakened; it was simply never asked.
--
-- THE FIX IS THE ONE ITS OWN SIBLING ALREADY USES. `admin_club_overview` is deliberately owner-rights
-- and carries `internal.has_site_capability('site.clubs.view')` as its only WHERE clause -- the
-- capability IS the boundary, which is what lets a Site Admin see across every club without the base
-- table being column-wide readable. The fixtures view is given exactly that shape with
-- `site.fixtures.view`, the capability the Site Admin fixtures screens are for.
--
-- TWO AUDIENCES, ONE VIEW -- and the first draft of this migration got that wrong. The screen is read
-- by a SITE ADMIN looking across every club AND by a CLUB ADMIN looking at their own, so gating on the
-- site capability alone made a club administrator's own fixtures vanish (caught immediately by
-- `fixture_search_and_venue_authority` assertion 1(A), "their own fixture was not readable").
--
-- THE SECOND CONDITION IS NOT A SECOND IMPLEMENTATION OF THE RULE. It calls
-- `internal.viewable_fixture_teams()` and `internal.viewable_fixture_clubs()` -- the very functions
-- `fixtures_select_related` itself calls -- so the view and the policy cannot drift apart: changing who
-- may see a fixture changes both at once, because there is only one place to change.
--
-- SECURITY INVOKER WAS CONSIDERED AND IS WRONG HERE. Those helpers are bounded by the caller's OWN
-- memberships by design, so a Full Site Admin -- who deliberately holds none -- would see nothing at
-- all. That is precisely why the view is owner-rights with the capability as its own WHERE, which is
-- the shape admin_club_overview already uses.
--
-- Found by the perimeter manifest, which flags any owner-rights view that is neither a public
-- projection nor capability-gated. It had been flagging this one; nothing had acted on it.
-- =====================================================================================================

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
     LEFT JOIN LATERAL get_team_identity_for_season(opp_t.id, f.season_id) opp_ident(category, age_group, squad_designation, gender, display_name, is_projected) ON true
  WHERE internal.has_site_capability('site.fixtures.view')
     OR f.owning_team_id = ANY (internal.viewable_fixture_teams())
     OR f.opponent_team_id = ANY (internal.viewable_fixture_teams())
     OR EXISTS (SELECT 1 FROM public.teams vt WHERE vt.id = f.owning_team_id AND vt.club_id = ANY (internal.viewable_fixture_clubs()))
     OR EXISTS (SELECT 1 FROM public.teams vt WHERE vt.id = f.opponent_team_id AND vt.club_id = ANY (internal.viewable_fixture_clubs()));

comment on view public.admin_fixture_overview is
  'Site Admin fixture overview. Deliberately OWNER-RIGHTS so it can look across clubs, with '
  'internal.has_site_capability(''site.fixtures.view'') as its own WHERE clause -- the capability is '
  'the boundary, the same shape admin_club_overview uses. Without it the view returned every fixture '
  'on the platform to any signed-in account (measured: 26 rows against 0 from the base table).';

do $$
begin
  if (select pg_get_viewdef('public.admin_fixture_overview'::regclass, true)) !~ 'site.fixtures.view' then
    raise exception 'admin_fixture_overview is not gated on the site fixtures capability.';
  end if;
end $$;
