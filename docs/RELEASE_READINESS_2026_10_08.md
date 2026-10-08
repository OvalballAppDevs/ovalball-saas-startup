# Release Readiness — 8 October 2026

Verdict: **NOT READY — BLOCKERS REMAIN.** (Updated after the 513/630 correction, `335283a`.) Nothing was pushed, deployed or applied to production. Every production
inspection was a read-only `SELECT` (Supabase MCP) against project `ywwdizmaanbujcfitpcj`.

## Blockers

1. ~~**Migration-time probes write into the database they run on (RED).**~~ **Resolved in `335283a`.**
   `20270513000000` and `20270630000000` now run their probe bodies inside a block that always raises a private
   SQLSTATE (`OVOK1`) its own handler catches, rolling back every probe write, audit and security rows included.
   Assertions unchanged (8 added lines per file, nothing removed). Proof on disposable databases: canonical isolated
   clean boot PASS, 118 suites, 4,528 checks, 0 failed; 0 probe rows afterwards in auth.users, profiles,
   club_directory, clubs, teams, venues, audit_log and security_events; each probe re-run as written passes with
   identical counts across ten tables before and after; each probe with one assertion deliberately broken aborts
   with its original error and leaves the same counts.
2. **No tested recovery path.** The only documented restore point is the 5 September 2026 manual dump
   (`docs/DEPLOYMENT_2026_09_05.md`). There is no evidence of current backups, point-in-time recovery or a rehearsed
   restore. Several pending migrations are irreversible (605 replaces a table with a view, 729 and 742 drop a column
   and functions, 757 merges conversations), so recovery would be a restore, not a rollback.
3. **Unsafe intermediate states under live traffic** (see the release sequence). The live site (`origin/main`
   `6d32f5b`) already expects 71 migrations production lacks, and pushing the 226 pending migrations while it serves
   traffic opens windows: 742 drops `request_/decide_player_dispensation`, which the live Player Moves page calls;
   605→608 exposes `tournament_team_entries` as an owner-rights view until 608 sets `security_invoker`; 729→731 lets
   a reminder fail its constraint. Production holds no dispensations, tournaments or events today, which limits —
   but does not remove — the exposure. A maintenance window is required.
4. **Source corrections proposed for 605 and 757 (owner decision; not applied).** See the section below. A
   maintenance page does not stop direct API access with existing tokens, and cannot guarantee 608 follows 605 if
   a push stops part-way, so the 605 exposure is best removed at source.
5. **Two authority defects in pending migrations (owner decision; not applied).** 605 drops the host-owned-or-
   reserved pitch check (only `20270217000000` ever had it) and nothing restores it; `count_tournament_age_group_impact`
   (`20270598000000`) is a definer function any signed-in user can call for any tournament, with no session or
   authority check. Neither has data to expose today (0 tournaments).

## Evidence

| Check | Result |
|---|---|
| Production ledger | 523 versions, `20260830143452`…`20270502000000`; repository 749; production-only 0 |
| Outstanding | **226** (`20270503000000`…`20270762000000`), none out of order; 71 already in `origin/main` |
| Drift | Baseline project booted from exactly the 523 migrations; fingerprints of 1,044 function bodies, 3,182 columns, 590 policies, 604 function grants, 234 table grants, 595 triggers and 8 catalogues are **identical** to production |
| Pending objects already present | none, except three generated columns 528/539/551 deliberately drop and re-add |
| Production data | 1 club, 4 profiles, 17 teams, 278 fixtures (external opponents), 1 text message, 2 guardians (`LEGACY_BACKFILL`), 2 attendance rows, 11 notifications, 2 venues, 2 pitches; no tournaments, events, payments, invitations, dispensations or requests; Union 26/27 covers today |
| Rehearsal | Production-shaped synthetic data; 226/226 applied in order, one transaction each, slowest 0.64 s; 278 fixtures kept; conversations 278 → 184 (production predicts 89 merges, 183 fixtures); upgraded schema identical to a fresh full-chain build |
| Post-upgrade suites | 20 authority and domain suites, 0 failures (two seed-dependent sections skipped themselves) |
| JavaScript | 165 files run one at a time, as the platform runner does: 1,973/1,973; web and mobile typecheck clean; mobile 290/290 |

## Migration 729 — `20270729000000_an_event_has_a_centre.sql`

Makes an event its own centre: four new tables (invitees, guests, responses, deliveries), 35 functions, event
answers moved off `player_fixture_attendance` (drops `event_id`, then requires exactly one of fixture, training or
tournament). Production: 0 attendance rows with `event_id`, 0 events, 0 communications; both attendance rows have
exactly one subject. Rehearsal: applied in 0.13 s. **PASS for today's data**, with two conditions the review found:
it has no backfill for an existing event at an external location (defaults to `VENUE`, which its own constraint
rejects), and it does not carry old event answers across. Both are safe only while production has no events, so the
count must be re-checked immediately before release.

## Migration classification (226)

- **RED (0):** 630 was RED (probe residue) — resolved in `335283a`. 605 and 757 carry the open proposals above.
- **AMBER (12 + 630):** 630 and 513 now only run self-rolling-back probes; 544 (installs `pg_net`, starts a per-minute geocoding job calling
  postcodes.io); 605 (tournament side model, owner-rights view until 608); 707, 755, 756 (push and messaging via
  `pg_net` to Expo); 716, 719 (dismiss existing notifications); 727 (match-award job); 729 (event reminders job,
  conditions above); 742 (drops functions the live web calls); 749 (GoCardless replay, inert until two Vault secrets
  exist); 757 (merges 183 fixtures' conversations — owner decision; catches errors per fixture, so verify the merge
  count afterwards).
