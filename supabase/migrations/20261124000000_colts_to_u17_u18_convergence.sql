-- Junior/Senior Colts converge onto the canonical U17 and U18 identities.
--
-- THE EVIDENCE
--
-- RFU Regulation 15, 2026/27 edition (Effective 1 August 2026), section 15.6
-- "Playing Out of Age Grade -- Male Players" lists the age grades by school
-- year, and its later-youth rows read:
--
--   U17s (Yr 12)
--   U18s (Yr 13)
--
-- alongside U12s (Yr 7) through U16s (Yr 11) and U19s. There is no "Junior
-- Colts" or "Senior Colts" row.
--
-- Corroborated by absence across the whole corpus: "Colts" appears ZERO times
-- in 280,972 characters of official RFU regulation text (Regulations 3, 5, 6,
-- 7 and 8 plus Regulation 15 Appendices 1-9), and zero times in the nine
-- appendix captures. Appendix 9 scopes itself "U15 to U18". The RFU's own
-- terminology is U17 and U18; Colts is club vernacular Ovalball inherited.
--
-- SO THE GOVERNING TERMINOLOGY WINS -- BUT ONLY ONCE
--
-- League work already created canonical u17 and u18. Renaming junior_colts to
-- "Under 17" would leave TWO canonical identities displaying the same name,
-- which is exactly the duplicate this platform's one-directory invariant
-- forbids. So the Colts identities converge ONTO the existing u17/u18 rows
-- rather than being relabelled.
--
--   ONE canonical u17, offered for BOTH codes
--   ONE canonical u18, offered for BOTH codes
--
-- Shared operational identity does NOT mean shared rules. Regulatory content
-- and season progression stay strictly code-specific: canonical U17 + union
-- resolves RFU rules, canonical U17 + league resolves RFL rules, and neither
-- ever falls back to the other.

-- ============================================================
-- 1. Union regulatory identities for U17 and U18.
-- ============================================================

insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id, mapping_notes, source_register_reference)
select 'union', v.identity_key, v.label, 'DIRECT', ctt.id, v.notes, 'RFU Regulation 15.6 (Effective 1 August 2026)'
from (values
  ('RFU-U17','RFU Age Grade U17 (Year 12)','u17','Regulation 15.6 male table, "U17s (Yr 12)". Rules of Play come from Appendix 9, which scopes itself U15-U18 for boys and girls. Ovalball previously called this Junior Colts, which is club vernacular and appears nowhere in RFU regulation.'),
  ('RFU-U18','RFU Age Grade U18 (Year 13)','u18','Regulation 15.6 male table, "U18s (Yr 13)". Rules of Play come from Appendix 9. Ovalball previously called this Senior Colts.')
) as v(identity_key, label, team_type_key, notes)
join public.canonical_team_types ctt on ctt.key = v.team_type_key
on conflict (identity_key) do nothing;

-- Appendix 9 governs U15-U18, so the U17/U18 union identities inherit the
-- facts already extracted from it. One fact, more identities -- never copies.
insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
select f.id, ri.id
from public.regulatory_facts f
join public.regulatory_fact_applicability a on a.fact_id = f.id
join public.regulatory_identities src on src.id = a.regulatory_identity_id
join public.regulatory_identities ri on ri.identity_key in ('RFU-U17', 'RFU-U18')
where src.identity_key = 'RFU-U16'
  and f.fact_key like 'RFU-REG15-APP-U15-U18-%'
on conflict do nothing;

-- ============================================================
-- 2. Open U17/U18 to Union. They were League-only.
-- ============================================================

update public.regulatory_team_type_mappings m
set mapping_state = 'MAPPED',
    regulatory_identity_id = ri.id,
    notes = null,
    updated_at = now()
from public.canonical_team_types ctt, public.regulatory_identities ri
where m.canonical_team_type_id = ctt.id
  and m.rugby_code = 'union'
  and ctt.key in ('u17', 'u18')
  and ri.identity_key = 'RFU-' || upper(ctt.key);

-- ============================================================
-- 3. Migrate any operational team off the legacy identities.
--
--    team_id is never touched, so fixtures, memberships, training,
--    attendance, permissions, season history and audit all survive: they
--    reference the team, and the team keeps its identity. What changes is
--    which canonical row that team points AT.
--
--    Zero teams currently sit on Colts locally, but this runs anyway so the
--    migration is correct wherever it is applied.
-- ============================================================

do $$
declare
  v_moved int := 0;
  v_n int;
