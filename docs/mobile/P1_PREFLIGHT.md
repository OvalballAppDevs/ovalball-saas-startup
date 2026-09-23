# P1 preflight — the seven answers

No code written. Checkpoint `d736ebb`.

---

## 1. DOB audit

**Which tables hold one:** `public.players.date_of_birth` and
`public.profiles.date_of_birth`. Both nullable.

**The population, in the review database:**

| | total | null DOB |
|---|---|---|
| players (all) | 13 | **0** |
| players with a login | 2 | **0** |
| players on an active team | 7 | **0** |
| profiles (all accounts) | 21 | **20** |
| active guardians | 5 | 4 |

Which is exactly the product principle stated: **children always have one,
adults usually do not.** Ovalball never required DOB to create an adult account,
and this audit is not a reason to start.

**How the two predicates derive age.**
`internal.person_is_established_adult` (used by `grant_role`) requires a recorded
DOB proving adulthood — unknown age is *not* adulthood there, which is correct
for granting authority. `internal.is_adult_messaging_user` is the inverse shape:
it asks whether any linked player **or** the profile has a DOB that makes them a
minor, so an account with no DOB anywhere passes.

**Why it is written that way**, in the canonical predicate's own recorded words:
*"NULL DOB does not mean adult in general — it means 'no minor identity is
attached to this account, and in this product that cannot be a child'."*

### Is the unsafe state reachable? No, and here is the closed proof

The dangerous shape is a genuine minor whose account has no DOB anywhere — i.e.
a `players` row with `user_id` set and `date_of_birth` null.

| Route into `public.players` | DOB |
|---|---|
| `add_child_for_guardian(…, p_date_of_birth date, …)` | **required parameter** |
| `create_player_for_guardian(…, p_date_of_birth date, …)` | **required parameter** |
| `create_own_player_profile(…, p_date_of_birth date, …)` | **required parameter** |
| `request_child_link(…, p_date_of_birth date, …)` | **required parameter** |
| `approve_guardian_link_request` | copies `guardian_link_requests.submitted_date_of_birth` |
| `resolve_player_duplicate_review_as_new` | copies `player_duplicate_reviews.submitted_date_of_birth` |

The two copying routes are closed by a CHECK constraint:

```
guardian_link_requests_kind_shape_check:
  (kind = 'FIRST_CHILD'      AND … AND submitted_date_of_birth IS NOT NULL AND target_player_id IS NULL)
  OR (kind = 'ADDITIONAL_GUARDIAN' AND target_player_id IS NOT NULL)          -- no new player
  OR (kind = 'SELF_ADDED_CHILD' AND … AND submitted_date_of_birth IS NOT NULL)
```

and `player_duplicate_reviews` rows are written only by
`add_child_for_guardian` / `create_player_for_guardian`, both of which already
require one.

Afterwards: the **only** function that updates `players.date_of_birth` is
`create_own_player_profile`, which also requires one — and `public.players` has
**no permissive UPDATE policy at all** (only the RESTRICTIVE `session_ok_required`
gate), so no client can clear it directly either.

Live: `select count(*) from players where user_id is not null and date_of_birth is null` → **0**.

**Conclusion: not a RED defect.** The fallback is reachable only by accounts with
no linked player — adults, the population deliberately exempted from DOB
collection. P1 does not touch it; the invariant gets permanent tests in P5
alongside the availability work, asserting each creation route refuses a null DOB
and that no player with a login lacks one.

## 2. Web Support — already exactly what O-1 describes

`app/(app)/support-button.tsx` sits in `app-nav.tsx` at line 89, and its own
comment reads: *"The persistent, always-available Support entry point — placed in
the same header row as Messages/Notifications … since every authenticated user
can reach Support regardless of role."*

The web header row is already `[MessagesPopover] [NotificationBell]
[SupportButton]`. The mobile shell is adopting a convention the web already has,
not a new one.

- **Destination**: `/support` — Support Centre, ticket list, new request, follow-ups.
- **Contracts**: `create_support_ticket`, `add_support_followup`,
  `getMySupportConversations` (already in `packages/contracts/src/support-conversations.ts`).
- **Tables**: `support_tickets`, `support_ticket_events`, `support_ticket_attachments`.
- **Unread is canonical.** `SupportButton` takes `unreadCount`, and
  `public.my_unread_counts()` returns `{ notifications, messages, support, total }`
  in **one call** — so Support may carry a badge, and all three counts come from a
  single authoritative source rather than three mobile queries.

## 3. Current mobile header/tab architecture that must change

