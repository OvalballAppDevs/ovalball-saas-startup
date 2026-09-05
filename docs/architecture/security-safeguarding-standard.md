# Ovalball Security & Safeguarding Standard

Status: **mandatory architectural standard**, established 2026-09-03 during the Master Architecture
Pass. Every future feature — Access & Teams, Parent Team Messaging, Ovie, and everything after —
must be designed against this document from the outset, not reviewed against it afterward.

## 0. Core principle

**Ovalball security and safeguarding are system properties, not a launch-week task.** Every feature
must be designed against identity, relationship, resource scope, capability, data sensitivity,
minor/youth status, cross-club isolation, cross-team isolation, and auditability — from its first
draft, not bolted on before shipping. Security is not "we'll review RLS before launch." Safeguarding
is not "we'll add parental controls later." A feature that cannot state its answers to §18's
Definition of Done is not finished, regardless of how complete its UI is.

## 1. Deny by default

A user receives access **because a canonical relationship or capability explicitly permits the
action** — never because they know an ID, can navigate to a URL, hold a powerful role somewhere
else, belong to the same club, belong to the same team, or because the UI happened to render a
button. If relationship resolution is ambiguous, **do not broaden access** — deny, and report the
ambiguity rather than guessing (this is exactly how the Player/Guardian foundation treated legacy
`team_permissions.view_only` rows it could not confidently classify: left as a documented
compatibility fallback, never silently upgraded to a Guardian relationship).

## 2. The server is authoritative

Every sensitive operation is reauthorized at the trusted boundary (RLS policy or `SECURITY DEFINER`
function) regardless of what the client sent. **Never** treat any of the following as authorization:
a hidden button, a navigation restriction, React state, the active context, a query-string value, or
a client-supplied `club_id`/`team_id`/`player_id`. UI restrictions exist for UX, not security — this
project has now twice found and fixed real leaks (the `?? manageableClubId(ctx)` fallback class, and
the `teams/[teamId]` session-wide entry guard) where a UI-layer check was mistaken for the real
boundary. Both were fixed at the *server* layer (RLS / `activeManageableClubId`/`activeClubId`
resolution), not by hiding buttons harder.

## 3. Active context is a lens, never authority

Recorded permanently, because it is the single most-repeated bug class found across this entire
pass: **ACTIVE CONTEXT CHANGES PRESENTATION. ACTIVE CONTEXT DOES NOT CREATE AUTHORITY.** Every
server operation independently resolves the actor's canonical relationship to the target resource,
via `getSessionContext()`'s real membership/relationship data — never by trusting which
`SwitchableContext` the cookie currently names. `lib/app-context/active-context.ts`'s own doc
comments say this explicitly and every page fixed this pass (`/people`, `/club`,
`/club/rollover`, `/club/venues`, `/fixtures/management`, `/fixtures/new`, `/messages`,
`/partner-clubs`, `/documents`, `/teams`, `/teams/[teamId]`, Calendar's lane-create and Schedule
Training) had exactly this bug: trusting "does this session hold authority *anywhere*" instead of
"does the *active* context hold authority *here*."

## 4. Resource-scoped authorization

