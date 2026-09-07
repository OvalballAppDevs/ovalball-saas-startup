-- ONE canonical Player regulatory-age resolver.
--
-- The three concepts this keeps apart: regulatory AGE (DOB + code + season),
-- operational TEAM IDENTITY (what the competition actually runs), and
-- PLACEMENT. A player can have a regulatory age for which their code runs no
-- team -- League Girls U17 in 2026 -- and the resolver must say so rather
-- than invent an identity or silently reassign them.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_league uuid; v_union uuid;
  v_n int; v_text text; v_key text; v_status text;
  r record;
begin

select id into v_league from public.seasons where rugby_code='league' and season_year_start=2026 and not is_regression_fixture limit 1;
select id into v_union  from public.seasons where rugby_code='union'  and season_year_start=2026 and not is_regression_fixture limit 1;

if v_league is null or v_union is null then
  raise notice 'SKIP (all): no 2026 season rows to resolve against';
  return;
end if;

-- ============ A. RFL F13 windows reproduced exactly ============

v_n := 0;
for r in select * from (values
  (6,'2019-09-01','2020-08-31'), (7,'2018-09-01','2019-08-31'), (9,'2016-09-01','2017-08-31'),
  (10,'2015-09-01','2016-08-31'), (11,'2014-09-01','2015-08-31'), (12,'2013-09-01','2014-08-31'),
  (13,'2012-09-01','2013-08-31'), (14,'2011-09-01','2012-08-31'), (15,'2010-09-01','2011-08-31'),
  (16,'2009-09-01','2010-08-31'), (17,'2008-09-01','2009-08-31'), (18,'2007-09-01','2008-08-31')
) as t(n, lo, hi)
loop
  if (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, r.lo::date)) = r.n
     and (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, r.hi::date)) = r.n then
    v_n := v_n + 1;
  end if;
end loop;
if v_n = 12 then
  raise notice 'PASS 1 (A): all 12 published RFL F13 season-2026 windows reproduced at BOTH boundaries';
else
  raise notice 'FAIL 1 (A): only % of 12 RFL windows reproduced', v_n;
end if;

-- One day either side of a boundary must land in different grades.
if (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, date '2014-08-31')) = 12
   and (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, date '2014-09-01')) = 11 then
  raise notice 'PASS 2 (A): 31 Aug / 1 Sep boundary splits U12 from U11 exactly';
else
  raise notice 'FAIL 2 (A): the 1 September boundary is wrong';
end if;

-- ============ B. The union/league offset ============

if (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, date '2013-09-01')) = 12
   and (select regulatory_age_number from public.resolve_player_regulatory_age('union', v_union, date '2013-09-01')) = 13 then
  raise notice 'PASS 3 (B): the SAME DOB is U12 in RFL 2026 and U13 in RFU 26/27 -- codes are offset by a school year';
else
  raise notice 'FAIL 3 (B): the union/league school-year offset is wrong';
end if;

-- Union must reproduce Regulation 15.6: U12 is Year 7.
select school_year into v_n from public.resolve_player_regulatory_age('union', v_union, date '2014-09-01');
if (select regulatory_age_label from public.resolve_player_regulatory_age('union', v_union, date '2014-09-01')) = 'U12'
   and v_n = 7 then
  raise notice 'PASS 4 (B): RFU 26/27 U12 is school Year 7, per Regulation 15.6';
else
  raise notice 'FAIL 4 (B): union U12 did not resolve to Year 7';
end if;

-- ============ C. No retired identity may be emitted ============

if not exists (
  select 1 from public.resolve_player_regulatory_age('union', v_union, date '2008-09-01')
  where regulatory_age_label in ('JuniorColts','SeniorColts')
) then
  raise notice 'PASS 5 (C): the resolver never emits a retired Colts identity';
else
  raise notice 'FAIL 5 (C): a retired Colts identity came back out of the resolver';
end if;

if regexp_replace(
     (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='resolve_player_age_grade'),
     '--[^\n]*','','g') !~* '(JuniorColts|SeniorColts)' then
  raise notice 'PASS 6 (C): the legacy age-grade shim no longer contains Colts logic';
else
  raise notice 'FAIL 6 (C): the legacy shim still emits Colts identities';
end if;

-- ============ D. Union girls dual age bands ============

select canonical_key, allocation_status into v_key, v_status
from public.resolve_normal_operational_identity('union', v_union, date '2013-09-01', 'girls');
if v_key = 'girls_u14' and v_status = 'NORMAL_PLACEMENT' then
  raise notice 'PASS 7 (D): a regulatory U13 union girl maps to the Girls U14 band, as a NORMAL placement';
else
  raise notice 'FAIL 7 (D): union U13 girl mapped to % (%)', coalesce(v_key,'nothing'), v_status;
end if;

select canonical_key into v_key from public.resolve_normal_operational_identity('union', v_union, date '2011-09-01', 'girls');
if v_key = 'girls_u16' then
  raise notice 'PASS 8 (D): a regulatory U15 union girl maps to the Girls U16 band';
else
  raise notice 'FAIL 8 (D): union U15 girl mapped to %', coalesce(v_key,'nothing');
end if;

select canonical_key into v_key from public.resolve_normal_operational_identity('union', v_union, date '2009-09-01', 'girls');
if v_key = 'girls_u18' then
  raise notice 'PASS 9 (D): a regulatory U17 union girl maps to the Girls U18 band';
