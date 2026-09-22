import { DestinationFoundation } from "../../src/components/destination"
import { OvalIcon } from "../../src/components/icons"
import { colour } from "../../src/design/tokens"

export default function Fixtures() {
  return (
    <DestinationFoundation
      icon={<OvalIcon size={30} color={colour.forest800} />}
      title="Fixtures"
      intro="Every match for the side you are in — and, where you are authorised, the controls to run them."
      willHold={[
        "Upcoming fixtures with kick-off, venue and who has answered",
        "Results, with the scoreline and how the side got there",
        "Add, edit and cancel a fixture, where your club has granted it for this team",
        "Request a fixture, against opponents your side may legally play",
        "Match Centre — the shared surface, filtered to what you may see",
      ]}
      webPath="/agenda"
      webLabel="Open Fixtures on the Web"
    />
  )
}
