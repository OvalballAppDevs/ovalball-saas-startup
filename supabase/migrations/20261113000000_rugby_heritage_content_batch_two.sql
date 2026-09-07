-- Heritage content, second batch: the competitions and the people.
--
-- The first batch established the spine -- origins, the schism, the two codes
-- diverging, the open era, the women's game. It was deliberately structural,
-- and it left the sport's actual furniture out: the oldest trophies, the
-- grounds, the players people can name.
--
-- Two things guided what went in here. League gets equal weight, because a
-- heritage section that treats league as a footnote to union reproduces
-- exactly the hierarchy the 1895 split created. And every entry is tied to a
-- source retrieved this session -- nothing is included on the strength of
-- being common knowledge, which is how errors get laundered into a product
-- that parents are meant to trust.

with era as (select era_key, id from public.heritage_eras)
insert into public.heritage_entries
  (entry_key, era_id, entry_type, code_scope, title, happened_year, happened_on, ends_year, summary, detail, certainty, certainty_note, significance, people, places, tags)
select v.entry_key, era.id, v.entry_type, v.code_scope, v.title, v.happened_year, v.happened_on, v.ends_year,
       v.summary, v.detail, v.certainty, v.certainty_note, v.significance,
       v.people::text[], v.places::text[], v.tags::text[]
from (values

-- ---------- UNION: competitions and grounds ----------
('CALCUTTA-CUP-1879', 'CODIFICATION', 'COMPETITION', 'pre_schism',
 'The Calcutta Cup', 1879, date '1879-03-10', null::integer,
 'England and Scotland played for the Calcutta Cup for the first time at Raeburn Place, and drew. It is the oldest trophy in international rugby.',
 'The cup was made from melted-down silver rupees when the Calcutta club disbanded. The first match was drawn; England became the first winners on 28 February 1880 in Manchester. The trophy predates the Home Nations Championship by four years, and the fixture is still played every year.',
 'ESTABLISHED', null, 3, '{}', '{"Raeburn Place","Edinburgh","Manchester","Calcutta"}', '{"competition","trophy","england","scotland","oldest"}'),

('HOME-NATIONS-1883', 'CODIFICATION', 'COMPETITION', 'pre_schism',
 'The first Home Nations Championship', 1883, null, null,
 'The four home unions began an annual championship -- the competition that became the Five Nations and then the Six Nations.',
 'It is the oldest international championship in rugby and one of the oldest in any sport. France joined to make it Five Nations, and Italy joined in 2000 to make it Six.',
 'ESTABLISHED', null, 3, '{}', '{"Britain","Ireland"}', '{"competition","six-nations","oldest"}'),

('LIONS-1888', 'CODIFICATION', 'MILESTONE', 'pre_schism',
 'The first Lions tour', 1888, null, null,
 'A party of 22 players captained by Robert Seddon toured Australia and New Zealand for close to 250 days -- the beginning of what became the British & Irish Lions.',
 'It was a private commercial venture, not organised by any union, and it was the first major tour of the southern hemisphere by a European rugby side. The Lions concept -- a combined team from four unions touring together -- has no equivalent in any other sport, and it started as a speculative business trip.',
 'ESTABLISHED', null, 3, '{"Robert Seddon"}', '{"Australia","New Zealand"}', '{"lions","tour","first"}'),

('TWICKENHAM-1909', 'AMATEUR_CENTURY', 'MILESTONE', 'union',
 'Twickenham''s first match', 1909, date '1909-10-02', null,
 'The first game at Twickenham was not an international but a club fixture: Harlequins beat Richmond 14-10 in front of about 2,000 people.',
 'Harlequins had a prior agreement with the RFU that they could use the new ground once it was ready, and invoked it. Adrian Stoop captained them, and would captain England in the ground''s first international three months later. The RFU had bought a market garden to build on, which is why Twickenham is still called the Cabbage Patch.',
 'ESTABLISHED', null, 3, '{"Adrian Stoop"}', '{"Twickenham","London"}', '{"twickenham","ground","first","england"}'),

('TWICKENHAM-INTERNATIONAL-1910', 'AMATEUR_CENTURY', 'MATCH', 'union',
 'England''s first international at Twickenham', 1910, date '1910-01-15', null,
 'England beat Wales 11-6 in front of around 20,000 people in the first international staged at Twickenham.',
 'England had not beaten Wales for over a decade before this match. The ground has been England''s home ever since, and in 2025 it held the world-record crowd for a women''s rugby match.',
 'ESTABLISHED', null, 3, '{"Adrian Stoop"}', '{"Twickenham","London"}', '{"twickenham","england","wales","match"}'),

('SIX-NATIONS-2000', 'OPEN_ERA', 'COMPETITION', 'union',
 'Italy joins and the Six Nations begins', 2000, null, null,
 'Italy was admitted to the Five Nations, creating the Six Nations Championship.',
 'It was the first expansion of the championship since France joined, and the first deliberate act of growing European union rugby beyond its historic base. The tournament traces directly back to the 1883 Home Nations.',
 'ESTABLISHED', null, 3, '{}', '{"Italy","Europe"}', '{"competition","six-nations"}'),

('LOMU-1995', 'AMATEUR_CENTURY', 'PERSON', 'union',
 'Jonah Lomu changes what a winger can be', 1995, null, null,
 'In the 1995 World Cup semi-final, New Zealand''s Jonah Lomu scored four tries against England in a performance that made him the sport''s first global superstar.',
 'The image of Lomu running straight over Mike Catt is one of the most reproduced in rugby. He was a wing with a forward''s size and a sprinter''s speed, and there was no established way to defend against him. His impact is often cited as one of the commercial pressures that made union''s amateurism untenable within months. He died in 2015, aged 40.',
 'ESTABLISHED', null, 4, '{"Jonah Lomu","Mike Catt"}', '{"South Africa"}', '{"person","union","world-cup","new-zealand"}'),

-- ---------- LEAGUE: the occasions ----------
('WEMBLEY-1929', 'LEAGUE_HEARTLAND', 'MATCH', 'league',
 'The Challenge Cup final comes to Wembley', 1929, date '1929-05-04', null,
 'Wigan beat Dewsbury 13-2 in the first Challenge Cup final staged at Wembley, watched by 41,500 people.',
 'Taking the final to Wembley made rugby league a national occasion rather than a northern one, and the Wembley final became the day the sport presented itself to the rest of the country. It remains one of the very few fixtures that has consistently taken the northern game to a London audience on its own terms.',
 'ESTABLISHED', null, 4, '{"Wigan","Dewsbury"}', '{"Wembley","London"}', '{"league","challenge-cup","wembley","match"}'),

('STATE-OF-ORIGIN-1980', 'LEAGUE_HEARTLAND', 'COMPETITION', 'league',
 'State of Origin', 1980, date '1980-07-07', null,
 'Queensland beat New South Wales 20-10 at Lang Park in the first match played under "state of origin" selection -- players picked for the state they came from, not the state they played in.',
 'The problem it solved was that Queensland''s best players had been signed by better-paying New South Wales clubs and then played against Queensland. Selecting by origin rather than by club produced what is now one of the most intense fixtures in world sport. Arthur Beetson captained Queensland; Wally Lewis and Mal Meninga played. A full series followed from 1982.',
 'ESTABLISHED', null, 4, '{"Arthur Beetson","Wally Lewis","Mal Meninga"}', '{"Lang Park","Brisbane","Queensland","New South Wales"}', '{"league","state-of-origin","australia","competition"}')

) as v(entry_key, era_key, entry_type, code_scope, title, happened_year, happened_on, ends_year, summary, detail, certainty, certainty_note, significance, people, places, tags)
join era on era.era_key = v.era_key
on conflict (entry_key) do nothing;

