# Slice 6b.2a — the session contract for SECURITY DEFINER RPCs

**Migration `20270501000000_session_liveness_for_definer_rpcs.sql`.** Closes the residual half of
**S6-9** that `b1f5c26` and `aa1b5bf` named and could not close without one.

---

## What was actually wrong

Phase 2 D.2 makes the database the authoritative enforcement layer, and that is a measurement rather
than a claim: 209 of 231 RLS-enabled public tables carry the RESTRICTIVE `session_ok_required` policy,
and `internal.capability_decision` refuses both a dead session and an unusable account, so every
capability-gated path inherits both checks.

**SECURITY DEFINER is the hole in that argument.** A definer function runs as its owner, so RLS does
not apply to it at all — the RESTRICTIVE policy every table relies on simply never runs. For a definer
function, the only authority is whatever the body states, and twenty-six browser-callable definer
functions that perform mutations stated it from `auth.uid()` alone.

`auth.uid()` reads a claim out of a JWT, and a JWT stays cryptographically valid until it expires. It
therefore survives **sign-out-everywhere** (which deletes the `auth.sessions` row, not the token), a
Site Admin **suspending** the account, and a Site Admin **disabling** it. For these twenty-six,
"revoked" meant "revoked for everything except these".

## The set is 26, not the 15 previously reported

The earlier figure was produced by a single direct-body regex over a narrower vocabulary and was an
**undercount**. Re-derived from first principles — a fixpoint over the call graph, so that reaching
the gate through a helper counts as reaching it — the set is **26**. All fifteen previously named are
inside it. The eleven that were missed are `accept_site_admin_invitation`,
`cancel_guardian_link_request`, `claim_responsible_payer`, `record_own_date_of_birth`,
`record_session_version`, `redeem_my_recovery_code`, `request_to_join_club`, `respond_to_attendance`,
`respond_to_event_attendance`, `respond_to_training_attendance` and `submit_public_support_ticket`.

The derivation is now a permanent test (`RPC-30`) and a self-check inside the migration, so the number
cannot quietly drift again.

## The frozen set, and what each one had

Every one of the 26 is `SECURITY DEFINER`, owned by `postgres`, `volatile`, and granted `EXECUTE` to
`postgres, service_role, authenticated` — plus `anon` for the one public exception. None is `STRICT`.

| # | Function | Existing authority | Session check | Mutation | Gate added |
|---|---|---|---|---|---|
| 1 | `accept_guardian_invitation(text)` | pending invitation token **and** exact email match | none | marks the invitation accepted | `session_ok` |
| 2 | `accept_site_admin_invitation(text)` | pending token, exact email, second-admin approval | `auth.uid()` not null | grant + invitation + notification | `session_ok` |
| 3 | `add_support_followup(uuid,text)` | ticket must be the caller's own and open | none | ticket event + touch | `session_ok` |
| 4 | `block_user(uuid)` | self-scoped; refuses self-target | `auth.uid()` not null | inserts the caller's block | `session_ok` |
| 5 | `cancel_guardian_link_request(uuid)` | request must have been made by the caller | `auth.uid()` not null | cancels request, closes relationship | `session_ok` |
| 6 | `claim_disabled_email_suppression(text,text,text)` | none beyond being signed in | `auth.uid()` not null | inserts a suppressed delivery | `session_ok` |
| 7 | `claim_email_delivery(…8 args)` | none beyond being signed in | `auth.uid()` not null | inserts a delivery claim | `session_ok` |
| 8 | `claim_responsible_payer(uuid,uuid)` | self or active guardian; club membership; pricing | none | payer row + finance audit | `session_ok` |
| 9 | `exit_diagnostic_club(uuid)` | row must belong to the calling site admin | none | ends the diagnostic session | `session_ok` |
| 10 | `mark_announcement_read(uuid)` | self-scoped by `recipient_user_id` | `auth.uid()` not null | marks deliveries/notifications read | `session_ok` |
| 11 | `mark_direct_conversation_read(uuid)` | self-scoped by `user_id` | none | marks notifications read | `session_ok` (LANGUAGE sql) |
| 12 | `record_billing_request(…5 args)` | payer subscription must be the caller's | none | inserts a GoCardless billing request | `session_ok` |
| 13 | `record_email_delivery_result(…7 args)` | **none** — see the finding below | `auth.uid()` not null | updates a delivery by id | `session_ok` |
| 14 | `record_own_date_of_birth(date,text,text)` | own profile; set-once; date validation | `auth.uid()` not null | writes DOB + security event | `session_ok` |
| 15 | `record_session_version(int)` | self-scoped | `auth.uid()` not null | upserts the caller's session version | `session_ok` |
| 16 | `redeem_my_recovery_code(text)` | one-time recovery code, throttled | `auth.uid()` not null | **removes every MFA factor** | `session_ok` **with AAL stand-down** |
| 17 | `request_to_join_club(uuid,uuid)` | self or active guardian; DOB and pathway | none | inserts a join request | `session_ok` |
| 18 | `respond_to_attendance(uuid,uuid,text)` | player must be in a team in the fixture | none | upserts an attendance response | `session_ok` |
| 19 | `respond_to_event_attendance(uuid,uuid,text)` | player involved in the event | none | upserts an attendance response | `session_ok` |
| 20 | `respond_to_training_attendance(uuid,uuid,text)` | player in the training team; not cancelled | none | upserts an attendance response | `session_ok` |
| 21 | `set_notification_preference(text,bool,bool)` | self-scoped; mandatory topics refused | `auth.uid()` not null | upserts the caller's preference | `session_ok` |
| 22 | `soft_delete_own_message(uuid)` | sender must be the caller | none | soft-deletes the message | `session_ok` |
| 23 | `submit_public_support_ticket(…6 args)` | validation + per-email rate limit | none | inserts a public ticket | **none — declared exception** |
| 24 | `touch_last_active()` | self-scoped | none | stamps `last_active_at` | `session_ok` (LANGUAGE sql) |
| 25 | `unblock_user(uuid)` | self-scoped | `auth.uid()` not null | lifts the caller's block | `session_ok` |
| 26 | `withdraw_player_club_join_request(uuid)` | player or active guardian | none | withdraws the request | `session_ok` |

