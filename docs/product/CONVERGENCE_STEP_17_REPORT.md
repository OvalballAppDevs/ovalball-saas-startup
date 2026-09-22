# Convergence Step 17 — Identity/Auth Slice 10

**PRODUCT IMPLEMENTATION COMPLETE — HARDENING PENDING.** From `1858392` (Step 16). Local only; nothing
pushed, nothing released, no migration-history repair, no canonical gate.

## 1. The canonical Slice 10 scope, recovered

Verbatim, from `IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` — the only place the repository defines it:

> **Slice 10 — Legacy retirement.** Drop compatibility columns and views (`account_status`,
> `club_memberships.role/status/authority_suspended*`, `team_permissions`, `role_capability_defaults`,
> `permission_groups*`, `site_admins` flags and `admin_role`), legacy invitation tables, deprecated
> capability keys, magic-link code paths, the Phase 0 signup binding, legacy helpers. `no_role_literals`
> shrink reaches 0. **Acceptance: zero references in CI; full runner, clean boot and all browser suites
> green; production usage telemetry zero for 30 days before each drop.**

**So Slice 10 owns no new authentication feature.** Every mechanism — password, TOTP, recovery codes,
sessions, Google, invitations, impersonation, recovery, suspension — was delivered in Slices 1–9 and is
not reopened. The final-slice ownership matrix for all twenty-two original goals is in
`CONVERGENCE_STEP_17_ARCHAEOLOGY.md` §5; nothing in it is reimplemented here.

## 2. The finding that shaped the step: no drop is due

Slice 10's first acceptance clause is **zero references in CI**. Measured:

**458 references across 12 retirement targets. Not one target is at zero.** 61 database functions read
`club_memberships.role`; 62 call the `has_capability` adapter; 22 read `team_permissions`; 108 CI files
name `site_admins.admin_role`.

And two preconditions cannot be met in this step at all: the full runner and clean boot are the hardening
work the sprint defers, and *"telemetry zero for 30 days"* cannot begin because nothing is deployed —
§20 says so directly, since `accept_invitation` and `get_invitation_preview` are themselves drop targets
the deployed bridge requires.

Even the two targets that looked droppable are not. **`invite_player_account`** has zero application
callers and mints a plaintext token — and `parent_add_child_regression` exercises it, so a drop would
remove coverage of a journey whose redemption half is still live. **`role_capability_defaults`** has zero
database readers — and seven permanent suites reference it.

**The drops are blocked by their own stated precondition, not by effort.** So Step 17 did the part that
is due: stop the legacy surfaces that are still live, and turn "zero references" into a ratchet.

## 3. Visible product change

**None, and that is correct.** Slice 10 is retirement; it has no user-facing surface. What changed is a
boundary and a measurement. The product surfaces that read the affected tables — Site Admin users and
invitations, People, Partner Clubs — render exactly as before, proven in the browser.

## 4. RED changes

| | |
|---|---|
| `public.invitations` | `authenticated` INSERT and UPDATE **revoked**. 0 rows, no application writer, no RPC inserts — but a session holding `people.invitation.create` could write a legacy invitation with a plaintext secret of its own choosing. The club-scoped policies are **retained and now unreachable**: a grant is checked before RLS, and losing the scoping rule would be worse than leaving it inert |
| `public.club_ovalball_invitations` | table SELECT replaced by a **column grant** omitting `token` — the last client-readable plaintext legacy invitation token on the platform |
| `public.access_invitations` | table SELECT replaced by a **column grant** omitting `token_sha256` and `code_hmac`. Found by this step's own suite |
| `internal` / `public` functions | **none changed.** Nothing was dropped |

**Zero browser-reachable invitation secret columns now exist anywhere in the schema**, asserted as a hard
zero rather than a ratchet.

## 5. A guard was asserting something untrue

`verify-legacy-invitation-token-readers.mjs` said, in its own header, *"THE LIST IS NOW EMPTY … nothing
reads a plaintext legacy token any more"*. Its database check required a `returning … token` clause, and
`send_replacement_guardian_invitation` does:

```sql
returning * into v_row;                     -- [^;]* stops at this semicolon
return query select v_row.id, v_row.token;  -- the token actually leaves here
```

The reconciliation had already flagged that function and `invite_player_account` as *"two legacy paths
[that] can still mint new plaintext-token credentials"*, owner Slice 10, *"flagged for the owner's
ruling"*. The regex is why it had looked closed since.

The check now also reads what a function **gives back**, and strips comments first — without that, the
word "invitations" inside an English sentence reported the **canonical** issuer as a legacy leak. The one
survivor is a **named shrink-list entry with a reason and an owner**, and the guard's success line now
prints it instead of claiming zero.

## 6. Targeted proof

| | |
|---|---|
| `step17_legacy_retirement` | **37 / 37** — secret unreachability table by table, the legacy table refused to a Club Admin *and* a Full Site Admin, readers keeping their columns while `select *` is refused, nothing dropped, live-versus-terminal token policy, the canonical issuer still hashing, and the boundaries Slice 10 does not own |
| `86-legacy-estate-unreachable` | **22 / 22**, run twice — the same boundary through **PostgREST with a real signed-in session**, which is the only place a grant is proven for a browser. Real 403s on every secret column and real 200s on every permitted read |
| `verify-slice10-retirement` | new, wired into the gate — 458 references, none risen, 0 browser-reachable secrets |
| `verify-legacy-invitation-token-readers` | fixed; now reports 1 named database issuer instead of claiming none |
| `invitation_authority_matrix` · `invitation_joining_closure` · `invitation_team_list` · `invite_only_onboarding` | **71/71** · **23/23** · **39/39** · **7/7** |
| `minor_prohibitions` · `users_and_permissions_authority` · `club_misc_authority_matrix` · `family_authority_matrix` | **11/11** · **30/30** · **84/84** · **79/79** |
| `security_perimeter_guard` · `perimeter_manifest.test.mts` | **6 / 6** · **12 / 12** (manifest updated to record the narrowed perimeter) |
| tsc · build · lint | clean · clean · **181/5/176, the unchanged baseline** |
| Static guards | content standard, authority guards, redemption callers, SQL registry (**291** declared, 0 undeclared), browser registry (**59** in the gate) |

