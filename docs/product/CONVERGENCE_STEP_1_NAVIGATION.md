# Convergence Step 1 — canonical navigation architecture

**Presentation and reachability only. No authority change, no migration, not released.**

## The architecture

```
my_capabilities                      one RPC, request-cached per scope
   → resolveClubSettingsNavCapabilities   THE canonical club decision
        ├→ buildNavItems              navigation structure
        ├→ club/settings/page.tsx     the hub   ← was deriving its own
        └→ club/page.tsx              already consumed it
   → groupNavItems(items, catalogue)  one grouper
        ├→ SITE_ADMIN_SECTIONS
        └→ CLUB_SECTIONS (+ a team group assembled for the active team)
   → NavSections                      one renderer, desktop and mobile
```

**One destination, one authority rule, two presentations.** Navigation is never the boundary: every
route still re-checks server-side, which is why two *hidden* features rendered perfectly by URL.

## The duplicate resolver that was removed

`app/(app)/club/settings/page.tsx` re-derived ten capability checks inline, omitting
`people.capability.manage` and `safeguarding.officer.nominate` and asking `club.guardians.manage`
where the shared resolver asks `family.relationship.approve`. It now calls
`resolveClubSettingsNavCapabilities` and contains **no `hasCapability` call at all** — pinned by test.
Two cards were added to the hub, because the capabilities were resolved but the destinations had never
been written.

## Before → after

| Context | Before | After |
|---|---|---|
| **Site Admin** | 4 groups: Rugby Operations · Clubs & People · Commercial · Support & System | **7 job groups**: Users & Permissions · Clubs & Teams · Fixtures & Competitions · **Safeguarding** · Communications & Support · Commercial · **Platform & Maintenance** |
| **Club** | **9 flat links**, People beside Deleted Calendar Events | **5 job groups**: Users & Permissions (People · **Permissions** · **Join Requests** · Guardians & Players · **Safeguarding Officer**) · Teams · Fixtures & Calendar · Communications · Club Management (Training · **Club Settings** · Deleted Calendar Events) |
| **Team** | Dashboard · *Under 12 Boys* (the **calendar**) · Fixtures · Player Requests · Messages | **Team** (**Under 12 Boys** — the team itself · Player Requests) · Fixtures & Calendar · Communications |
| **Player** | 6 fixed | unchanged |
| **Parent/Guardian** | 6 fixed | unchanged |

**Six destinations became reachable from navigation:** `/club/permissions`, `/club/join-requests`,
`/club/settings/guardians`, `/club/settings/safeguarding`, `/teams`, `/club/settings` — plus
`/teams/<id>` for team staff and `/admin/safeguarding` for Site Admin.

## Journeys, in a real browser

| Question | Result |
|---|---|
| Club Admin: *manage a user's access* | **2 interactions → `/people`** |
| Club Admin: *where are Permissions?* | **2 → `/club/permissions`** |
| Club Admin: *someone used a join code, approve them* | **2 → `/club/join-requests`** |
| Team Manager: *open my team* | **2 → `/teams/<id>`** — previously URL-only |
| Site Admin: *review safeguarding* | **2 → `/admin/safeguarding`** — previously orphaned |
| Parent: *respond for my child* | **1 → `/agenda`** |
| Player: *see my fixture* | **1 → `/agenda`** |

Six personas × desktop and 320px: **no horizontal overflow anywhere**, groups identical on both.

## Extension point for later Site Admin configuration

`groupNavItems(items, catalogue)` takes the catalogue as data, and `buildNavItems` is handed its
capability decisions rather than making them. A future Site Admin configurator would supply or reorder
the **catalogue** and nothing else:

```
NAV CONFIGURATION (catalogue: enabled · order · grouping)
      +
CANONICAL AUTHORITY (capability decisions, unchanged)
      =
VISIBLE DESTINATIONS
```

Configuration can only ever *remove* or *reorder*; it is intersected with authority, never substituted
for it. **Not implemented in Step 1.**

## Left to later steps

Users & Permissions is a **doorway** here, not a converged product — Step 2 owns merging People,
Permissions, Invitations and Requests into one surface. Join codes, QR and sharing are **Step 3**.
`/admin/email-preview` was judged an internal utility and **not promoted**. The nine raw
`logo_storage_path` reads remain **Step 6**; no new one was added. The Site Admin mobile scroll report
**remains open and unreproduced** — the drawer scrolls correctly at 320 and 390 here, and no
speculative fix was made.

## Gates

`navigation_architecture.test.mts` **17/17** (new) · `page_identity` 17/17 · `identity_and_context`
16/16 · `club_desk_hierarchy` 14/14 · UX-1 **18/18** · UX-2 **37/37** · UX-3 suite **28/28** ·
platform regression **4914 passed, 0 failed, 235 suites** (was 4897/234 — **+17 is exactly the new
suite**) · TypeScript, build, `diff --check` clean · lint **179 problems, 4 pre-existing errors — the
baseline**. **No migration.**
