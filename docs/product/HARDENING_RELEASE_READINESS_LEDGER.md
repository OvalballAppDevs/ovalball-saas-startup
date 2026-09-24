# Ovalball — Hardening / Release Readiness Ledger

Opened when the programme moved into **PRODUCT IMPLEMENTATION / UI-UX SPRINT
MODE** after Batch A. Everything here is **preserved verification debt**: it is
no longer a blocker to seeing the rest of the product, and it remains
**mandatory before production release** where applicable.

Nothing in this ledger lowers the release standard. **Step 21 remains the
exhaustive whole-product release audit.** What changed is *when* the cost is
paid, not whether.

**Batch A evidence is frozen where it stands** at
`71d23589531a5c3d44142f2423e5493ecb008118`, reported in
`docs/product/BATCH_A_CERTIFICATION_REPORT.md`. The batch is
**NOT TECHNICALLY ACCEPTED** and must not be described as accepted.

---

## H1 — The three open gate failures

The frozen-tree unsplit canonical gate exited **1** with **6,728 passed, 3
failed** across 323 suites. **None is a Steps 10–12 product regression, and all
three passed in an earlier run of the same tree.**

| # | suite | measured | owner |
|---|---|---|---|
| H1.1 | `76-branding-propagation` | FAIL S6BR-01 — *"with no crest of its own, the public Club Home shows the Club Directory's — (no club crest rendered)"*. 13 passed. Reproduces standalone; passed 14/14 in the prior run. The public club query **does** join `club_directory(logo_storage_path)` and calls `resolveClubLogoUrl`, and the Site Admin surface (S6BR-02) resolves the same fallback in the same run | **Step 6 / Club Digital Home** |
| H1.2 | `58-club-admin-authority` | CRASH after 1 assertion — `harness.mjs:269` *"The sign-in submit is still disabled 10s after switching to the link method."* Passed 30 in the prior run | **acceptance harness** |
| H1.3 | `59-club-misc-authority` | CRASH, same sign-in path | **acceptance harness** |

**H1.2 / H1.3 note:** the shared `signIn` helper still takes a **magic-link**
path, and the identity programme retired magic-link login. That is the likely
root cause and the first thing to check.

**No severe product, security or data-integrity defect was exposed by the run.**

---

## H2 — SQL suite governance

Implemented in Batch A and **working**; the remaining debt is classification, not
mechanism.

| | |
|---|---|
| Declaration source | `supabase/tests/suite-registry.json` |
| Runner | derives its gate list from it — no second hand-maintained list |
| Guard | `scripts/verify-sql-suite-registry.mjs`, wired into the gate |

| disposition | count |
|---|---|
| TOTAL | **286** |
| CANONICAL_GATE | 181 |
| SPECIAL_PURPOSE | 73 |
| UNVERIFIED | **32** |
| UNDECLARED | **0** |

- **H2.1** — the **32 UNVERIFIED** suites have no declared intent and have not
  been archaeologised. They are not coverage and nothing rests on them. Each
  needs a disposition on evidence. *Owner: each domain, coordinated by test
  governance.*
- **H2.2 — the prerequisite defect.** `permission_matrix.sql` and
  `season_transitions.sql` end with **`rollback;`**, so every SPECIAL_PURPOSE
  suite documented to run *after* them cannot work as written. Those suites are
  neither gate coverage nor currently runnable coverage. *Owner: test-fixture
  harness.*
- **H2.3 — known stale suites**, each with its measured cause recorded in the
  registry: `player_guardian_security`, `team_lifecycle`, `capability_engine`,
  `team_scoped_fixture_requests`, `fixture_results`, `fixture_status_lifecycle`,
  `fixture_age_eligibility`, `gender_age_grade_rules`, `player_team_dispensation`,
  `senior_cohort_graduation`, `player_movement_eligibility_resolver`. **No
  product architecture may be changed to satisfy an obsolete test.**

**Fixed in Batch A, recorded so it cannot recur:** the runner's old array listed
`site_admin_profile_matrix` **twice** — the gate ran and counted that suite twice.
Any assertion total reported before `71d2358` includes one suite twice.

---

## H3 — `46-family-authority` (L25 family domain)

**Teardown repaired in Batch A** and now independently repeatable: two
consecutive runs, identical results, **zero cleanup errors, zero residue**. The
previously recorded reason (append-only `audit_log` preventing identity removal)
was **wrong**; the real blocker was ownership drawn by tagged surname while the
blocking row was a product-named player in the run's own team.

**Still exempt, and still open:** A2/A4 fail because the Add Child flow completes
in the browser and shows "Waiting for Your Club" yet writes neither a `players`
row nor a `player_duplicate_reviews` row. *Owner: the family domain* — this is
the Add Child inconsistency Step 9 already deferred.

## H4 — L26, cleanup ownership

**OPEN.** `TEAM_JOIN_CODE` cleanup remains marker-scoped rather than
fixture-scoped. The invariant — *a test cleans only records it owns* — was
applied in the H3 repair, which is a worked example. *Owner: invitation /
test-fixture hygiene.*

## H5 — L27, `team.community.manage`

**OPEN, deliberately unactivated.** Granting it would let `CA@club · CO@team ·
TM@team` satisfy `internal.may_send_as` for a **team identity**, enforced on
insert by `internal.enforce_sender_identity` — broadening who may speak as a team
in Messenger. Needs a decision from the messaging-authority owner plus a
capability-catalogue decision. **Not to be granted to make Match Centre
convenient.**

---

## H6 — Migration history drift

**OPEN. No repair, no reset, no `schema_migrations` edit, no identity
destruction.**

| | |
|---|---|
| History tip | `20270430000000`, **521** rows |
| Migration files | **545** |
| Versions present as files, absent from history | **24**, contiguous `20270501000000` … `20270524000000` |
| History rows without a file | **0** |
| Cause | **UNKNOWN** — not guessed at |

**Verdict recorded in Batch A: MIGRATION HISTORY REPAIR — SAFE TO PERFORM**, on
the evidence of the semantic comparison below, **and deliberately not
performed.** Two stated limits: the comparison covered `public` and `internal`
schema objects, grants, RLS, policies and the seeded catalogues — **not** storage
buckets and policies, the `auth` schema, scheduled jobs, or every
migration-created backfill; and the range grew from 21 to 24 as Steps 11, 12 and
Batch A were applied incrementally by the same route.

Repair requires explicit owner authorisation.

## H7 — Clean-schema semantic comparison (evidence, keep)

Persistent UAT database vs a database built from empty, B unmodified:

| compared | result |
|---|---|
| `pg_dump --schema-only` of `public` + `internal`, 73,191 lines | 14 diff lines, 12 of them pg_dump session nonces |
| Function grants (anon/authenticated/service_role) + `SECURITY DEFINER` flags, table RLS state and CRUD privileges — 1,603 facts | **identical** |
| RLS policies with `USING` / `WITH CHECK` — 894 | **identical** |
| Capability bundle grants — 418 | **identical** |
| Seeded catalogues | **identical** |

Single difference: `internal.session_live_only()` — **whitespace only**.

## H8 — Clean boot and production-shaped rehearsal (evidence, keep)

- **Full-chain clean boot from empty: PASS.** Chain valid in canonical order, all
  Step 4–12 clean-boot assertions green, estate suites green on the fresh
  database including Step 11 (59) and Step 12 (34).
