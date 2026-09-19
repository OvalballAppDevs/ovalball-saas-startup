# Convergence Step 6 — club onboarding and canonical club / venue / team data

**Delivered and proved locally. NOT RELEASED. Step 7 not started.**

Companion documents:

| | |
|---|---|
| Current-state map and the six findings | `CONVERGENCE_STEP_6_ARCHAEOLOGY.md` |
| BEFORE / AFTER inventory | `CONVERGENCE_STEP_6_FUNCTIONALITY_MATRIX.md` |
| Existing architecture record (partly stale — see §1) | `../CLUB_SETUP_VENUES_AND_KIT.md` |

---

## 1. Archaeology — the headline

**Most of Step 6's territory already existed.** The first-run wizard is built,
mandatory, resumable and server-enforced. Venues and pitches have exactly one
canonical RPC layer. The address field is already the shared autocomplete
primitive. `is_default_home` is already the canonical default-venue
relationship. The club theme already has one resolver.

So this was a convergence and gap-closure step, not a rebuild — which is what §2
exists to establish before anybody starts typing.

`docs/CLUB_SETUP_VENUES_AND_KIT.md` is the existing record and is largely
accurate, but predates Identity/Auth Slices 3–7 and at least one venue
migration. Its §2 describes structured venue addresses as an unbuilt limitation
(they exist), and its §12 names a `role_capability_defaults` table as the undone
durable fix (it exists). The **live schema was treated as the authority
throughout**.

## 2. BEFORE functionality matrix

54 functions inventoried across club identity, venues, pitches, teams, setup,
fixture/training consumption, Site Admin and public surfaces. See the matrix
document.

## 3. The canonical club

There is **no competing "club profile" table**. The apparent duplication is a
deliberate two-record model:

- `club_directory` — the recognised-inventory record. Holds the **name**; exists
  for 1,395 clubs that have never heard of Ovalball.
- `clubs` — the activated-customer record. Holds slug, bio, socials, crest,
  timezone and the public-visibility flags. **Has no name column.**

Both carry `logo_storage_path`, `bio`, `website`, `facebook_url` and
coordinates, and that is the **fallback pair**, not a second truth: the club's
own value wins and the directory's seeds it.

`club_setup_state` holds status, current step and timestamps and **no copy of
any club data** — deleting every row would lose progress and no operational
data.

## 4. L17 — CLOSED

Measured, not inferred: `authenticated` held a **table-level** `SELECT` on
`club_directory`, silently overriding the 17-column public grant present on the
same table. `anon` was already correctly restricted.

`notes` was recovered before being judged: 1,385 of 1,395 rows, all
governing-body research provenance. Not personal data, so the exposure was **low
severity** — closed anyway, because the column is free text a Site Admin writes
and its classification follows the writer's licence rather than today's sample.

The fix, at the database boundary:

1. table-level `SELECT` revoked;
2. the column grant extended with `latitude`, `longitude`, `geocode_status`,
   which Ovie opponent search, the competitions workspace and the Partner Clubs
   map legitimately read — a blanket revoke would have broken real features;
3. `admin_club_overview` made **owner-rights**, its existing
   `has_site_capability('site.clubs.view')` gate becoming the boundary;
4. `site_club_directory_record(uuid)` added for the one editor that needs the
   private columns.

Writes are untouched: RLS already gated them on `site.directory.manage`.

**19 permanent assertions** covering anon, a signed-in stranger, an ordinary
member, the club's own Club Admin, and a Site Admin — plus positive controls
that the public facts and geo columns still read, and that a Site Admin can
still write.

## 5–6. Logo and theme convergence

**Logo.** Step 0 recorded "consumers skipping the directory fallback". Measured,
that was not true — every consumer applied it. They had each **re-implemented**
it: ten hand-written `?? ` chains across four files. All ten now route through
`lib/app-context/club-logo.ts`, which gained `resolveClubLogoPathFrom` for the
two legitimate call shapes (a flattened view row, and an unclaimed opponent whose
fallback is the directory the *fixture* points at — a different rule, named
rather than pretended away). A permanent test fails the eleventh copy.

