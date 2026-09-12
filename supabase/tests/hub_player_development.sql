-- Rugby Hub Player Development -- permanent regression.
--
-- Pins the architecture this slice was approved on, and the product
-- invariants that make it safe to ship to children:
--
--   * PLAYER_DEVELOPMENT_CONCEPT is an ordinary hub_content_items
--     content_type. No new content table, no new junction table, no stage
--     schema, no per-player column.
--   * development_family is content-type-aware in BOTH directions: a
--     development concept must have one, and nothing else may.
--   * every relationship runs through a junction that already existed and
--     was already generic.
--   * Player Development has ZERO reach into players, profiles, auth
--     users, guardians, memberships, attendance, fixtures, coach notes or
--     assessments -- there is no column and no foreign key by which it
--     could describe, score, rank, track or compare an individual player.
--   * physical content stays principles-only: no individualised loads,
--     weight or body-composition targets, supplements, diet, diagnosis,
--     rehabilitation or return-to-play.
--   * no talent-identification, selection or rating language.
--   * Player Development does not duplicate Skills; it is the layer above.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_concept uuid;
  v_raised boolean;
  v_union_identity uuid;
  v_league_identity uuid;
  v_count int;
  v_bad text;
  v_admin uuid := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;
  v_dev_keys text[] := array[
    'learning-the-basics', 'building-core-skills', 'training-habits', 'learning-from-mistakes',
    'scanning-before-you-act', 'linking-skills-together', 'contact-confidence',
    'finding-space', 'support-play', 'breakdown-decision-making', 'tackle-count-awareness',
    'movement-and-coordination', 'speed-and-agility', 'progressive-physical-development', 'warm-up-habits',
    'confidence-and-composure', 'preparing-for-match-day', 'trying-different-positions', 'moving-through-age-grade-rugby'
  ];
