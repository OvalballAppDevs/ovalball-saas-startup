# Identity/Auth Slice 7 — production release report

**Released 17 September 2026.** Commits `bf5ce97` … `cc16441` (14), fast-forward `b7f8a76..cc16441`.
Thirteen migrations, `20270417000000` … `20270429000000`.

## Release

Migrations first, then the push, because on Ovalball the push to `main` *is* the deployment — Vercel
builds on it. That order also matters specifically here: `20270421000000` drops
`public.set_account_status`, which the previously-live build called to suspend accounts. Applying the
migrations first leaves three Site Admin actions failing for the length of the build; pushing first
would have left the whole Users & Access page failing, because it reads a column the view did not yet
have. The narrower window was chosen deliberately, and it affected one person — production has one
Site Admin.

Production was checked before anything was written: **507 migrations, tip `20270416000000`**, exactly
the stated baseline, with 90 labelled policies, 60 definer bodies on `is_site_admin()`, 30 on
`is_full_site_admin()` and 3 policies on `site_admin_support_level()` — identical to the local
pre-slice counts, which is what made the rehearsal predictive.

`db push --dry-run` first: exactly the thirteen Slice 7 migrations, no seeds, no roles, nothing
unrelated.

## Production verification

| | |
|---|---|
| Migrations | **520**, tip `20270429000000`, all thirteen recorded, none unexpected |
| PG-15 (incl. the presentation-role family) | **0** |
| PG-16 (incl. `is_full_site_admin`, `site_admin_support_level`) | **0** |
| Master-control RPCs | **20** |
| `internal.is_full_site_admin` | **gone** |
| `public.set_account_status` | **gone** |
| Browser INSERT/UPDATE/DELETE on `site_admins` | **0** |
| `site_admins` SELECT lets a person see themselves | yes |
| The three support policies name the capability | 3/3 |
| `admin_user_overview` has `account_state` **and** `security_invoker` | yes / yes |
| Retired capability reachable through `has_site_capability` | **0** policies, **0** functions |
| New security event types registered | 8/8 |
| The one Full Site Admin's bundle | **51** capabilities |
| Build live | `/admin/users/new` serves (307), not 404 |

**Nothing was manufactured in production.** Profiles still 4, clubs still 1, `site_admin_grant_requests`
still empty, the pending invitation still pending. No persona was created to make a check observable;
behaviour is verified locally and in the production-shaped rehearsal, and that is stated rather than
papered over.

### One number that looked alarming and was not

A first, crude check reported "61 policies reference a DEPRECATED capability". They do, and it is
correct: they call `internal.has_capability()`, the compatibility adapter, which translates legacy
keys through `public.capability_key_map` — `site.hub_content.view` → `site.hub.view`, and likewise
`team.view`, `fixture.edit`, `team.manage`, `club.roster.manage`. The adapter retires at Slice 10.

The invariant that actually matters is the **non-translating** call: a retired key passed to
`internal.has_site_capability()` goes straight to `capability_decision`, which refuses it at rule 1
and so denies **everybody, including a Full Site Admin** — an authority loss nobody notices, because
nothing starts working that should not. In production that count is **0 policies and 0 functions**,
and it is now a permanent assertion (`PG16+`) rather than a thing I checked once.

## What changed for the one Site Admin in production

They are SITE_FULL, so they keep all 51 site capabilities and lose nothing. What changes is that every
master-control action now requires **an authenticator code from the last ten minutes** and **a reason
of at least ten characters**, and suspending an account records that reason. Three actions that were
single clicks are now a click, a sentence and a confirmation.

## Carried forward — needs the platform owner

1. **AN-3, and the pending invitation.** Production holds one pending Site Admin invitation for
   `full`, issued 14 September and expiring **21 September 2026**. After this release it confers
   nothing on its own: the grant it would make is the one that needs a second Full Site Admin to
   approve. This was not weakened for it — Phase 2 says the first additional Full Site Admin comes
   from a documented bootstrap procedure, "not by relaxing the rule in code".
   `docs/identity-auth/SITE_ADMIN_BOOTSTRAP.md` is that procedure, and it has been rehearsed end to
   end against a production-shaped database: one Full Site Admin became two, the exception is
   permanently visible as `bootstrap = true`, an undeclared self-decided row is still refused, and the
   ordinary two-person path then worked between them.
   **Either run it for that person and revoke the invitation, or let it expire and grant them the
   ordinary way once a second Full Site Admin exists — but tell whoever holds it which**, rather than
   letting them click it and meet a refusal.
2. **`SUPABASE_SERVICE_ROLE_KEY` must be set in the Vercel project** or Create User fails at
   `auth.admin.createUser`. Nothing else in Slice 7 depends on it, and it was not verified from here
   because that would mean creating a production identity.
3. **T1–T6 are not activated.** Authentication remains at AG.2 **T0**, no enforcement, as Slice 6 left it.

## Rollback

Every migration is additive or a policy/function replacement; none drops data. Reverting would mean
restoring `set_account_status`, the four `site_admins` write policies and the label helpers — all
recoverable from `b7f8a76`. No table was dropped and no row was deleted, so a rollback loses nothing
but the slice.
