# OVALBALL — IDENTITY, AUTHENTICATION & AUTHORIZATION PROGRAMME
## SLICE 4 — IMPLEMENTATION REPORT

**Scope of this report:** sub-slice **4a (family and players)** plus the shared Slice 4 test harness, as you decided (D-S4-1). 4b–4i are not started. Nothing has been committed, pushed, deployed or applied to production.

---

### A. The Phase 2 Slice 4 contract
The full extraction is in `scratchpad/slice4/PLAN.md` §1–2.
- **Shape:** Slice 4 is nine sub-slices, 4a–4i. Each is one banked unit with one commit series and one production release, in AA.3 order.
- **Per domain:**
  - policies and database functions answer through `can_*`, not the legacy helpers;
  - the browser makes no direct table writes;
  - the legacy helper references for that domain are removed;
  - its domain matrix passes.
- **Tests required:**
  - the domain matrices, the helper-retirement shrink ledger and the two isolation matrices ("complete after 4i");
  - a shadow comparison against the old rules, and the AA.5 structural guards;
  - the browser suite `51-role-negative-smoke`.
- **4a specifically:** retire `can_manage_player` and the guardian branches of `is_site_admin`, add `family_authority_matrix`, the AN-7 hold UI and private account pictures (Z-12).

### B. What was built, per work package
| Work package | Delivered |
|---|---|
| 4a family and players | Migrations 352/353/354, app consumers, Site Admin family panel |
| Shared harness | Family, family-isolation and cross-club matrices; retirement ledger; role-literal and client-write guards; browser suites 46 and 51; family race tests |
| 4b–4i | Not started (D-S4-1). 4g follows your recorded decision D-S4-2 |

### C. Starting repository state
- `main` at `b44aef0` (Slice 3), 445 migrations.
- The two logo files were already untracked and have not been touched.

### D. Starting production state (read-only)
- **Migrations:** 445, latest `20270351000000`.
- **People:** 4 users; 1 active membership; 1 Club Admin role; 1 Full Site Admin.
- **Family:**
  - 2 players, both minors, none with their own login or missing a date of birth;
  - 2 active guardian relationships, 1 child with a team place;
  - 0 guardians of adult players, 0 link requests, 0 consent rows, 0 duplicate reviews.
- **Pictures:** the `avatars` bucket is public with 1 object, owned by an adult.
- **Catalogue and perimeter:** capabilities 239/184/55; 15 functions callable anonymously.
- **Preconditions for 352 all present:** the link-request shape check, the 3-argument `transition_guardian_relationship`, and both policies 353/354 drop.
- **Not yet present:** the notification type 352 adds. Its topic already exists.
- Saved in `scratchpad/slice4/preflight-prod.json`.

### E. Migrations added
Timestamps were checked against every migration on disk; none collide, and no live migration was edited.
1. **`20270352000000_family_player_authority`** (expand)
   - rewrites the family and player database functions onto `can_*`;
   - adds FR-6 (derived access ends at 18) and the staff player view;
   - adds the SELF_ADDED_CHILD request kind, the AN-7 hold notification and `get_person_family_relationships`.
2. **`20270353000000_family_player_policies`** (contract): the 4a table policies.
3. **`20270354000000_private_account_avatars`** (contract): makes the `avatars` bucket private with a scoped read policy.

### F. What the old code was doing
- **Before 4a:**
  - staff read the `players` table directly, including date of birth, through `can_manage_player`;
  - guardian decisions and gender recording used `is_site_admin` and role checks;
  - account pictures were public.
- **Pre-existing defect fixed:** `club/settings/resolve-nav-capabilities.ts` read its capability answers in the wrong order, so a Fixtures Secretary was shown the guardian settings. It now uses named checks.

### G. Boundary and deferrals
- **Not done, as required:**
  - password, TOTP and AAL work;
  - Site Admin Users & Access, impersonation, the context switcher;
  - mass rewrites of `is_site_admin`, non-Full Site Admin profiles in production;
  - fixture and competition work, historical audit rows, Slice 5.
- **4g** (safeguarding appointments) is banked under D-S4-2 and not implemented.

