-- Rugby Hub Phase 4A: the complete coverage map.
--
-- Ovalball has 24 active canonical team types. Five of them resolved to a
-- regulatory identity; the other nineteen resolved to NULL -- and a NULL was
-- indistinguishable from "we have not got to it yet", "there is genuinely no
-- governing equivalent" and "somebody forgot". This migration makes every
-- canonical team type resolve DELIBERATELY, and records which.
--
-- THE SCHEMA GAP THIS CLOSES
--
-- regulatory_identities.ovalball_canonical_team_type_id is a single column,
-- so the mapping it expresses is one identity -> one team type. The product
-- needs the opposite cardinality in two places:
--
--   * Men's 1st, 2nd and 3rd XV are three canonical team types governed by
--     ONE set of laws. Squad designation does not alter the laws, so giving
--     each its own regulatory identity would copy the same regulatory truth
--     three times -- and then let the three copies drift.
--
--   * A canonical team type carries no rugby code. "U12" is a Union U12 or a
--     League U12 depending on the team, and those are governed by entirely
--     different bodies. The mapping is therefore keyed on the PAIR.
--
-- So: a join table. Many canonical team types, per rugby code, to at most one
-- regulatory identity.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It populates no regulatory FACTS. Creating an identity records that a
-- governing document was located and which team types it governs; it asserts
-- nothing about ball size, pitch size or duration. Those come in Phase 4B,
-- extracted from the primary sources, or they do not come at all.

-- ---------------------------------------------------------------------------
-- The mapping
-- ---------------------------------------------------------------------------

create table public.regulatory_team_type_mappings (
  id uuid primary key default gen_random_uuid(),

  canonical_team_type_id uuid not null references public.canonical_team_types(id) on delete cascade,
  rugby_code text not null check (rugby_code in ('union', 'league')),

  -- NULL is legitimate here, but only alongside a state that explains it.
  regulatory_identity_id uuid references public.regulatory_identities(id),

  -- The four honest answers. Each has a different remediation path, which is
  -- exactly why they must not collapse into "no information available":
  --
  --   MAPPED                   -- a governing identity exists and is attached.
  --   NO_REGULATORY_EQUIVALENT -- the governing body does not regulate this
  --                               combination at all. Nothing to research; the
  --                               product should say so plainly.
  --   RESEARCH_REQUIRED        -- we have not established the position. The
  --                               remediation is research, not schema.
  --   NOT_OFFERED              -- Ovalball supports the team type, but not in
  --                               this code (no such thing as League Colts in
  --                               the Ovalball catalogue today).
  mapping_state text not null check (mapping_state in ('MAPPED', 'NO_REGULATORY_EQUIVALENT', 'RESEARCH_REQUIRED', 'NOT_OFFERED')),

  -- Required whenever there is no identity: an unexplained gap is the thing
  -- this table exists to abolish.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_team_type_mappings_unique unique (canonical_team_type_id, rugby_code),
  constraint regulatory_team_type_mappings_state_shape check (
    (mapping_state = 'MAPPED' and regulatory_identity_id is not null)
    or (mapping_state <> 'MAPPED' and regulatory_identity_id is null and notes is not null)
  )
);

comment on table public.regulatory_team_type_mappings is
  'Every canonical team type, per rugby code, resolved deliberately to a regulatory identity or to an explained absence. Many-to-one on purpose: squad designation does not alter the laws, so three men''s XVs share one identity rather than copying regulatory truth three times.';

create index regulatory_team_type_mappings_identity_idx on public.regulatory_team_type_mappings (regulatory_identity_id);
create index regulatory_team_type_mappings_state_idx on public.regulatory_team_type_mappings (mapping_state);

create trigger set_updated_at before update on public.regulatory_team_type_mappings
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.regulatory_team_type_mappings
  for each row execute function internal.audit_row_change();

alter table public.regulatory_team_type_mappings enable row level security;

-- The coverage map is reference data about which governing rules apply. It
-- carries no club, player or personal information, and every authenticated
-- viewer already sees the resolved outcome through the Rugby Hub.
create policy regulatory_team_type_mappings_select on public.regulatory_team_type_mappings
  for select to authenticated using (true);

revoke all on public.regulatory_team_type_mappings from authenticated, anon;
grant select on public.regulatory_team_type_mappings to authenticated;

-- ---------------------------------------------------------------------------
-- Union identities for the age grades RFU Regulation 15 actually governs
-- ---------------------------------------------------------------------------