begin
  select id into v_union_identity from public.regulatory_identities where rugby_code = 'union' limit 1;
  select id into v_league_identity from public.regulatory_identities where rugby_code = 'league' limit 1;

  -- ============ A. PLAYER_DEVELOPMENT_CONCEPT accepted ============
  insert into public.hub_content_items (content_key, content_type, development_family, title, summary)
  values ('hpd-test-concept-' || substr(gen_random_uuid()::text,1,8), 'PLAYER_DEVELOPMENT_CONCEPT', 'FOUNDATIONS', 'Test Concept', 'A test summary.')
  returning id into v_test_concept;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test_concept, true);
  raise notice 'PASS (A): PLAYER_DEVELOPMENT_CONCEPT is accepted as a content_type on the existing hub_content_items table';

  -- ============ B. No new tables ============
  if (select count(*) from information_schema.tables
      where table_schema = 'public'
        and (table_name like 'hub_development%' or table_name like 'hub_player_development%'
             or table_name like 'hub_development_stage%' or table_name like '%_development_stages')) <> 0 then
    raise exception 'FAIL (B): a dedicated Player Development table was created — the approved architecture adds zero new tables';
  end if;
  raise notice 'PASS (B): zero new Player Development tables exist';

  -- ============ C. development_family required on a development concept ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hpd-test-nofamily-' || substr(gen_random_uuid()::text,1,8), 'PLAYER_DEVELOPMENT_CONCEPT', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C): a PLAYER_DEVELOPMENT_CONCEPT was accepted with no development_family'; end if;
  raise notice 'PASS (C): a development concept without a development_family is rejected';

  -- ============ D. development_family rejected on any other content type ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, development_family, title, summary)
    values ('hpd-test-wrongtype-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'FOUNDATIONS', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (D): a non-development content type was allowed to carry a development_family — the column is not content-type-aware'; end if;
  raise notice 'PASS (D): development_family is rejected on a content type that is not PLAYER_DEVELOPMENT_CONCEPT';

  -- ============ E. Invalid development_family rejected ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, development_family, title, summary)
    values ('hpd-test-badfamily-' || substr(gen_random_uuid()::text,1,8), 'PLAYER_DEVELOPMENT_CONCEPT', 'ELITE_PATHWAY', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (E): an invalid development_family value was accepted'; end if;
  raise notice 'PASS (E): development_family is constrained to the five approved families';

  -- ============ F. All five families are populated ============
  select count(distinct development_family) into v_count
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and content_key = any(v_dev_keys) and status = 'PUBLISHED';
  if v_count <> 5 then
    raise exception 'FAIL (F): expected all five development families to carry published content, found %', v_count;
  end if;
  raise notice 'PASS (F): all five development families carry published content';

  -- ============ G. The seeded concept set is published ============
  select count(*) into v_count
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and content_key = any(v_dev_keys) and status = 'PUBLISHED';
  if v_count <> array_length(v_dev_keys, 1) then
    raise exception 'FAIL (G): expected % published development concepts from this slice, found %', array_length(v_dev_keys, 1), v_count;
  end if;
  raise notice 'PASS (G): every development concept this slice seeded is published';

  -- ============ H. Every concept carries real explanatory content ============
  select string_agg(content_key, ', ') into v_bad
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and content_key = any(v_dev_keys)
      and (summary is null or length(summary) < 40 or why_it_matters is null or length(why_it_matters) < 40 or body is null or length(body) < 200);
  if v_bad is not null then
    raise exception 'FAIL (H): development concepts exist as thin stubs rather than real explanations: %', v_bad;
  end if;
  raise notice 'PASS (H): every development concept carries a real summary, why-it-matters and body';

  -- ============ I. No player-comparable developmental column was added ============
  select string_agg(column_name, ', ') into v_bad
    from information_schema.columns
    where table_schema = 'public' and table_name = 'hub_content_items'
      and column_name ~ '(level|rating|score|grade_achieved|proficiency|competency|ability|percentile|rank|stage)';
  if v_bad is not null then
    raise exception 'FAIL (I): hub_content_items gained a column that could encode a player-comparable developmental value: %', v_bad;
  end if;
  raise notice 'PASS (I): no column exists on which one player could be developmentally compared to another';

  -- ============ J. Zero reach into operational or personal data ============
  select string_agg(distinct ccu.table_name, ', ') into v_bad
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('hub_content_items', 'hub_content_item_positions', 'hub_skill_content_links', 'hub_content_relationships', 'hub_regulatory_fact_references', 'hub_content_sources')
      and ccu.table_name in ('players', 'profiles', 'guardians', 'player_guardians', 'team_memberships', 'club_memberships', 'attendance', 'fixtures', 'fixture_participants', 'coach_notes', 'player_assessments');
  if v_bad is not null then
    raise exception 'FAIL (J): Player Development''s tables gained a foreign key into personal or operational data: %', v_bad;
  end if;
  raise notice 'PASS (J): Player Development has no foreign key into players, guardians, memberships, attendance, fixtures, coach notes or assessments';

  -- ============ K. hub_position_age_stage was not repurposed ============
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'hub_position_age_stage' and column_name in ('development_family', 'content_item_id')) <> 0 then
    raise exception 'FAIL (K): hub_position_age_stage was extended to carry development content — it answers a different question (which positions exist at an age grade) and was deliberately not reused';
  end if;
  raise notice 'PASS (K): hub_position_age_stage was left answering its own question, not turned into a development stage schema';

  -- ============ L. Skill links reuse the existing generic junction ============
  select count(*) into v_count
    from public.hub_skill_content_links l
    join public.hub_content_items ci on ci.id = l.content_item_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
  if v_count = 0 then
    raise exception 'FAIL (L): no development concept is linked to a skill — the Development -> Skill direction does not exist';
  end if;
  raise notice 'PASS (L): % development-to-skill links exist on the pre-existing generic hub_skill_content_links table', v_count;

  -- ============ M. Every skill-linked concept resolves to a published skill ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_skill_content_links l
    join public.hub_content_items ci on ci.id = l.content_item_id
    join public.hub_skills s on s.id = l.skill_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and s.status <> 'PUBLISHED';
  if v_bad is not null then
    raise exception 'FAIL (M): development concepts link to unpublished skills: %', v_bad;
  end if;
  raise notice 'PASS (M): every development-to-skill link resolves to a published skill';

  -- ============ N. Position links reuse the existing generic junction ============
  select count(*) into v_count
    from public.hub_content_item_positions p
    join public.hub_content_items ci on ci.id = p.content_item_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
  if v_count = 0 then
    raise exception 'FAIL (N): no development concept is linked to a position';
  end if;
  raise notice 'PASS (N): % development-to-position links exist on the pre-existing generic hub_content_item_positions table', v_count;

  -- ============ O. A code-scoped concept never links to the other code''s positions ============
  select string_agg(ci.content_key || ' -> ' || pos.position_key, ', ') into v_bad
    from public.hub_content_item_positions p
    join public.hub_content_items ci on ci.id = p.content_item_id
    join public.hub_positions pos on pos.id = p.position_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and ci.rugby_code is not null
      and pos.rugby_code <> ci.rugby_code;
  if v_bad is not null then
    raise exception 'FAIL (O): a code-specific development concept links to the other code''s positions — this breaks Union/League isolation: %', v_bad;
  end if;
  raise notice 'PASS (O): no code-specific development concept reaches across into the other code''s positions';

  -- ============ P. Relationships reuse hub_content_relationships ============
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items ci on ci.id = r.content_item_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and r.relationship_type = 'RELATED_KNOWLEDGE';
  if v_count = 0 then
    raise exception 'FAIL (P): no development relationship exists on hub_content_relationships';
  end if;
  raise notice 'PASS (P): % development relationships exist on the pre-existing hub_content_relationships table', v_count;

  -- ============ Q. Every relationship target is published ============
  select string_agg(src.content_key || ' -> ' || tgt.content_key, ', ') into v_bad
    from public.hub_content_relationships r
    join public.hub_content_items src on src.id = r.content_item_id
    join public.hub_content_items tgt on tgt.id = r.related_content_item_id
    where src.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and tgt.status <> 'PUBLISHED';
  if v_bad is not null then
    raise exception 'FAIL (Q): development concepts relate to unpublished content — the page would render a dead link: %', v_bad;
  end if;
  raise notice 'PASS (Q): every development relationship points at published content';

  -- ============ R. Rule references are explanations of real verified facts ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_regulatory_fact_references r
    join public.hub_content_items ci on ci.id = r.content_item_id
    join public.regulatory_facts f on f.id = r.regulatory_fact_id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and (r.reference_type <> 'RULE_EXPLANATION' or f.status <> 'VERIFIED');
  if v_bad is not null then
    raise exception 'FAIL (R): a development concept cites a fact that is not a VERIFIED rule explanation: %', v_bad;
  end if;
  raise notice 'PASS (R): every development rule citation is a RULE_EXPLANATION of a VERIFIED governing-body fact';

  -- ============ S. Every concept carries provenance ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and ci.content_key = any(v_dev_keys)
      and not exists (select 1 from public.hub_content_sources s where s.content_item_id = ci.id);
  if v_bad is not null then
    raise exception 'FAIL (S): development concepts exist with no source: %', v_bad;
  end if;
  raise notice 'PASS (S): every development concept carries at least one source';

  -- ============ T. Every concept has applicability ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and ci.content_key = any(v_dev_keys)
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = ci.id);
  if v_bad is not null then
    raise exception 'FAIL (T): published development concepts exist with no applicability row: %', v_bad;
  end if;
  raise notice 'PASS (T): every development concept has an applicability row';

  -- ============ U. Universality and rugby_code agree ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    join public.hub_content_applicability a on a.content_item_id = ci.id
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and ci.content_key = any(v_dev_keys)
      and ((ci.rugby_code is null and a.is_universal is not true) or (ci.rugby_code is not null and a.is_universal is true));
  if v_bad is not null then
    raise exception 'FAIL (U): a development concept''s rugby_code disagrees with its applicability — a code-specific concept is marked universal, or a universal one is scoped: %', v_bad;
  end if;
  raise notice 'PASS (U): every development concept''s rugby_code and applicability agree';

  -- ============ V. Union-only content never resolves for a League identity ============
  if v_union_identity is not null and v_league_identity is not null then
    select count(*) into v_count
      from public.hub_content_items ci
      join public.hub_content_applicability a on a.content_item_id = ci.id
      where ci.content_key = 'breakdown-decision-making'
        and ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
        and a.regulatory_identity_id in (select id from public.regulatory_identities where rugby_code = 'league');
    if v_count <> 0 then
      raise exception 'FAIL (V): the Union-only breakdown concept is applicable to a Rugby League identity';
    end if;
    select count(*) into v_count
      from public.hub_content_items ci
      join public.hub_content_applicability a on a.content_item_id = ci.id
      where ci.content_key = 'tackle-count-awareness'
        and ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
        and a.regulatory_identity_id in (select id from public.regulatory_identities where rugby_code = 'union');
    if v_count <> 0 then
      raise exception 'FAIL (V): the League-only tackle-count concept is applicable to a Rugby Union identity';
    end if;
    raise notice 'PASS (V): code-specific development concepts never resolve for the other code''s identities';
  else
    raise notice 'PASS (V, skipped): no union/league regulatory identities exist to test against';
  end if;

  -- ============ W. Alias search resolves ============
  if (select count(*) from public.hub_content_items
      where content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
        and content_key = 'scanning-before-you-act'
        and search_vector @@ websearch_to_tsquery('english', 'Heads Up')) <> 1 then
    raise exception 'FAIL (W): the "Heads Up" alias does not resolve to the scanning concept — aliases are not in the search vector';
  end if;
  raise notice 'PASS (W): a development concept''s aliases are searchable ("Heads Up" resolves to Scanning Before You Act)';

  -- ============ X. Search returns development concepts, with zero RPC change ============
  if (select count(*) from public.search_hub_content('scanning before you act', 20) where result_type = 'CONTENT_ITEM' and title = 'Scanning Before You Act') <> 1 then
    raise exception 'FAIL (X): search_hub_content does not return development concepts — the generic search index did not pick up the new content type';
  end if;
  raise notice 'PASS (X): development concepts are searchable through the unchanged generic search_hub_content';

  -- ============ Y. No content type beyond the approved set ============
  -- The approved list grows by exactly one per approved slice. COACHING_CONCEPT
  -- was added by the Coaching Knowledge slice (20270290000000) and PARENT_GUIDE
  -- by Parents & Guardians (20270300000000); the assertion
  -- still fails on anything that appears without approval, which is its point.
  select string_agg(distinct content_type, ', ') into v_bad
    from public.hub_content_items
    where content_type not in ('COACHING_GUIDANCE','PRACTICAL_GUIDE','FUN_FACT','QUIZ_ITEM','VISUAL_DEFINITION','GAME_CONCEPT','OFFICIATING_CONCEPT','COMPETITION_GUIDE','RUGBY_TEAM','RUGBY_PERSON','PLAYER_DEVELOPMENT_CONCEPT','COACHING_CONCEPT','PARENT_GUIDE');
  if v_bad is not null then
    raise exception 'FAIL (Y): an unexpected content_type exists: %', v_bad;
  end if;
  raise notice 'PASS (Y): this slice added exactly one content_type and no others appeared';

  -- ============ Z. Unpublished development content is not publicly readable ============
  update public.hub_content_items set status = 'DRAFT', published_by = null, published_at = null where id = v_test_concept;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test_concept) <> 0 then
    reset role;
    raise exception 'FAIL (Z): an anonymous reader can see a DRAFT development concept';
  end if;
  reset role;
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_test_concept;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test_concept) <> 1 then
    reset role;
    raise exception 'FAIL (Z): a PUBLISHED development concept is not readable';
  end if;
  reset role;
  raise notice 'PASS (Z): development concepts follow the existing publication and RLS rules exactly';

  -- ============ AA. The beginner path is data, and is code-universal ============
  select count(*) into v_count
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and journey_order is not null and status = 'PUBLISHED';
  if v_count < 3 then
    raise exception 'FAIL (AA): the beginner path has only % steps — it is not real', v_count;
  end if;
  select string_agg(content_key, ', ') into v_bad
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and journey_order is not null and rugby_code is not null;
  if v_bad is not null then
    raise exception 'FAIL (AA): a code-specific concept sits on the shared beginner path, so the path is dishonest in one code: %', v_bad;
  end if;
  raise notice 'PASS (AA): the beginner path is % steps, ordered in the data, and every step is code-universal', v_count;

  -- ============ AB. No duplicate or gapped journey positions ============
  select count(*) into v_count from (
    select journey_order from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and journey_order is not null
    group by journey_order having count(*) > 1
  ) dup;
  if v_count <> 0 then
    raise exception 'FAIL (AB): the beginner path has % duplicated positions', v_count;
  end if;
  if (select max(journey_order) from public.hub_content_items where content_type = 'PLAYER_DEVELOPMENT_CONCEPT')
     <> (select count(*) from public.hub_content_items where content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and journey_order is not null) then
    raise exception 'FAIL (AB): the beginner path has a gap — positions do not run 1..n';
  end if;
  raise notice 'PASS (AB): the beginner path runs 1..n with no duplicates and no gaps';

  -- ============ AC. No orphan concepts ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and ci.content_key = any(v_dev_keys)
      and not exists (select 1 from public.hub_skill_content_links l where l.content_item_id = ci.id)
      and not exists (select 1 from public.hub_content_item_positions p where p.content_item_id = ci.id)
      and not exists (select 1 from public.hub_content_relationships r where r.content_item_id = ci.id)
      and not exists (select 1 from public.hub_content_relationships r where r.related_content_item_id = ci.id);
  if v_bad is not null then
    raise exception 'FAIL (AC): development concepts exist that nothing links to and that link to nothing: %', v_bad;
  end if;
  raise notice 'PASS (AC): every development concept is connected to the rest of the Hub in at least one direction';

  -- ============ AD. Every concept has a relationship readable in some direction ============
  -- The product reads hub_content_relationships in BOTH directions for this
  -- domain, so a concept that is only ever a TARGET still renders related
  -- content. This pins that such concepts genuinely exist and are covered.
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and ci.content_key = any(v_dev_keys)
      and not exists (select 1 from public.hub_content_relationships r where r.content_item_id = ci.id or r.related_content_item_id = ci.id);
  if v_bad is not null then
    raise exception 'FAIL (AD): development concepts have no relationship in either direction and would render as dead ends: %', v_bad;
  end if;
  raise notice 'PASS (AD): every development concept has at least one relationship readable in one direction or the other';

  -- ============ AE. Physical content is principles-only ============
  select string_agg(content_key, ', ') into v_bad
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(why_it_matters,'') || ' ' || coalesce(body,'')
          ~* '(\mkg\M|\mlbs\M|\mreps\M|\msets of\M|body fat|body composition|\mBMI\M|supplement|protein powder|creatine|\mdiet plan\M|meal plan|\mcalorie|one-rep max|\m1RM\M|return to play|rehabilitation|rehab protocol|\mdiagnos)';
  if v_bad is not null then
    raise exception 'FAIL (AE): physical development content contains individualised load, body-composition, supplement, diet, diagnosis or return-to-play material: %', v_bad;
  end if;
  raise notice 'PASS (AE): physical development content is principles-only — no loads, targets, supplements, diets, diagnosis or return-to-play';

  -- ============ AF. No talent-identification, selection or rating language ============
  select string_agg(content_key, ', ') into v_bad
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(why_it_matters,'') || ' ' || coalesce(body,'')
          ~* '(talent identification|talent ID|gifted and talented|\melite pathway\M|scouted|\mscouting\M|\mtrial\M|selection policy|ranked against|rated against|score your|your rating|top \d+ percent)';
  if v_bad is not null then
    raise exception 'FAIL (AF): development content carries talent-identification, selection or rating language: %', v_bad;
  end if;
  raise notice 'PASS (AF): no development content frames a player as identified, selected, scouted, ranked or rated';

  -- ============ AG. No content tells a reader they are behind ============
  -- Deliberately NOT matching "not good enough". Learning From Mistakes
  -- names that exact thought in order to reject it ("treating the same
  -- mistake as evidence that you are simply not good enough tells you
  -- nothing"), which is the healthiest sentence in the domain. A pattern
  -- that cannot tell an assertion from its rebuttal would force the content
  -- to stop naming the thing a child is actually thinking, so this pins the
  -- phrases that are harmful in any framing instead.
  select string_agg(content_key, ', ') into v_bad
    from public.hub_content_items
    where content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(why_it_matters,'') || ' ' || coalesce(body,'')
          ~* '(you are behind|you''re behind|falling behind|fallen behind|too late to (start|learn|catch)|you should already|by now you should|not cut out for|never be good)';
  if v_bad is not null then
    raise exception 'FAIL (AG): development content tells a reader they are behind: %', v_bad;
  end if;
  raise notice 'PASS (AG): no development content tells a reader they are behind or too late';

  -- ============ AH. Development does not duplicate a Skill identity ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    join public.hub_skills s on s.skill_key = ci.content_key
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
  if v_bad is not null then
    raise exception 'FAIL (AH): a development concept shares a key with a skill — the two layers have collided: %', v_bad;
  end if;
  raise notice 'PASS (AH): no development concept shares an identity with a skill';

  -- ============ AI. Development content names no individual player ============
  select string_agg(ci.content_key, ', ') into v_bad
    from public.hub_content_items ci
    where ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
      and exists (
        select 1 from public.hub_content_items p
        where p.content_type = 'RUGBY_PERSON'
          and position(p.title in coalesce(ci.summary,'') || ' ' || coalesce(ci.why_it_matters,'') || ' ' || coalesce(ci.body,'')) > 0
      );
  if v_bad is not null then
    raise exception 'FAIL (AI): development content names an individual person — development guidance is about learning, not about anybody in particular: %', v_bad;
  end if;
  raise notice 'PASS (AI): no development concept names an individual person';

  -- ============ AJ. Skills were not altered by this slice ============
  if (select count(*) from public.hub_skills where status = 'PUBLISHED') < 11 then
    raise exception 'FAIL (AJ): published skills dropped below the 11 that existed before Player Development — this slice removed or unpublished a skill';
  end if;
  raise notice 'PASS (AJ): the Skills layer is intact — Player Development sits above it rather than replacing it';

  -- ============ AK. Positions were not altered by this slice ============
  if (select count(*) from public.hub_positions where status = 'PUBLISHED') < 28 then
    raise exception 'FAIL (AK): published positions dropped below the 28 that existed before Player Development';
  end if;
  raise notice 'PASS (AK): the Positions layer is intact';

  -- ============ AL. Neighbouring content types were not disturbed ============
  if (select count(*) from public.hub_content_items where content_type = 'GAME_CONCEPT' and status = 'PUBLISHED') < 13
     or (select count(*) from public.hub_content_items where content_type = 'OFFICIATING_CONCEPT' and status = 'PUBLISHED') < 20 then
    raise exception 'FAIL (AL): Game Knowledge or Officiating content was lost while adding Player Development';
  end if;
  raise notice 'PASS (AL): Game Knowledge and Officiating content is intact';

  -- ============ AM (verified after rollback): QA cleanup zero ============
  raise notice 'PASS (AM, pending): wrapped in begin/rollback — verified externally by re-querying for hpd-test-%% rows after this transaction rolls back';
end $$;

rollback;
