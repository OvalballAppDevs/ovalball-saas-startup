-- Calendar Pitch Allocation -- foundation schema. Sections 31-40.
--
-- CANONICAL FIXTURE INVARIANT (the single most important rule this whole
-- feature exists to respect): nothing in this migration creates a second
-- source of truth for a fixture's date/kickoff/venue/pitch. Those remain
-- exclusively owned by public.fixtures, mutated exclusively through the
-- EXISTING public.update_fixture_pitch() / update_fixture_venue() /
-- update_fixture_kickoff() RPCs (audited before writing this migration --
-- all three already exist, already validate the target pitch/venue
-- belongs to the fixture's home club, and already propagate to a legacy
-- mirror_fixture_id where one exists). Pitch Allocation calls those same
-- three RPCs; it does not reimplement fixture mutation.
--
-- The only new tables here are (a) reference/config data that doesn't
-- belong on the fixtures table itself, and (b) an explicitly TEMPORARY,
-- pre-Apply proposal pair (Section 3's own explicit allowance) that is
-- never read as fixture truth by anything outside the Apply flow.

-- 1. Pitch physical category -- Section 31: "do NOT assume a boolean is
-- enough," but going further than full/reduced/mini into precise metre
-- dimensions per age band is NOT backed by research solid enough to
-- encode as fact this pass (see fixture_scheduling_rules' own
-- confidence column below) -- three categories is the honest, verified
-- floor: RFU Regulation 15 Appendices 2/4/6 (U8/U10/U12 Rules of Play,
-- englandrugby.com) describe meaningfully different maximum pitch
-- footprints for mini (U7-U8), reduced (U9-U12), and full (U13+/Colts/
-- Senior) age bands. Nullable -- an unset pitch is never treated as
-- unsuitable, only as unclassified (never auto-allocated a mini/reduced
-- fixture without a human confirming, per Section 78/45's hard-block
-- discipline below).
alter table public.club_pitches add column size_category text check (size_category in ('mini', 'reduced', 'full'));

-- 2. Canonical, effective-dated match-duration/pitch-suitability rules --
-- Section 33/34: never hardcoded in a component, versioned so next
-- season's regulation update doesn't require a code change. Seeded from
-- REAL, CITED research performed for this pass (RFU Regulation 15,
-- 2025-26 season, effective 1 August 2025 -- englandrugby.com "Regulation
-- 15 – Age Grade Rugby"). RFL junior match-duration figures were
-- searched but could not be confidently resolved to a clean per-age-band
-- table from official sources in the time available -- deliberately left
-- UNSEEDED rather than guessed (Section 32: "If a rule is unclear: do
-- not guess"); the allocation algorithm below falls back to a flagged
-- estimate for any rugby_code/age_group with no 'confirmed' row here,
-- never a silent invented number.
create table public.fixture_scheduling_rules (
  id uuid primary key default gen_random_uuid(),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  age_group text, -- null = applies to every age_group not more specifically matched (colts/senior)
  half_minutes integer not null,
  min_pitch_size_category text check (min_pitch_size_category in ('mini', 'reduced', 'full')),
  source text not null,
  effective_season text not null,
  confidence text not null check (confidence in ('confirmed', 'unresolved')),
  created_at timestamptz not null default now()
);

insert into public.fixture_scheduling_rules (rugby_code, age_group, half_minutes, min_pitch_size_category, source, effective_season, confidence) values
  ('union', 'U6', 10, 'mini', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U7', 10, 'mini', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U8', 10, 'mini', 'RFU Regulation 15 Appendix 2 (U8 Rules of Play) -- max pitch 45m x 22m (+5m in-goal); Regulation 15, 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U9', 15, 'reduced', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U10', 15, 'reduced', 'RFU Regulation 15 Appendix 4 (U10 Rules of Play) -- max pitch 60m x 35m (+5m in-goal); Regulation 15, 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U11', 20, 'reduced', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U12', 20, 'reduced', 'RFU Regulation 15 Appendix 6 (U12 Rules of Play) -- max pitch 60m x 43m (+5m in-goal, "half a full-size pitch"); Regulation 15, 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U13', 25, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U14', 25, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U15', 30, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U16', 35, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'U17', 35, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com', '2025-26', 'confirmed'),
  ('union', 'JuniorColts', 35, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season, englandrugby.com -- Colts treated at the U16+/senior half-length band', '2025-26', 'confirmed'),
  ('union', 'SeniorColts', 40, 'full', 'RFU Regulation 15 (Age Grade Rugby), 2025-26 season -- senior-adjacent half length; not itself a distinct age-grade row in Regulation 15''s own table', '2025-26', 'unresolved'),
  ('union', null, 40, 'full', 'Standard adult Rugby Union half length (Laws of the Game) -- applies to senior category fixtures not matched by a more specific age_group row above', '2025-26', 'confirmed');

-- 3. Club scheduling POLICY (preference), never governing-body law --
-- Section 40: "Do NOT confuse club preferences with governing-body
-- restrictions." One row per club, created lazily; the allocator's own
-- defaults (Sections 37-39) apply when a club has no row yet.
create table public.club_scheduling_policy (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  weekday_earliest_kickoff time not null default '18:00',
  weekend_youth_earliest time not null default '09:00',
  weekend_youth_latest time not null default '13:00',
  weekend_senior_earliest time not null default '13:00',
  weekend_senior_latest time not null default '17:30',
  turnaround_minutes integer not null default 15,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.fixture_scheduling_rules enable row level security;
alter table public.club_scheduling_policy enable row level security;

create policy fixture_scheduling_rules_select_all on public.fixture_scheduling_rules for select using (true);
create policy club_scheduling_policy_select_all on public.club_scheduling_policy for select using (true);

-- No general-purpose rule EDITOR is built this pass (Section 33 asks for
-- a versioned SOURCE, not necessarily an admin UI to hand-edit it yet) --
-- write access is service-role/migration-only for now, disclosed as a
-- remaining gap in the final report rather than silently assumed done.
create policy club_scheduling_policy_upsert_self on public.club_scheduling_policy for insert
  with check (internal.has_capability('fixture.edit', 'club', club_id, null));
create policy club_scheduling_policy_update_self on public.club_scheduling_policy for update
  using (internal.has_capability('fixture.edit', 'club', club_id, null))
  with check (internal.has_capability('fixture.edit', 'club', club_id, null));

-- 4. TEMPORARY, pre-Apply proposal pair (Section 3's explicit allowance).
-- A proposal row is a scratch pad for Auto Allocate's suggested plan --
-- never itself read by Calendar/Fixture Management/Agenda/anything else
-- as fixture truth. Applying a proposal calls the real fixture RPCs for
-- each item, then marks the proposal 'applied'; nothing about a fixture's
-- real facts ever lives only in these two tables.
create table public.pitch_allocation_proposals (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  proposal_date date not null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid references auth.users(id)
);

create table public.pitch_allocation_proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.pitch_allocation_proposals(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  proposed_pitch_id uuid references public.club_pitches(id),
  proposed_kickoff_time time,
  is_unallocated boolean not null default false,
  conflict_severity text check (conflict_severity in ('hard', 'warning')),
  conflict_reason text
);

alter table public.pitch_allocation_proposals enable row level security;
alter table public.pitch_allocation_proposal_items enable row level security;

create policy pitch_allocation_proposals_select on public.pitch_allocation_proposals for select
  using (internal.has_capability('fixture.edit', 'club', club_id, null) or internal.is_site_admin());
create policy pitch_allocation_proposal_items_select on public.pitch_allocation_proposal_items for select
  using (exists (
    select 1 from public.pitch_allocation_proposals p
    where p.id = proposal_id and (internal.has_capability('fixture.edit', 'club', p.club_id, null) or internal.is_site_admin())
  ));

-- INSERT/UPDATE/DELETE policies for these two tables are added in
-- 20260924710000_pitch_allocation_proposal_write_policies.sql, gated by
-- the same fixture.edit-at-club-scope capability the server action
-- (requirePitchAllocationAccess() in actions.ts) already checks before
-- ever reaching them.

create index pitch_allocation_proposal_items_proposal_id_idx on public.pitch_allocation_proposal_items (proposal_id);
create index pitch_allocation_proposals_club_date_idx on public.pitch_allocation_proposals (club_id, proposal_date);
