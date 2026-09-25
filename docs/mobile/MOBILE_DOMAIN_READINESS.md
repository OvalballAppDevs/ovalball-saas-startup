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
| notifications | **NOW** | one notification domain: `my_notifications` (keyset-paged, unread-only) beside `my_bell_notifications`, `mark_notification_read` / `_unread` / `mark_all_notifications_read` shared by both clients, `packages/contracts/src/notifications/{feed,preferences}.ts`; native `/notifications` and `/notifications/preferences` — see `CA_M8_NOTIFICATIONS_ACTION_CENTRE_MAP.md` | PUSH DELIVERY FOUNDATION PENDING (no registry, token, worker or credential exists; architecture and prerequisites recorded in the map) |
| Family & Player Operations — Family Home, child selector, sibling collapse, Children & Family, child picture and permissions, Profile, family memberships, Player Home | **NOW** | `packages/contracts/src/{family,player,identity,subscriptions}/*`; native `/family/*`, `/profile`, the family branch of `/subscriptions`, `PlayerHome` — see `CA_M9_FAMILY_PLAYER_OPERATIONS_MAP.md` | Direct Debit setup is a deliberate web hand-off; club events, adult transition and match community stay web-first (recorded) |
| Club Admin functional parity (CA-M11.1) — invitations with QR / code / link on both clients, native Pitch Allocation, Guardians & Players administration, Safeguarding, Subscriptions & Payments, Season Handover, one five-cell bar with no stray cells | **NOW** | `packages/contracts/src/{pitch-allocation,invitations/share,club/*}` and native `/admin/**` — see `CA_M11_1_CLUB_ADMIN_PARITY_MAP.md` | GoCardless authorisation stays provider-hosted; recorded divergences in ledger H32; physical-iPhone review owed |
| Identity, Profile, Security & Onboarding — Welcome, Get Started, Sign In, Forgot/Recovery, MFA challenge, native enrolment and management, recovery codes, Change Password, devices, invitation preview/accept/wrong-account, team code entry, onboarding router (zero/one/many), switcher kind labels, removed-context reconciliation, one sign-out list | **NOW** | `packages/contracts/src/{invitations,auth,onboarding}/*`; native `/get-started`, `/join`, `/security/**` — see `CA_M11_IDENTITY_SECURITY_ONBOARDING_MAP.md` | account creation, club claim, email change, recovery-code sign-in and Site Admin stay web-first; physical-iPhone review owed |
| Club Operations — Club Home, Teams, team-from-the-club with Enter Team Context, club-wide Fixture Requests, club events in the Calendar, staff invitations, Control Centre and pitch-allocation hand-offs | **NOW** | `packages/contracts/src/club/{overview,requests,invitations}.ts`, `agenda/events.ts`; native `/club/*`, `/calendar/event/*`, the club branches of Home, Fixtures, Calendar and More — see `CA_M10_CLUB_OPERATIONS_MAP.md` | planner, import, competitions, player moves, event management, finance and safeguarding stay web-first |
| attention / Action Centre | **NOW** | `packages/contracts/src/attention/*` — one `AttentionItem` projected from canonical source state per context (family, team, club; Site Admin and governing bodies are web desks and say so), `navigation/destinations.ts` typed destinations over the one native resolver; READ ≠ RESOLVED pinned in `notifications_action_centre_ca8.sql` and `.test.mts` | no task table, ever; the club queues not yet projected are listed in the map's recorded gaps |
| subscriptions (team) | **NOW** | `packages/contracts/src/team/subscriptions.ts` over `team_subscription_status` (CA-M7) — operational state only, `finance.subscription.view` at team or club | GoCardless itself stays server-side, always |
| Team Operations — Team Home, Needs Attention, Availability, People, Fixture Requests, Player Requests, Join Codes, Team Settings | **NOW** | `packages/contracts/src/team/*`; native `/team/**` — see `CA_M7_TEAM_OPERATIONS_MAP.md` | physical-iPhone review owed |
| Rugby Hub | **NOW** | the whole web Hub natively: shared readers in `packages/contracts/src/rugby-hub`, 34 native screens, one search, deep links — see `RUGBY_HUB.md` and `RUGBY_HUB_PARITY_MAP.md` | Rugby Hub convergence |
| Club Admin — Admin Centre: Club Profile, Branding, Venues, Teams, People, Roles & Permissions | **NOW** | `packages/contracts/src/club/{profile,admin-centre,branding,venues,teams,people}.ts`; operations `update_club_profile` / `save_club_contact` / `delete_club_contact` / `upsert_club_kit` / `save_club_venue` / `create_club_team` / `fold_team` / `reactivate_team` / `set_primary_club_role` / `transition_club_membership` / `set_team_access` / `remove_team_access` / `assign_role` / `transition_role_assignment` / `decide_club_join_request`; read model `club_people`; venue pins written by the platform (`pg_net` + `pg_cron`); permissions through `packages/contracts/src/club/permissions.ts` over `club_person_permissions` / `set_capability_override` / `revoke_capability_override` with R enforced server-side; native `/admin/*` — see `ADMIN_CENTRE.md` | CA-M5 next: the remaining "On the Web Today" sections one slice at a time |
| Site Admin | **WEB-ONLY BY DESIGN** | wide, destructive platform authority | Mobile shows what it is and opens the web |
| Competition Creator, Season Planner, Import | **WEB-ONLY BY DESIGN** | spreadsheet-shaped work | Stays a desk job |
| governing-body administration | **WEB-ONLY BY DESIGN** (for now) | `my_governing_bodies` already surfaces the context | The context appears and says honestly that the work is on the web |

## Social sign-in (CA-M11.3)

| provider | status | why |
|---|---|---|
| Google | **IMPLEMENTED, BLOCKED ON PROVIDER CREDENTIALS** | `src/auth/oauth.ts` — Supabase `signInWithOAuth` + `expo-web-browser`'s real system browser session (never a WebView), converging on the identical `exchangeCodeForSession` call the website's callback and mobile's own password recovery already use. Gated by `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`, still **off**. Needs the provider registered in Supabase (production: owner reports already done; local dev stack: not yet — `supabase/config.toml` now carries the structural `[auth.external.google]` block, disabled, ready for real values) |
| Apple | **IMPLEMENTED, BLOCKED ON PROVIDER CREDENTIALS** | Same browser path, PLUS a preferred native path via `expo-apple-authentication` (`signInWithAppleNative`, feature-detected, falls through automatically where unavailable). **Requires a paid Apple Developer account** and, to exercise the native path on a device, a development build — Expo Go does not carry the entitlement `expo-apple-authentication`'s config plugin sets. The browser-OAuth fallback needs no development build |
| Facebook | **IMPLEMENTED, BLOCKED ON PROVIDER CREDENTIALS** | Same browser path as Google — no native Facebook SDK was added (a deliberate choice: it would force a development-client rebuild for no security or UX gain over the browser-session path; see `docs/mobile/CA_M11_3_SOCIAL_AUTH_MAP.md`). Needs a Meta app + Facebook Login product configured |

All three still render nothing until their own flag is on — a button shown before its provider is
configured in Supabase sends a real person into a provider error page. See
`docs/mobile/CA_M11_3_SOCIAL_AUTH_MAP.md` for the full audit and
`docs/SOCIAL_AUTH_PROVIDER_SETUP.md` for the owner's own setup checklist (both providers and platforms).

## What is deliberately not cached on the device

Capabilities, rosters and permission answers. A cached "yes" outlives the permission it came from and
would still be on the phone after a Club Admin took it away. The only thing written to disk is the
Supabase session (secure store) and the selected context key (a view preference, cleared on sign-out).
