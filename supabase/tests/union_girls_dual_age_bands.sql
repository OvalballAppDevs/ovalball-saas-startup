-- Union girls dual age bands, code-specific availability, and the season
-- guard -- the three things Phase 4B.1 exists to make permanent.
--
-- The property under test throughout is asymmetry: RFU evidence must change
-- Rugby Union behaviour and must NOT change Rugby League behaviour. Most of
-- these assertions would still pass if the two codes were wired together, so
-- each union assertion is deliberately paired with its league counterpart --
-- that pairing is the test, not the individual line.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_count int; v_int int; v_text text;
  v_club uuid; v_dir uuid; v_admin uuid := gen_random_uuid();
  v_type uuid; v_fact uuid; v_set uuid; v_src_2025 uuid; v_src_2026 uuid;
  v_team uuid;
  v_ok boolean;
begin

-- ============ A. Union offers exactly the four dual age bands ============

select count(*) into v_count
from public.canonical_team_types_by_code
where rugby_code = 'union' and gender = 'girls' and is_offered;
if v_count = 4 then
  raise notice 'PASS 1 (A): union offers exactly 4 girls identities';
else
  raise notice 'FAIL 1 (A): union offers % girls identities, expected 4', v_count;
end if;

select string_agg(key, ',' order by key) into v_text
from public.canonical_team_types_by_code
where rugby_code = 'union' and gender = 'girls' and is_offered;
if v_text = 'girls_u12,girls_u14,girls_u16,girls_u18' then
  raise notice 'PASS 2 (A): they are exactly the U12/U14/U16/U18 bands';
else
  raise notice 'FAIL 2 (A): union girls identities are %', v_text;
end if;

-- ============ B. Union does NOT offer the single-year grades ============

select count(*) into v_count
from public.canonical_team_types_by_code
where rugby_code = 'union' and key in ('girls_u13', 'girls_u15') and is_offered;
if v_count = 0 then
  raise notice 'PASS 3 (B): union offers neither girls_u13 nor girls_u15';
else
  raise notice 'FAIL 3 (B): union still offers % of them', v_count;
end if;

-- U17 girls has never existed as a canonical row, and must not appear.
if not exists (
  select 1 from public.canonical_team_types_by_code
  where rugby_code = 'union' and gender = 'girls' and age_group = 'U17' and is_offered
) then
  raise notice 'PASS 4 (B): union offers no girls U17 identity';
else
  raise notice 'FAIL 4 (B): a union girls U17 identity is being offered';
end if;

-- ============ C. LEAGUE IS UNCHANGED -- the whole point ============

