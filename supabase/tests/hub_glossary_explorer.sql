-- Rugby Hub Glossary Explorer -- permanent regression.
--
-- Pins: publication gating applies to hub_glossary_terms exactly like every
-- other Hub table; universal vs code-specific applicability never collapses
-- into is_universal=true for a scoped term; the same display_term can
-- legitimately exist as two rows across the two codes; the three new
-- relationship tables (hub_glossary_content_links/positions/skills) have
-- real FK integrity and RLS gated on BOTH parents' publication state;
-- GLOSSARY_RELATED self-reference is refused exactly like every other
-- self-relationship in this codebase; RULE_GLOSSARY only ever targets a
-- glossary term (never a content item) and only a real VERIFIED fact; the
-- new regulatory-escape-hatch constraint on hub_glossary_terms actually
-- rejects law-like prose; and both search_hub_content and
-- get_hub_recommended_content correctly include/exclude glossary terms.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_identity_union uuid;
  v_identity_league uuid;
  v_term uuid;
  v_term_union uuid;
  v_term_league uuid;
  v_term2 uuid;
  v_content uuid;
  v_position uuid;
  v_skill uuid;
  v_fact uuid;
  v_raised boolean;
  v_n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hge-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hge-admin-' || v_admin::text || '@ovalball.test');

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hge-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'hge-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_identity_league;

  -- ============ A. Publication requires valid applicability ============
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
  values ('hge-term-' || substr(gen_random_uuid()::text,1,8), 'Hgetestterm', 'A test definition.')
  returning id into v_term;

  v_raised := false;
  begin
    update public.hub_glossary_terms set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_term;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (A): a glossary term published with no applicability row';
  end if;
  raise notice 'PASS (A): glossary term publication requires valid applicability, same as every other Hub table';

  -- ============ B. Universal term behaves correctly ============
  -- limit bumped from 100 to 500 (matching the precedent already
  -- established in hub_teams_competitions.sql/hub_international_rugby.sql):
  -- get_hub_recommended_content orders only by is_universal (true/false),
  -- so within the universal group a fresh row has no guaranteed position.
  -- Every later Hub domain that seeds its own real universal content --
  -- Teams & Competitions, International Rugby, and now People & Rugby
  -- Legends -- legitimately grows that pool (106 permanent universal rows
  -- as of this fix), so a small fixed limit was a latent bug this growth
  -- correctly exposed rather than a flake to route around.
  insert into public.hub_content_applicability (glossary_term_id, is_universal) values (v_term, true);
  update public.hub_glossary_terms set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_term;
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 500) where result_id = v_term) <> 1 then
    raise exception 'FAIL (B): a universal term did not reach a Union identity via recommendations';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_identity_league, 500) where result_id = v_term) <> 1 then
    raise exception 'FAIL (B2): a universal term did not reach a League identity via recommendations';
  end if;
  raise notice 'PASS (B): a universal glossary term is published and reaches both code contexts';

  -- ============ C/D. Code-specific terms are never falsely universal ============
  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values ('hge-union-term-' || substr(gen_random_uuid()::text,1,8), 'Hgetestunionterm', 'union', 'A union-specific test definition.')
  returning id into v_term_union;
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id) values (v_term_union, v_identity_union);
  update public.hub_glossary_terms set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_term_union;

  if (select count(*) from public.hub_content_applicability where glossary_term_id = v_term_union and is_universal = true) <> 0 then
    raise exception 'FAIL (C): a Union-specific term carried an is_universal=true applicability row';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_identity_league, 100) where result_id = v_term_union) <> 0 then
    raise exception 'FAIL (C2): a Union-specific term leaked into League recommendations';
  end if;
  raise notice 'PASS (C): a Union-specific term is never scoped via is_universal=true and never leaks to League';

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values ('hge-league-term-' || substr(gen_random_uuid()::text,1,8), 'Hgetestleagueterm', 'league', 'A league-specific test definition.')
  returning id into v_term_league;
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id) values (v_term_league, v_identity_league);
  update public.hub_glossary_terms set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_term_league;

  if (select count(*) from public.hub_content_applicability where glossary_term_id = v_term_league and is_universal = true) <> 0 then
    raise exception 'FAIL (D): a League-specific term carried an is_universal=true applicability row';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 100) where result_id = v_term_league) <> 0 then
    raise exception 'FAIL (D2): a League-specific term leaked into Union recommendations';
  end if;
  raise notice 'PASS (D): a League-specific term is never scoped via is_universal=true and never leaks to Union';

  -- ============ E. Same display_term can legitimately exist across codes ============
  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values ('hge-shared-union-' || substr(gen_random_uuid()::text,1,8), 'Hgetestsharedterm', 'union', 'The union meaning.');
  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition)
  values ('hge-shared-league-' || substr(gen_random_uuid()::text,1,8), 'Hgetestsharedterm', 'league', 'The league meaning.');
  raise notice 'PASS (E): the same display_term legitimately exists as two rows, one per code';

  -- ============ F/G/H. New relationship tables: real FK integrity ============
  select id into v_content from public.hub_content_items where content_type = 'GAME_CONCEPT' limit 1;
  select id into v_position from public.hub_positions where status = 'PUBLISHED' limit 1;
  select id into v_skill from public.hub_skills where status = 'PUBLISHED' limit 1;

  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values (v_term, v_content);
  v_raised := false;
  begin
    insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values (v_term, gen_random_uuid());
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (F): hub_glossary_content_links accepted a forged content_item_id';
  end if;
  raise notice 'PASS (F): hub_glossary_content_links has real FK integrity';

  insert into public.hub_glossary_positions (glossary_term_id, position_id) values (v_term, v_position);
  v_raised := false;
  begin
    insert into public.hub_glossary_positions (glossary_term_id, position_id) values (v_term, gen_random_uuid());
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (G): hub_glossary_positions accepted a forged position_id';
  end if;
  raise notice 'PASS (G): hub_glossary_positions has real FK integrity';

  insert into public.hub_glossary_skills (glossary_term_id, skill_id) values (v_term, v_skill);
  v_raised := false;
  begin
    insert into public.hub_glossary_skills (glossary_term_id, skill_id) values (v_term, gen_random_uuid());
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (H): hub_glossary_skills accepted a forged skill_id';
  end if;
  raise notice 'PASS (H): hub_glossary_skills has real FK integrity';

  -- ============ I. RLS: relationship rows invisible when either parent is unpublished ============
  declare
    v_draft_term uuid;
    v_draft_content uuid;
  begin
    insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
    values ('hge-draft-term-' || substr(gen_random_uuid()::text,1,8), 'Hgetestdraftterm', 'Not published.')
    returning id into v_draft_term;
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hge-draft-content-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Draft content', 'Not published.')
    returning id into v_draft_content;
    insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values (v_draft_term, v_draft_content);

    set local role authenticated;
    select count(*) into v_n from public.hub_glossary_content_links where glossary_term_id = v_draft_term;
    reset role;
    if v_n <> 0 then
      raise exception 'FAIL (I): a relationship row with an unpublished parent was visible to an ordinary authenticated reader';
    end if;
    raise notice 'PASS (I): a relationship row is invisible to public readers while either parent is unpublished';
  end;

  -- ============ J. GLOSSARY_RELATED self-reference refused ============
  v_raised := false;
  begin
    insert into public.hub_glossary_relationships (glossary_term_id, related_glossary_term_id) values (v_term, v_term);
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (J): a glossary term was allowed to relate to itself';
  end if;
  raise notice 'PASS (J): GLOSSARY_RELATED self-reference is refused, same as every other self-relationship in this codebase';

  -- ============ K. RULE_GLOSSARY only ever targets a glossary term ============
  select id into v_fact from public.regulatory_facts where status = 'VERIFIED' limit 1;
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
    values (v_fact, v_content, 'RULE_GLOSSARY');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (K): RULE_GLOSSARY was accepted with a content_item_id target instead of a glossary_term_id';
  end if;
  raise notice 'PASS (K): RULE_GLOSSARY is refused unless it targets a glossary_term_id';

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, glossary_term_id, reference_type) values (v_fact, v_term, 'RULE_GLOSSARY');
  raise notice 'PASS (K2): RULE_GLOSSARY is accepted when it correctly targets a glossary term';

  -- ============ L. A forged/invalid regulatory reference is rejected ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, glossary_term_id, reference_type) values (gen_random_uuid(), v_term, 'RULE_GLOSSARY');
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (L): a forged regulatory_fact_id was accepted';
  end if;
  raise notice 'PASS (L): a forged regulatory_fact_id is refused by a real foreign key';

  -- ============ M. Regulatory escape-hatch constraint rejects law-like glossary prose ============
  v_raised := false;
  begin
    insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
    values ('hge-lawlike-' || substr(gen_random_uuid()::text,1,8), 'Hgetestlawlike', 'Players must always retreat ten metres under regulation 15.');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (M): a law-like definition ("Players must... under regulation 15") was accepted into hub_glossary_terms';
  end if;
  raise notice 'PASS (M): the regulatory escape-hatch constraint rejects law-like glossary prose, mirroring hub_content_items exactly';

  -- ============ N/O. Search: published glossary term appears, draft does not ============
  update public.hub_glossary_terms set display_term = 'Hgetestsearchableterm' where id = v_term;
  if (select count(*) from public.search_hub_content('Hgetestsearchableterm', 20) where result_id = v_term and result_type = 'GLOSSARY_TERM') <> 1 then
    raise exception 'FAIL (N): a published glossary term did not appear in search_hub_content';
  end if;
  raise notice 'PASS (N): search_hub_content returns a published glossary term';

  declare
    v_draft_search uuid;
  begin
    insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
    values ('hge-draft-search-' || substr(gen_random_uuid()::text,1,8), 'Hgetestunpublishedterm', 'Not published.')
    returning id into v_draft_search;
    if (select count(*) from public.search_hub_content('Hgetestunpublishedterm', 20) where result_id = v_draft_search) <> 0 then
      raise exception 'FAIL (O): an unpublished glossary term appeared in search_hub_content';
    end if;
    raise notice 'PASS (O): an unpublished glossary term never surfaces in search';
  end;

  -- ============ P/Q/R. Recommendations: legitimate glossary term, Union/League isolation, universal reach ============
  -- P and R bumped from 100 to 500 for exactly the reason already recorded
  -- at assertion B: get_hub_recommended_content orders only by is_universal,
  -- so a fresh universal row has no guaranteed position within the universal
  -- group, and every later Hub domain that seeds real universal content
  -- legitimately grows that pool -- Player Development added 17 more. The
  -- exclusion assertions below stay at 100 deliberately: they assert that
  -- something is ABSENT, which a smaller window can only make easier to
  -- satisfy, so they are not affected by pool growth.
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 500) where result_id = v_term) <> 1 then
    raise exception 'FAIL (P): a legitimate published Glossary term was not returned by get_hub_recommended_content';
  end if;
  raise notice 'PASS (P): get_hub_recommended_content returns a legitimate Glossary term';

  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 100) where result_id = v_term_league) <> 0 then
    raise exception 'FAIL (Q): recommendation applicability leaked a League-specific term into a Union identity';
  end if;
  raise notice 'PASS (Q): recommendation applicability respects Union/League isolation for Glossary terms';

  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 500) where result_id = v_term) <> 1
     or (select count(*) from public.get_hub_recommended_content(v_identity_league, 500) where result_id = v_term) <> 1 then
    raise exception 'FAIL (R): a universal Glossary term did not reach both code contexts';
  end if;
  raise notice 'PASS (R): a universal Glossary recommendation reaches both Union and League contexts';
end $$;

rollback;
