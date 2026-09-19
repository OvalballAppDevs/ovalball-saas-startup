# Convergence Step 6 — archaeology and current-state map

**No implementation has started.** §2 of the Step 6 command requires the current
product to be mapped before anything is rebuilt, and §3 requires a BEFORE
functionality matrix before that. This is that map.

The headline: **far more of Step 6's territory already exists than the command
assumes.** The first-run setup wizard is built, mandatory, resumable and
server-enforced; venues and pitches have exactly one canonical RPC layer; the
address field is already the shared autocomplete primitive; the club theme has
one resolver. Step 6 is therefore a **convergence and gap-closure** step, not a
rebuild — which is what §2 exists to establish.

`docs/CLUB_SETUP_VENUES_AND_KIT.md` is the existing architecture record and is
largely accurate, but it **predates Identity/Auth Slices 3–7 and at least one
venue migration**, so it is stale in specific places called out below. The live
schema, not that document, is treated as the authority throughout.

---

## 1. The domain chain, as it actually is

```
club_directory ──(directory_id)──> clubs ──> venues ──> club_pitches
  recognised inventory             activated  │            │
  1,395 rows locally               customer   │            │
       │                              │       │            │
       │                              └──> teams           │
       │                                     │             │
  fixtures / training_sessions ──────────────┴─────────────┘
      venue_id · pitch_id · owning_team_id
```

| Concern | Canonical home | Notes |
|---|---|---|
| Club **name**, town, county, rugby code, governing body | `club_directory` | `clubs` has **no name column** |
| Club **activation**, slug, bio, website, socials, logo, timezone, public-field visibility flags | `clubs` | 27 columns |
| **Setup lifecycle** | `club_setup_state` | status / current_step / timestamps **only** |
| **Kit / colours** | `club_kits` (`primary` + `alternate`) | no image, no `team_id` |
| **Venue** | `venues` | 24 columns, structured address present |
| **Pitch** | `club_pitches` | child of venue **and** club |
| **Team identity** | `teams` → `canonical_team_types` | closed catalogue |

### §4 — one canonical club, answered

There is **no competing "club profile" table.** The apparent duplication is a
deliberate two-record model: `club_directory` is the recognised-inventory record
(exists for 1,395 clubs that have never heard of Ovalball) and `clubs` is the
activated-customer record. Both carry `logo_storage_path`, `bio`, `website`,
`facebook_url`, `latitude`, `longitude` — and that is the **fallback pair**, not
a second truth: the club's own value wins, the directory's seeds it.

`club_setup_state` deliberately holds no copy of any club data. Deleting every
row would lose progress and no operational data.

---

## 2. Findings — four real defects

### F-1 · L17 confirmed: `club_directory` private columns are readable by any session

**Measured, not inferred.** `authenticated` holds a **table-level** `SELECT` on
`club_directory`, which overrides the 17-column public grant that also exists on
the same table. `anon` is correctly column-restricted.

```
authenticated  TABLE SELECT        -> true
  has_column_privilege notes           -> true
  has_column_privilege official_email  -> true
anon has_column_privilege notes        -> false
```

RLS is **not** the gap: the policies are already capability-based
(`site.directory.manage` for insert/update/delete; select is active rows or that
capability). RLS scopes rows, never columns, so a signed-in person reading an
active row gets every column.

**What `notes` actually contains** (§6 requires recovering this rather than
assuming): 1,385 of 1,395 rows, 750 distinct values, all **governing-body
research provenance** — *"Official WRU 2026/27 community amateur competition
participant…"*, *"Club name and listed location verified against the official…"*.
It is not private club administration and not personal data. The exposure is
therefore **low severity in current content** — but the column is free text
writable by a Site Admin, so its classification must follow the writer's licence,
not today's sample. `official_email` is a club's published contact address on 29
rows.

**Why the fix is not simply revoking the table grant.** Ordinary authenticated
surfaces legitimately read three columns outside the public 17 —
`latitude`, `longitude`, `geocode_status` — for Ovie opponent search
(`lib/ovie/opponent-search.ts`), the competitions workspace and the Partner Clubs
map. A blanket revoke would break real features.

**The one true private-column consumer** is
`app/(app)/admin/clubs/[directoryId]/page.tsx`, which does `select("*")`. The
Site Admin club **list** does not read the table directly — it reads
`admin_club_overview`, which Slice 7e re-gated on `site.clubs.view`. That view is
`security_invoker`, and it **does** project `notes`, `official_email`, `source`,
`source_url`, `address` and `normalized_key`, so a column revoke reaches it too
and the Site Admin path needs a definer read of its own.

