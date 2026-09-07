-- Provenance correction: an operator-reported clarification is not a
-- governing-body publication, and the taxonomy must be able to say so.
--
-- WHAT WAS WRONG
--
-- The RFU's answer on the girls dual age bands was recorded as
-- MEDIA_STATEMENT / OFFICIAL_EXPLANATORY_GUIDANCE. Both overclaim.
-- MEDIA_STATEMENT implies the RFU published something; OFFICIAL_EXPLANATORY_
-- GUIDANCE implies an official artefact exists to be read. Neither is true.
-- What actually exists is: the developer asked the RFU, and reported the
-- answer. There is no URL, no document, no date of issue and no hash, and
-- nothing in the repository can independently retrieve it.
--
-- That is still valuable evidence -- it came from the governing body and it
-- settled a real ambiguity -- but the taxonomy had no honest way to say
-- "authoritative in origin, unverifiable in form", so it got rounded up to
-- the nearest official-sounding pair. Rounding up is exactly the failure this
-- provenance model exists to prevent.
--
-- THE SMALLEST HONEST EXTENSION
--
-- One new source_type and one new authority_classification, both named so
-- they cannot be mistaken for a publication:
--
--   source_type            OPERATOR_REPORTED_CLARIFICATION
--   authority_classification OPERATOR_REPORTED_NOT_RETRIEVABLE
--
-- WHY THIS IS NOT AN ESCAPE HATCH
--
-- A new lenient category is only safe if it is strictly less powerful than
-- the ones it sits beside. So the classification carries a hard structural
-- limit: a source classified OPERATOR_REPORTED_NOT_RETRIEVABLE can NEVER be
-- cited as PRIMARY evidence for a regulatory fact. It may only ever be
-- SUPPORTING, EXCEPTION or OVERLAY -- roles that qualify a fact rather than
-- establish its value.
--
-- That is enforced by a trigger, not by convention, because the whole point
-- is that no future author can reach for this category to get a value past
-- the normal source requirements. Every rule VALUE must still come from a
-- retrievable governing-body document.

-- ============================================================
-- 1. The two new vocabulary entries.
-- ============================================================

alter table public.regulatory_sources drop constraint if exists regulatory_sources_source_type_check;
alter table public.regulatory_sources add constraint regulatory_sources_source_type_check
  check (source_type in (
    'REGULATION', 'RULEBOOK', 'POLICY_DOCUMENT', 'WEB_GUIDANCE', 'LEARNING_RESOURCE',
    'MEDIA_STATEMENT', 'COMPETITION_RULES',
    -- A clarification obtained from the governing body by the operator and
    -- reported back. Authoritative in origin; no retrievable artefact.
    'OPERATOR_REPORTED_CLARIFICATION',
    'OTHER'
  ));

alter table public.regulatory_sources drop constraint if exists regulatory_sources_authority_classification_check;
alter table public.regulatory_sources add constraint regulatory_sources_authority_classification_check
  check (authority_classification in (
    'PRIMARY_REGULATION', 'PRIMARY_RULE_BOOK', 'PRIMARY_POLICY', 'PRIMARY_MEDICAL_GUIDANCE',
    'PRIMARY_SAFEGUARDING_GUIDANCE', 'PRIMARY_COMPETITION_OVERLAY',
    'OFFICIAL_EXPLANATORY_GUIDANCE', 'OFFICIAL_LEARNING_RESOURCE',
    -- Came from the governing body, but cannot be independently retrieved or
    -- re-read. Never sufficient to establish a regulatory VALUE.
    'OPERATOR_REPORTED_NOT_RETRIEVABLE',
    'SECONDARY_DISCOVERY_ONLY'
  ));

comment on column public.regulatory_sources.authority_classification is
  'How much weight this source can carry. OPERATOR_REPORTED_NOT_RETRIEVABLE marks a clarification obtained from the governing body by the operator and reported back: authoritative in origin, but with no URL, document, date of issue or hash, so nothing here can independently retrieve or re-read it. It is structurally barred from PRIMARY citation -- see the trigger below -- and may only ever qualify a fact, never establish one.';

-- ============================================================
-- 2. The bar. Enforced, not documented.
-- ============================================================

create or replace function internal.reject_primary_citation_of_unretrievable_source()
returns trigger
language plpgsql
as $$
declare
  v_class text;
  v_key text;
begin
  if new.support_role <> 'PRIMARY' then
    return new;
  end if;

  select authority_classification, source_key into v_class, v_key
  from public.regulatory_sources where id = new.source_id;

  if v_class = 'OPERATOR_REPORTED_NOT_RETRIEVABLE' then
    raise exception
      'Source "%" is an operator-reported clarification with no retrievable artefact and cannot be a PRIMARY citation. It may only ever be SUPPORTING, EXCEPTION or OVERLAY. Every regulatory VALUE must come from a retrievable governing-body document.',
      coalesce(v_key, new.source_id::text)
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists regulatory_fact_citations_reject_unretrievable_primary on public.regulatory_fact_citations;
create trigger regulatory_fact_citations_reject_unretrievable_primary
  before insert or update on public.regulatory_fact_citations
  for each row execute function internal.reject_primary_citation_of_unretrievable_source();

comment on function internal.reject_primary_citation_of_unretrievable_source() is
  'Stops OPERATOR_REPORTED_NOT_RETRIEVABLE ever becoming the source of a regulatory value. Without this the new classification would be an escape hatch: a lenient category that could be reached for whenever a real document was inconvenient. With it, the category can only qualify facts that a real document already establishes.';

-- ============================================================
-- 3. Reclassify the RFU clarification.
--
--    Values are untouched: this source has always been cited SUPPORTING only,
--    and every rule value continues to derive from the appendix text.
-- ============================================================

