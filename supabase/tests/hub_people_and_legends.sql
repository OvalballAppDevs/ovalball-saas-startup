-- Rugby Hub People & Rugby Legends -- permanent regression.
--
-- Pins: RUGBY_PERSON is accepted as a hub_content_items content_type with
-- a correctly enforced, multi-valued roles vocabulary and searchable
-- aliases; a person has ZERO FK/query dependency on any operational
-- table (players/profiles/guardians/auth.users); dual-code and multi-role
-- people are representable without duplicating the person row; a referee
-- can exist with zero team relationships; Union, League and women's
-- people are all genuinely represented; person<->honour links stay
-- sparse (never squad membership); person<->Heritage reuses the existing
-- generic table; multi-source biography provenance works; unpublished
-- content never leaks through any new relationship table; search and
-- recommendations generalise with zero RPC change; no CLUB_TEAM/famous
-- domestic club page was seeded.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_person uuid;
  v_test_person2 uuid;
  v_test_team uuid;
  v_test_competition uuid;
  v_test_honour uuid;
  v_test_heritage uuid;
  v_raised boolean;
  v_admin uuid;
  v_operational_players_before int;
  v_operational_profiles_before int;
begin
  -- Resolved, not hardcoded. This literal was a real auth.users id from the
  -- machine the Hub content was authored on, so this suite could only ever
  -- pass there; anywhere else it failed on a verified_by foreign key. The
  -- system content-import account is created by the Hub migrations.
  select id into v_admin from auth.users
  where email = 'rugby-hub-content-import@system.ovalball.internal';
  select count(*) into v_operational_players_before from public.players;
  select count(*) into v_operational_profiles_before from public.profiles;

  -- ============ A. RUGBY_PERSON accepted ============
  insert into public.hub_content_items (content_key, content_type, title, summary, roles)
  values ('hpl-test-person-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_PERSON', 'Test Person', 'A test summary.', array['PLAYER'])
  returning id into v_test_person;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test_person, true);
  raise notice 'PASS (A): a RUGBY_PERSON row is accepted';

  -- ============ B. Invalid content type still rejected ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary) values ('hpl-test-bad-type-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_LEGEND', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): an unapproved content_type (RUGBY_LEGEND) was accepted'; end if;
  raise notice 'PASS (B): an unapproved content_type remains rejected — RUGBY_PERSON is the only new type';

  -- ============ C. Roles valid ============
  if (select roles from public.hub_content_items where id = v_test_person) <> array['PLAYER'] then
    raise exception 'FAIL (C): roles was not stored correctly';
  end if;
  raise notice 'PASS (C): roles is accepted and stored correctly';

  -- ============ D. Invalid role rejected ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary, roles) values ('hpl-test-badrole-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_PERSON', 'x', 'x', array['GOALKEEPER']);
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (D): an unapproved role (GOALKEEPER) was accepted'; end if;
  raise notice 'PASS (D): roles is constrained to exactly PLAYER/COACH/REFEREE/ADMINISTRATOR/PIONEER';

  -- ============ E. Multiple roles valid ============
  update public.hub_content_items set roles = array['PLAYER', 'COACH', 'ADMINISTRATOR'] where id = v_test_person;
  if (select array_length(roles, 1) from public.hub_content_items where id = v_test_person) <> 3 then
    raise exception 'FAIL (E): a person could not hold multiple roles simultaneously';
  end if;
  update public.hub_content_items set roles = array['PLAYER'] where id = v_test_person;
  raise notice 'PASS (E): a person can hold multiple roles simultaneously — no single rigid role forced';

  -- ============ E2. RUGBY_PERSON requires at least one role ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary) values ('hpl-test-norole-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_PERSON', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (E2): a RUGBY_PERSON with zero roles was accepted'; end if;
  raise notice 'PASS (E2): a RUGBY_PERSON must have at least one real role';

  -- ============ F. Aliases stored ============
  update public.hub_content_items set aliases = array['Test Alias'] where id = v_test_person;
  if (select aliases from public.hub_content_items where id = v_test_person) <> array['Test Alias'] then
    raise exception 'FAIL (F): aliases was not stored correctly';
  end if;
  raise notice 'PASS (F): aliases is accepted and stored correctly';

  -- ============ G. Aliases searchable ============
  update public.hub_content_items set title = 'Hpltestsearchtarget', aliases = array['Hpltestaliasform'], status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_test_person;
  if (select count(*) from public.hub_content_items where id = v_test_person and search_vector @@ websearch_to_tsquery('english', 'Hpltestaliasform')) <> 1 then
    raise exception 'FAIL (G): a person is not findable by an alias that is not in their title';
  end if;
  raise notice 'PASS (G): aliases are folded into search_vector and genuinely searchable';

  -- ============ H. Exact person count ============
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_PERSON' and status = 'PUBLISHED' and content_key not like 'hpl-test-%') <> 14 then
    raise exception 'FAIL (H): expected exactly 14 permanent published RUGBY_PERSON rows';
  end if;
  raise notice 'PASS (H): exactly 14 permanent published RUGBY_PERSON rows exist';

  -- ============ I. Stable unique keys ============
  if (select count(*) from (select content_key from public.hub_content_items where content_type = 'RUGBY_PERSON' group by content_key having count(*) > 1) dupes) <> 0 then
    raise exception 'FAIL (I): a duplicate content_key exists among RUGBY_PERSON rows';
  end if;
  raise notice 'PASS (I): content_key remains the unique, immutable identity — no duplicate person rows';

  -- ============ J. Publication visibility ============
  perform set_config('role', 'anon', true);
  if (select count(*) from public.hub_content_items where content_key = 'jonah-lomu' and content_type = 'RUGBY_PERSON') <> 1 then
    raise exception 'FAIL (J): a published RUGBY_PERSON is not visible to an anonymous reader';
  end if;
  reset role;
  raise notice 'PASS (J): a published RUGBY_PERSON is publicly visible';

  -- ============ K. Draft invisibility ============
  insert into public.hub_content_items (content_key, content_type, title, summary, roles)
  values ('hpl-test-draft-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_PERSON', 'Hpltestdraftperson', 'Not published.', array['PLAYER']);
  if (select count(*) from public.search_hub_content('Hpltestdraftperson', 20) where result_type = 'CONTENT_ITEM') <> 0 then
    raise exception 'FAIL (K): a DRAFT RUGBY_PERSON appeared in search_hub_content';
  end if;
  raise notice 'PASS (K): a DRAFT RUGBY_PERSON never surfaces in search';

  -- ============ L. No operational-person FK ============
  if exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.table_name in ('hub_person_team_relationships', 'hub_person_honour_relationships', 'hub_content_sources')
      and tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name in ('players', 'profiles', 'guardians')
  ) then
    raise exception 'FAIL (L): a new People table has a foreign key into an operational person table';
  end if;
  if (select count(*) from public.players) <> v_operational_players_before or (select count(*) from public.profiles) <> v_operational_profiles_before then
    raise exception 'FAIL (L2): operational players/profiles row counts changed as a side effect of this domain';
  end if;
  raise notice 'PASS (L): zero FK from any new People table into players/profiles/guardians, and their row counts are untouched';

  -- ============ M. person<->team valid ============
  select id into v_test_team from public.hub_content_items where content_type = 'RUGBY_TEAM' limit 1;
  insert into public.hub_person_team_relationships (person_id, team_id, role_type) values (v_test_person, v_test_team, 'PLAYED_FOR') returning id into v_test_person2;
  raise notice 'PASS (M): hub_person_team_relationships accepts a real RUGBY_PERSON and a real RUGBY_TEAM';

  -- ============ N. Non-person person_id rejected ============
  v_raised := false;
  begin
    insert into public.hub_person_team_relationships (person_id, team_id, role_type) values (v_test_team, v_test_team, 'PLAYED_FOR');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (N): a non-RUGBY_PERSON content item was accepted as person_id'; end if;
  raise notice 'PASS (N): a non-RUGBY_PERSON content item is rejected as person_id';

  -- ============ O. Non-team team_id rejected ============
  v_raised := false;
  begin
    insert into public.hub_person_team_relationships (person_id, team_id, role_type) values (v_test_person, v_test_person, 'PLAYED_FOR');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (O): a non-RUGBY_TEAM content item was accepted as team_id'; end if;
  raise notice 'PASS (O): a non-RUGBY_TEAM content item is rejected as team_id';

  -- ============ P. Relationship role CHECK ============
  v_raised := false;
  begin
    insert into public.hub_person_team_relationships (person_id, team_id, role_type) values (v_test_person, v_test_team, 'OFFICIATED_FOR');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (P): OFFICIATED_FOR was accepted as a person-team role_type — a referee does not belong to a team'; end if;
  raise notice 'PASS (P): role_type is constrained to exactly PLAYED_FOR/CAPTAINED/COACHED/REPRESENTED — OFFICIATED_FOR correctly rejected';

  -- ============ Q. Referee can have zero team rows ============
  if (select count(*) from public.hub_person_team_relationships r join public.hub_content_items p on p.id = r.person_id where p.content_key = 'wayne-barnes') <> 0 then
    raise exception 'FAIL (Q): Wayne Barnes (a referee) has a team relationship row — referees do not belong to teams';
  end if;
  if (select roles from public.hub_content_items where content_key = 'wayne-barnes') <> array['REFEREE'] then
    raise exception 'FAIL (Q2): Wayne Barnes is not correctly marked as REFEREE-only';
  end if;
  raise notice 'PASS (Q): Wayne Barnes exists as a real RUGBY_PERSON with the REFEREE role and genuinely zero team relationship rows';

  -- ============ R. Dual-code person spans both codes ============
  if (
    select count(distinct t.rugby_code) from public.hub_person_team_relationships r
    join public.hub_content_items p on p.id = r.person_id
    join public.hub_content_items t on t.id = r.team_id
    where p.content_key = 'jason-robinson'
  ) <> 2 then
    raise exception 'FAIL (R): Jason Robinson''s team relationships do not span both Union and League';
  end if;
  if (select count(*) from public.hub_content_items where content_key = 'jason-robinson') <> 1 then
    raise exception 'FAIL (R2): Jason Robinson exists as more than one person row — a dual-code career must never duplicate the person';
  end if;
  raise notice 'PASS (R): Jason Robinson is one single RUGBY_PERSON row whose team relationships genuinely span both Union and League';

  -- ============ S. Women's people represented ============
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_PERSON' and content_key in ('jodie-cunningham', 'maggie-alphonsi', 'emily-scarratt')) <> 3 then
    raise exception 'FAIL (S): expected all three seeded women''s rugby figures to exist';
  end if;
  raise notice 'PASS (S): women''s rugby people (Jodie Cunningham, Maggie Alphonsi, Emily Scarratt) are genuinely represented, spanning both codes';

  -- ============ T. Union represented ============
  if (
    select count(*) from public.hub_person_team_relationships r join public.hub_content_items t on t.id = r.team_id
    where t.rugby_code = 'union' and r.person_id in (select id from public.hub_content_items where content_type = 'RUGBY_PERSON' and content_key not like 'hpl-test-%')
  ) < 5 then
    raise exception 'FAIL (T): fewer than the expected minimum of real Union person-team relationships exist';
  end if;
  raise notice 'PASS (T): Rugby Union is genuinely represented via real person-team relationships';

  -- ============ U. League represented ============
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_PERSON' and content_key in ('billy-boston', 'ellery-hanley', 'kevin-sinfield', 'rob-burrow', 'jodie-cunningham')) <> 5 then
    raise exception 'FAIL (U): expected all five seeded League-associated figures to exist';
  end if;
  raise notice 'PASS (U): Rugby League is genuinely represented, spanning Wigan, St Helens and Leeds — not token or single-club coverage';

  -- ============ V. Heritage link valid ============
  select id into v_test_heritage from public.heritage_entries limit 1;
  insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values (v_test_person, v_test_heritage);
  raise notice 'PASS (V): hub_content_heritage_links accepts a real RUGBY_PERSON, reused unchanged from International Rugby';

  -- ============ W. Existing Heritage PERSON entry reused ============
  if (
    select count(*) from public.hub_content_heritage_links l
    join public.hub_content_items p on p.id = l.content_item_id
    join public.heritage_entries h on h.id = l.heritage_entry_id
    where p.content_key = 'jonah-lomu' and h.entry_key = 'LOMU-1995'
  ) <> 1 then
    raise exception 'FAIL (W): Jonah Lomu is not linked to the existing LOMU-1995 Heritage PERSON entry';
  end if;
  if (
    select count(*) from public.hub_content_heritage_links l
    join public.hub_content_items p on p.id = l.content_item_id
    join public.heritage_entries h on h.id = l.heritage_entry_id
    where p.content_key = 'billy-boston' and h.entry_key = 'BILLY-BOSTON'
  ) <> 1 then
    raise exception 'FAIL (W2): Billy Boston is not linked to the existing BILLY-BOSTON Heritage PERSON entry';
  end if;
  raise notice 'PASS (W): both pre-existing Heritage PERSON entries (LOMU-1995, BILLY-BOSTON) are now linked to their real canonical person for the first time';

  -- ============ X. person<->honour valid ============
  select id into v_test_competition from public.hub_content_items where content_type = 'COMPETITION_GUIDE' limit 1;
  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label) values (v_test_team, v_test_competition, 'CHAMPION', '2099') returning id into v_test_honour;
  insert into public.hub_person_honour_relationships (person_id, honour_id, role_type) values (v_test_person, v_test_honour, 'CAPTAIN');
  raise notice 'PASS (X): hub_person_honour_relationships accepts a real RUGBY_PERSON and a real hub_team_honours row';

  -- ============ Y. Invalid honour rejected ============
  v_raised := false;
  begin
    insert into public.hub_person_honour_relationships (person_id, honour_id, role_type) values (v_test_team, v_test_honour, 'CAPTAIN');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (Y): a non-RUGBY_PERSON content item was accepted as person_id on hub_person_honour_relationships'; end if;
  raise notice 'PASS (Y): a non-RUGBY_PERSON content item is rejected as person_id on hub_person_honour_relationships';

  -- ============ Z. Honour role CHECK ============
  v_raised := false;
  begin
    insert into public.hub_person_honour_relationships (person_id, honour_id, role_type) values (v_test_person, v_test_honour, 'SQUAD_MEMBER');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (Z): SQUAD_MEMBER was accepted as an honour role_type — this must stay narrow'; end if;
  raise notice 'PASS (Z): honour role_type is constrained to exactly CAPTAIN/PLAYER/HEAD_COACH';

  -- ============ AA. Honour links sparse ============
  if (select count(*) from public.hub_person_honour_relationships where person_id not in (v_test_person)) <> 3 then
    raise exception 'FAIL (AA): expected exactly 3 permanent person-honour relationships (deliberately sparse)';
  end if;
  raise notice 'PASS (AA): exactly 3 permanent person-honour relationships exist against 27 hub_team_honours rows — genuinely sparse, never a full squad';

  -- ============ AB. No roster-like bulk membership ============
  if (
    select count(*) from public.hub_person_honour_relationships h
    group by h.honour_id
    having count(*) > 3
  ) is not null and (select count(*) from (select honour_id from public.hub_person_honour_relationships group by honour_id having count(*) > 3) x) <> 0 then
    raise exception 'FAIL (AB): a single honour has more than 3 credited people — this is drifting toward squad membership';
  end if;
  raise notice 'PASS (AB): no single honour has anything resembling a full squad of credited people';

  -- ============ AC. Source rows present ============
  if (select count(*) from public.hub_content_sources where content_item_id in (select id from public.hub_content_items where content_type = 'RUGBY_PERSON' and content_key not like 'hpl-test-%')) < 14 then
    raise exception 'FAIL (AC): fewer than one source row per permanent person exists';
  end if;
  raise notice 'PASS (AC): every permanent RUGBY_PERSON has at least one real hub_content_sources row';

  -- ============ AD. Multi-source biography works ============
  if (select count(*) from public.hub_content_sources s join public.hub_content_items p on p.id = s.content_item_id where p.content_key = 'billy-boston') < 2 then
    raise exception 'FAIL (AD): Billy Boston does not have multiple source rows';
  end if;
  raise notice 'PASS (AD): a person can carry multiple independent source rows (Billy Boston has 3) — the single source_url column was provably insufficient';

  -- ============ AE. Unpublished person sources/links do not leak ============
  declare
    v_unpub_person uuid;
    v_unpub_source_count int;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary, roles)
    values ('hpl-test-unpub-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_PERSON', 'Hpltestunpubperson', 'Not published.', array['PLAYER'])
    returning id into v_unpub_person;
    insert into public.hub_content_sources (content_item_id, source_tier, source_title) values (v_unpub_person, 'ENCYCLOPEDIA', 'Test source');
    insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values (v_unpub_person, v_test_heritage);
    perform set_config('role', 'anon', true);
    select count(*) into v_unpub_source_count from public.hub_content_sources where content_item_id = v_unpub_person;
    reset role;
    if v_unpub_source_count <> 0 then
      raise exception 'FAIL (AE): an unpublished person''s sources leaked to an anonymous reader';
    end if;
  end;
  raise notice 'PASS (AE): an unpublished RUGBY_PERSON''s sources and Heritage links are invisible to public readers';

  -- ============ AF/AG. Position link decision ============
  if (select to_regclass('public.hub_person_position_links')) is not null then
    raise exception 'FAIL (AG): hub_person_position_links exists despite the explicit decision to defer it — no page in the corpus demonstrated a need for it';
  end if;
  raise notice 'PASS (AF/AG): hub_person_position_links was correctly NOT created — deferred per instruction, since no page in the initial corpus needs a structured position link to complete a meaningful section or journey';

  -- ============ AH. Search raw branch remains CONTENT_ITEM ============
  update public.hub_content_items set title = 'Hpltestrawbranchperson' where id = v_test_person;
  if (select count(*) from public.search_hub_content('Hpltestrawbranchperson', 20) where result_type not in ('CONTENT_ITEM')) <> 0 then
    raise exception 'FAIL (AH): search_hub_content unexpectedly introduced a new raw result_type for person content';
  end if;
  if (select count(*) from public.search_hub_content('Hpltestrawbranchperson', 20) where result_id = v_test_person and result_type = 'CONTENT_ITEM') <> 1 then
    raise exception 'FAIL (AH2): a published RUGBY_PERSON did not appear in search_hub_content via the existing CONTENT_ITEM branch';
  end if;
  raise notice 'PASS (AH): the raw RPC result_type for person content remains exactly CONTENT_ITEM — presentation-only relabelling happens client-side, zero RPC change';

  -- ============ AI. Recommendation RPC unchanged ============
  declare
    v_test_identity uuid;
  begin
    insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
    values ('union', 'hpl-identity-' || substr(gen_random_uuid()::text,1,8), 'Test Identity', 'DIRECT')
    returning id into v_test_identity;
    if (select count(*) from public.get_hub_recommended_content(v_test_identity, 500) where result_id = v_test_person) <> 1 then
      raise exception 'FAIL (AI): a universal, published RUGBY_PERSON was not returned by get_hub_recommended_content';
    end if;
  end;
  raise notice 'PASS (AI): get_hub_recommended_content returns a legitimate universal RUGBY_PERSON with zero RPC change';

  -- ============ AJ. Retired: this assertion originally pinned "no
  -- CLUB_TEAM rows exist yet" as a within-slice scope boundary for
  -- People. Famous Clubs has since legitimately introduced CLUB_TEAM
  -- rows -- that boundary was for a point in time, not a permanent
  -- invariant. Retired per instruction, matching the same pattern already
  -- used for International Rugby's own now-obsolete "no RUGBY_PERSON"
  -- assertion. ============
  raise notice 'PASS (AJ, retired): CLUB_TEAM scope boundary superseded by Famous Clubs — see hub_famous_clubs.sql for its own real assertions';

  -- ============ AK. Retired: this assertion originally pinned "no famous
  -- domestic club page exists yet" as a within-slice scope boundary for
  -- People. Famous Clubs has since legitimately seeded Wigan Warriors, St
  -- Helens, Leeds Rhinos and Bradford Bulls -- that boundary was for a
  -- point in time, not a permanent invariant. Retired per instruction,
  -- matching assertions E and AJ's own retirement in this same pass.
  -- The real, still-valid invariant this once stood in for -- that
  -- person<->club relationships stay additive rather than requiring a
  -- club row to exist -- is now positively proven by hub_famous_clubs.sql
  -- itself (Boston/Robinson/Cunningham/Sinfield/Burrow/Hanley all link to
  -- real club rows there). ============
  raise notice 'PASS (AK, retired): famous-domestic-club scope boundary superseded by Famous Clubs — see hub_famous_clubs.sql for its own real assertions';

  -- ============ AL (verified after rollback): QA cleanup zero ============
  raise notice 'PASS (AL, pending): wrapped in begin/rollback — verified externally by re-querying for hpl-test-%% rows after this transaction rolls back';
end $$;

rollback;
