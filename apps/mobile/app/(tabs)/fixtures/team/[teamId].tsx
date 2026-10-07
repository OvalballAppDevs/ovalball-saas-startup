import { PublicTeamPage } from "../../../../src/clubhouse/public-team-page"

/**
 * THE SAME PUBLIC TEAM PAGE, OPENED FROM A MATCH CENTRE -- a second address, not a second page. A team
 * named in the Match Centre's hero opens here, inside the Fixtures stack, so Back returns to the match
 * rather than to whichever tab the router last remembered.
 */
export default function FixtureTeamPage() {
  return <PublicTeamPage clubPath="/fixtures/club/[directoryId]" />
}
