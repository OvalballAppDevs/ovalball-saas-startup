-- Rugby Hub — Coaching Knowledge.
--
-- The knowledge layer explaining HOW A COACH CREATES LEARNING.
--
-- Boundary, stated once and enforced by supabase/tests/hub_coaching_knowledge.sql:
--
--   hub_skills                 what a skill is and how a PLAYER performs/improves it
--   PLAYER_DEVELOPMENT_CONCEPT what a PLAYER should understand about their own development
--   GAME_CONCEPT               how a rugby situation works
--   OFFICIATING_CONCEPT        how officials interpret and decide
--   regulatory_facts           the Law itself
--   COACHING_CONCEPT (this)    how a COACH designs practice, communicates and creates learning
--
--   training_sessions / training_plans / player_fixture_attendance /
--   training_communications    the real, private, operational Training Centre
--
-- Coaching Knowledge is reusable public educational knowledge. It has ZERO
-- foreign keys and zero query path into clubs, teams, players, profiles,
-- auth.users, fixtures, attendance, coach assignments, session plans or
-- coach notes, and adds no operational state of any kind. Every hub_* table
-- is free of such references today and this slice keeps it that way.
--
-- Why a NEW content_type rather than reusing COACHING_GUIDANCE: that type
-- already exists but is a misnomer. Its only two rows
-- (when-contact-tackling-is-introduced, how-scrums-and-lineouts-change-by-age)
-- carry no body and no family and exist solely to hang Regulation 15 facts
-- off two skill pages, where the Skills explorer renders them as citations.
-- Folding pedagogy into that type would make the type meaningless, would put
-- two age-threshold explainers on a Coaching landing page as though they were
-- coaching concepts, and would force a content-type-aware family constraint
-- to exempt them. COACHING_GUIDANCE is left exactly as it is.
--
-- Positions are deliberately NOT linked. hub_content_item_positions is
-- generic and available, but no consumer renders the position -> content
-- direction, and coaching concepts (session design, feedback, questioning)
-- are role-agnostic by nature, so position links would be graph padding
-- rather than navigation. Deferred, not designed around.

-- ============ Schema ============

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT',
  'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE', 'RUGBY_TEAM', 'RUGBY_PERSON', 'PLAYER_DEVELOPMENT_CONCEPT',
  'COACHING_CONCEPT'
]));

alter table public.hub_content_items add column if not exists coaching_family text;

comment on column public.hub_content_items.coaching_family is
  'Editorial grouping for COACHING_CONCEPT only. Presentation taxonomy — never an operational field, never a coach record, never anything a coach is measured against.';

alter table public.hub_content_items drop constraint if exists hub_content_items_coaching_family_check;
alter table public.hub_content_items add constraint hub_content_items_coaching_family_check
  check (coaching_family is null or coaching_family = any (array[
    'COACHING_APPROACH', 'SESSION_DESIGN', 'PRACTICE_DESIGN', 'COMMUNICATION', 'INCLUSION', 'SAFETY', 'REFLECTION'
  ]));

alter table public.hub_content_items drop constraint if exists hub_content_items_coaching_family_matches_type;
alter table public.hub_content_items add constraint hub_content_items_coaching_family_matches_type
  check (
    (content_type = 'COACHING_CONCEPT' and coaching_family is not null)
    or (content_type <> 'COACHING_CONCEPT' and coaching_family is null)
  );

do $$
declare
  v_admin uuid;
  -- coaching concepts
  v_good uuid; v_centred uuid; v_newplayers uuid; v_experienced uuid;
  v_plansession uuid; v_purpose uuid; v_active uuid;
  v_gamelike uuid; v_progress uuid; v_stn uuid; v_decisions uuid;
  v_feedback uuid; v_questions uuid; v_explain uuid; v_intervene uuid; v_watch uuid;
  v_environment uuid; v_mixed uuid; v_latestart uuid; v_labels uuid;
  v_contact uuid; v_confidence uuid;
  v_reflect uuid; v_ownlearning uuid; v_playervoice uuid;
  v_breakdown uuid; v_tacklecount uuid;
  -- lookups
  v_union_ids uuid[]; v_league_ids uuid[];
