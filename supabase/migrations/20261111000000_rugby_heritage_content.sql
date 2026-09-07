-- The Rugby Hub heritage content: both codes, from folk football to 2025.
--
-- EDITORIAL RULES APPLIED THROUGHOUT
--
-- 1. Everything before 1895 is marked 'pre_schism', not 'union'. The shared
--    history belongs to both codes equally. Writing rugby league's story as
--    though it begins in 1895 is the commonest error in rugby history, and it
--    quietly frames league as a departure from a norm rather than one of two
--    inheritors of the same game.
--
-- 2. Nothing is stated more confidently than the evidence allows. The Webb
--    Ellis story is recorded as MYTH, the causes of the 1895 split as
--    CONTESTED. The schema forces a certainty_note onto both.
--
-- 3. Every entry carries at least one source, and no source text is
--    reproduced -- these summaries are written from the research, not copied
--    from it.
--
-- 4. The unflattering parts are included. A heritage section that records the
--    Challenge Cup but not the RFU's ban on anyone who had played league, or
--    the exclusion that sent Black Welsh players north, is marketing rather
--    than history.

-- ============================================================
-- ERAS
-- ============================================================

insert into public.heritage_eras (era_key, title, code_scope, starts_year, ends_year, summary, sort_order) values
('ORIGINS', 'Before the codes', 'pre_schism', 1500, 1870,
 'Centuries of unwritten folk football, narrowed in the early 1800s into the distinctive handling game played at Rugby School, and written down there in 1845 as the first laws any code of football ever had.', 1),
('CODIFICATION', 'Codification and the first union', 'pre_schism', 1863, 1894,
 'Rugby separates from association football, acquires a governing body and an international fixture list, and settles into fifteen a side -- while a growing northern, working-class playing base runs into a governing class committed to strict amateurism.', 2),
('SCHISM', 'The Great Schism', 'both', 1893, 1895,
 'The argument over paying players for work missed splits the sport permanently. Both codes date from this moment: one continues as the Rugby Football Union, the other begins as the Northern Union.', 3),
('DIVERGENCE', 'Two games diverge', 'league', 1895, 1922,
 'The Northern Union changes the rules rather than just the finances -- thirteen a side, the play-the-ball, no lineout -- and becomes a genuinely different sport, then exports itself to New Zealand and Australia.', 4),
('AMATEUR_CENTURY', 'The amateur century', 'union', 1895, 1994,
 'Union holds the amateur line for a hundred years, expanding worldwide while policing its own boundary against league with a severity that shaped careers and communities.', 5),
('LEAGUE_HEARTLAND', 'The professional heartland', 'league', 1922, 1995,
 'Rugby league consolidates as a professional winter game rooted in northern England, Australia and New Zealand, inventing the modern World Cup along the way.', 6),
('OPEN_ERA', 'The open era', 'both', 1995, null,
 'Union goes professional a century after expelling those who wanted the same, league moves to summer and Super League, and the boundary between the codes stops being a moral one.', 7),
('WOMENS_GAME', 'The women''s game', 'both', 1891, null,
 'Played, discouraged, banned in places, and rebuilt from the 1970s onward into the fastest-growing part of both codes -- culminating in a world-record crowd at Twickenham in 2025.', 8)
on conflict (era_key) do nothing;

-- ============================================================
-- ENTRIES
-- ============================================================

with era as (select era_key, id from public.heritage_eras)
insert into public.heritage_entries
  (entry_key, era_id, entry_type, code_scope, title, happened_year, happened_on, ends_year, summary, detail, certainty, certainty_note, significance, people, places, tags)
select v.entry_key, era.id, v.entry_type, v.code_scope, v.title, v.happened_year, v.happened_on, v.ends_year,
       v.summary, v.detail, v.certainty, v.certainty_note, v.significance,
       -- The array columns arrive as text literals from the VALUES list (a
       -- VALUES row types '{}' as text, not text[]), so cast them here rather
       -- than sprinkling ::text[] through every one of the rows below.
       v.people::text[], v.places::text[], v.tags::text[]
