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

- **H13.1 — no `body` scope in the capability engine.**
  `internal.capability_decision` takes club, team and player only, and
  `bundle_capabilities.scope_type` is constrained to five values. Step 14
  resolves governing-body authority through dedicated functions over
  `constituent_body_roles` rather than changing the signature of the function
  every authority decision in the platform calls. Promoting a sixth scope — and
  with it registering `governing.body.view` / `.manage` /
  `governing.competition.manage` in `public.capabilities` — is the right end
  state. *Owner: capability engine, with the Governing Body programme.*
- **H13.2 — governing-body navigation is a dashboard entry, not a nav section.**
  The nav catalogue is capability-filtered with its own architecture suite, and a
  foundation step is the wrong place to add a section to it. *Owner: Step 15.*
- **H13.3 — affiliation has no lifecycle.** `club_directory.constituent_body_id`
  is a single current value with no history and no workflow. Step 14 deliberately
  did not invent one. *Owner: Governing Body programme, if the product needs it.*

## H11 — Owed at hardening, in one list

Complete canonical gate on a frozen tree · full-chain clean boot ·
production-shaped rehearsal from the then-current production tip ·
persistent-schema comparison · migration-history repair decision ·
SQL-suite governance closure (H2) · stale-test reconciliation ·
security and authority sweep · cross-domain regression · full browser
regression · mobile · accessibility · race and concurrency · release readiness.