-- RFU Regulation 15 carries a separate Appendix per age grade from U7 to U14,
-- and a single Appendix 9 covering U15-U18 together. Each appendix is its own
-- governing document with its own Rules of Play, so each age grade is its own
-- regulatory identity.
--
-- That is NOT fragmentation: where the governing truth is genuinely shared --
-- as it is across U15-U18 -- the sharing is expressed in the FACT layer.
-- regulatory_fact_applicability is already many-to-many, so one extracted
-- fact attaches to every identity it governs without being copied. Identity
-- granularity follows the documents; fact reuse follows the truth.
--
-- No facts are asserted here. These rows record only that the document exists
-- and which age grade it governs.
insert into public.regulatory_identities (rugby_code, identity_key, label, mapping_type, ovalball_canonical_team_type_id, mapping_notes, source_register_reference)
select 'union', v.identity_key, v.label, 'DIRECT', ctt.id, v.notes, v.reference
from (values
  ('RFU-U8',  'RFU Age Grade U8',  'u8',  'RFU Regulation 15 Appendix 2 (U8 Rules of Play, Tag Rugby). Located; facts not yet extracted.', 'Reg 15 Appendix 2'),
  ('RFU-U9',  'RFU Age Grade U9',  'u9',  'RFU Regulation 15 Appendix 3 (U9 Rules of Play, Transitional Contact). Located; facts not yet extracted.', 'Reg 15 Appendix 3'),
  ('RFU-U10', 'RFU Age Grade U10', 'u10', 'RFU Regulation 15 Appendix 4 (U10 Rules of Play). Located; facts not yet extracted.', 'Reg 15 Appendix 4'),
  ('RFU-U11', 'RFU Age Grade U11', 'u11', 'RFU Regulation 15 Appendix 5 (U11 Rules of Play). Located; facts not yet extracted.', 'Reg 15 Appendix 5'),
  ('RFU-U12', 'RFU Age Grade U12', 'u12', 'RFU Regulation 15 Appendix 6 (U12 Rules of Play). Located; facts not yet extracted.', 'Reg 15 Appendix 6'),
  ('RFU-U13', 'RFU Age Grade U13', 'u13', 'RFU Regulation 15 Appendix 7 (U13 Rules of Play). Located; facts not yet extracted.', 'Reg 15 Appendix 7'),
  ('RFU-U14', 'RFU Age Grade U14', 'u14', 'RFU Regulation 15 Appendix 8 (U14 Rules of Play). Located; facts not yet extracted.', 'Reg 15 Appendix 8'),
  ('RFU-U16', 'RFU Age Grade U16', 'u16', 'RFU Regulation 15 Appendix 9 (U15-U18 Variations to the Laws of the Game) -- SHARED with U15. Facts extracted once will attach to both identities through regulatory_fact_applicability rather than being duplicated.', 'Reg 15 Appendix 9')
) as v(identity_key, label, team_type_key, notes, reference)
join public.canonical_team_types ctt on ctt.key = v.team_type_key
where not exists (select 1 from public.regulatory_identities ri where ri.identity_key = v.identity_key);

-- ---------------------------------------------------------------------------
-- Every canonical team type, deliberately resolved
-- ---------------------------------------------------------------------------

-- UNION -- age grades with a located Regulation 15 appendix.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'union', ri.id, 'MAPPED', null
from public.canonical_team_types ctt
join public.regulatory_identities ri
  on ri.rugby_code = 'union' and ri.ovalball_canonical_team_type_id = ctt.id
where ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- UNION -- U6. Regulation 15 scopes Age Grade Rugby as U7 upward, so U6 sits
-- outside the regulated definition. This is a real answer, not a gap.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'union', null, 'NO_REGULATORY_EQUIVALENT',
  'RFU Regulation 15 scopes Age Grade Rugby from U7. U6 has no RFU Rules of Play appendix, and the existing RFU-U6 identity records the same finding. Rugby Hub should say plainly that the RFU does not publish U6 rules of play rather than implying content is missing.'
from public.canonical_team_types ctt
where ctt.key = 'u6' and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- UNION -- Girls age grades. RFU publishes girls-specific age-grade material,
-- but whether the Rules of Play differ from the mixed/boys appendices has NOT
-- been established from a primary source. Assuming they are identical would
-- be inventing a regulatory fact; assuming they differ would be inventing a
-- different one.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'union', null, 'RESEARCH_REQUIRED',
  'Phase 4A did not establish from a primary RFU source whether girls'' age-grade Rules of Play differ from the corresponding Regulation 15 appendix. Both "identical" and "different" would be invented facts. Research target: RFU girls age-grade regulations and any girls-specific appendix or variation.'
