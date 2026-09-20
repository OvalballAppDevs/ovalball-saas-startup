# Convergence Step 8 — archaeology

**Identity/Auth Slice 8 + operational role management.**

Read before anything was designed, and written from the checked-in design and
the running system rather than from memory. Every claim below was measured
against the local database, the migration tree or the source, and says which.

---

## 1. What Slice 8 canonically is

Not recalled — re-read from `docs/identity-auth/IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md`
§R, which is the authoritative remaining-contract register, and cross-checked
against `IDENTITY_AUTH_CLOSURE_LEDGER.md`.

> **Slice 8 — Club People & Access.** People & Access (AB.5), Effective Access
> with provenance and editing (AC), presets, club audit timeline. Tests: browser
> 47, 48, `explain_access` parity. **Acceptance: a Club Admin cannot reach site
> controls or other clubs, directly or via UI; delegation ceilings proven.**

Plus two rows the reconciliation assigns to Slice 8 by name:

| id | requirement | recorded status |
|---|---|---|
| **V-3** | Volunteer presets — "Pitch Allocation", "Calendar", "Team Fixtures"; AC.Presets requires *"Apply Preset … in one transaction with one event per override"* | **MISSED**, 0 preset tables |
| **X-4** | stale context invalidation | **PARTIALLY IMPLEMENTED** — fallback exists in `resolveActiveContext`; *"no test names the stale case explicitly"* |

**This is not a roles/permissions redesign.** Slices 1–7 are authoritative
dependencies and Fixture Operations (Step 7) is an accepted consumer.

### Prerequisite state, stated plainly

`IDENTITY_AUTH_CLOSURE_LEDGER.md` lists Slice 8's prerequisite as "the four
units above". Their actual status today:

