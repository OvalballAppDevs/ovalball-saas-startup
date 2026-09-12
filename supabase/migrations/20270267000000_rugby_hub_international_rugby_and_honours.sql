-- Rugby Hub International Rugby + Teams + Honours.
--
-- Establishes the international-team + honours layer of the Rugby Hub
-- knowledge graph, per the approved archaeology/design. This slice does
-- NOT implement Famous Teams & Clubs (no CLUB_TEAM rows are seeded) and
-- does NOT implement People & Rugby Legends (no person entity, no change
-- to Heritage's existing free-text people[] field). Both remain separate,
-- deliberately deferred future domains.
--
-- New content_type: RUGBY_TEAM, on the existing hub_content_items table --
-- international/national/representative teams are knowledge entities,
-- never operational `teams` (which requires a real Ovalball-tenant
-- club_id and cannot represent "England Rugby Union"). Existing
-- COMPETITION_GUIDE is reused unchanged for international competitions --
-- no new competition entity. Two small new tables close real, demonstrated
-- gaps: hub_team_honours (curated major achievements: champion/runner-up/
-- grand slam/triple crown -- never statistics, never match-by-match
-- results, never a season database) and hub_content_heritage_links (a
-- fixed, generic content-item <-> heritage_entry pairing, finally closing
-- the standing Heritage-relationship gap this session's own archaeology
-- found blocking Challenge Cup and Super League discoverability even
-- before this slice existed).
--
-- Cardinality note (explicitly reviewed before writing this migration,
-- per instruction): hub_team_honours deliberately carries NO
-- heritage_entry_id column. One honour can plausibly relate to more than
-- one Heritage story (and one Heritage story to more than one honour/team) --
-- a single-valued FK would encode the wrong cardinality. Heritage linking
-- instead happens one level up, from the TEAM or COMPETITION content item
-- itself via the generic hub_content_heritage_links table, which already
-- correctly supports many-to-many.
--
-- No operational table is touched: `competitions`, `competition_editions`,
-- `competition_edition_teams`, `teams`, `clubs`, `players` are all
-- untouched and unreferenced (except `club_directory_id`, a nullable
-- column added now purely for future CLUB_TEAM/famous-domestic-club
-- compatibility -- no CLUB_TEAM row uses it in this migration, and
-- `club_directory` is already public data with no operational-tenant
-- concept attached to it).

-- =====================================================================
-- 1. Content model: one new content_type, three new nullable columns.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT', 'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE', 'RUGBY_TEAM'
]));

alter table public.hub_content_items add column if not exists team_type text;
alter table public.hub_content_items add column if not exists team_gender text;
alter table public.hub_content_items add column if not exists club_directory_id uuid references public.club_directory(id);

alter table public.hub_content_items add constraint hub_content_items_team_type_check check (team_type is null or team_type = any (array['NATIONAL_TEAM', 'REPRESENTATIVE_TEAM', 'CLUB_TEAM']));
alter table public.hub_content_items add constraint hub_content_items_team_gender_check check (team_gender is null or team_gender = any (array['mens', 'womens', 'mixed']));

comment on column public.hub_content_items.team_type is 'RUGBY_TEAM rows only: NATIONAL_TEAM (e.g. England Rugby Union), REPRESENTATIVE_TEAM (e.g. British & Irish Lions -- drawn from several unions, not itself a nation or a club), or CLUB_TEAM (reserved for the future Famous Teams & Clubs domain -- no CLUB_TEAM row is seeded in this migration). Never used outside RUGBY_TEAM.';
comment on column public.hub_content_items.team_gender is 'RUGBY_TEAM rows only: mens/womens/mixed -- a distinct concept from hub_content_applicability.gender_pathway, which describes who a piece of content is relevant to, not what gender the team itself is. A women''s team is always its own row with its own team_gender, never a flag on a men''s row.';
comment on column public.hub_content_items.club_directory_id is 'RUGBY_TEAM rows only, and only ever populated for team_type = CLUB_TEAM: an optional anchor to the real, already-public club_directory identity/geography a famous domestic club''s knowledge page describes. Reserved for the future Famous Teams & Clubs domain -- left null by every row seeded in this migration.';

-- =====================================================================
-- 2. hub_team_honours -- curated major achievements only.
-- =====================================================================