### H. Implementation decisions (PLAN.md §9)
- **D-4a-1:** staff see players only through `player_staff_view`: names and age grade, never date of birth. The Fixtures Secretary sees players through call-ups, never the family graph.
- **D-4a-2:** staff pages fetch their rows first, then names by id (`lib/players/staff-players.ts`).
- **D-4a-3 release order:** 352 → app deploy → 353 + 354.
- **D-4a-4:** with no season covering today, the staff view shows no age grade instead of failing.
- **D-4a-5:** suite 51 replays captured server actions.
- **D-4a-6:** four test cases added because mutants survived (section AE).
- **D-4a-7:** 352 re-applies cleanly.
- **D-4a-8:** list performance fixes (section AO).

### I. Schema and data model
- **New objects:**
  - the `player_staff_view` view;
  - the SELF_ADDED_CHILD request kind and its shape check;
  - `transition_guardian_relationship` gains a confidential flag;
  - the `guardian_relationship_changed` notification type;
  - about a dozen `internal.*` helpers (player scopes, family checks, staff rows, picture checks, the guardian-administration set).
- **No production data changes:** no backfill, and no existing rows are rewritten.

### J. State machines
- **Parent-added child:**
  - the relationship starts PENDING_APPROVAL, which gives no access;
  - the club approves, making it ACTIVE, or declines or it is withdrawn, which closes it and drops the pending place.
- **Relationship:**
  - ACTIVE → REVOKED: by the guardian themselves, the club (`family.relationship.remove`) or Ovalball;
  - ACTIVE ⇄ SUSPENDED: Ovalball only (`site.family.manage`, AN-7), and a reason is required.

### K. Capability integration
- All 4a database functions and policies answer through `internal.can` / `can_player_*`.
- FR-6 is enforced inside the canonical decision itself, with reason `ADULT_PLAYER` on rule 8.
- Server actions refuse early with `requirePlayerCapability` / `requireSelfCapability`; the database remains the authority.

### L. Catalogue changes
None. Every 4a key was already active from Slice 3 (239/184/55 unchanged).

### M. Scope and ceilings
- Staff authority is tied to the player's own club or team place.
- Authority at one of your clubs never answers for a player at another club (FA14b).

### N. Site Admin
- The family panel on `/admin/users/[id]` (put on hold, lift hold, end relationship, with reason and confidential flag) requires `site.family.manage`.
- No new `is_site_admin` authority and no blanket bypass.

### O. Club Admin
- Decides parent-added children and removes guardians at their club.
- Cannot place holds (FA5c, browser F7).
- Cannot approve a child they added themselves (FA14a).

### P. Team staff
- Coach, Team Manager and Team Administration see their team through the staff view, without date of birth.
- They cannot record gender, see a child's picture library (C9) or read the family graph.

### Q. Family and players
- A parent-added child waits for the club.
- Consent settings belong to the child's own guardian only.
- An adult player's guardian keeps the relationship row but gets no derived access (FR-6).
- A minor account cannot self-register as a player (FA14d).

### R. Safeguarding
- A confidential hold notifies only confirmed Safeguarding Officers.
- Other holds notify the child's other guardians (FR-5).
- No 4g work was done.

### S. Invitations and joining
- Replacement guardian invitations need `family.relationship.approve` at club level.
- Adding a child at a club needs an existing relationship or an invitation from that club. Club membership alone is not enough (FA8a).

### T. Signup and claim
- Adult self-registration: `player.self_register` plus the 18+ check.
- Player login claim: `player.account.link` plus the existing Phase 0 account binding.

### U. Email and notification
- One new notification type with a destination:
  - confidential holds go to `/club/settings/safeguarding`;
  - everything else goes to `/parent/children`.
- The catalogue guard test is updated.

### V. Token and code security
- No new tokens.
- Account pictures are served only through signed URLs that expire after an hour.
- No token appears in audit rows, security events or logs.

### W. Audit
- Relationship changes and gender recording write audit rows through the existing triggers.
- Consent decisions are an append-only log (existing design).

