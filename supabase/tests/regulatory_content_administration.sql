-- Regulatory content administration (Rugby Hub Phase 2 real integration).
--
-- Proves the one thing Side Project 3's own docs flagged as unsafe to ship
-- as-is: every public.get_rugby_hub_* function derives rugby_code/
-- regulatory_identity_id server-side from a real, authorized relationship
-- to a team_id -- never accepts either as a client-supplied parameter.
-- Also proves the capability collapse (SP3's six regulatory_admins flags
-- -> Main's two site_admins columns) authorizes correctly, and that a
-- fresh schema with no content populated behaves honestly (empty, not
-- fabricated).
--
-- Self-contained/transactional: fresh gen_random_uuid() identities,
-- begin/rollback, no persistent fixture.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Regulatory content administration ==='

begin;

do $$
declare
  v_directory uuid;
  v_club uuid;
  v_team uuid;
  v_no_map_team uuid;
  v_u12_type uuid;
  v_u6_type uuid;

  v_coach uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
  v_site_admin uuid := gen_random_uuid();
  v_regulatory_admin uuid := gen_random_uuid();

  v_player uuid;
  v_identity_id uuid;
  v_no_map_identity_id uuid;
  v_source_id uuid;
  v_fact_id uuid;

  v_rugby_code text;
  v_mapping_type text;
  v_count int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_coach, 'rca-coach-' || v_coach::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian, 'rca-guardian-' || v_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated, 'rca-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_site_admin, 'rca-siteadmin-' || v_site_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_regulatory_admin, 'rca-regadmin-' || v_regulatory_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into site_admins (user_id, status, admin_role) values (v_site_admin, 'active', 'full');
  insert into site_admins (user_id, status, admin_role, view_regulatory_content, manage_regulatory_content) values (v_regulatory_admin, 'active', 'read_only', true, true);

  select id into v_directory from club_directory cd where cd.rugby_code='union' and not exists (select 1 from clubs c where c.directory_id = cd.id) order by cd.id limit 1;
  insert into clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory, 'rca-test-club-' || gen_random_uuid()::text, 'active') returning id into v_club;
  insert into club_memberships (user_id, club_id, role, status) values (v_coach, v_club, 'CLUB_ADMIN', 'active');

  select id into v_u12_type from canonical_team_types where key = 'girls_u12';
  select id into v_u6_type from canonical_team_types where category='youth' and age_group='U6' and gender='mixed' limit 1;

  insert into teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, canonical_team_type_id)
  values (gen_random_uuid(), v_club, 'union', 'youth', 'U12', 'girls', 'RCA Test Girls U12', 'rca-test-girls-u12-' || gen_random_uuid()::text, v_u12_type)
  returning id into v_team;

  insert into players (id, first_name, surname, date_of_birth) values (gen_random_uuid(), 'RCA', 'Player', current_date - interval '11 years') returning id into v_player;
  insert into player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');
  insert into guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_player, 'guardian', 'active');

  insert into regulatory_authorities (code, name, rugby_code) values ('RFU', 'Rugby Football Union', 'union') on conflict (code) do nothing;
  insert into regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id)
  values ('union', 'RFU-GIRLS-U12-RCA', 'RFU Girls Union, Under 12', 'DIRECT', v_u12_type)
  returning id into v_identity_id;

  if v_u6_type is not null then
    insert into teams (id, club_id, rugby_code, category, age_group, display_name, slug, canonical_team_type_id)
    values (gen_random_uuid(), v_club, 'union', 'youth', 'U6', 'RCA Test Mixed U6', 'rca-test-mixed-u6-' || gen_random_uuid()::text, v_u6_type)
    returning id into v_no_map_team;

    insert into regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id, mapping_notes)
    values ('union', 'RFU-U6-RCA', 'RFU Under 6', 'NO_DIRECT_MAPPING', v_u6_type, 'Outside RFU Regulation 11''s own U7-U18 scope.')
    returning id into v_no_map_identity_id;
  end if;

  -- ===================================================================
  -- A. Real team relationship resolves the real mapped identity server-side
  -- ===================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
  select rugby_code, mapping_type into v_rugby_code, v_mapping_type from get_rugby_hub_identity_context(v_team);
  if v_rugby_code = 'union' and v_mapping_type = 'DIRECT' then
    raise notice 'PASS A: staff relationship resolves the real, server-derived identity';
  else
    raise notice 'FAIL A: got rugby_code=%, mapping_type=%', v_rugby_code, v_mapping_type;
  end if;

  -- B. A guardian of a player on the team also resolves it
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role', 'authenticated')::text, true);
  select rugby_code into v_rugby_code from get_rugby_hub_identity_context(v_team);
  if v_rugby_code = 'union' then raise notice 'PASS B: guardian of a linked player also resolves the team''s real identity'; else raise notice 'FAIL B: got %', v_rugby_code; end if;

  -- C. An unrelated authenticated user is denied outright -- never a raw rugby_code/identity parameter accepted from them
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  begin
    perform * from get_rugby_hub_identity_context(v_team);
    raise notice 'FAIL C: unrelated user was not denied';
  exception when others then
    if sqlerrm like '%not authorized%' then raise notice 'PASS C: unrelated user denied with the real authorization error'; else raise notice 'FAIL C: wrong error: %', sqlerrm; end if;
  end;

  -- D. NO_DIRECT_MAPPING is a real, distinct state -- never conflated with "no content yet"
  if v_no_map_team is not null then
    reset role; set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
    select mapping_type into v_mapping_type from get_rugby_hub_identity_context(v_no_map_team);
    if v_mapping_type = 'NO_DIRECT_MAPPING' then raise notice 'PASS D: a genuinely unmapped age band resolves NO_DIRECT_MAPPING honestly'; else raise notice 'FAIL D: got %', v_mapping_type; end if;

    -- E. Rules resolver returns nothing for a NO_DIRECT_MAPPING identity, without erroring
    if (select count(*) from get_rugby_hub_rules(v_no_map_team)) = 0 then
      raise notice 'PASS E: rules resolver returns empty for NO_DIRECT_MAPPING, never an error or fabricated content';
    else
      raise notice 'FAIL E: rules resolver returned rows for a NO_DIRECT_MAPPING identity';
    end if;
  else
    raise notice 'SKIP D/E: no U6 mixed canonical_team_type seeded in this environment';
  end if;

  -- F. No content exists anywhere yet (Phase 2 is schema-only) -- every resolver is honestly empty, not fabricated
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
  if (select count(*) from get_rugby_hub_rules(v_team)) = 0
     and (select count(*) from get_rugby_hub_safeguarding_content(v_team)) = 0
     and (select count(*) from get_rugby_hub_safeguarding_routes(v_team)) = 0
     and (select count(*) from get_rugby_hub_welfare(v_team)) = 0 then
    raise notice 'PASS F: every Rugby Hub resolver is honestly empty -- no fabricated content in a fresh schema';
  else
    raise notice 'FAIL F: a resolver returned rows despite no content ever being published';
  end if;

  -- ===================================================================
  -- G-J. Admin RPC authorization: manage_regulatory_content required
  -- ===================================================================
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  begin
    perform create_regulatory_source('rca-src-' || gen_random_uuid()::text, (select id from regulatory_authorities where code='RFU'), 'union', 'Test Source', 'REGULATION', 'PRIMARY_REGULATION', 'https://example.test', current_date);
    raise notice 'FAIL G: an ordinary authenticated user created a regulatory source';
  exception when others then
    raise notice 'PASS G: an ordinary authenticated user cannot create a regulatory source';
  end;

  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_regulatory_admin::text, 'role', 'authenticated')::text, true);
  select create_regulatory_source('rca-src-' || gen_random_uuid()::text, (select id from regulatory_authorities where code='RFU'), 'union', 'Test Source', 'REGULATION', 'PRIMARY_REGULATION', 'https://example.test', current_date) into v_source_id;
  update regulatory_sources set review_state = 'VERIFIED_CURRENT' where id = v_source_id;
  if v_source_id is not null then raise notice 'PASS H: a Site Admin with manage_regulatory_content can create a regulatory source'; else raise notice 'FAIL H'; end if;

  select create_regulatory_fact('rca-fact-' || gen_random_uuid()::text, 'PLAYER_COUNT', 'RULES', 'union', 'INTEGER', p_value_integer := 11) into v_fact_id;
  perform add_fact_citation(v_fact_id, v_source_id, 'PRIMARY');
  perform verify_regulatory_fact(v_fact_id);
  select count(*) into v_count from regulatory_facts where id = v_fact_id and status = 'VERIFIED';
  if v_count = 1 then raise notice 'PASS I: the full source->fact->citation->verify pipeline works end to end for an authorized regulatory admin'; else raise notice 'FAIL I'; end if;

  -- J. Full Site Admin bypasses the granular grant entirely, matching every other site domain
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);
  begin
    perform create_regulatory_source('rca-src-' || gen_random_uuid()::text, (select id from regulatory_authorities where code='RFU'), 'union', 'Test Source 2', 'REGULATION', 'PRIMARY_REGULATION', 'https://example.test', current_date);
    raise notice 'PASS J: a Full Site Admin can manage regulatory content without an explicit per-domain grant';
  exception when others then
    raise notice 'FAIL J: Full Site Admin was denied: %', sqlerrm;
  end;

  reset role;
end $$;

rollback;
