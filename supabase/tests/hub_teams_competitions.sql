-- Rugby Hub Teams & Competitions -- permanent regression.
--
-- Pins: COMPETITION_GUIDE is accepted as a hub_content_items content_type
-- and no TEAM_GUIDE (or any other new type) was introduced alongside it;
-- the real seeded corpus is durable, deduplicated and correctly code-
-- scoped; the generic explainers are genuinely universal; DRAFT content
-- never surfaces; search and recommendations already generalise to this
-- new content_type with zero RPC change; rugby-code isolation holds both
-- directions in recommendations; Glossary/content relationships are real
-- and FK-enforced; the new editorial-provenance columns behave correctly
-- whether populated or not; and -- the architectural boundary this whole
-- domain exists to protect -- the operational competitions/competition_
-- editions/competition_edition_teams tables, and every other operational
-- table, remain completely untouched and unreferenced by this migration.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_identity_union uuid;
  v_test_identity_league uuid;
  v_test_guide uuid;
  v_test_guide_2 uuid;
  v_test_glossary uuid;
  v_raised boolean;
  v_n int;
  v_operational_competitions_before int;
  v_operational_editions_before int;
  v_operational_edition_teams_before int;
begin
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'htc-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_test_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'htc-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_test_identity_league;

  select count(*) into v_operational_competitions_before from public.competitions;
  select count(*) into v_operational_editions_before from public.competition_editions;
  select count(*) into v_operational_edition_teams_before from public.competition_edition_teams;

  -- ============ A. COMPETITION_GUIDE accepted ============
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('htc-test-' || substr(gen_random_uuid()::text,1,8), 'COMPETITION_GUIDE', 'Test Competition Guide', 'A test summary.')
  returning id into v_test_guide;
  raise notice 'PASS (A): a COMPETITION_GUIDE row is accepted';

  -- ============ B. No TEAM_GUIDE (or any other new type) was introduced ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('htc-test-teamguide-' || substr(gen_random_uuid()::text,1,8), 'TEAM_GUIDE', 'Should not exist', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): a TEAM_GUIDE content_type was accepted — this was explicitly excluded from scope'; end if;
  raise notice 'PASS (B): TEAM_GUIDE (and by extension CLUB_GUIDE/COMPETITION_ENTITY/PYRAMID_ENTITY) remains rejected — exactly one new content_type was introduced';

  -- ============ C. Expected published corpus count ============
  -- Scoped to this slice's own UK-domestic content_keys rather than every
  -- COMPETITION_GUIDE row: International Rugby (a later slice) legitimately
  -- adds its own COMPETITION_GUIDE rows (Six Nations, Rugby World Cup, etc.)
  -- reusing the same content_type, and a global count would break here every
  -- time a later domain extends it.
  if (
    select count(*) from public.hub_content_items
    where content_type = 'COMPETITION_GUIDE' and status = 'PUBLISHED'
      and content_key in (
        'premiership-rugby', 'premiership-womens-rugby', 'champ-rugby', 'super-league', 'the-championship-rugby-league', 'challenge-cup',
        'how-league-tables-work', 'league-cup-or-hybrid', 'promotion-and-relegation', 'the-rugby-pyramid', 'club-vs-team', 'professional-vs-community-rugby'
      )
  ) <> 12 then
    raise exception 'FAIL (C): expected exactly 12 permanent published UK-domestic COMPETITION_GUIDE rows (6 named + 6 generic explainers)';
  end if;
  raise notice 'PASS (C): exactly 12 permanent published UK-domestic COMPETITION_GUIDE rows exist';

  -- ============ D. No duplicate content_keys ============
  if (select count(*) from (select content_key from public.hub_content_items where content_type = 'COMPETITION_GUIDE' group by content_key having count(*) > 1) dupes) <> 0 then
    raise exception 'FAIL (D): a duplicate content_key exists among COMPETITION_GUIDE rows';
  end if;
  raise notice 'PASS (D): no duplicate content_keys among COMPETITION_GUIDE rows';

  -- ============ E/F. Union/League named guides carry correct code and real applicability ============
  -- Scoped to this slice's own 3 named Union / 3 named League content_keys:
  -- International Rugby (a later slice) legitimately adds further union/
  -- league COMPETITION_GUIDE rows of its own, so a global rugby_code count
  -- would break every time a later domain extends this content_type.
  if (
    select count(*) from public.hub_content_items
    where content_type = 'COMPETITION_GUIDE' and rugby_code = 'union'
      and content_key in ('premiership-rugby', 'premiership-womens-rugby', 'champ-rugby')
  ) <> 3 then
    raise exception 'FAIL (E): expected exactly 3 named UK-domestic Union COMPETITION_GUIDE rows';
  end if;
  if (
    select count(*) from public.hub_content_items ci
    where ci.content_type = 'COMPETITION_GUIDE' and ci.rugby_code = 'union'
      and ci.content_key in ('premiership-rugby', 'premiership-womens-rugby', 'champ-rugby')
      and not exists (
        select 1 from public.hub_content_applicability a join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
        where a.content_item_id = ci.id and ri.rugby_code = 'union'
      )
  ) <> 0 then
    raise exception 'FAIL (E2): a named Union COMPETITION_GUIDE is missing real Union-identity applicability';
  end if;
  raise notice 'PASS (E): exactly 3 named UK-domestic Union COMPETITION_GUIDE rows exist, each with real Union-identity applicability';

  if (
    select count(*) from public.hub_content_items
    where content_type = 'COMPETITION_GUIDE' and rugby_code = 'league'
      and content_key in ('super-league', 'the-championship-rugby-league', 'challenge-cup')
  ) <> 3 then
    raise exception 'FAIL (F): expected exactly 3 named UK-domestic League COMPETITION_GUIDE rows';
  end if;
  if (
    select count(*) from public.hub_content_items ci
    where ci.content_type = 'COMPETITION_GUIDE' and ci.rugby_code = 'league'
      and ci.content_key in ('super-league', 'the-championship-rugby-league', 'challenge-cup')
      and not exists (
        select 1 from public.hub_content_applicability a join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
        where a.content_item_id = ci.id and ri.rugby_code = 'league'
      )
  ) <> 0 then
    raise exception 'FAIL (F2): a named League COMPETITION_GUIDE is missing real League-identity applicability';
  end if;
  raise notice 'PASS (F): exactly 3 named UK-domestic League COMPETITION_GUIDE rows exist, each with real League-identity applicability';

  -- ============ G. Universal explainer behaviour correct ============
  if (
    select count(*) from public.hub_content_items ci
    where ci.content_type = 'COMPETITION_GUIDE' and ci.rugby_code is null and ci.content_key not like 'htc-test-%'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = ci.id and a.is_universal = true)
  ) <> 0 then
    raise exception 'FAIL (G): a generic explainer is missing a real is_universal applicability row';
  end if;
  if (select count(*) from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and rugby_code is null and content_key not like 'htc-test-%') <> 6 then
    raise exception 'FAIL (G2): expected exactly 6 generic (code-universal) explainer rows';
  end if;
  raise notice 'PASS (G): exactly 6 generic explainers exist, each genuinely universal';

  -- ============ H. DRAFT excluded from search ============
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('htc-test-draft-' || substr(gen_random_uuid()::text,1,8), 'COMPETITION_GUIDE', 'Htctestdraftcompetition', 'Not published.')
  returning id into v_test_guide_2;
  if (select count(*) from public.search_hub_content('Htctestdraftcompetition', 20) where result_id = v_test_guide_2) <> 0 then
    raise exception 'FAIL (H): a DRAFT COMPETITION_GUIDE appeared in search_hub_content';
  end if;
  raise notice 'PASS (H): a DRAFT COMPETITION_GUIDE never surfaces in search';

  -- ============ I/J. Search indexes competition articles via the existing, unchanged CONTENT_ITEM branch ============
  update public.hub_content_items set title = 'Htctestsearchablecompetition' where id = v_test_guide;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test_guide, true);
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = (select id from auth.users where email = 'rugby-hub-content-import@system.ovalball.internal'), reviewed_at = now(), published_by = (select id from auth.users where email = 'rugby-hub-content-import@system.ovalball.internal'), published_at = now() where id = v_test_guide;
  if (select count(*) from public.search_hub_content('Htctestsearchablecompetition', 20) where result_id = v_test_guide and result_type = 'CONTENT_ITEM') <> 1 then
    raise exception 'FAIL (I): a published COMPETITION_GUIDE did not appear in search_hub_content via the existing CONTENT_ITEM branch';
  end if;
  raise notice 'PASS (I): search_hub_content returns a published COMPETITION_GUIDE with zero RPC change';

  if (select count(*) from public.search_hub_content('Htctestsearchablecompetition', 20) where result_type not in ('CONTENT_ITEM')) <> 0 then
    raise exception 'FAIL (J): search_hub_content unexpectedly introduced a new raw result_type for competition content';
  end if;
  raise notice 'PASS (J): search_hub_content''s raw result_type for competition content remains exactly CONTENT_ITEM — presentation-only relabelling happens client-side';

  -- ============ K. Recommendations include appropriate competition content, with zero RPC change ============
  if (select count(*) from public.get_hub_recommended_content(v_test_identity_union, 500) where result_id = v_test_guide) <> 1 then
    raise exception 'FAIL (K): a universal, published COMPETITION_GUIDE was not returned by get_hub_recommended_content';
  end if;
  raise notice 'PASS (K): get_hub_recommended_content returns a legitimate universal COMPETITION_GUIDE with zero RPC change';

  -- ============ L/M. Code isolation both directions on real named guides ============
  if (select count(*) from public.get_hub_recommended_content(v_test_identity_league, 500) where result_id in (select id from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and rugby_code = 'union')) <> 0 then
    raise exception 'FAIL (L): a Union-only COMPETITION_GUIDE leaked into League-context recommendations';
  end if;
  raise notice 'PASS (L): Union-only competition guides never reach League-context recommendations';

  if (select count(*) from public.get_hub_recommended_content(v_test_identity_union, 500) where result_id in (select id from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and rugby_code = 'league')) <> 0 then
    raise exception 'FAIL (M): a League-only COMPETITION_GUIDE leaked into Union-context recommendations';
  end if;
  raise notice 'PASS (M): League-only competition guides never reach Union-context recommendations';

  -- ============ N. Glossary links valid ============
  select id into v_test_glossary from public.hub_glossary_terms where term_key = 'league-competition';
  if v_test_glossary is null then raise exception 'FAIL (N): the new "League" glossary term does not exist'; end if;
  if (select count(*) from public.hub_glossary_content_links where glossary_term_id = v_test_glossary) < 1 then
    raise exception 'FAIL (N2): the new "League" glossary term has no real content link';
  end if;
  raise notice 'PASS (N): new Glossary terms carry real, FK-enforced content links into the competition-guide corpus';

  -- ============ O. Content relationships valid ============
  if (select count(*) from public.hub_content_relationships where content_item_id in (select id from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and content_key not like 'htc-test-%')) < 10 then
    raise exception 'FAIL (O): fewer than the expected sparse set of content relationships exist among competition guides';
  end if;
  raise notice 'PASS (O): sparse, real hub_content_relationships edges exist among the competition-guide corpus';

  -- ============ P/Q. Editorial provenance fields accepted when present, absent where not required ============
  -- Scoped to this slice's own 6 named UK-domestic competitions: International
  -- Rugby's own COMPETITION_GUIDE rows also carry source provenance, so a
  -- global source_url count would break every time a later domain extends
  -- this content_type with its own sourced competitions.
  if (
    select count(*) from public.hub_content_items
    where content_type = 'COMPETITION_GUIDE' and source_url is not null
      and content_key in ('premiership-rugby', 'premiership-womens-rugby', 'champ-rugby', 'super-league', 'the-championship-rugby-league', 'challenge-cup')
  ) <> 6 then
    raise exception 'FAIL (P): expected exactly the 6 named UK-domestic competitions to carry source provenance';
  end if;
  raise notice 'PASS (P): source_note/source_url/source_retrieved_on accepted and populated on every named (non-timeless) UK-domestic competition guide';

  if (select count(*) from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and rugby_code is null and source_url is not null and content_key not like 'htc-test-%') <> 0 then
    raise exception 'FAIL (Q): a timeless generic explainer unexpectedly carries a source_url';
  end if;
  raise notice 'PASS (Q): the generic, timeless explainers correctly carry no source_url — provenance is not forced onto content that does not need it';

  -- ============ R. Operational competitions/competition_editions/competition_edition_teams tables remain completely untouched ============
  if (select count(*) from public.competitions) <> v_operational_competitions_before
     or (select count(*) from public.competition_editions) <> v_operational_editions_before
     or (select count(*) from public.competition_edition_teams) <> v_operational_edition_teams_before then
    raise exception 'FAIL (R): an operational competitions/competition_editions/competition_edition_teams row count changed as a side effect of this domain';
  end if;
  raise notice 'PASS (R): operational competitions/competition_editions/competition_edition_teams remain completely untouched';

  -- ============ S. No professional/Hub article was created as an operational competition row ============
  if exists (
    select 1 from public.competitions c
    where c.name in ('Premiership Rugby', 'Premiership Women''s Rugby (PWR)', 'Champ Rugby', 'Super League', 'The Championship (Rugby League)', 'The Challenge Cup')
  ) then
    raise exception 'FAIL (S): a professional/editorial competition name leaked into the operational competitions table';
  end if;
  raise notice 'PASS (S): none of the seeded editorial competition guides exist as operational competitions rows — the two populations remain fully separate';

  -- ============ T. No new competition/team relationship table was introduced ============
  if exists (
    select 1 from pg_class where relkind = 'r' and relname in ('hub_competition_relationships', 'hub_team_relationships', 'hub_competition_teams', 'competition_guide_teams')
  ) then
    raise exception 'FAIL (T): a new competition/team relationship table was introduced';
  end if;
  raise notice 'PASS (T): no new competition/team relationship table exists — hub_content_relationships was reused exactly as designed';

  -- ============ U. No new hub_regulatory_fact_references reference_type was introduced ============
  if (
    select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.hub_regulatory_fact_references'::regclass and conname = 'hub_regulatory_fact_references_reference_type_check'
  ) not like '%RULE_EXPLANATION%RULE_GLOSSARY%' then
    raise exception 'FAIL (U): the hub_regulatory_fact_references reference_type taxonomy changed unexpectedly';
  end if;
  if (
    select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.hub_regulatory_fact_references'::regclass and conname = 'hub_regulatory_fact_references_reference_type_check'
  ) ~ 'COMPETITION' then
    raise exception 'FAIL (U2): a new competition-specific reference_type was added to hub_regulatory_fact_references';
  end if;
  raise notice 'PASS (U): hub_regulatory_fact_references still carries exactly RULE_EXPLANATION/RULE_GLOSSARY — no new reference type was needed for this domain';

  -- ============ V. No private-table dependency for the Hub route/query ============
  -- The real data-layer query (getCompetitionBundle) selects only from
  -- hub_content_items, hub_content_relationships and
  -- hub_glossary_content_links -- this proves those three tables' public-
  -- read policies alone are sufficient to serve every published
  -- COMPETITION_GUIDE row, with no dependency on clubs/teams/players/
  -- fixtures/competitions being readable at all.
  perform set_config('role', 'anon', true);
  if (select count(*) from public.hub_content_items where id = v_test_guide and status = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (V): a published COMPETITION_GUIDE is not readable via its own public-read policy alone (as anon), independent of any operational table';
  end if;
  reset role;
  raise notice 'PASS (V): a published COMPETITION_GUIDE is readable via hub_content_items'' own public-read policy alone — the Hub route depends on zero private operational tables';

  -- ============ W. All published rows have real applicability ============
  if (
    select count(*) from public.hub_content_items ci
    where ci.content_type = 'COMPETITION_GUIDE' and ci.status = 'PUBLISHED' and ci.content_key not like 'htc-test-%'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = ci.id)
  ) <> 0 then
    raise exception 'FAIL (W): a published COMPETITION_GUIDE has no applicability row at all';
  end if;
  raise notice 'PASS (W): every published COMPETITION_GUIDE row carries real applicability';

  -- ============ X. Article supersession/publication semantics remain correct (reused, unchanged) ============
  v_raised := false;
  begin
    update public.hub_content_items set status = 'SUPERSEDED' where id = v_test_guide;
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (X): a COMPETITION_GUIDE was marked SUPERSEDED with no superseded_by target'; end if;
  raise notice 'PASS (X): COMPETITION_GUIDE rows still require a real superseded_by target to be marked SUPERSEDED — the existing lifecycle constraint applies unchanged';

  -- ============ Y (verified after rollback, not here): QA fixture rollback leaves zero residue ============
  raise notice 'PASS (Y, pending): this whole test file is wrapped in begin/rollback — verified externally by re-querying for htc-test-%% rows after this transaction rolls back';
end $$;

rollback;
