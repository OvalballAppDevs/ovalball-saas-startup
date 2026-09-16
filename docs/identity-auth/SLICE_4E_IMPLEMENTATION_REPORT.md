# Identity/Auth Slice 4E — Calendar, Venues, Pitches, Training

**Phase 2 AA.3 row 4e**, design J.9 lines 496–507, carrying the **U** "venues RLS/RPC mismatch"
closure and the **V** volunteer boundary. Club events, venues, pitches, pitch allocation and
training now resolve through `internal.capability_decision`.

---

## 1. The exact contract

AA.3 row 4e retires **"role-string RPC checks, public training plans"**, with the matrix
`venue_training_authority_matrix.sql`.

**The role-string checks, found exactly.** The four venue RPCs gated on `internal.is_club_admin(club)`
— a raw membership-role helper — while the venues RLS gated on `club.venues.manage`, which CA *and*
FS hold. A Fixtures Secretary could change a venue row through one door and was refused the same act
at the other. That is the U section's "venues RLS/RPC mismatch", and J.9 line 500 settles it:
`venue.venue.manage` is CA and FS, one authority for one resource. The five pitch RPCs had the same
shape, borrowing 4C's `can_manage_club_fixtures` — a real gate answering a different question, the
species of mistake 4D found in `can_organise_competition`.

**"Public training plans" was already closed, and is now asserted.** Slice 1's perimeter migration
removed anon's grants on training plans, sessions, schedule rules, events and pitches. 4E does not
redo that; it pins it permanently and closes what Slice 1 left behind — those tables' policies still
said `true`, so every *signed-in* account could read every club's training and venues.

**The catalogue was already correct.** All eleven J.9 keys exist, ACTIVE, with the scopes and
bundles J.9 specifies. 4E adds no capability and changes no bundle.

---

## 2. Four intended changes, from an 80-pair shadow comparison

**1. A Fixtures Secretary may now manage a venue** — the U closure above.

**2. An ordinary club Member may no longer see training sessions or plans.** J.9 line 504 gives
`training.session.view` to CA and FS at the club and CO, TM and PL at the team, with PG at the
child; MB is absent and the key is safeguarding-sensitive. A training session is a standing record
of where named children will be on a given evening. A club **event** is deliberately unaffected —
`calendar.event.view` does include MB, because a club event is not a child's timetable.

**3. Another club, or a signed-in stranger, may no longer read this club's venues.** `venues_select`
was `true`. The obvious thing this could break is an away fixture at the opposition's ground, and it
was measured rather than hoped: `update_fixture_venue` refuses unless the fixture is a **home**
fixture and the venue belongs to that fixture's own club, so a visiting club never resolves another
club's venue row.

**4. Site support gains venue and training management** through the explicit site masters J.9 names,
where the legacy gates gave it no route at all. A declared widening, by named capability.

---

## 3. A Slice 4D remnant that blocked this slice

Four RPCs still decided **tournament** authority with the deprecated `calendar.manage`:
`save_tournament`, `add_tournament_team_entry`, `get_tournament_centre`, `update_tournament_venue`.
They are AA.3 row **4d**; 4D's retirement assertion missed them because it checked the function list
4D declared rather than the contract's wording.

4E could not retire the `calendar.manage` adapter while they held it, so their authority gates are
closed here on J.8 line 490's already-defined behaviour, together with two bare `is_site_admin()`
bypasses found beside them. Nothing else of 4D's is touched — `get_tournament_centre`'s remaining
`can_manage_team` call filters which pending invitations to *display*, is not an authority gate, and
is left with its owner.

---

## 4. Performance: the per-row resolver, a third time

Reading one club's 800 training sessions as its Club Admin:

| | |
|---|---|
| pre-4E (raw membership read) | 46.7 ms |
| 4E gate, called per row | **106.9 ms** — a real 2.3× regression |
| 4E gate, sets hoisted | **0.9 ms** |

The first hoist was not enough, and the reason matters. `training_plans` stayed linear — 6.6 ms for
50 rows, 53.8 ms for 400 — until the plan was read rather than guessed at. It showed the filter
beginning with `internal.can_manage_training(...)` and both hoisted SubPlans *"never executed"*:
`training_plans_write_scoped` is a **FOR ALL** policy, so its `USING` is OR'd into every SELECT. It
had never surfaced because `training_plans_select` was `true` — **enforcing a read that was
previously unenforced is what exposed it.** Hoisting the manage sets brought 400 plans to 1.1 ms.

A guess was tried and rejected on evidence first: raising the family helper's planner `COST` changed
nothing, because the family helper was never the cost.

---

## 5. What the battery caught

Eleven failures across eight suites, every one a genuine consequence:

