-- Rugby Hub Officiating & Respect the Referee -- permanent regression.
--
-- Pins: OFFICIATING_CONCEPT is accepted and publication-gated exactly like
-- every other content_type; universal vs code-specific applicability never
-- collapses into is_universal=true for a scoped concept; a genuine
-- Union/League pair isolates correctly; the existing generic relationship
-- tables (content relationships, glossary content links, skill links,
-- position links) all accept OFFICIATING_CONCEPT with zero schema change;
-- RULE_EXPLANATION only ever targets a real VERIFIED fact; and -- the
-- centrepiece of this slice -- the regulatory escape-hatch constraint now
-- rejects law-like prose in EVERY free-text column on hub_content_items,
-- not just title/summary/body. Both search_hub_content and
-- get_hub_recommended_content are proven to include/exclude Officiating
-- concepts correctly with zero RPC change.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_identity_union uuid;
  v_identity_league uuid;
  v_concept uuid;
  v_concept_union uuid;
  v_concept_league uuid;
  v_concept2 uuid;
  v_glossary uuid;
  v_position uuid;
  v_skill uuid;
  v_fact uuid;
  v_raised boolean;
  v_n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hof-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hof-admin-' || v_admin::text || '@ovalball.test');

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hof-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'hof-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_identity_league;

  -- ============ A. OFFICIATING_CONCEPT accepted ============
  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family)
  values ('hof-concept-' || substr(gen_random_uuid()::text,1,8), 'OFFICIATING_CONCEPT', 'Test Officiating Concept', 'A test summary.', 'MATCH_OFFICIALS')
  returning id into v_concept;
  raise notice 'PASS (A): an OFFICIATING_CONCEPT row is accepted with officiating_family set';

  -- ============ B. Publication requires valid applicability ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (B): an OFFICIATING_CONCEPT published with no applicability row';
  end if;
  raise notice 'PASS (B): OFFICIATING_CONCEPT publication requires valid applicability, same as every other content_type';

  -- ============ C. Universal concept behaves correctly ============
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_concept, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept;
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 200) where result_id = v_concept) <> 1
     or (select count(*) from public.get_hub_recommended_content(v_identity_league, 200) where result_id = v_concept) <> 1 then
    raise exception 'FAIL (C): a universal OFFICIATING_CONCEPT did not reach both code contexts';
  end if;
  raise notice 'PASS (C): a universal OFFICIATING_CONCEPT publishes and reaches both code contexts';

  -- ============ D/E. Code-specific concepts are never falsely universal ============
  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code)
  values ('hof-union-concept-' || substr(gen_random_uuid()::text,1,8), 'OFFICIATING_CONCEPT', 'Test Union Concept', 'A union-specific test.', 'DECISIONS_AND_SIGNALS', 'union')
  returning id into v_concept_union;
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_concept_union, v_identity_union);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept_union;

  if (select count(*) from public.hub_content_applicability where content_item_id = v_concept_union and is_universal = true) <> 0 then
    raise exception 'FAIL (D): a Union-specific OFFICIATING_CONCEPT carried an is_universal=true applicability row';
  end if;
  raise notice 'PASS (D): a Union-specific OFFICIATING_CONCEPT is never scoped via is_universal=true';

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code)
  values ('hof-league-concept-' || substr(gen_random_uuid()::text,1,8), 'OFFICIATING_CONCEPT', 'Test League Concept', 'A league-specific test.', 'DECISIONS_AND_SIGNALS', 'league')
  returning id into v_concept_league;
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_concept_league, v_identity_league);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept_league;

  if (select count(*) from public.hub_content_applicability where content_item_id = v_concept_league and is_universal = true) <> 0 then
    raise exception 'FAIL (E): a League-specific OFFICIATING_CONCEPT carried an is_universal=true applicability row';
  end if;
  raise notice 'PASS (E): a League-specific OFFICIATING_CONCEPT is never scoped via is_universal=true';

  -- ============ F. A genuine paired concept isolates by code ============
  if (select count(*) from public.get_hub_recommended_content(v_identity_league, 200) where result_id = v_concept_union) <> 0 then
    raise exception 'FAIL (F): a Union-specific OFFICIATING_CONCEPT leaked into League recommendations';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 200) where result_id = v_concept_league) <> 0 then
    raise exception 'FAIL (F2): a League-specific OFFICIATING_CONCEPT leaked into Union recommendations';
  end if;
  raise notice 'PASS (F): a Union/League OFFICIATING_CONCEPT pair isolates correctly by code';

  -- ============ G. Content relationships work (hub_content_relationships) ============
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hof-concept2-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'Test Related Concept', 'x')
  returning id into v_concept2;
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_concept, v_concept2, 'RELATED_KNOWLEDGE');
  raise notice 'PASS (G): hub_content_relationships accepts an OFFICIATING_CONCEPT<->GAME_CONCEPT link with zero schema change';

  -- ============ H. Glossary <-> Officiating relationship works ============
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
  values ('hof-glossary-' || substr(gen_random_uuid()::text,1,8), 'Hoftestglossaryterm', 'A test definition.')
  returning id into v_glossary;
  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values (v_glossary, v_concept);
  raise notice 'PASS (H): hub_glossary_content_links accepts an Officiating target with zero schema change';

  -- ============ I. Skill <-> Officiating relationship works ============
  select id into v_skill from public.hub_skills where status = 'PUBLISHED' limit 1;
  insert into public.hub_skill_content_links (skill_id, content_item_id) values (v_skill, v_concept);
  raise notice 'PASS (I): hub_skill_content_links accepts an Officiating target with zero schema change';

  -- ============ J. Position <-> Officiating relationship works ============
  select id into v_position from public.hub_positions where status = 'PUBLISHED' limit 1;
  insert into public.hub_content_item_positions (content_item_id, position_id) values (v_concept, v_position);
  raise notice 'PASS (J): hub_content_item_positions accepts an Officiating target with zero schema change';

  -- ============ K. Valid RULE_EXPLANATION reference works ============
  select id into v_fact from public.regulatory_facts where status = 'VERIFIED' limit 1;
  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (v_fact, v_concept, 'RULE_EXPLANATION');
  raise notice 'PASS (K): an OFFICIATING_CONCEPT can carry a real RULE_EXPLANATION reference';

  -- ============ L. Invalid/forged regulatory target refused ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (gen_random_uuid(), v_concept, 'RULE_EXPLANATION');
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (L): a forged regulatory_fact_id was accepted';
  end if;
  raise notice 'PASS (L): a forged regulatory_fact_id is refused by a real foreign key';

  -- ============ M-S. Extended regulatory escape-hatch rejects law-like prose in every free-text column ============
  declare
    v_lawlike text := 'Players must always retreat under regulation 15.';
    v_key text := 'hof-escape-' || substr(gen_random_uuid()::text,1,8);
  begin
    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, why_it_matters) values (v_key || '-m', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (M): law-like prose in why_it_matters was accepted'; end if;
    raise notice 'PASS (M): the escape-hatch constraint rejects law-like prose in why_it_matters';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, what_happens) values (v_key || '-n', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (N): law-like prose in what_happens was accepted'; end if;
    raise notice 'PASS (N): the escape-hatch constraint rejects law-like prose in what_happens';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, what_to_watch_for) values (v_key || '-o', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (O): law-like prose in what_to_watch_for was accepted'; end if;
    raise notice 'PASS (O): the escape-hatch constraint rejects law-like prose in what_to_watch_for';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, what_happens_next) values (v_key || '-p', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (P): law-like prose in what_happens_next was accepted'; end if;
    raise notice 'PASS (P): the escape-hatch constraint rejects law-like prose in what_happens_next';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, union_league_difference) values (v_key || '-q', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (Q): law-like prose in union_league_difference was accepted'; end if;
    raise notice 'PASS (Q): the escape-hatch constraint rejects law-like prose in union_league_difference';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, how_it_is_signalled) values (v_key || '-r', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (R): law-like prose in how_it_is_signalled was accepted'; end if;
    raise notice 'PASS (R): the escape-hatch constraint rejects law-like prose in how_it_is_signalled';

    v_raised := false;
    begin
      insert into public.hub_content_items (content_key, content_type, title, summary, common_misunderstanding) values (v_key || '-s', 'OFFICIATING_CONCEPT', 'Safe title', 'Safe summary.', v_lawlike);
    exception when check_violation then v_raised := true; end;
    if not v_raised then raise exception 'FAIL (S): law-like prose in common_misunderstanding was accepted'; end if;
    raise notice 'PASS (S): the escape-hatch constraint rejects law-like prose in common_misunderstanding';
  end;

  -- ============ T/U. Search: published Officiating result appears, draft does not ============
  update public.hub_content_items set title = 'Hoftestsearchableconcept' where id = v_concept;
  if (select count(*) from public.search_hub_content('Hoftestsearchableconcept', 20) where result_id = v_concept) <> 1 then
    raise exception 'FAIL (T): a published OFFICIATING_CONCEPT did not appear in search_hub_content';
  end if;
  raise notice 'PASS (T): search_hub_content returns a published OFFICIATING_CONCEPT with zero RPC change';

  declare
    v_draft uuid;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hof-draft-' || substr(gen_random_uuid()::text,1,8), 'OFFICIATING_CONCEPT', 'Hoftestunpublishedconcept', 'Not published.')
    returning id into v_draft;
    if (select count(*) from public.search_hub_content('Hoftestunpublishedconcept', 20) where result_id = v_draft) <> 0 then
      raise exception 'FAIL (U): an unpublished OFFICIATING_CONCEPT appeared in search_hub_content';
    end if;
    raise notice 'PASS (U): an unpublished OFFICIATING_CONCEPT never surfaces in search';
  end;

  -- ============ V/W/X/Y. Recommendations: legitimate appearance, Union isolation, League isolation, universal reach ============
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 200) where result_id = v_concept) <> 1 then
    raise exception 'FAIL (V): a legitimate published OFFICIATING_CONCEPT was not returned by get_hub_recommended_content';
  end if;
  raise notice 'PASS (V): get_hub_recommended_content returns a legitimate OFFICIATING_CONCEPT with zero RPC change';

  if (select count(*) from public.get_hub_recommended_content(v_identity_league, 200) where result_id = v_concept_union) <> 0 then
    raise exception 'FAIL (W): Union recommendation isolation failed for OFFICIATING_CONCEPT';
  end if;
  raise notice 'PASS (W): Union recommendation isolation holds for OFFICIATING_CONCEPT';

  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 200) where result_id = v_concept_league) <> 0 then
    raise exception 'FAIL (X): League recommendation isolation failed for OFFICIATING_CONCEPT';
  end if;
  raise notice 'PASS (X): League recommendation isolation holds for OFFICIATING_CONCEPT';

  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 200) where result_id = v_concept) <> 1
     or (select count(*) from public.get_hub_recommended_content(v_identity_league, 200) where result_id = v_concept) <> 1 then
    raise exception 'FAIL (Y): a universal OFFICIATING_CONCEPT recommendation did not reach both code contexts';
  end if;
  raise notice 'PASS (Y): a universal OFFICIATING_CONCEPT recommendation reaches both Union and League contexts';
end $$;

rollback;
