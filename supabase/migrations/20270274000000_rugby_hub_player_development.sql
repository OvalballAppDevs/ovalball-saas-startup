-- Rugby Hub Player Development.
--
-- Adds the player-development meta-layer to the Rugby Hub knowledge graph,
-- per the approved archaeology/design. This is educational knowledge for a
-- player about how development works -- never player assessment, tracking,
-- rating, talent identification, fitness prescription or medical guidance.
--
-- Zero new tables. One new content_type (PLAYER_DEVELOPMENT_CONCEPT) and
-- one new content-type-aware column (development_family). Every relationship
-- reuses a mechanism this codebase already proved generic, re-verified live
-- against the current schema before this migration was written rather than
-- taken from the archaeology report:
--   hub_skill_content_links       -- skill_id <-> content_item_id, no
--                                    content_type restriction, already
--                                    generic.
--   hub_content_item_positions    -- content_item_id <-> position_id, ALREADY
--                                    used by two content types
--                                    (OFFICIATING_CONCEPT, GAME_CONCEPT) --
--                                    proving it is intentionally generic and
--                                    NOT Glossary-specific. The archaeology
--                                    report named the wrong table here; the
--                                    live schema corrected it.
--   hub_regulatory_fact_references -- reference_type RULE_EXPLANATION already
--                                    targets content_item_id generically, so
--                                    Player Development needs NO new
--                                    reference_type and NO schema change to
--                                    reference real Laws.
--   hub_content_relationships      -- Game Knowledge and Officiating links.
--   hub_content_sources            -- provenance, reused unchanged.
--
-- The load-bearing boundary: Skills owns technique (each hub_skills row
-- already carries its own key_cues, technique_steps, common_mistakes and
-- how_to_improve). Player Development owns the layer above -- how abilities
-- combine, how learning changes with experience, how practice and reflection
-- work. Three originally-proposed concepts were REMOVED at implementation
-- time because reading the live Skills content proved they duplicated it:
-- "Developing Handling Under Pressure" (passing-under-pressure already says
-- "practise passing off both hands ... under real time pressure"),
-- "Developing Your Kicking Game" (kicking-for-territory-and-tactics already
-- owns purposeful kicking and reviewing whether the kick achieved its aim),
-- and "Communicating on the Pitch" (on-field-communication already owns
-- early, useful calling and practising it out loud). Two genuinely
-- non-duplicating concepts replaced them.
--
-- No developmental stage is stored anywhere: stage stays in prose ("new to
-- rugby", "once the basics feel comfortable"), deliberately NOT reusing
-- regulatory_identities or hub_position_age_stage, which answer a different
-- question (what a Law or a position requires at an age grade, not how an
-- individual is developing).

-- =====================================================================
-- 1. Content model: one new content_type, one content-type-aware column.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT', 'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE', 'RUGBY_TEAM', 'RUGBY_PERSON', 'PLAYER_DEVELOPMENT_CONCEPT'
]));

alter table public.hub_content_items add column if not exists development_family text;

alter table public.hub_content_items add constraint hub_content_items_development_family_check
  check (development_family is null or development_family = any (array['FOUNDATIONS', 'TECHNICAL', 'TACTICAL', 'PHYSICAL', 'MENTAL']));

-- Content-type-aware in both directions: a development concept must declare
-- a family, and no other content type may carry one (so no unrelated type
-- can come to depend on a Player Development field).
alter table public.hub_content_items add constraint hub_content_items_development_family_matches_type
  check (
    (content_type = 'PLAYER_DEVELOPMENT_CONCEPT' and development_family is not null)
    or (content_type <> 'PLAYER_DEVELOPMENT_CONCEPT' and development_family is null)
  );

comment on column public.hub_content_items.development_family is 'PLAYER_DEVELOPMENT_CONCEPT rows only, and required on every one of them: FOUNDATIONS/TECHNICAL/TACTICAL/PHYSICAL/MENTAL, matching World Rugby''s own Long-Term Player Development framing of technical, tactical, physical and mental development plus a foundations family for orientation content. Deliberately NOT a developmental stage: no stage is stored anywhere in this domain, because a concept genuinely spans stages and chronological age does not determine individual development.';

