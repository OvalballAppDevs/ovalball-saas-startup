-- An OPEN conflict about whether RFU Regulation 15 has girls-specific
-- appendices, recorded so it blocks publication rather than being resolved by
-- preference.
--
-- HOW IT WAS FOUND
--
-- englandrugby.com refuses automated retrieval, so two RFU CONSTITUENT BODIES
-- were consulted to corroborate the appendix structure. They disagree:
--
--   Gloucestershire RFU lists Appendices 6-9 as BOYS ONLY, and a further
--   Appendix 10 for U13 GIRLS plus a girls U15-U18 variations document.
--
--   Nottinghamshire, Lincolnshire & Derbyshire RFU lists Appendices 6, 8 and
--   9 as mixed, only Appendix 7 as boys-only, and no Appendix 10 at all.
--
-- WHY THIS IS RECORDED RATHER THAN DECIDED
--
-- Phase 4A had already marked Union girls age grades RESEARCH_REQUIRED on the
-- grounds that we could not establish whether their Rules of Play differ. One
-- of these pages appears to answer that question and even names the appendix.
-- It would be very easy, and wrong, to take it: both bodies are reputable,
-- NEITHER is the authority (only the RFU's own document is), and neither page
-- states a season -- so the difference could be a real regulatory change one
-- body has not reflected, or simply a stale page.
--
-- Creating girls identities on the strength of a county page would put a
-- guess into the layer the whole product's trustworthiness rests on. So the
-- disagreement is recorded as a conflict, the girls mappings stay
-- RESEARCH_REQUIRED, and the question is settled when the official document
-- arrives through the ingestion directory.
--
-- No fact is asserted here, and no identity is created.

do $$
declare
  v_conflict_id uuid;
begin
  if exists (select 1 from public.regulatory_conflicts where conflict_key = 'RFU-REG15-GIRLS-APPENDIX-SCOPE') then
    return;
  end if;

  insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, description, review_state)
  values (
    'RFU-REG15-GIRLS-APPENDIX-SCOPE',
    -- 'RULES' is the canonical topic vocabulary on regulatory_conflicts.
    'RULES',
    'union',
    'Two RFU constituent bodies describe the Regulation 15 appendix set differently. Gloucestershire RFU (grfu.org/regulation-15) labels Appendices 6-9 BOYS ONLY and lists a further Appendix 10 for U13 GIRLS plus a girls U15-U18 variations document. Nottinghamshire, Lincolnshire & Derbyshire RFU (nldrfu.co.uk age-grade-laws) labels Appendices 6, 8 and 9 as mixed, only Appendix 7 as boys-only, and lists no Appendix 10. Neither page states a season, and neither is the authority -- only the RFU''s own Regulation 15 index is. Unresolvable while englandrugby.com refuses automated retrieval; awaiting the official document via research-ingestion/rfu/. Until then no Union girls regulatory identity may be created and no girls Rules-of-Play fact may be published.',
    'OPEN'
  )
  returning id into v_conflict_id;
end $$;