from (values

-- ---------- ORIGINS ----------
('FOLK-FOOTBALL', 'ORIGINS', 'ORIGIN', 'pre_schism',
 'Folk football before the rules', 1500, null::date, 1800,
 'Long before anyone wrote a rule down, versions of football were played across Britain at festivals and holidays -- large, loosely organised, and varying from town to town.',
 'These games had no fixed team size, no fixed pitch and no written laws; what counted as fair play was local custom. Handling the ball was normal in many of them. This matters for what came later: rugby did not invent carrying the ball, it was one of the traditions that kept it when others gave it up.',
 'WELL_DOCUMENTED', null, 2, '{}', '{"Britain"}', '{"origins"}'),

('RUGBY-SCHOOL-GAME', 'ORIGINS', 'ORIGIN', 'pre_schism',
 'The game at Rugby School', 1800, null, 1845,
 'By the early nineteenth century Rugby School in Warwickshire was playing a distinctive handling-and-running form of football that pupils carried with them to universities and clubs.',
 'The school''s version spread because of who played it. Old boys took it to Oxford and Cambridge and then into adult clubs, which is why one school''s local variant became a national game and gave the sport its name.',
 'WELL_DOCUMENTED', null, 3, '{}', '{"Rugby School","Warwickshire"}', '{"origins"}'),

('WEBB-ELLIS-1823', 'ORIGINS', 'ORIGIN', 'pre_schism',
 'William Webb Ellis picks up the ball', 1823, null, null,
 'The sport''s founding story: that a Rugby School pupil named William Webb Ellis, "with a fine disregard for the rules of football as played in his time", caught the ball and ran with it, inventing rugby.',
 'The story is celebrated everywhere -- the Rugby World Cup trophy is the Webb Ellis Cup -- and there is no good evidence for it. It rests on a recollection published decades afterwards by Matthew Bloxam, who was not present, and was examined by the Old Rugbeian Society in the 1890s in an inquiry that produced its report in 1897, long after any eyewitness could be questioned. The 1845 laws written at the school itself do not mention Webb Ellis. Handling was already part of several football traditions, so there was no single moment to invent. The honest answer to "who invented rugby?" is that nobody did.',
 'MYTH',
 'Widely believed and not supported by evidence. The account is second-hand, first appears more than fifty years after the supposed event, and describes an innovation -- handling the ball -- that was already common in the folk football of the period. Ovalball records it because it is a real and important part of rugby culture, not because it happened. Never present it as fact.',
 5, '{"William Webb Ellis","Matthew Bloxam"}', '{"Rugby School"}', '{"origins","myth","webb-ellis"}'),

('LAWS-1845', 'ORIGINS', 'RULE_CHANGE', 'pre_schism',
 'The first written laws of football', 1845, null, null,
 'Three Rugby School pupils wrote down the rules of their game -- the first published laws of any code of football anywhere.',
 'The committee was William Delafield Arnold, W. W. Shirley and Frederick Hutchins, and the document was the "Laws of Football as Played At Rugby School". It predates the Football Association''s laws by eighteen years. This, not 1823, is the moment rugby becomes a defined game rather than a local custom -- and it belongs to both modern codes equally.',
 'ESTABLISHED', null, 5, '{"William Delafield Arnold","W. W. Shirley","Frederick Hutchins"}', '{"Rugby School"}', '{"origins","laws","first"}'),

-- ---------- CODIFICATION ----------
('FA-SPLIT-1863', 'CODIFICATION', 'SCHISM', 'pre_schism',
 'Rugby and association football separate', 1863, null, null,
 'At the meetings that created the Football Association, the clubs that wanted to keep handling and hacking withdrew -- and football divided into two families of game.',
 'Blackheath''s representative withdrew rather than accept the ban on hacking (kicking an opponent''s shins) and on running with the ball in hand. The disagreement produced association football on one side and rugby football on the other. Hacking itself was abolished by the rugby clubs soon afterwards, which is worth noting: the thing they split over, they then dropped anyway.',
 'ESTABLISHED', null, 4, '{}', '{"London","Blackheath"}', '{"origins","schism"}'),

('RFU-FOUNDED-1871', 'CODIFICATION', 'GOVERNANCE', 'pre_schism',
 'The Rugby Football Union is founded', 1871, date '1871-01-26', null,
 'Representatives of around twenty-one clubs met at the Pall Mall Restaurant in London and formed the Rugby Football Union, giving the game a single governing body and one set of laws.',
 'Accounts put the meeting at roughly 32 men from 21 clubs. Its first task was to replace the competing club interpretations of the Rugby School laws with one agreed code. Every club in England today, in both codes, descends from the game this meeting standardised.',
 'ESTABLISHED', null, 5, '{}', '{"Pall Mall Restaurant","London"}', '{"governance","rfu","first"}'),

('FIRST-INTERNATIONAL-1871', 'CODIFICATION', 'MATCH', 'pre_schism',
 'The first rugby international', 1871, date '1871-03-27', null,
 'Scotland beat England at Raeburn Place in Edinburgh in front of about 4,000 people -- the first international rugby match ever played.',
 'Scotland won by two tries and a goal to England''s single try, under scoring conventions quite unlike the modern ones. It was played twenty a side. The fixture is the direct ancestor of the Six Nations, the oldest international rivalry in the sport.',
 'ESTABLISHED', null, 4, '{}', '{"Raeburn Place","Edinburgh"}', '{"international","first","match"}'),

('FIFTEEN-A-SIDE-1877', 'CODIFICATION', 'RULE_CHANGE', 'pre_schism',
 'Fifteen a side', 1877, null, null,
 'Rugby reduced from twenty players a side to fifteen, the number union still uses.',
 'Twenty a side produced a congested game dominated by forward play. Cutting to fifteen opened space for the backs and is the first of the many changes both codes would make in pursuit of a better spectacle -- the same motive that drove the Northern Union to thirteen thirty years later.',
 'ESTABLISHED', null, 3, '{}', '{}', '{"laws"}'),

('AMATEURISM-BAN-1886', 'CODIFICATION', 'SOCIAL', 'pre_schism',
 'The RFU bans payment to players', 1886, null, null,
 'The RFU adopted strict amateur regulations forbidding any payment to players -- the rule that would break the sport in two nine years later.',
 'The ban''s stated purpose was to keep the game amateur. Its practical effect fell hardest on the working-class clubs of Lancashire and Yorkshire, whose players lost wages when they played on a Saturday, while it cost independently wealthy players nothing. Historians differ on how far this was deliberate social control, but the asymmetry itself is not in doubt.',
 'ESTABLISHED', null, 4, '{}', '{"England"}', '{"amateurism","class","schism"}'),

-- ---------- SCHISM ----------
('BROKEN-TIME-1893', 'SCHISM', 'GOVERNANCE', 'pre_schism',
 'The broken-time proposal is voted down', 1893, null, null,
 'Yorkshire clubs proposed that players be compensated six shillings for work missed while playing. The RFU rejected it.',
 'This was not a proposal to pay players to play. It was a proposal to reimburse them for wages actually lost -- "broken time". Its rejection left northern clubs with an unworkable choice between fielding weakened sides and breaking the rules, and made a split close to inevitable.',
 'ESTABLISHED', null, 5, '{}', '{"Yorkshire"}', '{"schism","broken-time","class"}'),

('GREAT-SCHISM-1895', 'SCHISM', 'SCHISM', 'both',
 'The Great Schism: the Northern Union is formed', 1895, date '1895-08-29', null,
 'Leading Lancashire and Yorkshire clubs met at the George Hotel in Huddersfield and voted to leave the RFU and form the Northern Rugby Football Union, permitting broken-time payments.',
 'Around twenty-one clubs resigned and formed the new body that night; sources differ slightly on whether twenty-one or twenty-two were in the room. It is the single most consequential date in rugby history and it is the birthday of BOTH modern codes -- not just rugby league. Union''s hundred-year commitment to amateurism was defined by this split as much as league''s professionalism was. The George Hotel still stands and is treated as the birthplace of rugby league.',
 'ESTABLISHED', null, 5, '{}', '{"George Hotel","Huddersfield"}', '{"schism","1895","league","founding"}'),

('SCHISM-CAUSES', 'SCHISM', 'SOCIAL', 'both',
 'Why the split really happened', 1895, null, null,
 'The 1895 split is explained as a dispute about money, as a class conflict, and as a north/south conflict -- and historians genuinely differ about which mattered most.',
 'The narrow account is accurate as far as it goes: the argument was about broken-time payments. The broader accounts argue that amateurism functioned as a way of keeping control of the sport in the hands of those who could afford to play for nothing, and that the geography of the split -- industrial Lancashire and Yorkshire against a southern and university-based establishment -- is not a coincidence. These readings are not mutually exclusive, and the disagreement is about emphasis rather than facts.',
 'CONTESTED',
 'Historians agree on what happened and differ on why. Present the broken-time dispute as the documented trigger and the class and regional dimensions as widely argued interpretation -- never assert a single motive as settled.',
 4, '{}', '{"Lancashire","Yorkshire"}', '{"schism","class","contested"}'),

('RFU-LEAGUE-BAN', 'AMATEUR_CENTURY', 'SOCIAL', 'union',
 'The ban on anyone who played league', 1895, null, 1995,
 'For a century, playing rugby league -- even as an amateur -- made a player permanently ineligible for rugby union.',
 'A player who went north was deemed to have professionalised themselves and was excluded from union, in some unions for life. The ban reached beyond professionals to amateurs and, in places, to coaches and referees. It ended only when union itself turned professional in 1995 and the rule lost any basis it had. It is a substantial part of why the two codes'' communities stayed separate for so long, and it shaped individual lives: players who changed code often could not go home to their old club again.',
 'ESTABLISHED', null, 4, '{}', '{"England","Wales"}', '{"amateurism","class","social","schism"}'),

-- ---------- DIVERGENCE (LEAGUE) ----------
('CHALLENGE-CUP-1897', 'DIVERGENCE', 'COMPETITION', 'league',
 'The Challenge Cup begins', 1897, null, null,
 'The Northern Union launched its knockout cup, won in its first final by Batley -- the oldest cup competition in either code of rugby.',
 'Fifty-two clubs entered the inaugural competition, played over six rounds in the spring of 1897. It has run ever since and remains rugby league''s most storied trophy; from 1929 its final became a Wembley occasion and one of the few fixtures to make the northern game a national event.',
 'ESTABLISHED', null, 4, '{"Batley"}', '{"England"}', '{"competition","challenge-cup","first"}'),

('THIRTEEN-A-SIDE-1906', 'DIVERGENCE', 'RULE_CHANGE', 'league',
 'Thirteen a side', 1906, null, null,
 'Meeting again at the George Hotel, Northern Union clubs voted to drop from fifteen players to thirteen -- the change that made league a visibly different sport.',
 'The motion came from Warrington, seconded by Leigh, and passed by 43 votes to 18. Two arguments carried it: a more open, faster game would draw better crowds, and two fewer players would save clubs around £100 a year in wages. Both motives are recorded openly, which is itself characteristic -- league changed its rules for spectators and for solvency, and said so.',
 'ESTABLISHED', null, 5, '{"Warrington","Leigh"}', '{"George Hotel","Huddersfield"}', '{"laws","league","1906"}'),

('PLAY-THE-BALL-1906', 'DIVERGENCE', 'RULE_CHANGE', 'league',
 'The play-the-ball replaces the ruck', 1906, null, null,
 'In the same set of changes, the Northern Union replaced the scrum-after-every-tackle with the play-the-ball, ending the contest for possession on the ground.',
 'This is the deepest structural difference between the codes. Union keeps a contest at the breakdown; league restarts play with the tackled player. Everything that follows from it -- the tackle count, the defensive line, the shape of league as a game of field position -- descends from this decision. Scoring rose immediately: a reported 800 points in the first fortnight of the 1906-07 season.',
 'ESTABLISHED', null, 5, '{}', '{"England"}', '{"laws","league","play-the-ball"}'),

('ALL-GOLDS-1907', 'DIVERGENCE', 'MILESTONE', 'league',
 'The All Golds take the game south', 1907, null, 1908,
 'A professional New Zealand side toured northern England and Australia, carrying the new code to the southern hemisphere.',
 'They were nicknamed the "All Golds" in the New Zealand press, in a dispute over whether it was honourable for a professional team of "All Blacks" to be paid. The tour seeded rugby league in New Zealand and Australia, where it would become one of the dominant winter sports -- and where the balance of power in the international game eventually settled.',
 'ESTABLISHED', null, 4, '{}', '{"New Zealand","Australia","England"}', '{"league","tour","international"}'),

('NAME-RUGBY-LEAGUE-1922', 'LEAGUE_HEARTLAND', 'GOVERNANCE', 'league',
 'The Northern Union becomes the Rugby Football League', 1922, null, null,
 'The governing body adopted the name it still carries, and the sport became "rugby league" rather than "the Northern Union game".',
 'The change followed the name already in use in Australia and New Zealand. It marks the point at which the code stops defining itself as a regional breakaway and starts presenting itself as a sport in its own right.',
 'ESTABLISHED', null, 3, '{}', '{"England"}', '{"governance","league","naming"}'),

('RLWC-1954', 'LEAGUE_HEARTLAND', 'COMPETITION', 'league',
 'The first Rugby League World Cup', 1954, date '1954-11-13', null,
 'France hosted and Great Britain won the first World Cup in either code of rugby, beating France 16-12 at the Parc des Princes.',
 'A crowd of 30,368 watched the final. France had pushed hardest for the tournament to happen. It is worth stating plainly because it is so often got wrong: rugby league had a World Cup thirty-three years before rugby union, and at the time it was known simply as the Rugby World Cup.',
 'ESTABLISHED', null, 5, '{}', '{"Parc des Princes","Paris","France"}', '{"competition","world-cup","league","first"}'),

('LIMITED-TACKLES', 'LEAGUE_HEARTLAND', 'RULE_CHANGE', 'league',
 'The tackle count arrives', 1966, null, 1972,
 'League introduced a limit on consecutive tackles before possession changes hands -- four from 1966, six from 1972.',
 'Before this a side could in principle hold the ball indefinitely. The limited-tackle rule created the six-tackle set that structures every modern league match, and with it the kick on the last tackle. It is the clearest example of league''s willingness to change fundamental structure in pursuit of a better game.',
 'ESTABLISHED', null, 4, '{}', '{}', '{"laws","league","tackle-count"}'),

('SUPER-LEAGUE-1996', 'OPEN_ERA', 'COMPETITION', 'league',
 'Super League and the move to summer', 1996, null, null,
 'British rugby league replaced its century-old winter championship with a summer competition, Super League, fully professional and television-funded.',
 'The championship it replaced had run continuously since 1895. Moving to summer was the larger change: better pitches, faster rugby, and a direct alignment with the Australian season. It arrived within months of union going professional, and the two events together ended the era in which the codes could be told apart by whether players were paid.',
 'ESTABLISHED', null, 4, '{}', '{"England"}', '{"competition","league","professional","super-league"}'),

('BILLY-BOSTON', 'OPEN_ERA', 'PERSON', 'league',
 'Sir Billy Boston', 1934, null, 2025,
 'The Cardiff-born Wigan wing who became one of rugby league''s greatest try-scorers, and in 2025 the first person knighted for services to the sport in its 130-year history.',
 'Boston came from Tiger Bay in Cardiff and went north to Wigan, a route taken by many Black Welsh players who found representative rugby union effectively closed to them. He became one of the most prolific wingers the game has produced. His knighthood in 2025, and his death later that year aged 92, prompted a wider reckoning with how long rugby league''s achievements went unhonoured relative to union''s -- and with why players like him had to leave Wales to be recognised at all.',
 'ESTABLISHED', null, 4, '{"Billy Boston"}', '{"Cardiff","Wigan","Tiger Bay"}', '{"person","league","race","wigan"}'),

-- ---------- UNION ----------
('BARBARIANS-TRY-1973', 'AMATEUR_CENTURY', 'MATCH', 'union',
 'The greatest try ever scored', 1973, null, null,
 'The Barbarians beat New Zealand 23-11 in Cardiff, opening with a try that began behind their own line and is still routinely called the finest in the sport.',
 'Phil Bennett started it with a series of sidesteps deep in his own 25, the ball travelled through several pairs of hands -- Pullin, Dawes, David, Quinnell -- and Gareth Edwards finished it in the corner, all inside about twenty-two seconds. Cliff Morgan''s live commentary is as celebrated as the try. It is the clearest single argument for what union''s continuous, contested game can produce.',
 'ESTABLISHED', null, 5, '{"Gareth Edwards","Phil Bennett","Cliff Morgan","John Dawes","Derek Quinnell","Tommy David","John Pullin"}', '{"Cardiff Arms Park","Cardiff"}', '{"match","union","barbarians","try"}'),

('RWC-1987', 'AMATEUR_CENTURY', 'COMPETITION', 'union',
 'The first Rugby World Cup', 1987, null, null,
 'Union staged its first World Cup, co-hosted by New Zealand and Australia and won by New Zealand -- thirty-three years after league''s.',
 'The tournament had been resisted for years by those who feared, correctly, that it would make the game commercially valuable and amateurism unsustainable. Within eight years union was professional. The 1987 World Cup is the hinge on which that century turned.',
 'ESTABLISHED', null, 4, '{}', '{"New Zealand","Australia"}', '{"competition","world-cup","union","first"}'),

('RWC-1995-MANDELA', 'AMATEUR_CENTURY', 'MATCH', 'union',
 'South Africa 1995', 1995, null, null,
 'South Africa won the World Cup on home soil in its first tournament after the end of apartheid, with Nelson Mandela presenting the trophy wearing the Springbok jersey.',
 'The Springbok had been a symbol of white South Africa and of the sporting boycott. Mandela wearing it to hand the cup to Francois Pienaar became one of the most reproduced images in sport. It is also the last major event of union''s amateur era -- the game was declared open two months later.',
 'ESTABLISHED', null, 5, '{"Nelson Mandela","Francois Pienaar"}', '{"Ellis Park","Johannesburg","South Africa"}', '{"match","world-cup","union","social"}'),

('PROFESSIONALISM-1995', 'OPEN_ERA', 'GOVERNANCE', 'union',
 'Rugby union declared an open game', 1995, date '1995-08-26', null,
 'After three days of meetings in Paris, the International Rugby Football Board declared union "an open game", ending 109 years of enforced amateurism.',
 'The decision came almost exactly one hundred years after the Great Schism, and conceded in a sentence the argument the RFU had refused in 1893 and split the sport over in 1895. Everything the northern clubs were expelled for wanting became the governing body''s own policy. It is impossible to tell either code''s story honestly without this symmetry.',
 'ESTABLISHED', null, 5, '{}', '{"Paris"}', '{"governance","union","professional","1995"}'),

('ENGLAND-2003', 'OPEN_ERA', 'MATCH', 'union',
 'England win the World Cup', 2003, null, null,
 'England beat Australia 20-17 in extra time in Sydney, with a Jonny Wilkinson drop goal in the final seconds -- the first northern-hemisphere side to win the tournament.',
 'There were about 26 seconds left when Wilkinson, a left-footed kicker, dropped the goal with his right. Martin Johnson captained the side. It remains the high point of English union and the moment most often cited by people who took up the game in England in the years afterwards.',
 'ESTABLISHED', null, 5, '{"Jonny Wilkinson","Martin Johnson"}', '{"Sydney","Australia"}', '{"match","world-cup","union","england"}'),

-- ---------- WOMEN'S GAME ----------
('WOMENS-FIRST-INTERNATIONAL-1982', 'WOMENS_GAME', 'MATCH', 'both',
 'The first women''s international', 1982, date '1982-06-13', null,
 'France played the Netherlands in Utrecht in the first women''s international rugby match.',
 'Women had played rugby for far longer -- there are records reaching back into the nineteenth century -- but organised international competition begins here. It took another nine years to reach a World Cup, and that one had to be staged without the governing body''s approval.',
 'ESTABLISHED', null, 4, '{}', '{"Utrecht","Netherlands","France"}', '{"womens","international","first"}'),

('WRWC-1991', 'WOMENS_GAME', 'COMPETITION', 'both',
 'The first Women''s Rugby World Cup', 1991, null, null,
 'The inaugural Women''s Rugby World Cup was held in Wales in April 1991 and won by the United States, who beat England in the final. The governing body had not approved it.',
 'The organisers went ahead without International Rugby Board sanction, and the players largely funded themselves. The USA won 19-6. That the tournament happened at all, against the wishes of the body that ran the sport, is the point of the story -- the women''s game''s early institutional history is one of proceeding without permission.',
 'WELL_DOCUMENTED', null, 5, '{}', '{"Wales"}', '{"womens","world-cup","first"}'),

('WRWC-2014-ENGLAND', 'WOMENS_GAME', 'MATCH', 'both',
 'England win the 2014 World Cup', 2014, date '2014-08-17', null,
 'England beat Canada 21-9 in the final, ending twenty years without the title after losing three finals in a row to New Zealand.',
 'England had last won in 1994 and then lost the 2002, 2006 and 2010 finals, all to New Zealand. The 2014 win is the moment the modern English women''s programme is usually dated from.',
 'ESTABLISHED', null, 4, '{}', '{"France"}', '{"womens","world-cup","england","match"}'),

('WRWC-2025-ENGLAND', 'WOMENS_GAME', 'MATCH', 'both',
 'A world-record crowd at Twickenham', 2025, date '2025-09-27', null,
 'England won the 2025 World Cup on home soil, beating Canada 33-13 at Twickenham in front of 81,885 people -- a world record attendance for any women''s rugby match.',
 'The tournament ran from 22 August to 27 September 2025, opening at the Stadium of Light. The final''s crowd is the single clearest measure of how far the women''s game travelled from a self-funded, unsanctioned tournament in 1991 to a sold-out Twickenham thirty-four years later.',
 'ESTABLISHED', null, 5, '{}', '{"Twickenham","England","Stadium of Light"}', '{"womens","world-cup","england","record"}')

) as v(entry_key, era_key, entry_type, code_scope, title, happened_year, happened_on, ends_year, summary, detail, certainty, certainty_note, significance, people, places, tags)
join era on era.era_key = v.era_key
on conflict (entry_key) do nothing;

