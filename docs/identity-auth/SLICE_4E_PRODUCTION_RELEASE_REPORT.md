# Identity/Auth Slice 4E — Production Release

**Commit `f78de26`.** Fast-forward `d882bb7..f78de26` on `main`. Released 16 September 2026.

---

## 1. What was released

Club events, venues, pitches, pitch allocation and training now resolve through
`internal.capability_decision`. Eight gates and nineteen RPCs move onto `internal.can`, the venue
and pitch RPCs stop deciding authority by membership role string, the training and venue reads stop
being world-readable to signed-in accounts, and the `calendar.manage` / `calendar.view` legacy
adapter rows are retired.

Twenty-eight files: three migrations, nine application files, the platform runner, the perimeter
manifest, nine test suites, two browser suites, the generated types and the programme documents.
The two protected logos remained untracked and unstaged throughout, SHA-1s unchanged —
`be2bef0c978869aaa73e474cd5abdf5aec1fff6c` and `bdd3224871f0561d971f93f519764f0502092504`.

---

## 2. A three-stage release, ordered by evidence

4E is the first slice in this conveyor to **retire a legacy capability adapter**, so the old build's
question stops resolving the moment the migration lands. The compatibility matrix measured both
directions and found that **neither pure order is safe**:

```
OLD BUILD, NEW DB   calendar.manage(CA)=f   club.training.manage(CA)=t   club.venues.manage(FS)=t
NEW BUILD, NEW DB   calendar.event.manage(CA)=t  training.plan.manage(CA)=t  venue.venue.manage(FS)=t
```

* Migrations first → the deployed build's `hasCapability('calendar.manage')` reads FALSE, so a Club
  Admin loses the club-events controls, and `/competitions/[slug]` loses venue names once anon's
  grant on `venues` goes.
* Application first → the new `/competitions/[slug]` reads `public.public_venues`, which would not
  exist yet.

So the contract migration was **split** and the slice released in three stages, each dry-run first,
with the held-back migration kept in an isolated stage directory so only the expected migration
could travel.

### Stage A — additive
```
DRY RUN: Would push these migrations:
 • 20270364000000_calendar_venue_training_authority_canonical.sql
 • 20270365000000_public_venue_projection.sql
```
Applied. Both domains returned 200 afterwards: the build then serving neither knew nor needed either.

### Stage B — deploy
`git push origin main` → `d882bb7..f78de26`. Confirmed live **80 seconds** later on two independent
markers, not assumed: `/login` etag `1d5a0b4c…` → `78ea2c5b…`, chunk set `48a53593…` → `8a7380b8…`.
Both domains 200.

### Stage C — contract
```
DRY RUN: Would push these migrations:
 • 20270366000000_calendar_venue_training_policies_canonical.sql
```
Applied. This is the migration that revokes anon's grant on `venues`, narrows the reads, closes the
Slice 4D remnant and deletes the calendar adapter rows. It carries `DO` blocks that raise if anon
keeps a column grant on `venues`, if anon cannot read `public_venues`, if a consumer of the retired
keys survives, or if the adapter rows remain. It completed without error, **so all of those
assertions passed inside production.**

---

## 3. Production state

```
rows 459 · applied remotely 459 · remote tip 20270366000000 · pending: none
20270364000000: APPLIED   20270365000000: APPLIED   20270366000000: APPLIED
```

`supabase db diff --linked` reports:

```
No schema changes found
```

The live schema is exactly the one the 3938 assertions and the clean boot ran against — every
function body, every policy expression, every grant. No drift, no partially-applied object.

---

## 4. Verified in production, and what is not

**Verified in production.** All three migrations applied in the intended order, each after a dry run
that proposed only the expected file. Their embedded assertions — the anon grant state on `venues`,
anon's read of `public_venues`, the absence of any surviving consumer of the retired keys, and the
deletion of the adapter rows — passed *there*. The live schema is identical to the tested tree. The
new build is live on both domains and serving. The repository is closed at `f78de26` with nothing
uncommitted but the two protected logos, whose hashes are unchanged.