-- This used to assert that league withholds NOTHING, which was true while
-- the catalogue held only Union-shaped identities. League now legitimately
-- withholds the Union-only ones (Colts and the numbered Men's XVs), so the
-- assertion is re-pointed at what actually needs protecting: league may
-- withhold Union-specific identities and NOTHING ELSE -- in particular never
-- a girls identity, and never anything on RFU evidence.
select string_agg(key, ',' order by key) into v_text
from public.canonical_team_types_by_code
where rugby_code = 'league' and is_active and not is_offered
  and key not in ('junior_colts','senior_colts','mens_1st','mens_2nd','mens_3rd');
if v_text is null then
  raise notice 'PASS 5 (C): league withholds only Union-specific identities -- union evidence has not narrowed it';
else
  raise notice 'FAIL 5 (C): league is withholding non-Union identity/identities: %', v_text;
end if;

select count(*) into v_count
from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('girls_u13', 'girls_u15') and is_offered;
if v_count = 2 then
  raise notice 'PASS 6 (C): league still offers BOTH girls_u13 and girls_u15';
else
  raise notice 'FAIL 6 (C): league offers only % of girls_u13/girls_u15', v_count;
end if;

-- The rows themselves must still be globally active. A global deactivation is
-- exactly the mistake this phase corrected.
select count(*) into v_count
from public.canonical_team_types where key in ('girls_u13', 'girls_u15') and is_active;
if v_count = 2 then
  raise notice 'PASS 7 (C): girls_u13/girls_u15 remain globally ACTIVE rows';
else
  raise notice 'FAIL 7 (C): only % of them are globally active', v_count;
end if;

-- ============ D. Historical identity still resolves ============

-- The resolver must not consult offering rules at all: an existing team has
-- to keep resolving on a type its own code no longer offers.
select internal.resolve_canonical_team_type('youth', 'U13', 'girls', null) into v_type;
if v_type is not null then
  raise notice 'PASS 8 (D): a historical girls U13 identity still resolves';
else
  raise notice 'FAIL 8 (D): girls U13 no longer resolves -- historical rows would break';
end if;

select internal.resolve_canonical_team_type('youth', 'U15', 'girls', null) into v_type;
if v_type is not null then
  raise notice 'PASS 9 (D): a historical girls U15 identity still resolves';
else
  raise notice 'FAIL 9 (D): girls U15 no longer resolves';
end if;

-- ============ E. Creation is refused for union, allowed for league ============

-- Must join: most club_directory rows are unclaimed and have no clubs row,
-- so selecting a directory first and then its club finds nothing.
select c.id into v_club
from public.clubs c
join public.club_directory d on d.id = c.directory_id
where d.rugby_code = 'union'
limit 1;

if v_club is null then
  raise notice 'SKIP 10 (E): no union club in this database to test creation against';
else
  -- The CHECK constraint refuses the age/gender combination outright.
  v_ok := false;
  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
    values (v_club, 'union', 'youth', 'U13', 'girls', 'UGDAB probe', 'ugdab-probe-' || gen_random_uuid());
  exception when check_violation then v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 10 (E): a union girls U13 team is refused at the database boundary';
  else
    raise notice 'FAIL 10 (E): a union girls U13 team was accepted';
  end if;

  -- And the band identity it should use instead is accepted.
  v_ok := false;
  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
    values (v_club, 'union', 'youth', 'U14', 'girls', 'UGDAB probe2', 'ugdab-probe2-' || gen_random_uuid());
    v_ok := true;
  exception when others then v_ok := false;
  end;
  if v_ok then
    raise notice 'PASS 11 (E): the union girls U14 band identity IS accepted';
  else
    raise notice 'FAIL 11 (E): union girls U14 was refused';
  end if;
end if;

-- The constraint expression itself, evaluated across every combination that
-- matters, independent of what clubs happen to exist locally.
select count(*) into v_count from (values
  ('union','youth','U12','girls',true),  ('union','youth','U13','girls',false),
  ('union','youth','U14','girls',true),  ('union','youth','U15','girls',false),
  ('union','youth','U16','girls',true),  ('union','youth','U17','girls',false),
  ('union','youth','U18','girls',true),  ('union','youth','U9','girls',true),
  ('league','youth','U13','girls',true), ('league','youth','U15','girls',true),
  ('union','youth','U13','boys',true),   ('union','youth','U15','boys',true),
  ('union','youth','U11','mixed',true),  ('union','youth','U12','mixed',false)
) as t(code, cat, age, gender, expected)
where expected <> (
  (cat = 'youth' and gender = 'mixed' and age in ('U6','U7','U8','U9','U10','U11'))
  or (cat = 'youth' and gender = 'boys')
  or (cat = 'youth' and gender = 'girls'
      and (code is distinct from 'union' or age in ('U6','U7','U8','U9','U10','U11','U12','U14','U16','U18')))
);
if v_count = 0 then
  raise notice 'PASS 12 (E): all 14 age/gender/code combinations behave as specified';
else
  raise notice 'FAIL 12 (E): % combination(s) disagree with the specification', v_count;
end if;

-- ============ F. Rollover steps the bands, not the years ============

if internal.next_age_grade_for('U12','girls','union') = 'U14'
   and internal.next_age_grade_for('U14','girls','union') = 'U16'
   and internal.next_age_grade_for('U16','girls','union') = 'U18' then
  raise notice 'PASS 13 (F): union girls roll U12 -> U14 -> U16 -> U18';
else
  raise notice 'FAIL 13 (F): union girls roll % / % / %',
    internal.next_age_grade_for('U12','girls','union'),
    internal.next_age_grade_for('U14','girls','union'),
    internal.next_age_grade_for('U16','girls','union');
end if;

if internal.next_age_grade_for('U18','girls','union') is null then
  raise notice 'PASS 14 (F): union girls U18 has no mechanical successor (manual transition)';
else
  raise notice 'FAIL 14 (F): U18 girls rolled to %', internal.next_age_grade_for('U18','girls','union');
end if;

-- Never step THROUGH a non-grade.
if internal.next_age_grade_for('U12','girls','union') <> 'U13'
   and internal.next_age_grade_for('U14','girls','union') <> 'U15' then
  raise notice 'PASS 15 (F): rollover never lands on U13 or U15 for union girls';
else
  raise notice 'FAIL 15 (F): rollover landed on a non-grade';
end if;

-- Boys stay single-year.
if internal.next_age_grade_for('U12','boys','union') = 'U13'
   and internal.next_age_grade_for('U13','boys','union') = 'U14'
   and internal.next_age_grade_for('U14','boys','union') = 'U15'
   and internal.next_age_grade_for('U15','boys','union') = 'U16' then
  raise notice 'PASS 16 (F): union boys still progress one year at a time';
else
  raise notice 'FAIL 16 (F): union boys progression changed';
end if;

-- League progression is untouched by union evidence.
if internal.next_age_grade_for('U12','girls','league') = internal.next_age_grade('U12')
   and internal.next_age_grade_for('U14','girls','league') = internal.next_age_grade('U14') then
  raise notice 'PASS 17 (F): league girls progression is unchanged from the shared default';
else
  raise notice 'FAIL 17 (F): league girls progression was altered by union evidence';
end if;

-- ============ G. Fixture-season identity still resolves ============

select count(*) into v_count from public.team_season_identity;
if v_count >= 0 then
  raise notice 'PASS 18 (G): team_season_identity still resolves (% row(s))', v_count;
else
  raise notice 'FAIL 18 (G): team_season_identity is broken';
end if;

-- Every existing team, including any on a now-unoffered type, still maps to a
-- canonical row. This is the real "history keeps working" assertion.
select count(*) into v_count
from public.teams t
where t.canonical_team_type_id is not null
  and not exists (select 1 from public.canonical_team_types c where c.id = t.canonical_team_type_id);
if v_count = 0 then
  raise notice 'PASS 19 (G): every team with a canonical type still resolves it';
else
  raise notice 'FAIL 19 (G): % team(s) point at a missing canonical type', v_count;
end if;

-- ============ H. Season derivation is code-aware ============

if internal.regulatory_season_of(date '2026-08-01','union') = '2026/27'
   and internal.regulatory_season_of(date '2026-07-31','union') = '2025/26' then
  raise notice 'PASS 20 (H): union seasons turn on 1 August';
else
  raise notice 'FAIL 20 (H): union season boundary is wrong';
end if;

if internal.regulatory_season_of(date '2026-02-03','league') = '2026'
   and internal.regulatory_season_of(date '2026-09-01','league') = '2026' then
  raise notice 'PASS 21 (H): league seasons are calendar years (summer game)';
else
  raise notice 'FAIL 21 (H): league season derivation still uses the union calendar';
end if;

-- ============ I. A season-mixed content set cannot be published ============

select count(*) into v_count from public.regulatory_season_compatibility_report();
if v_count = 0 then
  raise notice 'PASS 22 (I): no existing content set is season-incompatible';
else
  raise notice 'FAIL 22 (I): % content set(s) already season-incompatible', v_count;
end if;

-- Build the exact scenario the brief names: a 2026/27 content set that draws
-- one fact from the 2026/27 master and one from the 2025/26 appendix.
select id into v_src_2026 from public.regulatory_sources where source_key = 'RFU-REG15-MASTER-2026-27';

-- A throwaway 2025/26 source of our own, deliberately NOT carried forward.
--
-- This used to reuse RFU-REG15-APP1-2025-001, which broke the moment that
-- appendix was legitimately marked carries_forward = true: the guard correctly
-- exempted it and the test stopped proving anything. A regression that asserts
-- a guard bites must not depend on production data staying un-exempt.
insert into public.regulatory_sources (
  source_key, authority_id, rugby_code, title, source_type, authority_classification,
  canonical_url, retrieved_on, effective_from, review_state, carries_forward
) select 'UGDAB-PROBE-SRC-2025', a.id, 'union', 'UGDAB probe source (2025/26)', 'REGULATION', 'PRIMARY_REGULATION',
         'https://www.englandrugby.com/ugdab-probe', date '2026-09-07', date '2025-08-01', 'VERIFIED_CURRENT', false
  from public.regulatory_authorities a where a.code = 'RFU'
returning id into v_src_2025;

if v_src_2025 is null or v_src_2026 is null then
  raise notice 'SKIP 23 (I): the 2026/27 master source is needed to build the mixed-season scenario';
else
  -- The Site Admin is created first: a VERIFIED content set requires
  -- verified_by/verified_at, and running the publish attempt as a real Site
  -- Admin is what proves the refusal comes from the SEASON check rather than
  -- from the capability check.
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_admin, 'ugdab@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_admin, 'UG', 'Probe', 'ugdab@ovalball-test.invalid');
  insert into public.site_admins (user_id, status, admin_role) values (v_admin, 'active', 'full');

  insert into public.regulatory_content_sets (content_set_key, rugby_code, topic, effective_from, publication_state, verified_by, verified_at)
  values ('UGDAB-PROBE-MIXED-SEASON', 'union', 'RULES', date '2026-08-01', 'VERIFIED', v_admin, now())
  returning id into v_set;

  -- Fact A: correctly sourced from the 2026/27 master.
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status)
  values ('UGDAB-PROBE-FACT-2026', 'OTHER', 'RULES', 'union', 'TEXT', 'from the 2026/27 master', 'VERIFIED')
  returning id into v_fact;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role) values (v_fact, v_src_2026, 'PRIMARY');
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_set, 'MATCH_FORMAT', 1, v_fact);

  -- Fact B: the trap -- sourced from the 2025/26 appendix, whose effective_to
  -- is NULL, so any interval-overlap test would wave it through.
  insert into public.regulatory_facts (fact_key, fact_type, topic, rugby_code, value_type, value_text, status)
  values ('UGDAB-PROBE-FACT-2025', 'BALL_SIZE', 'RULES', 'union', 'TEXT', 'from the 2025/26 appendix', 'VERIFIED')
  returning id into v_fact;
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role) values (v_fact, v_src_2025, 'PRIMARY');
  insert into public.regulatory_content_sections (content_set_id, section_key, display_order, fact_id)
  values (v_set, 'BALL', 2, v_fact);

  select count(*) into v_count
  from public.regulatory_season_compatibility_report() where content_set_key = 'UGDAB-PROBE-MIXED-SEASON';
  if v_count > 0 then
    raise notice 'PASS 23 (I): the season-mixed set is REPORTED as incompatible (% violation(s))', v_count;
  else
    raise notice 'FAIL 23 (I): a 2026/27 set citing a 2025/26 appendix was not detected';
  end if;

  -- And the publish gate must refuse it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_ok := false;
  begin
    perform public.publish_regulatory_content_set(v_set);
  exception when others then
    v_ok := true;
    v_text := sqlerrm;
  end;
  if v_ok then
    raise notice 'PASS 24 (I): publishing the season-mixed set was REFUSED';
  else
    raise notice 'FAIL 24 (I): a season-mixed content set was published';
  end if;

  select publication_state into v_text from public.regulatory_content_sets where id = v_set;
  if v_text = 'VERIFIED' then
    raise notice 'PASS 25 (I): the set stayed VERIFIED -- the refusal happened BEFORE the state change';
  else
    raise notice 'FAIL 25 (I): the set is now %, so the guard ran too late', v_text;
  end if;

  -- The other half of the contract: carries_forward is the ONLY thing that
  -- lets a cross-season citation through, and it is an explicit assertion
  -- with a written reason -- never an inference from a missing end date.
  update public.regulatory_sources
  set carries_forward = true, carries_forward_note = 'probe: asserting this document remains in force'
  where id = v_src_2025;

  select count(*) into v_count
  from public.regulatory_season_compatibility_report() where content_set_key = 'UGDAB-PROBE-MIXED-SEASON';
  if v_count = 0 then
    raise notice 'PASS 25b (I): marking the source carries_forward exempts it -- the escape hatch works';
  else
    raise notice 'FAIL 25b (I): a carried-forward source is still reported as incompatible';
  end if;

  -- And the nine real appendices must be exactly the carried-forward set.
  select count(*) into v_count
  from public.regulatory_sources
  where source_key like 'RFU-REG15-APP%' and source_key not like '%2017%'
    and carries_forward and carries_forward_note is not null;
  if v_count = 9 then
    raise notice 'PASS 25c (I): all 9 Regulation 15 appendices are carried forward WITH a written reason';
  else
    raise notice 'FAIL 25c (I): % appendices carry a carries_forward reason, expected 9', v_count;
  end if;
