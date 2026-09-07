-- Rugby Hub regulatory coverage: every canonical team type resolves
-- DELIBERATELY.
--
-- The regression this exists to catch is quiet and easy to cause: somebody
-- adds a canonical team type (a new age grade, a new women's XV) and Rugby
-- Hub resolves it to nothing. No error, no empty state -- just a page that
-- says less than it should to a real child's parent.
--
-- Phase 4A does NOT require every identity to have published facts. It
-- requires every identity to have an explicit, explained mapping STATE.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Rugby Hub regulatory coverage ==='

begin;

do $$
declare
  v_n int; v_r record; v_missing text;
begin
  -- =================================================================
  -- A. No accidental nulls
  -- =================================================================
  select count(*) into v_n from public.regulatory_coverage_report() where mapping_state = 'UNMAPPED';
  if v_n = 0 then
    raise notice 'PASS 1 (A): every canonical team type resolves deliberately in BOTH rugby codes';
  else
    select string_agg(team_type_key || '/' || rugby_code, ', ') into v_missing
    from public.regulatory_coverage_report() where mapping_state = 'UNMAPPED';
    raise exception 'FAIL 1 (A): % team type/code pair(s) resolve to nothing: %', v_n, v_missing;
  end if;

  -- Every active team type is covered in both codes -- 2 rows each, no more.
  select count(*) into v_n from public.canonical_team_types where is_active;
  if (select count(*) from public.regulatory_coverage_report()) = v_n * 2 then
    raise notice 'PASS 2 (A): the coverage report covers all % active team types in both codes', v_n;
  else
    raise exception 'FAIL 2 (A): expected % rows, got %', v_n * 2, (select count(*) from public.regulatory_coverage_report());
  end if;

  -- =================================================================
  -- B. Every non-mapped state is EXPLAINED
  -- =================================================================
  -- An unexplained gap is the thing the mapping table exists to abolish.
  select count(*) into v_n from public.regulatory_team_type_mappings
  where mapping_state <> 'MAPPED' and (notes is null or length(trim(notes)) < 40);
  if v_n = 0 then
    raise notice 'PASS 3 (B): every unmapped state carries a substantive explanation';
  else
    raise exception 'FAIL 3 (B): % unmapped row(s) have no real explanation', v_n;
  end if;

  -- ...and every MAPPED state actually has an identity.
  select count(*) into v_n from public.regulatory_team_type_mappings
  where mapping_state = 'MAPPED' and regulatory_identity_id is null;
  if v_n = 0 then
    raise notice 'PASS 4 (B): every MAPPED row actually points at a regulatory identity';
  else
    raise exception 'FAIL 4 (B): % MAPPED row(s) point at nothing', v_n;
  end if;

  -- =================================================================
  -- C. UNION AND LEAGUE ARE NEVER CROSSED
  -- =================================================================
  -- The single most damaging error this product could make is showing RFU
  -- guidance to a Rugby League child, or the reverse.
  select count(*) into v_n
  from public.regulatory_team_type_mappings m
  join public.regulatory_identities ri on ri.id = m.regulatory_identity_id
  where m.rugby_code <> ri.rugby_code;
  if v_n = 0 then
    raise notice 'PASS 5 (C): no mapping ever points at another code''s regulatory identity';
  else
    raise exception 'FAIL 5 (C): % cross-code mapping(s)', v_n;
  end if;

  select count(*) into v_n
  from public.regulatory_facts f
  join public.regulatory_fact_applicability fa on fa.fact_id = f.id
  join public.regulatory_identities ri on ri.id = fa.regulatory_identity_id
  where f.rugby_code <> ri.rugby_code;
  if v_n = 0 then
    raise notice 'PASS 6 (C): no regulatory fact is applied across rugby codes';
  else
    raise exception 'FAIL 6 (C): % fact(s) cross the Union/League boundary', v_n;
  end if;

  -- League Primary genuinely covers U6 -- Union does not. Proving the codes
  -- are modelled separately rather than one being copied onto the other.
  if exists (
    select 1 from public.regulatory_coverage_report()
    where team_type_key = 'u6' and rugby_code = 'league' and mapping_state = 'MAPPED'
  ) and exists (
    select 1 from public.regulatory_identities where identity_key = 'RFU-U6' and mapping_type = 'NO_DIRECT_MAPPING'
  ) then
    raise notice 'PASS 7 (C): U6 is regulated in League and outside Age Grade Rugby in Union -- modelled separately';
  else
    raise exception 'FAIL 7 (C): the U6 Union/League asymmetry is not represented';
  end if;

  -- =================================================================
  -- D. SQUAD DESIGNATION DOES NOT FRAGMENT REGULATORY TRUTH
  -- =================================================================
  -- A B or C squad plays the same laws. If a squad ever gets its own
  -- regulatory identity, the same truth starts being maintained twice.
  select count(*) into v_n from public.regulatory_identities
  where identity_key ~* '(-|_)(B|C)(-|_|$)' or label ~* '\m(B|C) (squad|team|XV)\M';
  if v_n = 0 then
    raise notice 'PASS 8 (D): no regulatory identity exists for a squad designation';
  else
    raise exception 'FAIL 8 (D): % squad-level regulatory identit(ies) exist', v_n;
  end if;

  -- The three men's XVs must never resolve to three DIFFERENT identities.
  select count(distinct coalesce(m.regulatory_identity_id::text, m.mapping_state)) into v_n
  from public.regulatory_team_type_mappings m
  join public.canonical_team_types ctt on ctt.id = m.canonical_team_type_id
  where ctt.key in ('mens_1st', 'mens_2nd', 'mens_3rd') and m.rugby_code = 'union';
  if v_n = 1 then
    raise notice 'PASS 9 (D): all three men''s XVs resolve identically -- one law set, not three copies';
  else
    raise exception 'FAIL 9 (D): the men''s XVs resolve % different ways', v_n;
  end if;

  select count(distinct coalesce(m.regulatory_identity_id::text, m.mapping_state)) into v_n
  from public.regulatory_team_type_mappings m
  join public.canonical_team_types ctt on ctt.id = m.canonical_team_type_id
  where ctt.key in ('womens_1st', 'womens_2nd', 'womens_3rd') and m.rugby_code = 'union';
  if v_n = 1 then
    raise notice 'PASS 10 (D): all three women''s XVs resolve identically';
  else
    raise exception 'FAIL 10 (D): the women''s XVs resolve % different ways', v_n;
  end if;

  -- =================================================================
  -- E. Shared truth is REUSED, not duplicated
  -- =================================================================
  -- U15 and U16 are both governed by Regulation 15 Appendix 9. The schema
  -- supports one fact applying to many identities, so when those facts are
  -- extracted in Phase 4B they must attach twice -- not be written twice.
  if exists (
    select 1 from pg_indexes
    where tablename = 'regulatory_fact_applicability'
      and indexdef like '%fact_id%regulatory_identity_id%'
  ) then
    raise notice 'PASS 11 (E): the fact layer is many-to-many, so shared regulatory truth need never be copied';
  else
    raise exception 'FAIL 11 (E): facts cannot be shared across identities';
  end if;

  -- =================================================================
  -- F. Empty states stay DISTINCT
  -- =================================================================
  -- "Not yet researched", "no governing equivalent" and "nothing published"
  -- have different remediation paths and must not collapse into one message.
  select count(distinct mapping_state) into v_n from public.regulatory_team_type_mappings;
  if v_n >= 2 then
    raise notice 'PASS 12 (F): more than one distinct mapping state is in use (%)', v_n;
  else
    raise exception 'FAIL 12 (F): mapping states have collapsed to a single value';
  end if;

  if exists (select 1 from public.regulatory_identities where mapping_type = 'NO_DIRECT_MAPPING')
     and exists (select 1 from public.regulatory_identities where mapping_type = 'DIRECT') then
    raise notice 'PASS 13 (F): NO_DIRECT_MAPPING and DIRECT both survive as separate identity states';
  else
    raise exception 'FAIL 13 (F): the identity mapping-type distinction has been lost';
  end if;

  -- =================================================================
  -- G. PUBLICATION SAFETY -- a conflict blocks publication
  -- =================================================================
  select count(*) into v_n
  from public.regulatory_content_sets cs
  join public.regulatory_conflicts c
    on c.affected_regulatory_identity_id = cs.regulatory_identity_id
   and c.review_state = 'OPEN'
  where cs.publication_state = 'PUBLISHED';
  if v_n = 0 then
    raise notice 'PASS 14 (G): nothing is published against an identity with an OPEN conflict';
  else
    raise exception 'FAIL 14 (G): % content set(s) published despite an open conflict', v_n;
  end if;

  -- =================================================================
  -- H. PROVENANCE -- no fact without a source
  -- =================================================================
  select count(*) into v_n
  from public.regulatory_facts f
  where not exists (select 1 from public.regulatory_fact_citations fc where fc.fact_id = f.id);
  if v_n = 0 then
    raise notice 'PASS 15 (H): every regulatory fact carries at least one citation';
  else
    raise exception 'FAIL 15 (H): % fact(s) have no source citation', v_n;
  end if;

  -- Every source is first-party governing material. A blog or a wiki must
  -- never become published provenance.
  --
  -- OPERATOR_REPORTED_NOT_RETRIEVABLE is admitted here as a third case, and
  -- only because it is strictly weaker than the other two: it marks a
  -- clarification obtained from the governing body by the operator, with no
  -- retrievable artefact, and it is structurally barred from PRIMARY citation
  -- by internal.reject_primary_citation_of_unretrievable_source(). It can
  -- qualify a fact; it can never establish one. The two assertions below are
  -- deliberately paired -- admitting the category is only safe while the bar
  -- on it holds, so the bar is asserted immediately afterwards.
  select count(*) into v_n from public.regulatory_sources
  where authority_classification not like 'PRIMARY%'
    and authority_classification not like 'OFFICIAL%'
    and authority_classification <> 'OPERATOR_REPORTED_NOT_RETRIEVABLE';
  if v_n = 0 then
    raise notice 'PASS 16 (H): every registered source is governing material (primary, official, or operator-reported)';
  else
    raise exception 'FAIL 16 (H): % source(s) are not authoritative', v_n;
  end if;

  select count(*) into v_n
  from public.regulatory_fact_citations c
  join public.regulatory_sources rs on rs.id = c.source_id
  where rs.authority_classification = 'OPERATOR_REPORTED_NOT_RETRIEVABLE' and c.support_role = 'PRIMARY';
  if v_n = 0 then
    raise notice 'PASS 16b (H): no operator-reported source carries a regulatory VALUE';
  else
    raise exception 'FAIL 16b (H): % operator-reported citation(s) are PRIMARY', v_n;
  end if;

  -- And genuinely secondary material may not be cited at all.
  select count(*) into v_n
  from public.regulatory_fact_citations c
  join public.regulatory_sources rs on rs.id = c.source_id
  where rs.authority_classification = 'SECONDARY_DISCOVERY_ONLY';
  if v_n = 0 then
    raise notice 'PASS 16c (H): no discovery-only source is cited on a published fact';
  else
    raise exception 'FAIL 16c (H): % discovery-only citation(s) exist', v_n;
  end if;

  raise notice 'Regulatory coverage complete.';
end $$;

rollback;
