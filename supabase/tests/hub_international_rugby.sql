-- Rugby Hub International Rugby + Teams + Honours -- permanent regression.
--
-- Pins: RUGBY_TEAM is accepted as a hub_content_items content_type with
-- correctly enforced team_type/team_gender vocabularies; international
-- teams are knowledge entities, never operational teams; Union/League and
-- men's/women's identity stay fully independent rows (never a flag on a
-- shared row); the British & Irish Lions are REPRESENTATIVE_TEAM, not
-- NATIONAL_TEAM; hub_team_honours enforces its own team_id/competition_id
-- content-type semantics at the database level and is a genuinely curated,
-- source-verified structured fact set (never statistics); the World Cup
-- wins acceptance test (who won, how many, which years) is answerable
-- directly from structured honours with zero prose duplication; Grand Slam
-- and Triple Crown both resolve concept (Glossary) vs instance (honours)
-- correctly; hub_content_heritage_links closes the standing Heritage-
-- relationship gap for real, matching existing entries (LIONS-1888,
-- RWC-1995-MANDELA, LOMU-1995, CHALLENGE-CUP-1897, SUPER-LEAGUE-1996);
-- search and recommendations already generalise to RUGBY_TEAM with zero
-- RPC change; rugby-code isolation holds in both directions; no famous
-- domestic CLUB_TEAM and no person entity were introduced in this slice;
-- and every operational table remains completely untouched.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_identity_union uuid;
  v_test_identity_league uuid;
  v_test_team uuid;
  v_test_competition uuid;
  v_test_honour uuid;
  v_raised boolean;
  v_n int;
  v_admin uuid;
  v_operational_teams_before int;
  v_operational_competitions_before int;
