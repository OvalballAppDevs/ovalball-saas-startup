# Recent-authenticator (`R`) convergence register

**Owner decision (CA-M1, decision 1):** mobile does not enforce the catalogue's
`R` (recent authenticator) requirement on its own, and the 73 `R` declarations
are not switched on in one migration. Each is converged **when the slice that
owns the operation ships** — enforced canonically at the database, then both
clients updated, then proved fail-closed. This file is the tracked list.

## How `R` is enforced today

- The catalogue (`public.capabilities.aal`) declares `A2` for 110 active keys
  and `R` for 73. `A2` is met by `internal.session_aal_ok()` inside
  `internal.session_live()`, which every `internal.can` decision and every
  `session_ok_required` row policy passes through (rollout groups are all at T0,
  so AAL1 currently satisfies it; `account_security_state` overrides apply).
- `R` is enforced by `internal.require_recent_aal2(<minutes>)`, which only
  `approve_privileged_recovery`, `request_privileged_recovery` and
  `start_impersonation` call. **No club operation calls it.** The website has a
  `guardAction({ recentMinutes })` boundary (`lib/auth/action-boundary.ts`) that
  no club action passes a value to. So an `R` declaration is, for club work, a
  declaration only — on both clients equally.
- Mobile therefore carries **no** `R` logic. It reads capability answers from
  `my_capabilities` and lets the server refuse. When an operation gains
  `require_recent_aal2`, the refusal surfaces as a 42501 the app already shows,
  and the app then adds the re-authentication step in that slice.

## CA-M1's own mutations

| operation | capability | catalogue AAL | enforced today | CA-M1 action |
|---|---|---|---|---|
| `update_club_profile` | `club.profile.edit` | A2 | `internal.session_ok()` + `internal.can` | none needed — no `R` |
| `save_club_contact` | `club.profile.edit` | A2 | same | none |
| `delete_club_contact` | `club.profile.edit` | A2 | same | none |
| crest replace/remove (already native) | `club.logo.manage` | A2 | storage policy + `clubs_update_admin` | none |

No CA-M1 mutation carries `R`. Nothing was broadened and nothing was declared
enforced that is not.

## The 73 `R` declarations, by the slice that will own them

Keys as in `public.capabilities` where `aal = 'R'` and `status = 'ACTIVE'`
(2026-09-24). Each converges in the named slice: enforce at the RPC with
`internal.require_recent_aal2`, add the re-authentication step to web and
mobile, prove refusal without a recent authenticator.

**Account (identity programme, web-first):** `account.data.export`,
`account.deletion.request`, `account.recovery_codes.manage`,
`account.security.manage`, `account.sessions.manage`.

**Club settings (CA-M2 Club Settings):** `club.settings.manage`,
`club.reporting.export`, `messaging.policy.manage`,
`messaging.moderation.club_review`.

**People and roles (CA-M3 People & Memberships consumed; CA-M4 Roles & Permissions turns
`R` on):** `people.capability.manage`,
`people.invitation.create`, `people.membership.revoke`,
`people.membership.suspend`, `people.role.assign_club`,
`people.role.assign_team`, `player.account.invite`,
`player.profile.edit_protected`. CA-M3 consumes `people.role.assign_club` and
`people.role.assign_team` on both clients exactly as the database enforces them today: capability
yes, recent authenticator no. The membership operations (`transition_club_membership` to
SUSPENDED / ACTIVE / REVOKED) are enforced on `people.role.assign_club` by
`internal.club_people_authority`, while the catalogue names `people.membership.suspend` and
`people.membership.revoke` for them; that mismatch is recorded here and left for CA-M4, which
owns the enforcement. The web's Roles & Permissions panel was numbered CA-M7 in
`CLUB_ADMIN_CENTRE_MAP.md`; the owner's sequence is CA-M4.

**Family (family slice):** `family.duplicate.resolve`,
`family.relationship.approve`, `family.relationship.remove`.

**Safeguarding (safeguarding slice):** `safeguarding.officer.confirm`,
`safeguarding.officer.deactivate`, `safeguarding.officer.nominate`,
`safeguarding.welfare.view`.

**Fixtures and competitions (fixtures administration slice):**
`fixture.callup.approve`, `fixture.dispensation.approve_club`,
`fixture.dispensation.approve_team`, `fixture.fixture.delete`,
`fixture.import.run`, `competition.edition.issue`.

**Teams and season (team/season slice):** `team.handover.apply`,
`team.lifecycle.manage` — CA-M2 consumes `team.lifecycle.manage` on both clients (fold /
reactivate) exactly as the database enforces it today: capability yes, recent authenticator no.
Enforcement is added with the re-authentication step in the slice that turns it on.

**Finance (finance slice, web-only by design for connection and export):**
`finance.gocardless.connect`, `finance.payment.act`,
`finance.platform_billing.manage`, `finance.subscription.configure`,
`finance.subscription.export`.

**Governing body:** `governing.access.manage`.

**Site Admin (web-only by design; 36 keys):** `site.admins.manage`,
`site.audit.view_sensitive`, `site.capabilities.override`, `site.claims.review`,
`site.club_roles.manage`, `site.clubs.lifecycle`, `site.commercial.manage`,
`site.competitions.manage`, `site.email.manage`, `site.family.manage`,
`site.fixtures.delete`, `site.fixtures.support`, `site.invitations.manage`,
`site.memberships.manage`, `site.messages.moderate`,
`site.messages.policy.manage`, `site.permissions.manage`,
`site.regulatory.manage`, `site.safeguarding.review`, `site.seasons.manage`,
`site.support.act_in_club`, `site.support.view_club`,
`site.system.beta.manage`, `site.system.release.manage`,
`site.team_catalogue.manage`, `site.team_roles.manage`, `site.users.create`,
`site.users.disable`, `site.users.export`, `site.users.identity.correct`,
`site.users.impersonate`, `site.users.impersonate_act`, `site.users.merge`,
`site.users.security.manage`, `site.users.view_personal`.

## Role-authorised RPC mismatches (decision 2)

Recorded from CA-M0 §1.1 for convergence when their slices ship — not changed
in CA-M1, and access is not broadened meanwhile:

- `fold_team` / `reactivate_team` — **closed by CA-M2.** The database already
  authorised on `team.lifecycle.manage`; the role check lived on the web team
  page (`canManage` from `club_memberships.role`) and on the Add Team gate
  (`club.profile.edit`). Both now ask the capabilities the operations ask
  (`team.lifecycle.manage`, `team.team.manage`); the mobile Admin Centre asks
  the same two; migration `20270543000000` pins the server side.
- `apply_season_handover` (season handover) authorises on role rather than the
  capability its catalogue row names — its slice.
- Role and membership operations (`assign_role`, `set_primary_club_role`,
  `set_team_access`, `remove_team_access`, `transition_*`) check
  role-level authority inside the RPC; the capability engine is the target.

Mobile never reproduces a role check: it asks `my_capabilities` and lets the
server answer, so when an RPC converges the app needs no change.