begin
  for v_n in
    select 1 from public.canonical_team_types where key in ('junior_colts','senior_colts')
  loop
    null;
  end loop;

  update public.teams t
  set canonical_team_type_id = target.id,
      category = 'youth',
      age_group = case when legacy.key = 'junior_colts' then 'U17' else 'U18' end,
      gender = coalesce(t.gender, 'boys'),
      updated_at = now()
  from public.canonical_team_types legacy, public.canonical_team_types target
  where t.canonical_team_type_id = legacy.id
    and legacy.key in ('junior_colts', 'senior_colts')
    and target.key = case when legacy.key = 'junior_colts' then 'u17' else 'u18' end;
  get diagnostics v_moved = row_count;

  -- Teams that carry the old age_group without a canonical link.
  update public.teams t
  set category = 'youth',
      age_group = case when t.age_group = 'JuniorColts' then 'U17' else 'U18' end,
      gender = coalesce(t.gender, 'boys'),
      canonical_team_type_id = coalesce(
        t.canonical_team_type_id,
        (select id from public.canonical_team_types where key = case when t.age_group = 'JuniorColts' then 'u17' else 'u18' end)
      ),
      updated_at = now()
  where t.age_group in ('JuniorColts', 'SeniorColts');
  get diagnostics v_n = row_count;

  raise notice 'Colts convergence: % team(s) repointed by canonical link, % by age_group.', v_moved, v_n;

  update public.tournament_participants tp
  set canonical_team_type_id = target.id
  from public.canonical_team_types legacy, public.canonical_team_types target
  where tp.canonical_team_type_id = legacy.id
    and legacy.key in ('junior_colts', 'senior_colts')
    and target.key = case when legacy.key = 'junior_colts' then 'u17' else 'u18' end;
end $$;

-- ============================================================
-- 4. Retire the legacy identities. Deactivated, never deleted -- historical
--    references must stay resolvable.
-- ============================================================

update public.canonical_team_types
set is_active = false,
    label = case key when 'junior_colts' then 'Junior Colts (retired -- now U17)' else 'Senior Colts (retired -- now U18)' end,
    updated_at = now()
where key in ('junior_colts', 'senior_colts');

update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'RETIRED 2026-09-07. Converged onto the canonical U17/U18 identities, which is the RFU''s own terminology: Regulation 15.6 (2026/27) lists "U17s (Yr 12)" and "U18s (Yr 13)", and "Colts" appears nowhere in RFU regulation. The row is kept inactive so historical references stay resolvable; it must never be offered again.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and ctt.key in ('junior_colts', 'senior_colts');

update public.regulatory_identities
set label = 'Ovalball Senior Colts (retired -- superseded by RFU-U18)',
    mapping_notes = 'RETIRED 2026-09-07. Ovalball''s Colts terminology has been converged onto the RFU''s own U17/U18 age grades. Kept for historical referential integrity only; RFU-U18 is the live identity.',
    updated_at = now()
where identity_key = 'RFU-SENIOR-COLTS';

-- ============================================================
-- 5. Compatibility translation for legacy payloads.
--
--    Old imports, URLs and API bodies may still say JuniorColts/SeniorColts.
--    The resolver translates them to the canonical current identity rather
--    than resurrecting a second live catalogue.
-- ============================================================

create or replace function internal.resolve_canonical_team_type(p_category text, p_age_group text, p_gender text, p_squad_designation text)
returns uuid
language sql
stable
as $$
  with normalised as (
    select
      -- Legacy Colts inputs translate to the canonical age grades. This is a
      -- one-way compatibility shim, not a live alternative vocabulary.
      case when p_age_group in ('JuniorColts','SeniorColts') then 'youth' else p_category end as category,
      case p_age_group when 'JuniorColts' then 'U17' when 'SeniorColts' then 'U18' else p_age_group end as age_group,
      case when p_age_group in ('JuniorColts','SeniorColts') then coalesce(nullif(p_gender,''), 'boys') else p_gender end as gender
  )
  select ctt.id
  from public.canonical_team_types ctt, normalised n
  where ctt.category = n.category
    and (
      (n.category = 'senior' and ctt.gender = n.gender
        and (ctt.fixed_squad_designation = coalesce(nullif(p_squad_designation, ''), '1st') or ctt.fixed_squad_designation is null))
      or (n.category = 'colts' and ctt.age_group = n.age_group)
      or (n.category = 'youth' and ctt.age_group = n.age_group
          and ctt.gender = case when n.gender = 'girls' then 'girls' else ctt.gender end)
    )
  -- An EXACT gender match wins. Several age grades now exist in both a boys
  -- and a girls form (U12, U14, U16, U18), so the loose youth match above can
  -- return two rows; without this a "boys U18" lookup could land on Girls U18
  -- purely because it sorts earlier. Active rows are preferred over retired
  -- ones, so a retired identity is only returned when nothing live matches --
  -- which keeps history resolvable without offering it.
  order by (ctt.gender is not distinct from n.gender) desc, ctt.is_active desc, ctt.sort_order
  limit 1;
$$;

comment on function internal.resolve_canonical_team_type(text, text, text, text) is
  'Resolves structured team fields onto a canonical identity. Legacy JuniorColts/SeniorColts inputs are translated to U17/U18 -- a one-way compatibility shim for old payloads, never a second live vocabulary. Active identities are preferred over retired ones, so a retired row is only ever returned when nothing active matches, which keeps historical rows resolvable without offering them.';

