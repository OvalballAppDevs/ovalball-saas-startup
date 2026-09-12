-- Rugby Hub search coverage completion: Regulatory (Rules/Safeguarding/
-- Player Welfare) and Story of Rugby (heritage) join the one existing
-- search_hub_content architecture. No second search index, no per-fact
-- article pages, no duplicated heritage content.
--
-- REGULATORY RESULT MODEL (see RUGBY HUB REGULATORY SEARCH RESULT MODEL --
-- FINAL DESIGN, approved with corrections):
--   - regulatory_facts.id is the canonical searchable identity. One search
--     result per matching fact_id, never one per presentation occurrence.
--   - A fact reaches presentation through exactly one of two existing,
--     currently non-overlapping paths: (a) hub_regulatory_fact_references
--     -> hub_content_items -> hub_skill_content_links -> hub_skills (the
--     Skills Explorer citation model), or (b) regulatory_content_sections
--     -> regulatory_content_sets (the Rules/Safeguarding/Player-Welfare
--     page model). internal.regulatory_fact_primary_occurrence is the one
--     deterministic resolver for "where does this fact actually render" --
--     used by both the search branch (for an honest title) and the
--     get_regulatory_fact_search_context follow-up (for the destination) --
--     so there is exactly one place this decision is made, never two
--     implementations that could disagree. Path (a) is preferred over (b)
--     when both exist (richer teaching context); within path (b), ties
--     break on content_set_key/section_key ascending -- real stable text
--     keys, never physical row order.
--   - A fact wired into neither path is excluded from search entirely --
--     the same "no destination, no result" principle already applied to
--     orphaned CONTENT_ITEM/GLOSSARY_TERM rows.
--   - Effective state is enforced identically in both the search branch and
--     the resolver: VERIFIED facts, PUBLISHED content (content items or
--     content sets), and -- for the content-set path -- effective as of
--     CURRENT_DATE. No caller-supplied historical date anywhere in this
--     migration.
--   - Public URLs never carry a regulatory_identity_id UUID.
--     regulatory_identities.identity_key (already a stable, unique, public-
--     legible key -- e.g. "RFL-U12") is the one public identifier; the new
--     browse RPCs resolve it to the internal uuid themselves.
--
-- STORY: heritage_entries has no draft workflow and already has a fully
-- public RLS policy (heritage_entries_select_all, qual true) -- this only
-- needs a search_vector, no security change. Certainty/code_scope are
-- deliberately NOT part of the indexed text (they are metadata carried
-- through to presentation, never used to decide whether text matches).

-- =====================================================================
-- search_vector columns
-- =====================================================================

alter table public.regulatory_facts add column if not exists search_vector tsvector
  generated always as (setweight(internal.immutable_english_tsvector(coalesce(value_text, '')), 'A')) stored;

create index if not exists regulatory_facts_search_vector_idx on public.regulatory_facts using gin (search_vector);

comment on column public.regulatory_facts.search_vector is 'Indexes value_text only -- the real governing-body prose. Boolean/enum-only facts with no value_text index to an empty vector and simply never match a text query, which is correct: there is no prose to search.';

alter table public.heritage_entries add column if not exists search_vector tsvector
  generated always as (setweight(internal.immutable_english_tsvector(title), 'A') || setweight(internal.immutable_english_tsvector(summary), 'B')) stored;

create index if not exists heritage_entries_search_vector_idx on public.heritage_entries using gin (search_vector);

comment on column public.heritage_entries.search_vector is 'Title and summary only. certainty/code_scope are never indexed as text -- they are presentation metadata, not something a query should be able to match its way around.';

-- =====================================================================
-- internal.regulatory_fact_primary_occurrence -- the one deterministic
-- "where does this fact actually render" resolver, shared by the search
-- branch and the search-result destination RPC below.
-- =====================================================================

