# Club Setup, Venues, Lookup & Kit

Covers the club-side domain audit, the two reported search defects and their
fixes, the canonical Club Kit model, and the contract the future Matchday
invitation will consume. Dashboard architecture lives in
`docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md`; referral integrity in
`docs/REFERRAL_ATTRIBUTION_INTEGRITY.md`; navigation and support in
`docs/ADMIN_NAVIGATION_AND_SUPPORT.md`.

| | |
|---|---|
| Migrations | `20261015000000_club_kits.sql` (local only) |
| Regressions | `supabase/tests/club_kits.sql` (26) · `scripts/verify-lookup-search.mjs` (25) |
| **Not built this pass** | the first-run setup wizard — see §7 |

---

## 1. Domain map

```
club_directory ──(directory_id)──> clubs ──> venues ──> club_pitches
   recognised          activated              │            │
   inventory           customers              │            │
                          │                   │            │
                          └──> teams          │            │
                                 │            │            │
        fixtures ────────────────┴────────────┴────────────┘
          venue_id, pitch_id, owning_team_id
        training_sessions
          venue_id, pitch_id, team_id
        pitch_allocation_proposal_items
```

| Relationship | Classification |
|---|---|
| `clubs.directory_id → club_directory.id` | **CANONICAL** |
| `venues.club_id → clubs.id` | **CANONICAL** |
| `club_pitches.venue_id → venues.id` (+ `club_id`) | **CANONICAL** |
| `fixtures.venue_id` / `fixtures.pitch_id` | **CANONICAL** |
| `training_sessions.venue_id` / `pitch_id` | **CANONICAL** — same identities as fixtures |
| `teams.canonical_team_type_id → canonical_team_types` | **CANONICAL** |
| `fixtures.venue_address`, `fixtures.pitch_allocation` (text) | **LEGACY** — superseded by the id columns; retained for historical rows |
| `venues.address` as a single text line | **AMBIGUOUS** — see §3 |

### There is no second venue system

Checked explicitly, because the brief's stop-condition depended on it: the
schema holds exactly one venue table and one pitch table, and **all** venue
and pitch mutation goes through one RPC layer —
`create_venue`, `update_venue`, `set_default_venue`, `set_venue_active`,
`create_club_pitch`, `rename_club_pitch`, `set_club_pitch_active`,
`reorder_club_pitches`. Club Settings, Site Admin Lookup Administration,
Pitch Allocation, Training and fixture creation all call the same functions
and read the same rows. There are no competing `createVenue()`
implementations, so nothing needed reconciling and no third model was added.

### Identity is stable, names are not

`venues.id` and `club_pitches.id` are the join keys everywhere; `name` and
`display_name` are labels. Renaming "Main Pitch" to "First XV Pitch" updates
one column and breaks nothing, because no fixture, allocation or training row
joins on a name. `is_default_home` marks the default venue and is a flag on
the venue rather than a duplicate "default venue" concept elsewhere.

---

## 2. Reported defect: address entry

**Cause.** `AddressLookupField` rendered a text box plus a **Search button**.
Nothing was queried until the button was clicked, so typing a postcode
appeared to do nothing. There was no debounce, no keyboard support and no
combobox semantics.

**Fix.** The field now searches automatically after three characters and a
250 ms debounce, through the shared `Autocomplete` primitive (§4). Both call
sites — Club Admin's venue editor and Site Admin's directory editor — get the
fix from the one component.

**Provider.** Unchanged and not duplicated: `lib/address-lookup/lookup.ts`
(getAddress.io) is server-only, so the key never reaches the browser, and it
already returns structured `line1/line2/line3/town/county/postcode`. When no
`GETADDRESS_API_KEY` is set it reports `not_configured`, and the field now
surfaces that as an honest hint pointing at manual entry rather than an empty
list that reads as "no such address". Manual entry remains available and
writes the same canonical fields.

**Known limitation — structured address.** `venues` stores `address` as one
text column plus `postcode`, `latitude`, `longitude`. The provider returns
three structured lines, and the field joins them to fit. `profiles` and
`club_directory` both have proper `address_line_1..3 / town / county /
country`, so venues are the weaker model. Correcting it is an additive
migration plus a backfill of existing single-line addresses, which is real
work and is **not** done here. Recorded rather than half-done.

---

## 3. Reported defect: Site Admin club lookup

**Cause.** `/admin/lookups` was a Server Component driven by `?q=`, rendered
from a `<form method="get">`. Searching required pressing Enter and a full
page navigation; nothing appeared while typing.

