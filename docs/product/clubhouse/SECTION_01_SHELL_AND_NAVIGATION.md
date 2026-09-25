# Section 1 — Clubhouse Shell & Navigation

## PURPOSE

Establish Clubhouse unmistakably as a first-class product, eliminating navigation ambiguity: a Club Admin must immediately see Clubhouse as a destination, not discover it nested inside another menu.

## EXISTING IMPLEMENTATION

Verified directly against source before planning (never assumed):

- **Mobile bottom nav** already correct from the Clubhouse V1 pass: `Home / Fixtures / Calendar / Clubhouse / More`, same arrangement for every context, confirmed in `apps/mobile/src/context/tab-projection.ts` and pinned by `mobile_tab_projection.test.mts`.
- **Rugby Hub** already correctly preserved: unchanged route/stack under `apps/mobile/app/(tabs)/hub/`, reachable from a "Rugby Knowledge" group in `more.tsx`, for every context including Family and Player.
- **Web `/clubhouse` route**: exists, compiles (`next build` confirmed `/clubhouse` and `/clubhouse/[clubId]` as real routes), absorbing the former `/partner-clubs` directory (renamed via `git mv`, not duplicated).
- **Web nav item**: existed but was **buried** — a single row inside the collapsible "Fixtures & Calendar" disclosure section (`CLUB_SECTIONS` in `lib/app-context/build-nav-items.ts`), requiring a click to expand before it was visible. This was the one real gap Section 1 needed to close.
- **Old-route redirects**: `/partner-clubs` and `/partner-clubs/[clubId]` both `redirect()` to their `/clubhouse` equivalents.

## DOMAIN REUSE

None needed — this section is pure navigation/presentation. No table, RLS policy, or RPC was touched.

## UX

**Before:** Club Admin opens the sidebar, sees Dashboard at the top, then has to open "Fixtures & Calendar" to find "Clubhouse" listed alongside Agenda/Calendar/Fixture Management/Fixtures/Player Moves.

**After:** Club Admin sees Dashboard and Clubhouse both ungrouped, always visible, at the very top of the sidebar — the same visual tier, the same treatment. "Fixtures & Calendar" no longer lists Clubhouse at all (it moved out, not duplicated).

## WEB

`lib/app-context/build-nav-items.ts`:
- `groupNavItems()` now claims `/clubhouse` into the `top` array immediately after `/dashboard`, using the identical mechanism (special-cased top-tier promotion) Dashboard already had — no new mechanism invented.
- `/clubhouse` removed from `CLUB_SECTIONS`'s `rugby` ("Fixtures & Calendar") group's `hrefs` list.
- `app/(app)/app-nav.tsx`: corrected a stale comment ("Site Admin only: ungrouped top-level items. Empty elsewhere") that was no longer true.

**Scope decision, recorded honestly:** the directive's own wording is "Club Admin web navigation: Clubhouse must become a clear first-class item." This pass promoted it for **club context only** — team context's web nav spec (a separate, deliberately narrower list in `buildClubSections`) was left untouched, matching the pre-existing precedent that Partner Clubs was never offered to team-scoped web users either (comment in source: "a team-only manager genuinely has nothing to see there," referring to the `club_partnerships` RLS gap below). This is a real, deliberate scope boundary, not an oversight — recorded as owner-decision item 4 in the master plan, since mobile already gives team context the Clubhouse tab and this is a genuine cross-client asymmetry worth a decision, not a silent one.

## NATIVE

No changes needed — already correct from Clubhouse V1.

## AUTHORITY

Unchanged. `/clubhouse`'s visibility in the nav is still gated by the same `hasClubFixtureAuthority` check as before (derived from `canManageClubFixturesAnywhere(ctx)`) — promotion to `top` changed WHERE it renders, never WHETHER it renders or what it grants. Every route behind it still re-checks its own authority server-side, unchanged.

## PRIVACY

Not applicable — no data surface changed in this section.

## DATA

None. No migration, no RLS change, no new query.

## MUTATIONS

None. Section 1 is read-only presentation.

## FINDING CARRIED FORWARD (not this section's to fix)

Re-auditing `club_partnerships_select_scoped` RLS while verifying V1 claims found: it requires `club.partners.manage` at **club** scope specifically (`internal.club_ids_with('club.partners.manage')`), which a team-scoped Coach/Team Manager never holds (they hold `fixture.request.create`/`.respond` at **team** scope). Since mobile's Clubhouse tab is already reachable from every context including team (an existing V1 decision, not something Section 1 changed), a team-scoped mobile user's map today silently shows every club as "not partnered" even where a real active partnership exists — RLS correctly refuses the data, but the UI has nothing honest to say instead of a misleading default. This is real, but it is Section 5's (Partners) job, not Section 1's — recorded in the master plan so it is never lost.

## TESTS

New: `navigation_architecture.test.mts` — `"Clubhouse is a first-class destination: ungrouped and top-level, never buried inside a collapsible section"`, asserting `/clubhouse` appears in `top` and in no `sections` group.

Regression check: the full existing `bottom_bar_projection.test.mts` (14 assertions) and `navigation_architecture.test.mts` (now 27 assertions) suites both pass in full, confirming the promotion did not disturb any other capability-gated destination, team-context behaviour, or active-route highlighting.

Web typecheck (`npx tsc --noEmit -p tsconfig.json`): clean.

## ACCEPTANCE

**Met.** A Club Admin session (verified via the new permanent test, not just visual inspection since no browser/device proof was available) sees Clubhouse at the same ungrouped top tier as Dashboard — immediately, with zero disclosure clicks.

## DEFERRED

- Team-context web nav promotion (owner decision item 4, master plan).
- Contextual shortcuts FROM Fixtures/Calendar pages INTO Clubhouse (the reverse direction already exists — Clubhouse's own Find a Fixture button links to `/fixtures/new`). Not required by this section's stated acceptance criterion; left for a later polish pass (Section 18) rather than added speculatively here.
- The team-scope `club_partnerships` RLS accuracy gap (belongs to Section 5).
- Any visual/design polish to the sidebar itself beyond correct grouping — no design-system change was needed or made.
