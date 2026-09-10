# Email Dynamic Data catalogue

The permanent architecture, in one line: **canonical domain data → typed
email context resolver → the ONE Dynamic Data catalogue → template renderer
→ provider.** A template never reaches a database column directly, and the
Dynamic Data panel, template validation, preview, Send Test Email and a real
send all read the same catalogue — see `lib/email/dynamic-data/catalogue.ts`
for the registry itself and `scripts/verify-dynamic-data-catalogue.mjs` for
the guard that keeps it true.

## Domain coverage audit (as of this pass)

| Domain | Canonical source | Resolver | Status |
|---|---|---|---|
| Club | `clubs`, `club_directory` | inline in fixture/training/event resolvers | Implemented |
| Team | `teams` (structured identity) | `lib/teams/compact-label.ts` | Implemented |
| Player | `players`, guardian/player links | `lib/email/audience/recipient-relative-context.ts` | Implemented (ambiguity rule); **not wired to a live per-recipient send** — see below |
| Guardian | `player_guardians` | `recipient-relative-context.ts` | Implemented (relationship label only) |
| Fixture | `fixtures`, `venues`, `club_pitches`, `competition_editions` | `lib/email/context/resolve-fixture-email-context.ts` | Implemented, live-wired (`match_cancelled`) |
| Match Centre | (same as Fixture — Match Centre's own data, not a second copy) | same | Implemented |
| Training Session | `training_sessions`, `venues`, `club_pitches`, `teams` | `lib/email/context/resolve-training-email-context.ts` | Implemented, **no email event sends it yet** |
| Training Centre | (same as Training Session) | same | Implemented |
| Club Event | `club_events`, `club_event_teams`, `club_event_pitches` | none | **PLANNED / NOT AVAILABLE** — see below |
| Event Centre | (same as Club Event) | none | **PLANNED / NOT AVAILABLE** — see below |
| Venue | `venues` | inline in fixture/training resolvers | Implemented |
| Pitch | `club_pitches` | inline in fixture/training/event resolvers | Implemented |
| Competition | `competition_editions`, `competitions` | inline in fixture resolver | Implemented (name only) |
| Season | `seasons` | not yet resolved into any context object | Catalogued (`season_name`), **not wired into any resolver output** — no current event needs it |
| Attendance response | `player_fixture_attendance` | inline aggregate count in fixture resolver | Implemented (aggregate only, never per-person) |
| Calendar | (Calendar reads Fixture/Training/Event directly; no separate email concept) | n/a | Out of scope — Calendar is a UI surface, not a domain email data needs its own resolver for |
| Tournament | `tournaments`, `tournament_participants` | none | **PLANNED / NOT AVAILABLE** — see below |
| Recipient/audience engine | `internal.player_notification_recipients` and siblings | `lib/email/recipients.ts`, `lib/email/audience/` | Implemented for team/club/platform audiences (Phase 3); fixture-participant recipient kind wired |

### Tournament — explicitly not available

`public.tournaments` exists (used today for fixture pitch-allocation and
opponent search, not for anything email-facing), but Tournament Centre
itself is not complete in Main, and no email event concerns a tournament.
Per this task's explicit instruction, **no Tournament catalogue entries were
added**, even though the table exists — a database table existing is not
the same as a reviewed, product-ready domain for email. When Tournament
Centre is genuinely ready, a `resolveTournamentEmailContext` resolver and a
`Tournament` catalogue group can follow the same pattern as Fixture/
Training.

### Club Event — explicitly not available

An earlier pass in this project built `resolve-event-email-context.ts` and
an `eventSummaryBlock()` renderer against `public.club_events` and its
`club_event_teams` / `club_event_pitches` join tables, and added a full
"Event" catalogue group on the strength of it. That table set is Main's own
in-progress Event Centre work, developed in a separate, concurrent
workspace — it was never part of any commit on the branch this project
integrates against, so treating it as an already-reviewed, resolvable
domain was a mistake: the moment a build runs against the platform's actual
committed schema rather than a shared local database that happened to have
Main's uncommitted work applied, the resolver fails to compile (`public
.club_events` does not exist). The resolver, its renderer and the nine
"Event" catalogue items have been removed for the same reason Tournament
was never added: a database table existing (even one that will genuinely
land in Main soon) is not the same as a reviewed, product-ready, *committed*
domain for email. When Main's Club Event schema is committed, a
`resolveEventEmailContext` resolver and an `Event` catalogue group can be
rebuilt against the real, merged table shapes, following the same pattern
as Fixture/Training.

## Existing-template compatibility

Two production events had a variable renamed to a canonical key:

| Old key | New canonical key | Migration |
|---|---|---|
| `first_name` (club_welcome) | `recipient_first_name` | `VARIABLE_MAPS.club_welcome` produces BOTH keys with the same value; the catalogue marks `first_name` `deprecated: { replacedBy: "recipient_first_name" }`; `allowedVariables()` automatically includes a deprecated key when its replacement is declared. A published draft still reading `{{first_name}}` renders exactly as before. |

No other published key changed name. `match_cancelled` gained new optional
variables (`fixture_our_team`, `fixture_opposition_name`, etc.) — additive,
nothing existing broke.

## Recipient-relative Player/Guardian variables — a disclosed gap

`player_first_name`, `player_full_name`, `player_team_name` and
`recipient_relationship_label` are registered in the catalogue and their
ambiguity rule (single → available, none/ambiguous → unavailable, never a
guess) is proven by `supabase/tests/js/recipient_relative_context.test.mts`
(Phase 3, still passing). **No currently-wired email event actually renders
these per-recipient**, because `sendEmailEvent` (`lib/email/send.ts`) still
renders ONE piece of content and reuses it for every recipient of that
occurrence — there is no per-recipient render loop yet. Wiring one is real,
non-trivial work (it starts to look like the Broadcast Composer's own
personalisation engine), and building it was explicitly out of scope for
this pass ("Do NOT build Broadcast Composer yet"). The catalogue and the
ambiguity rule are ready for whichever future event needs them; the send
pipeline is not yet.

## Event-key compatibility matrix

| Event key | Wired? | Resolver | Recipient policy | Dynamic Data groups | Structured blocks | Preview scenarios | Real-send readiness |
|---|---|---|---|---|---|---|---|
| `club_invitation` | Yes | none (inline data) | `club_invitation` | Club, Account | club_crest | 1 | Live |
| `guardian_invitation` | Yes | none | `guardian_invitation` | Club | club_crest | 1 | Live |
| `player_account_invitation` | Yes | none | `player_account_invitation` | Player | — | 1 | Live |
| `safeguarding_officer_invitation` | Yes | none | `safeguarding_officer` | Club | club_crest | 1 | Live |
| `safeguarding_officer_message` | Yes | none | `safeguarding_officer` | Club | — | 1 | Live |
| `site_admin_invitation` | Yes | none | `site_admin_invitation` | — | — | 1 | Live |
| `partner_club_invitation` | Yes | none | `partner_invitation` | Club | — | 1 | Live |
| `club_claim_submitted` | Yes | none | `site_admin_inbox` | Club | — | 1 | Live |
| `club_welcome` | Yes | none | `club_claimant` | Recipient, Club | club_crest | 1 | Live |
| `support_ticket_reply` | Yes | none | `support_ticket` | Support | — | 1 | Live |
| `referral_reward_earned` | No (not yet triggered anywhere) | none | `club_billing_contact` | Referral | — | 1 | Content-ready, unwired |
| `match_cancelled` | Yes | `resolve-fixture-email-context.ts` | `fixture_participants` | Fixture, Opposition, Competition, Venue, Pitch, Match | match_summary | 2 (full data; missing pitch/meet-time/unclaimed opposition) | Live — proved end to end in Phase 4 |
| *(none yet)* | — | `resolve-training-email-context.ts` | — | Training, Venue, Pitch | training_summary | resolver live-proved against 3 real seeded rows | Resolver + block ready; no event exists |

## Searchable Dynamic Data UI

The existing Site Admin Dynamic Data panel (`app/(app)/admin/email/
[eventKey]/template-editor.tsx`) was extended, not rebuilt: search now
matches key, label, group and description; a "Recommended for this email"
section (from each contract's `recommended` list) appears above the full
grouped list; every card — scalar or structured/image — shows an
"Available when" line pulled from the catalogue; structured/image entries
render as non-insertable informational cards (generalising the existing
Club Crest special-case rather than duplicating it per block). Live-verified
in the browser against `match_cancelled` (the richest current event):
search, grouping, the Match Summary informational card, and double-click
insert all work end to end against real preview data.

## Amount of catalogue

47 registered items across 17 groups (Recipient, Player, Club, Team,
Fixture, Opposition, Match, Training, Venue, Pitch, Competition, Season,
Attendance, Brand, Account, Referral, Support). 2 structured blocks (Match
Summary, Training Summary). 1 deprecated key kept for compatibility. Event
is PLANNED / NOT AVAILABLE, the same as Tournament — see above.
