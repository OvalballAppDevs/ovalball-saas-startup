-- Rugby Hub general-knowledge applicability and relationships.
--
-- APPLICABILITY reuses the exact semantics regulatory_fact_applicability
-- already proved (20261029010000): resolved through a join table, never a
-- direct column implying a default. The one addition this table needs that
-- regulatory_fact_applicability didn't: an explicit is_universal flag.
-- regulatory_fact_applicability never needed one because EVERY regulatory
-- fact is identity-scoped by definition -- there is no such thing as a
-- universal regulatory fact. General knowledge is different: a lot of
-- coaching guidance and glossary content genuinely applies to everyone,
-- and "no applicability row yet" must never be silently read as "applies
-- to everyone" -- that would let unfinished, unscoped draft content reach
-- every viewer the moment it publishes. So UNIVERSAL is a row you write,
-- not an absence you rely on.
--
-- The parent is exactly one of four real foreign keys (content item,
-- position, skill, glossary term) -- the same num_nonnulls-checked
-- mutually-exclusive-FK pattern public.fixture_messages already uses for
-- "this row belongs to exactly one of several possible parents". No
-- polymorphic (type, uuid) pair, no unchecked reference -- every parent
-- link is a real FK Postgres enforces.

create table public.hub_content_applicability (
  id uuid primary key default gen_random_uuid(),

  content_item_id uuid references public.hub_content_items(id) on delete cascade,
  position_id uuid references public.hub_positions(id) on delete cascade,
  skill_id uuid references public.hub_skills(id) on delete cascade,
  glossary_term_id uuid references public.hub_glossary_terms(id) on delete cascade,

  is_universal boolean not null default false,
  regulatory_identity_id uuid references public.regulatory_identities(id),
  competition_overlay_id uuid references public.regulatory_competition_overlays(id),
  gender_pathway text check (gender_pathway in ('MALE', 'FEMALE', 'MIXED', 'OPEN')),
  geographic_scope text,
  season_id uuid references public.seasons(id),
  effective_from date,
  effective_to date,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint hub_content_applicability_exactly_one_parent check (
    num_nonnulls(content_item_id, position_id, skill_id, glossary_term_id) = 1
  ),
  -- A universal row carries no scoping dimension at all (it IS the
  -- statement "applies to everyone"); a scoped row must carry at least one
  -- real dimension -- an empty, non-universal row would be a meaningless
  -- applicability fact that resolves nothing and blocks nothing.
  constraint hub_content_applicability_universal_is_pure check (
    (is_universal = true and regulatory_identity_id is null and competition_overlay_id is null and gender_pathway is null and geographic_scope is null and season_id is null)
    or
    (is_universal = false and (regulatory_identity_id is not null or competition_overlay_id is not null or gender_pathway is not null or geographic_scope is not null or season_id is not null))
  ),
  constraint hub_content_applicability_effective_range_ordered check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  )
);
comment on table public.hub_content_applicability is 'Applicability for general Rugby Hub knowledge -- code/age-identity/pathway/jurisdiction/season, resolved via this join table exactly as regulatory_fact_applicability already proved. NEVER infer applicability from prose or from a missing row: is_universal=true is an explicit fact, not a default. A resolver querying "does this content apply to viewer X" must treat zero matching rows as NOT APPLICABLE, never as universal.';
comment on column public.hub_content_applicability.is_universal is 'Explicit "applies to everyone" statement. Content with zero applicability rows is not yet scoped and must not be treated as universal by any resolver -- see hub_require_applicability_before_publish, which refuses PUBLISHED status until at least one row (universal or scoped) exists.';

create unique index hub_content_applicability_universal_unique_idx
  on public.hub_content_applicability (coalesce(content_item_id, position_id, skill_id, glossary_term_id))
  where is_universal = true;

create index hub_content_applicability_content_item_idx on public.hub_content_applicability(content_item_id) where content_item_id is not null;
create index hub_content_applicability_position_idx on public.hub_content_applicability(position_id) where position_id is not null;
create index hub_content_applicability_skill_idx on public.hub_content_applicability(skill_id) where skill_id is not null;
create index hub_content_applicability_glossary_term_idx on public.hub_content_applicability(glossary_term_id) where glossary_term_id is not null;
create index hub_content_applicability_identity_idx on public.hub_content_applicability(regulatory_identity_id) where regulatory_identity_id is not null;

alter table public.hub_content_applicability enable row level security;

create policy hub_content_applicability_admin_all on public.hub_content_applicability
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

