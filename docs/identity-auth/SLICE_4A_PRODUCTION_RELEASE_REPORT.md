# OVALBALL — IDENTITY, AUTHENTICATION & AUTHORIZATION PROGRAMME
## SLICE 4A — PRODUCTION RELEASE REPORT

### A. Release authorization and scope
Slice 4A (family / players) plus the reviewed shared Slice 4 harness, released under your authorization. D-S4-4 was applied unchanged. 4b was not implemented, 4g untouched, Slice 5 not started, no unrelated repairs.

### B. Starting repository state
`main` = `origin/main` = `b44aef0`, nothing staged. Migration hashes matched the reviewed report exactly:
- 352 `fb56dcd60384f059c971fdeefe5762bec9df0597`
- 353 `0ff524d3d3144139e2aa882f1344682a839b3d05`
- 354 `7793db57f5aa5c5d0272c444a8c8bea492232ed0`

### C. Starting production state
- **Code:** `b44aef0`, confirmed from the deployment's own build log, aliased to ovalball.co.uk and www.
- **Database:** 445 migrations, tip `20270351000000`. No concurrent migration or deployment had appeared.
- **Shape:** 4 users and profiles, 1 active membership, CLUB_ADMIN:ACTIVE ×1, 1 Full Site Admin, 2 active guardians, 2 players (both minors), 1 active team place, 1 club, 17 teams, 278 fixtures.
- **Perimeter:** 220 tables, 20 views, 879 functions, 383 policies, `is_site_admin` policies 134, pg15 149, pg16 162, anonymous functions 15, browser TRUNCATE 0.
- **Pictures:** avatars bucket public with 1 object (adult-owned); player-avatars private, empty.
- Capabilities 239/184/55, 18 bundles, 418 entries, 106 keymap, 0 overrides, 0 site grants/requests. Audit 7490, security events 0, notifications 8. Maintenance unset, append-only triggers 6.

### D. Release content audit
57 paths staged: the 3 migrations, 4a app and lib code, the Site Admin family panel, the staff-player reader, the harness scripts and guards, 8 test files, the perimeter manifest and regenerated types. The types diff contains only 4a objects.
- Excluded: both protected logos, all scratch evidence, disposable release material, anything 4b–4i.
- `git diff --cached --check` clean. Secret and personal-data scan found nothing (no keys, no tokens, no real emails — only `@ovalball.test`).
- Guards: content standard, Match Centre, authority guards, notification catalogue and the rest pass. `verify-admin-nav` and `verify-auth-security` each fail one check, identically at HEAD (pre-existing, not in the runner). `verify-legal-routes` needs a running local server and was not run.

### E. Protected assets
Verified before and after; never staged or modified:
`be2bef0c978869aaa73e474cd5abdf5aec1fff6c` · `bdd3224871f0561d971f93f519764f0502092504`

### F. Migration preflight
Each stage directory was built to hold the chain only up to its own migration, so a push could not carry a later one. Each was dry-run first and proposed exactly one migration.

### G. Stage A — migration 352
Dry run proposed only `20270352000000_family_player_authority.sql`. Applied through the approved route; no bypass was used and no permission was denied.
**Verified:** ledger 446, tip `20270352000000`; staff view present; transition signature 4 arguments; SELF_ADDED_CHILD kind check; notification type registered; functions 879 → 891; views 20 → 21; pg16 162 → 159; policies, `is_site_admin` count, capabilities, overrides, site grants, anonymous functions (15) and browser TRUNCATE (0) unchanged; every data count unchanged; audit 7490, security events 0, notifications 8 — no growth, nothing fabricated.
**Fingerprints matched the clean-boot build exactly:** 43 functions `1daab2ef…`, 3 picture policies `6bb9ee35…`, the view `ea1c2303…`, 9 constraints `ea8439b1…`, notification type `account_security`.

### H. Old app + 352 compatibility gate
- Signed-out regression on the live old app: **56/56** across 1280px and 390px.
- Anonymous API probes: **36/36**.
- Database logs for the window: only my own deliberate probe refusals.
- One initial FAIL was my test's expectation, not the app: signed out, `/fixtures` is deliberately rewritten to the public fixtures page (`lib/supabase/middleware.ts`). Corrected and re-run green.

