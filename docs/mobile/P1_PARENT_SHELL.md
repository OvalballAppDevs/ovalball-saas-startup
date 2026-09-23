# P1 — Parent/Guardian mobile shell and the canonical family context

Completion report. Banked locally; nothing pushed, deployed or released, and no
migration was written.

## 1. Checkpoint

One commit on `main`, local only: `feat(p1): one family, three badges, five
destinations`. The two protected untracked logo files in `public/icons` were
deliberately left untracked.

## 2. What changed

**New, shared (platform-neutral):**

| File | What it is |
|---|---|
| `packages/contracts/src/family/projection.ts` | `FamilyProjection`, and every rule about a supplied child id |
| `packages/contracts/src/family/avatars.ts` | signed URLs over the private `player-avatars` bucket |
| `packages/contracts/src/unread.ts` | `getUnreadCounts` — moved out of `lib/app-context/` |
| `packages/contracts/src/notifications/bell.ts` | the bell list — moved out of `lib/app-context/` |
| `packages/contracts/src/notifications/destinations.ts` | `notificationHref` — moved out of `lib/notifications/` |
| `packages/contracts/src/notifications/index.ts` | the barrel for both |

`lib/app-context/unread.ts`, `lib/app-context/notifications.ts` and
`lib/notifications/destinations.ts` remain as re-export shims, so no web import
changed. `server-only` was kept only where the original carried it.

**New, app:**

| File | What it is |
|---|---|
| `apps/mobile/src/family/family.tsx` | `FamilyProvider` / `useFamily`, and the stored selection |
| `apps/mobile/src/components/child-filter.tsx` | All · Pippa · George, hidden when there is no choice |
| `apps/mobile/src/components/header-utilities.tsx` | the three header controls |
| `apps/mobile/src/context/header-projection.ts` | which three, and what each badge says |
| `apps/mobile/src/support/support.ts` | the tickets read and the two writes |
| `apps/mobile/app/(tabs)/notifications.tsx` | the canonical bell list, native |
| `apps/mobile/app/(tabs)/support.tsx` | the ticket list and a new request, native |
| `supabase/tests/js/mobile_parent_shell.test.mts` | 30 assertions: the shell, the badges, the family |

**Changed, app:** `app/_layout.tsx` (the provider), `app/(tabs)/_layout.tsx`
(two more declared routes, no badge in the bar), `app/(tabs)/index.tsx`,
`fixtures/index.tsx`, `calendar/index.tsx` (the child filter and the narrowing),
`app/(tabs)/more.tsx` (two duplicated rows removed), `src/components/app-header.tsx`,
`src/context/contexts.tsx` (three counts, not one), `src/context/tab-projection.ts`,
`src/context/home-data.ts`, `src/agenda/filter.ts`, `src/components/icons.tsx`.

**Changed, guards:** `supabase/security/perimeter-manifest.json` and
`scripts/verify-notification-catalogue.mjs` repointed at the moved modules;
`supabase/tests/js/mobile_tab_projection.test.mts` and
`supabase/tests/js/team_needs_attention.test.mts` updated to the decisions this
step makes.

**No SQL of any kind changed.** `git status --porcelain -- '*.sql'` is empty.

## 3. The family projection

```ts
interface FamilyMember {
  playerId: string
  firstName: string; fullName: string; shortLabel: string
  teamId: string; teamName: string
  clubId: string;  clubName: string
  avatarUrl: string | null; initials: string
}
interface FamilyProjection { members: FamilyMember[]; hasChoice: boolean }
```

It is built by `loadFamilyProjection(supabase, ctx, activeContext)`, which is
`resolveFamilyScope` — the canonical relationship read — plus signed avatar URLs.
The app derives no relationship of its own.

`hasChoice` counts **distinct children**, so a child registered with two teams is
one child and produces no selector. `shortLabel` is the first name, and becomes
the full name only when two children in the same family share a first name.

## 4. The selection state

`FamilyProvider` holds one nullable id, and `null` means *all of my children*.
It is remembered under `ovalball.selected-child` so the app opens where it was
left. The selection is presentation: it never becomes part of a session, a
context or a capability.

## 5. How an invalid child id is refused

`const selectedPlayerId = normaliseSelection(projection, requested)` runs on
**every render**, so a value restored from storage, arriving in a deep link or
simply wrong is reduced to `null` before it reaches a query, a chip or a filter.
Three layers, in order:

1. `normaliseSelection` rejects anything not in the projection;
2. the projection itself contains only what `resolveFamilyScope` proved;
3. `applyFilter` can only **remove** rows the server already returned — it runs
   no query, so a chosen id cannot reach a row the scope did not authorise.

A child whose place at the club ends stops being in scope, and the app returns to
showing the family rather than failing about an id nobody typed.

## 6. The bottom navigation

`Home · Fixtures · Calendar · Rugby Hub · More` — five cells, the same five for
every context, asserted for `parent`, `player`, `family`, `team`, `club`,
`site_admin`, `governing` and no context at all.

