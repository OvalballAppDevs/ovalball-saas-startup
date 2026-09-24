/**
 * The rule for whose Rugby Hub this is lives in the shared package now (RH-M0.2), so the website
 * follows the selected context the same way the app does. This module exists only so the app's
 * existing imports keep resolving; nothing is defined here.
 */
export { HUB_TEAM_PREFERENCE_PREFIX, hubTeamPreferenceKey, resolveHubTeam, type HubActiveContext, type HubTeamChoice } from "@ovalball/contracts/rugby-hub/team-choice"
