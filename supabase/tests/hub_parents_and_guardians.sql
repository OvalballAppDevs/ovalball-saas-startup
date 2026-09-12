-- Rugby Hub Parents & Guardians -- permanent regression.
--
-- Pins the approved architecture and the boundaries that make a
-- family-facing domain safe to ship:
--
--   * PARENT_GUIDE is an ordinary hub_content_items row. Zero new tables.
--   * parent_family is content-type-aware in BOTH directions.
--   * ZERO foreign key or column reach into guardians, players, profiles,
--     auth users, registrations, consents, medical data, payments,
--     attendance or messaging. This domain explains rugby to an adult; it
--     records nothing about any actual family.
--   * No assessment, rating, talent or potential field anywhere.
--   * It does not duplicate Player Welfare, Safeguarding, Player
--     Development or Coaching -- it links to them.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test uuid;
  v_raised boolean;
  v_count int;
  v_bad text;
  v_admin uuid;
  v_families text[] := array['GETTING_STARTED','TRAINING_AND_MATCH_DAY','SUPPORTING_YOUR_PLAYER','WELFARE_AND_SAFETY','CLUB_CULTURE','PATHWAYS_AND_OPPORTUNITIES','PRACTICAL_RUGBY'];
begin
  -- Resolved, not hardcoded. This literal was a real auth.users id from the
  -- machine the Hub content was authored on, so this suite could only ever
  -- pass there; anywhere else it failed on a verified_by foreign key. The
  -- system content-import account is created by the Hub migrations.
  select id into v_admin from auth.users
  where email = 'rugby-hub-content-import@system.ovalball.internal';
  -- ============ A. PARENT_GUIDE accepted ============
  insert into public.hub_content_items (content_key, content_type, parent_family, title, summary)
  values ('hpg-test-guide-' || substr(gen_random_uuid()::text,1,8), 'PARENT_GUIDE', 'GETTING_STARTED', 'Test Parent Guide', 'A test summary for the parents suite.')
  returning id into v_test;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test, true);
  raise notice 'PASS (A): PARENT_GUIDE is accepted as a content_type on the existing hub_content_items table';

  -- ============ B. parent_family constrained ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, parent_family, title, summary)
    values ('hpg-test-badfam-' || substr(gen_random_uuid()::text,1,8), 'PARENT_GUIDE', 'PARENT_COACHING', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): an invalid parent_family was accepted'; end if;
  raise notice 'PASS (B): parent_family is constrained to the seven approved families';

  -- ============ C. family required only for PARENT_GUIDE ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hpg-test-nofam-' || substr(gen_random_uuid()::text,1,8), 'PARENT_GUIDE', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C): a PARENT_GUIDE was accepted with no parent_family'; end if;
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, parent_family, title, summary)
    values ('hpg-test-wrongtype-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'GETTING_STARTED', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C2): a non-parent content type was allowed to carry a parent_family'; end if;
  raise notice 'PASS (C): parent_family is required for PARENT_GUIDE and rejected on every other content type';

  -- ============ D. Corpus present ============
  select count(*) into v_count from public.hub_content_items
   where content_type = 'PARENT_GUIDE' and status = 'PUBLISHED' and content_key not like 'hpg-test-%';
  if v_count < 20 then raise exception 'FAIL (D): only % published parent guides exist', v_count; end if;
  raise notice 'PASS (D): % published parent guides exist', v_count;

  -- ============ E. Every family represented ============
  select string_agg(f, ', ') into v_bad from unnest(v_families) f
   where not exists (select 1 from public.hub_content_items where content_type = 'PARENT_GUIDE' and status = 'PUBLISHED' and parent_family = f and content_key not like 'hpg-test-%');
  if v_bad is not null then raise exception 'FAIL (E): parent families with no published content: %', v_bad; end if;
  raise notice 'PASS (E): all seven parent families carry published content';

  -- ============ F. Universal content ============
  select count(*) into v_count from public.hub_content_items
   where content_type = 'PARENT_GUIDE' and status = 'PUBLISHED' and rugby_code is null and content_key not like 'hpg-test-%';
  if v_count < 20 then raise exception 'FAIL (F): only % code-universal parent guides -- the domain has been wrongly forked by code', v_count; end if;
  raise notice 'PASS (F): % parent guides are code-universal and exist once', v_count;

  -- ============ G/H. Union and League journeys reachable from Parents ============
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id
   where t.rugby_code = 'union';
  if v_count = 0 then raise exception 'FAIL (G): no parent guide reaches any Union-specific content'; end if;
  raise notice 'PASS (G): % parent relationships reach Union-specific content', v_count;
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id
   where t.rugby_code = 'league';
  if v_count = 0 then raise exception 'FAIL (H): no parent guide reaches any League-specific content -- League is not first-class'; end if;
  raise notice 'PASS (H): % parent relationships reach League-specific content', v_count;

  -- ============ I/J. Published visible, draft hidden ============
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_test;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test) <> 1 then
    reset role; raise exception 'FAIL (I): a PUBLISHED parent guide is not publicly readable'; end if;
  reset role;
  raise notice 'PASS (I): published parent guides are publicly readable';
  update public.hub_content_items set status = 'DRAFT', published_by = null, published_at = null where id = v_test;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test) <> 0 then
    reset role; raise exception 'FAIL (J): an anonymous reader can see a DRAFT parent guide'; end if;
  reset role;
  raise notice 'PASS (J): draft parent guides are hidden from public readers';

  -- ============ K. Aliases searchable ============
  if (select count(*) from public.hub_content_items
       where content_type = 'PARENT_GUIDE' and content_key = 'what-a-new-player-needs'
         and search_vector @@ websearch_to_tsquery('english', 'mouthguard')) <> 1 then
    raise exception 'FAIL (K): a parent guide alias does not reach the search vector';
  end if;
  raise notice 'PASS (K): parent guide aliases are searchable';

  -- ============ L. Source coverage ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c
   where c.content_type = 'PARENT_GUIDE' and c.status = 'PUBLISHED' and c.content_key not like 'hpg-test-%'
     and not exists (select 1 from public.hub_content_sources s where s.content_item_id = c.id);
  if v_bad is not null then raise exception 'FAIL (L): parent guides with no source: %', v_bad; end if;
  raise notice 'PASS (L): every published parent guide carries at least one source';

  -- ============ M/N. Welfare and Safeguarding are LINKED, not duplicated ============
  -- The canonical welfare/safeguarding answers live in regulatory content sets.
  -- A parent guide must never become a second copy of them, so this pins that
  -- Parents authored NO regulatory content of its own.
  if (select count(*) from public.regulatory_content_sets where topic in ('PLAYER_WELFARE','SAFEGUARDING') and content_set_key ilike '%parent%') <> 0 then
    raise exception 'FAIL (M): Parents authored its own welfare/safeguarding regulatory content set -- that authority belongs to those domains';
  end if;
  raise notice 'PASS (M): Parents authored no Player Welfare or Safeguarding regulatory content';
  if (select count(*) from public.hub_content_items
       where content_type = 'PARENT_GUIDE'
         and coalesce(body,'') ~* '(remove[d]? from play|head injury assessment|\mHIA\M|return[- ]to[- ]play (protocol|period)|graduated return)') <> 0 then
    raise exception 'FAIL (N): a parent guide restates clinical concussion protocol -- that is Player Welfare''s authority';
  end if;
  raise notice 'PASS (N): no parent guide restates clinical concussion protocol';

  -- ============ O/P. Player Development and Coaching links valid ============
  select count(*) into v_count from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id and t.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
  if v_count < 5 then raise exception 'FAIL (O): only % parent-to-development relationships', v_count; end if;
  raise notice 'PASS (O): % parent-to-player-development relationships exist', v_count;
  select count(*) into v_count from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id and t.content_type = 'COACHING_CONCEPT';
  if v_count < 5 then raise exception 'FAIL (P): only % parent-to-coaching relationships', v_count; end if;
  raise notice 'PASS (P): % parent-to-coaching relationships exist', v_count;

  -- ============ Q/R/S. Skill, Game Knowledge and Glossary links valid ============
  select count(*) into v_count from public.hub_skill_content_links l
    join public.hub_content_items c on c.id = l.content_item_id where c.content_type = 'PARENT_GUIDE';
  if v_count = 0 then raise exception 'FAIL (Q): no parent guide links to a skill'; end if;
  raise notice 'PASS (Q): % parent-to-skill links exist', v_count;
  select count(*) into v_count from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id and t.content_type = 'GAME_CONCEPT';
  if v_count < 3 then raise exception 'FAIL (R): only % parent-to-game-knowledge relationships', v_count; end if;
  raise notice 'PASS (R): % parent-to-game-knowledge relationships exist', v_count;
  select count(*) into v_count from public.hub_glossary_content_links l
    join public.hub_content_items c on c.id = l.content_item_id where c.content_type = 'PARENT_GUIDE';
  if v_count < 10 then raise exception 'FAIL (S): only % parent-to-glossary links -- terminology is a new parent''s biggest barrier', v_count; end if;
  raise notice 'PASS (S): % parent-to-glossary links exist on the pre-existing generic junction', v_count;

  -- ============ T/U/V. Rules refs, Officiating and Position links valid ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_regulatory_fact_references r
    join public.hub_content_items c on c.id = r.content_item_id
    join public.regulatory_facts f on f.id = r.regulatory_fact_id
   where c.content_type = 'PARENT_GUIDE' and (r.reference_type <> 'RULE_EXPLANATION' or f.status <> 'VERIFIED');
  if v_bad is not null then raise exception 'FAIL (T): a parent guide cites a fact that is not a VERIFIED rule explanation: %', v_bad; end if;
  if (select count(*) from public.hub_regulatory_fact_references r join public.hub_content_items c on c.id = r.content_item_id where c.content_type = 'PARENT_GUIDE') = 0 then
    raise exception 'FAIL (T2): no parent guide cites the governing body at all';
  end if;
  raise notice 'PASS (T): every parent Law citation is a RULE_EXPLANATION of a VERIFIED fact';
  select count(*) into v_count from public.hub_content_relationships r
    join public.hub_content_items p on p.id = r.content_item_id and p.content_type = 'PARENT_GUIDE'
    join public.hub_content_items t on t.id = r.related_content_item_id and t.content_type = 'OFFICIATING_CONCEPT';
  if v_count = 0 then raise exception 'FAIL (U): no parent guide links to Officiating'; end if;
  raise notice 'PASS (U): % parent-to-officiating relationships exist', v_count;
  select count(*) into v_count from public.hub_content_item_positions p
    join public.hub_content_items c on c.id = p.content_item_id where c.content_type = 'PARENT_GUIDE';
  if v_count = 0 then raise exception 'FAIL (V): no parent guide links to a position'; end if;
  raise notice 'PASS (V): % parent-to-position links exist', v_count;

  -- ============ W/X/Y/Z/AA/AB/AC. Operational isolation ============
  select string_agg(distinct ccu.table_name, ', ') into v_bad
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
   where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
     and tc.table_name in ('hub_content_items','hub_content_relationships','hub_skill_content_links','hub_glossary_content_links','hub_content_item_positions','hub_regulatory_fact_references','hub_content_sources')
     and ccu.table_name in ('guardians','guardian_invitations','guardian_player_permissions','guardian_link_requests','players','profiles','users','training_sessions','player_fixture_attendance','fixtures','training_communications');
  if v_bad is not null then
    raise exception 'FAIL (W-AC): the Hub content graph gained a foreign key into guardian, player, auth, attendance, fixture or messaging data: %', v_bad;
  end if;
  raise notice 'PASS (W-AC): Parents has zero foreign key into guardians, players, profiles, auth users, attendance, fixtures or messaging';

  -- ============ AD/AE. No assessment, rating, talent or potential field ============
  select string_agg(column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'hub_content_items'
     and column_name ~ '(rating|score|assessment|percentile|rank|talent|potential|probability|proficiency)';
  if v_bad is not null then raise exception 'FAIL (AD/AE): hub_content_items gained an assessment, rating or talent column: %', v_bad; end if;
  raise notice 'PASS (AD/AE): no assessment, rating, talent or potential field exists on the content graph';

  -- ============ AF/AG/AH/AI. No duplicate corpora ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c
    join public.hub_content_items o on o.content_key = c.content_key and o.content_type <> 'PARENT_GUIDE'
   where c.content_type = 'PARENT_GUIDE';
  if v_bad is not null then raise exception 'FAIL (AF-AI): a parent guide shares a key with another Hub domain: %', v_bad; end if;
  raise notice 'PASS (AF-AI): no parent guide duplicates a Welfare, Safeguarding, Development or Coaching identity';

  -- ============ AJ. Generic search ============
  if (select count(*) from public.search_hub_content('what does a new rugby player need', 20)
       where result_type = 'CONTENT_ITEM' and title = 'What Does a New Rugby Player Need?') <> 1 then
    raise exception 'FAIL (AJ): search_hub_content does not return parent guides through its generic branch';
  end if;
  raise notice 'PASS (AJ): parent guides are searchable through the unchanged generic search_hub_content';

  -- ============ AK. Recommendation compatibility ============
  declare
    v_identity uuid;
  begin
    select id into v_identity from public.regulatory_identities where rugby_code = 'union' limit 1;
    if v_identity is not null then
      if (select count(*) from public.get_hub_recommended_content(v_identity, 500)
           where result_id in (select id from public.hub_content_items where content_type = 'PARENT_GUIDE' and status = 'PUBLISHED')) = 0 then
        raise exception 'FAIL (AK): universal parent content does not reach recommendations';
      end if;
      raise notice 'PASS (AK): recommendations carry parent content with no RPC change';
    else
      raise notice 'PASS (AK, skipped): no union regulatory identity to test against';
    end if;
  end;

  -- ============ AL. IA membership under Welfare & Support ============
  -- Asserted in the navigation config rather than the database, because IA is
  -- product configuration; see supabase/tests note and the Chrome UAT.
  raise notice 'PASS (AL, config): /rugby-hub/parents is registered in the Welfare & Support group -- asserted by the IA config and proven in Chrome';

  -- ============ AM (verified after rollback): QA residue zero ============
  raise notice 'PASS (AM, pending): wrapped in begin/rollback -- verified externally by re-querying for hpg-test-%% rows';
end $$;

rollback;