- **Production-shaped rehearsal: PASS.** Production tip read from the production
  project's own migration history — **`20270502000000`** — and 22 migrations
  applied one at a time, each dry-run first. Functions +4, policies +7,
  `internal.is_site_admin` 1 → 0. **No membership, role, profile, administrator,
  club, venue, pitch, team or fixture moved.**

Both must be **re-run at hardening** against whatever the tree is then.

## H9 — L7 release bridge

**Intact and must remain so.** `accept_invitation` and `get_invitation_preview`
are deliberately retained while deployed application compatibility requires them.
Production release still requires expand → deploy compatible application →
verify → **contract**. Batch A performed no contract, and sprint mode has no
authority to.

---

## H10 — Presentation findings for the UX owner

Recorded during Batch A, **not** fixed, and not blockers to using the product.

- **H10.1 — the local wordmark renders in the wrong face.** Measured in a real
  browser: computed `font-family` is identical locally and deployed
  (`"Bebas Neue", "Bebas Neue Fallback"`), but the **development server serves no
  real webfont at all** — 0 `src: url` faces, only
  `@font-face { font-family: Bebas Neue Fallback; src: local(Arial) }` with metric
  overrides — while a production build embeds **15** real sources, 9 of them
  Bebas. Locally: `Bebas Neue Fallback:loaded` only. Deployed:
  **`Bebas Neue:loaded`**. So local review shows Arial wearing Bebas's metrics.
  **Production is correct; this is local review fidelity.** Fix would be
  self-hosting the font files. *Owner: UX / build.*
- **H10.2 — shell identity block**, `1ffdcb6 feat(shell): one person, several
  places to stand`: names the signed-in person and current context where the
  deployed build names the club with its crest. **Deliberate, not a regression,
  not reverted.** For owner review, not for a sprint step to decide.
- **H10.3 — L22**, the application-shell unread badge contrast, shrink-only and
  reported on every run. *Owner: Application Shell / UX.*

**Standing brand rule:** the logo, wordmark, display typography and protected
brand assets are never changed incidentally.
`public/icons/Ovalball Square Logo.png` and
`public/icons/Overball Logo Low Res.png` stay untouched and untracked.

---

## H12 — Identity/Auth Slice 9 (Step 13) debt

- **H12.1 — `impersonation.blocked_action` is registered but never emitted.** The
  security event type exists in the catalogue. The view-only clamp lives in
  `internal.impersonation_permits`, reached from `internal.can`, which is
  `STABLE` and cannot write — so a refusal is currently silent. Emitting it needs
  a write-side hook. *Owner: Identity/Auth.*
- **H12.2 — the blocked list is a regex, and the catalogue has a column.**
  `public.capabilities` carries **`impersonation_blocked`** per capability.
  Slice 9's blocked areas are pattern-matched on the key instead, because the
  clamp had to work before the catalogue could be audited row by row. Reading the
  column is the right end state. *Owner: Identity/Auth + capability catalogue.*

## H13 — Governing Body foundation (Step 14) debt

