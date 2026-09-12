-- Rugby Hub Teams & Competitions -- UK Domestic.
--
-- The Hub EXPLAINS competitions; operational products (competitions,
-- competition_editions, competition_edition_teams, Match Centre, Tournament
-- Centre) MANAGE real Ovalball fixtures. This migration touches none of
-- the operational tables -- it adds exactly one new content_type
-- (COMPETITION_GUIDE) to the existing hub_content_items table, three
-- generic nullable editorial-provenance columns (for non-regulatory
-- current-structure claims that still deserve a source), a small
-- (12-item) durable-first corpus of named professional competitions and
-- generic structural explainers, six new Glossary terms, and a handful of
-- sparse hub_content_relationships edges. No new tables, no new
-- relationship tables, no search/recommendation RPC change (both already
-- generalise to any hub_content_items row with zero code change, exactly
-- as Game Knowledge and Officiating proved in earlier slices).
--
-- Deliberately excluded, per the approved design: individual team/club
-- pages (a canonical team-knowledge entity was judged unnecessary --
-- every beginner question this domain must answer is about competition
-- structure, never about one specific team's own history); a competition
-- pyramid/tier schema (real structures are demonstrably volatile --
-- Premiership Rugby abolished automatic promotion/relegation for 2026/27
-- and Super League's own promotion mechanism was still unresolved in the
-- research performed for this migration, so no rigid tier enum is safe to
-- encode); Wales/Scotland/Ireland named competitions (not independently
-- primary-source verified in the time available for this slice -- left
-- for an explicit fast-follow rather than guessed).

-- =====================================================================
-- 1. Content model: one new content_type.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT', 'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE'
]));

-- =====================================================================
-- 2. Generic editorial provenance -- for ordinary current-structure
--    claims (who organises a competition, whether promotion/relegation
--    currently applies) that are NOT regulatory facts and must never be
--    confused with one. Nullable throughout: a timeless explainer (e.g.
--    "Club vs Team") carries no source at all. Deliberately NOT
--    regulatory_sources -- that registry's whole shape (authority_
--    classification, PRIMARY_RULE_BOOK, etc.) is regulatory-specific, and
--    reusing it here would misrepresent an ordinary "here's who currently
--    runs this competition" fact as governing-body law.
-- =====================================================================

alter table public.hub_content_items add column if not exists source_note text;
alter table public.hub_content_items add column if not exists source_url text;
alter table public.hub_content_items add column if not exists source_retrieved_on date;

comment on column public.hub_content_items.source_note is 'Plain-language provenance for an ordinary (non-regulatory) current-structure claim, e.g. "Official Premiership Rugby website". Never phrased as "Law says"/"Regulation says" -- that language is reserved for genuine regulatory_facts content.';
comment on column public.hub_content_items.source_url is 'The primary/official source URL backing a current-structure claim, when the claim is not timeless enough to stand alone.';
comment on column public.hub_content_items.source_retrieved_on is 'The date this specific claim was last checked against its source -- lets an editor know when a volatile claim (e.g. current promotion/relegation policy) needs re-verification.';

