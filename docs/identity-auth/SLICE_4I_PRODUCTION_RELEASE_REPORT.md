# Slice 4I — production release report

**Status: released.** Commit `c7a9a96`, pushed fast-forward `edcc5ce..c7a9a96`. The four migrations
were dry-run and then applied to production **before** the push, as the standing rule requires.
Production moved **469 → 473**, tip `20270380000000`.

## Release order, derived from compatibility evidence

The standing rule on this project is that production migrations are applied **before** `git push
origin main`, because Vercel auto-deploys on push and the push *is* the production deployment. That
rule is followed here. The compatibility evidence below is recorded so the window effect is known in
advance rather than discovered.

**Is the new application compatible with the old database?** Yes. The three application changes ask
`team.handover.prepare` instead of `club.season_rollover.manage`. `team.handover.prepare` has been
ACTIVE in the catalogue since Slice 3 and held by the CA and FS bundles since then, so it resolves on
the pre-4I database. On that database a Fixtures Secretary would briefly *see* Season Handover in
navigation while the RPCs behind it still refused them — cosmetic, and the refusals are fail-closed.

**Is the old application compatible with the new database?** Partly, and this is the window effect.
The previous build asks `club.season_rollover.manage`, which these migrations retire from
`capability_key_map`. For the length of the deploy, `internal.has_capability('club.season_rollover.manage')`
fails closed and the previous build's **Season Handover** entry hides for a Club Admin. It returns as
soon as the new build is serving. No data effect, no write is lost, nothing is left half-applied.

Applying the migrations first therefore trades a brief, fail-closed disappearance of one navigation
item for the guarantee that no new build ever runs against a database that cannot answer it. That is
the trade the standing rule makes deliberately, and it is the right one.

**The migrations are not atomic with the application.** Four migrations travel. They are ordered so
that each is independently safe: `20270377000000` (documents and Z-12), `20270378000000` (handover
authority and the lifecycle gates inside it), `20270379000000` (policies and the three adapter
retirements), `20270380000000` (the eighteen RPCs). Nothing in 377–379 depends on 380 having run, and
380 asserts the section U split that 378 installs rather than assuming it.

## Production verification

Twenty-three checks were run against the live database, all read-only. Every one passes.

| | production |
|---|---|
| ledger / tip | **473** / `20270380000000` |
| `is_club_admin` policies / bodies | **0 / 3** |
| `can_manage_club_fixtures` policies / bodies | **1 / 9** (was 1 / 27) |
| document-helper policies | **0** |
| document helpers free of role strings | yes |
| Z-12 `club-documents` bucket policies | **4** |
| adapter rows / of which 4I's | **77 / 0** |
| 4A's and 4C's adapter rows still present | yes (2 keys × 2 scopes) |
| **U**: apply asks the apply key and **not** the prepare key | yes |
| **U**: the Fixtures Secretary holds prepare and not apply | yes |
| apply is non-delegable and reason-bearing | `N` / `R` |
| fold + graduate inside a handover keep the lifecycle gate | yes (twice, prepare key absent) |
| the eighteen RPCs ask no legacy helper | yes |
| referral ledger and partnership invitation keyed apart | yes |
| hoist installed in the subquery form | **44 hoisted / 0 per-row** |
| a null subject answers `false` rather than erroring | `false` |
| 4H still holds: nothing acting on club money has a Site Admin branch | yes |
| 4G still holds: no safeguarding gate reads the contact table | yes |
| `anon` may still execute the two hoist helpers | yes |
| every adapter row resolves to an ACTIVE key valid where evaluated | yes |
| the nine 4I keys are ACTIVE | 9 of 9 |
| identities / clubs / teams | **4 / 1 / 17**, unchanged |

### What production actually holds in these domains

**Nothing yet.** Production carries 0 club documents, 0 document folders, 0 partnerships, 0
invitations to clubs not on Ovalball, and 0 season handovers. Every authority this slice moved is
therefore live and correct, and is currently deciding about an empty set. That is worth saying
plainly rather than letting a wall of green checks imply that live data was exercised: it was not,
because there is none. The first club to file a document or run a handover meets this authority, not
the old one.

## What travels

| | |
|---|---|
| Migrations | 4 — `20270377000000` … `20270380000000` |
| Application | 3 files, capability key repoint only |
| Tests | 1 new matrix, 1 new race file, 1 new browser suite, 6 existing suites updated |

## Verification before release

| | |
|---|---|
| platform battery | **4370 passed, 0 failed across 209 suites** |
| AA.3 4i matrix | **84 assertions**, identical on a seeded database and on one built from empty |
| races | 4/4 on real concurrent database sessions |
| mutation | **15 mutants, 0 survivors**, restore verified clean before and after each |
| clean empty-database rebuild | **473 migrations from empty**; 22 suites, **1187 assertions**, 0 failures |
| browser UAT | suites 51-59, **three sequential passes, 247/247 each** |
| residue after UAT | 0 identities, 0 clubs, 0 documents, 0 cached sessions |
| `npx tsc --noEmit` | clean |

### Two environmental failures, recorded rather than hidden

The UAT did not run clean first time, and neither failure was an authority failure:

1. A Next.js server-action POST timed out at 60s during suite 51, while the platform battery and a
   Docker teardown were still running. Re-run in isolation: 43/43.
2. One magic-link sign-in in suite 53 landed on `/login?error=link` under memory pressure. Re-run:
   14/14. The identity involved was a disposable `uat.slice4c.*` account; no owner account was
   touched and no link was issued for one.

In both cases the suite's own cleanup still ran and reported `remaining=0`, which is the property
that matters when a suite dies mid-run. The three counted passes are the three that ran clean end to
end, and the machine was quiet for them.

The background task runner also killed two UAT attempts for low system memory. The passes were then
run in smaller foreground batches. That is a constraint of this machine, not of the suites.

## The limit of production verification

The application changes are server-side and behind authentication. Verifying them in production would
require either creating production personas or signing in as the product owner, both of which are
prohibited. So the **authority** is verified directly against the production database — catalogue
rows, bundle membership, policy definitions, function bodies, grants — and the **behaviour** is
verified against a local database carrying the same migration tree, by three sequential browser UAT
passes over suites 51–59. This report states that division rather than wording the summary so the gap
is invisible.