- **H13.1 — no `organisation` scope in the capability engine.** *(Renamed by Step 16: the
  platform's own word is `organisation`, not `body`.)*
  `internal.capability_decision` takes club, team and player only, and
  `bundle_capabilities.scope_type` is constrained to five values. Step 14
  resolves governing-body authority through dedicated functions over
  `constituent_body_roles` rather than changing the signature of the function
  every authority decision in the platform calls. Promoting a sixth scope — and
  with it registering `governing.body.view` / `.manage` /
  `governing.competition.manage` in `public.capabilities` — is the right end
  state. *Owner: capability engine, with the Governing Body programme.*
- **H13.2 — governing-body navigation is a dashboard entry, not a nav section.**
  **CLOSED by Step 15.** The workspace became a first-class active context
  (`ActiveContextKind: "governing"`), so it is reached through the context
  switcher and has its own navigation, and the dashboard entry survives as the
  cross-context signpost for somebody currently acting as their club. Proven by
  `84-governing-body-product-journey` A1–A5 and the four new cases in
  `lib/app-context/active-context.verify.ts`.
- **H13.3 — affiliation has no lifecycle.** `club_directory.constituent_body_id`
  is a single current value with no history and no workflow. Step 14 deliberately
  did not invent one, and **Step 15 confirmed the decision after designing the
  UX**: a control that changes which county a club belongs to would silently
  rewrite what was true last season as well as this one. What it needs is a
  record of events — request, approve, transfer, suspend, effective from, and who
  decided — which is a table, not a button. The product surface states the gap in
  its own words on `/governing/[bodyId]/clubs`.
  *Owner: Step 16.*

## H14 — Governing Body product (Step 15) debt

- **H14.1 — a governing body cannot invite somebody who has no Ovalball
  account.** `access_invitations.kind` is a closed check constraint with no body
  shape and no body scope column, so representing one needs a new kind, a scope
  column, an `intended_outcome` shape and changes to `issue_invitation`,
  `accept_invitation` and `get_invitation_preview` — the protected contract
  surfaces. Step 15 therefore grants a role only to an **existing** account,
  resolved by exact email inside the RPC, and says so on the page. Extending the
  one canonical invitation system is the right end state; a second invitation
  path only this page understands is not. *Owner: Step 16.*
- **H14.2 — grant-by-email is a small account-existence oracle.** Because the
  address is resolved inside `grant_governing_body_role_by_email`, a BODY_ADMIN
  can learn whether an address has an Ovalball account. The exposure is bounded
  to authenticated administrators of a real organisation, and it is the direct
  consequence of H14.1: the canonical invitation path does not need to answer the
  question at all, because it invites the address either way. Closing H14.1
  closes this. *Owner: Step 16, with H14.1.*
- **H14.3 — a governing body has no way to reach its competitions' results as a
  competition record.** `governing_body_competitions` counts matches and results;
  it does not return a table, standings or a results list. Competition Match is
  the canonical truth and the public competition page already renders it, so this
  is a read model and a surface rather than new architecture.
  *Owner: Step 16.*
- **H14.4 — no organisation communications, and deliberately none.** There is no
  organisation-level conversation and no sender identity for a body
  (`club_conversations`, `team_conversations`, `direct_conversations`,
  `fixture_messages` are the whole set). Step 15 built no messaging and gave no
  "send as" anything, because a governing body sending as a club or a team is the
  Step 11 authority-coupling mistake in a wider blast radius. A body sender
  identity is a deliberate authority model, not a UI sprint decision.
  *Owner: Governing Body programme, needs a product decision first.*
- **H14.5 — no welfare or safeguarding oversight for a governing body.** Step 15
  surfaced none: a body relationship reaches no date of birth, medical field,
  guardian record or case note, and both the migration and the suite assert it.
  Whether a county has a legitimate aggregated welfare view — and what it may
  contain — is a safeguarding decision before it is an engineering one.
  *Owner: safeguarding architecture.*
- **H14.6 — the governing-body dispensation stage is an attestation, not a
  queue.** `decide_player_dispensation`'s `governing_body` stage is authorised by
  the SOURCE CLUB and requires a reference, because it records the certificate
  the club holds off-platform — the UI says "Ovalball records the governing
  body's approval; it does not grant it". Step 15 deliberately did not re-point
  it: doing so would change what existing records mean, including historical
  ones, and the data involved names a child and an age-grade exception. Whether a
  body should decide the stage **natively, beside** the attestation is a real
  product question with a migration behind it. *Owner: Step 16.*
- **H14.7 — `.verify.ts` suites are permanent tests outside the canonical
  gate.** `lib/app-context/active-context.verify.ts` (now 31 assertions,
  including Step 15's governing-context coverage) and its siblings are run by
  hand with `npx tsx` and appear in no runner, so a regression in them is
  invisible to the gate. Step 15 also found a **pre-existing failure** in that
  file, unrelated to this step: `switcherLabel` for two children on the same team
  returns the child's name where the suite expects `"Alex — Under 9"`. Recorded,
  not fixed — it is outside Step 15's scope and belongs to whoever owns the
  context switcher. *Owner: test governance (with H2), and the shell programme
  for the failure itself.*

## H15 — Competition / Governing closure (Step 16) outcome

**Five items closed, three deferred with an owner decision, one renamed.**

- **H14.1 governing-body invitations — CLOSED.** Through the canonical architecture: one kind
  (`GOVERNING_BODY_OFFICER`), one nullable `access_invitations.constituent_body_id`, one spec row at
  `scope_type = 'organisation'`, one disjunct in `issue_invitation`, one branch in `redeem_invitation`,
  and the organisation in `preview_invitation`'s label. No second table, no second token, no second
  redemption path.
- **H14.2 account-existence oracle — CLOSED.** `grant_governing_body_role_by_email` is **dropped**, and
  the one remaining path works whether or not the address has an account.
- **H14.3 body competition results and standings — CLOSED.** `governing_body_competition_matches` plus
  the existing `lib/competitions/standings.ts`. No second standings computation, and
  external-versus-external matches are visible because the module never looks at a fixture.
- **H13.3 affiliation lifecycle — CLOSED BY DECISION, not built.** `club_directory.constituent_body`
  holds the county's **published name** beside the FK, sourced from the county unions' own club lists.
  Which county a club belongs to is a published fact, not an agreement two Ovalball parties reach, and
  the repository contains no requirement for a lifecycle. The Clubs page states where the list comes
  from and offers no control that would overwrite it.
- **H13.2** remains closed (Step 15).
- **H13.1 organisation capability scope — DECIDED, NOT IMPLEMENTED, and renamed.** The engine already
  names it: `internal.capability_decision` refuses `organisation` at rule 1 with
  `SCOPE_NOT_IMPLEMENTED`, and `public.capabilities.valid_scopes` already permits the word. Step 16
  registered **`governing.access.manage`** with `valid_scopes = {organisation}` — required, because
  `access_invitations.issuer_capability` is a foreign key into that catalogue — so the vocabulary has one
  home while the scope stays unimplemented. Implementing it means a new parameter on the platform's
  most-called function, plus the override model and `bundle_source`; `step16_governing_closure` **A6**
  and **J1–J2** hold the line, and **A6** specifically forbids asking the engine for the scope, which is
  the actual trap. *Owner: capability engine.*

### Step 16 hardening pass (from `1858392`) — what it found

**One product defect, three verification gaps.** The Step 16 suite was thorough — 72 assertions covering
most of the handoff's cross-boundary list — so the hardening pass went looking for what it did *not* ask.

- **Accepting an invitation lifted a suspension.** §28 asked whether a revoked or suspended person loses
  authority; the suite proved neither, because it tested revoking an *invitation* and never a *role*.
  Revocation turned out to be correct. Suspension was correct for every read and every authority
  predicate — `internal.body_role()` requires `ACTIVE` — but `redeem_invitation`'s upsert sets
  `state = 'ACTIVE'` with a conflict target of `state <> 'REVOKED'`, so it matched a SUSPENDED row too.
  **Measured: a SUSPENDED `BODY_COMPETITIONS` officer redeemed and came back an ACTIVE `BODY_ADMIN`** —
  reinstated *and* escalated by clicking a link. That contradicts the rule this platform states for the
  club role machine, where suspended authority survives even a full club reactivation: *"reactivate_club()
  deliberately does NOT clear it … data returns, privileged authority does not silently return with it."*
  Fixed in `20270530000000`. **Latent, not live** — nothing writes `SUSPENDED` today; it is vocabulary the
  table and the People page carry, so this closed the path before it was reachable.
- **The first fix was wrong, and an existing test caught it.** It refused by raising, which
  `invitation_authority_matrix` **IN-K2** rejects: this function refuses by *returning*, because a raise
  rolls back the attempt record and defeats the redemption rate limits. Redone as a returned
  `REFUSED / ORGANISATION_ACCESS_SUSPENDED`, matching the `AGE_ELIGIBILITY_REQUIRED` precedent. The
  migration's own guard now pins the raise count at three so a fourth cannot creep in.
- **The refusal would not have reached the person.** `lib/invitations/redeem.ts` shows a specific message
  only for reasons on an allowlist, so the new reason failed closed but read as the generic sentence,
  hiding the one action available. Added to `ACTIONABLE_REASONS` — safe, because the branch is only
  reachable after step 6 has matched the redeemer's confirmed email to the invited address.
- **§17's external-versus-external requirement was claimed, not proven.** *"External-v-external
  Competition Matches must remain visible to the organiser even when zero Ovalball Fixtures exist."*
  Every participant in the suite's E series was an Ovalball club with an Ovalball team. Now proven
  (**L1–L6**) with two directory-only clubs, zero fixtures, and the organiser still reading the match —
  and it passed first time, so this was a verification gap, not a defect.
- **A VIEWER's email redaction was never asserted.** `governing_body_people` returns addresses only to
  somebody who can manage access. Written in Step 15, now pinned (**K12–K13**).

The suite goes **72 → 91** assertions. K9–K11 were confirmed to fail against the pre-fix function, which
was replayed from a `pg_get_functiondef` snapshot rather than restored from git.

### New Step 16 debt

- **H15.1 — governing-body invitations are not emailed.** The invitation is fully canonical, but
  Ovalball has no `governing_body_invitation` email event, so People & Access gives the administrator a
  link to send and **says so** rather than claiming an email was sent. Adding the event touches five
  files — `lib/email/catalogue.ts`, `wiring.ts`, `contracts.ts`, `templates.ts` (type, `copyFor` and a
  renderer) and `preview-fixtures.ts` — plus the email guards. *Owner: email programme.*
- **H15.2 — React's development performance instrumentation throws on interrupted transitions.**
  `Failed to execute 'measure' on 'Performance': '<Component>' cannot have a negative time stamp`,
  when a client-side transition is navigated out of. `85-competition-governing-closure` filters that
  exact message and nothing else, and records the count. Not an application error, and not silently
  dropped. **It has now recurred**, in `87-shell-coherence`, whose H6 probe walks twelve routes in
  succession: the Step 18 hardening pass saw it once on `FixtureMatchCentrePage` and then not at all on
  an otherwise identical re-run, which is what an instrumentation race looks like. Suite 87 filters it on
  the same terms and reports the same count, so the filter is defensive rather than load-bearing — on the
  final run it did not fire, because no such error occurred. *Owner: test harness; two suites now carry
  the same filter, and a third would be the point to lift it into a shared helper.*
- **H15.3 — competition standings are computed in TypeScript only.** Correct today, and deliberate: the
  module is the one source and the public page and the governing page both consume it. A native client
  would need the same answer from the server. *Owner: whoever builds it.*

### Deferred with an owner decision (see the Step 16 report's register)

- **H14.4 messaging.** The *organiser↔club* channel existed as notifications and was **mis-routed**;
  that is fixed. A governing body as a **sender identity** has no model and is not invented.
- **H14.5 welfare.** Every safeguarding concept in the platform is club-scoped; nothing escalates to a
  county and no table records a body's involvement in a case. There is no under-specified feature, there
  is no feature.
- **H14.6 native governing-body dispensation.** The stage is the club's attestation, there is no column
  in which a native decision could be recorded, and existing rows' `governing_body_decided_by` points at
  club administrators. Reinterpreting them would falsify them.

## H16 — Identity/Auth Slice 10 (Step 17) outcome

**Slice 10 is legacy retirement, and measured against its own acceptance NO DROP IS DUE.** The
acceptance is *"zero references in CI; full runner, clean boot and all browser suites green; production
usage telemetry zero for 30 days before each drop"*. The estate is now **measured** rather than
estimated, by `scripts/verify-slice10-retirement.mjs` against
`supabase/security/slice10-retirement-baseline.json`, wired into the gate:

| target | db | ts | ci |
|---|---:|---:|---:|
| `team_permissions` | 22 | 14 | 91 |
| `has_capability` adapter | 62 | 7 | 31 |
| `club_memberships` legacy columns | 39 | 0 | 14 |
| `site_admins.admin_role` | 5 | 6 | 108 |
| `site_admins.manage_*` flags | 6 | 0 | 5 |
| `profiles.account_status` | 2 | 4 | 12 |
| `permission_groups*` | 1 | 3 | 4 |
| `role_capability_defaults` | 0 | 1 | 7 |
| `invite_player_account` | 0 | 1 | 3 |
| Phase 0 signup binding | 0 | 1 | 0 |
| legacy invitation tables | 7 | — | — |
| legacy plaintext-token issuers | 2 | — | — |

**458 references, 12 targets, no target at zero.** The ratchet allows every count to fall and refuses
any rise — including refusing to write a baseline that would legitimise one, which it demonstrated
during Step 17 itself.

### Closed by Step 17

- **The last browser-reachable plaintext legacy invitation token is gone.**
  `club_ovalball_invitations.token` was SELECT-able by a signed-in club administrator; the grant is now
  column-scoped and omits it. `invitations` INSERT/UPDATE — which let a session write a legacy invitation
  with a plaintext secret of its own choosing — is revoked. **Zero** browser-reachable invitation secret
  columns remain anywhere in the schema, asserted as a hard zero rather than a ratchet.
- **The canonical table stopped publishing its hash material.** `access_invitations.token_sha256` and
  `code_hmac` are no longer readable by a browser role. A digest redeems nothing, but `code_hmac` is the
  HMAC of a short human code and there is no reason to make the pepper the only obstacle.
- **A guard that was asserting something untrue.** `verify-legacy-invitation-token-readers.mjs` claimed
  *"THE LIST IS NOW EMPTY"* while `send_replacement_guardian_invitation` handed out a plaintext legacy
  token; its regex required a `returning … token` clause and that function uses
  `returning * into v_row` then returns `v_row.token`. It now also reads what a function gives back, and
  strips comments first — without that, the word "invitations" in an English sentence reported the
  *canonical* issuer.

### New Step 17 debt

- **H16.1 — `send_replacement_guardian_invitation` still issues a plaintext legacy token.** It is now a
  **named shrink-list entry** with a reason and an owner rather than hidden by a regex hole. It cannot
  move to `public.issue_invitation` until `link_guardian_to_existing_player` and
  `create_player_for_guardian` accept a canonical invitation id — both take a legacy row id, and the
  canonical `GUARDIAN` redemption links nobody. Exposure is bounded: `guardian_invitations` has **no
  grant to `anon` or `authenticated`**, so only SECURITY DEFINER functions can read it.
  *Owner: family architecture, with Slice 10.* **Owner ruling requested** — see the Step 17 report.
- **H16.2 — every drop still owed.** Twelve targets, 458 references, and two preconditions that cannot be
  met until something is deployed: the full runner/clean boot, and 30 days of zero telemetry. §20's
  release bridge (`accept_invitation`, `get_invitation_preview`) is itself a drop target.
  *Owner: hardening and release.*
- **H16.3 — T7 magic-link removal is not due.** `/login` is password-primary with *"Email me a link
  instead"* present, and the acceptance harness signs in through it. T7's gate is zero magic-link
  sessions for 30 days. *Owner: release.*
- **H16.4 — two SPECIAL_PURPOSE suites fail on their own seeding, unrelated to Step 17.**
  `parent_add_child_regression` dies on a Team Directory catalogue mismatch (*"There is no boys team at
  U10"*), and `admin_user_management` on a `club_memberships_club_id_fkey` violation. Neither error
  mentions any table Step 17 touched. *Owner: test governance, with H2.*

## H17 — Application UX 4–7 (Step 18) outcome

**Three of the four slices were already substantially complete**, by later convergence work rather than
by UX: club navigation grouping and the bin relocation (UX-5, entirely), the mobile top bar, the shared
hamburger IA and the 44px targets (UX-4), and the Rugby Hub return path (UX-6). Recorded in
`CONVERGENCE_STEP_18_ARCHAEOLOGY.md` with the evidence, so nothing was rebuilt.

### Closed by Step 18

- **UX-4 — primary destinations are one tap away on a phone.** A context-aware bottom bar, built from
  `buildNavItems`, with a *More* cell that opens the drawer that still holds everything. 44px+ targets, no
  truncation and no overflow at 320px and 390px.
- **UX-4 — the shell reserves the space its own furniture occupies.** The floating widget's allowance was
  a per-page `pb-28` that 8 of about 100 files remembered; it is now declared once. The widget also used
  to sit **on** the new bar and now clears it.
- **UX-6 — the public club home is no longer a dead end.** It matters more than when the audit was
  written, because Step 16's affiliated-club list links into it.
- **UX-7 — measured, not asserted.** axe at AA on four shell routes at desktop **and** 320px: **0
  violations**, not "0 introduced". Keyboard focus on the bar, one `h1` per shell route.

### Step 18 hardening pass (from `1507ed3`) — what it found

**The implementation pass shipped the shell working, and its verification was thinner than it read.** Six
product defects and four verification defects, all measured rather than reasoned:

| # | defect | fix |
|---|---|---|
| 1 | **A team context's bar carried no team.** `buildBottomBarItems` chose from a static href map, and a team's destinations are addressed by the team's id, so the one destination team staff came for could not be named | `activeTeamId` parameter, as `buildClubSections` already takes; the team sits second, after the page they land on, matching the desktop sidebar's order |
| 2 | **The team cell was labelled with the team's display name.** "Under 12 Boys" clips in a five-cell bar, and a club may field a side with a longer name still, so no label list fixes it | `bottomBarLabel` gained a by-shape rule: a `/teams/<id>` href reads **Team**, the word the desktop sidebar already uses for that group |
| 3 | **`/calendar` can also carry a team's name.** A view-only person with exactly one team gets their team's name as the calendar label — useful in a sidebar, unbounded data in a 60px cell | overridden to **Calendar** on the bar |
| 4 | **"People & Access" (15 characters) clipped** on the governing bar | by-shape rule → **People** |
| 5 | **The cell's own padding cost more than it was worth.** Measured at 320px: a 64px cell gave a 56px label box, clipping "Dashboard" (57px) and "Rugby Hub" (58px). At 360px the governing bar's "Competitions" (70px) missed a 68px box **by two pixels** | the cell's horizontal padding removed entirely — the label is centred and truncating, so it bought nothing and cost width, and the tap target is the whole cell regardless. The box becomes the cell: 64px at 320, 72px at 360, 78px at 390 |
| 6 | **Two more pages still carried their own allowance for the floating widget** — `club/setup` (`pb-32`, guarding the Continue/Finish button) and `parent/players/[id]/subscription` (`mb-16`). The implementation pass found four and stopped | both removed; the shell reserves it once |

| # | verification defect | correction |
|---|---|---|
| 7 | **H17.4 was wrong.** `navigation_architecture.test.mts` was reported broken with `ERR_MODULE_NOT_FOUND`; it had been run with `npx tsx` instead of the gate's loader. It passes **17/17** | claim withdrawn above; found by hitting the identical error on this pass's own new suite |
| 8 | **The governing bar had never actually been measured.** The implementation pass navigated to a governing URL without switching context — context comes from the cookie, not the URL — so it measured the CLUB bar under a governing page | the suite now switches through the switcher and measures what renders |
| 9 | **A safe-area assertion proved nothing.** `pb-[env(safe-area-inset-bottom)]` computes to `0px` in a headless browser with no home indicator, so asserting the computed value was vacuous | it now asserts the declaration, and reports the computed value beside it |
| 10 | **A clipping assertion was blanket where the truth is per width** | reported per width: clean at 360px and 390px; at 320px, at most the one accepted label, and its full text asserted present for assistive technology |

**The label budget is now measured rather than estimated.** The implementation pass guessed 16 characters,
the first hardening attempt guessed 12; the measurement is **11** for a 320px cell (64px box at 11px).
`bottom_bar_projection.test.mts` enforces it with exactly one documented exception — **"Competitions"**,
12 characters needing exactly **70px**. Measured per width, it fits at **390px (78px)** and **360px
(72px)** — the two widths most phones use — and truncates **visually at 320px (64px) alone**, where its
full word stays in the DOM so the accessible name is complete. Abbreviating a governing body's own word
for a first-class destination would have been worse than the truncation.

### New Step 18 debt

- **H17.1 — the bottom bar's destinations are a curated map plus a fallback.** `buildBottomBarItems` names
  preferred hrefs per context and otherwise takes the first four a context offers. The fallback means a new
  context works on a phone the day it is added; the curated part means the map must be revisited when a
  context's jobs change. It is one function with the reasoning written in it, not scattered.
  *Owner: UX, when navigation next changes.*
- **H17.2 — `bottom-bar-label.ts` is a four-entry label override.** It exists because some sidebar labels
  ("Overview" for `/people`, "Fixture Control Centre") do not stand alone in a 78px cell. If it grows, the
  sidebar labels are the problem. *Owner: UX terminology work, with UX-0 §15.7.*
- **H17.3 — `SessionContext` test fixtures cast through `as unknown as`.** That is why Step 15's new
  `governingBodies` field passed the compiler and threw at runtime in two suites, found by this step. Two
  fixtures are fixed; five files use the pattern. *Owner: test governance, with H2.*
- **H17.4 — WITHDRAWN, and it was my error.** Step 18 reported `navigation_architecture.test.mts` as
  failing with `ERR_MODULE_NOT_FOUND` before any assertion. It does not fail: it was run with
  `npx tsx`, and these suites require the gate's own loader, which maps the `@/` alias and stubs the
  `server-only` package that throws outside a React Server Component graph:

  ```
  node --import ./scripts/email-test-loader.mjs --experimental-strip-types --test <file>
  ```

  Run that way it passes **17/17**. The Step 18 hardening pass found this by hitting the identical error
  on its own new suite. Nothing was wrong with the product or the test; the claim was wrong.

### Owner review, not defects

- **The person-first identity block** (UX-2, §8 of the Step 18 authorisation) was **evaluated and kept**,
  with the reasoning recorded. It is directional, so it is the owner's call rather than a defect.
- **The dev-only wordmark/webfont rendering difference** remains untouched UX owner debt (§23).

## H18 — UX-8 entrance journeys (Step 19) outcome

**One security defect, one cross-step integration defect, six product defects. FUNCTIONS LOST 0.**

- **H18.0 — CLOSED, and it was a live open redirect.** `app/security/verify/verify-flow.tsx` read `next`
  straight off the query string into `window.location.assign`, so
  `/security/verify?next=https://evil.example` sent a person who had just passed their second factor to
  another origin. `lib/auth/safe-next.ts` had fixed the identical hole on the password path in Slice 5,
  and its own header predicted this one: *"two copies of an open-redirect guard is exactly how one of
  them drifts."* There were three consumers, not two. Fixed, and
  `scripts/verify-redirect-targets.mjs` now fails the gate if a fourth appears — the comment could not
  prevent this, and a guard can.
- **H18.1 — CLOSED. A granted governing-body role reported itself as a failed invitation.** Step 16
  taught `redeem_invitation` to answer `BODY_ROLE_ACTIVE`; `SUCCESSFUL_REDEMPTION_OUTCOMES` never
  learned the name, and the chokepoint fails closed on an unrecognised outcome — correctly, for one it
  does not know, and wrongly for one it merely forgot. So the database granted the role and the page
  said *"That invitation or code can't be used."* **The Step 16 SQL suite passed because it called the
  RPC; the Step 16 browser suite passed because it never accepted an invitation as the invitee.** This
  was the seam between them, and `88-entrance-journeys` is now the suite that sits in it.
  `lib/invitations/entrance-landing.ts` is keyed by the outcome union, so an outcome can no longer be
  added without a landing.

### New Step 19 debt

- **H18.2 — the invitation preview does not say what relationship you would gain.** UX-8 §7 illustrates
  *"Role: Fixture Secretary"*. Deferred deliberately: it needs a new column on `preview_invitation` (a
  drop-and-recreate of a public RPC) and a label authority for club-staff invitation roles, which are
  stored as `COACH` / `TEAM_MANAGER` and have none. Governing roles do (`lib/governing/roles.ts`).
  Creating a second naming authority to fill a preview line is the wrong trade. *Owner: whoever owns
  club-role presentation.*
- **H18.3 — there is still no player or guardian self-service entrance.** §15.4 rows D and E, §15.6
  proposal 6. Its blocking dependency is now **gone** — the approval surface exists
  (`app/(app)/club/join-requests`, `list_pending_club_join_requests`, `approve_club_join_request`) — so
  this is buildable, and it is a product journey rather than an entrance-coherence repair. An uninvited
  player whose club is unclaimed is now told the truth instead of being walked into a claim, which is
  the honest interim state, not the finished product. *Owner: a product slice of its own.*
- **H18.4 — `ovalballSignupPayload` still exists** in `lib/signup/complete-signup.ts`, the legacy
  pre-SO-4 metadata path kept for one release. Step 19 built the intent fork on the canonical
  `auth_flow_states` carrier and did not extend the legacy payload. *Owner: 6b.2c retirement.*

### Measured, not asserted

axe WCAG 2 A/AA on the changed entrance surfaces: `/join` unauthenticated at 1280 — **0 violations**;
`/join` at 390px — **0**; `/signup` at 390px — **0**; the governing workspace landed in — **1 total, 1
pre-existing and declared, 0 introduced** (the shell's unread-badge contrast, `SHELL_PRE_EXISTING_VIOLATIONS`).
No sideways scroll at 390px or 320px on either entrance, and the single primary action measured 44px at
both widths.

## H11 — Owed at hardening, in one list

Complete canonical gate on a frozen tree · full-chain clean boot ·
production-shaped rehearsal from the then-current production tip ·
persistent-schema comparison · migration-history repair decision ·
SQL-suite governance closure (H2) · stale-test reconciliation ·
security and authority sweep · cross-domain regression · full browser
regression · mobile · accessibility · race and concurrency · release readiness.

## H12 — Mobile, owed at hardening

The React Native client reached PRODUCT IMPLEMENTATION COMPLETE for M0–M3 (shell, auth, recovery,
Home, Messages). What is deferred is recorded here so it is owed rather than forgotten. None of it is
ordinary unfinished UX — those are finished or say plainly that they are not built.

**Proof that cannot be obtained on this machine**

- **No native run has ever happened.** There is no Xcode and no Android SDK here, so neither platform
  has been launched: every automated proof is Expo Web, which is the same component tree, the same
  router and the same readers. It does **not** exercise `expo-secure-store` (the session falls back to
  `localStorage` on web), the real safe-area insets, or native keyboard behaviour. The owner reviews
  on a physical iPhone through Expo Go; a **development-build proof** is owed.
- **Expo Go is not App Store behaviour.** Custom-scheme and universal links behave differently in a
  signed build, and the recovery hop below exists only because of it.

**Deferred mobile work**

- **Push notifications** (APNs/FCM), notification permissions and badge counts — M7. The route is
  ready: a notification becomes a typed intent and the intent is already handled.
- ~~**Realtime messaging.**~~ **DONE at M4** — the platform's own private channel per conversation is
  reused. The broadcast carries no content, so the reaction is to re-read through RLS, which is why
  reusing it adds no new way for a message to reach a device. The INBOX still refreshes on
  app-resume, context change and read rather than subscribing to every conversation at once; that
  remains owed.
- **Offline message behaviour.** Network loss is a product state with a retry; there is no queue, no
  optimistic send and no local cache of conversations.
- **Attachments, document shares and contact cards.** The canonical reader returns them with signed
  URLs; there is no native renderer, so a message carrying one shows its text. **Creating** one is a
  separate job again — M4 deliberately did not build an upload path.
- **Optimistic send.** A message is shown only once the server has it. A bubble that appears sent and
  later turns out not to be is the one outcome worth avoiding in a product where somebody may act on
  having told a parent something; the composer holds a short pending state instead.
- **Offline outbox.** A failed send keeps the draft and says so; nothing is queued for later.
- **Announcements and Support threads** are listed with their unread state and are not openable — they
  have their own reply rules and deserve their own screens rather than a conversation view that would
  misdescribe them.
- **Message reporting, deletion and moderation** — the platform has all three; none is on the phone.
- **Delivery and read receipts** beyond the platform's existing unread semantics.
- **Background refresh** of any kind.

**Decisions owed before release**

- **Leaked-password protection at the auth server.** Ovalball's Have I Been Pwned check lives in the
  website's `server-only` validator, so it does not run when the mobile client sets a password through
  GoTrue. Project-level leaked-password protection would cover both clients and close the web's own
  direct-API gap. Recommended, and an owner decision.
- **Abuse protection on the mobile reset request.** Turnstile is a browser challenge with no native
  widget; the protection today is GoTrue's per-address rate limit.
- **`password_requirements = ""`** — uppercase and special characters are enforced by Ovalball's
  validator and not by GoTrue, pending owner decision AN-1.
- **The Expo Go recovery hop.** `/auth/mobile-recovery` exists because Supabase refuses an `exp://`
  redirect to a LAN host. It is development-only and disappears with a development build; it must not
  be configured in production.
- **Suspended or disabled accounts** have no mobile presentation. Not a dead end — signing in still
  resolves — but the app cannot name that state.
- **Store and signing**: Apple Developer membership, Play Console, `eas.json`, distribution
  certificates, push credentials, app icons at store sizes, and privacy manifests for both stores.
  None obtained; none needed before a development build.

---

## M6 — Match Centre, Training Centre and Availability

**Carried forward from the slice, not blocking the product**

- **The match community layer** (awards, recognition on a played match) is on the web's Match Centre
  and is not on the phone. It is its own product with its own locked decisions rather than a section
  to port, and an upcoming Match Centre must not look like a post-match awards page — so the native
  surface renders nothing for it, as the web does for an upcoming fixture.
- **Tell The Squad** on the Training Centre. The fixture equivalent (Announce to the Squad) is native;
  the training composer, which uses `training_communication.send` and its own audience counts, is not.
- **Message moderation on a fixture thread.** `can_moderate` comes back from the canonical
  capabilities and the native Match Centre does not act on it — the thread screen is M4's.
- **Realtime availability.** Neither client subscribes: the web's Match Centre is `force-dynamic` and
  re-reads on navigation, and the app refreshes on focus, after a mutation and on pull. A manager
  watching a screen while answers arrive will not see them move without one of those. Building a
  mobile-only subscription was rejected deliberately — it would be a channel the two clients then
  disagree through.
- **Offline availability.** Previously loaded data stays on screen; an answer that did not reach the
  server is reported as not recorded and nothing is queued. Draft reasons are not preserved because
  there are no reasons to preserve (see below).
- **An unavailability REASON or note.** The canonical model has no such column. The brief asked for
  parity if the web supported it; it does not, so nothing was invented. If it is wanted it is a
  platform change first.
- **Dynamic Type.** The native type scale is fixed. It clears the 44pt target and the contrast floor,
  but does not yet respond to the system text-size setting.
- **`internal.may_complete_player_profile`** still exists with no callers and retires with the Slice 7
  site-admin pass. Untouched here.

**Found outside this slice's scope, documented rather than fixed**

- `supabase/tests/training_management_regression.sql` assertion **9b** fails. It asserts that
  `training_plans` remains readable to somebody with no club membership — "the read posture is
  intentionally open". Migration `20270366000000` (calendar/venue/training policies canonical)
  deliberately closed that posture. The assertion is stale with respect to a security improvement made
  in a previous slice; the product behaviour is correct. 34 of 35 pass.
- The Supabase **migration history table** stops at `20270533000000` while `20270534000000` (M4) and
  `20270535000000` (M6) are applied to the live local database. Left unrepaired per standing
  instruction. Clean-boot proof of the chain from empty is therefore still outstanding for both.

---

## H19 — CA-M1 migration divergence: `20270540000000`

**OPEN. Recorded before CA-M2 began. Facts only.**

- Migration `20270540000000_the_club_profile_is_a_domain_operation.sql` was applied to the
  persistent local database by `npx supabase migration up --local` during CA-M1.
- Its file was subsequently amended in the working tree: `save_club_contact` gained defaulted
  parameters (`p_contact_id uuid default null`, `p_role`, `p_name`, `p_phone`, `p_email` default
  null, `p_is_public` default false) so the generated TypeScript type makes the contact id optional.
- That one function definition (`create or replace function public.save_club_contact(...)`, same
  identity signature `(uuid, uuid, text, text, text, text, boolean)`) was re-executed locally by
  `psql`; grants were unchanged and re-verified.
- The persistent local migration ledger (`supabase_migrations.schema_migrations`, version
  `20270540000000`) therefore holds the statements as first applied, which do not exactly match the
  repository file that was banked in `2221540`.
- No persistent database reset is permitted.
- No migration-history repair is authorised.
- A disposable clean-boot / full-migration-chain proof from empty remains required before release
  verification, for this migration as for `20270534000000` onward (see M6 above and H6).

Not to be "fixed" during CA-M2. Hardening debt.

## H20 — `club_admin_authority_matrix.sql` CH-A: `finance.subscription.view` scopes

Observed 2026-09-24 while running the neighbouring suites for CA-M3 (People & Memberships).
`supabase/tests/club_admin_authority_matrix.sql` reports two CH-A failures: the assertion that
`finance.subscription.view` is ACTIVE with scopes `{club}`. The catalogue row has scopes
`{club,team}` since `20270531000000_a_team_manager_can_see_their_own_squads_subscriptions.sql`
gave a Team Manager the team-scoped view. The test predates that migration and was not updated
with it; neither file is touched by CA-M3, which adds nothing to the capability catalogue. The
suite's other 78 assertions pass. Owed: decide whether the assertion should read `{club,team}`
(the migration's intent) — a one-line test change in the finance slice that owns the key. Left as
found, per the rule that findings outside the current slice are recorded, not fixed.

## H21 — Observed while running the neighbouring suites for CA-M4 (2026-09-24)

Facts only; none is caused by CA-M4 (its migration touches no catalogue row and none of these files)
and none was fixed, per the rule that findings outside the slice are recorded.

- `capability_catalogue_integrity.sql` CI1 / CI4a / CI4b: `governing.access.manage` (from the
  governing-body slice, `20270527000000`) is counted as a 182nd active key, lacks full metadata and sits
  in no bundle. Owed to the governing slice.
- `authority_helper_retirement.sql` HR1: `can_organise_competition` is referenced from three function
  bodies against a ceiling of two; the third is `public.governing_body_competitions`
  (`20270527000000`, banked 2026-09-21 after the ledger's ceiling was set). Owed to the governing slice.
- `session_boundary.sql` SB-11 expects exactly one RLS table (invitations) to accept a browser-role
  INSERT without a RESTRICTIVE gate and now finds zero — stricter than asserted, not weaker. Owed a
  one-line assertion update in the session slice.
- `capability_engine.sql` and `club_settings_capability_security.sql` (both UNVERIFIED) and
  `fixture_management.sql` (SPECIAL_PURPOSE) fail on environment shape (`on conflict` without a
  matching constraint; `permission denied for table` under `set role`). Not part of the canonical gate.
- `club_admin_authority_matrix.sql` CH-A `finance.subscription.view`: H20, unchanged.

## H22 — CA-M4 turned `R` on: permanent browser suites that now need an authenticator

`set_capability_override`, `revoke_capability_override` and `transition_club_membership` (suspend /
restore / remove of another person) require a code entered within ten minutes on the current session.
Two permanent browser suites drive those operations with a magic-link session and no enrolled
authenticator and will refuse until they enrol one through `enrolAuthenticator` in the harness:
`scripts/browser-verification/90-team-fixture-authority.mjs` (Withhold / Reset on
`/club/permissions`) and `scripts/browser-verification/44-canonical-memberships.mjs`
(`transition_club_membership` over REST with the admin token). `20-planner-persona-matrix.mjs` calls
the override through `psql` (no session claim) and is unaffected. Owed at hardening, with the
enrolment done in the suites' own setup and cleaned up in their teardown.


## H23 — CA-M6 Rugby Hub: owed at hardening

- **Physical-device review of the visual layer.** The explainers, hotspots, Reduce Motion and image
  loading were proved on Expo Web and exported for iOS; they have not been run on a physical iPhone in
  this slice. The owner's review through Expo Go is owed, in particular the 44 pt hotspot targets over
  a 3:2 image at 390 pt and VoiceOver reading of the "In words" block.
- **Image caching and first-launch weight.** The 24 approved scenes ship in the bundle (5.4 MB of
  JPEG). If the app's size budget tightens, move them to remote assets with `expo-image` caching and
  an app-owned placeholder; the manifest asks for a key, so the change is confined to `assets.ts`.
- **Deeper offline.** The Hub's in-memory cache is stale-while-revalidate and cleared on sign-out; a
  persisted read model for offline reading is not built and is not promised by any screen.
- **Related Rules on a concept.** `hub_regulatory_fact_references` links 82 facts to concepts, but
  some concepts (for example `the-breakdown-and-ruck`) have none, so the Related Rules block is
  absent there on both clients. Editorial data, not a defect; recorded so a reviewer does not read the
  absence as a mobile gap.
- **Higgsfield billing.** The owner reported an unlimited Nano Banana allowance; the CLI account
  (`ovalballapp@gmail.com`, plus plan) still debited 2 credits per Nano Banana job on 2026-09-24. Any
  further regeneration should confirm the allowance against the balance first.

## H24 — CLOSED by CA-M7.1: a kick-off change is a fixture edit

**Status: CLOSED** (CA-M7.1, migration `20270549000000_a_kick_off_change_is_a_fixture_edit.sql`;
checkpoint recorded in the banking commit that follows `067befb`).

**Cause.** Every mutation that changes when or where a fixture is played -- `update_fixture_kickoff`,
`update_fixture_schedule`, `update_fixture_meet_time`, `update_fixture_pitch`, `update_fixture_venue`,
`reject_fixture_kickoff_change` and the free-text ground branch of `update_fixture_details` -- asked
`internal.can_submit_fixture_result` (`fixture.result.record`), and the read model
`fixture_editable_fields.schedule` reported editability from the same key. The CA-M7 forensic pass
found the kick-off case; the CA-M7.1 pass found the rest were the same defect.

**Fix.** One helper, `internal.can_edit_fixture_schedule(fixture)` = `internal.caller_fixture_club_id`
is not null (the existing either-side `fixture.fixture.edit` answer) or site fixture support. The eight
functions are re-created from their live definitions with exactly the gate line swapped; the
either-side shape, the negotiation cycle, mirrors, notifications and validation are unchanged. No
capability, scope, bundle or policy changed. The mobile date and time fields gained a typed fallback on
web only, because the native picker has no web implementation and the proof surface could not change
a kick-off through the interface.

**Permanent proof.** `supabase/tests/fixture_schedule_edit_authority.sql` (40 assertions, canonical
gate): edit-only lands every scheduling change and is refused a result; result-only is refused every
scheduling change and lands a result; a Team Manager's role default, a Club Admin's withhold refusing
the save mid-edit with the kick-off unchanged while the role, the view and result recording remain,
restore returning it, the read model agreeing at each step; sibling-team and other-club refusal; the
opponent's staff proposing and answering with their own edit key. `team_operations_ca7.sql` TO-B7 is
now asserted. Browser proof on the served web export as `uat.team.manager`: kick-off moved through the
console, a stale save refused with the sheet saying so and the kick-off unchanged, the fixture still
fully visible as the Match Centre with no edit offered, restore returning the row, the original put back.

## H25 — a Team Manager's team-scoped `finance.subscription.view` cannot be withheld

**Status: OPEN — H25 UNCHANGED, DEFERRED BY DESIGN (CA-M7.1 did not touch finance inheritance, decision ceilings, subscription policies or GoCardless). Owed with H20 to the finance/subscription authority slice.**

Observed 2026-09-24 by the same suite. Migration `20270531000000` gave `finance.subscription.view` a
team scope and put it in the Team Manager bundle, but left `inherits_to_team = false` and the decision
ceiling at club level (grant level `C`). So a Club Admin's team-level withhold is refused ("You are not
authorised to change that permission"; the CA-M4 read model shows the row as not editable), and a
club-level withhold is recorded but does not reach the team-scope evaluation. The Team Manager keeps
the view whatever the club decides. Owed to the finance slice that owns the key: either
`inherits_to_team = true` (so the club decision reaches the team, as it does for every other
`club,team` key) or a team-level decision ceiling. `club_admin_authority_matrix.sql` CH-A (H20) is the
same key's stale assertion and should be settled in the same pass. The CA-M7 suite records this as
TO-E9/E10 comments rather than assertions.

## H26 — CA-M7 Team Operations: owed at hardening

- **Availability has no staff override** (`response_source = 'staff'` is permitted and nothing writes
  it; the register says "Staff can ask, not answer for them"). **The staff notification half of this
  item is CLOSED by CA-M8**: `respond_to_attendance` and `respond_to_training_attendance` now emit
  `fixture_availability_responded` / `training_availability_responded` to the holders of
  `team.attendance.view` by the capability decision, once per change, superseding an unread earlier
  answer (`notifications_action_centre_ca8.sql` AC-1…13). Event attendance still emits nothing (H28).
- **Team conversations have no client.** `public.team_conversations` carries a complete authority model
  (`messaging.team_conversation.view/send`, the club policy switch) and neither client lists or opens
  one. The Team workspace surfaces the canonical Messages inbox (fixture, request, club, direct,
  announcements) and the fixture-audience announce; a team-wide standing thread is an owner decision.
- **Raising a call-up is a website flow.** Deciding a call-up is native (`decide_player_call_up`);
  raising one needs the club's other sides, their players and `preview_player_movement_eligibility`, and
  hands off to `/teams/<id>/player-requests` on the website.
- **Assigning team staff is a club job.** Removing an assignment is native (`remove_team_access` behind
  `people.role.assign_team`); assigning needs the club member directory (`people.member.view`), which
  team staff do not hold, so it stays with the club's People on the web and in the Admin Centre.
- **Team Details opens the Admin Centre's team screen**, whose shell names the club and whose Back
  returns to the Admin Centre; acceptable for the club-level `team.team.manage` holder it is gated on.
- **Physical-iPhone walkthrough (A–Y in the CA-M7 directive)** not performed; Expo Web proof and the
  iOS export only. Dynamic Type and VoiceOver on the register tiles and the Needs Attention rows are the
  first things to look at.
- **Notifications for team events still open the web page where no native route exists** (call-up and
  dispensation notifications resolve to `/club/player-moves`, a club page); the Needs Attention item
  for a call-up routes natively.
- **Web parity gaps found and left**: the Fixture Control Centre and the nav gate on role names
  (`canManageClubFixturesAnywhere`) rather than capabilities; the planner and import pages ask the
  deprecated `fixture.import` alias; `lib/fixtures/fixture-type.ts` defaults an unset type to
  "Friendly" against the taxonomy's own rule. Recorded from the CA-M7 forensic audit, unchanged.

## H27 — Observed while running the neighbouring suites for CA-M7.1 (2026-09-24)

- `authority_helper_retirement.sql` HR1 reports `can_organise_competition` referenced from 3 function
  bodies against a ceiling of 2 (`update_competition_metadata`, `internal.can_organise_edition`,
  `governing_body_competitions`). None of the three is touched by CA-M7.1; the count predates it and
  belongs to the competition domain. Left as found.
- Four SPECIAL_PURPOSE manual-verification scripts (`chat_fixture_operations`,
  `unified_fixture_conversation`, `club_lifecycle`, `fixture_results`) fail at their own setup on
  hard-coded ids and ambient data before reaching any authority assertion. Unrelated to the gate change;
  left as found.

## H28 — CA-M8 Notifications, Inbox & Action Centre: owed at hardening

- **PUSH DELIVERY FOUNDATION PENDING.** No device registry, token, APNs/FCM credential, worker,
  delivery log or permission UX exists, and none was built: a registry with no consumer is a
  zero-caller hazard. The canonical architecture and its prerequisites are in
  `docs/mobile/CA_M8_NOTIFICATIONS_ACTION_CENTRE_MAP.md` §6. The app-icon badge follows the same
  foundation. The phone says plainly that nothing is sent to the device.
- **Event attendance emits no staff notification.** `respond_to_event_attendance` (club events) was
  left as found; only fixtures and training sessions tell the staff.
- **Pending states with no notification type**: `player_team_memberships` PENDING, `player_club_join_requests`
  pending, `guardian_link_requests` PENDING (either side), `access_invitations` ISSUED,
  `player_team_dispensation` intermediate states, `privileged_recovery_requests` PENDING_APPROVAL. Each
  is projected as attention where the phone holds the context, or handed to the web; none is faked.
- **Club queues not yet projected on the phone**: tournament invitations, competition match
  verifications, `amendment_pending` / `disputed` results, season handover blockers. Their readers are
  not yet shared; the website's own surfaces remain canonical.
- **`club_join_request_submitted` chooses recipients by a role list** (`club_memberships.role =
  'CLUB_ADMIN'`), unlike the new availability emitter which asks the capability decision. Left as found.
- **Call-up and dispensation notifications carry no team or club id**, so the phone cannot select a
  context before opening them; they route to `/club/player-moves` on the web.
- **The website's inbox has no unread-only filter and no page after fifty**; its read actions now call
  the shared operations (`mark_all_notifications_read` marks the bell's rows, where before it also
  marked Messenger's). `directory_request_submitted` routes to `/admin/claims`, where the Site Admin
  dashboard has no page for directory requests.
- **Messenger's own read path** (`markConversationRead`, `apps/mobile/src/messages/conversation.ts`)
  updates `read_at` directly under RLS. Deliberately untouched (CA-M5); the JS suite exempts it by name.
- **Neighbouring suites erroring at their own seed, unrelated to this slice** (all `UNVERIFIED`
  disposition): `parent_player_foundation_security.sql` and
  `training_management_extension_regression.sql` ("VALUES lists must all be the same length"),
  `player_movement_notification_recipients.sql` (`club_memberships_user_id_fkey`). Observed while
  running the suites that exercise the re-created response operations; every CANONICAL_GATE neighbour
  passed (`adult_player_self_registration` 40, `availability_one_product` 38,
  `definer_rpc_session_contract` 37, `match_centre_core` 22, `participant_route_authority` 40,
  `step9_family_and_availability` 41, `unread_truth` 16, `notification_catalogue` 18,
  `notification_mandatory_and_preferences` 19, `team_operations_ca7` 61,
  `safeguarding_officer_dispensation_notifications` 8, `announcement_unread_surfaces` 8).
- **Physical-iPhone walkthrough (A–V in the CA-M8 directive)** prepared, not performed; Expo Web proof
  and the iOS export only. Dynamic Type on the card's three lines and VoiceOver on the press-and-hold
  sheet are the first things to look at.
- **H27 unchanged.**
