# CA-M0 — Club Admin Centre: forensic map of the web product

**Status: MAP, then CA-M1 and CA-M2 delivered on it** — the Admin Centre foundation, Club Profile, Branding, Venues and Teams
(`ADMIN_CENTRE.md`), the `R` register (`RECENT_AUTH_CONVERGENCE.md`) and the price-oracle
containment (migrations `20270537000000`, `20270541000000`). Everything else here is still a map:
no push, no deploy, no release.**

This is the complete boundary of the website's Club Admin Settings/Admin product,
read from the routes, server actions, RPC bodies, RLS policies, triggers and the
capability catalogue — so a native Admin Centre can be designed as another
client of the same platform rather than as a second product. Every claim below
names a file, an RPC or a policy. Where the web itself is inconsistent, the
inconsistency is recorded, not copied.

The one architectural rule (owner, standing): **Ovalball is the product; web and
mobile are clients of the same canonical domain — same truth, same authority,
same audit, same validation, different native presentation.**

---

## Part 1 — Cross-cutting facts every slice depends on

### 1.1 Authority: the canonical capability engine

`internal.capability_decision(subject, key, scope_type, club, team, player)`
(exposed as `public.my_capabilities`, `public.has_capability`,
`public.explain_access`) is the one authority. Order of decision, verified from
the live function body:

0. session must be live (`internal.session_live` → `session_ok` → `session_aal_ok`);
1. the capability must exist, be ACTIVE, be valid for the scope, the scope must
   be well-formed (a team must belong to the club it is presented with —
   `SCOPE_TAMPERED`), the account active, impersonation mode respected
   (`VIEW` mode allows only `view*` actions; `impersonation_blocked` keys refused),
   `minor_prohibited` respected, the club active and the membership not suspended;
2–4. an explicit **deny** override (`capability_overrides.effect = 'deny'`) at
   SITE, CLUB or TEAM level wins;
5. an explicit **grant** override applies only while its grantor's authority and
   the subject's membership are still live (`GRANTOR_AUTHORITY_LAPSED`,
   `MEMBERSHIP_INACTIVE` are traced and ignored);
6. the **role bundle** (`capability_bundles` / `bundle_capabilities`, kind ROLE,
   RELATIONSHIP or SITE_PROFILE) — the default authority;
7. site capabilities for site scope;
8. default deny.

The catalogue (`public.capabilities`) carries, per key: `valid_scopes`,
`inherits_to_team`, `grant_level` / `revoke_level` (N none · T team · C club ·
S site — who may extend or withhold it), `delegable`, `aal` (`A2` = an AAL2
session; `R` = a recent authenticator code), `safeguarding_sensitive`,
`minor_prohibited`, `impersonation_blocked`. 110 active keys are `A2`, 73 are `R`.

**Admin Centre consequence.** Visibility, readability, editability and each
sensitive action must each ask the engine for the exact key at the exact scope
(`my_capabilities(p_scope_type:'club', p_club_id)` returns every decision at
once). Never `role === "CLUB_ADMIN"`; never one `isClubAdmin` boolean. The
mobile app already does this for `finance.subscription.view` and
`club.logo.manage` (`apps/mobile/src/context/contexts.tsx`,
`src/identity/images.ts`).

### 1.2 Assurance (AAL)

- **AAL2 session** is enforced in the database for every engine-backed read and
  write: `internal.session_aal_ok()` reads `auth.sessions.aal` (the server's
  record, never the JWT claim) and is folded into `session_live()` → `can()`.
  The mobile app already reaches AAL2 (`app/verify.tsx` TOTP challenge; the
  session status machine in `src/auth/session.tsx` fails closed).
- **Recent AAL2** (`R`): `internal.require_recent_aal2(10 min)` reads
  `auth.mfa_amr_claims` for the session. **Only three RPCs call it**:
  `approve_privileged_recovery`, `request_privileged_recovery`,
  `start_impersonation`. On the web, `guardAction({ recentMinutes })` exists
  (`lib/auth/action-boundary.ts` → `decideSession`) but **no club admin server
  action passes `recentMinutes`**. So the catalogue declares `R` for 73 keys
  (including `people.role.assign_club`, `people.membership.revoke`,
  `people.capability.manage`, `safeguarding.officer.nominate`,
  `finance.gocardless.connect`, `finance.subscription.configure`,
  `team.lifecycle.manage`, `club.settings.manage`) and neither the database
  nor the website enforces it for them today.
- **Consequence / owner decision (RED, §18):** mobile must not be *weaker* than
  the web, and the web enforces `A2` only. Matching the web is trivial. Meeting
  the catalogue's own `R` declaration would require enforcement in the RPCs
  (a migration) — the only place a phone cannot bypass — plus a native step-up
  (re-challenge TOTP, which `verify.tsx` can already do). Recommended: enforce
  `R` in the database for the RED keys as a prerequisite slice, then both
  clients inherit it.

### 1.3 Audit

- `public.audit_log(table_name, record_id, action, changed_by, before, after,
  actor_user_id, effective_person_id, impersonation_session_id, request_id,
  redacted)` written by the `internal.audit_row_change()` trigger on **every
  admin table in scope** (verified: `clubs`, `club_contacts`, `club_kits`,
  `club_memberships`, `role_assignments`, `capability_overrides`, `invitations`,
  `club_join_requests`, `guardians`, `guardian_invitations`, `teams`,
  `player_team_memberships`, `venues`, `club_pitches`, `club_documents`,
  `document_folders`, `club_partnerships`, `club_safeguarding_officers`,
  `club_safeguarding_officer_invitations`, `club_subscription_programmes`,
  `platform_club_subscriptions`, `message_policies`, `training_plans`,
  `training_sessions`, `tournaments`, `club_events`, `club_articles`,
  `club_announcements`, `scheduling_groups`, …). `internal.audit_log_facts()`
  (BEFORE INSERT) redacts per `audit_redaction_rules`, stamps `actor_user_id =
  auth.uid()` and `request_id` from the `ovalball.request_id` GUC.
- Separate ledgers: `finance_audit_log`, `internal.record_subscription_event`,
  `platform_subscription_events`, `security_events` (`club.reporting.export`).
- **Client identification:** the trigger records the actor, never the client.
  The web does not set `ovalball.request_id` (no caller found), so `request_id`
  is null today. A mutation from mobile lands in the **same** `audit_log` row
  shape with the same actor — B15 is satisfied by construction. If the owner
  wants "which client" in the trail, the canonical route is a request-scoped
  setting or a column, not a parallel mobile audit — decision in §18.
- **Storage objects are not row-audited** (crest uploads) — a known gap on the
  web, inherited by mobile.

### 1.4 Reason-required mutations

`internal.require_reason` is enforced inside: `assign_role`,
`change_membership_access_profile`, `decide_club_join_request`,
`grant_club_membership`, `move_player_team_membership`, `remove_team_access`,
`revoke_invitation`, `set_primary_club_role`, `set_team_access`,
`transition_club_membership`, `transition_guardian_relationship`,
`transition_role_assignment`. A native form for any of these must collect a
reason where the RPC requires one — the RPC refuses otherwise.

### 1.5 Where the club navigation comes from