**Theme.** Already converged. The guard added asserts the property §10 actually
asks for — that `clubThemeVariables` is the only producer of `--club-*` — rather
than flagging every file that reads `club_kits`, which caught four legitimate
shirt-renderer call sites on the first attempt.

## 7–8. Setup architecture and Step 1

Unchanged, because it was already right. §12's entry condition is
server-authoritative: the club comes from the active context's `clubId`, the
state from canonical `club_setup_state`, and the authority from
`hasCapability("club.profile.edit")` — never a role name, client metadata,
`localStorage` or `ovalballSignupPayload`. §40 holds by construction:
`club_setup_state` is keyed by club, so completing Club A cannot mark Club B
complete.

## 9–11. Venue, address and ID integrity

**One writer for a venue address.** `create_venue`/`update_venue` wrote the
derived single display line and never touched the structured columns, so editing
a venue in Club Settings stranded `address_line_1`/`town`/`county`. Both
signatures were **dropped and replaced** (never left as overloads PostgREST
would route to); `set_venue_address` is now the only writer, asserted
structurally.

**Club Settings now collects a structured address** — line 1, line 2, town,
county — matching what the wizard always collected, with manual entry preserved
(§21: a provider is never the only way in).

**A fixture's pitch must be at the fixture's ground.** The invariant already
existed *in the training path, in those words*; the fixture path had it in
neither writer, so changing a fixture's venue left last week's pitch — at the
other ground — attached. Closed in both writers, refusing rather than silently
clearing, because a pitch allocation is somebody's plan.

**§25 ID correlation.** All 22 foreign keys point at the right tables, so
"venue id used as pitch id" is structurally impossible. The one thing the schema
cannot express is the cross-row correlation, which is the defect above.

## 12–13. Teams and setup completion

Unchanged. There is no `proposed_teams` table — proposals are a `jsonb` column on
the claim, seeded exactly once by `decide_club_claim`, the only caller of
`seed_teams_from_proposal`. Setup's step 3 lists and confirms; it does not seed,
so §28's duplicate-seeding concern has no path to occur. Removal already scans
`pg_constraint` rather than a hand-kept list and folds anything with history.

## 17. Migrations and backfill

Six, `20270508000000` … `20270513000000`. One backfill: the derived venue
display line, recomputed by exactly the expression `set_venue_address` uses —
deterministic, idempotent, and unable to invent an address. Measured 2 venues
repaired, 0 rows created or removed.

## 18–19. Clean boot and rehearsal

**Clean boot PASS** — the chain installs from empty and Step 6's objects are
correct *including what they revoke*, which is the class of migration that
passes on a database where the thing was never there.

**Rehearsal PASS** — six migrations one at a time from the current tip, each
dry-run in a rolled-back transaction first. Delta: `+1` `site_*` function, and
**no club, venue, pitch, team, fixture, profile, membership, role assignment or
administrator moved.** The rehearsal script was generalised from Slice 7e's
(`migration-rehearsal.sh`) rather than copied, and its measure widened to the
club-domain counts §49 asks for.

## 20. Persistent UAT world

Enriched, never rebuilt. The review club had a crest, a kit and three teams but
**no ground**, so every venue, pitch and address surface rendered empty. A new
`enrich` command adds a default ground with two pitches and a second ground with
one — **through `create_venue` / `set_venue_address` / `create_club_pitch` as the
review Club Admin**, not by direct insert. It is additive, idempotent, touches no
person, team or role, and never calls `down()`.

That choice is deliberate: Step 6 found that the seed files insert venue rows
directly and produce a row the product cannot produce, which was then read as a
product defect. The seeds were corrected too.

## 23. Test totals