-- ============================================================
-- SOURCES
-- ============================================================

insert into public.heritage_entry_sources (entry_id, source_title, source_url, publisher, source_tier, supports, retrieved_on)
select e.id, v.source_title, v.source_url, v.publisher, v.source_tier, v.supports, date '2026-09-07'
from (values
('CALCUTTA-CUP-1879', 'The History of the Calcutta Cup', 'https://scottishrugby.org/news-and-features/the-history-of-the-calcutta-cup-2/', 'Scottish Rugby', 'GOVERNING_BODY',
 'The 10 March 1879 drawn first match at Raeburn Place and England''s first win on 28 February 1880.'),
('CALCUTTA-CUP-1879', 'Everything you need to know about the Calcutta Cup', 'https://www.world.rugby/news/574207/calcutta-cup-angleterre-ecosse-rugby-histoire', 'World Rugby', 'GOVERNING_BODY',
 'The trophy''s origin in melted silver rupees and its standing as the oldest in international rugby.'),
('HOME-NATIONS-1883', 'Calcutta Cup History', 'https://www.rugbypass.com/six-nations/info-and-faq/calcutta-cup/', 'RugbyPass', 'POPULAR_HISTORY',
 'That the first Home Nations Championship was held in 1883, four years after the first Calcutta Cup match.'),
('LIONS-1888', '1888-1899 - Touring tradition begins in 19th century', 'https://www.lionsrugby.com/en/history/year-by-year/1888-1899-touring-tradition-begins-in-19th-century', 'British & Irish Lions', 'GOVERNING_BODY',
 'Robert Seddon''s captaincy, the party of 22, the tour length and that it was a private venture.'),
('LIONS-1888', '1888 British Lions tour to New Zealand and Australia', 'https://en.wikipedia.org/wiki/1888_British_Lions_tour_to_New_Zealand_and_Australia', 'Wikipedia', 'ENCYCLOPEDIA',
 'Tour details and its status as the first major European tour of the southern hemisphere.'),
('TWICKENHAM-1909', 'On this day: Twickenham Stadium hosts its first ever game', 'https://www.englandrugby.com/follow/news-and-media/on-this-day-twickenham-stadium-hosts-its-first-ever-game', 'Rugby Football Union', 'GOVERNING_BODY',
 'The 2 October 1909 Harlequins v Richmond match, from the RFU itself.'),
('TWICKENHAM-1909', 'Tales from Twickenham Stadium: Harlequins 14-10 Richmond, 2nd October 1909', 'https://sportsgazette.co.uk/tales-from-twickenham-stadium-harlequins-14-10-richmond-2nd-october-1909/', 'Sports Gazette', 'POPULAR_HISTORY',
 'The 14-10 score, the gentleman''s agreement, Adrian Stoop''s captaincy and the small crowd.'),
('TWICKENHAM-INTERNATIONAL-1910', 'Twickenham Stadium', 'https://en.wikipedia.org/wiki/Twickenham_Stadium', 'Wikipedia', 'ENCYCLOPEDIA',
 'The 15 January 1910 England v Wales international, the 11-6 result and the approximate attendance.'),
('SIX-NATIONS-2000', 'Calcutta Cup History', 'https://www.rugbypass.com/six-nations/info-and-faq/calcutta-cup/', 'RugbyPass', 'POPULAR_HISTORY',
 'The championship''s expansion to six teams in 2000.'),
('LOMU-1995', 'The great Jonah Lomu: England''s Rugby World Cup semi-final against the All Blacks', 'https://www.thenationalnews.com/sport/rugby/the-great-jonah-lomu-england-s-rugby-world-cup-semi-final-against-the-all-blacks-a-reminder-of-an-incredible-watershed-in-rugby-1.926342', 'The National', 'POPULAR_HISTORY',
 'The four tries in the 1995 semi-final and the match''s significance as a watershed.'),
('LOMU-1995', 'How Jonah Lomu''s most famous victim responds to the abuse he still gets 30 years on', 'https://www.planetrugby.com/news/how-jonah-lomus-most-famous-victim-responds-to-the-abuse-he-still-gets-30-years-on-from-1995-incident', 'Planet Rugby', 'POPULAR_HISTORY',
 'The Mike Catt incident and its lasting place in the sport''s imagery.'),
('WEMBLEY-1929', '1928-29 Challenge Cup', 'https://en.wikipedia.org/wiki/1928%E2%80%9329_Challenge_Cup', 'Wikipedia', 'ENCYCLOPEDIA',
 'The 4 May 1929 final, Wigan''s 13-2 win over Dewsbury and the 41,500 attendance.'),
('WEMBLEY-1929', 'Ancient & Loyal - 1929 Challenge Cup', 'https://www.ancientandloyal.com/classic-games/1929-challenge-cup', 'Ancient & Loyal', 'POPULAR_HISTORY',
 'Corroborating detail on the first Wembley final.'),
('STATE-OF-ORIGIN-1980', 'First State of Origin, 1980', 'https://www.nfsa.gov.au/collection/item/first-state-origin-1980', 'National Film and Sound Archive of Australia', 'MUSEUM_OR_ARCHIVE',
 'The 7 July 1980 match at Lang Park, the selection controversy and the players involved.'),
('STATE-OF-ORIGIN-1980', '1980 State of Origin game', 'https://en.wikipedia.org/wiki/1980_State_of_Origin_game', 'Wikipedia', 'ENCYCLOPEDIA',
 'The 20-10 result and the move to a full series from 1982.')
) as v(entry_key, source_title, source_url, publisher, source_tier, supports)
join public.heritage_entries e on e.entry_key = v.entry_key;

-- Re-run the set-level invariants now that the batch is in. The first batch
-- shipped three unsourced entries because nothing checked; this will not.
do $$
declare
  v_bad record;
begin
  for v_bad in select * from public.heritage_content_integrity() where violations > 0 loop
    raise exception 'Heritage content integrity check "%" failed with % violation(s): %',
      v_bad.check_name, v_bad.violations, v_bad.detail;
  end loop;
end $$;