update public.regulatory_sources
set source_type = 'OPERATOR_REPORTED_CLARIFICATION',
    authority_classification = 'OPERATOR_REPORTED_NOT_RETRIEVABLE',
    title = 'Operator-reported RFU clarification: girls U12 and U14 follow the boys Rules of Play',
    provenance_notes =
      'OPERATOR-REPORTED CLARIFICATION. The developer researched the question with the RFU and was advised that Girls U12 and Girls U14 follow the same Rules of Play as the corresponding boys age grades, to ensure equality within the game. Reported to the repository on 2026-09-07. '
      || 'NO RETRIEVABLE ARTEFACT EXISTS: there is no publication, URL, email, document or dated statement in the repository, and this cannot be independently re-read or re-verified from here. It was previously recorded as MEDIA_STATEMENT / OFFICIAL_EXPLANATORY_GUIDANCE, which overclaimed by implying the RFU had published something. '
      || 'SCOPE OF USE: establishes APPLICABILITY only -- which regulatory identities an existing fact governs. It is structurally barred from PRIMARY citation by internal.reject_primary_citation_of_unretrievable_source(), so it can never supply a ball size, pitch dimension, player count, playing time, contact, scrum, lineout, kicking, restart or substitution value. Every such value continues to derive from the relevant RFU Regulation 15 appendix. '
      || 'IF THE RFU LATER PUBLISHES THIS IN WRITING, add the document as its own PRIMARY_REGULATION or OFFICIAL_EXPLANATORY_GUIDANCE source and demote this row to corroboration.',
    updated_at = now()
where source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026';

-- ============================================================
-- 4. Rugby League girls: make the offering DELIBERATE, not incidental.
--
--    The required matrix already held, but only because the availability rule
--    defaults positive and no one had said otherwise. That is the correct
--    behaviour and the wrong provenance: these six identities are a stated
--    product requirement, and the record should say so, so that a future
--    author does not read RESEARCH_REQUIRED as "nobody has decided".
--
--    mapping_state stays RESEARCH_REQUIRED because it describes the
--    REGULATORY position, which genuinely is unresearched. Operational
--    availability and regulatory-content completeness are separate, and
--    conflating them is what caused the original global-deactivation bug.
-- ============================================================

update public.regulatory_team_type_mappings m
set notes = 'OPERATIONALLY OFFERED FOR RUGBY LEAGUE BY EXPLICIT PRODUCT REQUIREMENT (developer, 2026-09-07): the supported League girls identities are U12, U13, U14, U15, U16 and U18. '
  || 'REGULATORY STATE IS SEPARATE AND STILL UNRESEARCHED: no authoritative RFL or IRL source has been obtained for girls Rules of Play, so no regulatory content is published for this identity and none may be inferred. '
  || 'RFU material must NEVER be copied onto this identity -- not the age bands, playing-up rules, pitch dimensions, player numbers, ball sizes, contact progression or scrum/lineout rules. Union''s dual-age-band structure governs union only. '
  || 'A League team on this identity resolves League content or an honest empty state; it never falls back to RFU because the age and gender look similar.',
    updated_at = now()
from public.canonical_team_types ctt
where m.canonical_team_type_id = ctt.id
  and m.rugby_code = 'league'
  and ctt.key in ('girls_u12', 'girls_u13', 'girls_u14', 'girls_u15', 'girls_u16', 'girls_u18')
  and m.mapping_state <> 'MAPPED';

-- ============================================================
-- 5. Guards.
-- ============================================================

do $$
declare v_bad text; v_n int;
begin
  -- The clarification must not be PRIMARY anywhere.
  if exists (
    select 1 from public.regulatory_fact_citations c
    join public.regulatory_sources rs on rs.id = c.source_id
    where rs.authority_classification = 'OPERATOR_REPORTED_NOT_RETRIEVABLE' and c.support_role = 'PRIMARY'
  ) then
    raise exception 'An operator-reported source is cited as PRIMARY.';
  end if;

  -- The required girls matrix, exactly.
  select string_agg(t.k || ' union=' || t.u || ' league=' || t.l, '; ') into v_bad
  from (
    select ctt.key k,
      (select is_offered from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'union')::text u,
      (select is_offered from public.canonical_team_types_by_code v where v.id = ctt.id and v.rugby_code = 'league')::text l
    from public.canonical_team_types ctt where ctt.gender = 'girls'
  ) t
  where (t.k, t.u, t.l) not in (
    ('girls_u12','true','true'), ('girls_u13','false','true'), ('girls_u14','true','true'),
    ('girls_u15','false','true'), ('girls_u16','true','true'), ('girls_u18','true','true')
  );
  if v_bad is not null then
    raise exception 'Girls availability matrix is not the required state: %', v_bad;
  end if;

  -- Exactly six girls canonical types, none duplicated per code.
  select count(*) into v_n from public.canonical_team_types where gender = 'girls';
  if v_n <> 6 then raise exception 'Expected exactly 6 canonical girls team types, found %.', v_n; end if;
  if exists (select 1 from public.canonical_team_types where key ~* '(union|league)') then
    raise exception 'A code-specific duplicate canonical team type exists; canonical identity and code availability must stay separate.';
  end if;

  -- No League identity may carry a fact sourced from the RFU.
  select count(*) into v_n
  from public.regulatory_facts f
  join public.regulatory_fact_applicability a on a.fact_id = f.id
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  where ri.rugby_code = 'league' and f.rugby_code = 'union';
  if v_n > 0 then raise exception '% union fact(s) leaked onto league identities.', v_n; end if;
end $$;
