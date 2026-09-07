-- The Rugby Hub's heritage layer: history, timelines, stories and people.
--
-- WHY THIS IS NOT regulatory_facts
--
-- Everything in the regulatory layer rests on one assumption: there is a
-- governing body, it has published a document, and that document is the
-- answer. Provenance is a URL, disagreement is a defect to be resolved, and a
-- fact is either current or superseded.
--
-- History does not work like that, and forcing it into that shape would
-- produce confident falsehoods. Three differences drove this schema:
--
-- 1. THE CENTRAL ORIGIN STORY IS A MYTH. "William Webb Ellis picked up the
--    ball and ran in 1823" is the sport's founding image, is carved on the
--    trophy, and is not history -- it rests on a single second-hand account
--    written more than fifty years later, and the 1845 laws written at Rugby
--    School itself do not mention him. A model with no way to say "this is
--    believed, celebrated, and false" would have to either publish it as fact
--    or delete it. Both are wrong: it is culturally true and factually
--    unsupported, and a child asking "who invented rugby?" deserves that
--    answer, not one half of it.
--
-- 2. DISAGREEMENT IS OFTEN THE SUBJECT, NOT AN ERROR. The 1895 split is
--    described as a dispute about broken-time payments, as a class conflict,
--    and as a north/south conflict. Historians genuinely differ in emphasis.
--    The regulatory model would flag that as a conflict to be closed; here it
--    is the thing worth teaching.
--
-- 3. NOTHING SUPERSEDES. A 2026/27 regulation replaces its 2025/26 version.
--    1895 does not replace 1871. Heritage accumulates.
--
-- So: separate tables, an explicit certainty vocabulary with MYTH as a
-- first-class value, and per-entry sources -- with the standing rule that
-- popular history sites and encyclopedias are acceptable here (they are NOT
-- acceptable as regulatory authority) precisely because the claim being made
-- is "this is what is recorded and how confidently", not "this is the rule
-- your child must play by".

-- ============================================================
-- 1. Eras -- the narrative spine a timeline is drawn against.
-- ============================================================

create table public.heritage_eras (
  id uuid primary key default gen_random_uuid(),
  era_key text not null unique,
  title text not null,
  code_scope text not null,
  starts_year integer not null,
  ends_year integer,
  summary text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint heritage_eras_code_scope_check check (code_scope in ('union', 'league', 'both', 'pre_schism')),
  constraint heritage_eras_years_ordered check (ends_year is null or ends_year >= starts_year)
);

comment on table public.heritage_eras is
  'Narrative periods the heritage timeline is grouped by. code_scope ''pre_schism'' marks the shared history both codes own equally -- everything before 1895 belongs to league as much as to union, which is the single most misunderstood thing about rugby history.';

-- ============================================================
-- 2. Entries -- events, people, milestones and stories.
-- ============================================================

create table public.heritage_entries (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  era_id uuid references public.heritage_eras(id) on delete set null,
  entry_type text not null,
  code_scope text not null,
  title text not null,
  -- Year is required and date is not: most of this is known to the year, some
  -- to the day, and a nullable exact date is honest about which is which.
  happened_year integer not null,
  happened_on date,
  ends_year integer,
  summary text not null,
  detail text,
  certainty text not null,
  certainty_note text,
  significance integer not null default 3,
  -- Deliberately free text, not a FK to clubs/teams: heritage refers to
  -- institutions that predate, outlive and sit outside Ovalball's own club
  -- directory (Rugby School, the Northern Union, the Barbarians).
  people text[] not null default '{}',
  places text[] not null default '{}',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint heritage_entries_type_check check (
    entry_type in ('ORIGIN', 'GOVERNANCE', 'SCHISM', 'RULE_CHANGE', 'COMPETITION', 'MATCH', 'PERSON', 'SOCIAL', 'MILESTONE')
  ),
  constraint heritage_entries_code_scope_check check (code_scope in ('union', 'league', 'both', 'pre_schism')),
  -- The certainty vocabulary is the heart of this table.
  --   ESTABLISHED       -- documented, uncontested, safe to state plainly
  --   WELL_DOCUMENTED   -- solid, but detail varies between accounts
  --   CONTESTED         -- historians genuinely disagree on cause or meaning
  --   LEGEND            -- widely told, plausible, unverifiable
  --   MYTH              -- widely believed and NOT supported by evidence
  constraint heritage_entries_certainty_check check (
    certainty in ('ESTABLISHED', 'WELL_DOCUMENTED', 'CONTESTED', 'LEGEND', 'MYTH')
  ),
  -- Anything less than solid must SAY why. This is the structural guarantee
  -- that a myth can never be rendered as a bare fact: the note always exists
  -- to be shown next to it.
  constraint heritage_entries_uncertainty_explained check (
    certainty in ('ESTABLISHED', 'WELL_DOCUMENTED') or certainty_note is not null
  ),
  constraint heritage_entries_significance_range check (significance between 1 and 5),
  constraint heritage_entries_date_matches_year check (
    happened_on is null or extract(year from happened_on) = happened_year
  ),
  constraint heritage_entries_years_ordered check (ends_year is null or ends_year >= happened_year)
);

