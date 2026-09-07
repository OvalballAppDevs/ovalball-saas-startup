-- Regulatory content data model (Rugby Hub Phase 2, Side Project 3 Stages
-- 0/2/6 real integration).
--
-- Ported from ovalball-rugby-knowledge's Stage 2 regulatory data model
-- (12 migrations, 20261101000000-20261101110000, audited directly, not
-- copied file-for-file) plus Stage 3/4/5's schema-only additions (fact_type
-- taxonomy widening, obligation_level, the reporting-routes table) folded
-- in from the start rather than replayed as incremental ALTERs, since there
-- is no existing Main data to preserve compatibility with. NO regulatory
-- content is populated by this migration or by this phase -- every table
-- below is created genuinely empty. Populating real sources/facts/content
-- is a separate, deliberately gated later decision (see this session's own
-- Phase 3 checkpoint) given the real, disclosed coverage gaps and open
-- conflicts in SP3's own vertical-slice content.
--
-- Reconciled from SP3's own "MUST BE REVIEWED AT INTEGRATION" list
-- (docs/SIDE_PROJECT_3_INTEGRATION_MANIFEST.md):
--   1. Authorization: every regulatory.* RLS check below uses Main's real
--      internal.has_capability('site.regulatory.view'|'site.regulatory.
--      manage', 'site') (20261029000000_regulatory_capabilities.sql) --
--      SP3's own temporary regulatory_admins scaffold is not ported at all.
--   2. Soft references: ovalball_canonical_team_type_id and
--      ovalball_competition_id are REAL foreign keys here (SP3 kept them
--      soft specifically to avoid coupling an isolated fork to Main's
--      live schema before integration -- that reason no longer applies).
--   3. Resolver security hardening: handled in 20261029030000_regulatory_
--      resolvers.sql, not in this schema migration.

-- ---------------------------------------------------------------------
-- 1. Authorities and sources
-- ---------------------------------------------------------------------

create table public.regulatory_authorities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  website_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.regulatory_authorities is 'Normalized governing-body identity (RFU, RFL, World Rugby). Regulatory provenance only -- distinct from public.constituent_bodies, which models which RFU county/services body a CLUB belongs to for club-identity purposes, not a content-provenance source.';

create table public.regulatory_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  authority_id uuid not null references public.regulatory_authorities(id),
  rugby_code text not null check (rugby_code in ('union', 'league')),

  title text not null,
  source_type text not null check (source_type in (
    'REGULATION', 'RULEBOOK', 'POLICY_DOCUMENT', 'WEB_GUIDANCE',
    'LEARNING_RESOURCE', 'MEDIA_STATEMENT', 'COMPETITION_RULES', 'OTHER'
  )),
  authority_classification text not null check (authority_classification in (
    'PRIMARY_REGULATION', 'PRIMARY_RULE_BOOK', 'PRIMARY_POLICY',
    'PRIMARY_MEDICAL_GUIDANCE', 'PRIMARY_SAFEGUARDING_GUIDANCE',
    'PRIMARY_COMPETITION_OVERLAY', 'OFFICIAL_EXPLANATORY_GUIDANCE',
    'OFFICIAL_LEARNING_RESOURCE', 'SECONDARY_DISCOVERY_ONLY'
  )),

  canonical_url text not null,
  landing_page_url text,
  document_version text,
  publication_date date,
  retrieved_on date not null,

  effective_from date,
  effective_to date,
  season_id uuid references public.seasons(id),

  geographic_scope text,
  competition_scope text,
  pathway_scope text,

  review_state text not null default 'DISCOVERED' check (review_state in (
    'DISCOVERED', 'REVIEW_REQUIRED', 'VERIFIED_CURRENT', 'CONFLICTING',
    'SUPERSEDED', 'STALE', 'UNRESOLVED'
  )),
  supersedes_source_id uuid references public.regulatory_sources(id),

  notes text,
  provenance_notes text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.regulatory_sources is 'One row per identifiable authoritative document/resource/version. effective_to/superseded rows are NEVER deleted -- source history stays auditable.';
comment on column public.regulatory_sources.supersedes_source_id is 'Points at the OLDER source this one replaces. The reverse is derived by querying WHERE supersedes_source_id = this.id, never stored redundantly.';
comment on column public.regulatory_sources.review_state is 'The EVIDENCE/SOURCE layer state -- a separate state machine from regulatory_facts.status (interpretation layer) and regulatory_content_sets.publication_state (user-facing layer). Three deliberately independent layers, never collapsed into one.';

create index regulatory_sources_authority_id_idx on public.regulatory_sources(authority_id);
create index regulatory_sources_review_state_idx on public.regulatory_sources(review_state);
create index regulatory_sources_rugby_code_idx on public.regulatory_sources(rugby_code);
create index regulatory_sources_season_id_idx on public.regulatory_sources(season_id) where season_id is not null;

create table public.regulatory_source_locators (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id) on delete cascade,
  locator_type text not null check (locator_type in (
    'REGULATION_NUMBER', 'SECTION', 'APPENDIX', 'PAGE', 'HEADING', 'PARAGRAPH', 'OTHER'
  )),
  locator_value text not null,
  description text,
  created_at timestamptz not null default now()
);
comment on table public.regulatory_source_locators is 'Citation precision finer than a URL (e.g. "Appendix 9", "Section F6"). Never stores the source document itself.';

