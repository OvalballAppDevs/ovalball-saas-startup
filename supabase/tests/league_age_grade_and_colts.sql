-- Code-specific later-youth pathways, the exact signup catalogues, and the
-- RFL's published sex variation.
--
-- Union's later youth is Junior/Senior Colts; League's is U17/U18/U19 with
-- Open Age above it. They are analogous pathway stages held in ONE canonical
-- vocabulary, and the code decides which a club is shown. Every assertion
-- about one code is paired with its opposite, because the failure mode being
-- guarded against is coupling, not absence.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_count int; v_text text; v_ok boolean;
  v_expected_union text; v_expected_league text;
begin

-- ============ A. The exact signup catalogue, per code ============

v_expected_union := 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,junior_colts,senior_colts,'
  || 'mens_1st,mens_2nd,mens_3rd,womens_1st,womens_2nd,womens_3rd,'
  || 'girls_u12,girls_u14,girls_u16,girls_u18';
v_expected_league := 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,'
  || 'girls_u12,girls_u13,girls_u14,girls_u15,girls_u16,girls_u18,'
  || 'u17,u18,u19,mens_open_age,womens_open_age';

select string_agg(key, ',' order by sort_order) into v_text
from public.canonical_team_types_by_code where rugby_code = 'union' and is_offered;
if v_text = v_expected_union then
  raise notice 'PASS 1 (A): the UNION catalogue is exactly the required set';
else
  raise notice 'FAIL 1 (A): union catalogue is [%]', v_text;
end if;

select string_agg(key, ',' order by sort_order) into v_text
from public.canonical_team_types_by_code where rugby_code = 'league' and is_offered;
if v_text = v_expected_league then
  raise notice 'PASS 2 (A): the LEAGUE catalogue is exactly the required set';
else
  raise notice 'FAIL 2 (A): league catalogue is [%]', v_text;
end if;

-- ============ B. Colts are Union-only ============

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'union' and key in ('junior_colts','senior_colts') and is_offered;
if v_count = 2 then
  raise notice 'PASS 3 (B): Junior Colts and Senior Colts are offered in UNION';
else
  raise notice 'FAIL 3 (B): only % of the two Colts identities are offered in union', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('junior_colts','senior_colts') and is_offered;
if v_count = 0 then
  raise notice 'PASS 4 (B): NEITHER Colts identity is offered in LEAGUE -- a League team can never display "Colts"';
else
  raise notice 'FAIL 4 (B): % Colts identity/identities are offered in league', v_count;
end if;

-- ============ C. U17/U18/U19/Open Age are League-only ============

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('u17','u18','u19','mens_open_age') and is_offered;
if v_count = 4 then
  raise notice 'PASS 5 (C): U17, U18, U19 and Men''s Open Age are all offered in LEAGUE';
else
  raise notice 'FAIL 5 (C): only % of the four League identities are offered', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'union' and key in ('u17','u18','u19','mens_open_age') and is_offered;
if v_count = 0 then
  raise notice 'PASS 6 (C): NONE of them is offered in UNION -- Union keeps Colts and numbered XVs';
else
  raise notice 'FAIL 6 (C): % League-only identity/identities are offered in union', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('mens_1st','mens_2nd','mens_3rd') and is_offered;
if v_count = 0 then
  raise notice 'PASS 7 (C): the numbered Men''s XVs are not offered in LEAGUE';
else
  raise notice 'FAIL 7 (C): % numbered Men''s XV(s) offered in league', v_count;
end if;

-- ============ D. One vocabulary -- no per-code duplicates ============

if not exists (select 1 from public.canonical_team_types where key ~* '(union|league)_') then
  raise notice 'PASS 8 (D): no code-prefixed duplicate canonical team type exists';
else
  raise notice 'FAIL 8 (D): a code-prefixed canonical duplicate was created';
end if;

select count(*) into v_count from public.canonical_team_types where key in ('u17','u18','u19','mens_open_age');
if v_count = 4 then
  raise notice 'PASS 9 (D): U17/U18/U19/Open Age exist exactly once each in the shared vocabulary';
else
  raise notice 'FAIL 9 (D): % rows for the four new identities, expected 4', v_count;
end if;

-- ============ E. No Girls U17 crept in from the League youth table ============

if not exists (select 1 from public.canonical_team_types where gender = 'girls' and age_group = 'U17')
   and not exists (select 1 from public.regulatory_identities where identity_key ~* 'girls.*u17') then
  raise notice 'PASS 10 (E): no Girls U17 identity exists in either the catalogue or the regulatory model';
else
  raise notice 'FAIL 10 (E): a Girls U17 identity was introduced';
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code='league' and gender='girls' and is_offered;
if v_count = 6 then
  raise notice 'PASS 11 (E): LEAGUE offers exactly 6 girls identities (U12/U13/U14/U15/U16/U18)';