end if;

-- ============ J. Every populated Regulation 15 fact is 2026/27-sourced ============

-- Facts drawn from the master must take their VALUE from the master: the
-- PRIMARY citation is what carries the value, and it must be the master.
-- Supporting citations from elsewhere are corroboration and are welcome --
-- four appendices independently restate the master's playing times, and
-- recording that agreement is worth more than forbidding it.
select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_citations c on c.fact_id = f.id
join public.regulatory_sources rs on rs.id = c.source_id
where f.fact_key like 'RFU-REG15-2026-%'
  and c.support_role = 'PRIMARY' and rs.source_key <> 'RFU-REG15-MASTER-2026-27';
if v_count = 0 then
  raise notice 'PASS 26 (J): every RFU-REG15-2026 fact takes its VALUE from the 2026/27 master';
else
  raise notice 'FAIL 26 (J): % fact(s) take their primary value from something other than the master', v_count;
end if;

-- This assertion used to read "no fact may derive from the 2025/26
-- appendices". That invariant was correct while the appendices were blocked,
-- and was deliberately superseded when the developer authorised carrying them
-- forward. What still needs protecting is narrower and more durable: a fact
-- may only rest on a superseded-season source where that source is explicitly
-- marked carries_forward WITH a written reason. Silence must never be enough.
select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_citations c on c.fact_id = f.id
join public.regulatory_sources rs on rs.id = c.source_id
where f.fact_key not like 'UGDAB-PROBE%'
  and rs.effective_from is not null
  and internal.regulatory_season_of(rs.effective_from, rs.rugby_code)
      is distinct from internal.regulatory_season_of(current_date, rs.rugby_code)
  and not (rs.carries_forward and rs.carries_forward_note is not null);
