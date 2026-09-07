-- Phase 4B: the Rules of Play, from Regulation 15 Appendices 1-9.
--
-- This is the population the whole Rugby Hub has been building towards: ball
-- size, pitch size, player numbers, scrum and lineout configuration, kicking,
-- restarts, substitutions and the contact progression, for every union age
-- grade Ovalball supports.
--
-- THE GIRLS AMBIGUITY, AND HOW IT WAS RESOLVED
--
-- The extraction found one genuine gap. Appendices 1-8 never mention gender --
-- they are written per single year -- while master Regulation 15.6 organises
-- the girls game into dual age bands (U12/U11, U14/U13, U16/U15, U18/U17).
-- Below U15 nothing stated which appendix governs a girls band: does the
-- U14/U13 band play Appendix 8 (U14) or Appendix 7 (U13)? The two readings
-- give different ball sizes, pitch sizes, scrum sizes and half lengths for the
-- same child, so it was left unpopulated rather than guessed.
--
-- The developer put the question to the RFU directly. The RFU's answer: girls
-- at U12 and U14 follow the same Rules of Play as the boys, to ensure equality
-- within the game. That settles it in favour of the band being governed by the
-- appendix for the year it is named after -- Girls U12 plays Appendix 6, Girls
-- U14 plays Appendix 8.
--
-- That answer is recorded as a source in its own right, and honestly: it is a
-- direct consultation reported by the developer, NOT a published document. It
-- cannot be independently re-read the way an appendix can, so it is classified
-- as explanatory guidance rather than primary regulation, and it is cited as
-- SUPPORTING evidence for the applicability decision -- never as the source of
-- a rule VALUE. Every value below still comes from the appendix text.
--
-- WHY EQUALITY FALLS OUT OF THE SCHEMA RATHER THAN BEING TYPED TWICE
--
-- "Girls follow the same rules as the boys" is expressed by attaching the SAME
-- fact row to both identities through regulatory_fact_applicability. There is
-- one U12 ball-size fact and it applies to RFU-U12 and RFU-GIRLS-U12 alike.
-- Nothing is copied, so nothing can later drift apart and quietly stop being
-- equal -- which is exactly what the many-to-many was for.

do $$
declare
  v_importer uuid;
  v_clarification uuid;
  v_auth uuid;
  v_src uuid;
  v_fact uuid;
  r record;
  c record;
