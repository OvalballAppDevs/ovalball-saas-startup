# Ovalball convergence — Step 0: the whole-product map

**AUDIT ONLY. No implementation, no migration, no authority change, no release.** Disk at `b2bbf59`.

Evidence: source archaeology, the live capability engine, and isolated Playwright walkthroughs of five
contexts at desktop and mobile. The Club Admin audit (`b2bbf59`) is carried in whole.

---

## 1. Five-context product map

### Where each persona starts, and what they are given

| Context | Landing `h1` | Nav items | Landing sections | Verdict |
|---|---|---|---|---|
| **Site Admin** | `Site Admin: Platform` | **20** flat desktop / 4 grouped sections on mobile | Platform pulse · Rugby today · Rugby activity · Growth · Adoption · Needs attention · Platform state · Commercial | **Richest and best-organised surface in the product** |
| **Club Admin** | `Club: <club>` | **9** flat | Attention · Requests · Up Next · This Week · Notices · News | Complete but its administration lives behind an unlabelled gear |
| **Team staff** (manager @ U12) | `Team: <club>` | **5** — Dashboard · *Under 12 Boys* · Fixtures · Player Requests · Messages | This Week · Rugby Hub | **The team page itself is not in their navigation** |
| **Player** | `Player: <club>` | **6** fixed | Coming up · This Week · Rugby Hub | Coherent, thin |
| **Parent/Guardian** | `Family: All Children` | **6** fixed | Your Children · This Week · Your Clubs | **Best journey in the product**; child switching is in the mobile drawer |

### Context-by-context detail

**SITE ADMIN — 32 pages on disk, 18 in navigation.**
Grouped on mobile (Rugby Operations · Clubs & People · Commercial · Support & System) and **flat on
desktop**, which is backwards: the small screen has the better information architecture.
**Orphaned:** `/admin/safeguarding` (officer capability control across every club — linked from nothing
but its own action file) and `/admin/email-preview`. Reachable by drill-down only:
`/admin/clubs/data-quality`, `/admin/fixtures/import`, `/admin/commercial/referrals`.
No settings gear at all in Site Admin — deliberate (`resolveContextSettingsLink` returns null).

