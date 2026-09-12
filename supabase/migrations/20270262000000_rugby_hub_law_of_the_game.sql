-- Rugby Hub Rules & Laws Deepening.
--
-- Rules is NOT a hub_content_items domain and stays that way -- it renders
-- canonical regulatory_facts directly through the existing
-- regulatory_content_sets + regulatory_content_sections curated-bundle
-- architecture. No new tables, no new content_type, no new relationship
-- mechanism, no new source registry. The corpus (134 VERIFIED facts) is
-- overwhelmingly age-grade administrative regulation; only ONE
-- regulatory_content_sets row with topic='RULES' exists in the whole
-- database (RFL-GIRLS-U12-2026-RULES), meaning almost every other identity
-- currently resolves the Rules page to "empty". This migration:
--
--   1. Registers World Rugby and IRL as real global Law authorities/sources.
--   2. Extends fact_type and section_key with the minimal new values a
--      genuine Law-of-the-Game corpus needs (reusing SCRUM/LINEOUT/KICKING/
--      RESTART/TACKLE_CONTACT/CONTACT_RULE/OTHER where they already fit).
--   3. Closes a real, previously-unnoticed schema gap: regulatory_content_
--      sections had a UNIQUE(content_set_id, section_key) constraint,
--      meaning only ONE fact could ever occupy one section within one
--      content set -- fine for "one ball size per age grade", wrong for a
--      section like Tackle & Breakdown that genuinely needs several atomic
--      facts. Relaxed to UNIQUE(content_set_id, fact_id), and a new
--      nullable regulatory_facts.display_title column added so multiple
--      facts sharing a section render with distinct card titles instead of
--      colliding on the shared section label.
--   4. Creates exactly one general (regulatory_identity_id IS NULL) RULES
--      content set per code -- the Tier-2 "Laws of the Game" bundle every
--      identity of that code sees by default.
--   5. Fixes internal.resolve_age_grade_rule_bundle (and the two RPCs that
--      wrap it) to MERGE the Tier-2 general set with a Tier-1 identity-
--      specific set when one exists, instead of the previous either/or
--      short-circuit -- Tier-1 overrides only the sections it genuinely
--      has an opinion on; every other Tier-2 section remains visible.
--   6. Seeds an atomic, citation-backed initial Law corpus for both codes,
--      linked into the existing Officiating/Game Knowledge/Glossary graph
--      via the existing hub_regulatory_fact_references/RULE_GLOSSARY
--      mechanisms -- zero new join tables.

-- =====================================================================
-- 1. Global Law authorities.
-- =====================================================================

insert into public.regulatory_authorities (code, name, rugby_code, website_url)
values
  ('WORLD_RUGBY', 'World Rugby', 'union', 'https://www.world.rugby'),
  ('IRL', 'International Rugby League', 'league', 'https://www.intrl.sport')
on conflict (code) do nothing;

-- =====================================================================
-- 2. Primary Law sources, with real, current, dated provenance.
-- =====================================================================

do $$
declare
  v_wr_authority uuid;
  v_irl_authority uuid;
  v_wr_lawbook uuid;
  v_wr_passport uuid;
  v_wr_lawupdate uuid;
  v_irl_lawbook uuid;
begin
  select id into v_wr_authority from public.regulatory_authorities where code = 'WORLD_RUGBY';
  select id into v_irl_authority from public.regulatory_authorities where code = 'IRL';

  insert into public.regulatory_sources (source_key, authority_id, rugby_code, title, source_type, authority_classification, canonical_url, publication_date, retrieved_on, review_state)
  values (
    'WR-LAWBOOK-2026', v_wr_authority, 'union', 'Laws of the Game 2026 (incorporating the playing charter)', 'RULEBOOK', 'PRIMARY_RULE_BOOK',
    'https://passport.world.rugby/media/jxrnmptk/2026en-laws-of-the-game-compressed.pdf', '2026-01-01', current_date, 'VERIFIED_CURRENT'
  )
  returning id into v_wr_lawbook;

  insert into public.regulatory_sources (source_key, authority_id, rugby_code, title, source_type, authority_classification, canonical_url, retrieved_on, review_state)
  values (
    'WR-LAWSBYNUMBER', v_wr_authority, 'union', 'World Rugby Passport — Laws by Number', 'WEB_GUIDANCE', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'https://passport.world.rugby/laws-of-the-game/laws-by-number/', current_date, 'VERIFIED_CURRENT'
  )
  returning id into v_wr_passport;

  -- No effective_from on the source itself: World Rugby's Laws of the Game
  -- are not a domestically season-scoped document like RFU Regulation 15,
  -- so the season-boundary carry-forward check does not apply to it. The
  -- amendment's real effective date belongs to the FACT it supports
  -- (regulatory_facts.effective_from on WR-LAW-RED-CARD-20MIN-REPLACEMENT,
  -- set below), not to this evergreen "what's new" source page.
  insert into public.regulatory_sources (source_key, authority_id, rugby_code, title, source_type, authority_classification, canonical_url, retrieved_on, review_state)
  values (
    'WR-LAWUPDATE-2026-07', v_wr_authority, 'union', 'World Rugby Passport — 2026-07 Law Updates', 'WEB_GUIDANCE', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'https://passport.world.rugby/laws-of-the-game/whats-new/2026-07-law-updates/', current_date, 'VERIFIED_CURRENT'
  )
  returning id into v_wr_lawupdate;

  insert into public.regulatory_sources (source_key, authority_id, rugby_code, title, source_type, authority_classification, canonical_url, publication_date, retrieved_on, review_state)
  values (
    'IRL-LAWBOOK-2026', v_irl_authority, 'league', 'International Laws of the Game 2026, with Notes on the Laws', 'RULEBOOK', 'PRIMARY_RULE_BOOK',
    'https://www.rugby-league.com/uploads/docs/International_Rugby_League_Laws_of_the_Game.pdf', '2026-01-01', current_date, 'VERIFIED_CURRENT'
  )
  returning id into v_irl_lawbook;

  -- ============ Source locators ============

  insert into public.regulatory_source_locators (source_id, locator_type, locator_value, description) values
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 7', 'Advantage'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 9', 'Foul Play'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 10', 'Offside and Onside in Open Play'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 11', 'Knock Forward or Throw Forward'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 14', 'Tackle'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 15', 'Ruck'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 16', 'Maul'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 18', 'Touch, Quick Throw and Lineout'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 19', 'Scrum'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 8', 'Scoring'),
    (v_wr_lawbook, 'REGULATION_NUMBER', 'Law 20', 'Sanctions: Penalty and Free-Kick'),
    (v_wr_passport, 'SECTION', 'Sin Bins (Yellow Card)', 'Sin-bin duration'),
    (v_wr_lawupdate, 'HEADING', '2026-07 Law Updates', '20-minute red card and TMO role become full law from 1 July 2026'),
    (v_irl_lawbook, 'HEADING', 'Offside', null),
    (v_irl_lawbook, 'HEADING', 'Knock-on and Forward Pass', null),
    (v_irl_lawbook, 'HEADING', 'Tackle and Play-the-Ball', null),
    (v_irl_lawbook, 'HEADING', 'Scrum', null),
    (v_irl_lawbook, 'HEADING', 'Scoring', null),
    (v_irl_lawbook, 'HEADING', 'Penalty Kick', null);