-- =====================================================================
-- 3. Seed corpus: 6 named professional competitions (3 Union, 3 League),
--    each researched live against a primary/official source at the time
--    of this migration, plus 6 generic, code-universal structural
--    explainers. All durable-first: no current team counts, no season
--    tables, no sponsor names as identity -- see each fact's own body for
--    how volatility was handled.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_prem uuid; v_pwr uuid; v_champ uuid;
  v_sl uuid; v_champship uuid; v_cc uuid;
  v_tables uuid; v_format uuid; v_promrel uuid; v_pyramid uuid; v_clubteam uuid; v_procomm uuid;

  v_g_league uuid; v_g_cup uuid; v_g_promotion uuid; v_g_relegation uuid; v_g_bonuspoint uuid; v_g_pointsdiff uuid;

  v_gk_scoring uuid;
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
  select id into v_gk_scoring from public.hub_content_items where content_key = 'how-scoring-works';

  -- ============ Named Union competitions ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'premiership-rugby', 'COMPETITION_GUIDE', 'Premiership Rugby', 'The top flight of English men''s domestic club rugby union.',
    'Premiership Rugby is the top tier of English men''s domestic club rugby union, organised by Premiership Rugby Limited. From the 2026/27 season, the competition moved to a ringfenced, franchise-based model: automatic promotion and relegation between Premiership Rugby and the tier below (Champ Rugby) was removed, and a club now joins by meeting a set of criteria rather than by finishing top of the second tier. The competition has stated an ambition to expand its number of clubs later in the decade. This is a genuinely recent and still-settling change — treat any specific promotion/relegation claim about this competition as current rather than permanent.',
    'union', 'Official Premiership Rugby website', 'https://www.premiershiprugby.com/', current_date
  ) returning id into v_prem;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'premiership-womens-rugby', 'COMPETITION_GUIDE', 'Premiership Women''s Rugby (PWR)', 'England''s top-flight domestic women''s club rugby union competition.',
    'Premiership Women''s Rugby (PWR) is the top tier of English women''s domestic club rugby union. It is a first-class competition in its own right, not a women''s version or variant of the men''s Premiership — it has its own clubs, its own season structure and its own governance. PWR has been expanding its reach beyond England, with other home-nation unions expressing interest in entering teams in future seasons — a reminder that a competition''s national scope can change, and that "which nation" is not always a fixed property of a competition.',
    'union', 'Official Premiership Women''s Rugby website', 'https://www.thepwr.com/', current_date
  ) returning id into v_pwr;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'champ-rugby', 'COMPETITION_GUIDE', 'Champ Rugby', 'The second tier of English men''s domestic club rugby union, administered by the RFU.',
    'Champ Rugby (formerly known as the RFU Championship) is the second tier of English men''s domestic club rugby union, sitting below Premiership Rugby and above National League 1. Since the 2026/27 season, there is no automatic promotion from Champ Rugby into Premiership Rugby, following the Premiership''s move to a ringfenced franchise model — but promotion and relegation between Champ Rugby and the level below it continues to operate. This split (one link in the pyramid frozen, another still moving) is a good example of why "promotion and relegation" cannot be described as one single rule across a whole sport.',
    'union', 'Official Champ Rugby website', 'https://www.champrugby.com/', current_date
  ) returning id into v_champ;

  -- ============ Named League competitions ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'super-league', 'COMPETITION_GUIDE', 'Super League', 'The top tier of British rugby league.',
    'Super League is the top tier of British rugby league, run by the Rugby Football League. Membership is not decided by a simple promotion-and-relegation table: clubs are assessed under an independent grading system (commonly known as IMG grading) against criteria including on-field performance, finances and stadium facilities, and the highest-graded clubs take the Super League places. Whether — and how — a more traditional promotion/relegation mechanism sits alongside grading has continued to be reviewed season to season, so treat the exact current mechanism as something to check rather than something fixed.',
    'league', 'Official Rugby Football League competition page', 'https://www.rugby-league.com/competitions/pro-national/betfred-super-league', current_date
  ) returning id into v_sl;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'the-championship-rugby-league', 'COMPETITION_GUIDE', 'The Championship (Rugby League)', 'The second tier of British rugby league, below Super League.',
    'The Championship is the second tier of British rugby league, run by the Rugby Football League, sitting below Super League. Its own shape has recently changed: the competition that used to sit below the Championship (League 1) was merged into an expanded Championship, so a claim about "how many tiers" or "how many teams" below Super League should always be checked against the current season rather than assumed. A club''s route into Super League from the Championship currently runs through the same grading process Super League itself uses, not a guaranteed top-of-the-table promotion.',
    'league', 'Official Rugby Football League competition page', 'https://www.rugby-league.com/competitions/pro-national/betfred-championship', current_date
  ) returning id into v_champship;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values (
    'challenge-cup', 'COMPETITION_GUIDE', 'The Challenge Cup', 'Rugby league''s oldest knockout cup competition, open to clubs from community level up to Super League.',
    'The Challenge Cup is rugby league''s oldest cup competition, held annually since the 1896/97 season — making it the oldest cup competition in either code of rugby. It is a genuine knockout: lose once and you are out. What makes it distinctive is its span — community clubs enter in the earliest rounds, with Championship and then Super League clubs joining in later rounds, so a small club can in principle face a Super League side. The exact number of rounds and exactly which round each tier enters has changed over the competition''s long history and should not be treated as fixed.',
    'league', 'Official Rugby Football League competition page', 'https://www.rugby-league.com/competitions/pro-national/betfred-challenge-cup', current_date
  ) returning id into v_cc;

  -- ============ Generic, code-universal structural explainers ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'how-league-tables-work', 'COMPETITION_GUIDE', 'How League Tables Work', 'What the numbers in a league table actually mean.',
    'A league table ranks teams in a competition using a set of match results. The common columns are: Played (matches completed), Won, Drawn, Lost, Points For and Points Against (total scored and conceded), and Points Difference (the gap between the two). Teams are usually ranked by competition points — points awarded for the result of each match — rather than by points difference alone, though points difference is often used to separate teams level on competition points. Exactly how many competition points a win, a draw or a loss is worth, and whether extra "bonus points" are available, varies between competitions — there is no single universal points system across all of rugby.'
  ) returning id into v_tables;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'league-cup-or-hybrid', 'COMPETITION_GUIDE', 'League vs Cup vs Hybrid', 'The three basic shapes a rugby competition can take.',
    'Most rugby competitions take one of three basic shapes. A league sees every team play a set schedule of matches over a season, ranked in a table by results. A cup (or knockout) is a straight elimination: lose once and the team is out, working down to a final. A hybrid combines the two — for example, an initial group or pool stage decided like a mini-league, feeding into a knockout stage to decide the eventual winner. Recognising which shape a competition uses is the first step to understanding how it works, before learning that competition''s own specific rules.'
  ) returning id into v_format;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'promotion-and-relegation', 'COMPETITION_GUIDE', 'Promotion & Relegation', 'What promotion and relegation mean, and why the exact system is not the same everywhere.',
    'Promotion and relegation is the general idea that a team''s performance in one season can move it between levels of a competition structure — typically the best-performing team(s) at one level moving up, and the worst-performing moving down. It is a common feature of rugby''s domestic pyramids, but it is not applied the same way everywhere, and it is not guaranteed to stay the same over time. Some levels use straightforward top-of-the-table promotion. Others use playoffs between teams finishing near the promotion or relegation places. Some professional competitions have replaced automatic promotion/relegation with criteria-based or grading systems that judge a club against off-field standards (finances, stadium, playing squad) as well as results, or have paused promotion/relegation between two specific levels while keeping it elsewhere in the same pyramid. Always check a specific competition''s own current rules rather than assuming "top goes up, bottom goes down" applies universally.'
  ) returning id into v_promrel;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'the-rugby-pyramid', 'COMPETITION_GUIDE', 'The Rugby Pyramid', 'Why rugby is organised in tiers, from professional to grassroots.',
    'Rugby in the UK (in both codes) is generally organised as a pyramid: a small number of professional or semi-professional clubs at the top, with progressively larger numbers of clubs at each level below, down to community and amateur rugby at the base. A club or player''s level in the pyramid is not a fixed fact about them forever — clubs can move up or down over time (see Promotion & Relegation), and the exact number of levels, and what each level is called, differs between Union and League and has changed more than once in each code''s history. Treat "the pyramid" as a useful mental picture of how the sport is organised, not as a fixed diagram with a permanent number of rungs.'
  ) returning id into v_pyramid;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'club-vs-team', 'COMPETITION_GUIDE', 'Club vs Team', 'A club and a team are not the same thing.',
    'A club is the organisation — the people, the ground, the ongoing entity that exists across seasons and age groups. A team is a specific squad that plays in a specific competition — one club can field several teams at once (for example, a men''s first team, a women''s team, and teams at several youth age groups), and a professional club''s first team is only one of potentially many teams the club runs. When a competition guide refers to "clubs" competing, it usually means each club''s senior first team specifically enters that competition, not every team the club has.'
  ) returning id into v_clubteam;

  insert into public.hub_content_items (content_key, content_type, title, summary, body)
  values (
    'professional-vs-community-rugby', 'COMPETITION_GUIDE', 'Professional vs Community Rugby', 'The difference between the professional/elite game and the community game underneath it.',
    'Professional (or elite) rugby — competitions like Premiership Rugby, Premiership Women''s Rugby, Super League and their equivalents — involves full-time or contracted players and is run as a commercial sport. Community rugby is the much larger base of the pyramid: amateur and semi-professional clubs, run largely by volunteers, playing at regional and local level, plus the age-grade and youth game most players actually grow up in. The two are connected — a knockout competition like the Challenge Cup can bring a community club into contact with elite opposition — but they are organised, funded and administered very differently, and most of rugby''s playing population is in the community game, not the professional game.'
  ) returning id into v_procomm;

  -- ============ Applicability: named competitions are code-specific; explainers are universal ============

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_prem, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_pwr, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_champ, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_sl, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_champship, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id) select v_cc, id from public.regulatory_identities where rugby_code = 'league';

  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items where id in (v_tables, v_format, v_promrel, v_pyramid, v_clubteam, v_procomm);

  -- ============ Publish the corpus ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_prem, v_pwr, v_champ, v_sl, v_champship, v_cc, v_tables, v_format, v_promrel, v_pyramid, v_clubteam, v_procomm);

  -- ============ Sparse content relationships (reusing RELATED_KNOWLEDGE -- no new relationship type) ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_tables, v_promrel, 'RELATED_KNOWLEDGE'), (v_promrel, v_tables, 'RELATED_KNOWLEDGE'),
    (v_format, v_cc, 'RELATED_KNOWLEDGE'), (v_cc, v_format, 'RELATED_KNOWLEDGE'),
    (v_procomm, v_prem, 'RELATED_KNOWLEDGE'), (v_procomm, v_sl, 'RELATED_KNOWLEDGE'),
    (v_prem, v_champ, 'RELATED_KNOWLEDGE'), (v_champ, v_prem, 'RELATED_KNOWLEDGE'),
    (v_sl, v_champship, 'RELATED_KNOWLEDGE'), (v_champship, v_sl, 'RELATED_KNOWLEDGE'),
    (v_clubteam, v_pyramid, 'RELATED_KNOWLEDGE'),
    (v_tables, v_gk_scoring, 'RELATED_KNOWLEDGE');

  -- ============ Six new Glossary terms (checked for collisions before this migration; none found) ============

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('league-competition', 'League', 'A competition where every team plays a set schedule of matches over a season, ranked in a table by results.', v_format) returning id into v_g_league;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('cup-competition', 'Cup', 'A knockout competition — lose once and a team is out — working down to a final.', v_format) returning id into v_g_cup;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('promotion', 'Promotion', 'Moving up to a higher level of a competition structure, usually based on performance — the exact system varies by competition.', v_promrel) returning id into v_g_promotion;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('relegation', 'Relegation', 'Moving down to a lower level of a competition structure, usually based on performance — the exact system varies by competition.', v_promrel) returning id into v_g_relegation;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('bonus-point', 'Bonus Point', 'An extra league-table point some competitions award beyond the basic result — for example for scoring several tries, or for losing narrowly. Not every competition uses bonus points, and where they exist the exact rule differs between competitions.', v_tables) returning id into v_g_bonuspoint;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('points-difference', 'Points Difference', 'The gap between the total points a team has scored and the total it has conceded across a competition — often used to separate teams level on competition points in a league table.', v_tables) returning id into v_g_pointsdiff;

  insert into public.hub_content_applicability (glossary_term_id, is_universal)
  select id, true from public.hub_glossary_terms where id in (v_g_league, v_g_cup, v_g_promotion, v_g_relegation, v_g_bonuspoint, v_g_pointsdiff);

  update public.hub_glossary_terms
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_g_league, v_g_cup, v_g_promotion, v_g_relegation, v_g_bonuspoint, v_g_pointsdiff);

  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values
    (v_g_league, v_format), (v_g_cup, v_format), (v_g_cup, v_cc),
    (v_g_promotion, v_promrel), (v_g_relegation, v_promrel),
    (v_g_bonuspoint, v_tables), (v_g_pointsdiff, v_tables);
end $$;
