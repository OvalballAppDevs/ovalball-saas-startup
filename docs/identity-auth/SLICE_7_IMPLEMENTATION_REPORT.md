# Identity/Auth Slice 7 — Site Admin Users & Access, and master control

**Phase 2 Q.1, Q.2, Q.3, R, AN-3; AI #36–#41, #50, #60–#62; AH R9 and R16; Z.4 PG-15/PG-16.**

Thirteen migrations (`20270417000000` … `20270429000000`), thirteen commits, `bf5ce97` … `f85e5de`.

## What Slice 7 is

Before it, Ovalball asked ninety RLS policies and sixty SECURITY DEFINER bodies whether somebody *was*
a Site Admin. `is_site_admin()` is true for **any** active Site Admin regardless of profile, so a Read
Only Site Admin could update the club directory, delete a competition entry and cancel a fixture. The
slice replaces that question everywhere with "do they hold the capability that names this operation",
and gives Site Admin the master-control RPCs it needs to do its job without a policy bypass.

The headline numbers are the acceptance criterion: **PG-15 = 0 and PG-16 = 0**.

| | |
|---|---|
| Policies moved off the Site Admin label | **90** |
| SECURITY DEFINER bodies moved off `is_site_admin()` | **60** |
| Bodies moved off `is_full_site_admin()` / the presentation role | **30** |
| RLS policies moved off `site_admin_support_level()` | **3** |
| Master-control RPCs | **20** |
| Browser write grants remaining on `site_admins` | **0** |

## The five things worth reading

**1. `is_full_site_admin()` was a second label family that PG-16 does not name.** Both invariants read
zero and both readings were honest; they were also not the whole family. Thirty function bodies still
decided authority by comparing `site_admins.admin_role` against the string `'full'`, and three RLS
policies did it through `site_admin_support_level()`, which launders the same column into the words
`manage` and `view` and so matches no PG-15 pattern. Reading the label skips `capability_decision`,
and with it the recent-authenticator requirement, the session liveness check and per-person overrides
— three of which are the whole of Slice 6. Each of the thirty-four was read and mapped individually;
twenty-nine mappings are exact, three widen to the profile that owns the domain, two narrow.
**PG-15+ and PG-16+** are added as permanent invariants stating what people already read PG-15/16 as
saying: nothing that grants or refuses reads the presentation role by any route.

**2. `set_account_status` was the escape hatch.** Users & Access called it to suspend accounts. It
authorised on the label, took **no reason**, required **no** authenticator code and emitted no event
of its own — an account could be suspended with nothing on the record saying why. It is gone,
replaced by `site_set_account_state`, which asks a *different capability per state*: only SITE_FULL
may disable, while SITE_SUPPORT may suspend and reinstate. The old function could not express that,
because it only ever looked at a label.

**3. A Site Admin grant now takes two people, by every route.** There were three ways for one person
to do it alone — write `site_admins`, issue a Site Admin invitation, or redeem a Slice 5 `SITE_ADMIN`
invitation. A rule enforced in one of three doors is not a rule, so the gate went where all three
converge: `internal.apply_site_admin_grant` is the only thing that makes anybody an active Site Admin,
and it refuses unless it finds and **consumes** an approved request. Direct writes are then closed to
every browser role. Revocation deliberately still takes one administrator — taking authority away is
the safe direction, and it ends every live session so the authority does not outlive the decision.

**4. Five of seven Site Admin profiles briefly lost the entire admin surface, and only a browser saw
it.** The `site_admins` SELECT policy was mapped to `site.admins.manage` along with its writes. Right
for writes; wrong for reads, because the policy it replaced was true for *any* Site Admin — so a Club
Data or Support administrator could not read their **own** row, `session-context.ts` concluded they
were not an administrator, and every `/admin/*` page redirected them away. No SQL suite could see it:
they all ask `internal.can()` directly, and that was correct throughout. What broke was the
application's ability to find out, which only appears when something reads the table through PostgREST
as they would.

**5. Create User could never have worked.** The ID-6 guard read `account_state`, which the ID-1 trigger
sets to `ACTIVE` on every new profile, so it fired on the identity the server had created one
statement earlier. `SMC-37` passed throughout because it set the profile to `PENDING_SETUP` first —
it seeded the state the function expects instead of the state the product produces.

## Verification

| | |
|---|---|
| Battery | **4,707 passed, 0 failed across 223 suites** |
| Clean boot from empty | **520 migrations**, tip `20270429000000`, every seed, then the full battery |
| Production-shaped rehearsal | booted at **507 / `20270416000000`** with production's identity shape (one Full Site Admin, one club, one pending `full` invitation); the thirteen migrations moved **90 / 60 / 29** — identical to production's own counts; **278 assertions, 0 failures** |
| Mutation campaign | **14 mutants, 0 survivors** (one survived first and showed a test was lying) |
| Races | **R9a, R9b, R16** — two genuinely concurrent sessions, the harness fails if B is not observed blocked behind A |
| Browser UAT | **18/18**, twice, self-cleaning, with **real TOTP codes** and a 320px pass |
| Attack matrix | #36, #37, #41 as a **generated** matrix over the whole master-control surface; #38, #39, #40, #47, #50, #60, #61, #62 |
| Performance | `has_site_capability` 0.108 ms held / 0.059 ms not held; `recent_aal2` 0.004 ms; the whole preamble 0.072 ms; `session_ok` 0.036 ms; rewritten policies hoist to **InitPlan**, once per query |
| Perimeter | manifest updated for all 20 RPCs and both tables, not loosened around them |