**Expected behaviour, for all 25 gated:** a live session on an ACTIVE account behaves exactly as
before; a revoked session, a suspended account and a disabled account are all refused with
*"Your session is no longer valid. Sign in again."* before any statement of the body runs.

## Caller classification — why no service path breaks

§5 of the authorisation asks for this before a user-session predicate is imposed, because three of the
names (`claim_email_delivery`, `record_email_delivery_result`,
`claim_disabled_email_suppression`) look operational. They are not.

- **Application call sites:** every one of the 26 is called from exactly one or two files, and every
  one of those files obtains its client from `createClient()` — the request-scoped, user-session
  client. The three email functions are reached only through `sendEmailEvent(supabase, …)`, and all
  eleven importers of `lib/email/send.ts` pass a `createClient()` client.
- **Service-role callers:** the nine files that build a service-role client are the two webhook route
  handlers and the GoCardless payment library. **None of them reaches any of the 26**, directly or
  through `lib/email/send.ts`.
- **Database-internal callers:** none. No function in `public` or `internal` calls any of the 26.
- **Scheduled callers:** none. All seven `pg_cron` jobs call `internal.*` functions; not one names any
  of the 26.

Two of the three email functions already required `auth.uid() is not null`, which a service-role token
cannot satisfy — so they were never a service path to begin with. Nothing needed a service branch, and
none was invented; had one been needed, the authorisation says to stop rather than improvise, and that
is what would have happened.

## The two judgement calls, stated plainly

### `submit_public_support_ticket` is deliberately **not** gated

It is granted to `anon` because it is the public contact form. Requiring a live session there would
refuse the people it exists for, and it grants nothing an anonymous caller could not already do. It is
named in the migration's own self-check, in the permanent suite (`RPC-18`, which calls it with no
session at all and requires it to work), and here — a recorded decision rather than an omission.

### `redeem_my_recovery_code` gets the AAL stand-down

`internal.session_ok()` folds `session_aal_ok()`. The moment an MFA enforcement group is switched on,
every person in it who has not enrolled fails the predicate — correctly, for ordinary work. But
`redeem_my_recovery_code` exists to rescue somebody who **cannot reach their authenticator**. Gating it
on the unqualified predicate would lock the door from the inside: the one function that could restore
access would refuse you for lacking the thing you are trying to replace. That is the same shape that
locked the platform owner out on 17 September.