## 7. The header

`Messages · Notifications · Support`, in that order, on every screen, matching
the website's own header. None of the three is also a bar cell, and `More` no
longer repeats Rugby Hub or Notifications.

## 8. Where the counts come from

One round trip to `public.my_unread_counts()`, via `getUnreadCounts`, returning
`{ notifications, messages, support, total }`. `projectHeaderUtilities` copies
each field to its own badge and performs no arithmetic: nothing is summed,
derived or counted on the device, and `total` is unreachable from the projection
because it must never be drawn as a badge. A badge is hidden at zero rather than
showing `0`, reads `99+` above ninety-nine, and always speaks the exact figure
("Messages, 1240 unread").

## 9. Support

Native: the list of the signed-in person's own tickets, and a form to raise one.
Opening a thread hands off to the web with the handoff stated on screen, because
the native thread is P6. There is no dead button.

## 10. Focused results

- **100 JS suites — 926 assertions, 0 failing.** Includes the new
  `mobile_parent_shell` (30), `mobile_tab_projection` (9), `family_scope`,
  `agenda_filter_narrowing`, `parent_agenda_model`, `parent_player_identity`,
  `notification_destinations`, `perimeter_manifest` (12).
- **Structural guards:** content standard (1107 files), identity presentation,
  Match Centre shared, Training Centre shared, Event Centre shared, availability
  one-product (1673 checks), messenger/notification architecture, mobile
  messenger scope (306 checks), notification catalogue (86 emitted / 86
  registered / 86 routed), contact safety (18), authority guards, SQL suite
  registry (297), browser suite registry — all pass.
- **Typecheck:** web clean, app clean.
- **Bundle:** `expo export --platform ios` succeeds (6.1 MB).

## 11. Safeguarding regression — both boundaries re-run live

Run against the local review database as the real people, after P1:

| Check | Expected | Actual |
|---|---|---|
| parent asks `fixture_opposition_contacts` | 0 rows | **0 rows** |
| parent's candidates named from a club outside the family | 0 people | **0 people** |
| (context) candidates offered at all | own club only | 8, every one "Your club · Ovalball UAT RUFC" |
| `may_direct_message(parent → admin at another club)` | false | **false** |
| parent opens that conversation with the id in hand | refused | **refused** |
| `is_adult_messaging_user(U18 player)` | false | **false** |
| U18 player `may_direct_message(their coach)` | false | **false** |
| U18 player's recipient list | 0 people | **0 people** |
| U18 player opens a conversation with the coach | refused | **refused** |
| `may_direct_message(coach → that child)` | false | **false** |

## 12. No authority moved

No SQL file changed, so none of these could have: `internal.may_direct_message`,
`internal.is_adult_messaging_user`, `internal.team_messaging_staff`,
`internal.player_contact_eligibility`, `internal.can_player_as_family`,
`internal.resolve_attendance_response_source`, `public.respond_to_attendance`,
`public.open_direct_conversation`, `public.my_direct_message_candidates`,
`public.fixture_opposition_contacts`. The RLS on `guardians`, `players`,
`player_team_memberships`, `player_fixture_attendance`,
`guardian_player_permissions` and `fixtures` is likewise untouched. Definition and
policy digests were recorded at the time of the run as evidence.

## 13. Remaining debt

- **The Support thread is a web handoff.** Stated on screen; P6 completes it.
- **No push notifications.** The notifications screen says so in as many words.
  Nothing is wired to Expo Push or APNs.
- **Availability answered on a phone still notifies nobody on the staff side.**
  A real platform gap, owner-scheduled for P5, not worked around here.
- **A pre-existing gate failure, not from this step.**
  `verify-recipient-audience-boundary` fails at `HEAD` as well: it flags
  `public.redeem_invitation`, whose definition and the guard script are both
  byte-identical to `HEAD`. Reading it, the flagged access is `players.user_id`
  used as a *claim guard* ("this player already has a login, so this invitation
  cannot claim them") and then written — not recipient resolution, so the guard's
  heuristic is too wide rather than the function being wrong. It belongs to the
  slice that owns invitation redemption, and is recorded here rather than fixed
  inside P1.
- **The physical-iPhone walkthrough is the owner's to perform** — see below.

## 14. Physical-iPhone walkthrough

Sign in as the parent UAT identity and check, in order:

1. the bottom bar shows exactly Home, Fixtures, Calendar, Rugby Hub, More;
2. the header shows three controls with independent badges, on every screen;
3. reading every message leaves the bell where it was;
4. Home names the child in bold and says Parent/Guardian;
5. the child chips appear only for a family with more than one child, and
   choosing one narrows Home, Fixtures and Calendar and nothing else;
6. closing and reopening the app returns to the same child;
7. Notifications opens native, and each item lands on the thing it is about;
8. Support lists your own tickets and can raise one; opening a thread says it
   continues on the web.
