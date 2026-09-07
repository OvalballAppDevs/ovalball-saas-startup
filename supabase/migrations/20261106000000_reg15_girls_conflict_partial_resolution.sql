-- The Regulation 15 girls-appendix conflict, resolved for U15-U18 by the
-- document's own words -- and deliberately left open below that.
--
-- WHAT SETTLED IT
--
-- The developer supplied the official Regulation 15 appendix text from
-- englandrugby.com (the host refuses automated retrieval; see
-- docs/rugby-hub/acquisition-log.json). Appendix 9 states its own scope:
--
--   "...are observed when playing BOYS AND GIRLS rugby at U15 to U18 in
--    England, which are mandatory for clubs, schools and colleges."
--
-- and then carries a clearly delimited section headed "Additional Law
-- Variations applicable to U15 boys only" for the scrum and lineout.
--
-- So one appendix governs both genders at U15-U18, with the boys-specific
-- variations handled inside it. Gloucestershire RFU's page, which labelled
-- Appendix 9 "BOYS ONLY" and listed a separate girls U15-U18 document, is
-- contradicted by the regulation itself. Nottinghamshire, Lincolnshire &
-- Derbyshire RFU's "mixed" labelling was correct.
--
-- This is exactly why the disagreement was recorded rather than decided in
-- Phase 4A: the more detailed page was the wrong one, and taking it would
-- have produced a girls U15-U18 identity that does not exist.
--
-- WHAT IS STILL OPEN
--
-- The supplied set runs Appendix 1 to Appendix 9. Gloucestershire RFU also
-- listed an Appendix 10 for U13 GIRLS, and labelled Appendices 6, 7 and 8
-- (U12, U13, U14) BOYS ONLY. The supplied appendix bodies carry no gender
-- restriction in their headings, but absence from a supplied set is not
-- proof that Appendix 10 does not exist -- it may simply not have been
-- included. So the U12-U14 girls question remains genuinely unresolved and a
-- NEW conflict is opened for it, narrowed to what is actually still in doubt.
--
-- No regulatory fact is populated here. This migration changes only what we
-- claim to KNOW about the appendix structure.

-- WHY THIS MIGRATION DOES NOT MARK THE CONFLICT RESOLVED
--
-- regulatory_conflicts carries a CHECK requiring resolved_by alongside any
-- resolution. That is a real control, not an obstacle: resolving a
-- regulatory conflict is an accountable human act, and a migration cannot be
-- accountable for one. So this records the EVIDENCE and leaves the sign-off
-- to a Site Admin through resolve_regulatory_conflict(), which stamps who
-- decided it.

do $$
begin
  update public.regulatory_conflicts
  set description = description || E'\n\n--- EVIDENCE ESTABLISHED (Phase 4A follow-up) ---\n'
    || 'RESOLVED IN SUBSTANCE FOR U15-U18, awaiting Site Admin sign-off. The official Regulation 15 Appendix 9 text (Last Updated 31 Jul 2025, Effective 1 Aug 2025), supplied by the developer from englandrugby.com because the host refuses automated retrieval, states its own scope: "...are observed when playing BOYS AND GIRLS rugby at U15 to U18 in England, which are mandatory for clubs, schools and colleges." It then carries a delimited section headed "Additional Law Variations applicable to U15 boys only" covering the scrum and lineout. One appendix therefore governs both genders at U15-U18 and there is no separate girls U15-U18 document. Gloucestershire RFU''s listing (Appendix 9 = BOYS ONLY plus a girls equivalent) is contradicted by the regulation itself; NLD RFU''s "mixed" labelling was correct -- the more detailed county page was the wrong one, which is precisely why this was recorded rather than decided. The narrower U12-U14 girls question is NOT settled by this and continues as RFU-REG15-GIRLS-U12-U14-APPENDIX.'
  where conflict_key = 'RFU-REG15-GIRLS-APPENDIX-SCOPE' and review_state = 'OPEN';

  -- The part that genuinely remains in doubt, stated narrowly.
  if not exists (select 1 from public.regulatory_conflicts where conflict_key = 'RFU-REG15-GIRLS-U12-U14-APPENDIX') then
    insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, description, review_state)
    values (
      'RFU-REG15-GIRLS-U12-U14-APPENDIX',
      'RULES',
      'union',
      'Whether RFU Regulation 15 carries girls-specific Rules of Play appendices at U12, U13 and U14. Gloucestershire RFU (grfu.org/regulation-15) labels Appendices 6, 7 and 8 BOYS ONLY and lists an Appendix 10 for U13 GIRLS. The official appendix text supplied for Appendices 1-9 carries no gender restriction in those headings, and no Appendix 10 was included -- but absence from a supplied set is not evidence that the appendix does not exist. Resolving this needs either the RFU''s own current Regulation 15 appendix index, or confirmation that Appendix 10 (and any further girls appendix) does or does not exist. Until then no Union girls regulatory identity may be created at U12-U14 and no girls Rules-of-Play fact may be published for those age grades. This does NOT affect U15-U18, where Appendix 9 explicitly covers both genders.',
      'OPEN'
    );
  end if;
end $$;