**Status: OPEN — Step 6 owns it. Not yet closed.**

### F-2 · Venue address has two writers, and one of them strands the structured columns

**This finding was wrong the first time it was written, and the correction is the
useful part.** The first pass reported that Club Settings shows no address for
venues created by the wizard, and that the wizard and settings disagree about
where an address lives. Half of that was a fixture artefact. What survives is
narrower and still real.

**What is actually canonical.** `set_venue_address` writes the structured columns
*and regenerates the legacy single-line column from them*:

```sql
address = nullif(concat_ws(', ', line1, line2, town, county), '')
-- "The display line is regenerated from the structured parts, so the
--  legacy column stays truthful rather than becoming stale."
```

So `venues.address` is a **derived display column** with a maintaining writer.
There is one canonical address model, not two.

**The real defect.** `update_venue` — which Club Settings uses
(`app/(app)/club/actions.ts:334`) — writes the derived column **directly** and
never touches the structured ones:

```sql
update public.venues set name = v_name, address = nullif(trim(coalesce(p_address,'')),''), ...
```

Editing a venue's address in Club Settings therefore sets
`address = 'New Street, Newtown'` while `address_line_1` still says
`Belvedere Road`. The derived column stops being derived, and every structured
reader — the setup wizard's own step 2, and anything that later consumes
`town`/`postcode`/`country` — keeps showing the old address. That is reachable
through the product today.

It also inverts §38: the guided wizard writes the canonical structured form, and
the ordinary administration surface writes a weaker one. Setup is supposed to be
*a presentation over* club administration, never more capable than it.

**What was NOT a defect, and why the first reading got it wrong.** Both venues on
this database show `address = NULL` despite having a full structured address:

```
Ovalball UAT Ground | address=NULL | line1=Belvedere Road | town=Burnley | postcode=BB10 2LS
```

That is not the product failing to derive the column. Those rows were inserted
**directly by seed SQL** — `supabase/seeds/local_uat_fixture_operations.sql:54`
and `local_uat_parent_player.sql:81` — with the structured columns and no
`address`, and `updated_by` is `NULL` on both, confirming no RPC ever touched
them. A venue created through the product would have the derived line.

**Which is itself worth recording** (§51): the seeds create venue rows the
product cannot create. A fixture world that bypasses the canonical writer will
keep producing findings like this one — a reviewer sees a state the product
could not have reached and reasonably reads it as a bug.

**Status: OPEN — Step 6 owns both halves.** Converge `update_venue` onto the
structured writer, and seed through the canonical RPC.

### F-3 · The logo fallback rule is re-implemented inline in four places

Better than Step 0 feared, and worth stating precisely rather than repeating the
original assumption. `lib/app-context/club-logo.ts` is the canonical resolver and
**17 files use it**. Nine files read `logo_storage_path` raw, of which four are
legitimately about the *directory record itself* (the directory logo manager, its
actions, the directory-crest email route) or are a **write** (`club/actions.ts`).

The remaining ones do not skip the fallback — they **re-implement it**:

| File | Line |
|---|---|
| `app/(app)/messages/compact-actions.ts` | `theirs?.clubs?.logo_storage_path ?? theirDirectory?.logo_storage_path` |
| `app/(app)/messages/[kind]/[id]/page.tsx` | same shape, twice |
| `app/(app)/admin/clubs/query.ts` | `row.logo_storage_path ?? row.directory_logo_storage_path` |
| `lib/app-context/diagnostic-access.ts` | reads a pre-resolved RPC column — **needs confirming** |

So the *behaviour* is currently correct everywhere checked. The convergence
§7 asks for is real all the same: an inline `??` chain is precisely the thing that
drifts when a third source (or a deactivated-club rule) is added, and four copies
means four places to miss.

**Status: OPEN — convergence, not a live breakage.**

### F-5 · A fixture's pitch is never checked against its venue — but training's is

The invariant is not something this step invents. It is already written, in
those words, in the training path:

```
override_training_session:  'The selected pitch does not belong to the selected venue.'
create_training_session:    'The selected pitch does not belong to the selected venue.'
```

The fixture path does not have it:

| Writer | Authority | Pitch belongs to club | **Pitch belongs to the row's venue** |
|---|---|---|---|
| `create_training_session` | ✅ | ✅ | **✅** |
| `override_training_session` | ✅ | ✅ | **✅** |
| `update_fixture_pitch` | ✅ | ✅ (+ not archived, home only) | **❌ never checked** |
| `update_fixture_venue` | ✅ | ✅ (venue belongs to club) | **❌ `pitch_id` not even read** |

