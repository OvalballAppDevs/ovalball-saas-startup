# Convergence Step 8 — Identity/Auth Slice 8 + operational role management

**TECHNICAL STATUS: READY FOR PRODUCT REVIEW.** Nothing released. Step 9 not
started.

| | |
|---|---|
| Archaeology | `docs/product/CONVERGENCE_STEP_8_ARCHAEOLOGY.md` |
| BEFORE/AFTER matrix | `docs/product/CONVERGENCE_STEP_8_FUNCTIONALITY_MATRIX.md` |
| FUNCTIONS BEFORE | **77** |
| FUNCTIONS AFTER | **85** |
| FUNCTIONS LOST | **0** |

---

## 1. What Slice 8 is, re-read rather than remembered

From `IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` §R, the authoritative
remaining-contract register:

> **Slice 8 — Club People & Access.** People & Access (AB.5), Effective Access
> with provenance and editing (AC), presets, club audit timeline. Tests: browser
> 47, 48, `explain_access` parity. **Acceptance: a Club Admin cannot reach site
> controls or other clubs, directly or via UI; delegation ceilings proven.**

Plus **V-3** (Volunteer presets, recorded MISSED, 0 preset tables) and **X-4**
(stale context invalidation, recorded PARTIALLY IMPLEMENTED — *"no test names
the stale case explicitly"*).

**This was not another roles/permissions redesign.** Slices 1–7 are
authoritative dependencies; Step 7's Fixture Operations is an accepted consumer.
Step 8 added **no new authority**. Everything below either makes existing
canonical authority reachable by the person the design says owns it, or proves
that it is not reachable by anyone else.

### The precedence model was reconciled against the implementation, not assumed

The Step 8 instruction carried a remembered summary of the precedence order and
said to stop and reconcile if the implementation differed. It does not differ.
`internal.capability_decision` numbers its rules 0–8 and resolves in exactly
that order:

| rule | meaning |
|---|---|
| 0 | no subject / no session |
| **1** | hard prohibitions — unknown or retired capability, malformed or tampered scope, inactive account, impersonation blocked, **minor prohibited**, club inactive, **membership suspended** |
| **2 / 3 / 4** | `EXPLICIT_DENY` at SITE / CLUB / TEAM |
| **5** | `EXPLICIT_ALLOW` |
| **6** | `ROLE_BUNDLE` |
| **7** | `SITE_CAPABILITY` |
| **8** | `DEFAULT_DENY` (`ROLE_SUSPENDED`, `MEMBERSHIP_INACTIVE`, `ADULT_PLAYER`, `DEFAULT_DENY`) |

`MEMBERSHIP_SUSPENDED` being a **rule-1** stop is the reason suspension defeats
a grant whose row still exists, which §11 of the contract asks to be proved and
section E of the SQL suite does prove.

---

## 2. The finding that shaped the whole step

`public.assign_role(membership, role_key, team, reason)` is the canonical
general role-assignment primitive. It locks the club's people, resolves the
actor's level, and enforces the delegation ceiling directly from the catalogue:

```sql
if v_level is null or not (v_level = any (v_role.assignable_by)) then
  raise exception 'You are not authorised to give the % role at this club.' using errcode = '42501';
```

**Nothing in `app/` or `lib/` called it.** Neither did anything call
`transition_role_assignment`. The club's own People screen reached the model
only through `set_primary_club_role` — a three-way seat — and `set_team_access`.

So `role_assignments` was writable from the database and from Site Admin, and
**not by the club**. Volunteer is a club role that `role_definitions` says a
Club Admin may assign (`assignable_by = {SITE,CLUB}`), and no screen could
assign it.

That is AB.5 in one sentence: not new authority, but the canonical authority
becoming reachable by its owner.

---

## 3. What was built

### 3.1 Other Roles, on the person's own access page

`assign_role` and `transition_role_assignment` now have callers
(`assignAdditionalRole`, `endRoleAssignment`). The page lists every role a
person holds besides the club-wide seat — club-wide and per team, in one list —
and each stands on its own.

**Role is not identity.** Nothing replaces one role with another. The section
deliberately shows a team role beside a club role, because a team role *is* an
additional role, and suite 47's F0/F1/F2 prove that removing the Volunteer left
the Coach standing.

**Safeguarding Officer is not offered**, because `assign_role` refuses it
outright — *"an officer is nominated and accepts"* — and a control that would
refuse is its own kind of lie.

### 3.2 Volunteer presets — V-3, closed

Three presets, exactly as the design names them:

| preset | capabilities |
|---|---|
| Volunteer — Pitch Allocation | `venue.pitch_allocation.view`, `.manage` |
| Volunteer — Calendar | `calendar.event.view`, `.manage` |
| Volunteer — Team Fixtures | `fixture.fixture.view`, `.create`, `.edit`, `fixture.request.respond` |

**The design decision that matters:** `apply_capability_preset` **calls
`public.set_capability_override` once per capability.** It reimplements nothing.
That function is a hundred and fifty lines of accumulated judgement — the
delegation ceiling ("nobody delegates what they do not have"), the minor
prohibition and its `AGE_ELIGIBILITY_REQUIRED` hint, the refusal to let a club
give a Volunteer people or finance authority, P37's refusal to record an allow
that a broader withhold would defeat, the club-people lock that stops a decision
racing a suspension, and the event pair that makes a replacement legible.

A preset is therefore **data plus a loop**. It can grant nothing the person
applying it could not have granted one at a time, and it produces the same audit
trail as if they had. Because a plpgsql function is one transaction, a refusal
on any capability aborts all of them: a club never ends up having handed out
half a job.

**Team Fixtures deliberately excludes** `fixture.import.run`,
`fixture.planner.use`, `fixture.fixture.bulk_edit` and `competition.creator.use`.
Those are the club's mass fixture authority, ruled club-administrative by the
programme, and a migration-time guard fails if a preset ever names one.

### 3.3 The club audit timeline

`public.club_access_history(club, subject, limit)` — a **read** of
`public.security_events`, which `internal.refuse_history_rewrite()` already
makes append-only. **Not a second log**, because an audit trail is the one thing
that can least afford two versions.

- Scoped by `e.club_id = p_club_id`, asserted by a migration-time guard.
- Gated on `people.access.explain` at the club **or** `site.users.view` — a Site
  Admin must never have to become a club member to do their job.
- Publishes the capability's and role's **human labels**, joined from the
  canonical catalogues.
- Publishes **no** `ip_hash`, `user_agent_hash`, `request_id`, raw `metadata` or
  impersonation id. Those are forensic fields for a Site Admin surface; a club
  timeline is a different question asked by a different person.
- Actor and subject stay distinct columns, because "who did this" and "who it
  was done to" are different questions.

### 3.4 Pitch Allocation — discoverability, not authority

`venue.pitch_allocation.view` and `.manage` are delegable club capabilities that
have existed since Slice 3, and `/club/permissions` offered no group for them.
The screen caught up; the authority did not change. Suite 48 B2/B3 prove exactly
that: a Club Admin could always manage it, an ordinary member still cannot.

Because the person access page **imports** the same `GROUPS`, both screens
gained it at once and cannot disagree.

### 3.5 L3's label half — closed

`role_definitions.label` said "Fixtures Secretary"; every other surface says
"Fixture Secretary". `assign_role` quotes that label in its own refusal, so a
club administrator could be refused in one spelling and offered the role in
another. Both the role catalogue and the capability bundle catalogue now say
**Fixture Secretary**, with a guard that no catalogue a person reads may drift
into the plural.

**The key is untouched.** `FIXTURES_SECRETARY` is an identifier. L3's other
half — one role with two identifiers, `FIXTURES_SECRETARY` in
`role_definitions` and `FIXTURE_SECRETARY` in `club_memberships` and
`role_capability_defaults` — is **Slice 10's**, which drops those columns. L3
therefore stays **partly open**, with its remaining owner named.

### 3.6 The seat rule moved into the catalogue

`internal.apply_primary_club_role` held the three mutually exclusive seat roles
as a literal. Slice 8's screen needs the same fact, and the obvious way to make
it know is to repeat three strings in a React component — which is how a
presentation list becomes an authority list two slices later, and what
`scripts/verify-authority-guards.mjs` refuses.

`role_definitions.is_primary_seat` now carries it, the function reads it, and
the page reads it. One definition. A migration-time guard proves the function no
longer carries its own copy and that **Volunteer is not a seat** — giving it
must not silently take somebody's Club Admin away.

### 3.7 X-4 — the stale case, named

The existing coverage tested a **forged** cookie: a context the session never
had. X-4's case is a **stale** one: a context the session genuinely did have and
has since lost, while the browser still carries the cookie. Slice 8 makes it
common on purpose — removing a role is now something a Club Admin does, and the
person it happened to may be looking at the club right then.

Three tests now name it (`identity_and_context.test.mts` 4c/4d/4e): a removed
club authority does not resolve, a stale cookie falls back to a context the
session really has, and losing the last context leaves nothing scoped.

---

## 4. Proof

### Server authority — `supabase/tests/step8_operational_access.sql`, 69 assertions, 0 failures

| section | what it establishes |
|---|---|
| A | one spelling for one role, in every catalogue a person reads; the key deliberately unchanged |
| B | a preset is an **exact capability delta** — one override and one event per capability, nothing outside its list, a second preset leaving the first's decisions alone, refused for a minor with **nothing left behind**, refused across a club boundary, refused to a Volunteer, an unknown preset refused as malformed |
| C | Pitch Allocation is discoverability, not new authority |
| D | **removing ONE role removes only what that role sourced** — the Team Manager role at another team, the club-wide Volunteer role, the Coach role at another club, the club membership and an unrelated explicit grant all survive |
| E | **suspension defeats a grant whose row still exists**, at rule 1, with `MEMBERSHIP_SUSPENDED`; reactivation restores only what the surviving grant describes; nobody reactivates themselves |
| F | the club timeline returns exactly this club's access events, refuses another club, refuses an ordinary member, keeps actor and subject distinct, and publishes no forensic field |
| G | `explain_access` agrees with every one of the above and names the decisive rule |
| H | **a Site Admin administering a club does not become a member of it**, and may still read its history |
| I | the persona matrix by capability decision, not by role name — a Fixture Secretary arranges matches and is **not** a people administrator; a Volunteer holding granted permissions cannot hand permissions on; another club's Club Admin holds nothing here; an adult-only permission cannot be given to a minor |
| J | **Safeguarding Officer** — no club may assign it (the catalogue says so), `assign_role` refuses it, not even a Full Site Admin may assign it, no preset carries a safeguarding-sensitive capability, a club cannot hand one out singly either, and the adult predicate is the database's own |

### Browser — the two suites the contract names by number

| | | |
|---|---|---|
| `47-club-people-and-access` | **25 assertions, 0 failures** | the lifecycle: inspect → understand → assign → inspect capabilities → `explain_access` agrees → audit history records it → remove → unrelated survives |
| `48-club-access-boundary` | **23 assertions, 0 failures** | the acceptance criterion: a Club Admin typing `/admin/users`, `/admin/site-admins`, `/admin/permissions`, `/admin/clubs` is sent away; a Volunteer who was given a job cannot hand jobs on; a Team Manager cannot reach the permissions screen; an outsider naming a membership id is sent away; another club's timeline is refused **in the database** |

Both use **disposable identities** and remove everything they create. No
persistent review persona is touched.

### Unit — `access_event_sentence.test.mts`, 7 assertions

Including the one that matters most: an event type the file does not recognise
falls back to its raw key. A timeline that invented a plausible sentence for an
event it did not understand would be confidently wrong about a change to
somebody's access.

### Accessibility and the two phone widths

Suite 47 runs axe on the surface Step 8 materially changed, at 1440, and walks
390 and 320. **No new serious violation.** The one violation reported is the
declared pre-existing application-shell unread badge (L22, ~3.1:1, owned by
whichever step owns the shell) — reported on every run, never suppressed, and
the baseline stays shrink-only.

It also asserts something the build itself taught: **no two controls on the page
answer to the same label.** Slice 8 added a Role select and a Reason field to a
page that already had both in the Team Access editor, and anybody navigating by
label rather than by sight would have got two identical answers. They are now
"Additional Role" and "Reason for This Role", and suite 47 G1 fails if a third
collision ever appears.

---

## 5. L25 — the Step 8 pass

**Every suite in Step 8's domain was run, not judged by its name.**

| | |
|---|---:|
| L25 BEFORE STEP 8 | **31** |
| STEP-8-OWNED DISPOSITIONED | **5** |
| L25 REMAINING | **26** |

### VERIFIED + canonical gate

| suite | measurement |
|---|---|
| `52-roster-authority` | 16 assertions green on the first run and **exit 1** — the `CRASH` shape L28 was closed to name. Its teardown died on a foreign key *after* reporting every assertion as passed, leaving its clubs behind: the same defect Step 7 found in suite 37. Teardown fixed to sweep placements by team as well as by player; now 17/17, exit 0, and its own cleanup assertion passes. |
| `58-club-admin-authority` | 30 assertions, 0 failures, exit 0, first run |
| `59-club-misc-authority` | 48 assertions, 0 failures, exit 0, first run |

### SUPERSEDED

| suite | measurement and successor |
|---|---|
| `45-capability-foundation` | aborts after 4 assertions waiting for a club allow the current screen no longer renders that way. The foundation it guarded is guarded far more thoroughly by `capability_precedence_truth_table.sql` (50), `capability_scope_isolation.sql` (22) and `step8_operational_access.sql` (69), all in the gate. |
| `51-role-negative-smoke` | hangs after one assertion; killed at ten minutes. Its negatives are asserted by `role_assignment_ceilings.sql` (28, in the gate) and by suite 48's persona refusals. |

### Still UNVERIFIED — measured, and deliberately not forced into a disposition

| suite | measurement | why not dispositioned here |
|---|---|---|
| `44-canonical-memberships` | aborts after 2 on a UI click timeout | its scope spans memberships, roles **and** family; only partly covered, and the rest is family-domain work Step 8 does not own |
| `46-family-authority` | 13 of 14; **F1** (a Site Admin seeing a person's family relationships) fails with HTTP 200 | a real single finding in the family domain; §34 keeps family a relationship, not an administrative shortcut |
| `57-safeguarding-authority` | hangs, killed at ten minutes, **0 assertions recorded** | nothing is known about what it would prove. Step 8 preserved the safeguarding rules rather than rebuilding them, and did not mutate the review world's pending nomination to make a suite green |
| `60-invitation-journeys` | 15 of 16; **G2** (a lower-case code accepted, so the normaliser does the work) fails | Slice 5 owns invitations, and Step 8 was told not to redesign them |

The other 22 belong to other programmes and were **not** mass-registered.

---

## 6. What Step 8 did not do

- **No new authority.** Every capability, ceiling, prohibition and event it
  touches already existed.
- **No roles/permissions redesign.** Slices 1–7 were consumed, not revised.
- **L26 untouched.** Step 8 did not modify the invitation fixture architecture,
  so the marker-versus-fixture-ownership question stays open and unbroadened.
- **L11, C6, C10** left with their own owners; nothing belonging to Slice 6b,
  7e or the perimeter closure was absorbed here.
- **Team Admin not resurrected.** `TEAM_ADMIN` survives only as a delegation
  *level* name returned by `internal.team_people_level`; `role_definitions` has
  no such row, the canonical role is `TEAM_ADMINISTRATION`, and Slice 10 owns
  dropping the string.
- **The persistent review world untouched.** No role, nomination, join request
  or invitation in `step2-review-rfc` was changed. Priya's
  `PENDING_CONFIRMATION` nomination is exactly as it was.
- **Nothing released. Step 9 not started.**

---

## 7. The acceptance gate — one stable tree, one complete run, unsplit

```
6495 passed, 0 failed across 255 suites.
GATE EXIT 0
```

| required | result |
|---|---|
| 0 FAIL | **0** |
| 0 KILL | **0** |
| 0 CRASH | **0** |
| 0 EMPTY | **0** |
| 0 missing required suites | **0** — the registry guard proves the runner list and the directory agree on every run |
| browser suites | **49 of 49**, 1,210 assertions |

Measured across the batch at 50 checkpoints: available memory never fell below
**2,378 MB**, and **zero browser processes survived between suites** at every
single one.

### The run before it, and why there were two

The first attempt returned **all 49 browser suites green** and **three SQL/JS
failures**. Every one was caused by this step's own work, and every one was the
estate refusing to let it pass unexamined:

| suite | cause | resolution |
|---|---|---|
| `perimeter_manifest` | two new tables and three new RPCs were not declared | declared, with classifications and consumers |
| `security_events_no_secrets` V6 | `apply_capability_preset` calls the event writer and was not on the allowlist | added, with the reason: the caller controls neither the event type (a literal in the body) nor the actor (`internal.actor()`) |
| `fixture_creation_races` C1 | **a real fails-in-batch / passes-alone intermittent** | root-caused, not accepted — see below |

**C1's root cause.** The test asserted that two staff creating the same external
fixture at once both persist. That stopped being true when
`internal.enforce_shared_team_fixture_capacity()` introduced the rule that a
team may hold only one match per day. Under that rule the outcome depends on
interleaving: two transactions in flight together both land, because neither
sees the other's uncommitted row; two that serialise end with the second
**refused by name**. It passed alone and failed under a loaded gate, which is
exactly the shape Step 7 §47 forbids accepting.

The product is right. The assertion was out of date, and it now asserts what the
test is actually for — that **neither attempt silently vanishes**: every one
ends either as a persisted fixture or as an explicit refusal naming the rule.
Proved stable over six consecutive runs before the gate was restarted.

Per the freeze rule, the tree was re-frozen and the gate **restarted from the
beginning** rather than resumed. The result above is that second, complete run.

---

## 8. Deferred manual review checkpoint

Manual Chrome review remains deferred. Isolated browser UAT was mandatory and
was done (suites 47 and 48, disposable identities, nothing persistent touched).

**The review world is exactly as Step 7 left it.** Verified at Step 8 closure:
Priya Nair's Safeguarding Officer nomination is still `ACTIVE /
PENDING_CONFIRMATION`, the six Step 7 review fixtures are still there, and
`step2-review-club.mjs verify` reports the same three differences it reported
before Step 8 — the club join request, Mina's player join request and the
`TEAM_JOIN_CODE`, all from the review administrator's own session on
**2026-09-18**. Nothing was repaired.

### What to look at, as the existing personas

```
node scripts/review-fixtures/step2-review-club.mjs report
node scripts/review-fixtures/step2-review-club.mjs verify    # prints differences, fixes nothing
```

| as | where | what is new |
|---|---|---|
| **Hannah Whitmore** (Club Admin) | `/people/<membership>` | **Other Roles** — give somebody Volunteer, see it appear as a canonical role assignment, remove it, and watch their team roles and membership stay exactly where they were |
| | same page | **How It Got This Way** — the club's own access history for that person, in words, with who did it and why |
| | `/club/permissions`, open a person | **Give them a job** — the three Volunteer presets; and the new **Pitch Allocation** group |
| **Gordon Pike** (Fixture Secretary) | `/club/permissions` | he cannot open it: he arranges fixtures, he is not a people administrator |
| **Nadia Oyelaran** (Volunteer) | anywhere | give her the Pitch Allocation job as Hannah, then check she still cannot hand it on to anybody else |
| **Priya Devlin** (Safeguarding Officer, pending) | `/people` | her appointment still reads as pending, and no screen offers to assign the role — an officer is nominated and accepts |
| **Karl Ndlovu** (direct capability override) | `/people/<membership>` | his explicit grant is still explained as an explicit allow, and a preset applied to somebody else did not disturb it |

The one thing worth trying deliberately: **suspend a membership** from the
people list and re-open that person's access page. Everything their role and
grants describe is still recorded, and every answer is now no — the engine says
`MEMBERSHIP_SUSPENDED` at the hard-prohibition rule, above any explicit
decision. Then reactivate, and only what should still exist comes back.