* **`authority_helper_retirement`** — the Slice 4C lesson repeating. `training_family_visible_row`
  was introduced to carry the Slice 4A family branch for the policies while
  `training_session_visible_row` still held its own copy, so 4A's counters saw each call site twice
  and read one over their ceilings. The helper now delegates instead of repeating.
* **`security_perimeter_guard`** — `public_venues` is an owner-rights view readable by anon, which P4
  forbids outside the deliberately public list. It joins that list, which is its whole purpose.
* **`bundle_legacy_parity`, `backfill_verification`** — 10 further legacy role defaults disappear with
  the calendar adapter, so the intended-removal list goes 17 → 27, each named with its reason.
* **`capability_catalogue_integrity`** — 72 → 70 pre-Slice 3 keys still resolvable.
* **`capability_override_ceilings`** — its "legacy names accepted" case used `calendar.manage`, which
  is no longer a legacy name that resolves; it now uses `club.edit_profile`, which still is, so the
  coverage is kept rather than deleted.
* **`training_centre_visibility`** — its "a member of the owning club sees the session" case used a
  persona *named* `v_coach` that was seeded as a bare `BASIC_USER` with no team permission, so it was
  really asserting club-wide visibility. It is now an actual coach, with an ordinary member seeded
  alongside to assert the narrowing. More coverage than before, not less.

---

## 6. Release ordering: neither pure order is safe

4E is the first slice in this conveyor to **retire a legacy capability adapter**, so the old build's
question stops resolving the moment the migration lands. Measured in both directions:

```
OLD BUILD, NEW DB   calendar.manage(CA)=f   club.training.manage(CA)=t   club.venues.manage(FS)=t
NEW BUILD, NEW DB   calendar.event.manage(CA)=t  training.plan.manage(CA)=t  venue.venue.manage(FS)=t
```

* Migrations first → the deployed build loses the club-events controls and the anonymous venue name.
* Application first → the new `/competitions/[slug]` reads `public_venues`, which would not exist.

So the contract migration was **split**, and the slice releases in three stages:

| Stage | Action | Why |
|---|---|---|
| A | `20270364000000` + `20270365000000` | Purely additive. Gates become canonical, `public_venues` appears; the running build neither knows nor needs either. |
| B | Deploy the application | It asks the canonical keys and reads `public_venues`, both provided by Stage A. |
| C | `20270366000000` | Revokes anon on `venues`, narrows the reads, closes the 4D remnant, retires the adapter — safe only once B is live. |

`club.training.manage`, `club.venues.manage` and `club.pitches.manage` keep resolving throughout:
`has_capability` passes an unmapped key straight to the canonical decision and those keys still
exist. Only the two calendar keys had adapter rows, which is why Stage C's blast radius is two
surfaces rather than the whole domain.

---

## 7. Evidence

| Proof | Result |
|---|---|
| Full platform battery | **3938 passed, 0 failed, 201 suites** |
| `venue_training_authority_matrix` (new) | **87 assertions** |
| `venue_training_authority_races` (new) | 4/4, three consecutive runs |
| Mutation testing | **7 mutants, 7 killed, 0 survivors**, clean restore |
| `authority_helper_retirement` | 46 assertions, every ceiling at the measured floor |
| Browser suites 51 / 52 / 53 / 54 / 55 | 21, 17, 14, 22, **20** — three passes, all fifteen runs green |
| Clean boot from empty | 459 migrations, tip `20270366000000`, all suites 0 failed |
| Production-shaped rehearsal | seeded data identical but for 4 audit rows, each accounted for |

### Retirement, monotonic

`has_capability` 121 → **104** bodies, 98 → **92** policies · `is_site_admin` 144 → **136** bodies ·
`is_club_admin` 25 → **21** bodies · `can_manage_club_fixtures` 41 → **35** bodies ·
`can_manage_team` 20 → **19** · **PG16 143 → 135** · PG15 130 unchanged · the `calendar.manage` and
`calendar.view` adapter rows **retired**. Nothing increased.

---

## 8. Stated limits

**`club_pitches_select` stays `true` for signed-in readers.** J.9 defines `venue.pitch.manage` and
`venue.pitch_allocation.view/manage` but **no pitch-view key**, and anon already holds no grant on
the table. Narrowing a read the design does not scope would be inventing product surface inside a
migration. Recorded for whichever slice owns it.

**`training_centre_visibility` cannot run on a seedless database.** It errored on the clean boot with
a `scheduling_groups.season_id` not-null violation, in seeding untouched by this slice. It is a
pre-existing environment-dependent suite, so it was removed from the clean-boot list and recorded
rather than repaired here. The 4E matrix itself was fixed when the same boot exposed the same class
of defect in it — it now seeds its own season.

**The §9 unknown-age check is NO.** 4E grants no role, changes no membership transition and touches
no onboarding path; every change narrows a read or unifies two existing answers. The follow-up
carries forward unchanged.
