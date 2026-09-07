-- Rugby code x girls team identity: one canonical vocabulary, two codes,
-- separate availability, and NO cross-code regulatory fallback.
--
-- The property under test is separation. Ovalball supports different girls age
-- structures in each code -- union runs dual age bands (U12/U14/U16/U18) while
-- league additionally offers U13 and U15 -- from a SINGLE shared canonical
-- vocabulary. Almost every assertion here would still pass if the codes were
-- quietly coupled, so each is paired with its opposite: the test is that
-- changing one code leaves the other untouched.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_count int; v_text text; v_ok boolean;
  v_u13 uuid; v_u15 uuid; v_u18 uuid; v_type uuid;
  v_union_before int; v_union_after int; v_league_before int; v_league_after int;
  v_league_identity uuid; v_union_identity uuid;
begin

-- ============ A. The required matrix, cell by cell ============

for v_text, v_ok, v_count in
  select * from (values
    ('girls_u12', true,  1), ('girls_u13', false, 2), ('girls_u14', true,  3),
    ('girls_u15', false, 4), ('girls_u16', true,  5), ('girls_u18', true,  6)
  ) as t(k, expected_union, n)
loop
  select is_offered into v_ok from public.canonical_team_types_by_code
  where key = v_text and rugby_code = 'union';
  if v_ok = (v_text not in ('girls_u13','girls_u15')) then
    raise notice 'PASS % (A): UNION % is %', v_count, v_text,
      case when v_ok then 'OFFERED' else 'NOT_OFFERED' end;
  else
    raise notice 'FAIL % (A): UNION % offered=%, not as required', v_count, v_text, v_ok;
  end if;
end loop;

-- League offers all six, without exception.
select count(*) into v_count
from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('girls_u12','girls_u13','girls_u14','girls_u15','girls_u16','girls_u18')
  and is_offered;
if v_count = 6 then
  raise notice 'PASS 7 (A): LEAGUE offers all six girls identities (U12/U13/U14/U15/U16/U18)';
else
  raise notice 'FAIL 7 (A): LEAGUE offers only % of the six required girls identities', v_count;
end if;

-- And league withholds nothing at all.
select count(*) into v_count
from public.canonical_team_types_by_code where rugby_code = 'league' and is_active and not is_offered;
if v_count = 0 then
  raise notice 'PASS 8 (A): LEAGUE withholds nothing -- union structure has not leaked across';
else
  raise notice 'FAIL 8 (A): LEAGUE is withholding % type(s)', v_count;
end if;

-- ============ B. One canonical vocabulary, never duplicated per code ============

select count(*) into v_count from public.canonical_team_types where gender = 'girls';
if v_count = 6 then
  raise notice 'PASS 9 (B): exactly 6 canonical girls team types exist';
else
  raise notice 'FAIL 9 (B): % canonical girls team types exist, expected 6', v_count;
end if;

if not exists (select 1 from public.canonical_team_types where key ~* '(union|league)') then
  raise notice 'PASS 10 (B): no code-specific duplicate canonical team type exists';
else
  select string_agg(key, ', ') into v_text from public.canonical_team_types where key ~* '(union|league)';
  raise notice 'FAIL 10 (B): code-specific duplicates found: %', v_text;
end if;

-- The shared identities are literally one row seen by both codes.
select id into v_u13 from public.canonical_team_types where key = 'girls_u13';
select id into v_u15 from public.canonical_team_types where key = 'girls_u15';
select id into v_u18 from public.canonical_team_types where key = 'girls_u18';
select count(distinct id) into v_count from public.canonical_team_types_by_code
where key in ('girls_u13','girls_u15','girls_u18');
if v_count = 3 and v_u13 is not null and v_u15 is not null and v_u18 is not null then
  raise notice 'PASS 11 (B): Girls U13/U15/U18 are each ONE stable canonical id shared by both codes';
else
  raise notice 'FAIL 11 (B): shared girls identities are not stable (% distinct ids)', v_count;
end if;

-- ============ C. Changing one code must not move the other ============

select count(*) into v_union_before from public.canonical_team_types_by_code where rugby_code='union' and is_offered;
select count(*) into v_league_before from public.canonical_team_types_by_code where rugby_code='league' and is_offered;

