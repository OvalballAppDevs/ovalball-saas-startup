# Deployment Record — 2026-09-05

**Integration identity:** `SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05`
**Type:** First full deployment (183 pending migrations onto an early bootstrap remote)
**Deployment start (UTC):** 2026-09-05T13:30:50Z

No secrets are recorded in this document.

---

## Pre-deployment state

| Item | Value |
|---|---|
| Local HEAD | `b34880e` |
| Working tree | clean |
| origin/main (before push) | `ad84f14` |
| Commits to push | 7 |
| Supabase project ref | `ywwdizmaanbujcfitpcj` |
| Repository migrations | 198 |
| Remote migrations applied | 15 (last `20260830224712`) |
| Pending migrations | 183 |
| Divergent / order conflicts | 0 / 0 |
| Remote public tables (before) | 24 |

### Remote data at risk (pre-deploy)
| Table | Rows |
|---|---|
| `public.club_directory` | 1,389 |
| `auth.users` | 1 |
| `clubs`, `teams`, `fixtures` | 0 |

## Backup / restore point

Created before any write, stored **outside the repository** at `~/ovalball-deploy-backups/`:

| File | Size | Validation |
|---|---|---|
| `remote-data-20260905T133152Z.sql` | 5,338,549 bytes | valid `PostgreSQL database dump` header; contains all `club_directory` rows |
| `remote-schema-20260905T133152Z.sql` | 80,233 bytes | 93 DDL statements |
| `remote-roles-20260905T133152Z.sql` | 370 bytes | 3 role statements |

Verified to contain no environment secrets.

## Deployment-time preflight (S4)

| Risk | Finding |
|---|---|
| `player_team_memberships` status constraint | Table does not exist remotely — created by a pending migration; no pre-existing row can violate it. **Safe.** |
| `club_directory.geocode_status` added `NOT NULL` | Declared `DEFAULT 'pending'`. **Safe** against 1,389 rows. |
| `club_directory_nation_check` (re-added) | Allowed set: England / Scotland / Wales / Northern Ireland / Republic of Ireland. Actual remote data: England 916, Wales 284, Scotland 177, Northern Ireland 12 = 1,389, no NULLs. **All conform — will pass.** |
| `seasons` `SET NOT NULL` (3 migrations) | `seasons` has 0 remote rows. **Safe.** |

No `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` or unpredicated `DELETE` in the release set.

## Constraints held throughout

- Production GoCardless **remains disabled** — requires both `GOCARDLESS_ENV=production` and `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED=true`.
- No real provider mandates/payments/subscriptions created.
- Test 7 provider evidence remains **open and deferred**:
  1. real webhook delivery + signature verification via public HTTPS
  2. real Direct Debit mandate creation
  3. real payment lifecycle `confirmed` → `paid_out`

---

## Execution log

*(populated below as the deployment proceeds)*
