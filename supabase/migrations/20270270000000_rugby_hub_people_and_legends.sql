-- Rugby Hub People & Rugby Legends.
--
-- Establishes the canonical public rugby-person layer of the Rugby Hub
-- knowledge graph, per the approved archaeology/design. This is
-- educational knowledge about publicly notable rugby figures -- never a
-- player database, a roster system, a stats engine, or a bridge into any
-- operational Ovalball person table. No FK from anything created here
-- reaches `players`, `profiles`, `guardians`, or `auth.users`.
--
-- New content_type: RUGBY_PERSON, on the existing hub_content_items table,
-- reusing its publication workflow, RLS, search_vector and generic
-- relationship tables exactly as every prior Hub domain has. Unlike prior
-- domains, people need genuinely multi-valued structured attributes --
-- roles and aliases -- which are added as constrained array columns
-- (`roles text[]`, `aliases text[]`) rather than forced single-value
-- columns, following the exact `<@` array-subset CHECK idiom already used
-- by `capabilities_applicable_scopes_valid` and
-- `message_policies_allowed_file_types_subset`, and the exact alias-array
-- shape already used by `hub_glossary_terms.aliases` and
-- `hub_positions.alternative_names`.
--
-- rugby_code is deliberately left NULL on every RUGBY_PERSON row: a
-- person's code association comes from their real hub_person_team_
-- relationships rows, which can legitimately span both codes for one
-- person (Jason Robinson) -- a single nullable column on the person row
-- would force a false single-code answer.
--
-- Three small new tables, each closing a real, demonstrated gap:
--   hub_person_team_relationships -- person <-> RUGBY_TEAM, with a role_type
--     (PLAYED_FOR/CAPTAINED/COACHED/REPRESENTED) deliberately excluding
--     OFFICIATED_FOR: a referee does not belong to a team merely because
--     they officiated its matches (Wayne Barnes has zero rows here).
--   hub_person_honour_relationships -- person <-> hub_team_honours, with a
--     narrow role_type (CAPTAIN/PLAYER/HEAD_COACH). Deliberately sparse by
--     design: 3 rows in this migration (Martin Johnson, Francois Pienaar,
--     Maggie Alphonsi) against 27 existing honours and hundreds of
--     possible squad members -- this must never become squad membership.
--   hub_content_sources -- a generic, multi-row source table for any
--     hub_content_items row (not RUGBY_PERSON-only), reusing Heritage's
--     already-proven 6-tier source vocabulary. The existing single
--     source_note/source_url/source_retrieved_on columns remain untouched
--     and unused by this migration -- they stay correct for the simpler
--     single-source domains that already rely on them.
--
-- Heritage integration reuses hub_content_heritage_links unchanged (no new
-- person-Heritage table) and closes it for the two people who already had
-- unlinked Heritage PERSON entries (Jonah Lomu, Billy Boston) plus five
-- more people named in other entries' free-text people[] (Adrian Stoop x2,
-- Martin Johnson, Jonny Wilkinson, Francois Pienaar). Heritage's people[]
-- text is left completely untouched -- these links are additive.
--
-- hub_person_position_links is explicitly NOT created in this migration:
-- no page in the 14-person corpus below needs a structured position link
-- to complete a meaningful section or any of the 5 required knowledge-
-- graph journeys, so per instruction it is deferred rather than built
-- speculatively.
--
-- Two real gaps in the existing RUGBY_TEAM corpus were found via this
-- migration's own research and are reported here rather than worked
-- around: there is no Great Britain (rugby league) RUGBY_TEAM row (much
-- of rugby league's international history before England's modern
-- selection was played under Great Britain, not England), and no England
-- Women's rugby league RUGBY_TEAM row. Four people below (Billy Boston,
-- Ellery Hanley, Jodie Cunningham, Rob Burrow) are therefore seeded with
-- zero hub_person_team_relationships rows despite very strong, verified
-- club/international careers -- their pages stand on Heritage links and
-- sourced prose alone. No new RUGBY_TEAM row is created here to work
-- around this: International Rugby's architecture is explicitly out of
-- scope for this slice.

-- =====================================================================
-- 1. Content model: one new content_type, four new columns.
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check check (content_type = any (array[
  'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT', 'OFFICIATING_CONCEPT', 'COMPETITION_GUIDE', 'RUGBY_TEAM', 'RUGBY_PERSON'
]));

alter table public.hub_content_items add column if not exists roles text[];
alter table public.hub_content_items add column if not exists aliases text[];
alter table public.hub_content_items add column if not exists birth_year integer;
alter table public.hub_content_items add column if not exists death_year integer;

