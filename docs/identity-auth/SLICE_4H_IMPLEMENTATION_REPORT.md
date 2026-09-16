# Identity/Auth Slice 4H — Club Administration and Finance

Retires `internal.is_club_admin` from every policy AA.3 row 4h names, moves the finance domain off the
deprecated keys Slice 3 catalogued and nothing ever used, and implements the one prohibition in
section S that had no implementation at all. Four migrations.

Contract: Phase 2 **AA.3 row 4h**, section **S** "Club Admin boundary", design **J.3** (people,
membership and permission management), **J.4** (clubs), **J.5** (teams) and **J.13** (finance and
payment administration).

---

## 1. The exact contract

AA.3 row 4h names `is_club_admin` — 23 policies and 20 function bodies at ledger 465 — the matrix
`club_admin_authority_matrix.sql`, and ten owned tables. Every capability the replacements need was
already ACTIVE with exactly the bundles J.3, J.4, J.5 and J.13 specify. **4H adds no capability and
changes no bundle.** What changes is which code asks which question.

---

## 2. Two things were wrong, and only one was on the label

**`club.reporting.export` governed nothing.** ACTIVE in the catalogue since Slice 3 at AAL R, zero
callers in the database and none in the application. Section S's last prohibition is *"Export personal
data without R and event"*, and the export it should have been governing is the club player-movement
CSV: named children, the teams they moved between, their dispensation status and the governing-body
reference the club recorded. It asked `manage_fixture_callups` — a fixtures key at AAL A2 — and emitted
nothing. A club's roll of children could be taken out of Ovalball with no reason given and no trace
left.

`public.record_club_export` is the gate now: the capability, a required reason, and an
`export.generated` security event naming the kind and the row count. The fixtures check stays, because
it is what decides whether the person may see the data at all; the new gate decides whether they may
take it away.

**Twenty-six finance functions opened with a bare `internal.is_site_admin()`.** Every site-admin
profile could configure a club's subscription prices, exempt a member from an obligation, change who
pays, refund a payment, end a subscription, connect or disconnect the club's GoCardless account, and
start, pause or cancel the club's plan with Ovalball.

J.13 does not leave this to inference. The site-master column is **empty** for every acting key, the
one for `finance.payment.act` carries the reason in the table itself — *"(Site Admins never act on club
payments)"* — and the section closes with a hard prohibition that payment secrets are never accessible
to any Site Admin profile. So the site branch was **removed** from those keys rather than re-pointed.
Where J.13 does record a master — the two platform-billing keys and the finance read, which are
Ovalball's own commercial relationship with the club rather than the club's money — it became that
master.

---

## 3. Shape, not just key

`internal.is_club_admin(club_id)` is correlated: in a policy it runs once per row. Replacing it with a
correlated `internal.can(...)` would have kept that shape and made each call heavier — the mistake this
programme has now paid for in 4E, 4F and 4G. So the policies ask a set: `internal.club_ids_with(key)`,
caller-dependent and row-independent.

The candidate set **mirrors `internal.bundle_source`**, and that is the whole correctness argument. A
club-scoped key reaches a person by three routes and only three: an ACTIVE membership carrying a role
whose bundle holds the key, being a player with an ACTIVE place in one of the club's teams, or being
the ACTIVE guardian of such a player. Enumerating memberships alone was the convenient answer and would
have dropped every parent from every policy that uses this. CH-P asserts the set and the per-row
question agree, persona by persona, and CH-P2 is a guardian with no membership at all.

---

## 4. Four more things the gates found

**The shadow comparison caught the wrong site master twice.** The first draft gave
`club_memberships_select_scoped` the master of `people.membership.suspend` rather than of
`people.member.view` — which would have stopped a user-support Site Admin reading a club's roll, which
is most of what user support does. And `role_assignments_select` was about to widen from
Full-Site-Admin-only to every site profile; J.3 records `site.club_roles.manage` for that key, which
sits in `SITE_FULL` alone and preserves the old answer exactly.

**A cross-slice grant was missing.** `internal.has_site_capability` was not executable by `anon`, and
**44 policies targeted `to public` already call it** — installed by 4C, 4E and 4F. A signed-out visitor
reading a published club article evaluates `clubs_select` transitively through that article's own
policy, and would have got "permission denied for function" instead of the article. It had been working
by accident because `internal.is_site_admin`, what those policies all used to ask, happens to be
anon-executable. Both helpers are now granted to `anon`, which learns nothing from either: they resolve
through the canonical decision, which answers no without a session.