begin
  select id into v_admin from auth.users order by created_at limit 1;
  select array_agg(id) into v_union_ids from public.regulatory_identities where rugby_code = 'union';
  select array_agg(id) into v_league_ids from public.regulatory_identities where rugby_code = 'league';

  -- ============ Concepts ============

  insert into public.hub_content_items (content_key, content_type, coaching_family, rugby_code, aliases, journey_order, title, summary, why_it_matters, body)
  values

  -- ---------- COACHING_APPROACH ----------
  ('what-good-coaching-looks-like', 'COACHING_CONCEPT', 'COACHING_APPROACH', null, array['Good Coaching','Coaching Basics'], 1,
   'What Good Coaching Looks Like',
   'The handful of things that separate a session players learn from a session players merely attend.',
   'Most volunteer coaches are not short of enthusiasm or rugby knowledge. What makes the difference is whether the session is built so that learning can actually happen.',
   'World Rugby describes a good session for children in four words: active, purposeful, enjoyable and safe. Those are more demanding than they sound. Active means players are playing rather than queuing. Purposeful means you could say in one sentence what this session is for. Enjoyable means players want to come back, which is the single strongest predictor of them still playing next season. Safe means both physically safe and safe to try something and get it wrong. Almost every practical idea in this section is a way of protecting one of those four. If you only change one thing, reduce the amount of time players spend standing still.'),

  ('player-centred-coaching', 'COACHING_CONCEPT', 'COACHING_APPROACH', null, array['Player Centred','Player-Led Coaching'], null,
   'Player-Centred Coaching',
   'Stepping back far enough that players have to think, without stepping back so far that nobody is coaching.',
   'A coach who supplies every answer produces players who can execute instructions but cannot read a game — and rugby is a game of unscripted decisions.',
   'A player-centred coach uses the game itself to teach, checks whether players actually understand rather than assuming, and is not frightened of a bit of chaos. World Rugby is explicit that this coach is "not afraid of chaos and players making mistakes", because that is what gives players the confidence to express themselves instead of playing not to fail. In practice it means observing before you intervene, asking before you tell, and letting a passage run on rather than stopping it the moment it goes wrong. It does not mean saying nothing. Players still need clear information, and a coach who never intervenes is not being player-centred, just absent. The judgement is about when.'),

  ('coaching-players-new-to-rugby', 'COACHING_CONCEPT', 'COACHING_APPROACH', null, array['Coaching Beginners','New Players'], null,
   'Coaching Players New to Rugby',
   'What to do in the first few weeks with someone who has never played, whatever their age.',
   'Beginners leave when they feel lost or exposed. Almost all of that is in the coach''s control.',
   'New players need far less rugby vocabulary than coaches tend to give them. Keep instructions to one or two things at a time, name only the terms they need to play the next activity, and let them handle the ball as much as possible. Small-sided games teach the shape of rugby faster than explanation does. Expect to say things more than once and in different words. Two things matter more than any drill: that a beginner touches the ball early and often, and that their first contact experience is calm, supervised and matched to what the age grade actually permits. Beginners are not only children — adults and teenagers start too, and a session that assumes everyone learned to pass at seven will lose them.'),

  ('coaching-experienced-players', 'COACHING_CONCEPT', 'COACHING_APPROACH', null, array['Experienced Players','Adult Community Rugby'], null,
   'Coaching Experienced Community Players',
   'How coaching changes when players already know how to play but want to get better.',
   'Coaching experienced players the way you coach beginners wastes their time; coaching them as though they are professionals wastes yours.',
   'Experienced community players usually do not need more technical instruction. They need richer problems, more ownership and better questions. Give them more say in how a session runs, let them solve tactical problems rather than receiving a solution, and use review — a short honest conversation about what happened and why — more than demonstration. Raise the decision complexity rather than the volume: fewer repetitions, harder choices. Remember the context is community rugby, where players arrive from work, availability varies and the session may be the only one that week. Autonomy and a clear purpose serve that reality better than a professional training model that assumes daily contact time.'),

  -- ---------- SESSION_DESIGN ----------
  ('planning-a-simple-session', 'COACHING_CONCEPT', 'SESSION_DESIGN', null, array['Session Plan','Planning a Session'], 2,
   'Planning a Simple Rugby Session',
   'A structure you can plan in ten minutes that works for almost any group.',
   'Sessions that drift are rarely a knowledge problem. They are a structure problem, and structure is the cheapest thing a coach can fix.',
   'A workable shape is: arrive and move, play, work on the thing, play again with the thing in it, finish. World Rugby''s whole-part-whole idea is exactly that — open with a game so you can see the problem, work on the specific weakness it exposed, then return to the game so players apply it under real conditions. Start the warm-up with the ball in hand rather than laps; it prepares bodies and gets touches at the same time. Plan for the number of players who might realistically turn up, not the number you hope for, and have one thing you are willing to drop if time goes. The plan exists to be adapted — if the opening game reveals a different problem than you expected, coach that instead.'),

  ('setting-a-clear-session-purpose', 'COACHING_CONCEPT', 'SESSION_DESIGN', null, array['Session Purpose','Session Objective'], null,
   'Setting a Clear Session Purpose',
   'Why one or two focus points beat a long list, and how to choose them.',
   'Coaches who try to fix everything in one session usually fix nothing, because no message is repeated often enough to stick.',
   'World Rugby''s guidance is to work on one or two key factors at a time, and to limit coaching points to a maximum of two or three at any one moment, precisely because extra detail dilutes the message. Choose the purpose from what you actually saw last time rather than from a syllabus. State it once at the start in plain language, design every activity so that it keeps appearing, and judge the session on whether it showed up — not on whether the session looked busy. A useful test: if you cannot finish the sentence "tonight is about…" in a few words, the session does not yet have a purpose, it has a list of activities.'),

  ('keeping-players-active-and-involved', 'COACHING_CONCEPT', 'SESSION_DESIGN', null, array['Active Players','Queues','Player Involvement'], null,
   'Keeping Players Active and Involved',
   'Getting rid of the queues, the long explanations and the standing around.',
   'Time spent waiting is time not learning, and it is where boredom, cold and misbehaviour come from.',
   'The most common fault in community sessions is too few balls and too many players per activity. Run several small games rather than one big one, use more balls, and shrink group sizes so everyone is involved. World Rugby''s advice for children is explicit about prioritising small-sided games with high participation. Keep your own talking short — players learn rugby by playing it, and a two-minute explanation costs two minutes of play. Watch for the players drifting to the back of the queue; they are usually the ones who most need touches. If you find yourself managing an activity rather than coaching it, the activity is probably too big.'),

  -- ---------- PRACTICE_DESIGN ----------
  ('designing-game-like-practice', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', null, array['Game-Based','Games Based','Game-Like Practice','Small-Sided Games'], 6,
   'Designing Game-Like Practice',
   'Why practice that looks like the game transfers to the game, and how to build it.',
   'Skills practised without opposition, pressure or a decision often disappear the moment a defender appears.',
   'Rugby is a game of reading and reacting, so practice should contain something to read and someone to react to. World Rugby recommends modified games that emphasise the skill you are working on, with the opposition conditioned to put players into decision-making situations. The practical version is simple: add a defender, shrink the space, or give one side a different objective. A passing practice with a defender who might or might not come is a different exercise from a passing line, even though the passing action is the same. This does not mean unopposed work is banned — it is useful for grooving a movement or when a skill is brand new — but it should be a step on the way to the game, not the destination.'),

  ('progressing-and-regressing-practice', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', null, array['Progression','Regression','Making It Harder'], null,
   'Progressing and Regressing Practice',
   'Making an activity harder when it is too easy, and easier when it is falling apart — without stopping the session.',
   'An activity pitched wrongly stops being practice: too easy and nobody thinks, too hard and nobody succeeds.',
   'Good practice sits where players succeed often enough to stay engaged and fail often enough to be learning. That point moves constantly, so plan every activity with a way up and a way down before you start. World Rugby specifically pairs progression with regression options based on player readiness. Going up: less space, less time, more defenders, an extra decision. Going down: more space, more time, fewer defenders, a simpler choice. Change one thing at a time so you can tell what made the difference. The signal to adjust is usually visible within a minute — watch whether players are still making choices or have settled into a single repeated answer.'),

  ('using-space-time-and-numbers', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', null, array['Constraints','Conditions','Changing the Challenge'], null,
   'Using Space, Time and Numbers to Change the Challenge',
   'The three dials that change almost any rugby activity, without needing a new one.',
   'Coaches often look for a different drill when the activity they already have would work with one adjustment.',
   'Nearly every rugby practice can be tuned with three things. Space: narrow the channel and defenders arrive sooner, so decisions come faster; widen it and players get time to execute. Time: limit how long a team may hold the ball and everything speeds up. Numbers: four attackers against two defenders is a very different problem from four against four, and moving one player changes the whole picture. World Rugby describes exactly these adjustments — narrowing the playing area, restricting skills in zones, varying the numbers in attack and defence. You can also adjust the scoring so that it rewards what the session is about, which changes behaviour faster than telling players what to do.'),

  ('coaching-decision-making', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', null, array['Decision Making','Decision-Rich Practice'], null,
   'Coaching Decision-Making',
   'Building practice where players have to choose, rather than practice where the answer is already known.',
   'A player who has only ever executed a pre-agreed move has no way of coping when the picture in front of them is different.',
   'Decisions need genuine alternatives. If the drill has one correct answer and everyone knows it in advance, no decision is being practised. Create situations with more than one reasonable option — a defender who may drift or push up, an overlap that only sometimes exists, a choice between passing and carrying. Then resist supplying the answer. Ask what the player saw, and what else was available. Judge the decision by the information they had at the time rather than by whether it came off, otherwise players learn to avoid decisions rather than make better ones. Over time the aim is players who can read the picture themselves, which is also what makes rugby enjoyable to play.'),

  ('coaching-breakdown-decisions', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', 'union', array['Breakdown Coaching','Ruck Decisions'], null,
   'Coaching Breakdown Decisions (Union)',
   'How to build practice where players choose well at the breakdown, rather than drilling a ruck technique.',
   'The breakdown is where Union games are decided, and the hardest part is not the technique but knowing which of several legal options to take.',
   'At a Union breakdown the arriving player has a genuine choice: compete for the ball, clear the threat away, or stay on their feet and get back into the defensive line. The right answer depends on how quickly they arrived, how many support players are near, and where the ball is. Coach it by building that picture rather than by rehearsing a single action — vary the arrival order, vary how many players reach the contact, and let the decision change. Legality is part of the skill, not a separate lecture: what counts as a legal arrival at a breakdown is set out in the Law itself and in the Officiating section rather than here, and a practice that quietly rewards an illegal entry teaches a habit that gets penalised on Saturday. The technique itself belongs with a qualified coach and with the contact skill pages.'),

  ('coaching-tackle-count-decisions', 'COACHING_CONCEPT', 'PRACTICE_DESIGN', 'league', array['Tackle Count Coaching','Set Coaching'], null,
   'Coaching Tackle-Count Decisions (League)',
   'Designing practice around the six-tackle set so players learn to think in sets rather than in single plays.',
   'In Rugby League every decision is shaped by which tackle of the set it is, and players who ignore the count make good decisions at the wrong moment.',
   'Coach the set, not just the play. Run practice in sets rather than isolated repetitions so players feel the count changing what is sensible: early tackles are for building position, later ones narrow the options, and the last tackle is a different problem again. Tell players the tackle number as it happens until they start tracking it themselves, then stop telling them. Vary the starting field position, because the same tackle count means something different inside your own twenty as it does near the opposition line. This is decision practice rather than fitness work — the aim is players who know what the set is for, not players who complete six plays.'),

  -- ---------- COMMUNICATION ----------
  ('giving-effective-feedback', 'COACHING_CONCEPT', 'COMMUNICATION', null, array['Feedback','Coaching Points'], 4,
   'Giving Effective Feedback',
   'Saying less, saying it at the right moment, and making it about something the player can change.',
   'Feedback is the main tool a coach has, and it is the one most often used badly — too much of it, too late, and too vague to act on.',
   'Useful feedback is specific, short, and about one thing. "Take the ball earlier" gives a player something to do; "concentrate" does not. Keep it to one or two points at a time, because World Rugby is clear that extra detail dilutes the message. Timing matters as much as content: mid-activity for something that needs fixing now, at a natural break for anything that needs more than a sentence. Direct it at the action rather than the person. Beware of only speaking to the players who are struggling, and beware of praise so constant it stops carrying information. Being able to say nothing for a while and let a player work it out is also feedback.'),

  ('asking-better-questions', 'COACHING_CONCEPT', 'COMMUNICATION', null, array['Questioning','Open Questions'], 5,
   'Asking Better Questions',
   'Using questions so players work things out, without turning the session into an interrogation.',
   'A question makes a player think about the picture; an instruction only makes them move.',
   'Open questions — what did you see, what else was on, what would you do differently — get players thinking about the game rather than waiting for orders. World Rugby describes continually checking for players'' understanding rather than assuming it, and notes that verbal questioning should be kept brief. That brevity matters: a long series of questions in front of a cold, waiting group is worse than simply telling them. Ask fewer, better questions, give players a moment to answer, and accept an answer you did not expect if it is reasonable. Questions are not a trick for extracting the answer you already have in mind; if you need them to know something specific, tell them and move on.'),

  ('explaining-and-demonstrating-clearly', 'COACHING_CONCEPT', 'COMMUNICATION', null, array['Demonstration','Explaining','Instructions'], null,
   'Explaining and Demonstrating Clearly',
   'Getting an idea across in under a minute so players can get back to playing.',
   'Most explanations are too long, and the extra words are usually where players stop listening.',
   'Show as well as tell, keep it to one or two points, and check understanding by watching what players do next rather than by asking whether everyone understood. Position the group so everyone can see and hear before you start, and use the same words for the same thing every week — a skill called one thing on Tuesday and something else on Thursday is two skills as far as a new player is concerned. A demonstration does not have to come from you; a player who has just done it well is often a better model. There is no need to tailor explanations to supposed visual, auditory or kinaesthetic learner types — that idea is not supported by evidence. Showing and telling works because most tasks are better understood with both, for everyone.'),

  ('knowing-when-to-intervene', 'COACHING_CONCEPT', 'COMMUNICATION', null, array['When to Stop','Intervening','Coach Interventions'], null,
   'Knowing When to Intervene',
   'Deciding whether to stop the practice, coach on the move, or leave it alone.',
   'Stopping too often destroys the flow players need in order to learn; never stopping leaves errors to harden into habits.',
   'Three options are always available. Stop everything — expensive, so reserve it for something unsafe, something illegal, or a point everybody needs. Coach on the move — a few words to one player while play continues, which is usually the best of the three. Say nothing and keep watching, which is the one coaches use least and should use more. Before stopping, ask whether the players are about to solve it themselves, because if they are, stepping in takes the learning away. If you have stopped the session three times in five minutes, the activity is probably pitched wrongly and adjusting it will do more than another explanation.'),

  ('watching-before-you-coach', 'COACHING_CONCEPT', 'COMMUNICATION', null, array['Observation','Watching Players','Analysis'], null,
   'Watching Before You Coach',
   'Looking properly at what is happening before deciding what to say about it.',
   'Coaches who speak first often fix the visible symptom while the real cause carries on unchanged.',
   'World Rugby describes the player-centred coach as observing and analysing performance before generating feedback, and that order matters. Watch a few repetitions before intervening. Watch the whole picture, not just the ball — the support runner who arrived late may be the reason the pass looked wrong. Ask yourself whether what you are seeing is a technique problem, a decision problem or simply an activity that is too hard, because all three look similar and only one is fixed by coaching technique. Look for patterns across several players rather than reacting to one error. This is observation in service of better coaching; it is not assessment, and nothing about it needs recording or scoring.'),

  -- ---------- INCLUSION ----------
  ('creating-a-positive-learning-environment', 'COACHING_CONCEPT', 'INCLUSION', null, array['Learning Environment','Positive Environment','Psychological Safety'], 3,
   'Creating a Positive Learning Environment',
   'Making it safe to try something difficult and get it wrong.',
   'Players only attempt the hard thing — the pass under pressure, the tackle on a bigger player — if getting it wrong is survivable.',
   'World Rugby''s guidance is direct about this: reward effort and the process as well as the outcome, work with all the players rather than only the most skilful, avoid a win-at-all-costs approach, and expose players to different positions instead of specialising them early. What that looks like in a session is reacting to a mistake with information rather than exasperation, making sure the quieter players get the ball, and not letting the same two players take every decision. How you respond to the first error of the evening sets the tone for the rest of it. This is ordinary good coaching, not a substitute for the club''s safeguarding responsibilities, which sit with the club and its safeguarding officer.'),

  ('coaching-mixed-ability-groups', 'COACHING_CONCEPT', 'INCLUSION', null, array['Mixed Ability','Different Abilities'], null,
   'Coaching Mixed-Ability Groups',
   'Running one session that works for the most and least experienced players in it.',
   'Almost every community session is mixed ability, and the default — pitching it at the middle — serves nobody at either end.',
   'The useful idea is that the same activity can carry different challenges. In a small-sided game a more experienced player can be given an extra condition — two touches only, must pass before contact — while a newer player plays the game as it is. Roles can differ inside one activity without anybody being moved to a separate group. Differentiation is something World Rugby names explicitly as part of designing practice. Splitting by ability for a whole session is worth avoiding: it tells everyone where they have been placed, and the less experienced group loses the players they learn fastest from. Where you do need different groups, make them short, purposeful and mixed up again afterwards.'),

  ('including-players-who-start-later', 'COACHING_CONCEPT', 'INCLUSION', null, array['Late Starters','New to the Squad','Joining Late'], null,
   'Including Players Who Start Later',
   'Bringing in someone who joins a group where everyone else already knows each other and the game.',
   'A late starter is usually the most likely player in the squad to leave, and the reasons are almost entirely social and structural rather than physical.',
   'Someone arriving into an established group faces two problems at once: they do not know the rugby and they do not know anybody. Deal with the second first — pair them with a player who will talk to them, and use their name early and often. On the rugby, give them a role they can do successfully in the first session rather than hiding them out of the way, and explain terms as they come up instead of assuming. Late starters are not only children moving clubs; they include teenagers trying rugby after another sport and adults playing for the first time. Avoid framing them as behind. They have less rugby experience, which is a description of where they are starting, not of what they will become.'),

  ('adapting-without-labelling', 'COACHING_CONCEPT', 'INCLUSION', null, array['Labelling','Adapting Practice','Grouping'], null,
   'Adapting Practice Without Labelling Players',
   'Changing the challenge for individuals without announcing who is being helped.',
   'An adaptation that publicly marks a player as the weakest one is often worse than no adaptation at all.',
   'Adjust quietly. Give conditions to several players rather than one, so an extra constraint reads as a challenge rather than a remedy. Change the activity instead of the person where you can — different sized channels, different scoring, mixed teams — so the practice absorbs the difference. Speak to individuals individually rather than explaining to the group why someone is doing something different. Avoid public ranking of any kind: no picking teams by turn, no naming the best and worst, no leaderboards. Ovalball deliberately holds no player rating, score or ability grade anywhere, and a session should not create one informally either. Players know where they stand; they do not need it confirmed in front of everybody.'),

  -- ---------- SAFETY ----------
  ('coaching-contact-safely', 'COACHING_CONCEPT', 'SAFETY', null, array['Contact Safety','Safe Contact','Coaching Contact'], null,
   'Coaching Contact Safely',
   'The coach''s responsibilities around contact, and where the governing body''s rules take over.',
   'Contact is the part of rugby where a coaching decision can cause an injury, and the rules around it are not advisory.',
   'Two things are true at once. The first is that what contact is permitted at each age grade is set by the governing body, is specific, changes year by year through the age grades, and is not a coaching judgement — it is written down and must be checked rather than assumed. The second is that within what is permitted, how you coach it matters: technique before intensity, controlled before competitive, supervised throughout, and stop immediately if it stops being safe. Build up slowly enough that players are confident at each stage before the next. Ovalball does not set tackle heights, contact volumes or contact loads, does not judge medical readiness, and does not give return-to-play or concussion guidance — those come from the governing body and from qualified medical people, and the Rules and Player Welfare sections of the Hub carry them.'),

  ('helping-players-build-contact-confidence', 'COACHING_CONCEPT', 'SAFETY', null, array['Contact Confidence Coaching','Nervous Players'], null,
   'Helping Players Build Contact Confidence',
   'What a coach can do for the player who is worried about contact.',
   'Nervousness about contact is extremely common and is usually about uncertainty rather than courage.',
   'The player-facing side of this — what contact confidence is and how it grows — is covered in Player Development. The coach''s side is different and practical. Make the progression visible so players know what is coming and that nothing will be sprung on them. Keep early contact slow, low and against a similar-sized partner. Let a player who is not ready do the next step down without it being a public event. Do not use contact as a test of character, and never as a punishment. Notice who avoids contact by drifting to the back of the queue rather than by saying anything. Confidence generally follows competence, so time spent on technique in a calm setting does more than encouragement does. If worry seems to go beyond rugby, that is a conversation for the club and the player''s family, not something to coach through.'),

  -- ---------- REFLECTION ----------
  ('reflecting-after-a-session', 'COACHING_CONCEPT', 'REFLECTION', null, array['Reflection','After the Session','Session Review'], 7,
   'Reflecting After a Session',
   'Three questions in the car park that are worth more than an hour of planning.',
   'Coaches repeat the same session faults for years, not through lack of care, but because nothing ever prompts them to notice.',
   'Ask three things while it is fresh. What did the players actually do — not what you planned, what happened. Was the session''s purpose visible in what they did. What one thing would you change next time. Write the answers down somewhere, even a phone note, because the value comes from comparing across weeks rather than from any single session. Look for patterns: if the last four sessions all ran out of time at the same point, that is a planning problem rather than four separate bad nights. Be as interested in the sessions that went well as the ones that did not. This is your own private reflection as a coach, and Ovalball stores none of it.'),

  ('learning-from-your-own-coaching', 'COACHING_CONCEPT', 'REFLECTION', null, array['Coach Development','Improving Your Coaching'], null,
   'Learning From Your Own Coaching',
   'Getting better across a season rather than across a single session.',
   'Most coaching improvement comes from the same handful of habits, and none of them require a course.',
   'Watch other coaches, including in other sports, and steal specific things rather than whole philosophies. Ask another coach to watch a session and tell you what they actually saw — the most useful question is what the players did, not whether they enjoyed it. Try one change at a time so you can tell whether it worked. Read what your governing body publishes, because it is free, current and written for your context. Be wary of adopting a single coaching methodology wholesale; credible coaching models disagree with each other, and community rugby rarely fits any of them exactly. None of this replaces formal coach education — the RFU and RFL run the qualifications, and Ovalball neither delivers nor records them.'),

  ('asking-players-what-they-think', 'COACHING_CONCEPT', 'REFLECTION', null, array['Player Voice','Player Feedback'], null,
   'Asking Players What They Think',
   'Using what players tell you as information about your coaching, not as a verdict on it.',
   'Players know things about your session that you cannot see from where you are standing.',
   'Ask occasionally and specifically. What was that game asking you to do? Which part tonight was too easy? What do you want to work on next week? The answers tell you whether the purpose you had in mind actually reached them, which is usually the most valuable thing you will learn all evening. Keep it brief and conversational — a formal survey changes the atmosphere and rarely produces better information. Expect some answers you disagree with, and take them as data rather than instruction; the coach still decides. With younger players the question needs to be concrete, because "how was that?" reliably produces "good". This is a coaching habit, not a rating exercise, and nothing about it is scored or recorded.')

  ;

  -- Resolve every id by key. A multi-row INSERT cannot RETURNING INTO
  -- scalars, so the ids are read back by their natural key instead.
  select id into v_good from public.hub_content_items where content_key = 'what-good-coaching-looks-like' and content_type = 'COACHING_CONCEPT';
  select id into v_centred from public.hub_content_items where content_key = 'player-centred-coaching' and content_type = 'COACHING_CONCEPT';
  select id into v_newplayers from public.hub_content_items where content_key = 'coaching-players-new-to-rugby' and content_type = 'COACHING_CONCEPT';
  select id into v_experienced from public.hub_content_items where content_key = 'coaching-experienced-players' and content_type = 'COACHING_CONCEPT';
  select id into v_plansession from public.hub_content_items where content_key = 'planning-a-simple-session' and content_type = 'COACHING_CONCEPT';
  select id into v_purpose from public.hub_content_items where content_key = 'setting-a-clear-session-purpose' and content_type = 'COACHING_CONCEPT';
  select id into v_active from public.hub_content_items where content_key = 'keeping-players-active-and-involved' and content_type = 'COACHING_CONCEPT';
  select id into v_gamelike from public.hub_content_items where content_key = 'designing-game-like-practice' and content_type = 'COACHING_CONCEPT';
  select id into v_progress from public.hub_content_items where content_key = 'progressing-and-regressing-practice' and content_type = 'COACHING_CONCEPT';
  select id into v_stn from public.hub_content_items where content_key = 'using-space-time-and-numbers' and content_type = 'COACHING_CONCEPT';
  select id into v_decisions from public.hub_content_items where content_key = 'coaching-decision-making' and content_type = 'COACHING_CONCEPT';
  select id into v_breakdown from public.hub_content_items where content_key = 'coaching-breakdown-decisions' and content_type = 'COACHING_CONCEPT';
  select id into v_tacklecount from public.hub_content_items where content_key = 'coaching-tackle-count-decisions' and content_type = 'COACHING_CONCEPT';
  select id into v_feedback from public.hub_content_items where content_key = 'giving-effective-feedback' and content_type = 'COACHING_CONCEPT';
  select id into v_questions from public.hub_content_items where content_key = 'asking-better-questions' and content_type = 'COACHING_CONCEPT';
  select id into v_explain from public.hub_content_items where content_key = 'explaining-and-demonstrating-clearly' and content_type = 'COACHING_CONCEPT';
  select id into v_intervene from public.hub_content_items where content_key = 'knowing-when-to-intervene' and content_type = 'COACHING_CONCEPT';
  select id into v_watch from public.hub_content_items where content_key = 'watching-before-you-coach' and content_type = 'COACHING_CONCEPT';
  select id into v_environment from public.hub_content_items where content_key = 'creating-a-positive-learning-environment' and content_type = 'COACHING_CONCEPT';
  select id into v_mixed from public.hub_content_items where content_key = 'coaching-mixed-ability-groups' and content_type = 'COACHING_CONCEPT';
  select id into v_latestart from public.hub_content_items where content_key = 'including-players-who-start-later' and content_type = 'COACHING_CONCEPT';
  select id into v_labels from public.hub_content_items where content_key = 'adapting-without-labelling' and content_type = 'COACHING_CONCEPT';
  select id into v_contact from public.hub_content_items where content_key = 'coaching-contact-safely' and content_type = 'COACHING_CONCEPT';
  select id into v_confidence from public.hub_content_items where content_key = 'helping-players-build-contact-confidence' and content_type = 'COACHING_CONCEPT';
  select id into v_reflect from public.hub_content_items where content_key = 'reflecting-after-a-session' and content_type = 'COACHING_CONCEPT';
  select id into v_ownlearning from public.hub_content_items where content_key = 'learning-from-your-own-coaching' and content_type = 'COACHING_CONCEPT';
  select id into v_playervoice from public.hub_content_items where content_key = 'asking-players-what-they-think' and content_type = 'COACHING_CONCEPT';

  -- ============ Applicability ============
  -- Universal coaching principles exist once. Only the two genuinely
  -- code-divergent concepts are scoped, and they are scoped by real
  -- regulatory identity rather than by an is_universal flag.
  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items
  where content_type = 'COACHING_CONCEPT' and rugby_code is null;

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select v_breakdown, unnest(v_union_ids);
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select v_tacklecount, unnest(v_league_ids);

  -- ============ Publish ============
  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where content_type = 'COACHING_CONCEPT';

  -- ============ Coaching -> Skill (existing generic hub_skill_content_links) ============
  insert into public.hub_skill_content_links (skill_id, content_item_id)
  select s.id, v.content_item_id
  from (values
    (v_gamelike, 'passing-under-pressure'), (v_gamelike, 'catching-under-pressure'), (v_gamelike, 'decision-making-under-pressure'),
    (v_decisions, 'decision-making-under-pressure'), (v_decisions, 'running-and-evasion'), (v_decisions, 'game-management'),
    (v_stn, 'running-and-evasion'),
    (v_progress, 'catching-under-pressure'),
    (v_contact, 'tackling-technique'),
    (v_confidence, 'tackling-technique'),
    (v_breakdown, 'contact-and-breakdown-work'), (v_breakdown, 'decision-making-under-pressure'),
    (v_tacklecount, 'play-the-ball-and-restart'), (v_tacklecount, 'kicking-for-territory-and-tactics'), (v_tacklecount, 'game-management'),
    (v_questions, 'on-field-communication'),
    (v_explain, 'on-field-communication'),
    (v_newplayers, 'passing-under-pressure'),
    (v_experienced, 'game-management')
  ) as v(content_item_id, skill_key)
  join public.hub_skills s on s.skill_key = v.skill_key and s.status = 'PUBLISHED';

  -- ============ Coaching -> Player Development / Game Knowledge / Officiating / Coaching ============
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
  select v.src, t.id, 'RELATED_KNOWLEDGE'
  from (values
    -- Player Development: the coach-side concept pointing at the player-side one.
    (v_feedback, 'learning-from-mistakes'),
    (v_environment, 'confidence-and-composure'),
    (v_decisions, 'scanning-before-you-act'),
    (v_gamelike, 'linking-skills-together'),
    (v_newplayers, 'learning-the-basics'),
    (v_mixed, 'building-core-skills'),
    (v_latestart, 'learning-the-basics'),
    (v_progress, 'progressive-physical-development'),
    (v_confidence, 'contact-confidence'),
    (v_contact, 'moving-through-age-grade-rugby'),
    (v_plansession, 'warm-up-habits'),
    (v_purpose, 'training-habits'),
    (v_reflect, 'learning-from-mistakes'),
    (v_experienced, 'trying-different-positions'),
    (v_stn, 'finding-space'),
    (v_watch, 'scanning-before-you-act'),
    -- The code-specific pairings: each coaching concept sits directly above
    -- the Player Development concept that teaches the player's side of the
    -- same decision.
    (v_breakdown, 'breakdown-decision-making'),
    (v_tacklecount, 'tackle-count-awareness'),
    (v_playervoice, 'preparing-for-match-day'),
    -- Game Knowledge
    (v_gamelike, 'how-teams-move-the-ball'),
    (v_decisions, 'possession-and-territory'),
    (v_stn, 'attack-and-defence'),
    (v_newplayers, 'the-objective-of-the-game'),
    (v_plansession, 'how-a-game-flows'),
    (v_breakdown, 'the-breakdown-and-ruck'),
    (v_tacklecount, 'tackle-count-and-set-restarts'),
    (v_tacklecount, 'the-play-the-ball'),
    -- Officiating
    (v_contact, 'foul-play-and-player-safety'),
    (v_environment, 'coaches-and-touchline-behaviour'),
    (v_breakdown, 'breakdown-and-ruck-decisions-union'),
    (v_tacklecount, 'tackle-and-play-the-ball-decisions-league'),
    (v_questions, 'players-and-respect'),
    -- Coaching -> Coaching (the internal spine of the domain)
    (v_good, 'planning-a-simple-session'),
    (v_good, 'creating-a-positive-learning-environment'),
    (v_centred, 'asking-better-questions'),
    (v_centred, 'knowing-when-to-intervene'),
    (v_plansession, 'setting-a-clear-session-purpose'),
    (v_purpose, 'keeping-players-active-and-involved'),
    (v_gamelike, 'using-space-time-and-numbers'),
    (v_progress, 'using-space-time-and-numbers'),
    (v_decisions, 'designing-game-like-practice'),
    (v_feedback, 'watching-before-you-coach'),
    (v_questions, 'giving-effective-feedback'),
    (v_explain, 'keeping-players-active-and-involved'),
    (v_intervene, 'watching-before-you-coach'),
    (v_mixed, 'adapting-without-labelling'),
    (v_latestart, 'coaching-players-new-to-rugby'),
    (v_environment, 'adapting-without-labelling'),
    (v_contact, 'helping-players-build-contact-confidence'),
    (v_reflect, 'learning-from-your-own-coaching'),
    (v_ownlearning, 'asking-players-what-they-think'),
    (v_experienced, 'coaching-decision-making'),
    (v_newplayers, 'explaining-and-demonstrating-clearly')
  ) as v(src, target_key)
  join public.hub_content_items t on t.content_key = v.target_key and t.status = 'PUBLISHED';

  -- ============ Coaching -> Law (existing generic hub_regulatory_fact_references) ============
  -- Coaching Knowledge never states the Law itself. It points at the
  -- governing body's own verified wording, which is what a coach must check.
  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
  select f.id, v.src, 'RULE_EXPLANATION'
  from (values
    (v_contact, 'RFU-REG15-2026-ADULTS-NOT-IN-CONTACT-TRAINING'),
    (v_contact, 'RFU-REG15-2026-CONTACT-PERMITTED-U9-PLUS'),
    (v_confidence, 'RFU-REG15-APP-U9-CONTACT'),
    (v_breakdown, 'WR-LAW-RUCK')
  ) as v(src, fact_key)
  join public.regulatory_facts f on f.fact_key = v.fact_key and f.status = 'VERIFIED';

  -- ============ Sources ============
  insert into public.hub_content_sources (content_item_id, source_tier, source_title, source_url, retrieved_on)
  values
    (v_good, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_centred, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_newplayers, 'GOVERNING_BODY', 'World Rugby Passport: Coaching children — the basics', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_experienced, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_plansession, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_purpose, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_active, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_gamelike, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_progress, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_stn, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_decisions, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_breakdown, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_tacklecount, 'GOVERNING_BODY', 'Play Rugby League: Coaching resources', 'https://www.playrugbyleague.com/coach/coaching-resources/', current_date),
    (v_tacklecount, 'GOVERNING_BODY', 'Rugby Football League: Coach', 'https://www.rugby-league.com/get-involved/coach', current_date),
    (v_feedback, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_questions, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_explain, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_explain, 'ACADEMIC', 'Learning styles: concepts and evidence (Pashler, McDaniel, Rohrer & Bjork)', 'https://journals.sagepub.com/doi/10.1111/j.1539-6053.2009.01038.x', current_date),
    (v_intervene, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_watch, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date),
    (v_environment, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_mixed, 'GOVERNING_BODY', 'World Rugby Passport: Coaching through games', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/coaching-through-games/', current_date),
    (v_latestart, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_labels, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_confidence, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_reflect, 'GOVERNING_BODY', 'World Rugby Passport: Coaching', 'https://passport.world.rugby/coaching', current_date),
    (v_ownlearning, 'GOVERNING_BODY', 'World Rugby Passport: Coaching', 'https://passport.world.rugby/coaching', current_date),
    (v_ownlearning, 'GOVERNING_BODY', 'Rugby Football League: Coach', 'https://www.rugby-league.com/get-involved/coach', current_date),
    (v_playervoice, 'GOVERNING_BODY', 'World Rugby Passport: Player-centred coaching', 'https://passport.world.rugby/coaching/introduction-to-coaching/coaching-styles/player-centred/', current_date);

end $$;