-- =====================================================================
-- 2. Seed corpus: 19 PLAYER_DEVELOPMENT_CONCEPT rows (4 FOUNDATIONS,
--    3 TECHNICAL, 4 TACTICAL, 4 PHYSICAL, 4 MENTAL; 17 universal,
--    1 Union-specific, 1 League-specific), with real Skill, Position,
--    Game Knowledge, Officiating and Law relationships and real sources.
--    Every concept was collision-checked against the live hub_skills,
--    hub_positions, GAME_CONCEPT and OFFICIATING_CONCEPT corpora
--    immediately before writing, and every source was re-verified live
--    (World Rugby LTPD and Activate material, RFU Regulation 15 age-grade
--    and contact guidance) rather than recalled.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_basics uuid; v_core uuid; v_habits uuid; v_mistakes uuid;
  v_scanning uuid; v_linking uuid; v_contact uuid;
  v_space uuid; v_support uuid; v_breakdown uuid; v_tacklecount uuid;
  v_movement uuid; v_speed uuid; v_progressive uuid; v_warmup uuid;
  v_confidence uuid; v_matchday uuid; v_positions uuid; v_agegrade uuid;

  v_skill_passing uuid; v_skill_catching uuid; v_skill_decisions uuid; v_skill_comms uuid;
  v_skill_tackling uuid; v_skill_breakdown uuid; v_skill_running uuid; v_skill_kicking uuid;
  v_skill_gamemgmt uuid; v_skill_playtheball uuid;

  v_gc_move uuid; v_gc_attackdefence uuid; v_gc_breakdown uuid; v_gc_tacklecount uuid;
  v_gc_territory uuid; v_gc_objective uuid; v_gc_flow uuid;

  v_off_foulplay uuid; v_off_breakdown_union uuid; v_off_tackle_league uuid; v_off_respect uuid;

  v_pos_union_scrumhalf uuid; v_pos_union_flyhalf uuid; v_pos_union_openside uuid; v_pos_union_fullback uuid;
  v_pos_league_halfback uuid; v_pos_league_fullback uuid;

  v_fact_tackle_complete uuid; v_fact_tackle_release uuid; v_fact_ruck_forms uuid; v_fact_league_playball uuid;