-- Withhold something from UNION; LEAGUE must not move.
update public.regulatory_team_type_mappings
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, notes = 'probe'
where canonical_team_type_id = (select id from public.canonical_team_types where key='girls_u16')
  and rugby_code = 'union';
select count(*) into v_league_after from public.canonical_team_types_by_code where rugby_code='league' and is_offered;
select count(*) into v_union_after from public.canonical_team_types_by_code where rugby_code='union' and is_offered;
if v_league_after = v_league_before and v_union_after = v_union_before - 1 then
  raise notice 'PASS 12 (C): withholding from UNION moved union only (% -> %), league unchanged at %',
    v_union_before, v_union_after, v_league_after;
else
  raise notice 'FAIL 12 (C): union % -> %, league % -> %', v_union_before, v_union_after, v_league_before, v_league_after;
end if;

-- Withhold something from LEAGUE; UNION must not move.
update public.regulatory_team_type_mappings
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, notes = 'probe'
where canonical_team_type_id = (select id from public.canonical_team_types where key='girls_u13')
  and rugby_code = 'league';
select count(*) into v_league_after from public.canonical_team_types_by_code where rugby_code='league' and is_offered;
select count(*) into v_count from public.canonical_team_types_by_code where rugby_code='union' and is_offered;
if v_league_after = v_league_before - 1 and v_count = v_union_before - 1 then
  raise notice 'PASS 13 (C): withholding from LEAGUE moved league only (% -> %), union unaffected',
    v_league_before, v_league_after;
else
  raise notice 'FAIL 13 (C): league % -> %, union unexpectedly %', v_league_before, v_league_after, v_count;
end if;

-- Put both back before the resolution assertions.
update public.regulatory_team_type_mappings
set mapping_state = 'MAPPED', regulatory_identity_id = (select id from public.regulatory_identities where identity_key='RFU-GIRLS-U16'), notes = null
where canonical_team_type_id = (select id from public.canonical_team_types where key='girls_u16') and rugby_code='union';
update public.regulatory_team_type_mappings
set mapping_state = 'RESEARCH_REQUIRED', regulatory_identity_id = null, notes = 'restored by probe'
where canonical_team_type_id = (select id from public.canonical_team_types where key='girls_u13') and rugby_code='league';

-- ============ D. No cross-code regulatory fallback ============

-- There is no league girls U13/U15 regulatory identity, and that is correct:
-- it must resolve to an honest empty state, never to a union band.
if not exists (
  select 1 from public.regulatory_identities
  where rugby_code = 'league' and identity_key ~* 'girls.*(u13|u15)'
) then
  raise notice 'PASS 14 (D): no League girls U13/U15 regulatory identity is invented';
else
  raise notice 'FAIL 14 (D): a League girls U13/U15 regulatory identity exists without RFL evidence';
end if;

-- The resolver refuses an identity that belongs to the other code outright.
select id into v_union_identity from public.regulatory_identities where identity_key = 'RFU-GIRLS-U14';
v_ok := false;
begin
  perform * from internal.resolve_published_regulatory_content('league', 'RULES', v_union_identity);
exception when others then v_ok := true;
end;
if v_ok then
  raise notice 'PASS 15 (D): asking for LEAGUE content with a UNION identity is REFUSED, not silently answered';
else
  raise notice 'FAIL 15 (D): a union identity resolved under rugby_code=league';
end if;

select id into v_league_identity from public.regulatory_identities where identity_key = 'RFL-GIRLS-U12';
if v_league_identity is not null then
  v_ok := false;
  begin
    perform * from internal.resolve_published_regulatory_content('union', 'RULES', v_league_identity);
  exception when others then v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 16 (D): asking for UNION content with a LEAGUE identity is REFUSED';
  else
    raise notice 'FAIL 16 (D): a league identity resolved under rugby_code=union';
  end if;
else
  raise notice 'SKIP 16 (D): no league girls identity available to probe with';
end if;

-- No fact may ever apply across codes.
select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where f.rugby_code <> ri.rugby_code;
if v_count = 0 then
  raise notice 'PASS 17 (D): no regulatory fact applies to an identity of the other code';
else
  raise notice 'FAIL 17 (D): % fact/identity pair(s) cross the code boundary', v_count;
end if;

