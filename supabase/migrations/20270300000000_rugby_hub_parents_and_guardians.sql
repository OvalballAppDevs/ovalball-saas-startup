-- Rugby Hub — Parents & Guardians.
--
-- The parent-facing INTERPRETATION AND NAVIGATION layer. It is deliberately
-- not the canonical authority for anything.
--
--   A parent asks          Canonical answer lives in     Parents guide does
--   "what is a ruck?"      Glossary / Game Knowledge     links there
--   "what is the law?"     Rules / regulatory_facts      links there
--   "concussion?"          Player Welfare                links there
--   "safeguarding?"        Safeguarding                  links there
--   "how do skills grow?"  Skills / Player Development   links there
--   "how do coaches work?" Coaching Knowledge            links there
--
-- What genuinely belongs here is the adult's own question: what happens
-- next, what do we need, what will this look like, how do I support this
-- person well, and where do I go for the real answer.
--
-- Why PARENT_GUIDE rather than the existing, unused PRACTICAL_GUIDE type:
-- PRACTICAL_GUIDE names a FORMAT, not a domain, and docs/rugby-hub/
-- content-architecture.md already earmarks it for Registration. Keying a
-- Parents landing page on it would mean that future registration content
-- silently appears on a parents page -- the same mistake COACHING_GUIDANCE
-- represents, where a type named for an audience actually holds two
-- regulatory note-carriers. Every other Hub domain owns exactly one
-- content_type; this one does too.
--
-- Collision resolved at design time: the Officiating domain already owns
-- 'parents-and-spectators' (touchline behaviour and referee respect). This
-- slice therefore seeds NO standalone referee guide. The touchline guide
-- links to the Officiating concept instead of restating it.
--
-- Zero reach into operational data: guardians, guardian_invitations,
-- guardian_player_permissions, guardian_link_requests, players, profiles,
-- auth.users, registrations, consents, medical records, emergency contacts,
-- payments, attendance and messaging are all untouched. No hub_* table
-- references any of them today and this slice keeps it that way.

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT',
  'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE', 'RUGBY_TEAM', 'RUGBY_PERSON', 'PLAYER_DEVELOPMENT_CONCEPT',
  'COACHING_CONCEPT', 'PARENT_GUIDE'
]));

alter table public.hub_content_items add column if not exists parent_family text;

comment on column public.hub_content_items.parent_family is
  'Editorial grouping for PARENT_GUIDE only. Presentation taxonomy — never a record of any family, guardian or player.';

alter table public.hub_content_items drop constraint if exists hub_content_items_parent_family_check;
alter table public.hub_content_items add constraint hub_content_items_parent_family_check
  check (parent_family is null or parent_family = any (array[
    'GETTING_STARTED', 'TRAINING_AND_MATCH_DAY', 'SUPPORTING_YOUR_PLAYER', 'WELFARE_AND_SAFETY',
    'CLUB_CULTURE', 'PATHWAYS_AND_OPPORTUNITIES', 'PRACTICAL_RUGBY'
  ]));

alter table public.hub_content_items drop constraint if exists hub_content_items_parent_family_matches_type;
alter table public.hub_content_items add constraint hub_content_items_parent_family_matches_type
  check (
    (content_type = 'PARENT_GUIDE' and parent_family is not null)
    or (content_type <> 'PARENT_GUIDE' and parent_family is null)
  );

-- Parents is the first Hub domain to cite a child-protection authority that
-- is not a rugby governing body. NSPCC / CPSU is neither GOVERNING_BODY nor
-- ACADEMIC, and labelling it as either would misstate provenance -- which is
-- the one thing the source architecture exists to prevent. One new tier
-- value, no new table.
alter table public.hub_content_sources drop constraint if exists hub_content_sources_source_tier_check;
alter table public.hub_content_sources add constraint hub_content_sources_source_tier_check
  check (source_tier = any (array[
    'GOVERNING_BODY', 'SAFEGUARDING_AUTHORITY', 'MUSEUM_OR_ARCHIVE', 'ACADEMIC',
    'ENCYCLOPEDIA', 'POPULAR_HISTORY', 'CONTEMPORARY_REPORT'
  ]));

do $$
declare
  v_admin uuid;
  v_start uuid; v_understand uuid; v_needs uuid; v_later uuid;
  v_training uuid; v_matchday uuid;
  v_aftergame uuid; v_difficult uuid; v_winlose uuid; v_contactconf uuid;
  v_contact uuid; v_concussion uuid; v_safeguarding uuid; v_safeclub uuid;
  v_touchline uuid; v_coachtalk uuid; v_selection uuid; v_notselected uuid;
  v_pathways uuid; v_academy uuid; v_positions uuid; v_girls uuid;
  v_costs uuid; v_festivals uuid; v_volunteer uuid;