So for a club with two grounds:

1. set the fixture's venue to Ground A and its pitch to Pitch A1 — valid;
2. change the venue to Ground B — accepted;
3. the fixture is now at Ground B, on a pitch that physically exists at Ground A.

Nothing errors and nothing reconciles. `update_fixture_venue` sets `venue_id`
and never looks at `pitch_id` at all.

**Why a constraint cannot do this.** The rule spans two columns on the fixture
row and a third table, so it is not expressible as a FK or a row-scoped RLS
policy — which is exactly why `set_club_pitch_venue` already exists for the
sibling case (`20261017000000`). It belongs in the RPCs, where training already
puts it.

**Current data is clean but proves nothing.** Zero mismatched fixtures, zero
mismatched training sessions, zero detached pitches — out of **zero** fixtures
that set both `venue_id` and `pitch_id` locally. A count of zero over an empty
set is not evidence, and the permanent test must seed real rows rather than
assert against this.

**Status: OPEN — Step 6 owns it.** §61 puts venue/pitch identity integrity
explicitly on this step even though fixtures consume it; fixing two RPCs'
validation is canonical-data integrity, not the Fixture Operations product work
§62 defers.

### F-6 · A postcode change discarded the coordinates supplied with it

Found by `structured_venue_address` the moment Step 6 split venue creation from
venue addressing — and latent long before that.

`internal.reset_venue_geocode_on_postcode_change` is a BEFORE trigger that clears
the pin whenever the postcode moves, which is right: a pin derived from the old
postcode is wrong for the new one. But `set_venue_address` writes the postcode
**and** the provider's coordinates in one statement, so when the postcode moved
in that statement the trigger nulled the latitude and longitude the same
statement was setting, and left `geocode_status = 'pending'`.

It was invisible because `create_venue` used to store the postcode first, so by
the time `set_venue_address` ran the postcode was unchanged and the trigger never
fired. Two functions that were each correct alone.

The rule, stated precisely: a postcode change invalidates a pin **derived from
the old postcode**; it does not invalidate coordinates the writer supplies
alongside the new postcode, because those came from the same provider result.

**Status: CLOSED** — `20270513000000`, proved against real rows in the migration
itself because the defect was an interaction rather than a body.

### F-4 · `docs/CLUB_SETUP_VENUES_AND_KIT.md` §12 is superseded

The document's closing incident describes `internal.has_club_role_capability` as
one function with inline per-role capability lists, and names a
`role_capability_defaults` table as the undone durable fix. That table now exists
and the canonical engine is `internal.capability_decision`. The incident record
stays as history; its "durable fix not started" conclusion is **no longer true**
and must not be acted on.

---

## 3. What is already correct, and must not be rebuilt

Recorded because §3's gate is that nothing is lost, and the fastest way to lose
something is to replace a working thing that was not understood.

- **One venue system.** One `venues` table, one `club_pitches` table, and all
  mutation through `create_venue` · `update_venue` · `set_venue_address` ·
  `set_default_venue` · `set_venue_active` · `create_club_pitch` ·
  `rename_club_pitch` · `set_club_pitch_active` · `set_club_pitch_venue` ·
  `reorder_club_pitches`. Club Settings, Site Admin Lookups, Pitch Allocation,
  Training and fixture creation all call these.
- **`is_default_home` is a flag on the venue** — the canonical default-venue
  relationship §23 asks about already exists. No UI-only default is needed.
- **Setup is server-enforced and resumable.** `club_setup_requirements(club_id)`
  re-derives every requirement from canonical data on each read, nothing is
  cached, and `complete_club_setup` re-validates before moving the lifecycle and
  is idempotent. §13 and §33 are already satisfied by construction.
- **The setup gate keys on the active context's `clubId`**, not on context kind,
  so a coach, parent and player at an unset-up club see the same bounded
  explanation rather than a redirect — and it grants no authority.
- **Pitch → venue integrity is enforced in `set_club_pitch_venue`**, because RLS
  is row-scoped and cannot express "this column must reference a row of the same
  club". A cross-club assignment was found live and closed by `20261017000000`.
- **One autocomplete primitive** (`components/ui/autocomplete.tsx`) with a
  verifier that fails if a surface re-implements its own debounce.