### X. Security events
- `guardian.suspended` and `guardian.restored` are recorded against the acting Site Admin (browser F6).

### Y. Perimeter and manifest
- The manifest now records:
  - the new `authenticated_internal` functions (including `administered_guardian_player_ids`);
  - the 4-argument transition function and `get_person_family_relationships`;
  - the staff view and the private `avatars` bucket.
- Anonymous function count stays at 15.

### Z. Compatibility adapters
- Database function signatures are unchanged, except that the transition function gains a defaulted argument.
- The old app keeps working on 352 (section AR).

### AA. Backfill
None required: production has no pending, adult-guardian or duplicate family data.

### AB. Production-shaped rehearsal
- **Data:** production's shape (4 users, 17 teams, 2 children, one placed, 1 adult-owned picture).
- **Method:** 352, 353 and 354 applied one at a time, checked after each.
- **Result:**
  - 0 errors;
  - guardians, players, roles, audit and security-event counts unchanged;
  - 0 notifications sent;
  - the owner keeps access to both children and their consent summary;
  - another user sees nothing.
- **Other checks:**
  - PG15 goes 149 → 140;
  - the bucket goes private only at 354;
  - all three migrations re-apply cleanly.

### AC. Attack tests
- **Matrices:**
  - `family_authority_matrix` 75 checks across 16 personas, including the shadow comparison;
  - `family_isolation_matrix` 83;
  - `cross_club_isolation_matrix` 87.
- **Browser 51 (replayed server actions):** captured from the authorised UI and replayed as every refused role:
  - consent, gender, child approval, guardian removal and hold were all refused with nothing changed;
  - the authorised replay then landed each time, proving the captured requests were real;
  - 12/12, three times.

### AD. Race tests
New `js/family_authority_races.test.mts`, 4/4 (three times on the clean database, once in the runner):
- **F1a/F1b:** a hold and a removal in both orders.
- **F2:** two Club Admins approving the same request: exactly one approval.
- **F3:** a guardian ending their own relationship while Ovalball places a hold: the ending stands.

### AE. Mutation testing
- **Database guards:** 17/17 killed. The first round killed 13/17. The four survivors exposed test gaps, now covered by FA14a–d:
  - requester approving their own request;
  - scope binding across clubs;
  - consent by an adult player's guardian;
  - minor self-registration with an adult date of birth.
- **JS guards:** 3/3 killed (a new client table write, a new role check, a grown role-literal count).

### AF. Idempotence and retry
- A double approval gives "already decided".
- A second hold is refused.
- Adding the same child again returns the existing request.
- Each migration runs in one transaction and all three re-apply cleanly.

### AG. Account enumeration
- Approving a request that doesn't exist and one you may not decide give the same message.
- An additional-guardian request answers PENDING whether or not the email has an account.

### AH–AJ. Regressions (Slice 3, Slice 2, Slice 1 / Phase 0)
All green inside the full runner.

### AK. Fixture, content and safeguarding regression
- All green inside the full runner.
- Regression browser suites 19, 20, 24, 25, 27, 30, 31, 39, 40, 42, 43, 44 and 45 are all green.

### AL. Full runner
**3594 passed, 0 failed, 193 suites.**

### AM. Clean boot
- **445 (HEAD):** 2836 passed, 41 failures that need seed data (seed is off in disposable databases).
- **448 (working tree):** 3114 passed, the same 41 failures and **no new ones**.
- The clean boot found a real defect: the staff view failed whenever no season covered today. It is fixed (D-4a-4) and guarded by FA1i.

### AN. Baseline comparison
- Tables 220 → 220; views 20 → 21; functions 910 → 925; policies 383 → 378.
- `is_site_admin` policies 134 → 125; anonymous functions 15 → 15.

### AO. Performance (K.5)
Old policy against new, on the same data (17 teams, 595 players):

| Query | Before 4a | After 4a |
|---|---|---|
| Club Admin player list | 205 ms | 18 ms |
| Fixtures Secretary player list | 362 ms | 25 ms |
| Coach team list | 21.1 ms | 23.3 ms (+10%, inside the 15% gate) |
| Parent reading players | 351 ms | 0.4 ms |
| Guardians (Club Admin / Coach / Parent) | 190 / 335 / 341 ms | 1 / 3 / 0.3 ms |