begin
  select id into v_admin from auth.users order by created_at limit 1;

  insert into public.hub_content_items (content_key, content_type, parent_family, rugby_code, aliases, journey_order, title, summary, why_it_matters, body)
  values

  -- ---------- GETTING_STARTED ----------
  ('new-to-rugby-parents-start-here', 'PARENT_GUIDE', 'GETTING_STARTED', null, array['Start Here','New Parent','Getting Started'], 1,
   'New to Rugby? A Parent''s Start Here',
   'What actually happens when someone in your family wants to try rugby, and what you need to do first.',
   'Most people arrive at a rugby club knowing nobody and nothing about the sport, and the first few weeks decide whether the family stays.',
   'The honest version is that very little is required of you at the start. Clubs expect new players to turn up knowing nothing, and the first session is usually about finding out whether the person enjoys it. Contact your local club and ask when the right age group trains — almost every club runs a come-and-try period before anyone joins properly. Registration with the club and the governing body happens once the family decides to continue, and the club will walk you through it. You do not need to understand rugby to be useful: turning up, being encouraging and getting your player there on time covers most of it. Everything else in this section exists because other families asked the same questions you are about to.'),

  ('understanding-the-game-as-a-parent', 'PARENT_GUIDE', 'GETTING_STARTED', null, array['Understanding Rugby','Watching Rugby','New to the Game'], 2,
   'Understanding the Game as a New Rugby Parent',
   'Enough of how rugby works to follow a game, without learning the whole rulebook first.',
   'Watching a sport you do not understand is uncomfortable, and it is hard to support someone well when you cannot tell whether what just happened was good.',
   'You need far less than you think. Rugby is two teams trying to carry, pass or kick the ball to the opposition''s end and ground it, and the ball cannot be passed forwards. Almost everything else follows from those two facts. The two codes then diverge: in Rugby Union the contest continues on the ground after a tackle, which is where rucks and mauls come from; in Rugby League the tackled player gets up and restarts play, and each team has a set number of tackles before possession changes. Both are explained properly in Game Knowledge, and any word you hear and do not recognise is in the Glossary. Watching one game with the Glossary open is usually enough to stop feeling lost.'),

  ('what-a-new-player-needs', 'PARENT_GUIDE', 'GETTING_STARTED', null, array['Kit','Boots','Mouthguard','Gum Shield','What to Bring'], 3,
   'What Does a New Rugby Player Need?',
   'What to buy before the first session, what can wait, and what the club will tell you.',
   'Families routinely spend money on equipment before finding out what is actually needed, and some of it is never used.',
   'Start with almost nothing. For a first session: something warm and comfortable to move in, trainers or boots, a drink, and weather-appropriate layers — rugby is played outdoors through the winter and being cold ruins it faster than anything else. A mouthguard is the one item worth getting early, and clubs will tell you at what point it becomes expected for the age group and format being played. Boots with the right studs come next, once you know the player is continuing. Club kit, training tops and anything branded can wait until they are part of the club. Requirements genuinely differ by code, age group and club, so the single most useful thing you can do is ask your club what this age group needs this season rather than buying from a general list.'),

  ('starting-rugby-later', 'PARENT_GUIDE', 'GETTING_STARTED', null, array['Late Starter','Starting Late','Joining Later'], null,
   'Supporting Someone Starting Rugby Later',
   'What is different when your player joins after everyone else already knows each other and the game.',
   'Starting later is the single most common reason a new player quietly stops going, and the reasons are usually social rather than sporting.',
   'Someone arriving into an established group has two problems at once: they do not know the rugby and they do not know anybody. The second matters more in the first month. Ask the coach to pair them with someone, learn one or two other families'' names yourself, and treat the social side as part of the sport rather than a distraction from it. On the rugby, expect them to look behind for a while and expect that to stop — the gap closes far faster than most families assume, because rugby has many roles and rewards different physical types. Starting late is genuinely normal: plenty of people play a first game at fourteen, and plenty more start as adults. Avoid framing them as catching up. They have less experience, which describes where they are starting and not what they will become.'),

  -- ---------- TRAINING_AND_MATCH_DAY ----------
  ('first-rugby-training-session', 'PARENT_GUIDE', 'TRAINING_AND_MATCH_DAY', null, array['First Training','First Session','Training'], 4,
   'What to Expect at the First Training Session',
   'The broad shape of a session, so nothing about the first one is a surprise.',
   'Knowing roughly what is coming makes the first session easier for the player and much easier for the adult standing at the side of it.',
   'Clubs run sessions differently, so treat this as a shape rather than a schedule. Most sessions begin with arrival and some form of moving about with a ball, move into games and activities that work on something specific, and finish with a bigger game. Expect a lot of activity and not much standing in lines — that is deliberate, and it is what good coaching looks like. Expect your player to be confused for some of it, and expect the coach not to fix everything at once. You will usually be asked to stay on site. Arrive a few minutes early for the first one so there is time to meet the coach, say what experience the player has, and mention anything the coach genuinely needs to know. Afterwards, the useful question is whether they enjoyed it.'),

  ('first-rugby-match-day', 'PARENT_GUIDE', 'TRAINING_AND_MATCH_DAY', null, array['Match Day','First Match','Fixtures'], 5,
   'What to Expect on Match Day',
   'How a match morning tends to run, and what your part in it is.',
   'Match day has more moving parts than training — travel, timings, kit, officials, other clubs — and it is where new families most often feel out of their depth.',
   'Arrival is earlier than you expect, usually so there is time to change, warm up and get organised before kick-off. There will be a match official, who at age-grade level is often a volunteer and sometimes quite young. Formats vary a great deal by age group and code — the number of players, the size of the pitch and the length of a game all change as players get older, and your club or the governing body''s own rules are the place to check what applies. Substitutions and how much game time each player gets also vary by competition and club approach, and it is a reasonable thing to ask about in advance. Afterwards there is usually food, other families, and a lot of standing around in the cold. Bring more layers than you think you need.'),

  -- ---------- SUPPORTING_YOUR_PLAYER ----------
  ('talking-about-rugby-after-the-game', 'PARENT_GUIDE', 'SUPPORTING_YOUR_PLAYER', null, array['After the Game','Car Journey','Talking About Rugby'], 7,
   'Talking About Rugby After the Game',
   'What to say in the car afterwards, and what to leave alone.',
   'The conversation immediately after a game shapes whether rugby stays something the player owns or becomes something they are assessed on.',
   'Lead with something other than analysis. "Did you enjoy that?" gets you further than "why did you not pass?", and it leaves the door open rather than opening a review. Let them raise the incident they are thinking about; they usually will, once it is clear you are not about to. If they want to talk about a mistake, talking about it is fine — the thing to avoid is a technical debrief they did not ask for, particularly one that contradicts what the coach said. Some players want to talk straight away and some want twenty minutes and a sandwich first, and it is worth finding out which yours is. The aim across a season is that they come away thinking about the game rather than about your reaction to it.'),

  ('supporting-after-a-difficult-game', 'PARENT_GUIDE', 'SUPPORTING_YOUR_PLAYER', null, array['Bad Game','Difficult Game','Upset'], null,
   'Supporting a Player After a Difficult Game',
   'What helps after a heavy defeat, a bad individual error, or a game they hated.',
   'Everyone has them, and how the adults around a player respond to a bad day teaches more than the good days do.',
   'Acknowledge it rather than talking them out of it. "That looked rough" lands better than "it was fine", which they know is not true. Give it time before any analysis, and ideally let the analysis come from them or the coach rather than from you. Separate the result from the person — a lost game and a bad error are events, not verdicts, and the way an adult frames them is usually the version a young player adopts. Watch for the difference between a normal bad afternoon, which passes by midweek, and something that is still there the following week or is putting them off going at all. If it is the second, the coach is the right first conversation. If something about rugby is genuinely affecting them beyond rugby, that is a conversation for your family and for people qualified to help, not something to coach through.'),

  ('helping-with-winning-and-losing', 'PARENT_GUIDE', 'SUPPORTING_YOUR_PLAYER', null, array['Winning','Losing','Results','Sportsmanship'], null,
   'Helping Players Handle Winning and Losing',
   'Keeping results in proportion, in both directions.',
   'Age-grade results predict very little, and families who attach a lot to them tend to enjoy the sport less and leave it earlier.',
   'The habits worth building are the same after a win and a loss: shake hands, thank the officials, be decent about the opposition, and talk about what happened rather than who is to blame. Heavy defeats and heavy wins are both common in age-grade rugby because squads develop at different rates, and a scoreline often says more about that than about effort. Praising effort, decisions and the things a player controls is not a euphemism for avoiding standards — it is the part they can actually repeat next week. Be aware that your own reaction on the touchline is read by your player long before any conversation happens, and that adults who are visibly furious about a result teach something they usually did not intend to.'),

  ('supporting-contact-confidence', 'PARENT_GUIDE', 'SUPPORTING_YOUR_PLAYER', null, array['Nervous About Contact','Scared of Tackling','Contact Worry'], null,
   'Supporting a Player Who Is Nervous About Contact',
   'What actually helps when your player is worried about the physical side.',
   'Being apprehensive about contact is extremely common and is almost always about uncertainty rather than courage.',
   'Start by taking it seriously rather than reassuring it away. Most nervousness comes from not knowing what is about to happen, so understanding how contact is introduced in stages usually does more than encouragement does. Tell the coach — this is exactly the sort of thing a coach can plan around, quietly and without making it an event. Avoid comparisons with siblings or team-mates, and avoid making a public matter of it. Progress is rarely linear and a step backwards after a knock is normal. Do not push someone into contact to prove a point; confidence follows competence, and a player who is allowed to build it at the right pace generally arrives in a better place than one who was pushed. If the worry is really about getting hurt, the honest answer is that the sport is taught in stages for exactly that reason, and the club and the governing body''s own guidance set what is permitted at each age.'),

  -- ---------- WELFARE_AND_SAFETY ----------
  ('understanding-contact-rugby', 'PARENT_GUIDE', 'WELFARE_AND_SAFETY', null, array['Contact','Tackling','Is Rugby Safe'], null,
   'Understanding Contact Rugby as a Parent',
   'How contact is introduced, who decides, and what a parent should reasonably expect.',
   'Contact is the single biggest worry for families considering rugby, and it is the area where informal opinion is least reliable.',
   'The important thing to understand is that contact is not switched on all at once. Younger age groups play non-contact formats, and contact is introduced progressively, with what is permitted at each age set by the governing body rather than by an individual coach or club. Those age-grade rules are specific, they change as players move up, and they are published — the Rules section of this Hub carries them, and they are worth checking rather than assuming. Alongside that, what good practice looks like is technique before intensity, controlled before competitive, and supervision throughout. You are entitled to ask a club how contact is coached in your player''s age group and who is qualified to coach it. Ovalball does not set any of these rules, does not judge medical readiness, and is not the authority on safety — that sits with the governing bodies and with qualified people, and the Player Welfare section links to their own guidance.'),

  ('what-parents-should-know-about-concussion', 'PARENT_GUIDE', 'WELFARE_AND_SAFETY', null, array['Concussion','Head Injury','Head Knock'], null,
   'What Parents Should Know About Concussion',
   'Why it is taken seriously, what to expect from a club, and where the real guidance lives.',
   'Head injuries are the area where family judgement is most likely to be overruled by official process, and understanding why makes that far easier to accept.',
   'This page is deliberately not the guidance. The governing bodies publish their own recognition and return-to-play processes, they are specific, they differ between the codes, and the Player Welfare section of this Hub carries them with links to the source. What is useful for a parent to understand is the shape of it. A suspected head injury is treated as a head injury until assessed — the familiar phrasing is that if there is any doubt, the player comes off. That decision is not a judgement about toughness, and a player who is removed has not done anything wrong. Expect a club to act cautiously and expect a return to take longer than it feels like it should. The least helpful thing an adult can do is encourage someone to carry on or to play again sooner than the process allows. Anything involving symptoms, assessment, clearance or treatment belongs with qualified medical people, and Ovalball gives no medical advice of any kind.'),

  ('what-safeguarding-means-for-families', 'PARENT_GUIDE', 'WELFARE_AND_SAFETY', null, array['Safeguarding','Welfare Officer','Raising a Concern'], null,
   'What Safeguarding Means for Rugby Families',
   'What the word means in practice, who is responsible, and where a concern goes.',
   'Safeguarding is often treated as paperwork happening somewhere else, when it is really a description of what a club should feel like.',
   'In practice it means the club has people whose job is the welfare of young players, has expectations about how adults behave around them, and has a route for raising something that does not feel right. Your club will have a safeguarding or welfare officer, and knowing who that is before you need them is worth five minutes. You do not need to be certain before raising something — that judgement is not yours to make, and the people whose job it is would far rather hear a concern that turns out to be nothing. The Safeguarding section of this Hub carries the official guidance and the actual reporting routes, including the governing body and the NSPCC''s Child Protection in Sport Unit, and that is where to go rather than here. Ovalball is not a safeguarding authority and does not handle concerns.'),

  ('what-a-safe-rugby-club-looks-like', 'PARENT_GUIDE', 'WELFARE_AND_SAFETY', null, array['Safe Club','Good Club','What to Look For'], null,
   'What a Good Rugby Environment Looks Like',
   'What to notice about a club in the first few weeks.',
   'Most families choose a club by geography and never consciously assess it, yet the differences between clubs are real and visible early.',
   'Encouraging signs are mundane rather than dramatic. Sessions start roughly on time and have some structure. Coaches know the players'' names and talk to all of them rather than the best few. There is a named person for welfare and people know who it is. Adults are told what is happening and when. Questions get answered rather than deflected, and the club can say how it approaches contact, game time and coaching qualifications. Players who are less able are still involved, and the atmosphere on the touchline is supportive whatever the score. Things worth paying attention to are the reverse of those: a club that cannot say who its welfare officer is, adults who are dismissive of questions, or a culture where winning visibly matters more than whether young players are enjoying it. If you have a specific concern about conduct or safety, the Safeguarding section carries the routes for raising it.'),

  -- ---------- CLUB_CULTURE ----------
  ('supporting-from-the-touchline', 'PARENT_GUIDE', 'CLUB_CULTURE', null, array['Touchline','Sideline','Supporting','Shouting'], 6,
   'Supporting From the Touchline',
   'How to be genuinely useful on the sideline, and the specific habits worth avoiding.',
   'The touchline is the one place a parent''s behaviour directly affects the player, the team, the coach and the match official at the same time.',
   'The most useful adult on a touchline is loud in encouragement and quiet in instruction. Shouting tactical directions at your own player puts them between two voices — yours and the coach''s — at the exact moment they are trying to make a decision, and the usual result is that they stop making decisions at all. Encouragement for the whole team travels further than encouragement for one player, and it matters more than most parents realise to the players who are not yours. Criticising a player, an opponent or an official from the sideline is the one thing that reliably damages the afternoon for everyone. Age-grade officials are often volunteers and frequently young, and the Officiating section of this Hub covers the relationship between spectators and match officials properly. If something genuinely needs raising, the club is the route, after the game.'),

  ('talking-with-your-players-coach', 'PARENT_GUIDE', 'CLUB_CULTURE', null, array['Talking to the Coach','Coach Communication','Asking the Coach'], null,
   'Talking With Your Player''s Coach',
   'When to have a conversation, how to open it, and what makes coaches switch off.',
   'Most parent-coach friction is about timing and framing rather than the actual subject.',
   'Age-grade coaches are almost always volunteers doing this around a job. That is not a reason to avoid raising things, but it does shape how. The two worst moments are immediately before and immediately after a game — the first because they are organising, the second because everyone is emotional. Ask when would be a good time, and use the club''s normal channels rather than approaching mid-session. Open with a question rather than a conclusion: "what should they be working on?" gets a genuinely useful answer far more often than "why are they not playing there?". Expect a coach to talk about development rather than to justify a selection line by line. Where a conversation is really about your player''s own experience, it is often better for the player to have it themselves as they get older — that is part of the sport too. Coaching Knowledge sets out how coaches are encouraged to work, which makes those conversations easier to have.'),

  ('understanding-selection', 'PARENT_GUIDE', 'CLUB_CULTURE', null, array['Selection','Team Selection','Game Time','Playing Time'], null,
   'Understanding Selection and Playing Opportunities',
   'How selection and game time tend to work in age-grade rugby, and what varies.',
   'Selection is the most common source of upset in age-grade rugby and the area where assumptions differ most between families and clubs.',
   'There is no single rule. How much rugby each player gets varies by age group, by competition, by club philosophy and by how many players turn up, and it is legitimate for a club to have its own approach as long as it is clear about it. Broadly, younger age-grade rugby leans towards everyone playing a meaningful amount, and the balance shifts as age groups get older and more competitive — but where exactly that happens differs, and the governing bodies'' own age-grade rules are the authority on anything that is actually specified. The useful move is to ask the club what its approach is, early and before it becomes a grievance. Comparing your player''s minutes with another family''s is rarely informative, because you are seeing one variable out of many. If the pattern over a season genuinely looks wrong, that is a reasonable conversation to have calmly with the coach.'),

  ('when-your-player-is-not-selected', 'PARENT_GUIDE', 'CLUB_CULTURE', null, array['Not Selected','Dropped','Left Out'], null,
   'When Your Player Is Not Selected',
   'What helps in the day or two afterwards, and what to do if it keeps happening.',
   'How the adults respond to a non-selection teaches a young player more than the non-selection itself does.',
   'Deal with the disappointment before dealing with the reason. It is genuinely disappointing and saying so is better than explaining it away. Resist the urge to blame the coach in front of your player: it feels supportive and it tends to teach that setbacks are somebody else''s fault, which is not a useful habit to carry. Separate one decision from a verdict — age-grade selection reflects a moment, a squad and a fixture, and players develop at very different rates and times. If you want to understand it, ask what they should work on rather than why they were left out; you will get a better answer and your player gets something to do with it. If it becomes a season-long pattern with no explanation, that is worth raising properly with the club, calmly and away from match day.'),

  -- ---------- PATHWAYS_AND_OPPORTUNITIES ----------
  ('understanding-rugby-pathways', 'PARENT_GUIDE', 'PATHWAYS_AND_OPPORTUNITIES', null, array['Pathways','Representative Rugby','County Rugby'], null,
   'Understanding Rugby Pathways',
   'How the structures above club rugby broadly work, and how much they should matter to you.',
   'Pathway structures are widely misunderstood, vary between codes and regions, and change over time — which makes confident second-hand advice unusually unreliable.',
   'The broad shape is club and school rugby at the base, some form of representative or district rugby above that in many areas, and academy or development structures beyond it — but the names, ages, entry points and selection methods differ by code, by region and from season to season. Anything specific is best checked with your club or the governing body for your code rather than taken from another parent. Two things are worth holding on to. Entry into any of these at a young age is a snapshot of where someone is now, not a forecast, and the people running them will usually say so themselves. And the overwhelming majority of people who play rugby their whole lives, and enjoy it, never enter a pathway at all. Treating them as the point of age-grade rugby tends to make the experience worse for everybody, including the players who are in them.'),

  ('what-academy-selection-means', 'PARENT_GUIDE', 'PATHWAYS_AND_OPPORTUNITIES', null, array['Academy','Academy Selection','Going Pro'], null,
   'What Academy Selection Does and Does Not Mean',
   'A realistic reading of what being selected — or not — actually tells you.',
   'Families routinely read far more into academy selection than the structures themselves claim, in both directions.',
   'Being selected means a group of people thought a player was worth developing further at that point. It is not a contract, not a prediction, and not a guarantee of anything beyond the opportunity itself. Not being selected means considerably less than it feels like: selection at young ages is affected by when in the year someone was born, how early they matured physically, which school they attend and who happened to watch them, and people who work in development structures are generally the first to say so. Players enter these structures late, leave them and come back, and reach senior rugby without ever going near them. The practical advice is the dull kind: keep playing, keep enjoying it, keep developing broadly, and avoid reorganising a childhood around an outcome nobody can forecast. Ovalball holds no rating, ranking or potential score for any player and never will.'),

  ('positions-variety-and-development', 'PARENT_GUIDE', 'PATHWAYS_AND_OPPORTUNITIES', null, array['Positions','What Position','Specialising'], null,
   'Positions, Variety and Development',
   'Why "what position should they play?" is a better question later than it is now.',
   'Parents are often told early that their player is a particular shape of rugby player, and that label can stick for years.',
   'Rugby has an unusually wide range of roles, which is one of the reasons it suits so many different people. That also means early labelling is risky: bodies change enormously through the teenage years, and the position that suits a twelve-year-old often is not the one that suits them at eighteen. Playing in several positions builds understanding that is hard to acquire any other way, and coaches will often move players around deliberately for exactly that reason. If your player is moved, that is usually development rather than demotion, though it is a fair thing to ask about. Avoid pushing a specialism because of current size or speed, both of which are temporary. The Positions section explains what each role actually does, and Player Development covers why variety matters while someone is still growing.'),

  ('girls-and-womens-rugby', 'PARENT_GUIDE', 'PATHWAYS_AND_OPPORTUNITIES', null, array['Girls Rugby','Womens Rugby','Girls Teams'], null,
   'Girls'' and Women''s Rugby: What Families Should Know',
   'How the girls'' game is structured, and the specific points at which it differs.',
   'Girls'' rugby has real structural differences that families hit without warning, and finding out at the time is worse than knowing in advance.',
   'Younger age groups are commonly mixed, and at a defined point the girls'' game separates into its own structure. That transition point, and how the girls'' age groups are then banded, is set by the governing body and differs between Rugby Union and Rugby League — the Rules section of this Hub carries the current position for each code, and it is worth checking rather than assuming, because the banding is not simply single school years. The practical consequence for a family is that the group of players around your daughter can change at that point, and that some clubs run girls'' sections while others partner with neighbouring clubs. Ask early what your club does. Beyond the structure, everything else in this section applies exactly as it does to any other player, which is the point: the girls'' game is not a variant of the sport, it is the sport.'),

  -- ---------- PRACTICAL_RUGBY ----------
  ('understanding-rugby-costs', 'PARENT_GUIDE', 'PRACTICAL_RUGBY', null, array['Costs','Fees','Subs','How Much'], null,
   'Understanding the Costs Around Rugby',
   'Where money tends to go, and what to ask about before committing.',
   'Cost is one of the most common reasons families do not start a sport, and it is the question people are most reluctant to ask out loud.',
   'Clubs set their own fees, so no figure is meaningful across the country — what is useful is knowing the categories. Typically there is a club membership or subscription, some form of governing-body registration handled through the club, kit, and then travel to fixtures, which for some clubs is the largest item. Beyond that, festivals, tours and optional extras vary enormously and are usually genuinely optional. Ask the club directly what a season costs for this age group and what is included. It is also worth asking whether the club has arrangements for families who need them — many clubs run kit reuse, payment plans or hardship support and simply do not advertise it, and asking is normal. Nobody should be put off starting because of an assumption about cost that turns out to be wrong.'),

  ('rugby-festivals-and-tours', 'PARENT_GUIDE', 'PRACTICAL_RUGBY', null, array['Festivals','Tours','Tournaments','Away Trips'], null,
   'Rugby Festivals and Tours',
   'What these events involve and what to check before signing up.',
   'Festivals and tours are where families most often encounter arrangements they have not met before, including overnight supervision.',
   'A festival is usually a single day with many short games against several clubs, and it is often the most enjoyable rugby of the year. Tours involve travel and sometimes overnight stays. For either, the practical questions are the same: what is the schedule, what does it cost and what is included, what kit and food should you send, who is supervising and in what ratio, and what happens if someone is injured or unwell. For anything involving overnight stays, a club should be able to explain its supervision and safeguarding arrangements without being asked twice — and if you want to understand what good practice looks like, the Safeguarding section carries the official guidance. Expect more standing in fields than you have ever done. Expect your player to enjoy it more than any league fixture.'),

  ('getting-involved-as-a-volunteer', 'PARENT_GUIDE', 'PRACTICAL_RUGBY', null, array['Volunteering','Helping Out','Getting Involved'], null,
   'Getting Involved as a Rugby Volunteer',
   'The many ways to help that are not coaching, and what is involved if you want to coach.',
   'Age-grade rugby runs almost entirely on parent volunteers, and most people assume the only role is coaching.',
   'The roles clubs most need filled are usually small and unglamorous: running a water bottle, keeping score, managing a team''s communications, first aid, helping at the clubhouse, or organising a festival entry. Several of those take under an hour a week and clubs are often explicit that short, defined tasks are welcome. If you want to go further, both governing bodies run coaching and match-official qualifications starting at entry level, and clubs will usually point you at — and sometimes pay for — the first one. Match officiating in particular is where the shortage is most acute at age-grade level. Any role working with young players involves the club''s safeguarding process, including the relevant checks, which is exactly as it should be. You do not need to have played. A large proportion of age-grade coaches never did.')

  ;

  select id into v_start from public.hub_content_items where content_key = 'new-to-rugby-parents-start-here';
  select id into v_understand from public.hub_content_items where content_key = 'understanding-the-game-as-a-parent';
  select id into v_needs from public.hub_content_items where content_key = 'what-a-new-player-needs';
  select id into v_later from public.hub_content_items where content_key = 'starting-rugby-later';
  select id into v_training from public.hub_content_items where content_key = 'first-rugby-training-session';
  select id into v_matchday from public.hub_content_items where content_key = 'first-rugby-match-day';
  select id into v_aftergame from public.hub_content_items where content_key = 'talking-about-rugby-after-the-game';
  select id into v_difficult from public.hub_content_items where content_key = 'supporting-after-a-difficult-game';
  select id into v_winlose from public.hub_content_items where content_key = 'helping-with-winning-and-losing';
  select id into v_contactconf from public.hub_content_items where content_key = 'supporting-contact-confidence';
  select id into v_contact from public.hub_content_items where content_key = 'understanding-contact-rugby';
  select id into v_concussion from public.hub_content_items where content_key = 'what-parents-should-know-about-concussion';
  select id into v_safeguarding from public.hub_content_items where content_key = 'what-safeguarding-means-for-families';
  select id into v_safeclub from public.hub_content_items where content_key = 'what-a-safe-rugby-club-looks-like';
  select id into v_touchline from public.hub_content_items where content_key = 'supporting-from-the-touchline';
  select id into v_coachtalk from public.hub_content_items where content_key = 'talking-with-your-players-coach';
  select id into v_selection from public.hub_content_items where content_key = 'understanding-selection';
  select id into v_notselected from public.hub_content_items where content_key = 'when-your-player-is-not-selected';
  select id into v_pathways from public.hub_content_items where content_key = 'understanding-rugby-pathways';
  select id into v_academy from public.hub_content_items where content_key = 'what-academy-selection-means';
  select id into v_positions from public.hub_content_items where content_key = 'positions-variety-and-development';
  select id into v_girls from public.hub_content_items where content_key = 'girls-and-womens-rugby';
  select id into v_costs from public.hub_content_items where content_key = 'understanding-rugby-costs';
  select id into v_festivals from public.hub_content_items where content_key = 'rugby-festivals-and-tours';
  select id into v_volunteer from public.hub_content_items where content_key = 'getting-involved-as-a-volunteer';

  -- Every parent guide is code-universal: the questions an adult has are the
  -- same in both codes, and where the ANSWER differs the guide points at the
  -- regulatory layer rather than forking the prose.
  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items where content_type = 'PARENT_GUIDE';

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where content_type = 'PARENT_GUIDE';

  -- ============ Parent -> other Hub domains (hub_content_relationships) ============
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
  select v.src, t.id, 'RELATED_KNOWLEDGE'
  from (values
    -- Officiating: the touchline guide defers to the concept that already owns this.
    (v_touchline, 'parents-and-spectators'),
    (v_touchline, 'respect-the-referee'),
    (v_matchday, 'what-the-referee-does'),
    (v_matchday, 'parents-and-spectators'),
    (v_coachtalk, 'coaches-and-touchline-behaviour'),
    -- Game Knowledge: the gateway for a parent who cannot follow a game.
    (v_understand, 'the-objective-of-the-game'),
    (v_understand, 'how-a-game-flows'),
    (v_understand, 'the-breakdown-and-ruck'),
    (v_understand, 'the-scrum-and-lineout-in-play'),
    (v_understand, 'the-play-the-ball'),
    (v_understand, 'tackle-count-and-set-restarts'),
    (v_understand, 'how-scoring-works'),
    (v_matchday, 'how-play-restarts'),
    (v_start, 'the-objective-of-the-game'),
    -- Player Development: the player's own side of what a parent is supporting.
    (v_contactconf, 'contact-confidence'),
    (v_contact, 'moving-through-age-grade-rugby'),
    (v_difficult, 'learning-from-mistakes'),
    (v_aftergame, 'learning-from-mistakes'),
    (v_winlose, 'confidence-and-composure'),
    (v_later, 'learning-the-basics'),
    (v_positions, 'trying-different-positions'),
    (v_academy, 'progressive-physical-development'),
    (v_matchday, 'preparing-for-match-day'),
    (v_training, 'training-habits'),
    -- Coaching Knowledge: what the coach is trying to do, so a parent can support it.
    (v_coachtalk, 'player-centred-coaching'),
    (v_coachtalk, 'giving-effective-feedback'),
    (v_touchline, 'creating-a-positive-learning-environment'),
    (v_training, 'planning-a-simple-session'),
    (v_training, 'what-good-coaching-looks-like'),
    (v_selection, 'coaching-mixed-ability-groups'),
    (v_contactconf, 'helping-players-build-contact-confidence'),
    (v_contact, 'coaching-contact-safely'),
    (v_safeclub, 'creating-a-positive-learning-environment'),
    (v_later, 'including-players-who-start-later'),
    (v_volunteer, 'coaching-players-new-to-rugby'),
    -- Parent -> Parent: the internal spine.
    (v_start, 'what-a-new-player-needs'),
    (v_start, 'understanding-the-game-as-a-parent'),
    (v_start, 'first-rugby-training-session'),
    (v_understand, 'first-rugby-match-day'),
    (v_matchday, 'supporting-from-the-touchline'),
    (v_touchline, 'talking-about-rugby-after-the-game'),
    (v_aftergame, 'supporting-after-a-difficult-game'),
    (v_difficult, 'helping-with-winning-and-losing'),
    (v_contact, 'supporting-contact-confidence'),
    (v_contact, 'what-parents-should-know-about-concussion'),
    (v_safeguarding, 'what-a-safe-rugby-club-looks-like'),
    (v_selection, 'when-your-player-is-not-selected'),
    (v_notselected, 'talking-with-your-players-coach'),
    (v_pathways, 'what-academy-selection-means'),
    (v_academy, 'positions-variety-and-development'),
    (v_girls, 'understanding-rugby-pathways'),
    (v_costs, 'rugby-festivals-and-tours'),
    (v_festivals, 'getting-involved-as-a-volunteer'),
    (v_needs, 'first-rugby-training-session')
  ) as v(src, target_key)
  join public.hub_content_items t on t.content_key = v.target_key and t.status = 'PUBLISHED';

  -- ============ Parent -> Skill (existing generic junction) ============
  insert into public.hub_skill_content_links (skill_id, content_item_id)
  select s.id, v.content_item_id
  from (values
    (v_contact, 'tackling-technique'),
    (v_contactconf, 'tackling-technique'),
    (v_understand, 'passing-under-pressure'),
    (v_positions, 'running-and-evasion')
  ) as v(content_item_id, skill_key)
  join public.hub_skills s on s.skill_key = v.skill_key and s.status = 'PUBLISHED';

  -- ============ Parent -> Glossary (existing generic junction) ============
  -- Terminology is a new parent's biggest barrier, so the two gateway guides
  -- link straight into the canonical definitions rather than paraphrasing them.
  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id)
  select g.id, v.content_item_id
  from (values
    (v_understand, 'ruck'), (v_understand, 'maul'), (v_understand, 'lineout'),
    (v_understand, 'play-the-ball'), (v_understand, 'tackle-count'), (v_understand, 'knock-on'),
    (v_understand, 'forward-pass'), (v_understand, 'try'), (v_understand, 'conversion'),
    (v_understand, 'advantage'), (v_understand, 'territory'), (v_understand, 'breakdown'),
    (v_matchday, 'sin-bin'), (v_matchday, 'touch-judge'), (v_matchday, 'penalty'),
    (v_start, 'try'), (v_contact, 'breakdown'), (v_contact, 'play-the-ball')
  ) as v(content_item_id, term_key)
  join public.hub_glossary_terms g on g.term_key = v.term_key and g.status = 'PUBLISHED';

  -- ============ Parent -> Position (existing generic junction) ============
  insert into public.hub_content_item_positions (content_item_id, position_id)
  select v.content_item_id, p.id
  from (values
    (v_positions, 'union-fly-half'), (v_positions, 'union-fullback'),
    (v_positions, 'league-halfback'), (v_positions, 'league-fullback')
  ) as v(content_item_id, position_key)
  join public.hub_positions p on p.position_key = v.position_key and p.status = 'PUBLISHED';

  -- ============ Parent -> Law (existing generic mechanism) ============
  -- Parents guides never state the Law. They point at the governing body's
  -- own verified wording, which is what a family should actually check.
  insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
  select f.id, v.src, 'RULE_EXPLANATION'
  from (values
    (v_contact, 'RFU-REG15-2026-CONTACT-PERMITTED-U9-PLUS'),
    (v_contact, 'RFU-REG15-APP-U9-CONTACT'),
    (v_contactconf, 'RFU-REG15-2026-ADULTS-NOT-IN-CONTACT-TRAINING'),
    (v_girls, 'RFU-REG15-2026-MIXED-RUGBY-ENDS-AT-U12'),
    (v_girls, 'RFU-REG15-2026-GIRLS-DUAL-AGE-BANDS'),
    (v_girls, 'RFL-CGOR-2026-MIXED-TO-U11')
  ) as v(src, fact_key)
  join public.regulatory_facts f on f.fact_key = v.fact_key and f.status = 'VERIFIED';

  -- ============ Sources ============
  insert into public.hub_content_sources (content_item_id, source_tier, source_title, source_url, retrieved_on)
  values
    (v_start, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_understand, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_needs, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_later, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_training, 'GOVERNING_BODY', 'World Rugby Passport: Creating a positive learning environment', 'https://passport.world.rugby/coaching/coaching-children/coaching-children-the-basics/creating-a-positive-learning-environment/', current_date),
    (v_matchday, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_aftergame, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_difficult, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_winlose, 'GOVERNING_BODY', 'RFU: Code of Conduct for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/code-conduct', current_date),
    (v_contactconf, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_contact, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_concussion, 'GOVERNING_BODY', 'World Rugby: Concussion guidance and player welfare', 'https://www.world.rugby/the-game/player-welfare/', current_date),
    (v_concussion, 'GOVERNING_BODY', 'RFU: Age Grade contact training, match load and recovery guidance', 'https://www.englandrugby.com/run/coaching/coach-resources/contact-guidance', current_date),
    (v_safeguarding, 'SAFEGUARDING_AUTHORITY', 'NSPCC: Keeping children safe in sport — a guide for parents and carers', 'https://www.nspcc.org.uk/keeping-children-safe/outside-the-home/sports-clubs/', current_date),
    (v_safeguarding, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit', 'https://sport.nspcc.org.uk/', current_date),
    (v_safeclub, 'SAFEGUARDING_AUTHORITY', 'NSPCC: Keeping children safe in sport — a guide for parents and carers', 'https://www.nspcc.org.uk/keeping-children-safe/outside-the-home/sports-clubs/', current_date),
    (v_safeclub, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_touchline, 'GOVERNING_BODY', 'RFU: Code of Conduct for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/code-conduct', current_date),
    (v_touchline, 'GOVERNING_BODY', 'Rugby Football League: Engaging with parents and the RESPECT programme', 'https://www.rugby-league.com/how-to-engage-with-parents', current_date),
    (v_coachtalk, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_coachtalk, 'GOVERNING_BODY', 'Rugby Football League: Engaging with parents and the RESPECT programme', 'https://www.rugby-league.com/how-to-engage-with-parents', current_date),
    (v_selection, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_notselected, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_pathways, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_academy, 'GOVERNING_BODY', 'World Rugby Passport: Long term athlete development (LTAD)', 'https://passport.world.rugby/conditioning-for-rugby/introduction-to-conditioning-youth/long-term-athlete-development/', current_date),
    (v_positions, 'GOVERNING_BODY', 'World Rugby Passport: Long Term Player Development', 'https://passport.world.rugby/injury-prevention-and-risk-management/rugby-ready/long-term-player-development/', current_date),
    (v_girls, 'GOVERNING_BODY', 'RFU Regulation 15 — Age Grade Rugby', 'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby', current_date),
    (v_girls, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_costs, 'GOVERNING_BODY', 'RFU: Age Grade Rugby Overview for parents and guardians', 'https://www.englandrugby.com/play/parents-guardians/age-grade-rugby-overview', current_date),
    (v_festivals, 'SAFEGUARDING_AUTHORITY', 'NSPCC Child Protection in Sport Unit: Parents in sport', 'https://sport.nspcc.org.uk/help-advice/topics/parents-in-sport/', current_date),
    (v_volunteer, 'GOVERNING_BODY', 'Rugby Football League: Engaging with parents and the RESPECT programme', 'https://www.rugby-league.com/how-to-engage-with-parents', current_date),
    (v_volunteer, 'GOVERNING_BODY', 'RFU: Coaching courses and coach resources', 'https://www.englandrugby.com/run/coaching', current_date);

end $$;
