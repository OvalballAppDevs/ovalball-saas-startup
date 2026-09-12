-- Rugby Hub general-knowledge foundation (Main, not a side project).
--
-- The regulatory layer (regulatory_*, 20261029010000 onward) already owns
-- RULES / SAFEGUARDING / PLAYER_WELFARE -- governing-body truth, strict
-- citation/publication/conflict discipline. This migration does not touch
-- it. It adds the separate layer the Rugby Hub Foundation Audit identified
-- as missing: general editorial/coaching knowledge -- positions, skills,
-- glossary terms, coaching guidance, practical guides, fun facts, quiz
-- items, visual definitions. Same publication discipline (DRAFT -> REVIEWED
-- -> PUBLISHED -> SUPERSEDED -> ARCHIVED), same "never infer applicability"
-- rule, but editorially separate: reviewed by different people, on a
-- different cadence, under a different capability pair
-- (site.hub_content.*, not site.regulatory.*).
--
-- WHY POSITIONS/SKILLS/GLOSSARY ARE NOT hub_content_items ROWS
--
-- A position has a name, a shirt number, a code -- fields with their own
-- meaning and their own uniqueness rules. Modelling that as a generic
-- content_type on hub_content_items would mean either inventing a second
-- "title" that can drift from the position's real name, or overloading
-- hub_content_items with position-only columns most rows never use. So
-- hub_positions / hub_skills / hub_glossary_terms are their OWN canonical
-- tables, each owning its own identity fields exclusively, each with an
-- OPTIONAL link to a hub_content_items row for a longer-form article when
-- (and only when) one is genuinely needed. One name, one place it lives.

-- ---------------------------------------------------------------------
-- 1. hub_content_items -- the general editorial content table.
-- ---------------------------------------------------------------------

create table public.hub_content_items (
  id uuid primary key default gen_random_uuid(),
  content_key text not null unique,
  content_type text not null check (content_type in (
    'COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION'
  )),

  title text not null,
  summary text not null,
  body text,

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'
  )),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  superseded_by uuid references public.hub_content_items(id),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hub_content_items_reviewed_requires_metadata check (
    status not in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint hub_content_items_published_requires_metadata check (
    status not in ('PUBLISHED', 'SUPERSEDED') or (published_by is not null and published_at is not null)
  ),
  constraint hub_content_items_superseded_requires_target check (
    status <> 'SUPERSEDED' or superseded_by is not null
  ),
  -- The regulatory escape-hatch guard (defense in depth -- see also
  -- scripts/verify-hub-content-regulatory-boundary.mjs and
  -- supabase/tests/hub_content_regulatory_boundary.sql). General knowledge
  -- may REFERENCE a regulatory fact (hub_regulatory_fact_references) but
  -- must never assert regulatory-sounding claims in its own prose --
  -- that's how a regulatory assertion would escape regulatory_*'s
  -- provenance/conflict/publication controls by being mis-labelled as
  -- editorial. This catches the most flagrant phrasings; the SQL/guard
  -- tests catch subtler ones a human reviewer would also catch.
  constraint hub_content_items_no_regulatory_escape_hatch check (
    title !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
    and summary !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y'
    and (body is null or body !~* '\y(the law (says|is)|players? (must|are required to)|(the )?(rfu|rfl|world rugby) (requires|mandates)|is (mandatory|required) (under|by) (law|regulation)|regulation \d+)\y')
  )
);
comment on table public.hub_content_items is 'General Rugby Hub editorial/coaching content -- NOT regulatory truth (that stays in regulatory_content_sets) and NOT a position/skill/glossary term''s own identity (those own their own tables). One canonical row per article; audience-specific copy, if ever needed, follows the regulatory_content_section_audience_copy precedent as a later addition, not duplicated title/summary/body per audience.';
comment on column public.hub_content_items.body is 'Structured editorial content where the format benefits from it; nullable because a FUN_FACT or VISUAL_DEFINITION may be fully expressed by title+summary alone.';
comment on constraint hub_content_items_no_regulatory_escape_hatch on public.hub_content_items is 'A regulatory assertion belongs in regulatory_facts, cited and applicability-scoped. This CHECK is a coarse, deliberately narrow net for the most obvious escape-hatch phrasing -- it is not a substitute for editorial review, only a floor beneath it.';

