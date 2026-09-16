# Final Slice 4 closure audit

**This audit has two parts.** Part one was read-and-verify only, at the end of Slice 4I, and it found
three unfinished items. Part two records the FINAL CLOSURE PASS that closed them, and re-measures
every AA.3 row afterwards. Nothing below is inferred: every count was taken from the banked tree.

**Verdict: Slice 4 is complete.** No item Phase 2 assigns to Slice 4 remains unfinished. Everything
still standing is named below with its later owner, and each of those owners is an assignment Phase 2
or a prior slice made, not a deferral invented here.

The question it answers is the one the letter asks: **is every item Phase 2 assigns to Slice 4
actually done, and where something is not, is it assigned to a later slice by an approved decision
rather than merely deferred?**

---

## 1. AA.3 rows 4A–4I

| Row | Domain | Legacy AA.3 names | State |
|---|---|---|---|
| 4a | Family and players | `can_manage_player`, guardian branches of `is_site_admin` | **Done and closed.** `can_manage_player` is **retired outright** by the closure pass. |
| 4b | Teams and roster | `team.view` club default, `can_manage_team` roster uses, `team_permissions` writes | **Done.** `team.view` retired and the roster call sites migrated. No POLICY anywhere asks `can_manage_team` now; the helper's remaining bodies are non-roster questions and it opens with `is_site_admin`, so it travels with Slice 7. |
| 4c | Fixtures, requests, results, Planner, Import | `can_manage_club_fixtures`, `can_manage_fixture_side`, direct fixture writes | **Done and closed.** `can_manage_fixture_side` is canonical inside; `can_manage_club_fixtures` now decides nothing anywhere (0 policies, 0 bodies). |
| 4d | Competitions and tournaments | `can_organise_competition` role checks, `calendar.manage` tournament use | **Done and closed.** `can_organise_competition` is canonical inside; the eight remaining tournament functions were migrated by the closure pass. |
| 4e | Calendar, venues, pitches, training | role-string RPC checks, public training plans | **Done.** |
| 4f | Messaging and notifications | `staffs_team`, `is_messaging_staff`, Site Admin conversation read | **Done.** |
| 4g | Safeguarding and dispensations | per-officer override dependence, Site Admin thread read | **Done and closed.** The dispensation policy was migrated by the closure pass. |
| 4h | Club administration and finance | `is_club_admin` (24 policies) | **Done.** 24 → 0 policies. |
| 4i | Documents, partners, referrals, handover | `can_manage_document_library` role checks | **Done.** 6 → 0 policies; and 4i additionally took the 11 `is_club_admin` bodies and the 18 `can_manage_club_fixtures` bodies that J.5 and 4c assign to it. |

---

## 2. Every remaining legacy consumer, counted and owned

Measured against the banked tree. "Policies" means row-level policies; "bodies" means function bodies
other than the helper itself.

