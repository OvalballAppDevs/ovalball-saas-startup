# CA-M11.2 — Pitch Capacity Schema Change Required

**Status: PROPOSED, NOT APPLIED.** Per the owner's own stop rule ("DO NOT APPLY A MIGRATION
AUTONOMOUSLY if it changes the underlying authority/domain semantics"), this is a design document, not
a migration file. Nothing here has been run against any database, local or otherwise.

## Why existing schema cannot represent the requirement

Audited (see the correction's own final report for the full trail):

- `club_pitches.size_category` (`mini | reduced | full`) describes **one** size class for a **whole**
  physical pitch — it answers "is this pitch big enough to host a fixture of size X at all", never
  "can this pitch be split so two smaller activities share it at once".
- `club_pitches.lane_count` (1–4) is a raw headcount of how many bookings a pitch can hold
  **concurrently**, with **zero size semantics** — a `lane_count=2` full-size pitch permitted two
  simultaneous full-size adult matches exactly as readily as two mini games, because nothing recorded
  *how much space* either one actually consumed.
- `fixtures.pitch_id`, `training_sessions.pitch_id` and the equivalent columns on tournaments/club
  events each name **which physical pitch**, never **which portion of it**.

There is no column anywhere in the schema that can express "this reservation occupies the eastern half
of Pitch 1" or "Pitch 1 is physically markable into two halves, but Pitch 2 is a single mini pitch with
no subdivision at all". That is a genuine gap, not an oversight this pass can fix by writing more
TypeScript — the fact does not exist to compute over.

## What this pass shipped WITHOUT a migration

A shared unit-budget engine (`packages/contracts/src/pitch-allocation/footprint.ts`) that:

- derives a match's required **footprint** (`full | half | quarter`) from the **existing**
  `requiredPitchSize` (`fixture_scheduling_rules.min_pitch_size_category`) — no new source of truth;
- derives a pitch's total **capacity budget** from its **existing** `size_category`;
- replaces the old pure-headcount overlap check in `detectConflicts`, `autoAllocate` and
  `detectResourceConflicts` with a unit-budget check that is strictly **more** restrictive than before,
  never less — a genuinely full-size match now always exceeds any pitch's remaining budget the instant
  anything else overlaps it, which the old model missed entirely.

This closes the "two full-size matches share a pitch because lane_count said 2" bug outright, and
correctly allows "two reduced-size matches share a full pitch" when the club has classified the pitch.
It genuinely **cannot** catch two reservations both wanting the *same declared half* — it only knows the
pitch's total budget, not which named zone each reservation sits in. That is what the migration below
would add.

## Proposed schema

```sql
-- A pitch's own declared subdivision layout: the discrete zones that ACTUALLY exist on it, each with
-- its own footprint and the set of other zones it spatially overlaps. A pitch with no rows here has no
-- declared subdivision at all -- the existing lane_count/size_category-only behaviour this pass ships
-- is preserved exactly (footprint.ts's pitchCapacityUnits() already returns null for an unclassified
-- pitch, and the zone-aware engine below would fall back the same way for a pitch with zero zone rows).
create table public.club_pitch_zones (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references public.club_pitches(id) on delete cascade,
  zone_key text not null,                      -- 'full' | 'half_a' | 'half_b' | 'quarter_a'..'quarter_d'
  footprint text not null check (footprint in ('full', 'half', 'quarter')),
  display_label text not null,                 -- 'Full Pitch' / 'Half A' / 'Quarter C' -- what a person sees
  -- Every OTHER zone on this pitch that spatially overlaps this one, INCLUDING the containment
  -- hierarchy (the full zone overlaps every half/quarter; half A overlaps whichever quarters sit
  -- inside it) -- explicit rather than inferred from zone_key naming, because Section 39/40's own
  -- warning is real: "different subdivision layouts may not tile together" is a genuine physical fact
  -- about a SPECIFIC pitch, not something derivable from the zone name alone.
  overlaps_zone_keys text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (pitch_id, zone_key)
);

-- Which zone a specific reservation occupies. Nullable and SEPARATE from pitch_id -- a fixture with a
-- pitch_id but a null zone_id means "on this pitch, no zone chosen yet", not "on the whole pitch"; see
-- the conservative-default rule below for how that reads to the conflict engine.
alter table public.fixtures add column pitch_zone_id uuid references public.club_pitch_zones(id);
alter table public.training_sessions add column pitch_zone_id uuid references public.club_pitch_zones(id);
-- club_events/tournament_pitches: audit their exact pitch-reservation shape (one row per pitch already,
-- per the existing tournament_pitches/club_event_pitches join tables) before finalising the equivalent
-- column there -- not done as part of this proposal's drafting, flagged as an open item below.
```

### Backward compatibility

An existing row with `pitch_id` set and `pitch_zone_id` null is read as **FULL / UNKNOWN** —
conservatively occupying the entire pitch — for exactly as long as nobody has explicitly assigned it a
zone. This is not a new rule invented for the migration: it is the *same* "unknown fails conservative"
behaviour `footprint.ts` already implements (Section 42), extended from "unknown footprint size" to
"unknown footprint size AND unknown zone identity". No historical row is silently reinterpreted as
anything more specific than what it already, honestly, is.

### RLS / authority implications

`club_pitch_zones` is club-owned configuration data, structurally identical to `club_pitches` itself:

- `select` mirrors `club_pitches`' own read policy (any authenticated member of the club, or anyone the
  board is rendered for).
- `insert`/`update`/`delete` requires `venue.pitch_allocation.manage` — the **same** capability that
  already gates pitch/lane configuration today, not a new authority tier.

`fixtures.pitch_zone_id` / `training_sessions.pitch_zone_id` are written only through the existing
canonical RPCs (`update_fixture_pitch`, `update_fixture_schedule`, the training-session equivalents),
extended to accept an optional `p_pitch_zone_id` alongside the pitch id they already take — never a
direct table write from either client, matching every other pitch-allocation write today.

### Web impact

- `getPitchAllocationBoard` (the one shared read model both clients already consume — `board.ts`) would
  select `club_pitch_zones` for the club's pitches, and join each fixture/training session's own
  `pitch_zone_id`, exposing a `zoneId`/`zoneLabel`/`zoneFootprint` on `AllocationFixture` next to the
  existing `requiredPitchSize`.
- `update_fixture_pitch` / `update_fixture_schedule` gain an optional `p_pitch_zone_id` parameter.
- The website's Move/Allocate flow and drag-drop target resolution would need the same "offer only
  compatible free zones" logic this pass's engine already computes in `footprintBudgetExceeded` — a
  **minimal** adaptation (a zone picker where a pitch/time picker already exists), not a redesign.

None of this is applied. It is scoped here so a future pass can implement it without re-deriving the
shape from scratch, and so the owner can review the exact column/table/RPC-parameter changes before any
of them land.

## Open items for whoever picks this up

1. Confirm `club_event_pitches`/`tournament_pitches`' exact reservation shape before adding a
   `pitch_zone_id` there — not audited in the same depth as `fixtures`/`training_sessions` this pass.
2. Decide whether `club_pitch_zones` needs a UI in Club Admin's pitch-settings screen (`app/(app)/club/
   settings/pitch-allocation/settings-form.tsx`) for a club to actually declare its layout, or whether
   Site Admin seeds common layouts (full/half-half, full/quarter-quarter-quarter-quarter) as presets a
   club picks from — a real product decision, not a technical one, and squarely the owner's to make.
3. Decide the drag/drop UX for zone selection once a pitch has more than one free compatible zone at
   drop time (Section 20: "If multiple are available: show/select the target zone clearly").
