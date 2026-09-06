# Site Admin Dashboard — Data & Architecture Audit

**Stage 1 — live data, metric, commercial, referral and architecture audit.**

Status: **audit only.** No dashboard code, no migrations, no schema changes, no
pushes, no deploys were produced by this stage.

| | |
|---|---|
| Repository | `ovalball-saas-startup` (MAIN) |
| Branch at audit | `main`, working tree clean, HEAD `f6cefb7` |
| Schema audited | local Supabase Docker (`supabase_db_ovalball-saas-startup`), **225/225 migrations applied**, latest `20261011140000` — byte-identical migration set to `supabase/migrations/` |
| Side Project 1 / 2 | integrated into Main and read as canonical (Side Project 2's `20261011*` training migrations are present) |
| Side Project 3 | **not touched, not read, not referenced** |
| Live verification | signed in as a Full Site Admin against the local app on `localhost:3000` and inspected the real rendered `/dashboard` and `/admin/commercial` |

Every count in this document that describes data (rather than schema) comes from
the **local development database**. Local dev is not production; production
figures will differ. Schema facts, function bodies, RLS policies, constraints and
gaps described here are properties of the migration set itself and therefore hold
in production too.

---

## Accepted product decisions

Confirmed by the owner after the Stage 1 audit, and binding on every later phase.

| | Decision |
|---|---|
| **A** | **Phase F₀ (referral attribution correctness) completes before Phase F₁ (referral analytics).** Authoritative analytics will not be built over known-incomplete attribution. *Done — see `docs/REFERRAL_ATTRIBUTION_INTEGRITY.md`.* |
| **E** | **A referral's beneficiary is the club, its actor is the person.** When an authorized Site Admin sends a club referral invitation on behalf of a referring club, the canonical referrer and reward beneficiary is that **club** (`platform_referrals.referring_club_id`); the Site Admin is recorded only as the actor (`created_by`, `club_ovalball_invitations.invited_by`, and `audit_log`). A Site Admin never personally becomes a beneficiary, and no person-level referral reward system exists. Dashboard terminology is therefore **Top Referring Clubs**, never "Top Referring Users", unless a genuine person-level programme is designed later. *Already the implemented behaviour — verified, not changed.* |
| **B** | **No heuristic test-record filtering.** KPI entities have no canonical test-data marker and none will be inferred from email domain or prefix, name, club name, UUID, creation date, or local seed convention. Analytics report canonical production records. Explicit classification is a separate future decision. |
| **C** | **Referral rewards are reported as money, never as reverse-calculated months.** "One month free" is stored as a snapshotted pence amount; analytics use *reward value earned / applied / outstanding*. Product copy may still explain the offer as a free month. |
| **D** | **Beta leaderboard ranks on referred clubs activated, not paid conversions**, because paid conversions are structurally zero during Beta. Once paid platform billing is live, successful paid referrals may become the primary commercial ranking. |

---

## Phase A — implemented

Phase A built the foundation and the first two real sections. What follows in
sections A–Z below is the Stage 1 **audit**, retained as the reasoning; this
section is what actually exists in code.

### Routing and context

One route. `app/(app)/dashboard/page.tsx` branches on
`activeContext.kind === "site_admin"` into `SiteAdminDashboard`; every other
context keeps its existing behaviour untouched. There is deliberately no
`/admin/dashboard`.

**Context decides presentation; it never grants authority.** The branch
re-authorizes with `requireActiveSiteAdmin` on the request, and all three RPCs
authorize again in the database. A Site Admin running a *diagnostic* session is
not caught by the branch — `resolveDiagnosticClub` gives them a synthetic club
context, which is the point of diagnostic mode.

Proven live with one account that is simultaneously a Full Site Admin, a Club
Admin at three clubs, a Team Admin and a Parent/Guardian:

| Active context | Dashboard rendered | Platform data present |
|---|---|---|
| Ovalball (Site Admin) | Site Admin command centre | yes |
| Burnley RUFC (Club Admin) | existing club dashboard | no |
| Robin — U12 (Parent/Guardian) | existing parent dashboard | no |

### Read model

`supabase/migrations/20261013000000_site_admin_dashboard_read_model.sql` —
three `security definer` functions, grouped by refresh class, each authorizing
as its first statement, each returning one row. Never one query per tile.

| Function | Contents | Authorization |
|---|---|---|
| `site_admin_dashboard_platform()` | population counts + directory size | Site Admin |
| `site_admin_dashboard_operations()` | fixtures today, claims, directory requests, stuck fixture requests, disputed and awaiting results, open tickets | Site Admin |
| `site_admin_dashboard_commercial()` | trials, subscriptions, referral funnel counts, canonical `referral_data_health()` status | Site Admin **and** `site.commercial.view` |

`lib/app-context/site-admin-dashboard-data.ts` issues all three in parallel and
contains every failure to its own section. It is a **sibling** of
`dashboard-data.ts`, not an extension: that file is correct for personal,
team-scoped dashboards and must never hold platform-wide aggregates.

### KPI definitions implemented

| Metric | Rule | Regression |
|---|---|---|
| Registered users | `count(profiles)` — completed person accounts, **not** `auth.users` | 14, 14b |
| Registered clubs | `count(clubs)`; a row exists only after `approve_club_claim` | 15, 16 |
| Registered teams | `count(teams)`; active = `active and folded_at is null and archived_at is null` | — |
| Registered parents | `count(distinct guardian_user_id) where status='active'` — **people, not relationship rows** | 17, 18 |
| Registered players | `count(players)` — sporting identities, never summed with users | 19 |
| Directory clubs | `count(club_directory) where active` — reported separately, labelled addressable market | 16 |
| Fixtures today | `admin_fixture_overview` with `is_primary_mirror`, excluding `Cancelled` | 20, 21, 22 |

No heuristic test-data filtering anywhere (Decision B).

### Error, loading, empty and unauthorized semantics

`ReadState<T>` is a discriminated union — `ok` / `omitted` / `unauthorized` /
`error` — and the UI must handle each. This supersedes the old dashboard's
silent error swallowing: an unauthorized read **raises 42501** and a failed read
renders an explicit "could not be loaded — this is a read failure, not a zero"
panel, so a query failure can never be mistaken for "0 clubs" (regression 23).
A section's failure never blanks the rest of the page.

`omitted` is distinct from `unauthorized`: it means the section was never
requested because the capability is absent, so commercial data is omitted
**server-side**, not fetched and hidden.

### Refresh and caching

No Supabase Realtime — nothing here changes fast enough to justify a socket per
Site Admin. `UpdatedAt` re-renders the Server Component via `router.refresh()`
every 60 s **only while the tab is visible**, plus a manual Refresh control.

**No cross-request caching in Phase A, deliberately.** Measured warm timings are
platform ~0.9 ms, operations ~0.7 ms, commercial ~8.7 ms; there is nothing to
save, and caching privileged aggregates across users would need a correctness
argument this phase does not need to make.

### Indexes — none, with evidence

`explain (analyze, buffers)` on the one selective read (fixtures today) shows a
3-page sequential scan at 0.061 ms. A `fixtures(kickoff_date)` index was
created, measured, found unused by the planner, and **removed**. Add it when
`public.fixtures` exceeds roughly 50k rows or the operations RPC exceeds ~50 ms;
note `fixtures_owning_team_id_idx` will not serve it, because its leading column
is the team and this query supplies no team. The eight other Stage 1 candidates
are deferred until a phase actually issues their query.

### Drill-through convention

A card or alert links only where a canonical Site Admin destination genuinely
exists. Where none does, it renders without a link rather than with a plausible
one.

| Destination exists | Registered users → `/admin/users` · Registered clubs → `/admin/clubs` · Registered teams → `/admin/team-directory` · Club claims → `/admin/claims` · Disputed / awaiting results → `/admin/fixtures?resultStatus=…` · Support → `/admin/support` · Past due & trials → `/admin/commercial` · System Health → `/admin/system-health` |
|---|
| **Missing — recorded, not faked** | Registered parents · Registered players · directory requests · stuck fixture requests · an exact `date=today` fixture filter · the Site Admin referral administration screen (Stage 1 R-5, required before Phase F₁) |

### Visual shell

`max-w-7xl`, existing Operate-mode tokens only, no chart library added. Sections
implemented: Platform pulse, Needs attention, Platform state (mode, release,
billing, fixtures today, referral data health). Growth, rugby activity, finance
visuals, Top Referring Clubs, referral funnel and platform activity are **absent
rather than stubbed** — no placeholder holds an invented number and nothing says
"coming soon".

New primitives: `components/dashboard/kpi-card.tsx` (carries trend, comparison
and sparkline slots but renders none without real data),
`dashboard-section.tsx` (+ `SectionError`, `SectionUnauthorized`),
`alert-list.tsx`, `updated-at.tsx`.

Accessibility verified in the live DOM: `h1 → h2 ×3` with no skipped level,
every section `aria-labelledby` resolving, 0 unlabelled SVGs, 0 images without
alt, severity announced as text (`— Action required`) so status is never
colour-only, and a `sr-only` expansion of the Beta badge.

### Mobile UAT — CLOSED

Phase A originally shipped with this gap open. It has since been closed at a
**genuine 390 x 760 layout viewport**, using a same-origin iframe: CSS media
queries and viewport units inside a frame resolve against the frame's own
viewport, so the framed document really does lay out as a phone.
`resize_window` remains unusable for this (it reports success but leaves
`window.innerWidth` at 1512), and no headless browser is installed.

Confirmed real rather than simulated: `innerWidth: 390`,
`matchMedia("(min-width: 768px)") === false`, desktop sidebar hidden, mobile
top bar present.

| Check | Result at 390 px |
|---|---|
| `/dashboard` Site Admin command centre renders | yes |
| KPI cards reflow | 5 columns to **2 x 173 px**, no shrinking |
| Horizontal overflow | none (`scrollWidth 390 === clientWidth 390`) |
| Headings, Beta badge, version, status cards readable | yes |
| Updated timestamp + Refresh control usable | yes |
| Needs Attention usable | yes |
| Platform state / System Health summary usable | yes |
| Commercial omission correct for a non-commercial Site Admin | yes |
| Site Admin nav opens, scrolls to every group, closes | yes |
| Hidden off-screen controls | none |
| Club Admin context still gets the Club dashboard | yes |
| Parent context still gets the Parent dashboard, no platform data | yes |

Navigation, drawer scrolling and the gear/close geometry are documented with
their measurements in `docs/ADMIN_NAVIGATION_AND_SUPPORT.md`.

**Still not proven:** a real handset — touch input, a dynamic browser toolbar
resizing `dvh`, iOS rubber-band scrolling, device pixel density. The iframe is
a true narrow viewport, not a true device.

---

## A. Current dashboard audit

### A.1 There is no Site Admin dashboard

The single most important finding of this audit: **`/admin/dashboard` does not
exist.** There is one shared `/dashboard` route (`app/(app)/dashboard/page.tsx`,
226 lines) rendered for every role, and its entire body is scoped to *the
signed-in person's own teams*.

`lib/app-context/my-teams.ts:112`:

```ts
if (activeContext.kind === "site_admin") {
  return []
}
```

`lib/app-context/dashboard-data.ts:66` then short-circuits on an empty team list
and returns all-empty data. The consequence is that a Site Admin's dashboard is
structurally incapable of showing platform information.

**Live-verified, not inferred.** Signed in as `test.site.admin@ovalball.local`
(`site_admins.admin_role = 'full'`, active context "Ovalball · Site Admin") the
rendered page reads, in full:

> GOOD EVENING, TEST
> **OVALBALL**
> Site Admin
> THIS WEEK — *Nothing scheduled this week. Fixtures for your team(s) in the next 7 days will show up here.* [View calendar]
> *No team assigned yet. Once you have a team or club role, its fixtures and requests will appear here.*

Two empty states and a greeting. Zero platform information, zero commercial
information, zero referral information, zero operational information.

### A.2 Route and component inventory

| Route | File | Purpose |
|---|---|---|
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Shared, team-scoped. Renders `FixtureListRow`, `RequestListRow`, `EmptyState` (all local to the file) plus `PlayerMovementsLog` |
| — | `lib/app-context/dashboard-data.ts` | `getDashboardData()`: this-week fixtures, outstanding fixture requests, recent approved call-ups |
| — | `app/(app)/dashboard/actions.ts` | Player-movement log actions |
| `/admin/system-health` | `app/(app)/admin/system-health/page.tsx` | Read-only build/release/platform-state card. Full Site Admin only |
| `/admin/commercial` | `app/(app)/admin/commercial/page.tsx` | Commercial overview across clubs; `site.commercial.view` gated |
| `/admin/releases` | `app/(app)/admin/releases/page.tsx` | Release & platform mode |

Site Admin nav (`lib/app-context/build-nav-items.ts:140-167`) currently lists 16
items in a Site Admin context: Dashboard, Calendar, Claims, Documents, Club
Management, User Management, Permission Management, Fixture Management, Message
Management, Seasons, Team Directory, Competitions, Lookup Administration, Support
Tickets, Site Admin Management, System Health, Release & Platform Mode, and
Commercial (the last only for `siteAdminRole === 'full'` or `viewCommercial`).
Dashboard is item one and is the console's landing page.

### A.3 Current data queries

`getDashboardData` issues, at most, four round trips through the caller's own
RLS-bound client: `fixtures` (by `owning_team_id`), `fixture_requests` twice
(outgoing/incoming), `fixture_player_call_up` once. All are `.in(team_ids)`
filtered. There is no aggregation, no caching directive, no `revalidate`, and no
`dynamic` export on the dashboard route.

### A.4 Loading, error and responsive behaviour

- **Loading:** none. No `loading.tsx`, no Suspense boundary. The page is a single
  async Server Component; the whole route blocks on the slowest query.
- **Error:** none. Supabase errors are silently discarded (`const { data: fixtures } = await …` with no `error` handling) and render as empty state — a failed query is visually indistinguishable from genuinely having no fixtures. This is acceptable for a personal dashboard and **unacceptable for a platform dashboard**, where "0 clubs" and "the query failed" must never look the same.
- **Responsive:** `mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12`, flex rows with `flex-wrap`. Works, but is a narrow single-column reading layout, not a dashboard grid.

### A.5 Reusable design assets

There is no chart library in `package.json` (no recharts, no d3, no visx, no
nivo). Charts are a **new dependency decision**, not an existing capability.

Established, reusable Operate-mode patterns (canonical example:
`app/(app)/admin/system-health/page.tsx`):

- Page shell `mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12` (wider pages use `max-w-5xl`)
- Eyebrow: lucide icon `size-5 text-forest-800` + `text-sm font-medium tracking-[0.08em] text-forest-800 uppercase`
- Title `mt-2 font-display text-display-l text-ink`; lede `mt-2 max-w-lg text-sm text-ink/55`
- Data card `divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white`, rows `flex items-center justify-between px-5 py-3.5`, `dt` `text-sm text-ink/55`, `dd` `font-mono text-sm text-ink`
- Status pill pattern with the **word carrying the state, colour as a second signal** (`admin/commercial/page.tsx:247`) — reuse verbatim
- Desktop table + mobile card-list duplication pattern (`admin/commercial/page.tsx:158-235`)
- Palette tokens: `forest-950`, `forest-800`, `chalk`, `pitch-600`, `pitch-400`, `mint-100`, `amber-*`, `ink` with `/80 /55 /10 /8` steps
- `components/platform/beta-badge.tsx`, `components/club/club-avatar.tsx`
- `app/(app)/admin/pagination.tsx`, `app/(app)/admin/pagination-constants.ts`

### A.6 Classification

| Piece | Verdict | Reasoning |
|---|---|---|
| `/dashboard` route as the Site Admin landing page | **EXTEND** | Keep one route; branch on `activeContext.kind === "site_admin"` into a separate Site Admin dashboard component tree. Do not create `/admin/dashboard` — the nav already points Site Admins at `/dashboard`, and a second route would leave the first one showing two empty states forever. |
| `getDashboardData()` team-scoped logic | **KEEP SEPARATE** | It is correct for club/team/parent/player. Do not extend it with platform aggregates; add a sibling `lib/app-context/site-admin-dashboard-data.ts`. |
| `FixtureListRow` / `RequestListRow` | **KEEP SEPARATE** | Shapes are personal-scope ("your team vs opposition"). The Site Admin fixture row needs both clubs, competition and code. |
| `EmptyState` | **REUSE** | Promote out of `page.tsx` into a shared component. |
| `/admin/system-health` Platform-state card | **REUSE (as a summary) + KEEP the page** | Surface a condensed status block on the dashboard; the page stays as the drill-through. Do not duplicate its mutations — it has none, correctly. |
| `/admin/commercial` | **REUSE as drill-through, EXTEND for referrals** | Live-verified working. It renders needs-attention, a counts line ("2 on Standard · 0 on Pro · 1 on trial · 1 past due · 0 cancelled · £15.00 credit outstanding · 1 referrals pending · 0 rewards earned") and a per-club table. It has **no per-referral detail** — see §R. |
| `platform_commercial_overview()` RPC | **REUSE** | Already the one place trial arithmetic happens. Do not recompute trial remaining time in TypeScript. |
| `admin_fixture_overview` view | **REUSE** | Carries `is_primary_mirror` (dedup), both clubs, both teams, competition, venue, rugby code, categories, season. It is the fixture read model. |
| `admin_club_overview` view | **REUSE** | Carries `activated_at`, `is_activated`, `club_admin_count`, `flag_pending_claim` and directory quality flags — the club adoption funnel's backbone. |
| `admin_user_overview` view | **REUSE** | Carries `user_created_at`, `account_status`, `has_active_membership`, `has_club_admin`, `has_pending_request`. |
| Site-wide error swallowing in dashboard queries | **SUPERSEDE** | The new surface must distinguish zero from failure. |
| Shared `/dashboard` `max-w-4xl` single column | **SUPERSEDE for Site Admin only** | Site Admin needs a wider grid (`max-w-7xl`). Club/team/parent keep `max-w-4xl`. |

---

## B. Platform KPI data audit

`profiles` is 1:1 with `auth.users` in current data (76 / 76 locally), created by
`completeSignupIfNeeded` on first successful auth callback. **`profiles` is the
canonical person record**, not `auth.users` — `auth.users` is not readable from
the app's RLS-bound client at all, and would count unfinished signups.

| KPI | Canonical source | Inclusion rule | Deactivated? | Test records? |
|---|---|---|---|---|
| **Registered Users** | `public.profiles` | `count(*)`. Optionally split by `account_status` (`active` \| `suspended`) | `suspended` profiles still exist and should be counted in "registered" and shown separately as suspended | **No marker exists.** GAP — see §X.1 |
| **Registered Clubs** | `public.clubs` | `count(*)` — a `clubs` row only exists after `approve_club_claim`, so *every* row is an activated club | `status` ∈ `active`/`suspended`/`deactivated`; "registered" = all, "active" = `status='active'` | No marker. GAP |
| **Registered Teams** | `public.teams` | `count(*)` | `active` boolean plus `folded_at` and `archived_at` timestamps | No marker. GAP |
| **Registered Guardians / Parents** | `public.guardians` | `count(distinct guardian_user_id) where status='active'` | `status` ∈ `active`/`revoked` | No marker. GAP |
| **Registered Players** | `public.players` | `count(*)`; "active players" = `active = true` | `active` boolean | No marker. GAP |
| **Active Clubs** | `public.clubs` | `status = 'active'` | by definition | — |
| **Active Teams** | `public.teams` | `active = true and folded_at is null and archived_at is null` | by definition | — |

Critical semantic notes:

1. **`guardians` is a relationship row, not a person.** One row = one
   (guardian_user_id, player_id) pair. "Registered Parents" must be
   `count(distinct guardian_user_id)`; `count(*)` would over-count a parent with
   three children by 3×. Locally: 10 `guardians` rows.
2. **`players` has no club column.** A player belongs to a club only through
   `player_team_memberships → teams.club_id`. "Players at active clubs" is a
   three-table join, not a column filter.
3. **`players.user_id` is nullable.** A player is not necessarily a user. Players
   and Users are disjoint counts and must never be summed.
4. **`clubs.created_at` *is* the activation timestamp.** `admin_club_overview`
   already exposes it under the honest alias `activated_at` and derives
   `is_activated` as `c.id is not null`. There is no separate `activated_at`
   column and none is needed.
5. **`club_directory` (1,434 rows locally) is not a club count.** It is the
   canonical ingested UK club directory. Directory rows are candidates, not
   customers. Never present `club_directory` count as "Registered Clubs".

### Local dev snapshot (for shape, not for reporting)

`profiles` 76 · `auth.users` 76 · `clubs` 44 · `club_directory` 1,434 · `teams` 85 ·
`players` 16 · `guardians` 10 · `fixtures` 41 · `platform_referrals` 1 ·
`platform_trials` 1 · `platform_club_subscriptions` 4 · `platform_payments` 1 ·
`platform_credits` 1 · `club_ovalball_invitations` 2 ·
`gocardless_merchant_connections` 1 · `training_plans` 0 · `support_tickets` 10.

---

## C. Fixture analytics audit

### C.1 One row per fixture — confirmed

`20260904600000_master_fixture_consolidation.sql` redefined
`accept_fixture_request` to insert a **single** row. `mirror_fixture_id` survives
as a legacy column serving historical pairs only. Local data: **41 fixtures, 0
with a non-null `mirror_fixture_id`, 0 with `source = 'mirror'`.**

`admin_fixture_overview` exposes `is_primary_mirror`, and the existing Site Admin
fixture query already filters `q.eq("is_primary_mirror", true)`
(`app/(app)/admin/fixtures/query.ts:51`). **Every dashboard fixture metric must
apply the same filter** — that is the established dedup contract, and it protects
production rows that pre-date consolidation.

### C.2 Play date vs booked date

Two genuinely different columns, and the distinction is load-bearing:

- **`fixtures.kickoff_date` (date)** — when the match is played.
- **`fixtures.created_at` (timestamptz)** — when the row was created, i.e. booked.

"Fixtures booked this week" therefore means
`created_at >= date_trunc('week', now())`, never `kickoff_date` in that range.
The two series must never share an axis without separate labels.

There is no dedicated `booked_at`/`confirmed_at` column. For fixtures created by
`accept_fixture_request`, `created_at` is the moment of acceptance and is a
faithful "booked" timestamp. For imported fixtures (`source` values include
`club_created`; imports carry `import_batch_id`), `created_at` is the import
moment, not a club decision. **Caveat to display:** "booked" counts include
imported fixtures unless filtered by `source`.

### C.3 Metric definitions

| Metric | Definition |
|---|---|
| Fixtures today | `kickoff_date = current_date and is_primary_mirror and status <> 'Cancelled'` |
| Fixtures this week | `kickoff_date between date_trunc('week', current_date) and +6 days` |
| Fixtures this calendar month | `date_trunc('month', kickoff_date) = date_trunc('month', current_date)` |
| Fixtures next 30 days | `kickoff_date between current_date and current_date + 30` |
| Fixtures booked this week | `created_at >= date_trunc('week', now())` |
| Fixtures booked this month | `created_at >= date_trunc('month', now())` |
| Cancelled this month | `status = 'Cancelled' and date_trunc('month', cancelled_at) = date_trunc('month', now())` — `cancelled_at` exists and is the correct attribution timestamp, not `kickoff_date` |
| Pending fixture requests | `fixture_requests.status = 'sent'` |
| Results awaiting confirmation | `fixtures.result_status = 'awaiting_confirmation'` — legitimately represented; `result_status` ∈ `none`, `awaiting_confirmation`, `final`, `disputed`, `amendment_pending`, `external_recorded`, `unverified` |
| Disputed results | `result_status = 'disputed'` — genuine Site Admin work, `result_site_admin_resolved_by` exists as the resolution field |

`fixtures.status` ∈ `Planned`, `Booked`, `To Be Determined`, `Annual Holiday`,
`Festival`, `Lancashire Cup`, `Cancelled`, `Completed`. Note that four of those
eight are *event-type-ish* rather than lifecycle states — any "cancelled rate"
denominator must be stated explicitly rather than assumed to be "all fixtures".

### C.4 Regression/test fixtures

`is_regression_fixture` exists **only on `seasons`**
(`20260906000000_structured_season_identity.sql:13`), and season resolvers already
exclude them (`20260925010000`). Fixtures carry `season_id`, so
`fixtures … join seasons s on s.id = f.season_id where s.is_regression_fixture = false`
is available — but `fixtures.season_id` is nullable, so the filter must be
`(s.id is null or s.is_regression_fixture = false)` or legitimate fixtures
disappear.

---

## D. Growth analytics audit

Every KPI entity carries a `created_at timestamptz not null default now()`:
`profiles`, `clubs`, `teams`, `players`, `guardians`, `fixtures`. Time-series over
30D / 90D / 12M / All is therefore **truthful and available with no new columns
and no invented history**, with these honest caveats:

1. **`clubs.created_at` is activation, not first interest.** The funnel's earlier
   stages (directory listing, claim submitted) live on `club_directory.created_at`
   and `club_claims.created_at` respectively.
2. **Guardian growth must dedupe by person.** A monthly series of
   `count(distinct guardian_user_id)` is a *cumulative distinct* problem, not a
   simple `group by month`. Recommend charting **new guardians** = first
   `created_at` per `guardian_user_id`, which is exact and cheap.
3. **Backfilled/seeded rows carry their insert time**, not a historical date. Any
   bulk import (the 1,434-row `club_directory` ingestion, for example) will appear
   as a single-day spike. Do not chart `club_directory` growth as adoption.
4. **`players` and `guardians` predate most of the platform** only in the sense
   that Side Project 1's migrations created them; rows created since are honest.

### Efficiency

**No index exists on a bare `created_at` for `profiles`, `clubs`, `teams`,
`players`, `guardians` or `fixtures`.** Verified by scanning `pg_indexes`: the only
`created_at`-bearing indexes are on `audit_log`, `finance_audit_log`,
`fixture_messages`, `fixture_result_submissions`, `gocardless_events`,
`guardian_player_permissions`, `notifications`, `platform_referrals`,
`support_ticket_events` and `support_tickets`. `fixtures` has
`(owning_team_id, kickoff_date)` but no bare `kickoff_date` and no `created_at`.

At current volumes (tens to low hundreds of rows) this is irrelevant. It is a
**Phase A requirement**, not a Phase A emergency: any 12-month series is a
sequential scan today and will stay acceptable well past a thousand clubs.

**Recommendation:** live aggregate queries in a `security definer` RPC, with
`created_at` b-tree indexes added in the same migration. Do **not** build a
materialised analytics store in Phase A — it would be a second truth (§33), and
the data does not justify it. Revisit only if a 12-month series exceeds ~200 ms.

---

## E. Club adoption funnel audit

Every stage below is computable from canonical data today.

| # | Stage | Exact rule | Available |
|---|---|---|---|
| 1 | Directory clubs | `club_directory` where `active = true` | ✅ |
| 2 | Claim submitted | `distinct directory_id` in `club_claims` | ✅ |
| 3 | Claimed / activated | `clubs` (a row exists ⇒ a claim was approved) | ✅ |
| 4 | Active clubs | `clubs.status = 'active'` | ✅ |
| 5 | Clubs with an active team | `clubs` ⋈ `teams` where `teams.active` and `folded_at is null` | ✅ |
| 6 | Clubs with a fixture | `clubs` ⋈ `admin_fixture_overview` on `owning_club_id` or `opponent_club_id`, `is_primary_mirror` | ✅ |
| 7 | Clubs using Training Management | `training_plans.status = 'ACTIVE'` **or** a `training_sessions` row with `status='PLANNED'` and `cancelled_at is null` — see §F | ✅ |
| 8 | Clubs with Parent/Player adoption | `clubs` ⋈ `teams` ⋈ `player_team_memberships` ⋈ `players` ⋈ `guardians` where `guardians.status='active'` | ✅ |
| 9 | Clubs taking member payments | `club_subscription_programmes.enabled = true` **and** a `gocardless_merchant_connections` row with a non-disconnected status | ✅ |

### Honest funnel-shape warning

**Stages 1→2 are not a conversion rate.** `club_directory` is an ingested list of
every UK rugby club (1,434 rows locally); it was not created by marketing and
those clubs have never been contacted. Showing "3% of directory clubs converted"
would be a meaningless denominator dressed as a KPI.

**Recommended funnel: start at stage 2.** Present stages 2→9 as the funnel with
real conversion percentages, and show "1,434 clubs in the canonical directory" as
a separate contextual figure above it, explicitly labelled as *addressable market,
not a funnel stage*. Stages 3→9 are genuinely comparable — each is a strict subset
of the previous — so percentages between them are legitimate.

---

## F. Feature adoption audit

"Adoption" must mean *a club did the thing*, never *a club could do the thing*.

| Feature | Definition of "using" | Source | Status |
|---|---|---|---|
| Fixture Management | ≥1 fixture where the club is either side, `is_primary_mirror` | `admin_fixture_overview` | **AVAILABLE NOW** |
| Training Management | ≥1 `training_plans` row with `status='ACTIVE'`, **or** ≥1 `training_sessions` row with `status='PLANNED'` and `cancelled_at is null`. Menu availability is explicitly *not* the criterion | `training_plans`, `training_sessions` | **AVAILABLE NOW** (0 plans locally — the metric will read zero, which is the honest answer) |
| Parent / Player | ≥1 `players` row reachable from the club's teams **and** ≥1 `guardians` row with `status='active'` for one of them | `player_team_memberships`, `players`, `guardians` | **AVAILABLE NOW** |
| Mini-Rugby Groups | ≥1 `scheduling_groups` row with `active = true` for the club | `scheduling_groups` | **AVAILABLE NOW** |
| Member payments (Domain B) | `club_subscription_programmes.enabled = true` AND ≥1 `gocardless_mandates` row AND ≥1 `gocardless_payments` with `status='confirmed'` — three tiers: *configured*, *connected*, *collecting* | `club_subscription_programmes`, `gocardless_*` | **AVAILABLE NOW** |
| Referral programme participation | ≥1 `platform_referrals` row with `referring_club_id = club` — i.e. the club actually made a referral claim. Eligibility (`club.referrals.manage` capability) is explicitly not participation | `platform_referrals` | **AVAILABLE NOW** (see §R for the attribution caveat) |
| Partner Clubs | ≥1 `club_partnerships` row with `status='active'` | `club_partnerships` | **AVAILABLE NOW** |
| Documents | ≥1 `club_documents` row | `club_documents` | **AVAILABLE NOW** |
| Messaging | ≥1 `fixture_messages` row from the club | `fixture_messages`, `admin_message_overview` | **AVAILABLE NOW** |
| Pitch Allocation | ≥1 `pitch_allocation_proposals` row | `pitch_allocation_proposals` | **AVAILABLE NOW** |

Present adoption as **clubs using / active clubs**, never / registered clubs — a
deactivated club cannot adopt anything and drags every ratio down permanently.

---

## G. Operations / needs-attention audit

| Signal | Canonical source | Exact rule | Verdict |
|---|---|---|---|
| Unresolved support tickets | `support_tickets` | `status` not closed; `support_tickets_status_idx (status, created_at desc)` exists | **AVAILABLE NOW** |
| Bug / error reports | `support_tickets.category` | Category-scoped subset of the above | **AVAILABLE NOW** |
| Pending club claims | `club_claims` | `status = 'pending'`; also surfaced as `admin_club_overview.flag_pending_claim` | **AVAILABLE NOW** |
| Directory requests awaiting Site Admin | `directory_requests` | `status = 'pending'` | **AVAILABLE NOW** |
| Stuck fixture requests | `fixture_requests` | `status = 'sent'` and `created_at < now() - interval '14 days'` (threshold is a product choice, not a canonical constant) | **AVAILABLE NOW** |
| Disputed / overdue results | `fixtures` | `result_status in ('disputed','awaiting_confirmation')`, with `result_deadline_at < now()` for overdue | **AVAILABLE NOW** |
| Failed member payments | `gocardless_payments` | `status = 'failed'` | **AVAILABLE NOW** |
| Failed platform payments | `platform_payments` | `status = 'failed'`, plus subscriptions in `past_due` | **AVAILABLE NOW** (already rendered on `/admin/commercial`) |
| Unprocessed provider webhooks | `gocardless_events` (`gocardless_events_unprocessed_idx` where `processed = false`), `platform_provider_events` (`processed`, `processing_error`) | `processed = false` older than N minutes, or `processing_error is not null` | **AVAILABLE NOW** |
| Commercial setup warnings | `platform_club_subscriptions` | `status='pending_setup' and provider_mandate_id is null` | **AVAILABLE NOW** (already rendered) |
| Referral attribution gaps | `club_ovalball_invitations` ⟕ `platform_referrals` | see §R — **live hit in current data** | **AVAILABLE NOW** |
| Orphan referral rewards | `platform_credits` ⟕ `platform_referrals` | see §R — **live hit in current data** | **AVAILABLE NOW** |
| Failed scheduled jobs | `cron.job_run_details` | Requires `pg_cron` run-history read; four jobs exist (below) | **PARTIAL** — job *existence* and schedule are readable; surfacing failures needs an RPC that reads `cron.job_run_details`, which does not exist yet |
| Failed notifications | — | `notifications` has no delivery/send state. `lib/email/dispatch.ts` is an explicit dev no-op that `console.log`s instead of sending; **no email provider is wired** | **GAP** |
| Auth / provider warnings | — | No health-probe table; GoTrue and provider status are not recorded locally | **GAP** — see §X |
| Generic application errors | — | No error table, and one must **not** be invented for the dashboard | **GAP (deliberate)** |

`cron.job` currently holds four active jobs: `process-due-season-transitions`
(`*/15 * * * *`), `expire-due-dispensations` (`0 3 * * *`),
`complete-overdue-fixtures` (`*/15 * * * *`), `process-due-trials`
(`*/15 * * * *`).

---

## H. System health audit

`app/(app)/admin/system-health/page.tsx` is Full-Site-Admin-only and exposes
`APP_VERSION`, `APP_BUILD_SHA`, `NODE_ENV`, `AUTH_SESSION_VERSION`, plus a
Platform-state card reading `getPlatformMode()` / `getBetaBadgeState()` and
linking to `/admin/releases`. It contains no secrets and no mutations. That
discipline must carry over.

Proposed dashboard health strip — each item resolves to `HEALTHY` / `WARNING` /
`ACTION REQUIRED` with a drill-through:

| Component | Signal | Availability | Drill-through |
|---|---|---|---|
| Application | `APP_VERSION` + `APP_BUILD_SHA` present | AVAILABLE NOW | `/admin/system-health` |
| Database | The dashboard RPC returned at all; optionally a `select 1` latency | AVAILABLE NOW | `/admin/system-health` |
| Scheduled jobs | 4 expected jobs present and `active`; WARNING if any missing/inactive; ACTION REQUIRED on recent failures (needs the `cron.job_run_details` RPC) | **PARTIAL** | `/admin/system-health` |
| Platform commercial state | `platform_public_state()` → mode + published release; Beta ⇒ explicit "billing paused" | AVAILABLE NOW | `/admin/releases` |
| Payment providers | `gocardless_merchant_connections.verification_status`, unprocessed `gocardless_events`, unprocessed `platform_provider_events` | AVAILABLE NOW | `/admin/commercial` |
| Referral / reward processing | Referral data-health status (§R) | AVAILABLE NOW | referral admin (GAP — §R.5) |
| Auth | — | **GAP** — nothing records GoTrue health | — |
| Notifications | — | **GAP** — no delivery state, no provider | — |
| Storage | — | **GAP** — no bucket-health record | — |

**Never render:** `gocardless_merchant_connections.access_token`,
`club_ovalball_invitations.token`, `platform_provider_events.payload`,
`SUPABASE_SERVICE_ROLE_KEY`, `GOCARDLESS_*` secrets, or any connection string.
Show *whether* a connection is verified, never the credential.

---

## I. Ovalball SaaS finance audit (Domain A: Ovalball charges clubs)

Canonical tables: `platform_plans`, `platform_club_subscriptions`,
`platform_trials`, `platform_payments`, `platform_credits`,
`platform_subscription_events`, `platform_provider_events`, `platform_referrals`.

`platform_plans` today: `standard` £15.00 `available` `purchasable=true`
`price_version 1`; `pro` £25.00 `coming_soon` `purchasable=false` `price_version 1`.

| Metric | Rule |
|---|---|
| Subscribed clubs | `platform_club_subscriptions.status in ('active','past_due','scheduled')` |
| Trial clubs | `platform_trials.status in ('active','paused')` |
| Standard / Pro counts | The above, grouped by `plan_code` |
| Subscriptions started this month | `platform_subscription_events` where `event_type='activated'` and `occurred_at` in month — **use the event ledger, not `started_at`**, because `started_at` is coalesced and only records the first activation |
| Cancellations this month | `platform_club_subscriptions.cancelled_at` in month, cross-checked against `platform_subscription_events` |
| MRR | `sum(plan_price_pence) where status in ('active','past_due')` |
| ARR run-rate | MRR × 12, **labelled a run-rate, never as revenue earned** |
| Credit outstanding | `sum(platform_credits.amount_pence)` per club (the ledger is signed and append-only; `application` and `reversal` rows are negative) |
| Cash actually collected | `sum(platform_payments.net_pence) where status='confirmed'` |

### The Beta rule — mandatory, and verified in code

`open_platform_billing_cycle` raises unconditionally while the mode is not `live`
(`20261005000000_platform_gocardless.sql:281`):

```sql
if coalesce(internal.current_platform_mode(), 'beta') <> 'live' then
  raise exception 'Ovalball is in Beta and is not charging clubs.';
end if;
```

and `internal.apply_platform_mode_to_trials('beta')` pauses every running trial
with `pause_reason = 'beta'`.

Therefore, while the platform mode is `beta`:
- no billing cycle can open, so **no new `platform_payments` row can be created**;
- consequently **no payment can be confirmed**;
- consequently **no referral can reach `qualified`** (§N);
- and every trial clock is stopped.

The dashboard **must** state this in words wherever a money figure is zero. A
£0.00 MRR tile during Beta is not information; "Billing paused — Ovalball is in
Beta. MRR will begin accruing when the platform goes Live." is. Read the mode from
`platform_public_state()` or `getPlatformMode()` — never from a client-side
constant.

---

## J. Club member-payments audit (Domain B: clubs charge their members)

Canonical tables: `club_subscription_programmes`, `club_subscription_pricing`,
`club_subscription_sibling_rules`, `player_subscription_payers`,
`membership_obligations`, `payment_refunds`, `gocardless_merchant_connections`,
`gocardless_customers`, `gocardless_mandates`, `gocardless_subscriptions`,
`gocardless_billing_requests`, `gocardless_payments`, `gocardless_payouts`,
`gocardless_events`, `gocardless_reconciliation_entries`, `finance_audit_log`.

| Metric | Rule |
|---|---|
| Clubs connected to GoCardless | `gocardless_merchant_connections` where `disconnected_at is null` |
| Clubs actively collecting | Connected **and** ≥1 `gocardless_payments` with `status='confirmed'` in the last 60 days |
| Active mandates | `gocardless_mandates` in an active state |
| Member subscriptions | `gocardless_subscriptions`, and `player_subscription_payers.status` for the Ovalball-side enrolment |
| Obligations outstanding | `membership_obligations.status` |
| Payments confirmed | `gocardless_payments.status='confirmed'`, `sum(gross_amount_minor)` |
| Payment failures | `gocardless_payments.status='failed'`, with `failure_reason_code` |
| Payouts confirmed | `gocardless_payouts`, `sum(amount_minor)` |
| Refunds | `payment_refunds` |

**Money units differ between the domains.** Domain A uses `*_pence`; Domain B uses
`*_minor`. Both are GBP minor units, but the naming difference is a real trip
hazard — any shared formatter must take an explicit unit argument.

**These figures are club money, held in club GoCardless merchant accounts.** They
are never Ovalball revenue. Present them under a heading that says so.

---

## K. Ovalball revenue audit

Three candidate revenue lines. Only one is real.

**1. Ovalball SaaS revenue — REAL, currently paused.**
`sum(platform_payments.net_pence) where status = 'confirmed'`. This is money
clubs actually paid Ovalball. Zero during Beta, by design (§I).

**2. Ovalball commission on member payments — GAP. Schema placeholder only.**

The schema hints at commission in three places:
- `club_subscription_programmes.platform_fee_mode` (`NONE`, `PARTNER_REVENUE_SHARE`, `GOCARDLESS_APP_FEE`, `PAYER_SURCHARGE`, `CLUB_SAAS_FEE`) and `platform_fee_minor`
- `gocardless_payments.app_fee_minor`
- `gocardless_subscriptions.app_fee_minor`
- `gocardless_reconciliation_entries.entry_type` includes `'app_fee'`

**None of it is implemented.** Verified:
- `configure_subscription_programme` rejects everything except `NONE` and `PARTNER_REVENUE_SHARE` (`20260928300000:1733`), and **does not take `platform_fee_minor` as a parameter at all** — the column can only ever be NULL through that path.
- `app_fee_minor` is written by **no migration and no application code** — a full-tree grep finds only the two column declarations and one check constraint.
- Live data: `gocardless_payments` 0 rows, `gocardless_subscriptions` 0 rows, `gocardless_reconciliation_entries` 0 rows, and the single existing programme is `platform_fee_mode = 'NONE'`, `platform_fee_minor = NULL`.

**Verdict: Ovalball commission revenue must not appear on the dashboard.** There
is no rate, no calculator, no writer and no ledger. Showing "£0 commission" would
imply the mechanism exists and simply earned nothing.

**3. Referral credits — a cost, not revenue.** `platform_credits` with
`source='referral_reward'` is a liability Ovalball owes clubs against future
collections. Report it under Referral Rewards (§N), never netted into revenue.

### Required presentation

```
OVALBALL SAAS               CLUB MEMBER PAYMENTS          OVALBALL REVENUE
what clubs pay Ovalball     what members pay their club   Ovalball's own money
                            — never Ovalball's money
MRR / ARR run-rate          gross collected               SaaS collected
subscribed / trial          payouts                       referral credits owed
                            failures                      commission: not implemented
```

Three visually separate cards. No shared total. No combined "platform revenue"
figure — that number does not exist.

---

## L. Referral domain audit — canonical architecture

Everything below is the current implementation, read from the migration set and
confirmed against live schema. **No second referral system exists, and none must
be created.**

### L.1 Tables and functions

| Object | Migration | Role |
|---|---|---|
| `public.club_ovalball_invitations` | `20260917000000` | The outreach. `inviting_club_id`, `club_directory_id`, `contact_name`, `contact_email`, `invited_by`, `token`, `status` ∈ `pending`/`accepted`/`expired`/`revoked`, `expires_at` (default `now() + 14 days`), `accepted_at`, `accepted_by`, `resulting_partnership_id` |
| `public.platform_referrals` | `20261006000000` | The **commercial claim layered on one invitation**. 16 columns |
| `public.platform_credits` | `20261004000000` | The reward *is* a credit-ledger row. `source='referral_reward'`; reversal rows are `source='reversal'` with `reverses_credit_id` |
| `public.create_partner_invitation(...)` | `20260917000000` | Creates the invitation |
| `public.claim_club_referral(p_invitation_id)` | `20261006000000` | Records the invitation as a referral claim. Idempotent. Requires `club.referrals.manage` on the inviting club or Site Admin |
| `public.register_referred_club(p_invitation_id, p_club_id)` | `20261006000000` | `pending → registered`. **service_role only** (`revoke … from public, anon, authenticated`) |
| `internal.reconcile_partner_invitations(p_directory_id, p_new_club_id)` | `20260917000000`, extended `20261008000000` | **Exists in current Main.** Called from `approve_club_claim`. Creates the partnership, marks the invitation `accepted`, and calls `register_referred_club` |
| `internal.qualify_referral_for_payment(p_payment_id)` | `20261006000000` | `registered → qualified` + inserts the credit. Called from **one** place |
| `internal.reverse_referral_for_payment(p_payment_id)` | `20261006000000` | `qualified → reversed` + inserts a negative credit |
| `public.apply_platform_payment_status(...)` | `20261006000000` | The single point where a payment becomes confirmed; calls qualify on confirm and reverse on fail. service_role only |
| `public.club_referral_summary(p_club_id)` | `20261006000000` | Club-facing read |
| `public.club_credit_balance_pence(p_club_id)` | `20261004000000` | Spendable balance |
| Capabilities | `20261006000000` | `club.referrals.view`, `club.referrals.manage` — both CLUB_ADMIN-only |

### L.2 `platform_referrals` columns

`id`, `invitation_id` (NOT NULL, **UNIQUE**, FK → invitations, ON DELETE CASCADE),
`referring_club_id` (NOT NULL, FK → clubs), `referred_club_id` (nullable, FK →
clubs, ON DELETE SET NULL), `status`, `rejection_reason`, `qualifying_payment_id`,
`reward_credit_id` (UNIQUE), `reward_amount_pence`, `reward_plan_code`,
`reward_price_version`, `qualified_at`, `reversed_at`, `created_by`, `created_at`,
`updated_at`.

RLS: SELECT only, `internal.has_capability('club.referrals.view','club', referring_club_id) or internal.is_site_admin()`.
**No INSERT/UPDATE/DELETE policy exists** — every transition is a function. The
referred club deliberately cannot see that it was referred.

Audit trigger `audit_row_change` is present on `platform_referrals`,
`platform_credits`, `platform_payments`, `platform_club_subscriptions`,
`platform_trials`, `clubs`, `teams`, `players`, `guardians`, `training_sessions`
and 54 other tables — 64 in total.

### L.3 The referrer is a CLUB, not a person

`referring_club_id` is the canonical referrer. `created_by` (nullable) records the
signed-in user who triggered the claim; `club_ovalball_invitations.invited_by`
(NOT NULL) records the person who sent the invitation. This resolves the
multi-club question cleanly: **the reward belongs to the club the invitation was
sent on behalf of**, so one person acting for two clubs earns for whichever club
they were acting as. Not a gap.

---

## M. Referral attribution audit — the exact state machine

```
      create_partner_invitation()                app layer, best-effort
  ┌──────────────────────────────┐            ┌─────────────────────────┐
  │ club_ovalball_invitations    │───────────▶│ claim_club_referral()   │
  │ status = 'pending'           │            │ platform_referrals      │
  │ expires_at = now() + 14d     │            │ status = 'pending'      │
  └──────────────────────────────┘            └────────────┬────────────┘
                                                           │
   Site Admin approves the invited club's claim            │
   approve_club_claim() → reconcile_partner_invitations()  │
   ── only for invitations still pending AND unexpired ──  ▼
                                              ┌─────────────────────────┐
                                              │ register_referred_club()│
                                              │ status = 'registered'   │
                                              └────────────┬────────────┘
                                                           │
   Referred club picks a plan, sets up a mandate,          │
   a cycle opens (LIVE mode only), collection confirms     │
   apply_platform_payment_status(..., 'confirmed')         ▼
                                              ┌─────────────────────────┐
                                              │ qualify_referral_for_   │
                                              │ payment()               │
                                              │ status = 'qualified'    │
                                              │ + platform_credits row  │
                                              └────────────┬────────────┘
                                                           │ collection later fails
                                                           ▼
                                              │ status = 'reversed'     │
                                              │ + negative credit row   │
```

### Stage-by-stage availability

| Concept | Canonical representation | Available |
|---|---|---|
| **Referral sent** | `platform_referrals` row exists (`created_at`) | ✅ — but see §R: the row is created best-effort by the app layer |
| **Invitation delivered / opened** | — | **GAP.** No email provider is wired (`lib/email/dispatch.ts` is a dev no-op) and there is no open/click tracking. An "opened" funnel stage must not be drawn |
| **Referral accepted** | `club_ovalball_invitations.status='accepted'`, `accepted_at`, `accepted_by` | ✅ — set by `reconcile_partner_invitations`, i.e. it means "the invited club was claimed and approved", *not* "someone clicked the email" |
| **Referred club claimed/joined** | `platform_referrals.referred_club_id is not null` and `status='registered'` | ✅ |
| **Referred club activated** | Same moment — `clubs` row creation, invitation acceptance and referral registration all happen inside `approve_club_claim`'s transaction | ✅ but **not separable from the previous stage.** Do not draw them as two funnel steps; they are one event |
| **Referred club subscribed** | `platform_club_subscriptions` for `referred_club_id` in `pending_setup`/`scheduled`/`active` | ✅ — via join; the referral row itself does not record it |
| **First successful paid collection** | `platform_referrals.qualifying_payment_id` + `qualified_at` | ✅ |
| **Reward earned** | `platform_referrals.reward_credit_id` + `platform_credits` row `source='referral_reward'` | ✅ |
| **Reward applied/redeemed** | `platform_credits` row `source='application'`, negative, `applied_to_payment_id` set | ✅ **at club level**, ⚠️ **not traceable back to the specific referral** — see §N.3 |
| **Reward reversed** | `status='reversed'`, `reversed_at`, negative credit with `reverses_credit_id` | ✅ |

**Ten invitations are not ten successful referrals.** The five `status` values are
the funnel, and `pending` (sent, nothing happened yet) is the default.

---

## N. Referral reward / free-month audit

### N.1 Verified implementation of the rule

The intended rule — *refer a club → one month free → only after their first
successful paid collection* — is implemented **exactly as stated**, in
`internal.qualify_referral_for_payment` (`20261006000000:272-377`). Guards, all
verified in the function body:

1. Payment must be `status='confirmed'`.
2. It must be the referred club's **first** confirmed payment:
   `count(*) from platform_payments where club_id = … and status='confirmed' and id <> p_payment_id` must be 0. Counted against the payment ledger, not inferred from subscription status.
3. The referral must be `status='registered'` — a rejected or already-qualified referral cannot earn again.
4. Self-referral → `rejected`.
5. Referring club must still be `status='active'` → otherwise `rejected` with "The referring club is no longer active."
6. Referring club must be on a plan (`internal.club_effective_plan`) → otherwise `rejected`.

### N.2 The answers to §17's questions

| Question | Answer | Source |
|---|---|---|
| Who receives the reward | The **referring club** | `platform_credits.club_id = referring_club_id` |
| What entity it attaches to | A **club-scoped credit-ledger row**. Not a person, not a subscription | `platform_credits` |
| One person, multiple clubs | Resolved structurally — the reward follows `referring_club_id`, i.e. the club the invitation was sent for | `platform_referrals.referring_club_id` |
| What "one month free" is internally | **A pence amount, not a month.** `reward_amount_pence` = the referring club's own plan price at the moment of earning, snapshotted with `reward_plan_code` and `reward_price_version` and never recomputed | `qualify_referral_for_payment` |
| Do multiple months accumulate | **Yes.** The ledger is additive; `club_credit_balance_pence` sums it | `platform_credits` |
| Is there a cap | **No cap exists in code.** | **PRODUCT POLICY GAP** |
| Do credits expire | **No expiry exists in code.** No `expires_at`, no sweep job | **PRODUCT POLICY GAP** (already listed in `LEGAL_REVIEW_REQUIRED.md`) |
| Pending vs earned vs applied | `pending`/`registered` = not yet earned; `qualified` = earned (positive credit); `application` rows (negative, with `applied_to_payment_id`) = applied | `platform_referrals.status` + `platform_credits.source` |
| Beta effect | Referrals are recorded and can reach `registered`; **no reward can be earned**, because no payment can confirm (§I) | verified |
| Can a reward duplicate | **No.** Three independent guards: `reward_credit_id` is UNIQUE; a partial unique index `platform_referrals_one_qualified_per_referred_club` on `(referred_club_id) where status='qualified'`; and `apply_platform_payment_status` returns early on an already-terminal payment, so webhook replay cannot re-enter the qualify path | verified |
| Failed / reversed first payment | `reverse_referral_for_payment` writes a negative credit and sets `status='reversed'`; guarded against double-reversal by checking for an existing `reverses_credit_id` row | verified |

### N.3 A real limitation in reward accounting

**Application of credit is not attributable to a specific referral.** When a
credit is spent, `open_platform_billing_cycle` reads the club's *balance*
(`sum(amount_pence)`) and writes one `application` row against the payment. It
does not decrement a particular `referral_reward` row.

Consequences for the dashboard:

- "Free months **earned**" is exact: `count(*) where status='qualified'`, and
  `sum(reward_amount_pence)`.
- "Free months **applied**" is exact **in money**:
  `abs(sum(amount_pence)) where source='application'`.
- "Free months applied" **in months is not canonically derivable** and must not be
  computed by dividing money by a plan price — a credit balance can be a mix of
  referral rewards, goodwill and beta adjustments at different price versions.
- "Outstanding" is exact in money: `sum(amount_pence)` over the whole ledger.

**Recommendation: report rewards in money, with a month count only where the unit
is exact** (earned, from `reward_amount_pence`). Label the applied/outstanding
figures in £, not months. This is the honest reading of the actual ledger model.

---

## O. Top Referrers — data contract

**Rank by clubs, with the sending person as a secondary column.** The canonical
referrer is `referring_club_id`; a person-level leaderboard is derivable from
`club_ovalball_invitations.invited_by` but is a weaker, secondary truth.

```
referrer_club_id      uuid    platform_referrals.referring_club_id
referrer_club_name    text    club_directory.name via clubs.directory_id
invitations_sent      int     count(club_ovalball_invitations) where inviting_club_id = club
referrals_claimed     int     count(platform_referrals) where referring_club_id = club
clubs_registered      int     count(*) where status in ('registered','qualified')
paid_conversions      int     count(*) where status = 'qualified'
reward_pence_earned   int     sum(reward_amount_pence) where status = 'qualified'
reversed              int     count(*) where status = 'reversed'
last_qualified_at     ts      max(qualified_at)
```

| Column | Supported? |
|---|---|
| rank | ✅ derived |
| referrer identity (club) | ✅ |
| associated club | ✅ — it *is* the club |
| invitations sent | ✅ |
| referred clubs activated | ✅ (`registered` + `qualified`) |
| successful paid conversions | ✅ (`qualified`) |
| free months earned | ✅ in **money**; count of qualified referrals is the month count |
| free months applied | ⚠️ money only, club-level, not per-referral (§N.3) |
| free months remaining/pending | ⚠️ money only — the club's ledger balance |

### Default ranking

```sql
order by paid_conversions       desc,   -- qualified referrals
         reward_pence_earned    desc,   -- tie-break 1
         last_qualified_at      desc,   -- tie-break 2
         clubs_registered       desc,   -- tie-break 3 (meaningful during Beta)
         referrer_club_name     asc     -- deterministic final tie-break
```

This matches the requested rule and adds a deterministic final key so the ranking
never depends on row order.

**Beta caveat that must be rendered, not hidden:** while the platform is in Beta,
`paid_conversions` is **structurally zero for every club** (§I). A leaderboard
ranked on it would be an all-zero table. During Beta the board must state that
plainly and fall through to `clubs_registered` as the visible primary measure —
labelled "clubs brought onto Ovalball", not "successful referrals".

### Time filters

`this month` / `90 days` / `12 months` / `all time` are all supported. **Filter on
`qualified_at` for conversion measures and on `platform_referrals.created_at` for
sent/claimed measures** — mixing them in one filtered row is the classic error
here. Say which one the active filter applies to.

### Privacy

The leaderboard shows **club identity only**. No email addresses, no personal
names, no tokens. `club_ovalball_invitations.contact_email` never appears in a
summary or chart — only in the operational log (§Q).

---

## P. Referral funnel — data contract

| Stage | Event / state | Canonical source | Dedup identity | Time attribution |
|---|---|---|---|---|
| 1. Invitations sent | invitation row exists | `club_ovalball_invitations` | `invitations.id` | `created_at` |
| 2. Referral claimed | referral row exists | `platform_referrals` | `platform_referrals.id` (1:1 with invitation via UNIQUE `invitation_id`) | `created_at` |
| 3. Referred club on Ovalball | `status in ('registered','qualified')` | `platform_referrals` | `referral_id` | `audit_log` transition to `registered` |
| 4. Subscription established | referred club has a subscription in `pending_setup`/`scheduled`/`active` | `platform_club_subscriptions` ⋈ `referred_club_id` | `club_id` | `subscription.created_at` |
| 5. First paid collection | `status='qualified'` | `platform_referrals` | `referral_id` | `qualified_at` |
| 6. Reward earned | `reward_credit_id is not null` | `platform_credits` | `credit_id` (UNIQUE on referral) | `credit.created_at` |

**Stages excluded, deliberately:**
- *Email opened / clicked* — no provider, no tracking. **GAP; do not draw.**
- *Invitation accepted* as a distinct step from *club activated* — they are the same transaction inside `approve_club_claim`. Drawing both would fabricate a conversion step with a permanent 100% rate.
- *Reward applied* — real, but club-level and not per-referral (§N.3). It belongs in the Rewards panel, not the funnel.

Stages 5 and 6 are also effectively the same event (the credit is inserted inside
the qualify function). **Recommend a five-stage funnel: Sent → Claimed →
On Ovalball → Subscribed → Paid & Rewarded.**

### Time filtering — recommended interpretation

**Cohort by referral creation date.** A filter of "last 90 days" should mean
*referrals created in the last 90 days, shown at whatever stage they have since
reached*. That is the only interpretation where the funnel narrows monotonically
and the percentages mean something.

The alternative — "stage transitions that occurred in the window" — produces a
funnel where a later stage can exceed an earlier one (a referral created 8 months
ago converting today), which reads as a bug. If a period-activity view is wanted,
it belongs as a separate "what happened this month" list, not as the funnel.
**Label the filter explicitly: "Referrals started in the last 90 days".**

---

## Q. Live referral log — data contract

`audit_log` (`table_name`, `record_id`, `action`, `changed_by`, `changed_at`,
`before`, `after`; indexed `changed_at desc`; RLS `internal.is_site_admin()`) has
an `audit_row_change` trigger on `platform_referrals`, `platform_credits`,
`platform_payments`, `platform_club_subscriptions` and `clubs`. **A true
chronological referral feed is therefore derivable from real recorded history, not
reconstructed from current state.**

Event derivation:

| Feed event | Derivation |
|---|---|
| Referral created | `audit_log` INSERT on `platform_referrals` |
| Referred club registered | `audit_log` UPDATE on `platform_referrals` where `before->>'status' = 'pending'` and `after->>'status' = 'registered'` |
| Referral qualified | same, `'registered' → 'qualified'` |
| Referral rejected | `after->>'status' = 'rejected'`, with `after->>'rejection_reason'` |
| Referral reversed | `after->>'status' = 'reversed'` |
| Reward credited | `audit_log` INSERT on `platform_credits` where `after->>'source' = 'referral_reward'` |
| Reward applied | INSERT where `after->>'source' = 'application'` |
| Reward reversed | INSERT where `after->>'source' = 'reversal'` |

Feed row shape: `timestamp` (`changed_at`), `event_type`, `referrer_club`,
`referred_club`, `status`, `reward_amount_pence`, `actor` (`changed_by` → profile
name).

### Two important honesty constraints

1. **History starts when the trigger did.** Referral rows created before
   `20261006000000` have no audit history. In practice all of them post-date it,
   but the feed must be able to say "no recorded history" rather than invent one.
2. **`audit_log.before`/`after` are full row snapshots** and therefore contain
   every column of the audited row. A referral feed reading `audit_log` must
   **project explicit fields**, never dump the JSONB. `club_ovalball_invitations`
   is *not* audited, so invitation tokens never enter `audit_log` — but this
   discipline still matters for `platform_payments` (provider ids) and
   `platform_club_subscriptions` (`provider_mandate_id`, `provider_customer_id`),
   which are audited and must never be rendered.

### Email privacy

`club_ovalball_invitations.contact_email` may appear in the **detailed operational
referral log only** — Site Admin, RLS-gated, for support and reconciliation. It
must not appear in the leaderboard, the funnel, the rewards panel, the broader
platform activity feed, or any club-facing surface. `club.referrals.view` is
CLUB_ADMIN-scoped and `club_referral_summary` deliberately returns
`coalesce(d.name, i.contact_name)` — a name, never the email. Keep it that way.

Never render: `club_ovalball_invitations.token`, `platform_provider_events.payload`,
provider ids, mandate ids.

---

## R. Referral reconciliation and data health — ~~the blocker~~ **RESOLVED in Phase F₀**

> **Update — Phase F₀ complete.** R-1 and R-2 below are fixed, and a third,
> more severe defect (**R-0**) was found while proving them: Side Project 2's
> `20261011000000_training_management_schema.sql` had silently dropped
> `club.referrals.view`, `club.referrals.manage`, `club.platform_billing.view`
> and `club.platform_billing.manage` from CLUB_ADMIN, switching the commercial
> platform off for every club and making R-1's best-effort call fail 100% of the
> time. All three are fixed in
> `supabase/migrations/20261012000000_referral_attribution_integrity.sql`.
>
> **The canonical record is `docs/REFERRAL_ATTRIBUTION_INTEGRITY.md`.** The
> analysis below is retained as the audit finding that motivated it; read the
> other document for the resolution, the reconciliation semantics, the
> data-health model and the historical-anomaly classification.
>
> Still open from this section: **R-5, the Site Admin referral administration
> surface, remains a GAP.** F₀ built its two canonical reads
> (`referral_data_health`, `referral_data_health_detail`) and its one canonical
> action (`reconcile_referral_attribution`); the screen itself is F₁ work.

### R.1 `internal.reconcile_partner_invitations` exists, but does not reconcile referrals

It is real, in current Main, at `20260917000000:110` and re-declared at
`20261008000000:26`. What it actually does, per invocation from
`approve_club_claim`:

- selects `club_ovalball_invitations where club_directory_id = … and status = 'pending' **and expires_at > now()**`
- creates or finds a `club_partnerships` row
- marks the invitation `accepted`
- calls `public.register_referred_club(v_inv.id, p_new_club_id)`

It is **idempotent** (the partnership insert catches `unique_violation`; the
invitation is only matched while `pending`; `register_referred_club` only acts on a
`pending` referral). It runs **automatically**, only inside `approve_club_claim`,
and never on a schedule.

**What it does not do:** it never *creates* a missing `platform_referrals` row.
`register_referred_club` begins with
`select … from platform_referrals where invitation_id = p_invitation_id` and
returns `false` if there is none. A referral that was never claimed is never
recovered.

### R.2 Two structural attribution gaps

**Gap R-1 — the claim is a best-effort application-layer call.**
`app/(app)/partner-clubs/actions.ts:140-148` and
`app/(app)/club/settings/ovalball-billing/actions.ts:106-110` call
`claim_club_referral` after `create_partner_invitation`, log on failure, and
continue. If that call fails — or if an invitation is ever created by a path that
does not make it — the invitation exists with **no referral record**, and nothing
will ever create one.

**Gap R-2 — expired invitations silently kill referrals.**
`club_ovalball_invitations` defaults to `expires_at = now() + 14 days`. There is
**no expiry job and no lazy expiry** for this table (unlike `invitations`,
`site_admin_invitations`, `guardian_invitations` and `player_account_invitations`,
which all set `status='expired'` in their accept paths — verified by grep). So an
invitation older than 14 days stays `pending` forever, `reconcile_partner_invitations`
skips it on the `expires_at > now()` clause, the partnership is never created, and
the referral stays `pending` permanently even though the referred club joined.

### R.3 Both gaps are detectable — and both have live hits

**Detector 1 — successful invitation with no referral record:**

```sql
select i.id, i.inviting_club_id, i.status
from public.club_ovalball_invitations i
left join public.platform_referrals r on r.invitation_id = i.id
where r.id is null and i.status = 'accepted';
```

Run against the local database: **1 row.** Invitation
`7f09e78d-0e2b-4b62-b03f-c6bc178fc240`, `status='accepted'`, `accepted_at`
2026-09-03, `resulting_partnership_id` set — a completed club conversion with **no
referral record at all**.

**Detector 2 — referral stuck `pending` while its invitation has expired:**

```sql
select r.id
from public.platform_referrals r
join public.club_ovalball_invitations i on i.id = r.invitation_id
where r.status = 'pending' and i.status = 'pending' and i.expires_at < now();
```

Local: 0 rows today (the one pending referral's invitation is still in date), but
the condition is reachable by construction.

**Detector 3 — orphan reward credit:**

```sql
select c.id, c.club_id, c.amount_pence
from public.platform_credits c
left join public.platform_referrals r on r.reward_credit_id = c.id
where c.source = 'referral_reward' and r.id is null;
```

Local: **1 row.** Credit `bd75a294-…`, £15.00, with no owning referral. (Almost
certainly a seeded test fixture rather than an engine fault — but the *detector*
is proven to run, and the FK direction means the ledger genuinely permits it: the
referral holds the credit id, the credit does not hold the referral id.)

**Detector 4 — divergence between qualified referrals and reward credits:**

```sql
select
  (select count(*) from public.platform_referrals where status = 'qualified') as qualified,
  (select count(*) from public.platform_credits where source = 'referral_reward') as rewards;
```

Local: 0 qualified vs 1 reward credit — divergence of 1, consistent with detector 3.

### R.4 Referral Data Health status — proposed rule

| Status | Condition |
|---|---|
| **HEALTHY** | Detectors 1–4 all return zero |
| **RECONCILIATION NEEDED** | Detector 1 or 2 > 0 — attribution is incomplete; analytics under-count |
| **ACTION REQUIRED** | Detector 3 or 4 > 0 — the reward ledger and the referral ledger disagree; this is money |

**This status must be rendered on the dashboard next to every referral figure.**
The user's own constraint applies directly: the dashboard must never silently
claim referral analytics are complete while known attribution gaps exist. Today,
against real data, the status would read **ACTION REQUIRED**.

### R.5 Referral administration surface — GAP

`/admin/commercial` shows exactly two referral numbers, from
`supabase.from("platform_referrals").select("status")`:
"1 referrals pending · 0 rewards earned" (live-verified). There is **no**
per-referral list, no referrer identity, no funnel, no reward ledger view, and no
reconciliation action anywhere in the Site Admin console.

**Classification: the referral administration surface is a GAP.** Drill-throughs
from the dashboard's referral visuals have nowhere canonical to land yet. Building
one is a legitimate later phase; building analytics that link nowhere is not.

**Do not fix any of this during Stage 1**, per instruction. It is surfaced here so
it can be sequenced before, not after, the referral analytics build (§Y).

---

## S. Referral fraud / duplication safety audit

| Risk | Current protection | Verdict |
|---|---|---|
| Duplicate referral per invitation | `invitation_id` is `UNIQUE`; `claim_club_referral` is idempotent | **Protected** |
| Self-referral | CHECK `platform_referrals_no_self_referral` (structural) **plus** runtime checks in both `register_referred_club` and `qualify_referral_for_payment` | **Protected, twice** |
| Same club referred by many clubs | Partial unique index `(referred_club_id) where status='qualified'` — at most one referrer can ever be rewarded for a given club | **Protected** |
| Multiple people claiming one referral | The referrer is a club, and one invitation yields one referral | **Protected** |
| Reward issued twice | `reward_credit_id` UNIQUE + the partial unique index + early return in `apply_platform_payment_status` | **Protected, three ways** |
| Webhook replay | `apply_platform_payment_status` returns `false` if the payment is already in a terminal state, before reaching the qualify call. `platform_payments.idempotency_key` also exists | **Protected** |
| Payment retry creating a second reward | "First confirmed payment" is counted against the payment ledger; a retry is a second confirmed payment and cannot qualify | **Protected** |
| Refunded / reversed first payment | `reverse_referral_for_payment` writes a compensating negative credit and marks the referral `reversed`, guarded against double-reversal | **Protected** |
| Referring an already-paying club | `register_referred_club` rejects if the club has any `confirmed` `platform_payments` | **Protected** |
| Referring an already-*active* (but never-paid) club | `create_partner_invitation` refuses when the directory club already has a `clubs` row, so the invitation cannot be created | **Protected at the invitation layer** |
| Folded referring club accruing credit | `qualify_referral_for_payment` rejects if the referring club is not `status='active'` | **Protected** |
| **Missing referral record entirely** | none | **GAP — R-1** |
| **Expired invitation orphaning a referral** | none | **GAP — R-2** |
| **Orphan reward credit** | none | **GAP — R-3** |
| Reward cap | none | **PRODUCT POLICY GAP** |
| Credit expiry | none | **PRODUCT POLICY GAP** |

The fraud posture on the *earning* path is genuinely strong. Every gap is on the
*attribution* path — records that should exist and do not — not on the reward path.

---

## T. Referrals during Beta

Verified behaviour, from code, not assumption:

| Concern | Beta behaviour |
|---|---|
| **Referral attribution** | Fully operational. `claim_club_referral` and `register_referred_club` have no mode gate; `approve_club_claim` runs normally |
| **Reward earning** | **Structurally impossible.** `open_platform_billing_cycle` raises while mode ≠ `live`, so no payment exists to confirm, so `qualify_referral_for_payment` is never reached |
| **Reward redemption** | Also impossible — application happens inside a billing cycle, which cannot open |
| **Trials** | Every trial paused with `pause_reason='beta'`; resumed only by a transition to Live, which restores exactly the clocks Beta stopped |

The dashboard's Beta copy must therefore be of this shape — and only if the
figures match:

> **12 referrals attributed · 4 clubs on Ovalball · 0 paid conversions**
> Rewards cannot be earned while Ovalball is in Beta. Referrals are being recorded
> now and will qualify once a referred club's first subscription payment is
> collected.

Read the mode live; never hardcode "Beta" in the copy.

---

## U. SignNow / contracts audit

A full-tree search for `signnow`, `SignNow`, `docusign`, `e_signature`,
`esignature` and `contract_signed` across `*.ts`, `*.tsx`, `*.sql` and `*.json`
returns **zero matches**. There is no contract table, no signature status, no
signed-date column, and no envelope/document integration anywhere in Main. The
`.env.example` surface contains no e-signature credentials.

**Classification: GAP / FUTURE INTEGRATION.** Not built here. When it is built, it
must never become the source of payment or referral truth — `platform_payments`
and `platform_referrals` remain canonical for both.

---

## V. Platform activity feed audit

`audit_log` covers 64 tables with a uniform trigger and is Site-Admin-only by RLS.
It can support a safe internal activity feed with **no new event store**.

Safe, useful event sources: `clubs` INSERT (club activated), `teams` INSERT/UPDATE
(team created / folded), `fixtures` INSERT (fixture created),
`training_sessions` INSERT, `guardians` INSERT (parent linked),
`club_partnerships` INSERT, `platform_referrals` and `platform_credits` (§Q),
`club_claims` status transitions, `directory_requests` status transitions.

### Mandatory exclusions

`audit_log.before`/`after` are **whole-row JSONB snapshots**. `players` and
`guardians` are audited, which means `players.first_name`, `players.surname` and
`players.date_of_birth` are present in `audit_log`. A feed must therefore:

- **project a fixed allow-list of fields per event type**, never render the JSONB;
- never render child names or DOB — a parent/player event should read "a
  parent/guardian was linked at Burnley RUFC", club-level and person-free;
- never render provider ids, mandate ids, tokens, or `platform_provider_events.payload`;
- never render free-text fields that can contain anything (`notes`, `bio`,
  `description`, `cancellation_reason`, `rejection_reason` in a public-ish context).

### Referral events: feed A or feed B?

**Recommendation: B — dedicated referral feed only, with a small number of
milestone referral events promoted into the broader platform feed.** Both feeds
read the same `audit_log` rows and project them differently, so there is no
duplicated storage either way. The reason to keep them separate is that the
referral feed carries commercial detail (reward amounts, and optionally the
invitation email) that the general activity feed must not; merging them would
force the general feed up to the referral feed's privacy classification for no
benefit. Promote only "club X was referred onto Ovalball" and "a referral reward
was earned" — no amounts, no emails — into the general feed.

---

## W. Performance and refresh architecture

### Refresh classification

| Class | Metrics | Strategy |
|---|---|---|
| **NEAR REAL TIME** (no cache; `dynamic = 'force-dynamic'`) | Fixtures today, Needs Attention, System Health, referral data health, recent referral activity, recent platform activity | Server Component, per-request. Optional 60 s client `router.refresh()` |
| **SHORT CACHE** (60–300 s) | Platform KPI counts, active clubs/teams, subscriber and trial counts, referral totals, credit balances | `unstable_cache` / `revalidate` on one aggregate RPC |
| **LONGER CACHE** (15–60 min) | 12-month growth series, 12-week fixture activity, feature adoption, adoption funnel, top-referrer historical ranking, financial trends | `revalidate` on a separate aggregate RPC |

### Query architecture — the rule

**One RPC per refresh class, not one query per tile.** Three `security definer`
RPCs, each guarded by `internal.is_site_admin()` and each returning a single JSONB
document:

- `site_admin_dashboard_live()` — near-real-time block
- `site_admin_dashboard_counts()` — short-cache block
- `site_admin_dashboard_trends()` — long-cache block

Rationale: the dashboard needs ~40 aggregates. Forty round trips through
PostgREST, each re-evaluating `internal.is_site_admin()` in an RLS predicate on
every row, is the failure mode the brief warns about. Three `security definer`
functions evaluate authorization **once each**, run their aggregates as plain SQL,
and return three payloads. `internal.is_site_admin()` and
`internal.has_capability()` are both `stable` and `security definer`, so
in-statement caching already helps, but the round-trip count is the dominant cost.

### Explicit avoidances

- No `select *` then `.length` — every count is a SQL `count()`.
- No N+1: club names come from one `clubs ⋈ club_directory` join, never per-row lookups.
- No direct privileged browser queries: the browser never calls these RPCs; Server Components do.
- No Supabase Realtime. There is no dashboard metric whose value changes fast enough to justify a persistent socket per Site Admin. A 60-second refresh on the live block is sufficient and far cheaper.
- No provider API calls to render anything. `gocardless_*` and `platform_*` tables already hold normalized local truth (§27). Live provider calls belong in webhook processing, never in a page render.

### Index work required in Phase A

```sql
create index on public.profiles  (created_at);
create index on public.clubs     (created_at);
create index on public.teams     (created_at);
create index on public.players   (created_at);
create index on public.guardians (created_at);
create index on public.fixtures  (created_at);
create index on public.fixtures  (kickoff_date);          -- bare, for cross-club "today"
create index on public.platform_referrals (status);
create index on public.platform_credits   (source);
```

None of these exist today (verified against `pg_indexes`). All are additive and
non-destructive.

### Pre-aggregation

**Not recommended for any phase currently foreseeable.** Every metric here is a
`count`/`sum` over tables in the tens-to-thousands of rows. A materialised
projection would be a second truth (§33) with a staleness contract to maintain, in
exchange for milliseconds. If it ever becomes necessary, it must be a
**read-only derived projection refreshed from canonical tables**, never a store
that anything writes to directly.

---

## X. Authorization review

### Existing primitives to reuse — no new mechanism needed

| Primitive | Location | Role |
|---|---|---|
| `requireActiveSiteAdmin(supabase, user)` | `lib/app-context/require-active-site-admin.ts` | Requires Site Admin authority **and** that the active context is Site Admin |
| `requireSiteAdmin(supabase, allowedProfiles?)` | `app/(app)/admin/require-site-admin.ts` | The same, plus profile narrowing, for server actions |
| `hasCapability(supabase, key, scope)` | `lib/permissions/has-capability.ts` | Scoped capability check |
| `internal.is_site_admin()` | DB | The actual RLS boundary |
| `internal.has_capability(key, scope, id)` | DB | Scoped capability, `stable security definer` |

### The context-cookie question, answered

The active-context cookie **cannot grant authority**. `resolveActiveContext`
selects among contexts the session already holds; `getSessionContext` derives
those from real `site_admins` / `club_memberships` / `team_permissions` rows.
Changing the cookie to `site_admin` when the account holds no active
`site_admins` row yields no Site Admin context, `requireActiveSiteAdmin` fails,
and the route redirects.

Beneath that, **RLS is the real boundary**. Verified SELECT policies on every
aggregate-critical table:

- `profiles`: `id = auth.uid() or internal.is_site_admin()`
- `players`: `internal.is_site_admin() or user_id = auth.uid() or is_active_player_guardian(id) or can_manage_player(id)`
- `guardians`: `internal.is_site_admin() or guardian_user_id = auth.uid() or can_manage_player(player_id)`
- `audit_log`: `internal.is_site_admin()` — admin only, full stop
- `platform_trials` / `platform_club_subscriptions` / `platform_payments` / `platform_credits`: `has_capability('club.platform_billing.view','club',club_id) or internal.is_site_admin()`
- `platform_referrals`: `has_capability('club.referrals.view','club',referring_club_id) or internal.is_site_admin()`
- `gocardless_payments`: `internal.is_site_admin() or has_capability('club.subscription.view_finance', …)`

A Club Admin calling a dashboard RPC directly therefore gets nothing: the RPC's
own `internal.is_site_admin()` guard rejects, and even without it every underlying
table would filter to their own club. A Parent or Player gets less again.

### One design requirement

The dashboard RPCs must be `security definer` **with an explicit
`internal.is_site_admin()` guard as their first statement** — following the exact
pattern `platform_commercial_overview()` uses with `site.commercial.view`. A
`security definer` function without that guard would bypass RLS for everyone.

### Capability scoping within Site Admin

`site_admins` carries per-area flags: `admin_role`, `view_commercial`,
`manage_system`, `diagnostic_club_access`, `manage_team_catalogue`,
`manage_competitions`, `manage_fixture_support`, `manage_global_lookups`,
`manage_permissions`, `manage_seasons`. `site.commercial.view` gates
`/admin/commercial` today.

**Recommendation:**
- Platform KPIs, growth, fixtures, adoption, operations, system health → any active Site Admin.
- Finance rows (MRR, ARR, collected, credits) and the referral rewards/leaderboard → `site.commercial.view`, matching `/admin/commercial`.
- The referral operational log **with `contact_email`** → `site.commercial.view` as well; the email is commercial support data.
- Server re-checks each block independently. A read-only Site Admin sees the platform half and simply does not receive the commercial half — omitted server-side, not hidden with CSS.

---

## Y. Metric catalogue

`RT` = near real time · `SC` = short cache · `LC` = long cache.
`Auth`: `SA` = any active Site Admin · `COM` = `site.commercial.view`.
`Priv`: `—` none · `AGG` aggregate-only · `PII` contains personal data.
`Cx`: implementation complexity, S/M/L.

| Metric | Definition | Canonical source | Calculation | Window | Refresh | Auth | Priv | Drill-through | Available | Cx | Caveats |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Registered Users | People with a completed profile | `profiles` | `count(*)` | total + 30d trend | SC | SA | AGG | `/admin/users` | ✅ | S | Excludes unfinished signups (correct) |
| Suspended Users | | `profiles` | `count(*) where account_status='suspended'` | total | SC | SA | AGG | `/admin/users` | ✅ | S | |
| Registered Clubs | Activated clubs | `clubs` | `count(*)` | total + trend | SC | SA | — | `/admin/clubs` | ✅ | S | Not `club_directory` |
| Active Clubs | | `clubs` | `count(*) where status='active'` | total | SC | SA | — | `/admin/clubs` | ✅ | S | |
| Registered Teams | | `teams` | `count(*)` | total + trend | SC | SA | — | `/admin/team-directory` | ✅ | S | |
| Active Teams | | `teams` | `active and folded_at is null and archived_at is null` | total | SC | SA | — | `/admin/team-directory` | ✅ | S | |
| Registered Parents | Distinct guardian people | `guardians` | `count(distinct guardian_user_id) where status='active'` | total + trend | SC | SA | AGG | — (GAP) | ✅ | M | Never `count(*)` |
| Registered Players | | `players` | `count(*)`; active = `active=true` | total + trend | SC | SA | AGG | — (GAP) | ✅ | S | Disjoint from Users |
| Directory clubs | Addressable market | `club_directory` | `count(*) where active` | total | LC | SA | — | `/admin/clubs` | ✅ | S | **Never a funnel stage** |
| Growth series | New rows per period | 5 entity tables | `count group by date_trunc(created_at)` | 30D/90D/12M/All | LC | SA | AGG | — | ✅ | M | Seeded rows spike on insert date |
| Fixtures today | | `admin_fixture_overview` | `kickoff_date = current_date`, `is_primary_mirror`, `status<>'Cancelled'` | today | RT | SA | — | `/admin/fixtures` **needs `date=today`** | ✅ | S | |
| Fixtures this week/month | | same | `kickoff_date` range | week/month | SC | SA | — | `/admin/fixtures` | ✅ | S | |
| Fixtures next 30 days | | same | `kickoff_date` range | +30d | SC | SA | — | `/admin/fixtures` | ✅ | S | |
| Fixtures booked this week/month | | `fixtures` | `created_at` range | week/month | SC | SA | — | `/admin/fixtures?sort=created` | ✅ | S | Includes imports |
| Cancelled this month | | `fixtures` | `status='Cancelled'`, `cancelled_at` in month | month | SC | SA | — | `/admin/fixtures?status=Cancelled` | ✅ | S | |
| Pending fixture requests | | `fixture_requests` | `status='sent'` | live | RT | SA | — | `/admin/fixtures` | ✅ | S | |
| Results awaiting confirmation | | `fixtures` | `result_status='awaiting_confirmation'` | live | RT | SA | — | `/admin/fixtures?resultStatus=…` | ✅ | S | |
| Disputed results | | `fixtures` | `result_status='disputed'` | live | RT | SA | — | `/admin/fixtures` | ✅ | S | |
| Fixture activity 12w | Two series | `fixtures` | created vs taking place, weekly | 12 weeks | LC | SA | — | `/admin/fixtures` | ✅ | M | Never one ambiguous series |
| Fixtures by rugby code | | `admin_fixture_overview.rugby_code` | group by | 12m | LC | SA | — | `/admin/fixtures?code=` | ✅ | S | |
| Teams by category | Mini / Age Grade / Colts / Adult M / Adult W | `teams.canonical_team_type_id` → `canonical_team_types` | group by canonical type | total | LC | SA | — | `/admin/team-directory` | ✅ | M | Canonical — **no name parsing** |
| Club adoption funnel | 8 stages | §E | see §E | total | LC | SA | — | per stage | ✅ | L | Start at stage 2 |
| Feature adoption | 10 features | §F | see §F | total | LC | SA | — | per feature | ✅ | M | Denominator = active clubs |
| Needs attention | 12 signals | §G | see §G | live | RT | SA/COM | mixed | per signal | mostly ✅ | M | Finance rows COM-gated |
| System health | 6 of 9 components | §H | see §H | live | RT | SA | — | `/admin/system-health` | partial | M | Auth/notifications/storage GAP |
| MRR | | `platform_club_subscriptions` | `sum(plan_price_pence) where status in ('active','past_due')` | now | SC | COM | — | `/admin/commercial` | ✅ | S | **State Beta explicitly** |
| ARR run-rate | | derived | MRR × 12 | now | SC | COM | — | `/admin/commercial` | ✅ | S | Label as run-rate |
| Subscribed / trial clubs | | `platform_commercial_overview()` | counts | now | SC | COM | — | `/admin/commercial` | ✅ | S | Reuse the RPC |
| Subscriptions started this month | | `platform_subscription_events` | `event_type='activated'` | month | SC | COM | — | `/admin/commercial` | ✅ | S | Event ledger, not `started_at` |
| Cancellations this month | | `platform_club_subscriptions` | `cancelled_at` in month | month | SC | COM | — | `/admin/commercial` | ✅ | S | |
| SaaS cash collected | | `platform_payments` | `sum(net_pence) where status='confirmed'` | month/all | SC | COM | — | `/admin/commercial` | ✅ | S | Zero during Beta |
| Clubs connected to GoCardless | | `gocardless_merchant_connections` | `disconnected_at is null` | now | SC | COM | — | `/admin/clubs` | ✅ | S | Domain B |
| Gross member collections | | `gocardless_payments` | `sum(gross_amount_minor) where confirmed` | month | SC | COM | — | — (GAP) | ✅ | S | **Not Ovalball revenue** |
| Member payment failures | | `gocardless_payments` | `status='failed'` | month | RT | COM | — | — (GAP) | ✅ | S | |
| Payouts confirmed | | `gocardless_payouts` | `sum(amount_minor)` | month | SC | COM | — | — (GAP) | ✅ | S | Club money |
| Ovalball commission | | — | — | — | — | — | — | — | **GAP** | — | **Do not render** (§K.2) |
| Referrals sent | | `platform_referrals` | `count(*)` | cohort | SC | COM | — | referral admin (GAP) | ✅ | S | |
| Referrals registered | | `platform_referrals` | `status in ('registered','qualified')` | cohort | SC | COM | — | referral admin (GAP) | ✅ | S | |
| Paid referral conversions | | `platform_referrals` | `status='qualified'` | `qualified_at` | SC | COM | — | referral admin (GAP) | ✅ | S | Zero during Beta |
| Referral funnel | 5 stages | §P | see §P | cohort by `created_at` | SC | COM | — | referral admin (GAP) | ✅ | M | No "opened" stage |
| Top Referrers | ranked clubs | §O | see §O | month/90d/12m/all | LC | COM | AGG | referral admin (GAP) | ✅ | M | Club identity only |
| Free months earned | | `platform_referrals` | `count where qualified`, `sum(reward_amount_pence)` | period | SC | COM | — | `/admin/commercial` | ✅ | S | Exact |
| Reward credit applied | | `platform_credits` | `abs(sum) where source='application'` | period | SC | COM | — | `/admin/commercial` | ✅ | S | **£ only, not months** (§N.3) |
| Credit outstanding | | `platform_credits` | `sum(amount_pence)` | now | SC | COM | — | `/admin/commercial` | ✅ | S | Signed ledger |
| Referral data health | 4 detectors | §R.3 | see §R.3 | live | RT | COM | — | referral admin (GAP) | ✅ | M | **ACTION REQUIRED today** |
| Live referral log | recent events | `audit_log` | §Q | last 20 | RT | COM | **PII** | referral admin (GAP) | ✅ | M | Email: log only |
| Platform activity | recent events | `audit_log` | §V | last 20 | RT | SA | AGG | per entity | ✅ | M | Field allow-list mandatory |
| Contracts / SignNow | | — | — | — | — | — | — | — | **GAP** | — | No integration exists |

---

## Z. Proposed visual layout

Recommendation: keep the brief's eight-row spine, but **cut two rows and reorder
one**, because the data does not support the original shape everywhere.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SITE ADMIN                                    [BETA 0.0.1]  Updated 14:32 ⟳   │
│ Platform                                                                      │
│ Everything Ovalball is doing right now.                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 1 — PLATFORM PULSE                                                        │
│ ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐                            │
│ │ Users  ││ Clubs  ││ Teams  ││Parents ││Players │   5 KPI tiles, each with   │
│ │   76   ││   44   ││   85   ││   10   ││   16   │   a 30-day sparkline and   │
│ │ ▁▂▃▅▆ ││ ▁▁▂▄▅ ││ ▂▃▄▅▆ ││ ▁▁▂▂▃ ││ ▁▂▂▃▃ │   "+n this month"          │
│ └────────┘└────────┘└────────┘└────────┘└────────┘                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 2 — NEEDS ATTENTION + SYSTEM HEALTH      ← moved up from row 4            │
│ ┌───────────────────────────────────┐┌─────────────────────────────────────┐  │
│ │ Needs attention              (6)  ││ System health                       │  │
│ │ ▸ 2 club claims awaiting review   ││ Application      ● Healthy  v0.0.1  │  │
│ │ ▸ 3 disputed results              ││ Database         ● Healthy          │  │
│ │ ▸ 1 subscription past due         ││ Scheduled jobs   ● 4 active         │  │
│ │ ▸ Referral data: ACTION REQUIRED  ││ Commercial       ◐ Beta — paused    │  │
│ │ ▸ 1 accepted invite, no referral  ││ Payment provider ● Connected (1)    │  │
│ │ ▸ 1 orphan reward credit          ││ Referral data    ▲ Action required  │  │
│ └───────────────────────────────────┘└─────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 3 — GROWTH + ADOPTION FUNNEL                                              │
│ ┌──────────────────────────────────────────┐┌──────────────────────────────┐  │
│ │ Platform growth                          ││ Club adoption                │  │
│ │ [Users][Clubs][Teams][Parents][Players]  ││ Claim submitted      ████ 51 │  │
│ │ [30D][90D][12M][All]                     ││ Activated            ███  44 │  │
│ │        ╱‾‾‾                              ││ With active teams    ██   31 │  │
│ │    ╱‾‾‾                                  ││ With fixtures        █    18 │  │
│ │ ╱‾                                       ││ Using training       ▏     0 │  │
│ │                                          ││ Parent/player        █     7 │  │
│ │                                          ││ Taking payments      ▏     1 │  │
│ │                                          ││ ─────────────────────────────│  │
│ │                                          ││ 1,434 clubs in the directory │  │
│ │                                          ││ (addressable, not a stage)   │  │
│ └──────────────────────────────────────────┘└──────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 4 — RUGBY ACTIVITY                                                        │
│ ┌──────────────────────────────────────────┐┌──────────────────────────────┐  │
│ │ Fixture activity · 12 weeks              ││ Playing today          (5)   │  │
│ │  ─── taking place   ┄┄┄ booked           ││ 10:30 Burnley U13 v Rossen…  │  │
│ │      ╱╲    ╱╲                            ││       Union · League Cup     │  │
│ │  ╱╲╱  ╲╱╲╱  ╲                            ││ 11:00 Burnley U15 v Preston  │  │
│ │  ┄┄╱╲┄┄┄╱╲┄┄┄┄                           ││ 14:00 …                      │  │
│ │  [Union 34] [League 7]                   ││ → View all fixtures today    │  │
│ └──────────────────────────────────────────┘└──────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 5 — COMMERCIAL              site.commercial.view only                     │
│ ┌────────────────────┐┌────────────────────┐┌──────────────────────────────┐  │
│ │ OVALBALL SAAS      ││ CLUB MEMBER        ││ OVALBALL REVENUE             │  │
│ │ what clubs pay us  ││ PAYMENTS           ││ our own money                │  │
│ │                    ││ what members pay   ││                              │  │
│ │ MRR      £0.00     ││ their club         ││ SaaS collected      £0.00    │  │
│ │ ⓘ Billing paused — ││                    ││ Referral credits    £15.00   │  │
│ │   Ovalball is in   ││ Connected clubs  1 ││   owed to clubs              │  │
│ │   Beta             ││ Collected     £0.00││                              │  │
│ │ Standard  2        ││ Failed           0 ││ Commission: not implemented  │  │
│ │ Pro       0        ││ Payouts       £0.00││                              │  │
│ │ On trial  1        ││                    ││                              │  │
│ │ Past due  1        ││ Club money, never  ││                              │  │
│ │                    ││ Ovalball's         ││                              │  │
│ └────────────────────┘└────────────────────┘└──────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 6 — REFERRALS               site.commercial.view only                     │
│ ▲ Referral data health: ACTION REQUIRED — 1 accepted invitation has no        │
│   referral record; 1 reward credit has no owning referral.  → Reconcile       │
│ ⓘ Rewards cannot be earned while Ovalball is in Beta.                         │
│ ┌──────────────────────────────────────────┐┌──────────────────────────────┐  │
│ │ Referral funnel   [This month][90d][12m] ││ Top referrers                │  │
│ │ referrals STARTED in the period          ││ # Club          reg  paid  £ │  │
│ │                                          ││ 1 Burnley RUFC    3    0   0 │  │
│ │ Sent           ████████████  12          ││ 2 Rossendale      1    0   0 │  │
│ │ Claimed        ██████████    10          ││                              │  │
│ │ On Ovalball    ████           4          ││ Ranked by paid conversions;  │  │
│ │ Subscribed     ▏              0          ││ zero for all during Beta, so │  │
│ │ Paid & rewarded▏              0          ││ shown by clubs brought on.   │  │
│ └──────────────────────────────────────────┘└──────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 7 — REWARDS + LIVE REFERRAL ACTIVITY    site.commercial.view only         │
│ ┌────────────────────────────┐┌──────────────────────────────────────────────┐│
│ │ Referral rewards           ││ Live referral activity                       ││
│ │ Earned      1  ·  £15.00   ││ 03 Sep 14:22  Burnley referred Rossendale    ││
│ │ Applied         £0.00      ││ 03 Sep 02:06  Rossendale joined Ovalball     ││
│ │ Outstanding     £15.00     ││ 02 Sep 19:40  Referral claimed · Preston GS  ││
│ │ Clubs w/ credit      1     ││ → Full referral log                          ││
│ │ Applied is £, not months   ││                                              ││
│ └────────────────────────────┘└──────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────────────┤
│ ROW 8 — FEATURE ADOPTION + PLATFORM ACTIVITY                                  │
│ ┌──────────────────────────────────────────┐┌──────────────────────────────┐  │
│ │ Feature adoption   (of 44 active clubs)  ││ Platform activity            │  │
│ │ Fixtures      ████████████████  18  41%  ││ 14:02 Team created · Burnley │  │
│ │ Partner clubs ████████          9   20%  ││ 13:44 Fixture created        │  │
│ │ Parent/player ██████            7   16%  ││ 11:20 Club activated         │  │
│ │ Mini-rugby    ████              4    9%  ││ 09:15 Partnership formed     │  │
│ │ Payments      █                 1    2%  ││                              │  │
│ │ Training      ▏                 0    0%  ││                              │  │
│ └──────────────────────────────────────────┘└──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Numbers shown are the local development database, for shape only.

### Changes from the brief's layout, and why

1. **Needs Attention + System Health moved from row 4 to row 2.** A command centre
   leads with what needs doing. Growth charts are context; a disputed result and a
   referral reconciliation warning are work. This also puts the referral data-health
   warning above every referral figure it qualifies.
2. **Rugby Activity Breakdown (§9) folded into Row 4**, as a code split under the
   fixture chart and a category breakdown inside Team Directory — it does not
   warrant its own row at current data volumes.
3. **Row 5 keeps three visually separate finance cards** with the domain stated in
   each subtitle, and the commission slot present but explicitly labelled *not
   implemented* rather than showing £0.
4. **Rows 5–7 are omitted entirely server-side** for a Site Admin without
   `site.commercial.view`.

### Chart recommendations

- **Fixture activity, 12 weeks: grouped bar chart, not line or area.** Weekly counts are discrete buckets; a line implies continuity between weeks that does not exist, and an area implies an accumulating quantity. Two series must be visually distinct by *shape and label*, not colour alone — solid bars for "taking place", outlined bars for "booked".
- **Growth: line chart** — cumulative totals over time genuinely are continuous.
- **Funnels: horizontal bars with absolute counts printed**, never a tapered funnel graphic (which distorts area) and never percentage-only.
- **Sparklines** on KPI tiles: 30-day daily counts, no axis, with the absolute delta printed beside them.

### Craft requirements

- `max-w-7xl` grid for this surface only; the shared `/dashboard` keeps `max-w-4xl`.
- Every tile has explicit empty (`—` plus a sentence), loading (skeleton) and **error** (`Couldn't load` plus retry) states. Zero must never be indistinguishable from failure.
- "Updated HH:MM" timestamp per refresh class, plus a manual refresh control.
- All charts get text alternatives and accessible tooltips; status is carried by the word first, colour second, per the established `StatusPill` pattern.
- Tabular figures (`tabular-nums`) everywhere numbers align.
- Reduced motion respected; no entrance animation on data.

---

## Gaps register

### Data gaps (schema or wiring absent)

| # | Gap | Impact | Severity |
|---|---|---|---|
| X.1 | No test/regression marker on `profiles`, `clubs`, `teams`, `players`, `guardians`, `fixtures`. Only `seasons.is_regression_fixture` exists | **DECIDED (Decision B): no heuristic filtering.** Analytics report canonical production records. Test data must never be inferred from email domain or prefix, name, club name, UUID, creation date, or local seed convention. Explicit test-data classification, if ever wanted, is a separate architecture decision | Closed as a decision |
| X.2 | No email provider wired (`lib/email/dispatch.ts` is a dev no-op) | No delivery/open/bounce data; no "invitation opened" funnel stage; "failed notifications" is unmeasurable | Medium |
| X.3 | No auth, storage or notification health signal | Three System Health components cannot be filled | Medium |
| X.4 | No `cron.job_run_details` reader | Job failures invisible; only existence and schedule are readable | Medium |
| X.5 | No `created_at` indexes on the six KPI entities; no bare `kickoff_date` index | Sequential scans on every trend query | Low now, Medium at scale |
| X.6 | Ovalball commission entirely unimplemented (§K.2) | No commission revenue metric is possible | Medium — product decision |
| X.7 | No SignNow / contract domain (§U) | No contract metrics | Low — future |
| X.8 | `/admin/fixtures` has no `date=today` filter (only `upcoming`/`past`/`all`) | "View all fixtures today" has no exact destination | Low — small extend |
| X.9 | No Site Admin drill-through for member payments, players, or guardians | Three metrics would link nowhere | Low |

### Referral gaps — **F₀ closed the blockers**

| # | Gap | Status after Phase F₀ |
|---|---|---|
| R-0 | Four CLUB_ADMIN commercial capabilities silently dropped by a stale re-declaration of `internal.has_club_role_capability` — found while proving R-1 | **FIXED.** Restored as the union of both intended lists, with a migration-time guard and a permanent regression assertion against recurrence |
| R-1 | `claim_club_referral` was a best-effort application-layer call with no server-side backfill | **FIXED.** Attribution now happens inside `create_partner_invitation`'s own transaction via `internal.ensure_club_referral`; the application call was removed |
| R-2 | `club_ovalball_invitations` had no expiry handling; reconciliation skipped lapsed invitations | **FIXED.** Expiry lifecycle added (nightly sweep) and reconciliation now judges validity against the moment the club submitted its claim, not approval time. This also restored the missing **partnership**, which R-2 destroyed too |
| R-3 | `platform_credits` has no back-reference to `platform_referrals` | **ACCEPTED, WITH A DETECTOR.** The FK direction is forced by the order `qualify_referral_for_payment` must write in; a constraint would mean restructuring money code. `reward_without_referral` detects it and the ledger is append-only. See `REFERRAL_ATTRIBUTION_INTEGRITY.md` §6 |
| R-4 | Credit application is club-level, not per-referral (§N.3) | **ACCEPTED AND LABELLED.** Confirmed as product Decision C: analytics report reward value in £, never reverse-calculated "months" |
| R-5 | No Site Admin referral administration surface | **STILL A GAP.** Its canonical reads and action now exist; the screen is F₁ work |

### Product policy gaps — **owner decisions, do not invent**

| # | Question | State |
|---|---|---|
| P-1 | Is there a cap on referral rewards per club? | No cap in code |
| P-2 | Do referral credits expire? | No expiry in code (also open in `LEGAL_REVIEW_REQUIRED.md`) |
| P-3 | Should referrals earned during Beta qualify retroactively when the platform goes Live? | Undefined. Today a `registered` referral simply waits — which is defensible, but it is not a stated policy |
| P-4 | Should the leaderboard be club-only, or may it name the person who sent the invitation? | Recommend club-only; needs a decision before Phase F |
| P-5 | Is the referral email allowed in the Site Admin log? | Recommended yes, Site Admin only. Needs owner confirmation |

---

## Recommended implementation sequence

Derived from the actual architecture, not from the template. The one substantive
deviation from the suggested A–H ordering: **referral correctness is promoted
ahead of referral analytics**, because building a leaderboard on knowingly
incomplete attribution would ship a wrong number with a premium chart around it.

| Phase | Scope | Depends on | Notes |
|---|---|---|---|
| **A** | Read-model foundation: three `security definer` RPCs (`_live`, `_counts`, `_trends`) with `internal.is_site_admin()` guards; the nine indexes; `lib/app-context/site-admin-dashboard-data.ts`; Site Admin branch in `/dashboard`; shared `EmptyState`; error/loading/empty primitives | — | One migration, additive only |
| **B** | Platform Pulse + Growth + Club Adoption funnel | A | Requires the X.1 test-data decision first, or the numbers are knowingly inflated |
| **C** | Fixture activity + Fixtures Today; add `date=today` to `/admin/fixtures` (X.8) | A | `admin_fixture_overview` + `is_primary_mirror` |
| **D** | Needs Attention + System Health | A | Ship the 12 available signals; leave auth/notifications/storage explicitly marked unavailable rather than faked |
| **E** | Commercial: SaaS / Member Payments / Revenue, three separated cards, Beta copy driven by live mode | A | Reuse `platform_commercial_overview()` |
| **F₀** | ~~Referral correctness~~ — **DONE.** R-0 capability restore, server-side referral claim (R-1), invitation expiry + acceptance semantics (R-2), reconciliation RPC and six data-health detectors. See `docs/REFERRAL_ATTRIBUTION_INTEGRITY.md` | E | Completed ahead of E by owner Decision A. Migration `20261012000000`, 33 new regression assertions, local only. **R-5 (the referral administration screen) was deliberately left to F₁** |
| **F₁** | Referral analytics: funnel, Top Referrers, rewards panel, live referral log, data-health banner — **plus the R-5 administration surface the drill-throughs need** | F₀ | Analytics now land on truth that reconciles |
| **G** | Feature Adoption + Platform Activity feed with the field allow-list | A, D | |
| **H** | Performance hardening, responsive/mobile, accessibility, authorization UAT (verify a Club Admin, Team Admin, Parent and Player each get nothing via URL, direct RPC and cookie tampering) | all | |

Phase F₀ may be deferred by explicit owner decision — in which case Phase F₁ must
ship with the data-health banner permanently visible and the funnel labelled as
lower-bound, never as complete.

---

## One source of truth — compliance check

| If this changes once… | …does the dashboard follow automatically? |
|---|---|
| A referral becomes `qualified` | ✅ Funnel, Top Referrers, rewards-earned and the live log all read `platform_referrals` / `platform_credits` |
| A reward credit is applied | ✅ Applied and outstanding both derive from the same signed `platform_credits` ledger; they cannot disagree |
| A club is renamed in the directory | ✅ Names resolve through `clubs.directory_id → club_directory.name`; the referral holds `club_id`, a stable identity |
| A club is deactivated | ✅ `clubs.status`; active-club denominators follow |
| A plan price changes | ✅ Historic rewards keep their snapshot (`reward_amount_pence`, `reward_price_version`); MRR reads current `plan_price_pence`. Both correct, deliberately different |
| Platform mode flips Beta → Live | ✅ Beta copy, trial clocks and billing all read `internal.current_platform_mode()` |
| A fixture is cancelled | ✅ `status` + `cancelled_at` |

No proposed metric requires a manually maintained store. No pre-aggregation is
recommended. The three RPCs are read-only projections of canonical tables.

---

## Files and git status

**Stage 1 (audit):**

| | |
|---|---|
| Created | `docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md` (this file) |
| Modified | none |
| Migrations | none created, none applied, none removed |
| Application code | unchanged |

**Phase F₀ (referral attribution remediation):** see
`docs/REFERRAL_ATTRIBUTION_INTEGRITY.md`. In summary — one migration
(`20261012000000`, local only), one new regression suite (33 assertions), the
redundant application-layer referral call removed from
`app/(app)/partner-clubs/actions.ts`, regenerated `types/database.types.ts`, and
this document updated.

Across both: **no remote migration, no commit, no push, no deploy, Side Project 3
untouched.**

---

## Verdict

**SITE ADMIN DASHBOARD DATA FOUNDATION — VERIFIED**

Canonical truth has been identified for every proposed metric; definitions are
exact and sourced; the referral architecture has been read in full and its state
machine documented from the implementation rather than from prior documentation;
the two financial domains are kept structurally separate and Ovalball commission
is classified as unimplemented rather than reported as zero; attribution and
reconciliation limitations are disclosed with working detectors and live evidence;
privacy and authorization boundaries are understood and reuse existing primitives;
and every missing capability is explicitly classified as a data gap, a referral
gap or a product policy gap.

Implementation can proceed without inventing analytics — with the stated condition
that referral analytics (Phase F₁) follow referral correctness (Phase F₀), or ship
with a permanent, honest data-health disclosure.