-- ============================================================
-- 6. Code-specific progression. Sharing an identity must not share a pathway.
-- ============================================================

create or replace function internal.next_age_grade_for(p_age_group text, p_gender text, p_rugby_code text)
returns text
language sql
immutable
as $$
  select case
    -- Union girls move band to band; U18 is the last, then adult women's.
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group in ('U12','U14','U16','U18') then
      case p_age_group when 'U12' then 'U14' when 'U14' then 'U16' when 'U16' then 'U18' else null end
    when p_gender = 'girls' and p_rugby_code = 'union' and p_age_group = 'U11' then 'U12'

    -- Union later youth stops at U18: the step beyond is senior rugby, which
    -- is a manual decision, not a mechanical roll.
    when p_rugby_code = 'union' and p_age_group = 'U16' then 'U17'
    when p_rugby_code = 'union' and p_age_group = 'U17' then 'U18'
    when p_rugby_code = 'union' and p_age_group = 'U18' then null

    -- League runs one grade further before Open Age. Union must never enter
    -- this pathway, which is why the code is tested and not just the age.
    when p_rugby_code = 'league' and p_age_group = 'U16' then 'U17'
    when p_rugby_code = 'league' and p_age_group = 'U17' then 'U18'
    when p_rugby_code = 'league' and p_age_group = 'U18' then 'U19'
    when p_rugby_code = 'league' and p_age_group = 'U19' then null

    else internal.next_age_grade(p_age_group)
  end;
$$;

comment on function internal.next_age_grade_for(text, text, text) is
  'Code-specific age-grade succession. Union girls step U12->U14->U16->U18 (RFU Regulation 15.6 dual age bands). Union boys run U16->U17->U18 and stop, because the step into senior rugby is a decision rather than a rollover. League runs U16->U17->U18->U19 and stops before Open Age. U17 and U18 are the SAME canonical identity in both codes but emphatically NOT the same pathway -- Union U18 must never roll into League U19.';

-- ============================================================
-- 7. Guards.
-- ============================================================

do $$
declare v_n int; v_union text; v_league text;
begin
  -- Exactly one live U17 and one live U18.
  select count(*) into v_n from public.canonical_team_types where key in ('u17','u18') and is_active;
  if v_n <> 2 then raise exception 'Expected exactly one active U17 and one active U18, found % active row(s).', v_n; end if;

  if exists (select 1 from public.canonical_team_types where key in ('junior_colts','senior_colts') and is_active) then
    raise exception 'A legacy Colts identity is still active.';
  end if;

  -- No live duplicate display names.
  select count(*) into v_n from (
    select label from public.canonical_team_types where is_active group by label having count(*) > 1
  ) d;
  if v_n > 0 then raise exception '% duplicated display label(s) among active canonical identities.', v_n; end if;

  -- Both codes offer U17 and U18 now.
  select count(*) into v_n from public.canonical_team_types_by_code
  where key in ('u17','u18') and is_offered;
  if v_n <> 4 then raise exception 'U17/U18 are not offered for both codes (% of 4 cells offered).', v_n; end if;

  -- Nothing may be left pointing at a retired Colts identity.
  select count(*) into v_n from public.teams t
  join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
  where ctt.key in ('junior_colts','senior_colts');
  if v_n > 0 then raise exception '% team(s) still reference a retired Colts identity.', v_n; end if;
  if exists (select 1 from public.teams where age_group in ('JuniorColts','SeniorColts')) then
    raise exception 'A team still carries a Colts age_group.';
  end if;

  -- The catalogues.
  select string_agg(key, ',' order by sort_order) into v_union
  from public.canonical_team_types_by_code where rugby_code = 'union' and is_offered;
  select string_agg(key, ',' order by sort_order) into v_league
  from public.canonical_team_types_by_code where rugby_code = 'league' and is_offered;

  if v_union <> 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,mens_1st,mens_2nd,mens_3rd,'
      || 'womens_1st,womens_2nd,womens_3rd,girls_u12,girls_u14,girls_u16,girls_u18,u17,u18' then
    raise exception 'UNION catalogue is not the required set: [%]', v_union;
  end if;
  if v_league <> 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,'
      || 'girls_u12,girls_u13,girls_u14,girls_u15,girls_u16,girls_u18,'
      || 'u17,u18,u19,mens_open_age,womens_open_age' then
    raise exception 'LEAGUE catalogue is not the required set: [%]', v_league;
  end if;

  -- Progression stays code-specific despite the shared identity.
  if internal.next_age_grade_for('U18','boys','union') is not null then
    raise exception 'Union U18 progresses onward; it must stop before senior rugby.';
  end if;
  if internal.next_age_grade_for('U18','boys','league') <> 'U19' then
    raise exception 'League U18 does not progress to U19.';
  end if;
end $$;