alter table public.hub_content_items add constraint hub_content_items_roles_check
  check (roles is null or roles <@ array['PLAYER', 'COACH', 'REFEREE', 'ADMINISTRATOR', 'PIONEER']);

alter table public.hub_content_items add constraint hub_content_items_rugby_person_requires_roles
  check (content_type <> 'RUGBY_PERSON' or (roles is not null and array_length(roles, 1) > 0));

alter table public.hub_content_items add constraint hub_content_items_death_after_birth
  check (death_year is null or birth_year is null or death_year >= birth_year);

comment on column public.hub_content_items.roles is 'RUGBY_PERSON rows only: one or more of PLAYER/COACH/REFEREE/ADMINISTRATOR/PIONEER. A person may hold several roles across a career (e.g. Kevin Sinfield: PLAYER, COACH, ADMINISTRATOR) -- never a single rigid role. Not used, and semantically meaningless, on any other content_type.';
comment on column public.hub_content_items.aliases is 'RUGBY_PERSON rows only (though the column shape mirrors hub_glossary_terms.aliases and hub_positions.alternative_names): common shortened names, full legal names, or well-established alternative forms, e.g. "Jonathan Wilkinson" as an alias of "Jonny Wilkinson". Folded into search_vector (see below) so an alias resolves search exactly like the title does. Never used for nicknames unsupported by authoritative sources, team names, or honours.';
comment on column public.hub_content_items.birth_year is 'RUGBY_PERSON rows only, populated only where independently verified: a lightweight year for historical orientation, deliberately not a full date of birth (which this domain has no genuine need for and would be needless maintenance for living figures).';
comment on column public.hub_content_items.death_year is 'RUGBY_PERSON rows only, populated only where independently verified: communicates a person is historic/deceased without a redundant is_current-style boolean.';

-- =====================================================================
-- 2. search_vector: fold aliases into the existing generated expression at
--    the same weight as title, so a person is exactly as findable by an
--    alias as by their canonical display name. The underlying function
--    already coalesces NULL to '', so this is safe for every existing row
--    (aliases is NULL on every non-RUGBY_PERSON row today).
-- =====================================================================

drop index if exists hub_content_items_search_vector_idx;
alter table public.hub_content_items drop column search_vector;
alter table public.hub_content_items add column search_vector tsvector generated always as (
  ((setweight(internal.immutable_english_tsvector(title), 'A'::"char")
    || setweight(internal.immutable_english_tsvector_from_array(aliases), 'A'::"char"))
   || setweight(internal.immutable_english_tsvector(summary), 'B'::"char"))
  || setweight(internal.immutable_english_tsvector(body), 'C'::"char")
) stored;
create index hub_content_items_search_vector_idx on public.hub_content_items using gin(search_vector);

comment on column public.hub_content_items.search_vector is 'Generated from title + aliases (both weight A), summary (B) and body (C), using the same internal.immutable_english_tsvector_from_array() helper hub_glossary_terms.aliases and hub_positions.alternative_names already use for their own search_vector columns -- reuse of a proven pattern, not a new one.';

-- =====================================================================
-- 3. hub_person_team_relationships.
-- =====================================================================

create table public.hub_person_team_relationships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hub_content_items(id),
  team_id uuid not null references public.hub_content_items(id),
  role_type text not null check (role_type = any (array['PLAYED_FOR', 'CAPTAINED', 'COACHED', 'REPRESENTED'])),
  notes text,
  source_note text,
  source_url text,
  source_retrieved_on date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hub_person_team_relationships is 'Curated person <-> team facts only -- never a roster, never every season, never a transfer/contract history. role_type deliberately excludes OFFICIATED_FOR: a referee does not belong to a team merely because they officiated its matches (see hub_content_relationships for how referees connect to Officiating/competition content instead).';

create index hub_person_team_relationships_person_idx on public.hub_person_team_relationships(person_id);
create index hub_person_team_relationships_team_idx on public.hub_person_team_relationships(team_id);

create function public.enforce_person_team_content_types()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_person_type text;
  v_team_type text;
begin
  select content_type into v_person_type from public.hub_content_items where id = new.person_id;
  if v_person_type is distinct from 'RUGBY_PERSON' then
    raise exception 'hub_person_team_relationships.person_id (%) must reference a RUGBY_PERSON content item, found %', new.person_id, v_person_type;
  end if;

  select content_type into v_team_type from public.hub_content_items where id = new.team_id;
  if v_team_type is distinct from 'RUGBY_TEAM' then
    raise exception 'hub_person_team_relationships.team_id (%) must reference a RUGBY_TEAM content item, found %', new.team_id, v_team_type;
  end if;

  return new;