**Fix.** A client type-ahead over the same source, on the shared primitive.
Selecting still navigates to `?clubId=` because the venues and pitches below
are server-rendered for that club — the *search* stopped needing a round
trip, not the result.

**Source semantics, stated rather than assumed.** This page administers
venues and pitches, which only an activated club can own, so it searches
`club_directory` joined `clubs!inner` — recognised clubs that are actually on
Ovalball. The full directory would offer clubs with no `clubs` row and
nothing to administer. The two sources are never silently mixed: a field
meaning "any recognised club" would query `club_directory` alone.

**Suggestions carry identity, not just a name.** Town, county, rugby code and
active team count, so two clubs called "Old Boys RFC" are told apart on
screen rather than by the Site Admin guessing. `%` and `_` in user input are
escaped before the `ilike`.

### Team lookup is club-aware

`TeamSearchInput` (fixture opponent selection) already showed each team's
owning club and town and selected by stable `team_id`. It was converged onto
the same primitive, gaining the debounce and keyboard support it lacked.

**A correction to the premise:** Lookup Administration has no team search —
it administers venues and pitches. Team search lives in fixture selection and
in `/admin/team-directory`. The "team search feels disconnected from club
search" report is really that they are *different pages*; the club-aware
behaviour asked for already exists in the team selector and is now
consistent with it.

---

## 4. One autocomplete primitive

`components/ui/autocomplete.tsx`. Ovalball had three search experiences and
two were broken, differently, because they were three implementations.

Guarantees, asserted by `scripts/verify-lookup-search.mjs`:

- debounced, never a button and never Enter-to-start;
- superseded responses discarded, so a slow early keystroke cannot overwrite
  a later one;
- `role="combobox"` / `aria-expanded` / `aria-activedescendant`, a labelled
  `listbox`, and `role="option"` rows;
- arrows move, Enter selects the highlighted option, Escape closes;
- distinct loading / empty / error states and a polite live region;
- a clear control.

Callers supply the search function and how to render an option. No surface
re-implements its own debounce — the verifier fails if one does.

---

## 5. Club Kit

`club_kits`: one row per `(club_id, variant)`, variants `primary` (Home) and
`alternate` (Away).

```
pattern            controlled vocabulary, 9 keys, CHECK-enforced
primary_colour     #rrggbb, CHECK-enforced server-side
secondary_colour   required for every pattern except SOLID
accent_colour      optional trim
```

**Distinctions that must not blur** (each asserted in `club_kits.sql`):

| | |
|---|---|
| **Club logo ≠ club kit** | logo is an uploaded asset in `club-logos`; kit is configuration a renderer draws. `club_kits` has no image, url or path column |
| **Kit ≠ identity** | a club is `clubs.id` / `directory_id`. Two clubs may share colours |
| **Kit is club-level** | no `team_id` on `club_kits`, no colour columns on `teams`. Team-specific kits would be an explicit override later, never duplicated colours |
| **Away is optional** | a club with only a Home kit is valid |

**Colours are validated in the database**, not the browser — a CHECK
constraint on `^#[0-9a-f]{6}$`, and values are lower-cased on write so
`#AABBCC` and `#aabbcc` are one value.

**Idempotent.** `upsert_club_kit` conflicts on `(club_id, variant)`, so a
double-clicked Save updates one row. Authorization reuses
`club.edit_profile` — kit is part of the club profile and needs no capability
of its own.

### The renderer

`components/club/rugby-kit.tsx` — one SVG component, used by the editor today
and by Matchday later, so a club cannot discover its shirt looks different on
the fixture card. SVG rather than a stored PNG: it re-renders at any size,
costs no storage, and stays in sync with the configuration by construction.

`HOOPS` and `HORIZONTAL_BANDS` are deliberately kept separate rather than
consolidated — same geometry at different frequencies, and rugby clubs
describe themselves using both words.

**Never colour alone.** `describeKit()` generates the accessible sentence
from the canonical pattern and colours — *"Burnley RUFC primary kit: light
blue and claret hoops"* — used as the SVG's `aria-label` and shown as visible
text under the preview.

`KitPlaceholder` is what a fixture card shows for canonical-but-unclaimed
opposition: a dashed outline, no invented colours.

### Kit history — a deliberate non-decision

A club may change kit next season, and a 2024 fixture arguably ought to show
the 2024 shirt. Two models could deliver that — effective-dated kit rows, or
a per-fixture visual snapshot — and there is no evidence yet for which
Matchday needs. Neither is implemented, and **neither is foreclosed**: kit
lives in its own table so `effective_from`/`effective_to` can be added and
the unique index relaxed, and Main already has the snapshot precedent in
`fixtures.owning_team_display_name_snapshot`.

