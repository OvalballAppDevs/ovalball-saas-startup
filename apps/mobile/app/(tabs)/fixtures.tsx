import { ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppContexts } from "../../src/context/contexts"
import { ComingSoon } from "../../src/components/ui"
import { colour, space, type } from "../../src/design/tokens"

/**
 * FIXTURES, honestly labelled.
 *
 * The fixture programme is M5, and it is a large job: the shared agenda reader, availability, the
 * Match Centre, and the team fixture actions the web product has just finished making
 * capability-gated. None of that is in this foundation, and an empty list here would read as "your
 * team has no fixtures" rather than "this is not built yet", which is a worse lie than saying nothing.
 *
 * The context is named so the page is at least truthful about WHOSE fixtures it will show.
 */
export default function Fixtures() {
  const insets = useSafeAreaInsets()
  const { active } = useAppContexts()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colour.chalk }} contentContainerStyle={{ paddingTop: insets.top + space.lg }}>
      {active && (
        <View style={{ paddingHorizontal: space.xl }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>{active.label.toUpperCase()}</Text>
        </View>
      )}
      <ComingSoon
        title="Fixtures"
        body="The full fixture programme — upcoming matches, results, availability and Match Centre — is the next mobile milestone. Your next fixture is on Home, and the Ovalball website has everything else today."
      />
    </ScrollView>
  )
}
