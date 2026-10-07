import { AddToClub } from "../../../../src/people/add-to-club"
import { WithClub } from "../../../../src/people/club-gate"

/** Add to Club -- Home's "+ Add to Club" and People's own Add to Club open this one hub. */
export default function AddToClubRoute() {
  return <WithClub title="Add to Club">{(clubId) => <AddToClub clubId={clubId} />}</WithClub>
}