create index regulatory_source_locators_source_id_idx on public.regulatory_source_locators(source_id);

-- ---------------------------------------------------------------------
-- 2. Ovalball <-> regulatory identity mapping (real FKs -- see header)
-- ---------------------------------------------------------------------

create table public.regulatory_identities (
  id uuid primary key default gen_random_uuid(),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  identity_key text not null unique,
  label text not null,

  mapping_type text not null check (mapping_type in (
    'DIRECT', 'DERIVED_COMPOSITE', 'NO_DIRECT_MAPPING', 'REVIEW_REQUIRED'
  )),
  ovalball_canonical_team_type_id uuid references public.canonical_team_types(id),

  mapping_notes text,
  source_register_reference text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_identities_notes_required_unless_direct check (
    mapping_type = 'DIRECT' or mapping_notes is not null
  )
);
comment on table public.regulatory_identities is 'The explicit Ovalball-team <-> regulatory-identity mapping layer. NO_DIRECT_MAPPING and REVIEW_REQUIRED are valid, honest, permanent states -- never resolved by inventing a category or parsing a team display name.';

create index regulatory_identities_rugby_code_idx on public.regulatory_identities(rugby_code);
create index regulatory_identities_mapping_type_idx on public.regulatory_identities(mapping_type);
create index regulatory_identities_team_type_idx on public.regulatory_identities(ovalball_canonical_team_type_id) where ovalball_canonical_team_type_id is not null;