create index hub_content_items_content_type_idx on public.hub_content_items(content_type);
create index hub_content_items_status_idx on public.hub_content_items(status);
create index hub_content_items_published_lookup_idx on public.hub_content_items(content_type, published_at) where status = 'PUBLISHED';

create trigger set_updated_at before update on public.hub_content_items for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.hub_content_items for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 2. hub_positions -- code-specific position identity. NEVER a shared row
--    between Union and League, even where names look identical.
-- ---------------------------------------------------------------------

create table public.hub_positions (
  id uuid primary key default gen_random_uuid(),
  position_key text not null unique,
  rugby_code text not null check (rugby_code in ('union', 'league')),

  display_name text not null,
  alternative_names text[] not null default '{}',
  shirt_number integer check (shirt_number is null or shirt_number between 1 and 23),
  position_family text not null,

  purpose text not null,
  role_with_ball text,
  role_without_ball text,
  attack_responsibilities text,
  defence_responsibilities text,
  set_piece_responsibilities text,
  key_skills_summary text,
  decision_making text,
  communication text,
  development_priorities text,
  common_mistakes text,
  strong_performance_looks_like text,

  -- Normalised 0-1 coordinates, driving the future interactive pitch
  -- diagram. Geometry is always derived from these numbers -- never a
  -- copied governing-body diagram (see docs/rugby-hub/content-architecture
  -- .md #6).
  pitch_anchor_x numeric check (pitch_anchor_x is null or pitch_anchor_x between 0 and 1),
  pitch_anchor_y numeric check (pitch_anchor_y is null or pitch_anchor_y between 0 and 1),

  -- Development/performance context ONLY. Deliberately no field here can be
  -- read as an eligibility gate -- see the age-guidance table (section 8 of
  -- the accepted audit) for the separate, explicit "does this position even
  -- apply at this age" concept, which is NOT this column.
  age_guidance_note text,

  detail_content_item_id uuid references public.hub_content_items(id),

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'
  )),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  superseded_by uuid references public.hub_positions(id),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hub_positions_reviewed_requires_metadata check (
    status not in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint hub_positions_published_requires_metadata check (
    status not in ('PUBLISHED', 'SUPERSEDED') or (published_by is not null and published_at is not null)
  ),
  constraint hub_positions_superseded_requires_target check (
    status <> 'SUPERSEDED' or superseded_by is not null
  )
);
comment on table public.hub_positions is 'One row per position per code. Union and League never share a row, even for identically-named positions (Hooker means a different role, differently, in each code) -- see docs/rugby-hub/content-architecture.md #4.';
comment on column public.hub_positions.age_guidance_note is 'Development-stage guidance in prose (e.g. "at this age, players are encouraged to experience different roles"). NEVER an eligibility rule -- physical attributes and age guidance here are always developmental observations, never exclusion criteria. Whether this position genuinely applies at a given age/identity is a separate, structured fact in hub_position_age_stage -- this column never substitutes for that.';

create unique index hub_positions_code_shirt_number_idx on public.hub_positions(rugby_code, shirt_number) where shirt_number is not null;
create index hub_positions_rugby_code_idx on public.hub_positions(rugby_code);
create index hub_positions_status_idx on public.hub_positions(status);
create index hub_positions_published_lookup_idx on public.hub_positions(rugby_code) where status = 'PUBLISHED';

create trigger set_updated_at before update on public.hub_positions for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.hub_positions for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. hub_skills -- canonical skill identity, code/age-aware via
--    applicability (never a direct rugby_code column implying universal-
--    by-default -- see hub_content_applicability below).
-- ---------------------------------------------------------------------

