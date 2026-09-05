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
### 1. Source push — SUCCESS

`git push origin main` → `ad84f14..1c3b3d5`. origin/main now resolves to `1c3b3d5`,
matching local HEAD. No force push, no rebase.

### 2. Migration application — FAILED, STOPPED AT FIRST ERROR

`supabase db push --linked` applied 2 of 183 migrations, then failed. Per the deployment
rule the run was stopped immediately; no migration was skipped, no `migration repair`
was used, and no later migration was attempted.

| Item | Value |
|---|---|
| Applied this run | `20260831085000_notifications`, `20260831090000_role_vocabulary_and_claim_approval` |
| **Failed migration** | **`20260831091000_invitations.sql`** |
| Database error | `function gen_random_bytes(integer) does not exist (SQLSTATE 42883)` |
| Last successfully applied | `20260831090000` |
| Remote applied / pending | **17 / 181** |
| Application deployed? | **No** — deployment never started |

### 3. Root cause — search_path, not a missing extension

`pgcrypto` **is** installed on remote, in the `extensions` schema. In an ordinary remote
session `search_path = "$user", public, extensions` and unqualified `gen_random_bytes`
resolves. The CLI's **migration-apply session runs with a narrower search_path that
excludes `extensions`**, so the unqualified call fails there.

The migration's own comment assumed `gen_random_bytes` behaves like `gen_random_uuid`.
It does not: `gen_random_uuid()` is a PostgreSQL built-in (`pg_catalog`), whereas
`gen_random_bytes()` is supplied by pgcrypto and must be reachable via search_path.

This is why the local clean replay passed — the local Supabase stack's migration session
has `extensions` on its search_path, so the asymmetry only appears against remote.

### 4. Remote health after the stop — HEALTHY

| Check | Value |
|---|---|
| `club_directory` rows | 1,389 (unchanged) |
| `auth.users` | 1 (unchanged) |
| public tables | 25 (24 + `notifications`) |
| Data loss | none |

The two applied migrations are additive. The backup/restore point was **not** needed and
was not used.

### 5. Forward-fix assessment (NOT applied — awaiting authorization)

Four **pending** migrations use unqualified pgcrypto functions and would each hit this
same error in order:

1. `20260831091000_invitations.sql` (the failure)
2. `20260831260000_site_admin_management.sql`
3. `20260917000000_partner_club_invitations.sql`
4. `20260928200000_side_project_1_player_guardian_foundation.sql`

Recommended fix: schema-qualify the calls (`extensions.gen_random_bytes(...)`), which is
semantically identical, requires no new extension, and changes no already-applied object.
None of the four has been applied remotely, so editing them creates no remote divergence.
All four are already applied locally with identical semantics, so local state is unaffected.

Rollback was **not** performed: the failure occurred before application deployment, the
database is healthy, and restoring would discard two clean additive migrations for no
safety benefit.
