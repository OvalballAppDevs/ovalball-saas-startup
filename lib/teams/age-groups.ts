/**
 * Moved to `packages/contracts/src/teams/age-groups.ts` so the Season Handover on the phone offers the
 * same Adjust destinations as the web (CA-M11.1), and re-exported here so nothing on the web changed its
 * import. The list's own history -- two silently different hardcoded copies before this file existed --
 * is recorded there; the server's check constraint remains authoritative regardless of what it offers.
 */
export { YOUTH_AGE_GROUPS, type YouthAgeGroup } from "@ovalball/contracts/teams/age-groups"