create or replace function internal.regulatory_fact_primary_occurrence(p_fact_id uuid)
returns table (
  destination_kind text,
  skill_key text,
  topic text,
  identity_key text,
  regulatory_identity_id uuid,
  rugby_code text,
  section_key text,
  occurrence_count integer
)
language sql
stable
security definer
set search_path = public, internal
as $$
  with skill_path as (
    select s.skill_key
    from public.hub_regulatory_fact_references r
    join public.hub_content_items ci on ci.id = r.content_item_id and ci.status = 'PUBLISHED'
    join public.hub_skill_content_links l on l.content_item_id = ci.id
    join public.hub_skills s on s.id = l.skill_id and s.status = 'PUBLISHED'
    where r.regulatory_fact_id = p_fact_id
    order by s.skill_key
    limit 1
  ),
  rules_path as (
    select cs.topic, ri.identity_key, ri.id as regulatory_identity_id, cs.rugby_code,
      -- Pitch length/width are merged into one "Pitch" card in the
      -- existing Rules UI (groupPitchDimensions) regardless of which
      -- literal section_key the width fact happens to carry -- the anchor
      -- must point at the card that actually exists, not at a section_key
      -- that renders nothing on its own.
      case when f.fact_type in ('PITCH_LENGTH', 'PITCH_WIDTH') then 'PITCH' else sec.section_key end as section_key
    from public.regulatory_content_sections sec
    join public.regulatory_content_sets cs on cs.id = sec.content_set_id
    join public.regulatory_facts f on f.id = sec.fact_id
    -- LEFT, not JOIN: Safeguarding/Player-Welfare content is not always
    -- identity-scoped (a "general, code-wide" content set genuinely has
    -- regulatory_identity_id = null) -- an inner join here would silently
    -- drop real, published, currently-effective general guidance (e.g. the
    -- community concussion protocols) from ever getting a destination.
    left join public.regulatory_identities ri on ri.id = cs.regulatory_identity_id
    where sec.fact_id = p_fact_id
      and cs.publication_state = 'PUBLISHED'
      and (cs.effective_from is null or cs.effective_from <= current_date)
      and (cs.effective_to is null or cs.effective_to >= current_date)
    order by cs.content_set_key, sec.section_key
    limit 1
  ),
  counted as (
    select
      (select count(*) from public.hub_regulatory_fact_references r
         join public.hub_content_items ci on ci.id = r.content_item_id and ci.status = 'PUBLISHED'
       where r.regulatory_fact_id = p_fact_id)
      +
      (select count(*) from public.regulatory_content_sections sec
         join public.regulatory_content_sets cs on cs.id = sec.content_set_id
       where sec.fact_id = p_fact_id and cs.publication_state = 'PUBLISHED'
         and (cs.effective_from is null or cs.effective_from <= current_date)
         and (cs.effective_to is null or cs.effective_to >= current_date))
      as cnt
  )
  select
    case
      when (select skill_key from skill_path) is not null then 'SKILL'
      when (select topic from rules_path) is not null then 'RULES_PAGE'
      else null
    end,
    (select skill_key from skill_path),
    (select topic from rules_path),
    (select identity_key from rules_path),
    (select regulatory_identity_id from rules_path),
    (select rugby_code from rules_path),
    (select section_key from rules_path),
    (select cnt from counted);
$$;

comment on function internal.regulatory_fact_primary_occurrence is 'The one deterministic resolver for where a regulatory fact actually renders. Prefers the skill-content path (hub_regulatory_fact_references -> a PUBLISHED skill) over the Rules-page path (regulatory_content_sections -> a PUBLISHED, currently-effective content set); ties within the Rules-page path break on content_set_key/section_key ascending, never physical row order. destination_kind is null (no result) when the fact is wired into neither path. Used identically by search_hub_content (for an honest result title) and get_regulatory_fact_search_context (for the actual destination) so there is exactly one implementation of this decision.';

-- =====================================================================
-- search_hub_content: extended in place. Same one entry point, same
-- return shape. Two new branches; nothing about the existing four changes.
-- =====================================================================

create or replace function public.search_hub_content(p_query text, p_limit integer default 20)
returns table (result_type text, result_id uuid, title text, snippet text, rank real)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  select 'CONTENT_ITEM', id, title, summary, ts_rank(search_vector, q.tsq) as rank
  from public.hub_content_items, q
  where status = 'PUBLISHED' and search_vector @@ q.tsq
  union all
  select 'POSITION', id, display_name, purpose, ts_rank(search_vector, q.tsq) as rank
  from public.hub_positions, q
  where status = 'PUBLISHED' and search_vector @@ q.tsq
  union all
  select 'SKILL', id, display_name, summary, ts_rank(search_vector, q.tsq) as rank
  from public.hub_skills, q
  where status = 'PUBLISHED' and search_vector @@ q.tsq
  union all
  select 'GLOSSARY_TERM', id, display_term, plain_language_definition, ts_rank(search_vector, q.tsq) as rank
  from public.hub_glossary_terms, q
  where status = 'PUBLISHED' and search_vector @@ q.tsq
  union all
  select 'RULE', f.id, coalesce(oc.section_key, 'Rule'), left(f.value_text, 200), ts_rank(f.search_vector, q.tsq) as rank
  from public.regulatory_facts f, q
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id) oc
  where f.status = 'VERIFIED' and f.search_vector @@ q.tsq and oc.destination_kind is not null
  union all
  select 'STORY', id, title, summary, ts_rank(search_vector, q.tsq) as rank
  from public.heritage_entries, q
  where search_vector @@ q.tsq
  order by rank desc
  limit p_limit;
