# Admin Navigation & Support Messaging

Two things share this document because one task fixed both: the Site Admin
navigation information architecture (including the mobile drawer), and how a
support request reaches Messages. Referral integrity lives in
`docs/REFERRAL_ATTRIBUTION_INTEGRITY.md`; the dashboard itself lives in
`docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md`.

| | |
|---|---|
| Regressions | `scripts/verify-admin-nav.mjs` (26 checks) · `supabase/tests/support_messaging.sql` (22 assertions) |
| Migrations | **none.** Navigation is presentation; support already had its canonical schema |
| Verified at | a genuine 390 × 760 layout viewport (see §5) |

---

## 1. Site Admin navigation hierarchy

Eighteen top-level links became **five top-level choices**. No page was
removed, no permission changed.

```
Dashboard                         /dashboard

Rugby operations                  (section)
  Fixture Management              /admin/fixtures
  Calendar                        /calendar
  Competitions                    /admin/competitions
  Seasons                         /admin/seasons
  Lookup Administration           /admin/lookups

Clubs & people                    (section)
  Club Management                 /admin/clubs
  Claims                          /admin/claims
  Team Directory                  /admin/team-directory
  User Management                 /admin/users
  Permission Management           /admin/permissions
  Documents                       /admin/documents

Commercial                        (section, site.commercial.view)
  Commercial                      /admin/commercial

Support & system                  (section)
  Support Tickets                 /admin/support
  Message Management              /admin/messages
  System Health                   /admin/system-health
  Release & Platform Mode         /admin/releases
  Site Admin Management           /admin/site-admins
```

Depth is capped at **SECTION → PAGE**. Dashboard stays top-level because
burying the page people land on would be perverse.

**Grouping is applied to the already-capability-filtered list.**
`buildSiteAdminSections()` takes the flat array `buildNavItems()` produced from
real permissions and rearranges it; it cannot introduce a route the filter did
not yield. Expanding a section is not authorization, and every route re-checks
its own permissions server-side regardless.

**Nothing can fall out of the map.** Any route not named in a section lands in
a trailing **More** section rather than disappearing, and
`verify-admin-nav.mjs` fails if a Site Admin route is unmapped — so a page
added later surfaces as an oddly-placed link, never as an unreachable one.

**One taxonomy, two chromes.** `app/(app)/nav-sections.tsx` is rendered by both
the desktop sidebar and the mobile drawer, differing only in touch-target size.
Two renderers would have drifted.

Club Admin, Team, Parent and Player navigation is **unchanged** — those
contexts receive empty sections, which selects the existing flat list.

---

## 2. Mobile drawer scroll model

The reported bug: Site Admin had more nav items than fit, and the drawer could
not be scrolled far enough to reach them.

**Cause.** `SheetContent` is `flex flex-col … h-full` with no scroll container
anywhere. Its children simply overflowed the fixed-height popup and were
unreachable; the page behind did not scroll them either.

**Fix.** The drawer is now three explicit regions:

```
┌──────────────────────────────────────┐
│ HEADER  (shrink-0, never scrolls)    │  identity · gear · close
├──────────────────────────────────────┤
│ SCROLL REGION                        │  context switcher
│ min-h-0 flex-1 overflow-y-auto       │  grouped navigation
│ overscroll-contain                   │  Profile · Support
└──────────────────────────────────────┘
```

`min-h-0` is the load-bearing part: without it a flex child refuses to shrink
below its content height, so `overflow-y-auto` never engages. `overscroll-contain`
stops the scroll chaining to the page behind. Safe areas are honoured with
`pt-[max(0.75rem,env(safe-area-inset-top))]` and the matching bottom inset.

The desktop sidebar received the same `min-h-0 flex-1 overflow-y-auto`
treatment plus `md:h-screen md:sticky`, because a long grouped nav overflowed
there too.

**Measured at 390 × 760, every section expanded (worst case):**

| | |
|---|---|
| Nav content height | 1608 px |
| Scroll region height | 691 px |
| Previously unreachable | **917 px** |
| Scrolled to bottom | yes (`reachedBottom: true`) |
| Last of 20 links visible | yes ("Support") |
| Page behind scrolled | `0` — independent, as required |

