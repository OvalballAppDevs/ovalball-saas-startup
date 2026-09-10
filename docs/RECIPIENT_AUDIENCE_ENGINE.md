# Ovalball Recipient + Audience Resolution Engine

SP4, phase 3. This is the canonical foundation every future operational
email/broadcast event and every future Broadcast Composer will use to answer
one question safely: *given a canonical context (a team, a club, a fixture, a
player set), who are the legitimate human recipients, and why did anyone get
excluded?*

No provider is called from anything in this phase. It ends at a resolved
recipient set.

---

## 1. The security architecture decision

### The question this replaces

The previous phase framed the open problem as *"how do we make Match
Centre's viewer-scoped resolvers (`getMatchCentreContext`,
`get_match_centre_capabilities`) answer for an arbitrary named recipient
instead of the current session"*, and proposed JWT/`request.jwt.claims`
impersonation as one way to do it.

**That was the wrong question.** Inspecting the two real, already-shipped
precedents for exactly this problem —
`internal.fixture_audience_recipients` (Match Centre's own "message the
team" feature, `20261103000000_fixture_communications.sql`) and
`internal.notify_training_participants` (`20261011060000`) — shows neither
one impersonates anybody. Both resolve recipients with an ordinary,
explicit, parameterised join: *given these player_ids, read their active
guardians, plus the player directly where they are old enough / consented*.
Authorization is checked once, up front, against the **actor's own real
session** (may this actor manage this fixture/team), never against an
impersonation of the person receiving the message.

### The three options, compared

| | A. JWT/request-claims impersonation | B. Explicit server-side resolver (actor + context, no impersonation) | C. Extract the existing safeguarding primitives, reused by both browser and background paths |
|---|---|---|---|
| RLS implications | Every RLS policy that reads `auth.uid()` now runs *as* an impersonated stranger — every policy on every table becomes part of this feature's attack surface, not just the ones it means to touch | None — no policy runs as anyone but the real caller | Same as B |
| Auditability | Hard: a table's own row-level audit trail (`created_by`, RLS decisions) would show the impersonated user, not the real actor who triggered the resolution | Easy — the actor is always the real `auth.uid()` of the session that called the function | Easy, same reason |
| Privilege escalation risk | High — any bug in a policy that widens under some unexpected role/JWT combination now widens for background email too, silently | None — new capability requires a new explicit `has_capability` grant | None |
| Background-job / future queue-worker behaviour | Breaks: a worker with no "current user" at all cannot construct a legitimate impersonation without inventing one, which is a second identity system | Works unchanged — the resolver takes explicit ids, no session required at all | Works unchanged |
| Forged recipient ids | Depends entirely on the impersonated JWT's own claims being trustworthy — a bug that lets an id through is now a full-identity bug | The recipient is never an input; only canonical context ids (team/club/player) are, and every one is capability-checked | Same as B |
| Testability | Requires simulating a JWT per test case, coupling every test to auth internals | A SQL function called with plain arguments — trivial to test, as the live proofs in this phase show | Same as B |
| Precedent in this codebase | One use, in a migration-time verification guard only (`20261019000000_capability_union_restore.sql`) — never in application runtime | This IS the existing pattern: two live features already work this way | Same |

**Decision: C, realised as B.** The underlying safeguarding primitives
(`internal.player_effective_age`, `internal.guardian_permission_effective`,
the active-guardian join) are extracted into one general-purpose function,
`internal.player_notification_recipients(p_player_ids uuid[])`, callable by
any audience source (team roster, club roster, fixture participants,
training roster) without re-deriving the rule. **No JWT impersonation is
used anywhere in this engine.** Authority (may this actor address this
audience) is checked once, against the real caller, by dedicated
`internal.can_address_*_audience` functions built on `internal.has_capability`
and `internal.is_club_admin`/`internal.is_full_site_admin` — never a role
string compared inline.

**Permanent principle, now enforced structurally, not just stated:**
background email processing must never gain authority by impersonating an
arbitrary user. `scripts/verify-recipient-audience-boundary.mjs` fails the
build if a second copy of the age/consent predicate appears anywhere outside
the two files allowed to declare it.

### What "existing pattern" was NOT reused wholesale, and why

`internal.fixture_audience_recipients` and `internal.notify_training_
participants` are **not called** by this engine's functions, and are
**not modified** by this phase. Two real reasons, stated rather than
papered over:

1. They are live Main Project features (Match Centre's "message the team",
   Training Centre's session notifications). Refactoring them to call the
   new shared primitive is a Main Project change with real regression risk
   for a shipped feature, out of scope for an SP4 email/audience
   foundation — flagged as the natural next step, not silently skipped.

2. **A genuine discrepancy was found between them**, and is reported here
   rather than fixed quietly: `notify_training_participants` treats *any*
   player with a linked account (`p.user_id is not null`) as a legitimate
   direct recipient, with no `player_effective_age >= 18` check and no
   16/17-consent check — unlike `fixture_audience_recipients`, which applies
   both. In today's data this is probably harmless (nothing in the audited
   schema suggests an under-16 can acquire `players.user_id` in the first
   place), but the two functions are not provably the same rule, which is
   exactly the "three subtly different implementations" failure this whole
   phase exists to prevent. **This is a genuine finding for Main Project
   attention, not fixed in SP4** — fixing Training Centre's own notification
   function is a Main Project change to a shipped feature, not an email
   foundation change.

---

## 2. The canonical primitive

```
internal.player_notification_recipients(p_player_ids uuid[])
  -> (player_id uuid, user_id uuid, relationship text)
```

For each input player: every active guardian (relationship `'guardian'`),
plus the player themselves (relationship `'self'`) only at 18+, or 16-17 with
recorded `direct_coach_communication` consent. Returns one row per
*relationship*, not per human — a guardian of three relevant children
produces three rows sharing one `user_id`. That is deliberate: it is what
lets the caller both (a) send exactly one email per human
(`count(distinct user_id)`) and (b) know which player(s) that email concerns,
for personalisation (§7 below).

```
internal.player_recipient_exclusions(p_player_ids uuid[])
  -> (player_id uuid, outcome text)
```

One row for every player who produced **zero** recipient rows, classified
`CONSENT_REQUIRED_NO_GUARDIAN` (a 16/17 year old with their own login, no
consent on record, and no guardian to ask) or `NO_ELIGIBLE_GUARDIAN`
(everyone else with nobody eligible). A player is never silently absent from
an aggregate without an explainable reason.

---

## 3. Audience sources implemented this phase

| Audience | Player source | Authority | Summary RPC (safe preview) | Raw RPC (send-time) |
|---|---|---|---|---|
| Team Playing Group | `player_team_memberships` active on one team | `internal.can_address_team_audience` | `public.team_playing_group_summary` | `public.team_playing_group_recipients` |
| Club Playing Group (whole club) | union across every active team at one club | `internal.can_address_club_audience` | `public.club_playing_group_summary` | `public.club_playing_group_recipients` |
| Platform — Eligible Users | union across every **active `clubs`** row (never `club_directory`) | `internal.is_full_site_admin()` only | `public.platform_eligible_audience_summary` | `public.platform_eligible_recipients` |

Selected-teams / selected-clubs are not separate RPCs this phase — proven
instead (§6 of the report) that the underlying primitive composes correctly
by unioning two teams' player_ids before calling
`player_notification_recipients` once, with a shared guardian across both
correctly deduplicated to one send. A dedicated `resolve_selected_teams_*`
RPC is a thin wrapper over the same primitive whenever a caller needs it —
not built speculatively this phase.

**Team Staff / Club Administrators / Whole Rugby Community audiences** are
not implemented this phase (design only — see the previous phase's doc for
the semantics). They are additional *player-set sources* or *non-player
recipient sources* (staff are contacted directly by `user_id`, not through
`player_notification_recipients` at all) layered on the same primitive, not
a reason to change it.

### The capability choice, disclosed

`can_address_team_audience` uses `team.attendance.view`, not `team.manage`.
`team.manage` was tried first (its English description, "edit a team's
details and roster," reads like the right authority for "may address this
team") and rejected on inspection: `role_capability_defaults` grants it to
**nobody** by default, at either team or club scope — gating on it would have
silently made every real coach and team manager unable to address their own
team, a fact discovered by testing against a real seeded `team_admin`
permission holder, not assumed from the capability's name.
`team.attendance.view` is granted to `TEAM_STAFF` by default and already
gates the closest existing thing to "manage this team as a group" (the
Match Centre full-roster section). This is a disclosed interim choice, not a
perfect semantic fit — **a dedicated `team.communication.manage` capability
key is the honest long-term answer**, and adding one is a Main Project
capability-vocabulary decision, not something to invent unilaterally from an
email/audience foundation.

---

## 4. Deduplication

`player_notification_recipients` returns one row per (player, recipient)
relationship. Two separate deduplication questions have two separate
answers, and conflating them was the bug this design avoids:

- **"How many emails do we send?"** → `count(distinct user_id)`. Proven live:
  a guardian with children on two different teams, given the union of both
  teams' player_ids, appears in exactly one send, never two.
- **"What is this email about, for this recipient?"** → the full row set for
  that `user_id`, never collapsed. A guardian of two children on the *same*
  team keeps both relationship rows, which is what makes a scalar variable's
  ambiguity detectable at all (§7).

Cross-role dedup was proven with real data: a Full Site Admin who is
simultaneously an adult self-managed player, a guardian, and a Club Admin
appears in a whole-club resolution **exactly once**, counted correctly under
both her `'guardian'` and `'self'` relationship rows.

---

## 5. Recipient-relative variables

`lib/email/audience/recipient-relative-context.ts` collapses one recipient's
rows into `single | none | ambiguous`. A player-scoped scalar
(`{{player_first_name}}`) resolves only for `single`. For `ambiguous` (a
guardian of more than one relevant child in this audience) it is
**unavailable, never an arbitrary first pick** — proven live: a guardian of
two children on the same fixture's team correctly produces `UNAVAILABLE
(ambiguous)` rather than either child's name.

What "unavailable" means operationally — omit the variable, omit that
recipient, or offer a structured multi-player block instead — is a Broadcast
Composer product decision this phase does not make; the guarantee this phase
provides is that the ambiguity is always surfaced, never hidden.

---

## 6. What is genuinely still open

- Selected-teams / selected-clubs as first-class audiences with their own
  RPC, authority check across a *set* of ids, and a real UI.
- Team Staff / Club Administrators / Whole Rugby Community as audiences that
  reach non-player humans directly.
- The `notify_training_participants` discrepancy noted in §1 — a Main
  Project fix, not an SP4 one.
- A dedicated `team.communication.manage` capability, replacing the
  disclosed `team.attendance.view` stand-in.
- Everything from the previous phase's design-only sections that this phase
  did not touch: the queue/worker, template version pinning for a broadcast,
  the Broadcast Composer itself.