---

## 6. Future Matchday invitation contract

Not built. Documented so it consumes canonical data when it is.

```
FIXTURE      fixture_id (stable physical fixture, is_primary_mirror)
             season_id · kickoff_date/time · home_away · status
HOME / AWAY  club identity   clubs.id, or club_directory.id when unclaimed
             logo            clubs.logo_storage_path (may be absent)
             kit             club_kits (may be absent -> KitPlaceholder)
             team identity   get_team_identity_for_season / the fixture's
                             own *_snapshot columns
LOCATION     venue_id -> venues (address, lat/long) · pitch_id -> club_pitches
CONDITIONS   weather derived at render from venue + time, never stored as
             fixture truth unless deliberately cached
PARTICIPATION player_fixture_attendance · fixture_player_call_up
COMMUNITY    the fixture's canonical conversation
```

### The duplication in the design mock

The reference design reads:

```
Leigh RUFC          Burnley RUFC
Leigh RUFC          Burnley RUFC     <- wrong: the club name twice
```

The contract is **club name, then the team's identity for that fixture's
season**:

```
Leigh RUFC          Burnley RUFC
Under 12            Under 12
```

The second line comes from `get_team_identity_for_season` or the fixture's
own snapshot columns — never from the club name, never from a mutable
current `teams.display_name`. This is what keeps a historical Under 12
fixture reading "Under 12" after that cohort has moved up, and a
future-season fixture reading the identity appropriate to that season.

### Avatars

Audited, not built. `profiles.avatar_storage_path` plus a public `avatars`
bucket is the only avatar architecture, and Matchday should resolve
*participant → person/player identity → authorized avatar*, never store a
copy against a fixture or an attendance row (both asserted).

**Youth photography.** `players` has no photo column at all today, so a
child's participation cannot currently depend on displaying a photograph —
and it must not be made to. Any future youth avatar has to go through the
existing guardian/consent architecture, and Matchday must fall back to
initials rather than pressure a club into uploading children's photographs
because the design looks better with them.

---

## 7. First-run setup wizard — BUILT

Three steps at `/club/setup`, mandatory, resumable, and enforced on the
server.

### The lifecycle

`club_setup_state` (migration `20261016000000`) holds one row per club with
`status` (`NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`), `current_step`, and
the confirmation/completion timestamps and actors. **That is all it holds.**
It carries no copy of the logo path, the kit, the venue, the address or the
team list — those live in `clubs`, `club_kits`, `venues`, `club_pitches` and
`teams`, exactly where they lived before and exactly where they are edited
afterwards. Deleting every row in `club_setup_state` would lose progress and
no operational data; the regression suite asserts this directly.

Every requirement is re-derived from canonical data on each read by
`club_setup_requirements(club_id)`. Nothing is cached, so a logo removed or
a venue deactivated after a step was passed un-ticks that step immediately.
The wizard's progress rail, the gate, and completion all call this one
function, so they cannot disagree.

`complete_club_setup` re-validates every requirement before it will move the
lifecycle, and refuses with a sentence naming what is still missing. A
client claiming to be on step 3 is not evidence. It is idempotent: a
double-clicked Finish returns `already_complete` rather than failing.

Activation is one-way. A club whose venue is deactivated in March is not
dropped back into onboarding mid-season; the suite asserts that too.

### The gate

`app/(app)/layout.tsx` reads the request path (via the `x-ovalball-pathname`
header set in `proxy.ts`) and, for a club whose setup is not `COMPLETED`:

- a Club Admin is **redirected** to `/club/setup?step=N`, where N is the
  first unfinished step;
- anyone else gets the bounded `ClubSetupRequired` screen in place of the
  page content — no redirect, and **no grant of authority**. The shell,
  nav, context switcher and account menu all stay where they were.

The gated club is resolved from the active context's `clubId`, not from
`kind === "club"`. A Team Admin, coach, parent and player at an unset-up
club are looking at the same empty application a Club Admin would be, and
every one of those contexts carries its club. Keying on the context kind had
meant only a Fixture Secretary ever saw the explanation.

`isSetupAllowedPath` keeps configuration reachable and operations blocked.
The gate exists to stop an unfinished club being **operated**, not
**configured**: `/club`, `/teams`, `/account`, `/support`, `/welcome` and
`/auth` stay open, minus `/club/training` and `/club/calendar`, which are
scheduling surfaces that happen to live under a settings URL. The wizard
links into Club Settings and Team Administration, so gating those would have
sent someone from the wizard to a page that bounced them back to it.