---

## 3. Gear / close collision

The reported bug: on mobile the settings gear sat under the close X and could
not be pressed reliably.

**Cause.** `SheetContent` renders its own close button at `absolute top-3
right-3`. The gear was the last child of a `p-4` header row — the same
position. Two controls, one place.

**Fix.** The built-in close is disabled (`showCloseButton={false}`) and both
controls are laid out as siblings in the header row:

```
[ avatar ]  [ identity name / role ]        [ ⚙ ]   [ ✕ ]
                                            44px    44px
                                              └─8px─┘
```

Both are 44 × 44 interactive areas with small icons inside — the pressable area
is generous, the visual is not shouty. No z-index tricks and no absolute
positioning, so overlap is structurally impossible rather than tuned away.

**Measured at 390 px, Club Admin context (where the gear exists):**

| | |
|---|---|
| Gear | 44 × 44, `aria-label="Burnley RUFC settings"`, → `/club/settings` |
| Close | 44 × 44, `aria-label="Close menu"` |
| Overlap | **false** |
| Visible gap | 8 px |
| Both fully on-screen | yes (drawer flush at 97.5 + 292.5 = 390) |
| `elementFromPoint` at gear centre | resolves to the gear |

Nav links are no longer wrapped in `SheetClose`; the drawer is controlled and
links call `close()` directly. Nesting a `Link` inside `SheetClose`'s render
prop made every row two overlapping controls — the same class of problem.

---

## 4. Context-aware settings

Unchanged and re-verified. `resolveContextSettingsLink()` resolves from the
**active** context, never from the account's highest role:

| Active context | Gear destination |
|---|---|
| Club | `/club/settings` |
| Team | `/teams/{that exact team id}` |
| Parent / Player | `/account` (personal settings) |
| Site Admin | **no gear** |

Site Admin returns null deliberately: there is no single Site Settings page,
and the pass that introduced this rejected inventing one. With the new grouping
the platform-administration pages (System Health, Releases, Site Admin
Management, Lookups) are discoverable under **Support & system** instead, which
serves the same need without a fabricated destination. A Full Site Admin
operating as a Club Admin gets Club Settings, not Site Settings.

---

## 5. Genuine narrow-viewport verification

`resize_window` reports success but leaves `window.innerWidth` at 1512 — the
layout viewport does not change — and no headless browser is installed. The
mechanism that does work is a **same-origin iframe sized to 390 × 760**: CSS
media queries, container queries and viewport units inside a frame resolve
against the frame's own viewport, so the framed document genuinely lays out as
a phone.

Confirmed real, not simulated:

```
innerWidth                      390
matchMedia("(min-width: 768px)") false
desktop sidebar                 hidden
mobile top bar                  present
```

**What this does and does not prove.** It is a true narrow layout viewport, so
reflow, breakpoints, overflow, hit-testing and scroll behaviour are genuine.
It is not a real handset: it does not reproduce touch input, a dynamic browser
toolbar resizing `dvh`, iOS rubber-band scrolling, or device pixel density.
Those remain unverified.

---

## 6. Support requests — the current architecture

Audited before anything was changed.

| Question | Answer |
|---|---|
| What stores a support request? | `public.support_tickets` |
| Stable id | `support_tickets.id`; `reference` (e.g. `OB-260906-0056`) is a quotable display value, never the authorization key |
| Requester | `created_by_user_id`, or `contact_name`/`contact_email` for a public-origin ticket |
| Originating context | `club_id` (derived server-side), `related_fixture_id`, `related_fixture_request_id`, `related_team_id`, `source_route` |
| Status | `new` \| `in_progress` \| `closed` |
| Does submission create a conversation? | **Yes** — `support_ticket_events` is the thread |
| Does it create an initial message? | Yes, a `created` event. Its `body` is null by design; the request text is `support_tickets.description`, immutable case history |
| Where do replies go? | Requester → `add_support_followup` → `requester_message`. Ovalball → `send_support_reply` → `support_reply`. Both into the same thread |
| Internal notes | `internal_note` with `visibility='internal'`, enforced in **RLS**, not by a UI filter |
| Site Admin page | `/admin/support` (+ `/admin/support/[ticketId]`) |
| Requester page | `/support` (+ `/support/[ticketId]`) |
| Can a case exist with no thread? | No — `create_support_ticket` writes both, and the FK prevents an orphan thread |
| Can either party reply where the other cannot see? | No — `support_reply` is `visibility='requester'`; only `internal_note` is hidden, deliberately |