`lib/app-context/build-nav-items.ts` builds the club's destinations from real
capabilities, then groups them (`CLUB_SECTIONS`): Users & Permissions
(`/people`, `/club/permissions`, `/club/join-requests`,
`/club/settings/guardians`, `/club/settings/safeguarding`), Teams (`/teams`),
Fixtures & Calendar (`/agenda`, `/calendar`, `/fixtures/management`,
`/fixtures`, `/partner-clubs`, `/club/player-moves`), Communications
(`/messages`, `/documents`), Club Management (`/club/training`,
`/club/settings`, `/club/calendar/deleted-events`).

`app/(app)/club/settings/resolve-nav-capabilities.ts` is the **one** computation
of Club Settings section visibility (14 keys) and `club-settings-nav.tsx` the
tab strip: Overview · Club Profile (`club.profile.edit`) · Teams
(`club.profile.edit ∨ venue.pitch.manage`) · News & Announcements
(`club.news.manage`) · Lookup Administration (`venue.venue.manage`) · Season
Handover (`team.handover.prepare`) · Pitch Allocation (`fixture.edit`) ·
Player Moves (`manage_fixture_callups ∨ manage_player_dispensations`) ·
Guardians & Players (`family.relationship.approve`) · Safeguarding Officer
(`safeguarding.officer.nominate`) · Permissions (`people.capability.manage`) ·
Subscriptions & Payments (`finance.subscription.configure ∨
finance.subscription.view`) · Ovalball Plan (`finance.platform_billing.view`).

**This map is web-only logic** (not in `packages/contracts`, not in the
database). It is the first extraction candidate (§12).

### 1.6 The Admin Centre entry (B5)

`More → Admin Centre` appears only when the app's active context is a **club**
context (`active.kind === "club"`, `active.id` = club id) **and**
`my_capabilities('club', clubId)` returns at least one of the Admin Centre
section keys allowed. Team, parent, player, family and site-admin contexts never
show it; a Site Admin who has switched into a real club context is governed by
the same rule. No role name is consulted.

---

## Part 2 — Area inventories

### 2.1 Club Profile · Crest · Kit · Contacts · Communications (`/club`)

Page gate: `club.profile.edit` at club scope (`hasCapability` → `my_capabilities`),
scoped to the active club (`activeManageableClubId`), redirect otherwise.

| Function | Web location | Read | Write | Tables / storage | Capability actually enforced | AAL | Audit | Validation | Side effects |
|---|---|---|---|---|---|---|---|---|---|
| Profile text (bio, website, Facebook, home-ground line) | `club-profile-form.tsx`, `actions.ts saveClubProfile` | `clubs` ⋈ `club_directory` | **direct** `clubs.update` | `clubs` | RLS `clubs_update_admin` = `club.profile.edit` (no check in the action) | A2 | `clubs` trigger | empty→null only; no zod, no URL check | `revalidatePath("/club")` |
| Public visibility switches (`show_*`) | Site Admin only (`admin/clubs/[directoryId]/actions.ts`) | — | — | `clubs` | site | — | — | — | not a club-admin function |
| Crest upload / replace | `club-profile-form.tsx handleLogoChange`, `actions.ts uploadClubLogo` | `clubs.logo_storage_path`, inherited `club_directory.logo_storage_path` | storage upload `club-logos/<clubId>/logo-<ts>.<ext>` then **direct** `clubs.update` | `clubs`, bucket `club-logos` (2 MiB; png/jpeg/webp/svg) | storage policy `club.logo.manage`; column `club.profile.edit`; UI gate `club.profile.edit` | A2 | `clubs` trigger (objects unaudited) | size + mime in action | revalidates `/club`, `/`(layout), and a non-existent `/club/<id>` |
| Crest remove | `removeClubLogo` | — | **direct** `clubs.update(null)` + object delete | same | as above | A2 | `clubs` | none | **no confirmation**, file permanently deleted |
| Kit home/away (pattern, primary, secondary, trim) | `kit-section.tsx`, `actions.ts saveClubKit` | `club_kits` | RPC **`upsert_club_kit`** | `club_kits` (unique club+variant) | RPC: `internal.can('club.profile.edit','club')` | A2 | `club_kits` trigger | DB CHECKs (variant, 9 patterns, hex colours, two-tone needs secondary) | derived theme on both clients (`resolveClubTheme`, `clubAccentsOnDark`) |
| "Same as home" checkbox | `kit-section.tsx handleSameAsHome` | — | `upsert_club_kit(alternate)` **on tick** | `club_kits` | as above | A2 | as above | — | overwrites away kit immediately; untick writes nothing |
| Public contacts add/edit | `club-contacts-section.tsx`, `saveClubContact` | `club_contacts` | **direct** insert/update | `club_contacts` | RLS `club_contacts_write_admin` / `_update_admin` = `club.profile.edit` | A2 | trigger | name required; no email/phone format check | `revalidatePath` + `window.location.reload()` |
| Public contact remove | `deleteClubContact` | — | **direct** delete | `club_contacts` | RLS `club_contacts_delete_admin` | A2 | trigger | **no confirmation**, not club-scoped in the call | — |
| Messaging attachment policy (5 tri-state rows) | `club-messaging-section.tsx`, `updateClubMessagingPolicy` | RPC `get_effective_message_policy(club)` and `(null)` | RPC **`update_club_message_policy`** | `message_policies` | RPC: **`messaging.policy.manage`** (UI gate is `club.profile.edit`) | A2 | trigger (no DELETE) | RPC re-checks each ceiling | `revalidatePath("/club")` |
| Communication toggles (7 switches, save on click) | `club-communications-panel.tsx`, `setClubCommunicationPolicy` | same RPC | RPC **`update_message_communication_policy`** | `message_policies` | RPC: **`club.settings.manage`** (UI gate `club.profile.edit`) | A2 | trigger | RPC refuses unknown keys, ceilings, platform-only keys | `revalidatePath("/messages","layout")` |

**Crest and theme — the one-source-of-truth proof (B12).** Both clients already
read the same columns: crest `clubs.logo_storage_path` → `club_directory`
fallback via `packages/contracts/src/club-logo.ts`; colours `club_kits`
(variant `primary`) via `loadClubKitTheme` → `resolveClubTheme` /
`clubAccentsOnDark` (`packages/contracts/src/club/*`). Mobile already **writes**
the crest through `replaceClubCrest` / `removeClubCrest`
(`apps/mobile/src/identity/images.ts`) — same bucket, same path convention,
same column, gated on `club.logo.manage`. Divergences to converge, not copy:
web accepts SVG (mobile does not); mobile deletes the superseded object (web
orphans it); mobile checks the affected row count after the relink (web reports
an RLS-refused relink as success).

