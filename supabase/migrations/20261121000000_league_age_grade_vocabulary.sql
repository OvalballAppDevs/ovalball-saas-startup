-- Rugby League's later-youth and Open Age identities, and the code-specific
-- catalogue split.
--
-- THE PATHWAYS ARE GENUINELY DIFFERENT
--
-- Union's later youth is Junior Colts and Senior Colts -- club terminology
-- Ovalball already supports. League's is Under 17, Under 18 and Under 19, and
-- its senior male identity is Open Age rather than numbered XVs.
--
-- These correspond as pathway STAGES and are not interchangeable records. A
-- League team must never display "Junior Colts", and a Union team must never
-- display "Under 17" in its place. Rugby code decides the operational
-- identity; the canonical vocabulary holds both without duplication, and the
-- existing per-code offering decides which a club is shown.
--
-- WHAT THIS ADDS
--
--   u17            League later youth (Year 12)
--   u18            League later youth (Year 13)
--   u19            League, above school age
--   mens_open_age  League senior male
--
-- and withholds Colts and the numbered Men's XVs from League, and the new
-- League identities from Union.
--
-- WOMEN'S SENIOR TEAMS ARE DELIBERATELY LEFT ALONE. The catalogue brief that
-- prompted this listed Union as mini/boys/senior-men/girls and League as
-- mini/boys/girls/open-age, mentioning senior women in neither. Treating that
-- omission as an instruction would delete women's senior rugby from both
-- codes on the strength of a list that did not mention it -- exactly the
-- silent narrowing this whole architecture exists to prevent. Women's 1st/2nd/
-- 3rd stay offered in both codes and the question is raised in the report.

-- ============================================================
-- 1. Widen the structure rules only as far as the new identities need.
-- ============================================================

alter table public.canonical_team_types drop constraint if exists canonical_team_types_structure_check;
alter table public.canonical_team_types add constraint canonical_team_types_structure_check
  check (
    (category = 'colts' and age_group in ('JuniorColts', 'SeniorColts') and gender is null
      and fixed_squad_designation is null and allows_squads = false)
    or (
      -- Senior. Historically every senior identity was a numbered XV with a
      -- fixed ordinal and no B/C. League's Open Age is a single identity that
      -- DOES take B/C squads, so an un-numbered senior type is now valid
      -- provided it opts into squads -- one shape or the other, never both.
      category = 'senior' and age_group is null and gender in ('mens', 'womens')
      and (
        (fixed_squad_designation is not null and allows_squads = false)
        or (fixed_squad_designation is null and allows_squads = true)
      )
    )
    or (
      category = 'youth'
      -- U19 added: League runs it, and it is above school age.
      and age_group in ('U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18','U19')
      and fixed_squad_designation is null
      and (
        gender in ('boys', 'girls')
        or (gender = 'mixed' and age_group in ('U6','U7','U8','U9','U10','U11'))
      )
    )
  );

-- teams.age_group must accept U19 too, or a League U19 team cannot be created.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'teams_age_group_check') then
    alter table public.teams drop constraint teams_age_group_check;
  end if;
  alter table public.teams add constraint teams_age_group_check
    check (age_group is null or age_group in
      ('U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18','U19','JuniorColts','SeniorColts'));
end $$;

-- ============================================================
-- 2. The four new canonical identities. One vocabulary, no code prefixes.
-- ============================================================

insert into public.canonical_team_types (key, label, category, age_group, gender, allows_squads, sort_order) values
  ('u17', 'U17', 'youth', 'U17', 'boys', true, 26),
  ('u18', 'U18', 'youth', 'U18', 'boys', true, 27),
  ('u19', 'U19', 'youth', 'U19', 'boys', true, 28),
  ('mens_open_age', 'Men''s Open Age', 'senior', null, 'mens', true, 29)
on conflict (key) do nothing;

-- ============================================================
-- 3. Code-specific offering. Every row below is a deliberate product
--    statement with a reason, not a default.
-- ============================================================

-- Mapping rows must exist for both codes before any can be set.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, mapping_state, notes)
select ctt.id, c.code, 'RESEARCH_REQUIRED',
  'Created with the identity; the deliberate offering decision is applied immediately below.'
