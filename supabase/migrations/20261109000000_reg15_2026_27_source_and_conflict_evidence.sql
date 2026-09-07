-- RFU Regulation 15 (2026/27) recorded as a source, the girls conflicts
-- answered, and a NEW blocker opened about the appendices' season.
--
-- THE DOCUMENT
--
-- The developer supplied RFU-Regulation-15-2026-27.pdf, a browser print
-- capture of the Regulation 15 page on englandrugby.com made on 2026-09-07,
-- after the host refused automated retrieval (retested this pass: still HTTP
-- 403, not circumvented). 25 pages, SHA-256
-- e9f6f55a210fac85eb96a8f45fef17e2ff834bf330576efdc6192b8df12028ee. Every page
-- carries the running footer "RFU REGULATION 15 - AGE GRADE RUGBY / Effective
-- from 1 August 2026".
--
-- Provenance is recorded honestly: this is a RENDERING of the RFU's page
-- produced by the developer's browser (Skia/PDF, Chrome), not the RFU's own
-- published PDF bytes, and it has no text layer at all -- the content was read
-- from page images. That is weaker than a publisher-signed artefact and
-- stronger than pasted text, because it is byte-stable and re-readable. It is
-- the best available given the access control, and the canonical provenance
-- remains the englandrugby.com URL.

-- ============================================================
-- 1. The source row.
-- ============================================================

insert into public.regulatory_sources (
  source_key, authority_id, rugby_code, title, source_type, authority_classification,
  canonical_url, landing_page_url, document_version, publication_date, retrieved_on,
  effective_from, review_state, notes, provenance_notes
)
select
  'RFU-REG15-MASTER-2026-27',
  a.id,
  'union',
  'RFU Regulation 15 - Age Grade Rugby',
  'REGULATION',
  'PRIMARY_REGULATION',
  'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby',
  'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations',
  '2026/27 edition',
  null,
  date '2026-09-07',
  date '2026-08-01',
  'VERIFIED_CURRENT',
  'The master regulation, previously the largest outstanding gap: Phase 4A had the appendices but not the parent. Covers 15.1 Objectives through 15.15 Competitions Regulations, including the age grade definition (age at midnight on 1 September), Combining/Playing Up/Playing Down (15.3-15.6), Playing Adult Rugby at 17 (15.7), non-contact (15.9), the Season and Summer Activity Framework (15.10), playing time and match-stop thresholds (15.12) and the Half Game Rule (15.13).',
  'DEVELOPER_SUPPLIED BROWSER PRINT CAPTURE. englandrugby.com returns HTTP 403 to automated requests at the CloudFront layer; retested this pass with a single plain unauthenticated GET and NOT circumvented. The developer opened the page in their own browser and printed it to PDF (Skia/PDF m152, Chrome on macOS, created 2026-09-07T18:49Z), then supplied the file locally. SHA-256 e9f6f55a210fac85eb96a8f45fef17e2ff834bf330576efdc6192b8df12028ee, 25 pages, 10354078 bytes. CAVEAT: the capture is IMAGE-ONLY -- it carries no text layer, so every quotation extracted from it was read from rendered page images rather than machine-extracted, and it is a rendering of the RFU page rather than the RFU''s own published PDF bytes. Byte-stable and re-readable, so stronger than pasted text; not publisher-signed, so weaker than an official PDF. Canonical authority remains the englandrugby.com URL.'
from public.regulatory_authorities a
where a.code = 'RFU'
on conflict (source_key) do nothing;

-- ============================================================
-- 2. The girls appendix conflicts -- answered.
--
--    Both are left OPEN. regulatory_conflicts requires resolved_by alongside
--    any resolution, and no Site Admin exists to stamp it; resolving a
--    regulatory conflict is an accountable human act and a migration cannot be
--    accountable for one. So the evidence is recorded in full and each is
--    marked READY FOR SIGN-OFF, for a Site Admin to close through
--    resolve_regulatory_conflict().
-- ============================================================

