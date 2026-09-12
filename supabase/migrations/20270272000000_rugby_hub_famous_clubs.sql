-- Rugby Hub Famous Clubs.
--
-- Adds historically significant domestic/professional rugby club knowledge
-- to the Rugby Hub knowledge graph, per the approved archaeology/design.
-- This is curated club knowledge -- never a live club database, a
-- standings service, a roster system, or an operational-club bridge.
--
-- Zero new tables. Every fact below lives on hub_content_items (reusing
-- team_type = 'CLUB_TEAM', already reserved by International Rugby) or in
-- the five relationship/source tables Teams & Competitions/International
-- Rugby/People already built: hub_team_honours, hub_person_team_
-- relationships, hub_content_heritage_links, hub_content_sources,
-- hub_content_relationships. No RUGBY_CLUB content_type, no new team_type,
-- no venue/rivalry/era schema, exactly as approved.
--
-- Knowledge identity follows sporting/historical continuity, never
-- company-law continuity -- Bradford Bulls is ONE durable row (aliases:
-- "Bradford Northern") despite a 1963-64 liquidation/reformation, a 1996
-- rebrand, and a 2017 liquidation-and-phoenix-reformation, because every
-- primary source (the RFL, the press, the 2017 owners themselves)
-- narrates this as one continuous club, not several. Every other club
-- below follows the same rule where it applies. club_directory_id is left
-- NULL on every row: club_directory contains zero Rugby League clubs and
-- the one Union stub found (Leicester Tigers) was too weak to be worth
-- anchoring to -- populating it against an unverified stub would be worse
-- than leaving it null.
--
-- Six new COMPETITION_GUIDE rows are added, each required by a real
-- seeded honour, never speculative: rugby-league-championship (the
-- pre-1996 Rugby League predecessor of Super League -- Wigan's 1990 title
-- was never a "Super League" title and must not be back-projected as
-- one), world-club-challenge (the historic northern-hemisphere-vs-NRL
-- fixture three of the four League clubs have real, well-documented
-- honours in), english-club-championship (the pre-1997 English club
-- rugby union top division/cup era, covering both Leicester's 1988 title
-- and Bath's 1984-87 John Player Cup wins -- genuinely distinct from
-- today's Gallagher Premiership, never back-projected as one),
-- european-rugby-champions-cup (one continuous competition identity
-- despite its historic "Heineken Cup" sponsor name -- Munster's defining
-- achievement, also Leicester's and Bath's), womens-super-league and
-- womens-challenge-cup (the women's Rugby League competitions are
-- genuinely separate competition identities from the men's, exactly as
-- Rugby World Cup and Women's Rugby World Cup already are -- never a
-- shared guide with a gender flag). Women's Rugby Union honours reuse the
-- already-existing premiership-womens-rugby guide unchanged.

-- =====================================================================
-- 1. New COMPETITION_GUIDE rows (reusing the existing content_type),
--    hub_team_honours rows (reusing the existing table, unchanged),
--    hub_content_relationships (reusing unchanged, including the
--    club-to-competition discoverability edges), hub_content_heritage_links
--    (reusing unchanged), hub_content_sources (reusing unchanged), and
--    hub_person_team_relationships (reusing unchanged). Every fact below
--    was verified live against primary/authoritative sources (Sky Sports,
--    Super League's own site, Wikipedia, club and governing-body pages,
--    Rugby League Project, munsterrugby.ie, bathrugbyheritage.org.uk)
--    immediately before writing this migration, never recalled from
--    memory.
-- =====================================================================

do $$
declare
  v_admin uuid := '54518912-752c-4f36-a3ff-176d28a6262d'::uuid;

  v_wigan uuid; v_saints uuid; v_leeds uuid; v_bradford uuid;
  v_leicester uuid; v_bath uuid; v_quins uuid; v_munster uuid;
  v_saints_w uuid; v_leeds_w uuid; v_quins_w uuid; v_saracens_w uuid;

  v_comp_challenge_cup uuid; v_comp_super_league uuid; v_comp_premiership uuid; v_comp_premiership_w uuid;
  v_comp_rl_championship uuid; v_comp_wcc uuid; v_comp_eng_club_champ uuid; v_comp_euro_champions_cup uuid;
  v_comp_womens_sl uuid; v_comp_womens_cc uuid;

  v_boston uuid; v_robinson uuid; v_cunningham uuid; v_sinfield uuid; v_burrow uuid; v_hanley uuid; v_stoop uuid;

  v_heritage_wembley_1929 uuid; v_heritage_challenge_cup_1897 uuid; v_heritage_super_league_1996 uuid;
  v_heritage_bradford_2017 uuid; v_heritage_munster_2006 uuid;
begin
  select id into v_comp_challenge_cup from public.hub_content_items where content_key = 'challenge-cup';
  select id into v_comp_super_league from public.hub_content_items where content_key = 'super-league';
  select id into v_comp_premiership from public.hub_content_items where content_key = 'premiership-rugby';
  select id into v_comp_premiership_w from public.hub_content_items where content_key = 'premiership-womens-rugby';

  select id into v_boston from public.hub_content_items where content_key = 'billy-boston';
  select id into v_robinson from public.hub_content_items where content_key = 'jason-robinson';
  select id into v_cunningham from public.hub_content_items where content_key = 'jodie-cunningham';
  select id into v_sinfield from public.hub_content_items where content_key = 'kevin-sinfield';
  select id into v_burrow from public.hub_content_items where content_key = 'rob-burrow';
  select id into v_hanley from public.hub_content_items where content_key = 'ellery-hanley';
  select id into v_stoop from public.hub_content_items where content_key = 'adrian-stoop';

  select id into v_heritage_wembley_1929 from public.heritage_entries where entry_key = 'WEMBLEY-1929';
  select id into v_heritage_challenge_cup_1897 from public.heritage_entries where entry_key = 'CHALLENGE-CUP-1897';
  select id into v_heritage_super_league_1996 from public.heritage_entries where entry_key = 'SUPER-LEAGUE-1996';

  -- ============ New historic/cross-hemisphere COMPETITION_GUIDE rows ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('rugby-league-championship', 'COMPETITION_GUIDE', 'Rugby League Championship (pre-1996)', 'The top level of British rugby league before Super League began in 1996.',
    'Before Super League launched in 1996, the top division of British rugby league was known simply as the Championship (or First Division). Clubs that dominated this era — including Wigan''s run of seven consecutive titles from 1990 — were not "Super League champions": Super League is a distinct competition identity that began in 1996, and pre-1996 titles belong to this separate, earlier competition.',
    'league', 'Rugby Football League history', 'https://www.rugby-league.com/governance/about-the-rfl/history-&-heritage', current_date) returning id into v_comp_rl_championship;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('world-club-challenge', 'COMPETITION_GUIDE', 'World Club Challenge', 'The annual fixture between the champion clubs of Super League and the NRL.',
    'The World Club Challenge pits the reigning Super League champion against the reigning NRL (Australian) champion. It began as an occasional fixture and has been played most years since the 1990s, giving British and Australian clubs a rare direct measure against each other outside international rugby league.',
    'league', 'Super League World Club Challenge history', 'https://www.superleague.co.uk/article/5816/world-club-challenge-the-history', current_date) returning id into v_comp_wcc;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('english-club-championship', 'COMPETITION_GUIDE', 'English Club Championship (pre-1997)', 'The top level of English club rugby union before the professional Premiership era began in 1997.',
    'Before English club rugby turned professional and the modern Premiership began in 1997, the top division was contested as an amateur/early-professional league championship, alongside a separate knockout cup (played for much of the 1970s-90s as the John Player Cup, then the Pilkington Cup). Titles from this era — including Leicester''s 1988 league championship and Bath''s four consecutive John Player Cup wins from 1984 to 1987 — are genuinely distinct competition identities from today''s Gallagher Premiership and must never be described as Premiership titles.',
    'union', 'History of the English rugby union system', 'https://en.wikipedia.org/wiki/History_of_the_English_rugby_union_system', current_date) returning id into v_comp_eng_club_champ;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('european-rugby-champions-cup', 'COMPETITION_GUIDE', 'European Rugby Champions Cup', 'The top European club rugby union competition, contested by the leading clubs of England, France, Ireland, Scotland, Wales and Italy.',
    'The European Rugby Champions Cup is the top tier of European club rugby union, bringing together the leading clubs and provinces from England, France, Ireland, Scotland, Wales and Italy. It was known as the Heineken Cup from its 1995 launch until a 2014 rebrand — the competition itself is the same continuous identity throughout, only the title sponsor changed.',
    'union', 'European Professional Club Rugby', 'https://en.wikipedia.org/wiki/European_Rugby_Champions_Cup', current_date) returning id into v_comp_euro_champions_cup;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('womens-super-league', 'COMPETITION_GUIDE', 'Women''s Super League', 'The top division of English women''s rugby league.',
    'The Women''s Super League is the top division of English women''s rugby league, run by the Rugby Football League. It is a genuinely separate competition identity from the men''s Super League, with its own champions, never a subsection of the men''s competition.',
    'league', 'RFL Women''s Super League', 'https://en.wikipedia.org/wiki/RFL_Women%27s_Super_League', current_date) returning id into v_comp_womens_sl;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('womens-challenge-cup', 'COMPETITION_GUIDE', 'Women''s Challenge Cup', 'The women''s equivalent of rugby league''s Challenge Cup.',
    'The Women''s Challenge Cup is women''s rugby league''s major knockout cup competition, contested annually since the 1990s. Like the Women''s Super League, it is a genuinely separate competition identity from the men''s Challenge Cup, never a variant of the same trophy.',
    'league', 'Rugby Football League', 'https://en.wikipedia.org/wiki/Women%27s_Challenge_Cup', current_date) returning id into v_comp_womens_cc;

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select c.id, ri.id from public.hub_content_items c cross join public.regulatory_identities ri
  where c.id in (v_comp_rl_championship, v_comp_wcc, v_comp_womens_sl, v_comp_womens_cc) and ri.rugby_code = 'league';

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select c.id, ri.id from public.hub_content_items c cross join public.regulatory_identities ri
  where c.id in (v_comp_eng_club_champ, v_comp_euro_champions_cup) and ri.rugby_code = 'union';

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_comp_rl_championship, v_comp_wcc, v_comp_eng_club_champ, v_comp_euro_champions_cup, v_comp_womens_sl, v_comp_womens_cc);

  -- ============ Rugby League men's clubs (all four mandatory) ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender, aliases)
  values ('wigan-warriors', 'RUGBY_TEAM', 'Wigan Warriors', 'One of rugby league''s most successful clubs, whose 1988-95 run of eight consecutive Challenge Cup wins remains unmatched.',
    'Wigan''s rugby league club traces back to the 1870s and has been through more than one reformation in that time, but its identity as Wigan''s club has remained continuous since the professional era began. The club was known as Wigan Rugby League Football Club before adopting the Warriors name around the start of the Super League era in 1996. Wigan''s late-1980s and early-1990s side is one of the sport''s great dynasties: seven consecutive league championships from 1990 and eight consecutive Challenge Cup wins from 1988 to 1995, a record no club has matched. Wigan hold the record for the most Challenge Cup wins of any club, with 21 as of 2024.',
    'league', 'CLUB_TEAM', 'mens', array['Wigan RLFC']) returning id into v_wigan;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender, aliases)
  values ('st-helens', 'RUGBY_TEAM', 'St Helens', 'Known as Saints, the club with the most Super League Grand Final wins of any side.',
    'St Helens, known to supporters as Saints, was a founding member of the Northern Union in 1895 and has never been through a liquidation or reformation in its history — a genuinely continuous identity since the 1870s/1890s. St Helens hold the record for the most Super League Grand Final wins of any club, and their 2006 side won the League Leaders'' Shield, the Grand Final and the Challenge Cup in the same season, one of the sport''s great single-season achievements.',
    'league', 'CLUB_TEAM', 'mens', array['Saints']) returning id into v_saints;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender, aliases)
  values ('leeds-rhinos', 'RUGBY_TEAM', 'Leeds Rhinos', 'One of Super League''s most successful clubs, and the first side to win three consecutive Super League Grand Finals.',
    'Leeds'' rugby league club traces back to Leeds St John''s in 1870, was long known as Leeds RLFC, and was rebranded Leeds Rhinos in 1997 under new ownership at the height of the Super League era — a straightforward rename with no break in the club''s continuous identity. Leeds became the first side in Super League history to win three consecutive Grand Finals (2007-2009), part of a "Golden Era" that saw the club crowned champions four times in five seasons, and has won the World Club Challenge three times.',
    'league', 'CLUB_TEAM', 'mens', array['Leeds RLFC']) returning id into v_leeds;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender, aliases)
  values ('bradford-bulls', 'RUGBY_TEAM', 'Bradford Bulls', 'Four-time Super League champions whose history includes a marketing rebrand, an earlier 1960s reformation, and a 2017 liquidation and phoenix reformation.',
    'Bradford''s rugby league club was known as Bradford Northern for most of its history before rebranding as Bradford Bulls for the start of the Super League era in 1996. The club has faced real organisational discontinuities — it folded and reformed in 1963-64, and went into liquidation in January 2017 before a new ownership group reformed the club within weeks, preserving supporters'' season tickets and entering the same competition system at a lower tier. Every primary account of the club''s history — the Rugby Football League''s own, the press, and the 2017 owners themselves — treats this as one continuous sporting identity, not a break, and Bradford''s honours are attributed to "Bradford Bulls" throughout. Bradford won four Super League titles between 1997 and 2005, including becoming the first Super League-era side to complete a treble in 2003, and won the World Club Challenge three times. Bradford''s current league position does not reflect this historical importance.',
    'league', 'CLUB_TEAM', 'mens', array['Bradford Northern']) returning id into v_bradford;

  -- ============ Rugby Union men's clubs ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('leicester-tigers', 'RUGBY_TEAM', 'Leicester Tigers', 'The most successful club in English rugby union history, with a record 11 Premiership titles.',
    'Leicester Tigers were founded in 1880 and have played at Welford Road since 1892. Leicester hold the record for the most English top-flight titles of any club, both before and after the professional Premiership era began in 1997, and were the first club to retain the Heineken Cup, winning it in successive seasons in 2001 and 2002.',
    'union', 'CLUB_TEAM', 'mens') returning id into v_leicester;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('bath-rugby', 'RUGBY_TEAM', 'Bath Rugby', 'The dominant force in English club rugby through the late 1980s and 1990s, and the first English club to win the European Cup.',
    'Bath Rugby was founded in 1865 as Bath Football Club and has played at the Recreation Ground since 1894. Under coach Jack Rowell, Bath dominated English club rugby from the mid-1980s to the mid-1990s, winning the John Player Cup four years running from 1984 to 1987 and going on to become the first English club to win the European Cup, in 1998 — achievements from a genuinely different competition era from today''s Gallagher Premiership.',
    'union', 'CLUB_TEAM', 'mens') returning id into v_bath;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender, aliases)
  values ('harlequins', 'RUGBY_TEAM', 'Harlequins', 'One of English rugby union''s founding clubs, and two-time Premiership champions.',
    'Harlequins was founded in 1866 as Hampstead Football Club, renamed Harlequins soon after, and became one of the founding members of the Rugby Football Union in 1871. Harlequins won the Premiership title in 2012 and 2021, and their home ground, The Stoop, is named after Adrian Stoop, the club captain who also captained England''s first international at Twickenham in 1910.',
    'union', 'CLUB_TEAM', 'mens', array['Quins']) returning id into v_quins;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('munster', 'RUGBY_TEAM', 'Munster', 'One of Ireland''s four rugby union provinces, and two-time champions of Europe.',
    'Munster is one of the four Irish provincial rugby union sides, with roots in the Irish Rugby Football Union''s provincial branches dating to 1879 — a genuinely continuous identity long predating professionalism, not a modern regional merger of separate clubs. Munster won their first European title, the Heineken Cup, in 2006, beating Biarritz in the final, and won it again in 2008 against Toulouse — the same competition now known as the European Rugby Champions Cup.',
    'union', 'CLUB_TEAM', 'mens') returning id into v_munster;

  -- ============ Women's clubs (first-class, separate rows) ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('st-helens-women', 'RUGBY_TEAM', 'St Helens Women', 'The most successful club in Women''s Challenge Cup history, with a record eight titles.',
    'St Helens Women hold the record for the most Women''s Challenge Cup wins of any club, including two separate runs of four consecutive titles (2013-2016 and 2021-2024), and won the Women''s Super League title in 2021. St Helens Women is a fully independent team from the men''s St Helens club, with its own history and honours.',
    'league', 'CLUB_TEAM', 'womens') returning id into v_saints_w;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('leeds-rhinos-women', 'RUGBY_TEAM', 'Leeds Rhinos Women', 'Two-time Women''s Super League champions.',
    'Leeds Rhinos Women won the Women''s Super League title in 2019 and 2022, and the Women''s Challenge Cup in 2018 and 2019. Leeds Rhinos Women is a fully independent team from the men''s Leeds Rhinos club, with its own history and honours.',
    'league', 'CLUB_TEAM', 'womens') returning id into v_leeds_w;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('harlequins-women', 'RUGBY_TEAM', 'Harlequins Women', 'Premier 15s champions in the 2020-21 season.',
    'Harlequins Women won the Premier 15s title in the 2020-21 season, English women''s club rugby''s top division. Harlequins Women is a fully independent team from the men''s Harlequins club, with its own history and honours.',
    'union', 'CLUB_TEAM', 'womens') returning id into v_quins_w;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('saracens-women', 'RUGBY_TEAM', 'Saracens Women', 'One of the most decorated clubs in English women''s rugby union.',
    'Saracens Women have won more top-flight English titles than any other club across the sport''s various professional eras and competition names. Saracens Women is a fully independent team from the men''s Saracens club, with its own history and honours.',
    'union', 'CLUB_TEAM', 'womens') returning id into v_saracens_w;

  -- ============ Applicability: every club is code-specific ============

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select t.id, ri.id from public.hub_content_items t cross join public.regulatory_identities ri
  where t.id in (v_wigan, v_saints, v_leeds, v_bradford, v_saints_w, v_leeds_w) and ri.rugby_code = 'league';

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select t.id, ri.id from public.hub_content_items t cross join public.regulatory_identities ri
  where t.id in (v_leicester, v_bath, v_quins, v_munster, v_quins_w, v_saracens_w) and ri.rugby_code = 'union';

  -- ============ Publish every club ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_wigan, v_saints, v_leeds, v_bradford, v_leicester, v_bath, v_quins, v_munster, v_saints_w, v_leeds_w, v_quins_w, v_saracens_w);

  -- ============ Honours (curated, 3-8 per club, never exhaustive) ============

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_wigan, v_comp_challenge_cup, 'CHAMPION', '2024', 'Beat Warrington Wolves 18-8 at Wembley, taking the club''s record to 21 Challenge Cup wins.', 'Sky Sports', 'https://www.skysports.com/rugby-league/news/12196/13150062/challenge-cup-final-how-matt-peets-wigan-warriors-conquered-the-rugby-league-world', current_date),
    (v_wigan, v_comp_challenge_cup, 'CHAMPION', '1988-1995', 'Won all eight Challenge Cup finals played in this span, a run no club has matched.', 'Love Rugby League', 'https://www.loverugbyleague.com/post/throwback-thursday-wigan-1988-1995-and-the-greatest-challenge-cup-winning-run', current_date),
    (v_wigan, v_comp_super_league, 'CHAMPION', '2023', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/2023_Super_League_Grand_Final', current_date),
    (v_wigan, v_comp_wcc, 'CHAMPION', '2024', 'Beat NRL champions Penrith Panthers, a fifth World Club Challenge title.', 'Love Rugby League', 'https://www.loverugbyleague.com/post/wigan-warriors-coach-delivers-major-update-on-2025-world-club-challenge-after-super-league-grand-final-triumph', current_date),
    (v_wigan, v_comp_rl_championship, 'CHAMPION', '1990', 'First of seven consecutive league championships from 1990.', 'Rugby League Project', 'https://www.rugbyleagueproject.org/teams/wigan-warriors/summary.html', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_saints, v_comp_super_league, 'CHAMPION', '2006', 'Part of a treble season alongside the League Leaders'' Shield and Challenge Cup.', 'Super League', 'https://www.superleague.co.uk/article/6037/sl30-|-st-helens-2006-voted-super-leagues-greatest-team-in-30-years', current_date),
    (v_saints, v_comp_challenge_cup, 'CHAMPION', '2006', 'Part of the club''s 2006 treble.', 'Super League', 'https://www.superleague.co.uk/article/6037/sl30-|-st-helens-2006-voted-super-leagues-greatest-team-in-30-years', current_date),
    (v_saints, v_comp_challenge_cup, 'CHAMPION', '1996', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Rugby_League_Challenge_Cup', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_leeds, v_comp_super_league, 'CHAMPION', '2007', 'First of three consecutive Super League titles (2007-2009), a Super League record at the time.', 'UK Parliament Early Day Motion', 'https://edm.parliament.uk/early-day-motion/39213/leeds-rhinos-historic-third-consecutive-super-league-title', current_date),
    (v_leeds, v_comp_wcc, 'CHAMPION', '2005', 'First of three World Club Challenge titles (2005, 2008, 2012).', 'Total Rugby League', 'https://www.totalrl.com/time-machine-remembering-leeds-rhinos-2005-world-club-challenge-triumph/', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_bradford, v_comp_super_league, 'CHAMPION', '1997', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Bradford_Bulls', current_date),
    (v_bradford, v_comp_super_league, 'CHAMPION', '2003', 'The first Super League-era side to complete a treble, beating Wigan 25-12 in the Grand Final.', 'Wikipedia', 'https://en.wikipedia.org/wiki/2003_Super_League_Grand_Final', current_date),
    (v_bradford, v_comp_wcc, 'CHAMPION', '2002', 'First of three World Club Challenge titles (2002, 2004, 2006).', 'Super League', 'https://www.superleague.co.uk/article/5816/world-club-challenge-the-history', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_leicester, v_comp_premiership, 'CHAMPION', '2013', 'One of a record 11 English top-flight titles.', 'Wikipedia', 'https://en.wikipedia.org/wiki/List_of_Leicester_Tigers_records_and_statistics', current_date),
    (v_leicester, v_comp_euro_champions_cup, 'CHAMPION', '2001', 'First of back-to-back Heineken Cup wins, the first club to retain the trophy.', 'Wikipedia', 'https://en.wikipedia.org/wiki/History_of_Leicester_Tigers', current_date),
    (v_leicester, v_comp_euro_champions_cup, 'CHAMPION', '2002', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/History_of_Leicester_Tigers', current_date),
    (v_leicester, v_comp_eng_club_champ, 'CHAMPION', '1988', 'Won the old English club championship before the professional Premiership era began.', 'Rugby Tigers Network', 'https://www.rugbynetwork.net/main/s103/st6896.htm', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_bath, v_comp_eng_club_champ, 'CHAMPION', '1984-1987', 'Won the John Player Cup, English club rugby''s leading knockout competition at the time, four years running.', 'Bath Rugby Heritage', 'https://www.bathrugbyheritage.org.uk/content/heritage-topics/the-club/history-of-the-club/history-of-bath-rugby-1965-to-2015', current_date),
    (v_bath, v_comp_euro_champions_cup, 'CHAMPION', '1998', 'The first English club to win the competition, then known as the Heineken Cup.', 'Planet Rugby', 'https://www.planetrugby.com/greatest-rugby-sides-bath-1987-96', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_quins, v_comp_premiership, 'CHAMPION', '2012', 'Beat Leicester Tigers 30-23 in the final at Twickenham, the club''s first Premiership title.', 'ESPN', 'https://www.espn.com/rugby/story/_/id/31713891/harlequins-crowned-premiership-champions-nine-years', current_date),
    (v_quins, v_comp_premiership, 'CHAMPION', '2021', 'Beat Exeter Chiefs 40-38 in the final.', 'ESPN', 'https://www.espn.com/rugby/story/_/id/31713891/harlequins-crowned-premiership-champions-nine-years', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_munster, v_comp_euro_champions_cup, 'CHAMPION', '2006', 'Beat Biarritz in the final, the province''s first European title, then known as the Heineken Cup.', 'Wikipedia', 'https://en.wikipedia.org/wiki/2006_Heineken_Cup_Final', current_date),
    (v_munster, v_comp_euro_champions_cup, 'CHAMPION', '2008', 'Beat Toulouse 16-13 in the final.', 'Wikipedia', 'https://en.wikipedia.org/wiki/2008_Heineken_Cup_final', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_saints_w, v_comp_womens_cc, 'CHAMPION', '2013-2016', 'Won four consecutive Women''s Challenge Cups.', 'Sky Sports', 'https://www.skysports.com/rugby-league/news/12196/13379390/womens-challenge-cup-final-wigan-warriors-win-maiden-title-with-42-6-domination-of-st-helens', current_date),
    (v_saints_w, v_comp_womens_cc, 'CHAMPION', '2021-2024', 'A second run of four consecutive titles, taking the club''s record to eight Women''s Challenge Cups overall.', 'Sky Sports', 'https://www.skysports.com/rugby-league/news/12196/13379390/womens-challenge-cup-final-wigan-warriors-win-maiden-title-with-42-6-domination-of-st-helens', current_date),
    (v_saints_w, v_comp_womens_sl, 'CHAMPION', '2021', 'Beat Leeds Rhinos Women 28-0 in the Grand Final.', 'Wikipedia', 'https://en.wikipedia.org/wiki/2021_RFL_Women%27s_Super_League', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_leeds_w, v_comp_womens_sl, 'CHAMPION', '2019', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Leeds_Rhinos_Women', current_date),
    (v_leeds_w, v_comp_womens_sl, 'CHAMPION', '2022', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Leeds_Rhinos_Women', current_date),
    (v_leeds_w, v_comp_womens_cc, 'CHAMPION', '2018', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Leeds_Rhinos_Women', current_date),
    (v_leeds_w, v_comp_womens_cc, 'CHAMPION', '2019', null, 'Wikipedia', 'https://en.wikipedia.org/wiki/Leeds_Rhinos_Women', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_quins_w, v_comp_premiership_w, 'CHAMPION', '2020-21', 'Won the Premier 15s title, English women''s club rugby''s top division at the time.', 'Wikipedia', 'https://en.wikipedia.org/wiki/2020%E2%80%9321_Premier_15s', current_date);

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_saracens_w, v_comp_premiership_w, 'CHAMPION', '2025-26', 'One of more top-flight English titles than any other club, across the sport''s various professional eras and competition names.', 'Ruck', 'https://www.ruck.co.uk/category/womens-rugby/premiership-womens-rugby/saracens-women/', current_date);

  -- ============ Person <-> club relationships (curated, reusing People's existing role types) ============

  insert into public.hub_person_team_relationships (person_id, team_id, role_type, source_url, source_retrieved_on) values
    (v_boston, v_wigan, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Billy_Boston', current_date),
    (v_robinson, v_wigan, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Jason_Robinson_(rugby)', current_date),
    (v_cunningham, v_saints_w, 'CAPTAINED', 'https://www.saintsrlfc.com/2025/06/05/saints-21-woman-squad-for-challenge-cup-final/', current_date),
    (v_sinfield, v_leeds, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Kevin_Sinfield', current_date),
    (v_burrow, v_leeds, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Rob_Burrow', current_date),
    (v_hanley, v_bradford, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Ellery_Hanley', current_date),
    (v_hanley, v_wigan, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Ellery_Hanley', current_date),
    (v_hanley, v_leeds, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Ellery_Hanley', current_date);

  insert into public.hub_person_team_relationships (person_id, team_id, role_type, notes, source_url, source_retrieved_on) values
    (v_stoop, v_quins, 'CAPTAINED', 'Captained Harlequins for eight consecutive seasons, and the club''s home ground, The Stoop, is named in his memory.', 'https://en.wikipedia.org/wiki/Adrian_Stoop', current_date);

  -- ============ Heritage links (reusing existing entries additively; Heritage
  -- people[] free text is left completely untouched). ============

  insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values
    (v_wigan, v_heritage_wembley_1929),
    (v_wigan, v_heritage_challenge_cup_1897),
    (v_wigan, v_heritage_super_league_1996),
    (v_saints, v_heritage_challenge_cup_1897),
    (v_saints, v_heritage_super_league_1996),
    (v_leeds, v_heritage_super_league_1996),
    (v_bradford, v_heritage_super_league_1996);

  -- ============ Two new Heritage entries -- each earns its place: Bradford's
  -- 2017 reformation is the central real-world proof of this whole slice's
  -- "sporting continuity, not legal continuity" rule; Munster's 2006 final
  -- is Irish rugby's defining club-rugby landmark and gives the corpus's
  -- one non-English case a genuine Heritage story, matching what every
  -- League club now has. ============

  insert into public.heritage_entries (entry_key, era_id, entry_type, code_scope, title, happened_year, summary, detail, certainty, people, places, tags)
  select 'BRADFORD-BULLS-2017', era.id, 'MILESTONE', 'league', 'Bradford Bulls fold and reform within weeks', 2017,
    'Bradford Bulls, four-time Super League champions, went into liquidation in January 2017 — and a new ownership group reformed the club within weeks, honouring existing season tickets and continuing in the same competition system.',
    'Bradford Bulls entered administration for the third time in four years in November 2016, then liquidation in January 2017. Rugby League historians and the Rugby Football League itself treat this as a reformation of the same historic club rather than the creation of a new one: the new owners committed to honouring 2017 season tickets already sold, and publicly acknowledged the history and tradition of rugby league in Bradford. The club continued playing under the same name, at the same Odsal ground, with its honours from the Super League era still attributed to it throughout British rugby league''s historical record.',
    'WELL_DOCUMENTED', array['Bradford Bulls'], array['Bradford', 'Odsal'], array['league', 'bradford', 'reformation']
  from public.heritage_eras era where era.id = (select era_id from public.heritage_entries where entry_key = 'SUPER-LEAGUE-1996')
  returning id into v_heritage_bradford_2017;

  insert into public.heritage_entries (entry_key, era_id, entry_type, code_scope, title, happened_year, summary, detail, certainty, people, places, tags)
  select 'MUNSTER-2006', era.id, 'MATCH', 'union', 'Munster win the Heineken Cup', 2006,
    'Munster beat Biarritz in the 2006 Heineken Cup final to win the province''s first European title, one of Irish club rugby''s defining moments.',
    'Munster reached the Heineken Cup final in 2000 and 2002 without winning it before finally beating Biarritz Olympique in the 2006 final. The result was one of the most significant moments in Irish club rugby history, cementing Munster''s reputation as one of the great forces of the European professional era. Munster went on to win the competition again in 2008, beating Toulouse.',
    'ESTABLISHED', array['Munster'], array['Cardiff'], array['union', 'ireland', 'europe', 'final']
  from public.heritage_eras era where era.id = (select era_id from public.heritage_entries where entry_key = 'SUPER-LEAGUE-1996')
  returning id into v_heritage_munster_2006;

  insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values
    (v_bradford, v_heritage_bradford_2017),
    (v_munster, v_heritage_munster_2006);

  -- ============ Multi-source provenance (every club gets at least one row;
  -- several get two or more -- Bradford's complex history in particular
  -- needs multi-source citation). ============

  insert into public.hub_content_sources (content_item_id, source_tier, source_title, source_url, retrieved_on) values
    (v_wigan, 'ENCYCLOPEDIA', 'Wigan Warriors', 'https://en.wikipedia.org/wiki/Wigan_Warriors', current_date),
    (v_wigan, 'CONTEMPORARY_REPORT', 'Throwback Thursday: Wigan 1988-1995 and the greatest Challenge Cup winning run', 'https://www.loverugbyleague.com/post/throwback-thursday-wigan-1988-1995-and-the-greatest-challenge-cup-winning-run', current_date),
    (v_saints, 'ENCYCLOPEDIA', 'St Helens R.F.C.', 'https://en.wikipedia.org/wiki/St_Helens_R.F.C.', current_date),
    (v_saints, 'GOVERNING_BODY', 'SL30: St Helens 2006 voted Super League''s Greatest Team in 30 Years', 'https://www.superleague.co.uk/article/6037/sl30-|-st-helens-2006-voted-super-leagues-greatest-team-in-30-years', current_date),
    (v_leeds, 'ENCYCLOPEDIA', 'Leeds Rhinos', 'https://en.wikipedia.org/wiki/Leeds_Rhinos', current_date),
    (v_leeds, 'CONTEMPORARY_REPORT', 'Leeds Rhinos historic third consecutive Super League title', 'https://edm.parliament.uk/early-day-motion/39213/leeds-rhinos-historic-third-consecutive-super-league-title', current_date),
    (v_bradford, 'ENCYCLOPEDIA', 'Bradford Bulls', 'https://en.wikipedia.org/wiki/Bradford_Bulls', current_date),
    (v_bradford, 'CONTEMPORARY_REPORT', 'Bradford Bulls go into liquidation', 'https://theweek.com/rugby-league/80139/bradford-bulls-go-into-liquidation', current_date),
    (v_bradford, 'CONTEMPORARY_REPORT', 'New owners officially announced weeks after Bradford Bulls'' liquidation', 'https://bdaily.co.uk/articles/2017/01/17/new-owners-officially-announced-weeks-after-bradford-bulls-liquidation', current_date),
    (v_leicester, 'ENCYCLOPEDIA', 'History of Leicester Tigers', 'https://en.wikipedia.org/wiki/History_of_Leicester_Tigers', current_date),
    (v_leicester, 'CONTEMPORARY_REPORT', 'Leicester Tigers club history', 'https://www.leicestertigers.com/club/history', current_date),
    (v_bath, 'ENCYCLOPEDIA', 'Bath Rugby', 'https://en.wikipedia.org/wiki/Bath_Rugby', current_date),
    (v_bath, 'ACADEMIC', 'History of Bath Rugby, 1965 to 2015', 'https://www.bathrugbyheritage.org.uk/content/heritage-topics/the-club/history-of-the-club/history-of-bath-rugby-1965-to-2015', current_date),
    (v_quins, 'ENCYCLOPEDIA', 'Harlequin F.C.', 'https://en.wikipedia.org/wiki/Harlequin_F.C.', current_date),
    (v_munster, 'ENCYCLOPEDIA', 'Munster Rugby', 'https://www.munsterrugby.ie/the-club/about-munster-rugby/history-timeline/', current_date),
    (v_munster, 'ENCYCLOPEDIA', '2006 Heineken Cup Final', 'https://en.wikipedia.org/wiki/2006_Heineken_Cup_Final', current_date),
    (v_saints_w, 'ENCYCLOPEDIA', 'Women''s Challenge Cup', 'https://en.wikipedia.org/wiki/Women%27s_Challenge_Cup', current_date),
    (v_leeds_w, 'ENCYCLOPEDIA', 'Leeds Rhinos Women', 'https://en.wikipedia.org/wiki/Leeds_Rhinos_Women', current_date),
    (v_quins_w, 'ENCYCLOPEDIA', 'Harlequins Women', 'https://en.wikipedia.org/wiki/Harlequins_Women', current_date),
    (v_saracens_w, 'CONTEMPORARY_REPORT', 'Saracens Women', 'https://www.ruck.co.uk/category/womens-rugby/premiership-womens-rugby/saracens-women/', current_date);

  -- ============ Club <-> competition discoverability edges (generic,
  -- reusing hub_content_relationships unchanged -- discoverability only,
  -- never season-by-season membership). ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_wigan, v_comp_challenge_cup, 'RELATED_KNOWLEDGE'),
    (v_wigan, v_comp_super_league, 'RELATED_KNOWLEDGE'),
    (v_saints, v_comp_challenge_cup, 'RELATED_KNOWLEDGE'),
    (v_saints, v_comp_super_league, 'RELATED_KNOWLEDGE'),
    (v_leeds, v_comp_super_league, 'RELATED_KNOWLEDGE'),
    (v_bradford, v_comp_super_league, 'RELATED_KNOWLEDGE'),
    (v_leicester, v_comp_premiership, 'RELATED_KNOWLEDGE'),
    (v_bath, v_comp_premiership, 'RELATED_KNOWLEDGE'),
    (v_quins, v_comp_premiership, 'RELATED_KNOWLEDGE');

end $$;