| unit | status |
|---|---|
| Stage 0 — production TOTP | **CLOSED LOCALLY**; production enrolment remains an owner action |
| Slice 6b | largely delivered; **L11 still open** and belongs to 6b |
| Slice 7e | **DELIVERED, NOT RELEASED** |
| Test / perimeter closure | AO C12 closed; **C6, C10 and unwired-suite drift still open** (the latter is the programme ledger's L25) |

Step 8 proceeds under explicit authorisation with those carried items **still
owned by their own units**. Nothing belonging to Slice 6b, 7e or the perimeter
closure is absorbed here — that is the "silently stuff missed work into Slice 8"
the reconciliation prohibits.

---

## 2. Every operational role-management mutation that exists today

Measured: `pg_proc` in the local database for the RPC surface, then `grep` over
`app/` and `lib/` for callers. "NO UI CALLER" means no file in the application
names the function.

### Club-scoped — the Club Admin's own tools

| mutation | UI | server action | canonical effect |
|---|---|---|---|
| `set_primary_club_role` | `/people` person row | `app/(app)/people/actions.ts` | the membership's one primary club role |
| `set_team_access` | `/people/[membershipId]`, `/teams/[teamId]` | `people/actions.ts`, `teams/[teamId]/actions.ts` | team staff permission |
| `remove_team_access` | same two | same two | removes one team assignment |
| `transition_club_membership` | `/people`, Site Admin club page | `people/actions.ts` | membership state machine |
| `decide_club_join_request` | `/people` join-request row | `people/actions.ts` | approve/reject a club join request |
| `approve_player_club_join_request` | `/club/join-requests` | `club/join-requests/actions.ts` | approve and place a player |
| `set_capability_override` | `/club/permissions` | `club/permissions/actions.ts` | explicit grant/deny |
| `revoke_capability_override` | `/club/permissions` | `club/permissions/actions.ts` | clears an explicit decision |
| `issue_invitation` / `resend_invitation` / `revoke_invitation` | `/people` | `people/actions.ts` | Slice 5 invitation lifecycle |

### Site-scoped — master control (Slice 7e)

`site_assign_club_role` · `site_assign_team_role` · `site_add_club_membership` ·
`site_transition_club_membership` · `site_revoke_role_assignment` ·
`site_set_capability_override` · `site_link_guardian` ·
`site_end_guardian_relationship` · `site_request_site_admin_grant` ·
`site_approve_site_admin_grant` · `site_reject_site_admin_grant` ·
`site_revoke_site_admin` · `site_change_site_admin_profile`

All are reached from `app/(app)/admin/users/[userId]/master-control.ts` and
`app/(app)/admin/site-admins/actions.ts`. **Every one has a caller** — that was
7e's whole point, and it holds.

### Readers

| | |
|---|---|
| `explain_access(subject, capability, scope, club, team, player)` | returns `allowed, decisive_rule, reason_code, decisive_source, trail`. Called by `/people/[membershipId]` (ten separate questions, deliberately not batched) and by `lib/auth/require-capability.ts` |
| `club_member_capabilities(club, keys[])` | returns `user_id, capability_key, effective, source, override_id, decisive_rule, reason_code, override_level, editable`. Called by `/club/permissions` |
| `site_membership_history` · `site_family_history` · `site_team_history` · `site_account_history` | Site Admin timelines, built in 7e |

---

## 3. Findings — measured, each one a thing Step 8 must decide about

### F1. `assign_role` and `transition_role_assignment` have no UI caller

`public.assign_role(p_membership_id, p_role_key, p_team_id, p_reason)` is the
**canonical general role-assignment primitive**. It locks the club's people,
resolves the actor's level with `internal.club_people_authority` /
`internal.team_people_level`, and enforces the delegation ceiling directly:

```sql
if v_level is null or not (v_level = any (v_role.assignable_by)) then
  raise exception 'You are not authorised to give the % role at this club.' using errcode = '42501';
```

Nothing in `app/` or `lib/` calls it. `transition_role_assignment` likewise.
The club operator UI instead reaches the model through `set_primary_club_role`
(one primary role per membership) and `set_team_access` (a team permission), so
**`role_assignments` — 24 ACTIVE, 13 REVOKED rows locally — is writable from the
database and from Site Admin, but not from the club's own People screen.**

This is the most likely substance of AB.5: not new authority, but the canonical
authority becoming reachable by the person the design says owns it.

### F2. The delegation ceilings exist and are data, not code

`public.role_definitions`, read from the database:

| role_key | scope | label | assignable_by |
|---|---|---|---|
| `CLUB_ADMIN` | CLUB | Club Admin | `{SITE,CLUB}` |
| `FIXTURES_SECRETARY` | CLUB | **Fixtures Secretary** | `{SITE,CLUB}` |
| `MEMBER` | CLUB | Member | `{SITE,CLUB,SYSTEM}` |
| `SAFEGUARDING_OFFICER` | CLUB | Safeguarding Officer | `{SITE}` |
| `VOLUNTEER` | CLUB_OR_TEAM | Volunteer | `{SITE,CLUB}` |
| `COACH` | TEAM | Coach | `{SITE,CLUB,TEAM_ADMIN}` |
| `TEAM_ADMINISTRATION` | TEAM | Team Administration | `{SITE,CLUB}` |
| `TEAM_MANAGER` | TEAM | Team Manager | `{SITE,CLUB,TEAM_ADMIN}` |

Two things follow.

**Safeguarding Officer is `{SITE}`-assignable only.** A Club Admin cannot grant
it at all, which is the canonical expression of the eligibility rules Step 8 must
not let ordinary role editing bypass.

**L3 is visible here.** The catalogue says **"Fixtures Secretary"**; the rest of
the product says **"Fixture Secretary"**. The programme ledger carries this as
L3, *"the catalogue key/label inconsistency stays open for its schema owner"* —
and Slice 8 is the slice that owns the club role catalogue's presentation.

### F3. `TEAM_ADMIN` survives as a LEVEL name, not as a grantable role

`COACH` and `TEAM_MANAGER` carry `TEAM_ADMIN` in `assignable_by`. That string is
a **delegation-ceiling level** returned by `internal.team_people_level`, not a
role anybody can hold: `role_definitions` has no `TEAM_ADMIN` row — the canonical
role is `TEAM_ADMINISTRATION`, which replaced it (TA-1).

**Classification: compatibility level name.** Not a resurrection, and not
authority granted by a retired name. Slice 10 owns dropping the string.

### F4. There are zero preset tables

```
select count(*) from information_schema.tables
 where table_schema='public' and table_name like '%preset%';   -->  0
```

V-3 is genuinely unbuilt, exactly as recorded.

### F5. The Pitch Allocation capabilities exist, are delegable, and are absent from the one screen for the job

| key | valid scopes | delegable |
|---|---|---|
| `venue.pitch_allocation.view` | `{club}` | **yes** |
| `venue.pitch_allocation.manage` | `{club}` | **yes** |
| `venue.pitch.manage` | `{club}` | yes |
| `calendar.event.view` | `{club,team,child}` | yes |
| `calendar.event.manage` | `{club,team}` | yes |

`app/(app)/club/permissions/groups.ts` offers three groups — Fixture Operations,
Training Operations, Calendar and Events. **There is no Pitch Allocation group**,
so two legitimately delegable capabilities cannot be reached by the Club Admin on
the screen that exists for delegating capabilities. 73 of 239 capabilities are
delegable; this screen offers 10.

### F6. `/club/permissions` already edits, and already shows provenance

Contrary to a reading of the reconciliation's "(Slice 3 made it read-only)", the
panel calls `setClubCapability` / `clearClubCapability` and renders the source of
every answer through `SOURCE_LABEL` — *From their role · Granted · Withheld ·
Restricted by Ovalball · Not from their role* — plus a lock reason when
`editable` is false. **AC's editing and provenance halves exist.** What is
missing from AC is the **presets** (F4) and the reach (F5).

### F7. There is no club audit timeline

`pg_proc` holds `site_account_history`, `site_family_history`,
`site_membership_history`, `site_team_history` and `handover_audit`. **No
club-scoped equivalent exists.** Matches the reconciliation's "Club audit
timeline | Slice 8 | absent".

### F8. Browser suites 47 and 48 do not exist

`ls scripts/browser-verification/` has no `47-*` or `48-*`. Slice 8's named test
artefacts have never been written. They are not among L25's thirty-one
undeclared suites either — those are files that exist; these are files that do
not.

### F9. X-4's stale-context fallback exists and is untested by name

`resolveActiveContext` is consumed by ten modules including
`lib/app-context/active-context-rules.ts`, `require-active-site-admin.ts`,
`lib/fixtures/require-active-fixture-authority.ts` and
`lib/competitions/organiser-scope.ts`. The reconciliation's remaining work is a
test that **names the stale case**, not new behaviour.

---

## 4. What Step 8 therefore owns

| # | deliverable | basis |
|---|---|---|
| 1 | AB.5 — club People & Access reaching the canonical role model | §R, F1 |
| 2 | AC presets, applied in one transaction with one event per override | V-3, F4 |
| 3 | AC reach — every legitimately delegable capability the club owns | AC, F5 |
| 4 | club audit timeline | §R, F7 |
| 5 | `explain_access` parity after every mutation | §R |
| 6 | X-4 — a test that names the stale context | X-4, F9 |
| 7 | browser 47 and 48 | §R, F8 |
| 8 | the Fixture Secretary catalogue label | L3, F2 |
| 9 | acceptance: a Club Admin reaches no site control and no other club; delegation ceilings proven | §R |

## 5. What Step 8 does NOT own

L11 (Slice 6b) · C6 / C10 (perimeter closure) · L25's thirty-one suites beyond
those in this domain · L26 unless Step 8 touches that fixture · IMP-1 (Slice 9) ·
TA-1's string drop (Slice 10) · the Parent/Player response experience · rewards,
polls and awards · the application-shell contrast debt (L22).