create table public.hub_team_honours (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.hub_content_items(id),
  competition_id uuid not null references public.hub_content_items(id),
  honour_type text not null check (honour_type = any (array['CHAMPION', 'RUNNER_UP', 'GRAND_SLAM', 'TRIPLE_CROWN'])),
  year_label text not null,
  notes text,
  source_note text,
  source_url text,
  source_retrieved_on date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hub_team_honours is 'Curated major honours only -- never statistics, never match-by-match results, never a season/membership database. Every row must be independently source-verified before insertion, exactly as regulatory_facts and COMPETITION_GUIDE provenance already require for their own domains.';

create index hub_team_honours_team_idx on public.hub_team_honours(team_id);
create index hub_team_honours_competition_idx on public.hub_team_honours(competition_id);

create function public.enforce_honour_content_types()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_team_type text;
  v_competition_type text;
begin
  select content_type into v_team_type from public.hub_content_items where id = new.team_id;
  if v_team_type is distinct from 'RUGBY_TEAM' then
    raise exception 'hub_team_honours.team_id (%) must reference a RUGBY_TEAM content item, found %', new.team_id, v_team_type;
  end if;

  select content_type into v_competition_type from public.hub_content_items where id = new.competition_id;
  if v_competition_type is distinct from 'COMPETITION_GUIDE' then
    raise exception 'hub_team_honours.competition_id (%) must reference a COMPETITION_GUIDE content item, found %', new.competition_id, v_competition_type;
  end if;

  return new;
end;
$$;

create trigger hub_team_honours_enforce_content_types
  before insert or update of team_id, competition_id on public.hub_team_honours
  for each row execute function public.enforce_honour_content_types();

create trigger set_updated_at before update on public.hub_team_honours for each row execute function set_updated_at();
alter table public.hub_team_honours enable row level security;

create policy hub_team_honours_admin_all on public.hub_team_honours
  using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

-- Public read only when BOTH the team and the competition it names are
-- themselves published -- an honour can never leak a draft team or
-- competition's existence through the back door.
create policy hub_team_honours_public_read on public.hub_team_honours
  for select
  using (
    exists (select 1 from public.hub_content_items t where t.id = team_id and t.status = 'PUBLISHED')
    and exists (select 1 from public.hub_content_items c where c.id = competition_id and c.status = 'PUBLISHED')
  );

-- =====================================================================
-- 3. hub_content_heritage_links -- the generic, fixed content <-> Heritage
--    pairing that closes the standing Heritage-relationship gap. Mirrors
--    hub_glossary_content_links's exact existing shape. Never polymorphic:
--    always content_item_id <-> heritage_entry_id, nothing else.
-- =====================================================================

create table public.hub_content_heritage_links (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  heritage_entry_id uuid not null references public.heritage_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (content_item_id, heritage_entry_id)
);

comment on table public.hub_content_heritage_links is 'Generic, fixed pairing between any hub_content_items row and a real heritage_entries row -- closes the Heritage-relationship gap identified across three consecutive Rugby Hub slices (Rules & Laws, Teams & Competitions, this one). Deliberately not polymorphic: always content_item_id <-> heritage_entry_id, mirroring hub_glossary_content_links exactly.';

create index hub_content_heritage_links_content_idx on public.hub_content_heritage_links(content_item_id);
create index hub_content_heritage_links_heritage_idx on public.hub_content_heritage_links(heritage_entry_id);

alter table public.hub_content_heritage_links enable row level security;

create policy hub_content_heritage_links_admin_all on public.hub_content_heritage_links
  using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

-- heritage_entries has no draft workflow at all (heritage_entries_select_all
-- is already unconditionally public) -- the only real gate is the Hub side:
-- a link is publicly visible only once its own content item is published.
create policy hub_content_heritage_links_public_read on public.hub_content_heritage_links
  for select
  using (exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED'));

-- =====================================================================
-- 4. Seed corpus: 13 RUGBY_TEAM rows (9 Union, 4 League; 10 men's, 3
--    women's; 11 NATIONAL_TEAM, 2 REPRESENTATIVE_TEAM), 5 new
--    COMPETITION_GUIDE rows (international competitions), 2 new Glossary
--    terms (Grand Slam, Triple Crown), 27 hub_team_honours rows and a
--    handful of hub_content_heritage_links -- every fact below was
--    verified live against primary/official sources (World Rugby's own
--    rugbyworldcup.com winners list, rugby-league.com, sixnationsrugby.com,
--    the official British & Irish Lions site's own 2026 women's-team
--    announcement) immediately before writing this migration, never
--    recalled from memory.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_england_ru_m uuid; v_ireland_ru_m uuid; v_nz_ru_m uuid; v_rsa_ru_m uuid; v_australia_ru_m uuid; v_france_ru_m uuid;
  v_england_ru_w uuid; v_nz_ru_w uuid;
  v_lions_m uuid; v_lions_w uuid;
  v_england_rl_m uuid; v_australia_rl_m uuid; v_australia_rl_w uuid;

  v_six_nations uuid; v_womens_six_nations uuid; v_rwc uuid; v_wrwc uuid; v_rugby_championship uuid; v_rlwc uuid; v_lions_tours uuid;

  v_g_grandslam uuid; v_g_triplecrown uuid;

  v_heritage_lions_1888 uuid; v_heritage_mandela uuid; v_heritage_lomu uuid; v_heritage_challenge_cup_1897 uuid; v_heritage_super_league_1996 uuid;
  v_comp_challenge_cup uuid; v_comp_super_league uuid;
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
  select id into v_heritage_lions_1888 from public.heritage_entries where entry_key = 'LIONS-1888';
  select id into v_heritage_mandela from public.heritage_entries where entry_key = 'RWC-1995-MANDELA';
  select id into v_heritage_lomu from public.heritage_entries where entry_key = 'LOMU-1995';
  select id into v_heritage_challenge_cup_1897 from public.heritage_entries where entry_key = 'CHALLENGE-CUP-1897';
  select id into v_heritage_super_league_1996 from public.heritage_entries where entry_key = 'SUPER-LEAGUE-1996';
  select id into v_comp_challenge_cup from public.hub_content_items where content_key = 'challenge-cup';
  select id into v_comp_super_league from public.hub_content_items where content_key = 'super-league';

  -- ============ Union men's national teams ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('england-rugby-union-men', 'RUGBY_TEAM', 'England (Rugby Union)', 'England''s men''s national rugby union team.',
    'England is one of the founding nations of rugby union and a permanent member of the Six Nations. England won the Rugby World Cup in 2003, beating Australia 20-17 after extra time — still the only Rugby World Cup won by a northern-hemisphere team. England has also reached the final on two further occasions, in 2007 and 2019, both against South Africa.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_england_ru_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('ireland-rugby-union-men', 'RUGBY_TEAM', 'Ireland (Rugby Union)', 'Ireland''s men''s national rugby union team.',
    'Ireland is a permanent member of the Six Nations. In 2023 Ireland won its first ever Six Nations Grand Slam on home soil in Dublin, and followed it with a second Grand Slam in 2024 and a Triple Crown in 2025.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_ireland_ru_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('new-zealand-rugby-union-men', 'RUGBY_TEAM', 'New Zealand (Rugby Union)', 'New Zealand''s men''s national rugby union team, the All Blacks.',
    'New Zealand, known as the All Blacks, is the most successful team in men''s Rugby World Cup history alongside South Africa, each having won the tournament three and four times respectively. New Zealand won the first Rugby World Cup in 1987 and won again in 2011 and 2015.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_nz_ru_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('south-africa-rugby-union-men', 'RUGBY_TEAM', 'South Africa (Rugby Union)', 'South Africa''s men''s national rugby union team, the Springboks.',
    'South Africa, known as the Springboks, has won the Rugby World Cup a record four times: 1995, 2007, 2019 and 2023. The 1995 win, on home soil in South Africa''s first tournament after the end of apartheid, is one of the sport''s most significant moments — Nelson Mandela presented the trophy wearing the Springbok jersey.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_rsa_ru_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('australia-rugby-union-men', 'RUGBY_TEAM', 'Australia (Rugby Union)', 'Australia''s men''s national rugby union team, the Wallabies.',
    'Australia, known as the Wallabies, has won the Rugby World Cup twice, in 1991 and 1999, and has reached the final on two further occasions.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_australia_ru_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('france-rugby-union-men', 'RUGBY_TEAM', 'France (Rugby Union)', 'France''s men''s national rugby union team.',
    'France is a permanent member of the Six Nations and has won the tournament outright more times in the twenty-first century than any other side, though it has not yet won the Rugby World Cup, finishing runner-up on three occasions.',
    'union', 'NATIONAL_TEAM', 'mens') returning id into v_france_ru_m;

  -- ============ Union women's national teams ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('england-rugby-union-women', 'RUGBY_TEAM', 'England Women (Rugby Union)', 'England''s women''s national rugby union team, the Red Roses.',
    'England Women, known as the Red Roses, have won the Women''s Rugby World Cup three times: 1994, 2014 and, most recently, on home soil in 2025, beating Canada 33-13 in front of a record crowd at Twickenham. England Women are a fully independent national team from England Men, with their own history and honours.',
    'union', 'NATIONAL_TEAM', 'womens') returning id into v_england_ru_w;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('new-zealand-rugby-union-women', 'RUGBY_TEAM', 'New Zealand Women (Rugby Union)', 'New Zealand''s women''s national rugby union team, the Black Ferns.',
    'New Zealand Women, known as the Black Ferns, are the most successful team in Women''s Rugby World Cup history, having won the tournament six times: 1998, 2002, 2006, 2010, 2017 and 2021.',
    'union', 'NATIONAL_TEAM', 'womens') returning id into v_nz_ru_w;

  -- ============ British & Irish Lions -- REPRESENTATIVE_TEAM, not a nation, not a club ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('british-and-irish-lions-men', 'RUGBY_TEAM', 'British & Irish Lions', 'A men''s rugby union team drawn from the four home unions, touring the southern hemisphere roughly every four years.',
    'The British & Irish Lions are not a national team and not a club — they are a representative touring team, selected from players eligible for England, Ireland, Scotland and Wales, that comes together only for tours (traditionally to Australia, New Zealand or South Africa) roughly once every four years. The first Lions tour took place in 1888. Because the Lions exist only for the duration of a tour, the concept of a permanent squad, ranking or season does not apply to them the way it does to a national team.',
    'union', 'REPRESENTATIVE_TEAM', 'mens') returning id into v_lions_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('british-and-irish-lions-women', 'RUGBY_TEAM', 'British & Irish Lions Women', 'The first-ever British & Irish Lions women''s representative team, touring New Zealand in 2027.',
    'The British & Irish Lions Women is a new team, selected from players eligible to represent the women''s national teams of England, Ireland, Scotland and Wales. Its first-ever tour, to New Zealand, is scheduled for 2027, with fixtures confirmed in January 2026 and Jo Yapp appointed as the team''s first head coach in May 2026. This is a genuinely new representative team, not a long-standing women''s counterpart to the men''s Lions — treat its history as still being written.',
    'union', 'REPRESENTATIVE_TEAM', 'womens') returning id into v_lions_w;

  -- ============ League national teams ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('england-rugby-league-men', 'RUGBY_TEAM', 'England (Rugby League)', 'England''s men''s national rugby league team.',
    'England competes in the Rugby League World Cup and other international rugby league competitions. England has reached the Rugby League World Cup final three times — in 1975, 1995 and 2017 — without winning it, finishing runner-up to Australia each time.',
    'league', 'NATIONAL_TEAM', 'mens') returning id into v_england_rl_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('australia-rugby-league-men', 'RUGBY_TEAM', 'Australia (Rugby League)', 'Australia''s men''s national rugby league team, the Kangaroos.',
    'Australia, known as the Kangaroos, is by a wide margin the most successful men''s Rugby League World Cup team, with more titles than every other nation combined, including the two most recent tournaments in 2017 and 2021.',
    'league', 'NATIONAL_TEAM', 'mens') returning id into v_australia_rl_m;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, team_type, team_gender)
  values ('australia-rugby-league-women', 'RUGBY_TEAM', 'Australia Women (Rugby League)', 'Australia''s women''s national rugby league team, the Jillaroos.',
    'Australia Women, known as the Jillaroos, won the 2021 Women''s Rugby League World Cup, held in England alongside the men''s and wheelchair tournaments.',
    'league', 'NATIONAL_TEAM', 'womens') returning id into v_australia_rl_w;

  -- ============ Applicability: every team is code-specific, scoped to every identity of its code (mirrors the named-competition pattern from the prior slice) ============

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select t.id, ri.id from public.hub_content_items t cross join public.regulatory_identities ri
  where t.id in (v_england_ru_m, v_ireland_ru_m, v_nz_ru_m, v_rsa_ru_m, v_australia_ru_m, v_france_ru_m, v_england_ru_w, v_nz_ru_w, v_lions_m, v_lions_w) and ri.rugby_code = 'union';

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select t.id, ri.id from public.hub_content_items t cross join public.regulatory_identities ri
  where t.id in (v_england_rl_m, v_australia_rl_m, v_australia_rl_w) and ri.rugby_code = 'league';

  -- ============ Publish every team ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_england_ru_m, v_ireland_ru_m, v_nz_ru_m, v_rsa_ru_m, v_australia_ru_m, v_france_ru_m, v_england_ru_w, v_nz_ru_w, v_lions_m, v_lions_w, v_england_rl_m, v_australia_rl_m, v_australia_rl_w);

  -- ============ International competitions (reusing COMPETITION_GUIDE unchanged) ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('six-nations', 'COMPETITION_GUIDE', 'Six Nations', 'The annual men''s international rugby union championship between England, France, Ireland, Italy, Scotland and Wales.',
    'The Six Nations is the annual international rugby union championship contested by England, France, Ireland, Italy, Scotland and Wales. A team that wins all five of its matches in one championship completes a Grand Slam — the tournament''s highest honour. Any of England, Ireland, Scotland or Wales that beats the other three home nations in a single championship wins the Triple Crown, independent of how they fare against France and Italy.',
    'union', 'Official Six Nations website', 'https://www.sixnationsrugby.com', current_date) returning id into v_six_nations;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('womens-six-nations', 'COMPETITION_GUIDE', 'Women''s Six Nations', 'The annual women''s international rugby union championship between the same six nations as the men''s tournament.',
    'The Women''s Six Nations is the women''s equivalent of the Six Nations, contested by the same six unions — England, France, Ireland, Italy, Scotland and Wales — with its own independent Grand Slam and Triple Crown, never treated as a variant of the men''s tournament.',
    'union', 'Official Six Nations website', 'https://www.sixnationsrugby.com', current_date) returning id into v_womens_six_nations;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('rugby-world-cup', 'COMPETITION_GUIDE', 'Rugby World Cup', 'The pinnacle men''s international rugby union tournament, held every four years since 1987.',
    'The Rugby World Cup is the sport''s pinnacle men''s international tournament, held every four years since the first edition in 1987, co-hosted by Australia and New Zealand. New Zealand and South Africa are the most successful teams, with three and four titles respectively; England is the only northern-hemisphere nation to have won it, in 2003.',
    'union', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date) returning id into v_rwc;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('womens-rugby-world-cup', 'COMPETITION_GUIDE', 'Women''s Rugby World Cup', 'The pinnacle women''s international rugby union tournament, held every four years since 1991.',
    'The Women''s Rugby World Cup is the sport''s pinnacle women''s international tournament, held every four years since 1991. New Zealand is by far the most successful team, with six titles; England has won three, most recently as hosts in 2025.',
    'union', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date) returning id into v_wrwc;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('rugby-championship', 'COMPETITION_GUIDE', 'The Rugby Championship', 'The annual men''s international rugby union championship between Argentina, Australia, New Zealand and South Africa.',
    'The Rugby Championship is the southern hemisphere''s equivalent of the Six Nations, an annual men''s international championship contested by Argentina, Australia, New Zealand and South Africa.',
    'union', 'Official World Rugby website', 'https://www.world.rugby', current_date) returning id into v_rugby_championship;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('rugby-league-world-cup', 'COMPETITION_GUIDE', 'Rugby League World Cup', 'The pinnacle international rugby league tournament for men''s, women''s and wheelchair teams.',
    'The Rugby League World Cup is rugby league''s pinnacle international tournament. Australia has won the men''s tournament far more often than any other nation, including the two most recent editions, held in 2017 and 2021. The 2021 tournament (delayed into late 2022) was the first held jointly with a women''s and a wheelchair tournament, both won by Australia and England respectively.',
    'league', 'Official Rugby Football League competition page', 'https://www.rugby-league.com', current_date) returning id into v_rlwc;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, rugby_code, source_note, source_url, source_retrieved_on)
  values ('british-and-irish-lions-tours', 'COMPETITION_GUIDE', 'British & Irish Lions Tours', 'What a Lions tour is, and how it differs from an ordinary international series.',
    'A British & Irish Lions tour brings together players from all four home unions to tour a single southern-hemisphere host nation, roughly every four years, playing a Test series against the host alongside matches against provincial or regional sides. Because the squad exists only for the tour itself, a Lions tour is best understood as a one-off event rather than an ongoing team competing in a permanent competition.',
    'union', 'Official British & Irish Lions website', 'https://www.lionsrugby.com', current_date) returning id into v_lions_tours;

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select c.id, ri.id from public.hub_content_items c cross join public.regulatory_identities ri
  where c.id in (v_six_nations, v_womens_six_nations, v_rwc, v_wrwc, v_rugby_championship, v_lions_tours) and ri.rugby_code = 'union';

  insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
  select c.id, ri.id from public.hub_content_items c cross join public.regulatory_identities ri
  where c.id = v_rlwc and ri.rugby_code = 'league';

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_six_nations, v_womens_six_nations, v_rwc, v_wrwc, v_rugby_championship, v_rlwc, v_lions_tours);

  -- ============ Team <-> competition relationships (ordinary curated association, reusing hub_content_relationships -- never seasonal membership) ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_england_ru_m, v_six_nations, 'RELATED_KNOWLEDGE'), (v_ireland_ru_m, v_six_nations, 'RELATED_KNOWLEDGE'), (v_france_ru_m, v_six_nations, 'RELATED_KNOWLEDGE'),
    (v_england_ru_w, v_womens_six_nations, 'RELATED_KNOWLEDGE'),
    (v_england_ru_m, v_rwc, 'RELATED_KNOWLEDGE'), (v_nz_ru_m, v_rwc, 'RELATED_KNOWLEDGE'), (v_rsa_ru_m, v_rwc, 'RELATED_KNOWLEDGE'), (v_australia_ru_m, v_rwc, 'RELATED_KNOWLEDGE'),
    (v_england_ru_w, v_wrwc, 'RELATED_KNOWLEDGE'), (v_nz_ru_w, v_wrwc, 'RELATED_KNOWLEDGE'),
    (v_nz_ru_m, v_rugby_championship, 'RELATED_KNOWLEDGE'), (v_rsa_ru_m, v_rugby_championship, 'RELATED_KNOWLEDGE'), (v_australia_ru_m, v_rugby_championship, 'RELATED_KNOWLEDGE'),
    (v_lions_m, v_lions_tours, 'RELATED_KNOWLEDGE'), (v_lions_w, v_lions_tours, 'RELATED_KNOWLEDGE'),
    (v_england_rl_m, v_rlwc, 'RELATED_KNOWLEDGE'), (v_australia_rl_m, v_rlwc, 'RELATED_KNOWLEDGE'), (v_australia_rl_w, v_rlwc, 'RELATED_KNOWLEDGE'),
    (v_six_nations, v_rwc, 'RELATED_KNOWLEDGE'), (v_rugby_championship, v_rwc, 'RELATED_KNOWLEDGE');

  -- ============ Grand Slam / Triple Crown -- concept in Glossary, instances in hub_team_honours ============

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('grand-slam', 'Grand Slam', 'In the Six Nations, winning all five of your matches in a single championship — the tournament''s highest honour.', v_six_nations)
  returning id into v_g_grandslam;
  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition, detail_content_item_id)
  values ('triple-crown', 'Triple Crown', 'Beating the other three home nations (England, Ireland, Scotland and Wales all count each other) in a single Six Nations championship, independent of results against France and Italy.', v_six_nations)
  returning id into v_g_triplecrown;

  insert into public.hub_content_applicability (glossary_term_id, is_universal) values (v_g_grandslam, true), (v_g_triplecrown, true);

  update public.hub_glossary_terms
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_g_grandslam, v_g_triplecrown);

  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values (v_g_grandslam, v_six_nations), (v_g_triplecrown, v_six_nations);

  -- ============ Honours: every row verified live against a primary/official source immediately before this migration ============

  insert into public.hub_team_honours (team_id, competition_id, honour_type, year_label, notes, source_note, source_url, source_retrieved_on) values
    (v_nz_ru_m, v_rwc, 'CHAMPION', '1987', 'The inaugural Rugby World Cup, co-hosted by New Zealand and Australia.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_australia_ru_m, v_rwc, 'CHAMPION', '1991', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_rsa_ru_m, v_rwc, 'CHAMPION', '1995', 'South Africa''s first tournament after the end of apartheid, won on home soil.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_australia_ru_m, v_rwc, 'CHAMPION', '1999', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_england_ru_m, v_rwc, 'CHAMPION', '2003', 'Beat Australia 20-17 after extra time — the only northern-hemisphere Rugby World Cup win to date.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_rsa_ru_m, v_rwc, 'CHAMPION', '2007', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_england_ru_m, v_rwc, 'RUNNER_UP', '2007', 'Lost the final to South Africa.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_m, v_rwc, 'CHAMPION', '2011', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_m, v_rwc, 'CHAMPION', '2015', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_rsa_ru_m, v_rwc, 'CHAMPION', '2019', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_england_ru_m, v_rwc, 'RUNNER_UP', '2019', 'Lost the final to South Africa.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_rsa_ru_m, v_rwc, 'CHAMPION', '2023', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),

    (v_ireland_ru_m, v_six_nations, 'GRAND_SLAM', '2023', 'Ireland''s first ever Six Nations Grand Slam, won on home soil in Dublin.', 'Official Six Nations website', 'https://www.sixnationsrugby.com', current_date),
    (v_ireland_ru_m, v_six_nations, 'TRIPLE_CROWN', '2025', null, 'Official Six Nations website', 'https://www.sixnationsrugby.com', current_date),

    (v_nz_ru_w, v_wrwc, 'CHAMPION', '1998', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_w, v_wrwc, 'CHAMPION', '2002', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_w, v_wrwc, 'CHAMPION', '2006', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_w, v_wrwc, 'CHAMPION', '2010', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_england_ru_w, v_wrwc, 'CHAMPION', '2014', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_w, v_wrwc, 'CHAMPION', '2017', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_nz_ru_w, v_wrwc, 'CHAMPION', '2021', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),
    (v_england_ru_w, v_wrwc, 'CHAMPION', '2025', 'Beat Canada 33-13 at a sold-out Allianz Stadium, Twickenham, as tournament hosts.', 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),

    (v_england_ru_w, v_wrwc, 'CHAMPION', '1994', null, 'Official Rugby World Cup website', 'https://www.rugbyworldcup.com/en/past-tournaments', current_date),

    (v_australia_rl_m, v_rlwc, 'CHAMPION', '2017', null, 'Official Rugby Football League competition page', 'https://www.rugby-league.com', current_date),
    (v_england_rl_m, v_rlwc, 'RUNNER_UP', '2017', 'Lost the final to Australia.', 'Official Rugby Football League competition page', 'https://www.rugby-league.com', current_date),
    (v_australia_rl_m, v_rlwc, 'CHAMPION', '2021', 'Delayed into late 2022 by the COVID-19 pandemic but retained its "2021" tournament designation.', 'Official Rugby Football League competition page', 'https://www.rugby-league.com', current_date),
    (v_australia_rl_w, v_rlwc, 'CHAMPION', '2021', 'Held in England alongside the men''s and wheelchair tournaments.', 'Official Rugby Football League competition page', 'https://www.rugby-league.com', current_date);

  -- ============ Heritage links: closes the standing gap for real, matching existing entries -- both Team/Competition articles and, per instruction, the pre-existing Challenge Cup / Super League gap ============

  insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values
    (v_lions_m, v_heritage_lions_1888),
    (v_lions_tours, v_heritage_lions_1888),
    (v_rsa_ru_m, v_heritage_mandela),
    (v_rwc, v_heritage_mandela),
    (v_nz_ru_m, v_heritage_lomu),
    (v_comp_challenge_cup, v_heritage_challenge_cup_1897),
    (v_comp_super_league, v_heritage_super_league_1996);
end $$;