else
  raise notice 'FAIL 11 (E): league offers % girls identities, expected 6', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code='union' and gender='girls' and is_offered;
if v_count = 4 then
  raise notice 'PASS 12 (E): UNION still offers exactly 4 girls identities (U12/U14/U16/U18)';
else
  raise notice 'FAIL 12 (E): union offers % girls identities, expected 4', v_count;
end if;

-- ============ F. The RFL's published sex variation is preserved ============

-- Same value published for both sexes -> the SAME canonical fact row.
select count(*) into v_count from (
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFL-U14' and f.fact_type = 'MATCH_DURATION'
  intersect
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFL-GIRLS-U14' and f.fact_type = 'MATCH_DURATION'
) x;
if v_count = 1 then
  raise notice 'PASS 13 (F): U14 match duration is ONE shared fact row for both sexes (same published value)';
else
  raise notice 'FAIL 13 (F): U14 duration is not shared between the sexes (% shared row(s))', v_count;
end if;

-- Different value published -> emphatically NOT shared.
select count(*) into v_count from (
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFL-U14' and f.fact_type = 'BALL_SIZE'
  intersect
  select a.fact_id from public.regulatory_fact_applicability a
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  join public.regulatory_facts f on f.id = a.fact_id
  where ri.identity_key = 'RFL-GIRLS-U14' and f.fact_type = 'BALL_SIZE'
) x;
if v_count = 0 then
  raise notice 'PASS 14 (F): U14 ball size is NOT shared -- the RFL publishes a sex variation';
else
  raise notice 'FAIL 14 (F): the sexes share a ball-size fact despite RFL B2:2:2 differing';
end if;

select max(f.value_enum) into v_text from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id=f.id
join public.regulatory_identities ri on ri.id=a.regulatory_identity_id
where ri.identity_key='RFL-U14' and f.fact_type='BALL_SIZE';
if v_text = '5' then
  raise notice 'PASS 15 (F): male U14 ball size is 5, per RFL B2:2:2';
else
  raise notice 'FAIL 15 (F): male U14 ball size is %', v_text;
end if;

select max(f.value_enum) into v_text from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id=f.id
join public.regulatory_identities ri on ri.id=a.regulatory_identity_id
where ri.identity_key='RFL-GIRLS-U14' and f.fact_type='BALL_SIZE';
if v_text = '4' then
  raise notice 'PASS 16 (F): female U14 ball size is 4, per RFL B2:2:2 -- the variation survived population';
else
  raise notice 'FAIL 16 (F): female U14 ball size is %', v_text;
end if;

-- No female identity below U19 may carry the male size-5 fact.
select count(*) into v_count
from public.regulatory_fact_applicability a
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
join public.regulatory_facts f on f.id = a.fact_id
where f.fact_key = 'RFL-CGOR-2026-BALL-SIZE-MALE-U14-PLUS' and ri.identity_key like '%GIRLS%';
if v_count = 0 then
  raise notice 'PASS 17 (F): the male size-5 ball fact reaches no female identity';
else
  raise notice 'FAIL 17 (F): the male ball fact leaked onto % female identity/identities', v_count;
end if;

-- ============ G. Strict code isolation survives the League population ============

select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where ri.rugby_code = 'league' and f.fact_key like 'RFU-%';
if v_count = 0 then
  raise notice 'PASS 18 (G): no RFU fact reaches any League identity';
else
  raise notice 'FAIL 18 (G): % RFU fact(s) reached a League identity', v_count;
end if;

select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where ri.rugby_code = 'union' and f.fact_key like 'RFL-%';
if v_count = 0 then
  raise notice 'PASS 19 (G): no RFL fact reaches any Union identity';
else
  raise notice 'FAIL 19 (G): % RFL fact(s) reached a Union identity', v_count;
end if;

select count(*) into v_count
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
where f.rugby_code <> ri.rugby_code;
if v_count = 0 then
  raise notice 'PASS 20 (G): no fact applies across the rugby-code boundary at all';
else
  raise notice 'FAIL 20 (G): % cross-code fact/identity pair(s)', v_count;
end if;

-- League U17/U18 resolve their OWN identity, never a Union Colts one.
select ri.identity_key into v_text
from public.regulatory_identities ri
join public.canonical_team_types ctt on ctt.id = ri.ovalball_canonical_team_type_id
where ctt.key = 'u17' and ri.rugby_code = 'league';
if v_text = 'RFL-U17' then
  raise notice 'PASS 21 (G): League U17 maps to RFL-U17, not a Union Colts identity';
else
  raise notice 'FAIL 21 (G): League U17 maps to %', coalesce(v_text, '(nothing)');
end if;

