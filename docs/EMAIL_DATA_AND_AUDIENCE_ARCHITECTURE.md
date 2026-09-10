# Ovalball Email Data + Audience Architecture

SP4, phase 2. This extends `docs/EMAIL_COMMUNICATIONS_ARCHITECTURE.md` (the
send pipeline, the template registry) with where an email's *domain data*
genuinely comes from, and with the architecture broadcast/audience email will
need. Built from a real reading of the canonical tables and resolvers below,
not from UI labels.

---

## 1. Domain data map

| Domain | Canonical entity | Identity key | Authoritative source | Useful email data | Sensitivity | Safe as variable? | Safe only as structured block? | Recipient-dependent? |
|---|---|---|---|---|---|---|---|---|
| Person | `profiles` | `id` (= `auth.users.id`) | `profiles` | first name, surname | Low (self) | Yes (first name) | — | Yes — it's always *this* recipient's own name |
| Player | `players` | `id` | `players` | first name only for email; DOB/medical never | High (child data) | first name only | — | Yes, when the recipient is that player or their guardian |
| Guardian | `guardians` (join) + `profiles` | `guardian_user_id` | `guardians`, `profiles` | first name | Low (self) | Yes | — | Yes |
| Club | `clubs` + `club_directory` | `clubs.id` / `club_directory.id` | `resolveClubLogoPath` (`lib/app-context/club-logo.ts`), `club_directory.name` | name, crest | Low (public directory data) | name: yes. crest: **structured only**, never a raw URL | Crest | No |
| Team | `teams` | `id` | `teams.display_name` (canonical, no free rename — see CLAUDE.md) | display name | Low | Yes | — | No |
| Fixture | `fixtures` | `id` | `fixtures` (read exactly as `lib/app-context/match-centre-data.ts` reads it) | date, kickoff, meet time, home/away, status | Low (once teams/clubs are public) | date/time: yes (formatted). Team/venue identity: structured | Match Summary | Attendance counts: no. Named attendance: yes (open question, §4) |
| Training Session | `training_sessions` | `id` | `training_sessions` | date, start/end, venue, pitch | Low | Yes (formatted) | Training Summary | Same as fixture attendance |
| Venue | `venues` | `id` | `venues` | name, address lines, postcode | Low (club's own address, often public) | Structured only (never hand-assembled from raw columns) | Venue block (inside Match/Training Summary) | No |
| Pitch | `club_pitches` | `id` | `club_pitches.display_name` | name | Low | Yes | — | No |
| Competition | `competitions` + `competition_editions` | `competition_editions.id` | `competition_editions.competitions(name)` | name | Low | Yes | — | No |
| Season | `seasons` | `id` | `public.seasons` (canonical register — see pinned platform rule) | name/label only, never a computed boundary | Low | Yes (label) | — | No |
| Attendance | `player_fixture_attendance` (polymorphic: `fixture_id` XOR `training_session_id`) | `(activity_id, player_id)` | `player_fixture_attendance`, `internal.resolve_attendance_response_source` | aggregate counts today; a named response is the open question | **High** (a named response ties an identity to a child's activity) | Aggregate: yes. Named: **not yet — open question, §4** | Attendance Summary (aggregate) | Named response: yes, by definition |
| Subscription/Payment | club subscription + GoCardless tables (not re-audited to column level this pass) | `club_id` | existing platform-billing domain | plan label, status, next collection date | High (financial) | Semantic status label only, never a provider ID or raw amount object | — | Yes, per club |
| Brand | `email_brand_settings` | singleton | `active_email_logo_path()` | Ovalball's own logo | None | Structured only (`/email-assets/logo.png`) | Brand block | No |
| Support | `support_tickets` | `id` | existing (already wired) | reference, subject, reply body | Medium (author-supplied text) | Yes, already escaped as text | — | No |
| Referral | referral ledger | `id` | existing (already wired) | referred club name, plan, reward value | Low | Yes, already implemented | — | No |

**What this table changes from the previous pass:** nothing about the
existing 13 variables — they were all already correctly classified. It adds
the fixture/training/venue/attendance domains, which did not exist in the
catalogue before this phase, and it makes explicit that a *named* attendance
response is genuinely unresolved, not merely unbuilt.

---

## 2. The open architecture question: recipient-relative resolution

**Existing truth.** Match Centre's real resolvers —
`getMatchCentreContext`, `get_match_centre_capabilities`,
`get_my_attendance_authority`, `internal.resolve_attendance_response_source`
— all answer *"what can the currently signed-in browser session see"*. Every
one of them reads `auth.uid()` from the active Postgres connection's JWT.
That is correct and deliberate for a live page.

**The problem.** An email is composed server-side for a *named recipient* who
is not the person triggering the send and is usually not signed in. Getting
"Harry's response" into a guardian's email, or resolving whether a specific
recipient is even authorized to see a specific player's row, needs an answer
to a question those functions cannot take as a parameter: *what would user X
see*, not *what does the current session see*.

**Two ways to answer it, and why one is disqualified:**

- **A — a parallel, explicitly-parameterised set of resolvers.** Write
  `get_attendance_response_for_recipient(p_fixture_id, p_player_id,
  p_recipient_user_id)` etc., re-implementing each canonical predicate with an
  explicit user argument instead of `auth.uid()`. **Rejected.** This is
  exactly the failure `internal.has_club_role_capability`'s own migration
  comment warns about by name: a second copy of an authorization rule that
  can silently drift from the first ("it has happened ten times"). Two
  answers to "can this person see this" is a bug waiting for the day a
  capability rule changes in one copy and not the other.

- **B — impersonate the recipient's JWT for the single scoped read, then call
  the EXISTING, unmodified canonical function.** Postgres/Supabase already
  supports this (`set_config('request.jwt.claims', '{"sub": "...", "role":
  "authenticated"}', true)` against a service-role connection), and this
  codebase has already used the exact mechanism once — in
  `20261019000000_capability_union_restore.sql`'s migration-time verification
  guard, not in application runtime. **Recommended**, because it adds zero
  new authorization logic: the canonical rule is asked the question it was
  always built to answer, just from a different connection.

**Why this is not decided in this pass rather than built anyway:** option B
is real, new, security-sensitive infrastructure — a service-role connection
that can assert *any* user's identity for a read is powerful, and needs its
own scoping review (never allowed to write, never allowed to answer more than
the one field the email pipeline asked for, itself gated behind the
already-authorized `sendEmailEvent` boundary so it can never become a second
door into "look up any user's data"). Building it as a side effect of a
template-catalogue pass would be exactly the kind of rushed architecture this
brief explicitly asked not to produce. It is the single blocking item before
a fixture/training email can say "Harry's response" instead of only aggregate
counts — everything else in §1 is unblocked today.

---

## 3. Canonical Email Event Catalogue (proposed additions)

The existing 11 events are unchanged. Proposed additions, **not implemented
this pass** (no trigger/schedule decision exists for any of them — adding the
catalogue row without a real trigger would be exactly the "half-wired fake
event" the drift guard exists to catch):

| Event key | Category | Trigger (needs product decision) | Blocked by |
|---|---|---|---|
| `fixture_reminder` | Fixture | A scheduled job, X hours before kickoff — no scheduler exists in this codebase yet | Retry/queue infra (§6 below), recipient-relative resolution (§2) if it names a named response |
| `fixture_changed` | Fixture | A fixture's date/time/venue/opposition changes after it was first confirmed | Needs the "snapshot vs live" policy decided (§5) before it can be wired safely |
| `training_reminder` | Training | Same scheduling gap as `fixture_reminder` | Same |
| `match_cancelled` | Fixture | `fixtures.cancelled_at` being set | Genuinely close to wirable today — cancellation is a single, real, already-recorded event with no scheduler dependency. Flagged as the most likely *next* real event, not built this pass because it wasn't asked for. |

## 4. Canonical Audience Catalogue (design only — not implemented)

Every audience below is a **server-resolved set**, never a value the browser
supplies. None of this is built; it is the shape the eventual resolver must
have, grounded in the tables above rather than guessed:

| Audience | Resolves to | Real ambiguity this must not paper over |
|---|---|---|
| Team participants | Active `player_team_memberships` for a team → each player's legitimate notification destination | A player under 16 has no destination of their own — resolves to their active guardian(s), per the existing safeguarding rule, never to the player |
| Team guardians / staff | `guardians` / `club_memberships` scoped to the team | A person who is both a guardian on this team and staff on another must be deduplicated to one send |
| Whole club | Every active team's participants, unioned | "Whole club" is a UNION of team audiences, not a separate query — the same person on three teams gets one email |
| Club administrators | `club_memberships` where role implies admin, `status = 'active'`, `authority_suspended = false` | Matches the exact predicate `lib/email/recipients.ts`'s `club_billing_contact` case already uses — reuse it, don't re-derive it |
| Selected clubs / all active clubs | `clubs` where `status = 'active'` | **`club_directory` is never the audience.** A recognised-but-unclaimed directory club has no `clubs` row and nobody on Ovalball to receive anything — this distinction (already a permanent rule in CLAUDE.md) applies to audiences exactly as it applies to the Team Directory |
| Platform-wide | Every active club's whole-club audience, deduplicated | Full Site Admin only; the sender must never receive the resolved list, only a count |

**Every audience must produce, before send:** eligible count, excluded count
(with reason categories, never named), duplicate-resolved count, and a
guardian-redirect count — this is the "2,438 legitimate recipients across 81
active clubs" requirement, and it is a property of the resolver's return
shape, not a UI afterthought.

---

## 5. Event-specific snapshots (design only)

If `fixture_changed` is ever built: the correct answer is **enqueue-time
state**, not send-time state, for one reason — a queued "the venue changed"
email that gets silently re-resolved against a THIRD, later change reports a
wrong old-venue/new-venue pair. This needs a small typed, immutable payload
captured at enqueue (`{ field, previousValue, newValue }` for exactly the
fields that changed), **not** a second fixtures table — an audit/delivery
snapshot scoped to that one queued message. Not built this pass; no event
that needs it is wired yet.

---

## 6. Queue / retry — design only, explicitly not built

A platform-wide or whole-club send cannot happen inside one web request. The
existing `email_deliveries` ledger already has `attempts` for exactly this,
unconsumed. A generic queue needs: batch identity, audience definition,
pinned template version (§36 of the brief), progress counts, and retry
compatibility — this is real infrastructure, not a template-catalogue
feature, and building it now would be the same rushed-architecture mistake
§2 already declined. **This pass returns NEEDS WORK partly because of this
gap being genuine**, not because it was overlooked.

---

## 7. Permanent invariants (pinning §58 of the brief)

1. Email templates consume approved canonical domain data (§1's table),
   never arbitrary database fields — enforced today by `unknownVariables()`
   and the drift guard's variable-vs-renderer check.
2. A feature sender passes canonical identity (`clubId`, `fixtureId`), never
   pre-assembled copy — see `resolveClubCrestEmailUrl`/
   `resolveFixtureEmailContext` for the shape this takes.
3. The browser chooses an audience *definition*; the server resolves
   recipients — already true for every existing invitation event
   (`lib/email/recipients.ts` never accepts a `to`), and the design in §4
   extends the same rule to audiences rather than introducing a new one.
4. Safeguarding and consent apply to email exactly as elsewhere in Ovalball —
   no email-specific exception exists or should exist.
5. A new event cannot send until it is registered with a typed contract —
   already enforced at compile time (`EmailEventKey`) and by
   `scripts/verify-email-wiring.mjs`.
6. One published template version is pinned per send — already true for
   individual sends (`resolveTemplateContent`); extends unchanged to a future
   broadcast once one exists.
7. Broad audiences are capability-scoped and audited — design only (§4),
   not yet implemented.
8. Event email, operational broadcast, and marketing communication remain
   semantically distinct — `EMAIL_COMMUNICATIONS_ARCHITECTURE.md` already
   states ZeptoMail is transactional-only and marketing does not belong in
   this pipeline; nothing in this pass changes that boundary.
