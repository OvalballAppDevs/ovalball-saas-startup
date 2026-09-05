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
  activeContext: { kind: "club" | "team" | "parent" | "player" | "site_admin"; id: string | null },
  fixture: { involvedClubIds: string[]; involvedTeamIds: string[] }
): boolean {
  const activeIsSiteAdmin = ctx.isSiteAdmin && activeContext.kind === "site_admin"
  const activeIsInvolvedClub = activeContext.kind === "club" && activeContext.id !== null && fixture.involvedClubIds.includes(activeContext.id)
  const activeIsInvolvedTeam = activeContext.kind === "team" && activeContext.id !== null && fixture.involvedTeamIds.includes(activeContext.id)
  return activeIsSiteAdmin || activeIsInvolvedClub || activeIsInvolvedTeam
}