The first measurement showed the coach list at 20× slower. It was fixed before sign-off: capability decisions are now made once per team, and the cheap policy prefilter runs first.

### AP. TypeScript, lint, diff and build
- `tsc` clean.
- ESLint: 42 files, 0 errors, 1 warning. The warning (an unused `getSiteUrl` import) already exists at HEAD.
- `git diff --check` clean; the authority guards pass.
- `next build` succeeds in a scratch copy.

### AQ. Isolated browser UAT
- Playwright with disposable `uat.slice4a.*` identities.
- No personal Chrome, no real identities, and every run cleans up after itself.
- Suite 46: 27/27, three times.

### AR. Compatibility matrix
| App \ Database | 445 | 352 only | 353 + 354 |
|---|---|---|---|
| **Old app** | 10/10 | **10/10** | 7/10: staff see no player names; account picture fails |
| **New app** | 8/10: staff see no player names | **10/10** | **10/10** |

This proves the release order: 352 first, then the app, then 353 + 354.

### AS. Production read-only preflight
- Done (section D).
- Nothing written, no secrets or personal data printed, no production sign-in.

### AT. Migration and release order
1. Apply 352, with a dry run first, through the approved production-permission route.
2. Commit and push; the push is the deploy.
3. Verify production.
4. Apply 353, then 354, verifying after each.

### AU. Rollback and forward fix
- **Database:** forward fix only.
- **App rollback:**
  - safe while production is on 352 alone;
  - after 353 + 354 the old app loses staff player names and account pictures, so fix forward.
- Never restore the Site Admin bypass.

### AV. Changed paths
**36 modified files** (+406 / −156):
- app and lib consumers;
- `scripts/run-platform-tests.sh`, the perimeter manifest, three existing tests and the generated types.

**New files:**
- the 3 migrations;
- `family-actions.ts` and `family-relationships-panel.tsx`, `lib/players/staff-players.ts`;
- browser suites 46 and 51, `scripts/security/`, `verify-authority-guards.mjs`, the role-literal baseline;
- 4 SQL suites and 3 JS tests.

### AW. Protected assets
- Both logo hashes match (`be2bef0c…`, `bdd32248…`) before and after.
- Nothing is staged.

### AX. Remaining legacy consumers (retirement ledger)
- **References in policies / function bodies:**
  - `is_site_admin` 125/160, `has_capability` 98/125, `is_full_site_admin` 15/46, `is_club_admin` 23/25;
  - `can_manage_club_fixtures` 20/57, `can_manage_team` 9/29, `is_active_player_guardian` 7/14, `is_own_linked_player` 9/9;
  - these belong to 4b–4i.
- **Retired to zero:** `can_manage_player`, `may_complete_player_profile`.
- **UI only:** the Player Access and Details pages still decide whether to show their form from the session's guardian list and `isSiteAdmin`; the database stays the authority.

### AY. Deferred later-slice work
- 4b–4i in AA.3 order.
- The isolation matrices complete after 4i.
- 4g per D-S4-2; external nominees in Slice 5.

### AZ. Risks and open decisions
1. **Pre-existing, not fixed:** a guardian whose child has no team place yet sees no gender form on the Player Details page (the database would allow it).
2. **Pre-existing:** calendar hydration errors in the dev log.
3. Production migrations need permission approval again; they must not be bypassed.
4. Once 354 lands, any cached public picture URL stops working. The app no longer creates any.

### BA. Repository state
- `main` at `b44aef0`.
- 36 modified and 20 untracked paths (including the two logos).
- Nothing staged or committed; disposable stacks stopped.

### BB. Verdict
**IDENTITY/AUTH SLICE 4 — READY FOR PRODUCTION RELEASE**, for sub-slice 4a (family and players) plus the Slice 4 harness, as scoped by D-S4-1. 4b–4i have not been started.

No commit, push, deploy or production migration was made. Slice 5 was not started. Stopping here for review.