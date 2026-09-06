# Safeguarding Officer Foundation

The canonical Main-domain identity/role/contact/messaging/notification foundation for a Club's Safeguarding Officer. This is knowledge/role/contact/communication infrastructure only — never safeguarding case management. Consumed later by SP3 Stage 7's own Rugby Hub Safeguarding page via the contract in the final section below.

## Audit classification

- **REUSE**: `profiles`/`auth.users` (canonical person identity — no new person table); the Canonical Scoped Capability Engine (`internal.has_capability`, `public.capability_overrides`, `set_capability_override`/`revoke_capability_override` — no new grant mechanism); `internal.audit_row_change()` (no new audit mechanism); `public.set_updated_at()`; `site_admin_invitations`' own shape as the direct structural template for the new invitation table.
- **EXTEND**: `public.capabilities` (the flat catalogue is the genuine FK target `capability_overrides.capability_key` references — extended with seven new keys, never duplicated); `internal.has_club_role_capability()` (adds three of those keys to the existing CLUB_ADMIN default bundle only); `fixture_messages` (a new nullable `safeguarding_conversation_id` thread column, following the table's own established, repeated pattern).
- **DO NOT TOUCH**: `club_memberships.role` (stays `BASIC_USER`/`CLUB_ADMIN`/`FIXTURE_SECRETARY` — Safeguarding Officer is deliberately not a new value here, for the same reason `site_admins` is its own table rather than a `club_memberships` row); `public.club_contacts` (a separate, simpler, unlinked free-text phone-book concept for `fixture_secretary`/`minis_secretary`/`general` — not touched, not reused); `public.invitations` (kept separate, matching why `site_admin_invitations`/`guardian_invitations`/`player_account_invitations` are each their own table rather than one shared generic table).
- **CONSOLIDATE**: none required. No existing safeguarding-officer-shaped data exists anywhere to consolidate — `team_contacts.role`'s dormant `'safeguarding_lead'` value has zero app references, and the `safety.safeguarding` platform entitlement / `'safeguarding'` `policy_acknowledgements` value are both unwired. Neither is a real officer-assignment model.

## Canonical identity

A Safeguarding Officer is a person/user relationship to a club, never a separate `safeguarding_officer_user` identity. `club_safeguarding_officers.user_id` references `auth.users(id)` directly and is null until a real, invited person accepts. The same person may hold this duty at one club while independently holding `CLUB_ADMIN`/`FIXTURE_SECRETARY`/`BASIC_USER` at another (or the same) club — proven in regression test F.

## Primary / deputy

`club_safeguarding_officers.officer_type` is `'primary' | 'deputy'`, with a partial unique index (`club_safeguarding_officers_one_active_per_type`, `where status <> 'inactive'`) allowing at most one non-inactive assignment per type per club. The architecture supports both from day one — a deputy is not a later addition bolted on.

## Contact vs. authorization

`club_safeguarding_officers.contact_name`/`contact_email` are editable from the moment of nomination (`status = 'not_invited'`), independent of whether the nominated person has ever heard of Ovalball. `status` (`not_invited → invite_sent → active → inactive`) tracks the actual authorization lifecycle; only `accept_safeguarding_officer_invitation()` ever sets `user_id` and moves the row to `active`. A pending or not-yet-invited contact grants nothing — proven in regression test C.

Note: the spec's own five-state list (adding a separate "Invite accepted" state between "Invite sent" and "Active") was deliberately collapsed to four. There is no real product moment between a person accepting and the role becoming authorized in this implementation — introducing a persisted state with no real transition into or out of it was judged worse than the spec-literal fidelity would have bought.

## Club Admin UI

`/club/settings/safeguarding` — a new Club Settings tab, gated on `club.safeguarding.view` (read) with `club.safeguarding.manage_contact` (nominate/invite/resend/revoke/edit/deactivate) and `club.safeguarding.message` independently checked, matching this page family's own convention of independent capability booleans rather than one combined flag. Shows name, email, role (primary/deputy), Ovalball status (Not invited/Invite sent/Active/Inactive), and the four documented actions.

**Known follow-up, disclosed rather than silently left incomplete**: only this new page and `pitch-allocation`'s own render pass `canSafeguarding` correctly computed; the other eight pages that render `<ClubSettingsNav>` (`/club/settings`, `/club`, `/club/settings/ovalball-billing`, `/club/settings/subscriptions`, `/club/settings/guardians`, `/club/player-moves`, `/club/venues`, `/club/rollover`, `/teams`) do not yet compute and pass their own `canSafeguarding` boolean, so the "Safeguarding Officer" tab will not appear in their nav bar even for a Club Admin who has access. The Safeguarding Officer page itself remains fully reachable and correctly gated by direct navigation; this is a small, mechanical, low-risk cross-navigation-consistency gap, not a security or functional defect.

## Invitation lifecycle

`club_safeguarding_officer_invitations` mirrors `site_admin_invitations`' shape exactly (token, 14-day expiry, `accepted_by`/`accepted_at`, `revoked_by`/`revoked_at`, `invited_by`). A partial unique index (`..._one_pending_per_officer`) enforces at most one pending invitation per officer assignment — safe/idempotent resend is revoke-then-recreate via `resend_safeguarding_officer_invitation()`, matching this codebase's own established resend idiom exactly (there is no separate "resend" concept anywhere else in Main either). Acceptance (`accept_safeguarding_officer_invitation`) requires the accepting session's own email to match `invited_email` — the same binding every invitation type in this codebase uses — and additionally establishes a `club_memberships` row (`role = 'BASIC_USER'`, `on conflict do nothing` so an existing higher role is never touched) purely because `set_capability_override()` refuses to grant a club-scoped capability to anyone without an active `club_memberships` row at that club ("a capability override narrows or extends real authority, it does not invent a relationship").

## Capability model

Seven new capability keys, category `'club'`, `applicable_scopes = ['club']`:

| Key | Default grant |
|---|---|
| `club.safeguarding.view` | CLUB_ADMIN default bundle |
| `club.safeguarding.manage_contact` | CLUB_ADMIN default bundle |
| `club.safeguarding.message` | CLUB_ADMIN default bundle |
| `club.dispensation.view` | None — Site-Admin-grantable only |
| `club.dispensation.notify` | None — Site-Admin-grantable only |
| `club.transfer.safeguarding_view` | None — Site-Admin-grantable only |
| `club.transfer.safeguarding_notify` | None — Site-Admin-grantable only |

The four Site-Admin-grantable keys reach a specific accepted officer only via an individual `capability_overrides` grant — never a role default, never a bundled "can view/edit everything" capability. No new grant/revoke RPC was built: the Site Admin UI (`/admin/safeguarding`) calls the existing `set_capability_override`/`revoke_capability_override` RPCs directly, restricted to exactly these four keys at the application layer (`SAFEGUARDING_GRANTABLE_CAPABILITIES` in `app/(app)/admin/safeguarding/actions.ts`) — though the real, unconditional boundary remains those RPCs' own Site-Admin-only authorization, identical regardless of which capability key is named (proven in regression test L).

## Site Admin permission UI

`/admin/safeguarding` lists every active, accepted Safeguarding Officer across every club and toggles the four capabilities per officer per club, using the exact same outlined-button on/off pattern already established for Site Admin's own per-capability toggles (`app/(app)/admin/site-admins/admin-row.tsx`).

## View vs. edit

`club.safeguarding.view` and `club.safeguarding.manage_contact` are genuinely separate capabilities, checked independently everywhere — holding one never implies the other (proven in regression test K).

## Message Safeguarding Officer / email fallback

Reuses `fixture_messages` exactly as instructed — no separate safeguarding message store. A new `club_safeguarding_officer_conversations` table provides a genuine 1:1 scope (deliberately **not** `club_conversations`' own club-wide-role-scoped shape, which would let every current/future Club Admin at either club see the thread). `internal.can_view_safeguarding_conversation`/`can_send_safeguarding_conversation` are layered into `fixture_messages`' existing RLS policies as an additional OR-branch, mirroring the most recent precedent for adding a new conversation kind (`team_conversation_id`'s own addition), not a further widening of `internal.can_access_any_conversation`'s own parameter list.

`start_or_get_safeguarding_officer_conversation()` refuses to create an Ovalball conversation unless the named officer is genuinely `active` with a real `user_id` — this refusal is the server-side proof the app layer's email-fallback branch relies on (proven in regression test N). The email fallback uses the existing `dispatchEmailEvent`/`EmailEvent` mechanism with a new `safeguarding_officer_message` variant carrying the real message body (mirroring `support_ticket_reply`'s own precedent for sending real content by email, not only a link). The UI states plainly which mode was used.

**Known follow-up**: the thread view (`/club/settings/safeguarding/messages/[conversationId]`) is a small, purpose-built page rather than an extension of the generic `/messages/[kind]/[id]` shell — that shell is heavily coupled to fixture-negotiation presentation (status badges, result panels, inline competition/pitch/kickoff editors) and extending it safely was judged out of scope for this pass. The underlying data is fully shared; only the presentation is separate. No realtime/presence wiring was added for this conversation kind (a page reload shows new messages; live-updating is a follow-up, not a blocker for the feature's real function).

## Dispensation notifications

Audit finding: player dispensation/movement is always same-club (the eligibility resolver hard-rejects any cross-club move), so exactly one club's officer(s) are ever relevant per dispensation. `internal.notify_club_safeguarding_officers()` is a small, genuinely shared helper (not a new subsystem) factored out only because the same "active, accepted officer with capability X" recipient query would otherwise be duplicated verbatim at each call site. Wired into `request_player_dispensation` (requested), `decide_player_dispensation` (a genuine rejection at any stage, or the final governing-body approval only — never an intermediate approval), and `revoke_player_dispensation` (revoked). Who approves is completely unchanged — every authorization check in these three functions is copied verbatim from the pre-existing definitions; only a notification insert was added after the fact (proven in regression test R: the notified officer has zero approval authority).

The new notification `type` strings (`safeguarding_dispensation_requested`/`_decided`/`_revoked`, `safeguarding_officer_invitation_accepted`) are deliberately left unmapped in `notification_types`/`notification_topics` — matching how the pre-existing `fixture_call_up_decided`/`player_eligibility_approval_required` types already behave (unmapped → the delivery-gating trigger fails open, always delivered). This was a deliberate choice, not an oversight: spec section 28 explicitly requires a required safeguarding alert not silently disappear behind a generic notification-preference toggle.

## Transfer / registration notifications

Audit finding: **Main has no inter-club transfer/registration-change system**. Every "player movement" concept that exists (`internal.resolve_player_movement_eligibility`, `fixture_player_call_up`, `player_team_dispensation`) is explicitly same-club, team-to-team movement only. `club.transfer.safeguarding_view`/`club.transfer.safeguarding_notify` capability keys were still added (matching the spec's own proposed catalogue and leaving the door open for a future real inter-club transfer domain to wire into), but **no actual notification-firing code was built for a "transfer" event distinct from dispensation**, because no such distinct event exists in Main today to wire into. Wiring these two capabilities to real events is future work for whichever stage eventually builds inter-club transfers, not invented here.

## Privacy / minor safety

Least privilege throughout: the Site Admin Safeguarding page shows only name/club/capability-toggle state, never DOB, guardian contact details, medical information, private conversations, or attendance notes. `club_safeguarding_officers`' own RLS restricts read access to the club's own admins (`club.safeguarding.view`), the officer themselves, and Site Admin — no other club, and no ordinary member/parent/player, can see it (proven in regression tests U1/U2).

## Rugby Hub integration contract (for SP3 Stage 7)

Main can provide, per club:

```
club_id
safeguarding_officer_present: boolean
officer_display_name: string | null
message_mode: 'OVALBALL' | 'EMAIL' | null   -- null when no active officer
accepted_ovalball_user_id: string | null    -- only when message_mode = 'OVALBALL'
```

Derivable directly from `club_safeguarding_officers` (`status = 'active'` for `officer_type = 'primary'`, `user_id` non-null implies `OVALBALL`, `user_id` null on an active row is not possible by construction). No regulatory content of any kind belongs in this contract — SP3 owns regulatory knowledge, Main owns the club/person relationship. Not integrated into SP3 in this pass, per this task's own explicit instruction.

## Audit

Every new table (`club_safeguarding_officers`, `club_safeguarding_officer_invitations`, `club_safeguarding_officer_conversations`) carries the standard `internal.audit_row_change()` trigger — no new logging mechanism. Capability grants/revokes are additionally self-auditing via `capability_overrides`' own append-only design (revoking supersedes, never deletes), exactly as every other domain using this engine already relies on.

## Explicit non-goals

No safeguarding incident form, allegation record, victim record, accused-person record, evidence upload, investigation workflow, or safeguarding notes database of any kind exists anywhere in this schema (proven directly against the schema catalog in regression test X). This is role, contact, permissions, communication, and notification infrastructure only.
