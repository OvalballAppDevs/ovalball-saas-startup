import { ScrollView } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ComingSoon } from "../../src/components/ui"
import { colour, space } from "../../src/design/tokens"

export default function Calendar() {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colour.chalk }} contentContainerStyle={{ paddingTop: insets.top + space.lg }}>
      <ComingSoon
        title="Calendar"
        body="Training, matches and club events for the context you are in. It is next after Fixtures in the mobile build; until then the Ovalball website has the full calendar."
      />
    </ScrollView>
  )
}