create table public.regulatory_competition_overlays (
  id uuid primary key default gen_random_uuid(),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  ovalball_competition_id uuid references public.competitions(id),
  competition_label text not null,
  season_id uuid references public.seasons(id),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.regulatory_competition_overlays is 'A competition-specific regulatory variant layered on top of a base governing-body rule -- never presented as if it were the national rule. season_id stays nullable: Main''s competitions table has no confirmed competition<->season binding today.';

create index regulatory_competition_overlays_rugby_code_idx on public.regulatory_competition_overlays(rugby_code);
create index regulatory_competition_overlays_competition_idx on public.regulatory_competition_overlays(ovalball_competition_id) where ovalball_competition_id is not null;

-- ---------------------------------------------------------------------
-- 3. Facts (taxonomy widened + obligation_level folded in from the start)
-- ---------------------------------------------------------------------

create table public.regulatory_facts (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null unique,
  fact_type text not null check (fact_type in (
    'PLAYER_COUNT','MATCH_DURATION','BALL_SIZE','PITCH_LENGTH','PITCH_WIDTH','PITCH_VARIATION',
    'SCRUM','LINEOUT','KICKING','RESTART','TACKLE_CONTACT','SUBSTITUTION','SCORING_VARIATION',
    'PLAYING_UP_DOWN','MATCH_FORMAT','OTHER_AGE_VARIATION',
    'PITCH_DIMENSION','SCRUM_CONFIGURATION','LINEOUT_CONFIGURATION','PLAYING_ELIGIBILITY','CONTACT_RULE',
    'SAFEGUARDING_REVIEW_CYCLE','SAFEGUARDING_POLICY_SCOPE','SAFEGUARDING_ROLE_REQUIREMENT',
    'SAFEGUARDING_TRAINING_REQUIREMENT','SAFEGUARDING_PRINCIPLE_STATEMENT',
    'COMMUNITY_GAME_PROTOCOL','ELITE_PROTOCOL','RED_FLAGS_EMERGENCY','MEDICAL_ASSESSMENT',
    'REMOVE_FROM_PLAY','RETURN_TO_PLAY_MINIMUM_DURATION',
    'OTHER'
  )),
  topic text not null check (topic in ('RULES', 'SAFEGUARDING', 'PLAYER_WELFARE')),
  subtopic text,
  rugby_code text not null check (rugby_code in ('union', 'league')),

  value_type text not null check (value_type in (
    'INTEGER', 'DECIMAL', 'BOOLEAN', 'DURATION', 'DISTANCE', 'RANGE', 'ENUM', 'TEXT', 'JSON'
  )),
  value_integer integer,
  value_decimal numeric,
  value_boolean boolean,
  value_duration_minutes integer,
  value_distance_metres numeric,
  value_range_min numeric,
  value_range_max numeric,
  value_enum text,
  value_text text,
  value_json jsonb,
  value_unit text,

  obligation_level text check (obligation_level is null or obligation_level in ('MANDATORY', 'REQUIRED', 'RECOMMENDED', 'ADVISORY', 'INFORMATIONAL')),

  season_id uuid references public.seasons(id),
  effective_from date,
  effective_to date,

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEW_REQUIRED', 'CONFLICTING', 'VERIFIED', 'SUPERSEDED'
  )),
  supersedes_fact_id uuid references public.regulatory_facts(id),

  verified_by uuid references auth.users(id),
  verified_at timestamptz,

  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_facts_one_value_matches_type check (
    (value_type = 'INTEGER' and num_nonnulls(value_integer) = 1 and num_nonnulls(value_decimal, value_boolean, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_enum, value_text, value_json) = 0)
    or (value_type = 'DECIMAL' and num_nonnulls(value_decimal) = 1 and num_nonnulls(value_integer, value_boolean, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_enum, value_text, value_json) = 0)
    or (value_type = 'BOOLEAN' and num_nonnulls(value_boolean) = 1 and num_nonnulls(value_integer, value_decimal, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_enum, value_text, value_json) = 0)
    or (value_type = 'DURATION' and num_nonnulls(value_duration_minutes) = 1 and num_nonnulls(value_integer, value_decimal, value_boolean, value_distance_metres, value_range_min, value_range_max, value_enum, value_text, value_json) = 0)
    or (value_type = 'DISTANCE' and num_nonnulls(value_distance_metres) = 1 and num_nonnulls(value_integer, value_decimal, value_boolean, value_duration_minutes, value_range_min, value_range_max, value_enum, value_text, value_json) = 0)
    or (value_type = 'RANGE' and value_range_min is not null and value_range_max is not null and num_nonnulls(value_integer, value_decimal, value_boolean, value_duration_minutes, value_distance_metres, value_enum, value_text, value_json) = 0)
    or (value_type = 'ENUM' and num_nonnulls(value_enum) = 1 and num_nonnulls(value_integer, value_decimal, value_boolean, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_text, value_json) = 0)
    or (value_type = 'TEXT' and num_nonnulls(value_text) = 1 and num_nonnulls(value_integer, value_decimal, value_boolean, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_enum, value_json) = 0)
    or (value_type = 'JSON' and num_nonnulls(value_json) = 1 and num_nonnulls(value_integer, value_decimal, value_boolean, value_duration_minutes, value_distance_metres, value_range_min, value_range_max, value_enum, value_text) = 0)
  )
);
comment on table public.regulatory_facts is 'One canonical structured regulatory proposition per row, stable fact_key identity independent of presentation wording.';
comment on column public.regulatory_facts.value_json is 'Controlled-shape escape hatch. Each fact_type using JSON must define its own versioned shape in documentation before use -- not populated by this migration.';
comment on column public.regulatory_facts.status is 'The FACT/INTERPRETATION layer state -- distinct from regulatory_sources.review_state and regulatory_content_sets.publication_state. No PUBLISHED value here: publication is a content-set concept.';
comment on column public.regulatory_facts.obligation_level is 'Mandatory-vs-advisory classification, set ONLY where the cited source clearly supports it -- never promoted from advice to a hard rule, never softened from mandatory into advice. Null means "not classified," and null is never treated as ADVISORY by any resolver.';

