-- The RFL Girls League competition rules, and the evidence that Girls U17 was
-- withdrawn for 2026.
--
-- WHY THIS IS BANKED SEPARATELY
--
-- The general RFL age ranges (Operational Rules 2026, Section F13) DO include
-- an Under 17 band: Year 12, true age range 01/09/2008-31/08/2009. It would be
-- easy, and wrong, to conclude from that alone that Ovalball should offer a
-- Girls U17 team.
--
-- The competition rules say otherwise. The 2026 Girls League runs U11, U12,
-- U13, U14, U15, U16 and U18 -- rule 4.2 enumerates exactly those divisions
-- when it sets minimum registered players. The 2025 edition of the same
-- document DID include U17. So the absence is a deliberate change between
-- editions, not an omission, and must not be "corrected" by assumption.
--
-- This is the distinction the season engine now has to hold: a player can
-- become regulatory age U17 without Ovalball manufacturing a Girls U17
-- operational competition team.

do $$
declare v_auth uuid; v_importer uuid;
begin
  select id into v_auth from public.regulatory_authorities where code = 'RFL';
  select id into v_importer from auth.users where email = 'regulatory-content-import@ovalball.internal';

  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, landing_page_url, document_version, retrieved_on, effective_from,
    review_state, notes, provenance_notes
  ) values
  (
    'RFL-GIRLS-COMP-2026', v_auth, 'league',
    'Girls Rugby League Competition Rules 2026', 'COMPETITION_RULES', 'PRIMARY_COMPETITION_OVERLAY',
    'https://www.rugby-league.com/uploads/docs/Girls%20League%20Competition%20Rules%202026.pdf',
    'https://www.rugby-league.com/competitions/ncrl/girls-rugby-league',
    '2026 season', date '2026-09-07', date '2026-01-01', 'VERIFIED_CURRENT',
    'Establishes the 2026 Girls League divisions as U11, U12, U13, U14, U15, U16 and U18 -- rule 4.2 enumerates exactly these when setting minimum registered players (U13/U14/U18 minimum 15; U15/U16 minimum 17; U11/U12 may participate below 15). THERE IS NO U17 DIVISION. Rule 4.4: players are eligible in their true age group or one age group above. Rule 4.5: players must have turned 16 before participating in U18 fixtures. Rule 4.9: dispensations are governed by the RFL Dispensation Policy and the League neither administers nor approves them.',
    'Retrieved by ordinary public HTTPS GET from rugby-league.com on 2026-09-07; no authentication or evasion needed. 13 pages, 279317 bytes, SHA-256 50c87d522fc4d8b37e84c360c6517ed339d8437b811328ae0ce89d1b6e5dc07b, full text layer. Copy in research-ingestion/rfl/ (gitignored). Linked from the RFL''s own Girls Rugby League page, last updated 26 Feb 2026.'
  ),
  (
    'RFL-GIRLS-COMP-2025', v_auth, 'league',
    'Girls Rugby League Competition Rules 2025', 'COMPETITION_RULES', 'PRIMARY_COMPETITION_OVERLAY',
    'https://www.rugby-league.com/uploads/docs/Girls%20League%20Competition%20Rules%202025.pdf',
    'https://www.rugby-league.com/competitions/ncrl/girls-rugby-league',
    '2025 season', date '2026-09-07', date '2025-01-01', 'SUPERSEDED',
    'Banked as COMPARATIVE EVIDENCE, not as a current rule source. Its age tokens are U11, U12, U13, U14, U15, U16, U17 and U18 -- it DID carry a U17 division. Set against the 2026 edition, which carries U11-U16 and U18, this establishes that the withdrawal of Girls U17 for 2026 is a deliberate change between editions rather than a drafting omission. No value from this document may be published as a current rule.',
    'Retrieved by ordinary public HTTPS GET from rugby-league.com on 2026-09-07. 12 pages, 197132 bytes, SHA-256 8ffdd6e381d48019af7ca5a8c2590a9da1ba0fbfb7116d9d26e941f3011b70f0, full text layer. Copy in research-ingestion/rfl/.'
  ),
  (
    'RFL-GIRLS-U12-RULES-2026', v_auth, 'league',
    'Under 12s Girls Rugby League Modified Rules 2026', 'COMPETITION_RULES', 'PRIMARY_RULE_BOOK',
    'https://www.rugby-league.com/uploads/docs/Under%2012''s%20Girls%20Rugby%20League%20Rules%202026.pdf',
    'https://www.rugby-league.com/competitions/ncrl/girls-rugby-league',
    '2026 season', date '2026-09-07', date '2026-01-01', 'VERIFIED_CURRENT',
    'The modified Rules of Play for the Under 12 girls division. Acquired and banked; structured extraction of its values is a separate step and no fact has been populated from it here.',
    'Retrieved by ordinary public HTTPS GET from rugby-league.com on 2026-09-07. 141325 bytes, SHA-256 9e2c0792aaaa0380fcc8a73a830b54e64bf6bc2214bc67f83644b75bc40b911f. Copy in research-ingestion/rfl/.'
  )
  on conflict (source_key) do update set
    notes = excluded.notes, provenance_notes = excluded.provenance_notes,
    review_state = excluded.review_state, updated_at = now();
end $$;

-- The finding, recorded where the season engine's reviewers will meet it.
do $$
begin
  if not exists (select 1 from public.regulatory_conflicts where conflict_key = 'RFL-GIRLS-U17-WITHDRAWN-2026') then
    insert into public.regulatory_conflicts (conflict_key, topic, rugby_code, description, review_state)
    values (
      'RFL-GIRLS-U17-WITHDRAWN-2026', 'RULES', 'league',
      'GIRLS U17 EXISTS AS A REGULATORY AGE BUT NOT AS A 2026 COMPETITION DIVISION, AND THE U16 COHORT THEREFORE HAS NO ESTABLISHED AUTOMATIC SUCCESSOR. '
      || 'RFL Operational Rules 2026 Section F13 lists Under 17s as a general age band (Year 12, true age range 01/09/2008-31/08/2009). But the Girls Rugby League Competition Rules 2026 (RFL-GIRLS-COMP-2026) run U11, U12, U13, U14, U15, U16 and U18 only -- rule 4.2 enumerates exactly those divisions. The 2025 edition (RFL-GIRLS-COMP-2025) DID include U17, so the withdrawal is deliberate. '
      || 'WHAT IS ESTABLISHED: rule 4.4 allows a player to play in her true age group or one above, and rule 4.5 requires a player to have turned 16 before participating in U18 fixtures. Those establish ELIGIBILITY FOR AN INDIVIDUAL PLAYER. '
      || 'WHAT IS NOT ESTABLISHED: an automatic operational successor for a whole U16 cohort at season rollover. The 4.5 condition ("has turned 16") cannot be assumed true of every player in a squad, and no clause states that a U16 team becomes a U18 team. '
      || 'CONSEQUENCE: internal.next_age_grade_for returns null for league girls at U16, which routes that transition to requires_manual_choice / NEEDS_ATTENTION rather than proposing a target. This is the designed behaviour, not a gap. No Girls U17 operational identity has been created, and none may be created from the general age band alone. '
      || 'TO CLOSE THIS: confirm with the RFL what a Girls U16 cohort does at the end of the 2026 season -- whether it moves to U18, disbands, or is handled club by club.',
      'OPEN'
    );
  end if;
end $$;
