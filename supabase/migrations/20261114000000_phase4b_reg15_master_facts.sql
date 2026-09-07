-- Phase 4B, first population: facts from RFU Regulation 15 (2026/27 master).
--
-- SCOPE, AND WHY IT IS NARROWER THAN IT LOOKS
--
-- Only facts drawn from the MASTER regulation are populated here, because that
-- is the only Regulation 15 document verified as current (2026/27, source
-- RFU-REG15-MASTER-2026-27).
--
-- Deliberately NOT populated: ball size, pitch dimensions, player counts,
-- scrum and lineout configuration, tackle height -- everything a parent would
-- call "the rules of the game". Those live in Appendices 1 to 9, and the
-- appendix text on record is the 2025/26 edition while the master regulation
-- is 2026/27. That mismatch is recorded as the open conflict
-- RFU-REG15-APPENDIX-SEASON-SPLIT and it blocks those facts until the 2026/27
-- appendices are obtained. Publishing a 2025/26 ball size beside a 2026/27
-- half length, with nothing to tell them apart, is exactly the kind of quiet
-- inconsistency this whole layer exists to prevent.
--
-- What IS here is the framework: how a child's age grade is decided, how long
-- they may play, when contact starts, when a match must be stopped, the Half
-- Game Rule, and the girls dual age band structure. Most of it is more
-- immediately useful to a parent than a ball size anyway.
--
-- APPLICABILITY, NOT COPYING
--
-- Every fact is written once and attached to each age grade it governs through
-- regulatory_fact_applicability. The 20-minute half is ONE row applying to
-- U11, U12 and the girls U12/U11 band -- not three rows that can drift apart.
-- That is the point of the many-to-many, and it is why the playing-time facts
-- are keyed by the BAND the regulation states ("U11s & U12s") rather than by
-- age grade.

do $$
declare
  v_importer uuid;
  v_source uuid;
  v_fact uuid;
  r record;