create index regulatory_facts_fact_type_idx on public.regulatory_facts(fact_type);
create index regulatory_facts_topic_idx on public.regulatory_facts(topic);
create index regulatory_facts_status_idx on public.regulatory_facts(status);
create index regulatory_facts_rugby_code_idx on public.regulatory_facts(rugby_code);
create index regulatory_facts_season_id_idx on public.regulatory_facts(season_id) where season_id is not null;
create index regulatory_facts_obligation_level_idx on public.regulatory_facts(obligation_level) where obligation_level is not null;

create table public.regulatory_fact_applicability (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.regulatory_facts(id) on delete cascade,
  regulatory_identity_id uuid not null references public.regulatory_identities(id),
  competition_overlay_id uuid references public.regulatory_competition_overlays(id),
  gender_pathway text check (gender_pathway in ('MALE', 'FEMALE', 'MIXED', 'OPEN')),
  geographic_scope text,
  created_at timestamptz not null default now(),
  unique (fact_id, regulatory_identity_id, competition_overlay_id)
);
comment on table public.regulatory_fact_applicability is 'A fact ALWAYS resolves applicability through this table, never a direct FK on regulatory_facts. competition_overlay_id null = base/national rule; non-null = the overlay-specific variant.';

create unique index regulatory_fact_applicability_base_unique_idx
  on public.regulatory_fact_applicability (fact_id, regulatory_identity_id)
  where competition_overlay_id is null;

create index regulatory_fact_applicability_fact_id_idx on public.regulatory_fact_applicability(fact_id);
create index regulatory_fact_applicability_identity_id_idx on public.regulatory_fact_applicability(regulatory_identity_id);

-- ---------------------------------------------------------------------
-- 4. Citations and conflicts
-- ---------------------------------------------------------------------

create table public.regulatory_fact_citations (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.regulatory_facts(id) on delete cascade,
  source_id uuid not null references public.regulatory_sources(id),
  locator_id uuid references public.regulatory_source_locators(id),
  support_role text not null check (support_role in ('PRIMARY', 'SUPPORTING', 'EXCEPTION', 'OVERLAY')),
  verification_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (fact_id, source_id, locator_id)
);
comment on table public.regulatory_fact_citations is 'Many-to-many provenance between facts and sources. A fact intended for VERIFIED needs at least one PRIMARY citation -- enforced in verify_regulatory_fact, not a bare constraint.';

create index regulatory_fact_citations_fact_id_idx on public.regulatory_fact_citations(fact_id);
create index regulatory_fact_citations_source_id_idx on public.regulatory_fact_citations(source_id);

create table public.regulatory_conflicts (
  id uuid primary key default gen_random_uuid(),
  conflict_key text not null unique,
  topic text not null check (topic in ('RULES', 'SAFEGUARDING', 'PLAYER_WELFARE')),
  rugby_code text check (rugby_code in ('union', 'league')),
  affected_regulatory_identity_id uuid references public.regulatory_identities(id),
  description text not null,

  review_state text not null default 'OPEN' check (review_state in ('OPEN', 'RESOLVED')),
  resolution_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_conflicts_resolution_requires_notes check (
    review_state = 'OPEN' or (resolution_notes is not null and resolved_by is not null and resolved_at is not null)
  )
);
comment on table public.regulatory_conflicts is 'Normalized evidence-conflict tracking. Genuine ambiguity is represented explicitly, never resolved by inference or by silently picking one source.';

