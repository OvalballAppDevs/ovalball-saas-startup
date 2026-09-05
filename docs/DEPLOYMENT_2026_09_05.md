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

---

## Forward fix — pgcrypto search_path portability

### Scope (complete chain scan)

`gen_random_bytes` appears **6 times across 4 files — all PENDING remotely, none in an
already-applied migration**, so no historical remote-applied file was modified:

| File | Calls | Status |
|---|---|---|
| `20260831091000_invitations.sql` | 1 (+1 comment) | pending |
| `20260831260000_site_admin_management.sql` | 1 | pending |
| `20260917000000_partner_club_invitations.sql` | 1 | pending |
| `20260928200000_side_project_1_player_guardian_foundation.sql` | 2 | pending |

Focused scan for other extension-owned functions in pending migrations
(`crypt`, `gen_salt`, `digest`, `hmac`, `pgp_*`, `encrypt`, `decrypt`, `uuid_generate_*`,
`armor`, `sign`, `verify`): **no other unqualified occurrences**.
`gen_random_uuid()` is confirmed a `pg_catalog` built-in, which is why it never failed.

### The fix

Only change: `gen_random_bytes(...)` → `extensions.gen_random_bytes(...)` (5 call sites).
No change to arguments, encoding, token length, constraints, tables, functions, RLS,
grants or business logic. The stale comment in `20260831091000` that asserted the
unqualified form was safe was corrected to explain the actual behaviour.

### Semantic equivalence (proved locally)

| Property | Result |
|---|---|
| Same function oid | **true** (16418) |
| Argument type | `integer` |
| Return type | `bytea` |
| Owning extension | `pgcrypto` |
| `encode(...,'hex')` length for 32 bytes | 64 chars — token format unchanged |

### Narrow-search_path validation (the check the shadow replay could not make)

Reproduced the remote migration-session condition locally with `search_path=public`:

- unqualified `gen_random_bytes(32)` → **fails, SQLSTATE 42883** (matches the remote failure exactly)
- `extensions.gen_random_bytes(32)` → **succeeds, 32 bytes**

This is retained as the meaningful portability evidence. A local clean replay alone is
**not** sufficient for this class of bug, because the local stack's migration session
includes `extensions` on search_path while the remote one does not.

### Migration-history integrity (checked, not assumed)

`supabase_migrations.schema_migrations` columns: `version (text)`, `statements (ARRAY)`,
`name (text)` — **no checksum/hash column**. Tracking is version-based, so editing the
content of an already-locally-applied migration does not invalidate local history. The
CLI reported no integrity warning afterwards.

Local tables created before this edit still carry the unqualified default expression;
that is expected and harmless — the fix governs **fresh** applications (i.e. remote),
which the clean replay exercises.

### Post-fix verification

| Check | Result |
|---|---|
| Clean replay (198 migrations, shadow DB) | **PASS — "No schema changes found"** |
| `parent_add_child_regression` | 34 PASS / 0 / 0 |
| `side_project_1_player_guardian_foundation` | 7 PASS / 0 / 0 |
| `site_admin_management` | 14 / 2 / 0 — **identical to pre-existing baseline** |
| `partner_club_invitations` | 4 / 0 / 2 — **identical to pre-existing baseline** |
| TypeScript | 0 errors |

---

## Resumed deployment — DATABASE COMPLETE

### Migration run 2 — SUCCESS

Resumed from `20260831091000`. **All 181 remaining migrations applied with no error.**

| Check | Result |
|---|---|
| Repository migrations | 198 |
| Remote applied | **198** |
| Pending | **0** |
| Divergent / order conflicts | **0 / 0** |

No `migration repair`, no reset, no skipped migration, no manual history edit.

### Data integrity — PRESERVED

| Item | Before | After |
|---|---|---|
| `club_directory` rows | 1,389 | **1,389** |
| `auth.users` | 1 | **1** |
| public tables | 25 | **109** |
| capability keys | — | 47 |

Backup was **not** needed and **not** restored.

### Remote schema sanity — PASS

Core (`clubs`/`teams`/`seasons`/`fixtures`) 4/4 · Mini-Rugby 2/2 · Player/Guardian
(`players`, `guardians`, `player_team_memberships`, `guardian_player_permissions`,
`player_account_invitations`, `player_duplicate_reviews`) present · subscription domain 5 ·
GoCardless domain 9 · Finance domain 2. **Duplicate namespaces (`sp1_*`, `*_v2`): NONE.**

Remote matches local exactly: **109 public tables and 47 capability keys on both**.

### Remote security sanity — PASS

| Check | Result |
|---|---|
| Tables without RLS | **0** (all 109 enabled) |
| anon-executable finance functions | **0** of 18 |
| anon INSERT/UPDATE/DELETE grants on `gocardless_*` | **0** |
| Key capabilities present | 4/4 |

### Application deployment — NOT PERFORMED (no target exists)

The repository has **no application deployment target**: no `vercel.json`,
`.vercel/project.json`, `netlify.toml`, `wrangler.toml`, `fly.toml`, `Dockerfile`, no
CI/CD workflow, and no deploy script in `package.json`. No production origin is
referenced anywhere in the repository.

Consequently the following could **not** be performed and are **not** claimed:
application deployment, deployment ID, production URL, production environment variable
validation, and all production smoke tests (core, Side Project 1, Finance security,
OAuth origin).