### I. Release commit
`909f5be494a72a400eeecb473cb157f6db99cbde` — "feat(authorization): move family and player authority to the canonical capability decision". 57 files, +6225 / −175. No Claude attribution. No history amended.

### J. Push and deployment
`git push origin main`, fast-forward `b44aef0..909f5be`. Deployment built from commit `909f5be`, reached READY, and carries the production aliases ovalball.co.uk and www.ovalball.co.uk (both HTTP 200).

### K. New app + 352 gate
- 353 and 354 confirmed absent; players policy still the legacy one; the 353/354 helpers absent; bucket still public.
- Signed-out regression on the new app: **56/56**. Anonymous probes: **36/36**.
- Canonical semantics: the guardian's child keys allowed by rule 6 ROLE_BUNDLE; an unrelated person DEFAULT_DENY; a person with no membership has no club key; the Site Admin's site keys come from rule 7 SITE_CAPABILITY.

### L. Migration 353
Dry run proposed only `20270353000000_family_player_policies.sql`. Applied.
**Verified:** ledger 447; fingerprints match (2 functions `51535882…`, 7 policies `74f55fe4…`); policies 383 → 378; `is_site_admin` policies **134 → 125**; pg15 149 → 140; the pending-roster policy gone; `can_manage_player` and `may_complete_player_profile` references **0**; anonymous functions 15; browser TRUNCATE 0; all data, audit, security-event and notification counts unchanged. Anonymous probes 38/38; public pages 200.

### M. Migration 354
Dry run proposed only `20270354000000_private_account_avatars.sql`. Applied.
**Verified:** ledger 448; fingerprints match (2 functions `75174f25…`, 1 policy `ec1371b1…`); bucket **private**; `avatars_select_public` gone; remaining picture policies are self-scoped plus `avatars_select_scoped[SELECT]` to `authenticated`; the 1 existing object intact; 0 stored URLs.

### N. Final migration ledger
**448 / `20270354000000`** — exactly the three Slice 4A migrations, applied one at a time.

### O. Final schema and perimeter
Tables 220 (=), views 20 → 21, functions 879 → 895, policies 383 → 378, `is_site_admin` policies 134 → **125**, pg15 149 → **140**, pg16 162 → **159**, anonymous functions **15** (=), browser TRUNCATE **0** (=). Capabilities 239/184/55, bundles 18, entries 418, keymap 106, overrides 0, site grants 0, grant requests 0 — all unchanged. Every change is accounted for by the three migrations.

### P. Helper-retirement ledger (production)
`can_manage_player` **0/0** and `may_complete_player_profile` **0/0** — retired. Remaining, assigned to 4b–4i and deliberately untouched: `is_site_admin` 125/160, `has_capability` 98/125, `is_full_site_admin` 15/46, `is_club_admin` 23/25, `can_manage_club_fixtures` 20/57, `can_manage_team` 9/29, `is_active_player_guardian` 7/14, `is_own_linked_player` 9/9, `can_organise_edition` 8/1, `can_manage_document_library` 6/2, `can_manage_fixture_side` 3/6, `can_manage_club_fixtures_or_any_team` 2/0, `staffs_team` 0/3, `can_organise_competition` 0/2, `is_messaging_staff` 0/0.

### Q. Capability and authority verification
Every decision came from the canonical resolver. Site Admin site keys resolve at rule 7 SITE_CAPABILITY; no blanket bypass exists. The one production Site Admin is also that club's Club Admin and a guardian, so their club-level family key resolves from their own role bundle (rule 6), not from being Site Admin — confirmed by the contrast that a person with no membership is refused the same key at the same club.

### R. Family and player verification (as the real people, read-only)
- **The club admin / guardian:** 2 players, 2 guardian rows, 1 staff-view row, 0 link requests, 0 consent rows.
- **A signed-in person with no club and no child:** 0 players, 0 guardians, 0 staff-view rows, own profile only.
- `player_staff_view` carries no date of birth, login id or recorded gender.

### S. FR-6 verification
Production has **no adult player and no guardian of an adult player**, so FR-6 cannot be exercised on real data. The production build of the deciding function is byte-identical to the build where FR-6 is proven (fingerprint match), and it is covered by the matrix, mutation testing and the rehearsal. Recorded as a probe that production's current state cannot demonstrate.

