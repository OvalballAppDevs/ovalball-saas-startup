-- ===========================================================================
-- A RULE OF PLAY CAN BE FOUND (RH-M0.2, search)
-- ===========================================================================
--
-- THE FINDING. `regulatory_facts.search_vector` was generated from `value_text` alone. A rule stated
-- in words ("Rolling substitutions are permitted…") was searchable; a rule stated as a MEASURE --
-- ball size 3, six a side, 45 metres, 10 minutes -- carried an empty vector, because its value is a
-- number and its words live in `display_title`, `notes` and its category. 65 of the 139 verified
-- RULES facts could not be found by any query at all, and every one of them is an age-grade Rule
-- of Play. The RH-M0.2 readers put those rules on the page; this lets search reach them.
--
-- THE FIX. The generated column now indexes what a person would type: the rule's own words
-- (value_text, A), its title (A), its category in words ("ball size", "player count", B) and the
-- governing body's note (C). It stays a generated column over the row's own columns -- nothing is
-- written by hand, and a corrected fact re-indexes itself. The GIN index is rebuilt with it, and
-- the search RPC's RULE snippet falls back to the title and the note where there is no rule text.
--
-- Forward-only: a generated column is recomputed, never migrated. No grant changes.
-- ===========================================================================

alter table public.regulatory_facts drop column search_vector;

alter table public.regulatory_facts
  add column search_vector tsvector
  generated always as (
    setweight(internal.immutable_english_tsvector(coalesce(value_text, '')), 'A')
    || setweight(internal.immutable_english_tsvector(coalesce(display_title, '')), 'A')
    || setweight(internal.immutable_english_tsvector(replace(lower(coalesce(fact_type, '')), '_', ' ')), 'B')
    || setweight(internal.immutable_english_tsvector(coalesce(notes, '')), 'C')
  ) stored;

create index regulatory_facts_search_vector_idx on public.regulatory_facts using gin (search_vector);

comment on column public.regulatory_facts.search_vector is
  'Generated: the rule''s words (value_text, display_title), its category in words (fact_type) and the governing body''s note, so a rule stated as a measure is as findable as one stated in words.';

create or replace function public.search_hub_content(p_query text, p_limit integer default 20)
returns table(result_type text, result_id uuid, title text, snippet text, rank real)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
  -- A RULE row's title is resolved by the client from its destination (get_regulatory_fact_search_context);
  -- the snippet is the rule's own words, else its title, else the governing body's note.
  select 'RULE', f.id, coalesce(oc.section_key, 'Rule'),
    coalesce(nullif(left(f.value_text, 200), ''), f.display_title, left(f.notes, 200)),
    ts_rank(f.search_vector, q.tsq) as rank
  from public.regulatory_facts f, q
  cross join lateral internal.regulatory_fact_primary_occurrence(f.id) oc
  where f.status = 'VERIFIED' and f.search_vector @@ q.tsq and oc.destination_kind is not null
  union all
  select 'STORY', id, title, summary, ts_rank(search_vector, q.tsq) as rank
  from public.heritage_entries, q
  where search_vector @@ q.tsq
  order by rank desc
  limit p_limit;
$function$;

do $$
declare v_empty int; v_found int;
begin
  select count(*) into v_empty from public.regulatory_facts where status = 'VERIFIED' and topic = 'RULES' and search_vector::text = '';
  if v_empty > 0 then
    raise exception '% verified RULES facts still have an empty search vector', v_empty;
  end if;
  select count(*) into v_found from public.search_hub_content('ball size', 20) s where s.result_type = 'RULE';
  if v_found = 0 then
    raise exception 'a Rule of Play stated as a measure (ball size) is still not findable';
  end if;
  if has_function_privilege('anon', 'public.search_hub_content(text, integer)', 'EXECUTE') then
    raise exception 'search_hub_content must not be executable by anon';
  end if;
end $$;
