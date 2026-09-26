# Section 11 — Clubhouse Activity

## PURPOSE

Give Clubhouse Home's "Recent Activity" teaser (a 5-item, Clubhouse-filtered slice of
`my_notifications`, built during the Home pass) a real destination for "the rest of it" — without
building a second, duplicate notification list screen.

## AUDIT FINDING

Mobile already has one mature, general Notifications screen (`apps/mobile/app/(tabs)/notifications/
index.tsx`) — paged (`readNotificationPage`, keyset cursor), filterable (All/Unread/Needs Action),
mark-read/unread, pull-to-refresh, "Show Older". Building a second, Clubhouse-scoped paginated list
with its own read/unread mutation would duplicate this exact machinery for one extra type filter — the
kind of second implementation this codebase repeatedly refuses to create (Match Centre, the fixture-
request domain, the Team Directory). The correct, minimal completion is a filter on the existing
screen, not a new screen.

## WHAT CHANGED

- `packages/contracts/src/notifications/feed.ts`: the Clubhouse-relevant type list (fixture requests,
  partner requests, club-claim outcome) moved out of `clubhouse/index.tsx`'s own local `const` into an
  exported `CLUBHOUSE_NOTIFICATION_TYPES` — the one source for both consumers below, so they cannot
  quietly drift apart.
- `apps/mobile/app/(tabs)/clubhouse/index.tsx`: "Recent Activity" gained a "See All" link (shown once
  there is at least one item), pushing to `/notifications?filter=clubhouse`.
- `apps/mobile/app/(tabs)/notifications/index.tsx`: `Filter` gained `"clubhouse"` alongside
  `all`/`unread`/`action` — a new chip, client-side filtered against `CLUBHOUSE_NOTIFICATION_TYPES`
  exactly like `"action"` is already filtered against the attention projection. Arriving via
  `?filter=clubhouse` lands directly on the "Recent" tab with that filter already selected (rather than
  the screen's own default "Needs Attention" tab), and gets its own empty-state sentence.

## SCOPE DELIBERATELY NOT TAKEN

No changes to web's `app/(app)/notifications/`. Clubhouse Home and its Recent Activity teaser are
mobile-only surfaces (per the original UI/UX brief); there is no web-side "Clubhouse Home" this needs to
converge with.

## TESTING

`supabase/tests/js/clubhouse_activity_types.test.mts` (new, 2 assertions) pins the exact contents of
`CLUBHOUSE_NOTIFICATION_TYPES` and confirms it never admits a single-team operational type. Both
clients' `tsc --noEmit` are clean. ESLint on every touched file shows only pre-existing, unrelated
findings (confirmed via `git stash` diff). A live-device walkthrough of the "See All" → filtered list →
tap-through round trip was **not** performed this pass.

## KNOWN DEBT

None new.