do $$
begin
  -- The broader scope question. Appendix 9 already settled U15-U18; what was
  -- left was WHY the county pages disagreed at all. The dual age bands explain
  -- it: the girls game is not organised the way the boys game is.
  update public.regulatory_conflicts
  set description = description || E'\n\n--- ANSWERED (2026-09-07), READY FOR SIGN-OFF ---\n'
    || 'RFU Regulation 15.6 (2026/27 edition, Effective 1 August 2026, source RFU-REG15-MASTER-2026-27) settles the underlying structure. The female "Playing Out of Age Grade" table lists FOUR dual age bands and nothing else: U12/U11 (Yr 7/Yr 6), U14/U13 (Yr 8/Yr 9), U16/U15 (Yr 11/Yr 10), U18s/U17s (Yr 13/Yr 12), plus U19s as adults. The male table on the facing page lists single years U12 to U18. Corroborated twice more inside the same document: the 15.2 Competitive Menu carries female columns for Under 12/14/16/18 Female only, and the 15.10 Summer Activity Plan refers to "U12, 14, 16, 18 GIRLS BANDS". Regulation 15.4 states the consequence: for girls "the only playing up allowed is within the two-year age band (e.g. a girl in the U14 age band cannot play up in the U16s)". The county pages disagreed because they were describing a structure that has since changed, not because either was careless. Ovalball''s canonical data was corrected accordingly in 20261108000000_union_girls_dual_age_bands.sql.'
  where conflict_key = 'RFU-REG15-GIRLS-APPENDIX-SCOPE'
    and review_state = 'OPEN'
    and description not like '%ANSWERED (2026-09-07)%';

  -- The narrow Appendix 10 question.
  update public.regulatory_conflicts
  set description = description || E'\n\n--- ANSWERED (2026-09-07), READY FOR SIGN-OFF ---\n'
    || 'THERE IS NO APPENDIX 10 IN THE CURRENT SET, AND NO GIRLS U12-U14 APPENDIX IS MISSING. Two independent statements in the 2026/27 master regulation settle it. First, Regulation 15.2(2)(a) enumerates the range directly: players and Match Officials "must always do so in accordance with the Rules of Play set out Appendix 1 to 9 of this Regulation". The set is 1-9; there is no Appendix 10. Second, Regulation 15.6 explains WHY none is needed: the girls game runs in dual age bands, so a U13 girl plays in the U14/U13 band and is governed by the U14 appendix. There is no girls U13 age grade for a girls U13 appendix to govern. '
    || 'This also reconciles the 2017 evidence rather than contradicting it. The developer''s U13-Rules-of-play-2017-Girls.pdf (SHA-256 04b8f11f..., "Effective from 1 August 2017") is genuine, and Appendix 10 really did exist in 2017/18 -- Gloucestershire RFU''s page was accurate for a structure the RFU has since replaced with the dual age bands. Both facts are true; they belong to different seasons. Nottinghamshire, Lincolnshire & Derbyshire RFU''s listing, with no Appendix 10, matches the current set. '
    || 'CONSEQUENCE: the publication block on girls U12-U14 Rules of Play is lifted for the BAND identities now created (RFU-GIRLS-U12, RFU-GIRLS-U14), which draw on Appendices 6 and 8. The 2017 file remains historical evidence only and none of its values may be published as current, with or without a date caveat. NOTE the separate blocker RFU-REG15-APPENDIX-SEASON-SPLIT opened below: the appendix TEXT on record is the 2025/26 edition while this master regulation is 2026/27, so appendix-derived facts are still blocked on freshness, for an unrelated reason.'
  where conflict_key = 'RFU-REG15-GIRLS-U12-U14-APPENDIX'
    and review_state = 'OPEN'
    and description not like '%ANSWERED (2026-09-07)%';
end $$;

-- ============================================================
-- 3. A NEW blocker: the appendices on record are a season behind.
--
--    This was found by reading the master regulation's footer, and it is the
--    kind of thing that is easy to miss precisely because the earlier work was
--    correct when it was done. It must block Phase 4B publication of
--    appendix-derived facts until resolved.
-- ============================================================

do $$
begin
  if not exists (select 1 from public.regulatory_conflicts where conflict_key = 'RFU-REG15-APPENDIX-SEASON-SPLIT') then
    insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, description, review_state)
    values (
      'RFU-REG15-APPENDIX-SEASON-SPLIT',
      'RULES',
      'union',
      'THE REGULATION 15 APPENDIX TEXT ON RECORD IS A SEASON BEHIND THE MASTER REGULATION. The master regulation supplied on 2026-09-07 (RFU-REG15-MASTER-2026-27) states on every page "Effective from 1 August 2026" and defines at 15.10 that "Season 2026-27 will run from Saturday 5 September 2026 until Monday 3 May 2027". Today is within that season, so 2026/27 is the CURRENT season. '
      || 'But the Regulation 15 Appendix 1-9 text supplied earlier in Phase 4A was captured as "Last Updated 31 Jul 2025, Effective 1 Aug 2025" -- the 2025/26 edition. The regulatory_sources row RFU-REG15-APP1-2025-001 carries effective_from = 2025-08-01 accordingly. That was correct when recorded; it has since been overtaken. '
      || 'Note the asymmetry that makes this worth flagging rather than assuming: the other RFU regulations the developer supplied at the same time (Regulations 3, 5, 6, 7, 8) were all "Effective 1 Aug 2026", i.e. already 2026/27. Only the Regulation 15 appendices were 2025/26. So the appendices were either not yet updated at capture time, or were captured from a stale view, or genuinely carry forward unchanged -- and which of those is true cannot be determined from what is on record. '
      || 'UNTIL RESOLVED: no Rules-of-Play fact derived from the Appendix 1-9 text may be published as current. This blocks the appendix-derived half of Phase 4B; facts drawn from the MASTER regulation (age grade definition, playing time, Half Game Rule, combining/playing up/down, season dates) are NOT affected, because that document is verified 2026/27. '
      || 'TO CLOSE THIS: obtain the Regulation 15 Appendix 1-9 pages for 2026/27 from englandrugby.com and compare against the 2025/26 text on record, recording either that the values are unchanged or what changed.',
      'OPEN'
    );
  end if;
end $$;