$$;

comment on function public.search_hub_content is 'The one canonical Rugby Hub general-knowledge search entry point. PUBLISHED/VERIFIED/currently-effective rows only, by construction -- a draft, unverified, superseded, or unaddressable row can never surface here regardless of what the caller passes. RULE title is a raw section_key placeholder; the caller (rugby-hub-search.ts) replaces it with the correct human label once it has the full destination from get_regulatory_fact_search_context, exactly as POSITION/SKILL results already resolve their own presentation client-side. Context/applicability boosting is intentionally NOT applied inside this function, for any branch -- see get_hub_recommended_content for that concern.';

-- =====================================================================
-- get_regulatory_fact_search_context: the one destination-resolution
-- follow-up for RULE search results, keyed by the fact ids a given result
-- page actually returned -- never one call per result, never a general
-- fact-browsing endpoint.
-- =====================================================================

create or replace function public.get_regulatory_fact_search_context(p_fact_ids uuid[])
returns table (
  fact_id uuid,
  destination_kind text,
  skill_key text,
  topic text,
  identity_key text,
  regulatory_identity_id uuid,
  rugby_code text,
  section_key text,
  occurrence_count integer
)
language sql
stable
security definer
set search_path = public, internal
as $$
  select f.id, oc.destination_kind, oc.skill_key, oc.topic, oc.identity_key, oc.regulatory_identity_id, oc.rugby_code, oc.section_key, oc.occurrence_count
  from public.regulatory_facts f
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id) oc
  where f.id = any(p_fact_ids) and f.status = 'VERIFIED';
$$;

comment on function public.get_regulatory_fact_search_context is 'Resolves the deterministic destination for a batch of RULE search results in one call -- never one RPC per result. Cannot be used to browse or enumerate facts generally: the caller must already hold real fact ids (from search_hub_content), and only VERIFIED facts with a real, currently-published destination return anything. regulatory_identity_id is returned for server-side grouping/personalisation comparison only (e.g. preferring the viewer''s own age grade within a group of otherwise-identical age-grade results) -- identity_key, never this uuid, is the public identifier that may appear in a URL.';

revoke all on function public.get_regulatory_fact_search_context(uuid[]) from public, anon;
grant execute on function public.get_regulatory_fact_search_context(uuid[]) to authenticated;

-- =====================================================================
-- Broad-browse regulatory RPCs. Three separate wrappers -- the underlying
-- canonical resolvers (resolve_age_grade_rule_bundle /
-- resolve_safeguarding_content_bundle / resolve_player_welfare_content_bundle)
-- genuinely have different return shapes, so one invented unified RPC
-- would flatten a distinction the model actually has. Each: takes the
-- stable public identity_key (never a uuid in the public signature);
-- resolves internally; hardcodes CURRENT_DATE (no caller-supplied date,
-- no historical browsing surface); is read-only and mutates no
-- session/cookie/active context; returns only VERIFIED/PUBLISHED/
-- currently-effective material via the same resolver the viewer's own
-- team-scoped page already trusts; returns only whitelisted identity
-- presentation fields (label, rugby_code) since regulatory_identities
-- itself has no public-read policy; returns empty for an unknown or
-- unmapped identity_key -- never an error, never a generic "browse all
-- identities" capability. Browsing an identity this way implies no
-- membership, no write authority, and no personalised safeguarding status
-- for the viewer.
-- =====================================================================

create or replace function public.get_rugby_hub_rules_by_identity(p_identity_key text)
returns table (
  content_set_id uuid, section_key text, fact_id uuid, fact_key text, fact_type text, value_type text,
  value_integer integer, value_decimal numeric, value_boolean boolean, value_duration_minutes integer,
  value_distance_metres numeric, value_range_min numeric, value_range_max numeric, value_enum text,
  value_text text, value_unit text, is_overlay boolean, primary_source_key text, primary_source_locator text,
  identity_label text, identity_rugby_code text
)
language plpgsql
stable
security definer
set search_path = public, internal
as $$
declare v_id uuid; v_code text; v_label text;
begin
  select id, rugby_code, label into v_id, v_code, v_label from public.regulatory_identities where identity_key = p_identity_key;
  if v_id is null then return; end if;

  return query
    select b.*, v_label, v_code
    from internal.resolve_age_grade_rule_bundle(v_code, v_id, current_date, null) b;