| Gate | Result |
|---|---|
| **FULL PLATFORM + FULL BROWSER** | **5436 passed, 0 failed across 247 suites** |
| `club_venue_pitch_integrity` | 21 assertions (venue/pitch correlation + venue address authority) |
| `club_directory_privacy` | 19 assertions (L17) |
| `club_canonical_resolvers.test.mts` | 4 tests (logo and theme convergence guards) |
| `74-club-venue-and-address` | 15 assertions, real browser, 1440 / 390 / 320 |
| Isolated clean boot | PASS, including what the migrations revoke |
| Production-shaped rehearsal | PASS, 6 migrations one at a time |
| TypeScript · build · content standard · `diff --check` · lint · authority guards | clean |

**One caveat, recorded as ledger L18 rather than smoothed over.** Suite 62 failed
five assertions in one batch, then passed 18/18 standalone twice and 18/18 in the
next full batch. It is **not root-caused**; the suite now reports the route, the
refusal and whether the row landed, so the next occurrence is diagnosable.

## 24–26. Functionality

| | |
|---|---|
| **FUNCTIONS BEFORE** | **54** |
| **FUNCTIONS AFTER** | **54** |
| **FUNCTIONS LOST** | **0** |

Four moved; none lost. Detail and reasoning in the matrix.

## 27. Protected logo provenance — NEEDS OWNER REVIEW

Recorded at Step 6 start and **left untouched**. Neither file was modified,
restored, staged or written to.

| | `Ovalball Square Logo.png` | `Overball Logo Low Res.png` |
|---|---|---|
| size | 1,151,454 bytes | 1,140,858 bytes |
| mtime | 2026-09-09 23:32:50 BST | 2026-09-09 23:32:50 BST |
| SHA-1 (`git hash-object`) | `aca33ffc9812cb3e65f29232bb73140bdcced288` | `1a4f167526fec91375ac8f337f61feca0fd80fff` |
| SHA-256 | `fc5abb60b66f2bafe56de45a2cea6a0e9fa41d240068eff96f86c27f2bdb7e50` | `3f77df404a5a004e5a917ebd8424620b10ae0ebd8da4122f0e9fdae0f042cb30` |
| MD5 | `4315467b04a767cce05bb8e4c53402fb` | `f2be0801e71bb31738e85ce19fde886b` |
| git | untracked (`??`), never staged | untracked (`??`), never staged |

These do **not** match the previously recorded `be2bef0c…` / `bdd32248…`. The
mtimes predate this session by ten days and both files are untracked, so nothing
in Steps 4–6 could have changed them. The canonical protected-hash record has
**not** been updated, and no investigation involving replacing either file was
attempted.

## 28. Step 7 handoff

- Fixture Import, Fixture Search, Control Centre closure, away-card
  presentation, week/date slider, weather/postcode presentation, Match Centre
  back behaviour, Calendar team filtering, training-plan season occurrence UX,
  pitch-allocation split-square presentation, availability counts — all
  explicitly **not** pulled forward.
- Venue/pitch/team identity integrity **is** fixed here, as §61 requires.

## 29. Later-owned

Team cover photos, team-role redesign, parent availability UX, additional-parent
workflows, child duplicate approval, rewards, polls, Kudos.

Plus, carried from earlier steps and untouched: **L7** (contract half of the
legacy invitation retirement, waiting on Step 3 being live), **L11** (a deep link
dropped at sign-in, Identity/Auth 6b), **L15** (fourteen perimeter-manifest
consumer declarations belonging to other slices), and **S7-13** (a second
production Full Site Admin — owner action).

## 30. DEFERRED MANUAL REVIEW CHECKPOINT

The product owner reviews by hand, in Chrome, against the local stack. The
review club is enriched and ready:

```
node scripts/review-fixtures/step2-review-club.mjs report
```

`Step 2 Review RFC` — Claro Road (default, 2 pitches) and Pannal Playing Fields
(1 pitch), both with structured addresses and derived display lines.
