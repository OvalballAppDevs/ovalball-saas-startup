# OVALBALL — IDENTITY, AUTHENTICATION & AUTHORIZATION PROGRAMME
## SLICE 4A — FAMILY / PLAYERS — IMPLEMENTATION REPORT (contract closure)

**4b–4i NOT STARTED. The Slice 4 programme is NOT COMPLETE.** This closure covers Slice 4A only. `PLAN.md` now uses the Slice 4A name throughout and has a closure section (§11).

---

### 1. Naming and verdict
Corrected everywhere. The only verdict used is "IDENTITY/AUTH SLICE 4A — …".

### 2. The two client legacy checks
| Page | Old check | Class |
|---|---|---|
| Player Access | `ctx.guardianRelationships` or `ctx.isSiteAdmin` | A: presentation only |
| Player Details | `ctx.guardianRelationships`, `isSelf` or `ctx.siteAdminRole === "full"` | A: presentation only |

**Why they were only presentation.** Both server actions refuse through the capability check, and the database functions decide:
- **Access:** page shows switches → `setPlayerPermission` → `requirePlayerCapability(family.permission.manage)` → `set_guardian_player_permission` → the `can_player_as_family` decision plus an ACTIVE guardian row.
- **Details:** page shows the form → `setPlayerGender` → early refusal → `set_player_playing_pathway` → `player.profile.edit_protected` for the child or self, or `site.users.identity.correct`, plus the set-once rule.

**Why I replaced them anyway.** Phase 2 does not allow even presentation checks here:
- AA.3 makes "UI capability reads" part of the 4a banked unit.
- AA.1 says "UI renders from `my_capabilities()`, no authority logic in components".
- AA.5 bans `isSiteAdmin` and `siteAdminRole ===`.
- The session guardian list answers a different question from the database: it only holds children with an ACTIVE team place.

**What each page asks now:**
- **Access:** `hasPlayerCapability(family.permission.manage)`, the same answer its action refuses with.
- **Details:** a new shared `mayRecordPlayerGender`, used by both the page and `setPlayerGender`.

**A regression of my own, fixed.** My earlier 4a early check on `setPlayerGender` had blocked the Full Site Admin from completing a missing gender, which HEAD and the database both allow. The shared answer restores it.

**Permanent guard:**
- `migratedDomainUiViolations()` has zero tolerance in the 4a interface files for role literals, Site Admin flags and the session guardian list.
- `js/migrated_domain_ui_authority.test.mts` ties each page to its action's exact answer and requires the early refusal before the database call.
- The role-literal baseline drops both pages.
- Guard mutants: 4/4 killed (back to the guardian list, an added Site Admin flag, a different key plus `isSiteAdmin`, a removed early refusal).

### 3. Guardian whose child has no team place
- **Owner: 4a.** Phase 2 J.6 gives a guardian `player.profile.edit_protected` and `family.permission.manage` "for each ACTIVE linked child", and says "visibility derives from the child, not from membership".
- **Fixed** by the change in section 2.
- **Suite 46, new checks J1–J7 (34/34, three runs):**
  - a coach is refused (404, no form);
  - the guardian is offered the form, records the gender once, and the form disappears;
  - the guardian gets the consent switches;
  - a Site Admin may complete a missing gender but gets no consent controls.
- **Suite 51:** the gender replay now uses a child with no team place. It is refused for every staff role, the co-guardian and Parent B, then the authorised replay lands (12/12, three runs).

### 4. Z-12 private picture cutover (rehearsal, real Storage API)
Checked at 445, 352, 353 and 354. Only HTTP statuses are recorded; no URL or token was printed.

| Probe | 445–353 | After 354 |
|---|---|---|
| Raw public URL (adult and minor) | 200 | **400** |
| Owner signs and renders their own picture | 200 | 200 |
| Anonymous | signs 200 | **refused** |
| Minor's picture: the minor, their guardian, their team's coach, the Club Admin | 200 | 200 |
| Minor's picture: another team's coach, unrelated adult | 200 (the leak) | **refused** |
| Child picture: guardian and Club Admin allowed; team coach, unrelated adult and anonymous refused | same | same |
| Signed URL lifetime (2 s signature) | — | 200 at once, 400 after 4.5 s |