comment on column public.heritage_entries.certainty is
  'How far this can be trusted. MYTH is a first-class value, not a failure state -- the Webb Ellis story is the sport''s founding image AND unsupported by evidence, and the Hub must be able to say both. Anything below WELL_DOCUMENTED must carry a certainty_note, enforced by heritage_entries_uncertainty_explained, so no interface can render an uncertain claim without the caveat being available beside it.';

comment on column public.heritage_entries.significance is
  '1-5, editorial weight for what a compact timeline shows first. Not a claim about historical importance -- a ranking for display, and named that way so it is never mistaken for a sourced fact.';

create index heritage_entries_year_idx on public.heritage_entries (happened_year);
create index heritage_entries_code_scope_idx on public.heritage_entries (code_scope);
create index heritage_entries_certainty_idx on public.heritage_entries (certainty);
create index heritage_entries_era_idx on public.heritage_entries (era_id);
create index heritage_entries_tags_idx on public.heritage_entries using gin (tags);

-- ============================================================
-- 3. Sources -- per entry, because a single entry can rest on several and
--    a contested one usually rests on sources that disagree.
-- ============================================================

create table public.heritage_entry_sources (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.heritage_entries(id) on delete cascade,
  source_title text not null,
  source_url text,
  publisher text,
  source_tier text not null,
  supports text,
  retrieved_on date,
  created_at timestamptz not null default now(),
  -- MUSEUM_OR_ARCHIVE and GOVERNING_BODY are the strongest; ENCYCLOPEDIA and
  -- POPULAR_HISTORY are admissible HERE and nowhere else in the product.
  constraint heritage_entry_sources_tier_check check (
    source_tier in ('GOVERNING_BODY', 'MUSEUM_OR_ARCHIVE', 'ACADEMIC', 'ENCYCLOPEDIA', 'POPULAR_HISTORY', 'CONTEMPORARY_REPORT')
  )
);

comment on table public.heritage_entry_sources is
  'Citations for a heritage entry. source_tier is what keeps the regulatory boundary intact: ENCYCLOPEDIA and POPULAR_HISTORY are acceptable for history and are NEVER acceptable as regulatory authority -- regulatory_sources has its own, much narrower vocabulary and no overlap with this one.';

create index heritage_entry_sources_entry_idx on public.heritage_entry_sources (entry_id);

-- ============================================================
-- 4. Access. Heritage is public, read-only content -- the one part of the
--    Rugby Hub with nothing club-specific or child-specific in it, so it
--    needs no row-level scoping, only a hard write lock.
-- ============================================================

alter table public.heritage_eras enable row level security;
alter table public.heritage_entries enable row level security;
alter table public.heritage_entry_sources enable row level security;

create policy heritage_eras_select_all on public.heritage_eras for select to anon, authenticated using (true);
create policy heritage_entries_select_all on public.heritage_entries for select to anon, authenticated using (true);
create policy heritage_entry_sources_select_all on public.heritage_entry_sources for select to anon, authenticated using (true);

-- No insert/update/delete policy of any kind: content arrives by migration
-- and by Site Admin tooling running as the service role, never from a session.
-- A club admin cannot edit the sport's history from inside their own club.

grant select on public.heritage_eras to anon, authenticated;
grant select on public.heritage_entries to anon, authenticated;
grant select on public.heritage_entry_sources to anon, authenticated;

-- ============================================================
-- 5. One read view, so no consumer has to re-derive the caveat logic.
-- ============================================================

create view public.heritage_timeline
with (security_invoker = true)
as
select
  e.entry_key,
  e.title,
  e.entry_type,
  e.code_scope,
  e.happened_year,
  e.happened_on,
  e.ends_year,
  e.summary,
  e.detail,
  e.certainty,
  e.certainty_note,
  -- The single most important derived value in this schema: whether an
  -- interface MUST show the caveat alongside the claim.
  (e.certainty not in ('ESTABLISHED', 'WELL_DOCUMENTED')) as requires_caveat,
  e.significance,
  e.people,
  e.places,
  e.tags,
  era.era_key,
  era.title as era_title,
  (select count(*) from public.heritage_entry_sources s where s.entry_id = e.id) as source_count
from public.heritage_entries e
left join public.heritage_eras era on era.id = e.era_id;

comment on view public.heritage_timeline is
  'Heritage entries with their era and a computed requires_caveat flag. Any surface rendering an entry where requires_caveat is true must show certainty_note with it -- that is the whole point of the flag, and it is computed here once rather than re-derived by every consumer.';

grant select on public.heritage_timeline to anon, authenticated;