from public.canonical_team_types ctt
where ctt.gender = 'girls' and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- UNION -- Colts. "Junior Colts"/"Senior Colts" are club branding, not
-- current RFU regulatory terms; Regulation 15 uses U15-U18 exclusively. The
-- existing RFU-SENIOR-COLTS identity already records this for Senior Colts.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'union', null, 'RESEARCH_REQUIRED',
  'Colts is informal club branding, not a current RFU regulatory category -- Regulation 15 uses U15-U18. Which age grade a given club means by "Junior Colts" is a club-level question, so this cannot be resolved centrally without either a club-declared age grade or an RFU mapping. Research target: whether the RFU publishes any Colts-to-age-grade equivalence.'
from public.canonical_team_types ctt
where ctt.key = 'junior_colts' and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- UNION -- Adult senior. Three men's XVs and three women's XVs are SIX
-- canonical team types and at most TWO sets of governing laws. This is the
-- case the join table exists for: when the adult identities are created in
-- Phase 4B, all three men's squads point at one of them.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'union', null, 'RESEARCH_REQUIRED',
  'Adult community rugby is governed by the World Rugby Laws of the Game as adopted by the RFU, plus RFU adult regulations -- neither established from a primary source in Phase 4A. Squad designation (1st/2nd/3rd XV) does NOT alter the laws, so all three squads of a gender must resolve to ONE identity when it is created. Research target: World Rugby Laws current edition and the RFU adult competition regulations.'
from public.canonical_team_types ctt
where ctt.category = 'senior' and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- LEAGUE -- Primary Rugby League covers U6-U11, which is a genuine structural
-- difference from Union: the RFL regulates the age Union leaves out.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'league', ri.id, 'MAPPED', null
from public.canonical_team_types ctt
cross join public.regulatory_identities ri
where ri.identity_key = 'RFL-PRIMARY'
  and ctt.age_group in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11')
  and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- LEAGUE -- Girls U12 has its own located modified-rules document.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'league', ri.id, 'MAPPED', null
from public.canonical_team_types ctt
cross join public.regulatory_identities ri
where ri.identity_key = 'RFL-GIRLS-U12' and ctt.key = 'girls_u12' and ctt.is_active
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- LEAGUE -- everything else. Youth/junior League rules are published per
-- LEAGUE (Yorkshire, North West, London, Hull each publish their own 2026
-- Competition Rules), which makes them competition-specific rather than
-- universal. Publishing one region's rules as national truth is precisely the
-- error the competition-overlay model exists to prevent.
insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, regulatory_identity_id, mapping_state, notes)
select ctt.id, 'league', null, 'RESEARCH_REQUIRED',
  'RFL youth/junior playing rules above Primary age are published per competition (Yorkshire, North West, London and Hull each publish their own Competition Rules), on top of the Community Game Operational Rules. Whether a universal national layer exists for these age grades was not established in Phase 4A. Until it is, any extracted rule is competition-specific and belongs in a competition overlay, not in universal Rugby Hub truth.'
from public.canonical_team_types ctt
where ctt.is_active
  and not exists (
    select 1 from public.regulatory_team_type_mappings m
    where m.canonical_team_type_id = ctt.id and m.rugby_code = 'league'
  )
on conflict (canonical_team_type_id, rugby_code) do nothing;

-- ---------------------------------------------------------------------------
-- Coverage reporting
-- ---------------------------------------------------------------------------

-- The function the automated coverage test reads. Returns one row per
-- canonical team type per code, so a newly added team type shows up as an
-- unmapped row rather than silently resolving to nothing.
create or replace function public.regulatory_coverage_report()
returns table (
  team_type_key text,
  team_type_label text,
  rugby_code text,
  mapping_state text,
  identity_key text,
  identity_mapping_type text,
  fact_count integer,
  published_set_count integer,
  open_conflict_count integer
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    ctt.key,
    ctt.label,
    codes.rugby_code,
    coalesce(m.mapping_state, 'UNMAPPED'),
    ri.identity_key,
    ri.mapping_type,
    coalesce((select count(*)::integer from public.regulatory_fact_applicability fa where fa.regulatory_identity_id = ri.id), 0),
    coalesce((select count(*)::integer from public.regulatory_content_sets cs where cs.regulatory_identity_id = ri.id and cs.publication_state = 'PUBLISHED'), 0),
    coalesce((select count(*)::integer from public.regulatory_conflicts c where c.affected_regulatory_identity_id = ri.id and c.review_state = 'OPEN'), 0)
  from public.canonical_team_types ctt
  cross join (values ('union'), ('league')) as codes(rugby_code)
  left join public.regulatory_team_type_mappings m
    on m.canonical_team_type_id = ctt.id and m.rugby_code = codes.rugby_code
  left join public.regulatory_identities ri on ri.id = m.regulatory_identity_id
  where ctt.is_active
  order by codes.rugby_code, ctt.sort_order;
$$;

revoke all on function public.regulatory_coverage_report() from public;
grant execute on function public.regulatory_coverage_report() to authenticated;
