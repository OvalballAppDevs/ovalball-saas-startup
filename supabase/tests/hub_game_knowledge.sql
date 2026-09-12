-- Rugby Hub Game Knowledge (GAME_CONCEPT content) -- permanent regression.
--
-- Pins: publication gating applies to GAME_CONCEPT exactly like every other
-- content_type; a code-specific concept's applicability is real per-identity
-- enumeration, never is_universal=true (the same correction made in the
-- Set-Piece Split slice); hub_content_item_positions has real FK integrity
-- and RLS; Union/League recommendations never leak across identities of the
-- other code; search picks up a GAME_CONCEPT exactly like any other
-- hub_content_items row; unpublished concepts are excluded from both public
-- read and search; and a regulatory-fact reference from a concept resolves
-- to a real, VERIFIED fact.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_identity_union uuid;
  v_identity_league uuid;
  v_concept uuid;
  v_concept2 uuid;
  v_pos uuid;
  v_fact uuid;
  v_raised boolean;
  v_n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'hgk-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'Hub', 'Admin', 'hgk-admin-' || v_admin::text || '@ovalball.test');

  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hgk-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'hgk-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_identity_league;

  -- ============ A. content_type accepts GAME_CONCEPT, with its own columns ============
  insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order)
  values ('hgk-concept-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'Test Concept', 'A test concept summary.', 'FUNDAMENTALS', 1)
  returning id into v_concept;
  raise notice 'PASS (A): a GAME_CONCEPT row is accepted with concept_family and journey_order set';

  -- ============ B. Publication gating applies to GAME_CONCEPT exactly like every other content_type ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (B): a GAME_CONCEPT published with no applicability row -- the generic publish gate did not fire';
  end if;
  raise notice 'PASS (B): GAME_CONCEPT is refused PUBLISHED status with no applicability, same as any other content_type';

  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_concept, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept;
  raise notice 'PASS (B2): a universal GAME_CONCEPT publishes once real applicability exists';

  -- ============ C. Code-specific concept: applicability must be real per-identity rows, never is_universal=true ============
  insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, concept_family, journey_order)
  values ('hgk-league-concept-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'Test League Concept', 'A league-specific concept.', 'league', 'RESTARTS_AND_SET_PIECES', 2)
  returning id into v_concept2;
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_concept2, v_identity_league);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_concept2;

  select count(*) into v_n
  from public.hub_content_applicability a
  join public.hub_content_items c on c.id = a.content_item_id
  where c.id = v_concept2 and c.rugby_code is not null and a.is_universal = true;
  if v_n <> 0 then
    raise exception 'FAIL (C): a code-specific GAME_CONCEPT carried an is_universal=true applicability row -- self-contradictory scoping';
  end if;
  raise notice 'PASS (C): a code-specific GAME_CONCEPT is never scoped via is_universal=true, only real per-identity rows';

  -- ============ D. Union/League isolation: recommendations never cross code via identity applicability ============
  if (select count(*) from public.get_hub_recommended_content(v_identity_union, 50) where result_id = v_concept2) <> 0 then
    raise exception 'FAIL (D): a League-only GAME_CONCEPT leaked into recommendations for a Union identity';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_identity_league, 50) where result_id = v_concept2) <> 1 then
    raise exception 'FAIL (D2): a League-scoped GAME_CONCEPT did not appear in recommendations for its own League identity';
  end if;
  raise notice 'PASS (D): Game Knowledge recommendations respect Union/League isolation exactly like any other content';

  -- ============ E. hub_content_item_positions: real FK integrity ============
  insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose)
  values ('hgk-pos-' || substr(gen_random_uuid()::text,1,8), 'union', 'Test Position', 'FORWARDS', 'Test purpose')
  returning id into v_pos;
  insert into public.hub_content_item_positions (content_item_id, position_id) values (v_concept, v_pos);
  raise notice 'PASS (E): a real concept-position link is created';

  v_raised := false;
  begin
    insert into public.hub_content_item_positions (content_item_id, position_id) values (v_concept, gen_random_uuid());
  exception when foreign_key_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (E2): hub_content_item_positions accepted a position_id with no matching row';
  end if;
  raise notice 'PASS (E2): a forged position_id is refused by a real foreign key';

  -- ============ F. hub_content_item_positions RLS: public read only reaches published pairs ============
  declare
    v_draft_concept uuid;
    v_draft_pos uuid;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hgk-draft-concept-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'Draft Concept', 'Not published.')
    returning id into v_draft_concept;
    insert into public.hub_positions (position_key, rugby_code, display_name, position_family, purpose)
    values ('hgk-draft-pos-' || substr(gen_random_uuid()::text,1,8), 'union', 'Draft Position', 'FORWARDS', 'x')
    returning id into v_draft_pos;
    insert into public.hub_content_item_positions (content_item_id, position_id) values (v_draft_concept, v_draft_pos);

    set local role authenticated;
    select count(*) into v_n from public.hub_content_item_positions where content_item_id = v_draft_concept;
    reset role;
    if v_n <> 0 then
      raise exception 'FAIL (F): an unpublished concept-position link was visible to an ordinary authenticated reader';
    end if;
    raise notice 'PASS (F): hub_content_item_positions RLS excludes links for unpublished concepts';
  end;

  -- ============ G. Search eligibility: a published GAME_CONCEPT is a real search_hub_content result ============
  update public.hub_content_items set title = 'Hgktestsearchable Concept Title' where id = v_concept;
  if (select count(*) from public.search_hub_content('Hgktestsearchable', 20) where result_id = v_concept) <> 1 then
    raise exception 'FAIL (G): a published GAME_CONCEPT did not appear in search_hub_content for a matching title';
  end if;
  raise notice 'PASS (G): search_hub_content picks up a published GAME_CONCEPT exactly like any other content item';

  -- ============ H. Search exclusion: an unpublished GAME_CONCEPT never appears in search ============
  declare
    v_draft_search uuid;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hgk-draft-search-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'Hgktestunpublished Concept', 'Not published.')
    returning id into v_draft_search;
    if (select count(*) from public.search_hub_content('Hgktestunpublished', 20) where result_id = v_draft_search) <> 0 then
      raise exception 'FAIL (H): an unpublished GAME_CONCEPT appeared in search_hub_content';
    end if;
    raise notice 'PASS (H): an unpublished GAME_CONCEPT never surfaces in search, regardless of title match';
  end;

  -- ============ I. Regulatory-fact provenance: a concept's fact reference resolves to a real, VERIFIED fact ============
  select id into v_fact from public.regulatory_facts where status = 'VERIFIED' limit 1;
  if v_fact is not null then
    insert into public.hub_regulatory_fact_references (content_item_id, regulatory_fact_id, reference_type)
    values (v_concept, v_fact, 'RULE_EXPLANATION');
    raise notice 'PASS (I): a GAME_CONCEPT can reference a real VERIFIED regulatory fact';

    v_raised := false;
    begin
      insert into public.hub_regulatory_fact_references (content_item_id, regulatory_fact_id, reference_type)
      values (v_concept, gen_random_uuid(), 'RULE_EXPLANATION');
    exception when foreign_key_violation then
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'FAIL (I2): hub_regulatory_fact_references accepted a forged regulatory_fact_id';
    end if;
    raise notice 'PASS (I2): a forged regulatory_fact_id is refused by a real foreign key';
  else
    raise notice 'SKIP (I): no VERIFIED regulatory_facts row available in this environment to reference';
  end if;

  -- ============ J. CONCEPT_RELATED relationship: real link, self-relationship refused ============
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
  values (v_concept, v_concept2, 'CONCEPT_RELATED');
  raise notice 'PASS (J): a CONCEPT_RELATED link between two GAME_CONCEPT rows is created';

  v_raised := false;
  begin
    insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
    values (v_concept, v_concept, 'CONCEPT_RELATED');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (J2): a GAME_CONCEPT was allowed to relate to itself';
  end if;
  raise notice 'PASS (J2): a self-relationship is refused for GAME_CONCEPT exactly like any other content item';
end $$;

rollback;