**The hoist was written the wrong way round.** `club_id = any (internal.club_ids_with(...))` is a plain
expression, and Postgres evaluates a stable function in one once per **row** even with a constant
argument — `EXPLAIN` showed it in the Filter beside two InitPlans that had been folded. The subquery
form is what the planner hoists.

**A mutant revealed a test calling a function that did not exist.** CH-D5 named a
`set_subscription_price` signature no function has, so it passed on "function does not exist" and would
have gone on passing if the authority inside had been deleted. It now calls a real finance RPC, and
asserts the Club Admin is *not* refused so the boundary is a boundary rather than a broken call.

---

## 5. Performance

| read | pre-4H | 4H |
|---|---|---|
| a 400-member club roll, as the Club Admin | ~21.5 ms | **~2.1 ms** |
| the same, with the hoist written as `= any (...)` | — | 47.5 ms |
| teams, and the whole club directory | 0.5 ms | 0.5 ms |

Ten times faster than before the slice. The club question is asked once per query instead of once per
row, and CH-P1 asserts the hoisted policy and the per-row question select the same rows for thirteen
personas.

---

## 6. Mutation testing

Ten mutants, **ten killed, no survivors**. **M10** is the one worth keeping: swapping the membership
policy's site master for a same-sized neighbour survived every behavioural test, because
`site.users.view` and `site.clubs.view` sit in exactly the same six bundles. It is killed by asserting
the key **by name** — which is what the contract actually fixes, and what will matter the moment those
two bundles stop being identical.

---

## 7. Release ordering, DERIVED

The new build requires `record_club_export` and `internal.club_ids_with`, both created here. The
previous build asks the eleven retired aliases on its club-settings and finance surfaces, so those tabs
hide for the length of the deploy — fail-closed, self-healing, no data effect, and the reason the app
half of this slice repoints those call sites. Its RPCs all keep working: same names, same signatures,
canonical gates. **Migrations first, then push.** C1-C7 measure both directions.

---

## 8. Evidence

| gate | result |
|---|---|
| `club_admin_authority_matrix.sql` | 79 assertions, CH-A … CH-P, deterministic and self-seeding |
| `club_admin_authority_races.test.mts` | 4 passed, three times, real concurrent sessions |
| browser suite 58 | 30/30 |
| shared harness, suite 51 | extended with N13 and N14; 36/36 |
| full banking battery | **4261 passed, 0 failed across 206 suites** |
| clean empty-database rebuild | 469 migrations from empty; 18 suites, 992 assertions; perimeter 11/11 |
| production-shaped rehearsal | 465 → 469 one at a time, each dry-run first; nobody's access changed; only data delta `audit` +13 |
| compatibility matrix | 7/7 |

`is_club_admin` policies **23 → 0**. PG-15 **124 → 100**. PG-16 **121 → 91**.

---

## 9. The unknown-age gate (programme §9)

**No.** 4H grants no role, changes no membership transition, adds no onboarding path and touches no age
check. `internal.person_is_minor` is untouched, and every authority this slice moves was already
reachable by exactly the same people through exactly the same memberships — the questions changed name
and shape, not who they answer yes to. The carried follow-up carries forward unchanged.

---

## 10. Stated limits

- **14 `is_club_admin` bodies remain**, and they are named: `can_manage_club_fixtures` (4c),
  `can_manage_team` (4b), and the eleven rollover, graduation, handover and tournament-team functions
  (4i). This slice did not take them to flatter its own number.
- **The source-team stage of `decide_player_dispensation`** still asks `approve_player_dispensations`.
  That is a fixtures question and AA.3 row 4c's; the club and governing-body stages beside it are
  canonical, and the retirement ledger asserts the residue is exactly one call so neither of 4H's
  stages can quietly revert.
- **`club.season_rollover.manage` and `club.guardians.manage` adapter rows stay**, because surfaces
  owned by 4i and 4a still ask them.
- **The `to public` role targeting on the ten tables is vestigial for direct reads** — anon holds no
  SELECT grant on any of them — but not for transitive ones, which is what made defect E reachable.
  Tidying the targeting is not this slice's, and CH-P5 pins the grant position so a later change is
  visible.
- **Carried programme debt is unchanged**: the unknown-age follow-up, the 4C `local_uat_parent_player`
  seed defect, the `training_centre_visibility` seedless-boot limitation, the Playwright prefix-cleanup
  concurrency hazard, the deliberately carried pitch-view boundary, `may_send_as`'s platform branch
  (Slice 7), and the club-level branches of the audience helpers — one of which, `is_club_admin` in
  `can_address_club_audience`, 4H has now closed.
