-- Rugby Hub general-knowledge PROOF-OF-MODEL records.
--
-- These are NOT real Rugby Hub content and must never be presented as
-- coverage of any knowledge domain. Every content_key/position_key/
-- skill_key/term_key below is prefixed "proof-" specifically so it can
-- never be mistaken for genuine editorial content in an admin listing.
-- Their only purpose is to prove, end to end, against a real (if minimal)
-- local database, that: general content, applicability (universal AND
-- identity-scoped), a position, a skill, a glossary term, every
-- relationship type, the publication lifecycle, and search all work
-- together as one coherent system -- not just as isolated schema.
--
-- Idempotent: safe to run more than once (on conflict do nothing / guarded
-- existence checks), like every other local_uat_*.sql seed.

do $$
declare
  v_admin uuid;
  v_identity uuid;
  v_content uuid;
  v_content_2 uuid;
  v_position uuid;
  v_skill uuid;
  v_glossary uuid;
  v_fact uuid;
begin
  select id into v_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  if v_admin is null then
    return;
  end if;

  select id into v_identity from public.regulatory_identities where identity_key = 'proof-hub-identity' limit 1;
  if v_identity is null then
    insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, mapping_notes)
    values ('union', 'proof-hub-identity', 'Proof-of-model Under 12 Boys identity', 'REVIEW_REQUIRED', 'Proof-of-model row for the Rugby Hub general-knowledge foundation seed -- not a real identity mapping.')
    returning id into v_identity;
  end if;

  -- ============ Position: DRAFT, then applicability, then publish ============
  select id into v_position from public.hub_positions where position_key = 'proof-union-scrum-half';
  if v_position is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, key_skills_summary, decision_making,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'proof-union-scrum-half', 'union', 'Scrum-Half', array['9', 'Number Nine'], 9, 'HALF_BACKS',
      'Proof-of-model purpose text: links forwards and backs, distributing quickly from the base of set-piece and breakdown.',
      'Proof-of-model: quick, accurate passing off both hands; sniping runs close to the breakdown.',
      'Proof-of-model: organises forwards at the breakdown; communicates the attacking shape.',
      'Proof-of-model: passing, box-kicking, tactical kicking.',
      'Proof-of-model: reads whether to run, pass or kick from each breakdown.',
      0.35, 0.5,
      'Proof-of-model note: at younger age grades this role is shared and rotated rather than fixed to one player.'
    ) returning id into v_position;

    insert into public.hub_content_applicability (position_id, is_universal) values (v_position, true);
    if v_identity is not null then
      insert into public.hub_position_age_stage (position_id, regulatory_identity_id, stage, stage_note)
      values (v_position, v_identity, 'EMERGING', 'Proof-of-model: positional roles are still emerging and rotated at this age grade.');
    end if;

    update public.hub_positions
    set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now()
    where id = v_position;
    update public.hub_positions
    set status = 'PUBLISHED', published_by = v_admin, published_at = now()
    where id = v_position;
    raise notice 'PROOF: position proof-union-scrum-half seeded and published.';
  end if;

  -- ============ A skill, universally applicable ============
  select id into v_skill from public.hub_skills where skill_key = 'proof-passing-off-both-hands';
  if v_skill is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('proof-passing-off-both-hands', 'Passing Off Both Hands', 'HANDLING', 'Proof-of-model summary: the ability to pass accurately with either hand under pressure.')
    returning id into v_skill;
    insert into public.hub_content_applicability (skill_id, is_universal) values (v_skill, true);
    update public.hub_skills set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now() where id = v_skill;
    update public.hub_skills set status = 'PUBLISHED', published_by = v_admin, published_at = now() where id = v_skill;
    raise notice 'PROOF: skill proof-passing-off-both-hands seeded and published.';
  end if;

  insert into public.hub_position_skills (position_id, skill_id)
  select v_position, v_skill where not exists (select 1 from public.hub_position_skills where position_id = v_position and skill_id = v_skill);

  -- ============ A glossary term, code-specific ============
  select id into v_glossary from public.hub_glossary_terms where term_key = 'proof-breakdown-union';
  if v_glossary is null then
    insert into public.hub_glossary_terms (term_key, display_term, aliases, rugby_code, plain_language_definition)
    values ('proof-breakdown-union', 'Breakdown', array['Ruck Contest'], 'union', 'Proof-of-model definition: the contest for the ball after a tackle, where players compete on their feet.')
    returning id into v_glossary;
    insert into public.hub_content_applicability (glossary_term_id, is_universal) values (v_glossary, true);
    update public.hub_glossary_terms set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now() where id = v_glossary;
    update public.hub_glossary_terms set status = 'PUBLISHED', published_by = v_admin, published_at = now() where id = v_glossary;
    raise notice 'PROOF: glossary term proof-breakdown-union seeded and published.';
  end if;

  -- ============ Two content items, one universal + one identity-scoped, RELATED to each other ============
  select id into v_content from public.hub_content_items where content_key = 'proof-warming-up-safely';
  if v_content is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, body)
    values ('proof-warming-up-safely', 'COACHING_GUIDANCE', 'Proof: Warming Up Safely', 'Proof-of-model summary about warming up before contact.', 'Proof-of-model body text about warming up.')
    returning id into v_content;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content, true);
    update public.hub_content_items set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now() where id = v_content;
    update public.hub_content_items set status = 'PUBLISHED', published_by = v_admin, published_at = now() where id = v_content;
    raise notice 'PROOF: content item proof-warming-up-safely seeded and published (universal).';
  end if;

  select id into v_content_2 from public.hub_content_items where content_key = 'proof-scrum-half-development-ideas';
  if v_content_2 is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, body)
    values ('proof-scrum-half-development-ideas', 'COACHING_GUIDANCE', 'Proof: Scrum-Half Development Ideas', 'Proof-of-model summary of development ideas for the scrum-half role.', 'Proof-of-model body text with development ideas.')
    returning id into v_content_2;
    if v_identity is not null then
      insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_content_2, v_identity);
    else
      insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content_2, true);
    end if;
    update public.hub_content_items set status = 'REVIEWED', reviewed_by = v_admin, reviewed_at = now() where id = v_content_2;
    update public.hub_content_items set status = 'PUBLISHED', published_by = v_admin, published_at = now() where id = v_content_2;
    raise notice 'PROOF: content item proof-scrum-half-development-ideas seeded and published (identity-scoped).';
  end if;

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
  select v_content, v_content_2, 'RELATED_KNOWLEDGE'
  where not exists (select 1 from public.hub_content_relationships where content_item_id = v_content and related_content_item_id = v_content_2 and relationship_type = 'RELATED_KNOWLEDGE');

  insert into public.hub_skill_content_links (skill_id, content_item_id)
  select v_skill, v_content_2 where not exists (select 1 from public.hub_skill_content_links where skill_id = v_skill and content_item_id = v_content_2);

  -- ============ The regulatory-fact-reference mechanism, against a real fact if one exists ============
  select id into v_fact from public.regulatory_facts where fact_type = 'PLAYER_COUNT' and rugby_code = 'union' limit 1;
  if v_fact is not null then
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
    select v_fact, v_content, 'RULE_EXPLANATION'
    where not exists (select 1 from public.hub_regulatory_fact_references where regulatory_fact_id = v_fact and content_item_id = v_content);
    raise notice 'PROOF: proof-warming-up-safely references a real regulatory_facts row rather than restating it.';
  else
    raise notice 'PROOF: no PLAYER_COUNT/union regulatory fact found to reference -- skipping the regulatory-fact-reference proof link (schema itself is still proven by supabase/tests/hub_content_relationships.sql).';
  end if;
end $$;
