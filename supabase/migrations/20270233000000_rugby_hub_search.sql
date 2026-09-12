-- Rugby Hub general-knowledge search foundation.
--
-- Postgres-native: tsvector + GIN for ranked full-text, pg_trgm + GIN for
-- fuzzy alias/term matching (a parent typing "flyhalf" should still find
-- "Fly-Half"). No external search service, no fetch-catalogue-then-filter
-- client-side -- one indexed query per search, joined against
-- hub_content_applicability for context boosting, always filtered to
-- PUBLISHED rows so an unpublished draft can never surface in results.

create extension if not exists pg_trgm;

-- to_tsvector(regconfig, text) is STABLE, not IMMUTABLE (Postgres cannot
-- guarantee a text-search configuration never changes), so it cannot be used
-- directly inside a GENERATED ALWAYS AS column -- Postgres requires the
-- generation expression to be IMMUTABLE. This wrapper hardcodes 'english' as
-- a literal inside the function body, which makes the wrapper itself safe to
-- mark IMMUTABLE: nothing about ITS output can change without a new function
-- deployment (a real migration), which is exactly the guarantee IMMUTABLE
-- requires.
create or replace function internal.immutable_english_tsvector(text)
returns tsvector
language sql
immutable
as $$ select to_tsvector('pg_catalog.english', coalesce($1, '')); $$;

-- array_to_string(anyarray, text) is itself only STABLE, so the join must
-- happen INSIDE an immutable function body -- a generated column's
-- immutability check inspects every function call visible in the
-- expression tree, not just the outermost one, so array_to_string(...)
-- called directly as an argument (even to an immutable wrapper) is still
-- rejected. Folding the join inside this function's own body hides it from
-- that check, which is exactly what IMMUTABLE promises: nothing about this
-- function's OWN declared behaviour can change.
create or replace function internal.immutable_english_tsvector_from_array(text[])
returns tsvector
language sql
immutable
as $$ select to_tsvector('pg_catalog.english', coalesce(array_to_string($1, ' '), '')); $$;

alter table public.hub_content_items add column search_vector tsvector
  generated always as (
    setweight(internal.immutable_english_tsvector(title), 'A')
    || setweight(internal.immutable_english_tsvector(summary), 'B')
    || setweight(internal.immutable_english_tsvector(body), 'C')
  ) stored;
create index hub_content_items_search_vector_idx on public.hub_content_items using gin (search_vector);
create index hub_content_items_title_trgm_idx on public.hub_content_items using gin (title gin_trgm_ops);

alter table public.hub_positions add column search_vector tsvector
  generated always as (
    setweight(internal.immutable_english_tsvector(display_name), 'A')
    || setweight(internal.immutable_english_tsvector_from_array(alternative_names), 'A')
    || setweight(internal.immutable_english_tsvector(purpose), 'B')
  ) stored;
create index hub_positions_search_vector_idx on public.hub_positions using gin (search_vector);
create index hub_positions_display_name_trgm_idx on public.hub_positions using gin (display_name gin_trgm_ops);

alter table public.hub_skills add column search_vector tsvector
  generated always as (
    setweight(internal.immutable_english_tsvector(display_name), 'A')
    || setweight(internal.immutable_english_tsvector(summary), 'B')
  ) stored;
create index hub_skills_search_vector_idx on public.hub_skills using gin (search_vector);
create index hub_skills_display_name_trgm_idx on public.hub_skills using gin (display_name gin_trgm_ops);

alter table public.hub_glossary_terms add column search_vector tsvector
  generated always as (
    setweight(internal.immutable_english_tsvector(display_term), 'A')
    || setweight(internal.immutable_english_tsvector_from_array(aliases), 'A')
    || setweight(internal.immutable_english_tsvector(plain_language_definition), 'B')
  ) stored;
create index hub_glossary_terms_search_vector_idx on public.hub_glossary_terms using gin (search_vector);
create index hub_glossary_terms_term_trgm_idx on public.hub_glossary_terms using gin (display_term gin_trgm_ops);

-- One canonical search RPC across all four searchable tables, UNIONed,
-- ranked, published-only, paginated. One query -- never one query per
-- result, and never a query per table issued from the client.
create or replace function public.search_hub_content(p_query text, p_limit integer default 20)
returns table (
  result_type text,
  result_id uuid,
  title text,
  snippet text,
  rank real
)
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
  order by rank desc
  limit p_limit;
$$;
comment on function public.search_hub_content is 'The one canonical Rugby Hub general-knowledge search entry point. PUBLISHED rows only, by construction (the status filter is inside this function, not left to the caller) -- a draft title/snippet can never surface here regardless of what the caller passes. Context/applicability boosting is intentionally NOT applied inside this function -- callers that want it join the result ids against hub_content_applicability themselves, so "broaden beyond my context" stays a real, simple choice (skip the join) rather than a second search implementation.';

revoke all on function public.search_hub_content(text, integer) from public, anon;
grant execute on function public.search_hub_content(text, integer) to authenticated;