### Three tests that were lying, all found by something other than themselves

- **`site_admin_profile_matrix`** built its argument list with `string_agg` over a join and no
  `ORDER BY`, so every call became "function does not exist" on a clean boot; its positive control
  accepted any SQLSTATE other than 42501 and so reported success. Found by the **clean boot**.
- **`SMC-33`** claimed to test the recent-AAL2 gate and tested the session gate: a random session id
  has no `auth.sessions` row, so the refusal came from `session_live()` and never reached
  `require_recent_aal2`. Found by the **mutation campaign**, which emptied that function and watched
  the suite stay green.
- **`SMC-37`** seeded the state the RPC expects rather than the state the product makes. Found by the
  **browser**.

### Five defects in my own work, found by the tests

`site_set_account_state` double-emitted `account.suspended` and invented `account.reinstated` for a
transition already called `account.restored`; recreating `admin_user_overview` dropped
`security_invoker` and made it an owner-rights view; five master-control RPCs answered "that does not
exist" before checking whether the caller was allowed to ask, which is an existence oracle;
`site_register_created_identity` emitted a second `user.created` disagreeing with the trigger's; and
an emit inside an exception handler that re-raises was dead code reading like a feature.

## Decisions recorded

- **D-S7-AUTO-1** — `is_full_site_admin()` and `site_admin_support_level()` are retired as authority
  even though PG-16 names neither. The brief says presentation roles are not authority, and a
  surviving `is_site_admin() OR …` escape hatch on a Slice-7-owned path is prohibited.
- **D-S7-AUTO-2** — three mappings deliberately widen, each to the profile that owns the domain:
  `withdraw_announcement` → SITE_MOD, `request_fixture_restoration` and
  `competition_organiser_recipients` → SITE_OPS. Authority should follow the named job; this is the
  intended outcome of the slice rather than a side effect.
- **D-S7-AUTO-3** — `guard_club_membership_revival` narrows from FULL+SUPPORT to
  `site.memberships.manage` (FULL), the capability that names the operation.
- **D-S7-AUTO-4** — `internal.is_club_admin()` is **left alone** in three bodies. It tests a canonical
  `club_memberships` role, not a cosmetic label, and club authority is not Slice 7's to redraw.
  Recorded for the slice that owns it; rewriting it on a grep count is what the brief prohibits.
- **D-S7-AUTO-5** — Q.3's `site_initiate_mfa_recovery` / `site_approve_mfa_recovery` are **not** added.
  Slice 6 shipped those operations as `request_privileged_recovery` / `approve_privileged_recovery`.
  A second pair under the Q.3 names would give one operation two doors, which is the mistake 7c spent
  a migration undoing. The existing pair was strengthened to carry the full preamble instead.
- **D-S7-AUTO-6** — moving a Site Admin **up to** SITE_FULL goes through the two-admin gate; moving
  them down or sideways does not. A promotion to Full is a grant of the authority the rule protects.
- **D-S7-AUTO-7** — the AN-3 bootstrap is a **declared** exception (`site_admin_grant_requests.bootstrap`)
  rather than a constraint switched off, because the constraint cannot be restored afterwards and
  "it was off for a while" leaves no trace.

## Open, and needing the platform owner

- **AN-3 is unresolved, and production holds a pending invitation that Slice 7 changes the meaning
  of.** There is one pending Site Admin invitation, for `full`, issued 14 September 2026 and expiring
  **21 September 2026**. After this release it confers nothing on its own, because the grant it would
  make is the one that needs a second Full Site Admin to approve. This was **not** weakened for it:
  Phase 2 AN-3 says the first additional Full Site Admin comes from a documented bootstrap procedure
  "not by relaxing the rule in code". That procedure is now written and rehearsed —
  `docs/identity-auth/SITE_ADMIN_BOOTSTRAP.md`. Either run it for that person (and revoke the now
  redundant invitation), or let it expire and grant them through the ordinary path once a second Full
  Site Admin exists. **Whoever holds that invitation should be told which**, rather than clicking it
  and meeting a refusal.
- **`SUPABASE_SERVICE_ROLE_KEY` must be set in production** or Create User fails: `auth.admin.createUser`
  needs it. `.env.example` declares it. Nothing else in Slice 7 depends on it.
- **T1–T6 are not activated.** Authentication stays at AG.2 T0, no enforcement, exactly as Slice 6 left it.
- Two pre-existing `<img>` lint warnings in `app/(app)/admin/email/brand-panel.tsx`, untouched and out of scope.
