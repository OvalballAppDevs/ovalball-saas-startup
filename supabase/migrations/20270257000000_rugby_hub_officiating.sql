-- Rugby Hub Officiating & Respect the Referee.
--
-- Officiating lives in hub_content_items as a new content_type,
-- OFFICIATING_CONCEPT, exactly the pattern Game Knowledge already proved:
-- no standalone table, no separate search, no separate recommendation
-- engine, no new relationship tables. Every relationship shape this domain
-- needs (Officiating<->Officiating, Officiating<->Game Knowledge,
-- Officiating<->Glossary, Officiating<->Skill, Officiating<->Position,
-- Officiating<->regulatory fact) already exists and is already generic on
-- the hub_content_items side. search_hub_content and
-- get_hub_recommended_content already UNION hub_content_items with no
-- content_type filter, so this migration makes zero RPC changes.
--
-- Respect the Referee is a first-class FAMILY inside Officiating
-- (RESPECT_AND_BEHAVIOUR), never a separate content_type.

-- =====================================================================
-- 1. content_type + structured fields.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check
  check (content_type = any (array['COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT', 'OFFICIATING_CONCEPT']));

alter table public.hub_content_items add column if not exists officiating_family text;
alter table public.hub_content_items add column if not exists how_it_is_signalled text;
alter table public.hub_content_items add column if not exists common_misunderstanding text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hub_content_items_officiating_family_check') then
    alter table public.hub_content_items add constraint hub_content_items_officiating_family_check check (
      officiating_family is null or officiating_family = any (array['MATCH_OFFICIALS', 'DECISIONS_AND_SIGNALS', 'DISCIPLINE_AND_SANCTIONS', 'COMMUNICATION', 'RESPECT_AND_BEHAVIOUR', 'BECOMING_AN_OFFICIAL'])
    );
  end if;
end $$;

comment on column public.hub_content_items.officiating_family is 'Taxonomy for OFFICIATING_CONCEPT rows only -- mirrors concept_family''s role for GAME_CONCEPT rows, kept as its own column/constraint rather than reusing concept_family so the two domains'' taxonomies never blur on one column. Null for every other content_type.';
comment on column public.hub_content_items.how_it_is_signalled is 'How a match official communicates a decision (e.g. an arm signal, a call) -- text-first by design, never an image reference. Populated only for OFFICIATING_CONCEPT rows where a decision genuinely has a signal; null and unrendered otherwise.';
comment on column public.hub_content_items.common_misunderstanding is 'A frequent misconception about this concept, addressed directly -- used sparingly, only where a real, common misunderstanding exists. Not populated merely because the column exists.';