| Helper | Policies | Bodies | Owner | Why it is still there |
|---|---|---|---|---|
| `is_site_admin` | 76 | 63 | **Slice 7** | AA.3 says so in its own words, immediately under the table: *"Site-side `is_site_admin()` removal (140 policies) happens in Slice 7, alongside the Users & Access UI, domain by domain in the same order."* This is an assignment in the design, not a deferral by a slice. |
| `is_full_site_admin` | 14 | 30 | **Slice 7** | Same sentence. It is the narrower of the two site-admin helpers and retires with them. |
| `has_capability` | 86 | 60 | **per-domain, then Slice 10** | The legacy adapter. It answers through `capability_key_map`, so each row retires with the slice that owns its domain; the adapter's own removal is the end state the programme reaches at Slice 10. 77 rows remain — §4. |
| `can_manage_club_fixtures` | **0** | **0** | **closed** | The closure pass took 4G's policy and 4D's eight bodies; 4A's caller went with `can_manage_player`. It decides nothing anywhere. The definition is retained deliberately — see §5. |
| `can_manage_team` | **0** | 7 | **Slice 7** | AA.3 row 4b names "`can_manage_team` **roster uses**", and those are done. The closure pass took the dispensation policy, which was the last POLICY asking it anywhere. The helper opens with `internal.is_site_admin()`, so the remaining bodies cannot be finished before the Slice 7 site-admin pass. |
| `is_club_admin` | 0 | 3 | **4B (1), 4C (2)** | `internal.can_manage_team` (4b's), `internal.can_manage_club_fixtures` (4c's) and `public.request_fixture_restoration` (4c's). Zero policies anywhere in Ovalball. |
| `site_admin_role` | 0 | 6 | **Slice 7** | A site-profile reader; site-side. |
| `can_manage_document_library` / `can_view_document_library` | 0 / 0 | 2 / 2 | **done (4I)** | Both are canonical inside. The bodies are the object-storage predicate and the delete RPC, which the 4I matrix exercises by name. |
| `can_manage_player` | 0 | 0 | **RETIRED** | Dropped outright by the closure pass — same treatment 4F gave `staffs_team` and `is_messaging_staff`, and for the same reason. |
| `can_manage_fixture_side` | 2 | 6 | **done (4C)** | Not legacy: the helper is canonical inside, asking `fixture.fixture.edit` at team and club scope. AA.3 row 4c is satisfied by that. |
| `can_organise_competition` | 0 | 2 | **done (4D)** | Likewise canonical inside, asking `competition.edition.manage` with `site.competitions.manage` as its master. |
| `may_complete_player_profile` | 0 | 0 | **Slice 7** | A zero-caller helper, and AA.3 row 4a does **not** name it — row 4a names `can_manage_player` and the guardian branches of `is_site_admin`. Its body asks `internal.is_full_site_admin()`, so it travels with the Slice 7 site-admin retirement. `CLAUDE.md` still names it as the gender-recording authority, which is why it is not removed casually. |

### `can_manage_club_fixtures`, in full

4C's implementation report states the rule this audit applies: *"A helper is retired by the slice that
owns the meaning of the call site, not by whichever slice's grep happens to match it first — migrating
a training policy inside a fixtures slice would move a decision without anyone having reviewed the
decision."* It named 4D, 4E, 4F, 4G and 4I as the owners of the remainder.

4I took its eighteen. What is left:

| Remaining consumer | Owner | Reason |
|---|---|---|
| `player_team_dispensation_select` (policy) | **4G** | A dispensation is a regulatory judgement about a player, which 4C assigned to 4G explicitly. 4G migrated the safeguarding appointment and visibility surfaces and did not take this policy. **Deferred without a recorded decision — see §5.** |
| `internal.tournament_visible_row`, `public.check_tournament_participant_target`, `get_tournament_centre`, `invite_tournament_participant`, `reconcile_tournament_participant`, `remove_tournament_participant`, `respond_tournament_invitation`, `update_fixture_competition` | **4D** | Tournaments and competitions. 4C assigned these to 4D by name. **Deferred without a recorded decision — see §5.** |
| `internal.can_manage_player` | **4A** | A **zero-caller** helper: nothing in the database calls `can_manage_player` any more, so this is a dead body calling another dead-ish body. It decides nothing today, but a dead helper is a hazard because the next person who needs the answer may find it before they find the canonical resolver. **See §5.** |

---

## 3. The adapter rows, counted and owned

77 rows remain in `capability_key_map`, all of them resolvable to an ACTIVE canonical key
(`capability_catalogue_integrity` CI3 asserts this).

| Prefix | Rows | Owner |
|---|---|---|
| `site.*` | 15 | **Slice 7** — the site-side pass |
| `club.*` | 19 | 4A (`club.guardians.manage`), 4C (`club.roster.manage`, `club.teams.manage`, `club.training.manage`, `club.venues.manage`, `club.pitches.manage`, `club.logo.manage`, `club.news.manage`, `club.view`), 4G (`club.dispensation.*`, `club.transfer.safeguarding_*`), 4I's three are **retired** |
| `fixture.*` | 14 | **4C** |
| `team.*` | 11 | **4B** |
| `people.*` | 4 | **4A / Slice 7** |
| `messages.*` | 2 | **4F** |
| bare verb keys (`place_graduating_players`, `manage_player_dispensations`, `approve_player_dispensations`, `manage_fixture_callups`, `approve_fixture_callups`, `manage_mini_rugby_groups`) | 12 | 4B/4C/4G |

`bundle_legacy_parity` names all 49 intended default removals with a reason each, and asserts there
are exactly 49 — so no row can be dropped silently and none can be added without being explained.

---

## 4. What Slice 4 actually achieved

| | start of Slice 4 | end of Slice 4I |
|---|---|---|
| `is_club_admin` policies | 24 | **0** |
| `is_club_admin` bodies | — | **3** |
| `can_manage_club_fixtures` policies | 18 | **1** |
| `can_manage_club_fixtures` bodies | 57 | **9** |
| `can_manage_document_library` policies | 6 | **0** |
| `can_manage_player` policies / bodies | — | **0 / 0** |
| `is_site_admin` bodies | — | **63** (4I took 17, the closure pass 7 more) |
| `can_manage_club_fixtures` policies / bodies | 18 / 57 | **0 / 0** |
| `can_manage_team` policies | — | **0** |
| helpers dropped outright | — | **3** (`staffs_team`, `is_messaging_staff`, `can_manage_player`) |
| adapter rows | 80+ | **77** |
| intended default removals, each named with a reason | 0 | **49** |
| domain matrices | 0 | **9**, all deterministic and self-seeding |

The tree was also rebuilt from empty at the close: **473 migrations from an empty database**, then 22
authority suites totalling **1187 assertions**, 0 failures. One pre-existing defect surfaced there and
is recorded rather than fixed — `supabase/seeds/local_uat_parent_player.sql` cannot load into a clean
database, because it inserts a U12 team with no pathway and
`20261231000000_a_team_always_carries_its_pathway.sql` has refused that since December 2026. It is a
seed-file drift, not a schema fault, and it belongs to whoever next owns the local seeds.

---

## 5. The three items, closed

Migration `20270381000000_slice4_closure_canonical.sql`. Every mapping came from a Phase 2 table.

### 1. The dispensation read — 4G

`player_team_dispensation_select` carried five branches: the Safeguarding Officer's (canonical), the
site branch (canonical), and three that were not — `can_manage_team` on the source team, on the target
team, and `can_manage_club_fixtures` on the source club. That last one was **the final
`can_manage_club_fixtures` policy anywhere in Ovalball**.

Who may read a dispensation is who may act on one, so the three moved onto J.7 lines 471–472:
`fixture.dispensation.request` (CO, TM; CA, FS) and `fixture.dispensation.approve_team` (TM, TA),
hoisted through a new `internal.dispensation_team_ids()` shaped exactly like the
`internal.safeguarding_dispensation_team_ids()` beside it. 4G's separation of duties is untouched
because it is a **write** rule and this is a **read** change — `SA-Q7` asserts that a Team Manager who
can now see a dispensation still cannot decide the club stage.

One behavioural change, mandated: a **Fixtures Secretary** gains the read through the target team.
J.7 line 471 lists `CA, FS` for `fixture.dispensation.request`, and the Secretary already had the
source-club branch, so this makes the two ends consistent.

### 2. The eight tournament functions — 4D

Slice 4C recorded the rule and named 4D: *"A helper is retired by the slice that owns the meaning of
the call site."* 4D built the canonical model and verified it, but these eight never went through it.
They now ask `tournament.tournament.manage` (J.8 line 490) for the occasion,
`calendar.event.manage` at team scope for a side acting for itself — the mechanism
`internal.can_manage_tournament_entry` already uses — and `fixture.fixture.edit` for
`update_fixture_competition`, which is a fixture edit and not a tournament act at all.

The consent boundary is asserted structurally **in the migration** and behaviourally in the matrix:
inviting, reconciling and removing must name the host club and nothing else; responding must name the
participant's own club and team and must not consult the host. `CM-J3` proves the host cannot answer
for an invited club, and `CM-J9b` proves the host cannot remove a club that has already accepted —
consent, once given, is not the organiser's to withdraw.

One behavioural change, mandated: a **Coach** can no longer answer a tournament invitation for their
team. `tournament.tournament.manage` has no team bundle at all (J.8 line 490, asserted as `CM-A` and
`CM-J12`), and 4D's own `can_manage_tournament_entry` already excluded a Coach from entry management.
This applies that decision rather than making a new one.

### 3. `internal.can_manage_player` — 4A

Zero callers, zero policies, zero dependent objects — verified before the drop and asserted after it.
AA.3 row 4a lists it as legacy removed; 4a removed its call sites and left the body. **Dropped
outright**, which is exactly what 4F did with `staffs_team` and `is_messaging_staff` and for the
recorded reason: a zero-caller raw-role helper is still a hazard, because the next person needing the
answer may find it before they find the canonical one. No compatibility shim was put in its place —
`FA14b` asserts that nothing named like it appeared.

Its body lives on in `family_authority_matrix.sql` as a test-local `SECURITY DEFINER` function, so
4A's two historical shadow comparisons still measure the real legacy answer.

### Why `can_manage_club_fixtures` was NOT dropped, though it is now zero-caller

It reached 0 policies and 0 bodies as a **consequence** of item 2. Dropping it would be a fourth
action this letter did not authorise, and it is not the same case as `can_manage_player`: **ten
permanent test suites use it as a legacy comparison baseline**, so removing it means rewriting them.
AA.3 row 4c's "legacy removed" is satisfied by its call sites being gone, which is the same reading
applied to row 4b's "`can_manage_team` roster uses". Its definition travels with the test-baseline
cleanup at Slice 7/10.

## 6. The carried follow-up

`SECURITY_FOLLOW_UP_unverifiable_age.md` remains **open and unchanged**. No Slice 4 sub-slice touched
`internal.person_is_minor`, added an onboarding path or changed a membership transition, so the
question it raises — whether staff or sensitive authority can be reached through an identity whose age
cannot be established — is exactly where 4A left it. It is surfaced here because the letter requires
it to be visible **before** Slice 5, and Slice 5 owns external email-bound invitation and redemption,
which is the first place an unverified age would arrive from outside the club.

---

## 7. D-S4-2

Honoured throughout. Slice 5 still owns external email-bound safeguarding invitation and redemption;
no sub-slice built nomination-by-email, redemption or a second invitation mechanism. 4G built the
appointment state machine against **existing ACTIVE members only**, which is what D-S4-2 permits.
