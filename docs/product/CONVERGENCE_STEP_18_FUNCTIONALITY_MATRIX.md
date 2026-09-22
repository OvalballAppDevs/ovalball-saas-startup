# Convergence Step 18 — functionality accounting

**FUNCTIONS BEFORE 36 · FUNCTIONS AFTER 38 · FUNCTIONALITY LOST 0.**

UX convergence mostly *recomposes* — most of what this step did was move a rule to where it belongs or
fix a layout. Two things are genuinely new.

## Before — 36

Step 17's thirty-six, in `CONVERGENCE_STEP_17_FUNCTIONALITY_MATRIX.md`, unchanged.

## After — 38

| # | function | how |
|---|---|---|
| 37 | **A mobile bottom bar: the primary destinations of whatever context you are in, one tap away** — for a club, a team, a family, Site Admin and a governing body, each built from that context's own navigation | `buildBottomBarItems` (lib), rendered in `app-mobile-nav.tsx` sharing the drawer's state |
| 38 | **A way back into Ovalball from a club's public home** — the dead end UX-6 named, now reachable from Step 16's affiliated-club list | `ClubBar`'s `returnHref`, on all three public club routes |

## Functionality lost: zero, checked item by item

| could have been lost | proof it was not |
|---|---|
| Any navigation destination | the drawer still renders the **whole** catalogue — `87` **A10**; all 38 static hrefs still resolve; the bar only ever returns items `buildNavItems` already produced |
| The grouped club and Site Admin taxonomies | `87` **C1**, **C2**; `verify-admin-nav` **29/29** |
| Anything under the reserved space | nothing was deleted — four pages stopped declaring their own `pb-28` and the shell declares it instead, measured at **104px** reserved (`87` **B1**) |
| The club's public-home content | `min-w-0` changes width resolution, not content; `87` **D5** |
| The calendar-access request | the control remains; its visible label shortened and the club's name moved into the **accessible** name, so the announced label is unchanged in substance |
| Rugby Hub's existing return path | `87` **D3** |
| The Club Desk hierarchy (UX-3) | `67-club-desk-hierarchy` **28/28** at three viewports |
| Page identity (UX-1) | `page_identity` **17/17** |
| The context architecture (UX-2) | `identity_and_context` **21/21**, `parent_player_identity` **9/9** |
| Governing, family and Site Admin contexts | `87` **F4**, **F5**, **F6**, **A11**, **A12** |
| Server-side authority | nothing in this step touched a capability, a policy or an RPC. The bar is links to routes that re-check themselves |

## Four things changed rather than added

1. **The shell now reserves the space its own furniture occupies.** The floating widget was compensated
   per page, in **8 of about 100** files. A rule most pages do not follow is the wrong shape of fix.
2. **The floating widget was raised above the bottom bar.** Measured: it used to end at 760px with the bar
   starting at 723px — it sat on top of it. It now ends at 704px.
3. **The public club home stopped overflowing sideways.** 23px at 390px for a signed-in visitor, from two
   causes: grid items default to `min-width:auto`, and a `whitespace-nowrap shrink-0` button carried a
   label long enough to be 355px inside a 316px row. Now **0**.
4. **Three stale assertions were corrected, not worked around** (§33):
   - `verify-admin-nav`'s *"grouping is applied only in a Site Admin context"* — green, and untrue since
     UX-5 gave clubs the same treatment. It now asserts what the layout does, plus that both builders
     share one grouping function.
   - `verify-admin-nav`'s parent/player settings check pinned an exact pair of `case` labels and had been
     failing since **before this step** (confirmed at `83c37e0`) because `family` joined the chain. It now
     asserts the rule.
   - `identity_and_context` and `parent_player_identity` built `SessionContext` fixtures through
     `as unknown as`, so Step 15's new `governingBodies` field could not be caught by the compiler and
     threw at runtime. Fixtures corrected; **found by this step, caused by Step 15.**

## Deliberately not done

| | why |
|---|---|
| A bottom bar for a context with no navigation of its own | it is built from `buildNavItems`; a context is not given destinations to fill a bar |
| Grouping the governing or family navigation | six links is not a taxonomy; the layout leaves Setup flat for the same stated reason |
| Reverting UX-2's person-first identity block | §8 asked for it to be evaluated, not reverted. Evaluated as part of the whole shell and kept: it is the only thing on screen distinguishing a Club Admin acting for their club from the same person acting for their county |
| The dev-only webfont issue | §23 |
| The H14.7 child `switcherLabel` expectation | §13 — a `.verify.ts` label expectation, not a UX-4–7 surface |
| Tightening the `as unknown as SessionContext` casts in five fixtures | the two that broke are fixed; hardening the pattern across the suite is test governance, recorded rather than done (§35) |

## Hardening pass (after `1507ed3`)

**FUNCTIONS BEFORE 38 · FUNCTIONS AFTER 38 · FUNCTIONALITY LOST 0.**

The hardening pass added no function and removed none. It found six product defects in the shell built
above and fixed each of them in place, and four defects in the *verification* rather than the product —
which matter more, because a check that passes for the wrong reason is worse than no check.

The count is unchanged because a bar cell that was missing its destination, or carried a label that
clipped, was never a separate function: it was this step's own function delivered wrongly. The one place
that could be read as a restoration is the team bar's Team cell (D1) — the team's page was reachable from
the drawer throughout, so nothing was ever unreachable.

### Product defects fixed

| | defect | fix |
|---|---|---|
| D1 | the team bar omitted the team's own page — the single most-visited destination in a team context | `/teams/<id>` takes the second cell, displacing Messages, which keeps its drawer place |
| D2 | the team cell was labelled with the team's display name, which is club-entered data of any length | matched by shape to the word **Team**, as the desktop sidebar already calls that group |
| D3 | `/calendar` can carry a team's display name for a view-only person with exactly one team | the bar always uses the plain word **Calendar** |
| D4 | governing **People & Access** (15 chars) clipped at every supported width | **People** on the bar; the workspace heading keeps the full phrase |
| D5 | cell padding cost label width — a 56px box clipped "Dashboard" (57px) and "Rugby Hub" (58px) at 320px | `px-1` removed; the label is centred and truncating, so padding bought nothing and the tap target is the whole cell either way |
| D6 | two pages still carried local compensation for the global widget (`pb-32 md:pb-20`, `mb-16`) | removed; the shell's own allowance covers them, which was the point of §1 |

### Verification defects fixed

| | defect | why it mattered |
|---|---|---|
| V1 | the report claimed `navigation_architecture.test.mts` had a stale failure (H17.4) | it passes **17/17** under the gate's own loader. The claim came from running it with `npx tsx`, which cannot resolve `@/`. **H17.4 is withdrawn** |
| V2 | the governing bottom bar had never actually been measured | the probe navigated by URL, but context comes from the cookie — so it had been measuring the **club** bar and calling it governing. Now switched through the real context switcher first |
| V3 | the safe-area assertion was vacuous | `env(safe-area-inset-bottom)` computes to `0px` headless, so the assertion could not fail. It now asserts the declaration |
| V4 | the clipping assertion was blanket where the truth is per width | "Competitions" needs 70px and the box is 64px@320, 72px@360, 78px@390. Asserted per width, with a named, reasoned acceptance at 320px only |