begin
  select id into v_importer from auth.users where email = 'regulatory-content-import@ovalball.internal';
  if v_importer is null then raise exception 'regulatory-content-import principal missing.'; end if;
  select id into v_auth from public.regulatory_authorities where code = 'RFU';

  -- ============================================================
  -- 1. The RFU's direct clarification, recorded for what it is.
  -- ============================================================
  insert into public.regulatory_sources (
    source_key, authority_id, rugby_code, title, source_type, authority_classification,
    canonical_url, retrieved_on, effective_from, review_state, notes, provenance_notes
  ) values (
    'RFU-CLARIFICATION-GIRLS-BANDS-2026',
    v_auth, 'union',
    'RFU direct clarification: girls U12 and U14 age bands follow the boys Rules of Play',
    'MEDIA_STATEMENT', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby',
    date '2026-09-07', date '2026-08-01', 'VERIFIED_CURRENT',
    'Answers the one ambiguity the appendix extraction could not close: Appendices 1-8 are silent on gender, while Regulation 15.6 organises the girls game into dual age bands. The RFU stated that girls at U12 and U14 follow the same Rules of Play as the boys, to ensure equality within the game. Girls U12 therefore takes Appendix 6 and Girls U14 takes Appendix 8 -- the band is governed by the appendix for the year it is named after.',
    'DIRECT CONSULTATION WITH THE RFU, REPORTED BY THE DEVELOPER (2026-09-07). This is NOT a published document: it has no URL of its own, no effective date of its own, no SHA-256, and it cannot be independently re-read the way an appendix page can. It is therefore classified as OFFICIAL_EXPLANATORY_GUIDANCE rather than PRIMARY_REGULATION, and is only ever cited as SUPPORTING evidence for an APPLICABILITY decision -- it is never the source of a rule value. Every value in the facts it supports is taken from the appendix text itself. If the RFU later publishes this in writing, replace this row with the document.'
  )
  on conflict (source_key) do update set notes = excluded.notes, provenance_notes = excluded.provenance_notes, updated_at = now();

  select id into v_clarification from public.regulatory_sources where source_key = 'RFU-CLARIFICATION-GIRLS-BANDS-2026';

  -- ============================================================
  -- 2. The Rules of Play.
  --
  --    `identities` names every regulatory identity the fact governs. The U12
  --    and U14 rows carry their girls band alongside the single-year identity;
  --    that is the equality decision, and it is one row, not two.
  -- ============================================================
  for r in
    select * from (values

    -- ---- Player counts ----
    ('U7','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,4,null,'Maximum 4-a-side. Teams must be of equal numbers.','{RFU-U7}',1),
    ('U8','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,6,null,'Maximum 6-a-side. Teams must be of equal numbers.','{RFU-U8}',2),
    ('U9','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,7,null,'Maximum 7-a-side. Teams must be of equal numbers.','{RFU-U9}',3),
    ('U10','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,8,null,'Maximum 8-a-side. Teams must be of equal numbers.','{RFU-U10}',4),
    ('U11','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,9,null,'Maximum 9-a-side. Teams must be of equal numbers.','{RFU-U11}',5),
    ('U12','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,12,null,'Maximum 12-a-side. At a scrum, 5 players form the scrum and the rest form the back line.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,13,null,'Maximum 13-a-side. Six players are forwards and form the scrum; the rest form the back line.','{RFU-U13}',7),
    ('U14','PLAYER-COUNT','PLAYER_COUNT','INTEGER',null,15,null,'Maximum 15-a-side. Eight players are forwards and form the scrum; the rest form the back line.','{RFU-U14,RFU-GIRLS-U14}',8),

    -- ---- Ball size ----
    ('U7','BALL-SIZE','BALL_SIZE','ENUM','3',null,null,'Ball size 3.','{RFU-U7}',1),
    ('U8','BALL-SIZE','BALL_SIZE','ENUM','3',null,null,'Ball size 3.','{RFU-U8}',2),
    ('U9','BALL-SIZE','BALL_SIZE','ENUM','3',null,null,'Ball size 3.','{RFU-U9}',3),
    ('U10','BALL-SIZE','BALL_SIZE','ENUM','4',null,null,'Ball size 4.','{RFU-U10}',4),
    ('U11','BALL-SIZE','BALL_SIZE','ENUM','4',null,null,'Ball size 4.','{RFU-U11}',5),
    ('U12','BALL-SIZE','BALL_SIZE','ENUM','4',null,null,'Ball size 4.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','BALL-SIZE','BALL_SIZE','ENUM','4',null,null,'Ball size 4.','{RFU-U13}',7),
    ('U14','BALL-SIZE','BALL_SIZE','ENUM','4',null,null,'Ball size 4.','{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15-U18','BALL-SIZE','BALL_SIZE','ENUM','5',null,null,'Ball size 5 at U15, U16, U17 and U18.','{RFU-U15,RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}',9),

    -- ---- Pitch length ----
    ('U7','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,20,'Maximum 20 metres long, plus 5 metres for each in-goal area.','{RFU-U7}',1),
    ('U8','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,45,'Maximum 45 metres long, plus 5 metres for each in-goal area.','{RFU-U8}',2),
    ('U9','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,60,'Maximum 60 metres long, plus 5 metres for each in-goal area.','{RFU-U9}',3),
    ('U10','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,60,'Maximum 60 metres long, plus 5 metres for each in-goal area.','{RFU-U10}',4),
    ('U11','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,60,'Maximum 60 metres long, plus 5 metres for each in-goal area.','{RFU-U11}',5),
    ('U12','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,60,'Maximum 60 metres long, plus 5 metres for each in-goal area -- half a full-size pitch.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,90,'Maximum 90 metres long, plus 5 metres for each in-goal area -- a full-size pitch.','{RFU-U13}',7),
    ('U14','PITCH-LENGTH','PITCH_LENGTH','DISTANCE',null,null,100,'Maximum 100 metres long, plus 5 metres for each in-goal area -- a full-size pitch.','{RFU-U14,RFU-GIRLS-U14}',8),

    -- ---- Pitch width ----
    ('U7','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,12,'Maximum 12 metres wide.','{RFU-U7}',1),
    ('U8','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,22,'Maximum 22 metres wide.','{RFU-U8}',2),
    ('U9','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,30,'Maximum 30 metres wide.','{RFU-U9}',3),
    ('U10','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,35,'Maximum 35 metres wide.','{RFU-U10}',4),
    ('U11','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,43,'Maximum 43 metres wide.','{RFU-U11}',5),
    ('U12','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,43,'Maximum 43 metres wide.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,60,'Maximum 60 metres wide.','{RFU-U13}',7),
    ('U14','PITCH-WIDTH','PITCH_WIDTH','DISTANCE',null,null,70,'Maximum 70 metres wide.','{RFU-U14,RFU-GIRLS-U14}',8),

    -- ---- Contact progression ----
    ('U7','CONTACT','CONTACT_RULE','TEXT','Tag rugby. No tackling and no contact of any kind, other than removing a tag from the ball carrier''s belt. No hand-off or fend-off. The ball carrier must stay on their feet and may not dive to score.',null,null,'The only permitted contact is the tag itself. Shirt pulling, barging or forcing the ball carrier into touch are all penalised.','{RFU-U7}',1),
    ('U8','CONTACT','CONTACT_RULE','TEXT','Tag rugby. No tackling and no contact of any kind, other than removing a tag from the ball carrier''s belt. No hand-off or fend-off. Players are permitted to go to ground to score.',null,null,'As U7, except that going to ground to score a try is allowed.','{RFU-U8}',2),
    ('U9','CONTACT','CONTACT_RULE','TEXT','The tackle is introduced, and nothing else: no rucks, mauls, lineouts or scrums. A tackle occurs when the ball carrier is held by one or more opponents and brought to ground, and must include the use of arms.',null,null,'Transitional contact. The referee calls "Tackle" and, where the carrier goes to ground, "Tackle-Release".','{RFU-U9}',3),
    ('U10','CONTACT','CONTACT_RULE','TEXT','Tackle, ruck and maul. The contest for the ball is limited to one player against one player. Opponents must grip and hold the ball carrier below the base of the sternum.',null,null,'Ruck and maul are introduced at this grade, with a strictly limited contest.','{RFU-U10}',4),
    ('U11','CONTACT','CONTACT_RULE','TEXT','Tackle, ruck and maul, with the contest for the ball limited to two players against two players. The tackler must grip and hold the ball carrier below the base of the sternum.',null,null,'The contest widens from 1v1 to 2v2.','{RFU-U11}',5),
    ('U12','CONTACT','CONTACT_RULE','TEXT','Tackle, ruck and maul with no limit on the numbers contesting for the ball. The hand-off is introduced, permitted below the armpits of the opponent. The tackler must grip and hold the ball carrier below the base of the sternum.',null,null,'First grade at which the contest is unlimited and the hand-off is legal.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','CONTACT','CONTACT_RULE','TEXT','Full contact. No limit on numbers contesting for the ball including in the maul and ruck. The tackler must grip and hold the ball carrier below the base of the sternum.',null,null,'The ball carrier must not go into contact with shoulders below their hips, dip late and low, or place their head into the head space of an opponent.','{RFU-U13}',7),
    ('U14','CONTACT','CONTACT_RULE','TEXT','Full contact. The tackler must grip and hold the ball carrier below the base of the sternum.',null,null,'The ball carrier must not go into contact with shoulders below their hips, dip late and low, or place their head into the head space of an opponent.','{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15-U18','CONTACT','CONTACT_RULE','TEXT','Full contact under the World Rugby Laws and the World Rugby Under 19 Law Variations. The tackler must grip and hold the ball carrier below the base of the sternum; sanction is a penalty to the non-offending team. The technique known as "Squeezeball" is prohibited outright, and no one involved in teaching or coaching rugby may teach or encourage it.',null,null,'Applies to boys and girls alike at U15 to U18.','{RFU-U15,RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}',9),

    -- ---- Scrum ----
    ('U7','SCRUM','SCRUM_CONFIGURATION','TEXT','No scrums.',null,null,'Tag rugby: the sanction for all infringements is a free pass.','{RFU-U7}',1),
    ('U8','SCRUM','SCRUM_CONFIGURATION','TEXT','No scrums.',null,null,'Tag rugby: the sanction for all infringements is a free pass.','{RFU-U8}',2),
    ('U9','SCRUM','SCRUM_CONFIGURATION','TEXT','No scrums.',null,null,'The tackle is introduced at U9, but the scrum is not.','{RFU-U9}',3),
    ('U10','SCRUM','SCRUM_CONFIGURATION','TEXT','Uncontested scrum of 3 players a side: a prop either side of the hooker. The nearest 3 players form it, with the fourth nearest acting as scrum half.',null,null,'Uncontested scrum introduced. All players trained -- late specialisation. Awarded for a forward pass or a knock-on.','{RFU-U10}',4),
    ('U11','SCRUM','SCRUM_CONFIGURATION','TEXT','Scrum of 3 players a side with a contested strike. The nearest 3 players form it, with the fourth nearest acting as scrum half.',null,null,'The contested strike is introduced. Also awarded where the ball does not emerge from a maul or ruck, or becomes unplayable.','{RFU-U11}',5),
    ('U12','SCRUM','SCRUM_CONFIGURATION','TEXT','Scrum of 5 players a side with a contested strike: a prop either side of the hooker in the front row, plus two locks in the second row. The nearest 5 players form it, with a sixth acting as scrum half.',null,null,'All players trained -- late specialisation.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','SCRUM','SCRUM_CONFIGURATION','TEXT','Fully contested scrum of 6 players a side, who must be confident and competent: a prop either side of the hooker, two locks, and a Number 8 bound between the hips of the two locks.',null,null,'First fully contested scrum.','{RFU-U13}',7),
    ('U14','SCRUM','SCRUM_CONFIGURATION','TEXT','Contested scrum of 8 players a side, who must be confident and competent: front row, two locks and three players forming the back row. The Number 8 may pick the ball up from the base of the scrum.',null,null,'Full eight-player scrum.','{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15-BOYS','SCRUM','SCRUM_CONFIGURATION','TEXT','Additional variations applicable to U15 boys only: there is no turnover law, and if a scrum is reset for wheeling beyond 45 degrees the throw-in goes to the side in possession at that point. The scrum-half not throwing in must not move beyond the middle line of the scrum until the ball has emerged or an opponent has lifted it from the ground.',null,null,'Explicitly headed "Additional Law Variations applicable to U15 boys only" in Appendix 9 -- it does NOT apply to girls.','{RFU-U15}',9),

    -- ---- Lineout ----
    ('U7-U13','LINEOUT','LINEOUT_CONFIGURATION','TEXT','No lineouts.',null,null,'The lineout is not part of the game below U14. The ball returns to play by free pass or free kick instead.','{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-GIRLS-U12}',1),
    ('U14','LINEOUT','LINEOUT_CONFIGURATION','TEXT','Uncontested lineout, introduced at this grade. The throw must be down the middle of the channel; if it is not straight the lineout goes to the opposing team, and if that throw is not straight a scrum is awarded on the 15m line.',null,null,'First lineout in the age grade pathway.','{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15','LINEOUT','LINEOUT_CONFIGURATION','TEXT','The lineout is uncontested at U15. Lifting and supporting is permitted -- a player may bind to a jumper until they have returned to the ground.',null,null,'Stated in Appendix 9 under the U15 heading.','{RFU-U15}',9),

    -- ---- Kicking ----
    ('U7','KICKING','KICKING','TEXT','Kicking of any kind is prohibited.',null,null,'Tag rugby.','{RFU-U7}',1),
    ('U8','KICKING','KICKING','TEXT','Kicking of any kind is prohibited.',null,null,'Tag rugby.','{RFU-U8}',2),
    ('U9','KICKING','KICKING','TEXT','Kicking of any kind is prohibited.',null,null,'Contact is introduced at U9 but kicking is not.','{RFU-U9}',3),
    ('U10','KICKING','KICKING','TEXT','Kicking of any kind is prohibited.',null,null,'Scrum, ruck and maul are introduced at U10 but kicking is not.','{RFU-U10}',4),
    ('U11','KICKING','KICKING','TEXT','Tactical kicking and kicking restarts are introduced. Kicking the ball along the ground (a "fly-hack") is prohibited. A ball kicked from outside the 15-metre line directly into touch concedes a free pass to the opposition in line with where it was kicked.',null,null,'First grade at which kicking is permitted at all.','{RFU-U11}',5),
    ('U12','KICKING','KICKING','TEXT','Kicking the ball along the ground (a "fly-hack") is prohibited. Box kicks and drop goals are not permitted. A ball kicked from outside the 22-metre line directly into touch concedes a free pass 5 metres in from the touchline.',null,null,'Kicking remains restricted at U12.','{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','KICKING','KICKING','TEXT','Kicking the ball along the ground (a "fly-hack") is allowed. Box kicks and drop goals are still not permitted. A ball kicked from outside the 22-metre line directly into touch concedes a free pass 10 metres in from the touchline.',null,null,'The fly-hack becomes legal at U13.','{RFU-U13}',7),
    ('U14','KICKING','KICKING','TEXT','Kicking the ball along the ground (a "fly-hack") is allowed. Box kicks and drop goals are permitted. A ball kicked from outside the 22-metre line directly into touch concedes a lineout to the opposition.',null,null,'The last kicking restrictions are lifted at U14.','{RFU-U14,RFU-GIRLS-U14}',8),

    -- ---- Restarts ----
    ('U7-U10','RESTART','RESTART','TEXT','Play starts and restarts with a free pass from the centre of the pitch. The opposition must be 3 metres back from the mark and may not move forward until the ball leaves the passer''s hands.',null,null,'After a try, the non-scoring team restarts with a free pass from the centre.','{RFU-U7,RFU-U8,RFU-U9,RFU-U10}',1),
    ('U11','RESTART','RESTART','TEXT','A drop kick from the centre of the half way line starts each half and restarts play after a score. The kicker''s team must be behind the ball; the non-kicking team must be at least 7 metres back. After a score the opponents of the scoring team choose whether to receive or kick off.',null,null,'Kicking restarts are introduced at U11.','{RFU-U11}',5),
    ('U12','RESTART','RESTART','TEXT','A drop kick from the centre of the half way line starts each half and restarts play after a score. The non-kicking team must be at least 7 metres back. After a score the opponents of the scoring team choose whether to receive or kick off.',null,null,null,'{RFU-U12,RFU-GIRLS-U12}',6),
    ('U13','RESTART','RESTART','TEXT','A drop kick from the centre of the half way line starts each half and restarts play after a score. The non-kicking team must be at least 10 metres back. The team scored against chooses whether to receive or kick off.',null,null,'The retreat distance grows from 7 to 10 metres at U13.','{RFU-U13}',7),
    ('U14','RESTART','RESTART','TEXT','A drop kick from the centre of the half way line starts each half and restarts play after a score. The non-kicking team must be at least 10 metres back. After a score, the opponents of the scoring team kick to the opposing team.',null,null,null,'{RFU-U14,RFU-GIRLS-U14}',8),

    -- ---- Substitutions ----
    ('U7-U13','SUBSTITUTION','SUBSTITUTION','TEXT','Rolling substitutions are permitted and substituted players can return at any time. Substitutions may only take place when the ball is dead and always with the referee''s permission.',null,null,'Coaches are not permitted on the pitch while the game is in play.','{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-GIRLS-U12}',1),
    ('U14','SUBSTITUTION','SUBSTITUTION','TEXT','Rolling substitutions are permitted and substituted players can be re-used at any time. Substitutions may only take place when the ball is dead and always with the referee''s permission.',null,null,null,'{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15-U18','SUBSTITUTION','SUBSTITUTION','TEXT','Rolling substitutions are permitted and substituted players can be re-used at any time. There is no limit on the number of replacements a team may have, even where the competing teams have unequal numbers, unless a competition''s own regulations specify otherwise.',null,null,null,'{RFU-U15,RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}',9),

    -- ---- Sin bin ----
    ('U13','SIN-BIN','OTHER_AGE_VARIATION','DURATION',null,5,null,'Sin bin duration for a temporary suspension.','{RFU-U13}',7),
    ('U14','SIN-BIN','OTHER_AGE_VARIATION','DURATION',null,5,null,'Sin bin duration for a temporary suspension.','{RFU-U14,RFU-GIRLS-U14}',8),
    ('U15','SIN-BIN','OTHER_AGE_VARIATION','DURATION',null,6,null,'Sin bin duration for a temporary suspension at U15.','{RFU-U15}',9),
    ('U16-U18','SIN-BIN','OTHER_AGE_VARIATION','DURATION',null,7,null,'Sin bin duration for a temporary suspension at U16, U17 and U18.','{RFU-U16,RFU-GIRLS-U16,RFU-GIRLS-U18}',9),

    -- ---- Pitch safety ----
    ('U7-U14','PITCH-SAFETY','PITCH_VARIATION','TEXT','The referee and coaches may agree to reduce the pitch size provided they agree it is safe to do so. Adjacent pitches should be no closer than 5 metres.',null,null,'A safety provision, and the reason a maximum rather than a fixed pitch size is stated.','{RFU-U7,RFU-U8,RFU-U9,RFU-U10,RFU-U11,RFU-U12,RFU-U13,RFU-U14,RFU-GIRLS-U12,RFU-GIRLS-U14}',1)

    ) as t(age, slug, fact_type, value_type, v_text, v_int, v_dist, notes, identities, appendix)
  loop
    insert into public.regulatory_facts (
      fact_key, fact_type, topic, rugby_code, value_type,
      value_text, value_integer, value_duration_minutes, value_enum, value_distance_metres,
      obligation_level, effective_from, status, verified_by, verified_at, notes, created_by, updated_by
    ) values (
      'RFU-REG15-APP-' || r.age || '-' || r.slug,
      r.fact_type, 'RULES', 'union', r.value_type,
      case when r.value_type = 'TEXT' then r.v_text end,
      case when r.value_type = 'INTEGER' then r.v_int end,
      case when r.value_type = 'DURATION' then r.v_int end,
      case when r.value_type = 'ENUM' then r.v_text end,
      case when r.value_type = 'DISTANCE' then r.v_dist end,
      'MANDATORY', date '2025-08-01', 'VERIFIED', v_importer, now(),
      coalesce(r.notes, '') || ' [RFU Regulation 15 Appendix ' || r.appendix || ']',
      v_importer, v_importer
    )
    on conflict (fact_key) do nothing
    returning id into v_fact;

    if v_fact is null then
      select id into v_fact from public.regulatory_facts where fact_key = 'RFU-REG15-APP-' || r.age || '-' || r.slug;
    end if;

    insert into public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
    select v_fact, ri.id from public.regulatory_identities ri
    where ri.identity_key = any (r.identities::text[])
    on conflict do nothing;

    -- Primary citation: the appendix the value was read from.
    select id into v_src from public.regulatory_sources
    where source_key = 'RFU-REG15-APP' || r.appendix || '-2025-001';
    insert into public.regulatory_fact_citations (fact_id, source_id, support_role, verification_notes, created_by)
    values (v_fact, v_src, 'PRIMARY',
      'Read from the developer-supplied browser print capture of the appendix page (captured 2026-09-07 from englandrugby.com; full text layer, machine-extracted). Carried forward into 2026/27 on the developer''s explicit authorisation -- see the source''s carries_forward_note.',
      v_importer)
    on conflict do nothing;

    -- Supporting citation on the girls-band rows only: the RFU's direct
    -- clarification justifies the APPLICABILITY, never the value.
    if r.identities like '%GIRLS-U12%' or r.identities like '%GIRLS-U14%' then
      insert into public.regulatory_fact_citations (fact_id, source_id, support_role, verification_notes, created_by)
      values (v_fact, v_clarification, 'SUPPORTING',
        'Supports the decision to apply this fact to the girls U12/U14 dual age band. The RFU confirmed directly that girls at U12 and U14 follow the same Rules of Play as the boys, to ensure equality within the game. The VALUE comes from the appendix; this citation covers only who it applies to.',
        v_importer)
      on conflict do nothing;
    end if;

    v_fact := null;
  end loop;

  -- ============================================================
  -- 3. The appendices independently corroborate the master on playing time.
  --    Recorded as SUPPORTING citations on the existing master facts rather
  --    than as duplicate facts -- two sources agreeing is worth recording,
  --    two rows holding the same number is a liability.
  -- ============================================================
  for c in
    select * from (values
      ('RFU-REG15-2026-HALF-MINUTES-U7-U8', 1), ('RFU-REG15-2026-HALF-MINUTES-U9-U10', 3),
      ('RFU-REG15-2026-HALF-MINUTES-U11-U12', 5), ('RFU-REG15-2026-HALF-MINUTES-U13-U14', 7)
    ) as t(fact_key, appendix)
  loop
    select id into v_fact from public.regulatory_facts where fact_key = c.fact_key;
    select id into v_src from public.regulatory_sources where source_key = 'RFU-REG15-APP' || c.appendix || '-2025-001';
    if v_fact is not null and v_src is not null then
      insert into public.regulatory_fact_citations (fact_id, source_id, support_role, verification_notes, created_by)
      values (v_fact, v_src, 'SUPPORTING',
        'The appendix states the same maximum minutes per half as master Regulation 15.12, independently confirming the value.',
        v_importer)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ============================================================
-- Guards.
-- ============================================================
do $$
declare v_n int; v_bad text;
begin
  -- Nothing may apply to no identity.
  select count(*) into v_n from public.regulatory_facts f
  where f.fact_key like 'RFU-REG15-APP-%'
    and not exists (select 1 from public.regulatory_fact_applicability a where a.fact_id = f.id);
  if v_n > 0 then raise exception '% appendix fact(s) apply to no identity -- likely a mistyped identity key.', v_n; end if;

  -- Nothing may be uncited.
  select count(*) into v_n from public.regulatory_facts f
  where f.fact_key like 'RFU-REG15-APP-%'
    and not exists (select 1 from public.regulatory_fact_citations c where c.fact_id = f.id);
  if v_n > 0 then raise exception '% appendix fact(s) have no citation.', v_n; end if;

  -- Equality: every fact on a boys single-year identity at U12/U14 must ALSO
  -- carry its girls band. This is the RFU's ruling expressed as an invariant.
  select string_agg(f.fact_key, ', ') into v_bad
  from public.regulatory_facts f
  join public.regulatory_fact_applicability a on a.fact_id = f.id
  join public.regulatory_identities ri on ri.id = a.regulatory_identity_id
  where f.fact_key like 'RFU-REG15-APP-%' and ri.identity_key in ('RFU-U12', 'RFU-U14')
    and not exists (
      select 1 from public.regulatory_fact_applicability a2
      join public.regulatory_identities ri2 on ri2.id = a2.regulatory_identity_id
      where a2.fact_id = f.id
        and ri2.identity_key = case ri.identity_key when 'RFU-U12' then 'RFU-GIRLS-U12' else 'RFU-GIRLS-U14' end
    );
  if v_bad is not null then
    raise exception 'Girls do NOT have equal Rules of Play -- these facts apply to the boys grade but not the girls band: %', v_bad;
  end if;

  -- The season guard must still be clean.
  if exists (select 1 from public.regulatory_season_compatibility_report()) then
    raise exception 'Season incompatibility introduced by the appendix population.';
  end if;
end $$;
