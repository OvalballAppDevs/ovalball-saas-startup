-- Rugby Hub general-knowledge relationships -- permanent regression.
--
-- Pins: every relationship table has real two-column FK integrity (no
-- unchecked (type, uuid) pair anywhere), self-relationships are refused
-- where meaningless, and hub_regulatory_fact_references is THE one
-- mechanism for general content to reference regulatory truth -- proving
-- it actually resolves to a real regulatory_facts row, and that its
-- reference_type/target combination is enforced.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_pos1 uuid; v_pos2 uuid; v_skill1 uuid; v_skill2 uuid;
  v_content1 uuid; v_content2 uuid; v_glossary1 uuid; v_glossary2 uuid;
  v_raised boolean;
begin
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose)
  values ('hcr-pos1-' || substr(gen_random_uuid()::text,1,8), 'union', 'Position One', 'BACKS', 'Purpose one')
  returning id into v_pos1;
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose)
  values ('hcr-pos2-' || substr(gen_random_uuid()::text,1,8), 'union', 'Position Two', 'BACKS', 'Purpose two')
  returning id into v_pos2;
  insert into public.hub_skills (skill_key, display_name, skill_family, summary)
  values ('hcr-skill1-' || substr(gen_random_uuid()::text,1,8), 'Skill One', 'HANDLING', 'Summary one')
  returning id into v_skill1;
  insert into public.hub_skills (skill_key, display_name, skill_family, summary)
  values ('hcr-skill2-' || substr(gen_random_uuid()::text,1,8), 'Skill Two', 'DECISION_MAKING', 'Summary two')
  returning id into v_skill2;
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcr-content1-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'Test title one', 'Test summary one')
  returning id into v_content1;
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcr-content2-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'Test title two', 'Test summary two')
  returning id into v_content2;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
  values ('hcr-glossary1-' || substr(gen_random_uuid()::text,1,8), 'Test Term One', 'Definition one.')
  returning id into v_glossary1;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
  values ('hcr-glossary2-' || substr(gen_random_uuid()::text,1,8), 'Test Term Two', 'Definition two.')
  returning id into v_glossary2;

  -- ============ A. POSITION_SKILL: real FK integrity ============
  insert into public.hub_position_skills (position_id, skill_id) values (v_pos1, v_skill1);
  raise notice 'PASS (A): a real position-skill link is created';

  v_raised := false;
  begin
    insert into public.hub_position_skills (position_id, skill_id) values (v_pos1, gen_random_uuid());
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (A2): hub_position_skills accepted a skill_id with no matching row -- real FK integrity is missing';
  end if;
  raise notice 'PASS (A2): a forged skill_id is refused by a real foreign key, not a soft/unchecked reference';

  -- ============ B. RELATED_POSITION: self-relationship refused ============
  v_raised := false;
  begin
    insert into public.hub_position_relationships (position_id, related_position_id) values (v_pos1, v_pos1);
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (B): a position was allowed to relate to itself';
  end if;
  raise notice 'PASS (B): a position cannot be listed as related to itself';

  insert into public.hub_position_relationships (position_id, related_position_id) values (v_pos1, v_pos2);
  raise notice 'PASS (B2): a genuine position-to-position relationship is created';

  -- ============ C. SKILL_PREREQUISITE / RELATED both use the same typed table ============
  insert into public.hub_skill_relationships (skill_id, related_skill_id, relationship_type) values (v_skill1, v_skill2, 'PREREQUISITE');
  insert into public.hub_skill_relationships (skill_id, related_skill_id, relationship_type) values (v_skill1, v_skill2, 'RELATED');
  if (select count(*) from public.hub_skill_relationships where skill_id = v_skill1 and related_skill_id = v_skill2) <> 2 then
    raise exception 'FAIL (C): expected both a PREREQUISITE and a RELATED row to coexist for the same skill pair';
  end if;
  raise notice 'PASS (C): PREREQUISITE and RELATED coexist as distinct, typed rows for the same skill pair';

  -- ============ D. SKILL_TRAINING links a skill to real coaching content ============
  insert into public.hub_skill_content_links (skill_id, content_item_id) values (v_skill1, v_content1);
  raise notice 'PASS (D): a skill links to a real coaching-guidance content item';

  -- ============ E. RELATED_KNOWLEDGE / CONCEPT_RELATED, content-to-content, self refused ============
  v_raised := false;
  begin
    insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_content1, v_content1, 'RELATED_KNOWLEDGE');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E): content was allowed to relate to itself';
  end if;
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_content1, v_content2, 'CONCEPT_RELATED');
  raise notice 'PASS (E): content self-relationship refused; genuine content-to-content relationship accepted';

  -- ============ F. GLOSSARY_RELATED ============
  insert into public.hub_glossary_relationships (glossary_term_id, related_glossary_term_id) values (v_glossary1, v_glossary2);
  raise notice 'PASS (F): a genuine glossary-to-glossary relationship is created';
end $$;

do $$
declare
  v_fact uuid;
  v_content uuid;
  v_glossary uuid;
  v_raised boolean;
begin
  -- ============ G. THE regulatory-fact-reference mechanism ============
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_integer)
  values ('hcr-fact-' || substr(gen_random_uuid()::text,1,8), 'PLAYER_COUNT', 'RULES', 'union', 'INTEGER', 15)
  returning id into v_fact;

  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hcr-g-content-' || substr(gen_random_uuid()::text,1,8), 'COACHING_GUIDANCE', 'A safe title', 'Explains team size in coaching terms.')
  returning id into v_content;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition)
  values ('hcr-g-glossary-' || substr(gen_random_uuid()::text,1,8), 'Test Player Count Term', 'How many players are on the pitch.')
  returning id into v_glossary;

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (v_fact, v_content, 'RULE_EXPLANATION');
  raise notice 'PASS (G): a coaching-guidance content item references a REAL regulatory_facts row via RULE_EXPLANATION';

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, glossary_term_id, reference_type) values (v_fact, v_glossary, 'RULE_GLOSSARY');
  raise notice 'PASS (G2): a glossary term references the same fact via RULE_GLOSSARY';

  -- ============ H. reference_type must match which target column is set ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (v_fact, v_content, 'RULE_GLOSSARY');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (H): RULE_GLOSSARY accepted with a content_item_id target instead of a glossary_term_id';
  end if;
  raise notice 'PASS (H): reference_type is refused when it does not match the target column actually set';

  -- ============ I. exactly one target required ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, glossary_term_id, reference_type)
    values (v_fact, v_content, v_glossary, 'RULE_EXPLANATION');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (I): a reference row was accepted with BOTH content_item_id and glossary_term_id set';
  end if;
  raise notice 'PASS (I): exactly-one-target constraint refuses both a content item and a glossary term on the same reference row';

  -- ============ J. A forged fact id is refused by a real FK ============
  v_raised := false;
  begin
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (gen_random_uuid(), v_content, 'RULE_EXPLANATION');
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (J): a forged regulatory_fact_id was accepted';
  end if;
  raise notice 'PASS (J): a forged regulatory_fact_id is refused -- this reference always resolves to a real, existing regulatory fact';
end $$;

rollback;