if v_count = 0 then
  raise notice 'PASS 27 (J): no fact rests on an out-of-season source unless it is explicitly carried forward with a reason';
else
  raise notice 'FAIL 27 (J): % citation(s) use an out-of-season source with no carry-forward justification', v_count;
end if;

-- ============ L. Girls have EQUAL Rules of Play at U12 and U14 ============

-- The RFU confirmed directly that girls at U12 and U14 follow the same Rules
-- of Play as the boys, to ensure equality. The strong form of that is not
-- "the values match" but "it is the same row" -- copies can drift, a shared
-- row cannot.
select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where f.fact_key like 'RFU-REG15-APP-%' and ri.identity_key in ('RFU-U12','RFU-U14')
  and not exists (
    select 1 from public.regulatory_fact_applicability a2
    join public.regulatory_identities ri2 on ri2.id = a2.regulatory_identity_id
    where a2.fact_id = f.id
      and ri2.identity_key = case ri.identity_key when 'RFU-U12' then 'RFU-GIRLS-U12' else 'RFU-GIRLS-U14' end
  );
if v_count = 0 then
  raise notice 'PASS 32 (L): every U12/U14 Rules-of-Play fact applies to the girls band too';
else
  raise notice 'FAIL 32 (L): % fact(s) apply to the boys grade but not the girls band', v_count;