create table public.regulatory_conflict_sources (
  conflict_id uuid not null references public.regulatory_conflicts(id) on delete cascade,
  source_id uuid not null references public.regulatory_sources(id) on delete cascade,
  primary key (conflict_id, source_id)
);

create table public.regulatory_conflict_facts (
  conflict_id uuid not null references public.regulatory_conflicts(id) on delete cascade,
  fact_id uuid not null references public.regulatory_facts(id) on delete cascade,
  primary key (conflict_id, fact_id)
);
comment on table public.regulatory_conflict_facts is 'Which facts are blocked pending this conflict''s resolution. A fact referenced by an OPEN row here cannot reach VERIFIED status.';

create index regulatory_conflicts_review_state_idx on public.regulatory_conflicts(review_state);

-- ---------------------------------------------------------------------
-- 5. Content sets, sections, audience copy -- the only user-facing layer
-- ---------------------------------------------------------------------

create table public.regulatory_content_sets (
  id uuid primary key default gen_random_uuid(),
  content_set_key text not null unique,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  topic text not null check (topic in ('RULES', 'SAFEGUARDING', 'PLAYER_WELFARE')),
  regulatory_identity_id uuid references public.regulatory_identities(id),

  season_id uuid references public.seasons(id),
  effective_from date,
  effective_to date,

  publication_state text not null default 'DRAFT' check (publication_state in (
    'DRAFT', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED'
  )),
  version integer not null default 1,
  supersedes_content_set_id uuid references public.regulatory_content_sets(id),

  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_content_sets_verified_requires_metadata check (
    publication_state not in ('VERIFIED', 'PUBLISHED') or (verified_by is not null and verified_at is not null)
  ),
  constraint regulatory_content_sets_published_requires_metadata check (
    publication_state <> 'PUBLISHED' or (published_by is not null and published_at is not null)
  )
);
comment on table public.regulatory_content_sets is 'The USER-FACING publication unit. VERIFIED is deliberately not PUBLISHED -- both states require their own actor+timestamp, enforced by this table''s own CHECK constraints.';

create index regulatory_content_sets_publication_state_idx on public.regulatory_content_sets(publication_state);
create index regulatory_content_sets_identity_idx on public.regulatory_content_sets(regulatory_identity_id) where regulatory_identity_id is not null;
create index regulatory_content_sets_season_idx on public.regulatory_content_sets(season_id) where season_id is not null;
create index regulatory_content_sets_published_lookup_idx on public.regulatory_content_sets(rugby_code, topic, regulatory_identity_id, effective_from, effective_to) where publication_state = 'PUBLISHED';

create table public.regulatory_content_sections (
  id uuid primary key default gen_random_uuid(),
  content_set_id uuid not null references public.regulatory_content_sets(id) on delete cascade,
  section_key text not null check (section_key in (
    'OVERVIEW', 'KEY_RULES', 'PITCH', 'MATCH_FORMAT', 'SCRUM', 'LINEOUT',
    'SAFETY', 'SAFEGUARDING', 'CONCUSSION', 'REPORTING', 'SOURCES', 'OTHER'
  )),
  display_order integer not null default 0,
  fact_id uuid references public.regulatory_facts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_set_id, section_key)
);
comment on table public.regulatory_content_sections is 'Lets a page assemble a structured document instead of one monolithic blob. fact_id is nullable: a section may be built around one canonical structured fact, or be pure prose with no single fact behind it.';

create index regulatory_content_sections_content_set_id_idx on public.regulatory_content_sections(content_set_id);
create index regulatory_content_sections_fact_id_idx on public.regulatory_content_sections(fact_id) where fact_id is not null;