end $$;

-- =====================================================================
-- 3. Extend fact_type -- only the values with no existing legitimate fit.
--    SCRUM, LINEOUT, KICKING, RESTART, TACKLE_CONTACT, CONTACT_RULE, OTHER
--    already exist and are reused for the corresponding new Law facts.
-- =====================================================================

alter table public.regulatory_facts drop constraint regulatory_facts_fact_type_check;
alter table public.regulatory_facts add constraint regulatory_facts_fact_type_check check (fact_type = any (array[
  'PLAYER_COUNT', 'MATCH_DURATION', 'BALL_SIZE', 'PITCH_LENGTH', 'PITCH_WIDTH', 'PITCH_VARIATION',
  'SCRUM', 'LINEOUT', 'KICKING', 'RESTART', 'TACKLE_CONTACT', 'SUBSTITUTION', 'SCORING_VARIATION',
  'PLAYING_UP_DOWN', 'MATCH_FORMAT', 'OTHER_AGE_VARIATION', 'PITCH_DIMENSION', 'SCRUM_CONFIGURATION',
  'LINEOUT_CONFIGURATION', 'PLAYING_ELIGIBILITY', 'CONTACT_RULE', 'SAFEGUARDING_REVIEW_CYCLE',
  'SAFEGUARDING_POLICY_SCOPE', 'SAFEGUARDING_ROLE_REQUIREMENT', 'SAFEGUARDING_TRAINING_REQUIREMENT',
  'SAFEGUARDING_PRINCIPLE_STATEMENT', 'COMMUNITY_GAME_PROTOCOL', 'ELITE_PROTOCOL', 'RED_FLAGS_EMERGENCY',
  'MEDICAL_ASSESSMENT', 'REMOVE_FROM_PLAY', 'RETURN_TO_PLAY_MINIMUM_DURATION',
  'ADVANTAGE', 'OFFSIDE', 'KNOCK_ON', 'FORWARD_PASS', 'FOUL_PLAY', 'SANCTION', 'TRY', 'CONVERSION', 'PENALTY_GOAL', 'VIDEO_REVIEW',
  'OTHER'
]));

-- =====================================================================
-- 4. Extend section_key -- the 8 approved durable categories.
-- =====================================================================

alter table public.regulatory_content_sections drop constraint regulatory_content_sections_section_key_check;
alter table public.regulatory_content_sections add constraint regulatory_content_sections_section_key_check check (section_key = any (array[
  'OVERVIEW', 'KEY_RULES', 'PITCH', 'MATCH_FORMAT', 'PLAYER_COUNT', 'BALL', 'SCRUM', 'LINEOUT', 'KICKING', 'RESTART', 'SAFETY',
  'SAFEGUARDING', 'CONCUSSION', 'REPORTING', 'SOURCES', 'EMERGENCY', 'MEDICAL_ASSESSMENT', 'RETURN_TO_PLAY',
  'SCORING', 'ADVANTAGE', 'OFFSIDE', 'TACKLE_BREAKDOWN', 'FOUL_PLAY', 'SANCTIONS', 'TOUCH_AND_RESTART', 'VIDEO_REVIEW',
  'OTHER'
]));

-- =====================================================================
-- 5. Close the real one-fact-per-section gap: a section like Tackle &
--    Breakdown genuinely needs several atomic facts, not one. Relax the
--    uniqueness to (content_set_id, fact_id) -- a given fact can still only
--    appear once in a content set, but a section can now hold many facts.
--    Add display_title so multiple facts sharing a section render with
--    distinct card titles instead of colliding on the section label.
-- =====================================================================

alter table public.regulatory_content_sections drop constraint regulatory_content_sections_content_set_id_section_key_key;
alter table public.regulatory_content_sections add constraint regulatory_content_sections_content_set_id_fact_id_key unique (content_set_id, fact_id);
create index if not exists regulatory_content_sections_content_set_section_idx on public.regulatory_content_sections(content_set_id, section_key);

alter table public.regulatory_facts add column if not exists display_title text;
comment on column public.regulatory_facts.display_title is 'Short, human-readable per-fact card title (e.g. "Tackle Completion", "Ruck") -- used only when a section genuinely holds more than one fact (e.g. Tackle & Breakdown), so cards do not all collide on the shared section label. Null for the common one-fact-per-section case, where the section label alone remains the title.';

