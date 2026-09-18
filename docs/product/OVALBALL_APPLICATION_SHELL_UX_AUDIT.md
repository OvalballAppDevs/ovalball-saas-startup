# Ovalball application shell — UX-0 audit

**Status: AUDIT ONLY. Nothing implemented, nothing released, no migration, no authorisation change.**
Production baseline is `e4e8c59`, ledger **523**, tip `20270502000000` (Slice 6b.2a, production verified).

This is Track B. It does not replace, cancel or rewrite the Identity/Auth programme, which is
reproduced as a live control table in §1 and remains the gate on release.

---

## 1. Identity/Auth programme control plane

Recovered from `IDENTITY_AUTH_CLOSURE_LEDGER.md`, `SLICE_6B_CLOSURE_MANIFEST.md`,
`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` and the banked slice records — **not from memory**. Rows
keep their original owner. Nothing below is absorbed into a UX slice.

| # | Requirement / checkpoint | Original owner | Current status | Production | Next action | Blocker / dependency | Must precede |
|---|---|---|---|---|---|---|---|
| **S6-9** | `requireSession` on every protected boundary | Slice 6 | **CLOSED** | **VERIFIED** `3b60d3f`, ledger 522 | — | — | — |
| **S6-8** | Suspended/disabled has no usable authority | Slice 6 | **enforcement CLOSED**; `/account/suspended` intentionally unreachable (D-S6B-AUTO-10) | VERIFIED | record only | — | — |
| **NEW-2** | Email-delivery result bound to its claimant | found in 6b.2a review | **CLOSED** | VERIFIED `67ee056`, ledger 523 | — | — | — |
| **A / SO-4** | Canonical `auth_flow_states` (S5-7) | Slice 5 → 6b | **NOT STARTED** — dead schema, 0 callers, 0 rows | not present | begin 6b.2b | — | H-7 retirement; social closure |
| **B / H-7** | Retire `ovalballSignupPayload` (S5-6) | Slice 5 → 6b | **NOT STARTED** — 3 live occurrences | live | 6b.2c | **6b.2b** (SO-4 replaces the binding) | Slice 10 legacy retirement |
| **C / S6-17** | Security headers, CSP, cookie `secure` | Slice 6 → 6b | **NOT STARTED** — none present | none | 6b.2d | — | — |
| **D / SO-1…SO-7** | Social closure: Google end-to-end, social+MFA composition, linking/unlinking, Linked Sign-In Methods UX (S6-16), Apple, Facebook | Slice 6 → 6b.4 | **PARTIAL** — SO-7 code repaired and deployed; **Google is enabled in production**; no provider UAT | Google live | real Google journey UAT | 6b.2b (flow state carries onboarding context) | — |
| **E / S6-2, S6-5** | Password policy on every setting surface (≥12, ≤72 bytes, uppercase, special, breached) | Slice 6 → 6b.1 | **code CLOSED** | deployed | verify prod GoTrue config | — | — |
| **E′ / S6-3** | GoTrue native `minimum_password_length` = 12 | Slice 6 → 6b.5 | **REGRESSED** — config half outstanding | unverified | dashboard read + set | **owner, Supabase dashboard** | — |
| **F / S6-4** | Leaked-password protection in production | Slice 6 → 6b.5 | **NOT CONFIGURED** (app HIBP fails closed) | advisor: disabled | dashboard | **owner** | — |
| **G / Stage 0** | Production TOTP availability, max factors 3, **no** enforcement | Stage 0 | **BLOCKED — OWNER ACTION** | 0 factors | enable in dashboard | **owner** | H, I, J, K |
| **H** | Owner TOTP enrolment | Stage 0 | pending | 0 factors | enrol via `/account/security` | **G** | J, K |
| **I** | Recovery / break-glass production operability | S6-11 → 6b.5 | code complete, unconfigured | — | dashboard + rehearsal | **G** | K |
| **J / AN-3** | Second Full Site Admin | AN-3 / T1 | **NOT STARTED** — 1 pending invitation, untouched | 1 admin | T1 bootstrap | **G, H** | K (T1+) |
| **K / T1–T5** | Staged MFA enforcement | AG.2 | not started | T0 | per-stage gates | **J** | L |
| **L / T6** | Magic-link retirement | AG.2 | not started | live | — | **K** | Slice 10 |
| **M / Slice 7e** | Site Admin Users & Access master-control UI (17 of 23 RPCs have no UI) | Slice 7a/b/c → 7e | **NOT STARTED** | RPCs live, UI absent | 7e | Stage 0 | Slice 8 |
| **N / S7-8** | Two-admin Site Admin grant usable through product | Slice 7c → 7e | rule exists, **unusable without UI** | rule live | 7e | — | J |
| **O** | Production `SUPABASE_SERVICE_ROLE_KEY` for Create User | Slice 7b → 7e | not verified | unknown | config verification | — | M |
| **P** | Test/perimeter closure: 105 unwired SQL suites, `function_search_path_mutable` 73→0, `pg_trgm` out of `public`, service-role guard, **`internal` least privilege** | Slice 1 → Test closure | **NOT STARTED**; `internal` finding recorded in `SLICE_6B2A_INTERNAL_SCHEMA_PERIMETER.md` with a wired guard | guard live | triage | — (parallel) | — |
| **Q** | Legacy invitation paths/columns retirement | Slice 10 | not started | live | — | **B** | — |
| **R** | Slice 8 — Club People & Access | Slice 8 | not started | — | — | 6b, 7e, test closure | — |
| **S** | Slice 9 — controlled impersonation | Slice 9 | not started | — | — | Slice 8 | — |
| **T** | Slice 10 — final legacy retirement | Slice 10 | not started | — | — | B, L, Q | — |