create table public.regulatory_content_section_audience_copy (
  id uuid primary key default gen_random_uuid(),
  content_section_id uuid not null references public.regulatory_content_sections(id) on delete cascade,
  audience text not null check (audience in ('PARENT', 'PLAYER', 'COACH', 'TEAM_ADMIN', 'CLUB_ADMIN', 'GENERAL')),
  body text not null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_section_id, audience)
);
comment on table public.regulatory_content_section_audience_copy is 'Audience-specific presentation over the SAME canonical section/fact -- never a second, independently-editable fact database per audience.';

-- ---------------------------------------------------------------------
-- 6. Reporting routes (governing-body contact/reporting routes)
-- ---------------------------------------------------------------------

create table public.regulatory_reporting_routes (
  id uuid primary key default gen_random_uuid(),
  route_key text not null unique,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  authority_id uuid not null references public.regulatory_authorities(id),
  regulatory_identity_id uuid references public.regulatory_identities(id),

  route_type text not null check (route_type in (
    'GOVERNING_BODY_SAFEGUARDING_TEAM', 'CLUB_WELFARE_OFFICER',
    'EXTERNAL_CHILD_PROTECTION_PARTNER', 'EMERGENCY_SERVICES', 'OTHER'
  )),
  classification text not null default 'NON_EMERGENCY' check (classification in ('EMERGENCY', 'NON_EMERGENCY')),

  label text not null,
  email text,
  phone text,
  url text,
  geographic_scope text,

  season_id uuid references public.seasons(id),
  effective_from date,
  effective_to date,

  publication_state text not null default 'DRAFT' check (publication_state in (
    'DRAFT', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED'
  )),
  supersedes_route_id uuid references public.regulatory_reporting_routes(id),

  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,

  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regulatory_reporting_routes_has_a_channel check (
    email is not null or phone is not null or url is not null
  ),
  constraint regulatory_reporting_routes_verified_requires_metadata check (
    publication_state not in ('VERIFIED', 'PUBLISHED') or (verified_by is not null and verified_at is not null)
  ),
  constraint regulatory_reporting_routes_published_requires_metadata check (
    publication_state <> 'PUBLISHED' or (published_by is not null and published_at is not null)
  )
);
comment on table public.regulatory_reporting_routes is 'Official governing-body safeguarding contact/reporting routes, modelled separately from prose -- a route''s contact detail changes independently of any policy text describing it. Deliberately CLUB-LEVEL-CONTACT-FREE: this table never carries a specific club''s own Safeguarding Officer contact (that is public.club_safeguarding_officers, a real, separate Main feature -- see lib/app-context/rugby-hub-data.ts for how the two present together). Only the governing body''s own published routes.';

create index regulatory_reporting_routes_rugby_code_idx on public.regulatory_reporting_routes(rugby_code);
create index regulatory_reporting_routes_publication_state_idx on public.regulatory_reporting_routes(publication_state);
create index regulatory_reporting_routes_authority_id_idx on public.regulatory_reporting_routes(authority_id);
create index regulatory_reporting_routes_route_type_idx on public.regulatory_reporting_routes(route_type);

create table public.regulatory_reporting_route_citations (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.regulatory_reporting_routes(id) on delete cascade,
  source_id uuid not null references public.regulatory_sources(id),
  locator_id uuid references public.regulatory_source_locators(id),
  support_role text not null check (support_role in ('PRIMARY', 'SUPPORTING', 'EXCEPTION', 'OVERLAY')),
  verification_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (route_id, source_id, locator_id)
);
comment on table public.regulatory_reporting_route_citations is 'Many-to-many provenance between reporting routes and sources, mirroring regulatory_fact_citations exactly.';

create index regulatory_reporting_route_citations_route_id_idx on public.regulatory_reporting_route_citations(route_id);
create index regulatory_reporting_route_citations_source_id_idx on public.regulatory_reporting_route_citations(source_id);

-- ---------------------------------------------------------------------
-- 7. RLS -- real Main capabilities throughout
-- ---------------------------------------------------------------------