**Root cause of the reported problem.** Nothing was broken in the support
domain. `/messages` and `/admin/messages` simply read fixture and club
conversations only, so the canonical support thread lived exclusively behind
the Support surfaces and never appeared in Messages.

**Why support was not re-homed onto `fixture_messages`.** The brief allows an
existing better canonical architecture to stand, and this is one.
`fixture_messages` / `club_conversations` are club-to-club and have no party
for "Ovalball Support" — the reason `20260901120000_support_tickets.sql`
modelled support separately in the first place. Migrating would have created
the second disconnected message store the brief forbids and destroyed the
RLS-enforced internal/requester split.

---

## 7. Support in Messages

A **read model**, `lib/support/conversations.ts`. No migration, no new table,
no duplicated reply path.

**Requester** — `/messages` lists their support threads alongside fixture and
club conversations, with a **Support** filter beside All / Fixture requests /
Fixtures / Club messages. Rows show the "Ovalball Support" identity, the
subject, the latest visible message and a status of Open / With Ovalball /
Resolved. They link to `/support/[ticketId]`, which remains the one place a
reply is written.

Deliberately **not** gated on context: a support request belongs to the person,
so a Parent or Player sees their own thread exactly as a Club Admin does.
Scoped by `created_by_user_id` — a colleague at the same club sees nothing,
even though the request carries that club's id.

**Site Admin** — `/admin/messages` gains an **Ovalball Support** section above
the club/fixture conversation log, visually separate because the participants,
moderation rules and content policy are different. Each row links to
`/admin/support/[ticketId]`.

Gated on the canonical `internal.site_admin_support_level` via
`supportAccessLevel()` — **not** on "is this a Site Admin". A
`message_moderator` moderates club messaging and resolves to `none`; the
section is omitted server-side rather than fetched and hidden. No new
`site.support.*` capabilities were invented.

**Presentation identity vs actor.** Requesters see "Ovalball Support";
`support_ticket_events.actor_user_id` records the real person, and `audit_log`
keeps the provenance. Both are asserted (`support_messaging.sql` 13, 14).

---

## 8. Notifications, status and history

Notifications reuse the canonical `notifications` table through the existing
support RPCs — no second system, asserted by name rather than by count.

Status vocabulary is the existing `new` / `in_progress` / `closed`, surfaced as
**Open** / **With Ovalball** / **Resolved**. No new lifecycle was invented. A
resolved thread stays fully readable to the requester (assertion 19).

**Historical reconciliation: none required.** Every support case in the local
database already has a thread, and the foreign key makes the reverse
impossible — so there is nothing to link, nothing ambiguous and nothing to
guess. All 13 pre-existing local tickets are public-origin (no account behind
them), which is why they correctly do not appear in any requester's Messages.

---

## 9. Remaining gaps

- **Real-handset UAT** — the iframe gives a true narrow layout viewport but not touch input, dynamic-toolbar `dvh` behaviour, or device pixel density.
- **`/admin/messages` horizontal pan at 390 px** — `document.scrollWidth` is 928 on that page. Pre-existing: the conversation table is correctly wrapped in `overflow-x-auto`, and the residue traces to a 1 px `sr-only` element inside it. The support panel contributes **zero** overflowing elements. `/dashboard` and `/messages` have none.
- **Public-origin support threads** have no account to show them to, so they appear only in the Site Admin surfaces. Correct today; if public requesters ever get accounts, linking them is a product decision.
- **Site Admin has no settings gear** — by existing design (§4), not an oversight.
