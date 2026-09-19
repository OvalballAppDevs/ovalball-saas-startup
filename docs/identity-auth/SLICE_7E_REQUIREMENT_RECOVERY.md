# Convergence Step 5 / Identity-Auth Slice 7 — requirement recovery

**Status: BLOCKED before implementation.** The blocker is an owner action in the
Supabase dashboard, not an engineering problem, and it is load-bearing for every
remaining row. Evidence below.

Recovered from `IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` §D.7,
`IDENTITY_AUTH_CLOSURE_LEDGER.md` and the live schema — not from any
conversational summary.

---

## 1. What Slice 7 still owns

Slice 7 is **Site Admin master control**. Eight of its thirteen rows are
PRODUCTION VERIFIED and are not reopened here. What remains, and who the
checked-in ledger gives it to:

| ID | Requirement | Status | Closure owner |
|---|---|---|---|
| **S7-4** | Q.3 master-control RPCs (20 of them) | **REGRESSED** — present, **unusable** | owner (TOTP) |
| **S7-5** | Users & Access detail tabs, AB.1's thirteen | PARTIALLY IMPLEMENTED — **17 of 23 RPCs have no UI caller** | **7e** |
| **S7-6** | Create User, AB.4's three-step wizard | PARTIALLY IMPLEMENTED — delivered single-step; the **Assignments** step is missing | **7e** |
| **S7-7** | `site_search_users` RPC | **MISSED** — absent; the search uses a view query | **7e** |
| **S7-8** | Two-admin Site Admin grant | IMPLEMENTED — **NOT ENFORCED**; no UI to raise or approve | AN-3 (rule) / **7e** (UI) |
| **S7-13** | AN-3 bootstrap procedure run | BLOCKED — OWNER ACTION | owner |

Verified against disk tonight: `public.site_search_users` **does not exist**
(S7-7 confirmed still missing).

**Explicitly NOT Slice 7**, and not pulled forward: impersonation (IMP-1, Slice
9), Volunteer presets (V-3, Slice 8), `team_admin` string retirement (TA-1, Slice
10), stale-context invalidation (X-4, Slice 8).

---

## 2. The blocker, with evidence

Every Q.3 master-control RPC goes through one preamble:

```
internal.master_control_preamble(capability, reason, target)
  -> internal.require_site_capability(capability)
  -> internal.require_recent_aal2(interval '10 minutes')   <-- here
  -> internal.require_reason(reason, true)
```

`require_recent_aal2` demands a TOTP factor verified within the last ten minutes.
The programme baseline records **0 TOTP factors** and **0 MFA enforcement
groups**, because production TOTP has never been switched on. So every one of
those RPCs raises for **everybody, including the Full Site Admin** — which is
precisely what S7-4 means by *"present, unusable"*.

The closure ledger sequences the work accordingly:

| Unit | Prerequisite |
|---|---|
| **STAGE 0** — production TOTP availability, then enrolment | — · **IN PROGRESS, OWNER ACTION REQUIRED** |
| SLICE 7e | **Stage 0** |
| AN-3 / T1+ | Stage 0 |

**Stage 0.1 is: enable TOTP enrol/verify in the production Supabase Auth
settings, with max factors 3.** It is a dashboard change by the platform owner.
Tonight's authorisation forbids production configuration changes, and rightly.

---

## 3. Why building 7e anyway would be the wrong call

The temptation is that the UI work is ordinary React and does not itself need a
TOTP. Three reasons not to:

1. **It would ship screens nobody can use.** Every control on the thirteen tabs
   calls an RPC that raises until Stage 0 is done. Slice 7's own audit already
   records "present but unusable" as a **regression**; adding a user interface in
   front of it would turn one regressed row into two.
2. **It cannot be proved.** The programme's standard is attack-first, with both
   the authorised positive path and the unauthorised negative path exercised.
   With zero factors in existence the positive path cannot be reached at all, so
   every test would assert denial only — which the authorisation names explicitly
   as not counting as authority coverage.
3. **The design says so.** 7e's prerequisite is Stage 0 in the checked-in ledger.
   Reordering it would be choosing a sequence the design already rejected.

`S7-7` is the one row that could be written without a factor — the missing
`site_search_users` RPC. It is left too, because it exists to serve the Users &
Access search in S7-5, and adding an RPC with no caller reproduces the exact
shape this slice is trying to close.

---

## 4. What unblocks it

| | |
|---|---|
| **Owner** | Enable TOTP enrol/verify in the production Supabase Auth settings (max factors 3) — Stage 0.1 |
| **Owner** | Enrol the existing Full Site Admin through `/account/security` — Stage 0.2 |
| **Claude** | Read-only verification that the factor exists, is verified, and enforcement is still off — Stage 0.3 |
| **Then** | 7e becomes buildable and provable: S7-5, S7-6, S7-7, S7-8's UI |

Nothing in Slice 7 is waiting on engineering. It is waiting on one setting and
one enrolment.
