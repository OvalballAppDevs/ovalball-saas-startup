-- Regulatory content import (Rugby Hub Phase 3, real content population).
--
-- Ports Side Project 3's own genuinely-researched, cited vertical-slice
-- content (Stages 1-5: the source register plus the age-grade-rules,
-- safeguarding, and player-welfare vertical slices) into Main's real
-- regulatory schema (ported schema-only in 20261029010000). Every source
-- URL, date, review_state, fact value, citation, conflict, and reporting
-- route below is taken directly from ovalball-rugby-knowledge's own
-- supabase/seeds/{regulatory_source_register,age_grade_rules_vertical_
-- slice,safeguarding_vertical_slice,player_welfare_vertical_slice}.sql,
-- read and reconciled by hand, not copied file-for-file -- nothing here
-- upgrades an unresolved SP3 finding to something more certain than SP3
-- itself established. In particular:
--   - CONF-0001 (RFU Regulation 15 appendix currency, C-1) is ported OPEN.
--   - CONF-0002 (RFL safeguarding contact email discrepancy) is ported
--     OPEN, independently re-confirmed live via WebFetch against
--     rugby-league.com/governance/safeguarding on 2026-09-07 as still
--     showing safeguarding@rfl.co.uk and still linking only the 2025
--     policy PDF -- both exactly as SP3 itself found them.
--   - RFL-SAFEGUARDING-PAGE-VARIANT-2026 is ported DRAFT and never
--     verified/published, exactly as SP3 built it, specifically to prove
--     the uncertainty survives rather than silently vanishing.
--   - Zero RFU age-grade RULES content and zero RFU safeguarding content
--     are ported, because none exists to port: this migration's own
--     research pass re-attempted both englandrugby.com regulation pages
--     (Regulation 15 Appendix 1, Regulation 21) via WebFetch and got the
--     same HTTP 403 SP3's own Stage 1/3/4 research independently found.
--     A third-party PDF mirror and several secondary summary sites were
--     also found via WebSearch, but none meets the PRIMARY-citation bar
--     this schema requires (and the PDF mirror is itself dated 2025-26,
--     not 2026-27, so even a readable copy would not resolve C-1) -- so
--     none is used. This is a disclosed, honest coverage gap, not a bug.
--
-- Actor: SP3 used a separate, clearly-labelled synthetic seed-actor
-- auth.users row per stage (regulatory_content_sets/regulatory_reporting_
-- routes' own CHECK constraints require a real, non-null actor id for
-- VERIFIED/PUBLISHED -- there is no authenticated human session during a
-- migration). This migration uses ONE such actor for the whole import,
-- named to be unambiguous in any admin UI that later lists verified_by/
-- published_by: this content was verified by an automated import process
-- porting SP3's own already-cited research, not by an independent human
-- regulatory reviewer. A real human review pass remains a legitimate
-- future step and is not claimed to have happened here.
--
-- Publication: every content set/route below that SP3 itself published is
-- published here too (publication_state = 'PUBLISHED'), consistent with
-- this whole merge's own explicit scope -- get Rugby Hub genuinely working
-- and visible locally in Main, never deployed live without a further
-- separate decision. The one deliberate exception is the disputed
-- safeguarding-page-variant route, which stays DRAFT exactly as SP3 left
-- it.

do $$
declare
  v_import_actor uuid := gen_random_uuid();
  v_rfu uuid;
  v_rfl uuid;

  v_source_reg9 uuid;
  v_source_reg15_app1 uuid;
  v_source_helpfaq uuid;
  v_source_firstaid uuid;
  v_source_cgor_2025 uuid;
  v_source_cgor_2026 uuid;
  v_source_safeplay uuid;
  v_source_girls_u12 uuid;
  v_source_reg21 uuid;
  v_source_safeguard_2026 uuid;
  v_source_safeguard_page uuid;

  v_locator_ball_size uuid;

  v_id_rfu_u7 uuid;
  v_id_rfu_u15 uuid;
  v_id_rfu_u6 uuid;
  v_id_rfu_senior_colts uuid;
  v_id_rfl_primary uuid;
  v_id_girls_u12 uuid;
  v_id_elite uuid;

  v_fact_player_count uuid;
  v_fact_pitch_length uuid;
  v_fact_pitch_width uuid;
  v_fact_match_duration uuid;
  v_fact_ball_size uuid;
  v_fact_review_cycle uuid;
  v_fact_community_protocol_rfu uuid;
  v_fact_elite_protocol uuid;
  v_fact_red_flags uuid;
  v_fact_medical_assessment uuid;
  v_fact_remove_from_play uuid;
  v_fact_return_duration uuid;
  v_fact_community_protocol_rfl uuid;

  v_cs_rules uuid;
  v_cs_safeguarding uuid;
  v_cs_rfu_community uuid;
  v_cs_rfu_elite uuid;
  v_cs_rfl_community uuid;
  v_section_match_format uuid;
  v_section_safeguarding uuid;
  v_section_reporting uuid;
  v_section_safety uuid;

  v_conflict_1 uuid;
  v_conflict_2 uuid;

  v_route_team uuid;
  v_route_cpsu uuid;
  v_route_page_variant uuid;