**Superseded / completed since the ledger was written, with evidence:** S6-9 (commit `3b60d3f`,
production ledger 522, archaeology returns 0); S6-8 enforcement (browser suites 65/66, production
route checks); S6-6 `/forgot-password` and S6-7 `/account/setup` (6b.1, `c03e2b8`); NEW-1 social
Turnstile null token (`b1f5c26`, deployed in `e4e8c59`). Everything else above is still open.

---

## 2. What was actually observed

**Instrument.** A throwaway observation script (kept outside the repository, in the session scratchpad)
built on the existing `scripts/browser-verification/harness.mjs`. It signs in, records what renders and
screenshots it. It changes nothing and is **not** a permanent suite. This is the only tooling UX-0 added.

**Personas observed** — all local disposable UAT identities; no production identity was used, none was
created, and the owner's browser was not touched:

| Persona | Identity | Authority |
|---|---|---|
| Full Site Admin | `uat.fullsiteadmin@ovalball.test` | site admin `full` |
| Club Admin | `uat.coach@ovalball.test` (Priya Nair) | CLUB_ADMIN |
| Guardian | `uat.guardian.one@ovalball.test` (Marcus Bell) | 3 children |
| Player | `uat.player.self@ovalball.test` (Rowan Whitaker) | player |
| Team staff | `uat.team.admin@ovalball.test` | BASIC_USER + team |

**Viewports:** 1440×900 desktop, 834×1112 tablet, 320×720 mobile (plus 390×844 for the signup trace).
**25 observations, 15 screenshots** of landing, account and security per persona.

### NOT OBSERVABLE

- **A genuinely multi-context person.** No local identity holds Site Admin **and** a club role **and** a
  team role **and** a guardian link **and** a player record at once. §3's worked example — the single
  most important thing the context switcher exists for — could not be exercised. Everything said below
  about multi-context switching is from single-relationship personas and from code, and is marked so.
- **Multi-club membership.** No persona belongs to two clubs.
- **A club with populated news, notices, requests and player moves.** Every Club Desk observed was
  largely empty, so the "busy club" layout is unproven.
- **Screen-reader semantics.** Only inspectable properties were recorded; no assistive-technology run.
- **Production UI.** All observation was local. The deployed bundle was only probed structurally.

---

## 3. The first 60 seconds, per persona

Everyone lands on **`/dashboard`**, which then renders a different page per context. That single route
is doing five jobs.

| Persona | H1 | Nav items | What tells them the context | What needs attention |
|---|---|---|---|---|
| Full Site Admin | eyebrow **SITE ADMIN** + **Platform** | 20 (grouped into 4 sections) | **clearest in the product** | counts, "Rugby Today" |
| Club Admin | **Ovalball UAT RUFC** | 9 (flat) | crest + club name + "Club Admin" | nothing — three empty states |
| Guardian | **All Children** | 6 (fixed) | "Marcus Bell / Parent/Guardian" + child cards | "1 attendance response needed" |
| Player | **Ovalball UAT RUFC** | 6 | club name only | — |
| Team staff | **Ovalball UAT RUFC** | 3 | club name only | — |

**Finding 3.1 — the page never says what it is.** For three of five personas the `<h1>` is the *club
name*. A club admin, a player and a team volunteer all get the identical heading, "Ovalball UAT RUFC",
despite having completely different authority. Site Admin is the exception and gets it right: an
eyebrow naming the context (`SITE ADMIN`) above a heading naming the page (`Platform`). That pattern
should be the rule.

**Finding 3.2 — the sidebar identity block names the scope, not the person, for club contexts.** The
guardian's block reads "**Marcus Bell** / Parent/Guardian". The club admin's reads "**Ovalball UAT
RUFC** / Club Admin". The standing product rule is that this block names the signed-in person; the club
context breaks it. The person's name survives only in the greeting, which scrolls away.

**Finding 3.3 — the context switcher is invisible when you have one context, and undiscoverable when
you have several.** It is a small ⇅ chevron beside the identity block, shown only when there is
something to switch to. A person with one club never learns the control exists, so the first time they
gain a second relationship they have no mental model for it. On mobile it is not in the header at all.

**Finding 3.4 — "Deleted Calendar Events" is a top-level navigation item** for a Club Admin, beside
People and Fixtures. A recycle bin is not a primary destination.

**Finding 3.5 — Site Admin nav is grouped; club nav is not.** Site Admin's 20 items are organised into
Rugby Operations / Clubs & People / Commercial / Support & System. The club's 9 are a flat list. The
grouping machinery already exists (`buildSiteAdminSections`) and is applied to exactly one context.

