-- Canonical Constituent Body directory.
--
-- `club_directory.constituent_body` was free text. Five clubs said
-- "Lancashire RFU", one said "Hertfordshire RFU", 1,428 said nothing, and
-- nothing stopped the next one saying "lancs rfu" or "Lancashire County".
-- A club's governing body is a controlled identity, not a string, and
-- competition/booking work downstream needs to join on it.
--
-- SOURCE OF THE SEED
--
-- The RFU's own support site (help.rfu.com, "What is a Constituent Body?"
-- and "How do I contact my Constituent Body?"), read September 2026. It
-- states 28 geographical CBs and 7 non-geographic, and names all 35. The
-- names below are those names verbatim -- not tidied, not expanded, not
-- guessed.
--
-- Two things that audit corrected, both worth recording so nobody
-- reintroduces them:
--
--   * Huntingdonshire & Peterborough is NOT a Constituent Body. It is a
--     sub-county within East Midlands RFU. An earlier hand-assembled list
--     included it and happened to reach a plausible total, which is exactly
--     how a wrong list survives review.
--   * There is no "Students" CB. The seventh non-geographic body is the
--     Rugby Football Referees Union.
--
-- RUGBY LEAGUE HAS NO EQUIVALENT AND NONE IS INVENTED
--
-- The RFL governs directly, with BARLA for the community game, restructured
-- in November 2025 into the National Community Rugby League. Its national
-- divisions, regional conferences and regional leagues are COMPETITION
-- structures, not a club's governing body, and modelling them here would
-- put a fabricated governing body against a real club. A league club has no
-- constituent body: the column stays null and the UI says so. If the RFL
-- ever publishes a true equivalent it gets rows here with
-- rugby_code = 'league'; if it publishes a competition-region concept
-- instead, that is its own table, not this one overloaded.

create table if not exists public.constituent_bodies (
  id uuid primary key default gen_random_uuid(),

  -- Scoped, so the selector can only ever offer a club the bodies that
  -- govern its own code and nation. There are no 'league' rows today.
  rugby_code text not null,
  nation text not null,

  canonical_name text not null,
  short_name text,
  body_type text not null,
  active boolean not null default true,

  -- Provenance travels with the row. When someone asks in two years where
  -- "Dorset & Wiltshire RFU" came from, the row answers.
  source text not null default 'rfu_official',
  source_url text,
  source_checked_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint constituent_bodies_rugby_code_check check (rugby_code in ('union', 'league')),
  constraint constituent_bodies_nation_check check (nation in ('England', 'Scotland', 'Wales', 'Northern Ireland')),
  constraint constituent_bodies_body_type_check check (
    body_type in ('GEOGRAPHIC', 'ARMED_FORCES', 'UNIVERSITY', 'SCHOOLS', 'REFEREES')
  ),
  -- One canonical body per name per code+nation. This is what stops a
  -- second "Lancashire RFU" ever existing.
  constraint constituent_bodies_identity_key unique (rugby_code, nation, canonical_name)
);

comment on table public.constituent_bodies is
  'Canonical governing bodies a club belongs to. Rugby union only today: the RFU''s 28 geographic and 7 non-geographic Constituent Bodies, seeded verbatim from help.rfu.com. Rugby league has no constituent-body concept and deliberately has no rows -- its competition regions, if ever modelled, belong in their own table rather than here.';

comment on column public.constituent_bodies.body_type is
  'GEOGRAPHIC (28 county CBs) or one of the non-geographic kinds the official list actually contains: ARMED_FORCES (Army, RAF, Royal Navy), UNIVERSITY (Oxford, Cambridge), SCHOOLS, REFEREES. There is no STUDENTS body -- an earlier assumption that there was proved wrong against the RFU''s own list.';

alter table public.constituent_bodies enable row level security;

-- Every authenticated user reads it: a Club Admin has to be able to pick
-- from the list. Nobody but a Site Admin writes it, so a club selects a
-- canonical body rather than inventing a governing body.
create policy constituent_bodies_select on public.constituent_bodies
  for select to authenticated using (true);

create policy constituent_bodies_write on public.constituent_bodies
  for all to authenticated
  using (internal.is_site_admin())
  with check (internal.is_site_admin());

create index if not exists constituent_bodies_scope_idx
  on public.constituent_bodies (rugby_code, nation, active);

create trigger set_updated_at before update on public.constituent_bodies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Seed -- verbatim from the RFU's own list
-- ---------------------------------------------------------------------

insert into public.constituent_bodies
  (rugby_code, nation, canonical_name, short_name, body_type, source_url, source_checked_on)