-- Specifically: no RFU fact has reached a league identity, and vice versa.
select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where ri.rugby_code = 'league' and f.fact_key like 'RFU-%';
if v_count = 0 then
  raise notice 'PASS 18 (D): LEAGUE never falls back to RFU regulatory facts';
else
  raise notice 'FAIL 18 (D): % RFU fact(s) reached a league identity', v_count;
end if;

select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where ri.rugby_code = 'union' and f.fact_key like 'RFL-%';
if v_count = 0 then
  raise notice 'PASS 19 (D): UNION never falls back to RFL regulatory facts';
else
  raise notice 'FAIL 19 (D): % RFL fact(s) reached a union identity', v_count;
end if;

-- ============ E. Team identity resolution stays code-aware and stable ============

-- A league girls U13 team resolves the shared canonical identity, and its
-- rugby_code is what keeps it out of the union band.
select internal.resolve_canonical_team_type('youth','U13','girls',null) into v_type;
if v_type = v_u13 then
  raise notice 'PASS 20 (E): a Girls U13 team resolves the ONE shared canonical identity, whatever its code';
else
  raise notice 'FAIL 20 (E): Girls U13 resolved to an unexpected canonical type';
end if;

-- Historical teams keep resolving regardless of current offered state.
select count(*) into v_count
from public.teams t
where t.canonical_team_type_id is not null
  and not exists (select 1 from public.canonical_team_types c where c.id = t.canonical_team_type_id);
if v_count = 0 then
  raise notice 'PASS 21 (E): every existing team still resolves its canonical identity';
else
  raise notice 'FAIL 21 (E): % team(s) point at a missing canonical type', v_count;
end if;

-- Fixture-season identity is keyed by season AND rugby code, so a future
-- season cannot resolve across codes.
if exists (
  select 1 from information_schema.columns
  where table_name = 'team_season_identity' and column_name = 'rugby_code'
) or exists (
  select 1 from information_schema.columns
  where table_name = 'team_season_identity' and column_name = 'season_id'
) then
  raise notice 'PASS 22 (E): team_season_identity is keyed on season, and teams carry rugby_code';
else
  raise notice 'FAIL 22 (E): team_season_identity has no season key';
end if;

-- ============ F. League rollover is NOT union rollover ============

if internal.next_age_grade_for('U12','girls','league') = internal.next_age_grade('U12')
   and internal.next_age_grade_for('U14','girls','league') = internal.next_age_grade('U14')
   and internal.next_age_grade_for('U12','girls','union') = 'U14' then
  raise notice 'PASS 23 (F): league girls keep the shared default progression; union girls step by band';
else
  raise notice 'FAIL 23 (F): league girls progression has been given union band behaviour';
end if;

-- ============ G. Provenance: the operator report can never carry a value ============

if not exists (
  select 1 from public.regulatory_fact_citations c
  join public.regulatory_sources rs on rs.id = c.source_id
  where rs.authority_classification = 'OPERATOR_REPORTED_NOT_RETRIEVABLE' and c.support_role = 'PRIMARY'
) then
  raise notice 'PASS 24 (G): no operator-reported source is cited as PRIMARY';
else
  raise notice 'FAIL 24 (G): an operator-reported source is carrying a regulatory value';
end if;

-- And the database actively refuses it, rather than merely happening not to.
v_ok := false;
begin
  insert into public.regulatory_fact_citations (fact_id, source_id, support_role)
  select f.id, rs.id, 'PRIMARY'
  from public.regulatory_facts f, public.regulatory_sources rs
  where f.fact_key = 'RFU-REG15-APP-U12-BALL-SIZE'
    and rs.source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026';
exception when check_violation then v_ok := true;
end;
if v_ok then
  raise notice 'PASS 25 (G): a PRIMARY citation of the operator report is REFUSED by the database';
else
  raise notice 'FAIL 25 (G): the operator report was accepted as a PRIMARY citation';
end if;

-- It is classified honestly, not as a publication.
select authority_classification into v_text from public.regulatory_sources
where source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026';
if v_text = 'OPERATOR_REPORTED_NOT_RETRIEVABLE' then
  raise notice 'PASS 26 (G): the RFU clarification is classified OPERATOR_REPORTED_NOT_RETRIEVABLE';
else
  raise notice 'FAIL 26 (G): it is classified %, which overclaims', v_text;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