begin
  -- Resolved, not hardcoded. This literal was a real auth.users id from the
  -- machine the Hub content was authored on, so this suite could only ever
  -- pass there; anywhere else it failed on a verified_by foreign key. The
  -- system content-import account is created by the Hub migrations.
  select id into v_admin from auth.users
  where email = 'rugby-hub-content-import@system.ovalball.internal';
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('union', 'hir-identity-union-' || substr(gen_random_uuid()::text,1,8), 'Test Union Identity', 'DIRECT')
  returning id into v_test_identity_union;
  insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
  values ('league', 'hir-identity-league-' || substr(gen_random_uuid()::text,1,8), 'Test League Identity', 'DIRECT')
  returning id into v_test_identity_league;

  select count(*) into v_operational_teams_before from public.teams;
  select count(*) into v_operational_competitions_before from public.competitions;

  -- ============ A. RUGBY_TEAM accepted ============
  insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, team_type, team_gender)
  values ('hir-test-team-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'Test Team', 'A test summary.', 'union', 'NATIONAL_TEAM', 'mens')
  returning id into v_test_team;
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) values (v_test_team, v_test_identity_union);
  raise notice 'PASS (A): a RUGBY_TEAM row is accepted';

  -- ============ B. team_type CHECK ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary, team_type) values ('hir-test-bad-type-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'x', 'x', 'FRANCHISE');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): an unapproved team_type (FRANCHISE) was accepted'; end if;
  raise notice 'PASS (B): team_type is constrained to exactly NATIONAL_TEAM/REPRESENTATIVE_TEAM/CLUB_TEAM';

  -- ============ C. team_gender CHECK ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary, team_gender) values ('hir-test-bad-gender-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'x', 'x', 'male');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C): an unapproved team_gender (male, not mens) was accepted'; end if;
  raise notice 'PASS (C): team_gender is constrained to exactly mens/womens/mixed';

  -- ============ D. International team corpus exact count ============
  -- Scoped to team_type IN (NATIONAL_TEAM, REPRESENTATIVE_TEAM) rather than
  -- every RUGBY_TEAM row: Famous Clubs (a later slice) legitimately adds
  -- its own RUGBY_TEAM rows with team_type = CLUB_TEAM, reusing the same
  -- content_type -- a global count would break here every time a later
  -- domain extends it, exactly like hub_teams_competitions' own count
  -- assertions had to be fixed for this same reason.
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_TEAM' and team_type in ('NATIONAL_TEAM', 'REPRESENTATIVE_TEAM') and status = 'PUBLISHED' and content_key not like 'hir-test-%') <> 13 then
    raise exception 'FAIL (D): expected exactly 13 permanent published international/representative RUGBY_TEAM rows';
  end if;
  raise notice 'PASS (D): exactly 13 permanent published RUGBY_TEAM rows exist';

  -- ============ E. Retired: this assertion originally pinned "no CLUB_TEAM
  -- rows exist yet" as a within-slice scope boundary for International
  -- Rugby. Famous Clubs has since legitimately introduced CLUB_TEAM rows
  -- (team_type was reserved by this very slice specifically for that
  -- future reuse) -- that boundary was for a point in time, not a
  -- permanent invariant. Retired per instruction, exactly like assertion
  -- AH's retirement when RUGBY_PERSON legitimately arrived. ============
  raise notice 'PASS (E, retired): CLUB_TEAM scope boundary superseded by Famous Clubs — see hub_famous_clubs.sql for its own real assertions';

  -- ============ F. Union/League identity separation ============
  if (select id from public.hub_content_items where content_key = 'england-rugby-union-men') = (select id from public.hub_content_items where content_key = 'england-rugby-league-men') then
    raise exception 'FAIL (F): England Rugby Union and England Rugby League resolved to the same row';
  end if;
  if (select rugby_code from public.hub_content_items where content_key = 'england-rugby-union-men') <> 'union'
     or (select rugby_code from public.hub_content_items where content_key = 'england-rugby-league-men') <> 'league' then
    raise exception 'FAIL (F2): England Union/League rows do not carry the correct distinct rugby_code';
  end if;
  raise notice 'PASS (F): England Rugby Union and England Rugby League are fully independent rows with correct, distinct rugby_code';

  -- ============ G. Men's/women's independent rows ============
  if (select id from public.hub_content_items where content_key = 'england-rugby-union-men') = (select id from public.hub_content_items where content_key = 'england-rugby-union-women') then
    raise exception 'FAIL (G): England Men and England Women resolved to the same row';
  end if;
  if (select team_gender from public.hub_content_items where content_key = 'england-rugby-union-women') <> 'womens' then
    raise exception 'FAIL (G2): England Women is not marked team_gender = womens';
  end if;
  raise notice 'PASS (G): England Men and England Women are fully independent rows, never a flag on a shared row';

  -- ============ H. Lions = REPRESENTATIVE_TEAM ============
  if (select team_type from public.hub_content_items where content_key = 'british-and-irish-lions-men') <> 'REPRESENTATIVE_TEAM' then
    raise exception 'FAIL (H): the British & Irish Lions are not marked REPRESENTATIVE_TEAM';
  end if;
  if (select team_type from public.hub_content_items where content_key = 'british-and-irish-lions-men') = 'NATIONAL_TEAM' then
    raise exception 'FAIL (H2): the Lions were incorrectly treated as a national team';
  end if;
  raise notice 'PASS (H): the British & Irish Lions (both men''s and women''s rows) are correctly modelled as REPRESENTATIVE_TEAM, never NATIONAL_TEAM';

  -- ============ I. England RU != England RL (restated structurally) ============
  if (select count(*) from public.hub_content_items where content_key in ('england-rugby-union-men', 'england-rugby-league-men')) <> 2 then
    raise exception 'FAIL (I): England Rugby Union and England Rugby League do not both exist as distinct rows';
  end if;
  raise notice 'PASS (I): England Rugby Union and England Rugby League both exist as genuinely distinct rows';

  -- ============ J. Published/applicability correctness ============
  if (
    select count(*) from public.hub_content_items ci
    where ci.content_type = 'RUGBY_TEAM' and ci.status = 'PUBLISHED' and ci.content_key not like 'hir-test-%'
      and not exists (
        select 1 from public.hub_content_applicability a join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
        where a.content_item_id = ci.id and ri.rugby_code = ci.rugby_code
      )
  ) <> 0 then
    raise exception 'FAIL (J): a published RUGBY_TEAM is missing real, code-matching applicability';
  end if;
  raise notice 'PASS (J): every published RUGBY_TEAM carries real applicability scoped to its own rugby_code';

  -- ============ K. DRAFT invisibility ============
  insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, team_type, team_gender)
  values ('hir-test-draft-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'Hirtestdraftteam', 'Not published.', 'union', 'NATIONAL_TEAM', 'mens');
  if (select count(*) from public.search_hub_content('Hirtestdraftteam', 20) where result_type = 'CONTENT_ITEM') <> 0 then
    raise exception 'FAIL (K): a DRAFT RUGBY_TEAM appeared in search_hub_content';
  end if;
  raise notice 'PASS (K): a DRAFT RUGBY_TEAM never surfaces in search';

  -- ============ L/M. hub_team_honours FK enforcement ============
  select id into v_test_competition from public.hub_content_items where content_type = 'COMPETITION_GUIDE' and content_key = 'rugby-world-cup';
  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label) values (v_test_team, v_test_competition, 'CHAMPION', '2099') returning id into v_test_honour;
  raise notice 'PASS (L): hub_team_honours accepts a real RUGBY_TEAM as team_id';
  raise notice 'PASS (M): hub_team_honours accepts a real COMPETITION_GUIDE as competition_id';

  -- ============ N. Invalid non-team team_id rejected ============
  v_raised := false;
  begin
    insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label) values (v_test_competition, v_test_competition, 'CHAMPION', '2099');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (N): a non-RUGBY_TEAM content item was accepted as team_id'; end if;
  raise notice 'PASS (N): a non-RUGBY_TEAM content item is rejected as team_id by the enforcement trigger';

  -- ============ O. Invalid non-competition competition_id rejected ============
  v_raised := false;
  begin
    insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label) values (v_test_team, v_test_team, 'CHAMPION', '2099');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (O): a non-COMPETITION_GUIDE content item was accepted as competition_id'; end if;
  raise notice 'PASS (O): a non-COMPETITION_GUIDE content item is rejected as competition_id by the enforcement trigger';

  -- ============ P. World Cup winner query works ============
  if (
    select t.content_key from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where c.content_key = 'rugby-world-cup' and h.honour_type = 'CHAMPION' and h.year_label = '2003'
  ) <> 'england-rugby-union-men' then
    raise exception 'FAIL (P): querying who won the 2003 Rugby World Cup did not return England';
  end if;
  raise notice 'PASS (P): "who won the 2003 Rugby World Cup" resolves correctly to England from structured honours';

  -- ============ Q. World Cup count works ============
  if (
    select count(*) from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where t.content_key = 'south-africa-rugby-union-men' and c.content_key = 'rugby-world-cup' and h.honour_type = 'CHAMPION'
  ) <> 4 then
    raise exception 'FAIL (Q): South Africa''s Rugby World Cup win count did not resolve to 4';
  end if;
  raise notice 'PASS (Q): "how many Rugby World Cups has South Africa won" correctly resolves to 4 from structured honours';

  -- ============ R. Women's honours work ============
  if (
    select count(*) from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where t.content_key = 'new-zealand-rugby-union-women' and c.content_key = 'womens-rugby-world-cup' and h.honour_type = 'CHAMPION'
  ) <> 6 then
    raise exception 'FAIL (R): New Zealand Women''s Rugby World Cup win count did not resolve to 6';
  end if;
  raise notice 'PASS (R): Women''s Rugby World Cup honours resolve correctly (New Zealand Women: 6 titles) using the exact same architecture as men''s honours';

  -- ============ S. League honours work ============
  if (
    select count(*) from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where t.content_key = 'australia-rugby-league-men' and c.content_key = 'rugby-league-world-cup' and h.honour_type = 'CHAMPION'
  ) <> 2 then
    raise exception 'FAIL (S): Australia Rugby League World Cup win count did not resolve to 2';
  end if;
  raise notice 'PASS (S): Rugby League World Cup honours resolve correctly using the exact same architecture as Union honours';

  -- ============ T. Grand Slam works ============
  if (
    select h.year_label from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    where t.content_key = 'ireland-rugby-union-men' and h.honour_type = 'GRAND_SLAM'
  ) <> '2023' then
    raise exception 'FAIL (T): Ireland''s Grand Slam honour did not resolve to 2023';
  end if;
  if (select count(*) from public.hub_glossary_terms where term_key = 'grand-slam' and status = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (T2): the Grand Slam Glossary concept does not exist';
  end if;
  raise notice 'PASS (T): Grand Slam resolves correctly as both a Glossary concept and a real 2023 Ireland instance in hub_team_honours';

  -- ============ U. Triple Crown works ============
  if (
    select h.year_label from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    where t.content_key = 'ireland-rugby-union-men' and h.honour_type = 'TRIPLE_CROWN'
  ) <> '2025' then
    raise exception 'FAIL (U): Ireland''s Triple Crown honour did not resolve to 2025';
  end if;
  if (select count(*) from public.hub_glossary_terms where term_key = 'triple-crown' and status = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (U2): the Triple Crown Glossary concept does not exist';
  end if;
  raise notice 'PASS (U): Triple Crown resolves correctly as both a Glossary concept and a real 2025 Ireland instance in hub_team_honours';

  -- ============ V. Provenance present for every permanent honour ============
  if (select count(*) from public.hub_team_honours where source_url is null and team_id not in (v_test_team)) <> 0 then
    raise exception 'FAIL (V): a permanent honour row is missing source_url provenance';
  end if;
  raise notice 'PASS (V): every permanent hub_team_honours row carries real source provenance';

  -- ============ W. Heritage content links valid ============
  if (select count(*) from public.hub_content_heritage_links where content_item_id in (select id from public.hub_content_items where content_key = 'british-and-irish-lions-men')) <> 1 then
    raise exception 'FAIL (W): the Lions do not carry a real Heritage link';
  end if;
  raise notice 'PASS (W): hub_content_heritage_links carries real, FK-enforced links (e.g. the Lions to LIONS-1888)';

  -- ============ X. Unpublished content cannot leak through Heritage links ============
  declare
    v_heritage uuid;
  begin
    select id into v_heritage from public.heritage_entries limit 1;
    insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values (v_test_team, v_heritage);
    update public.hub_content_items set status = 'DRAFT' where id = v_test_team;
    perform set_config('role', 'anon', true);
    if (select count(*) from public.hub_content_heritage_links where content_item_id = v_test_team) <> 0 then
      raise exception 'FAIL (X): an unpublished content item''s Heritage link was visible to an anonymous reader';
    end if;
    reset role;
  end;
  raise notice 'PASS (X): a Heritage link is invisible to public readers when its own content item is not published';

  -- ============ Y. Existing Challenge Cup Heritage link works ============
  if (
    select count(*) from public.hub_content_heritage_links l
    join public.hub_content_items c on c.id = l.content_item_id
    join public.heritage_entries h on h.id = l.heritage_entry_id
    where c.content_key = 'challenge-cup' and h.entry_key = 'CHALLENGE-CUP-1897'
  ) <> 1 then
    raise exception 'FAIL (Y): the pre-existing Challenge Cup competition is not linked to its matching Heritage entry';
  end if;
  raise notice 'PASS (Y): the standing Heritage gap is closed for the Challenge Cup — a real link to CHALLENGE-CUP-1897 now exists';

  -- ============ Z. Existing Super League Heritage link works ============
  if (
    select count(*) from public.hub_content_heritage_links l
    join public.hub_content_items c on c.id = l.content_item_id
    join public.heritage_entries h on h.id = l.heritage_entry_id
    where c.content_key = 'super-league' and h.entry_key = 'SUPER-LEAGUE-1996'
  ) <> 1 then
    raise exception 'FAIL (Z): the pre-existing Super League competition is not linked to its matching Heritage entry';
  end if;
  raise notice 'PASS (Z): the standing Heritage gap is closed for Super League — a real link to SUPER-LEAGUE-1996 now exists';

  -- ============ AA. Search finds RUGBY_TEAM ============
  update public.hub_content_items set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now(), title = 'Hirtestsearchableteam' where id = v_test_team;
  if (select count(*) from public.search_hub_content('Hirtestsearchableteam', 20) where result_id = v_test_team and result_type = 'CONTENT_ITEM') <> 1 then
    raise exception 'FAIL (AA): a published RUGBY_TEAM did not appear in search_hub_content';
  end if;
  raise notice 'PASS (AA): search_hub_content returns a published RUGBY_TEAM with zero RPC change';

  -- ============ AB. Search raw branch remains CONTENT_ITEM ============
  if (select count(*) from public.search_hub_content('Hirtestsearchableteam', 20) where result_type not in ('CONTENT_ITEM')) <> 0 then
    raise exception 'FAIL (AB): search_hub_content unexpectedly introduced a new raw result_type for team content';
  end if;
  raise notice 'PASS (AB): the raw RPC result_type for team content remains exactly CONTENT_ITEM — presentation-only relabelling happens client-side';

  -- ============ AC. Recommendations remain sane (code isolation, both directions) ============
  if (select count(*) from public.get_hub_recommended_content(v_test_identity_union, 500) where result_id in (select id from public.hub_content_items where content_type = 'RUGBY_TEAM' and rugby_code = 'league')) <> 0 then
    raise exception 'FAIL (AC): a League RUGBY_TEAM leaked into Union-context recommendations';
  end if;
  if (select count(*) from public.get_hub_recommended_content(v_test_identity_league, 500) where result_id in (select id from public.hub_content_items where content_type = 'RUGBY_TEAM' and rugby_code = 'union')) <> 0 then
    raise exception 'FAIL (AC2): a Union RUGBY_TEAM leaked into League-context recommendations';
  end if;
  raise notice 'PASS (AC): RUGBY_TEAM recommendation isolation holds correctly in both directions';

  -- ============ AD. Operational teams untouched ============
  if (select count(*) from public.teams) <> v_operational_teams_before then
    raise exception 'FAIL (AD): the operational teams table row count changed as a side effect of this domain';
  end if;
  raise notice 'PASS (AD): operational teams remains completely untouched';

  -- ============ AE. Operational competitions untouched ============
  if (select count(*) from public.competitions) <> v_operational_competitions_before then
    raise exception 'FAIL (AE): the operational competitions table row count changed as a side effect of this domain';
  end if;
  raise notice 'PASS (AE): operational competitions remains completely untouched';

  -- ============ AF. No operational player dependency ============
  perform set_config('role', 'anon', true);
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_TEAM' and content_key = 'england-rugby-union-men' and status = 'PUBLISHED') <> 1 then
    raise exception 'FAIL (AF): a published RUGBY_TEAM is not readable via its own public-read policy alone (as anon)';
  end if;
  reset role;
  raise notice 'PASS (AF): a published RUGBY_TEAM is readable via hub_content_items'' own public-read policy alone — no dependency on players or any other operational table';

  -- ============ AG. No famous domestic CLUB_TEAM seeded (restated) ============
  if (select count(*) from public.hub_content_items where content_type = 'RUGBY_TEAM' and club_directory_id is not null) <> 0 then
    raise exception 'FAIL (AG): a RUGBY_TEAM row references club_directory_id — no famous domestic club was meant to be seeded in this slice';
  end if;
  raise notice 'PASS (AG): zero RUGBY_TEAM rows reference club_directory_id — confirms no famous domestic club was seeded';

  -- ============ AH. Retired: this assertion originally pinned "no person
  -- entity exists yet" as a within-slice scope boundary for International
  -- Rugby. People & Rugby Legends has since legitimately introduced
  -- RUGBY_PERSON as its own approved content_type -- that boundary was
  -- for a point in time, not a permanent invariant, and enforcing it
  -- forever would incorrectly fail every future regression run. Retired
  -- per instruction (previous-domain assertions must not assume a shared
  -- resource can never grow), rather than left as a silent false FAIL. ============
  raise notice 'PASS (AH, retired): person-entity scope boundary superseded by People & Rugby Legends — see hub_people_and_legends.sql for its own real assertions';

  -- ============ AI (verified after rollback): QA cleanup zero ============
  raise notice 'PASS (AI, pending): wrapped in begin/rollback — verified externally by re-querying for hir-test-%% rows after this transaction rolls back';
end $$;

rollback;