`NEXT_PUBLIC_SITE_URL` was undocumented; it has now been added to `.env.example` with the
production requirement stated.

### GoCardless — remains disabled

No production provider mode was enabled and no provider object was created. The two-flag
gate (`GOCARDLESS_ENV=production` **and** `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED=true`)
is unchanged, and `assertGoCardlessRedirectOriginSafe()` additionally refuses a
production OAuth redirect built on a localhost/non-HTTPS origin.

### Test 7 — still deferred

1. real webhook delivery + signature verification via public HTTPS
2. real Direct Debit mandate creation
3. real payment lifecycle `confirmed` → `paid_out`

---

## Application hosting — BLOCKED AT VERCEL AUTHENTICATION

Attempted after the database deployment completed (198/198).

| Check | Result |
|---|---|
| Vercel CLI on PATH | not installed (used `npx vercel@latest`, no global install) |
| `~/.vercel` / `.vercel` auth artifacts | none |
| `VERCEL_TOKEN` (env or `.env.local`) | not set |
| `npx vercel whoami` | **"Logged out."** |

No Vercel account is authenticated on this machine and no token is available.
`vercel login` is interactive, so authentication could not be completed
non-interactively. No credentials were invented and no token was requested in chat.

**Therefore not performed:** project creation, repository link, environment
configuration, preview deployment, production deployment, and every production smoke
test (core, Club Settings navigation, Finance, Parent/Guardian, security, OAuth origin,
webhook route, log review). None of these are claimed.

### Auth-independent preparation completed

| Item | Result |
|---|---|
| Local verification on `736298a` | TypeScript **0 errors**, lint **0 errors** (151 pre-existing warnings), production build **succeeds** |
| S9 — GoCardless not required at startup | **Proven**: production build succeeds with **zero** `GOCARDLESS_*` variables; no credential getter runs at module load |
| S11 — startup-critical variables | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` throw when unset (`lib/supabase/env.ts`); `SUPABASE_SERVICE_ROLE_KEY` is feature-level (server-only); `NEXT_PUBLIC_SITE_URL` used by 10 files |
| S8 — Supabase target | Production must point at ref `ywwdizmaanbujcfitpcj`. Local `.env.local` points at `127.0.0.1:54321`, so production Supabase values must come from the Supabase dashboard, not local config. |
| S31 — hosting documentation | `docs/PRODUCTION_HOSTING.md` created |
| `.vercel` gitignored | yes |

### Smallest exact manual action required

Run on this machine, then tell me:

```
npx vercel login
```

(or export a `VERCEL_TOKEN` into the environment for non-interactive use).

After that I can complete link → env configuration → preview → production → full smoke
testing without further input, except that the three Supabase production values must be
entered by a human — I will not handle or print them.

---

## Public contact — where messages actually go (added 2026-09-05)

Canonical identity, defined once in `lib/legal/metadata.ts`:

| Item | Value |
|---|---|
| Public contact address | `hello@ovalball.co.uk` (`CONTACT_EMAIL`) |
| Operator | Pipaxon Technologies Ltd (`OPERATOR_NAME`) |
| Copyright line | `© <year> Pipaxon Technologies Ltd. All rights reserved.` (`copyrightLine()`) |
| Canonical About route | `/about` |
| Canonical Contact route | `/contact` |

### OWNER MANUAL ACTION — outbound email is not connected

**No outbound email provider is configured for this application.**
`lib/email/dispatch.ts` is an explicit development no-op: it logs what would be
sent and returns. This predates the Contact work and is unchanged by it.

Consequences, stated plainly so nobody assumes otherwise:

- A message submitted through `/contact` (or `/support`) **does not arrive in the
  `hello@ovalball.co.uk` inbox.** It is written to `public.support_tickets` and
  appears in the Site Admin Support Register at `/admin/support`.
- A `mailto:` to `hello@ovalball.co.uk` works normally — that is the visitor's own
  mail client and does not depend on this application at all.
- Nothing is silently dropped: every submission is durably stored with a reference,
  and the submitter is told their message was sent to the team, which is true.

**Smallest action to connect delivery** (all owner-side; do not invent credentials):

1. Create a mailbox or forwarding rule for `hello@ovalball.co.uk`.
2. Add a transactional email provider (Resend is the provider `dispatch.ts`'s own
   comment anticipates), verify the `ovalball.co.uk` sending domain, and complete
   SPF/DKIM/DMARC.
3. Put the provider's API key in Vercel as a **Sensitive** server-only variable —
   never a `NEXT_PUBLIC_*` name, and never in the repository.
4. Replace the dev no-op block inside `dispatchEmailEvent()` with the provider call.
   Every existing call site stays unchanged; that is why the function exists.
5. Raise a `support_ticket_created` event on the public submission path so new
   tickets notify `hello@ovalball.co.uk`. Set `Reply-To` to the submitter's address,
   and keep `From` on a verified `ovalball.co.uk` sender so SPF/DMARC still pass —
   never send as the submitter's own unverified address.

Until step 5 is done, the Support Register is the only place contact messages are
seen, so it needs to be checked.

### Production verification performed

One controlled production submission through the live form created ticket
**`OB-260905-0001`** (`origin=public`, `category=other`,
`subject="Contact — General enquiry"`), confirmed by direct query against the
production database. This proves the production contact path works end to end into
the Support Register. It does **not** prove email delivery, because no email is sent.