else
  raise notice 'FAIL 9 (D): union U17 girl mapped to %', coalesce(v_key,'nothing');
end if;

-- The bands must never be created as identities.
if not exists (
  select 1 from public.canonical_team_types_by_code
  where rugby_code='union' and gender='girls' and age_group in ('U13','U15','U17') and is_offered
) then
  raise notice 'PASS 10 (D): banding did NOT manufacture Girls U13/U15/U17 for union';
else
  raise notice 'FAIL 10 (D): a union girls single-year identity was created';
end if;

-- ============ E. League girls: age exists, team does not ============

select canonical_key, allocation_status into v_key, v_status
from public.resolve_normal_operational_identity('league', v_league, date '2009-09-01', 'girls');
if v_key = 'girls_u16' and v_status = 'NORMAL_PLACEMENT' then
  raise notice 'PASS 11 (E): League Girls U16 EXISTS and resolves as a normal placement';
else
  raise notice 'FAIL 11 (E): league U16 girl mapped to % (%)', coalesce(v_key,'nothing'), v_status;
end if;

select regulatory_age_label, canonical_key, allocation_status into v_text, v_key, v_status
from public.resolve_normal_operational_identity('league', v_league, date '2008-09-01', 'girls');
if v_text = 'U17' and v_key is null and v_status = 'NEEDS_ATTENTION' then
  raise notice 'PASS 12 (E): a regulatory U17 league girl has NO operational team -- NEEDS_ATTENTION, nothing invented';
else
  raise notice 'FAIL 12 (E): league U17 girl resolved age=% team=% status=%', v_text, coalesce(v_key,'null'), v_status;
end if;

-- Specifically: not silently converted to U18, and no U17 identity created.
if (select canonical_key from public.resolve_normal_operational_identity('league', v_league, date '2008-09-01', 'girls')) is distinct from 'girls_u18' then
  raise notice 'PASS 13 (E): the U17 league girl was NOT silently placed into Girls U18';
else
  raise notice 'FAIL 13 (E): a U17 league girl was silently converted to Girls U18';
end if;

if not exists (select 1 from public.canonical_team_types where gender='girls' and age_group='U17') then
  raise notice 'PASS 14 (E): still no Girls U17 canonical identity anywhere';
else
  raise notice 'FAIL 14 (E): a Girls U17 identity was created';
end if;

-- A league BOY of the same age does have a team, which is the whole contrast.
select canonical_key into v_key from public.resolve_normal_operational_identity('league', v_league, date '2008-09-01', 'boys');
if v_key = 'u17' then
  raise notice 'PASS 15 (E): a league BOY of the same age maps to U17 -- the gap is girls-specific';
else
  raise notice 'FAIL 15 (E): league U17 boy mapped to %', coalesce(v_key,'nothing');
end if;

-- ============ F. Missing DOB is never guessed ============

select allocation_status into v_status
from public.resolve_normal_operational_identity('union', v_union, null::date, 'boys');
if v_status = 'DOB_REQUIRED' then
  raise notice 'PASS 16 (F): a missing date of birth returns DOB_REQUIRED -- never inferred from the current team';
else
  raise notice 'FAIL 16 (F): missing DOB returned %', v_status;
end if;

-- ============ G. Mixed rugby ends at U12 ============

select allocation_status into v_status
from public.resolve_normal_operational_identity('union', v_union, date '2014-09-01', 'mixed');
if v_status = 'NEEDS_ATTENTION' then
  raise notice 'PASS 17 (G): a mixed player reaching U12 needs a decision, not an automatic pick';
else
  raise notice 'FAIL 17 (G): mixed at U12 returned %', v_status;
end if;

select canonical_key into v_key
from public.resolve_normal_operational_identity('union', v_union, date '2016-09-01', 'mixed');
if v_key = 'u10' then
  raise notice 'PASS 18 (G): a mixed player below U12 still resolves normally';
else
  raise notice 'FAIL 18 (G): mixed below U12 mapped to %', coalesce(v_key,'nothing');
end if;

-- ============ H. The mapping uses canonical IDs, not built strings ============

if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='resolve_normal_operational_identity') ~ 'canonical_team_types_by_code'
   and (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='resolve_normal_operational_identity') !~ '''girls_u''\s*\|\|' then
  raise notice 'PASS 19 (H): the identity mapping reads the canonical directory and builds no keys by string';
else
  raise notice 'FAIL 19 (H): the identity mapping constructs canonical keys as strings';
end if;

-- Every resolved placement must return a real, offered canonical id.
select count(*) into v_n from (
  select o.canonical_team_type_id, d.code
  from (values ('union', date '2013-09-01','girls'), ('league', date '2009-09-01','girls'),
               ('league', date '2008-09-01','boys'), ('union', date '2014-09-01','boys')) as d(code, dob, gender)
  join public.seasons s on s.rugby_code = d.code and s.season_year_start = 2026 and not s.is_regression_fixture
  cross join lateral public.resolve_normal_operational_identity(d.code, s.id, d.dob, d.gender) o
) x
join public.canonical_team_types_by_code v on v.id = x.canonical_team_type_id and v.rugby_code = x.code
where not v.is_offered;
if v_n = 0 then
  raise notice 'PASS 20 (H): every resolved placement points at an identity that code actually offers';
else
  raise notice 'FAIL 20 (H): % placement(s) point at an identity not offered for that code', v_n;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