**Not run, deliberately:** no canonical gate, no clean boot, no production rehearsal, no whole-platform
sweep.

**Two pre-existing failures, unrelated:** `parent_add_child_regression` dies on a Team Directory
catalogue mismatch (*"There is no boys team at U10"*); `admin_user_management` on a
`club_memberships_club_id_fkey` violation. Both SPECIAL_PURPOSE, neither error naming a table Step 17
touched. Recorded as H16.4, not chased (§29, §32).

## 7. FUNCTIONS BEFORE 34 · AFTER 36 · LOST 0

Item by item in `CONVERGENCE_STEP_17_FUNCTIONALITY_MATRIX.md`, including the six things deliberately
*not* done and why each is a decision. The two additions are platform properties — the estate is measured
and cannot grow; no browser role reaches invitation secret material — because Slice 10 adds no feature and
§31 forbids padding the number.

## 8. Remaining Identity/Auth hardening

Recorded as **H16** in `HARDENING_RELEASE_READINESS_LEDGER.md`, with the full reference table:

- **H16.1** — `send_replacement_guardian_invitation` still issues a plaintext legacy token; named,
  reasoned, owned. **Owner ruling requested** below.
- **H16.2** — every drop still owed: 12 targets, 458 references, plus the runner/clean-boot and
  30-day-telemetry preconditions.
- **H16.3** — T7 magic-link removal not due (gate is zero magic-link sessions for 30 days).
- **H16.4** — two unrelated SPECIAL_PURPOSE seeding failures.

## 9. Identity/Auth implementation status (§34)

| | |
|---|---|
| **IMPLEMENTED — VISIBLE PRODUCT COMPLETE** | email/password · password policy · MFA/TOTP · recovery codes · sessions · Google · one identity across many contexts (Site Admin, Club Admin, Coach, Team Manager, Safeguarding Officer, Fixture Secretary, Volunteer, Player, Parent/Guardian, and Step 16's governing-body officer) · capability-scoped authority · unified invitations and joining · account recovery · controlled impersonation · audit and security events · suspension and revocation · AAL2-sensitive operations |
| **IMPLEMENTED — HARDENING PENDING** | legacy retirement (H16) · the `organisation` capability scope, deliberately refused (H13.1) · the release bridge's expand→deploy→verify→contract sequence |
| **DEFERRED TO UX** | signup, claim and join entrance journeys (Step 19) |
| **DEFERRED TO RELEASE/HARDENING** | full runner · clean boot · production rehearsal · telemetry-gated drops · T7 |
| **OWNER DECISION** | Apple and Facebook readiness (no provider credentials exist, and §12 forbids pretending) · H16.1 below |

**This is not a statement that Identity/Auth is production-verified.** That needs the hardening and
release proof above, and none of it has been run.

## 10. Owner decision requested

**The reconciliation asked for a ruling on the two legacy plaintext-token issuers. One is now answerable
and one is not.**

`invite_player_account` mints a plaintext token, has **zero application callers**, and its table holds
**zero rows** — but a permanent suite exercises it and the `/player-invite` redemption bridge is live.

`send_replacement_guardian_invitation` mints one and **is** in use, from
`/club/settings/guardians`. Exposure is bounded — no API role can read that table at all.

Three options:

1. **Leave both, as now.** The estate is measured, the surfaces are unreachable from a browser, and the
   one live legacy row keeps working. Costs nothing; the plaintext remains at rest.
2. **Port the family acceptance functions onto the canonical invitation** —
   `link_guardian_to_existing_player` and `create_player_for_guardian` take a canonical id — then
   re-point the issuer and retire the legacy guardian path. This is the end state, and it is
   family-architecture work with its own proof, not cleanup.
3. **Hash `guardian_invitations.token` at rest** without changing the journey. Smaller than (2), but it
   touches six functions in the family journey and would rewrite the stored token of **one live pending
   invitation belonging to a real person**, whose link must keep working.

My reading: (2) is right and is not a retirement slice's work; (1) is correct until then, because Phase 2
O.5's tested policy is already that a live legacy invitation keeps its token.

## 11. Manual review checkpoint

There is **no new screen to look at** — which is itself the thing worth confirming. Five minutes:

- Sign in as `uat.fullsiteadmin@ovalball.test`, open **Site Admin → Users → any user → Invitations**, and
  **People** at a club. Both read the invitation tables whose grants changed. *Does anything look
  broken or emptier than before?*
- Open **Partner Clubs** as `uat.preston.admin@ovalball.test`. That surface reads the table whose token
  column is now out of reach. *Does the referral journey still read normally?*
- Invite somebody from **People** or from a governing body's **People & Access**, and check the link is
  still produced. *Does inviting still feel the same?*

The question behind all three: **did making the old estate unreachable cost an ordinary club volunteer
anything they could notice?** It should not have.
