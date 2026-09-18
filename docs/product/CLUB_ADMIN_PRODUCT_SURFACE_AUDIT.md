# Club Admin product surface — recovery audit

**AUDIT ONLY. Nothing implemented, nothing changed, nothing released.** Current disk at `1d44960`.

Evidence: source archaeology, the live capability engine, and an isolated Playwright walkthrough as
the real UAT Club Admin (`uat.coach@ovalball.test`, Priya Nair, CLUB_ADMIN at Ovalball UAT RUFC).
Site Admin was not used as a substitute.

---

## The short answer

**Almost all of it exists and works. Very little of it is findable.** The Club Admin administration
product is close to complete behind two doors — a 16px unlabelled gear, and a hub page that hides two
of its own tabs — and one route that is linked from nowhere at all.

**UX-1, UX-2 and UX-3 removed nothing.** Proven below.

---

## 1. Did the UX programme break this? No.

`lib/app-context/build-nav-items.ts` — the single file that decides which navigation items exist —
has **zero commits** since UX-0 (`git log 905a247..HEAD` returns nothing for it). The only
navigation-adjacent changes in the whole UX programme were:

| Commit | Navigation change |
|---|---|
| UX-1 `795813b` | none |
| UX-2 `1ffdcb6` | **added** a mobile context bar; removed a dead `clubLogoUrl` prop from `AppNav`/`layout.tsx` |
| UX-3 `f2aa75f` / `1d44960` | none |

No capability-dependent rendering was touched, no administrative link removed, no label changed. The
nav a Club Admin sees today — Dashboard, Calendar, Fixtures, Messages, Partner Clubs, Documents,
People, Training Management, Deleted Calendar Events — is exactly what UX-0 recorded at the start.

**Verdict: NOT a UX regression.** The discoverability problem predates the UX programme, and UX-0
§3.4 and §4 flagged parts of it at the time.

## 2. The three real causes

### Cause A — a duplicated capability resolver hides two tabs *(this is a defect, not a design)*

`app/(app)/club/settings/resolve-nav-capabilities.ts` is the shared resolver, and its own comment
warns about drift. **`app/(app)/club/settings/page.tsx` does not use it.** It re-derives ten checks
inline and that list omits two:

- `people.capability.manage` → **Permissions** never appears
- `safeguarding.officer.nominate` → **Safeguarding Officer** never appears

(It also uses `club.guardians.manage` for Guardians where the shared resolver uses
`family.relationship.approve`.)

**The Club Admin holds both missing capabilities** — measured directly against the capability engine:

```
people.capability.manage      = true
safeguarding.officer.nominate = true
```

And the browser proves the consequence exactly:

| Page | Permissions tab | Safeguarding tab |
|---|---|---|
| `/club/settings` (**the hub everyone lands on**) | **no** | **no** |
| `/club` | **YES** | **YES** |
| `/club/venues` | **YES** | **YES** |

Both routes render perfectly when visited directly. **Capability held, UI present, entry point hidden
by a second resolver.**

### Cause B — one orphaned route

`/club/join-requests` — *"Players asking to join"*, capability-gated, functional — is **linked from
nowhere in the product**. The only references are its own `revalidatePath` calls. This is the answer
to *"someone used a team join code, where do I approve them?"*

### Cause C — the only door to club administration is an unlabelled gear

Everything except People lives under Club Settings, reached solely from a 16px gear beside the
identity block (`aria-label="Ovalball UAT RUFC settings"`, **no visible text**). UX-0 recorded this;
nothing has changed it. It *is* reachable on mobile, inside the drawer.

## 3. Implementation and reachability matrix

