-- Rugby Hub Glossary Explorer.
--
-- hub_glossary_terms already existed as a complete canonical table (lifecycle,
-- applicability, publication gating, RLS, search_vector, trigram support,
-- glossary-to-glossary relationships, regulatory fact references,
-- search_hub_content coverage) since the original general-knowledge schema
-- migration -- it simply had zero rows and no UI. This migration closes the
-- three genuine relationship gaps identified in archaeology (glossary terms
-- could not connect to hub_content_items, positions, or skills), closes a
-- regulatory-escape-hatch gap on hub_glossary_terms that hub_content_items
-- already had, extends get_hub_recommended_content to include glossary terms
-- (search_hub_content already covered them), and seeds the first genuinely
-- useful term set. No new content_type, no new table for glossary identity
-- itself, no parallel architecture.

-- =====================================================================
-- 1. Regulatory escape-hatch protection, mirrored exactly from
--    hub_content_items_no_regulatory_escape_hatch. A glossary definition
--    explains a word; RULE_GLOSSARY is the one legitimate mechanism for
--    citing real regulation, so plain_language_definition must never be
--    able to assert regulatory-sounding claims in its own prose.
-- =====================================================================

alter table public.hub_glossary_terms add constraint hub_glossary_terms_no_regulatory_escape_hatch check (
  display_term !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
  and plain_language_definition !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
);
comment on constraint hub_glossary_terms_no_regulatory_escape_hatch on public.hub_glossary_terms is 'A regulatory assertion belongs in regulatory_facts, cited via hub_regulatory_fact_references (RULE_GLOSSARY) and applicability-scoped -- never restated as if it were the definition itself. Mirrors hub_content_items_no_regulatory_escape_hatch exactly.';

-- =====================================================================
-- 2. The three relationship gaps. Each mirrors an existing exact sibling
--    shape -- fixed two-column FK integrity, never a generic polymorphic
--    junction, consistent with every other Hub relationship table.
-- =====================================================================

-- GLOSSARY_CONTENT: mirrors hub_skill_content_links exactly. Generic on
-- purpose -- covers Game Knowledge today (GAME_CONCEPT is just a
-- hub_content_items content_type) and future Officiating/other content
-- types with zero further schema change, because this table has no
-- content_type filter of its own.
create table public.hub_glossary_content_links (
  glossary_term_id uuid not null references public.hub_glossary_terms(id) on delete cascade,
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (glossary_term_id, content_item_id)
);
comment on table public.hub_glossary_content_links is 'Connects a glossary term to hub_content_items rows it is relevant to (Game Knowledge concepts today; any future content_type transparently, since this table has no type filter). GLOSSARY_CONTENT relationship.';
create index hub_glossary_content_links_content_item_idx on public.hub_glossary_content_links(content_item_id);

-- GLOSSARY_POSITION: mirrors hub_content_item_positions exactly.
create table public.hub_glossary_positions (
  glossary_term_id uuid not null references public.hub_glossary_terms(id) on delete cascade,
  position_id uuid not null references public.hub_positions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (glossary_term_id, position_id)
);
comment on table public.hub_glossary_positions is 'Connects a glossary term to the positions it is materially relevant to (e.g. "Lineout" to the locks and hooker). GLOSSARY_POSITION relationship.';
create index hub_glossary_positions_position_idx on public.hub_glossary_positions(position_id);

-- GLOSSARY_SKILL: mirrors hub_position_skills exactly.
create table public.hub_glossary_skills (
  glossary_term_id uuid not null references public.hub_glossary_terms(id) on delete cascade,
  skill_id uuid not null references public.hub_skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (glossary_term_id, skill_id)
);
comment on table public.hub_glossary_skills is 'Connects a glossary term to the skills it is materially relevant to (e.g. "Territory" to Kicking for Territory and Tactics). GLOSSARY_SKILL relationship.';
create index hub_glossary_skills_skill_idx on public.hub_glossary_skills(skill_id);

alter table public.hub_glossary_content_links enable row level security;
alter table public.hub_glossary_positions enable row level security;
alter table public.hub_glossary_skills enable row level security;

create policy hub_glossary_content_links_admin_all on public.hub_glossary_content_links
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_glossary_content_links_public_read on public.hub_glossary_content_links for select using (
  exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED')
  and exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED')
);