**TEAM STAFF.** Nav is Dashboard, the team's Calendar (labelled with the team name), Fixtures, Player
Requests, Messages. `/teams` (the list) is **club-authority-gated and refuses them**, while
`/teams/<id>` renders — so **their own team page is reachable only by URL**. The team page offers Join
code · Players · Parents · News. `/club/join-requests` is reachable to them (by design: *"a club
manager and a team manager both arrive here"*) and orphaned for them too.

**PLAYER.** Fixed six-link nav. "Coming up", "This Week", Rugby Hub. Payments reachable. No team page,
no availability surface of their own.

**PARENT/GUARDIAN.** Per-child cards with club, team, next event and four actions each. The mobile
drawer lists **All Children + each child by name** — the context switcher inline, which is exactly
right. Known backlog defects (Add Child inconsistency, child identity showing the wrong person,
player-shown-as-Parent/Guardian, additional-parent workflow, child→adult handover) are carried to
Step 9 unresolved.

---

## 2. Current navigation map, and every place it is built

| # | Constructor | Scope | Classification |
|---|---|---|---|
| 1 | `lib/app-context/build-nav-items.ts` | the whole authenticated shell, all six contexts | **CANONICAL** |
| 2 | `buildSiteAdminSections` (same file) | Site Admin grouping | **DERIVED FROM CANONICAL** |
| 3 | `app/(app)/nav-sections.tsx` | renders 1 + 2 for desktop **and** mobile | **DERIVED** — one renderer, correctly shared |
| 4 | `app/(app)/club/settings/resolve-nav-capabilities.ts` | Club Settings tabs | **CANONICAL for club settings** |
| 5 | `app/(app)/club/settings/club-settings-nav.tsx` (`TABS`) | the tab strip | **DERIVED** from 4 |
| 6 | **`app/(app)/club/settings/page.tsx`** | the Settings **hub** | **DUPLICATE — proven drift** |
| 7 | `app/(app)/club/rollover/handover-nav.tsx` | handover steps | LOCAL ONE-OFF (legitimate: a wizard) |
| 8 | `app/(app)/teams/[teamId]/team-people.tsx` | team sub-tabs | LOCAL ONE-OFF |
| 9 | `lib/app-context/public-header-identity.ts`, `components/club-home/club-chrome.tsx` | public club pages | **CANONICAL for public** |
| 10 | `app/(app)/dashboard/page.tsx` | landing shortcuts | DERIVED |

**Only #6 is drift**, and it is the proven cause of the hidden Club Admin features.

### Reproduced, and not reproduced

| Reported | Result |
|---|---|
| Site Admin mobile nav cannot scroll to all options | **NOT REPRODUCED.** At 320×640 with every section expanded: 22 links, container **scrollable**, overflow 735px, last item reachable. Also fine at 390. If real, it is device- or browser-specific (iOS Safari momentum / safe-area), which Chromium under Playwright will not show. **Needs a device repro before Step 1 treats it as a defect.** |
| Settings gear / close-X collision | **NOT REPRODUCED.** Measured `gearAndCloseOverlap: false` in every club-context drawer. A fix already exists in the code, with a comment describing the original collision. |

---

## 3. Proposed Step 1 information architecture

Grouped by job. **Nothing is deleted — everything currently reachable stays reachable**; maintenance
surfaces move out of prime navigation.

**SITE ADMIN** — apply the existing mobile grouping to desktop too, and adopt the two orphans.
```
Overview
Rugby Operations   Fixture Control Centre · Competitions · Calendar · Seasons ·
                   Team Directory · Pitch Allocation Defaults · Lookup Administration
Clubs & People     Club Management · Claims · Users & Permissions · Documents
                   ↳ Safeguarding Officers   ← adopts the orphan
Commercial         Commercial · Referrals
Platform           Support · Messages · Email Configuration · System Health ·
                   Release & Platform Mode · Site Admins
```

**CLUB**
```
Overview            (Club Desk)
People & Access     People · Invitations · Join Requests ← adopts the orphan ·
                    Permissions ← un-hidden · Guardians & Players
Fixtures & Calendar Fixtures · Calendar · Partner Clubs · Player Moves
Teams               Teams · Team Join Codes ← surfaced here as well as on each team
Communications      Messages · News & Announcements · Documents
Club Management     Club Profile · Venues & Pitches · Season Handover ·
                    Training · Safeguarding Officer ← un-hidden · Subscriptions · Ovalball Plan
                    ↳ Deleted Calendar Events   ← leaves top-level navigation
Rugby Hub
```

**TEAM**
```
Overview            ← the team page, finally in the navigation
People              Players · Parents · Staff · Join Code · Player Requests
Fixtures & Calendar Fixtures · Calendar · Availability · Training
Communications      Messages · Team News
Rugby Hub
```

**PLAYER** — `Home · My Fixtures · Calendar · Match Centre · Rugby Hub · Payments · Account`
**PARENT/GUARDIAN** — `All Children · <each child> · Fixtures · Calendar · Rugby Hub · Payments · Account`

**Rules this encodes:** Permissions sits **inside** People & Access, never elsewhere. Invitations and
join requests are part of People, not a separate product. Maintenance screens are not top-level. The
same grouping serves desktop and mobile.

---

## 4. Users & Permissions convergence map

| Surface | Scope | Concept | Canonical authority |
|---|---|---|---|
| `/people` | Club | members, roles, invitations, join requests | `set_primary_club_role`, `transition_club_membership`, `remove_team_access`, `issue_invitation`, `decide_club_join_request` |
| `/club/permissions` | Club | per-person capability overrides | `set_capability_override` |
| `/club/join-requests` | Club + Team | join requests | `decide_club_join_request` |
| `/teams/[id]` | Team | players, parents, staff, join code | `issue_invitation(TEAM_JOIN_CODE)` |
| `/club/settings/guardians` | Club | family relationships | `family.relationship.approve` |
| `/club/settings/safeguarding` | Club | officer appointment | `safeguarding.officer.nominate` |
| `/admin/users`, `/admin/permissions`, `/admin/site-admins`, `/admin/safeguarding` | Site | platform users, capability control | site capabilities |

**They already share one authority model** — `internal.capability_decision` / `internal.can`, through
the single app adapter `lib/permissions/has-capability.ts`. There is **no competing authority store**.
What is missing is one *product concept*: seven surfaces under six names, related only by the reader
knowing they are related. That is Step 2's job, and it is presentation and grouping, not authority.

---

## 5. Canonical source-of-truth table

| Concept | Canonical source | Consumers | Duplicates / drift | Owner step |
|---|---|---|---|---|
| **Club logo** | `resolveClubLogoPath` / `resolveClubLogoUrl` (`clubs` → `club_directory` fallback) | 17 files | **9 files read `logo_storage_path` raw**; 4 are consumer reads that skip the fallback (Messages ×2, `club/actions.ts`, `diagnostic-access.ts`) — the exact "no logo for a directory-only club" case the resolver's own comment names | **6** |
| **Club theme** | `resolveClubTheme` → `clubThemeVariables` → `ClubThemeScope` | Club Home, Club Desk | **none** — proven in UX-3 with two kits | — |
| **Person identity** | `resolveIdentityDisplay` | desktop sidebar, mobile drawer, mobile context bar | **none** since UX-2 | — |
| **Context** | `listSwitchableContexts` + `resolveActiveContext` | shell, dashboard, every scoped page | **none**; cookie is validated on read | — |
| **Roles** | `club_memberships.role` + `role_assignments` | People, invitations | none found | 2 |
| **Permissions** | `internal.capability_decision` / `internal.can`; adapter `hasCapability` | everything | `public.has_capability` remains as a **legacy DB adapter with no app caller** | **17** |
| **Invitation issuance** | `issue_invitation` | People invite, team join codes | **none** — one path, two kinds | 3 |
| **Invitation redemption** | `/join?t=…` + `guardian-invite`, `invite/site-admin` | — | three entry routes, one canonical redemption | 3 |
| **Club membership** | `club_memberships` + `transition_club_membership` | People, context | none | 2 |
| **Team membership** | `team_permissions` / `player_team_memberships` | team pages, context | **two tables, two meanings** (staff authority vs player registration) — correct, but easy to confuse | 8/10 |
| **Venues / pitches** | `club_pitches`, `venues` | `/club/venues`, allocation | to be confirmed | **6** |
| **Club lookup** | `club_directory` + `clubs` | signup, admin, partner clubs | none | 6 |
| **Team lookup** | `canonical_team_types_by_code` | directory, signup, teams | none — guarded by `rugby_code_isolation` | — |
| **Fixtures** | `fixtures` + Competition Match architecture | fixtures, calendar, Match Centre | designed, not audited here | **7** |
| **Navigation** | `build-nav-items` | shell | **`club/settings/page.tsx`** | **1** |

---

## 6. Hidden, orphaned and duplicate surfaces

| Surface | Class | Cause |
|---|---|---|
| `/club/permissions` | **HIDDEN** | settings hub omits `people.capability.manage` |
| `/club/settings/safeguarding` | **HIDDEN** | settings hub omits `safeguarding.officer.nominate` |
| `/club/join-requests` | **ORPHANED** | linked from nowhere |
| `/admin/safeguarding` | **ORPHANED** | linked from nowhere |
| `/admin/email-preview` | **ORPHANED** | linked from nowhere |
| `/teams/[id]` for team staff | **UNREACHABLE BY NAVIGATION** | `/teams` list refuses them; no nav entry for their own team |
| Team join codes | **HARD TO FIND** | team page only |
| `Deleted Calendar Events` | **MISNAMED PRIORITY** | a recycle bin in prime navigation |
| Site Admin desktop nav | **UNGROUPED** | grouping exists and is applied only to mobile |

## 7. Confirmed regressions vs genuinely unfinished

**Regressions (something once worked or should work and does not):**
1. **Club Settings hub hides Permissions and Safeguarding Officer** — proven: capability `true`,
   tab present on `/club` and `/club/venues`, absent on `/club/settings`.
2. **Nothing else.** `build-nav-items.ts` has **zero commits since UX-0**; UX-1/2/3 removed no
   navigation, no control and no capability-dependent rendering.

**Genuinely unfinished (never built):** resend invitation · human invitation code UI · add a team role
to an existing member · `explain_access` UI · suspend-vs-revoke · Volunteer permission tuning entry
point · Site Admin master control (17 of 23 RPCs without UI, Slice 7e).

**Not reproduced:** Site Admin mobile scroll; gear/X collision.

## 8. Backlog → programme step

| Item | Step |
|---|---|
| Settings-hub navigation drift; grouped IA for all five contexts; Deleted Calendar Events demotion; team page into team nav; adopt the three orphans | **1** |
| One Users & Permissions concept at site/club/team scope; `explain_access`; suspend-vs-revoke; add-team-role | **2** |
| Resend · copy link · human code · join-code surfacing · join-request approval | **3** |
| Remaining Identity/Auth Slice 6 (6b.2b SO-4, 6b.2c H-7, 6b.2d CSP, social closure, password/TOTP config, Stage 0) | **4** |
| Slice 7e Site Admin Users & Access; service-role key verification | **5** |
| Club first-login setup; venue/address/pitch; canonical club/venue/team data; **club-logo resolver adoption** | **6** |
| Fixture import · Control Centre · search/filter/week grouping · weather/postcode · calendar filtering · training management · pitch-split regression | **7** |
| Slice 8 + operational role management; team staff roles/badges | **8** |
| Family/add-child/add-parent · child→adult · availability | **9** |
| Team experience and visual design; availability counts | **10** |
| Polls · awards · Kudos · write-ups | **11** |
| Safeguarding · age-grade · rules content | **12** |
| Slice 9 impersonation | **13** |
| Governing Body foundation → product → workflow closure | **14–16** |
| Slice 10 legacy retirement; `public.has_capability` adapter removal | **17** |
| UX-4…UX-7 shell, mobile, accessibility | **18** |
| UX-8 signup/claim/join entrance journeys | **19** |
| Cookie consent · subscriptions/payments · support read-state · commercial/platform closure | **20** |
| Whole-product release audit | **21** |
| **QR / share links** | **unassigned — see blockers** |

Every Identity/Auth contractual owner from `IDENTITY_AUTH_CLOSURE_LEDGER.md` is preserved unchanged.

## 9. Architectural note — navigation is not authority

Step 1 will control what is **discoverable**. `internal.capability_decision` continues to control what
is **allowed**. A hidden nav item is not a boundary and must never become one — today's proof is that
two *hidden* features render perfectly when their URL is typed, which is correct.

If Site Admin ever configures club navigation, it must be **configuration over the canonical
destination catalogue, bounded by canonical capability rules** — never a second authorization system,
and never able to enable a destination the viewer lacks authority to use. Recorded; not implemented.

## 10. Blockers needing a human decision

1. **Site Admin mobile scroll** — not reproducible in Chromium at 320 or 390. Need a device/browser, or
   Step 1 proceeds on the grouping improvement alone and leaves the reported symptom open.
2. **Is `/teams` meant to refuse team staff?** They can reach their own team by URL but the list
   refuses them. Either the list should show the teams they hold, or the team belongs in their nav —
   this is a product call, not a bug fix.
3. **QR / share links** has no obvious owner: Step 3 (invitations) or Step 10 (team)?
4. **Does "Users & Permissions" replace the name "People"?** Step 2 needs the vocabulary settled; UX-0
   §15.7 already flagged that role/relationship words are overloaded.
5. **Volunteer (View Only)** — is Club-Admin-tunable permission a Step 2 product feature or Slice 8?
   The capability machinery exists; the ownership does not.