begin
  select id into v_importer from auth.users where email = 'regulatory-content-import@ovalball.internal';
  if v_importer is null then
    raise exception 'The regulatory-content-import principal is missing; refusing to attribute imported facts to nobody.';
  end if;

  select id into v_source from public.regulatory_sources where source_key = 'RFU-REG15-MASTER-2026-27';
  if v_source is null then
    raise exception 'RFU-REG15-MASTER-2026-27 source row is missing; run 20261109000000 first.';
  end if;

  for r in
    select * from (values

    -- ---------- Framework: applies to every union age grade ----------
    ('RFU-REG15-2026-AGE-GRADE-DETERMINATION', 'PLAYING_ELIGIBILITY', 'RULES', 'TEXT',
     'A player''s age grade is set by their age at midnight on 1 September at the start of the season, and applies for the whole season. Players move up to their new age grade from 1 July, before the next season begins.',
     null::integer, 'MANDATORY', 'Regulation 15.2(1). The 1 July move is the part clubs most often get wrong: a child changes age group in July, not in September.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-SEASON-DATES', 'MATCH_FORMAT', 'RULES', 'TEXT',
     'The 2026-27 age grade season runs from Saturday 5 September 2026 to Monday 3 May 2027. The 2027-28 season runs from Saturday 4 September 2027 to Monday 1 May 2028.',
     null, 'MANDATORY', 'Regulation 15.10(1). Activity outside these dates is governed by the RFU Summer Activity Framework, which is mandatory and forms part of Regulation 15.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-MAX-MATCHES-PER-SEASON', 'MATCH_FORMAT', 'PLAYER_WELFARE', 'INTEGER',
     null, 35, 'MANDATORY', 'Regulation 15.12(1): "No player may play more than 35 matches per season." A whole-season load limit, distinct from the per-day limits.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-HALF-GAME-RULE', 'SUBSTITUTION', 'PLAYER_WELFARE', 'TEXT',
     'Every player named in a match day squad must play at least half of the Available Playing Time. This applies to all contact and non-contact age grade matches, including 7-a-side and festival matches.',
     null, 'MANDATORY', 'Regulation 15.13. Half of the Available Playing Time is the "Half Game Threshold". Time off the pitch counts towards it only for a temporary injury or enforced absence (up to 10 minutes) or a yellow card. It does not apply where a player is permanently removed through injury, genuine risk of injury, a red card, or an abandoned match. The U18 PREM Rugby Academy Competition is the one exception, at 20% rather than 50%.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-ACTIVATE-ALLOWANCE', 'MATCH_FORMAT', 'PLAYER_WELFARE', 'DURATION',
     null, 15, 'RECOMMENDED', 'Regulation 15.12. An additional 15 minutes per day is allowed on top of the playing-time limits for "Activate", the RFU''s injury prevention programme -- so an U16 may have up to 105 minutes total on a match day (90 playing plus 15 Activate).',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    -- ---------- Playing time: keyed by the band the regulation itself uses ----------
    ('RFU-REG15-2026-HALF-MINUTES-U7-U8', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 10, 'MANDATORY', 'Regulation 15.12 playing time table, "U7s & U8s" row: maximum minutes in each match half.', '{RFU-U7,RFU-U8}'),
    ('RFU-REG15-2026-HALF-MINUTES-U9-U10', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 15, 'MANDATORY', 'Regulation 15.12 playing time table, "U9s & U10s" row.', '{RFU-U9,RFU-U10}'),
    ('RFU-REG15-2026-HALF-MINUTES-U11-U12', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 20, 'MANDATORY', 'Regulation 15.12 playing time table, "U11s & U12s" row. Applies to the girls U12/U11 dual age band, whose players are the same school years.', '{RFU-U11,RFU-U12,RFU-GIRLS-U12}'),
    ('RFU-REG15-2026-HALF-MINUTES-U13-U14', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 25, 'MANDATORY', 'Regulation 15.12 playing time table, "U13s & U14s" row. Applies to the girls U14/U13 dual age band.', '{RFU-U13,RFU-U14,RFU-GIRLS-U14}'),
    ('RFU-REG15-2026-HALF-MINUTES-U15', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 30, 'MANDATORY', 'Regulation 15.12 playing time table, "U15s" row.', '{RFU-U15}'),
    ('RFU-REG15-2026-HALF-MINUTES-U16-PLUS', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 35, 'MANDATORY', 'Regulation 15.12 playing time table, "U16s and above" row, which names the girls dual U16/15 age band explicitly. Also applied to the girls U18/U17 band, which is above U16.', '{RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    -- ---------- Playing time per day ----------
    ('RFU-REG15-2026-DAY-MINUTES-U7-U8', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 50, 'MANDATORY', 'Regulation 15.12 playing time table: maximum minutes of rugby per day, across all matches and festivals.', '{RFU-U7,RFU-U8}'),
    ('RFU-REG15-2026-DAY-MINUTES-U9-U10', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 60, 'MANDATORY', 'Regulation 15.12 playing time table: maximum minutes of rugby per day.', '{RFU-U9,RFU-U10}'),
    ('RFU-REG15-2026-DAY-MINUTES-U11-U12', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 70, 'MANDATORY', 'Regulation 15.12 playing time table: maximum minutes of rugby per day. Applies to the girls U12/U11 band.', '{RFU-U11,RFU-U12,RFU-GIRLS-U12}'),
    ('RFU-REG15-2026-DAY-MINUTES-U13-U14', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 80, 'MANDATORY', 'Regulation 15.12 playing time table: maximum minutes of rugby per day. Applies to the girls U14/U13 band.', '{RFU-U13,RFU-U14,RFU-GIRLS-U14}'),
    ('RFU-REG15-2026-DAY-MINUTES-U15-PLUS', 'MATCH_DURATION', 'PLAYER_WELFARE', 'DURATION',
     null, 90, 'MANDATORY', 'Regulation 15.12 playing time table: maximum minutes of rugby per day for U15s and for U16s and above, which share the same 90-minute figure.', '{RFU-U15,RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    -- ---------- Contact ----------
    ('RFU-REG15-2026-CONTACT-NOT-PERMITTED-U7-U8', 'CONTACT_RULE', 'PLAYER_WELFARE', 'BOOLEAN',
     null, 0, 'MANDATORY', 'Regulation 15.10(3) in-season activity table: at U7s and U8s, contact training and contact matches are both "No". Non-contact training and matches are permitted. Contact rugby begins at U9.', '{RFU-U7,RFU-U8}'),
    ('RFU-REG15-2026-CONTACT-PERMITTED-U9-PLUS', 'CONTACT_RULE', 'PLAYER_WELFARE', 'BOOLEAN',
     null, 1, 'MANDATORY', 'Regulation 15.10(3) in-season activity table: from U9s to U18s inclusive, contact training and contact matches are both permitted in season.', '{RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-ADULTS-NOT-IN-CONTACT-TRAINING', 'CONTACT_RULE', 'PLAYER_WELFARE', 'TEXT',
     'Adults must not join in any aspect of contact training with age grade players. This includes holding contact shields or tackle bags, demonstrating tackling or contact techniques, and playing in semi-contact or opposed practices.',
     null, 'MANDATORY', 'Regulation 15.2(10)(d). Frequently broken in good faith by volunteer coaches, which is why it is worth stating to parents as well as to staff.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    -- ---------- Match stop thresholds ----------
    ('RFU-REG15-2026-MATCH-STOP-U7-U13', 'MATCH_FORMAT', 'PLAYER_WELFARE', 'TEXT',
     'A match must be stopped if one team leads by more than 6 tries. Coaches may then agree an alternative format to make the game fairer; any further playing time or results are not officially recorded.',
     null, 'MANDATORY', 'Regulation 15.12(3). Applies from U7 to U13, which includes the girls U12/U11 dual age band.', '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-GIRLS-U12}'),
    ('RFU-REG15-2026-MATCH-STOP-U14-U18', 'MATCH_FORMAT', 'PLAYER_WELFARE', 'TEXT',
     'A match must be stopped if one team leads by more than 50 points. Coaches may then agree an alternative format to make the game fairer; any further playing time or results are not officially recorded.',
     null, 'MANDATORY', 'Regulation 15.12(3), which names the girls dual U14/13 age grade explicitly as falling under the U14-U18 threshold.', '{RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-NO-EXTRA-TIME', 'MATCH_FORMAT', 'RULES', 'TEXT',
     'No extra time is allowed in any age grade match, except time added by the referee for an injury stoppage. Place-kicking or similar contests to resolve a tie are not permitted.',
     null, 'MANDATORY', 'Regulation 15.12(2). A drawn age grade match stays drawn.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    -- ---------- Structure ----------
    ('RFU-REG15-2026-MIXED-RUGBY-ENDS-AT-U12', 'PLAYING_ELIGIBILITY', 'RULES', 'TEXT',
     'Mixed rugby -- boys and girls playing together -- is permitted up to and including U11. From U12 and above it is not permitted, and separate regulations apply to male and female players.',
     null, 'MANDATORY', 'Regulation 15.6, stated between the male and female playing-out-of-age-grade tables. Regulation 15.2(9) adds that girls may play both mixed and girls-only rugby at U11 and below, and that a girl in a U12/U11 combined band may not play with U11 boys.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-GIRLS-U12}'),

    ('RFU-REG15-2026-GIRLS-DUAL-AGE-BANDS', 'PLAYING_ELIGIBILITY', 'RULES', 'TEXT',
     'Girls'' rugby is played in four dual age bands rather than single years: U12/U11 (school years 7 and 6), U14/U13 (years 9 and 8), U16/U15 (years 11 and 10), and U18/U17 (years 13 and 12). There is no separate girls U13, U15 or U17 age grade -- a U13 girl plays in the U14/U13 band.',
     null, 'MANDATORY', 'Regulation 15.6 female playing-out-of-age-grade table, corroborated by the 15.2 Competitive Menu (female columns are Under 12/14/16/18 Female only) and the 15.10 Summer Activity Plan ("U12, 14, 16, 18 GIRLS BANDS").',
     '{RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-GIRLS-PLAYING-UP-WITHIN-BAND', 'PLAYING_UP_DOWN', 'RULES', 'TEXT',
     'In the girls'' game the only playing up permitted is within a player''s own two-year age band. A girl in the U14 band may not play up in the U16s.',
     null, 'MANDATORY', 'Regulation 15.4(1). This is a materially tighter restriction than the boys'' game, where playing up one age grade is permitted from U12 and two age grades at U16.',
     '{RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-PLAY-IN-OWN-AGE-GRADE', 'PLAYING_UP_DOWN', 'RULES', 'TEXT',
     'The priority is always for players to play in their own age grade with their own peers. Playing out of age grade is the exception, and requires the assessments and approvals set out in the regulation to be in place beforehand.',
     null, 'MANDATORY', 'Regulation 15.2(8)(a). Applications for combining, playing up, playing down and 17-year-olds playing adult rugby are made on RFU online forms and take up to 10 days to consider.',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-ADULT-RUGBY-FROM-17', 'PLAYING_ELIGIBILITY', 'PLAYER_WELFARE', 'TEXT',
     'A player may play and train in contact rugby with adults from their 17th birthday, but must not train or play in the front row of a contested scrum until they are 18. Approval is required: the club must have Constituent Body approval to play 17-year-olds in adult rugby that season, the club must have an appointed Safeguarding Officer, and the individual player must be assessed and approved.',
     null, 'MANDATORY', 'Regulation 15.7(1). Approval lasts only until the player''s 18th birthday, after which they may play in any position.',
     '{RFU-U16}'),

    ('RFU-REG15-2026-LEAGUE-RUGBY-FROM-U15', 'MATCH_FORMAT', 'RULES', 'TEXT',
     'League rugby is only permitted from U15 upwards, and league tables may only be published from U15 upwards. Waterfall pools are permitted from U12 upwards but must not be published as full league tables.',
     null, 'MANDATORY', 'Regulation 15.2(10)(a). A common source of confusion for clubs running age grade competitions.',
     '{RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}'),

    ('RFU-REG15-2026-REGISTRATION-45-DAYS', 'PLAYING_ELIGIBILITY', 'RULES', 'TEXT',
     'All age grade club players must be registered annually on the RFU''s Game Management System. New players must be registered within 45 days of first joining the club; existing players within 45 days of the start of a new season.',
     null, 'MANDATORY', 'Regulation 15.2(5). Applies equally to players who only train or play non-contact rugby (Regulation 15.9(3)(a)).',
     '{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-U15,RFU-U16,RFU-GIRLS-U12,RFU-GIRLS-U14,RFU-GIRLS-U16,RFU-GIRLS-U18}')

    ) as t(fact_key, fact_type, topic, value_type, value_text, value_number, obligation_level, notes, identities)
  loop
    insert into public.regulatory_facts (
      fact_key, fact_type, topic, rugby_code, value_type,
      value_text, value_integer, value_duration_minutes, value_boolean,
      obligation_level, effective_from, status, verified_by, verified_at, notes, created_by, updated_by
    ) values (
      r.fact_key, r.fact_type, r.topic, 'union', r.value_type,
      case when r.value_type = 'TEXT' then r.value_text end,
      case when r.value_type = 'INTEGER' then r.value_number end,
      case when r.value_type = 'DURATION' then r.value_number end,
      case when r.value_type = 'BOOLEAN' then r.value_number = 1 end,
      r.obligation_level, date '2026-08-01', 'VERIFIED', v_importer, now(), r.notes, v_importer, v_importer
    )
    on conflict (fact_key) do nothing
    returning id into v_fact;

    if v_fact is null then
      select id into v_fact from public.regulatory_facts where fact_key = r.fact_key;
    end if;

    -- Attach to every identity the regulation says it governs. One fact, many
    -- age grades -- never a copy per grade.
    insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
    select v_fact, ri.id
    from public.regulatory_identities ri
    where ri.identity_key = any (r.identities::text[])
    on conflict do nothing;

    insert into public.regulatory_fact_citations (fact_id, source_id, support_role, verification_notes, created_by)
    values (v_fact, v_source, 'PRIMARY',
      'Read from the developer-supplied browser print capture of the RFU Regulation 15 page (2026/27 edition, Effective 1 August 2026). The capture has no text layer, so this was read from the rendered page image rather than machine-extracted.',
      v_importer)
    on conflict do nothing;

    v_fact := null;
  end loop;
end $$;

-- ============================================================
-- Guard: every identity named above must actually exist. A typo in an
-- identity key would otherwise fail silently -- the applicability insert
-- would simply match zero rows and the fact would apply to nobody.
-- ============================================================

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.regulatory_facts f
  where f.fact_key like 'RFU-REG15-2026-%'
    and not exists (select 1 from public.regulatory_fact_applicability a where a.fact_id = f.id);
  if v_orphans > 0 then
    raise exception 'Phase 4B: % Regulation 15 fact(s) apply to no regulatory identity at all -- almost certainly a mistyped identity key.', v_orphans;
  end if;
end $$;
