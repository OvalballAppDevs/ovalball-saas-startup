-- Rugby Hub Coaching Knowledge -- permanent regression.
--
-- Pins the approved architecture and the boundaries that keep this domain
-- educational rather than operational:
--
--   * COACHING_CONCEPT is an ordinary hub_content_items row. Zero new
--     tables, zero new junctions, zero operational state.
--   * coaching_family is content-type-aware in BOTH directions.
--   * Coaching Knowledge has ZERO foreign key or column reach into the
--     Training Centre (training_sessions, training_plans,
--     training_communications, player_fixture_attendance) or into players,
--     profiles, auth users, teams, clubs or fixtures.
--   * No assessment, rating, score, qualification or session/attendance
--     field exists anywhere on the content graph.
--   * Coaching does not duplicate Skills, Player Development or Game
--     Knowledge, and seeds no People, Clubs or Heritage.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test uuid;
  v_raised boolean;
  v_count int;
  v_bad text;
  v_admin uuid := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;
  v_families text[] := array['COACHING_APPROACH','SESSION_DESIGN','PRACTICE_DESIGN','COMMUNICATION','INCLUSION','SAFETY','REFLECTION'];
begin
  -- ============ A. COACHING_CONCEPT accepted ============
  insert into public.hub_content_items (content_key, content_type, coaching_family, title, summary)
  values ('hck-test-concept-' || substr(gen_random_uuid()::text,1,8), 'COACHING_CONCEPT', 'SESSION_DESIGN', 'Test Coaching Concept', 'A test summary for the coaching suite.')
  returning id into v_test;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test, true);
  raise notice 'PASS (A): COACHING_CONCEPT is accepted as a content_type on the existing hub_content_items table';

  -- ============ B. coaching_family constrained to the approved set ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, coaching_family, title, summary)
    values ('hck-test-badfamily-' || substr(gen_random_uuid()::text,1,8), 'COACHING_CONCEPT', 'ELITE_PERFORMANCE', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): an invalid coaching_family value was accepted'; end if;
  raise notice 'PASS (B): coaching_family is constrained to the seven approved families';

  -- ============ C. family required for Coaching, forbidden elsewhere ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hck-test-nofamily-' || substr(gen_random_uuid()::text,1,8), 'COACHING_CONCEPT', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C): a COACHING_CONCEPT was accepted with no coaching_family'; end if;
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, coaching_family, title, summary)
    values ('hck-test-wrongtype-' || substr(gen_random_uuid()::text,1,8), 'GAME_CONCEPT', 'SESSION_DESIGN', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C2): a non-coaching content type was allowed to carry a coaching_family'; end if;
  raise notice 'PASS (C): coaching_family is required for COACHING_CONCEPT and rejected on every other content type';

  -- ============ D. Corpus present ============
  select count(*) into v_count from public.hub_content_items
   where content_type = 'COACHING_CONCEPT' and status = 'PUBLISHED' and content_key not like 'hck-test-%';
  if v_count < 20 then
    raise exception 'FAIL (D): only % published coaching concepts exist — the domain is not real', v_count;
  end if;
  raise notice 'PASS (D): % published coaching concepts exist', v_count;

  -- ============ E. Every family represented ============
  select string_agg(f, ', ') into v_bad from unnest(v_families) f
   where not exists (
     select 1 from public.hub_content_items
      where content_type = 'COACHING_CONCEPT' and status = 'PUBLISHED' and coaching_family = f and content_key not like 'hck-test-%');
  if v_bad is not null then
    raise exception 'FAIL (E): coaching families exist with no published content: %', v_bad;
  end if;
  raise notice 'PASS (E): all seven coaching families carry published content';

  -- ============ F. Universal content exists ============
  select count(*) into v_count from public.hub_content_items
   where content_type = 'COACHING_CONCEPT' and status = 'PUBLISHED' and rugby_code is null and content_key not like 'hck-test-%';
  if v_count < 15 then
    raise exception 'FAIL (F): only % code-universal coaching concepts — general coaching has been wrongly forked by code', v_count;
  end if;
  raise notice 'PASS (F): % coaching concepts are genuinely code-universal and exist once', v_count;

  -- ============ G. Union content exists ============
  if (select count(*) from public.hub_content_items where content_type = 'COACHING_CONCEPT' and rugby_code = 'union' and status = 'PUBLISHED') = 0 then
    raise exception 'FAIL (G): no Union-specific coaching concept exists';
  end if;
  raise notice 'PASS (G): Union-specific coaching content exists';

  -- ============ H. League content exists ============
  if (select count(*) from public.hub_content_items where content_type = 'COACHING_CONCEPT' and rugby_code = 'league' and status = 'PUBLISHED') = 0 then
    raise exception 'FAIL (H): no League-specific coaching concept exists — League is not first-class';
  end if;
  raise notice 'PASS (H): League-specific coaching content exists';

  -- ============ I. Aliases searchable ============
  if (select count(*) from public.hub_content_items
       where content_type = 'COACHING_CONCEPT' and content_key = 'designing-game-like-practice'
         and search_vector @@ websearch_to_tsquery('english', 'small sided games')) <> 1 then
    raise exception 'FAIL (I): a coaching concept alias does not reach the search vector';
  end if;
  raise notice 'PASS (I): coaching aliases are searchable';

  -- ============ J/K. Published public, draft hidden ============
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_test;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test) <> 1 then
    reset role; raise exception 'FAIL (J): a PUBLISHED coaching concept is not publicly readable';
  end if;
  reset role;
  raise notice 'PASS (J): published coaching content is publicly readable';
  update public.hub_content_items set status = 'DRAFT', published_by = null, published_at = null where id = v_test;
  set local role anon;
  if (select count(*) from public.hub_content_items where id = v_test) <> 0 then
    reset role; raise exception 'FAIL (K): an anonymous reader can see a DRAFT coaching concept';
  end if;
  reset role;
  raise notice 'PASS (K): draft coaching content is hidden from public readers';

  -- ============ L. Zero operational Training Centre dependency ============
  select string_agg(distinct ccu.table_name, ', ') into v_bad
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
   where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
     and tc.table_name in ('hub_content_items','hub_content_relationships','hub_skill_content_links','hub_regulatory_fact_references','hub_content_sources','hub_content_applicability')
     and ccu.table_name in ('training_sessions','training_plans','training_plan_schedule_rules','training_communications','player_fixture_attendance','fixture_attendance_invitations');
  if v_bad is not null then
    raise exception 'FAIL (L): the Hub content graph gained a foreign key into the operational Training Centre: %', v_bad;
  end if;
  raise notice 'PASS (L): Coaching Knowledge has zero foreign key into training sessions, plans, attendance or coach communications';

  -- ============ M. Zero player/profile/auth/team dependency ============
  select string_agg(distinct ccu.table_name, ', ') into v_bad
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
   where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
     and tc.table_name in ('hub_content_items','hub_content_relationships','hub_skill_content_links','hub_regulatory_fact_references','hub_content_sources')
     and ccu.table_name in ('players','profiles','guardians','player_guardians','teams','clubs','team_memberships','club_memberships','fixtures');
  if v_bad is not null then
    raise exception 'FAIL (M): the Hub content graph gained a foreign key into player, profile, team or club data: %', v_bad;
  end if;
  raise notice 'PASS (M): Coaching Knowledge has zero foreign key into players, profiles, teams, clubs or fixtures';

  -- ============ N. Skill links valid ============
  select count(*) into v_count
    from public.hub_skill_content_links l
    join public.hub_content_items c on c.id = l.content_item_id
   where c.content_type = 'COACHING_CONCEPT';
  if v_count = 0 then raise exception 'FAIL (N): no coaching concept links to a skill'; end if;
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_skill_content_links l
    join public.hub_content_items c on c.id = l.content_item_id
    join public.hub_skills s on s.id = l.skill_id
   where c.content_type = 'COACHING_CONCEPT' and s.status <> 'PUBLISHED';
  if v_bad is not null then raise exception 'FAIL (N2): coaching concepts link to unpublished skills: %', v_bad; end if;
  raise notice 'PASS (N): % coaching-to-skill links exist, all resolving to published skills', v_count;

  -- ============ O. Player Development links valid ============
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items c on c.id = r.content_item_id
    join public.hub_content_items t on t.id = r.related_content_item_id
   where c.content_type = 'COACHING_CONCEPT' and t.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
  if v_count < 5 then
    raise exception 'FAIL (O): only % coaching-to-development relationships — the most important graph in this domain is not real', v_count;
  end if;
  raise notice 'PASS (O): % coaching-to-player-development relationships exist', v_count;

  -- ============ P. Game Knowledge links valid ============
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items c on c.id = r.content_item_id
    join public.hub_content_items t on t.id = r.related_content_item_id
   where c.content_type = 'COACHING_CONCEPT' and t.content_type = 'GAME_CONCEPT';
  if v_count = 0 then raise exception 'FAIL (P): no coaching concept relates to Game Knowledge'; end if;
  raise notice 'PASS (P): % coaching-to-game-knowledge relationships exist', v_count;

  -- ============ Q. Rules references valid ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_regulatory_fact_references r
    join public.hub_content_items c on c.id = r.content_item_id
    join public.regulatory_facts f on f.id = r.regulatory_fact_id
   where c.content_type = 'COACHING_CONCEPT' and (r.reference_type <> 'RULE_EXPLANATION' or f.status <> 'VERIFIED');
  if v_bad is not null then raise exception 'FAIL (Q): a coaching concept cites a fact that is not a VERIFIED rule explanation: %', v_bad; end if;
  if (select count(*) from public.hub_regulatory_fact_references r join public.hub_content_items c on c.id = r.content_item_id where c.content_type = 'COACHING_CONCEPT') = 0 then
    raise exception 'FAIL (Q2): no coaching concept cites the governing body at all';
  end if;
  raise notice 'PASS (Q): every coaching Law citation is a RULE_EXPLANATION of a VERIFIED governing-body fact';

  -- ============ R. Officiating links valid ============
  select count(*) into v_count
    from public.hub_content_relationships r
    join public.hub_content_items c on c.id = r.content_item_id
    join public.hub_content_items t on t.id = r.related_content_item_id
   where c.content_type = 'COACHING_CONCEPT' and t.content_type = 'OFFICIATING_CONCEPT';
  if v_count = 0 then raise exception 'FAIL (R): no coaching concept relates to Officiating'; end if;
  raise notice 'PASS (R): % coaching-to-officiating relationships exist', v_count;

  -- ============ S. Position links deliberately deferred ============
  if (select count(*) from public.hub_content_item_positions p
       join public.hub_content_items c on c.id = p.content_item_id
      where c.content_type = 'COACHING_CONCEPT') <> 0 then
    raise exception 'FAIL (S): coaching concepts gained position links — these were deliberately deferred because nothing renders the position-to-content direction';
  end if;
  raise notice 'PASS (S): position links remain deliberately deferred, matching the current canonical mechanism';

  -- ============ T. Source coverage ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c
   where c.content_type = 'COACHING_CONCEPT' and c.status = 'PUBLISHED' and c.content_key not like 'hck-test-%'
     and not exists (select 1 from public.hub_content_sources s where s.content_item_id = c.id);
  if v_bad is not null then raise exception 'FAIL (T): coaching concepts exist with no source: %', v_bad; end if;
  raise notice 'PASS (T): every published coaching concept carries at least one source';

  -- ============ U. No duplicate Skills ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c join public.hub_skills s on s.skill_key = c.content_key
   where c.content_type = 'COACHING_CONCEPT';
  if v_bad is not null then raise exception 'FAIL (U): a coaching concept shares an identity with a skill: %', v_bad; end if;
  raise notice 'PASS (U): no coaching concept duplicates a skill identity';

  -- ============ V. No duplicate Player Development concepts ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c
    join public.hub_content_items d on d.content_key = c.content_key and d.content_type = 'PLAYER_DEVELOPMENT_CONCEPT'
   where c.content_type = 'COACHING_CONCEPT';
  if v_bad is not null then raise exception 'FAIL (V): a coaching concept shares a key with a Player Development concept: %', v_bad; end if;
  raise notice 'PASS (V): no coaching concept duplicates a Player Development concept';

  -- ============ W. No duplicate Game Knowledge concepts ============
  select string_agg(c.content_key, ', ') into v_bad
    from public.hub_content_items c
    join public.hub_content_items g on g.content_key = c.content_key and g.content_type = 'GAME_CONCEPT'
   where c.content_type = 'COACHING_CONCEPT';
  if v_bad is not null then raise exception 'FAIL (W): a coaching concept shares a key with a Game Knowledge concept: %', v_bad; end if;
  raise notice 'PASS (W): no coaching concept duplicates a Game Knowledge concept';

  -- ============ X/Y/Z. No new People, Clubs or Heritage ============
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_PERSON') <> 14 then
    raise exception 'FAIL (X): the People corpus changed — Coaching Knowledge must seed no People';
  end if;
  raise notice 'PASS (X): Coaching Knowledge seeded no new People';
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_TEAM' and team_type = 'CLUB_TEAM') <> 12 then
    raise exception 'FAIL (Y): the Famous Clubs corpus changed — Coaching Knowledge must seed no Clubs';
  end if;
  raise notice 'PASS (Y): Coaching Knowledge seeded no new Clubs';
  if (select count(*) from public.hub_content_heritage_links hl
       join public.hub_content_items c on c.id = hl.content_item_id
      where c.content_type = 'COACHING_CONCEPT') <> 0 then
    raise exception 'FAIL (Z): Coaching Knowledge manufactured Heritage links';
  end if;
  raise notice 'PASS (Z): Coaching Knowledge manufactured no Heritage';

  -- ============ AA. No assessment/rating fields ============
  select string_agg(column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'hub_content_items'
     and column_name ~ '(rating|score|assessment|competency|proficiency|percentile|rank|qualification|certification|badge|cpd)';
  if v_bad is not null then
    raise exception 'FAIL (AA): hub_content_items gained an assessment, rating or qualification column: %', v_bad;
  end if;
  raise notice 'PASS (AA): no assessment, rating, qualification or certification field exists on the content graph';

  -- ============ AB. No session/attendance fields ============
  select string_agg(column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'hub_content_items'
     and column_name ~ '(session_id|training_session|attendance|coach_id|team_id|player_id|club_id|plan_id|scheduled)';
  if v_bad is not null then
    raise exception 'FAIL (AB): hub_content_items gained an operational session or attendance column: %', v_bad;
  end if;
  raise notice 'PASS (AB): no session, attendance, coach, team or player column exists on the content graph';

  -- ============ AC. Search generic branch ============
  if (select count(*) from public.search_hub_content('designing game-like practice', 20)
       where result_type = 'CONTENT_ITEM' and title = 'Designing Game-Like Practice') <> 1 then
    raise exception 'FAIL (AC): search_hub_content does not return coaching concepts through its generic CONTENT_ITEM branch';
  end if;
  raise notice 'PASS (AC): coaching concepts are searchable through the unchanged generic search_hub_content';

  -- ============ AD. Recommendation compatibility ============
  declare
    v_identity uuid;
  begin
    select id into v_identity from public.regulatory_identities where rugby_code = 'union' limit 1;
    if v_identity is not null then
      if (select count(*) from public.get_hub_recommended_content(v_identity, 500)
           where result_id in (select id from public.hub_content_items where content_type = 'COACHING_CONCEPT' and rugby_code is null and status = 'PUBLISHED')) = 0 then
        raise exception 'FAIL (AD): universal coaching content does not reach recommendations';
      end if;
      if (select count(*) from public.get_hub_recommended_content(v_identity, 500)
           where result_id = (select id from public.hub_content_items where content_key = 'coaching-tackle-count-decisions' and content_type = 'COACHING_CONCEPT')) <> 0 then
        raise exception 'FAIL (AD2): League-only coaching content reached a Union identity through recommendations';
      end if;
      raise notice 'PASS (AD): recommendations carry universal coaching content and respect Union/League isolation, with no RPC change';
    else
      raise notice 'PASS (AD, skipped): no union regulatory identity exists to test against';
    end if;
  end;

  -- ============ AE (verified after rollback): QA cleanup zero ============
  raise notice 'PASS (AE, pending): wrapped in begin/rollback — verified externally by re-querying for hck-test-%% rows after this transaction rolls back';
end $$;

rollback;