-- =====================================================================
-- 6. Fix the Tier-1/Tier-2 resolver: merge instead of short-circuit.
--    Tier 2 (general, regulatory_identity_id IS NULL) is resolved
--    independently of Tier 1 (identity-specific) by calling the existing,
--    unchanged resolve_published_regulatory_content twice -- once with the
--    real identity, once with NULL. Tier-1 sections override Tier-2
--    sections of the same section_key; every other Tier-2 section is
--    preserved. A new is_tier1_variation output column lets the UI say
--    "General Law" vs "Your Age Grade's Variation" without guessing from
--    is_overlay, which remains reserved for the pre-existing competition-
--    overlay concept.
-- =====================================================================

drop function if exists internal.resolve_age_grade_rule_bundle(text, uuid, date, uuid);
create function internal.resolve_age_grade_rule_bundle(p_rugby_code text, p_regulatory_identity_id uuid, p_as_of_date date default current_date, p_competition_overlay_id uuid default null)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text, value_text text, value_unit text,
  is_overlay boolean, is_tier1_variation boolean, primary_source_key text, primary_source_locator text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_general_set_id uuid; v_specific_set_id uuid;
begin
  select rc.content_set_id into v_general_set_id
  from internal.resolve_published_regulatory_content(p_rugby_code, 'RULES', null, p_as_of_date) rc;

  if p_regulatory_identity_id is not null then
    select rc.content_set_id into v_specific_set_id
    from internal.resolve_published_regulatory_content(p_rugby_code, 'RULES', p_regulatory_identity_id, p_as_of_date) rc;
    -- resolve_published_regulatory_content itself falls back to the general
    -- set when the identity has no Tier-1 set of its own -- when that
    -- happens v_specific_set_id will equal v_general_set_id, and it must
    -- not be treated as a genuine Tier-1 override.
    if v_specific_set_id = v_general_set_id then v_specific_set_id := null; end if;
  end if;

  if v_general_set_id is null and v_specific_set_id is null then return; end if;

  return query
  with general_base as (
    select sec.section_key, sec.fact_id, f.fact_type
    from public.regulatory_content_sections sec join public.regulatory_facts f on f.id = sec.fact_id
    where sec.content_set_id = v_general_set_id and f.status = 'VERIFIED'
  ),
  specific_base as (
    select sec.section_key, sec.fact_id, f.fact_type
    from public.regulatory_content_sections sec join public.regulatory_facts f on f.id = sec.fact_id
    where v_specific_set_id is not null and sec.content_set_id = v_specific_set_id and f.status = 'VERIFIED'
  ),
  -- Tier-1 overrides at the SECTION level, not per-row: a section a Tier-1
  -- set has an opinion on replaces that whole section's Tier-2 facts
  -- (however many there are), rather than pairing rows section-by-section --
  -- pairing would Cartesian-multiply whenever either tier holds more than
  -- one fact under a shared section_key (exactly the case this migration's
  -- own relaxed content_sections uniqueness now permits, e.g. Tackle &
  -- Breakdown). Every other Tier-2 section, and any Tier-1-only section, is
  -- preserved unchanged.
  tier1_sections as (
    select distinct sp.section_key from specific_base sp
  ),
  merged as (
    select g.section_key, g.fact_id, false as is_tier1_variation
    from general_base g
    where not exists (select 1 from tier1_sections t1 where t1.section_key = g.section_key)
    union all
    select sp.section_key, sp.fact_id, true as is_tier1_variation
    from specific_base sp
  ),
  overlay_candidates as (
    select distinct on (m.fact_id) m.fact_id as base_fact_id, f2.id as overlay_fact_id
    from merged m
    join public.regulatory_facts f1 on f1.id = m.fact_id
    join public.regulatory_facts f2 on f2.fact_type = f1.fact_type and f2.status = 'VERIFIED'
    join public.regulatory_fact_applicability fa on fa.fact_id = f2.id
    where p_competition_overlay_id is not null and fa.regulatory_identity_id = p_regulatory_identity_id and fa.competition_overlay_id = p_competition_overlay_id
    order by m.fact_id, f2.id
  ),
  applicable as (
    select m.section_key, m.fact_id as base_fact_id, coalesce(oc.overlay_fact_id, m.fact_id) as fact_id, (oc.overlay_fact_id is not null) as is_overlay, m.is_tier1_variation
    from merged m left join overlay_candidates oc on oc.base_fact_id = m.fact_id
  ),
  primary_citation as (
    select distinct on (c.fact_id) c.fact_id, s.source_key, l.locator_type, l.locator_value
    from public.regulatory_fact_citations c
    join public.regulatory_sources s on s.id = c.source_id
    left join public.regulatory_source_locators l on l.id = c.locator_id
    order by c.fact_id, (c.support_role = 'PRIMARY') desc, c.created_at asc
  )
  select coalesce(v_specific_set_id, v_general_set_id), a.section_key, f.id, f.fact_key, f.fact_type, f.display_title,
    f.value_type, f.value_integer, f.value_decimal, f.value_boolean, f.value_duration_minutes,
    f.value_distance_metres, f.value_range_min, f.value_range_max, f.value_enum, f.value_text, f.value_unit,
    a.is_overlay, a.is_tier1_variation, pc.source_key,
    case when pc.locator_type is not null then pc.locator_type || ': ' || pc.locator_value else null end
  from applicable a
  join public.regulatory_facts f on f.id = a.fact_id
  left join primary_citation pc on pc.fact_id = f.id;
end;
$function$;

comment on function internal.resolve_age_grade_rule_bundle is 'Resolves the RULES bundle for one identity by MERGING the Tier-2 general (code-wide) content set with any genuine Tier-1 identity-specific content set -- Tier-1 overrides only the sections it has an opinion on, every other Tier-2 section is preserved. Previously an either/or short-circuit; fixed because it silently meant every identity without its own Tier-1 set (almost all of them) saw no Rules content at all once a Tier-2 general set existed.';

-- Both public wrapper RPCs return this shape verbatim -- recreate to match.

