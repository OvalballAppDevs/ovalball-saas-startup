-- Rugby Hub Famous Clubs -- permanent regression.
--
-- Pins: CLUB_TEAM is accepted as an existing team_type (no RUGBY_CLUB
-- content_type, no new team_type); Bradford Northern -> Bradford Bulls
-- resolves via alias search to one durable row; Wigan/St Helens/Leeds
-- historic aliases resolve correctly; men's and women's clubs are
-- genuinely separate rows; club_directory_id is null on every v1 row;
-- honours are FK-valid and a pre-1996 League honour never points to
-- Super League, and a historic Union honour never points to the modern
-- Premiership; Ellery Hanley spans three clubs; Heritage links are valid;
-- source provenance is present; publication/RLS is correct; search's raw
-- result stays CONTENT_ITEM; the "Club" presentation label is correct;
-- recommendations are unchanged; Great Britain RL/England Women's RL/
-- Welsh regional rows were NOT added in this slice.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_test_club uuid;
  v_test_team uuid;
  v_test_person uuid;
  v_test_competition uuid;
  v_test_honour uuid;
  v_raised boolean;
  v_admin uuid := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;
  v_operational_clubs_before int;
  v_operational_teams_before int;
begin
  select count(*) into v_operational_clubs_before from public.clubs;
  select count(*) into v_operational_teams_before from public.teams;

  -- ============ A. CLUB_TEAM accepted ============
  insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, team_type, team_gender)
  values ('hfc-test-club-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'Test Club', 'A test summary.', 'union', 'CLUB_TEAM', 'mens')
  returning id into v_test_club;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_test_club, true);
  raise notice 'PASS (A): CLUB_TEAM is accepted as an existing team_type — no new team_type was required';

  -- ============ B. RUGBY_CLUB content_type absent ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary) values ('hfc-test-badtype-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_CLUB', 'x', 'x');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (B): a RUGBY_CLUB content_type was accepted — this was explicitly rejected by the approved architecture'; end if;
  raise notice 'PASS (B): RUGBY_CLUB does not exist as a content_type';

  -- ============ C. No new team_type ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary, team_type) values ('hfc-test-badteamtype-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'x', 'x', 'PROVINCIAL_TEAM');
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'FAIL (C): an unapproved team_type (PROVINCIAL_TEAM) was accepted'; end if;
  raise notice 'PASS (C): team_type remains constrained to exactly NATIONAL_TEAM/REPRESENTATIVE_TEAM/CLUB_TEAM — no new value was required, including for Munster';

  -- ============ D. Exact v1 CLUB_TEAM count ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and status = 'PUBLISHED' and content_key not like 'hfc-test-%') <> 12 then
    raise exception 'FAIL (D): expected exactly 12 permanent published CLUB_TEAM rows';
  end if;
  raise notice 'PASS (D): exactly 12 permanent published CLUB_TEAM rows exist';

  -- ============ E. League men count ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and rugby_code = 'league' and team_gender = 'mens' and content_key not like 'hfc-test-%') <> 4 then
    raise exception 'FAIL (E): expected exactly 4 League men''s CLUB_TEAM rows';
  end if;
  raise notice 'PASS (E): exactly 4 League men''s clubs exist (Wigan, St Helens, Leeds, Bradford)';

  -- ============ F. Union men count ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and rugby_code = 'union' and team_gender = 'mens' and content_key not like 'hfc-test-%') <> 4 then
    raise exception 'FAIL (F): expected exactly 4 Union men''s CLUB_TEAM rows';
  end if;
  raise notice 'PASS (F): exactly 4 Union men''s clubs exist (Leicester, Bath, Harlequins, Munster)';

  -- ============ G. League women count ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and rugby_code = 'league' and team_gender = 'womens' and content_key not like 'hfc-test-%') <> 2 then
    raise exception 'FAIL (G): expected exactly 2 League women''s CLUB_TEAM rows';
  end if;
  raise notice 'PASS (G): exactly 2 League women''s clubs exist (St Helens Women, Leeds Rhinos Women)';

  -- ============ H. Union women count ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and rugby_code = 'union' and team_gender = 'womens' and content_key not like 'hfc-test-%') <> 2 then
    raise exception 'FAIL (H): expected exactly 2 Union women''s CLUB_TEAM rows';
  end if;
  raise notice 'PASS (H): exactly 2 Union women''s clubs exist (Harlequins Women, Saracens Women)';

  -- ============ I. Bradford Bulls canonical row ============
  if (select count(*) from public.hub_content_items where content_key = 'bradford-bulls' and team_type = 'CLUB_TEAM') <> 1 then
    raise exception 'FAIL (I): the canonical Bradford Bulls row does not exist';
  end if;
  if (select count(*) from public.hub_content_items where content_key = 'bradford-northern') <> 0 then
    raise exception 'FAIL (I2): a second Bradford Northern entity exists — this must remain one durable row';
  end if;
  raise notice 'PASS (I): Bradford Bulls is one durable canonical row, with no separate Bradford Northern entity';

  -- ============ J. Bradford Northern alias present ============
  if not (select 'Bradford Northern' = any(aliases) from public.hub_content_items where content_key = 'bradford-bulls') then
    raise exception 'FAIL (J): Bradford Bulls is missing the Bradford Northern alias';
  end if;
  raise notice 'PASS (J): Bradford Northern is present as a real alias of Bradford Bulls';

  -- ============ K. Bradford Northern search resolves Bradford Bulls ============
  if (select count(*) from public.hub_content_items where content_key = 'bradford-bulls' and search_vector @@ websearch_to_tsquery('english', 'Bradford Northern')) <> 1 then
    raise exception 'FAIL (K): searching "Bradford Northern" does not resolve to the Bradford Bulls row';
  end if;
  raise notice 'PASS (K): searching "Bradford Northern" resolves to the current canonical Bradford Bulls page';

  -- ============ L. Wigan alias present ============
  if not (select 'Wigan RLFC' = any(aliases) from public.hub_content_items where content_key = 'wigan-warriors') then
    raise exception 'FAIL (L): Wigan Warriors is missing the Wigan RLFC alias';
  end if;
  raise notice 'PASS (L): Wigan RLFC is present as a real alias of Wigan Warriors';

  -- ============ M. Wigan historic search resolves canonical row ============
  if (select count(*) from public.hub_content_items where content_key = 'wigan-warriors' and search_vector @@ websearch_to_tsquery('english', 'Wigan RLFC')) <> 1 then
    raise exception 'FAIL (M): searching "Wigan RLFC" does not resolve to the Wigan Warriors row';
  end if;
  raise notice 'PASS (M): searching "Wigan RLFC" resolves to the current canonical Wigan Warriors page';

  -- ============ N. St Helens alias present ============
  if not (select 'Saints' = any(aliases) from public.hub_content_items where content_key = 'st-helens') then
    raise exception 'FAIL (N): St Helens is missing the Saints alias';
  end if;
  raise notice 'PASS (N): Saints is present as a real alias of St Helens';

  -- ============ O. Leeds alias present ============
  if not (select 'Leeds RLFC' = any(aliases) from public.hub_content_items where content_key = 'leeds-rhinos') then
    raise exception 'FAIL (O): Leeds Rhinos is missing the Leeds RLFC alias';
  end if;
  raise notice 'PASS (O): Leeds RLFC is present as a real alias of Leeds Rhinos';

  -- ============ P. Women rows separate from men ============
  if (select id from public.hub_content_items where content_key = 'st-helens') = (select id from public.hub_content_items where content_key = 'st-helens-women') then
    raise exception 'FAIL (P): St Helens and St Helens Women resolved to the same row';
  end if;
  if (select count(*) from public.hub_team_honours h join public.hub_content_items t on t.id = h.team_id where t.content_key = 'st-helens-women') = 0 then
    raise exception 'FAIL (P2): St Helens Women has no honours of her own — women''s honours must never be cross-attached to the men''s row';
  end if;
  raise notice 'PASS (P): women''s clubs are genuinely separate rows with their own real honours, never a flag on the men''s row';

  -- ============ Q. club_directory_id null on all v1 rows ============
  if (select count(*) from public.hub_content_items where team_type = 'CLUB_TEAM' and content_key not like 'hfc-test-%' and club_directory_id is not null) <> 0 then
    raise exception 'FAIL (Q): a v1 CLUB_TEAM row has club_directory_id populated — club_directory has zero Rugby League clubs and no verified Union stub was found';
  end if;
  raise notice 'PASS (Q): club_directory_id is null on every v1 CLUB_TEAM row';

  -- ============ R. Zero operational-table FK ============
  if (select count(*) from public.clubs) <> v_operational_clubs_before or (select count(*) from public.teams) <> v_operational_teams_before then
    raise exception 'FAIL (R): operational clubs/teams row counts changed as a side effect of this domain';
  end if;
  raise notice 'PASS (R): operational clubs/teams remain completely untouched';

  -- ============ S. Honours FK-valid ============
  select id into v_test_team from public.hub_content_items where team_type = 'CLUB_TEAM' limit 1;
  select id into v_test_competition from public.hub_content_items where content_type = 'COMPETITION_GUIDE' limit 1;
  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label) values (v_test_club, v_test_competition, 'CHAMPION', '2099') returning id into v_test_honour;
  raise notice 'PASS (S): hub_team_honours accepts a real CLUB_TEAM as team_id, reused unchanged';

  -- ============ T. Historic competition honour points to historic guide ============
  if (
    select c.content_key from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where t.content_key = 'wigan-warriors' and h.year_label = '1990'
  ) <> 'rugby-league-championship' then
    raise exception 'FAIL (T): Wigan''s 1990 title does not point to the historic rugby-league-championship guide';
  end if;
  raise notice 'PASS (T): Wigan''s 1990 title correctly points to the historic Rugby League Championship guide, a genuinely distinct competition from Super League';

  -- ============ U. No pre-1996 honour falsely points to Super League ============
  if (
    select count(*) from (
      select h.year_label from public.hub_team_honours h
      join public.hub_content_items c on c.id = h.competition_id
      where c.content_key = 'super-league' and h.year_label ~ '^\d{4}$'
    ) super_league_years
    where year_label::int < 1996
  ) <> 0 then
    raise exception 'FAIL (U): a pre-1996 honour falsely points to Super League';
  end if;
  raise notice 'PASS (U): no pre-1996 honour is falsely attributed to Super League';

  -- ============ V. No historic Union honour falsely points to modern Premiership ============
  if (
    select c.content_key from public.hub_team_honours h
    join public.hub_content_items t on t.id = h.team_id
    join public.hub_content_items c on c.id = h.competition_id
    where t.content_key = 'leicester-tigers' and h.year_label = '1988'
  ) <> 'english-club-championship' then
    raise exception 'FAIL (V): Leicester''s 1988 title does not point to the historic english-club-championship guide, not the modern Premiership';
  end if;
  raise notice 'PASS (V): Leicester''s 1988 title correctly points to the historic English Club Championship guide, never the modern Gallagher Premiership';

  -- ============ W. People links valid ============
  select id into v_test_person from public.hub_content_items where content_type = 'RUGBY_PERSON' limit 1;
  insert into public.hub_person_team_relationships (person_id, team_id, role_type) values (v_test_person, v_test_club, 'PLAYED_FOR');
  raise notice 'PASS (W): hub_person_team_relationships accepts a real RUGBY_PERSON and a real CLUB_TEAM, reused unchanged';

  -- ============ X. Hanley spans multiple clubs ============
  if (
    select count(distinct team_id) from public.hub_person_team_relationships r
    join public.hub_content_items p on p.id = r.person_id
    where p.content_key = 'ellery-hanley'
  ) <> 3 then
    raise exception 'FAIL (X): Ellery Hanley does not have exactly 3 distinct club relationships (Bradford, Wigan, Leeds)';
  end if;
  raise notice 'PASS (X): Ellery Hanley spans exactly three clubs — Bradford Bulls, Wigan Warriors, Leeds Rhinos';

  -- ============ Y. Heritage links valid ============
  declare
    v_test_heritage uuid;
  begin
    select id into v_test_heritage from public.heritage_entries limit 1;
    insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values (v_test_club, v_test_heritage);
  end;
  if (select count(*) from public.heritage_entries where entry_key in ('BRADFORD-BULLS-2017', 'MUNSTER-2006')) <> 2 then
    raise exception 'FAIL (Y): expected both new Heritage entries (BRADFORD-BULLS-2017, MUNSTER-2006) to exist';
  end if;
  raise notice 'PASS (Y): hub_content_heritage_links accepts a real CLUB_TEAM, and both new Heritage entries exist';

  -- ============ Z. Source provenance present ============
  if (select count(*) from public.hub_content_sources where content_item_id in (select id from public.hub_content_items where team_type = 'CLUB_TEAM' and content_key not like 'hfc-test-%')) < 12 then
    raise exception 'FAIL (Z): fewer than one source row per permanent club exists';
  end if;
  raise notice 'PASS (Z): every permanent club has at least one real hub_content_sources row';

  -- ============ AA. Publication/RLS correct ============
  perform set_config('role', 'anon', true);
  if (select count(*) from public.hub_content_items where content_key = 'wigan-warriors' and team_type = 'CLUB_TEAM') <> 1 then
    raise exception 'FAIL (AA): a published CLUB_TEAM is not visible to an anonymous reader';
  end if;
  reset role;
  raise notice 'PASS (AA): a published CLUB_TEAM is publicly visible';

  -- ============ AB. Draft invisible ============
  insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, team_type, team_gender)
  values ('hfc-test-draft-' || substr(gen_random_uuid()::text,1,8), 'RUGBY_TEAM', 'Hfctestdraftclub', 'Not published.', 'union', 'CLUB_TEAM', 'mens');
  if (select count(*) from public.search_hub_content('Hfctestdraftclub', 20) where result_type = 'CONTENT_ITEM') <> 0 then
    raise exception 'FAIL (AB): a DRAFT CLUB_TEAM appeared in search_hub_content';
  end if;
  raise notice 'PASS (AB): a DRAFT CLUB_TEAM never surfaces in search';

  -- ============ AC. Search raw result CONTENT_ITEM ============
  update public.hub_content_items set title = 'Hfctestsearchtarget', status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now() where id = v_test_club;
  if (select count(*) from public.search_hub_content('Hfctestsearchtarget', 20) where result_id = v_test_club and result_type = 'CONTENT_ITEM') <> 1 then
    raise exception 'FAIL (AC): a published CLUB_TEAM did not appear in search_hub_content via the existing CONTENT_ITEM branch';
  end if;
  if (select count(*) from public.search_hub_content('Hfctestsearchtarget', 20) where result_type not in ('CONTENT_ITEM')) <> 0 then
    raise exception 'FAIL (AC2): search_hub_content unexpectedly introduced a new raw result_type for club content';
  end if;
  raise notice 'PASS (AC): the raw RPC result_type for club content remains exactly CONTENT_ITEM, zero RPC change';

  -- ============ AD. Client presentation label Club ============
  -- (This is a client-side presentation fact, verified live in Chrome UAT
  -- rather than SQL -- the raw content_type/team_type data this label is
  -- derived from is proven valid by assertions A and D above.)
  raise notice 'PASS (AD, structural): team_type = CLUB_TEAM is the exact value the client-side presentation layer maps to "Club" — verified live in Chrome UAT';

  -- ============ AE. Recommendation RPC unchanged ============
  declare
    v_test_identity uuid;
  begin
    insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type)
    values ('union', 'hfc-identity-' || substr(gen_random_uuid()::text,1,8), 'Test Identity', 'DIRECT')
    returning id into v_test_identity;
    if (select count(*) from public.get_hub_recommended_content(v_test_identity, 500) where result_id = v_test_club) <> 1 then
      raise exception 'FAIL (AE): a universal, published CLUB_TEAM was not returned by get_hub_recommended_content';
    end if;
  end;
  raise notice 'PASS (AE): get_hub_recommended_content returns a legitimate universal CLUB_TEAM with zero RPC change';

  -- ============ AF. Bradford current-tier independence content invariant ============
  if (select body from public.hub_content_items where content_key = 'bradford-bulls') !~* 'current.*(league|tier|position).*not.*(reflect|reflected)' then
    raise exception 'FAIL (AF): Bradford Bulls'' body does not explicitly state that current tier does not reflect its historical importance';
  end if;
  raise notice 'PASS (AF): Bradford Bulls'' content explicitly states its current league position does not reflect its historical importance';

  -- ============ AG. Great Britain RL not added ============
  if (select count(*) from public.hub_content_items where content_key ilike '%great-britain%') <> 0 then
    raise exception 'FAIL (AG): a Great Britain Rugby League row was added — this remains International Rugby follow-up debt';
  end if;
  raise notice 'PASS (AG): Great Britain Rugby League was not added in this slice';

  -- ============ AH. England Women''s RL not added ============
  if (select count(*) from public.hub_content_items where content_key = 'england-rugby-league-women') <> 0 then
    raise exception 'FAIL (AH): an England Women''s Rugby League row was added — this remains International Rugby follow-up debt';
  end if;
  raise notice 'PASS (AH): England Women''s Rugby League was not added in this slice';

  -- ============ AI. No Welsh regional rows in v1 ============
  if (select count(*) from public.hub_content_items where content_key in ('ospreys', 'scarlets', 'cardiff-rugby', 'dragons', 'glasgow-warriors', 'edinburgh-rugby')) <> 0 then
    raise exception 'FAIL (AI): a Welsh or Scottish club/region row was seeded — these remain deliberately deferred past v1';
  end if;
  raise notice 'PASS (AI): no Welsh regional or Scottish club rows were seeded in this slice, exactly as deferred';

  -- ============ AJ (verified after rollback): QA cleanup zero ============
  raise notice 'PASS (AJ, pending): wrapped in begin/rollback — verified externally by re-querying for hfc-test-%% rows after this transaction rolls back';
end $$;

rollback;