-- ============================================================
-- SOURCES
-- ============================================================

insert into public.heritage_entry_sources (entry_id, source_title, source_url, publisher, source_tier, supports, retrieved_on)
select e.id, v.source_title, v.source_url, v.publisher, v.source_tier, v.supports, date '2026-09-07'
from (values
('WEBB-ELLIS-1823', 'William Webb Ellis: What We Know', 'https://worldrugbymuseum.com/from-the-vaults/uncategorized/william-webb-ellis-what-we-know', 'World Rugby Museum', 'MUSEUM_OR_ARCHIVE', 'That the account is second-hand and the evidence thin -- from the sport''s own museum, which matters: this is not a debunking by outsiders.'),
('WEBB-ELLIS-1823', 'William Webb Ellis and the Origins of Rugby - a new perspective', 'https://worldrugbymuseum.com/from-the-vaults/club-rugby/william-webb-ellis-and-the-origins-of-rugby-a-new-perspective', 'World Rugby Museum', 'MUSEUM_OR_ARCHIVE', 'The Bloxam accounts, the Old Rugbeian Society inquiry and its 1897 report.'),
('WEBB-ELLIS-1823', 'William Webb Ellis', 'https://en.wikipedia.org/wiki/William_Webb_Ellis', 'Wikipedia', 'ENCYCLOPEDIA', 'That historians treat the story as an origin myth; corroborating detail only.'),
('LAWS-1845', 'History of rugby union', 'https://en.wikipedia.org/wiki/History_of_rugby_union', 'Wikipedia', 'ENCYCLOPEDIA', 'The 1845 committee members and that these were the first published laws of any football code.'),
('RUGBY-SCHOOL-GAME', 'How Rugby Football Began: The Game & Webb Ellis Story', 'https://www.therugbytown.co.uk/about-rugby/the-game/', 'The Rugby Town', 'POPULAR_HISTORY', 'The school game and its spread through old boys.'),
('RFU-FOUNDED-1871', 'History of rugby union', 'https://en.wikipedia.org/wiki/History_of_rugby_union', 'Wikipedia', 'ENCYCLOPEDIA', 'The 26 January 1871 meeting at the Pall Mall Restaurant and the approximate club and delegate counts.'),
('FIRST-INTERNATIONAL-1871', '1871 Scotland versus England rugby union match', 'https://en.wikipedia.org/wiki/1871_Scotland_versus_England_rugby_union_match', 'Wikipedia', 'ENCYCLOPEDIA', 'Date, venue, result and approximate attendance.'),
('FIRST-INTERNATIONAL-1871', 'Scotland and England play first international', 'https://www.raeburnplacefoundation.org/rugby-beginnings/interactive-timeline/scotland-and-england-play-first-international', 'Raeburn Place Foundation', 'MUSEUM_OR_ARCHIVE', 'The match at Raeburn Place, from the site''s own heritage foundation.'),
('FA-SPLIT-1863', 'Blackheath F.C.', 'https://en.wikipedia.org/wiki/Blackheath_F.C.', 'Wikipedia', 'ENCYCLOPEDIA', 'The withdrawal from the FA meetings over hacking and handling.'),
('AMATEURISM-BAN-1886', 'The Great Schism - Northern Union', 'https://www.rugbyfootballhistory.com/Schism.html', 'Rugby Football History', 'POPULAR_HISTORY', 'The 1886 professionalism ban and its uneven effect on working-class players.'),
('BROKEN-TIME-1893', 'The Great Schism - Northern Union', 'https://www.rugbyfootballhistory.com/Schism.html', 'Rugby Football History', 'POPULAR_HISTORY', 'The 1893 Yorkshire six-shilling broken-time proposal and its rejection.'),
('GREAT-SCHISM-1895', 'Milestones In RL', 'http://www.huddersfieldrlheritage.co.uk/Archive/Written/Rugby_League/Milestones.html', 'Huddersfield Rugby League Heritage', 'MUSEUM_OR_ARCHIVE', 'The 29 August 1895 meeting, the clubs present and the vote.'),
('GREAT-SCHISM-1895', 'George Hotel Huddersfield - Birthplace of the Rugby League', 'https://sportinglandmarks.co.uk/george-hotel-huddersfield-birthplace-of-the-rugby-league/', 'Sporting Landmarks', 'POPULAR_HISTORY', 'The venue and its status; note the club count differs slightly between accounts (21 or 22).'),
('GREAT-SCHISM-1895', 'Rugby league in the British Isles', 'https://en.wikipedia.org/wiki/Rugby_league_in_the_British_Isles', 'Wikipedia', 'ENCYCLOPEDIA', 'The formation of the Northern Rugby Football Union.'),
('SCHISM-CAUSES', '1895: the aftermath', 'https://tony-collins.squarespace.com/rugbyreloaded/2012/8/12/1895-the-aftermath', 'Tony Collins, Rugby Reloaded', 'ACADEMIC', 'The class and regional readings of the split, from a specialist historian of the sport.'),
('SCHISM-CAUSES', 'Rugby''s Class War', 'https://tribunemag.co.uk/2021/01/rugbys-class-war/', 'Tribune', 'POPULAR_HISTORY', 'The class-conflict interpretation, included as one of the competing readings rather than as the answer.'),
('RFU-LEAGUE-BAN', 'Rugby''s Class War', 'https://tribunemag.co.uk/2021/01/rugbys-class-war/', 'Tribune', 'POPULAR_HISTORY', 'The exclusion of players who had played league, including amateurs, and its lifting in 1995.'),
('CHALLENGE-CUP-1897', 'Report: The 1897 Challenge Cup Final', 'https://www.rugby-league.com/article/60125/report-the-1897-challenge-cup-final', 'Rugby Football League', 'GOVERNING_BODY', 'The inaugural final and Batley''s win, from the RFL itself.'),
('CHALLENGE-CUP-1897', '1896-97 Challenge Cup', 'https://en.wikipedia.org/wiki/1896%E2%80%9397_Challenge_Cup', 'Wikipedia', 'ENCYCLOPEDIA', 'The 52 entrants and six rounds; and that it is the oldest cup competition in either code.'),
('THIRTEEN-A-SIDE-1906', 'Why is rugby league 13-a-side?', 'https://tony-collins.squarespace.com/rugbyreloaded/2012/8/12/why-is-rugby-league-13-a-side', 'Tony Collins, Rugby Reloaded', 'ACADEMIC', 'The Warrington motion, the 43-18 vote and the wage-saving argument.'),
('PLAY-THE-BALL-1906', '1906-07 Northern Rugby Football Union season', 'https://en.wikipedia.org/wiki/1906%E2%80%9307_Northern_Rugby_Football_Union_season', 'Wikipedia', 'ENCYCLOPEDIA', 'The play-the-ball replacing the post-tackle scrum, and the scoring increase that followed.'),
('ALL-GOLDS-1907', 'All Golds', 'https://en.wikipedia.org/wiki/All_Golds', 'Wikipedia', 'ENCYCLOPEDIA', 'The 1907 professional New Zealand tour and the origin of the nickname.'),
('ALL-GOLDS-1907', 'All Golds, 1907', 'https://teara.govt.nz/en/zoomify/39015/all-golds-1907', 'Te Ara - Encyclopedia of New Zealand', 'ENCYCLOPEDIA', 'The tour from the New Zealand national encyclopedia.'),
('RLWC-1954', '1954 Rugby League World Cup', 'https://en.wikipedia.org/wiki/1954_Rugby_League_World_Cup', 'Wikipedia', 'ENCYCLOPEDIA', 'Date, venue, score, attendance, and that it was the first World Cup in either code.'),
('RLWC-1954', 'Rugby League World Cup', 'https://www.rugbyfootballhistory.com/RLWC.html', 'Rugby Football History', 'POPULAR_HISTORY', 'France''s role in pushing for the tournament.'),
('LIMITED-TACKLES', 'Rugby league', 'https://en.wikipedia.org/wiki/Rugby_league', 'Wikipedia', 'ENCYCLOPEDIA', 'The four-tackle and six-tackle rules.'),
('SUPER-LEAGUE-1996', 'Super League', 'https://en.wikipedia.org/wiki/Super_League', 'Wikipedia', 'ENCYCLOPEDIA', 'The 1996 launch, the switch from winter to summer, and the championship it replaced.'),
('BILLY-BOSTON', 'Sir Billy Boston becomes rugby league''s first knight', 'https://www.intrl.sport/article/442/sir-billy-boston-becomes-rugby-leagues-first-knight', 'International Rugby League', 'GOVERNING_BODY', 'The knighthood and its status as the first in the code''s history.'),
('BILLY-BOSTON', 'Sir Billy Boston: Trailblazing rugby league player dies aged 92', 'https://www.skysports.com/rugby-league/news/12040/13573943/sir-billy-boston-trailblazing-rugby-league-player-dies-aged-92', 'Sky Sports', 'POPULAR_HISTORY', 'His death aged 92 and career summary.'),
('BILLY-BOSTON', 'Billy Boston', 'https://en.wikipedia.org/wiki/Billy_Boston', 'Wikipedia', 'ENCYCLOPEDIA', 'Birth in Cardiff, the move to Wigan, and his scoring record.'),
('BARBARIANS-TRY-1973', 'Barbarians vs New Zealand, 1973', 'https://en.wikipedia.org/wiki/Barbarians_vs_New_Zealand,_1973', 'Wikipedia', 'ENCYCLOPEDIA', 'The 23-11 result, the passage of play and the players involved.'),
('BARBARIANS-TRY-1973', 'Eight Barbarians tries to rival the 1973 classic', 'https://www.world.rugby/news/634985/great-barbarians-rugby-tries', 'World Rugby', 'GOVERNING_BODY', 'The try''s standing in the sport, from the governing body.'),
('RWC-1987', '1987 Rugby World Cup final', 'https://en.wikipedia.org/wiki/1987_Rugby_World_Cup_final', 'Wikipedia', 'ENCYCLOPEDIA', 'The first union World Cup and its winner.'),
('RWC-1987', 'An open game: The story of how rugby union turned professional', 'https://www.world.rugby/news/582543/comment-rugby-professionnel', 'World Rugby', 'GOVERNING_BODY', 'That the 1987 tournament made professionalism increasingly inevitable.'),
('RWC-1995-MANDELA', '1995 Rugby World Cup', 'https://en.wikipedia.org/wiki/1995_Rugby_World_Cup', 'Wikipedia', 'ENCYCLOPEDIA', 'The tournament, the final and its position as the last major amateur-era event.'),
('PROFESSIONALISM-1995', 'Inside the meeting that took rugby professional', 'https://www.world.rugby/news/86763/rugby-professional-1995', 'World Rugby', 'GOVERNING_BODY', 'The Paris meeting of 24-26 August 1995 and the declaration of an open game.'),
('PROFESSIONALISM-1995', '27 August 1995: Rugby Union turns professional', 'https://moneyweek.com/405912/27-august-1995-rugby-union-turns-professional', 'MoneyWeek', 'POPULAR_HISTORY', 'Corroborating date and context; note popular accounts differ by a day (26 or 27 August) on when the declaration is dated.'),
('ENGLAND-2003', 'On this day in 2003: Jonny Wilkinson''s drop goal gives England World Cup glory', 'https://www.rugbypass.com/news/on-this-day-in-2003-jonny-wilkinsons-drop-goal-gives-england-world-cup-glory/', 'RugbyPass', 'POPULAR_HISTORY', 'The 20-17 score, the extra-time drop goal and the seconds remaining.'),
('WOMENS-FIRST-INTERNATIONAL-1982', 'The story behind the first-ever women''s international', 'https://www.world.rugby/news/570629/lhistoire-derriere-le-premier-match-international-feminin', 'World Rugby', 'GOVERNING_BODY', 'France v Netherlands at Utrecht on 13 June 1982.'),
('WRWC-1991', '1991 Women''s Rugby World Cup', 'https://en.wikipedia.org/wiki/1991_Women%27s_Rugby_World_Cup', 'Wikipedia', 'ENCYCLOPEDIA', 'The tournament in Wales, the lack of IRB approval, and the USA''s 19-6 win over England.'),
('WRWC-1991', '1991 pioneers, players, and perseverance: The first women''s Rugby World Cup', 'https://worldrugbymuseum.com/from-the-vaults/womens-rugby/1991-pioneers-players-and-perseverance-the-first-womens-rugby-world-cup', 'World Rugby Museum', 'MUSEUM_OR_ARCHIVE', 'The self-funding and the circumstances of the tournament. Accounts differ on the exact final date within April 1991, which is why this entry is WELL_DOCUMENTED rather than ESTABLISHED.'),
('WRWC-2014-ENGLAND', '2014 Women''s Rugby World Cup final', 'https://en.wikipedia.org/wiki/2014_Women%27s_Rugby_World_Cup_final', 'Wikipedia', 'ENCYCLOPEDIA', 'The 21-9 win over Canada on 17 August 2014 and the preceding run of final defeats.'),
('WRWC-2014-ENGLAND', 'England crowned Women''s World Cup champions', 'https://www.world.rugby/news/34922/england-crowned-womens-world-cup-champions', 'World Rugby', 'GOVERNING_BODY', 'The result, from the governing body.'),
('WRWC-2025-ENGLAND', '2025 Women''s Rugby World Cup final', 'https://en.wikipedia.org/wiki/2025_Women%27s_Rugby_World_Cup_final', 'Wikipedia', 'ENCYCLOPEDIA', 'The 33-13 win over Canada and the 81,885 attendance record.'),
('WRWC-2025-ENGLAND', '2025 Women''s Rugby World Cup', 'https://en.wikipedia.org/wiki/2025_Women%27s_Rugby_World_Cup', 'Wikipedia', 'ENCYCLOPEDIA', 'Tournament dates and venues.')
) as v(entry_key, source_title, source_url, publisher, source_tier, supports)
join public.heritage_entries e on e.entry_key = v.entry_key;
