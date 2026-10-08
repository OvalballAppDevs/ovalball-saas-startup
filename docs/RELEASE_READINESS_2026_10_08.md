# Release Readiness — 8 October 2026

Verdict: **NOT READY — BLOCKERS REMAIN.** Updated after the pre-release security and migration corrections. Nothing
was pushed, deployed or applied to production. Every production inspection was a read-only `SELECT` (Supabase MCP)
against project `ywwdizmaanbujcfitpcj`; production still records 523 migrations, ending `20270502000000`, and none of
the corrected migrations (598, 605, 757, 763) is applied anywhere except the local development database, which was
deliberately not touched and now differs from the corrected source for those four.

## Remaining blockers

1. **No tested recovery path.** The only documented restore point is the 5 September 2026 manual dump
   (`docs/DEPLOYMENT_2026_09_05.md`). There is no evidence of current backups, point-in-time recovery or a rehearsed
   restore. Several pending migrations cannot be reversed (605 replaces a table with a view, 729 and 742 drop a column
   and functions, 757 merges conversations), so recovery would be a restore, not a rollback.
2. **Intermediate states under live traffic.** The live site (`origin/main` `6d32f5b`) already expects 71 migrations
   production lacks, and while the 227 pending migrations are pushed: 742 drops `request_/decide_player_dispensation`,
   which the live Player Moves page calls; 729→731 lets an event reminder fail its constraint; until 605, 598's
   management check still recognises entered teams through the old table. Production holds no dispensations,
   tournaments or events today, which limits — but does not remove — the exposure. Writes must be quiesced at the
   database/API level (a website maintenance page alone does not stop direct API calls with existing tokens).
   **Operations readiness (8 Oct, later):** both blockers now have rehearsed runbooks in `docs/release/` — a logical
   backup/restore proven on disposable stacks (Gate 1 still needs an owner-approved restore of a PRODUCTION backup)
   and a three-layer write quiescence proven 53/53 with the full 228-migration push inside the window (Gate 2 still
   NOT VERIFIED in production; preconditions P4, P9–P11 in `PRODUCTION_RELEASE_EXECUTION_PLAN.md`).
3. ~~**One audience decision.**~~ **Decided and implemented** (locked owner policy, `20270764000000`): an invitation
   belongs to the conversation it was given for. See "Invitation lifecycle" below.

## Corrections made (local, committed; not applied to production)

| Finding | Resolution | Proof |
|---|---|---|
| 513 / 630 probes left rows (and audit history) in the target database | Probe bodies roll themselves back (`335283a`) | 0 residual rows in 10 tables; a broken assertion still aborts; clean boot PASS |
| 598 `count_tournament_age_group_impact`: any signed-in user, any tournament | Live session + `internal.can_manage_tournament`, else `42501` | Stage proof immediately after 598: manager answered; same-club member, participating club, unrelated club, dead session and anon refused (7/7) |
| 605 `tournament_team_entries` owner-rights until 608 | Created `with (security_invoker = true)`; 608 unchanged and idempotent | Stage proof immediately after 605: unrelated admin and member read 0 via the view, as via the table; host reads its side; negative control (old owner-rights view) shows the same member WOULD read it (9/9) |
| 605 dropped the host-owned-or-reserved pitch rule | Restored on its own trigger, `internal.validate_tournament_game_pitch`; asks no pitch-allocation authority, so `venue.pitch_allocation.manage` stays the independent boundary | Host pitch and reserved pitch accepted; another club's pitch refused on insert and on update (a tournament may only reserve host pitches, an existing rule) |
| 757 catch-all per-fixture handler could commit a partial merge | Merge is `internal.merge_fixture_conversations_by_opponent()`: no handler, fail-fast; ends by asserting one conversation per opposing pair, no message left on a merged-away conversation, no message newly separated from its fixture's conversation (by identity), every fixture-request message's placement unchanged | Folded-team refusal aborts the whole merge, nothing half-merged; production-shaped rehearsal: 89 groups, 94 fixtures moved, 278 → 184 conversations, message kept with its fixture |
| 757 merge semantics: mute/leave and read positions | Latest real choice wins (synthesising triggers stand aside during the merge; ties go to left, then muted); read position = earliest still-unread point across merged threads; receipts and notifications untouched | Unmuted-later and left-on-tie cases; cursors before the first unread message; reading afterwards receipts the 3 never-read messages; 0 receipt and 0 notification changes |
| 757 kept a lone fixture's conversation when its opponent changed | A changed opponent always gets a fresh conversation (or joins the new opponent's) | Old messages stay where they were written |
| A new opponent could read the previous opponent's messages (pre-existing in production: authority came from the fixture's current sides) | `20270763000000`: conversations record their parties; a message in an earlier conversation is readable only by that conversation's parties and moderators, and is read-only; applied to the select policy, `can_access_message`, `can_read_attached_message`, `can_post_to_message`, the storage policy's path check, and replies | New opponent refused via table, receipts, reactions, reports, attachment rows, storage and replies; owning side and previous opponent keep it; club linked later does not inherit; nothing deleted |
| A side's manager could set `fixtures.conversation_id` or `mirror_fixture_id` directly and join any conversation | Server-owned: refused to a browser session (`a_fixture_conversation_is_server_owned`, runs first, SECURITY INVOKER) | Both refused; ordinary edits still work |
| 757's expression index ran a function signed-in writers could not execute: non-HOT client updates of fixtures failed intermittently ("permission denied") | `internal.fixture_opponent_key` executable by `authenticated` (pure, reads nothing) | Was failing 2 runs in 3; now 5/5 runs, 12 successive edits each |