end if;

-- Same fact ids, so the values cannot diverge later.
select count(*) into v_count from (
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFU-U12' and f.fact_key like 'RFU-REG15-APP-%'
  except
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFU-GIRLS-U12' and f.fact_key like 'RFU-REG15-APP-%'
) x;
if v_count = 0 then
  raise notice 'PASS 33 (L): Girls U12 shares the IDENTICAL fact rows as U12 -- not copies';
else
  raise notice 'FAIL 33 (L): % U12 fact(s) are not shared with the girls band', v_count;
end if;

-- The one place the codes are NOT equal, and must not be: Appendix 9's
-- "Additional Law Variations applicable to U15 boys only".
if not exists (
  select 1 from public.regulatory_facts f
  join public.regulatory_fact_applicability a on a.fact_id = f.id
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  where f.fact_key = 'RFU-REG15-APP-U15-BOYS-SCRUM'
    and ri.identity_key like '%GIRLS%'
) then
  raise notice 'PASS 34 (L): the U15 boys-only scrum variation does NOT apply to any girls identity';
else
  raise notice 'FAIL 34 (L): a boys-only variation leaked onto a girls identity';
end if;

-- Every appendix fact carries a citation, and the girls-band ones additionally
-- cite the RFU clarification that justifies applying them.
select count(*) into v_count from public.regulatory_facts f
where f.fact_key like 'RFU-REG15-APP-%'
  and not exists (select 1 from public.regulatory_fact_citations c where c.fact_id = f.id);