| Product function | Designed owner | Server | UI | Reachable | Who | Route | Status |
|---|---|---|---|---|---|---|---|
| People directory | Slice 7/8 | ✓ | ✓ | ✓ nav | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Club memberships (view) | Slice 4 | ✓ | ✓ | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Change club role | Slice 4 | `set_primary_club_role` | ✓ select | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Remove club access | Slice 4 | `transition_club_membership` | ✓ Remove + reason dialog | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Remove team role | Slice 4 | `remove_team_access` | ✓ | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| **Invite by email** | Slice 5 | `issue_invitation` | ✓ full form | ✓ behind "Invite someone" | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Role ceiling on invite | Slice 5 | `invitation_staff_role_options` | ✓ Member / Club Admin / Fixture Secretary | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| **Per-team roles on invite** | Slice 5 | ✓ `teamAssignments` | ✓ one select per team (Coach / Team Manager / Volunteer) | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| **Invite link** | Slice 5 | token returned once | ✓ shown once as `/join?t=…` | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** (no copy button) |
| Pending invitations | Slice 5 | ✓ | ✓ list | ✓ conditional | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Revoke invitation | Slice 5 | `revoke_invitation` | ✓ | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| **Resend invitation** | Slice 5 | — | — | — | — | — | **NOT BUILT** |
| **Human invitation code** | Slice 5 | returned at issue | **not surfaced** | ✗ | — | — | **SERVER COMPLETE / UI MISSING** |
| **Team join codes** | Slice 5 | `issue_invitation(TEAM_JOIN_CODE)` | ✓ `JoinCodeSection` | ✓ **team page only** | Club Admin + team staff | `/teams/[id]` | **COMPLETE BUT HARD TO FIND** |
| **Club join requests** | Slice 5/8 | `decide_club_join_request` | ✓ page **and** a section in `/people` | **orphaned page**; the `/people` section is conditional | Club Admin | `/club/join-requests` | **COMPLETE BUT HIDDEN** |
| **Custom / delegable permissions** | Slice 4 | `set_capability_override` | ✓ grouped panel with plain-English labels | **tab hidden** | Club Admin (`people.capability.manage`) | `/club/permissions` | **COMPLETE BUT HIDDEN** |
| **Volunteer (view only)** | Slice 4/8 | ✓ role + overrides | ✓ invite option + permissions panel | partial — panel hidden | Club Admin | `/people` + `/club/permissions` | **PARTIAL — the panel is unreachable from the hub** |
| **Safeguarding Officer** | Slice 4G | `safeguarding.officer.nominate` | ✓ page | **tab hidden** | Club Admin | `/club/settings/safeguarding` | **COMPLETE BUT HIDDEN** |
| Fixture Secretary assignment | Slice 4 | ✓ | ✓ via invite + role select | ✓ | Club Admin | `/people` | **COMPLETE + REACHABLE** |
| Guardian / family relationships | Slice 4a | `family.relationship.approve` | ✓ | ✓ Settings tab | Club Admin | `/club/settings/guardians` | **COMPLETE + REACHABLE** |
| Player moves | Side project | ✓ | ✓ | ✓ Settings tab | Club Admin | `/club/player-moves` | **COMPLETE + REACHABLE** |
| **Add a team role to an existing member** | Slice 4/8 | ✓ RPC exists | **removal only in UI** | ✗ | — | — | **SERVER COMPLETE / UI MISSING** |
| **"Why does this person have access?"** | Slice 8 | `explain_access` exists | — | ✗ | — | — | **SERVER COMPLETE / UI MISSING** |
| Suspend (vs revoke) membership | Slice 4 | `transition_club_membership` | revoke only | partial | Club Admin | `/people` | **PARTIAL** |
| Claim review | Slice 5 | ✓ | ✓ | ✓ | **Site Admin** | `/admin/claims` | **NOT DESIGNED FOR CLUB ADMIN** |
| Site-level roles/permissions | Slice 7 | ✓ | partial (7e) | Site Admin only | Site Admin | `/admin/*` | **INTENTIONALLY DEFERRED (7e)** |

## 4. The eleven journeys, walked

| Question | Answer |
|---|---|
| *New coach joining — how do I invite them?* | **Works.** People → "Invite someone" → email + club role + per-team role → Send. 3 interactions from the dashboard. |
| *Coach on U14 **and** U15?* | **Works.** The form renders one role select per team — 11 on this club — so different roles on different teams is supported. |
| *Volunteer who can view but not administer?* | **Half.** "Volunteer" is an invite option; tuning what they may do needs `/club/permissions`, whose tab is hidden. |
| *Fixtures Secretary?* | **Works.** Club role select offers Member / Club Admin / Fixture Secretary. |
| *Who has access to my club?* | **Works.** `/people`, in the nav. |
| *Why does this person have access?* | **Cannot be answered in the UI.** `explain_access` exists server-side; no surface. |
| *Remove someone's access?* | **Works.** Remove + reason dialog on the person row. |
| *Someone used a team join code — approve them?* | **Stops.** The `/people` section only appears when requests exist; the dedicated page is orphaned. |
| *Invitation sent yesterday — see / revoke / resend?* | **See ✓ revoke ✓ resend ✗.** The link is shown once at issue and never again (deliberate — only a hash is stored). |
| *Manage permissions?* | **Stops at the hub.** Reachable only by URL, or from `/club` or `/club/venues`. |
| *Appoint a Safeguarding Officer?* | **Stops at the hub.** Same cause. |

## 5. Recovery plan — smallest first

**RECOVERY (expected to exist now, and nearly does)**

| # | Fix | Why it is small |
|---|---|---|
| **R1** | Make `/club/settings/page.tsx` use `resolveClubSettingsNavCapabilities` | Deletes a duplicated resolver and restores **Permissions** and **Safeguarding Officer** to the hub. One import, one deletion. Highest value per line in this audit. |
| **R2** | Link `/club/join-requests` — from People, and as a Settings tab | An orphaned, finished page. |
| **R3** | Give the Club Settings gear a visible label, or a nav entry | The only door to club administration is a 16px icon. |
| **R4** | Surface team join codes where a Club Admin looks for them | Finished UI, currently only on each team page. |
| **R5** | Add a copy button to the invite link, and "Resend" | Small additions to a working form. |

**FUTURE (legitimately deferred — keep the owner)**

| Item | Owner |
|---|---|
| Add a team role to an existing member | Slice 8 — Club People & Access |
| "Why does this person have access?" (`explain_access` UI) | Slice 8 |
| Suspend (as distinct from revoke) | Slice 8 |
| Human invitation code surface | Slice 5 follow-up / Slice 8 |
| Site Admin master control (17 of 23 RPCs still without UI) | **Slice 7e** |
| Join-request approval surface for the entrance journeys | Slice 8 / 7e (already recorded in UX-0 §15 and UX-3) |

**R1 and R2 are one small slice.** They restore three finished surfaces without building anything.

**Recommendation: do R1–R3 before resuming UX-4.** A shell pass that styles navigation which is
still missing three of its destinations would be solving the wrong problem.