Authorization must answer: **may THIS user perform THIS capability on THIS resource, inside THIS
club/team/player scope?** Avoid `isAdmin()`-style checks where the resource scope matters — prefer
the explicit, resource-aware pattern this schema already uses throughout: `internal.can_manage_team
(p_team_id)`, `internal.can_manage_club_fixtures(p_club_id)`, `internal.can_manage_player
(p_player_id)`. A bare `ctx.isSiteAdmin` or `canManageClubFixturesAnywhere(ctx)` check is a coarse
pre-gate at best (matching §38's "prefer capabilities" guidance) — never the final authorization for
a specific resource.

## 5. Cross-club isolation

A relationship in Club A never grants authority in Club B. Applies to People, Players, Guardians,
Teams, Fixtures, Messages, Documents, Venues, Pitches, Settings, Calendar, CSV, Notifications,
Partner Clubs, Support tooling, and every future Ovie action. Live-proven this pass with a genuine
synthetic cross-club account (Home Guardian + Away Coach on one login): switching context correctly
scopes the settings gear, the Team Settings page's own entry guard, and Calendar/Fixtures nav to
*only* the active club/team — even the account's own legitimately-coached Away team was
inaccessible while a Home context was active, and vice versa. Neither direction leaked.

## 6. Cross-team isolation

Team authority is team-scoped unless an explicit *club-wide* capability grants broader authority. A
U12 Coach never automatically gains U14 private data, U14 Team Settings, U14 messages, U14 player
records, or U14 documents — and tampering with `team_id` in a direct request must not change that.
Live-proven: an isolated single-team Away Coach test account, given the `team_id` of an unrelated
Home team directly, matched 0 rows attempting to read or write it.

## 7. Player is not a Child entity

Retain the architecture already established (Relationship Registry §11): **PLAYER is canonical.**
The same stable `player_id` persists U6 → Colts → senior rugby. Minor/youth status is a *derived*
protection state (`lib/players/age-state.ts`), never a separate identity lifecycle. There is no
`children` table and there must never be one — a "child becoming an adult" must never require a
migration between two entity types.

## 8. Minor/youth protection — the canonical rule

Implemented in `lib/players/age-state.ts`'s `resolvePlayerAgeState()`, the **one** place this
decision is made:

1. A known, valid DOB always wins: 18+ at the effective date → `adult`, otherwise → `minor`.
2. Missing/invalid DOB + an active membership on any youth team (U6–U17) or Junior Colts →
   `unknown_youth_protected` (a safeguarding default — errs toward protection when a player holds
   several teams of mixed category).
3. Senior Colts and senior adult teams **never** infer minority from the team name — an unknown DOB
   there is `unknown`, never assumed adult and never assumed minor from team identity.
4. Age is calculated calendar-correctly against an explicit effective date, never
   `currentYear - birthYear`.
5. Classification is derived from `canonical_team_types.category`/`age_group` (controlled pathway
   metadata), **never** by parsing a team's free-text `display_name`.

Every future consumer that needs to know "is this player a protected minor" calls this function —
never reimplements the rule, never parses a team name.

## 9. Data minimization

Before adding any Player field, ask **why does Ovalball need this?** Do not collect data merely
because sports-management software commonly does. `players.date_of_birth` is nullable and
deliberately minimal — collected only because the youth-protection rule above genuinely needs it,
not as a general profile field. No medical information, home address, or private phone/email exists
on the Player entity, and none should be added without an explicit, stated product justification —
especially for a minor.

## 10. DOB handling

DOB is sensitive personal data. Most consumers receive the *derived* state (`minor` / `adult` /
`unknown_youth_protected` / `unknown`), never the raw column. `players.date_of_birth` is selected
only by the one query that computes the derived state (`session-context.ts`'s guardian/player
resolution) — no page, component, or API response should select it wholesale. Any future surface
that genuinely needs the raw DOB (e.g. a guardian editing their own child's record) must be
explicitly documented here as an exception, with the reason stated.

## 11. Player discovery

Parents must not be able to enumerate unrelated Players — confirmed by RLS, not just by the absence
of a UI selector: `players_select` returns rows only for the caller's own linked player, an active
Guardian relationship, or genuine team/club staff authority over that specific player's team. Live
security-tested: an isolated parent account saw exactly 1 player (their own child) out of a 12-player
synthetic fixture set; a genuinely unrelated club member saw 0. No People/search selector involving
Players may exist without an equally explicit, resource-scoped authorization check — "same club" or
"same age group" is never sufficient justification on its own.

## 12. Guardian privacy

Do not expose a guardian's email, phone, address, other children, other clubs, or other roles merely
because two players share a team. `resolveParticipantIdentities()` (Messages) already follows this
pattern — resolving only a display name/role/club, scoped to the clubs/teams actually party to the
conversation, never a session-wide profile dump. Any future Team Community messaging membership list
must follow the identical pattern: participant identity, not participant profile.

## 13. Messaging security

Keep conversation scopes structurally distinct — today's real types are `FIXTURE`
(`fixture_id`/`fixture_request_id`) and `CLUB_OPERATIONAL` (`club_conversation_id`), both authorized
by real club/team membership on either side, never by active context. A future `TEAM_COMMUNITY` type
is a genuinely different authorization question (team/guardian relationship, not "manages one of the
two clubs in this fixture") and must be a structurally separate source, not a filtered view over the
same rows (Relationship Registry §14.1 has the full design constraint). **Authorization differs by
conversation scope — never infer privacy from a conversation's title or label.**

## 14. Parent messaging boundaries

Parent/Guardian must never see fixture negotiation messages, opposition staff messages, club-to-club
operational correspondence, or staff-only discussions — enforced this pass (`messages/page.tsx`
skips both conversation-summary fetches entirely for `"parent"`/`"player"` context, not just hides
them client-side). A future Parent Team Community channel derives eligibility from the canonical
relationship graph (`guardians` → `players` → `player_team_memberships` → `teams`) — never a
manually-copied membership list, and never by copying operational fixture-conversation messages into
a parent-facing channel (§27 restates this as a permanent boundary: a fixture's *canonical fact* —
opponent, date, kickoff, venue — is legitimately visible; the *private discussion that produced it*
is not, and the two must never be conflated).

## 15. Document & storage security

Every document/file needs an explicit owner/scope, classification, authorized audience, storage
authorization, and download authorization — a hidden link is not security. `club_documents`' RLS
(`internal.can_manage_document_library(club_id, directory_id)`) and the storage bucket policy must
agree; they are checked independently and both must hold. Audit storage buckets individually rather
than assuming bucket-level access implies application-level authorization: `avatars` and
`club-logos` are legitimately public-read (a crest/avatar has no confidentiality requirement), but a
future Player document bucket almost certainly should not be, and that decision must be made
explicitly per bucket, never inherited from an existing bucket's policy by default.

## 16. Export / import security

Exports are a major data-loss surface. Every export must use the *same* canonical authorization
rules as the UI it's derived from — never a broader query just because the user can see one page of
it. Sensitive Player/Guardian data requires deliberate, reviewed column-level inclusion in any future
export, not "select *". Imports must validate schema, validate stable identifiers, validate the
target club/team scope, reject cross-club references, stage potentially destructive changes for
review, and never silently create duplicate Players or Guardians — the existing fixture CSV import's
staged-review workflow (`admin/fixtures` import) is the pattern to follow for any future Player
import, not a direct-insert shortcut.

## 17. Notification privacy

Email/push/in-app notification payloads are minimized — no DOB, address, or private message content
in a subject line, push preview, notification summary, or log line where unnecessary. Authorization
must be re-checked when a notification's destination link is actually opened — possessing an old
notification is never itself permanent access to whatever it once pointed at.

## 18. Search security

Search/autocomplete enforces authorization **before** returning candidate records, never after —
never return unauthorized Player/Guardian/staff data and rely on the user not selecting it. This
applies to every future search surface including Ovie's own opponent/team resolution (already
scoped by `internal.can_manage_team`-style checks in `lib/ovie/actor-context.ts`, per the earlier
Ovie security pass — the pattern to extend, not reinvent).

## 19. Logging

Never log DOB, addresses, private message content, tokens, passwords, session secrets, or other
Player private data. Security diagnostics identify records by safe stable IDs (`player_id`,
`team_id`, `club_id`) — never by dumping the row.

## 20. Auditability

Privileged actions record enough to answer *who did what, to which resource, when, from which
surface* — particularly role changes, Guardian relationship changes, Player Team Membership changes,
club/team administration, fixture support intervention, sensitive exports, and Site Admin actions.
`internal.audit_row_change()` (already attached to `players`, `guardians`, and
`player_team_memberships` in this pass's own migration, matching the existing pattern on
`club_memberships`/`team_permissions`/`club_conversations`) is the established mechanism — every new
sensitive table gets the same trigger, not a bespoke logging call.

## 21. `SECURITY DEFINER` functions

Every `SECURITY DEFINER` function is security-sensitive by construction — it bypasses the RLS of
whatever it queries. For each one: document why elevated execution is needed (this pass's own
`internal.is_own_linked_player`/`internal.is_active_player_guardian`/`internal.can_manage_player`
exist specifically to break a genuine RLS recursion cycle between three tables, not to skip writing
real policies), authorize the actor *inside* the function body, validate the target resource, never
trust a client-supplied `club_id`/`team_id` without re-deriving it, pin `search_path`, and grant
`EXECUTE` narrowly. No blanket elevation because RLS was inconvenient to write correctly.

## 22. Service role

Service-role credentials never reach the browser. Server-side use is narrowly justified per call
site — never used merely to avoid designing correct RLS or domain authorization.

## 23. Site Admin is not a universal shortcut

Site Admin is a set of explicit, per-person capabilities (`manage_team_catalogue`,
`manage_competitions`, `manage_fixture_support`, `manage_global_lookups`, plus `admin_role`) — a
Site Admin holding one capability does not automatically receive every piece of private
Player/Guardian data. Every blanket `internal.is_site_admin()` check in a new feature requires
explicit review: does this genuinely need *every* Site Admin to pass, or does it need a specific
capability?

## 24. Settings ownership

Restated from `docs/architecture/settings-ownership-map.md`: Personal → Person, Club → Club, Team →
Team, Player/Guardian preferences → Player/Guardian where they eventually exist, Site → explicit
configuration domain. A lower-scope mutation never silently alters a higher scope — guaranteed today
because every scope is a genuinely separate table with its own RLS policy, never a shared "settings"
table a narrow write could reach a wider scope through.

## 25. Relationship revocation propagates

Remove a Guardian relationship → derived Parent access disappears. End a Player Team Membership →
derived team access disappears. Remove a Coach assignment → team capability disappears. No
feature-specific orphan permission may exist anywhere — if a future feature needs its own membership
concept, it must derive from the canonical relationship graph, never maintain a parallel copy that
could drift out of sync on revocation.

## 26. Invitations

Every invitation binds to an intended identity/email, a target club, a target team where relevant,
an intended role/capability, an expiry/state, and an audit actor. Accepting an invitation must never
affect unrelated existing relationships on the accepting account (the existing `invitations` +
`club_ovalball_invitations` + `site_admin_invitations` tables already model this shape — a future
cross-club invitation for the Access & Teams feature must follow it, not invent a new one).

## 27. Account recovery

One account may control Parent relationships, Player identity, Coach access, and Club Admin access
simultaneously — account recovery is correspondingly sensitive. Use Supabase Auth's own trusted
mechanisms; never invent a custom weak recovery flow, and ensure recovered access never bypasses the
canonical relationship checks above (recovery restores the account, not a shortcut around
authorization).

## 28. Deletion & retention

Design deletion separately from historical sporting records — deleting a person's account must never
silently corrupt fixture history, team history, audit history, or results. But personal data,
especially a minor's, must not be retained forever merely because sporting history references it.
Retention/anonymization rules must be documented **before** this becomes a production concern, not
discovered during an incident.

## 29. Test data policy

Until explicitly approved for real-data testing, use synthetic/local playground Player/Guardian data
only — this pass's own `supabase/tests/player_guardian_security.sql` fixture (fictional players named
`PlayerA1`, `PlayerB1`, etc., fictional `@ovalball.local` emails) is the pattern. Never add genuine
child personal information merely to test functionality, and never commit production personal data
to source control.

## 30. Automated security regression

Every major authorization capability needs both a **positive** test (an authorized actor succeeds)
and a **negative** test (an unauthorized actor — wrong team, wrong club, wrong relationship — fails).
Do not test only happy paths. `supabase/tests/player_guardian_security.sql` (12/12 PASS) and
`lib/players/age-state.verify.ts` (12/12 PASS) are the reference shape: self-contained fixture data,
explicit PASS/FAIL assertions, both directions of every isolation boundary.

## 31. Direct tampering tests

For every sensitive feature, test direct substitution of `club_id`, `team_id`, `player_id`,
`fixture_id`, `conversation_id`, and `document_id` — the server must reject an unauthorized resource
even when the UI itself would never generate that request. This pass ran exactly this class of test
live (SQL `set local request.jwt.claims` impersonation) against `clubs`, `teams`,
`player_team_memberships`, and `club_documents` — every attempt by an unauthorized actor matched 0
rows or raised a real RLS violation, never silently succeeded.

## 32. The security regression rule

When a security bug class is discovered, **do not patch only the observed page.** Search the
repository for the architectural pattern, fix every occurrence, add regression coverage, and
document the bug class. This is exactly how the `activeManageableClubId(...) ??
manageableClubId(ctx)` fallback leak was handled this pass — found on `/fixtures/management` first,
then searched for and fixed across 13 more call sites in the same session, not patched one page at a
time as each was separately reported.

## 33. Fail closed

If relationship resolution is ambiguous, do not broaden access. If club scope cannot be proven, deny.
If a Player relationship cannot be proven, deny. If a legacy `view_only` row is semantically
ambiguous, do not invent Guardian/Player meaning for it — leave it on the documented compatibility
path (Relationship Registry §11.5) rather than guessing.

## 34. Future Ovie

Ovie inherits every rule above without exception. Ovie is another interface to the same canonical
services — it never receives broader data because it is an AI system. Authorize *before* sending
information to the model, minimize the model's payload, and never allow the model to invent resource
IDs or bypass deterministic authorization (`lib/ovie/team-authorization.ts`'s `canActOnTeam()` and
the RLS behind every write Ovie performs are the existing enforcement points — a future Player/Guardian-
aware Ovie feature must call the same canonical resolvers this document describes, never build its
own).

## 35. Definition of Done for future features

Every meaningful feature's implementation report must include this section, stated explicitly —
`"N/A — reason"` where genuinely irrelevant, never silently omitted:

- **DATA TOUCHED**
- **MINOR/YOUTH DATA TOUCHED**
- **RELATIONSHIPS USED**
- **AUTHORIZATION BOUNDARY**
- **CROSS-CLUB TEST**
- **CROSS-TEAM TEST**
- **DIRECT TAMPERING TEST**
- **RLS/SERVER ACTION IMPACT**
- **SECURITY DEFINER IMPACT**
- **STORAGE IMPACT**
- **EXPORT/IMPORT IMPACT**
- **LOGGING/AUDIT IMPACT**
- **NEGATIVE TESTS**
- **REMAINING RISKS**

## 36. Canonical Scoped Capability Engine

Ovalball's answer to "can this actor perform this capability on this resource in this scope?" is one
primitive, `internal.has_capability()` (`docs/architecture/capability-model.md` §7), never a
per-page role check. It composes with, and never weakens, every principle above:

- **Deny-by-default** extends to overrides: an explicit deny always wins over an explicit grant and
  over the role default, with zero exception -- not even a Full Site Admin bypass can re-grant what
  was explicitly denied for that exact scope.
- **Resource-scoped authorization**: every team-scope capability check independently re-derives and
  validates that the named team belongs to the named club before consulting anything else -- a
  malformed club_id/team_id pairing is rejected before role logic even runs. This closed a genuine,
  live-confirmed cross-club privilege-escalation vulnerability in `team_permissions`
  (`20260921000000_team_permissions_cross_club_scope_fix.sql`), which is now permanent regression
  coverage (`supabase/tests/club_settings_capability_security.sql` test 10).
- **No self-escalation**: `set_capability_override()`/`revoke_capability_override()` refuse a
  caller who names themselves as the target, unconditionally -- a Full Site Admin cannot grant or
  deny their own capabilities.
- **Security invariants stay non-configurable** (§11 above): the capability catalogue has no key for
  cross-club access, RLS bypass, Guardian privacy, or any other platform invariant -- there is
  nothing in `capabilities` a Site Admin could grant that would weaken tenant isolation, because no
  such capability exists to grant.
- **RLS composition** (not a UI-only gate): `clubs`, `teams`, `venues`, `club_pitches`,
  `team_permissions`, and the `club-logos` storage bucket's write policies all call
  `has_capability()` directly -- a deny override is enforced at the true authorization boundary, not
  merely hidden from the UI. Live-verified: after a deny, the raw `UPDATE` statement itself returns
  0 rows, independent of any page.
- **Permission management is itself gated** (§23, Site Admin is not a universal shortcut): editing
  `permission_groups` or issuing a `capability_overrides` grant/deny/revoke requires the new
  `internal.can_manage_permissions()` capability, not blanket `is_site_admin()`.

## 37. Production gate

**Passing feature tests does not mean Ovalball is production-ready.** Before any real-data pilot or
production launch, a separate, comprehensive Security Review, Safeguarding Review,
Privacy/Data-Protection Review, Production Infrastructure Review, and Operational
Incident/Recovery Review are required. This standard is not weakened merely because development is
progressing well — a clean typecheck and a passing regression suite are necessary, never sufficient,
conditions for that gate.