### T. Site Admin verification
`site.family.manage` and `site.users.view` allowed at site scope through rule 7; no club-scope key granted by Site Admin status; the family panel's RPC requires the site capability.

### U. Club Admin verification
`family.relationship.approve` allowed at their own club (rule 6) and refused elsewhere; guardian administration reads the once-per-query set added by 353.

### V. Staff verification
Staff see players only through the projection: the one staff-view row is the placed child, by name and age grade.

### W. Private account pictures — D-S4-4
- Bucket private; the public endpoint now answers "Bucket not found" (probed with a non-existent path — no real object path, URL or token was used or printed).
- Anonymous: cannot list (0 objects), cannot sign, cannot read; the policy is `TO authenticated` only.
- **Adult (the real object's owner):** visible to signed-in people — as locked. A signed-in person with no club and no child sees exactly that 1 account picture and no child pictures.
- **Minor:** production has no minor account picture. The deciding function is fingerprint-identical to the build where the minor rule was proven end-to-end in the rehearsal (minor, guardian, own team's coach and Club Admin allowed; another team's coach, unrelated adult and anonymous refused; signed URLs expiring).
- Child pictures (`player-avatars`) remain private; 0 stored URLs anywhere; no token or `/object/sign/` string in audit, security-event or notification history.

### X. Production data integrity
Identities 4, profiles 4, memberships ACTIVE 1, roles CLUB_ADMIN:ACTIVE 1, guardians ACTIVE 2, team places ACTIVE 1, players 2, clubs 1, teams 17, fixtures 278, link requests 0, consent rows 0 — **identical before and after**. No membership, role, relationship, place, override, grant, notification or security event was created.

### Y. Audit and security events
Audit 7490 → 7490, security events 0 → 0, notifications 8 → 8. Append-only triggers enabled (6), maintenance unset, browser and API mutation still refused, no secret-shaped metadata.

### Z. Anonymous and API perimeter
42/42 after 354: family tables and the staff view unreadable, writes refused, all family RPCs refused, internal helpers unreachable (406), audit and security-event inserts refused, storage listings empty and signing refused.

### AA. Production browser UAT
Isolated headless Chromium, signed out only, no production identity created or used, desktop and 390px: **56/56**. One route timed out once at 60s mid-run and passed on re-run — transient, not a defect. Known third-party Cloudflare Turnstile console noise on login-redirected routes (37 occurrences), as in previous releases.

### AB. Public regression
Home, Clubs, club profile and news, public fixtures, the public competition page, Rugby Hub and login all render; every protected route redirects to login; no overflow at 390px; no page or console errors beyond the known third-party noise.

### AC. Runtime and database logs
Whole window: no FATAL, PANIC, deadlock, lock timeout, migration failure, resolver failure, audit-trigger failure or security-event failure. Postgres errors were 108 deliberate probe refusals (42501) plus 1 syntax error from my own malformed verification query (42601). Edge 4xx were my probes only. Vercel runtime: 100 log lines, all info, no 5xx.

### AD. Known deferrals
4b–4i and their legacy helpers; the site-side `is_site_admin` removal (Slice 7); FR-6 and the minor-picture rule not demonstrable on current production data; the two pre-existing HEAD guard failures; `verify-legal-routes` not run (needs a local server).

### AE. Repository closure
`main` = `origin/main` = `909f5be`; nothing staged; only the two protected logos untracked, hashes re-verified and unchanged.

### AF. Production closure
Code `909f5be` serving on both domains; database at 448 / `20270354000000`; the three migrations applied in the mandated order with the app deployed between 352 and 353.

### AG. Risks and observations
1. FR-6 and the minor-picture rule have no production data to exercise; both are covered by tests, mutation testing and the rehearsal.
2. The single production Site Admin is also the club's Club Admin and a guardian, so production cannot separate those roles by observation; the contrast probe with an unrelated person covers the bypass question.
3. `internal.can_view_account_avatar` treats an owner it cannot age as an adult. Only a real account id can appear as a picture path prefix, and every account has a profile, so this is not reachable today — worth a look when minor logins arrive.
4. A guardian relationship or account picture created later will exercise paths production has not yet run.

### AH. Verdict
**IDENTITY/AUTH SLICE 4A — PRODUCTION VERIFIED**

4b not started. Slice 5 not started. The Slice 4 programme is not complete. Stopping here.