While the gate is up, the nav is filtered to the same allowed set plus a
"Set up your club" entry, so it never offers a link that silently bounces.

### The steps

1. **Club identity** — mounts Club Settings' own `ClubProfileForm` and
   `KitSection`. Not a copy: the same components, writing the same rows. The
   form's free-text "Home ground address" field is suppressed here
   (`hideHomeGroundAddress`), because step 2 asks the same question properly
   two screens later and two fields for one answer read as a lost answer.
   Requires a crest and a home kit.
2. **Home ground** — `StepVenue` creates the venue, its structured address
   and its pitches in **one submission**, through the canonical
   `create_venue` / `set_venue_address` / `create_club_pitch` RPCs. Venue and
   pitch are created together because a ground with no pitch is not a usable
   home ground. Requires a default venue with an address and at least one
   attached pitch.
3. **Teams** — lists the club's teams, links out to Team Administration to
   add more, and removes safely: `classify_team_removal` scans every foreign
   key pointing at `teams` from `pg_constraint` (31 columns today), and
   `remove_setup_team` deletes only a provably pristine team, folding
   anything with history instead. Requires explicit confirmation of the list.

### Away kit — "we play in our home shirts away too"

Plenty of clubs run one set of shirts. The Away tab carries a checkbox that
copies the home kit across and saves it as a real `alternate` row, so every
fixture card still reads one canonical place and nothing downstream needs to
know the two match. Unticking unlocks the editor without writing anything —
the stored row is untouched until they save a change themselves.

---

## 7a. Pitch → venue integrity (migration `20261017000000`)

Two defects found and fixed this pass.

**V-1 — cross-club venue assignment.** `club_pitches.venue_id` is read as
canonical by training plan validation, manual session reconciliation and
session editing, and was written by a direct
`update public.club_pitches set venue_id = ...` from the app. The
`club_pitches_update` policy checks `club.pitches.manage` against the row's
own `club_id` and, having no `WITH CHECK` of its own, re-uses that as the
check — so the pitch cannot change clubs, but `venue_id` was unconstrained.
**Verified live on this database**: a Burnley Club Admin successfully
attached a Burnley pitch to a Rossendale venue. RLS is row-scoped and cannot
express "this column must reference a row of the same club", so the rule now
lives in `set_club_pitch_venue`, which the app calls instead.

**V-2 — pitches born detached.** `create_club_pitch` accepted no venue, so
every pitch had to be attached in a second step. It now takes an optional
`p_venue_id`, validated the same way. The old three-argument signature was
**dropped explicitly** rather than replaced, so the function does not become
an ambiguous overload.

No backfill. The four detached pitches on this database all belong to clubs
with three to five active venues each, so there is no unambiguous answer and
guessing one would put a fabricated location on a real pitch.

## 8. Remaining gaps

- **Live provider suggestions are unverified.** `GETADDRESS_API_KEY` is
  absent locally, so no real suggestion list has ever been rendered from the
  provider. What IS verified is the unconfigured path (an honest hint
  pointing at manual entry, and no contradictory "no addresses found"
  dropdown) and manual entry end to end. Every structured-address assertion
  is written against the components the client extracts from a provider
  result, so the suite holds either way — but a live provider UAT still has
  to happen in an environment that has the key.
- **Same-as-home away kit** — live-verified in the browser (ticking writes an
  identical `alternate` row; unticking writes nothing). The behaviour is
  client-side, so it has no SQL suite assertion of its own.
- **Address provider not configured locally** (`GETADDRESS_API_KEY` absent), so live suggestions are unverified end to end; the unconfigured path and manual fallback are verified.
- **Kit history** — deliberately deferred, §5.
- **`/admin/lookups` is read-only** for a Site Admin without `site.lookups.manage`, so venue/pitch mutation UAT needs a Club Admin or that capability.

---

## 9. Address lookup in first-run setup

Step 2 mounts the shared `AddressLookupField` — the same component Club
Settings' venue editor and the Site Admin directory editor use, over the
same `Autocomplete` primitive. One implementation, one set of keyboard,
loading, empty and error behaviours.

`onSelect` was extended additively rather than forked. It previously handed
back a single joined `address` line, because `venues.address` was one
column; it now hands back **both** that joined line and the provider's own
`line1` / `line2`, and each caller takes the shape it needs. Nothing is
discarded — the provider's rare `line_3` folds into `line2`.

Selecting a suggestion fills the fields and writes nothing. **Save home
ground** remains the only thing that persists, and every field stays
editable afterwards, so a slightly wrong provider result is corrected in
place rather than being a dead end.