if not exists (
  select 1 from public.regulatory_identities ri
  join public.canonical_team_types ctt on ctt.id = ri.ovalball_canonical_team_type_id
  where ctt.key in ('junior_colts','senior_colts') and ri.rugby_code = 'league'
) then
  raise notice 'PASS 22 (G): no League regulatory identity is attached to a Colts canonical type';
else
  raise notice 'FAIL 22 (G): a League identity is attached to a Colts type';
end if;

-- ============ I. Senior structure is code-specific ============

-- Union: numbered XVs. League: Open Age. Neither may cross.
select string_agg(t.k || ':' || t.u || '/' || t.l, ' ' order by t.k) into v_text
from (
  select ctt.key k,
    (select case when v.is_offered then 'U' else '-' end from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'union') u,
    (select case when v.is_offered then 'L' else '-' end from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'league') l
  from public.canonical_team_types ctt where ctt.category = 'senior'
) t
where (t.k, t.u, t.l) not in (
  ('mens_1st','U','-'), ('mens_2nd','U','-'), ('mens_3rd','U','-'),
  ('womens_1st','U','-'), ('womens_2nd','U','-'), ('womens_3rd','U','-'),
  ('mens_open_age','-','L'), ('womens_open_age','-','L')
);
if v_text is null then
  raise notice 'PASS 24 (I): the senior matrix is exactly Union=numbered XVs, League=Open Age';
else
  raise notice 'FAIL 24 (I): senior matrix deviates: %', v_text;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('mens_open_age','womens_open_age') and is_offered;
if v_count = 2 then
  raise notice 'PASS 25 (I): LEAGUE offers BOTH Men''s and Women''s Open Age';
else
  raise notice 'FAIL 25 (I): league offers only % Open Age identity/identities', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'union' and key in ('mens_open_age','womens_open_age') and is_offered;
if v_count = 0 then
  raise notice 'PASS 26 (I): UNION offers NEITHER Open Age identity';
else
  raise notice 'FAIL 26 (I): union offers % Open Age identity/identities', v_count;
end if;

select count(*) into v_count from public.canonical_team_types_by_code
where rugby_code = 'league' and key in ('womens_1st','womens_2nd','womens_3rd') and is_offered;
if v_count = 0 then
  raise notice 'PASS 27 (I): the numbered Women''s XVs are Union-only';
else
  raise notice 'FAIL 27 (I): % numbered Women''s XV(s) offered in league', v_count;
end if;

-- Open Age carries B/C squads rather than spawning numbered identities.
select bool_and(allows_squads) into v_ok from public.canonical_team_types
where key in ('mens_open_age','womens_open_age');
if v_ok then
  raise notice 'PASS 28 (I): both Open Age identities take B/C squads -- extra squads never become new identities';
else
  raise notice 'FAIL 28 (I): an Open Age identity does not allow squads';
end if;

-- One identity per concept, not one per code.
select count(*) into v_count from public.canonical_team_types where key like '%open_age%';
if v_count = 2 then
  raise notice 'PASS 29 (I): exactly two Open Age canonical identities exist -- no per-code duplicates';
else
  raise notice 'FAIL 29 (I): % Open Age canonical identities exist', v_count;
end if;

-- ============ J. Stable identity is not the display name ============

-- Renaming must not move the identity, its code offering or its branch.
update public.canonical_team_types set label = 'ZZZ Renamed Probe' where key = 'womens_open_age';
select string_agg(t.k || ':' || t.u || '/' || t.l, ' ') into v_text
from (
  select ctt.key k,
    (select case when v.is_offered then 'U' else '-' end from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'union') u,
    (select case when v.is_offered then 'L' else '-' end from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'league') l
  from public.canonical_team_types ctt where ctt.key = 'womens_open_age'
) t;
if v_text = 'womens_open_age:-/L' then
  raise notice 'PASS 30 (J): renaming the display label changed neither the stable key nor the code offering';
else
  raise notice 'FAIL 30 (J): renaming moved the identity: %', v_text;
end if;

select category || '/' || coalesce(age_group,'-') || '/' || coalesce(gender,'-') into v_text
from public.canonical_team_types where key = 'womens_open_age';
if v_text = 'senior/-/womens' then
  raise notice 'PASS 31 (J): renaming changed no branch field (category/age/gender intact)';
else
  raise notice 'FAIL 31 (J): renaming changed the branch to %', v_text;
end if;

-- ============ H. Existing teams keep resolving ============

select count(*) into v_count
from public.teams t
where t.canonical_team_type_id is not null
  and not exists (select 1 from public.canonical_team_types c where c.id = t.canonical_team_type_id);
if v_count = 0 then
  raise notice 'PASS 23 (H): every existing team still resolves its canonical identity';
else
  raise notice 'FAIL 23 (H): % team(s) point at a missing canonical type', v_count;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