values
  -- 28 geographic
  ('union','England','Berkshire County RFU','Berkshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Buckinghamshire RFU','Buckinghamshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Cheshire RFU','Cheshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Cornwall RFU','Cornwall','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Cumbria RFU','Cumbria','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Devon RFU','Devon','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Dorset & Wiltshire RFU','Dorset & Wilts','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Durham County RFU','Durham','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','East Midlands RFU','East Midlands','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Eastern Counties RFU','Eastern Counties','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Essex County RFU','Essex','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Gloucestershire RFU','Gloucestershire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Hampshire RFU','Hampshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Hertfordshire RFU','Hertfordshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Kent RFU','Kent','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Lancashire RFU','Lancashire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Leicestershire RFU','Leicestershire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Middlesex RFU','Middlesex','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','North Midlands RFU','North Midlands','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Northumberland RFU','Northumberland','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Nottinghamshire, Lincolnshire & Derbyshire RFU','Notts, Lincs & Derbys','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Oxfordshire RFU','Oxfordshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Somerset County RFU','Somerset','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Staffordshire Rugby Union','Staffordshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Surrey RFU','Surrey','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Sussex RFU','Sussex','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Warwickshire RFU','Warwickshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Yorkshire RFU','Yorkshire','GEOGRAPHIC','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  -- 7 non-geographic
  ('union','England','The Army Rugby Union','Army','ARMED_FORCES','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Royal Air Force RFU','RAF','ARMED_FORCES','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Royal Navy RFU','Royal Navy','ARMED_FORCES','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Oxford Uni RFC','Oxford University','UNIVERSITY','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Cambridge Uni RFC','Cambridge University','UNIVERSITY','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','England Rugby Football Schools','Schools','SCHOOLS','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07'),
  ('union','England','Rugby Football Referees Union','Referees','REFEREES','https://help.rfu.com/support/solutions/articles/103000258386','2026-09-07')
on conflict (rugby_code, nation, canonical_name) do nothing;

-- ---------------------------------------------------------------------
-- The club reference
-- ---------------------------------------------------------------------

-- The FK is the truth. The legacy text column is KEPT, because the
-- ingestion pipeline (scripts/ingestion) and the directory-research
-- provider both still write it as raw observed evidence, and because an
-- unmatched value must not be thrown away -- it is the only record of what
-- the source actually said.
alter table public.club_directory
  add column if not exists constituent_body_id uuid references public.constituent_bodies(id) on delete restrict;

create index if not exists club_directory_constituent_body_id_idx
  on public.club_directory (constituent_body_id) where constituent_body_id is not null;

comment on column public.club_directory.constituent_body_id is
  'The club''s canonical Constituent Body. THIS is the club''s governing body; club_directory.constituent_body is the raw text an import or research pass observed, kept as provenance and as the review queue for anything that did not reconcile.';

comment on column public.club_directory.constituent_body is
  'LEGACY/RAW text from ingestion or directory research. Not the source of truth -- constituent_body_id is. A non-null value here with a null id is an unreconciled observation awaiting Site Admin review.';

-- ---------------------------------------------------------------------
-- Reconcile what is already there
-- ---------------------------------------------------------------------

-- Exact match first, then a normalised match (case and punctuation), so
-- "lancashire rfu" reconciles as readily as "Lancashire RFU". Nothing is
-- deleted and nothing is guessed: a value that matches no canonical body
-- keeps its text, keeps a null id, and shows up for review.
update public.club_directory d
set constituent_body_id = cb.id
from public.constituent_bodies cb
where d.constituent_body_id is null
  and d.constituent_body is not null
  and cb.rugby_code = d.rugby_code
  and cb.active
  and (
    lower(btrim(d.constituent_body)) = lower(cb.canonical_name)
    or lower(btrim(d.constituent_body)) = lower(coalesce(cb.short_name, ''))
    or regexp_replace(lower(btrim(d.constituent_body)), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(cb.canonical_name), '[^a-z0-9]', '', 'g')
  );

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------

do $$
declare
  v_geo int; v_non int; v_league int; v_unmatched int;
begin
  select count(*) into v_geo from public.constituent_bodies
  where rugby_code='union' and nation='England' and body_type='GEOGRAPHIC';
  if v_geo <> 28 then
    raise exception 'Expected exactly 28 geographic RFU Constituent Bodies, found %.', v_geo;
  end if;

  select count(*) into v_non from public.constituent_bodies
  where rugby_code='union' and nation='England' and body_type <> 'GEOGRAPHIC';
  if v_non <> 7 then
    raise exception 'Expected exactly 7 non-geographic RFU Constituent Bodies, found %.', v_non;
  end if;

  -- The specific wrong entry this seed exists to keep out.
  if exists (select 1 from public.constituent_bodies where canonical_name ilike '%peterborough%'
             or canonical_name ilike '%hunt%') then
    raise exception 'Huntingdonshire & Peterborough is a sub-county of East Midlands RFU, not a Constituent Body.';
  end if;

  -- Rugby league has no constituent bodies and must not acquire invented ones.
  select count(*) into v_league from public.constituent_bodies where rugby_code = 'league';
  if v_league <> 0 then
    raise exception 'Rugby league has no Constituent Body concept -- % league rows were seeded.', v_league;
  end if;

  -- Reconciliation must have caught the values already present.
  select count(*) into v_unmatched from public.club_directory
  where constituent_body is not null and btrim(constituent_body) <> '' and constituent_body_id is null;
  raise notice 'Constituent bodies seeded. % directory rows hold unreconciled text for Site Admin review.', v_unmatched;
end;
$$;
