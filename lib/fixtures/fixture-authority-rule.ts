/**
 * Pure decision rule extracted from require-active-fixture-authority.ts
 * specifically so it has standalone, dependency-free regression coverage
 * (see fixture-authority-rule.verify.ts) -- the wrapping module imports
 * "server-only"/next/headers and can't be exercised with a plain
 * `npx tsx` run, matching the exact reason lib/app-context/
 * site-admin-context-rule.ts was split out earlier this session.
 */
export function isActiveFixtureAuthority(
  ctx: { isSiteAdmin: boolean },
  // "family" (All Children) and "governing" are listed for completeness only. Like "parent" and
  // "player" they match none of the three grants below, so a Guardian aggregating their children can
  // never reach a fixture write -- and neither can a governing-body officer, who organises COMPETITION
  // matches and has no authority over any club's own fixtures. The rule is allow-list shaped precisely
  // so a new context kind defaults to denied, and Convergence Step 15 adding one is the proof: this
  // line changed and the answer did not.
  activeContext: { kind: "club" | "team" | "parent" | "player" | "family" | "site_admin" | "governing"; id: string | null },
  fixture: { involvedClubIds: string[]; involvedTeamIds: string[] }
): boolean {
  const activeIsSiteAdmin = ctx.isSiteAdmin && activeContext.kind === "site_admin"
  const activeIsInvolvedClub = activeContext.kind === "club" && activeContext.id !== null && fixture.involvedClubIds.includes(activeContext.id)
  const activeIsInvolvedTeam = activeContext.kind === "team" && activeContext.id !== null && fixture.involvedTeamIds.includes(activeContext.id)
  return activeIsSiteAdmin || activeIsInvolvedClub || activeIsInvolvedTeam
}