- **GREEN (212):** applied cleanly in the faithful rehearsal, with no external dependency.
- **UNKNOWN:** none.

## Production configuration

- **Extensions:** `pg_cron` 1.6.4, `supabase_vault` 0.3.1, `pg_trgm` (public schema), `pgcrypto`, `uuid-ossp`,
  `pg_stat_statements` installed; `pg_net` 0.20.4 available, not installed — migration 544 creates it.
- **Vault (names only):** `invitation_code_pepper`, `recovery_code_pepper`. Missing for 749:
  `gocardless_replay_url`, `gocardless_replay_secret` (replay is inert without them; `docs/PRODUCTION_HOSTING.md`
  requires them before live mandates).
- **Scheduled jobs:** 7 today, 12 after the upgrade (adds GoCardless replay and its collector, venue geocoding, match
  awards, event reminders).
- **Edge function:** `address-lookup` v3 active, JWT verification on; needs `GOOGLE_PLACES_API_KEY`. Deployed code
  cannot be compared with the repository — redeploy it from the release commit.
- **Advisors, as production stands today:** two definer views (`public_venues`, `public_club_fixtures` — deliberate
  public projections), 12 functions callable by signed-out users (the declared public perimeter), leaked-password
  protection off.
- **Mobile:** new native modules (audio, video, notifications, device) need a new native build; not deliverable
  over the air.

## Proposed release sequence (for approval; not executed)

1. ~~Probe fix for 513 and 630~~ — **done** (`335283a`, clean boot PASS).
   Then: owner decides the 605 and 757 corrections and the two authority defects; any accepted change gets its own
   disposable proof and one more isolated clean boot before release.
2. **Recovery gate:** confirm the plan's backup and point-in-time recovery; take a fresh logical backup; restore it
   into a disposable project and verify it. Stop if the restore is not proven.
3. **Configuration:** confirm `GOOGLE_PLACES_API_KEY` is set; decide whether to add the two GoCardless replay Vault
   secrets and `GOCARDLESS_REPLAY_SECRET` in Vercel now or before live mandates.
4. **Re-check the data assumptions** read-only: events and event-attendance rows still 0, dispensations still 0,
   tournaments still 0, notification and guardian values unchanged.
5. **Maintenance window:** stop writes to the live site (maintenance page or Vercel protection) so no request
   reaches the intermediate schema.
6. **Migrations:** `supabase migration list --linked`, then `supabase db push --linked`. The standing rule is one
   migration at a time with a dry run and verification; across 226 migrations the owner should decide whether that
   rule holds or approves pushing in reviewed groups. Stop on any error.
7. **Verify:** ledger equals the repository; fixtures 278 with 184 conversations; no `trfix`/probe rows; 12
   scheduled jobs; `pg_net` installed; advisors show no new errors.
8. **Edge function:** redeploy `address-lookup` from the release commit.
9. **Web:** `git push origin main` (Vercel deploys), then end the maintenance window.
10. **Smoke tests:** sign-in, Club Admin home, fixtures and Match Centre, messaging, Season Planner, notifications.
11. **Monitor** for 24 hours: cron run history, `net._http_response` errors, push delivery, Vercel and Postgres logs.
12. **If something fails:** fix forward. The destructive migrations cannot be reversed; restore from the step-2
    backup only as a last resort.
13. **Mobile:** new native build and store release, separately.

## Independent review of 605–608 and 757 (Codex, static, read-only; key claims re-checked in code)

**605–608 — high severity, zero rows exposed today.** 605 creates `tournament_team_entries` as an owner-rights view
(no `security_invoker`) with `grant select … to authenticated` (605:653–677); until 608 sets `security_invoker`
(608:34) any signed-in user can read every host-side participant row of every tournament, private ones included
(participant, tournament, team and club ids, `invited_by`, timestamps). Base tables keep their RLS; no write
privilege is added; anon gets nothing. Production has 0 tournaments.
*Proposed change:* create the view `with (security_invoker = true)` in 605:653 and keep 608's `alter view` and
assertion (idempotent). *Risk:* low — the definer readers between 605 and 608 (`tournament_visible_row`,
`can_manage_tournament`, `get_tournament_centre`) keep definer execution; 606/607 read the canonical table, not the
view; the base SELECT grants predate 605.

**757 — high integrity risk: the migration can commit with an incomplete merge.** The per-fixture
`exception when others` (757:242–248) swallows any error — including existing validators (inactive owning team,
same-day shared-team capacity) — keeps that fixture on its old conversation, and only raises a notice; nothing
fails the migration. Both updates in the block roll back together, so a fixture is never repointed without its
messages. Production's 278 external-opponent fixtures still merge (89 groups by directory/text key), so 757 is not
a no-op there.
*Proposed change:* remove the inner exception block and `v_kept`, so any failure aborts 757 with its own error; add
end-of-migration `raise exception` checks that every opponent-key group has exactly one conversation and every
fixture-linked message shares its fixture's conversation. *Risk:* the push can stop at 757 on historical data we
cannot see (earlier migrations stay committed) — preferable to silently committing a partial merge, and checkable
read-only beforehand.
*Also reported (medium, empty today: 0 subscriptions, 0 read cursors):* the subscription merge can prefer an
inherited row's synthesised timestamp over a genuinely later mute; merged read cursors can skip older unread
messages. *Reported high, design-level:* a singleton fixture whose opponent changes keeps its conversation, so the
new opponent's staff could read earlier messages through the API — needs a decision on conversation authority.

## Separate findings

- **Messenger order:** the website's thread is still newest-at-top; the phone follows the owner's 7 Oct
  newest-at-bottom rule. A web parity item, not a release blocker.
- **Open product items:** H6 (native Import Fixtures and Competition Creator) remains open; Team Admin not started.