Paths by which a fixture's opponent can change (all covered by row triggers, so no path can bypass them):
`update_fixture_opposition`, `accept_fixture_request`, `update_fixture_owning_team`, `claim_external_fixture_result`,
`internal.sync_competition_match_fixtures` (all definer), and direct client updates under row-level security. Nothing
disables triggers.

## Invitation lifecycle — `20270764000000_an_invitation_belongs_to_its_conversation.sql`

Locked policy: a conversation's invited participants belong to that conversation, not to whichever opponent occupies
the fixture. On an opposition change the original conversation and its history stay (read-only); its invitees keep
READ access unless explicitly revoked or withheld by safeguarding authority; the new opposition gets a separate
conversation; invitations are never transferred; the new opponent gets nothing historical; joining the new
conversation needs an explicit invitation; an explicit revocation overrides history.

| Path | Now |
|---|---|
| Invitation record | `fixture_conversation_participants.conversation_id`, stamped at creation, backfilled, frozen; one invitation per person per conversation. The backfill refuses to run if an invitation's fixture already changed opposition — shown by messages in an earlier conversation or by an audited opposition change after the invitation (it would otherwise transfer); production has 0 invitations |
| Current thread | admits an invitee only for the conversation they were invited to (through whichever fixture of the pair, a mirror included), with a live session and no explicit withhold |
| Earlier thread (messages, attachment rows, storage file, receipts) | admits that conversation's own invitees, read-only, with a live session and no explicit withhold |
| Explicit withhold | an active `messaging.fixture_conversation.participate` deny, scoped as the canonical resolver scopes it (site; a club withhold for either side's club; a team withhold for either side's team), ends invitation access and its notifications |
| Posting, reactions, replies, deletion | refused in an earlier conversation for everyone, authors included |
| Notifications | new-message notices reach an invitee only for their conversation; revocation also deletes the stored excerpts |
| Realtime / people list / invitation records | follow the conversation: a new opponent sees the new conversation's invitees, never the earlier list |
| Revocation | removes the person's invitations through the fixture to its current and every earlier conversation (mirrors included); a previous opponent's invitee can be revoked by the current sides |
| A future re-run of 757's merge | carries invitations with their conversation, including historical ones whose messages it moves |

Proof: `fixture_conversation_invitation_lifecycle` 43/43 on a production-shaped rehearsal (763 → data with
pre-existing invitations → 764 as an upgrade; backfill stamped 3/3), and in the canonical clean boot. Two independent
review rounds (Codex). Round one found seven defects — withholds and revoked sessions ignored on the historical path,
old invitee lists visible to the new opponent, previous-opponent invitees unrevocable, historical deletion, no realtime
for invitees, excerpts kept after revocation — plus backfill, merge and mirror risks. Round two confirmed those fixed
and found four more: a withhold on an unrelated team of the same club wrongly applied (over-strict scoping), withheld
invitees still notified, revocation not reaching an invitation held only on the mirror fixture, and a merge stranding
historical invitations; all corrected and covered. The suite also exposed one pre-existing limitation, now removed: an
invitation given through one fixture of a pair did not admit to the shared conversation through the other.
Note: three legacy SPECIAL_PURPOSE suites (`conversation_participation_management`, `conversation_add_participant`,
`unified_fixture_conversation`) cannot run on the current schema at all — their prerequisite `permission_matrix`
creates clubs without the long-required `directory_id` — so they were not usable evidence either way.

## Evidence

| Check | Result |
|---|---|
| Production ledger | 523 versions, `20260830143452`…`20270502000000`; production-only 0 |
| Outstanding | **228** (`20270503000000`…`20270764000000`), none out of order; 71 already in `origin/main` |
| Drift | Baseline booted from exactly the 523 migrations; fingerprints of 1,044 function bodies, 3,182 columns, 590 policies, 604 function grants, 234 table grants, 595 triggers and 8 catalogues **identical** to production |
| 763 preconditions in production (read-only) | 0 fixture messages without a conversation; 0 conversations shared by fixtures |
| Production data | 1 club, 4 profiles, 17 teams, 278 fixtures (external opponents), 1 text message, 2 guardians, 2 attendance rows, 11 notifications, 2 venues, 2 pitches; no tournaments, events, payments, invitations, dispensations or requests |
| Staged rehearsal (edited chain) | Disposable project at 598 → proof; +599–605 → proof; +606–756, production-shaped data, +757 → merge proof; +758–763 → full suite |
| Permanent suites | `release_hardening_corrections` 58/58 (five consecutive runs); `fixture_conversation_invitation_lifecycle` 43/43 |
| JavaScript | 165 files run one at a time: 1,973/1,973; web typecheck clean |
| Canonical isolated clean boot | **PASS — 120 suites, 4,629 checks, 0 failed** (includes `fixture_conversation_invitation_lifecycle` 43/43, `release_hardening_corrections` 58/58, `messenger_one_conversation_per_opponent` 19/19, `canonical_recipient_safeguarding` 24/24) |

