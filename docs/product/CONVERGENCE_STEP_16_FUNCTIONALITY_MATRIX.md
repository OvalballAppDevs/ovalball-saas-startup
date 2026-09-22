# Convergence Step 16 — functionality accounting

**FUNCTIONS BEFORE 24 · FUNCTIONS AFTER 34 · FUNCTIONALITY LOST 0.**

## Before (Step 15's close, `7a9960b`)

The twenty-four in `CONVERGENCE_STEP_15_FUNCTIONALITY_MATRIX.md`, unchanged in meaning.

## After

All twenty-four, plus:

| # | function | how |
|---|---|---|
| 25 | **Invite somebody to a governing body who has no Ovalball account** | `GOVERNING_BODY_OFFICER` through `issue_invitation` / `redeem_invitation` |
| 26 | **Accept such an invitation**, server-authored, single-use, bound to the invited address | `redeem_invitation`'s new branch |
| 27 | **See who has been invited and not yet accepted** | `governing_body_invitations` |
| 28 | **Send an invitation again** (rotating the secret) and **withdraw** one | `resend_invitation` / `revoke_invitation`, via `can_administer_invitation` |
| 29 | **A body organiser can read its own competition through RLS** — including the match verifications, which have no public fallback | `internal.organised_edition_ids` |
| 30 | **A body organiser is told what its clubs answered** | `internal.competition_organiser_recipients` |
| 31 | **A competition's real results and table, for the organisation that runs it** | `governing_body_competition_matches` + `lib/competitions/standings.ts` |
| 32 | **A club can see which competitions it is in, and who runs them** | `club_competition_entries`, `/fixtures/competitions` |
| 33 | **What a new competition would inherit, shown before naming it** | `current_competition_season` |
| 34 | **The review county's competition is reproducible with entrants, a draw and results** | `step2-review-club.mjs enrich-governing-competition` |

## Functionality lost: zero, checked item by item

| could have been lost | proof it was not |
|---|---|
| **Give a governing body role by email** — the function was DROPPED | preserved and widened by #25: the same act now also works for somebody with no account. `step16` **B1–B4**, `step15` **E1–E10** |
| Every other invitation kind | `invitation_authority_matrix` **71/71**, `invitation_joining_closure` **23/23**, `invitation_team_list` **39/39**, `invite_only_onboarding` **7/7** — `issue_invitation` and `redeem_invitation` were both rewritten |
| Redemption's hardening | `step16` **C1–C6**, **I4–I5**; the migration asserts throttling and email binding are still in the body |
| Site Admin / club competition organising | `step16` **B2 (via step15)**, `competition_authority_matrix` **87/87**, `competition_matches` **28/28**, `competition_creator_conformance` **13/13** |
| Site Admin competition notifications | still routed, now only when a competition genuinely has no organiser — `step16` **F3** |
| The organiser-only participant model | `step16` **G6–G7**; `save_competition_participants` still requires `require_edition_organiser` |
| Club-side match answering | `step16` **F5**, **F7**, **D7**; `respond_competition_match` untouched |
| Club fixture authority | `step16` **H1–H6**, `fixture_bulk_planning_authority` **28/28** |
| Dispensation semantics | `step16` **J3–J4** |
| Club affiliation | `step16` **J5** — nothing writes `club_directory` |
| The five-scope capability engine | `step16` **J1–J2** |
| Step 14 and Step 15's own guarantees | `step14_governing_body` **26/26** (one assertion added), `step15_governing_product` **67/67**, `83` **15/15**, `84` **60/60** |
| Standings computed once | `step16` **J7**, and **A7** proves the page shows exactly the stored results |

## Four things changed rather than added

1. **`grant_governing_body_role_by_email` was removed.** It answered `NO_ACCOUNT`, which told an
   administrator whether an address is registered on Ovalball. Its product function is preserved by
   the invitation; the function is gone rather than left with no callers, because CLAUDE.md is explicit
   that a zero-caller helper is still a hazard.
2. **`access_invitations` gained an `ORGANISATION` issuing level.** Filing a county officer's invitation
   as `SITE` claimed they were a Site Admin — and redemption's step 8 re-check refused it for exactly
   that reason. Found by the suite's first run.
3. **Step 14's `F4` assertion was narrowed and a stronger `F5` added.** `redeem_invitation` is the one
   canonical redeemer for every kind, so once it learned the governing kind it necessarily names both
   `constituent_body_roles` and the words SAFEGUARDING and GUARDIAN — in other branches. The guarantee is
   now asserted on the governing branch itself, which reads the branch rather than the file.
4. **Invitation expiry moved out of the render.** `Date.now()` in a React render is impure and the lint
   rule catches it — the same defect Step 10 removed from the team page. The database answers
   `expires_soon`, because it is the thing that knows the time.

## Hardening pass (after `1858392`)

**FUNCTIONS BEFORE 34 · FUNCTIONS AFTER 34 · FUNCTIONALITY LOST 0.**

The hardening pass added no function and removed none. It closed one latent fail-open and proved three
things the implementation pass had asserted without testing.

Nothing a person could legitimately do before they can no longer do. The single behavioural change
refuses one thing that should never have worked: accepting a governing-body invitation while your access
to that organisation is suspended. No such suspension can exist yet, so no live journey changes.

### Product defect fixed

| | defect | fix |
|---|---|---|
| S1 | `redeem_invitation` reinstated a **SUSPENDED** governing-body role and could raise it at the same time — measured, `SUSPENDED BODY_COMPETITIONS` → `ACTIVE BODY_ADMIN`. Privileged authority returning as a side effect of clicking a link, which the club role machine explicitly forbids | migration `20270530000000` refuses it as a returned `REFUSED / ORGANISATION_ACCESS_SUSPENDED`, leaving the role untouched and the invitation unspent so it still works after a deliberate restoration |

### Verification gaps closed

| | gap | now |
|---|---|---|
| S2 | revoking a **role** was never tested — only revoking an invitation | **K1–K5**: authority, the organisation read and the competition read all go immediately |
| S3 | suspension was never tested at all | **K6–K7** hold it, **K8–K11** hold the way back in |
| S4 | §17's external-versus-external requirement was claimed but every tested participant was an Ovalball club | **L1–L6**: two directory-only clubs, zero fixtures, organiser still sees the match, another body still cannot |
| S5 | a VIEWER's email redaction was written in Step 15 and never asserted | **K12–K13** |

### Contract preserved

The first attempt at S1 refused by raising and was rejected by `invitation_authority_matrix` **IN-K2**:
this function refuses by *returning*, because raising rolls back the attempt record and defeats the
redemption rate limits. The fix follows the canonical pattern instead, and the migration's own guard now
pins the raise count at three.