begin
  -- THE CONTENT-IMPORT IDENTITY IS LOOKED UP, NEVER HARDCODED.
  --
  -- This previously assigned a literal auth.users UUID taken from the
  -- machine the content was authored on. That row exists in exactly one
  -- database, so the migration could only ever succeed there: applying it
  -- anywhere else -- a colleague's machine, a clean boot, production --
  -- failed on the verified_by foreign key. It is resolved by email against
  -- the stable system account an earlier Hub migration creates, and created
  -- here if this migration happens to be the first to need it.
  select id into v_admin from auth.users
  where email = 'rugby-hub-content-import@system.ovalball.internal';
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (v_admin, 'rugby-hub-content-import@system.ovalball.internal', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
    insert into public.profiles (id, first_name, surname, email)
    values (v_admin, 'Rugby Hub', 'Content Import', 'rugby-hub-content-import@system.ovalball.internal')
    on conflict (id) do nothing;
  end if;
  select id into v_skill_passing from public.hub_skills where skill_key = 'passing-under-pressure';
  select id into v_skill_catching from public.hub_skills where skill_key = 'catching-under-pressure';
  select id into v_skill_decisions from public.hub_skills where skill_key = 'decision-making-under-pressure';
  select id into v_skill_comms from public.hub_skills where skill_key = 'on-field-communication';
  select id into v_skill_tackling from public.hub_skills where skill_key = 'tackling-technique';
  select id into v_skill_breakdown from public.hub_skills where skill_key = 'contact-and-breakdown-work';
  select id into v_skill_running from public.hub_skills where skill_key = 'running-and-evasion';
  select id into v_skill_kicking from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
  select id into v_skill_gamemgmt from public.hub_skills where skill_key = 'game-management';
  select id into v_skill_playtheball from public.hub_skills where skill_key = 'play-the-ball-and-restart';

  select id into v_gc_move from public.hub_content_items where content_key = 'how-teams-move-the-ball';
  select id into v_gc_attackdefence from public.hub_content_items where content_key = 'attack-and-defence';
  select id into v_gc_breakdown from public.hub_content_items where content_key = 'the-breakdown-and-ruck';
  select id into v_gc_tacklecount from public.hub_content_items where content_key = 'tackle-count-and-set-restarts';
  select id into v_gc_territory from public.hub_content_items where content_key = 'possession-and-territory';
  select id into v_gc_objective from public.hub_content_items where content_key = 'the-objective-of-the-game';
  select id into v_gc_flow from public.hub_content_items where content_key = 'how-a-game-flows';

  select id into v_off_foulplay from public.hub_content_items where content_key = 'foul-play-and-player-safety';
  select id into v_off_breakdown_union from public.hub_content_items where content_key = 'breakdown-and-ruck-decisions-union';
  select id into v_off_tackle_league from public.hub_content_items where content_key = 'tackle-and-play-the-ball-decisions-league';
  select id into v_off_respect from public.hub_content_items where content_key = 'players-and-respect';

  select id into v_pos_union_scrumhalf from public.hub_positions where position_key = 'union-scrum-half';
  select id into v_pos_union_flyhalf from public.hub_positions where position_key = 'union-fly-half';
  select id into v_pos_union_openside from public.hub_positions where position_key = 'union-openside-flanker';
  select id into v_pos_union_fullback from public.hub_positions where position_key = 'union-fullback';
  select id into v_pos_league_halfback from public.hub_positions where position_key = 'league-halfback';
  select id into v_pos_league_fullback from public.hub_positions where position_key = 'league-fullback';

  -- LOOKED UP BY FACT KEY, NOT BY ID.
  --
  -- These four previously selected regulatory_facts by literal UUID. Those
  -- ids are generated per database, so the literals only ever resolved on
  -- the machine the content was authored on; anywhere else the selects
  -- returned NULL and the insert below failed on a NOT NULL constraint.
  -- fact_key is the stable business key these rows already carry, and the
  -- migration that creates them runs earlier in this same sequence.
  select id into v_fact_tackle_complete from public.regulatory_facts where fact_key = 'WR-LAW-TACKLE-COMPLETION';
  select id into v_fact_tackle_release from public.regulatory_facts where fact_key = 'WR-LAW-TACKLE-RELEASE';
  select id into v_fact_ruck_forms from public.regulatory_facts where fact_key = 'WR-LAW-RUCK';
  select id into v_fact_league_playball from public.regulatory_facts where fact_key = 'IRL-LAW-PLAY-THE-BALL';

  -- ============ FOUNDATIONS ============

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('learning-the-basics', 'PLAYER_DEVELOPMENT_CONCEPT', 'FOUNDATIONS', 'Learning the Basics',
    'What to concentrate on in your first weeks of rugby, and what can safely wait.',
    'Rugby has a lot of laws, positions and set pieces, and trying to absorb all of it at once is the quickest way to feel lost rather than to improve.',
    'You do not need to understand every law, every position or every set piece to start playing and enjoying rugby. In your first weeks, almost everything useful sits in three places: catching and passing the ball, understanding that you pass backwards or sideways rather than forwards, and knowing roughly where you are allowed to be. Everything else — the set pieces, the tactical detail, the specialist positions — is built on top of those, and will make far more sense once they feel familiar. It is also completely normal to start rugby at any age. Plenty of people play their first game at fourteen, twenty-five or forty, and the starting point is the same at any of them.')
  returning id into v_basics;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('building-core-skills', 'PLAYER_DEVELOPMENT_CONCEPT', 'FOUNDATIONS', 'Building Core Skills',
    'Why building a broad base of skills serves you better early on than narrowing down quickly.',
    'Players who can catch, pass, run, support and tackle have options in every situation. Players who can only do one of those depend on the game coming to them in exactly the right shape.',
    'A broad base matters more than early specialisation. The skills that carry a player furthest — handling, movement, supporting the ball, defending honestly — are useful in every position, in both codes, and at every level. Narrowing early to whatever suits your current size or speed tends to look effective for a season or two and then stops, because bodies change and games change. Broad development also keeps more of the game open to you later: a player who has only ever done one job on the pitch has fewer places to go when their body or their interests change.')
  returning id into v_core;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('training-habits', 'PLAYER_DEVELOPMENT_CONCEPT', 'FOUNDATIONS', 'Training Habits',
    'How consistency and attention in training turn into something you can actually use on a Saturday.',
    'Improvement comes far more reliably from turning up regularly and practising with attention than from occasional bursts of extra effort.',
    'Little and often beats rare and intense. Skills become automatic through repetition spread over time, not through one long session before a big game. Attention matters as much as volume: ten minutes of passing where you are genuinely trying to be accurate is worth more than half an hour of throwing the ball around while chatting. It also helps to practise things you are not yet good at rather than the things that already feel comfortable, which is harder and less enjoyable but is where the improvement actually is.')
  returning id into v_habits;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('learning-from-mistakes', 'PLAYER_DEVELOPMENT_CONCEPT', 'FOUNDATIONS', 'Learning From Mistakes and Feedback',
    'Treating errors and coaching feedback as information about what to work on, rather than as a verdict on you.',
    'Every player drops balls, misses tackles and makes poor decisions. What separates players who improve is what they do in the ten minutes and the week afterwards.',
    'A mistake is information. Knocking on under pressure tells you something specific — perhaps you were watching the defender instead of the ball, or your hands were not ready early enough. That is a thing you can practise. Treating the same mistake as evidence that you are simply not good enough tells you nothing and helps nobody. The same applies to coaching feedback: it is aimed at the action, not at you as a person, and the players who improve fastest are usually the ones who ask what specifically to change rather than going quiet. Reflecting briefly after a game — one thing that went well, one thing to work on — is one of the cheapest development habits there is.')
  returning id into v_mistakes;

  -- ============ TECHNICAL ============

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body, aliases)
  values ('scanning-before-you-act', 'PLAYER_DEVELOPMENT_CONCEPT', 'TECHNICAL', 'Scanning Before You Act',
    'The habit of looking up and taking in what is around you before the ball arrives, not after.',
    'Most poor decisions on a rugby pitch are not decision-making failures at all — they are information failures. The player simply did not know what was around them when the ball came.',
    'Scanning is the habit of lifting your eyes and gathering information before you receive the ball rather than afterwards. A player who has already seen where the space is, how many defenders are in front of them and who is supporting inside has a genuine choice when the ball arrives. A player who only looks up after catching it has already used the time they needed, and is reduced to reacting. This is a habit rather than a technique: it is built by deliberately looking up in training before every pass you receive, until it stops requiring thought. It sits underneath almost every attacking skill — the choice of what to do with the ball is a separate skill in its own right, and this is the information that choice depends on.',
    array['Looking Up', 'Heads Up'])
  returning id into v_scanning;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('linking-skills-together', 'PLAYER_DEVELOPMENT_CONCEPT', 'TECHNICAL', 'Linking Skills Together',
    'How separate skills combine into sequences — catch, scan, pass — that hold up at real game speed.',
    'Skills practised one at a time often fall apart when the game asks for three of them in two seconds. Rugby is played in sequences, not in isolated repetitions.',
    'Individual skills are learned separately and used together. In a game you rarely just pass: you catch, take in what is in front of you, adjust your feet and then pass, usually while moving and with someone closing you down. Each part may be solid on its own and the sequence still break, because the joins have never been practised. This is why practice that links skills — catching a moving ball and immediately passing it, or receiving under mild pressure rather than standing still — transfers into matches far better than practising each piece in isolation. It is also why a skill can look fine in a drill and disappear on Saturday: the drill never asked for the join.')
  returning id into v_linking;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('contact-confidence', 'PLAYER_DEVELOPMENT_CONCEPT', 'TECHNICAL', 'Building Contact Confidence',
    'Growing comfortable in contact at a pace set by your age grade, your coach and the Laws — never on your own.',
    'Contact is the part of rugby most new players worry about, and confidence in it comes from graded, supervised progression rather than from being thrown in.',
    'Confidence in contact is built, not found. In age-grade rugby the progression into contact is deliberately staged and governed by regulation rather than left to individual clubs or players: younger age grades play non-contact formats, and contact is introduced gradually with specific safety conditions attached. That staging exists precisely so that confidence and technique arrive together. The practical implication for a player is simple: contact skills are developed in coached, supervised sessions appropriate to your age grade, and are not something to practise informally with friends. Technique itself belongs with your coach and with the tackling skill guidance in the Hub; what belongs to you is turning up, asking questions when something feels unsafe, and being honest about when you are not comfortable rather than hiding it.')
  returning id into v_contact;

  -- ============ TACTICAL ============

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('finding-space', 'PLAYER_DEVELOPMENT_CONCEPT', 'TACTICAL', 'Finding Space',
    'Learning to see where the space actually is, and to move so that you or a team-mate can use it.',
    'Space is the thing every attack is trying to create and every defence is trying to remove, and seeing it is a learnable habit rather than a gift.',
    'New players tend to watch the ball. More developed players watch the space. Space usually appears somewhere other than where the ball currently is — outside the last defender, behind a defence that has pushed up, or in the gap left when someone drifts in to make a tackle. Learning to notice it involves looking at the shape of the defence rather than at the carrier, and noticing how that shape changes as the ball moves. Using it is a separate step: getting your feet and your depth right so that when the ball arrives you are already moving onto it rather than standing still waiting. Beating a defender once you are there is its own skill; this is about arriving somewhere worth being.')
  returning id into v_space;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('support-play', 'PLAYER_DEVELOPMENT_CONCEPT', 'TACTICAL', 'Understanding Support Play',
    'Being in a useful position for the ball-carrier before you are needed, rather than after.',
    'Rugby continuity depends almost entirely on whether someone is close enough and deep enough to keep the ball moving when the carrier is stopped.',
    'Support is the work done before the ball gets to you. When a team-mate carries, the question is whether anyone is arriving in a position to receive, to protect the ball or to carry it on — and that is decided several seconds earlier by whether people followed the ball or stood watching it. Good support tends to be close enough to be useful, deep enough to be passed to legally, and on the side where the space is rather than the side that happens to be convenient. It is one of the least glamorous parts of rugby development and one of the most valuable, because it is almost entirely about work rate and anticipation rather than physical advantage, which makes it available to every player regardless of size or speed.')
  returning id into v_support;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body, rugby_code)
  values ('breakdown-decision-making', 'PLAYER_DEVELOPMENT_CONCEPT', 'TACTICAL', 'Breakdown Decision-Making',
    'Judging when to commit to a breakdown and when your team needs you somewhere else entirely.',
    'Committing the wrong number of players to a ruck is one of the most common ways attacking teams run out of options, and it is a judgement rather than a technique.',
    'In rugby union, every player who commits to a breakdown is a player who is no longer available in the defensive line or the attacking shape. The judgement is therefore not "can I win this ball" but "does my team need me here more than it needs me somewhere else". That depends on whether the carrier is secure, whether opponents are genuinely contesting, and how many team-mates have already arrived. Over-committing leaves nobody wide; under-committing loses the ball. Developing this judgement takes watching what actually happened after the fact — did the team have options on the next phase, or had everyone piled in? — far more than it takes extra physical work. The technique of the breakdown itself, and the legality of what is allowed there, are separate things worth understanding alongside it.',
    'union')
  returning id into v_breakdown;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body, rugby_code)
  values ('tackle-count-awareness', 'PLAYER_DEVELOPMENT_CONCEPT', 'TACTICAL', 'Tackle Count Awareness',
    'Knowing where your team is in the set, and letting that change what you do next.',
    'In rugby league the same situation calls for completely different decisions on the second tackle and on the fifth, and players who lose track of the count make good decisions at the wrong moment.',
    'A set of six tackles has a shape. Early in the set the priority is usually making ground and getting the team moving forward. Late in the set the priority shifts towards field position and what happens when possession changes hands. The practical development habit is simply knowing the count without having to ask — which sounds trivial and is not, because under fatigue and pressure it is one of the first things players lose. Once you do know it, it changes your positioning before the ball reaches you: on a last tackle, the players who are already in position to chase or to cover are the ones who knew what was coming.',
    'league')
  returning id into v_tacklecount;

  -- ============ PHYSICAL (principles only -- never programmes, loads,
  --              targets, diet, supplements, or medical guidance) ============

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('movement-and-coordination', 'PLAYER_DEVELOPMENT_CONCEPT', 'PHYSICAL', 'Movement and Coordination',
    'Why moving well — balance, landing, changing direction — sits underneath every rugby skill.',
    'Skills are performed by a moving body. A player who cannot change direction under control will lose the ball even when their handling is good.',
    'General movement quality underpins rugby-specific skill. Balance, coordination, the ability to accelerate and stop, and the ability to land and get back up are used constantly in a game, and they develop through varied movement rather than through rugby alone. Playing other sports, and simply moving in lots of different ways, tends to build this better than early specialisation in one sport does. This is a principle rather than a programme: what specific work suits you at your age and stage is a conversation for your coach, and anything involving structured physical training should come through them rather than from a page on the internet.')
  returning id into v_movement;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('speed-and-agility', 'PLAYER_DEVELOPMENT_CONCEPT', 'PHYSICAL', 'Speed and Agility',
    'What speed actually means in rugby, and why agility usually matters more than straight-line pace.',
    'Rugby is rarely a hundred-metre race. Most of what looks like speed on a pitch is acceleration, change of direction, and having set off at the right moment.',
    'Straight-line speed is useful and it is not the whole picture. A great deal of what decides rugby situations is how quickly you reach top pace over a few metres, how well you change direction without losing balance, and — often most important — whether you started moving at the right time. That last one is a decision, not a physical quality, which is why players who read the game early often look faster than they are. Agility and acceleration respond to training, though what and how much is appropriate depends heavily on your age and stage, and should come from your coach rather than from a generic plan.')
  returning id into v_speed;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('progressive-physical-development', 'PLAYER_DEVELOPMENT_CONCEPT', 'PHYSICAL', 'Progressive Physical Development',
    'Why physical development is built gradually, and why comparing yourself to team-mates rarely helps.',
    'Young players of the same age can be years apart in physical maturity, and that gap says almost nothing about who will be the better player later.',
    'Physical development happens on its own timetable. In any age group some players will have grown earlier than others, and the difference can be dramatic — which means size and strength at fourteen are a poor guide to anything much at twenty. The practical consequences are worth knowing: building gradually matters more than building fast, recovery is part of development rather than time away from it, and a player who is currently smaller usually benefits from leaning into skill, movement and game understanding rather than trying to close a physical gap that time will close anyway. Specific training loads, programmes and any question involving injury belong with qualified coaches and medical professionals, not with general guidance.')
  returning id into v_progressive;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('warm-up-habits', 'PLAYER_DEVELOPMENT_CONCEPT', 'PHYSICAL', 'Warm-Up Habits',
    'Why a proper warm-up is one of the best-evidenced things in rugby, and what your part in it is.',
    'Structured rugby warm-up programmes have been shown in controlled trials to substantially reduce injury and concussion risk — but only when they are actually done properly and regularly.',
    'Warming up is not a formality before the real session. World Rugby''s Activate programme — a structured warm-up built around balance, strength and movement exercises — has been studied in randomised controlled trials in schoolboy and adult rugby and was associated with substantial reductions in injury and concussion rates, with the largest effects in teams that used it consistently through a season rather than occasionally. The programme itself is delivered by coaches, so your part as a player is straightforward: arrive in time to do it, do it properly rather than going through the motions, and treat it as part of the session rather than the queue before it.')
  returning id into v_warmup;

  -- ============ MENTAL (non-clinical only) ============

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('confidence-and-composure', 'PLAYER_DEVELOPMENT_CONCEPT', 'MENTAL', 'Confidence and Composure',
    'Where confidence in rugby actually comes from, and how to keep thinking clearly when a game speeds up.',
    'Confidence that depends on things going well disappears exactly when it is needed. Confidence built on preparation survives a bad first ten minutes.',
    'Composure is the ability to keep making reasonable decisions when the game is fast, loud and not going your way. It grows mostly out of familiarity: having practised something enough that it does not require full attention, and having been in pressured situations often enough that they feel survivable rather than novel. Small things help — having one clear job you know you can do, doing it, and letting the rest settle — and so does separating the last mistake from the next decision, which is a skill in itself. This is ordinary sporting confidence, not a substitute for proper support: if pressure around rugby is genuinely affecting you off the pitch, that is a conversation for people who can actually help rather than something to solve alone.')
  returning id into v_confidence;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('preparing-for-match-day', 'PLAYER_DEVELOPMENT_CONCEPT', 'MENTAL', 'Preparing for Match Day',
    'The ordinary, controllable things that make you ready to play well before a game starts.',
    'Most of what decides whether you play near your level is settled before kick-off, and almost all of it is within your control.',
    'Match-day preparation is mostly unglamorous. Knowing where you need to be and when, having your kit ready, arriving with enough time to warm up properly rather than sprinting from the car, having eaten and drunk sensibly, and knowing the one or two things you are personally trying to do in this game — these account for far more than any last-minute effort. Knowing your own job clearly also helps: players who arrive thinking "I will see how it goes" tend to take longer to get into the game than players who arrive with something specific in mind. Nerves before a game are normal and are not a sign that anything is wrong.')
  returning id into v_matchday;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('trying-different-positions', 'PLAYER_DEVELOPMENT_CONCEPT', 'MENTAL', 'Trying Different Positions',
    'Why playing in several positions while you are developing is an advantage rather than indecision.',
    'Deciding early that you "are" one position closes off skills, understanding and options that are much harder to acquire later.',
    'Positions in rugby are jobs, not identities — particularly while you are still developing. Playing in different parts of the pitch teaches you things that are difficult to learn any other way: what a forward actually needs from a half-back, why the back three see space that nobody else can, what the game looks like from inside a breakdown. Players who have done several jobs tend to make better decisions in all of them. There are also practical reasons not to specialise early. Bodies change a great deal through the teenage years, and the position that suits a fourteen-year-old often is not the one that suits them at twenty. Each position''s specific demands are worth exploring in their own right once you want to go deeper.')
  returning id into v_positions;

  insert into public.hub_content_items (content_key, content_type, development_family, title, summary, why_it_matters, body)
  values ('moving-through-age-grade-rugby', 'PLAYER_DEVELOPMENT_CONCEPT', 'MENTAL', 'Moving Through Age-Grade Rugby',
    'What changes as you move up through age grades, and why the game you are playing keeps changing shape.',
    'Age-grade rugby is deliberately built as a progression, so the game you play at one age is genuinely a different game from the one a year or two later.',
    'The version of rugby played at each age grade is designed rather than accidental. Numbers on the pitch, pitch size, what contact is permitted and which parts of the full game are included all change step by step, so that the demands arrive in a manageable order. Moving up therefore means more than playing the same game against bigger opponents: new elements appear, and things you had got comfortable with are suddenly happening faster. It is normal to feel less accomplished for a while after moving up — that is the progression working, not evidence of going backwards. The specific rules for each age grade are set by the governing bodies and are worth checking rather than assuming, because they differ by code and are updated over time.')
  returning id into v_agegrade;

  -- ============ Applicability: universal concepts are genuinely universal;
  -- the two code-specific concepts are scoped to their own code only ============

  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items
  where id in (v_basics, v_core, v_habits, v_mistakes, v_scanning, v_linking, v_contact, v_space, v_support,
               v_movement, v_speed, v_progressive, v_warmup, v_confidence, v_matchday, v_positions, v_agegrade);

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select v_breakdown, ri.id from public.regulatory_identities ri where ri.rugby_code = 'union';

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select v_tacklecount, ri.id from public.regulatory_identities ri where ri.rugby_code = 'league';

  -- ============ Publish ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_basics, v_core, v_habits, v_mistakes, v_scanning, v_linking, v_contact, v_space, v_support,
               v_breakdown, v_tacklecount, v_movement, v_speed, v_progressive, v_warmup, v_confidence,
               v_matchday, v_positions, v_agegrade);

  -- ============ Development <-> Skill (hub_skill_content_links, reused
  -- unchanged -- only links where the Skill genuinely owns the technique
  -- this concept depends on) ============

  insert into public.hub_skill_content_links (skill_id, content_item_id) values
    (v_skill_passing, v_scanning),
    (v_skill_catching, v_scanning),
    (v_skill_decisions, v_scanning),
    (v_skill_passing, v_linking),
    (v_skill_catching, v_linking),
    (v_skill_tackling, v_contact),
    (v_skill_running, v_space),
    (v_skill_decisions, v_space),
    (v_skill_breakdown, v_support),
    (v_skill_breakdown, v_breakdown),
    (v_skill_decisions, v_breakdown),
    (v_skill_kicking, v_tacklecount),
    (v_skill_gamemgmt, v_tacklecount),
    (v_skill_playtheball, v_tacklecount),
    (v_skill_comms, v_support),
    (v_skill_decisions, v_confidence),
    (v_skill_passing, v_core),
    (v_skill_catching, v_core);

  -- ============ Development <-> Position (hub_content_item_positions,
  -- the genuinely generic mechanism already used by GAME_CONCEPT and
  -- OFFICIATING_CONCEPT -- small, meaningful links only, never a
  -- per-position curriculum) ============

  insert into public.hub_content_item_positions (content_item_id, position_id) values
    (v_positions, v_pos_union_scrumhalf),
    (v_positions, v_pos_union_flyhalf),
    (v_positions, v_pos_union_fullback),
    (v_positions, v_pos_league_halfback),
    (v_positions, v_pos_league_fullback),
    (v_scanning, v_pos_union_flyhalf),
    (v_scanning, v_pos_league_halfback),
    (v_breakdown, v_pos_union_openside),
    (v_tacklecount, v_pos_league_fullback);

  -- ============ Development <-> Game Knowledge / Officiating
  -- (hub_content_relationships, reused unchanged) ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_basics, v_gc_objective, 'RELATED_KNOWLEDGE'),
    (v_basics, v_gc_flow, 'RELATED_KNOWLEDGE'),
    (v_scanning, v_gc_move, 'RELATED_KNOWLEDGE'),
    (v_linking, v_gc_move, 'RELATED_KNOWLEDGE'),
    (v_space, v_gc_move, 'RELATED_KNOWLEDGE'),
    (v_space, v_gc_attackdefence, 'RELATED_KNOWLEDGE'),
    (v_support, v_gc_breakdown, 'RELATED_KNOWLEDGE'),
    (v_breakdown, v_gc_breakdown, 'RELATED_KNOWLEDGE'),
    (v_tacklecount, v_gc_tacklecount, 'RELATED_KNOWLEDGE'),
    (v_tacklecount, v_gc_territory, 'RELATED_KNOWLEDGE'),
    (v_contact, v_off_foulplay, 'RELATED_KNOWLEDGE'),
    (v_breakdown, v_off_breakdown_union, 'RELATED_KNOWLEDGE'),
    (v_tacklecount, v_off_tackle_league, 'RELATED_KNOWLEDGE'),
    (v_mistakes, v_off_respect, 'RELATED_KNOWLEDGE');

  -- ============ Development <-> related Development ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_basics, v_core, 'RELATED_KNOWLEDGE'),
    (v_core, v_scanning, 'RELATED_KNOWLEDGE'),
    (v_scanning, v_space, 'RELATED_KNOWLEDGE'),
    (v_space, v_support, 'RELATED_KNOWLEDGE'),
    (v_habits, v_linking, 'RELATED_KNOWLEDGE'),
    (v_habits, v_mistakes, 'RELATED_KNOWLEDGE'),
    (v_movement, v_speed, 'RELATED_KNOWLEDGE'),
    (v_progressive, v_warmup, 'RELATED_KNOWLEDGE'),
    (v_confidence, v_matchday, 'RELATED_KNOWLEDGE'),
    (v_positions, v_core, 'RELATED_KNOWLEDGE'),
    (v_agegrade, v_contact, 'RELATED_KNOWLEDGE'),
    (v_agegrade, v_progressive, 'RELATED_KNOWLEDGE');

  -- ============ Development <-> Law (hub_regulatory_fact_references,
  -- reused with the EXISTING RULE_EXPLANATION reference_type -- no new
  -- reference type and no schema change was required, because that type
  -- already targets content_item_id generically. No Law prose is copied. ============

  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values
    (v_fact_tackle_complete, v_contact, 'RULE_EXPLANATION'),
    (v_fact_tackle_release, v_contact, 'RULE_EXPLANATION'),
    (v_fact_ruck_forms, v_breakdown, 'RULE_EXPLANATION'),
    (v_fact_league_playball, v_tacklecount, 'RULE_EXPLANATION');

  -- ============ Sources (hub_content_sources, reused unchanged) ============

  insert into public.hub_content_sources (content_item_id, source_tier, source_title, source_url, retrieved_on) values
    (v_basics, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_core, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_habits, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_mistakes, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_scanning, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_linking, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_space, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_support, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_breakdown, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_tacklecount, 'GOVERNING_BODY', 'Rugby Football League', 'https://www.rugby-league.com', current_date),
    (v_movement, 'GOVERNING_BODY', 'World Rugby Passport: Long term athlete development (LTAD)', 'https://passport.world.rugby/conditioning-for-rugby/introduction-to-conditioning-children/long-term-athlete-development/long-term-athlete-development-ltad/', current_date),
    (v_speed, 'GOVERNING_BODY', 'World Rugby Passport: Long term athlete development (LTAD)', 'https://passport.world.rugby/conditioning-for-rugby/introduction-to-conditioning-children/long-term-athlete-development/long-term-athlete-development-ltad/', current_date),
    (v_progressive, 'GOVERNING_BODY', 'World Rugby Passport: Long term athlete development (LTAD)', 'https://passport.world.rugby/conditioning-for-rugby/introduction-to-conditioning-youth/long-term-athlete-development/', current_date),
    (v_progressive, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_warmup, 'GOVERNING_BODY', 'World Rugby Passport: What is Activate and why should coaches use it?', 'https://passport.world.rugby/injury-prevention-and-risk-management/activate-programme/frequently-asked-questions/what-is-activate/', current_date),
    (v_warmup, 'ACADEMIC', 'Implementation of the Activate injury prevention exercise programme in English schoolboy rugby union', 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8098930/', current_date),
    (v_confidence, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_matchday, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_positions, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_agegrade, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_agegrade, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date);

end $$;

-- ============ Beginner journey order ============
-- "Start Here" and the New to Rugby path are DATA, never a hardcoded list
-- inside a React component -- this reuses hub_content_items.journey_order
-- exactly as GAME_CONCEPT already does, so reordering the path is a content
-- edit rather than a code change. Only genuinely code-universal concepts sit
-- on the path, so the same journey is honest for a Rugby Union player and a
-- Rugby League player alike. Everything else stays journey_order null and is
-- reached by family, by skill, by position or by search.
update public.hub_content_items as ci
set journey_order = v.ord
from (values
  ('learning-the-basics', 1),
  ('building-core-skills', 2),
  ('training-habits', 3),
  ('movement-and-coordination', 4),
  ('scanning-before-you-act', 5),
  ('finding-space', 6),
  ('confidence-and-composure', 7)
) as v(content_key, ord)
where ci.content_key = v.content_key
  and ci.content_type = 'PLAYER_DEVELOPMENT_CONCEPT';
