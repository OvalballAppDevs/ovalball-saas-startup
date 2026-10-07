import { PublicTeamPage } from "../../../../src/clubhouse/public-team-page"

/**
 * THE SAME PUBLIC TEAM PAGE, OPENED FROM A MATCH CENTRE THAT WAS OPENED FROM THE CALENDAR -- a second address,
 * not a second page, so Back walks Team -> Match -> Calendar.
 */
export default function CalendarTeamPage() {
  return <PublicTeamPage clubPath="/calendar/club/[directoryId]" />
}
