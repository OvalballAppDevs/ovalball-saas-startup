import { useLocalSearchParams } from "expo-router"

import { AddPlayers } from "../../../../src/people/add-players"
import { WithClub } from "../../../../src/people/club-gate"

/** Add Players (and Share a Joining Pass) from the club: the team is chosen on the screen. */
export default function AddPlayersRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  return (
    <WithClub title="Add Players">
      {(clubId) => <AddPlayers clubId={clubId} mode={mode === "pass" ? "pass" : null} requestsRoute="/admin/guardians/join-requests" />}
    </WithClub>
  )
}