---

## 4. Information architecture map

| Tier | Destinations (as built) |
|---|---|
| **Global** | `/dashboard`, `/calendar`, `/rugby-hub`, `/messages`, `/notifications`, `/support` |
| **Platform** | `/admin/*` — 18 pages in 4 groups |
| **Club** | `/people`, `/documents`, `/partner-clubs`, `/club/training`, `/club/settings` (via gear), `/club/player-moves`, `/club/calendar/deleted-events` |
| **Team** | `/teams/[id]/player-requests`, `/fixtures/management`, team-scoped `/calendar` |
| **Child / family** | `/agenda`, `/parent/children`, `/guardian-requests`, `/player/payments` |
| **Personal** | `/account`, `/account/security`, `/profile` |
| **Public** | `/clubs/[slug]` (Club Home), `/rugby-hub`, `/signup`, `/join`, `/login` |

**IA problems found**

- **Tier confusion.** `/calendar` is global in the nav but its *label* changes to the active team's
  name in a team context, so the same list position means "everything" or "one team" depending on
  state the user cannot see.
- **"Settings" is overloaded.** In the parent/player nav, "Settings" is `/account` (personal). Beside
  the club identity block, the gear is `/club/settings` (club configuration). Same word, two tiers.
- **Club Settings and Season Rollover are deliberately not in nav** (a documented decision) and are
  reachable only through that gear. Correct instinct, but the gear is a 16px icon with no label.
- **No return path is expressed.** `/rugby-hub` and the public Club Home are linked *out of* the
  operational app with no breadcrumb back; Club Home opens with an external-link icon.
- **`/dashboard` is five pages.** Routing by context is right; giving them one URL and one name is not.

---

## 5. Journey findings

| Journey | Observed | Finding |
|---|---|---|
| **J1** sign in → destination | `/login` → `/dashboard` | works; destination is context-correct |
| **J2** dashboard → club work | 1 click to People/Fixtures | fine on desktop |
| **J3** switch context → task | **NOT OBSERVABLE** (no multi-context persona) | — |
| **J4** parent → child | child cards carry Fixtures / Calendar / Rugby Hub / Match Centre | **best journey in the product** |
| **J5** team staff → team | nav has 3 items | thin; no team identity anywhere on the page |
| **J6** club admin → People/Teams | 1 click | fine |
| **J7** Site Admin → platform → back to club | **NOT OBSERVABLE** | — |
| **J8** app → public Club Home → back | "View Club Page" opens out | **no return path** |
| **J9** app → Rugby Hub → back | in-app nav item | fine |
| **J10** account → security → back | `/account` → `/account/security` | both reachable; H1 "Edit Personal Profile" is a task name where a destination name belongs |
| **J11** mobile equivalents | all nav behind a hamburger | see §7 |

---

## 6. Desktop findings

1. **The "Your Next Match" card overlaps the club header banner**, and the banner's decorative stripe
   pattern renders as hard grey/green bands behind it. It reads as a rendering fault. *(Club Desk,
   1440px.)*
2. **The Club Desk is mostly empty space.** One fixture row, then ~500px of nothing in a two-thirds
   column, with three consecutive empty states stacked in the right rail. The dominant message a Club
   Admin receives is that there is nothing here.
3. **Two floating overlays compete** — "Ask Ovie" bottom-right and a circular avatar bottom-left, both
   over content.
4. **Site Admin's "Platform Pulse"** is the strongest page in the product: labelled counts, an explicit
   note that players and parents are separate populations, and a real "addressable market, not
   customers" caveat. It sets the honesty bar the rest should meet.

## 7. Mobile findings (320px)

**No horizontal overflow at any viewport for any persona** — `scrollWidth === innerWidth` at 320, 834
and 1440 throughout. That is a real, already-won property worth protecting.

1. **The club name is clipped mid-word** in the Club Desk header at 320px ("OVALBALL UAT RUF…"), with
   the decorative stripes running across it.
2. **"Your Next Match" overlaps the header** worse than on desktop, covering the role label.
3. **All primary navigation is behind a hamburger.** For a product whose highest-frequency users are
   parents and coaches checking a fixture on a phone, the most common destinations cost two taps and a
   drawer.
4. **The context switcher is absent from the mobile header.** Changing club/child/team on a phone
   requires opening the drawer first — and for a guardian, child context is the single most common
   thing they need to change.
5. **"Ask Ovie" and the avatar bubble both sit over the bottom of a 320px screen**, where the content
   is.
6. **Site Admin mobile is the cleanest** — eyebrow, heading, description, then cards. It survives 320px
   because it states its context in text rather than in a decorated banner.

## 8. Accessibility findings

- Heading structure is present and single-`h1` per page on every page observed.
- **The `h1` is frequently not the page name** (§3.1), which is what a screen-reader user hears first.
- The context switcher is an icon-only control with no visible label.
- The club-settings gear is icon-only with no visible label.
- Club-header text is white on a mid-green photographic/striped background; **contrast is not
  measurable from the screenshot and was not measured** — flagged for UX-7 rather than asserted.
- Focus visibility and keyboard traversal were **not** exercised. NOT OBSERVABLE in this pass.

