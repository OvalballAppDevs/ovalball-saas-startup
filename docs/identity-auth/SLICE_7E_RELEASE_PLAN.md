# Convergence Step 5 / Slice 7e — release plan

**Nothing in this document has been done.** Step 5 banks locally; the release is
a separate, authorised act. This is written now, while the reasoning is fresh,
rather than reconstructed on the night.

---

## 1. What ships

Four migrations, `20270504000000` … `20270507000000`:

| | |
|---|---|
| `20270504000000_site_search_users` | AB.3. Adds `public.site_search_users`. Additive. |
| `20270505000000_site_admin_can_read_the_roster_it_can_change` | Adds `public.site_player_team_memberships`. Additive; asserts the roster RLS policy is **unchanged**. |
| `20270506000000_retire_is_site_admin` | **Destructive.** Recreates `admin_club_overview` gated on `site.clubs.view`, then `drop function internal.is_site_admin()`. |
| `20270507000000_the_timelines_can_see_their_own_events` | Replaces the bodies of the three history functions and adds `public.site_account_history`. Signature-compatible. |

Plus the application: the thirteen-tab record, `master-control.ts`, the Create
User wizard, the Site Admin grant queue, and the list page's move onto the RPC.

---

## 2. Order, and why

**Migrations first, then the push** — on Ovalball the push to `main` *is* the
deployment, because Vercel builds on it.

That order is not merely the convention here; it is required by
`20270506000000`, which drops `internal.is_site_admin()`. If the push went first,
the new build would call `site_search_users` and `site_player_team_memberships`
before they exist, and **Users & Access would fail entirely** — the list page has
no fallback, by design, since a search that silently returns everything is worse
than one that errors.

Applying migrations first inverts the exposure to something much smaller: for the
length of the build, the previously-live build is running against a database
whose `admin_club_overview` is gated on `site.clubs.view` rather than
`is_site_admin()`. Every Site Admin profile holds `site.clubs.view`, so the club
list keeps working for everybody who could already see it. No live code path
calls `internal.is_site_admin()` — that is what `S7E-30`/`S7E-31` assert, and it
was true in production before this step began.

**Verify the baseline before writing anything, by reading production.** This
repository holds 528 migration files, of which four are Slice 7e's, so the
expected production baseline is the 524 up to and including `20270503000000`.

Read that from production rather than inferring it from local. The local
`schema_migrations` table records **521**, because several migrations have been
applied during development with `psql` directly rather than through the CLI. That
gap is local bookkeeping and cannot affect a `db push`, which computes what is
missing from the **remote** record — but it does mean the local count is not
evidence of anything, and a release that quoted it would be quoting the wrong
number. The isolated clean boot is the proof that the file list applies in order
from empty; production's own record is the proof of where production is.

If production is not at that baseline, stop: the rehearsal is only predictive
against the baseline it rehearsed.

`supabase db push --dry-run` first, and check it lists exactly these four and
nothing else — no seeds, no roles.

---

## 3. The one thing to check in production first

`20270506000000` refuses to run if `site.clubs.view` does not exist, and recreates
a view whose definition is captured from the **local** database. A view definition
that has drifted in production would be silently replaced by the local one.

Before release, diff `pg_get_viewdef('public.admin_club_overview')` between
production and local, ignoring the `WHERE` clause. If anything else differs,
**stop and re-derive the migration from production's definition** — this is
exactly the case where "it worked locally" means nothing.

---

## 4. Post-release verification (read-only)

| | expected |
|---|---|
| Migrations | baseline + 4, tip `20270507000000`, all four recorded and nothing unexpected |
| `internal.is_site_admin` | **gone** |
| Policies / functions / views referencing it | 0 / 0 / 0 |
| `admin_club_overview` gate | `site.clubs.view` |
| `site_search_users`, `site_player_team_memberships`, `site_account_history` | present, `authenticated` only, never `anon` |
| `player_team_memberships_select` | unchanged — **no** `has_site_capability` clause |
| Build live | `/admin/users?tab=` serves; `/admin/users/<id>?tab=audit-history` serves |

**Nothing is to be manufactured in production to make a check observable.** No
persona, no membership, no grant request. Behaviour is verified locally and in
the isolated clean boot; where a production check cannot be made without creating
data, the gap is stated rather than filled.

---

## 5. L7 — the contract half that this release enables

Ledger **L7**: `accept_invitation` and `get_invitation_preview` are a second,
granted role-grant path over `public.invitations`, which holds **0 rows**. Step 3
deleted their last consumers (`app/invite/[token]/`) but deliberately left the
functions granted, because a release that removes an endpoint in the same deploy
that removes its caller has no rollback.

L7's owner is *"the release after this one deploys"* — and **this is that
release**, if Step 3's unit is already live. The contract step is therefore
in scope for the same window, but as its **own migration and its own decision**:

1. confirm `public.invitations` still holds 0 rows in production;
2. confirm no build has called `accept_invitation` or `get_invitation_preview`
   since Step 3 went live — `security_events` and the PostgREST logs both answer
   this, and both must agree;
3. only then revoke the grants and drop the functions.

If Step 3 is **not** yet live in production, L7 stays open and this release does
not touch it. That condition is checked, not assumed. Slice 7e's own migrations
have no dependency on it either way, so L7 can be dropped from the window without
disturbing anything above.

The four `manifest-consumer-baseline.json` entries pointing at the deleted
`app/invite/[token]/` routes are L7's to remove, not this step's — they document
precisely the functions L7 retires, and clearing them early would erase the
signpost.

---

## 6. Rollback

`20270504000000`, `20270505000000` and `20270507000000` are additive or
signature-compatible: reverting the application build restores the previous
behaviour and the unused functions sit inert.

`20270506000000` is the one with a real rollback cost, because it drops a
function. Recreating `internal.is_site_admin()` is three lines, but the honest
rollback is **re-deploying the previous application build**, which does not call
it either. In other words the drop is safe to leave in place while rolling the
build back — and that is worth knowing in advance rather than discovering at
speed.

---

## 7. Not in this release

- **S7-13 / AN-3** — a second Full Site Admin in production. An owner operation
  (T1), unchanged by this step, and the reason the two-administrator grant queue
  will show "nothing is waiting" and be unable to approve anything until it
  happens. That is the rule working, not a defect to route around.
- Mandatory MFA enforcement. Stage 0 proved the AAL2 boundary; **enforcement
  groups stay off**, and turning them on is the T3–T5 sequence with its own
  monitoring.
- The `club_directory` column breadth for `authenticated`, which belongs to the
  Site Admin **club** surface's own pass.
