# Ovalball Mobile — Domain Readiness

What mobile can reach today, and what each domain needs first. Classified against the code that is
actually checked in.

**MOBILE READY** — a platform-neutral reader exists, or one plain RLS read does the job.
**NEEDS REUSABLE CONTRACT** — the logic exists and is correct, but is welded to a Next.js server file.
**WEB-ONLY BY DESIGN** — belongs at a desk, and should stay there.
**LATER** — nothing blocking; it simply has not been built for mobile.

| domain | status | what exists | what is needed |
|---|---|---|---|
| authenticated user | **MOBILE READY** | `supabase.auth.getUser/getSession` | — used |
| session | **MOBILE READY** | secure-store-backed client | — used |
| AAL / MFA | **MOBILE READY** | `auth.mfa.getAuthenticatorAssuranceLevel`, `challenge`, `verify` | — used. Enrolment stays on the web |
| profile / person | **MOBILE READY** | `profiles` via RLS | — used |
| profile avatar | **MOBILE READY** | `resolvePersonalAvatarUrl` (shared) | — used |
| active contexts | **MOBILE READY** | `getSessionContext` + `listSwitchableContexts` (shared) | — used. **The heart of M2** |
| club identity | **MOBILE READY** | `resolveClubLogoPath*` (shared) | — used |
| team identity | **NEEDS REUSABLE CONTRACT** | canonical naming is `internal.canonical_team_presentation` in the database and `compactTeamLabel` / `fullTeamLabel` in `lib/teams/` | M4 extracts the label helpers. `teams.display_name` is already derived, so reading it is correct today |
| capabilities | **MOBILE READY (server-side)** | `internal.can` through RPCs | Nothing gates an action yet. The first one calls an RPC — never a local rule |
| family relationships | **MOBILE READY** | already inside `SessionContext`; parent/family contexts appear in the switcher | M6 builds the family surfaces |
| fixtures | **NEEDS REUSABLE CONTRACT** | `lib/agenda/load.ts` is the canonical reader, but imports a React component's props type (`KitConfig`) and `…team-identity.server` | **M5**: split the view model from the component type, drop `server-only`. Home currently asks its own small question and says so |
| calendar | **NEEDS REUSABLE CONTRACT** | `lib/calendar/` server modules | M5, after the agenda extraction it shares |
| availability | **NEEDS REUSABLE CONTRACT** | `fixture_availability_summary` RPC exists and is mobile-shaped | M5 — close to ready |
| messages | **LATER** | `lib/messenger/view-model.ts`, realtime already used by the web | M7. Realtime works on RN unchanged |
| notifications | **MOBILE READY** | `my_bell_notifications`, shared `notificationHref`; the app parses the canonical href through its own intent table; a `/teams/<id>/…` link switches into a held team context (CA-M7) | Push delivery is hardening work |
| subscriptions (team) | **NOW** | `packages/contracts/src/team/subscriptions.ts` over `team_subscription_status` (CA-M7) — operational state only, `finance.subscription.view` at team or club | GoCardless itself stays server-side, always |
| Team Operations — Team Home, Needs Attention, Availability, People, Fixture Requests, Player Requests, Join Codes, Team Settings | **NOW** | `packages/contracts/src/team/*`; native `/team/**` — see `CA_M7_TEAM_OPERATIONS_MAP.md` | physical-iPhone review owed |
| Rugby Hub | **NOW** | the whole web Hub natively: shared readers in `packages/contracts/src/rugby-hub`, 34 native screens, one search, deep links — see `RUGBY_HUB.md` and `RUGBY_HUB_PARITY_MAP.md` | Rugby Hub convergence |
| Club Admin — Admin Centre: Club Profile, Branding, Venues, Teams, People, Roles & Permissions | **NOW** | `packages/contracts/src/club/{profile,admin-centre,branding,venues,teams,people}.ts`; operations `update_club_profile` / `save_club_contact` / `delete_club_contact` / `upsert_club_kit` / `save_club_venue` / `create_club_team` / `fold_team` / `reactivate_team` / `set_primary_club_role` / `transition_club_membership` / `set_team_access` / `remove_team_access` / `assign_role` / `transition_role_assignment` / `decide_club_join_request`; read model `club_people`; venue pins written by the platform (`pg_net` + `pg_cron`); permissions through `packages/contracts/src/club/permissions.ts` over `club_person_permissions` / `set_capability_override` / `revoke_capability_override` with R enforced server-side; native `/admin/*` — see `ADMIN_CENTRE.md` | CA-M5 next: the remaining "On the Web Today" sections one slice at a time |
| Site Admin | **WEB-ONLY BY DESIGN** | wide, destructive platform authority | Mobile shows what it is and opens the web |
| Competition Creator, Season Planner, Import | **WEB-ONLY BY DESIGN** | spreadsheet-shaped work | Stays a desk job |
| governing-body administration | **WEB-ONLY BY DESIGN** (for now) | `my_governing_bodies` already surfaces the context | The context appears and says honestly that the work is on the web |

## Social sign-in

| provider | status | why |
|---|---|---|
| Google | **PARTIAL** | Configured in `lib/auth/oauth-providers.ts`, gated by `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`, **off**. Native needs the provider's own iOS/Android client IDs and the app's redirect registered in Supabase |
| Apple | **PARTIAL** | Same, plus Apple requires Sign in with Apple on iOS once any other social provider ships — and that needs a paid Apple Developer account, which this session deliberately does not require |
| Facebook | **PARTIAL** | Same, flag **off** |

No provider button is drawn. All three are switched off in the platform, and a button shown before its
provider is configured sends a real person into a provider error page.

## What is deliberately not cached on the device

Capabilities, rosters and permission answers. A cached "yes" outlives the permission it came from and
would still be on the phone after a Club Admin took it away. The only thing written to disk is the
Supabase session (secure store) and the selected context key (a view preference, cleared on sign-out).
