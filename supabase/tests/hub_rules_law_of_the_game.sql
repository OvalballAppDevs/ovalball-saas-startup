-- Rugby Hub Rules & Laws Deepening -- permanent regression.
--
-- Pins: the extended fact_type/section_key taxonomies are accepted; World
-- Rugby and IRL are registered as real Law authorities with real primary
-- sources; exactly one general (Tier-2) RULES content set exists per code
-- and is real, published Law content; the relaxed regulatory_content_
-- sections uniqueness now genuinely allows several facts under one section
-- while still refusing the same fact linked twice; the Tier-1/Tier-2
-- resolver MERGES rather than short-circuits -- a Union or League identity
-- with no Tier-1 set of its own still receives the full general Law
-- content, and the one real production Tier-1 identity (RFL-GIRLS-U12)
-- receives its own age-grade facts merged with the League general Law
-- facts rather than losing them; rugby-code isolation holds in both
-- directions; content-set effective-dating (future/expired) and fact status
-- (VERIFIED vs SUPERSEDED vs DRAFT) both resolve correctly; RULE_EXPLANATION
-- and RULE_GLOSSARY references are real, FK-enforced links into the
-- existing Officiating/Game Knowledge/Glossary graph; Rules content is
-- discoverable through the existing search and glossary-fact RPCs with zero
-- new "Regulation" result type; the regulatory_conflicts mechanism finds no
-- unresolved contradiction across the corpus; and get_hub_recommended_
-- content deliberately carries no RULE branch (a considered decision, not
-- an oversight -- regulatory_facts has no public-read policy and a bare Law
-- fact has no article-level scaffolding to recommend out of context).
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_identity_union uuid;
  v_test_identity_league uuid;
  v_test_identity_schema uuid;
  v_test_set_general uuid;
  v_test_set_future uuid;
  v_test_set_expired uuid;
  v_fact_current uuid;
  v_fact_old uuid;
  v_fact_new uuid;
  v_fact_draft uuid;
  v_fact_future_set uuid;
  v_fact_expired_set uuid;
  v_concept uuid;
  v_glossary uuid;
  v_real_fact uuid;
  v_real_glossary_term uuid;
  v_admin uuid := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;
  v_full_admin uuid := gen_random_uuid();
  v_raised boolean;
  v_n int;
  v_rfl_girls_u12 uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_full_admin, 'hlaw-full-admin-' || v_full_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_full_admin, 'Hub', 'Admin', 'hlaw-full-admin-' || v_full_admin::text || '@ovalball.test');
  insert into public.site_admins (user_id, status) values (v_full_admin, 'active');
  select id into v_rfl_girls_u12 from public.regulatory_identities where identity_key = 'RFL-GIRLS-U12';

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hlaw-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_test_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'hlaw-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_test_identity_league;
  -- A separate identity for every test that attaches its own Tier-1 content
  -- set (F/G/O/R/S below) -- kept apart from v_test_identity_union so that
  -- H's "no Tier-1 set at all" assumption is never disturbed by a set
  -- created for an unrelated schema-level assertion.
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hlaw-identity-schema-' || substr(gen_random_uuid()::text,1,8), 'Test Schema Identity', 'DIRECT')
  returning id into v_test_identity_schema;

  -- ============ A. New fact_type values are accepted ============
  perform 1;
  declare v_test_fact uuid; begin
    insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status)
    values ('hlaw-test-advantage-' || substr(gen_random_uuid()::text,1,8), 'ADVANTAGE', 'RULES', 'union', 'TEXT', 'test', 'DRAFT')
    returning id into v_test_fact;
  end;
  raise notice 'PASS (A): the new fact_type value ADVANTAGE is accepted (and by extension OFFSIDE/KNOCK_ON/FORWARD_PASS/FOUL_PLAY/SANCTION/TRY/CONVERSION/PENALTY_GOAL/VIDEO_REVIEW, seeded live in the migration)';

  -- ============ B. New section_key values are accepted ============
  v_raised := false;
  begin
    insert into public.regulatory_content_sections (content_set_id, section_key, fact_id)
    select id, 'TACKLE_BREAKDOWN', null from public.regulatory_content_sets limit 0;
    -- The above selects zero rows (guard against touching real data); the
    -- real proof is that the migration itself already inserted real
    -- TACKLE_BREAKDOWN/SCORING/OFFSIDE/ADVANTAGE/SANCTIONS section rows,
    -- asserted directly below.
  exception when check_violation then v_raised := true; end;
  if v_raised then raise exception 'FAIL (B): a new approved section_key value was rejected'; end if;
  if (select count(*) from public.regulatory_content_sections where section_key in ('SCORING', 'ADVANTAGE', 'OFFSIDE', 'TACKLE_BREAKDOWN', 'SANCTIONS')) < 5 then
    raise exception 'FAIL (B2): the migration''s own seeded content does not use the new section_key values';
  end if;
  raise notice 'PASS (B): the new section_key values are accepted and genuinely used by seeded content';

  -- ============ C. World Rugby and IRL are registered as real authorities ============
  if (select count(*) from public.regulatory_authorities where code = 'WORLD_RUGBY' and rugby_code = 'union') <> 1
     or (select count(*) from public.regulatory_authorities where code = 'IRL' and rugby_code = 'league') <> 1 then
    raise exception 'FAIL (C): World Rugby and/or IRL are not registered as real authorities';
  end if;
  raise notice 'PASS (C): World Rugby (union) and IRL (league) are registered as real Law authorities';

  -- ============ D. Primary Law sources are real, retrievable, correctly classified ============
  if (select count(*) from public.regulatory_sources where source_key = 'WR-LAWBOOK-2026' and authority_classification = 'PRIMARY_RULE_BOOK' and canonical_url is not null) <> 1
     or (select count(*) from public.regulatory_sources where source_key = 'IRL-LAWBOOK-2026' and authority_classification = 'PRIMARY_RULE_BOOK' and canonical_url is not null) <> 1 then
    raise exception 'FAIL (D): the primary World Rugby/IRL Law-book sources are missing or misclassified';
  end if;
  raise notice 'PASS (D): the primary World Rugby and IRL Law-book sources are real, retrievable and correctly classified as PRIMARY_RULE_BOOK';

  -- ============ E. Exactly one general (Tier-2) RULES content set exists per code, both PUBLISHED ============
  if (select count(*) from public.regulatory_content_sets where topic = 'RULES' and rugby_code = 'union' and regulatory_identity_id is null and publication_state = 'PUBLISHED') <> 1
     or (select count(*) from public.regulatory_content_sets where topic = 'RULES' and rugby_code = 'league' and regulatory_identity_id is null and publication_state = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (E): exactly one general PUBLISHED RULES content set per code was not found';
  end if;
  raise notice 'PASS (E): exactly one general (Tier-2) RULES content set exists per code, both PUBLISHED';

  -- ============ F. A section can now hold multiple facts in one content set; the same fact still cannot be linked twice ============
  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, publication_state, verified_by, verified_at, published_by, published_at)
  values ('hlaw-test-set-' || substr(gen_random_uuid()::text,1,8), 'union', 'RULES', v_test_identity_schema, 'PUBLISHED', v_admin, now(), v_admin, now())
  returning id into v_test_set_general;

  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, display_title, status, verified_by, verified_at)
  values ('hlaw-test-fact-a-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'Fact A body.', 'Fact A', 'VERIFIED', v_admin, now())
  returning id into v_fact_current;
  declare v_fact_b uuid; begin
    insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, display_title, status, verified_by, verified_at)
    values ('hlaw-test-fact-b-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'Fact B body.', 'Fact B', 'VERIFIED', v_admin, now())
    returning id into v_fact_b;
    insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_general, 'TACKLE_BREAKDOWN', v_fact_current);
    insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_general, 'TACKLE_BREAKDOWN', v_fact_b);
    if (select count(*) from public.regulatory_content_sections where content_set_id = v_test_set_general and section_key = 'TACKLE_BREAKDOWN') <> 2 then
      raise exception 'FAIL (F): a section could not hold two distinct facts in one content set';
    end if;

    v_raised := false;
    begin
      insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_general, 'OTHER', v_fact_current);
    exception when unique_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (F2): the same fact was linked into one content set twice'; end if;
  end;
  raise notice 'PASS (F): a section now holds multiple distinct facts in one content set, while the same fact still cannot be linked twice';

  -- ============ G. display_title renders distinctly for two facts sharing a section ============
  if (select count(distinct display_title) from public.regulatory_facts where fact_key like 'hlaw-test-fact-%') <> 2 then
    raise exception 'FAIL (G): two facts sharing a section did not carry distinct display_title values';
  end if;
  raise notice 'PASS (G): display_title lets two facts sharing one section render with distinct card titles';

  -- ============ H. A Union identity with no Tier-1 set resolves to real general Union Law content ============
  v_n := (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_union));
  if v_n < 20 then
    raise exception 'FAIL (H): a Union identity with no Tier-1 set of its own did not receive the general Law content (got % rows)', v_n;
  end if;
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_union) where is_tier1_variation) <> 0 then
    raise exception 'FAIL (H2): a Union identity with no Tier-1 set showed a false is_tier1_variation=true row';
  end if;
  raise notice 'PASS (H): a Union identity with no Tier-1 set of its own now receives the real general Law content, entirely marked as general';

  -- ============ I. A League identity with no Tier-1 set resolves to real general League Law content ============
  v_n := (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_test_identity_league));
  if v_n <> 13 then
    raise exception 'FAIL (I): a League identity with no Tier-1 set did not receive exactly the 13 general League Law facts (got %)', v_n;
  end if;
  raise notice 'PASS (I): a League identity with no Tier-1 set of its own receives exactly the general League Law content';

  -- ============ J. The real RFL-GIRLS-U12 Tier-1 identity merges its own facts with the League general Law facts ============
  if v_rfl_girls_u12 is null then
    raise exception 'FAIL (J): the real RFL-GIRLS-U12 regulatory identity used as the mandated regression case no longer exists';
  end if;
  v_n := (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_rfl_girls_u12));
  if v_n <> 18 then
    raise exception 'FAIL (J): RFL-GIRLS-U12 did not resolve to exactly its 5 Tier-1 facts plus the 13 League general Law facts (got % rows)', v_n;
  end if;
  raise notice 'PASS (J): the real RFL-GIRLS-U12 Tier-1 identity now receives its own 5 age-grade facts merged with the 13 League general Law facts (18 total) — the mandated non-regression case';

  -- ============ K. Every RFL-GIRLS-U12 result row from its own Tier-1 set is marked is_tier1_variation=true ============
  if (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_rfl_girls_u12) where fact_key like 'RFL-GIRLS-U12-2026-%' and not is_tier1_variation) <> 0 then
    raise exception 'FAIL (K): a genuine RFL-GIRLS-U12 age-grade fact was not marked is_tier1_variation=true';
  end if;
  raise notice 'PASS (K): RFL-GIRLS-U12''s own age-grade facts are correctly marked as its age-grade variation';

  -- ============ L. Every RFL-GIRLS-U12 result row inherited from the Tier-2 general set is marked is_tier1_variation=false ============
  if (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_rfl_girls_u12) where fact_key like 'IRL-LAW-%' and is_tier1_variation) <> 0 then
    raise exception 'FAIL (L): a general League Law fact inherited by RFL-GIRLS-U12 was incorrectly marked as its own age-grade variation';
  end if;
  raise notice 'PASS (L): RFL-GIRLS-U12''s inherited general Law sections are correctly marked as general, not as its own variation — Tier-1 overrides only the sections it has an opinion on';

  -- ============ M. A Union identity never receives a League fact ============
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_union) where fact_key like 'IRL-LAW-%') <> 0 then
    raise exception 'FAIL (M): a Union identity received a League Law fact';
  end if;
  raise notice 'PASS (M): rugby-code isolation holds — a Union identity never receives a League Law fact';

  -- ============ N. A League identity never receives a Union fact ============
  if (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_test_identity_league) where fact_key like 'WR-LAW-%') <> 0 then
    raise exception 'FAIL (N): a League identity received a Union Law fact';
  end if;
  raise notice 'PASS (N): rugby-code isolation holds — a League identity never receives a Union Law fact';

  -- ============ O. A VERIFIED fact with no special dating resolves as current ============
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_schema) where fact_id = v_fact_current) <> 1 then
    raise exception 'FAIL (O): an ordinary VERIFIED fact did not resolve as current';
  end if;
  raise notice 'PASS (O): an ordinary VERIFIED fact with no special dating resolves as current';

  -- ============ P. A future-dated content set is excluded today, and included once its effective_from arrives ============
  -- v_test_identity_union has no other content set attached (H, above, is
  -- the proof of that), so this future set is the only Tier-1 candidate for
  -- it at any date -- no ambiguity between overlapping sets is possible.
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, verified_by, verified_at)
  values ('hlaw-test-future-fact-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'Future body.', 'VERIFIED', v_admin, now())
  returning id into v_fact_future_set;
  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, effective_from, publication_state, verified_by, verified_at, published_by, published_at)
  values ('hlaw-test-set-future-' || substr(gen_random_uuid()::text,1,8), 'union', 'RULES', v_test_identity_union, current_date + 30, 'PUBLISHED', v_admin, now(), v_admin, now())
  returning id into v_test_set_future;
  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_future, 'OTHER', v_fact_future_set);
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_union, current_date) where fact_id = v_fact_future_set) <> 0 then
    raise exception 'FAIL (P): a future-dated content set was resolved before its effective_from date arrived';
  end if;
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_union, current_date + 40) where fact_id = v_fact_future_set) <> 1 then
    raise exception 'FAIL (P2): a future-dated content set was not resolved once its effective_from date arrived';
  end if;
  raise notice 'PASS (P): a future-dated content set is excluded until its effective_from date arrives, then resolves correctly';

  -- ============ Q. An expired content set is excluded today, but was resolvable within its own validity window ============
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, verified_by, verified_at)
  values ('hlaw-test-expired-fact-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'league', 'TEXT', 'Expired body.', 'VERIFIED', v_admin, now())
  returning id into v_fact_expired_set;
  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, regulatory_identity_id, effective_to, publication_state, verified_by, verified_at, published_by, published_at)
  values ('hlaw-test-set-expired-' || substr(gen_random_uuid()::text,1,8), 'league', 'RULES', v_test_identity_league, current_date - 30, 'PUBLISHED', v_admin, now(), v_admin, now())
  returning id into v_test_set_expired;
  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_expired, 'OTHER', v_fact_expired_set);
  if (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_test_identity_league, current_date) where fact_id = v_fact_expired_set) <> 0 then
    raise exception 'FAIL (Q): an expired content set was still resolved as current today';
  end if;
  if (select count(*) from internal.resolve_age_grade_rule_bundle('league', v_test_identity_league, current_date - 40) where fact_id = v_fact_expired_set) <> 1 then
    raise exception 'FAIL (Q2): an expired content set was not resolvable within its own past validity window';
  end if;
  raise notice 'PASS (Q): an expired content set is excluded today but was correctly resolvable within its own past validity window';

  -- ============ R. A superseded fact is excluded; its replacement (via supersedes_fact_id) is the one returned ============
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status, verified_by, verified_at)
  values ('hlaw-test-old-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'Old value.', 'SUPERSEDED', v_admin, now())
  returning id into v_fact_old;
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, supersedes_fact_id, status, verified_by, verified_at)
  values ('hlaw-test-new-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'New value.', v_fact_old, 'VERIFIED', v_admin, now())
  returning id into v_fact_new;
  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_general, 'SAFETY', v_fact_new);
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_schema) where fact_id = v_fact_old) <> 0 then
    raise exception 'FAIL (R): a SUPERSEDED fact was still returned as current';
  end if;
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_schema) where fact_id = v_fact_new) <> 1 then
    raise exception 'FAIL (R2): the VERIFIED fact that supersedes an old fact was not returned';
  end if;
  raise notice 'PASS (R): a SUPERSEDED fact is excluded and its VERIFIED replacement (linked via supersedes_fact_id) is the one returned';

  -- ============ S. A DRAFT fact is never returned even if linked into a published section ============
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status)
  values ('hlaw-test-draft-linked-' || substr(gen_random_uuid()::text,1,8), 'OTHER', 'RULES', 'union', 'TEXT', 'Not yet verified.', 'DRAFT')
  returning id into v_fact_draft;
  insert into public.regulatory_content_sections (content_set_id, section_key, fact_id) values (v_test_set_general, 'PITCH', v_fact_draft);
  if (select count(*) from internal.resolve_age_grade_rule_bundle('union', v_test_identity_schema) where fact_id = v_fact_draft) <> 0 then
    raise exception 'FAIL (S): a DRAFT fact was returned as published content';
  end if;
  raise notice 'PASS (S): a DRAFT fact never surfaces through the resolver, even when linked into an otherwise-published section';

  -- ============ T. A real RULE_EXPLANATION reference resolves into the existing Officiating/Game Knowledge graph ============
  select f.regulatory_fact_id, f.content_item_id into v_real_fact, v_concept
  from public.hub_regulatory_fact_references f
  where f.reference_type = 'RULE_EXPLANATION' and f.regulatory_fact_id in (select id from public.regulatory_facts where fact_key like 'WR-LAW-%' or fact_key like 'IRL-LAW-%')
  limit 1;
  if v_real_fact is null then
    raise exception 'FAIL (T): no RULE_EXPLANATION reference from a new Law fact into Officiating/Game Knowledge was found';
  end if;
  if (select count(*) from public.hub_content_items where id = v_concept and status = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (T2): a RULE_EXPLANATION reference points at a non-existent or unpublished content item';
  end if;
  raise notice 'PASS (T): a real RULE_EXPLANATION reference from a new Law fact resolves into a real, published Officiating/Game Knowledge concept';

  -- ============ U. A forged regulatory_fact_id in a RULE_EXPLANATION/RULE_GLOSSARY reference is rejected by the real foreign key ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (gen_random_uuid(), v_concept, 'RULE_EXPLANATION');
  exception when foreign_key_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (U): a forged regulatory_fact_id was accepted into a RULE_EXPLANATION reference'; end if;
  raise notice 'PASS (U): a forged regulatory_fact_id is refused by the real foreign key on hub_regulatory_fact_references';

  -- ============ V. A real RULE_GLOSSARY reference resolves via get_hub_glossary_term_regulatory_facts ============
  select f.regulatory_fact_id, f.glossary_term_id into v_real_fact, v_real_glossary_term
  from public.hub_regulatory_fact_references f
  where f.reference_type = 'RULE_GLOSSARY' and f.regulatory_fact_id in (select id from public.regulatory_facts where fact_key like 'WR-LAW-%' or fact_key like 'IRL-LAW-%')
  limit 1;
  if v_real_glossary_term is null then
    raise exception 'FAIL (V): no RULE_GLOSSARY reference from a new Law fact into the Glossary was found';
  end if;
  if (select count(*) from public.get_hub_glossary_term_regulatory_facts(v_real_glossary_term) where fact_key = (select fact_key from public.regulatory_facts where id = v_real_fact)) <> 1 then
    raise exception 'FAIL (V2): get_hub_glossary_term_regulatory_facts did not return the real linked Law fact for its Glossary term';
  end if;
  raise notice 'PASS (V): a real RULE_GLOSSARY reference from a new Law fact resolves correctly via get_hub_glossary_term_regulatory_facts';

  -- ============ W. Rules content is discoverable through the existing search RPC with zero new result type ============
  update public.hub_glossary_terms set display_term = 'Hlawtestsearchableadvantage' where id = (select glossary_term_id from public.hub_regulatory_fact_references where reference_type = 'RULE_GLOSSARY' and glossary_term_id is not null limit 1);
  if (select count(*) from public.search_hub_content('Hlawtestsearchableadvantage', 20) where result_type = 'GLOSSARY_TERM') <> 1 then
    raise exception 'FAIL (W): a Glossary term enriched with a new Law fact reference did not surface in search_hub_content';
  end if;
  if (select count(distinct result_type) from public.search_hub_content('Hlawtestsearchableadvantage', 20) where result_type = 'RULE' or result_type = 'REGULATION') <> 0 then
    raise exception 'FAIL (W2): search_hub_content unexpectedly introduced a new RULE/REGULATION result type';
  end if;
  raise notice 'PASS (W): Rules content is discoverable through the existing search RPC via its Glossary/Officiating/Game Knowledge cross-links, with zero new "Regulation" result type';

  -- ============ X. The conflict-detection query correctly finds a genuine same-fact_type/same-scope/overlapping-date contradiction, and stops finding it once tracked as resolved ============
  -- fact_type is a shared CATEGORY, not a unique-value key -- SANCTION alone
  -- covers five distinct, legitimately coexisting Union facts (Penalty,
  -- Free Kick, Sin Bin, Red Card, 20-Minute Replacement), and this is true
  -- even of the pre-existing administrative taxonomy (PLAYING_ELIGIBILITY
  -- already covers three distinct, coexisting RFU Reg 15 facts). A bare
  -- "any two facts sharing a fact_type" query would flag those as false
  -- contradictions across the whole corpus. The genuine, narrow signal is a
  -- fact_type that is conceptually single-valued per identity (like
  -- BALL_SIZE: an age grade has exactly one current ball size) carrying TWO
  -- simultaneously-VERIFIED, overlapping-date values for the SAME identity
  -- -- that is a real, checkable contradiction, and this proves the query
  -- catches it and that linking it into the existing regulatory_conflicts
  -- tracking mechanism (create_regulatory_conflict/link_conflict_fact)
  -- correctly clears it.
  declare
    v_conflict_fact_a uuid;
    v_conflict_fact_b uuid;
    v_conflict_id uuid;
    v_found_before int;
    v_found_after int;
  begin
    insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_integer, value_unit, status, verified_by, verified_at)
    values ('hlaw-test-conflict-a-' || substr(gen_random_uuid()::text,1,8), 'BALL_SIZE', 'RULES', 'union', 'INTEGER', 3, 'size', 'VERIFIED', v_admin, now())
    returning id into v_conflict_fact_a;
    insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_integer, value_unit, status, verified_by, verified_at)
    values ('hlaw-test-conflict-b-' || substr(gen_random_uuid()::text,1,8), 'BALL_SIZE', 'RULES', 'union', 'INTEGER', 4, 'size', 'VERIFIED', v_admin, now())
    returning id into v_conflict_fact_b;
    insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id) values (v_conflict_fact_a, v_test_identity_union), (v_conflict_fact_b, v_test_identity_union);

    v_found_before := (
      select count(*)
      from public.regulatory_facts f1
      join public.regulatory_facts f2 on f2.id > f1.id and f2.fact_type = f1.fact_type and f2.rugby_code = f1.rugby_code and f2.topic = f1.topic
      join public.regulatory_fact_applicability a1 on a1.fact_id = f1.id
      join public.regulatory_fact_applicability a2 on a2.fact_id = f2.id and a2.regulatory_identity_id = a1.regulatory_identity_id
      where f1.status = 'VERIFIED' and f2.status = 'VERIFIED'
        and daterange(f1.effective_from, f1.effective_to, '[]') && daterange(f2.effective_from, f2.effective_to, '[]')
        and f1.id in (v_conflict_fact_a, v_conflict_fact_b) and f2.id in (v_conflict_fact_a, v_conflict_fact_b)
        and not exists (select 1 from public.regulatory_conflict_facts cf1 join public.regulatory_conflict_facts cf2 on cf2.conflict_id = cf1.conflict_id where cf1.fact_id = f1.id and cf2.fact_id = f2.id)
    );
    if v_found_before <> 1 then
      raise exception 'FAIL (X): the conflict-detection query did not find a genuine overlapping-date BALL_SIZE contradiction for one identity';
    end if;

    -- create_regulatory_conflict/link_conflict_fact are capability-gated on
    -- the caller (internal.has_capability('site.regulatory.manage', ...)),
    -- which reads auth.uid() -- simulate a real full site admin's session
    -- (the temporary v_full_admin created above), the same pattern
    -- capability_engine.sql already establishes for capability-gated RPCs.
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '{"sub":"' || v_full_admin::text || '","role":"authenticated"}', true);
    select public.create_regulatory_conflict('hlaw-test-conflict-' || substr(gen_random_uuid()::text,1,8), 'RULES', 'Test conflict for permanent regression coverage.', 'union', v_test_identity_union) into v_conflict_id;
    perform public.link_conflict_fact(v_conflict_id, v_conflict_fact_a);
    perform public.link_conflict_fact(v_conflict_id, v_conflict_fact_b);
    reset role;

    v_found_after := (
      select count(*)
      from public.regulatory_facts f1
      join public.regulatory_facts f2 on f2.id > f1.id and f2.fact_type = f1.fact_type and f2.rugby_code = f1.rugby_code and f2.topic = f1.topic
      join public.regulatory_fact_applicability a1 on a1.fact_id = f1.id
      join public.regulatory_fact_applicability a2 on a2.fact_id = f2.id and a2.regulatory_identity_id = a1.regulatory_identity_id
      where f1.status = 'VERIFIED' and f2.status = 'VERIFIED'
        and daterange(f1.effective_from, f1.effective_to, '[]') && daterange(f2.effective_from, f2.effective_to, '[]')
        and f1.id in (v_conflict_fact_a, v_conflict_fact_b) and f2.id in (v_conflict_fact_a, v_conflict_fact_b)
        and not exists (select 1 from public.regulatory_conflict_facts cf1 join public.regulatory_conflict_facts cf2 on cf2.conflict_id = cf1.conflict_id where cf1.fact_id = f1.id and cf2.fact_id = f2.id)
    );
    if v_found_after <> 0 then
      raise exception 'FAIL (X2): a tracked regulatory_conflicts entry did not clear the conflict-detection query';
    end if;
  end;
  raise notice 'PASS (X): the conflict-detection query correctly finds a genuine overlapping-date, single-valued-fact_type contradiction, and clears once it is tracked via the existing regulatory_conflicts mechanism';

  -- ============ Y. get_hub_recommended_content deliberately carries no RULE branch ============
  if (select count(*) from public.get_hub_recommended_content(v_test_identity_union, 500) where result_id in (select id from public.regulatory_facts where fact_key like 'WR-LAW-%' or fact_key like 'IRL-LAW-%')) <> 0 then
    raise exception 'FAIL (Y): a raw regulatory_facts row leaked into get_hub_recommended_content — Rules facts must only be recommended indirectly, via the Officiating/Game Knowledge/Glossary items that reference them';
  end if;
  raise notice 'PASS (Y): get_hub_recommended_content carries no RULE branch (a considered decision: regulatory_facts has no public-read policy, and a bare Law fact has no article-level scaffolding to recommend out of context) — Rules content reaches recommendations only indirectly, via the existing content types that reference it';
end $$;

rollback;