drop function if exists public.get_rugby_hub_rules(uuid, date, uuid);
create function public.get_rugby_hub_rules(p_team_id uuid, p_as_of_date date default current_date, p_competition_overlay_id uuid default null)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text, value_text text, value_unit text,
  is_overlay boolean, is_tier1_variation boolean, primary_source_key text, primary_source_locator text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_rugby_code text; v_identity_id uuid; v_mapping_type text;
begin
  select rugby_code, regulatory_identity_id, mapping_type into v_rugby_code, v_identity_id, v_mapping_type
  from internal.regulatory_context_for_team(p_team_id);

  if v_rugby_code is null then return; end if;
  if v_mapping_type = 'NO_DIRECT_MAPPING' then return; end if;

  return query select * from internal.resolve_age_grade_rule_bundle(v_rugby_code, v_identity_id, p_as_of_date, p_competition_overlay_id);
end;
$function$;
comment on function public.get_rugby_hub_rules is 'The viewer''s own Rules bundle: their team''s age-grade variation merged with the code-wide general Laws of the Game. NO_DIRECT_MAPPING correctly yields nothing; a mapped identity with no Tier-1 set of its own still receives the full Tier-2 general Law content.';
revoke all on function public.get_rugby_hub_rules(uuid, date, uuid) from public, anon;
grant execute on function public.get_rugby_hub_rules(uuid, date, uuid) to authenticated;

drop function if exists public.get_rugby_hub_rules_by_identity(text);
create function public.get_rugby_hub_rules_by_identity(p_identity_key text)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, display_title text,
  value_type text, value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text, value_text text, value_unit text,
  is_overlay boolean, is_tier1_variation boolean, primary_source_key text, primary_source_locator text,
  identity_label text, identity_rugby_code text
)
language plpgsql
stable security definer
set search_path to 'public', 'internal'
as $function$
declare v_id uuid; v_code text; v_label text;
begin
  select id, rugby_code, label into v_id, v_code, v_label from public.regulatory_identities where identity_key = p_identity_key;
  if v_id is null then return; end if;

  return query
    select b.*, v_label, v_code
    from internal.resolve_age_grade_rule_bundle(v_code, v_id, current_date, null) b;
end;
$function$;
comment on function public.get_rugby_hub_rules_by_identity is 'Broad-browse Rules for a real, named identity -- same merged Tier-1+Tier-2 resolution as get_rugby_hub_rules, keyed by the stable public identity_key rather than the viewer''s own team.';
revoke all on function public.get_rugby_hub_rules_by_identity(text) from public, anon;
grant execute on function public.get_rugby_hub_rules_by_identity(text) to authenticated;

-- =====================================================================
-- 7. The two Tier-2 general (regulatory_identity_id IS NULL) RULES content
--    sets -- the mechanism that makes genuine Law-of-the-Game content
--    available to every identity of a code by default.
-- =====================================================================

do $$
declare
  v_admin uuid;
  v_union_set uuid;
  v_league_set uuid;

  v_wr_lawbook uuid; v_wr_passport uuid; v_wr_lawupdate uuid; v_irl_lawbook uuid;

  v_u_advantage uuid; v_u_offside uuid; v_u_knockon uuid; v_u_fwdpass uuid;
  v_u_tackle_complete uuid; v_u_tackle_release uuid; v_u_ruck uuid; v_u_maul uuid;
  v_u_scrum uuid; v_u_lineout uuid; v_u_penalty uuid; v_u_freekick uuid; v_u_foulplay uuid;
  v_u_sinbin uuid; v_u_redcard uuid; v_u_redcard20 uuid;
  v_u_try uuid; v_u_conversion uuid; v_u_penaltygoal uuid; v_u_dropgoal uuid;

  v_l_offside uuid; v_l_knockon uuid; v_l_fwdpass uuid;
  v_l_tackle_complete uuid; v_l_ptb uuid; v_l_tacklecount uuid; v_l_setrestart uuid;
  v_l_scrum uuid; v_l_penalty uuid;
  v_l_try uuid; v_l_conversion uuid; v_l_penaltygoal uuid; v_l_dropgoal uuid;

  v_concept_advantage uuid; v_concept_offside_u uuid; v_concept_offside_l uuid; v_concept_knockon uuid;
  v_concept_breakdown_u uuid; v_concept_ptb_l uuid; v_concept_scrumlineout_u uuid; v_concept_scrum_l uuid;
  v_concept_foulplay uuid; v_concept_cards uuid;
  v_gk_advantage uuid; v_gk_attackdefence uuid; v_gk_scoring uuid; v_gk_scrumlineout uuid; v_gk_restarts uuid;

  v_g_advantage uuid; v_g_offside_u uuid; v_g_offside_l uuid; v_g_knockon uuid; v_g_fwdpass uuid;
  v_g_ruck uuid; v_g_maul uuid; v_g_scrum_u uuid; v_g_lineout uuid; v_g_scrum_l uuid;
  v_g_ptb uuid; v_g_tacklecount uuid; v_g_setrestart uuid; v_g_foulplay uuid; v_g_sinbin uuid; v_g_yellowcard uuid; v_g_redcard uuid;