**NOT OBSERVABLE ON CURRENT PRODUCTION DATA.** Every per-persona authority distinction — the four
intended changes, the venue and training refusals, the club-event/training split. Observing them
needs signed-in identities holding particular roles at particular clubs, and production has one club
with one active membership. No identity was created to change that: putting fabricated people into a
real club's records to improve a report would be the wrong trade. They are proven instead on the
local and clean-boot databases, where the matrix seeds its own people — 87 assertions, plus 7 killed
mutants and 15 green browser runs against real authenticated sessions.

**Also not observable.** The anonymous venue projection could not be probed live: no production anon
credentials exist in the working tree, and obtaining them is not something this release needed. The
anon grant state was asserted *inside* production by the migration instead, which is stronger than
an external probe for the specific question of who holds what. `/competitions/<slug>` returns 404
for a non-existent slug, and production holds no published competition edition, so the public venue
name path is proven on the clean boot rather than live.

---

## 5. Evidence

| Proof | Result |
|---|---|
| Full platform battery | **3938 passed, 0 failed, 201 suites** |
| `venue_training_authority_matrix` (new) | 87 assertions, self-seeding |
| `venue_training_authority_races` (new) | 4/4, three consecutive runs |
| Mutation testing | 7 mutants, **7 killed, 0 survivors**, clean restore |
| `authority_helper_retirement` | 46 assertions, every ceiling at the measured floor |
| Perimeter manifest | 11/11 |
| Clean boot from empty | 459 migrations, tip `20270366000000`, all suites 0 failed |
| Production-shaped rehearsal | seeded data identical but for 4 audit rows, each accounted for |
| Browser suites 51–55 | 21 / 17 / 14 / 22 / 20 — three passes, **all fifteen runs green** |
| Performance | training read 46.7 ms → **0.9 ms** |
| `tsc` / `eslint` / `git diff --check` | clean |

### Retirement: 4E-owned, and global

**4E-owned, before → after.** venue RPCs `is_club_admin` **4 → 0** · pitch RPCs
`can_manage_club_fixtures` **5 → 0** · training RPCs `club.training.manage` **10 → 0** ·
`venues_select`/`training_plans_select`/schedule-rules `true` **3 → 0** · calendar adapter rows
**4 → 0**.

**Global Slice 4 footprint.** `has_capability` 121 → **104** bodies and 98 → **92** policies ·
`is_site_admin` 144 → **136** bodies · `is_club_admin` 25 → **21** bodies ·
`can_manage_club_fixtures` 41 → **35** bodies · `can_manage_team` 20 → **19** ·
**PG16 143 → 135** · PG15 **130** unchanged. Nothing increased.

### Audit and integrity

The rehearsal's only data delta was `audit 2859 → 2863` — exactly the four `capability_key_map`
deletions, verified by querying those audit rows rather than inferred from the count. No club,
person, venue, plan, session or event row changed. Audit and security-event immutability suites pass
in the battery.

---

## 6. Risks and deferrals

**`club_pitches_select` stays `true` for signed-in readers.** J.9 defines no pitch-view key and anon
already holds no grant. Narrowing a read the design does not scope would be inventing product
surface inside a migration. Recorded for its owner.

**`training_centre_visibility` cannot run on a seedless database** — it errors on
`scheduling_groups.season_id` in seeding this slice never touched. Pre-existing and
environment-dependent, so it was removed from the clean-boot list and recorded rather than repaired
here. The same clean boot exposed the same class of defect in 4E's *own* matrix, which was fixed: it
now seeds its own season.

**Carried forward unchanged:** the unknown-age follow-up (4E's §9 answer is **NO** — it grants no
role, changes no membership transition and touches no onboarding path); the 4C
`local_uat_parent_player` seed defect; the shared Playwright prefix-cleanup hazard (the suites must
not be run concurrently with themselves, and were not); later Slice 4 ownership; and Slice 5
invitation work. D-S4-2 remains preserved for 4G.

---

## 7. Verdict

**IDENTITY/AUTH SLICE 4E — PRODUCTION VERIFIED**

4f–4i are not started. Next in order is 4f (Messaging and notifications). 4g remains banked under
decision D-S4-2 and is not to be implemented ahead of its turn. Slice 5 is not started.