## Migration 729 — `20270729000000_an_event_has_a_centre.sql`

Unchanged. Production: 0 attendance rows with `event_id`, 0 events, 0 communications. **PASS for today's data**; it
has no backfill for an existing event at an external location and does not carry old event answers across, so the
event count must be re-checked immediately before release.

## Migration classification (228)

- **RED (0).**
- **AMBER (13):** 513 and 630 (probes now roll themselves back); 544 (installs `pg_net`, per-minute geocoding job
  calling postcodes.io); 707, 755, 756 (push and messaging via `pg_net`); 716, 719 (dismiss existing notifications);
  727, 729 (scheduled jobs; 729's data conditions above); 742 (drops functions the live web calls); 749 (GoCardless
  replay inert until two Vault secrets exist). 605, 757 and 763 moved to GREEN on the evidence above, with 757's merge
  verified after the push (step 7).
- **GREEN (215)** (764 included). **UNKNOWN (0).**

## Production configuration

- **Extensions:** `pg_cron` 1.6.4, `supabase_vault` 0.3.1, `pg_trgm` (public schema), `pgcrypto`, `uuid-ossp`,
  `pg_stat_statements`; `pg_net` 0.20.4 available, not installed — migration 544 creates it.
- **Vault (names only):** `invitation_code_pepper`, `recovery_code_pepper`; 749 needs `gocardless_replay_url` and
  `gocardless_replay_secret` before live mandates.
- **Scheduled jobs:** 7 today, 12 after the upgrade.
- **Edge function:** `address-lookup` v3 active, JWT verification on; needs `GOOGLE_PLACES_API_KEY`; redeploy from the
  release commit.
- **Advisors, as production stands today:** two definer views (deliberate public projections), 12 functions callable
  by signed-out users (the declared public perimeter), leaked-password protection off.
- **Mobile:** new native modules need a new native build.

## Proposed release sequence (for approval; not executed)

1. ~~Owner decision on invited participants~~ — decided and implemented (764).
2. **Recovery gate:** confirm backups and point-in-time recovery; take a fresh logical backup; restore it into a
   disposable project and verify it. Stop if the restore is not proven.
3. **Configuration:** confirm `GOOGLE_PLACES_API_KEY`; decide on the GoCardless replay secrets.
4. **Re-check the data assumptions** read-only: events, event attendance, dispensations and tournaments still 0;
   no fixture message without a conversation; no conversation shared by fixtures.
5. **Quiesce writes** at the database/API level for the push.
6. **Migrations:** `supabase migration list --linked`, then `supabase db push --linked` (the owner decides whether the
   one-at-a-time rule holds across 227 migrations). Stop on any error — 757 and 763 now stop rather than half-apply.
7. **Verify:** ledger equals the repository; 278 fixtures in 184 conversations; no probe rows; 12 scheduled jobs;
   `pg_net` installed; parties recorded for every fixture conversation; advisors show no new errors.
8. **Edge function:** redeploy `address-lookup`.
9. **Web:** `git push origin main`, then lift the quiescence.
10. **Smoke tests** (sign-in, Club Admin home, fixtures and Match Centre, messaging, Season Planner, notifications) and
    **monitoring** for 24 hours.
11. **If something fails:** fix forward; restore from the step-2 backup only as a last resort.
12. **Mobile:** new native build and store release, separately.

## Independent reviews (Codex, static, read-only; claims re-checked in code)

- **Before the corrections:** 605's owner-rights window, 757's swallowed failures, the dropped pitch rule, the
  unguarded 598 count and the opponent-change disclosure — all confirmed and corrected above.
- **After the corrections:** no remaining ordinary-user path found that discloses earlier messages or files to a new
  opponent. Reported and then fixed: a reply could reference a message from the earlier conversation (now refused);
  the merge assertions compared counts rather than identities (now identities, and the full request-thread state);
  763 now refuses to run if any fixture message lacks a conversation or any conversation is shared across opposing
  pairs (both 0 in production). Reported and left for the owner: invited participants (blocker 3). Noted: realtime
  topics still follow the fixture's current sides, so an earlier conversation's parties may stop receiving live
  events for it (broadcasts carry no content).

## Separate findings

- **Messenger order:** the website's thread is still newest-at-top; the phone follows the owner's 7 Oct
  newest-at-bottom rule. A web parity item, not a release blocker.
- **Open product items:** H6 (native Import Fixtures and Competition Creator) remains open; Team Admin not started.