begin
  -- The one canonical regulatory-content-import system user already used as
  -- verified_by/published_by on every existing regulatory_facts row and
  -- regulatory_content_sets row -- reused here rather than minting a second
  -- identity for the same provenance role.
  v_admin := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;

  select id into v_wr_lawbook from public.regulatory_sources where source_key = 'WR-LAWBOOK-2026';
  select id into v_wr_passport from public.regulatory_sources where source_key = 'WR-LAWSBYNUMBER';
  select id into v_wr_lawupdate from public.regulatory_sources where source_key = 'WR-LAWUPDATE-2026-07';
  select id into v_irl_lawbook from public.regulatory_sources where source_key = 'IRL-LAWBOOK-2026';

  select id into v_concept_advantage from public.hub_content_items where content_key = 'advantage' and content_type = 'OFFICIATING_CONCEPT';
  select id into v_concept_offside_u from public.hub_content_items where content_key = 'offside-decisions-union';
  select id into v_concept_offside_l from public.hub_content_items where content_key = 'offside-decisions-league';
  select id into v_concept_knockon from public.hub_content_items where content_key = 'knock-on-and-forward-pass';
  select id into v_concept_breakdown_u from public.hub_content_items where content_key = 'breakdown-and-ruck-decisions-union';
  select id into v_concept_ptb_l from public.hub_content_items where content_key = 'tackle-and-play-the-ball-decisions-league';
  select id into v_concept_scrumlineout_u from public.hub_content_items where content_key = 'scrum-and-lineout-decisions-union';
  select id into v_concept_scrum_l from public.hub_content_items where content_key = 'scrum-decisions-league';
  select id into v_concept_foulplay from public.hub_content_items where content_key = 'foul-play-and-player-safety';
  select id into v_concept_cards from public.hub_content_items where content_key = 'cards-and-sin-bin';

  select id into v_gk_advantage from public.hub_content_items where content_key = 'penalties-and-advantage';
  select id into v_gk_attackdefence from public.hub_content_items where content_key = 'attack-and-defence';
  select id into v_gk_scoring from public.hub_content_items where content_key = 'how-scoring-works';
  select id into v_gk_scrumlineout from public.hub_content_items where content_key = 'the-scrum-and-lineout-in-play';
  select id into v_gk_restarts from public.hub_content_items where content_key = 'how-play-restarts';

  select id into v_g_advantage from public.hub_glossary_terms where term_key = 'advantage';
  select id into v_g_offside_u from public.hub_glossary_terms where term_key = 'offside-union';
  select id into v_g_offside_l from public.hub_glossary_terms where term_key = 'offside-league';
  select id into v_g_knockon from public.hub_glossary_terms where term_key = 'knock-on';
  select id into v_g_fwdpass from public.hub_glossary_terms where term_key = 'forward-pass';
  select id into v_g_ruck from public.hub_glossary_terms where term_key = 'ruck';
  select id into v_g_maul from public.hub_glossary_terms where term_key = 'maul';
  select id into v_g_scrum_u from public.hub_glossary_terms where term_key = 'scrum-union';
  select id into v_g_lineout from public.hub_glossary_terms where term_key = 'lineout';
  select id into v_g_scrum_l from public.hub_glossary_terms where term_key = 'scrum-league';
  select id into v_g_ptb from public.hub_glossary_terms where term_key = 'play-the-ball';
  select id into v_g_tacklecount from public.hub_glossary_terms where term_key = 'tackle-count';
  select id into v_g_setrestart from public.hub_glossary_terms where term_key = 'set-restart';
  select id into v_g_foulplay from public.hub_glossary_terms where term_key = 'foul-play';
  select id into v_g_sinbin from public.hub_glossary_terms where term_key = 'sin-bin';
  select id into v_g_yellowcard from public.hub_glossary_terms where term_key = 'yellow-card';
  select id into v_g_redcard from public.hub_glossary_terms where term_key = 'red-card';

  -- ============ Union facts ============

  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-ADVANTAGE', 'ADVANTAGE', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'Play may continue without a penalty being awarded when the non-offending team gains an advantage following an opponent''s infringement.', null, 'INFORMATIONAL', 'DRAFT') returning id into v_u_advantage;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-OFFSIDE-OPEN-PLAY', 'OFFSIDE', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'In open play, a player is offside if positioned in front of a teammate who is carrying the ball or who last played it.', null, 'MANDATORY', 'DRAFT') returning id into v_u_offside;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-KNOCK-ON', 'KNOCK_ON', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A knock-on occurs when the ball is lost forward from a player''s hand or arm and touches the ground or another player before that player can catch it again.', 'Knock-On', 'MANDATORY', 'DRAFT') returning id into v_u_knockon;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-FORWARD-PASS', 'FORWARD_PASS', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A throw forward occurs when a player throws or passes the ball forward towards the opposition''s dead-ball line.', 'Forward Pass', 'MANDATORY', 'DRAFT') returning id into v_u_fwdpass;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-TACKLE-COMPLETION', 'TACKLE_CONTACT', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A tackle is completed when the ball-carrier is held by one or more opponents and is brought to the ground.', 'Tackle Completion', 'MANDATORY', 'DRAFT') returning id into v_u_tackle_complete;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-TACKLE-RELEASE', 'TACKLE_CONTACT', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'After a tackle is completed, the tackler must release the ball-carrier, and the ball-carrier must release the ball and get up or move away from it, before either can play the ball again.', 'Tackle Release', 'MANDATORY', 'DRAFT') returning id into v_u_tackle_release;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-RUCK', 'CONTACT_RULE', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A ruck forms when at least one player from each team, on their feet and in contact, close around the ball on the ground after a tackle.', 'Ruck', 'MANDATORY', 'DRAFT') returning id into v_u_ruck;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-MAUL', 'CONTACT_RULE', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A maul forms when the ball-carrier is held by one or more opponents and one or more of the ball-carrier''s own teammates bind on, with everyone on their feet.', 'Maul', 'MANDATORY', 'DRAFT') returning id into v_u_maul;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-SCRUM-BASE', 'SCRUM', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A scrum restarts play by bringing together each team''s front-row forwards to contest the ball fed in along the middle line.', null, 'MANDATORY', 'DRAFT') returning id into v_u_scrum;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-LINEOUT-BASE', 'LINEOUT', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A lineout restarts play after the ball has gone into touch, with players from both teams lining up to contest a throw-in thrown straight down the middle.', null, 'MANDATORY', 'DRAFT') returning id into v_u_lineout;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-PENALTY', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A penalty is awarded to the non-offending team for a serious infringement, and may be taken as a kick at goal, a kick to touch, a scrum, or by running the ball.', 'Penalty', 'MANDATORY', 'DRAFT') returning id into v_u_penalty;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-FREE-KICK', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A free kick is awarded for a lesser infringement, and the non-offending team may kick or run with it, but cannot score a goal directly from it.', 'Free Kick', 'MANDATORY', 'DRAFT') returning id into v_u_freekick;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-FOUL-PLAY', 'FOUL_PLAY', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'Foul play is any action contrary to the letter and spirit of the laws of the game, including dangerous play towards an opponent, misconduct, and unfair play.', null, 'MANDATORY', 'DRAFT') returning id into v_u_foulplay;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_duration_minutes, display_title, obligation_level, status)
  values ('WR-LAW-SIN-BIN', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'DURATION', 10, 'Yellow Card / Sin Bin', 'MANDATORY', 'DRAFT') returning id into v_u_sinbin;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('WR-LAW-RED-CARD', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'A red card permanently removes a player from the rest of the match for serious foul play.', 'Red Card', 'MANDATORY', 'DRAFT') returning id into v_u_redcard;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, effective_from, status)
  values ('WR-LAW-RED-CARD-20MIN-REPLACEMENT', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'TEXT', 'Since 1 July 2026, a competition may permit a team to replace a sent-off player after 20 minutes of match time, at the discretion of the match organiser running that competition.', '20-Minute Red Card Replacement', 'RECOMMENDED', '2026-07-01', 'DRAFT') returning id into v_u_redcard20;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('WR-LAW-TRY', 'TRY', 'RULES', 'LAW_OF_THE_GAME', 'union', 'INTEGER', 5, 'points', 'Try', 'MANDATORY', 'DRAFT') returning id into v_u_try;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('WR-LAW-CONVERSION', 'CONVERSION', 'RULES', 'LAW_OF_THE_GAME', 'union', 'INTEGER', 2, 'points', 'Conversion', 'MANDATORY', 'DRAFT') returning id into v_u_conversion;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('WR-LAW-PENALTY-GOAL', 'PENALTY_GOAL', 'RULES', 'LAW_OF_THE_GAME', 'union', 'INTEGER', 3, 'points', 'Penalty Goal', 'MANDATORY', 'DRAFT') returning id into v_u_penaltygoal;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('WR-LAW-DROP-GOAL', 'OTHER', 'RULES', 'LAW_OF_THE_GAME', 'union', 'INTEGER', 3, 'points', 'Drop Goal', 'MANDATORY', 'DRAFT') returning id into v_u_dropgoal;

  -- ============ League facts ============

  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-OFFSIDE-PTB', 'OFFSIDE', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A defending player is offside if they are in front of the marker at a play-the-ball, or in front of the ball when it is kicked, until put onside.', null, 'MANDATORY', 'DRAFT') returning id into v_l_offside;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-KNOCK-ON', 'KNOCK_ON', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A knock-on occurs when a player loses possession of the ball and it travels forward out of their hand or arm.', 'Knock-On', 'MANDATORY', 'DRAFT') returning id into v_l_knockon;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-FORWARD-PASS', 'FORWARD_PASS', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A forward pass occurs when a player throws or passes the ball forward towards the opposition''s dead-ball line.', 'Forward Pass', 'MANDATORY', 'DRAFT') returning id into v_l_fwdpass;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-TACKLE-COMPLETION', 'TACKLE_CONTACT', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A tackle is completed when the ball-carrier is held by one or more defenders and further progress is stopped.', 'Tackle Completion', 'MANDATORY', 'DRAFT') returning id into v_l_tackle_complete;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-PLAY-THE-BALL', 'TACKLE_CONTACT', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'After a tackle, the tackled player must play the ball by facing their own try line, placing it on the ground, and rolling it back with a foot to a teammate.', 'Play-the-Ball', 'MANDATORY', 'DRAFT') returning id into v_l_ptb;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, display_title, obligation_level, status)
  values ('IRL-LAW-TACKLE-COUNT', 'RESTART', 'RULES', 'LAW_OF_THE_GAME', 'league', 'INTEGER', 6, 'Tackle Count', 'MANDATORY', 'DRAFT') returning id into v_l_tacklecount;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-SET-RESTART', 'RESTART', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A set restart gives the attacking team a fresh set of tackles without conceding possession, awarded for certain defensive infringements near the play-the-ball.', 'Set Restart', 'MANDATORY', 'DRAFT') returning id into v_l_setrestart;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-SCRUM-BASE', 'SCRUM', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A scrum restarts play after a knock-on or handling error; in the modern game it is rarely contested, and the feeding team almost always retains possession.', null, 'MANDATORY', 'DRAFT') returning id into v_l_scrum;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_text, display_title, obligation_level, status)
  values ('IRL-LAW-PENALTY', 'SANCTION', 'RULES', 'LAW_OF_THE_GAME', 'league', 'TEXT', 'A penalty is awarded to the non-offending team for an infringement, and may be taken as a kick at goal, a kick for territory, or by tapping and running.', 'Penalty', 'MANDATORY', 'DRAFT') returning id into v_l_penalty;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('IRL-LAW-TRY', 'TRY', 'RULES', 'LAW_OF_THE_GAME', 'league', 'INTEGER', 4, 'points', 'Try', 'MANDATORY', 'DRAFT') returning id into v_l_try;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('IRL-LAW-CONVERSION', 'CONVERSION', 'RULES', 'LAW_OF_THE_GAME', 'league', 'INTEGER', 2, 'points', 'Conversion', 'MANDATORY', 'DRAFT') returning id into v_l_conversion;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('IRL-LAW-PENALTY-GOAL', 'PENALTY_GOAL', 'RULES', 'LAW_OF_THE_GAME', 'league', 'INTEGER', 2, 'points', 'Penalty Goal', 'MANDATORY', 'DRAFT') returning id into v_l_penaltygoal;
  insert into public.regulatory_facts (fact_key, fact_type, topic, subtopic, rugby_code, value_type, value_integer, value_unit, display_title, obligation_level, status)
  values ('IRL-LAW-DROP-GOAL', 'OTHER', 'RULES', 'LAW_OF_THE_GAME', 'league', 'INTEGER', 1, 'points', 'Drop Goal', 'MANDATORY', 'DRAFT') returning id into v_l_dropgoal;

  -- ============ Applicability: every Law fact is universal within its own code (no age-grade/gender/competition narrowing). geographic_scope is left null, matching every existing regulatory_fact_applicability row. ============

  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
  select f.id, ri.id
  from public.regulatory_facts f
  cross join public.regulatory_identities ri
  where f.fact_key like 'WR-LAW-%' and ri.rugby_code = 'union';

  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
  select f.id, ri.id
  from public.regulatory_facts f
  cross join public.regulatory_identities ri
  where f.fact_key like 'IRL-LAW-%' and ri.rugby_code = 'league';

  -- ============ Citations ============

  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role)
  select f.id, v_wr_lawbook, l.id, 'PRIMARY'
  from public.regulatory_facts f
  join public.regulatory_source_locators l on l.source_id = v_wr_lawbook
  where (f.fact_key = 'WR-LAW-ADVANTAGE' and l.locator_value = 'Law 7')
     or (f.fact_key = 'WR-LAW-FOUL-PLAY' and l.locator_value = 'Law 9')
     or (f.fact_key = 'WR-LAW-OFFSIDE-OPEN-PLAY' and l.locator_value = 'Law 10')
     or (f.fact_key in ('WR-LAW-KNOCK-ON', 'WR-LAW-FORWARD-PASS') and l.locator_value = 'Law 11')
     or (f.fact_key in ('WR-LAW-TACKLE-COMPLETION', 'WR-LAW-TACKLE-RELEASE') and l.locator_value = 'Law 14')
     or (f.fact_key = 'WR-LAW-RUCK' and l.locator_value = 'Law 15')
     or (f.fact_key = 'WR-LAW-MAUL' and l.locator_value = 'Law 16')
     or (f.fact_key = 'WR-LAW-LINEOUT-BASE' and l.locator_value = 'Law 18')
     or (f.fact_key = 'WR-LAW-SCRUM-BASE' and l.locator_value = 'Law 19')
     or (f.fact_key in ('WR-LAW-TRY', 'WR-LAW-CONVERSION', 'WR-LAW-PENALTY-GOAL', 'WR-LAW-DROP-GOAL') and l.locator_value = 'Law 8')
     or (f.fact_key in ('WR-LAW-PENALTY', 'WR-LAW-FREE-KICK', 'WR-LAW-RED-CARD') and l.locator_value = 'Law 20');

  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role)
  select v_u_sinbin, v_wr_passport, l.id, 'PRIMARY' from public.regulatory_source_locators l where l.source_id = v_wr_passport and l.locator_value = 'Sin Bins (Yellow Card)';
  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role)
  select v_u_redcard20, v_wr_lawupdate, l.id, 'PRIMARY' from public.regulatory_source_locators l where l.source_id = v_wr_lawupdate and l.locator_value = '2026-07 Law Updates';

  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role)
  select f.id, v_irl_lawbook, l.id, 'PRIMARY'
  from public.regulatory_facts f
  join public.regulatory_source_locators l on l.source_id = v_irl_lawbook
  where (f.fact_key = 'IRL-LAW-OFFSIDE-PTB' and l.locator_value = 'Offside')
     or (f.fact_key in ('IRL-LAW-KNOCK-ON', 'IRL-LAW-FORWARD-PASS') and l.locator_value = 'Knock-on and Forward Pass')
     or (f.fact_key in ('IRL-LAW-TACKLE-COMPLETION', 'IRL-LAW-PLAY-THE-BALL', 'IRL-LAW-TACKLE-COUNT', 'IRL-LAW-SET-RESTART') and l.locator_value = 'Tackle and Play-the-Ball')
     or (f.fact_key = 'IRL-LAW-SCRUM-BASE' and l.locator_value = 'Scrum')
     or (f.fact_key in ('IRL-LAW-TRY', 'IRL-LAW-CONVERSION', 'IRL-LAW-PENALTY-GOAL', 'IRL-LAW-DROP-GOAL') and l.locator_value = 'Scoring')
     or (f.fact_key = 'IRL-LAW-PENALTY' and l.locator_value = 'Penalty Kick');

  -- ============ Publish every seeded fact ============

  update public.regulatory_facts
  set status = 'VERIFIED', verified_by = v_admin, verified_at = now()
  where fact_key like 'WR-LAW-%' or fact_key like 'IRL-LAW-%';

  -- ============ Tier-2 general content sets ============

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at)
  values ('WR-LAW-OF-THE-GAME-2026', 'union', 'RULES', null, 'PUBLISHED', v_admin, now(), v_admin, now())
  returning id into v_union_set;

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at)
  values ('IRL-LAW-OF-THE-GAME-2026', 'league', 'RULES', null, 'PUBLISHED', v_admin, now(), v_admin, now())
  returning id into v_league_set;

  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values
    (v_union_set, 'ADVANTAGE', v_u_advantage),
    (v_union_set, 'OFFSIDE', v_u_offside),
    (v_union_set, 'KEY_RULES', v_u_knockon),
    (v_union_set, 'KEY_RULES', v_u_fwdpass),
    (v_union_set, 'TACKLE_BREAKDOWN', v_u_tackle_complete),
    (v_union_set, 'TACKLE_BREAKDOWN', v_u_tackle_release),
    (v_union_set, 'TACKLE_BREAKDOWN', v_u_ruck),
    (v_union_set, 'TACKLE_BREAKDOWN', v_u_maul),
    (v_union_set, 'SCRUM', v_u_scrum),
    (v_union_set, 'LINEOUT', v_u_lineout),
    (v_union_set, 'SANCTIONS', v_u_penalty),
    (v_union_set, 'SANCTIONS', v_u_freekick),
    (v_union_set, 'SANCTIONS', v_u_sinbin),
    (v_union_set, 'SANCTIONS', v_u_redcard),
    (v_union_set, 'SANCTIONS', v_u_redcard20),
    (v_union_set, 'FOUL_PLAY', v_u_foulplay),
    (v_union_set, 'SCORING', v_u_try),
    (v_union_set, 'SCORING', v_u_conversion),
    (v_union_set, 'SCORING', v_u_penaltygoal),
    (v_union_set, 'SCORING', v_u_dropgoal);

  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values
    (v_league_set, 'OFFSIDE', v_l_offside),
    (v_league_set, 'KEY_RULES', v_l_knockon),
    (v_league_set, 'KEY_RULES', v_l_fwdpass),
    (v_league_set, 'TACKLE_BREAKDOWN', v_l_tackle_complete),
    (v_league_set, 'TACKLE_BREAKDOWN', v_l_ptb),
    (v_league_set, 'TACKLE_BREAKDOWN', v_l_tacklecount),
    (v_league_set, 'TACKLE_BREAKDOWN', v_l_setrestart),
    (v_league_set, 'SCRUM', v_l_scrum),
    (v_league_set, 'SANCTIONS', v_l_penalty),
    (v_league_set, 'SCORING', v_l_try),
    (v_league_set, 'SCORING', v_l_conversion),
    (v_league_set, 'SCORING', v_l_penaltygoal),
    (v_league_set, 'SCORING', v_l_dropgoal);

  -- ============ RULE_EXPLANATION -> Officiating / Game Knowledge ============

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values
    (v_u_advantage, v_concept_advantage, 'RULE_EXPLANATION'), (v_u_advantage, v_gk_advantage, 'RULE_EXPLANATION'),
    (v_u_offside, v_concept_offside_u, 'RULE_EXPLANATION'), (v_u_offside, v_gk_attackdefence, 'RULE_EXPLANATION'),
    (v_l_offside, v_concept_offside_l, 'RULE_EXPLANATION'), (v_l_offside, v_gk_attackdefence, 'RULE_EXPLANATION'),
    (v_u_knockon, v_concept_knockon, 'RULE_EXPLANATION'), (v_u_fwdpass, v_concept_knockon, 'RULE_EXPLANATION'),
    (v_u_tackle_complete, v_concept_breakdown_u, 'RULE_EXPLANATION'), (v_u_tackle_release, v_concept_breakdown_u, 'RULE_EXPLANATION'),
    (v_u_ruck, v_concept_breakdown_u, 'RULE_EXPLANATION'), (v_u_maul, v_concept_breakdown_u, 'RULE_EXPLANATION');

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values
    (v_l_tackle_complete, v_concept_ptb_l, 'RULE_EXPLANATION'), (v_l_ptb, v_concept_ptb_l, 'RULE_EXPLANATION'),
    (v_l_tacklecount, v_concept_ptb_l, 'RULE_EXPLANATION'), (v_l_setrestart, v_concept_ptb_l, 'RULE_EXPLANATION'),
    (v_u_scrum, v_concept_scrumlineout_u, 'RULE_EXPLANATION'), (v_u_lineout, v_concept_scrumlineout_u, 'RULE_EXPLANATION'), (v_u_scrum, v_gk_scrumlineout, 'RULE_EXPLANATION'),
    (v_l_scrum, v_concept_scrum_l, 'RULE_EXPLANATION'), (v_l_scrum, v_gk_restarts, 'RULE_EXPLANATION'),
    (v_u_foulplay, v_concept_foulplay, 'RULE_EXPLANATION'),
    (v_u_sinbin, v_concept_cards, 'RULE_EXPLANATION'), (v_u_redcard, v_concept_cards, 'RULE_EXPLANATION'), (v_u_redcard20, v_concept_cards, 'RULE_EXPLANATION'),
    (v_u_try, v_gk_scoring, 'RULE_EXPLANATION'), (v_u_conversion, v_gk_scoring, 'RULE_EXPLANATION'),
    (v_l_try, v_gk_scoring, 'RULE_EXPLANATION'), (v_l_conversion, v_gk_scoring, 'RULE_EXPLANATION');

  -- ============ RULE_GLOSSARY -> Glossary ============

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, glossary_term_id, reference_type) values
    (v_u_advantage, v_g_advantage, 'RULE_GLOSSARY'),
    (v_u_offside, v_g_offside_u, 'RULE_GLOSSARY'), (v_l_offside, v_g_offside_l, 'RULE_GLOSSARY'),
    (v_u_knockon, v_g_knockon, 'RULE_GLOSSARY'), (v_l_knockon, v_g_knockon, 'RULE_GLOSSARY'),
    (v_u_fwdpass, v_g_fwdpass, 'RULE_GLOSSARY'), (v_l_fwdpass, v_g_fwdpass, 'RULE_GLOSSARY'),
    (v_u_ruck, v_g_ruck, 'RULE_GLOSSARY'), (v_u_maul, v_g_maul, 'RULE_GLOSSARY'),
    (v_u_scrum, v_g_scrum_u, 'RULE_GLOSSARY'), (v_u_lineout, v_g_lineout, 'RULE_GLOSSARY'), (v_l_scrum, v_g_scrum_l, 'RULE_GLOSSARY'),
    (v_l_ptb, v_g_ptb, 'RULE_GLOSSARY'), (v_l_tacklecount, v_g_tacklecount, 'RULE_GLOSSARY'), (v_l_setrestart, v_g_setrestart, 'RULE_GLOSSARY'),
    (v_u_foulplay, v_g_foulplay, 'RULE_GLOSSARY'),
    (v_u_sinbin, v_g_sinbin, 'RULE_GLOSSARY'), (v_u_sinbin, v_g_yellowcard, 'RULE_GLOSSARY'), (v_u_redcard, v_g_redcard, 'RULE_GLOSSARY');
end $$;