create table public.hub_skills (
  id uuid primary key default gen_random_uuid(),
  skill_key text not null unique,
  display_name text not null,
  skill_family text not null check (skill_family in (
    'HANDLING', 'RUNNING_EVASION', 'CONTACT', 'BREAKDOWN', 'SET_PIECE',
    'KICKING', 'DEFENCE', 'ATTACK_SHAPE', 'COMMUNICATION', 'DECISION_MAKING', 'LEADERSHIP', 'OTHER'
  )),
  summary text not null,
  detail_content_item_id uuid references public.hub_content_items(id),

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'
  )),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  superseded_by uuid references public.hub_skills(id),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hub_skills_reviewed_requires_metadata check (
    status not in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint hub_skills_published_requires_metadata check (
    status not in ('PUBLISHED', 'SUPERSEDED') or (published_by is not null and published_at is not null)
  ),
  constraint hub_skills_superseded_requires_target check (
    status <> 'SUPERSEDED' or superseded_by is not null
  )
);
comment on table public.hub_skills is 'Canonical skill identity. Deliberately NO rugby_code column -- a skill''s code/age/pathway scope is a hub_content_applicability fact, explicit and queryable, never implied by the absence of a column. A scrum-specific skill is Union-or-League-specific because an applicability row says so, not because of a default.';

create index hub_skills_family_idx on public.hub_skills(skill_family);
create index hub_skills_status_idx on public.hub_skills(status);

create trigger set_updated_at before update on public.hub_skills for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.hub_skills for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. hub_glossary_terms -- code-aware glossary. The same word may exist in
--    both codes, mean something different by code, or not exist in one.
-- ---------------------------------------------------------------------

create table public.hub_glossary_terms (
  id uuid primary key default gen_random_uuid(),
  term_key text not null unique,
  display_term text not null,
  aliases text[] not null default '{}',
  rugby_code text check (rugby_code is null or rugby_code in ('union', 'league')),
  plain_language_definition text not null,
  detail_content_item_id uuid references public.hub_content_items(id),

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'
  )),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  superseded_by uuid references public.hub_glossary_terms(id),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hub_glossary_terms_reviewed_requires_metadata check (
    status not in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint hub_glossary_terms_published_requires_metadata check (
    status not in ('PUBLISHED', 'SUPERSEDED') or (published_by is not null and published_at is not null)
  ),
  constraint hub_glossary_terms_superseded_requires_target check (
    status <> 'SUPERSEDED' or superseded_by is not null
  )
);
comment on table public.hub_glossary_terms is 'rugby_code is nullable and means "the same in both codes" -- an EXPLICIT, deliberate value on the row, not an inference. A term meaning different things per code gets two rows, each with its own rugby_code, sharing the same display_term but different term_key.';

create unique index hub_glossary_terms_term_code_idx on public.hub_glossary_terms(lower(display_term), coalesce(rugby_code, ''));
create index hub_glossary_terms_rugby_code_idx on public.hub_glossary_terms(rugby_code);
create index hub_glossary_terms_status_idx on public.hub_glossary_terms(status);

create trigger set_updated_at before update on public.hub_glossary_terms for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.hub_glossary_terms for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 5. RLS -- mirrors regulatory_content_sets exactly: admin-all for the
--    manage/view capability holders, public read for PUBLISHED only.
--    Defense in depth: even a direct table query bypassing a future
--    resolver function can only ever see PUBLISHED rows as a non-admin.
-- ---------------------------------------------------------------------

alter table public.hub_content_items enable row level security;
alter table public.hub_positions enable row level security;
alter table public.hub_skills enable row level security;
alter table public.hub_glossary_terms enable row level security;

create policy hub_content_items_admin_all on public.hub_content_items
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_content_items_public_read on public.hub_content_items
  for select using (status = 'PUBLISHED');

create policy hub_positions_admin_all on public.hub_positions
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_positions_public_read on public.hub_positions
  for select using (status = 'PUBLISHED');

create policy hub_skills_admin_all on public.hub_skills
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_skills_public_read on public.hub_skills
  for select using (status = 'PUBLISHED');

create policy hub_glossary_terms_admin_all on public.hub_glossary_terms
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_glossary_terms_public_read on public.hub_glossary_terms
  for select using (status = 'PUBLISHED');