Web-only logic to extract (area 2.1): `resolve-nav-capabilities.ts` map;
`COMMUNICATION_ROWS` + `GROUPS` + the `effectiveOf`/`locked` precedence;
messaging `CAPABILITIES` + tri-state mapping; `uploadClubLogo` pipeline
(shared with mobile's copy); profile/contact null-coercion and role labels;
`DEFAULT_KIT`, swatches and away-kit defaults. Direct table writes: `clubs`
(profile, logo path), `club_contacts` (insert/update/delete), storage objects.
Classification: **A** (native required) for profile, crest, kit, contacts,
messaging and communication settings.

Findings recorded for the owner: four different keys gate one screen
(`club.profile.edit` UI; `club.logo.manage` storage; `messaging.policy.manage`;
`club.settings.manage`) — a per-person deny on any of the last three yields a
live control whose write is refused; no confirmation on crest/contact removal;
the web's direct writes cannot tell an RLS refusal from success.

> Correction to §1.2 from the live database: `internal.session_aal_ok()` is **not**
> a stub. An aal1 session passes only while the person's enforcement group is not
> yet enforced (`mfa_enforcement_policy`, `account_security_state` overrides
> `FORCE_NOW` / `EXEMPT_UNTIL_DATE`); once a group is enforced, every engine-backed
> read and write demands AAL2. `internal.impersonation_mode()` **is** still a null
> stub (Slice 9), so `impersonation_blocked` is declared, not enforced.

### 2.2 Safeguarding Officer configuration (`/club/settings/safeguarding`) — RED

Two records, deliberately distinct (the mobile client must keep them distinct):

- `club_safeguarding_officers` — the **contact register** a club publishes
  (name, email, primary/deputy, status `not_invited → invite_sent → active →
  inactive`). Grants nothing.
- `role_assignments` with `role_key = 'SAFEGUARDING_OFFICER'` — the
  **appointment** state machine (`PENDING_CONFIRMATION` → Site Admin
  `confirm_safeguarding_officer` → `CONFIRMED` → `deactivate` → `REVOKED`).
  `internal.active_safeguarding_officer_ids(club_id)` is the one answer to
  "who is an officer"; every read of officer authority uses it.

| Function | Web location | Read | Write (RPC) | Tables | Capability enforced (RPC / policy) | Audit | Validation / side effects |
|---|---|---|---|---|---|---|---|
| See register + appointments | `safeguarding/page.tsx`, `lib/safeguarding/club-appointments.ts` | `get_club_safeguarding_officers(club)`; direct `role_assignments` select + `get_club_member_directory` | — | `club_safeguarding_officers`, `_invitations`, `role_assignments`, `club_memberships` | page gate `safeguarding.officer.nominate`; RPC also admits `site.support.view_club` or the officer's own row | — | pending vs confirmed partition, "Nominate" offered or not, lives in the page |
| Nominate a contact | `nominate-form.tsx` → `nominateSafeguardingOfficer` | — | `nominate_safeguarding_officer(club, type, name, email)` | `club_safeguarding_officers` | `safeguarding.officer.nominate` | row trigger only | primary/deputy, non-empty, one active per type (23505) |
| Edit contact | `officer-row.tsx` → `updateSafeguardingOfficerContact` | — | `update_safeguarding_officer_contact` | same | `safeguarding.officer.contact_edit`@self **or** `safeguarding.officer.nominate`@club | trigger | email lowercased |
| Invite / resend | `inviteSafeguardingOfficer`, `resend…` | officer row under caller's RLS; club name and sender resolved server-side | `invite_safeguarding_officer` / `resend_…` → `issue_invitation('SAFEGUARDING_OFFICER')` | `club_safeguarding_officers`, `access_invitations` | `safeguarding.officer.nominate` | trigger; token masked as HASH in audit | `sendEmailEvent(safeguarding_officer_invitation)`; **returns the raw invite link to the browser** |
| Revoke invitation | `RevokeInviteButton` | — | `revoke_safeguarding_officer_invitation` | invitations + officer back to `not_invited` | `safeguarding.officer.nominate` (rewritten in `20270372`) | trigger | no confirmation |
| Remove assignment (deactivate) | `officer-row.tsx` → `deactivateSafeguardingOfficer` | — | `deactivate_safeguarding_officer(officer)` | officers, invitations, `capability_overrides`, `role_assignments` (`end_role`), conversations, `notifications`, `security_events` | **`safeguarding.officer.deactivate`** | `safeguarding.threads_unattended` (CRITICAL) only when threads orphan; row triggers | `window.confirm`, **no reason field**; revokes pending invites and 8 dispensation/transfer overrides; transfers open threads to a remaining officer or notifies `site.safeguarding.review` holders |
| Message / email officer | `messageSafeguardingOfficer` | — | `start_or_get_safeguarding_officer_conversation` | `club_safeguarding_officer_conversations`, `fixture_messages` | `safeguarding.conversation.start` | trigger on conversations | only error `22023` (no active registered officer) falls back to email; any other error is a refusal (anti-open-relay) |
| Read / reply to a thread the admin raised | `messages/[conversationId]/page.tsx`, `reply-form.tsx` → `send_safeguarding_officer_message` | direct `fixture_messages` select under RLS | `send_safeguarding_officer_message` | `fixture_messages` | RLS `can_view_safeguarding_conversation` / `can_send_safeguarding_conversation` (requester with `conversation.start`, or active officer with `conversation.handle`) | none | body non-empty |

**Boundary (B10) — what a Club Admin can never read, and a mobile Admin Centre
must never widen:** `welfare_member_view` (guardian contact, consent state;
`safeguarding.welfare.view`, SO bundle only, reason mandatory, event
`safeguarding.welfare_viewed`); thread bodies of threads they did not raise;
`safeguarding_thread_reviews` (a review may be about the Club Admin — excluded
by policy); dispensation rows through the safeguarding branch (a Club Admin sees
them only through fixture authority); the confirmation queue and
`confirm_safeguarding_officer` (site). There is no case-management data model
(tests assert none exists). No `authenticated` INSERT/UPDATE/DELETE policy
exists on any `club_safeguarding_*` table — all writes are SECURITY DEFINER RPCs.

Classification: **A** for register, nomination, invite/resend/revoke, contact
edit, deactivate (with confirmation + reason), message officer, own-thread
reply. **C/never** for everything in the boundary above.

Findings for the owner: the canonical 4G nomination RPC
(`nominate_club_safeguarding_officer`) has no UI caller — the product enters the
state machine only through invitation acceptance; deactivation records no audit
event unless threads orphan; `R` is declared for nominate/deactivate/welfare
and enforced nowhere; the invite link is returned to the inviting client.

### 2.3 Subscriptions & Payments · GoCardless · Finance — RED

**(a) Club configuration a Club Admin edits** (`/club/settings/subscriptions`)

| Function | Read | Write (RPC) | Tables | Capability | Audit | Validation |
|---|---|---|---|---|---|---|
| Programme (enabled, collection day, first-payment policy, platform fee mode) | direct `club_subscription_programmes` / `_pricing`; `get_gocardless_connection_status` | `configure_subscription_programme` | programmes, `finance_audit_log` | `finance.subscription.configure` (RPC key `club.subscription.configure` mapped) | `programme_configured`, `first_payment_policy_changed` | day 1–28; enumerations |
| Price change (append-only, effective-dated) | `current_subscription_price` | `set_subscription_price` | `club_subscription_pricing`, audit | configure | `price_changed` | amount > 0, effective ≥ today; existing subscribers untouched |
| Sibling discount rule (2nd–6th) | `get_sibling_discount_rules` | `configure_sibling_discount_rule` | `club_subscription_sibling_rules`, audit | configure | `sibling_discount_rule_changed` | ordinal ≥ 2; pct 0–100 |
| First-payment worked example | `preview_first_payment_illustrative` | — | — | **none** (granted to `authenticated`, no capability check — a price oracle) | — | — |
| Connect GoCardless | — | `<a href="/api/gocardless/oauth/start?clubId">` → provider OAuth → `/api/gocardless/oauth/callback` → `store_gocardless_connection` | `gocardless_merchant_connections` | `finance.gocardless.connect` (route) ; RPC checks capability | trigger | `state` cookie CSRF, `requireSession` on both routes |
| Disconnect (reason required) | `get_active_subscription_impact` (not rendered) | `disconnect_gocardless(club, reason)` | `gocardless_merchant_connections.disconnected_at/by` | `finance.gocardless.connect` | **none** (no finance audit row, no security event) | soft; live provider subscriptions keep collecting — copy warns, code does not prevent |

**(b) Family payment state a Club Admin reads** (`/club/finance`): direct
selects on `membership_obligations`, `gocardless_payments`,
`gocardless_subscriptions`, `player_subscription_payers` under
`finance.subscription.view` RLS; `get_finance_action_required`,
`get_membership_operational_detail`, `export_finance_rows`
(`finance.subscription.export`, audited `finance_export_generated`). Actions:
generate obligations (`create_membership_obligations_for_period`,
`finance.enrolment.manage`), waive/exempt (`set_obligation_exemption`, reason,
audited), retry failed payment (provider call, `finance.payment.act`, constant
idempotency key, no audit until the webhook), refund (`record_payment_refund`
then provider — **no UI caller**), cancel membership (provider → reconcile →
`end_membership_subscription` → notify; `finance.payment.act`; reason; audited).

**(c) Provider-hosted:** merchant OAuth at `connect{-sandbox}.gocardless.com`
with server-side code exchange; payer mandates through Billing Request Flow.
Bank details never enter Ovalball. **(d) Secrets (names only):**
`GOCARDLESS_CLIENT_ID/SECRET`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENV`,
`GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED`, `GOCARDLESS_PLATFORM_ACCESS_TOKEN`,
`GOCARDLESS_PLATFORM_WEBHOOK_SECRET`, `OVALBALL_SAAS_BILLING_ENABLED`,
`SUPABASE_SERVICE_ROLE_KEY`; per-club `gocardless_merchant_connections.access_token`
is a column with no `authenticated` policy, reachable only through
service-role-only token RPCs. **(e) Webhooks:** two HMAC-verified,
inbox-first, service-role endpoints (`/api/gocardless/webhooks`,
`/api/platform-billing/webhooks`) with separate secrets and tables.

Classification: **A** — programme, price, sibling rules, connection status,
disconnect (with confirmation + reason), finance dashboard reads, waive/exempt,
cancel membership, export. **B (secure hand-off)** — Connect GoCardless: the
app opens the existing `/api/gocardless/oauth/start` route in the system
browser; the callback lands on the website; the app re-reads
`get_gocardless_connection_status` on focus. Never a native bank form, never an
in-app code exchange. **Never** — merchant token, secrets, webhook endpoints,
raw provider payloads, `gc_*` provider ids in family-facing payloads.

Web-only logic to extract (2.3): `lib/payments/domain/*` (dashboard metrics,
OVERDUE derivation with its 5-day window, proration duplicate of the SQL, the
9-state readiness machine, minor-unit money), status vocabularies in
`finance/[payerSubscriptionId]/page.tsx` and `relationship-review-panel.tsx`,
month arithmetic. Server-only and must stay so: `activateMembership`,
`cancelMembership`, `reconcile*`, `env.ts` kill gates, webhook verification.

### 2.4 Club Settings hub · Guardians & Players · News & Announcements · Ovalball Plan · Pitch Allocation

**Hub** (`/club/settings`): pure navigation over eleven cards, gated per card by
`resolveClubSettingsNavCapabilities` (§1.5); redirects to `/dashboard` when
every card is false. Finding: the hub page passes an explicit prop list to the
tab strip that omits `canPermissions` and `canSafeguarding`, so those two tabs
are missing on the hub itself (cards are present).

**Guardians & Players** (`/club/settings/guardians`, page gate
`family.relationship.approve`) — RED (family relationships, child records).

| Function | Read | Write (RPC) | Tables | Capability enforced by the RPC | Audit | Confirmation / validation |
|---|---|---|---|---|---|---|
| Directory of players, guardians, pending joins, duplicate reviews | `teams`, `team_aliases`, `player_team_memberships`, `get_team_guardian_directory` (per team, N+1), `player_duplicate_reviews`, `guardians`, `profiles`, `player_staff_view` | — | — | RPC re-checks `family.relationship.approve` or `site.family.manage` | — | "GUARDIAN REQUIRED" = age state minor / unknown-youth-protected (web-only rule) |
| Remove a guardian | — | `remove_guardian_relationship(guardian, reason)` | `guardians` → `REVOKED` | **`family.relationship.remove`** at a club where the child holds an active place | trigger | dialog + **mandatory reason**; irreversible (trigger refuses re-activation); returns `orphaned` |
| Replacement guardian invitation | `teams.club_id` | `send_replacement_guardian_invitation(player, team, email)` | `guardian_invitations` | `family.relationship.approve` (action + RPC) | trigger | email event `guardian_invitation`; **renders the raw token link in the UI** |
| Duplicate review → link existing / create new | — | `resolve_player_duplicate_review_as_existing` / `_as_new` | `guardians`, `player_team_memberships`, `players` (DOB), `player_duplicate_reviews` | **`family.duplicate.resolve`** + separation of duties (resolver ≠ requester ≠ submitter) | trigger | **no confirmation, no reason**; terminal, no undo |
| Approve / decline a pending Add-a-Child membership | — | `approve_pending_team_membership` / `reject_pending_team_membership(id, reason)` | `player_team_memberships`, `notifications` | **`team.roster.manage`@team or `club.roster.manage`@club** | membership yes; `notifications` no | decline: **no confirmation, reason hard-coded "Declined by club"**; `DECLINED` is terminal |

Capability drift recorded: the page is gated on one key while its four actions
enforce three others — a holder of `approve` alone sees controls that fail.

**News & Announcements** (`/club/settings/news`; `club.news.manage` at club,
`team.news.manage` at team; DB mirror `internal.may_edit_club_content` /
`may_publish_club_content`). Articles and announcements are saved through
`save_club_article` / `save_club_announcement`, status through
`set_club_article_status` / `set_club_announcement_status` (DRAFT · PUBLISHED ·
ARCHIVED, never deleted), lead story through `set_club_article_featured` (club
authority only). Hero images: bucket `club-news-media`
(`<clubId>/<teamId|club>/<uuid>.<ext>`, 5 MiB, png/jpeg/webp, extension from
verified MIME), storage policy `may_manage_club_news_media`; superseded objects
removed; orphan check before discard. Constraints live in the database
(lengths, `link_safe`, window, scope trigger). `lib/club-content/actions.ts`
deliberately holds no permission check of its own. Archive has a two-step
inline confirmation and a Restore. Classification: **A** (native editor with the
same RPCs; markup helpers already shared in `@ovalball/contracts/club/markup`).

**Ovalball Plan** (`/club/settings/ovalball-billing`; view
`finance.platform_billing.view`, manage `finance.platform_billing.manage`,
referrals `club.referrals.view`). Reads: `club_platform_billing_state`,
`club_platform_next_collection`, direct `platform_payments` / `platform_credits`
(append-only ledger), `platform_plans` + entitlements, `club_referral_summary`.
Writes: `start_club_trial` (idempotent; paused in Beta), `select_club_plan`
(**no confirmation**, snapshots price, event-logged), `cancel_club_platform_subscription`
(**no UI caller**), `claim_club_referral` (**no UI caller**; enforces a fourth
key `club.referrals.manage`). Mandate setup (`startPlatformMandateSetup`) has no
caller — the `pending_setup` state has no door. Separate merchant, secrets,
webhook and tables from the club's own GoCardless (Domain B). Classification:
**A** for reading state, history, credit and referrals and for trial/plan
choice with a confirmation added; **B** for mandate setup (provider-hosted,
website route) once the web has a control; nothing provider-side native.

**Pitch Allocation** (`/club/settings/pitch-allocation`; `fixture.edit` at
club + active context must be this club). The one **direct upsert** in the area:
`club_scheduling_policy` (`auto_allocate_home_fixtures`, `warm_up_minutes`,
`pack_up_minutes`, client-supplied `updated_at`) — **no audit trigger**, no
history, last-write-wins, and no way to return a buffer to "inherit platform
default" (NULL) from the form; policy is world-readable to any authenticated
session (`using (true)`). Read of provenance through
`resolve_club_scheduling_buffers`. Classification: **A**, with the write moved
behind a domain operation (§13).

Web-only logic to extract (2.4): the nav resolver and tab strip; the
"needs guardian" age-state rule; the nine platform billing states' copy and the
Beta-first "next collection" rule; plan comparison (`addsNothingYet`),
`formatPlanPrice`, trial day maths, referral prose; `CONSTRAINT_MESSAGES`
error mapping and the image upload contract for news; announcement local-time
conversion; buffer validation duplicated against the DB CHECKs.

### 2.5 People & Access (`/people`, `/people/[membershipId]`, `/club/permissions`, `/club/join-requests`, `/teams/[teamId]/people`, join codes) — RED

**Every mutation in this area goes through a SECURITY DEFINER RPC — zero direct
table writes** (grep-verified). Reads are RLS/view-scoped
(`invitations_admin_view` structurally omits token and code hashes).

**Two questions, two surfaces, one engine.** `/people` decides who is in the
room and what job they hold (writes `club_memberships`, `role_assignments`,
`access_invitations`, `club_join_requests`; vocabulary = roles and seats).
`/club/permissions` edits the exception layer on top (writes
`capability_overrides` only; vocabulary = product wording in `groups.ts`, never
raw keys; scope club or one team via `?team=`; fully reversible with Reset).
`/people/[membershipId]` bridges them (seat, other roles, team access, twelve
`explain_access` decisions, `club_access_history` timeline).

| Function | Write (RPC) | Authority actually enforced | Reason | Events / audit | Web confirmation |
|---|---|---|---|---|---|
| Invite (CLUB_STAFF) | `issue_invitation('CLUB_STAFF', club, email, intended_outcome, team_roles)` | `people.invitation.create`@club; roles ⊆ ceiling {CLUB_ADMIN, FIXTURES_SECRETARY, VOLUNTEER, COACH, TEAM_MANAGER}; every team must be an active team of this club | no | `invitation.issued` security event; email `club_invitation` | token/code/QR shown once |
| Resend | `resend_invitation` | `can_administer_invitation` | no | `invitation.resent`; email | **none**, rotates both secrets |
| Revoke invitation | `revoke_invitation(id, reason)` | same | **required by DB**; web hard-codes "Withdrawn by the club." | `invitation.revoked` | inline two-step |
| Club-wide role (Member / Fixture Secretary / Club Admin) | `set_primary_club_role` | `club_people_authority` = CLUB_ADMIN role **and** `people.role.assign_club` | SITE only | `audit_row_change` + role events; club must keep an admin | **none** (plain select) |
| Give / remove an additional role | `assign_role` / `transition_role_assignment` | authority ∩ `role_definitions.assignable_by`; SAFEGUARDING_OFFICER refused | SITE only; web hard-codes "Removed from Users & Permissions" | `role.granted` / `role.revoked` | **none** on remove |
| Team access (Coach / Manager / Team Admin) give / remove | `set_team_access` / `remove_team_access` | `team_people_level` (CLUB_ADMIN + `people.role.assign_team`, or TEAM_ADMIN limited to coach/manager) | SITE only | `team_access.granted/revoked` | **none** on remove |
| Remove from club | `transition_club_membership(id,'REVOKED',reason)` | `people.membership.revoke` via `club_people_authority`; last Club Admin refused | **required** (client + DB) | `membership.revoked`; ends all roles | dialog, reason mandatory; irreversible |
| Suspend / restore membership | `transition_club_membership('SUSPENDED'|'ACTIVE')` | `people.membership.suspend` | required | events | **no web control** (site only) |
| Club join request approve / decline | `decide_club_join_request(id, decision, reason)` | `people.join_request.review` | **required on DECLINE** | `membership.approved/declined`; notifications | reason field, disabled until typed |
| Player join request accept / decline | `approve_player_club_join_request(id, team)` / `decline_player_club_join_request(id, reason)` | `team.join_request.review`@club or @team; nobody approves their own child | optional (shown to the player) | explicit `audit_log`; notifications; decline emits **no** security event | inline; page has **no server-side gate** (RLS only) |
| Team join request approve / decline | `approve_pending_team_membership` / `reject_pending_team_membership` | `team.roster.manage`@team or `club.roster.manage`@club | web hard-codes "Declined from Team People." | notifications | **none** |
| Archive / restore a player's place | `archive_player_team_membership` / `restore_…` | roster authority | no | trigger | none; reversible |
| Allow / Withhold / Reset a capability | `set_capability_override(user, key, scope, club, team, effect, reason, expires)` / `revoke_capability_override` | `people.capability.manage` **and** the actor holds the key itself from a bundle (`override_authority_level`); self refused; subject must be an ACTIVE member; Volunteer prohibition for finance/people; P36 (a lower level never overwrites a higher) and P37 (a grant a senior deny would defeat is refused) | DB **requires a reason for every non-site deny**; web sends a canned string | `audit_row_change` on `capability_overrides` + `override.granted/revoked` | **none** — the most senior effect in the ladder is a toggle |
| Give them a job (preset) | `apply_capability_preset(user, preset, club)` | delegates to `set_capability_override`, all-or-nothing | no | per-key + `override.preset_applied` | none |
| Issue / revoke team join code | `issue_invitation('TEAM_JOIN_CODE', team)` / `revoke_invitation` | `team.join_code.manage`@team | web hard-codes "withdrawn by the club" | `invitation.issued/revoked` | none |

Read RPCs the app will reuse verbatim: `my_capabilities`,
`club_member_capabilities(club, keys)`, `club_team_capabilities(club, team,
keys)` (both return `editable` decided by the DB), `club_capability_presets`,
`explain_access`, `club_access_history(club, subject, limit ≤ 500)`,
`list_pending_club_join_requests`, `invitation_staff_role_options`,
`team_people`, `get_club_member_directory`.

Findings recorded: two authority idioms coexist (membership/role RPCs demand
the CLUB_ADMIN role **plus** the capability; the permissions RPCs demand the
capability from a bundle) — `/people` and the person page are gated on the
role, not on `people.member.view`; `get_club_member_directory` is still gated
on legacy `is_club_admin`/`is_site_admin`; reasons are captured by the UI in
only three of fourteen sensitive actions and hard-coded in seven; Withhold has
no confirmation; `decline_player_club_join_request` emits no security event;
`/club/join-requests` has no page gate; `access_invitations` is audited through
`security_events` rather than `audit_row_change`; a Club Admin may give
themselves a team role by design.

Already shared for this area: `role-labels`, `session-context`,
`active-context-rules`, `governing-roles`. Web-only and needed by a native
client: `club/permissions/groups.ts` (the product vocabulary of delegable
keys), `lib/permissions/access-explanation.ts` (26 reason sentences),
`access-event-sentence.ts` (23 event sentences), `role-presentation.ts`,
`lib/invitations/share.ts` (join URL shape, QR, the only decoder of
`intended_outcome`), `redeem.ts` (a refusal is a **return**, not a throw —
security-critical), invitation status derivation, seat/assignable filters.
Classification: **A** for the directory, invitations, join requests, roles,
team access and the permissions panel (Team Administration included at team
scope); **C** for suspend/restore (site-only on the web too).

### 2.6 Teams · Venues & Pitches · Setup · Season Handover · Training plans · Documents · Partner clubs (and the operational surfaces that are NOT Admin Centre)

| Function | Write | Tables | Capability actually enforced | Audit | Confirmation / recovery |
|---|---|---|---|---|---|
| Create a team (closed catalogue) | **direct** `teams.insert` (+ RPC `set_team_alias`) | `teams`, `team_aliases` | RLS `teams_insert_admin` = `team.team.manage` + `canonical_team_type_id` not null; display name derived by trigger | `teams` yes; `team_aliases` **no** | availability rule (`computeTeamAvailability`) is TypeScript-only |
| Team alias (B/C squads only) | `set_team_alias` / `clear_team_alias` | `team_aliases` | `club.teams.manage`@club | none | — |
| Fold / reactivate team | `fold_team(team, reason)` / `reactivate_team` | `teams`, `fixtures` (+ opponent notifications) | **raw `internal.is_club_admin` or full site admin** inside the RPC, not `team.lifecycle.manage` | explicit `audit_log` + triggers | fold: dialog, reason required, reversible; reactivate: none |
| Restore a fold-cancelled fixture | `request_fixture_restoration` | `fixtures`, `fixture_requests` | inside RPC | triggers | conflict-checked; activated opponent gets a request |
| Mini-Rugby scheduling groups | `create_scheduling_group`, `set_…_alias`, `set_…_active`, `delete_scheduling_group` | `scheduling_groups`, `_members` | `team.mini_rugby_group.manage` | groups yes; members no | delete refused once a fixture references the group; inline two-step |
| Venues (create, update, address, default, deactivate) | `create_venue`, `update_venue`, `set_venue_address`, `set_default_venue`, `set_venue_active` (+ server-side geocode writes coordinates directly) | `venues` | `venue.venue.manage` (`internal.can_manage_venue`) | trigger | deactivate has **no confirmation**; reversible; no hard delete exists; name uniqueness checked in the RPC, not indexed |
| Pitches (create, rename, reorder, deactivate, move venue) | `create_club_pitch`, `rename_club_pitch`, `reorder_club_pitches`, `set_club_pitch_active`, `set_club_pitch_venue` | `club_pitches` | `venue.pitch.manage` | trigger | deactivate no confirmation; reversible |
| Address lookup | server action → getAddress.io (server-only key) | — | signed-in | — | provider stays server-side |
| Setup wizard (advance, confirm teams, remove team, venue + pitches, complete) | `advance_club_setup`, `confirm_club_teams`, `remove_setup_team`, `create_venue`…, `complete_club_setup` | `club_setup_state`, `teams`, `venues`, `club_pitches` | `assert_club_setup_authority` (`club.edit_profile` legacy or site) | triggers | **remove team hard-deletes a pristine team with no confirmation**; venue+pitches not transactional |
| Season handover (prepare, decide, split, flags, placements, graduation queue, undo) | `generate_rollover_proposal`, `confirm_rollover_team_proposal`, `confirm_mixed_boundary_rollover`, `resolve_rollover_group_flag`, `undo_rollover_team_decision`, `set_rollover_player_placement`…, `place_graduating_player`, `mark_graduating_player_left`, `create_next_season_scheduling_group` | `age_grade_rollover_*`, `player_team_memberships` | `team.handover.prepare`; fold/graduate branches `team.lifecycle.manage`; placements `team.graduation.place` | explicit `audit_log` per decision (`handover_audit`) | every pre-apply decision reversible; server returns the placement verdict, the UI displays it |
| **Apply season handover** | `apply_season_handover(rollover, expected_revision)` | teams, identities, memberships, fixtures, transitions | **raw `is_club_admin` / full site admin**, not `team.handover.apply`; UI gate wrongly `team.handover.prepare` | explicit per consequence | modal with server-computed consequences and blocker count; **optimistic concurrency done right** (`decisions_revision`, row lock, idempotent); not undoable |
| Training plans (save, deactivate, reactivate, preview) | `save_training_plan`, `deactivate_training_plan(plan, reason)`, `reactivate_training_plan`, `preview_training_plan_occurrences` | `training_plans`, `_schedule_rules`, `training_sessions` | `training.plan.manage`@club (action re-derives the club and asserts it matches) | triggers | editing cancels every future non-overridden session and regenerates; deactivate is a **toggle with a hard-coded reason** and notifies families |
| Document library (upload, folder, move, archive; delete has no UI) | **direct** storage upload + `club_documents.insert`; **direct** `document_folders.insert`; **direct** `club_documents.update` (move, archive); RPC `delete_club_document` (dead) | `club_documents`, `document_folders`, bucket `club-documents` (`<clubId>/<uuid>.<ext>`, 10 MB, pdf/jpeg/png/webp) | RLS `club.documents.manage`; page gate is a membership comparison | triggers; storage unaudited | archive has **no confirmation and no un-archive control**; move cannot verify the target folder's club; no folder-cycle check; delete orphans the object |
| Partner clubs (request, respond, revoke, invite a club to Ovalball) | **direct** `club_partnerships.insert`; `respond_to_club_partnership`; `revoke_club_partnership`; `create_partner_invitation` (+ email, referral claim in the same transaction) | `club_partnerships`, `club_ovalball_invitations`, `platform_referrals` | `club.partners.manage` | trigger | revoke has **no confirmation**; soft |

**Not Admin Centre (B9 — day-to-day operations, already or later native elsewhere):**
club events (`calendar.event.manage`; a dated occurrence with attendance and a
pitch reservation), the deleted-events bin and fixture restore
(`fixture.fixture.archive`), call-ups and dispensations (`fixture.callup.*`,
`fixture.dispensation.*`; per-fixture and per-season approvals — the page even
renders the settings tab strip today), tournaments (running one), the training
exceptions/conflicts panel and per-session cancellation, team roster / join
requests / join codes / subscriptions on a team, partner availability lookup.
The venues, pitches and teams these read are configuration; the occurrences
are not.

**Concurrency (B16), measured:** Apply Season Handover uses optimistic
concurrency correctly (`decisions_revision` + `for update` + idempotence);
fold and complete-setup lock the row; everything else is **last-write-wins**
with no `updated_at` comparison (venues, pitches, training plans — where a
concurrent edit can cancel and regenerate sessions under new ids — events,
documents, partnerships, tournaments, scheduling policy). A native client must
therefore re-read canonical values on focus and after every mutation, and never
hold a stale form as truth.

Web-only logic to extract (2.6): `lib/teams/catalog.ts` (catalogue assembly,
`computeTeamAvailability`, B/C-squad availability rule), `directory-taxonomy.ts`
(PRESENTATION_ONLY Juniors/Youth split), `lib/mini-rugby/group-label.ts`,
`lib/club-setup/state.ts` (resume/allowed paths), `lib/seasons/validation.ts`,
directions URL construction, the training-conflict engine
(`lib/pitch-allocation/training-conflicts.ts`, 30-day window, 80-minute fixture
assumption), document MIME/extension map and categories, and every
error-message allow-list (`toPublicTrainingError`, events, tournaments, setup).
Server-only and staying so: geocoding (`postcodes.io`) and address lookup
(getAddress.io).

Boundary defects the codebase already contains (recorded, not fixed):
`canTeams = club.profile.edit ∨ venue.pitch.manage` gates `/teams` (should be
`team.team.manage`); `canApply` on the handover page is `team.handover.prepare`
where the RPC demands Club Admin; the team page's `canManage` and the document
page's `canManage` are membership comparisons, not capabilities; `fold_team`
and `apply_season_handover` authorise through raw role helpers so a capability
override on `team.lifecycle.manage` / `team.handover.apply` has no effect.

---

## Part 3 — What this means for a native Admin Centre

### 3.1 Complete web route map (B25 §1)

Club administration on the web is these routes and nothing else:
`/club/settings` (hub) · `/club` (profile, crest, kit, contacts, messaging
policy, communication toggles) · `/club/venues` · `/teams`, `/teams/[teamId]`
(identity, alias, lifecycle) · `/teams` Mini-Rugby groups · `/club/setup` ·
`/club/rollover` · `/club/training` (plans) · `/club/settings/pitch-allocation`
· `/club/settings/news` (+ `/new`, `/[articleId]`, announcements) ·
`/club/settings/guardians` · `/club/settings/safeguarding` (+ `/messages/[id]`)
· `/club/settings/subscriptions` · `/club/finance` (+ `/[payerSubscriptionId]`)
· `/club/settings/ovalball-billing` · `/people`, `/people/[membershipId]` ·
`/club/permissions` (+ `?team=`) · `/club/join-requests` · `/documents` ·
`/partner-clubs` · plus the GoCardless OAuth routes under `/api/gocardless/oauth`.
Operational routes that share the club's navigation but are not administration
are listed in 2.6.

### 3.2 Proposed native IA (B18) — derived from the map, not the hypothesis

```
More → Admin Centre                     (club context + ≥1 allowed section key)

CLUB
  Club Profile        club.profile.edit         bio, website, Facebook, home-ground line, public contacts
  Crest & Kit         club.logo.manage / club.profile.edit   crest (already native), home & away kit
  Venues & Pitches    venue.venue.manage / venue.pitch.manage
  Teams               team.team.manage          directory, add from catalogue, alias, fold / reactivate
                      (fold: team.lifecycle.manage; RPC today: Club Admin role)
  Mini-Rugby Groups   team.mini_rugby_group.manage
  Season Handover     team.handover.prepare / team.handover.apply

PEOPLE & ACCESS
  People              CLUB_ADMIN role (web gate) → people.member.view / people.role.* / people.membership.revoke
  Invitations         people.invitation.create / people.invitation.revoke
  Join Requests       people.join_request.review (club) · team.join_request.review (players)
  Permissions         people.capability.manage (club scope and per-team scope)
  Guardians & Players family.relationship.approve (+ remove / duplicate.resolve / roster.manage per action)

OPERATIONS CONFIGURATION
  Training Plans      training.plan.manage
  Pitch Allocation    fixture.edit (club)
  Document Library    club.documents.view / club.documents.manage
  Partner Clubs       club.partners.manage
  News & Announcements  club.news.manage

COMMUNICATION
  Messaging Settings  messaging.policy.manage (attachments) · club.settings.manage (toggles)

FINANCE
  Subscriptions & Payments   finance.subscription.configure / finance.subscription.view
  Finance Dashboard          finance.subscription.view (+ enrolment.manage / payment.act / export)
  Ovalball Plan              finance.platform_billing.view / .manage · club.referrals.view

SECURITY & GOVERNANCE
  Safeguarding Officer  safeguarding.officer.nominate / .deactivate / conversation.start
  Access History        people.access.explain (club_access_history)
```

Every row is a **section** whose visibility is one capability answer from
`my_capabilities('club', clubId)`; every control inside answers its own key;
every sensitive action re-asks the server (the RPC does). No section exists
that the web does not have. The setup wizard is not a section: it is a
first-run presentation over Club Profile, Kit, Venues and Teams and stays on
the web until those four are native (then it can be native too).

### 3.3 Security classification of the sections (B23)

| GREEN (read / presentation) | AMBER (ordinary club mutation) | RED |
|---|---|---|
| Admin Centre landing; every section's read state; Finance dashboard reads; Access History; Ovalball Plan state, history, credit, referrals | Club Profile fields; kit; contacts; venues and pitches; team alias; Mini-Rugby groups; training plans; pitch allocation policy; news and announcements; documents; partner requests/responses; messaging and communication settings; season handover **decisions** (pre-apply) | Invitations (issue, resend, revoke); roles and team access; remove from club; permissions overrides and presets; join-request decisions; guardians & players (remove, duplicate resolution, approve/decline); safeguarding officer nomination, deactivation, contact, conversations; subscriptions configuration; GoCardless connect/disconnect; finance actions (waive, retry, cancel membership, export); plan choice / trial / cancel; **fold / reactivate team**; **apply season handover**; hard team delete in setup; crest removal |

### 3.4 Slice plan (B25 §15) — after CA-M0, nothing before owner approval

| Slice | Scope | Class | Prerequisite |
|---|---|---|---|
| CA-M1 | Admin Centre entry (More → Admin Centre; club context + capability), landing with sections from one `my_capabilities` call, focus/foreground re-read, offline read-only banner, fail-closed refresh on 42501 | GREEN | shared `admin-centre/ia.ts` (§3.7) |
| CA-M2 | Club Profile, Contacts, Crest (converge web/mobile pipelines), Kit (`upsert_club_kit`) | AMBER | §3.7 extraction of profile/contact/kit rules |
| CA-M3 | Venues & Pitches (all RPCs), Team directory + add from catalogue + alias, Mini-Rugby groups | AMBER | `lib/teams/catalog.ts` → contracts; team create behind a domain operation (§3.8 D1) |
| CA-M4 | Messaging settings + communication toggles; Pitch Allocation policy; Training plans; Document library; Partner clubs | AMBER | scheduling policy, documents, partnership writes behind RPCs (§3.8) |
| CA-M5 | News & Announcements (native editor, same RPCs, shared markup) | AMBER | error mapping → contracts |
| CA-M6 | People directory, Invitations (share sheet, QR), Join Requests, Roles, Team access, Remove from club, Access History | RED | reason capture for every reason-taking RPC; `R` decision (§3.9) |
| CA-M7 | Permissions panel (club + team scope, presets, explain access) | RED | `groups.ts`, explanation sentences → contracts |
| CA-M8 | Guardians & Players | RED | confirmations + reasons the web lacks |
| CA-M9 | Safeguarding Officer section (register, nominate, invite, deactivate, message) | RED | boundary tests proving no widening |
| CA-M10 | Subscriptions & Payments (configure, price, sibling rules, connection status, disconnect), Finance dashboard and actions, Ovalball Plan | RED | GoCardless hand-off via system browser to the existing routes; finance domain logic → contracts |
| CA-M11 | Team lifecycle (fold / reactivate / restore fixtures) and Season Handover (decisions, placements, apply) | RED | RPC authority moved from role helpers to capabilities is an owner decision (§3.9) |

### 3.5 Cross-client acceptance matrix (B22)

| # | Test | Mechanism that makes it true |
|---|---|---|
| 1 | Change club bio on mobile → refresh web → new value | both read `clubs` (web `/club`, public page) |
| 2 | Change it on web → refocus mobile → new value | mobile re-reads on focus (no local copy) |
| 3 | Change kit colours on mobile → web public page theme and mobile Home accent both change | one `club_kits` row, one `resolveClubTheme` |
| 4 | Create a venue on one client → other client lists it | `create_venue`, `venues` read |
| 5 | Withhold a capability on web → mobile Admin Centre hides/disables that control on next `my_capabilities` | engine rules 2–4 |
| 6 | Revoke `people.capability.manage` on web while mobile has Permissions open → next mutation fails 42501, UI updates after refresh | RPC re-asks `override_authority_level`; mobile maps 42501 to a refusal and re-reads |
| 7 | Audit history shows a mobile mutation and a web mutation in the same `audit_log` / `security_events` timeline with the same actor | triggers keyed on `auth.uid()`; `club_access_history` |
| 8 | Nominate a safeguarding officer on mobile → web register shows them pending | `nominate_safeguarding_officer` |
| 9 | Change the subscription price on mobile → web subscriptions page shows the scheduled price and the `finance_audit_log` row | `set_subscription_price` |
| 10 | Decide a handover proposal on mobile, apply on web with the mobile revision → applied; apply with a stale revision → refused | `decisions_revision` |

### 3.6 RED-risk map (B25 §17)

- **Assurance.** `R` is declared for 73 keys and enforced for 3 site RPCs.
  Mobile can match the web (AAL2 session, enforced per enforcement group; all
  groups currently at T0/unenforced). Exceeding it means DB enforcement.
- **Impersonation blocking** is declared, `impersonation_mode()` is a stub.
- **Two authority idioms:** membership/role RPCs and `fold_team` /
  `apply_season_handover` require the Club Admin **role**; the rest require
  capabilities. A capability-first Admin Centre must display those sections
  from `my_capabilities` but expect role-based refusal on the RPC.
- **Reasons:** eleven RPCs require a reason; the web hard-codes seven of them.
  Native forms must collect a real reason or the audit trail stays hollow.
- **Confirmations missing on the web** for crest removal, contact removal,
  venue/pitch deactivation, partnership revoke, capability withhold, duplicate
  resolution, decline of team joins, training-plan deactivation, tournament
  removals, setup hard-delete. Mobile must add them (B20: match or exceed).
- **Safeguarding:** the Club Admin boundary is exact (2.2); any native screen
  must consume only the RPCs listed there.
- **Payments:** merchant token, secrets, webhooks, OAuth code exchange never
  leave the server; `preview_first_payment_illustrative` is an ungated price
  oracle; disconnect writes no audit row.
- **Direct writes** the web still makes (3.8) have no column allow-list and
  cannot distinguish an RLS refusal from success.

### 3.7 Web-only logic to extract to `packages/contracts` (B25 §12)

`resolve-nav-capabilities` map + `club-settings-nav` tabs (→ one
`admin-centre/ia.ts` both clients render); `club/permissions/groups.ts`;
`access-explanation.ts`; `access-event-sentence.ts`; `role-presentation.ts`;
`lib/invitations/share.ts` (join URL, QR, `intended_outcome` decoder) and the
`redeem.ts` refusal contract; invitation status derivation; communication rows,
groups and the `effectiveOf`/`locked` precedence; messaging tri-state mapping;
crest upload pipeline (converge with mobile's `images.ts`); profile/contact
coercion rules and role labels; kit defaults and swatches; `lib/teams/catalog.ts`
and `directory-taxonomy.ts`; `mini-rugby/group-label.ts`; `club-setup/state.ts`;
`seasons/validation.ts`; training-conflict engine; `lib/payments/domain/*`
(metrics, OVERDUE, proration, readiness machine, money) and finance status
vocabularies; platform billing state copy, plan comparison, trial maths,
referral prose; `CONSTRAINT_MESSAGES` and every RPC error allow-list.
Server-only and staying so: geocoding, address lookup, GoCardless env gates,
webhook verification, `activateMembership` / `cancelMembership` / reconcile.

### 3.8 Direct-table access that should become a shared domain operation (B25 §13)

| Today | Proposed |
|---|---|
| `clubs.update` (profile, logo path) — web action and mobile `images.ts` | `update_club_profile(club, …)` / `set_club_logo(club, path)` with column allow-list and row-count semantics |
| `club_contacts` insert/update/delete | `save_club_contact` / `delete_club_contact` |
| `teams.insert` (three triggers + a policy must agree) | `create_team(club, canonical_team_type, squad, gender)` |
| `club_scheduling_policy.upsert` (unaudited, client clock) | `set_club_scheduling_policy(club, auto, warm_up, pack_up)` with NULL = inherit, plus an audit trigger |
| `club_documents` insert/update, `document_folders.insert` | `register_club_document`, `move_club_document` (verifies target folder's club), `archive_club_document`, `create_document_folder` (cycle check) |
| `club_partnerships.insert` | `request_club_partnership` (symmetry with respond/revoke) |
| `venues` coordinate writes from geocoding | inside `set_venue_address` |
| `notifications.insert` from `cancelMembership` (service role) | inside `end_membership_subscription` |

Each is a migration and therefore an owner decision; none is required for the
GREEN slice.

### 3.9 Genuine conflicts requiring an owner decision (B25 §18)

1. **Recent-authenticator (`R`) enforcement.** Keep parity with the web (AAL2
   session only) or enforce `R` in the database for the RED keys before the RED
   slices ship (migration + native TOTP step-up). Recommended: enforce in the
   database; both clients inherit it.
2. **Role-gated RPCs vs capability-first UI.** `fold_team`,
   `apply_season_handover`, `set_primary_club_role`, `assign_role`,
   `transition_club_membership`, `get_club_member_directory` require the Club
   Admin role (or legacy helpers) regardless of capability overrides. Either
   the Admin Centre gates those sections on the role (as the web's `/people`
   does) or the RPCs move to `team.lifecycle.manage` / `team.handover.apply` /
   `people.*` (migration).
3. **Direct-table writes** (3.8): keep RLS-only writes on mobile too (parity,
   with mobile's row-count check), or land the domain operations first.
4. **Reasons the web hard-codes.** Mobile will ask for them; should the web be
   corrected in the same slice so both clients record real reasons?
5. **Which-client audit metadata.** Not needed for B15; if wanted, a request
   scoped setting (`ovalball.request_id` is already read but never set) or a
   `client` column — a migration.
6. **Web defects found** (hub tab props, `canApply` gate, `canTeams` gate,
   guardians-page drift, three-keys-one-screen on `/club`, unaudited
   scheduling policy, no un-archive for documents, dead `cancelSubscription` /
   `deleteClubDocument` / `claimReferralForInvitation` endpoints, ungated
   `preview_first_payment_illustrative`, GoCardless disconnect unaudited):
   fix on the web before or alongside the corresponding mobile slice, or leave
   as documented risks.

**STOP.** CA-M0 ends here. No Admin Centre code, no migration, no push.