begin
  -- -----------------------------------------------------------------
  -- Import actor -- an FK anchor only, never used to authenticate.
  -- Token columns explicitly set to '' (not left null), matching Main's
  -- own established auth.users-fixture convention (supabase/tests/
  -- site_admin_management.sql) -- this session already hit a real GoTrue
  -- bug earlier from hand-inserted auth.users rows with NULL token
  -- columns, so this avoids repeating it even though this row is never
  -- expected to be scanned by an actual auth flow.
  -- -----------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    v_import_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'regulatory-content-import@ovalball.internal', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', '', ''
  );
  insert into public.profiles (id, first_name, surname)
  values (v_import_actor, 'Regulatory Content Import', '(Automated Process)');

  -- -----------------------------------------------------------------
  -- Authorities
  -- -----------------------------------------------------------------
  insert into public.regulatory_authorities (code, name, rugby_code, website_url)
  values ('RFU', 'Rugby Football Union / England Rugby', 'union', 'https://www.englandrugby.com')
  returning id into v_rfu;

  insert into public.regulatory_authorities (code, name, rugby_code, website_url)
  values ('RFL', 'Rugby Football League', 'league', 'https://www.rugby-league.com')
  returning id into v_rfl;

  -- -----------------------------------------------------------------
  -- Sources (SP3 Stage 1/2/3/4/5 register, ported verbatim)
  -- -----------------------------------------------------------------
  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, publication_date, retrieved_on, effective_from, review_state, provenance_notes,
    created_by, updated_by
  ) values (
    'RFU-REG9-2026-001', v_rfu, 'union', 'RFU Regulation 9 - Player Safety', 'REGULATION', 'PRIMARY_REGULATION',
    'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-9-player-safety',
    '2026-07-30', '2026-09-06', '2026-08-01', 'VERIFIED_CURRENT',
    'Full text captured directly via live browser navigation; page-level Last Updated banner confirmed. (SP3 Stage 1/5.)',
    v_import_actor, v_import_actor
  ) returning id into v_source_reg9;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, publication_date, retrieved_on, effective_from, review_state, provenance_notes,
    created_by, updated_by
  ) values (
    'RFU-REG15-APP1-2025-001', v_rfu, 'union', 'RFU Regulation 15 Appendix 1 - U7 Rules of Play', 'REGULATION', 'PRIMARY_REGULATION',
    'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby/regulation-15-appendix-1-u7-rules-of-play',
    '2025-07-31', '2026-09-07', '2025-08-01', 'REVIEW_REQUIRED',
    'Page banner reads 2025/26 despite the parent Regulation 15 page/PDF being stamped 2026/27 -- unresolved whether content differs; see Conflict Register C-1 (CONF-0001). Re-checked directly via WebFetch during this Phase 3 import (2026-09-07): still returns HTTP 403, same blocking SP3 Stage 1/3 found -- currency question remains genuinely unresolved, not guessed at.',
    v_import_actor, v_import_actor
  ) returning id into v_source_reg15_app1;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFU-HELPFAQ-2025-001', v_rfu, 'union', 'FAQs for Age Grade 2025-26', 'WEB_GUIDANCE', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'https://help.rfu.com/support/solutions/articles/103000123394-faqs-for-age-grade-2025-26',
    '2026-09-06', 'STALE',
    'Explicitly prior-season by its own title; no 2026-27 replacement located in SP3 Stage 1 or in this Phase 3 re-check.',
    v_import_actor, v_import_actor
  ) returning id into v_source_helpfaq;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, effective_from, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-FIRSTAID-2026-001', v_rfl, 'league', 'Community Game First Aid Standards 2026 (Operational Rules Section F6)', 'POLICY_DOCUMENT', 'PRIMARY_MEDICAL_GUIDANCE',
    'https://www.rugby-league.com/uploads/docs/F6%20First%20Aid%20Standards%202026.pdf',
    '2026-09-06', '2026-02-03', 'VERIFIED_CURRENT',
    'Full text extracted directly via pypdf; server Last-Modified header cross-checked (3 Feb 2026). Re-fetched and re-extracted in SP3 Stage 5 (44 pages): Section 6 Red Flags list, Recognise/Remove/Recovery/Return structure, and the full 6-stage GRAS table all confirmed present.',
    v_import_actor, v_import_actor
  ) returning id into v_source_firstaid;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-CGOR-2025-001', v_rfl, 'league', 'Tiers 4-6 (Community Game) Operational Rules 2025', 'RULEBOOK', 'PRIMARY_RULE_BOOK',
    'https://www.rugby-league.com/uploads/docs/Operational%20Rules%20T4-6%202025.pdf',
    '2026-09-06', 'SUPERSEDED',
    'Superseded by RFL-CGOR-2026-001.',
    v_import_actor, v_import_actor
  ) returning id into v_source_cgor_2025;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, supersedes_source_id, provenance_notes, created_by, updated_by
  ) values (
    'RFL-CGOR-2026-001', v_rfl, 'league', 'Community Game Operational Rules 2026 (Tiers 3/4-6, master document)', 'RULEBOOK', 'PRIMARY_RULE_BOOK',
    'https://www.rugby-league.com/uploads/docs/Community%20Game%20Operational%20Rules%202026_Final.pdf',
    '2026-09-06', 'VERIFIED_CURRENT', v_source_cgor_2025,
    'Full text extracted directly via pypdf (240pp); server Last-Modified header cross-checked (6 Feb 2026). Own document carries an internal tier-numbering inconsistency (cover vs running header) -- see Conflict Register C-3, not resolved here.',
    v_import_actor, v_import_actor
  ) returning id into v_source_cgor_2026;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-SAFEPLAY-2026-001', v_rfl, 'league', '2026 Safe Play Code', 'POLICY_DOCUMENT', 'PRIMARY_SAFEGUARDING_GUIDANCE',
    'https://www.rugby-league.com/uploads/docs/2026%20Safe%20Play%20Code.pdf',
    '2026-09-06', 'REVIEW_REQUIRED',
    'Confirmed to exist and be 2026-dated (server Last-Modified 12 Mar 2026), but returned zero extractable text -- appears image/graphic-based. Needs OCR or manual visual review before any fact can cite it as PRIMARY.',
    v_import_actor, v_import_actor
  ) returning id into v_source_safeplay;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-GIRLSU12-2026-001', v_rfl, 'league', 'Under 12s Modified Rules 2026 (RFL Girls Rugby League)', 'RULEBOOK', 'PRIMARY_RULE_BOOK',
    'https://www.rugby-league.com/uploads/docs/Under%2012''s%20Girls%20Rugby%20League%20Rules%202026.pdf',
    '2026-09-06', 'VERIFIED_CURRENT',
    'Full text extracted directly via pypdf; server Last-Modified header cross-checked (26 Feb 2026). Single continuous ruleset document, no internal section/appendix numbering found.',
    v_import_actor, v_import_actor
  ) returning id into v_source_girls_u12;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, publication_date, retrieved_on, effective_from, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFU-REG21-2026-001', v_rfu, 'union', 'RFU Regulation 21 - Safeguarding', 'REGULATION', 'PRIMARY_SAFEGUARDING_GUIDANCE',
    'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-21-safeguarding',
    '2026-07-31', '2026-09-07', '2026-08-01', 'VERIFIED_CURRENT',
    'Currency confirmed by title/date-banner inspection only -- full text never extracted (SP3 Stage 1/4, and this Phase 3 import''s own re-check: direct HTML fetch via WebFetch returned HTTP 403, same access pattern as C-1). No fact or reporting route cites this source; there is no extracted text to build one from.',
    v_import_actor, v_import_actor
  ) returning id into v_source_reg21;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-SAFEGUARD-2026-001', v_rfl, 'league', 'RFL Safeguarding Policy 2026', 'POLICY_DOCUMENT', 'PRIMARY_SAFEGUARDING_GUIDANCE',
    'https://www.rugby-league.com/uploads/docs/RFL%20Safeguarding%20Policy%202026.pdf',
    '2026-09-06', 'VERIFIED_CURRENT',
    'Directly fetched and text-extracted in SP3 Stage 4: in-document review-cycle dates (last review January 2026, next review January 2027) and contact addresses (safeguarding@rfl.uk.com; cpsu@nspcc.org.uk; help@nspcc.org.uk) confirmed present.',
    v_import_actor, v_import_actor
  ) returning id into v_source_safeguard_2026;

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, review_state, provenance_notes, created_by, updated_by
  ) values (
    'RFL-SAFEGUARDPAGE-2026-001', v_rfl, 'league', 'RFL Safeguarding governance page', 'WEB_GUIDANCE', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'https://www.rugby-league.com/governance/safeguarding',
    '2026-09-07', 'CONFLICTING',
    'Live page features only the 2025 policy PDF (Conflict Register C-4), and gives a different safeguarding contact email (safeguarding@rfl.co.uk) than RFL-SAFEGUARD-2026-001''s own text (safeguarding@rfl.uk.com) -- see Conflict Register CONF-0002. Marked CONFLICTING (not merely REVIEW_REQUIRED) because the specific contact detail this page provides is actively disputed. Independently re-fetched live via WebFetch during this Phase 3 import (2026-09-07): both discrepancies confirmed still current, not resolved.',
    v_import_actor, v_import_actor
  ) returning id into v_source_safeguard_page;

  insert into public.regulatory_source_locators (source_id, locator_type, locator_value, description)
  values (v_source_cgor_2026, 'SECTION', 'B2:2:2', 'Ball size table by age band and gender/pathway')
  returning id into v_locator_ball_size;

  -- -----------------------------------------------------------------
  -- Regulatory identities. ovalball_canonical_team_type_id is wired to
  -- Main's REAL canonical_team_types catalogue where doing so is safe and
  -- meaningful (Phase 2's header already noted the FK is real now that
  -- integration has happened -- SP3 kept it soft/unresolved by design).
  -- Two deliberate exceptions stay unmapped: RFL-PRIMARY spans multiple
  -- team types ("up to ~U11") and a single FK column cannot represent a
  -- composite range without misrepresenting it as one specific type;
  -- RFU-PREM-CHAMP-PWR is professional/elite rugby with no Ovalball
  -- club-level team equivalent at all. Both stay real, honest,
  -- permanently-unmapped register rows rather than a forced guess.
  -- -----------------------------------------------------------------
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes, source_register_reference, ovalball_canonical_team_type_id)
  values ('union', 'RFU-U7', 'RFU Age Grade U7', 'DIRECT', null, 'Coverage Matrix: RFU U7', (select id from public.canonical_team_types where key = 'u7'))
  returning id into v_id_rfu_u7;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes, source_register_reference, ovalball_canonical_team_type_id)
  values ('union', 'RFU-U15', 'RFU Age Grade U15', 'DIRECT', null, 'Coverage Matrix: RFU U15', (select id from public.canonical_team_types where key = 'u15'))
  returning id into v_id_rfu_u15;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes, source_register_reference, ovalball_canonical_team_type_id)
  values (
    'union', 'RFU-U6', 'Ovalball U6 (Union)', 'NO_DIRECT_MAPPING',
    'RFU Regulation 11 explicitly scopes "Age Grade Rugby" as U7-U18. U6 sits outside that regulated definition entirely; no regulated Rules-of-Play source was located. Do not invent one.',
    'Coverage Matrix: RFU U6', (select id from public.canonical_team_types where key = 'u6')
  ) returning id into v_id_rfu_u6;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes, source_register_reference, ovalball_canonical_team_type_id)
  values (
    'union', 'RFU-SENIOR-COLTS', 'Ovalball Senior Colts (Union)', 'NO_DIRECT_MAPPING',
    '"Senior Colts" is not a current RFU regulatory term -- current Regulation 15 / Appendix 9 use U15/U16/U17/U18 exclusively. "Colts" persists only as informal club/league branding, informally corresponding to roughly U18/U19. Do not treat this as a confirmed RFU category.',
    'Coverage Matrix: Junior/Senior Colts', (select id from public.canonical_team_types where key = 'senior_colts')
  ) returning id into v_id_rfu_senior_colts;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes, source_register_reference, ovalball_canonical_team_type_id)
  values ('league', 'RFL-PRIMARY', 'RFL Primary Rugby League (up to ~U11)', 'DIRECT', null, 'Coverage Matrix: Primary/Mini', null)
  returning id into v_id_rfl_primary;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, source_register_reference, ovalball_canonical_team_type_id)
  values ('league', 'RFL-GIRLS-U12', 'RFL Girls Rugby League, Under 12', 'DIRECT', 'Coverage Matrix: Girls U12', (select id from public.canonical_team_types where key = 'girls_u12'))
  returning id into v_id_girls_u12;

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, source_register_reference, ovalball_canonical_team_type_id)
  values ('union', 'RFU-PREM-CHAMP-PWR', 'RFU Premiership / Championship / PWR (elite/professional)', 'DIRECT', 'Regulation 9 SS9.5', null)
  returning id into v_id_elite;

  -- -----------------------------------------------------------------
  -- Conflicts (both OPEN, ported exactly as SP3 left them)
  -- -----------------------------------------------------------------
  insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, affected_regulatory_identity_id, description, review_state)
  values (
    'CONF-0001', 'RULES', 'union', v_id_rfu_u7,
    'RFU Regulation 15''s parent index page and master PDF are stamped 2026/27, but its own Rules-of-Play appendices (sampled: Appendix 1 U7, Appendix 9 U15-U18) still display 2025/26 date banners. Unresolved whether appendix content actually changed or the sub-pages simply were not re-stamped. Requires a human to open the 2026/27 PDF directly and diff it against the HTML appendix content. Independently re-attempted via WebFetch during Phase 3 import (2026-09-07): still HTTP 403, unresolved.',
    'OPEN'
  ) returning id into v_conflict_1;
  insert into public.regulatory_conflict_sources (conflict_id, source_id) values (v_conflict_1, v_source_reg15_app1);

  insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, description, review_state, created_by)
  values (
    'CONF-0002', 'SAFEGUARDING', 'league',
    'RFL''s own primary 2026 Safeguarding Policy document states the safeguarding contact email as safeguarding@rfl.uk.com; the live governance page (rugby-league.com/governance/safeguarding) instead shows safeguarding@rfl.co.uk. Both are official RFL touchpoints; which is the currently-correct address for a user to actually use has not been independently confirmed and is not guessed here. Also re-confirms C-4: the live page still links only the 2025 policy PDF. Independently re-fetched live during Phase 3 import (2026-09-07): both discrepancies still current.',
    'OPEN', v_import_actor
  ) returning id into v_conflict_2;
  insert into public.regulatory_conflict_sources (conflict_id, source_id) values
    (v_conflict_2, v_source_safeguard_2026),
    (v_conflict_2, v_source_safeguard_page);

  -- -----------------------------------------------------------------
  -- Age-grade RULES facts (RFL Girls U12 -- SP3 Stage 3, RFL-only, since
  -- no RFU age-grade source was ever readable)
  -- -----------------------------------------------------------------
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_integer, value_unit, status, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-GIRLS-U12-2026-PLAYER-COUNT', 'PLAYER_COUNT', 'RULES', 'league', 'INTEGER', 11, 'players per side',
    'VERIFIED', v_import_actor, now(),
    'Source states 11-a-side, with a minimum-equal-numbers provision if a side is short -- that conditional qualifier is preserved here, not silently dropped.',
    v_import_actor, v_import_actor
  ) returning id into v_fact_player_count;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, gender_pathway) values (v_fact_player_count, v_id_girls_u12, 'FEMALE');
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by) values (v_fact_player_count, v_source_girls_u12, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_range_min, value_range_max, value_unit, status, verified_by, verified_at, created_by, updated_by)
  values ('RFL-GIRLS-U12-2026-PITCH-LENGTH', 'PITCH_LENGTH', 'RULES', 'league', 'RANGE', 60, 80, 'metres', 'VERIFIED', v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_fact_pitch_length;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, gender_pathway) values (v_fact_pitch_length, v_id_girls_u12, 'FEMALE');
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by) values (v_fact_pitch_length, v_source_girls_u12, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_range_min, value_range_max, value_unit, status, verified_by, verified_at, created_by, updated_by)
  values ('RFL-GIRLS-U12-2026-PITCH-WIDTH', 'PITCH_WIDTH', 'RULES', 'league', 'RANGE', 40, 50, 'metres', 'VERIFIED', v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_fact_pitch_width;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, gender_pathway) values (v_fact_pitch_width, v_id_girls_u12, 'FEMALE');
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by) values (v_fact_pitch_width, v_source_girls_u12, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_duration_minutes, value_unit, status, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-GIRLS-U12-2026-HALF-DURATION', 'MATCH_DURATION', 'RULES', 'league', 'DURATION', 20, 'minutes',
    'VERIFIED', v_import_actor, now(),
    'Duration of ONE half. Two halves are played with a 5-minute half-time break (see this fact''s own section audience copy) -- kept as one canonical duration value rather than a separately-invented "total match time" figure.',
    v_import_actor, v_import_actor
  ) returning id into v_fact_match_duration;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, gender_pathway) values (v_fact_match_duration, v_id_girls_u12, 'FEMALE');
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by) values (v_fact_match_duration, v_source_girls_u12, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_enum, status, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-GIRLS-U12-2026-BALL-SIZE', 'BALL_SIZE', 'RULES', 'league', 'ENUM', 'SIZE_4',
    'VERIFIED', v_import_actor, now(),
    'Female pathway, U12-U18 band per the Operational Rules 2026 ball-size table (Section B2:2:2) -- this specific age happens to share Size 4 with the male U12-13 band; that coincidence is not assumed to hold at every age and is not generalised beyond what the table itself states.',
    v_import_actor, v_import_actor
  ) returning id into v_fact_ball_size;
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id, gender_pathway) values (v_fact_ball_size, v_id_girls_u12, 'FEMALE');
  insert into public.regulatory_fact_citations (fact_id, source_id, locator_id, support_role, created_by) values (v_fact_ball_size, v_source_cgor_2026, v_locator_ball_size, 'PRIMARY', v_import_actor);

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by)
  values ('RFL-GIRLS-U12-2026-RULES', 'league', 'RULES', v_id_girls_u12, 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_cs_rules;

  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id) values
    (v_cs_rules, 'PLAYER_COUNT', 1, v_fact_player_count),
    (v_cs_rules, 'PITCH', 2, v_fact_pitch_length),
    (v_cs_rules, 'OTHER', 3, v_fact_pitch_width),
    (v_cs_rules, 'BALL', 4, v_fact_ball_size);

  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_cs_rules, 'MATCH_FORMAT', 5, v_fact_match_duration)
  returning id into v_section_match_format;
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (v_section_match_format, 'GENERAL', 'Two halves of 20 minutes each, with a 5-minute half-time break.', v_import_actor, v_import_actor);

  -- -----------------------------------------------------------------
  -- Safeguarding (general, RFL -- SP3 Stage 4)
  -- -----------------------------------------------------------------
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-SAFEGUARD-2026-REVIEW-CYCLE', 'SAFEGUARDING_REVIEW_CYCLE', 'SAFEGUARDING', 'league', 'TEXT',
    'Reviewed January 2026; next review due January 2027.',
    'VERIFIED', v_import_actor, now(),
    'Directly stated in the source document''s own review-date fields, not an inferred or estimated cadence.',
    v_import_actor, v_import_actor
  ) returning id into v_fact_review_cycle;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_review_cycle, v_source_safeguard_2026, 'PRIMARY', v_import_actor);

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, effective_from, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by)
  values ('RFL-SAFEGUARDING-2026-GENERAL', 'league', 'SAFEGUARDING', null, '2026-01-01', 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_cs_safeguarding;

  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_cs_safeguarding, 'SAFEGUARDING', 1, v_fact_review_cycle)
  returning id into v_section_safeguarding;
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (v_section_safeguarding, 'GENERAL', 'This information reflects the Rugby Football League''s Safeguarding Policy, most recently reviewed in January 2026 (next review due January 2027).', v_import_actor, v_import_actor);

  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_cs_safeguarding, 'REPORTING', 2, null)
  returning id into v_section_reporting;
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (v_section_reporting, 'GENERAL', 'If you have a safeguarding concern in Rugby League, you can raise it with your club''s own Welfare Officer, with the RFL Safeguarding Team, or with the NSPCC Child Protection in Sport Unit directly -- see the official contact details published alongside this guidance.', v_import_actor, v_import_actor);
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (v_section_reporting, 'PARENT', 'If you''re worried about your child''s safety in Rugby League, you don''t have to handle it alone. Speak to your club''s Welfare Officer, contact the RFL Safeguarding Team directly, or reach out to the NSPCC Child Protection in Sport Unit -- their official contact details are shown below.', v_import_actor, v_import_actor);

  insert into public.regulatory_reporting_routes (
    route_key, rugby_code, authority_id, route_type, classification, label, email,
    effective_from, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by
  ) values (
    'RFL-SAFEGUARDING-TEAM-2026', 'league', v_rfl, 'GOVERNING_BODY_SAFEGUARDING_TEAM', 'NON_EMERGENCY', 'RFL Safeguarding Team', 'safeguarding@rfl.uk.com',
    '2026-01-01', 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor
  ) returning id into v_route_team;
  insert into public.regulatory_reporting_route_citations (route_id, source_id, support_role, created_by)
  values (v_route_team, v_source_safeguard_2026, 'PRIMARY', v_import_actor);

  insert into public.regulatory_reporting_routes (
    route_key, rugby_code, authority_id, route_type, classification, label, email, url,
    effective_from, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by
  ) values (
    'RFL-CPSU-NSPCC-PARTNER-2026', 'league', v_rfl, 'EXTERNAL_CHILD_PROTECTION_PARTNER', 'NON_EMERGENCY', 'NSPCC Child Protection in Sport Unit (CPSU)', 'cpsu@nspcc.org.uk', 'https://thecpsu.org.uk',
    '2026-01-01', 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor
  ) returning id into v_route_cpsu;
  insert into public.regulatory_reporting_route_citations (route_id, source_id, support_role, created_by)
  values (v_route_cpsu, v_source_safeguard_2026, 'PRIMARY', v_import_actor);

  -- Deliberately left DRAFT -- never verified/published. Proves CONF-0002
  -- survives as real, queryable, un-resolved data.
  insert into public.regulatory_reporting_routes (
    route_key, rugby_code, authority_id, route_type, classification, label, email, phone,
    notes, created_by, updated_by
  ) values (
    'RFL-SAFEGUARDING-PAGE-VARIANT-2026', 'league', v_rfl, 'GOVERNING_BODY_SAFEGUARDING_TEAM', 'NON_EMERGENCY',
    'RFL Safeguarding Team (live governance page variant -- disputed, see CONF-0002)', 'safeguarding@rfl.co.uk', '0330 111 1113',
    'Deliberately left DRAFT. Cites RFL-SAFEGUARDPAGE-2026-001, which is CONFLICTING -- this route cannot be verified until CONF-0002 is resolved by a human.',
    v_import_actor, v_import_actor
  ) returning id into v_route_page_variant;
  insert into public.regulatory_reporting_route_citations (route_id, source_id, support_role, created_by)
  values (v_route_page_variant, v_source_safeguard_page, 'PRIMARY', v_import_actor);

  -- -----------------------------------------------------------------
  -- Player welfare (RFU community + RFU elite + RFL community -- SP3
  -- Stage 5, three deliberately separate content sets)
  -- -----------------------------------------------------------------
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFU-REG9-COMMUNITY-PROTOCOL', 'COMMUNITY_GAME_PROTOCOL', 'PLAYER_WELFARE', 'union', 'TEXT',
    'Age-grade and non-elite adult matches follow the HEADCASE hub and the Graduated Return to Activity and Sport (GRAS) programme.',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Regulation 9 SS9.6.', v_import_actor, v_import_actor
  ) returning id into v_fact_community_protocol_rfu;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_community_protocol_rfu, v_source_reg9, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFU-REG9-ELITE-PROTOCOL', 'ELITE_PROTOCOL', 'PLAYER_WELFARE', 'union', 'TEXT',
    'Premiership, Championship, and PWR matches follow a separate, non-HEADCASE concussion management process. This protocol does not apply to community or age-grade rugby.',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Regulation 9 SS9.5. Deliberately scoped only to RFU-PREM-CHAMP-PWR -- never generalised to community/age-grade identities.', v_import_actor, v_import_actor
  ) returning id into v_fact_elite_protocol;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_elite_protocol, v_source_reg9, 'PRIMARY', v_import_actor);
  insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
  values (v_fact_elite_protocol, v_id_elite);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-FIRSTAID-RED-FLAGS', 'RED_FLAGS_EMERGENCY', 'PLAYER_WELFARE', 'league', 'TEXT',
    'A player with any red-flag sign or symptom after a head injury must have an urgent medical assessment at a hospital Accident and Emergency (A&E) department, using an emergency ambulance (999) transfer if necessary.',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Section 6.1, Red Flags of Structural Brain Injuries.', v_import_actor, v_import_actor
  ) returning id into v_fact_red_flags;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_red_flags, v_source_firstaid, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-FIRSTAID-MEDICAL-ASSESSMENT', 'MEDICAL_ASSESSMENT', 'PLAYER_WELFARE', 'league', 'TEXT',
    'All players suspected of having experienced a concussion must seek medical assessment from NHS 111 or another NHS service within 24 hours of injury.',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Section 6.2.4, Remove.', v_import_actor, v_import_actor
  ) returning id into v_fact_medical_assessment;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_medical_assessment, v_source_firstaid, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-FIRSTAID-REMOVE-FROM-PLAY', 'REMOVE_FROM_PLAY', 'PLAYER_WELFARE', 'league', 'TEXT',
    'A player with any possible sign or symptom of concussion must be removed from the field immediately and must not return to play that day, even if symptoms appear to resolve -- "if in doubt, sit them out."',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Section 6.2.4, Remove. No diagnosis is required before removal -- the source itself requires removal on suspicion alone, and this fact does not add one.', v_import_actor, v_import_actor
  ) returning id into v_fact_remove_from_play;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_remove_from_play, v_source_firstaid, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_integer, value_unit, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-FIRSTAID-RETURN-TO-PLAY-MINIMUM', 'RETURN_TO_PLAY_MINIMUM_DURATION', 'PLAYER_WELFARE', 'league', 'INTEGER',
    21, 'days',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Section 6.2.6/GRAS Tables. This is a MINIMUM, not a target -- players must not progress through the 6-stage Graduated Return to Activity and Sport (GRAS) programme faster than its own stage timelines, and must additionally be symptom-free for 14 consecutive days before returning to full contact training. The GRAS timelines apply to all Rugby League players and are explicitly stated as not age-specific; extra care is required for players with physical or cognitive impairment/disabilities. This single duration value deliberately does not attempt to encode the full 6-stage sequence itself, to avoid over-structuring a clinically-led, symptom-driven process into false numeric certainty.',
    v_import_actor, v_import_actor
  ) returning id into v_fact_return_duration;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_return_duration, v_source_firstaid, 'PRIMARY', v_import_actor);

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, obligation_level, verified_by, verified_at, notes, created_by, updated_by)
  values (
    'RFL-FIRSTAID-COMMUNITY-PROTOCOL', 'COMMUNITY_GAME_PROTOCOL', 'PLAYER_WELFARE', 'league', 'TEXT',
    'There is no Head Injury Assessment (HIA) process in the Community Game -- any possible sign or symptom of concussion requires immediate removal from play, without an on-field assessment process.',
    'VERIFIED', 'MANDATORY', v_import_actor, now(),
    'Section 6.2.1/6.2.4. Distinguishes community-game protocol from the professional game''s own HIA process (out of scope for this slice).', v_import_actor, v_import_actor
  ) returning id into v_fact_community_protocol_rfl;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role, created_by)
  values (v_fact_community_protocol_rfl, v_source_firstaid, 'PRIMARY', v_import_actor);

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by)
  values ('RFU-PLAYER-WELFARE-COMMUNITY-2026', 'union', 'PLAYER_WELFARE', null, 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_cs_rfu_community;
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_cs_rfu_community, 'CONCUSSION', 1, v_fact_community_protocol_rfu);

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by)
  values ('RFU-PLAYER-WELFARE-ELITE-2026', 'union', 'PLAYER_WELFARE', v_id_elite, 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_cs_rfu_elite;
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_cs_rfu_elite, 'CONCUSSION', 1, v_fact_elite_protocol);

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at, created_by, updated_by)
  values ('RFL-PLAYER-WELFARE-COMMUNITY-2026', 'league', 'PLAYER_WELFARE', null, 'PUBLISHED', v_import_actor, now(), v_import_actor, now(), v_import_actor, v_import_actor)
  returning id into v_cs_rfl_community;
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id) values
    (v_cs_rfl_community, 'EMERGENCY', 1, v_fact_red_flags),
    (v_cs_rfl_community, 'MEDICAL_ASSESSMENT', 2, v_fact_medical_assessment),
    (v_cs_rfl_community, 'SAFETY', 3, v_fact_remove_from_play),
    (v_cs_rfl_community, 'RETURN_TO_PLAY', 4, v_fact_return_duration),
    (v_cs_rfl_community, 'CONCUSSION', 5, v_fact_community_protocol_rfl);

  select sec.id into v_section_safety from public.regulatory_content_sections sec
  where sec.content_set_id = v_cs_rfl_community and sec.section_key = 'SAFETY';
  insert into public.regulatory_content_section_audience_copy (content_section_id, audience, body, created_by, updated_by)
  values (v_section_safety, 'PLAYER', 'If you or a teammate might have a concussion, stop playing straight away -- even if you feel okay. It''s not about being tough, it''s about keeping your brain safe. Tell your coach or first aider immediately.', v_import_actor, v_import_actor);
end $$;