- **One theme resolver** (`lib/club-theme/theme.ts` → `resolveClubTheme` /
  `clubThemeVariables`), consumed by the dashboard, Club Desk, the public club
  pages and the shared primitives. Kit writes go through `upsert_club_kit`, and
  setup mounts Club Settings' own `KitSection` rather than a copy.
- **Team identity is structural, not parsed.** `teams_set_canonical_type_trigger`
  resolves the canonical type from structured fields and
  `teams_active_requires_canonical_type` rejects a row when nothing resolves, so
  a free-text team cannot be inserted from either direction. A folded team keeps
  its identity permanently (`teams_club_id_identity_key_key` is unconditional),
  which is why setup "removal" must reactivate rather than re-add.

---

## 3a. §12 and §25, answered

**§12 — who enters setup.** Already server-authoritative, and already correct.
`app/(app)/layout.tsx` resolves the club from `activeContext.clubId` (never from
`kind`), reads canonical `club_setup_state` through `getClubSetupState`, and asks
`hasCapability(supabase, "club.profile.edit", "club", { clubId })` — the Slice 3+
resolver, not a role name. Nothing consults client metadata, `localStorage` or
`ovalballSignupPayload`. Anyone without the capability gets a bounded screen with
no redirect and **no grant of authority**.

**§40 — multi-club.** `club_setup_state` is keyed by `club_id`, and the gate
reads the *active context's* club, so completing Club A cannot mark Club B
complete and switching context shows the right state. Setup completion is not on
the person or the profile.

**§25 — ID correlation.** Every consumer reaches venues and pitches through real
foreign keys — 22 of them, each pointing at the right table — so the "venue id
used as a pitch id" and "display name used instead of id" classes are
structurally impossible rather than merely absent. What the schema **cannot**
express is the cross-row correlation, and that is F-5 below.

---

## 3b. A gap in this archaeology, found by the gate rather than by the map

§2 asks for "tests" as one of the things to identify per stage. This document's
first version did not, and the full gate found four existing suites in Step 6's
own domain that the map had never mentioned:

| Suite | What it already covered |
|---|---|
| `structured_venue_address` | the provider/manual address shapes, the derived display line, coordinate preservation |
| `venue_pitch_team_integrity` | venue, pitch and team identity across clubs |
| `club_activation_setup` | the setup lifecycle end to end |
| `directory_admin_verification_status` | the Site Admin attestation and its RLS boundary |

All four broke on the first Step 6 change, for two honest reasons — three called
`create_venue`/`update_venue` with the address parameters this step removed, and
one read a `club_directory` column L17 closed. All four are updated and green.

The lesson is the one the programme keeps re-learning: **an archaeology pass that
maps tables, functions and UI but not the existing tests has not finished.** The
tests are where the previous pass wrote down what it believed, and in this case
one of them — `structured_venue_address`'s coordinate assertion — knew something
the schema did not, and caught a defect this step would otherwise have shipped
(F-6).

## 3c. Teams (§27–§29), answered

**There is no `proposed_teams` table.** §28 names one; the schema has a `jsonb`
column, `club_claims.proposed_teams`, carrying what the claimant said their club
runs.

The chain is single-writer and single-shot:

```
club_claims.proposed_teams (jsonb)
      └─ decide_club_claim            the ONLY caller of…
            └─ internal.seed_teams_from_proposal(club_id, rugby_code, proposed_teams)
```

`seed_teams_from_proposal` has exactly one caller, and it is claim **approval**.
Setup's step 3 lists the club's teams, links out to Team Administration to add
more, and removes through `classify_team_removal` / `remove_setup_team`. It does
not seed. So §28's "do not seed duplicate teams when the user reaches step 3" is
satisfied by construction rather than by a guard — there is no second seeding
path to collide with.

§29's safety is likewise already built: `classify_team_removal` scans every
foreign key pointing at `teams` from `pg_constraint` rather than a hand-kept
list, and `remove_setup_team` deletes only a provably pristine team, folding
anything with history. And because `teams_club_id_identity_key_key` is
unconditional, a folded team keeps its identity permanently — which is why an
accidental removal is undone by **reactivating** in Team Administration and never
by adding a second team of the same identity.

**Nothing in Step 6 changes any of this**, and the functionality matrix records
rows 29–34 as unchanged.

## 4. Still to map before implementation

Named so the gaps in this document are visible rather than implied.

- §5 the full club field inventory with every reader and writer.
- §10 remaining hard-coded club colours.
- §37 Site Admin club management against the same canonical data.
- The BEFORE functionality matrix itself (§3), which this map feeds.