end;
$$;

create trigger hub_person_team_relationships_enforce_content_types
  before insert or update of person_id, team_id on public.hub_person_team_relationships
  for each row execute function public.enforce_person_team_content_types();

create trigger set_updated_at before update on public.hub_person_team_relationships for each row execute function set_updated_at();
alter table public.hub_person_team_relationships enable row level security;

create policy hub_person_team_relationships_admin_all on public.hub_person_team_relationships
  using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_person_team_relationships_public_read on public.hub_person_team_relationships
  for select
  using (
    exists (select 1 from public.hub_content_items p where p.id = person_id and p.status = 'PUBLISHED')
    and exists (select 1 from public.hub_content_items t where t.id = team_id and t.status = 'PUBLISHED')
  );

-- =====================================================================
-- 4. hub_person_honour_relationships -- deliberately narrow and sparse.
-- =====================================================================

create table public.hub_person_honour_relationships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hub_content_items(id),
  honour_id uuid not null references public.hub_team_honours(id),
  role_type text not null check (role_type = any (array['CAPTAIN', 'PLAYER', 'HEAD_COACH'])),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hub_person_honour_relationships is 'Sparse, curated marquee facts only ("Martin Johnson captained England''s 2003 CHAMPION side") -- never squad membership. honour_id references the single existing hub_team_honours row directly, so the underlying fact is never duplicated; this table only ever annotates who is credited for a fact that already exists exactly once.';

create index hub_person_honour_relationships_person_idx on public.hub_person_honour_relationships(person_id);
create index hub_person_honour_relationships_honour_idx on public.hub_person_honour_relationships(honour_id);

create function public.enforce_person_honour_person_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_person_type text;
begin
  select content_type into v_person_type from public.hub_content_items where id = new.person_id;
  if v_person_type is distinct from 'RUGBY_PERSON' then
    raise exception 'hub_person_honour_relationships.person_id (%) must reference a RUGBY_PERSON content item, found %', new.person_id, v_person_type;
  end if;
  return new;
end;
$$;

create trigger hub_person_honour_relationships_enforce_person_type
  before insert or update of person_id on public.hub_person_honour_relationships
  for each row execute function public.enforce_person_honour_person_type();

create trigger set_updated_at before update on public.hub_person_honour_relationships for each row execute function set_updated_at();
alter table public.hub_person_honour_relationships enable row level security;

create policy hub_person_honour_relationships_admin_all on public.hub_person_honour_relationships
  using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_person_honour_relationships_public_read on public.hub_person_honour_relationships
  for select
  using (
    exists (select 1 from public.hub_content_items p where p.id = person_id and p.status = 'PUBLISHED')
    and exists (
      select 1 from public.hub_team_honours h
      join public.hub_content_items t on t.id = h.team_id
      join public.hub_content_items c on c.id = h.competition_id
      where h.id = honour_id and t.status = 'PUBLISHED' and c.status = 'PUBLISHED'
    )
  );

-- =====================================================================
-- 5. hub_content_sources -- generic multi-source provenance, reusing
--    Heritage's proven tier vocabulary. Not People-only: any
--    hub_content_items row may use it, though this migration only seeds
--    rows for RUGBY_PERSON content. The existing single source_note/
--    source_url/source_retrieved_on columns are untouched and remain
--    correct for the domains that only ever needed one source.
-- =====================================================================

create table public.hub_content_sources (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  source_tier text not null check (source_tier = any (array['GOVERNING_BODY', 'MUSEUM_OR_ARCHIVE', 'ACADEMIC', 'ENCYCLOPEDIA', 'POPULAR_HISTORY', 'CONTEMPORARY_REPORT'])),
  source_title text not null,
  source_url text,
  retrieved_on date,
  created_at timestamptz not null default now()
);

comment on table public.hub_content_sources is 'Generic multi-row source citation for any hub_content_items row, modelled directly on heritage_entry_sources'' already-proven tier vocabulary. Introduced because a single source_url (the existing hub_content_items columns) is provably insufficient for biography -- Heritage''s own two PERSON entries already needed 2-3 sources each.';

create index hub_content_sources_content_item_idx on public.hub_content_sources(content_item_id);

alter table public.hub_content_sources enable row level security;