if v_count = 0 then
  raise notice 'PASS 35 (L): every appendix-derived fact is cited';
else
  raise notice 'FAIL 35 (L): % appendix fact(s) are uncited', v_count;
end if;

select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where f.fact_key like 'RFU-REG15-APP-%' and ri.identity_key in ('RFU-GIRLS-U12','RFU-GIRLS-U14')
  and not exists (
    select 1 from public.regulatory_fact_citations c
    join public.regulatory_sources rs on rs.id = c.source_id
    where c.fact_id = f.id and rs.source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026'
  );
if v_count = 0 then
  raise notice 'PASS 36 (L): every girls-band fact cites the RFU clarification that justifies it';
else
  raise notice 'FAIL 36 (L): % girls-band fact(s) lack the clarification citation', v_count;
end if;

-- The clarification is explanatory guidance, never a source of rule VALUES.
if not exists (
  select 1 from public.regulatory_fact_citations c
  join public.regulatory_sources rs on rs.id = c.source_id
  where rs.source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026' and c.support_role = 'PRIMARY'
) then
  raise notice 'PASS 37 (L): the RFU verbal clarification is never cited as a PRIMARY source';
else
  raise notice 'FAIL 37 (L): an unpublished verbal clarification is being used as a primary rule source';
end if;

-- ============ K. The offering rule defaults POSITIVE ============

-- A type with no mapping row at all must still be offered -- silence must
-- never narrow availability. Proven with a real row rather than by reading
-- the view definition.
insert into public.canonical_team_types (key, label, category, age_group, gender, allows_squads, sort_order)
values ('ugdab-probe-unmapped', 'UGDAB Probe', 'youth', 'U17', 'girls', false, 9998)
returning id into v_type;

select count(*) into v_count
from public.canonical_team_types_by_code where id = v_type and is_offered;
if v_count = 2 then
  raise notice 'PASS 28 (K): a type with NO mapping row is offered for both codes (positive default)';
else
  raise notice 'FAIL 28 (K): an unmapped type is offered for only % code(s)', v_count;
end if;

-- RESEARCH_REQUIRED must not narrow either.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, mapping_state, notes)
values (v_type, 'union', 'RESEARCH_REQUIRED', 'probe');
select is_offered into v_ok from public.canonical_team_types_by_code where id = v_type and rugby_code = 'union';
if v_ok then
  raise notice 'PASS 29 (K): RESEARCH_REQUIRED still means OFFERED -- unresearched is not withheld';
else
  raise notice 'FAIL 29 (K): RESEARCH_REQUIRED silently withheld the type';
end if;

-- Only NOT_OFFERED withholds.
update public.regulatory_team_type_mappings set mapping_state = 'NOT_OFFERED', notes = 'probe'
where canonical_team_type_id = v_type and rugby_code = 'union';
select is_offered into v_ok from public.canonical_team_types_by_code where id = v_type and rugby_code = 'union';
if not v_ok then
  raise notice 'PASS 30 (K): NOT_OFFERED withholds it for union';
else
  raise notice 'FAIL 30 (K): NOT_OFFERED did not withhold the type';
end if;

select is_offered into v_ok from public.canonical_team_types_by_code where id = v_type and rugby_code = 'league';
if v_ok then
  raise notice 'PASS 31 (K): and league is STILL offered it -- withholding is per code';
else
  raise notice 'FAIL 31 (K): withholding from union also withheld it from league';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