So it, alone, passes `p_allow_aal_elevation => true`. The elevated branch is still a real gate — the
session row must exist for this user and the account must still be usable — it stands down the
assurance question and nothing else. `RPC-24` and `RPC-25` prove the stand-down survives neither
suspension nor revocation, and `RPC-31` plus a migration self-check fail if any second caller appears.
This is the database half of D-S6B-AUTO-12.

## Findings recorded, not fixed

Two things were found while doing this that are **not** session-liveness defects and were therefore
left alone, per the standing rule that out-of-scope findings are documented and the owner schedules
them.

1. **`record_email_delivery_result` has no scope boundary at all.** Any authenticated caller can update
   any `email_deliveries` row by naming its id — status, provider, error text, suppression reason.
   Adding the session gate does not change that: a live, ordinary session still can. This is an
   authorisation gap, not a session one, and closing it needs a decision about who may record a
   delivery result.
2. **`internal` is granted `USAGE` to `authenticated`, and 227 `internal` functions are `EXECUTE`-able
   by it.** This is not currently reachable from a browser — PostgREST is configured with
   `PGRST_DB_SCHEMAS=public,graphql_public`, so `/rpc/` resolves only in `public`. It is recorded
   because it is one configuration line away from mattering.

A third was checked and is **not** a finding: three `public` views are not `security_invoker`, but two
(`public_club_fixtures`, `public_venues`) are public by design and the third
(`scheduling_group_membership`) was measured against an unrelated authenticated session and returned
exactly what that session could already read from the base table.

## Evidence

| Gate | Result |
|---|---|
| `supabase/tests/definer_rpc_session_contract.sql` (**new**, wired) | **37 / 37** — A/B/C/D for all 25, the public exception, the enrolment trap, the invitation boundary, two races, and the archaeology |
| Migration self-checks | 3 — archaeology clean, stand-down narrow, metadata preserved |
| `pg_proc` metadata before/after (26 functions) | **no drift** on args, return type, language, volatility, strictness, definer status, leakproof, parallel safety, `search_path`, owner, ACL or argument defaults |
| Function-body diff before/after | every changed line is an **addition**, and every addition is the guard or its comment |
| Mutation campaign | **16 mutants, 0 survivors** (M11–M16 are the migration's) |
| Clean boot from empty | **522 migrations**, then **168 SQL suites / 4258 assertions / 0 failures** |
| Production-shaped rehearsal | ledger 521 → migration → identical behaviour for every live ACTIVE call |
| Performance | guard **0.0425 ms/call**; **+0.046 ms** on the cheapest function in the set |

### Performance, in full

`internal.require_live_session()` costs **0.0425 ms** per call, measured over 500 calls after warm-up.
On `touch_last_active()` — the cheapest function in the set, and the one called most often — the end to
end cost goes from **0.1493 ms** to **0.1951 ms**, an addition of **0.0459 ms**. The percentage looks
large (31%) only because the baseline is 149 microseconds.

The gate's reads are `auth.sessions` by primary key, `public.profiles` by primary key and
`public.account_security_state` by primary key. **No index is added and none is needed**; the local
planner chooses sequential scans purely because those tables hold 0 and 17 rows. It runs once per call
and caches nothing — a stale session cache would be a second answer to the question `session_ok()`
already answers, which is exactly what the architecture forbids.

## The full runner, and the same honest caveat as before

**4906 assertions passed, 0 failed, across 233 suites.** That is exactly the previous
4869 plus the new suite's 37, which is the arithmetic that says nothing else moved.

It was not one process, and the reason is the machine rather than the code. One invocation of
`scripts/run-platform-tests.sh` reached **231 suites / 4869 assertions / 0 failures** — every SQL
suite, every JS suite, and browser suites 63 (12) and 64 (34) — and was then killed by the low-memory
guard part-way through suite 65. That has now happened three times, always in the Playwright half,
never with a test failing: Docker's VM alone holds 1.3 GB on this machine. Before this attempt the
disposable clean-boot and rehearsal databases were dropped, the production build was run separately
rather than alongside Playwright, and no other work was in flight; it was killed anyway. Suites
**65 (18/18)** and **66 (19/19)** were therefore run standalone straight afterwards, in the same shell
environment against the same disk.