-- Public read follows the PARENT's publication state -- an applicability
-- row for a draft position must not leak that the draft exists, even
-- though the row itself carries no title or body.
create policy hub_content_applicability_public_read on public.hub_content_applicability
  for select using (
    (content_item_id is not null and exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED'))
    or (position_id is not null and exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED'))
    or (skill_id is not null and exists (select 1 from public.hub_skills s where s.id = skill_id and s.status = 'PUBLISHED'))
    or (glossary_term_id is not null and exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED'))
  );

-- ---------------------------------------------------------------------
-- Publish requires applicability. Enforced as a trigger (not a same-row
-- CHECK constraint, since it must look at a different table) so it holds
-- regardless of caller -- RPC or a direct authorised write both go through
-- it. Mirrors, in spirit, regulatory_content_sets' own
-- ..._published_requires_metadata pattern: PUBLISHED is a state you can
-- only reach with the supporting facts already in place.
-- ---------------------------------------------------------------------

create or replace function internal.hub_require_applicability_before_publish()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $$
begin
  if new.status = 'PUBLISHED' and (tg_op = 'INSERT' or old.status is distinct from 'PUBLISHED') then
    if not exists (
      select 1 from public.hub_content_applicability a
      where (tg_table_name = 'hub_content_items' and a.content_item_id = new.id)
         or (tg_table_name = 'hub_positions' and a.position_id = new.id)
         or (tg_table_name = 'hub_skills' and a.skill_id = new.id)
         or (tg_table_name = 'hub_glossary_terms' and a.glossary_term_id = new.id)
    ) then
      raise exception 'Cannot publish %: no applicability row exists. Add an explicit applicability fact (including is_universal=true if it genuinely applies to everyone) before publishing.', tg_table_name using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
comment on function internal.hub_require_applicability_before_publish is 'Refuses PUBLISHED status until at least one hub_content_applicability row exists for this content -- so unfinished, unscoped drafts can never reach a wider audience than intended merely by flipping a status column. is_universal must be set explicitly to reach everyone; there is no way to publish with zero applicability rows.';

create trigger require_applicability_before_publish before insert or update on public.hub_content_items for each row execute function internal.hub_require_applicability_before_publish();
create trigger require_applicability_before_publish before insert or update on public.hub_positions for each row execute function internal.hub_require_applicability_before_publish();
create trigger require_applicability_before_publish before insert or update on public.hub_skills for each row execute function internal.hub_require_applicability_before_publish();
create trigger require_applicability_before_publish before insert or update on public.hub_glossary_terms for each row execute function internal.hub_require_applicability_before_publish();

-- ---------------------------------------------------------------------
-- Position age-stage: does this position even apply at this age/identity?
-- A SEPARATE, explicit fact from age_guidance_note's development prose --
-- never forcing adult positional structure onto age grades that don't use
-- it. NORMAL / EMERGING / NOT_APPLICABLE are the only three answers; a
-- young player must never see an empty position page and be left to guess
-- why -- the UI renders NOT_APPLICABLE / EMERGING as an explicit, honest
-- state, sourced from here, never hardcoded prose per age grade.
-- ---------------------------------------------------------------------

create table public.hub_position_age_stage (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.hub_positions(id) on delete cascade,
  regulatory_identity_id uuid not null references public.regulatory_identities(id),
  stage text not null check (stage in ('NORMAL', 'EMERGING', 'NOT_APPLICABLE')),
  stage_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (position_id, regulatory_identity_id),
  constraint hub_position_age_stage_note_required_unless_normal check (
    stage = 'NORMAL' or stage_note is not null
  )
);
comment on table public.hub_position_age_stage is 'Whether a position genuinely applies at a given regulatory identity (age grade). NOT_APPLICABLE/EMERGING are valid, permanent, honest states -- rendered explicitly by the UI, never inferred from an absent row (an absent row means "not yet assessed", not "normal").';

create index hub_position_age_stage_position_idx on public.hub_position_age_stage(position_id);
create index hub_position_age_stage_identity_idx on public.hub_position_age_stage(regulatory_identity_id);

alter table public.hub_position_age_stage enable row level security;

create policy hub_position_age_stage_admin_all on public.hub_position_age_stage
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_position_age_stage_public_read on public.hub_position_age_stage
  for select using (
    exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED')
  );

create trigger set_updated_at before update on public.hub_position_age_stage for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.hub_position_age_stage for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- Knowledge relationships -- one small, precisely-typed table per real
-- relationship shape, each with genuine two-column FK integrity. No
-- generic polymorphic (type, uuid) relationship table: the brief is
-- explicit that relational integrity is preferred over flexibility for
-- its own sake, and each of these pairs has a real, fixed shape anyway
-- (a position relates to a skill, not to "some entity of some type").
-- ---------------------------------------------------------------------

-- POSITION_SKILL
create table public.hub_position_skills (
  position_id uuid not null references public.hub_positions(id) on delete cascade,
  skill_id uuid not null references public.hub_skills(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key (position_id, skill_id)
);
comment on table public.hub_position_skills is 'Which skills matter for which position. POSITION_SKILL relationship.';

-- RELATED_POSITION
create table public.hub_position_relationships (
  position_id uuid not null references public.hub_positions(id) on delete cascade,
  related_position_id uuid not null references public.hub_positions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (position_id, related_position_id),
  constraint hub_position_relationships_not_self check (position_id <> related_position_id)
);
comment on table public.hub_position_relationships is 'Adjacent/related positions, drives prev/next navigation in the future Position Explorer. Directional by row -- store both directions explicitly if the relationship is genuinely symmetric, since "related" is not always reciprocal (a starting front-row player''s adjacent positions differ from a specialist''s).';

-- SKILL_PREREQUISITE + skill-to-skill RELATED
create table public.hub_skill_relationships (
  skill_id uuid not null references public.hub_skills(id) on delete cascade,
  related_skill_id uuid not null references public.hub_skills(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('PREREQUISITE', 'RELATED')),
  created_at timestamptz not null default now(),
  primary key (skill_id, related_skill_id, relationship_type),
  constraint hub_skill_relationships_not_self check (skill_id <> related_skill_id)
);
comment on table public.hub_skill_relationships is 'PREREQUISITE: related_skill_id should generally come before skill_id. RELATED: a same-level, non-ordered relationship.';

-- SKILL_TRAINING
create table public.hub_skill_content_links (
  skill_id uuid not null references public.hub_skills(id) on delete cascade,
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (skill_id, content_item_id)
);
comment on table public.hub_skill_content_links is 'Links a skill to COACHING_GUIDANCE/PRACTICAL_GUIDE content items that develop it. SKILL_TRAINING relationship.';

-- RELATED_KNOWLEDGE + CONCEPT_RELATED (content-to-content)
create table public.hub_content_relationships (
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  related_content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('RELATED_KNOWLEDGE', 'CONCEPT_RELATED')),
  created_at timestamptz not null default now(),
  primary key (content_item_id, related_content_item_id, relationship_type),
  constraint hub_content_relationships_not_self check (content_item_id <> related_content_item_id)
);
comment on table public.hub_content_relationships is 'Content-to-content relationships. RELATED_KNOWLEDGE for general "see also"; CONCEPT_RELATED for a tighter conceptual link (e.g. two articles that together explain one idea).';

-- GLOSSARY_RELATED
create table public.hub_glossary_relationships (
  glossary_term_id uuid not null references public.hub_glossary_terms(id) on delete cascade,
  related_glossary_term_id uuid not null references public.hub_glossary_terms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (glossary_term_id, related_glossary_term_id),
  constraint hub_glossary_relationships_not_self check (glossary_term_id <> related_glossary_term_id)
);
comment on table public.hub_glossary_relationships is 'GLOSSARY_RELATED relationship -- e.g. "ruck" and "maul" cross-referenced so a reader lands on the distinction, not just one definition.';

-- RULE_EXPLANATION + RULE_GLOSSARY -- THE regulatory-fact-reference
-- mechanism. This is how general content explains a rule without
-- restating it: it links to the canonical regulatory_facts row and the
-- UI renders that fact directly, never a second copy of the assertion in
-- hub_content_items prose. Exactly one of content_item_id/glossary_term_id
-- is set per row, matching the num_nonnulls "exactly one parent" pattern
-- already used above and elsewhere in this codebase (public.fixture_messages).
create table public.hub_regulatory_fact_references (
  id uuid primary key default gen_random_uuid(),
  regulatory_fact_id uuid not null references public.regulatory_facts(id) on delete cascade,
  content_item_id uuid references public.hub_content_items(id) on delete cascade,
  glossary_term_id uuid references public.hub_glossary_terms(id) on delete cascade,
  reference_type text not null check (reference_type in ('RULE_EXPLANATION', 'RULE_GLOSSARY')),
  created_at timestamptz not null default now(),
  constraint hub_regulatory_fact_references_exactly_one_target check (
    num_nonnulls(content_item_id, glossary_term_id) = 1
  ),
  constraint hub_regulatory_fact_references_type_matches_target check (
    (reference_type = 'RULE_EXPLANATION' and content_item_id is not null)
    or (reference_type = 'RULE_GLOSSARY' and glossary_term_id is not null)
  )
);
comment on table public.hub_regulatory_fact_references is 'THE mechanism for general knowledge to reference regulatory truth without duplicating it. A COACHING_GUIDANCE article that needs to explain a rule links here (RULE_EXPLANATION) and renders the canonical regulatory_facts row; a glossary term whose definition depends on law does the same (RULE_GLOSSARY). Never restate the regulatory claim in hub_content_items/hub_glossary_terms prose -- see hub_content_items_no_regulatory_escape_hatch.';

create index hub_position_skills_skill_idx on public.hub_position_skills(skill_id);
create index hub_position_relationships_related_idx on public.hub_position_relationships(related_position_id);
create index hub_skill_relationships_related_idx on public.hub_skill_relationships(related_skill_id);
create index hub_skill_content_links_content_item_idx on public.hub_skill_content_links(content_item_id);
create index hub_content_relationships_related_idx on public.hub_content_relationships(related_content_item_id);
create index hub_glossary_relationships_related_idx on public.hub_glossary_relationships(related_glossary_term_id);
create index hub_regulatory_fact_references_fact_idx on public.hub_regulatory_fact_references(regulatory_fact_id);
create index hub_regulatory_fact_references_content_item_idx on public.hub_regulatory_fact_references(content_item_id) where content_item_id is not null;
create index hub_regulatory_fact_references_glossary_term_idx on public.hub_regulatory_fact_references(glossary_term_id) where glossary_term_id is not null;

alter table public.hub_position_skills enable row level security;
alter table public.hub_position_relationships enable row level security;
alter table public.hub_skill_relationships enable row level security;
alter table public.hub_skill_content_links enable row level security;
alter table public.hub_content_relationships enable row level security;
alter table public.hub_glossary_relationships enable row level security;
alter table public.hub_regulatory_fact_references enable row level security;

create policy hub_position_skills_admin_all on public.hub_position_skills for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_position_skills_public_read on public.hub_position_skills for select using (
  exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED')
  and exists (select 1 from public.hub_skills s where s.id = skill_id and s.status = 'PUBLISHED')
);

create policy hub_position_relationships_admin_all on public.hub_position_relationships for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_position_relationships_public_read on public.hub_position_relationships for select using (
  exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED')
  and exists (select 1 from public.hub_positions p2 where p2.id = related_position_id and p2.status = 'PUBLISHED')
);

create policy hub_skill_relationships_admin_all on public.hub_skill_relationships for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_skill_relationships_public_read on public.hub_skill_relationships for select using (
  exists (select 1 from public.hub_skills s where s.id = skill_id and s.status = 'PUBLISHED')
  and exists (select 1 from public.hub_skills s2 where s2.id = related_skill_id and s2.status = 'PUBLISHED')
);

create policy hub_skill_content_links_admin_all on public.hub_skill_content_links for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_skill_content_links_public_read on public.hub_skill_content_links for select using (
  exists (select 1 from public.hub_skills s where s.id = skill_id and s.status = 'PUBLISHED')
  and exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED')
);

create policy hub_content_relationships_admin_all on public.hub_content_relationships for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_content_relationships_public_read on public.hub_content_relationships for select using (
  exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED')
  and exists (select 1 from public.hub_content_items c2 where c2.id = related_content_item_id and c2.status = 'PUBLISHED')
);

create policy hub_glossary_relationships_admin_all on public.hub_glossary_relationships for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_glossary_relationships_public_read on public.hub_glossary_relationships for select using (
  exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED')
  and exists (select 1 from public.hub_glossary_terms g2 where g2.id = related_glossary_term_id and g2.status = 'PUBLISHED')
);

create policy hub_regulatory_fact_references_admin_all on public.hub_regulatory_fact_references for all using (internal.has_capability('site.hub_content.view', 'site')) with check (internal.has_capability('site.hub_content.manage', 'site'));
create policy hub_regulatory_fact_references_public_read on public.hub_regulatory_fact_references for select using (
  (content_item_id is not null and exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED'))
  or (glossary_term_id is not null and exists (select 1 from public.hub_glossary_terms g where g.id = glossary_term_id and g.status = 'PUBLISHED'))
);