alter table public.regulatory_authorities enable row level security;
alter table public.regulatory_sources enable row level security;
alter table public.regulatory_source_locators enable row level security;
alter table public.regulatory_identities enable row level security;
alter table public.regulatory_competition_overlays enable row level security;
alter table public.regulatory_facts enable row level security;
alter table public.regulatory_fact_applicability enable row level security;
alter table public.regulatory_fact_citations enable row level security;
alter table public.regulatory_conflicts enable row level security;
alter table public.regulatory_conflict_sources enable row level security;
alter table public.regulatory_conflict_facts enable row level security;
alter table public.regulatory_content_sets enable row level security;
alter table public.regulatory_content_sections enable row level security;
alter table public.regulatory_content_section_audience_copy enable row level security;
alter table public.regulatory_reporting_routes enable row level security;
alter table public.regulatory_reporting_route_citations enable row level security;

create policy regulatory_authorities_admin_all on public.regulatory_authorities
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_sources_admin_all on public.regulatory_sources
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_source_locators_admin_all on public.regulatory_source_locators
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_identities_admin_all on public.regulatory_identities
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_competition_overlays_admin_all on public.regulatory_competition_overlays
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_facts_admin_all on public.regulatory_facts
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_fact_applicability_admin_all on public.regulatory_fact_applicability
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_fact_citations_admin_all on public.regulatory_fact_citations
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_conflicts_admin_all on public.regulatory_conflicts
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_conflict_sources_admin_all on public.regulatory_conflict_sources
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_conflict_facts_admin_all on public.regulatory_conflict_facts
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

-- Defense in depth: even a direct table query (bypassing the resolver
-- functions in 20261029030000) can only ever see PUBLISHED rows if the
-- caller is not a regulatory admin. Effective-date/season resolution is
-- never duplicated here -- that logic lives only in the resolver functions.
create policy regulatory_content_sets_admin_all on public.regulatory_content_sets
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_content_sets_public_read on public.regulatory_content_sets
  for select using (publication_state = 'PUBLISHED');

create policy regulatory_content_sections_admin_all on public.regulatory_content_sections
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_content_sections_public_read on public.regulatory_content_sections
  for select using (
    exists (select 1 from public.regulatory_content_sets s where s.id = content_set_id and s.publication_state = 'PUBLISHED')
  );

create policy regulatory_content_section_audience_copy_admin_all on public.regulatory_content_section_audience_copy
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_content_section_audience_copy_public_read on public.regulatory_content_section_audience_copy
  for select using (
    exists (
      select 1 from public.regulatory_content_sections sec
      join public.regulatory_content_sets s on s.id = sec.content_set_id
      where sec.id = content_section_id and s.publication_state = 'PUBLISHED'
    )
  );

create policy regulatory_reporting_routes_admin_all on public.regulatory_reporting_routes
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_reporting_routes_public_read on public.regulatory_reporting_routes
  for select using (publication_state = 'PUBLISHED');

create policy regulatory_reporting_route_citations_admin_all on public.regulatory_reporting_route_citations
  for all using (internal.has_capability('site.regulatory.view', 'site'))
  with check (internal.has_capability('site.regulatory.manage', 'site'));

create policy regulatory_reporting_route_citations_public_read on public.regulatory_reporting_route_citations
  for select using (
    exists (select 1 from public.regulatory_reporting_routes r where r.id = route_id and r.publication_state = 'PUBLISHED')
  );

-- ---------------------------------------------------------------------
-- 8. Audit trail -- reuses Main's existing trigger verbatim
-- ---------------------------------------------------------------------

create trigger audit_row_change after insert or update or delete on public.regulatory_authorities for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_sources for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_source_locators for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_identities for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_competition_overlays for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_facts for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_fact_applicability for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_fact_citations for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_conflicts for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_content_sets for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_content_sections for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_content_section_audience_copy for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_reporting_routes for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.regulatory_reporting_route_citations for each row execute function internal.audit_row_change();