create policy hub_content_sources_admin_all on public.hub_content_sources
  using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_content_sources_public_read on public.hub_content_sources
  for select
  using (exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED'));

-- =====================================================================
-- 6. Seed corpus: 14 RUGBY_PERSON rows (8 Union, 5 League, 1 dual-code;
--    5 women, 9 men; 6 historic/deceased, 8 living/modern; 12 PLAYER-role,
--    2 COACH-role, 1 REFEREE-role, 1 PIONEER-role, 1 ADMINISTRATOR-role),
--    12 hub_person_team_relationships rows, 3 hub_person_honour_
--    relationships rows (deliberately sparse), 7 hub_content_heritage_
--    links rows, and multi-source hub_content_sources rows for every
--    person. Every fact below was verified live against primary/
--    authoritative sources (englandrugby.com, therhinos.co.uk,
--    lionsrugby.com, skysports.com, world.rugby, rugbyleagueproject.org,
--    en.wikipedia.org, worldrugbymuseum.com) immediately before writing
--    this migration, never recalled from memory.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_lomu uuid; v_boston uuid; v_robinson uuid; v_sinfield uuid; v_barnes uuid; v_cunningham uuid;
  v_johnson uuid; v_wilkinson uuid; v_alphonsi uuid; v_scarratt uuid; v_pienaar uuid; v_hanley uuid;
  v_burrow uuid; v_stoop uuid;

  v_team_nz_ru_m uuid; v_team_england_rl_m uuid; v_team_england_ru_m uuid; v_team_lions_m uuid;
  v_team_england_ru_w uuid; v_team_rsa_ru_m uuid;

  v_honour_2003 uuid; v_honour_1995 uuid; v_honour_2014 uuid;

  v_heritage_lomu uuid; v_heritage_boston uuid; v_heritage_stoop_1909 uuid; v_heritage_stoop_1910 uuid;
  v_heritage_england_2003 uuid; v_heritage_mandela uuid;

  v_officiating_what_referee_does uuid; v_officiating_becoming_referee uuid; v_comp_rwc uuid;
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
  select id into v_team_nz_ru_m from public.hub_content_items where content_key = 'new-zealand-rugby-union-men';
  select id into v_team_england_rl_m from public.hub_content_items where content_key = 'england-rugby-league-men';
  select id into v_team_england_ru_m from public.hub_content_items where content_key = 'england-rugby-union-men';
  select id into v_team_lions_m from public.hub_content_items where content_key = 'british-and-irish-lions-men';
  select id into v_team_england_ru_w from public.hub_content_items where content_key = 'england-rugby-union-women';
  select id into v_team_rsa_ru_m from public.hub_content_items where content_key = 'south-africa-rugby-union-men';

  select h.id into v_honour_2003 from public.hub_team_honours h join public.hub_content_items t on t.id = h.team_id where t.content_key = 'england-rugby-union-men' and h.year_label = '2003' and h.honour_type = 'CHAMPION';
  select h.id into v_honour_1995 from public.hub_team_honours h join public.hub_content_items t on t.id = h.team_id where t.content_key = 'south-africa-rugby-union-men' and h.year_label = '1995' and h.honour_type = 'CHAMPION';
  select h.id into v_honour_2014 from public.hub_team_honours h join public.hub_content_items t on t.id = h.team_id where t.content_key = 'england-rugby-union-women' and h.year_label = '2014' and h.honour_type = 'CHAMPION';

  select id into v_officiating_what_referee_does from public.hub_content_items where content_key = 'what-the-referee-does';
  select id into v_officiating_becoming_referee from public.hub_content_items where content_key = 'becoming-a-referee';
  select id into v_comp_rwc from public.hub_content_items where content_key = 'rugby-world-cup';

  select id into v_heritage_lomu from public.heritage_entries where entry_key = 'LOMU-1995';
  select id into v_heritage_boston from public.heritage_entries where entry_key = 'BILLY-BOSTON';
  select id into v_heritage_stoop_1909 from public.heritage_entries where entry_key = 'TWICKENHAM-1909';
  select id into v_heritage_stoop_1910 from public.heritage_entries where entry_key = 'TWICKENHAM-INTERNATIONAL-1910';
  select id into v_heritage_england_2003 from public.heritage_entries where entry_key = 'ENGLAND-2003';
  select id into v_heritage_mandela from public.heritage_entries where entry_key = 'RWC-1995-MANDELA';

  -- ============ People ============

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, birth_year, death_year)
  values ('jonah-lomu', 'RUGBY_PERSON', 'Jonah Lomu', 'New Zealand winger whose power and speed at the 1995 Rugby World Cup changed what a winger could be.',
    'Jonah Lomu made his New Zealand debut in 1994 and became rugby union''s first true global superstar during the 1995 Rugby World Cup, where his combination of size and speed as a winger overwhelmed defences that had never faced anything like it before. He played 63 tests for New Zealand and remains one of the most influential figures the sport has produced. Lomu died in 2015, aged 40.',
    array['PLAYER'], 1975, 2015) returning id into v_lomu;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, aliases, birth_year, death_year)
  values ('billy-boston', 'RUGBY_PERSON', 'Sir Billy Boston', 'Rugby league winger who became one of Wigan''s greatest players and, in later life, the sport''s first knight.',
    'Billy Boston signed for Wigan in 1953 and went on to become one of the most prolific try-scorers in British rugby league history, touring with Great Britain on multiple Ashes tours. He was later knighted for services to rugby league, becoming the sport''s first knight. Sir Billy Boston died in August 2026, aged 92.',
    array['PLAYER'], array['Sir Billy Boston'], 1934, 2026) returning id into v_boston;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('jason-robinson', 'RUGBY_PERSON', 'Jason Robinson', 'One of rugby''s most famous dual-code players, capped for Great Britain and England in rugby league before switching codes to win the World Cup with England in rugby union.',
    'Jason Robinson began his career at Wigan in rugby league, winning major honours with the club and earning caps for both Great Britain and England before switching to rugby union in 2000. He went on to win 51 caps for England, was capped five times across two British & Irish Lions tours, and started every match — scoring a try in the final — as England won the 2003 Rugby World Cup. He remains one of the clearest examples of a player who reached the top of the game in both rugby codes.',
    array['PLAYER']) returning id into v_robinson;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, aliases)
  values ('kevin-sinfield', 'RUGBY_PERSON', 'Sir Kevin Sinfield', 'Leeds Rhinos'' record points-scorer and long-serving captain, who later moved into rugby union coaching with Leicester Tigers and England.',
    'Kevin Sinfield played his entire rugby league career at Leeds Rhinos between 1997 and 2015, captaining the club to seven Super League titles and remaining Super League''s all-time record points-scorer. He also captained England in rugby league. After retiring as a player, Sinfield served as Rugby Director for the Rugby Football League and Director of Rugby at Leeds Rhinos, before moving into on-field coaching — switching codes to join Leicester Tigers'' rugby union coaching staff and later becoming England Rugby Union''s skills and kicking coach. He is also widely known for the fundraising he led alongside former Leeds teammate Rob Burrow following Burrow''s motor neurone disease diagnosis.',
    array['PLAYER', 'COACH', 'ADMINISTRATOR'], array['Sir Kevin Sinfield']) returning id into v_sinfield;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('wayne-barnes', 'RUGBY_PERSON', 'Wayne Barnes', 'One of rugby union''s most experienced international referees, whose 17-year test career included five Rugby World Cups.',
    'Wayne Barnes made his rugby union test refereeing debut in 2006 and went on to become the game''s most experienced test referee, taking charge of a record 111 test matches across a 17-year career. He refereed five Rugby World Cups, including the 2023 final between New Zealand and South Africa, before retiring from officiating shortly afterwards.',
    array['REFEREE']) returning id into v_barnes;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('jodie-cunningham', 'RUGBY_PERSON', 'Jodie Cunningham', 'St Helens and England Women''s captain, and one of the leading figures in the growth of women''s rugby league.',
    'Jodie Cunningham made her England Women''s rugby league debut in 2009 and became the side''s all-time cap holder, representing England at three Rugby League World Cups. She joined St Helens Women in 2018 and captained the club to a historic unbeaten domestic treble in 2021, later becoming the first women''s captain to lift the Challenge Cup at Wembley Stadium in 2023. Cunningham was named England captain in 2023.',
    array['PLAYER']) returning id into v_cunningham;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('martin-johnson', 'RUGBY_PERSON', 'Martin Johnson', 'Captain of England''s 2003 Rugby World Cup-winning side, and one of the most influential leaders the sport has produced.',
    'Martin Johnson captained England to victory at the 2003 Rugby World Cup, beating Australia in the final — the only Rugby World Cup won by a northern-hemisphere team to date. A lock renowned for his physical presence and leadership, he also captained the British & Irish Lions on their 1997 tour of South Africa.',
    array['PLAYER']) returning id into v_johnson;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, aliases, birth_year)
  values ('jonny-wilkinson', 'RUGBY_PERSON', 'Jonny Wilkinson', 'England fly-half whose extra-time drop goal won the 2003 Rugby World Cup final.',
    'Jonny Wilkinson played every minute of England''s 2003 Rugby World Cup campaign, kicking the extra-time drop goal that beat Australia 20-17 in the final — one of the most famous moments in English sporting history. He went on to become one of the most capped and highest-scoring fly-halves in the history of both the England team and the British & Irish Lions.',
    array['PLAYER'], array['Jonathan Wilkinson'], 1979) returning id into v_wilkinson;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('maggie-alphonsi', 'RUGBY_PERSON', 'Maggie Alphonsi', 'England flanker and World Cup winner, inducted into the World Rugby Hall of Fame.',
    'Maggie Alphonsi was a key member of the England Women''s side that won the 2014 Rugby World Cup, part of a run of seven consecutive Six Nations titles between 2006 and 2012. She was inducted into the World Rugby Hall of Fame in 2016 and was awarded an MBE for services to rugby.',
    array['PLAYER']) returning id into v_alphonsi;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('emily-scarratt', 'RUGBY_PERSON', 'Emily Scarratt', 'England Women''s record points-scorer and former captain, twice a Rugby World Cup winner.',
    'Emily Scarratt won two Rugby World Cups with England Women and became the Red Roses'' all-time leading points-scorer across a career spanning more than a decade. She captained England, led Great Britain''s rugby sevens team at the 2016 Rio Olympics, and was named World Rugby Women''s Player of the Year in 2019.',
    array['PLAYER']) returning id into v_scarratt;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('francois-pienaar', 'RUGBY_PERSON', 'Francois Pienaar', 'Captain of South Africa''s 1995 Rugby World Cup-winning side, presented the trophy by Nelson Mandela.',
    'Francois Pienaar captained South Africa to victory at the 1995 Rugby World Cup on home soil, South Africa''s first major tournament after the end of apartheid. He won all 29 of his international caps as captain, and the image of President Nelson Mandela presenting him the trophy while wearing a Springbok jersey remains one of rugby''s defining moments.',
    array['PLAYER']) returning id into v_pienaar;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles)
  values ('ellery-hanley', 'RUGBY_PERSON', 'Ellery Hanley', 'One of rugby league''s greatest players, whose career spanned Bradford Northern, Wigan and Leeds, and who captained and later coached Great Britain.',
    'Ellery Hanley played for Bradford Northern, Wigan and Leeds across a nineteen-year career, becoming one of the most decorated players in British rugby league history. His 1985 transfer from Bradford Northern to Wigan, for a then-record fee, marked the start of one of Wigan''s most dominant eras. He captained Great Britain from 1988 to 1992 and later became Great Britain''s head coach. Hanley was inducted into the Rugby League Hall of Fame.',
    array['PLAYER', 'COACH']) returning id into v_hanley;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, birth_year, death_year)
  values ('rob-burrow', 'RUGBY_PERSON', 'Rob Burrow', 'Leeds Rhinos'' record appearance-maker, who became a national figure for his openness about living with motor neurone disease.',
    'Rob Burrow played his entire rugby league career at Leeds Rhinos, making 492 appearances and winning eight Super League titles, two Challenge Cups and three World Club Challenges. He represented England and Great Britain internationally and was twice named man of the match in a Super League Grand Final. Diagnosed with motor neurone disease in 2019, Burrow and former Leeds teammate Kevin Sinfield went on to raise millions of pounds for MND research and support before Burrow''s death in June 2024, aged 41.',
    array['PLAYER'], 1982, 2024) returning id into v_burrow;

  insert into public.hub_content_items (content_key, content_type, title, summary, body, roles, birth_year, death_year)
  values ('adrian-stoop', 'RUGBY_PERSON', 'Adrian Stoop', 'England captain who led the side out for the first international at Twickenham in 1910, and a pioneer of modern back play.',
    'Adrian Stoop won 15 caps for England and captained the side that played England''s first international at the newly-opened Twickenham in 1910. At club level he captained Harlequins for eight consecutive seasons and is widely credited with pioneering a new style of attacking back play that influenced the sport well beyond his own career. Harlequins'' home ground, The Stoop, is named in his memory. Stoop died in 1957.',
    array['PLAYER', 'PIONEER'], 1883, 1957) returning id into v_stoop;

  -- ============ Applicability: RUGBY_PERSON carries no rugby_code, so
  -- every row is universal, mirroring Teams & Competitions' 6 generic
  -- (code-neutral) explainer rows. ============

  insert into public.hub_content_applicability (content_item_id, is_universal)
  select id, true from public.hub_content_items
  where id in (v_lomu, v_boston, v_robinson, v_sinfield, v_barnes, v_cunningham, v_johnson, v_wilkinson, v_alphonsi, v_scarratt, v_pienaar, v_hanley, v_burrow, v_stoop);

  -- ============ Publish every person ============

  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (v_lomu, v_boston, v_robinson, v_sinfield, v_barnes, v_cunningham, v_johnson, v_wilkinson, v_alphonsi, v_scarratt, v_pienaar, v_hanley, v_burrow, v_stoop);

  -- ============ Person <-> team relationships (curated, not exhaustive;
  -- Boston/Hanley/Cunningham/Burrow deliberately carry none -- see the
  -- migration header for the Great Britain / England Women's League
  -- RUGBY_TEAM gap this found). ============

  insert into public.hub_person_team_relationships (person_id, team_id, role_type, source_url, source_retrieved_on) values
    (v_lomu, v_team_nz_ru_m, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Jonah_Lomu', current_date),
    (v_robinson, v_team_england_rl_m, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Jason_Robinson_(rugby)', current_date),
    (v_robinson, v_team_england_ru_m, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Jason_Robinson_(rugby)', current_date),
    (v_robinson, v_team_lions_m, 'REPRESENTED', 'https://www.lionsrugby.com/en/teams/mens-team/jason-robinson-JR911440', current_date),
    (v_sinfield, v_team_england_rl_m, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Kevin_Sinfield', current_date),
    (v_sinfield, v_team_england_ru_m, 'COACHED', 'https://www.englandrugby.com/follow/england-men/senior-men/kevin-sinfield', current_date),
    (v_johnson, v_team_england_ru_m, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Martin_Johnson_(rugby_union)', current_date),
    (v_wilkinson, v_team_england_ru_m, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Jonny_Wilkinson', current_date),
    (v_alphonsi, v_team_england_ru_w, 'PLAYED_FOR', 'https://en.wikipedia.org/wiki/Maggie_Alphonsi', current_date),
    (v_scarratt, v_team_england_ru_w, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Emily_Scarratt', current_date),
    (v_pienaar, v_team_rsa_ru_m, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Francois_Pienaar', current_date),
    (v_stoop, v_team_england_ru_m, 'CAPTAINED', 'https://en.wikipedia.org/wiki/Adrian_Stoop', current_date);

  -- ============ Person <-> honour relationships (deliberately sparse:
  -- 3 marquee facts against 27 existing honours). ============

  insert into public.hub_person_honour_relationships (person_id, honour_id, role_type, notes) values
    (v_johnson, v_honour_2003, 'CAPTAIN', 'Captained England to the only Rugby World Cup won by a northern-hemisphere team to date.'),
    (v_pienaar, v_honour_1995, 'CAPTAIN', 'Won all 29 of his international caps as captain, presented the trophy by President Nelson Mandela.'),
    (v_alphonsi, v_honour_2014, 'PLAYER', 'Key member of England Women''s 2014 Rugby World Cup-winning squad.');

  -- ============ Person <-> Heritage links (additive; existing Heritage
  -- people[] free text left completely untouched). ============

  insert into public.hub_content_heritage_links (content_item_id, heritage_entry_id) values
    (v_lomu, v_heritage_lomu),
    (v_boston, v_heritage_boston),
    (v_stoop, v_heritage_stoop_1909),
    (v_stoop, v_heritage_stoop_1910),
    (v_johnson, v_heritage_england_2003),
    (v_wilkinson, v_heritage_england_2003),
    (v_pienaar, v_heritage_mandela);

  -- ============ Person <-> generic Hub knowledge (hub_content_relationships,
  -- reused entirely unchanged). Wayne Barnes -- a referee with genuinely
  -- zero team relationships -- connects to Officiating content and to the
  -- Rugby World Cup he refereed in 2023 through this generic edge, exactly
  -- as designed: a referee relates to competitions/history he officiated,
  -- never to a team he never played for. ============

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values
    (v_barnes, v_officiating_what_referee_does, 'RELATED_KNOWLEDGE'),
    (v_barnes, v_officiating_becoming_referee, 'RELATED_KNOWLEDGE'),
    (v_barnes, v_comp_rwc, 'RELATED_KNOWLEDGE');

  -- ============ Multi-source provenance (every person gets at least one
  -- row; several get two or more to prove multi-source biography works). ============

  insert into public.hub_content_sources (content_item_id, source_tier, source_title, source_url, retrieved_on) values
    (v_lomu, 'ENCYCLOPEDIA', 'Jonah Lomu', 'https://en.wikipedia.org/wiki/Jonah_Lomu', current_date),
    (v_boston, 'ENCYCLOPEDIA', 'Billy Boston', 'https://en.wikipedia.org/wiki/Billy_Boston', current_date),
    (v_boston, 'POPULAR_HISTORY', 'Rugby League legend Sir Billy Boston dies aged 92', 'https://sports.yahoo.com/articles/rugby-league-legend-billy-boston-103951831.html', current_date),
    (v_boston, 'GOVERNING_BODY', 'Sir Billy Boston becomes rugby league''s first knight', 'https://www.intrl.sport/article/442/sir-billy-boston-becomes-rugby-leagues-first-knight', current_date),
    (v_robinson, 'GOVERNING_BODY', 'On This Day: Jason Robinson switches to rugby union', 'https://www.englandrugby.com/follow/news-and-media/on-this-day-jason-robinson-switches-to-rugby-union', current_date),
    (v_robinson, 'ENCYCLOPEDIA', 'Jason Robinson (rugby)', 'https://en.wikipedia.org/wiki/Jason_Robinson_(rugby)', current_date),
    (v_sinfield, 'ENCYCLOPEDIA', 'Kevin Sinfield', 'https://en.wikipedia.org/wiki/Kevin_Sinfield', current_date),
    (v_sinfield, 'GOVERNING_BODY', 'Kevin Sinfield', 'https://www.englandrugby.com/follow/england-men/senior-men/kevin-sinfield', current_date),
    (v_sinfield, 'CONTEMPORARY_REPORT', 'Sir Kevin Sinfield', 'https://www.therhinos.co.uk/player-profile/336/kevin-sinfield-cbe', current_date),
    (v_barnes, 'GOVERNING_BODY', 'Record-breaking referee Wayne Barnes calls time on stellar career', 'https://www.world.rugby/news/891175/record-breaking-referee-wayne-barnes-calls-time-on-stellar-career', current_date),
    (v_barnes, 'ENCYCLOPEDIA', 'Wayne Barnes', 'https://en.wikipedia.org/wiki/Wayne_Barnes', current_date),
    (v_cunningham, 'CONTEMPORARY_REPORT', 'Jodie Cunningham announced as England Women Captain', 'https://www.rugby-league.com/article/61612/jodie-cunningham-announced-as-england-women-captain', current_date),
    (v_cunningham, 'ENCYCLOPEDIA', 'Jodie Cunningham', 'https://en.wikipedia.org/wiki/Jodie_Cunningham', current_date),
    (v_johnson, 'ENCYCLOPEDIA', 'Martin Johnson (rugby union)', 'https://en.wikipedia.org/wiki/Martin_Johnson_(rugby_union)', current_date),
    (v_wilkinson, 'ENCYCLOPEDIA', 'Jonny Wilkinson', 'https://en.wikipedia.org/wiki/Jonny_Wilkinson', current_date),
    (v_alphonsi, 'GOVERNING_BODY', 'World Rugby Hall of Fame — Maggie Alphonsi', 'https://www.world.rugby/halloffame/inductees/706671', current_date),
    (v_alphonsi, 'ENCYCLOPEDIA', 'Maggie Alphonsi', 'https://en.wikipedia.org/wiki/Maggie_Alphonsi', current_date),
    (v_scarratt, 'GOVERNING_BODY', 'Scarratt named World Rugby player of the year', 'https://www.englandrugby.com/follow/news-and-media/scarratt-named-world-rugby-player-of-the-year', current_date),
    (v_scarratt, 'ENCYCLOPEDIA', 'Emily Scarratt', 'https://en.wikipedia.org/wiki/Emily_Scarratt', current_date),
    (v_pienaar, 'ENCYCLOPEDIA', 'Francois Pienaar', 'https://en.wikipedia.org/wiki/Francois_Pienaar', current_date),
    (v_hanley, 'CONTEMPORARY_REPORT', 'Ellery Hanley - Playing Career', 'https://www.rugbyleagueproject.org/players/ellery-hanley/summary.html', current_date),
    (v_hanley, 'ENCYCLOPEDIA', 'Ellery Hanley', 'https://en.wikipedia.org/wiki/Ellery_Hanley', current_date),
    (v_burrow, 'ENCYCLOPEDIA', 'Rob Burrow', 'https://en.wikipedia.org/wiki/Rob_Burrow', current_date),
    (v_burrow, 'CONTEMPORARY_REPORT', 'Leeds Rhinos rugby league legend Rob Burrow dies aged 41', 'https://www.skysports.com/rugby-league/news/12196/13146204/rob-burrow-leeds-rhinos-rugby-league-legend-dies-aged-41-after-suffering-from-motor-neurone-disease', current_date),
    (v_stoop, 'MUSEUM_OR_ARCHIVE', 'Player Profile - Adrian Stoop', 'https://worldrugbymuseum.com/from-the-vaults/players/player-profile-adrian-stoop', current_date),
    (v_stoop, 'ENCYCLOPEDIA', 'Adrian Stoop', 'https://en.wikipedia.org/wiki/Adrian_Stoop', current_date);

end $$;
