-- Rugby League's senior structure: Men's Open Age and Women's Open Age.
--
-- WHAT THIS SETTLES
--
-- When League's later-youth identities were added, I kept Women's 1st/2nd/3rd
-- offered in BOTH codes and flagged it, because the catalogue brief listed
-- neither code's senior women and I would not delete women's senior rugby on
-- the strength of an omission. That question is now answered explicitly:
--
--   UNION SENIOR    Men's 1st/2nd/3rd, Women's 1st/2nd/3rd
--   LEAGUE SENIOR   Men's Open Age, Women's Open Age
--
-- So the numbered XVs are Union-only and the Open Age identities are
-- League-only. This adds the missing Women's Open Age identity and completes
-- the senior half of the code-specific matrix.
--
-- ONE IDENTITY, NOT ONE PER CODE
--
-- Women's Open Age is added once, as a stable canonical identity. There is no
-- league_womens_open_age or rfl_womens_open_age: the code-specific offering
-- architecture already expresses "exists globally, offered for League only",
-- and duplicating identities per code is precisely what that architecture
-- exists to avoid.
--
-- It takes B/C squads through the same structured mechanism as every other
-- squad-bearing identity, so a club can run Women's Open Age, Women's Open Age
-- B and an alias over the top without any of those becoming a separate
-- regulatory identity.
--
-- NO REGULATORY CONTENT IS POPULATED HERE. Operational availability and
-- regulatory coverage are separate concerns; the RFL Open Age rules, and any
-- published female variation, are researched through the League regulatory
-- architecture and never copied from the men's identity or from union.

-- ============================================================
-- 1. The missing identity.
-- ============================================================

insert into public.canonical_team_types (key, label, category, age_group, gender, allows_squads, sort_order)
values ('womens_open_age', 'Women''s Open Age', 'senior', null, 'womens', true, 30)
on conflict (key) do nothing;

insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, mapping_state, notes)
select ctt.id, c.code, 'RESEARCH_REQUIRED',
  'Created with the identity; the deliberate offering decision is applied below. Regulatory content for League Open Age is researched separately from first-party RFL material.'
from public.canonical_team_types ctt
cross join (values ('union'), ('league')) as c(code)
where ctt.key = 'womens_open_age'
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- ============================================================
-- 2. The senior half of the code matrix.
-- ============================================================

-- Open Age is League senior structure, not Union.
update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'Not a Rugby Union operational identity. Union senior rugby is organised as numbered XVs (Men''s and Women''s 1st/2nd/3rd); Open Age is the League structure. A Union club must never be offered an Open Age identity.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'union'
  and ctt.key in ('mens_open_age', 'womens_open_age');

-- The numbered XVs are Union senior structure, not League. This supersedes
-- the earlier decision to leave Women's 1st/2nd/3rd offered in both codes.
update public.regulatory_team_type_mappings m
set mapping_state = 'NOT_OFFERED', regulatory_identity_id = null, updated_at = now(),
    notes = 'Not a Rugby League operational identity. League senior rugby is organised as Open Age (Men''s and Women''s), not as numbered 1st/2nd/3rd XVs, which are Union structure. Additional League senior squads are represented through the B/C squad mechanism on the Open Age identity, never as separate numbered identities.'
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  and ctt.key in ('mens_1st', 'mens_2nd', 'mens_3rd', 'womens_1st', 'womens_2nd', 'womens_3rd');

-- League DOES run both Open Age identities.
update public.regulatory_team_type_mappings m
set notes = 'OPERATIONALLY OFFERED FOR RUGBY LEAGUE BY EXPLICIT PRODUCT REQUIREMENT (developer, 2026-09-07). Regulatory content is researched separately from first-party RFL material; no RFU senior fact may be copied here, and no men''s Open Age fact may be copied onto the women''s identity where the RFL publishes a female variation.',
    updated_at = now()
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  and ctt.key in ('mens_open_age', 'womens_open_age')
  and m.mapping_state <> 'NOT_OFFERED';

-- ============================================================
-- 3. Prove the complete senior matrix and the full catalogues.
-- ============================================================

do $$
declare v_union text; v_league text; v_bad text;
begin
  -- The senior matrix, exactly as specified.
  select string_agg(t.k || ':' || t.u || '/' || t.l, ' ' order by t.k) into v_bad
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
  if v_bad is not null then
    raise exception 'Senior code matrix is not the required state: %', v_bad;
  end if;

  -- And the full catalogues.
  select string_agg(key, ',' order by sort_order) into v_union
  from public.canonical_team_types_by_code where rugby_code = 'union' and is_offered;
  select string_agg(key, ',' order by sort_order) into v_league
  from public.canonical_team_types_by_code where rugby_code = 'league' and is_offered;

  if v_union <> 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,junior_colts,senior_colts,'
      || 'mens_1st,mens_2nd,mens_3rd,womens_1st,womens_2nd,womens_3rd,'
      || 'girls_u12,girls_u14,girls_u16,girls_u18' then
    raise exception 'UNION catalogue is not the required set: [%]', v_union;
  end if;

  if v_league <> 'u6,u7,u8,u9,u10,u11,u12,u13,u14,u15,u16,'
      || 'girls_u12,girls_u13,girls_u14,girls_u15,girls_u16,girls_u18,'
      || 'u17,u18,u19,mens_open_age,womens_open_age' then
    raise exception 'LEAGUE catalogue is not the required set: [%]', v_league;
  end if;

  -- One identity per concept, never one per code.
  if exists (select 1 from public.canonical_team_types where key ~* '(union|league|rfl|rfu)_') then
    raise exception 'A code-prefixed duplicate canonical identity exists.';
  end if;
  if (select count(*) from public.canonical_team_types where key like '%open_age%') <> 2 then
    raise exception 'Expected exactly two Open Age canonical identities (men''s and women''s).';
  end if;
end $$;
