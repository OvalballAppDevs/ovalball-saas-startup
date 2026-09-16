# Slice 4 — final closure release report

**Status: released and production-verified.** Commit `753d3cd`, pushed fast-forward
`1014155..753d3cd`. One migration, dry-run then applied to production **before** the push.
Production moved **473 → 474**, tip `20270381000000`.

## Release order

The closure changes **no application code at all** — it is one migration plus tests, the perimeter
manifest and documentation. `git status` showed zero files under `app/`, `lib/` or `components/`.
That removes the ordering hazard entirely: there is no "new app on old database" case, because the
application is byte-identical either side of the release.

The only compatibility question is whether the existing build works against the new database. It
does: no RPC signature changed (each was rewritten through `pg_get_functiondef`, so a signature
change would have been refused by `create or replace`), no RPC was removed, and the one function
dropped — `internal.can_manage_player` — had zero callers anywhere including the application.

## Production verification

Twelve read-only checks. All pass.

| | production |
|---|---|
| ledger / tip | **474** / `20270381000000` |
| `can_manage_club_fixtures` policies / bodies | **0 / 0** (was 1 / 9) |
| `can_manage_team` policies / bodies | **0 / 7** (was 1 / 15) |
| `internal.can_manage_player` | **gone** |
| no `can_manage_player*` replacement appeared | yes |
| dispensation policy free of legacy helpers | yes |
| dispensation policy asks the J.7 keys and keeps the safeguarding branch | yes |
| the eight 4D functions free of legacy helpers | yes |
| consent: host invites/reconciles/removes, and does **not** answer | yes |
| J.8 line 490: the occasion has no team bundle | yes |
| a null subject answers `false` rather than erroring | `false` |
| identities / clubs / teams | **4 / 1 / 17**, unchanged |

## Pre-release gates

| | |
|---|---|
| gate shadow (verification before change) | 8 gates × 13 personas; every mapping traced to a Phase 2 table; **no new decision required** |
| 4A family matrix | 75 → **79** |
| 4D competition matrix | 65 → **87** |
| 4G safeguarding matrix | 115 → **128** |
| retirement ledger | 69 → **73** |
| mutation | **9 mutants, 0 survivors** |
| races | 1 added (not ceremonial), 5/5 pass |
| platform battery | **4409 passed, 0 failed across 209 suites** |
| clean empty-database rebuild | **474 migrations from empty**; 22 suites, **1225 assertions**, 0 failures |
| production-shaped rehearsal at ledger 473 | `can_manage_club_fixtures` 1/9 → **0/0**; `can_manage_player` defined → **gone** |
| browser | suites 51–59, **247/247** |
| `npx tsc --noEmit` | clean |

### One mutant the database refuses outright

`N7` grants `tournament.tournament.manage` at team scope. `internal.guard_bundle_capability()` rejects
it: *"Capability tournament.tournament.manage is not held at team scope."* That is a stronger
guarantee than a test assertion — the schema makes the mutation impossible rather than detecting it —
and the mutant is kept so the guarantee cannot quietly lapse.

## An environmental failure, recorded rather than hidden

Browser suite 51 timed out three consecutive times on a 60-second server-action POST. It was not the
closure: `next-server` had been running fifteen hours and was down to **24 MB resident at 0% CPU**,
having been paged out by earlier memory pressure, so every request was faulting in from disk. The
development server was restarted; the same suite then ran in **86 seconds** and passed 43/43, and the
new process sat at 2.5 GB resident. No test was changed and no timeout was relaxed to make this pass.

## Two mandated behavioural changes

Both were found by the gate shadow **before** implementation and are asserted in the owning matrices.

1. A **Fixtures Secretary** gains the dispensation read through the target team. J.7 line 471 lists
   `CA, FS` for `fixture.dispensation.request`, and the Secretary already held the source-club branch.
2. A **Coach** can no longer answer a tournament invitation for their team. `tournament.tournament.manage`
   has no team bundle at all (J.8 line 490), and 4D's own `can_manage_tournament_entry` already
   excluded a Coach from entry management. This applies 4D's decision rather than making a new one.

## The limit of production verification

Unchanged from every prior sub-slice, and stated rather than papered over: the application layer is
server-side and behind authentication, and verifying it in production would require creating
production personas or signing in as the product owner, both prohibited. Authority is verified
directly against the production database; behaviour is verified locally against the same migration
tree. Production also holds **no** dispensations, tournaments or tournament participants, so this
authority is live and correct and is currently deciding about an empty set.