-- =====================================================================
-- 2. Regulatory escape-hatch: close the gap found during Officiating
--    archaeology. The original constraint (20270231000000) only ever
--    checked title/summary/body -- it never covered the five free-text
--    columns Game Knowledge added (why_it_matters, what_happens,
--    what_to_watch_for, what_happens_next, union_league_difference), which
--    have carried zero regulatory-escape-hatch protection since they were
--    created. Officiating's subject matter makes this urgent to close now.
--    Existing published rows are unaffected unless re-saved; this is a
--    write-time guard, not a retroactive content edit.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_no_regulatory_escape_hatch;
alter table public.hub_content_items add constraint hub_content_items_no_regulatory_escape_hatch check (
  title !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
  and summary !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
  and (body is null or body !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (why_it_matters is null or why_it_matters !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (what_happens is null or what_happens !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (what_to_watch_for is null or what_to_watch_for !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (what_happens_next is null or what_happens_next !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (union_league_difference is null or union_league_difference !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (how_it_is_signalled is null or how_it_is_signalled !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  and (common_misunderstanding is null or common_misunderstanding !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
);
comment on constraint hub_content_items_no_regulatory_escape_hatch on public.hub_content_items is 'A regulatory assertion belongs in regulatory_facts, cited via hub_regulatory_fact_references and applicability-scoped. This CHECK is a coarse, deliberately narrow net for the most obvious escape-hatch phrasing across every free-text prose column on this table, not just title/summary/body -- it is not a substitute for editorial review, only a floor beneath it.';

-- =====================================================================
-- 3. Seed content: 20 rows across the six approved families. Universal
--    concepts carry is_universal=true; code-specific concepts carry real
--    per-regulatory_identity enumeration, never is_universal=true. Zero
--    new RULE_EXPLANATION references: the current regulatory corpus is
--    entirely age-grade administrative regulation (RFU-REG15/RFL-CGOR)
--    with no genuine Law-of-the-Game fact that honestly fits any of these
--    twenty concepts -- one real citation would be better than twenty
--    invented ones, and none exists yet, so none is forced.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_ref uuid; v_ar_tj uuid; v_tmo_vr uuid;
  v_advantage uuid; v_offside_u uuid; v_offside_l uuid; v_knockon_fp uuid;
  v_breakdown_u uuid; v_ptb_l uuid; v_scrum_lineout_u uuid; v_scrum_l uuid;
  v_foulplay uuid; v_cards uuid;
  v_captain_comm uuid;
  v_respect uuid; v_players_respect uuid; v_coaches uuid; v_parents uuid;
  v_young_ref uuid; v_becoming_ref uuid;

  v_g_referee uuid; v_g_ar uuid; v_g_tj uuid; v_g_tmo uuid; v_g_vr uuid;
  v_g_foulplay uuid; v_g_sinbin uuid; v_g_yellow uuid; v_g_red uuid;
  v_g_captain uuid; v_g_dissent uuid;
  v_g_advantage uuid; v_g_offside_u uuid; v_g_offside_l uuid; v_g_knockon uuid; v_g_fp uuid;
  v_g_ruck uuid; v_g_breakdown uuid; v_g_ptb uuid; v_g_tackle_count uuid; v_g_set_restart uuid;
  v_g_scrum_u uuid; v_g_lineout uuid; v_g_scrum_l uuid;

  v_concept_advantage uuid; v_concept_attack_defence uuid; v_concept_breakdown uuid;
  v_concept_ptb uuid; v_concept_tackle_restarts uuid; v_concept_scrum_lineout uuid;
  v_concept_restarts uuid; v_concept_territory uuid;

  v_skill_breakdown uuid; v_skill_ptb uuid; v_skill_scrum_lineout uuid; v_skill_comm uuid;

  v_pos_lhp uuid; v_pos_hooker_u uuid; v_pos_thp uuid; v_pos_lock4 uuid; v_pos_lock5 uuid;
  v_pos_blindside uuid; v_pos_openside uuid; v_pos_no8 uuid;
  v_pos_prop8 uuid; v_pos_hooker_l uuid; v_pos_prop10 uuid;
begin
  select id into v_admin from auth.users where email like 'hub-admin-officiating-%' limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (v_admin, 'hub-admin-officiating-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
    insert into public.profiles (id, first_name, surname, email) values (v_admin, 'Hub', 'Admin', 'hub-admin-officiating-' || v_admin::text || '@ovalball.test');
  end if;

  select id into v_concept_advantage from public.hub_content_items where content_key = 'penalties-and-advantage';
  select id into v_concept_attack_defence from public.hub_content_items where content_key = 'attack-and-defence';
  select id into v_concept_breakdown from public.hub_content_items where content_key = 'the-breakdown-and-ruck';
  select id into v_concept_ptb from public.hub_content_items where content_key = 'the-play-the-ball';
  select id into v_concept_tackle_restarts from public.hub_content_items where content_key = 'tackle-count-and-set-restarts';
  select id into v_concept_scrum_lineout from public.hub_content_items where content_key = 'the-scrum-and-lineout-in-play';
  select id into v_concept_restarts from public.hub_content_items where content_key = 'how-play-restarts';
  select id into v_concept_territory from public.hub_content_items where content_key = 'possession-and-territory';

  select id into v_skill_breakdown from public.hub_skills where skill_key = 'contact-and-breakdown-work';
  select id into v_skill_ptb from public.hub_skills where skill_key = 'play-the-ball-and-restart';
  select id into v_skill_scrum_lineout from public.hub_skills where skill_key = 'scrum-and-lineout-technique';
  select id into v_skill_comm from public.hub_skills where skill_key = 'on-field-communication';

  select id into v_pos_lhp from public.hub_positions where position_key = 'union-loosehead-prop';
  select id into v_pos_hooker_u from public.hub_positions where position_key = 'union-hooker';
  select id into v_pos_thp from public.hub_positions where position_key = 'union-tighthead-prop';
  select id into v_pos_lock4 from public.hub_positions where position_key = 'union-lock-four';
  select id into v_pos_lock5 from public.hub_positions where position_key = 'union-lock-five';
  select id into v_pos_blindside from public.hub_positions where position_key = 'union-blindside-flanker';
  select id into v_pos_openside from public.hub_positions where position_key = 'union-openside-flanker';
  select id into v_pos_no8 from public.hub_positions where position_key = 'union-number-eight';
  select id into v_pos_prop8 from public.hub_positions where position_key = 'league-prop-eight';
  select id into v_pos_hooker_l from public.hub_positions where position_key = 'league-hooker';
  select id into v_pos_prop10 from public.hub_positions where position_key = 'league-prop-ten';

  select id into v_g_advantage from public.hub_glossary_terms where term_key = 'advantage';
  select id into v_g_offside_u from public.hub_glossary_terms where term_key = 'offside-union';
  select id into v_g_offside_l from public.hub_glossary_terms where term_key = 'offside-league';
  select id into v_g_knockon from public.hub_glossary_terms where term_key = 'knock-on';
  select id into v_g_fp from public.hub_glossary_terms where term_key = 'forward-pass';
  select id into v_g_ruck from public.hub_glossary_terms where term_key = 'ruck';
  select id into v_g_breakdown from public.hub_glossary_terms where term_key = 'breakdown';
  select id into v_g_ptb from public.hub_glossary_terms where term_key = 'play-the-ball';
  select id into v_g_tackle_count from public.hub_glossary_terms where term_key = 'tackle-count';
  select id into v_g_set_restart from public.hub_glossary_terms where term_key = 'set-restart';
  select id into v_g_scrum_u from public.hub_glossary_terms where term_key = 'scrum-union';
  select id into v_g_lineout from public.hub_glossary_terms where term_key = 'lineout';
  select id into v_g_scrum_l from public.hub_glossary_terms where term_key = 'scrum-league';

  -- ============ New Glossary terms this content genuinely uses ============

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('referee', 'Referee', 'The official with overall authority and responsibility for a match: applying the laws, managing player safety, and keeping the game fair and flowing.')
  returning id into v_g_referee;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('assistant-referee', 'Assistant Referee', 'union', 'A touch judge formally appointed by the match organiser or a Referees'' Society, with the added authority to report foul play to the referee.')
  returning id into v_g_ar;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('touch-judge', 'Touch Judge', 'An official who runs the touchline signalling when the ball goes into touch and the success of kicks at goal, in both Union and League.')
  returning id into v_g_tj;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('tmo', 'TMO', 'union', 'The Television Match Official — an off-field official who reviews video footage to help the referee with tries, touch-in-goal and foul play.')
  returning id into v_g_tmo;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('video-referee', 'Video Referee', 'league', 'An off-field official who reviews video footage to help the on-field referee with tries and other reviewable decisions.')
  returning id into v_g_vr;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('foul-play', 'Foul Play', 'Any act that breaks the laws around player safety and fair play, ranging from accidental technique errors to deliberate dangerous acts.')
  returning id into v_g_foulplay;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('sin-bin', 'Sin Bin', 'A timed period where a player is temporarily removed from play as a sanction, after which they may return.')
  returning id into v_g_sinbin;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('yellow-card', 'Yellow Card', 'The card shown to send a player to the sin bin for a temporary period.')
  returning id into v_g_yellow;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('red-card', 'Red Card', 'The card shown to remove a player from the match entirely for serious foul play.')
  returning id into v_g_red;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('captain', 'Captain', 'The player responsible for representing their team to the referee, communicating on tactical and disciplinary matters and helping manage their own team''s conduct.')
  returning id into v_g_captain;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('dissent', 'Dissent', 'Showing visible disagreement with an official''s decision — through words, gestures or body language — rather than accepting it and playing on.')
  returning id into v_g_dissent;

  insert into public.hub_content_applicability (glossary_term_id, is_universal)
  select id, true from public.hub_glossary_terms where id in (v_g_referee, v_g_tj, v_g_foulplay, v_g_sinbin, v_g_yellow, v_g_red, v_g_captain, v_g_dissent);
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id) select v_g_ar, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id) select v_g_tmo, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id) select v_g_vr, id from public.regulatory_identities where rugby_code = 'league';

  update public.hub_glossary_terms
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_g_referee, v_g_ar, v_g_tj, v_g_tmo, v_g_vr, v_g_foulplay, v_g_sinbin, v_g_yellow, v_g_red, v_g_captain, v_g_dissent);

  -- ============ MATCH_OFFICIALS ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_to_watch_for)
  values (
    'what-the-referee-does', 'OFFICIATING_CONCEPT', 'What the Referee Does',
    'The referee has overall authority for the match — applying the laws, managing safety, and keeping the game fair and flowing.',
    'MATCH_OFFICIALS',
    'A game only works if everyone accepts one person''s decisions as final in the moment — the referee is that person, and their job is bigger than just spotting infringements.',
    'Through the whole match, the referee is constantly reading the game: judging safety at the tackle and breakdown, deciding whether to play advantage or stop for a penalty, managing restarts and scoring, and talking to captains and other officials to keep control of the match.',
    'How the referee positions themselves to see key contact areas, how quickly they communicate a decision, and how they manage the game''s flow rather than stopping it for every minor issue.'
  )
  returning id into v_ref;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, union_league_difference)
  values (
    'assistant-referees-and-touch-judges', 'OFFICIATING_CONCEPT', 'Assistant Referees and Touch Judges',
    'Touchline officials who help the referee — with real differences in authority depending on how they are appointed and which code they are in.',
    'MATCH_OFFICIALS', null,
    'A referee cannot see everything from one position on the pitch — touchline officials extend what the match can see and confirm.',
    'They run the touchline, signal when the ball goes into touch, and confirm the success of kicks at goal.',
    'In Union, a touch judge formally appointed by the match organiser or a Referees'' Society becomes an Assistant Referee, with the added authority to report foul play — an unappointed touch judge in a community match does not have that authority. League''s touchline officials are simply called touch judges, without that same formal/informal distinction.'
  )
  returning id into v_ar_tj;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, union_league_difference)
  values (
    'tmo-and-video-officials', 'OFFICIATING_CONCEPT', 'TMO and Video Officials',
    'An off-field official who uses video replay to help the on-field team of officials get key decisions right.',
    'MATCH_OFFICIALS', null,
    'Some incidents — a grounding under a pile of players, a boot brushing the touchline — are genuinely too fast or too obscured to call with certainty from pitch level.',
    'The video official reviews footage from multiple camera angles and passes what they see back to the on-field referee, who remains the one making the final decision rather than simply following instructions.',
    'Union calls this official the TMO (Television Match Official); League calls the equivalent role the Video Referee. Both exist to support, not replace, the on-field referee''s judgement.'
  )
  returning id into v_tmo_vr;

  -- ============ DECISIONS_AND_SIGNALS ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_to_watch_for, how_it_is_signalled, what_happens_next)
  values (
    'advantage', 'OFFICIATING_CONCEPT', 'Advantage',
    'Why the referee sometimes lets play continue after an infringement instead of stopping the game straight away.',
    'DECISIONS_AND_SIGNALS',
    'Stopping the game for every infringement would reward the team that just broke a rule by handing them a stoppage exactly when their opponents had the upper hand.',
    'When the non-offending team already has the ball and a genuine chance to gain ground or score, the referee lets play continue rather than blowing the whistle immediately.',
    'Whether the advantage gained is real and lasting, not just a token phase before possession is lost again.',
    'The referee often calls "advantage" aloud so both teams know it is being played.',
    'If the advantage is realised, play continues from there. If it never develops, the referee can still bring play back for the original infringement.'
  )
  returning id into v_advantage;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next, common_misunderstanding)
  values (
    'offside-decisions-union', 'OFFICIATING_CONCEPT', 'Offside Decisions (Union)',
    'What the referee is watching when judging whether a Union player was offside.',
    'DECISIONS_AND_SIGNALS', 'union',
    'Offside stops players gaining an unfair advantage by standing somewhere the laws say they should not be able to take part.',
    'The referee (and assistant referees) watch the position of players relative to the ball, the back foot of a ruck or maul, and the player who last played the ball.',
    'Whether a player in front of the relevant line is interfering with play, rather than merely standing still and uninvolved.',
    'An offside offence usually leads to a penalty for the non-offending team.',
    'Standing in an offside position is not itself always an offence — it only becomes one once that player takes part in play or affects the opposition.'
  )
  returning id into v_offside_u;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next, common_misunderstanding)
  values (
    'offside-decisions-league', 'OFFICIATING_CONCEPT', 'Offside Decisions (League)',
    'What the referee is watching when judging whether a League player was offside.',
    'DECISIONS_AND_SIGNALS', 'league',
    'League''s offside line is central to its whole defensive structure, since it governs how quickly a defence can advance after each play-the-ball.',
    'The referee watches the defending line''s position relative to the ball and the marker at each play-the-ball, and the position of players at a kick.',
    'Whether defenders retreat properly after a play-the-ball rather than creeping forward early.',
    'An offside offence usually leads to a penalty for the attacking team.',
    'Being offside from open play (rather than a kick) does not stop a player automatically — it only matters once they interfere with play.'
  )
  returning id into v_offside_l;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
  values (
    'knock-on-and-forward-pass', 'OFFICIATING_CONCEPT', 'Knock-On and Forward Pass',
    'Two of the most common reasons play stops: the ball going forward off a hand or arm, or being thrown forward.',
    'DECISIONS_AND_SIGNALS',
    'Rugby is built around moving the ball backwards through hands so that forward progress only comes from running or kicking — these two calls protect that basic shape of the game.',
    'The referee watches the ball''s direction relative to the pitch, not the player''s own movement, since a player can run forward while still passing the ball backwards.',
    'Whether the ball genuinely travelled forward, as opposed to simply being dropped straight down or deflected unpredictably off an opponent.',
    'Both usually lead to a scrum for the opposing team.'
  )
  returning id into v_knockon_fp;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next, common_misunderstanding)
  values (
    'breakdown-and-ruck-decisions-union', 'OFFICIATING_CONCEPT', 'Breakdown and Ruck Decisions (Union)',
    'What the referee is watching in the tackle area, one of the most frequent and closely-judged parts of a Union match.',
    'DECISIONS_AND_SIGNALS', 'union',
    'The breakdown decides how quickly and cleanly a team can keep or win the ball after a tackle, so it is refereed closely and constantly.',
    'The referee watches whether the tackler releases the ball-carrier, whether arriving players enter from behind the ball (not from the side), and whether players stay on their feet.',
    'Quick releases, straight entries, and hands staying off the ball once a real ruck has formed.',
    'A clean win usually continues the attack; an infringement usually gives a penalty to the team not at fault.',
    'Not every ruck infringement looks the same to spectators — the same physical contact can be legal or illegal depending on timing and body position, which is exactly where the referee''s judgement matters.'
  )
  returning id into v_breakdown_u;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
  values (
    'tackle-and-play-the-ball-decisions-league', 'OFFICIATING_CONCEPT', 'Tackle and Play-the-Ball Decisions (League)',
    'What the referee is watching at the tackle and the play-the-ball, the heartbeat of a League match.',
    'DECISIONS_AND_SIGNALS', 'league',
    'League has no contest for the ball after a tackle, so the referee''s job shifts to making sure the restart itself is played correctly and fairly.',
    'The referee watches that the tackle is completed properly, that the tackled player gets up and plays the ball correctly facing their own try line, and that the defending line retreats the required distance.',
    'A correctly performed play-the-ball and a defensive line that retreats promptly rather than creeping forward.',
    'An incorrectly played ball can cost the team a tackle from their count; defensive infringements can lead to a penalty or a set restart.'
  )
  returning id into v_ptb_l;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
  values (
    'scrum-and-lineout-decisions-union', 'OFFICIATING_CONCEPT', 'Scrum and Lineout Decisions (Union)',
    'What the referee is watching during Union''s two set-piece restarts.',
    'DECISIONS_AND_SIGNALS', 'union',
    'Set-piece restarts involve real physical contest, so the referee''s job is as much about safety as it is about the contest for the ball.',
    'At the scrum, the referee watches the engagement, stability and straightness of the feed; at the lineout, they watch the straightness of the throw and legality of lifting and jumping.',
    'A stable, safe scrum engagement, and a lineout throw that goes straight down the middle.',
    'An unstable or illegal scrum can be reset or penalised; a crooked throw usually gives the throw-in to the other team.'
  )
  returning id into v_scrum_lineout_u;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, rugby_code, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
  values (
    'scrum-decisions-league', 'OFFICIATING_CONCEPT', 'Scrum Decisions (League)',
    'What the referee is watching at a League scrum, a restart rather than a genuine contest in the modern game.',
    'DECISIONS_AND_SIGNALS', 'league',
    'Because the League scrum is rarely contested, the referee''s main job is making sure it forms safely and restarts play promptly.',
    'The referee watches that the scrum forms correctly and safely, then feeds the ball to restart play.',
    'A safe, correctly-formed scrum rather than a genuine contest for possession.',
    'Possession almost always returns to the team that did not cause the error that led to the scrum.'
  )
  returning id into v_scrum_l;

  -- ============ DISCIPLINE_AND_SANCTIONS ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_to_watch_for, common_misunderstanding)
  values (
    'foul-play-and-player-safety', 'OFFICIATING_CONCEPT', 'Foul Play and Player Safety',
    'Why player safety changes how an infringement is treated, and why similar-looking incidents can have different outcomes.',
    'DISCIPLINE_AND_SANCTIONS',
    'Rugby is a contact sport, and officiating exists partly to keep that contact within safe, fair limits.',
    'The referee weighs the point of contact, the force involved, and the context of the incident — a genuine accident, a reckless action and a deliberate one are treated differently even when the visible outcome looks similar.',
    'Contact with the head or neck receives particular scrutiny regardless of intent, because the outcome for player safety matters more than whether contact was deliberate.',
    'Two tackles that look almost identical can receive different outcomes — that reflects real differences in force, contact point or context, not inconsistency for its own sake.'
  )
  returning id into v_foulplay;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_happens_next)
  values (
    'cards-and-sin-bin', 'OFFICIATING_CONCEPT', 'Cards and Sin Bin',
    'How officials escalate a response to foul play, from a warning through to removing a player from the game.',
    'DISCIPLINE_AND_SANCTIONS',
    'A single warning is not always enough to deter a genuinely dangerous or repeated infringement, and a scale of sanctions lets the punishment match the seriousness of what happened.',
    'A referee can warn a team or player, award a penalty, or show a card. A yellow card sends a player to the sin bin for a temporary period; a red card removes them from the match entirely.',
    'A sin-binned player may return once their time is up; a sent-off player takes no further part and their team plays on short.'
  )
  returning id into v_cards;

  -- ============ COMMUNICATION ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens, what_to_watch_for, common_misunderstanding)
  values (
    'captain-and-referee-communication', 'OFFICIATING_CONCEPT', 'Captain and Referee Communication',
    'Why captains, and only captains, get a direct channel to ask the referee questions during play.',
    'COMMUNICATION',
    'A referee needs one clear point of contact per team, not fifteen players each questioning every call — a captain gives them that, while keeping the game manageable.',
    'A captain may ask the referee to clarify a decision, at an appropriate moment and in a respectful tone, and is expected to help manage their own team''s discipline and reactions.',
    'The difference between a calm, timely question and repeated dissent — the first supports good game management, the second undermines it.',
    'Asking a referee to clarify a decision is not the same as disputing it — a respectful question is a normal part of the game; visible disagreement with the outcome is not.'
  )
  returning id into v_captain_comm;

  -- ============ RESPECT_AND_BEHAVIOUR ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'respect-the-referee', 'OFFICIATING_CONCEPT', 'Respect the Referee',
    'Why treating match officials well matters for safety, the quality of the game, and whether new referees stick around.',
    'RESPECT_AND_BEHAVIOUR',
    'Officials make quick judgement calls in a fast, physical game and will sometimes get things wrong — how everyone responds to that is what actually shapes the culture of a club, not the officiating itself. Rugby also depends on volunteers willing to referee at every level, and abuse is the single biggest reason people stop.',
    'Both the RFU and RFL run ongoing campaigns aimed at improving how players, coaches, parents and spectators treat match officials, because the same behaviour that drives an experienced referee away from a difficult game is exactly what stops a new referee ever coming back for a second one.'
  )
  returning id into v_respect;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'players-and-respect', 'OFFICIATING_CONCEPT', 'Players and Respect',
    'What respecting the referee actually looks like for a player, during and after a decision.',
    'RESPECT_AND_BEHAVIOUR',
    'A player who accepts a decision and plays on, even a decision they disagree with, keeps the game moving and keeps their own team disciplined.',
    'Accepting the call, retreating or resetting promptly, letting the captain raise any genuine question, and recognising that officials — like players — can make honest mistakes in a fast-moving game.'
  )
  returning id into v_players_respect;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'coaches-and-touchline-behaviour', 'OFFICIATING_CONCEPT', 'Coaches and Touchline Behaviour',
    'The standard a coach sets on the touchline is the standard their players and supporters follow.',
    'RESPECT_AND_BEHAVIOUR',
    'Players and parents both take their cues from the coach — a coach who models calm, respectful touchline behaviour makes that the club''s normal, not the exception.',
    'Coaches are expected to manage their own conduct and their team''s reactions, raise genuine concerns through appropriate club or league channels rather than confronting an official directly, and actively support newer or younger referees rather than adding pressure to them.'
  )
  returning id into v_coaches;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'parents-and-spectators', 'OFFICIATING_CONCEPT', 'Parents and Spectators',
    'Supporting your team and your child without trying to referee the game from the touchline.',
    'RESPECT_AND_BEHAVIOUR',
    'Grassroots rugby often relies on young or newly-qualified referees, and touchline abuse from adults is one of the clearest reasons they stop volunteering.',
    'Supporting players positively, avoiding shouting decisions or corrections at officials from the sideline, and raising any genuine concern through the club rather than directly at the official during the game.'
  )
  returning id into v_parents;

  -- ============ BECOMING_AN_OFFICIAL ============

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'young-and-new-referees', 'OFFICIATING_CONCEPT', 'Young and New Referees',
    'Why new officials need patience and support, not perfection, from everyone around them.',
    'BECOMING_AN_OFFICIAL',
    'Every experienced referee started with their first, difficult match — how they were treated in those early games shapes whether they carry on.',
    'New and young referees are still learning to apply the laws confidently at real match pace, and can make honest misjudgements — clubs, coaches, players and parents who respond patiently and supportively are directly responsible for whether that person referees again.'
  )
  returning id into v_young_ref;

  insert into public.hub_content_items (content_key, content_type, title, summary, officiating_family, why_it_matters, what_happens)
  values (
    'becoming-a-referee', 'OFFICIATING_CONCEPT', 'Becoming a Referee',
    'Refereeing is a genuine rugby pathway of its own, with training and support built in from the start.',
    'BECOMING_AN_OFFICIAL',
    'Every match at every level needs a referee, and new officials are how that pool is kept up — for many people it is also a way of staying involved in the game.',
    'New referees typically begin with an introductory course covering safety, communication and the core laws, combining self-directed learning with practical, in-person training, before taking charge of matches with ongoing mentoring and support as they progress. In England, the RFU''s current entry-level course for this is called Ready2Ref.'
  )
  returning id into v_becoming_ref;

  -- ============ Applicability: universal concepts ============

  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items
  where id in (v_ref, v_ar_tj, v_tmo_vr, v_advantage, v_knockon_fp, v_foulplay, v_cards, v_captain_comm, v_respect, v_players_respect, v_coaches, v_parents, v_young_ref, v_becoming_ref);

  -- ============ Applicability: code-specific concepts, real per-identity enumeration ============

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_offside_u, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_breakdown_u, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_scrum_lineout_u, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_offside_l, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_ptb_l, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_scrum_l, id from public.regulatory_identities where rugby_code = 'league';

  -- ============ Publish every seeded concept now that applicability exists ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (
    v_ref, v_ar_tj, v_tmo_vr, v_advantage, v_offside_u, v_offside_l, v_knockon_fp,
    v_breakdown_u, v_ptb_l, v_scrum_lineout_u, v_scrum_l, v_foulplay, v_cards, v_captain_comm,
    v_respect, v_players_respect, v_coaches, v_parents, v_young_ref, v_becoming_ref
  );

  -- ============ Officiating <-> Game Knowledge (hub_content_relationships, RELATED_KNOWLEDGE) ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_advantage, v_concept_advantage, 'RELATED_KNOWLEDGE'),
    (v_offside_u, v_concept_attack_defence, 'RELATED_KNOWLEDGE'),
    (v_offside_l, v_concept_attack_defence, 'RELATED_KNOWLEDGE'),
    (v_knockon_fp, v_concept_territory, 'RELATED_KNOWLEDGE'),
    (v_breakdown_u, v_concept_breakdown, 'RELATED_KNOWLEDGE'),
    (v_ptb_l, v_concept_ptb, 'RELATED_KNOWLEDGE'),
    (v_ptb_l, v_concept_tackle_restarts, 'RELATED_KNOWLEDGE'),
    (v_scrum_lineout_u, v_concept_scrum_lineout, 'RELATED_KNOWLEDGE'),
    (v_scrum_l, v_concept_restarts, 'RELATED_KNOWLEDGE');

  -- ============ Officiating <-> Officiating (hub_content_relationships, CONCEPT_RELATED) -- symmetric pairs stored as two rows each ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_respect, v_players_respect, 'CONCEPT_RELATED'), (v_players_respect, v_respect, 'CONCEPT_RELATED'),
    (v_respect, v_coaches, 'CONCEPT_RELATED'), (v_coaches, v_respect, 'CONCEPT_RELATED'),
    (v_respect, v_parents, 'CONCEPT_RELATED'), (v_parents, v_respect, 'CONCEPT_RELATED'),
    (v_respect, v_young_ref, 'CONCEPT_RELATED'), (v_young_ref, v_respect, 'CONCEPT_RELATED'),
    (v_captain_comm, v_respect, 'CONCEPT_RELATED'), (v_respect, v_captain_comm, 'CONCEPT_RELATED'),
    (v_foulplay, v_cards, 'CONCEPT_RELATED'), (v_cards, v_foulplay, 'CONCEPT_RELATED'),
    (v_ref, v_ar_tj, 'CONCEPT_RELATED'), (v_ar_tj, v_ref, 'CONCEPT_RELATED'),
    (v_ref, v_tmo_vr, 'CONCEPT_RELATED'), (v_tmo_vr, v_ref, 'CONCEPT_RELATED'),
    (v_young_ref, v_becoming_ref, 'CONCEPT_RELATED'), (v_becoming_ref, v_young_ref, 'CONCEPT_RELATED');

  -- ============ Officiating <-> Skill (hub_skill_content_links) ============

  insert into public.hub_skill_content_links (skill_id, content_item_id) values
    (v_skill_breakdown, v_breakdown_u),
    (v_skill_ptb, v_ptb_l),
    (v_skill_ptb, v_scrum_l),
    (v_skill_scrum_lineout, v_scrum_lineout_u),
    (v_skill_comm, v_captain_comm);

  -- ============ Officiating <-> Position (hub_content_item_positions) -- high-signal only; Captain gets none ============

  insert into public.hub_content_item_positions (content_item_id, position_id) values
    (v_scrum_lineout_u, v_pos_lhp), (v_scrum_lineout_u, v_pos_hooker_u), (v_scrum_lineout_u, v_pos_thp),
    (v_scrum_lineout_u, v_pos_lock4), (v_scrum_lineout_u, v_pos_lock5),
    (v_breakdown_u, v_pos_blindside), (v_breakdown_u, v_pos_openside), (v_breakdown_u, v_pos_no8),
    (v_scrum_l, v_pos_prop8), (v_scrum_l, v_pos_hooker_l), (v_scrum_l, v_pos_prop10),
    (v_ptb_l, v_pos_hooker_l);

  -- ============ Officiating <-> Glossary (hub_glossary_content_links) ============

  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values
    (v_g_referee, v_ref),
    (v_g_ar, v_ar_tj), (v_g_tj, v_ar_tj),
    (v_g_tmo, v_tmo_vr), (v_g_vr, v_tmo_vr),
    (v_g_advantage, v_advantage),
    (v_g_offside_u, v_offside_u),
    (v_g_offside_l, v_offside_l),
    (v_g_knockon, v_knockon_fp), (v_g_fp, v_knockon_fp),
    (v_g_ruck, v_breakdown_u), (v_g_breakdown, v_breakdown_u),
    (v_g_ptb, v_ptb_l), (v_g_tackle_count, v_ptb_l), (v_g_set_restart, v_ptb_l),
    (v_g_scrum_u, v_scrum_lineout_u), (v_g_lineout, v_scrum_lineout_u),
    (v_g_scrum_l, v_scrum_l),
    (v_g_foulplay, v_foulplay),
    (v_g_sinbin, v_cards), (v_g_yellow, v_cards), (v_g_red, v_cards),
    (v_g_captain, v_captain_comm), (v_g_dissent, v_captain_comm),
    (v_g_dissent, v_players_respect);
end $$;
