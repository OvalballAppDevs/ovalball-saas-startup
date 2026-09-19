# Identity/Auth Slice 7e — Site Admin master control reaches a person

Convergence Step 5. This is the closure pass for Slice 7, not a new slice: the
authority model was built and verified in 7a–7d, and almost none of it reached a
screen.

---

## 1. All thirteen rows, reconciled

The instruction was to enumerate **all thirteen** authoritative Slice 7 rows and
reconcile them, rather than working only on 7e's four. Eight were previously
reported PRODUCTION VERIFIED; those eight were re-checked against the live
schema tonight rather than taken from the table.

The authority for the row list is
`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` §D.7. **The Phase 2 brief itself is
not checked into this repository**, so where a row cites a brief section (AB.1's
thirteen tabs, AB.3, AB.4's wizard) the reconciliation's own description of that
section is the highest available authority and is what this pass implements. That
is stated here rather than left implicit, because reconstructing a specification
from a summary of it is exactly the kind of step that should be visible.

| ID | Requirement | Reported | Re-checked tonight | Verdict |
|---|---|---|---|---|
| S7-1 | PG-15 = 0 (legacy authority helpers out of policies) | PRODUCTION VERIFIED | `pg_policies` referencing `is_club_admin\|is_team_admin\|is_site_admin\|can_manage_player\|has_club_role`: **0** | **holds** |
| S7-2 | PG-16 = 0 | PRODUCTION VERIFIED | same query, same 0; `authority_helper_retirement.sql` is wired and green | **holds** |
| S7-3 | Presentation-role authority retired | PRODUCTION VERIFIED | `internal.site_admin_role` survives as an accessor with **0 authority callers** and **0 policies**; the retirement suite pins that. But `internal.is_site_admin()` did **not** hold: one reference survived in `admin_club_overview`'s `WHERE` clause, where the policy and function guards do not look | **held for the row as stated; extended by this pass** — see §4.4 and ledger L16 |
| S7-4 | Q.3 master-control RPCs (20) | REGRESSED — present, unusable | The preamble chain is intact and `internal.require_recent_aal2` now has end-to-end proof against a real factor (`71-recent-aal2-authority`, banked `7885fc6`) | **regression cause removed; closed by this pass giving them callers** |
| S7-5 | Users & Access detail tabs | PARTIALLY IMPLEMENTED — 17 of 23 RPCs have no UI caller | Counted from source: callers exist for `site_set_account_state`, `site_revoke_site_admin`, `site_change_site_admin_profile`, `site_register_created_identity`, `site_resend_account_setup`. **17 have none** | **open — this pass** |
| S7-6 | Create User wizard, AB.4 | PARTIALLY IMPLEMENTED — single-step | `/admin/users/new` is one form; `site_register_created_identity` already accepts `p_intended jsonb` and nothing sends it | **open — this pass** |
| S7-7 | `site_search_users` | MISSED | `select count(*) … proname='site_search_users'` → **0**. Users & Access searches `admin_user_overview` with an `.or(ilike)` chain | **open — this pass** |
| S7-8 | Two-admin Site Admin grant | IMPLEMENTED — NOT ENFORCED | `public.site_admin_grant_requests` exists with the full state machine; **no screen raises or approves a request** | **open — this pass (the UI half)** |
| S7-9 | `site_admin_grant_and_lockout` suite | PRODUCTION VERIFIED | wired at `run-platform-tests.sh:364`, green | **holds** |
| S7-10 | Profile matrix | PRODUCTION VERIFIED | `site_admin_profile_matrix` wired twice (351, 367), green | **holds** |
| S7-11 | Races R9, R16 | PRODUCTION VERIFIED | `supabase/tests/js/site_admin_races.test.mts` present, glob-wired, green | **holds** |
| S7-12 | AN-8 no read-out of setup codes | PRODUCTION VERIFIED | `62-site-admin-master-control` S7-07 asserts no token and no Copy Setup Link | **holds** |
| S7-13 | AN-3 bootstrap run | BLOCKED — OWNER ACTION | Unchanged. A second Full Site Admin is an owner operation on production and is not in scope for an unreleased step | **stays with the owner** |

### One finding that came out of the reconciliation

`supabase/security/perimeter-manifest.json` already names a `consumers` path for
each of the seventeen orphan RPCs — for example
`app/(app)/admin/users/actions.ts` for `site_revoke_sessions`. **That file
contains no such caller.** The manifest was describing the design's intent
rather than the code's state, and nothing checked the difference. This pass makes
the declarations true; a guard that would have caught it is part of the same
unit, because a perimeter manifest that can drift silently is worth slightly less
than one that cannot.

### Rows explicitly NOT pulled forward

Impersonation (IMP-1, Slice 9), Volunteer presets (V-3, Slice 8),
`team_admin` string retirement (TA-1, Slice 10), stale-context invalidation
(X-4, Slice 8), and the AB.5 club People & Access overhaul (Slice 8). Step 2
already delivered the club-scope surface; Slice 8 owns its authority model.

---

## 2. AB.1's thirteen tabs, reconstructed

The reconciliation names three of them outright — **Team Memberships,
Invitations, Audit History** — and gives the completeness condition for the
rest: every one of the twenty-three master-control RPCs must have a caller. The
thirteen below are the smallest set of coherent tabs that satisfies both, with
each RPC placed under the question it answers.

| # | Tab | RPCs it gives a caller |
|---|---|---|
| 1 | Overview | — (reads only) |
| 2 | Personal Details | — (reads `profiles`, `site.users.view_personal`) |
| 3 | Account & Security | `site_set_account_state`, `site_revoke_sessions`, `site_force_password_reset` |
| 4 | Club Memberships | `site_add_club_membership`, `site_transition_club_membership` |
| 5 | Club Roles | `site_assign_club_role`, `site_revoke_role_assignment` |
| 6 | Team Memberships | `site_assign_team_role`, `site_set_player_team_membership` |
| 7 | Family | `site_link_guardian`, `site_end_guardian_relationship`, `site_family_history` |
| 8 | Capability Overrides | `site_set_capability_override` |
| 9 | Invitations | `site_revoke_invitation`, `site_resend_account_setup` |
| 10 | Site Admin | `site_request_site_admin_grant`, `site_revoke_site_admin`, `site_change_site_admin_profile` |
| 11 | Membership History | `site_membership_history` |
| 12 | Team History | `site_team_history` |
| 13 | Audit History | `site_account_history` (added by this pass), plus the row-level `audit_log` |

`site_approve_site_admin_grant` and `site_reject_site_admin_grant` are decided by
the *second* administrator and so belong on the Site Admin Management queue at
`/admin/site-admins`, not on the subject's own record — a person cannot be the
page on which their own grant is approved. `site_register_created_identity`
belongs to Create User (S7-6) rather than to any tab, because it runs before the
person exists. Twenty from the table, two on the grant queue, one on Create User:
all twenty-three.

**`site_family_history` is the one timeline that is not its own tab.** It sits
inside Family, because a safeguarding question is never "what is the
relationship" and separately "who decided it" — it is always both at once, and
splitting them across two tabs would make the answer take two clicks. That frees
the thirteenth slot for **Audit History**, which the reconciliation names by name
alongside Team Memberships and Invitations as a tab that does not exist in any
form. Writing that tab is what uncovered §4.2.

---

## 3. What was built

### S7-7 — `site_search_users` (AB.3)

`20270504000000_site_search_users.sql`. The Users & Access list previously built
its own filter and handed it to PostgREST as a string:

```ts
q.or(`first_name.ilike.%${escaped}%,surname.ilike.%${escaped}%,email.ilike.%${escaped}%,…`)
```

It was escaped and it read a `security_invoker` view, so it was not a hole. It
was the wrong shape for the one screen that can see every account on the
platform: "who may be searched, and by what" was answered in TypeScript. The RPC
authorises on `site.users.view` **before reading anything**, takes every filter
as data with no dynamic SQL, **refuses** an unrecognised sort rather than
defaulting it, caps a page at 100 rows, and returns `total_count` with the page
so the two cannot disagree under a concurrent write.

It deliberately does **not** require AAL2. The ten-minute authenticator rule
belongs on the master-control mutations; putting it on a search would train
administrators to keep a code ready for looking things up.

A consequence worth naming: `parseAdminUserQuery` used to cast whatever was in
the URL (`get("access") as AccessFilter`), which typechecked and then fell
through every `switch` arm, silently applying **no filter at all**. Somebody with
a mistyped bookmark got the whole platform back with no indication. The RPC now
refuses an unknown value, so the parse had to become a real mapping.

### S7-5 — AB.1's thirteen tabs, and seventeen RPCs that had no caller

`app/(app)/admin/users/[userId]/` is now a tabbed record. The tab is **URL
state**, not component state: only the active tab's data is read, an
administrator can send a colleague the exact tab they are looking at, and a
verification suite can address one directly.

The seventeen orphaned RPCs are called from one file,
`master-control.ts`, through one shared control,
`MasterControlAction`. Seventeen bespoke forms would have produced seventeen
slightly different reason boxes and one of them eventually forgetting the reason
altogether. The control is handed a server action already **bound to its
subject**, so the browser cannot choose who an operation applies to.

Refusals are shown verbatim, and that is a deliberate, bounded decision: the
canonical functions classify every refusal a person is meant to read with an
explicit SQLSTATE — `42501` authority, `23514` a rule, `22023` a malformed
argument, `P0002` a missing row. Anything else is an internal fault and gets the
generic message. That allowlist is why "This would leave the club with no Club
Admin" reaches the screen while a constraint name never does.

### S7-6 — Create User's Assignments step (AB.4)

`site_register_created_identity` has accepted `p_intended` since Slice 7b and
applies each entry through the **same** master-control RPC the Users & Access
screen calls, so each re-checks its own capability. Nothing had ever sent it
anything. The form is now Identity → Assignments → Review.

The assignments travel **with** the creation rather than being applied afterwards
from the new record's own tabs, because the RPC deliberately does not wrap them
in a sub-transaction: a refused assignment fails the whole creation and the auth
identity is deleted. A half-assigned person is worse than no person — nobody
would know which half — and that guarantee only exists if they travel together.

Site Admin is not offered at any step. It takes two administrators, and a
checkbox on a create form is the single-handed route Slice 7c closed.

### S7-8 — the UI half of the two-administrator rule

Raising a grant is on the subject's own record; **deciding** one is on Site Admin
Management. A person's own record is not the page their own elevation is approved
on, and putting both on one screen would invite the two clicks to be the same
administrator's. The RPCs refuse the requester and the target regardless of which
screen asks, so the separation is a courtesy rather than the boundary.

The two refusals the queue can hit — "you raised this" and "this is about you" —
are shown **before** the buttons rather than after a click. They are not errors;
presenting them as failures would suggest something went wrong when what happened
is the rule working.

AN-3 is restated rather than worked around: with one Full Site Admin in
production, no approval is possible. The answer is a second administrator (T1),
never a way to approve one's own request.

---

## 4. Four things this pass found

### 4.1 A Site Admin could change a roster placement they could not see

`20270505000000`. `site_set_player_team_membership` lets a Site Admin add, end or
move a player's place on a team. `player_team_memberships`' RLS answers to
`team.roster.view` at **team** scope, `is_own_linked_player`, or
`is_active_player_guardian` — a platform administrator holds none of those for a
club they are not in, which is deliberate: Site Admin is a set of explicit
site-scoped capabilities, never a blanket RLS bypass.

The consequence is that "move this player to Under 14" was performable blind.

The fix is **not** a wider policy. Adding a site clause to that policy would hand
every roster on the platform to every administrator with any site read
capability, including Support profiles with no business in a child's team
placement. It is one narrow per-person definer read, gated on `site.users.view`,
answering only about the subject's own linked player or a child they actively
guard. `S7E-21` and `S7E-22` assert the policy is still narrow, so a later
"simplification" cannot quietly widen it.

### 4.2 The provenance timelines could not see the events their own slice writes

`20270507000000`, found by the browser suite. `site_add_club_membership` emits
`site.membership_added`; `site_membership_history` matched `membership.%`,
`site.club_%` and `club.%`. Neither matches the other.

Across the master-control family, **seven of the sixteen event types it emits
were displayed by nothing at all**: `site.membership_added`,
`site.membership_transitioned`, `site.role_revoked`,
`account.password_reset_forced`, `account.setup_resent`,
`session.revoked_by_admin`, the four `site_admin.*` grant events, and
`user.created`. "Why is this person no longer a Club Admin" and "who ended their
sessions on the 3rd" were both unanswerable from the product while the rows sat
in `security_events` the whole time.

The timelines now discriminate on the **scope column** — an event carrying a
`team_id` is team history, one without is membership history — rather than on the
shape of the event name. A name is a label and drifts; `club_id`/`team_id`/
`player_id` are what the event is about, so a new event type is covered the day it
is written rather than the day somebody notices. A fourth timeline,
`site_account_history`, carries what is none of those, and surfaces on Audit
History beside the row-level `audit_log` entries.

This is the reconciliation's "answer a question no screen asks" turning into
"answer the wrong question the moment a screen asks it", and it could only be
found by reading the output.

### 4.3 The perimeter manifest declared consumers that did not exist

`supabase/security/perimeter-manifest.json` records, for most browser-callable
functions, the application file that calls them. **Nothing had ever checked.**
Seventeen declarations described the design's intent rather than the code's state
— `site_revoke_sessions` was recorded as consumed by
`app/(app)/admin/users/actions.ts`, which is the CSV export and had never called
it — and four named files Convergence Step 3 had deleted.

A false declaration is worse than none: a reviewer reading the manifest would
conclude the function had a caller and that the named file was where to look.
The Slice 7 declarations are now true, and
`supabase/tests/js/perimeter_manifest.test.mts` checks every one of them. The
fourteen that predate the check and belong to other slices are declared in
`supabase/security/manifest-consumer-baseline.json`, which **may only shrink** —
the same shape as the role-literal baseline, and for the same reason.

### 4.4 `internal.is_site_admin` had one reference left, inside a view

`20270506000000`. The manifest has carried this as a declared legacy bypass since
Slice 1. Policies referencing it reached 0 and so did functions — and the last
reference survived in the **`WHERE` clause of `admin_club_overview`**, precisely
because the guards that drove the retirement count policies and function bodies.

It mattered rather than being tidy: `is_site_admin()` is true for a Read-Only
Site Admin, a Message Moderator and a Club Data Admin alike, which is the
undifferentiated authority Slice 7 exists to replace. The gate is now
`site.clubs.view`. With no references left anywhere, the helper is **dropped**
rather than kept as a convenience — on this project a zero-caller authority
helper is a hazard, because the next person to need an answer may find it before
they find the canonical resolver.

---

## 5. Two assertions that were wrong, and what they taught

Both were in the first draft of the SQL suite, and both are recorded because the
correction is the interesting part.

**A Message Moderator does hold `site.users.view`.** The first negative control
assumed a narrow profile would not. All seven site profiles carry
`site.users.view` and `site.clubs.view`: seeing the platform is the baseline of
being a Site Admin, and only *acting* is profile-specific. Asserting otherwise
would have been asserting a product decision nobody made.

**A site-scope deny override is ignored, and should be.** The second draft wrote
one directly into `capability_overrides` and read the engine's correct behaviour
as a failure. K.3 is explicit in `internal.capability_decision`: at site scope
only rule 7 can allow and overrides are never consulted, and
`public.set_capability_override` refuses a `site.*` capability for exactly that
reason. The draft had used a raw `INSERT` to manufacture a state the product
cannot create.

The surviving control is the one that is both real and reachable: an account
whose Site Admin access has been **revoked**, whose `site_admins` row is still
there. That distinguishes "answers the capability" from "answers the existence of
a row" without inventing anything.

It also changed the product: the Capability Overrides tab no longer lists `site.*`
capabilities, because a picker whose most powerful-looking options always end in
a refusal reads as the product being broken rather than as the rule being kept.

---

## 6. Evidence

| Gate | Result |
|---|---|
| `supabase/tests/site_admin_users_access_closure.sql` | 37 assertions |
| `supabase/tests/js/site_admin_master_control_reachability.test.mts` | 5 tests — every `site_*` function a browser may execute is reachable; the thirteen tabs exist; the seventeen are named individually |
| `supabase/tests/js/service_role_usage.test.mts` | 6 tests (S1-15, §6a) |
| `supabase/tests/js/perimeter_manifest.test.mts` | 12 tests, including the new consumer-declaration check |
| `scripts/browser-verification/73-users-access-detail-tabs.mjs` | 41 assertions, real AAL2, canonical state re-read after every claimed change |
| `scripts/browser-verification/62-site-admin-master-control.mjs` | 18/18 — **now wired into the release runner**, see below |
| `scripts/isolated-clean-boot.sh` | the four new migrations asserted from empty, including what they remove |
|  `scripts/migration-rehearsal.sh` (was `slice7e-rehearsal.sh`; generalised at Step 6) | **PASS** — the four applied one at a time from the 524-migration production tip, each dry-run in a rolled-back transaction first |

### What the rehearsal measured

The clean boot proves the chain installs from **empty**. That is a different
question from the one a release asks. Two of these four are exactly where the
difference shows: `20270506000000` recreates a view that *already exists with
dependents* and then drops a function, and `20270507000000` **replaces** three
existing function bodies — from empty, "replace" and "create" are
indistinguishable.

| | before | after |
|---|---:|---:|
| `site_*` functions | 29 | **32** |
| policies | 594 | 594 |
| capabilities | 239 | 239 |
| profiles | 15 | 15 |
| club memberships | 4 | 4 |
| role assignments | 5 | 5 |
| site admins | 2 | 2 |
| `internal.is_site_admin` | 1 | **0** |

`+3` functions and `−1` helper, and **nobody's access moved** — the script fails
if a profile, membership, role assignment or administrator count changes, because
a schema migration that moves one of those is doing something it did not say it
was doing. Then `site_admin_users_access_closure` (37),
`authority_helper_retirement` (77), `security_perimeter_guard` (6) and
`definer_rpc_session_contract` (37) all pass against the rehearsed database.

It rehearses production's **shape**, not its data, and says so: nothing here
reads or touches the production project.

### The two-administrator rule is proved to COMPLETE, not only to refuse

A rule that refuses everybody passes exactly the same assertions as a working
one. Production has a single Full Site Admin and creating a second there is an
owner operation (AN-3 / T1) this step has no authority to perform — so suite 73
creates a **disposable local second administrator**, signs in as them with a
password, enrols their own authenticator, and has them approve the request raised
earlier in the same run. `T-56b` then reads `site_admins` and asserts the grant
actually landed.

That identity is also given a club membership, which makes it the one thing the
permanent persona directory does not contain: an account holding **both** real
Site Admin authority and a club to operate as. Without it, "active context is a
lens, not authority" cannot be walked at all — an administrator with nothing else
to be is always in Site Admin context. `T-55` walks it as the club and is
refused; `T-55a` is the same session, having switched, reaching the page.

An earlier draft of `T-55` used the permanent Full Site Admin and **passed
nothing**: that persona holds no club, so the cookie was ignored by
`resolveActiveContext` and the guard was never exercised. The assertion looked
right and proved nothing, which is the failure mode this programme keeps finding.

### Suite 62 is now in the release runner

`62-site-admin-master-control` is Slice 7's own browser evidence — `S7-07` is what
the reconciliation cites for AN-8, *"the setup link is never shown"* — and it had
**never been in `BROWSER_SUITES`**. That evidence rested on somebody's memory of
having run it once.

Wiring it immediately earned its place: it caught two real regressions from this
step that nothing else did. Create User's submit moved to the wizard's third
step, and account status moved onto its own tab, so the suite's walk was stale —
and `S7-15` caught that the new three-pill step indicator overflowed a 320px
screen by 15 pixels. The same class of defect on the detail record (a
`whitespace-nowrap` control label 343 pixels wide) is now covered by `T-56`.

---

## 7. Service-role key verification (S1-15 / AO C12)

The Convergence map assigns "Slice 7e Site Admin Users & Access; **service-role
key verification**" to Step 5. The second half is S1-15, which the reconciliation
recorded as MISSED with no owner: *"`perimeter_manifest.test.mts` mentions
service_role but does not assert the Z-11 allow-list."*

`supabase/tests/js/service_role_usage.test.mts` is that assertion.
`SUPABASE_SERVICE_ROLE_KEY` has no session, no capability check of its own, and
bypasses every RLS policy in the project — it is the one credential for which
"who may do this" has no answer at all. So the only defensible control is that
the set of modules holding it is small, named, and cannot grow quietly.

Six properties, each one something the codebase can violate silently: only the
two declared modules read the variable; nothing else builds an elevated client by
hand; no holder or importer is a client component, which would drag the key's
module graph into the browser bundle; no `NEXT_PUBLIC_` alias exists in source or
in `.env.example`; each holder carries the reasoning for its own use in its own
file, because the next person to add a call site reads the file rather than the
test; and the seven modules importing the factory are listed by name, since each
is individually responsible for authorising itself.

It is an allow-list rather than a count on purpose. A count passes when one
module is removed and another added; naming them makes a new holder of the key a
deliberate edit with a reason beside it.

Relevant to Step 5 specifically: `lib/admin/create-identity.ts` is the newer of
the two holders, and the Create User wizard is the surface this step extended. It
asks Supabase Auth for an identity and nothing else — every assignment the wizard
collects is applied afterwards by `site_register_created_identity` under ordinary
capability rules, so the elevated client never decides anything.

---

## 8. Three suites the retirement broke, and why that is the guard working

Dropping `internal.is_site_admin()` made three existing assertions fail. None was
a defect in the retirement; all three are suites doing exactly their job.

**`public_team_season_identity` T2** counts the functions `anon` may execute and
compares it against a number written down with reasons. It expected 20 and found
19. The helper had been anon-executable since Slice 1 because policies a
signed-out visitor reaches evaluate it transitively. **A shrink is still a change
to a perimeter**, so the number is re-declared with the reason beside the four
that preceded it, rather than made dynamic.

**`family_authority_matrix` FA13a and FA13b** are shadow comparisons: they run
the *legacy* authority expression beside the canonical one and require every
disagreement to be one Phase 2 names. Both legacy expressions called
`internal.is_site_admin()`, so with the function gone the legacy side raised,
`allowed_for` read that as "nobody", and the comparison reported every role as
newly permitted. **A retirement looked like a widening.**

The suite already had the right answer to this: `internal.can_manage_player` was
retired in Slice 4 and its exact body lives on as a test-local function so the
baseline still measures the real historical answer. `pg_temp.legacy_is_site_admin`
is the same move for the same reason.

There is a fourth, latent, in `scripts/slice7-mutation-campaign.sh`. Its M5 mutant
**resurrects** `internal.is_site_admin()` and the owning migration cannot know to
drop it, so a campaign run would have left the retired helper standing and
`S7E-33` failing afterwards — after the campaign reported success. The file
already carried a note about this exact trap with a policy; `mutant()` now takes
an explicit cleanup step, so the second half is closed too.

---

## 9. What is deliberately still open

| | Owner |
|---|---|
| **S7-13** — AN-3 bootstrap: a second Full Site Admin in production | product owner (T1). Not an engineering step, and not in scope for an unreleased one |
| `site_safeguarding_review` has no UI caller | Slice 4G's / Message Management's. Declared in `DECLARED_UNREACHABLE` so it cannot be forgotten |
| Fourteen manifest consumer declarations belonging to other slices | their own slices, via the shrink-only baseline |
| `club_directory` column breadth for `authenticated` | the Site Admin **club** surface's own pass. Slice 7e moved the user reads behind an RPC; the club reads have not moved |
| Two legacy paths can still mint plaintext-token credentials | Slice 10, flagged in the reconciliation §M for the owner's ruling |