end;
$$;

comment on function public.get_rugby_hub_rules_by_identity is 'Broad-browse: the same PUBLISHED/VERIFIED rule bundle any team mapped to this identity would see, addressed directly by the stable public identity_key rather than through a team relationship. A read/browse capability only -- grants no membership, no write authority, no personalised status. CURRENT_DATE is hardcoded; there is no historical-date parameter.';

revoke all on function public.get_rugby_hub_rules_by_identity(text) from public, anon;
grant execute on function public.get_rugby_hub_rules_by_identity(text) to authenticated;

-- p_identity_key is optional here (unlike Rules): Safeguarding genuinely
-- has published, currently-effective general/code-wide guidance that is
-- not identity-scoped at all (regulatory_content_sets.regulatory_identity_id
-- is null) -- resolve_safeguarding_content_bundle already accepts a null
-- identity deliberately (see its own team-scoped wrapper's comment), so
-- this browse RPC must too rather than making general guidance unreachable.
create or replace function public.get_rugby_hub_safeguarding_by_identity(p_rugby_code text, p_identity_key text default null)
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_boolean boolean, body text, primary_source_key text, primary_source_locator text,
  identity_label text, identity_rugby_code text
)
language plpgsql
stable
security definer
set search_path = public, internal
as $$
declare v_id uuid; v_label text;
begin
  if p_rugby_code not in ('union', 'league') then return; end if;
  if p_identity_key is not null then
    select id, label into v_id, v_label from public.regulatory_identities where identity_key = p_identity_key and rugby_code = p_rugby_code;
    if v_id is null then return; end if;
  end if;

  return query
    select b.*, v_label, p_rugby_code
    from internal.resolve_safeguarding_content_bundle(p_rugby_code, current_date, v_id, 'GENERAL') b;
end;
$$;

comment on function public.get_rugby_hub_safeguarding_by_identity is 'Broad-browse safeguarding content for a rugby code, optionally narrowed to a specific identity_key, GENERAL audience only -- never guesses a personal role/audience for an identity the viewer has no actual relationship to. identity_key is optional because real, published, currently-effective safeguarding content genuinely is not always identity-scoped. Same read-only/no-authority/no-historical-date guarantees as get_rugby_hub_rules_by_identity.';

revoke all on function public.get_rugby_hub_safeguarding_by_identity(text, text) from public, anon;
grant execute on function public.get_rugby_hub_safeguarding_by_identity(text, text) to authenticated;

create or replace function public.get_rugby_hub_welfare_by_identity(p_rugby_code text, p_identity_key text default null)
returns table (
  content_set_id uuid, section_key text, display_order integer, fact_id uuid, fact_type text, value_type text,
  value_text text, value_integer integer, value_unit text, obligation_level text, body text,
  primary_source_key text, primary_source_locator text, identity_label text, identity_rugby_code text
)
language plpgsql
stable
security definer
set search_path = public, internal
as $$
declare v_id uuid; v_label text;
begin
  if p_rugby_code not in ('union', 'league') then return; end if;
  if p_identity_key is not null then
    select id, label into v_id, v_label from public.regulatory_identities where identity_key = p_identity_key and rugby_code = p_rugby_code;
    if v_id is null then return; end if;
  end if;

  return query
    select b.*, v_label, p_rugby_code
    from internal.resolve_player_welfare_content_bundle(p_rugby_code, current_date, v_id, 'GENERAL') b;
end;
$$;

comment on function public.get_rugby_hub_welfare_by_identity is 'Broad-browse player-welfare content for a rugby code, optionally narrowed to a specific identity_key, GENERAL audience only. identity_key is optional for the same reason as get_rugby_hub_safeguarding_by_identity. Same read-only/no-authority/no-historical-date guarantees as get_rugby_hub_rules_by_identity.';

revoke all on function public.get_rugby_hub_welfare_by_identity(text, text) from public, anon;
grant execute on function public.get_rugby_hub_welfare_by_identity(text, text) to authenticated;
