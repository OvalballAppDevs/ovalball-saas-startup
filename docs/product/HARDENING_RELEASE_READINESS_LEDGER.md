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
  dropped. *Owner: test harness, if it recurs elsewhere.*
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

## H11 — Owed at hardening, in one list

Complete canonical gate on a frozen tree · full-chain clean boot ·
production-shaped rehearsal from the then-current production tip ·
persistent-schema comparison · migration-history repair decision ·
SQL-suite governance closure (H2) · stale-test reconciliation ·
security and authority sweep · cross-domain regression · full browser
regression · mobile · accessibility · race and concurrency · release readiness.