- Stored picture paths that are URLs: 0.
- Issued tokens found in audit, security-event or notification history: 0.
- The app signs pictures for 3600 s and never calls `getPublicUrl` on `avatars`.

**One conflict needs your call.** Your brief says an unrelated signed-in user cannot access the existing adult-owned picture. Your locked decision D-S4-4 ("Adults: signed-in; minors: related") makes an adult's account picture visible to any signed-in person, and that is what is implemented: the unrelated adult gets 200. The restriction in your brief holds for minors. I haven't changed a locked decision. If you mean to reverse D-S4-4, say so and it becomes a small follow-up.

### 5. Staged production release order (hard gate)
1. **Stage A:** production at 445 with the old app → dry run, then apply **352 only** → verify.
2. **Stage B:** 352 with the old app → confirm it still works → commit and push. The push is the deploy.
3. **Stage C:** 352 with the new app → confirm the deployment is ready and serving.
4. Only then apply **353** → verify.
5. Only then apply **354** → verify.

Proven by the compatibility matrix: the old app is 10/10 on 352 but fails after 353 + 354; the new app is 10/10 on 352 and on 354.

### 6. Production commands and permissions (prepared, nothing run)
- **Staged work directories:** `release/prepare-stage.sh` builds `stage-352`, `stage-353` and `stage-354`. Each holds the migration chain only up to that version plus the repo's link, so a push can only apply that one migration.
  - Migration hashes: 352 `fb56dcd6…`, 353 `0ff524d3…`, 354 `7793db57…`.
  - Rebuild the stages if any migration changes.
- **Commands, per step (N = 352, then 353, then 354):**
  - `cd …/scratchpad/slice4/release/stage-N` as its own call;
  - `npx supabase db push --linked --dry-run`;
  - `npx supabase db push --linked`.
- **Permission rules:**
  - Your saved rules already cover exact `npx supabase db push --linked` and `git push origin main`.
  - The **`--dry-run` form is not covered**. It needs a rule, or approval at the prompt.
  - A `cd … &&` compound was blocked last time, so run `cd` as a separate call.
  - If the classifier still blocks, approve at the prompt; no other route.
- **Verification after each step:** `release/verify-stage.sql`, read-only, checked against `release/EXPECTED.md` (ledger, staff view, transition signature, policies, bucket flag, unchanged data counts, pg15 149 → 140, no notifications, no stored URLs).

### 7. Re-verification after the closure changes
- Migrations unchanged, so no new clean boot was needed.
- Full runner: **3599 passed, 0 failed, 194 suites**.
- TypeScript clean. Lint: 45 files, 0 errors, 1 warning (an unused import that already exists at HEAD). `git diff --check` clean. Authority guards pass. `next build` succeeds.
- Browser suites: 46 at 34/34 three times; 51 at 12/12 three times.
- All test identities cleaned up. One local row, `race-probe@ovalball-test.invalid`, predates this work and was not created by any of it.

### 8. Repository state and protected logos
- `main` at `b44aef0`. 38 files modified (+435 / −175), 21 untracked (including the two logos). Nothing staged or committed.
- **Closure changes:**
  - pages and actions: both Player pages, `details/actions.ts`, `lib/auth/require-capability.ts`, a corrected comment in the guardians page;
  - guards: `scripts/security/authority-guards.mjs`, `verify-authority-guards.mjs`, the role-literal baseline;
  - tests: browser suites 46 and 51, the new `js/migrated_domain_ui_authority.test.mts`.
- Logos: `be2bef0c978869aaa73e474cd5abdf5aec1fff6c` and `bdd3224871f0561d971f93f519764f0502092504`, unchanged.
- Disposable stacks stopped.

### 9. Verdict
**IDENTITY/AUTH SLICE 4A — READY FOR PRODUCTION RELEASE**

This applies the adult-picture rule as locked in D-S4-4 (section 4). If that decision is being reversed, the verdict becomes NEEDS WORK until the policy changes.

No commit, push, deploy or production migration was made, and 4b was not started. Stopping here.