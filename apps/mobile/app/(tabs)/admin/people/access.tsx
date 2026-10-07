import { AccessControl } from "../../../../src/people/access-control"
import { WithClub } from "../../../../src/people/club-gate"

/** Roles & Access -- who can do what across the club, and who does what for each team. */
export default function AccessRoute() {
  return <WithClub title="Roles & Access">{(clubId) => <AccessControl clubId={clubId} />}</WithClub>
}