When the provider is not configured, the field says exactly that and points
at manual entry. It no longer also shows "No addresses found for that
search." — that read as "this address does not exist" when the truth is
that nothing was searched. The `Autocomplete` primitive now suppresses the
dropdown entirely when its caller passes an empty `emptyMessage`, which is
what a caller does when a hint below the field is already explaining.

---

## 10. Profile photo / youth privacy audit (documentation only)

No Matchday attendance or avatar UI was built. This records what the schema
actually supports, for whoever builds it.

**There is exactly one photo column in the entire `public` schema:**
`profiles.avatar_storage_path`. Verified by scanning
`information_schema.columns` for `%avatar%` / `%photo%`.

Consequences, all of which the future Matchday card must respect:

1. **`players` carries no photo at all.** A player is a sporting identity,
   not an account. A minor's participation therefore has **no** photo
   dependency of any kind — not by policy, but by construction. §41 is
   satisfied structurally rather than by a rule someone has to remember.
2. **No fixture or attendance table carries an avatar column.** Nothing
   copies an avatar path or URL into a fixture, an attendance row or a
   call-up. A participant's photo, where one legitimately exists, is
   resolved at render time from the canonical person via
   `resolvePersonalAvatarUrl` — the single resolver in
   `lib/app-context/personal-avatar.ts`. A future Matchday card must keep
   resolving, never snapshot.
3. **An avatar belongs to a registered user, not to a player.** A photo can
   only appear for someone who holds an account and uploaded one
   themselves. There is no path by which a guardian, coach or club uploads
   a photo *of a child*.

**One open decision, flagged rather than resolved.** The `avatars` bucket is
**public** (`storage.buckets.public = true`), like `club-logos` and unlike
`club-documents`, `fixture-attachments` and `support-attachments`. For an
adult account holder that is an ordinary product choice. But if a player
old enough to hold their own account ever uploads an avatar, that image is
world-readable by URL to anyone who has it. Before any avatar is rendered on
a matchday card seen by a wider audience, someone has to decide whether the
avatars bucket stays public or moves to signed URLs. This pass does not make
that decision, and nothing built here depends on the answer.

The fallback where no legitimate photo exists is initials, which the shell's
own avatar already renders.

---

## 11. Team identity: folded teams keep their identity

Found while writing the removal regressions, and worth recording because it
changes what "remove" means in step 3.

`teams` carries **two** identity constraints:

- `teams_active_canonical_identity_idx` — partial, `WHERE active = true`
- `teams_club_id_identity_key_key` — `UNIQUE (club_id, identity_key)`,
  **unconditional**

So a folded team's identity stays reserved to it permanently. A club can
never hold two teams of the same identity in any state. That means removing
a team by mistake during setup is undone by **reactivating** it in Team
Administration, never by adding a second one — which is exactly what keeps
a folded team's fixtures, memberships and season history attached to the
team they belong to.

A related fact, also asserted: omitting `canonical_team_type_id` on an
insert does not create a free-text team. `teams_set_canonical_type_trigger`
resolves the type from the structured fields, and
`teams_active_requires_canonical_type` rejects the row when nothing
resolves. The closed catalogue holds from either direction.

---

## 12. Incident: capability union regression (R-0, tenth occurrence)

Recorded because it will happen an eleventh time otherwise.

`internal.has_club_role_capability` is one function holding one inline list
per role. Any migration that adds a capability re-declares the whole
function, and a re-declaration written from an older copy of the list
silently deletes every capability added since. Nothing errors. A product
area simply stops working for every Club Admin on the platform.

During this pass, four untracked `20261018*` safeguarding migrations
appeared in the working tree from concurrent work and were applied to the
shared local database. Their re-declaration correctly added
`club.safeguarding.view` / `manage_contact` / `message` and silently dropped
twelve capabilities, including all of Domain A billing, referrals, training
and GoCardless connection. Seven previously-green suites failed at once.

The R-0 assertion in `referral_attribution_integrity` named the missing
capabilities exactly. That assertion has now paid for itself twice.

`20261019000000_capability_union_restore.sql` re-declares the function as
the **union** of both intended lists, so neither line of work loses
anything, and carries a migration-time guard that fails the migration if the
union does not resolve for a real Club Admin. It modifies no other
migration; being ordered last, it is the last word regardless of the order
the others are applied in.

**The durable fix is not this migration.** It is that the inline lists are a
bad shape for a value multiple feature areas extend. A `role_capability_defaults`
table, or a set of additive `grant`-style migrations, would make this class
of regression impossible. That is a Main architecture task, deliberately not
started inside this scoped pass.
