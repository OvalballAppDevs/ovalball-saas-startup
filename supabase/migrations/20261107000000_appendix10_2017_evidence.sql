-- Evidence that RFU Regulation 15 Appendix 10 (U13 Girls) genuinely existed --
-- and the reason that still does not unblock publication.
--
-- WHAT ARRIVED
--
-- The developer supplied a local PDF, U13-Rules-of-play-2017-Girls.pdf
-- (SHA-256 04b8f11ffe75a0c5616f978317f1a39cba552cb376931494b8f44b3bee8e3335,
-- 9 pages, 73268 bytes). Its own text reads:
--
--   "RFU REGULATION 15 - AGE GRADE RUGBY / Appendix 10 / Under 13s /
--    Effective from 1 August 2017 / Girls Only"
--
-- Its publication metadata is Adobe InDesign CS6 / Adobe PDF Library 10.0.1,
-- created 2017-07-07. The 2017/18 master regulation retrieved independently in
-- an earlier pass (ACQ-RFU-REG15-2017-WHITEROSE) carries the same toolchain and
-- a creation date in the same week. Neither file's provenance depends on the
-- other, so that agreement is genuine mutual corroboration rather than a single
-- artefact vouching for itself.
--
-- WHAT IT SETTLES
--
-- Appendix 10 for U13 girls existed. Gloucestershire RFU did not invent it, and
-- the disagreement recorded in RFU-REG15-GIRLS-U12-U14-APPENDIX is therefore no
-- longer a straight choice between a correct county page and a wrong one. That
-- matters: the earlier reasoning leaned on NLD RFU having been right about
-- Appendix 9, and it would have been easy to carry that forward into assuming
-- NLD was right about Appendix 10 too. It cannot be assumed.
--
-- WHAT IT DOES NOT SETTLE
--
-- Whether Appendix 10 survives into the current 2025/26 set. A document from
-- nine seasons ago is evidence about 2017 and nothing else. The RFU's current
-- appendices are dated "Effective from Friday 1st August 2025", and the set
-- supplied for this season ran 1 to 9. Appendix 10 may have been withdrawn,
-- renumbered, or folded into another appendix -- or it may simply not have been
-- included in what was supplied.
--
-- WHY NO DATED DISCLAIMER IS ACCEPTABLE
--
-- The developer asked whether the 2017 values could be published with a note
-- saying they came from a 2017 copy. They cannot, and the reason is specific to
-- who reads this product. A parent opening the Rugby Hub to check their U13
-- daughter's ball size or half length acts on the number; the footnote does not
-- travel with it to the touchline. Age-grade Rules of Play have changed
-- materially since 2017. A wrong safety-relevant value carrying a date caveat
-- is worse than no value at all, because the caveat transfers the risk to the
-- reader while the number still reads as authoritative.
--
-- So the file is banked as historical evidence, the conflict stays OPEN, and
-- the publication block on U12-U14 girls Rules of Play stands unchanged.
--
-- No regulatory fact is populated here. This migration changes only what we
-- claim to KNOW, and records why knowing it is not yet enough to publish.

do $$
begin
  update public.regulatory_conflicts
  set description = description || E'\n\n--- EVIDENCE UPDATE (2026-09-07): APPENDIX 10 DID EXIST ---\n'
    || 'The developer supplied U13-Rules-of-play-2017-Girls.pdf (SHA-256 04b8f11ffe75a0c5616f978317f1a39cba552cb376931494b8f44b3bee8e3335, 9 pages). Its own cover text reads "RFU REGULATION 15 - AGE GRADE RUGBY / Appendix 10 / Under 13s / Effective from 1 August 2017 / Girls Only". Publication metadata is Adobe InDesign CS6 / Adobe PDF Library 10.0.1, created 2017-07-07 -- the same toolchain and the same week as the independently retrieved 2017/18 master regulation, which is mutual corroboration rather than self-vouching. '
    || 'EFFECT ON THIS CONFLICT: Appendix 10 for U13 girls demonstrably existed, so Gloucestershire RFU''s listing is not an invention and this is no longer a straight choice between a correct county page and a wrong one. NLD RFU being right about Appendix 9 must not be carried forward into an assumption that it is right about Appendix 10. '
    || 'WHAT REMAINS OPEN: whether Appendix 10 survives into the current 2025/26 set. A 2017 document is evidence about 2017 only. The current appendices are dated "Effective from Friday 1st August 2025" and the supplied set ran 1 to 9; Appendix 10 may have been withdrawn, renumbered, folded into another appendix, or simply omitted from what was supplied. '
    || 'PUBLICATION REMAINS BLOCKED, AND A DATED DISCLAIMER DOES NOT LIFT IT. The 2017 values must not be published as current rules with a "(2017)" note or any equivalent caveat: a parent checking a U13 ball size or half length acts on the number, not the footnote, and age-grade Rules of Play have changed materially since 2017. The file is banked as historical structural evidence only -- see docs/rugby-hub/acquisition-log.json, ACQ-RFU-REG15-APP10-2017-U13-GIRLS. '
    || 'TO CLOSE THIS: the RFU''s own current Regulation 15 appendix index is needed, confirming whether Appendix 10 exists in 2025/26.'
  where conflict_key = 'RFU-REG15-GIRLS-U12-U14-APPENDIX'
    and review_state = 'OPEN'
    and description not like '%APPENDIX 10 DID EXIST%';
end $$;