from public.canonical_team_types ctt
cross join (values ('union'), ('league')) as c(code)
where ctt.key in ('u17', 'u18', 'u19', 'mens_open_age')
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- Union does not run U17/U18/U19 or Open Age as operational identities: its
-- later youth is Junior/Senior Colts and its senior male teams are numbered.
update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'Not a Rugby Union operational identity. Union''s later youth pathway is Junior Colts and Senior Colts, and its senior male identities are the numbered Men''s XVs. U17/U18/U19 and Open Age are the LEAGUE equivalents -- corresponding pathway stages, not interchangeable records. A Union club must never be offered these labels.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'union'
  and ctt.key in ('u17', 'u18', 'u19', 'mens_open_age');

-- League does not run Colts or numbered Men's XVs.
update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'Not a Rugby League operational identity. "Junior Colts" and "Senior Colts" are Rugby Union club terminology; League''s equivalent later-youth stages are Under 17 and Under 18. A League team must never display a Colts label.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  and ctt.key in ('junior_colts', 'senior_colts');

update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'Not a Rugby League operational identity. League''s senior male identity is Men''s Open Age -- a single identity carrying B/C squads through the existing squad architecture -- rather than numbered Men''s 1st/2nd/3rd XVs, which are Union structure.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  and ctt.key in ('mens_1st', 'mens_2nd', 'mens_3rd');

-- League DOES run U17/U18/U19 and Open Age. Regulatory content for them is a
-- separate matter and is populated from RFL evidence, never inferred.
update public.regulatory_team_type_mappings m
set notes = 'OPERATIONALLY OFFERED FOR RUGBY LEAGUE BY EXPLICIT PRODUCT REQUIREMENT (developer, 2026-09-07). Regulatory content is populated separately from first-party RFL material; no RFU value may ever be copied onto this identity.',
    updated_at = now()
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  and ctt.key in ('u17', 'u18', 'u19', 'mens_open_age');

-- ============================================================
-- 4. Prove the exact required catalogues, per code.
-- ============================================================

do $$
declare v_union text; v_league text; v_expected_union text; v_expected_league text;
begin
  select string_agg(key, ',' order by sort_order) into v_union
  from public.canonical_team_types_by_code where rugby_code = 'union' and is_offered;
  select string_agg(key, ',' order by sort_order) into v_league
  from public.canonical_team_types_by_code where rugby_code = 'league' and is_offered;

  v_expected_union := 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,junior_colts,senior_colts,'
    || 'mens_1st,mens_2nd,mens_3rd,womens_1st,womens_2nd,womens_3rd,'
    || 'girls_u12,girls_u14,girls_u16,girls_u18';

  v_expected_league := 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,'
    || 'womens_1st,womens_2nd,womens_3rd,'
    || 'girls_u12,girls_u13,girls_u14,girls_u15,girls_u16,girls_u18,'
    || 'u17,u18,u19,mens_open_age';

  if v_union <> v_expected_union then
    raise exception 'UNION catalogue is not the required set. got=[%] want=[%]', v_union, v_expected_union;
  end if;
  if v_league <> v_expected_league then
    raise exception 'LEAGUE catalogue is not the required set. got=[%] want=[%]', v_league, v_expected_league;
  end if;

  -- Colts are union-only; U17/U18/U19/Open Age are league-only.
  if exists (select 1 from public.canonical_team_types_by_code
             where rugby_code = 'league' and is_offered and key in ('junior_colts','senior_colts','mens_1st','mens_2nd','mens_3rd')) then
    raise exception 'League is being offered Union-only identities.';
  end if;
  if exists (select 1 from public.canonical_team_types_by_code
             where rugby_code = 'union' and is_offered and key in ('u17','u18','u19','mens_open_age')) then
    raise exception 'Union is being offered League-only identities.';
  end if;

  -- The girls matrix must be untouched by any of this.
  if (select count(*) from public.canonical_team_types_by_code
      where rugby_code='union' and gender='girls' and is_offered) <> 4
     or (select count(*) from public.canonical_team_types_by_code
      where rugby_code='league' and gender='girls' and is_offered) <> 6 then
    raise exception 'The girls availability matrix moved while adding League identities.';
  end if;

  -- No Girls U17 may be introduced from the League youth table.
  if exists (select 1 from public.canonical_team_types where gender='girls' and age_group='U17') then
    raise exception 'A Girls U17 identity was introduced; the required League girls set is U12/U13/U14/U15/U16/U18 only.';
  end if;
end $$;