| File | Lines | Change |
|---|---|---|
| `apps/mobile/src/context/tab-projection.ts` | 72 | Messages out of the five; Rugby Hub in. Its comment records the superseded M3 decision and must record this one. |
| `apps/mobile/app/(tabs)/_layout.tsx` | 195 | `ALL` list and the `messages` tab registration |
| `apps/mobile/src/components/app-header.tsx` | 246 | Today: person avatar · context (crest + label + caption) · **one** bell. Becomes: identity left, `[Messages] [Notifications] [Support]` right. |
| `supabase/tests/js/bottom_bar_projection.test.mts` | 255 | Asserts the current five. Updated deliberately. |
| `apps/mobile/src/context/contexts.tsx` | — | `unreadMessages` is currently summed from `loadInbox`. Replace with `my_unread_counts` so all three badges come from one canonical answer. |

Messages keeps its route (`/messages/*`) and every deep link; only the shortcut
moves. `resolveIntent`'s `MESSAGES` / `MESSAGE_THREAD` intents are unaffected.

## 4. The shared family projection P1 will use

**It already exists and must not be re-invented.**

`resolveFamilyScope(ctx, activeContext) → FamilyChild[]` in
`packages/contracts/src/agenda/family-scope.ts` is the canonical answer to "which
of my children does this view cover", derived from `ctx.guardianRelationships` —
relationships the session already proved. `FamilyChild` carries `playerId`,
first/surname, `fullName`, `teamId`, `teamName`, `clubId`, `clubName`,
`avatarStoragePath`.

P1 adds **one** thing to the shared package: a small
`FamilyProjection` that resolves the avatar path to a signed URL once and exposes
the ordered child list, so Home, Fixtures, Calendar, Match Centre and Training
Centre all render the same child identity from one place.

And it adds `playerId` to the mobile `AgendaFilter`, applied through the shared
narrowing rule. **An arbitrary UUID grants nothing** for two independent reasons:
the loader only ever returned rows for proved children, and the filter can only
remove. P1 additionally rejects a `playerId` that is not in the resolved set, so
the chip cannot display a state that does not exist.

## 5. Do the RED proofs survive P1?

**Yes, and nothing in P1 is near them.**

P1 touches: a bottom-bar projection, a header layout, an unread read, a client
filter field, and a presentation projection over already-proved relationships. It
adds no capability, no RPC, no policy, and no recipient rule.

- `internal.may_direct_message`, `internal.team_messaging_staff`,
  `internal.is_adult_messaging_user` and
  `public.fixture_opposition_contacts` are untouched.
- Moving Messages from a tab to a header icon changes **where the same screen is
  reached from**, not who may be messaged. The recipient list is still
  `my_direct_message_candidates`.
- The child filter narrows rows the server already authorised.

Both proofs will be re-run at the end of P1 as regression rather than assumed.

## 6. Exact files P1 will modify

**Shared (`packages/contracts/src/`)**
- `agenda/family-scope.ts` — add the `FamilyProjection` resolver
- `agenda/filters.ts` — no change; `playerId` already exists here
- `unread.ts` *(new)* — move `getUnreadCounts` in from `lib/app-context/unread.ts`

**Web**
- `lib/app-context/unread.ts` — becomes a re-export shim

**Mobile**
- `src/agenda/filter.ts` — add `playerId`, count it as active, narrow on it
- `src/components/agenda-filter.tsx` — child chips from the projection
- `src/context/tab-projection.ts` — the five destinations
- `app/(tabs)/_layout.tsx` — tab registration
- `src/components/app-header.tsx` — the utility cluster
- `src/components/icons.tsx` — `CircleHelp`
- `src/context/contexts.tsx` — three canonical unread counts
- `app/(tabs)/index.tsx`, `app/(tabs)/fixtures/index.tsx`, `app/(tabs)/calendar/index.tsx` — the child filter
- `app/(tabs)/support.tsx` *(new)* — the Support destination
- `src/support/` *(new)* — reader/writer over `create_support_ticket`, `add_support_followup`, `getMySupportConversations`

**Tests**
- `supabase/tests/js/bottom_bar_projection.test.mts` — the new five
- `supabase/tests/js/mobile_foundation.test.mts` — header cluster assertions
- new: a family-projection unit suite (two children, filter isolation, arbitrary id yields nothing)

## 7. Migration required by P1

**None.** Every contract P1 needs already exists and is already
`authenticated`-executable: `my_unread_counts`, `create_support_ticket`,
`add_support_followup`, and the guardian relationships behind
`resolveFamilyScope`. No schema change, no new capability, no policy change.

The first migration in this programme belongs to **P5** — the availability →
staff notification domain event — and to **P11** for the push device registry.
Both are canonical platform features, not mobile ones.
