import { DestinationFoundation } from "../../src/components/destination"
import { CalendarDays } from "../../src/components/icons"
import { colour } from "../../src/design/tokens"

export default function Calendar() {
  return (
    <DestinationFoundation
      icon={<CalendarDays size={30} color={colour.forest800} strokeWidth={1.9} />}
      title="Calendar"
      intro="Training, matches and club events, for whichever context you are standing in."
      willHold={[
        "The week ahead at a glance, and the month when you need it",
        "Training sessions with times, pitches and who is coming",
        "Club events and meetings",
        "Add to your phone's own calendar",
      ]}
      webPath="/calendar"
      webLabel="Open the Calendar on the Web"
    />
  )
}
