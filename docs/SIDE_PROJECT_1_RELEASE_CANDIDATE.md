# Side Project 1 — Release Candidate

**NO DEPLOYMENT HAS OCCURRED.** Nothing has been pushed, no remote migration has been
applied, and production GoCardless remains disabled.

**Integration identity:** `SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05`
**Prepared:** 2026-09-05 · **Branch:** `main` · **Remote:** `git@github.com:OvalballAppDevs/ovalball-saas-startup.git`

---

## 1. Release candidate commit range

Base (safety tag `pre-release-packaging-safety`) → `9a00bed`
Release commits → `62935f2..e0266d5` (5 commits)

| Commit | Contents |
|---|---|
| `62935f2` | Ignore local ingestion data + tool caches; GoCardless env var names in `.env.example`; removal of dead `team-edit-form.tsx` |
| `6c2c735` | GoCardless Club Subscriptions domain, finance surfaces, provider client, OAuth/webhook routes + 4 hardening migrations |
| `695c386` | Club Settings navigation repair (Guardians & Subscriptions reachable everywhere) |
| `cdbca96` | Mini-Rugby: group-targeted accept fix + opponent-side composition freeze fix + 2 re-runnable test suites |
| `e0266d5` | Side Project 1 regression suites, season-handover cross-club security suite, integration records |

**Final HEAD:** `e0266d5`
**Working tree:** clean (`git status --porcelain` empty)

`9a00bed` was **kept, not restructured.** It is a large WIP snapshot, but rewriting it
offered no functional gain and carried real risk of losing previously-untracked
integration files. Priority order applied: no data loss > reproducible tree > correct
migration chain > tidy history.

## 2. Migration state

- **Repository migrations:** 198 (198 tracked, 198 files — exact match)
- **Local applied:** 198
- **Remote applied:** 15 (bootstrap only, last = `20260830224712`, 2026-08-30)
- **REMOTE BEHIND BY: 183** (first pending `20260831085000`, last `20260929100000`)
- **Remote-only / divergent: 0 · Order conflicts: 0** — no STOP condition

Remote currently holds **24 public tables** — the original bootstrap. This is
effectively a **first full deploy**, not an incremental one.

All ten Side Project 1 + Mini-Rugby-fix migrations are pending remotely:
`20260928000000`, `…100000`, `…200000`, `…300000`, `…400000`, `…500000`, `…600000`,
`…700000`, `20260929000000`, `20260929100000`.

## 3. Clean replay (source-of-truth proof)

`supabase db diff` replayed **all 198 migrations in order into a disposable shadow
database** and reported **"No schema changes found"**, both before and after commit
preparation. This proves the migration chain applies from a clean baseline, in correct
dependency order, with **zero hidden local schema drift**. The playground DB was never
reset or mutated.

## 4. Production data preflight — SATISFIED

Required check:

```sql
select count(*) from public.player_team_memberships
where status not in ('active','pending') and ended_at is null;   -- must be 0
```

Executed **read-only** against remote: `player_team_memberships` **does not exist yet**
(`to_regclass(...) is null`). The table is created by a pending migration, so no
pre-existing row can violate the new constraint. Risk for this deployment: **none**.
Re-run this query if remote is ever advanced independently before deployment.

## 5. `NEXT_PUBLIC_SITE_URL` — HARD GATE

`getAppBaseUrl()` falls back to `http://localhost:3000` so local development needs no
configuration. That fallback must never reach a production GoCardless deployment.

**Hardened in this release** (`lib/payments/gocardless/env.ts`,
`assertGoCardlessRedirectOriginSafe()`): when `GOCARDLESS_ENV=production`, building an
OAuth `redirect_uri` now **throws** unless `NEXT_PUBLIC_SITE_URL` is a real HTTPS,
non-localhost origin. Verified: production+localhost → blocked, production+http →
blocked, production+https → allowed, sandbox+localhost → unaffected.

`NEXT_PUBLIC_SITE_URL` is therefore **REQUIRED AT DEPLOY**.

## 6. GoCardless production gate

Production requires **both** `GOCARDLESS_ENV=production` **and**
`GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED=true`. Neither `NODE_ENV=production` nor the
act of deploying can reach production — there is no `NODE_ENV` reference anywhere in the
provider code. All three credential getters throw when unset rather than defaulting.
Locally: `GOCARDLESS_ENV=sandbox`, go-live flag not true.

## 7. Verification results (post-packaging)

| Check | Result |
|---|---|
| GoCardless / Subscriptions | **150 PASS / 0 FAIL / 0 ERROR** |
| Parent / Guardian | **82 / 0 / 0** |
| Season Handover | **101 / 0 / 0** |
| Player Movement | **68 / 0 / 0** |
| Calendar + Pitch Allocation | **14 / 0 / 0** |
| TypeScript | **0 errors** |
| Lint | **0 errors** (151 pre-existing warnings, none in touched areas) |
| Production build | **Compiled successfully** |

Identical to pre-packaging figures — the Git packaging changed no runtime behaviour.

## 8. Known baseline test failures (NOT fixed here, NOT claimed passing)

The full battery is **955 PASS / 199 FAIL / 178 ERROR**. This is **not** "all tests
pass". Two documented, pre-existing causes, neither a product defect and neither
introduced by this work (PASS rose 942 → 955):

1. Seed fixture rows (`30000000-…001` and family) were deleted by earlier fixture-data
   cleanup; `permission_matrix.sql` does **not** recreate them (verified). Suites
   referencing them fail — e.g. `tournaments` (10 refs), `fixture_results` (8 refs).
2. Non-idempotent legacy suites failing on their own leftover state — e.g.
   `team_lifecycle` fails on a team it folded in a previous run.

Only a full `db reset` restores (1); that would destroy the local playground data and
was deliberately not done. Repairing the ~47 legacy suites is a separate workstream.

## 9. Files deliberately excluded from the release

| Path | Reason |
|---|---|
| `.env.local` | secrets; gitignored, never committed in any history |
| `data/clubcontacts/`, `data/clubdata/`, `data/fixturedata/` | local ingestion input; `teamdirectoryexample.csv` holds ~57 real club contact emails (PII) |
| `data/clublogo/` (new PNGs) | **no application code reads this directory**; crests are served from Supabase Storage via `logo_storage_path` (`lib/app-context/club-logo.ts`). The 56 crests already tracked in `9a00bed` are left tracked — removing them would rewrite history for no functional gain. One new untracked PNG (`Wigan RUFC.png`) is excluded. |
| `.impeccable/`, `.claude/skills/` | tool caches |

## 10. Test 7 / provider readiness — carried forward, still open

**Not** ready for partner submission. Outstanding provider evidence:

1. Real webhook delivery + signature verification via a public HTTPS endpoint.
2. Real Direct Debit mandate creation end-to-end.
3. Real payment lifecycle through `confirmed` → `paid_out`.

Sandbox OAuth connect is **verified** (reached the genuine
`connect-sandbox.gocardless.com` "Connect to GoCardless" page) and is **not** an open
item. Test 7 is tracked separately from code deployment readiness.

## 11. Deployment authorization status

**NOT AUTHORIZED.** This document records a prepared release candidate only.
Deployment requires explicit user authorization.