---

## 9. Club Desk — what should be where

| Priority | Content | Rationale |
|---|---|---|
| **Above the fold** | who you are · which club · which role · the single next thing needing you | Observed: a Club Admin currently sees a decorative banner and three empty states |
| **Primary** | needs-attention items (requests, responses, moves), this week's fixtures | The guardian's "1 attendance response needed" is the model |
| **Secondary** | club notices, club news | |
| **Conditional** | player moves, join requests, deleted events | |
| **Hidden when empty** | notices, news, requests | Three stacked "nothing here" cards is the current default state |
| **Never** | invented metrics | Site Admin's counts are real and labelled; do not manufacture club equivalents |

## 10. Your Clubs / multi-context

`Your Clubs` appears as a right-rail card in the guardian view ("Open a club to see its notices, news
and fixtures"). It is a **club** list in a product where a person may hold platform, club, team, family
and player relationships at once.

Options, from observation (no rename proposed yet, per instruction):

- **(a)** keep `Your Clubs` as a clubs-only list and add sibling lists for children/teams;
- **(b)** one "Your Ovalball" surface listing every relationship, grouped by tier;
- **(c)** fold it entirely into the context switcher and remove the card.

**Recommendation: (b)**, because the guardian view already proves the pattern works — per-child cards
with a club, a team and the next event are exactly what a per-team or per-club card should look like.

## 11. Context switcher findings

| Question | Observed |
|---|---|
| Discoverable? | **No** — a small ⇅ beside the identity block, absent entirely for single-context people |
| Current context visible? | Yes on desktop, in the identity block |
| Hierarchy shown? | **NOT OBSERVABLE** (single-relationship personas only) |
| Persistence | Cookie-backed (`set-context.ts`, `switch-context-provider.tsx`) |
| Mobile | **Not in the header at all** |
| Does switching change permissions? | **No — and this is correct.** `buildNavItems` filters an already-resolved permission set; every route re-checks server-side. Parent/Player contexts deliberately force `hasClubFixtureAuthority = false` so a multi-role account cannot leak club authority into a parent view |

The underlying model is sound and already documented in code. **The defect is entirely presentational:
the product never explains that identity is constant and context is a lens.**

## 12. Site Admin findings

Site Admin is already visually distinct — eyebrow, "Platform", grouped navigation, its own dashboard —
and `buildNavItems` deliberately never superimposes club and platform navigation. That is the right
model and should not be diluted.

Gaps: there is no visible "you are in platform administration, leave it here" affordance, and no
observable route back to a club context (J7 NOT OBSERVABLE). **7e master-control UI remains a separate
slice and UX-0 proposes no master-control functionality.**

---

## 13. Target shell proposal

Each change carries its authority impact. **Every one below is PRESENTATION ONLY unless stated.**

| Element | Current problem | Evidence | Proposal | Why | Authority impact | Mobile | Accessibility |
|---|---|---|---|---|---|---|---|
| **Page header** | `h1` is the club name for 3 of 5 personas | §3.1 | Adopt Site Admin's pattern everywhere: context eyebrow + page name + one-line description | A page that names itself is navigable and announceable | **NONE** | Survives 320px without a banner | `h1` becomes the page name |
| **Identity block** | Names the scope in club contexts | §3.2 | Always name the person; put club/role on the second line | Matches the standing rule and the guardian view | **NONE** | Also in mobile header | — |
| **Context control** | Icon-only, hidden when singular, absent on mobile | §3.3, §7.4 | A labelled control that always renders, reading "Acting as: …"; single-context people see their one context, disabled with a hint | Teaches the model before it is needed | **NONE** | Promote to mobile header | Labelled button, listbox semantics |
| **Club nav grouping** | Flat 9 vs grouped 20 | §3.5 | Reuse `buildSiteAdminSections` shape for club context | Machinery already exists | **NONE** | Same IA both sizes | — |
| **Deleted Calendar Events** | Top-level nav | §3.4 | Move under Club Settings | A bin is not a destination | **NONE** | — | — |
| **Club Desk hierarchy** | Decoration first, emptiness dominant | §6.1–6.2 | Needs-attention first; hide empty cards; shrink the banner | The guardian view already proves it | **NONE** | Single column, attention first | — |
| **Header banner** | Overlap + clipping | §6.1, §7.1–7.2 | Make the next-match card a sibling, not an overlay; let the club name wrap | It currently reads as a bug | **NONE** | Fixes the 320px clip | — |
| **Mobile navigation** | Everything behind a hamburger | §7.3 | Bottom bar of 4–5 context-appropriate destinations; drawer keeps the full IA | Phone-first for parents and coaches | **NONE** | — | 44px targets |
| **Return paths** | Club Home opens out with no way back | §5 J8 | In-app "Back to <club>" on public Club Home when signed in | Prevents context loss | **NONE** | — | — |
| **Floating overlays** | Two, over content | §6.3, §7.5 | One anchored assistant entry; avatar into the header | 320px has no room | **NONE** | — | — |
| **`/dashboard`** | One route, five pages | §4 | Keep the route; give each rendering its own name in the header | Users need a noun | **NONE** | — | — |
| **Site Admin exit** | No visible way back | §12 | Explicit "Leave platform administration" returning to the last club context | Makes the mode legible | **NONE** | — | — |

**Deliberately not proposed:** no design-system rewrite, no permission change, no new master-control UI,
no renaming of "Your Clubs" yet, no change to the parent/player fixed nav set.

---

## 14. Implementation slices

Derived from the findings, not from the illustrative list.

| Slice | Outcome | Routes / components | Authority invariant | Desktop acceptance | Mobile acceptance | A11y acceptance | Release boundary |
|---|---|---|---|---|---|---|---|
| **UX-1 Page identity** | Every signed-in page names its context and itself | `app/(app)/layout.tsx`, a shared `PageHeader`, `dashboard/page.tsx`, `club/*`, `admin/*` | `buildNavItems` untouched; no capability read moves | `h1` is the page name on all 5 personas | Header legible at 320px, no clipping | one `h1`, it is the page name | independent |
| **UX-2 Identity block + context control** | Person named; context always visible and labelled | `context-switcher.tsx`, `profile-button.tsx`, `switch-context-provider.tsx` | switching changes the lens only; routes re-check | control present for single- and multi-context | control in the mobile header | labelled, listbox semantics | independent |
| **UX-3 Club Desk hierarchy** | Attention first, emptiness hidden | `dashboard/page.tsx`, club desk components | no new data, no new capability | next-match card no longer overlaps | club name wraps at 320px | — | independent |
| **UX-4 Mobile shell** | Primary destinations one tap away | `app-mobile-nav.tsx`, `nav-sections.tsx` | items still come from `buildNavItems` | unchanged | bottom bar, 44px targets, no overflow | focus order | independent |
| **UX-5 Club nav grouping + bin relocation** | Club nav matches Site Admin's IA | `build-nav-items.ts`, `nav-sections.tsx`, `club/settings` | grouping is presentation over a filtered list | grouped sections | same IA | — | independent |
| **UX-6 Return paths** | No dead ends | public club home, Rugby Hub, Site Admin exit | none | back affordance present | — | — | independent |
| **UX-7 Accessibility + contrast pass** | Measured, not asserted | shell-wide | none | axe clean on shell routes | 320px axe clean | contrast measured | independent |
| **UX-8 Entrance journeys** | See §15 — **blocked** | `app/signup/*`, `app/join/*` | claim remains Site-Admin-approved | — | — | — | **blocked by 6b.2b** |

---

## 15. SIGNUP / JOIN / CLAIM JOURNEY AUDIT

### 15.0 Security verdict first

**NOT a privilege escalation. This is a UX defect. Continuing the audit.**

The claimed title is descriptive evidence and cannot grant authority. Traced end to end:

1. `club_claims.claimed_role` carries a **CHECK constraint**,
   `club_claims_claimed_role_eligible`, restricting it to seven values: Club Chair, Club Secretary,
   Fixture Secretary, Club Administrator, Director of Rugby, Committee Member, Treasurer. **Safeguarding
   / Welfare Officer, Head Coach, Team Manager, Coach, Volunteer, Player and Parent/Guardian are
   rejected by the database.**
2. `public.decide_club_claim` requires `site.claims.review`, and its own comment states the rule:
   *"The roles are the REVIEWER's choice; the claimed title only suggests a default (L9)."* It computes
   `v_roles := coalesce(p_roles, internal.claim_suggested_roles(claimed_role))`.
3. Granting any role additionally requires `site.club_roles.manage`, else it refuses with *"You may
   review a claim but not grant a role. A Full Site Admin must do that."*
4. The UI already states *"Submitting this request does not automatically grant control of the club."*

So Slice 5 secured this underneath the old UI. Safeguarding Officer remains on the separate canonical
4G appointment process and is claim-ineligible by constraint.

### 15.1 Why the reported screen appears — browser evidence

`app/signup/steps/club-step.tsx:283`:

```js
setMode(result.claimed ? "join" : "claim")
```

**Selecting a directory club that has no activated `clubs` row puts the person into CLAIM mode
automatically. Intent is never asked.**

And the entrance itself, observed live at 320, 390 and 1440px:

> **`/signup` `<h1>` = "Bring your club to Ovalball"**
> Intent question (player / parent / guardian / coach) present anywhere on the entry screen: **NO**

`/signup` is, by its own heading, a **club-onboarding funnel** — and it is what every new person is
given. A player whose club is not yet on Ovalball is therefore walked into "Claim Wigan Rugby Union
Football Club".

### 15.2 What the role question actually is

`RolePicker` renders all fifteen `CLUB_ROLES`, on a step titled **CLAIM**. Choosing one of the eight
claim-ineligible answers replaces the rest of the form with `ClaimAuthorityNotice` — a graceful
dead-end, not an error. So the screen invites an answer it will then refuse, and on a phone it does so
through a fifteen-item native select.

### 15.3 What the team question actually is — traced, not assumed

`proposed_teams` (jsonb on `club_claims`) → read by `public.decide_club_claim` → passed to
`internal.seed_teams_from_proposal` → which **`insert into public.teams`**, one row per selected
category plus one per additional squad letter.

**It is club team-structure creation.** It is not claim evidence, not registration interest, not
proposed membership, and nothing to do with the claimant personally.

**Why would a player be asked which teams they are "registering"?** They would not, and should not.
They are being shown a *club configuration* question because the wizard has silently put them in the
club-founder journey. For a **parent/guardian** the same applies with the same answer. Neither creates
any membership for the person: `decide_club_claim` creates **one** club membership — the claimant's —
and grants it only the roles a Full Site Admin chooses.

### 15.4 Current-state journey map

```
/signup  "Bring your club to Ovalball"
  Step 1 account ──▶ Step 2 personal details ──▶ Step 3 "Your club"
                                                    │
                                              pick rugby code
                                                    │
                                              search directory
                                    ┌───────────────┼────────────────┐
                          club activated?      not activated?    not listed?
                                    │               │                │
                              JOIN (role only)   CLAIM           NEW CLUB
                                    │          role + teams +     (directory
                                    │          declaration         request)
                                    ▼               ▼                ▼
                          Club Admin approves  Site Admin approves  Site Admin
                                               → club created,      reviews
                                                 teams seeded,
                                                 roles granted

/join?token=…  "Accept an Invitation"   ← the canonical relationship route
/guardian-invite/[token]                ← guardian relationship
/invite/site-admin/[token]              ← platform authority
```

| Journey | Entry | Exists? |
|---|---|---|
| A create an account | `/signup` | yes — but fused with club onboarding |
| B accept an invitation | `/join?token` | **yes, canonical** |
| C join a club | `/signup` → JOIN branch | yes, if the club is already activated |
| D join a team | — | **no public entrance** |
| E player join | — | **no player entrance** |
| F parent/guardian join | `/guardian-invite/[token]` only | **invitation-only; no self-service** |
| G staff invitation | `/join?token` | yes |
| H claim an unmanaged club | `/signup` Step 3, **entered automatically** | yes — but not chosen |
| I existing account, new relationship | — | **NOT OBSERVABLE / no entrance found** |
| J social signup | `/signup` with Google (enabled in production) | yes; reaches the same Step 3 |

**Merged journeys that should be separate: A + C + H are one wizard**, and which one you are in is
decided by a database fact about the club rather than by anything the person said.

### 15.5 Proposed-state journey map

```
/signup  "Create your Ovalball account"
   │
   ├─ identity (email+password or Google) ─ verify ─ personal details
   │
   └─ "What brings you to Ovalball?"          ◀── THE MISSING FORK
        ├─ I play                 ─▶ find club ─▶ JOIN REQUEST  (approval: Club Admin)
        ├─ I'm a parent/guardian  ─▶ find club ─▶ JOIN REQUEST for a child
        ├─ I help run a team      ─▶ "you'll need an invitation" + request access
        └─ I'm setting up my club ─▶ /clubs/claim   ◀── SEPARATE, EXCEPTIONAL JOURNEY
                                        │
                                        ├─ "No one manages this club on Ovalball yet."
                                        ├─ "You can ask Ovalball to verify you're authorised to set it up."
                                        ├─ role  = EVIDENCE, from CLAIM_ELIGIBLE_ROLES only (7, not 15)
                                        ├─ "Choosing a title does not give you that role."
                                        ├─ teams = "Which teams does the club run?" (optional, club setup)
                                        └─ declaration ─▶ Site Admin review
```

Claiming becomes something a person **chooses**, never something they are **routed into**.

### 15.6 Specific proposals

| # | Change | Why | Authority impact |
|---|---|---|---|
| 1 | Add the intent fork to `/signup`, and rename its H1 to "Create your Ovalball account" | The wizard currently announces itself as club onboarding to everyone | **NONE** |
| 2 | Move claiming to its own route (`/clubs/[slug]/claim` or `/clubs/claim`) | Exceptional acts deserve their own door | **NONE** |
| 3 | On the claim step, offer **only** `CLAIM_ELIGIBLE_ROLES` (7) | The other 8 dead-end; the constraint already rejects them | **NONE** — narrows the UI to what the DB already enforces |
| 4 | Put "Choosing a title does not give you that role" **beside the picker**, not below the teams list | It is the single most important sentence on the screen and is currently below the fold on a phone | **NONE** |
| 5 | Re-label the teams question "Which teams does the club run?" with "this creates them, ready for you to edit" | It currently reads as personal registration; it is club setup | **NONE** |
| 6 | Give players and guardians a real **join request** entrance | Today an uninvited player whose club is unclaimed has no path at all | **REQUIRES LATER AUTH WORK** — needs the approval surface, i.e. Slice 8 / 7e |
| 7 | Keep Safeguarding/Welfare Officer out of claim, and say why when chosen | Already true; make the reason visible | **NONE** |

### 15.7 Terminology

| Word | Used today for | Proposed meaning |
|---|---|---|
| **Sign up** | creating an account *and* onboarding a club | creating an Ovalball account, only |
| **Join** | a token invitation (`/join`) *and* the JOIN branch of signup | asking to be connected to a club or team |
| **Register** | selecting team categories during a claim | not used for people at all |
| **Claim** | taking over an unmanaged club | asking Ovalball to verify you may set a club up — always exceptional |
| **Role** | a title in a dropdown *and* a granted capability | granted authority only |
| **Relationship / title** | — | what you are at the club, as evidence |
| **Manage** | "No one manages this club" | holding club administrative authority |

The rule: **a word that describes evidence must never be the same word that describes authority.**

### 15.8 Mobile

At 320px and 390px the claim step stacks: a 15-item native select, then a scrolling team checklist,
then the declaration, then the reassurance. The reassurance — the only sentence that corrects the
impression the screen creates — is last. Fixing the select is not the fix; **fixing what is asked is**.
With proposal 3 the list falls from 15 to 7, and with proposal 4 the reassurance moves above the fold.

### 15.9 What remains

**Secured already (Slice 5, underneath the old UI):** eligibility CHECK, reviewer-chosen roles,
two-capability grant, pending-only claims, non-pre-checked declaration, honest submission copy.

**Outstanding UX/product defects:** no intent fork; claim entered automatically; claim offers
ineligible roles; teams question mislabelled; **no player or guardian self-service entrance**;
vocabulary collision.

**Dependency:** proposal 6 needs an approval surface (Slice 8 / 7e). Proposals 1–5 and 7 are
presentation-only and could be done in a UX slice — but **UX-8 is placed after 6b.2b** because
`auth_flow_states` (SO-4) is the canonical carrier of onboarding intent, and building an intent fork on
`ovalballSignupPayload` would be building on the thing 6b.2c exists to retire.

---

## 16. Combined Security + Product sequence

| Order | Unit | Track | Why here |
|---|---|---|---|
| ✓ | **6b.2a** | A | **PRODUCTION VERIFIED** — `e4e8c59`, ledger 523 |
| 1 | **UX-1** page identity | B | safe now; no dependency |
| 2 | **6b.2b** SO-4 `auth_flow_states` | A | unblocks H-7 **and** UX-8 |
| 3 | **UX-2** identity block + context control | B | safe now |
| 4 | **6b.2c** H-7 retirement | A | needs 6b.2b |
| 5 | **UX-3** Club Desk hierarchy | B | safe now |
| 6 | **6b.2d** S6-17 headers/CSP | A | independent; do before more UI ships |
| 7 | **UX-4** mobile shell | B | safe now |
| 8 | **Stage 0 + H** TOTP availability and owner enrolment | A | **owner action** — unblocks J, K |
| 9 | **UX-5** club nav grouping | B | safe now |
| 10 | **6b.4** social closure incl. Google UAT | A | needs 6b.2b |
| 11 | **UX-6** return paths · **UX-7** accessibility | B | safe now |
| 12 | **AN-3 / J** second Full Site Admin | A | needs Stage 0 |
| 13 | **7e** Site Admin master control | A | unblocks UX Site Admin work |
| 14 | **UX-8** entrance journeys | B | needs 6b.2b; proposal 6 needs 7e/Slice 8 |
| 15 | **T1–T5**, then Slice 8, 9, 10 | A | as originally designed |

### Dependency map

- **SAFE NOW:** UX-1, UX-2, UX-3, UX-4, UX-5, UX-6, UX-7
- **BLOCKED BY 6b.2b:** UX-8 (entrance journeys)
- **BLOCKED BY social closure:** Linked Sign-In Methods UX (S6-16)
- **BLOCKED BY 7e:** Site Admin master-control screens; the join-request approval surface
- **BLOCKED BY MFA/TOTP:** any enrolment or step-up UI beyond what exists
- **BLOCKED BY Slice 8/9/10:** Club People & Access UI, impersonation UI, legacy retirement

No dependency above is manufactured: each is either a named prerequisite in the closure ledger or a
surface that does not yet exist.

---

## 17. Security-relevant findings, deliberately assigned later

Found during UX-0, **none critical, none exploitable, none blocking**:

1. **No player/guardian self-service entrance** — a product hole, not a vulnerability. Owner: UX-8 +
   Slice 8.
2. **The claim step offers roles the database rejects** — fails closed with a courteous notice. Owner:
   UX-8.
3. **`internal` schema grant surface** — already recorded in
   `SLICE_6B2A_INTERNAL_SCHEMA_PERIMETER.md` with a wired guard. Owner: perimeter closure (P).
4. **`record_email_delivery_result` scope** — **closed** in this release; listed only so the ledger is
   not read as still carrying it.

**Nothing found in UX-0 meets CRITICAL + EXPLOITABLE + RELEVANT TO THE CURRENT PRODUCT PATH.**

---

# UX-1 — page identity (implemented)

**Presentation only. No authorisation change, no migration, no route change, not released.**

## What changed

UX-0 found that three of five personas met the same `<h1>` — the club's name — so the page said which
club and never which workspace or which page. Site Admin was already doing it right. UX-1 makes that
one pattern the shell's, through one primitive rather than a sixth hand-rolled copy.

| File | Change |
|---|---|
| `lib/app-context/workspace-label.ts` | **new** — maps the already-resolved `ActiveContextKind` to a word. Reads nothing, decides nothing |
| `components/shell/page-identity.tsx` | **new** — the one place a page says what it is |
| `app/(app)/dashboard/site-admin-dashboard.tsx` | the reference case, moved onto the primitive with no visual change |
| `components/club-home/club-desk.tsx` | the branded hero gains the workspace word; the club's theme still owns its colours |
| `app/(app)/dashboard/page.tsx` | the fallback header (family, player, team, club) derives its word from the live context |
| `app/(app)/people/page.tsx` | already had the shape; moved onto the primitive so the eyebrow reaches assistive technology |
| `app/(app)/teams/[teamId]/page.tsx` | same, with the "Folded" chip kept beside it |
| `supabase/tests/js/page_identity.test.mts` | **new** — 16 assertions, auto-discovered by the runner |

**Three hand-rolled copies of this pattern existed before UX-1** (Site Admin, People, the team page),
each repeating the same class strings. There is now one.

## Before → after, measured in a real browser

| Persona | Viewport | Before (UX-0) | After |
|---|---|---|---|
| Full Site Admin | 1440 / 390 / 320 | `Platform` | **`Site Admin: Platform`** (unchanged visually) |
| Club Admin | 1440 / 390 / 320 | `Ovalball UAT RUFC` | **`Club: Ovalball UAT RUFC`** |
| Club Admin → People | 1440 / 390 / 320 | `People` | **`Club: People`** |
| Guardian | 1440 / 390 / 320 | `All Children` | **`Family: All Children`** |
| Player | 1440 / 390 / 320 | `Ovalball UAT RUFC` | **`Player: Ovalball UAT RUFC`** |
| Team volunteer | 1440 / 390 / 320 | `Ovalball UAT RUFC` | **`Club: Ovalball UAT RUFC`** |

The strings quoted are the **accessible names** actually read out of the rendered `<h1>`. A player and
a team volunteer still land on the same club, and now say so differently — which is the distinction
UX-0 recorded as missing.

**18 persona × viewport × page combinations, all PASS**: exactly one `<h1>`, accessible name carries
the workspace, `scrollWidth === innerWidth` at 1440, 390 and 320, navigation intact
(20 / 9 / 6 / 6 / 3 links unchanged per persona).

## Accessibility

- **Exactly one `<h1>` per page**, asserted in the browser and pinned by test.
- **The eyebrow is a `<p>`, never a heading** — a heading above the page heading would invert the
  document outline. Pinned by test.
- **The eyebrow is `aria-hidden`, and the real workspace text lives inside the `<h1>`** as visually
  hidden text. Without that, assistive technology hears the workspace twice when reading linearly and
  not at all when navigating heading-by-heading. The accessible name is now e.g. "Club: People",
  announced once, correct however the page is reached.
- **Nothing is carried by icon or colour alone** — the Site Admin gauge is decorative and the words
  say everything.
- **Document titles were already correct** and were not touched: `app/layout.tsx` has a title template
  and 101 routes in `(app)` declare their own.
- A real improvement fell out of this: on mobile the club name in the hero is **visually clipped**
  (a pre-existing defect, recorded below) — but the accessible name is complete, so a screen-reader
  user now gets the full club name that a sighted user does not.

## Quality gates

| Gate | Result |
|---|---|
| `page_identity.test.mts` | **16 / 16** |
| Platform regression (all SQL + JS) | **4866 passed, 0 failed, 232 suites** — was 4850 / 231, so +16 is exactly the new suite |
| `content_standard` | ok — 1036 files, the new copy included |
| TypeScript | clean |
| Build | clean |
| `git diff --check` | clean |
| Lint | **4 errors, all pre-existing, in 4 untouched files** (`recovery-flow.tsx`, `club-step.tsx`, `activity-card.tsx`, `messaging-panel.tsx`); 179 problems, unchanged by UX-1 |
| Browser acceptance | 18 / 18 PASS |

No migration was created and no database rehearsal was run: UX-1 touches no schema.

## A vocabulary decision, made deliberately

UX-0's illustration used "CLUB DESK" as the workspace word. **It was not adopted.** That phrase appears
nowhere in the product — only in the UX-0 document itself — and inventing user-facing vocabulary is a
product decision, not a presentation one. Every word UX-1 uses is either already on screen ("Site
Admin" above the platform dashboard, "Club" above People) or is the noun the product's own routes
already use (`/teams` → Team, `/player` → Player). "Family" is the word the code itself already uses
for this context (`FamilyAvatar`, `isFamilyFacingContext`).

Naming the club workspace is a live question — it belongs with the wider terminology work UX-0 raised
in §15.7, for the owner to settle.

## Still owned by UX-2 and later — deliberately untouched

The identity block still names the **scope** rather than the person in club contexts (UX-2); the
context switcher is still an unlabelled ⇅ and still absent from the mobile header (UX-2); the Club Desk
is still decoration-first with stacked empty states and the next-match card still **overlaps the
header** (UX-3); the club name is still **visually clipped at 320px** (UX-3/UX-4); navigation is still
flat for clubs and grouped only for Site Admin (UX-5); "Deleted Calendar Events" is still top-level
(UX-5); there is still no return path from the public Club Home (UX-6).

**None of these was needed to fix page identity, so none was touched.**