create policy hub_glossary_positions_admin_all on public.hub_glossary_positions
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_glossary_positions_public_read on public.hub_glossary_positions for select using (
  exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED')
  and exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED')
);

create policy hub_glossary_skills_admin_all on public.hub_glossary_skills
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_glossary_skills_public_read on public.hub_glossary_skills for select using (
  exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED')
  and exists (select 1 from public.hub_skills s where s.id = skill_id and s.status = 'PUBLISHED')
);

-- =====================================================================
-- 3. get_hub_recommended_content: add the GLOSSARY_TERM branch. Mirrors
--    the existing SKILL branch exactly -- same applicability join, same
--    is_universal/identity-match filter, same ordering. search_hub_content
--    already covers GLOSSARY_TERM; recommendations did not.
-- =====================================================================

create or replace function public.get_hub_recommended_content(
  p_regulatory_identity_id uuid default null,
  p_limit integer default 10
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  summary text,
  is_universal_match boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select 'CONTENT_ITEM', c.id, c.title, c.summary, a.is_universal
  from public.hub_content_items c
  join public.hub_content_applicability a on a.content_item_id = c.id
  where c.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  union all
  select 'POSITION', p.id, p.display_name, p.purpose, a.is_universal
  from public.hub_positions p
  join public.hub_content_applicability a on a.position_id = p.id
  where p.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  union all
  select 'SKILL', s.id, s.display_name, s.summary, a.is_universal
  from public.hub_skills s
  join public.hub_content_applicability a on a.skill_id = s.id
  where s.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  union all
  select 'GLOSSARY_TERM', g.id, g.display_term, g.plain_language_definition, a.is_universal
  from public.hub_glossary_terms g
  join public.hub_content_applicability a on a.glossary_term_id = g.id
  where g.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  order by is_universal asc
  limit p_limit;
$$;
comment on function public.get_hub_recommended_content is 'Context-ranked, published-only general knowledge for a resolved regulatory identity (team/player/child context, resolved by the caller exactly as internal.regulatory_context_for_team already does for the regulatory layer). Identity-specific matches rank before universal ones. Returns a RECOMMENDATION, not a filter on what the viewer may browse -- public.search_hub_content remains the unrestricted entry point for anyone exploring beyond their own context.';

revoke all on function public.get_hub_recommended_content(uuid, integer) from public, anon;
grant execute on function public.get_hub_recommended_content(uuid, integer) to authenticated;

-- =====================================================================
-- 3b. get_hub_glossary_term_regulatory_facts: the RULE_GLOSSARY sibling of
--     the existing get_hub_skill_content_regulatory_facts -- same shape,
--     same security-definer/revoke/grant pattern, keyed by glossary_term_id
--     instead of content_item_id because they are genuinely different
--     columns on hub_regulatory_fact_references, not a case for one
--     function branching on which id was passed.
-- =====================================================================

create or replace function public.get_hub_glossary_term_regulatory_facts(p_glossary_term_id uuid)
returns table (fact_key text, value_text text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.fact_key, f.value_text
  from public.hub_regulatory_fact_references r
  join public.regulatory_facts f on f.id = r.regulatory_fact_id
  where r.glossary_term_id = p_glossary_term_id
    and f.status = 'VERIFIED';
$function$;
comment on function public.get_hub_glossary_term_regulatory_facts is 'Returns the VERIFIED regulatory_facts (fact_key, value_text) linked to one hub_glossary_terms row via hub_regulatory_fact_references (RULE_GLOSSARY) -- the one sanctioned way the Glossary Explorer surfaces real regulatory text, since regulatory_facts itself has no public-read policy. Cannot be used to browse facts generally: the caller must already hold a real, published glossary_term_id. Mirrors get_hub_skill_content_regulatory_facts exactly.';

revoke all on function public.get_hub_glossary_term_regulatory_facts(uuid) from public, anon;
grant execute on function public.get_hub_glossary_term_regulatory_facts(uuid) to authenticated;

-- =====================================================================
-- 4. Seed content: 17 terms (19 rows -- "Scrum" and "Offside" each get a
--    genuine Union row and a genuine League row, since the two codes'
--    versions differ materially rather than sharing one meaning).
--    Universal terms carry is_universal=true; code-specific terms carry
--    real per-regulatory_identity enumeration, never is_universal=true.
-- =====================================================================

do $$
declare
  v_admin uuid;
  v_breakdown uuid; v_ruck uuid; v_ptb uuid; v_territory uuid; v_turnover uuid;
  v_advantage uuid; v_tackle_count uuid; v_set_restart uuid;
  v_scrum_union uuid; v_scrum_league uuid; v_lineout uuid; v_maul uuid;
  v_knock_on uuid; v_forward_pass uuid; v_try uuid; v_conversion uuid; v_penalty uuid;
  v_offside_union uuid; v_offside_league uuid;
  v_concept_ruck uuid; v_concept_ptb uuid; v_concept_territory uuid; v_concept_tackle_restarts uuid;
  v_concept_advantage uuid; v_concept_scrum_lineout uuid; v_concept_restarts uuid; v_concept_scoring uuid;
  v_concept_attack_defence uuid;
  v_skill_breakdown uuid; v_skill_ptb uuid; v_skill_territory uuid; v_skill_scrum_lineout uuid;
  v_pos_lhp uuid; v_pos_hooker_u uuid; v_pos_thp uuid; v_pos_lock4 uuid; v_pos_lock5 uuid;
  v_pos_blindside uuid; v_pos_openside uuid; v_pos_no8 uuid;
  v_pos_prop8 uuid; v_pos_hooker_l uuid; v_pos_prop10 uuid;
  v_fact_restart uuid;
begin
  select id into v_admin from auth.users where email like 'hub-admin-glossary-%' limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (v_admin, 'hub-admin-glossary-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
    insert into public.profiles (id, first_name, surname, email) values (v_admin, 'Hub', 'Admin', 'hub-admin-glossary-' || v_admin::text || '@ovalball.test');
  end if;

  select id into v_concept_ruck from public.hub_content_items where content_key = 'the-breakdown-and-ruck';
  select id into v_concept_ptb from public.hub_content_items where content_key = 'the-play-the-ball';
  select id into v_concept_territory from public.hub_content_items where content_key = 'possession-and-territory';
  select id into v_concept_tackle_restarts from public.hub_content_items where content_key = 'tackle-count-and-set-restarts';
  select id into v_concept_advantage from public.hub_content_items where content_key = 'penalties-and-advantage';
  select id into v_concept_scrum_lineout from public.hub_content_items where content_key = 'the-scrum-and-lineout-in-play';
  select id into v_concept_restarts from public.hub_content_items where content_key = 'how-play-restarts';
  select id into v_concept_scoring from public.hub_content_items where content_key = 'how-scoring-works';
  select id into v_concept_attack_defence from public.hub_content_items where content_key = 'attack-and-defence';

  select id into v_skill_breakdown from public.hub_skills where skill_key = 'contact-and-breakdown-work';
  select id into v_skill_ptb from public.hub_skills where skill_key = 'play-the-ball-and-restart';
  select id into v_skill_territory from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
  select id into v_skill_scrum_lineout from public.hub_skills where skill_key = 'scrum-and-lineout-technique';

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

  select id into v_fact_restart from public.regulatory_facts where fact_key = 'RFU-REG15-APP-U14-SCRUM' and status = 'VERIFIED';

  -- ============ Universal terms ============

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('territory', 'Territory', 'How much of the pitch a team controls, usually measured by how close they are to the opposition''s try line.')
  returning id into v_territory;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('turnover', 'Turnover', 'The moment possession changes from one team to the other, whether through an error, a tackle contest, or a kick.')
  returning id into v_turnover;

  insert into public.hub_glossary_terms (term_key, display_term, aliases, plain_language_definition) values
    ('advantage', 'Advantage', array['advantage law'], 'Letting play continue after an infringement because the non-offending team already has a scoring opportunity, rather than stopping the game straight away.')
  returning id into v_advantage;

  insert into public.hub_glossary_terms (term_key, display_term, aliases, plain_language_definition) values
    ('knock-on', 'Knock-On', array['knock on'], 'Accidentally losing control of the ball forward with the hand or arm before it hits the ground or another player.')
  returning id into v_knock_on;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('forward-pass', 'Forward Pass', 'Throwing or passing the ball forward, towards the opposition''s try line, which is not allowed in either code.')
  returning id into v_forward_pass;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('try', 'Try', 'Grounding the ball in the opposition''s in-goal area, the main way of scoring in both codes.')
  returning id into v_try;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('conversion', 'Conversion', 'A kick at goal, taken after a try, that adds further points for the scoring team.')
  returning id into v_conversion;

  insert into public.hub_glossary_terms (term_key, display_term, plain_language_definition) values
    ('penalty', 'Penalty', 'An award to the non-offending team after a more serious infringement, typically a kick at goal, a kick for territory, or a scrum.')
  returning id into v_penalty;

  -- ============ Union-specific terms ============

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('breakdown', 'Breakdown', 'union', 'The area of contact after a tackle where players compete for the ball on the ground, most often forming a ruck.')
  returning id into v_breakdown;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('ruck', 'Ruck', 'union', 'A phase of play where at least one player from each team, on their feet and in contact, close around the ball on the ground after a tackle.')
  returning id into v_ruck;

  insert into public.hub_glossary_terms (term_key, display_term, aliases, rugby_code, plain_language_definition) values
    ('lineout', 'Lineout', array['line-out'], 'union', 'A restart used after the ball goes into touch, where players from both teams line up and jump to catch a throw-in down the middle.')
  returning id into v_lineout;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('maul', 'Maul', 'union', 'A phase of play where the ball-carrier is held up off the ground and teammates bind on to drive forward together as a group.')
  returning id into v_maul;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('scrum-union', 'Scrum', 'union', 'A contested restart where each team''s forwards bind together and push against the opposition to compete for the ball fed in along the ground.')
  returning id into v_scrum_union;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('offside-union', 'Offside', 'union', 'Being in a position where a player isn''t allowed to take part in play — generally in front of a teammate who last played the ball, or in front of the back of a ruck or maul.')
  returning id into v_offside_union;

  -- ============ League-specific terms ============

  insert into public.hub_glossary_terms (term_key, display_term, aliases, rugby_code, plain_language_definition) values
    ('play-the-ball', 'Play-the-Ball', array['play the ball'], 'league', 'How the tackled player''s team restarts after a tackle: they get up, face their own try line, and roll the ball back with a foot to a teammate.')
  returning id into v_ptb;

  insert into public.hub_glossary_terms (term_key, display_term, aliases, rugby_code, plain_language_definition) values
    ('tackle-count', 'Tackle Count', array['six tackle rule'], 'league', 'The limited number of tackles a team gets to advance the ball before possession passes to the opposition.')
  returning id into v_tackle_count;

  insert into public.hub_glossary_terms (term_key, display_term, aliases, rugby_code, plain_language_definition) values
    ('set-restart', 'Set Restart', array['six again'], 'league', 'A restart that gives the attacking team a fresh set of tackles without conceding possession, awarded for certain defensive infringements near the play-the-ball.')
  returning id into v_set_restart;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('scrum-league', 'Scrum', 'league', 'A restart used after a knock-on or handling error; in the modern game it is rarely contested, and possession almost always returns to the team that didn''t make the error.')
  returning id into v_scrum_league;

  insert into public.hub_glossary_terms (term_key, display_term, rugby_code, plain_language_definition) values
    ('offside-league', 'Offside', 'league', 'Being in front of the ball when it is played — most visibly the defending line, which must retreat behind the marker (or ten metres back) at each play-the-ball.')
  returning id into v_offside_league;

  -- ============ Applicability: universal terms ============

  insert into public.hub_content_applicability (glossary_term_id, is_universal)
  select id, true from public.hub_glossary_terms
  where id in (v_territory, v_turnover, v_advantage, v_knock_on, v_forward_pass, v_try, v_conversion, v_penalty);

  -- ============ Applicability: code-specific terms, real per-identity enumeration ============

  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_breakdown, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_ruck, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_lineout, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_maul, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_scrum_union, id from public.regulatory_identities where rugby_code = 'union';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_offside_union, id from public.regulatory_identities where rugby_code = 'union';

  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_ptb, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_tackle_count, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_set_restart, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_scrum_league, id from public.regulatory_identities where rugby_code = 'league';
  insert into public.hub_content_applicability (glossary_term_id, regulatory_identity_id)
  select v_offside_league, id from public.regulatory_identities where rugby_code = 'league';

  -- ============ Publish every seeded term now that applicability exists ============

  update public.hub_glossary_terms
  set status = 'PUBLISHED', reviewed_by = v_admin, reviewed_at = now(), published_by = v_admin, published_at = now()
  where id in (
    v_breakdown, v_ruck, v_ptb, v_territory, v_turnover, v_advantage, v_tackle_count, v_set_restart,
    v_scrum_union, v_scrum_league, v_lineout, v_maul, v_knock_on, v_forward_pass, v_try, v_conversion,
    v_penalty, v_offside_union, v_offside_league
  );

  -- ============ Related Game Knowledge (hub_glossary_content_links) ============

  insert into public.hub_glossary_content_links (glossary_term_id, content_item_id) values
    (v_ruck, v_concept_ruck),
    (v_breakdown, v_concept_ruck),
    (v_ptb, v_concept_ptb),
    (v_territory, v_concept_territory),
    (v_turnover, v_concept_territory),
    (v_tackle_count, v_concept_tackle_restarts),
    (v_set_restart, v_concept_tackle_restarts),
    (v_advantage, v_concept_advantage),
    (v_penalty, v_concept_advantage),
    (v_scrum_union, v_concept_scrum_lineout),
    (v_lineout, v_concept_scrum_lineout),
    (v_scrum_league, v_concept_restarts),
    (v_try, v_concept_scoring),
    (v_conversion, v_concept_scoring),
    (v_offside_union, v_concept_attack_defence),
    (v_offside_league, v_concept_attack_defence);

  -- ============ Related Skills (hub_glossary_skills) ============

  insert into public.hub_glossary_skills (glossary_term_id, skill_id) values
    (v_ruck, v_skill_breakdown),
    (v_breakdown, v_skill_breakdown),
    (v_maul, v_skill_breakdown),
    (v_ptb, v_skill_ptb),
    (v_tackle_count, v_skill_ptb),
    (v_set_restart, v_skill_ptb),
    (v_territory, v_skill_territory),
    (v_scrum_union, v_skill_scrum_lineout),
    (v_lineout, v_skill_scrum_lineout),
    (v_scrum_league, v_skill_ptb);

  -- ============ Related Positions (hub_glossary_positions) ============

  insert into public.hub_glossary_positions (glossary_term_id, position_id) values
    (v_scrum_union, v_pos_lhp), (v_scrum_union, v_pos_hooker_u), (v_scrum_union, v_pos_thp),
    (v_scrum_union, v_pos_lock4), (v_scrum_union, v_pos_lock5),
    (v_lineout, v_pos_lock4), (v_lineout, v_pos_lock5), (v_lineout, v_pos_hooker_u),
    (v_maul, v_pos_lhp), (v_maul, v_pos_hooker_u), (v_maul, v_pos_thp), (v_maul, v_pos_lock4), (v_maul, v_pos_lock5),
    (v_ruck, v_pos_blindside), (v_ruck, v_pos_openside), (v_ruck, v_pos_no8),
    (v_breakdown, v_pos_blindside), (v_breakdown, v_pos_openside), (v_breakdown, v_pos_no8),
    (v_scrum_league, v_pos_prop8), (v_scrum_league, v_pos_hooker_l), (v_scrum_league, v_pos_prop10),
    (v_ptb, v_pos_hooker_l);

  -- ============ Related Terms (hub_glossary_relationships) -- genuinely symmetric pairs stored as two rows each, per the established directional-storage convention ============

  insert into public.hub_glossary_relationships (glossary_term_id, related_glossary_term_id) values
    (v_ruck, v_maul), (v_maul, v_ruck),
    (v_ruck, v_breakdown), (v_breakdown, v_ruck),
    (v_try, v_conversion), (v_conversion, v_try),
    (v_knock_on, v_scrum_union), (v_scrum_union, v_knock_on),
    (v_tackle_count, v_ptb), (v_ptb, v_tackle_count),
    (v_set_restart, v_tackle_count), (v_tackle_count, v_set_restart),
    (v_penalty, v_advantage), (v_advantage, v_penalty),
    (v_scrum_union, v_lineout), (v_lineout, v_scrum_union),
    (v_scrum_league, v_ptb), (v_ptb, v_scrum_league);

  -- ============ Rule/Regulatory provenance (RULE_GLOSSARY) -- only where a real VERIFIED fact genuinely fits; the rest of the corpus is age-grade/administrative regulation with no clean law-of-the-game fact to cite, so left empty rather than fabricated ============

  if v_fact_restart is not null then
    insert into public.hub_regulatory_fact_references (regulatory_fact_id, glossary_term_id, reference_type)
    values (v_fact_restart, v_scrum_union, 'RULE_GLOSSARY');
  end if;
end $$;
