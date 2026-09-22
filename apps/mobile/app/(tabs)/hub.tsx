import { ScrollView } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ComingSoon } from "../../src/components/ui"
import { colour, space } from "../../src/design/tokens"

export default function Hub() {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colour.chalk }} contentContainerStyle={{ paddingTop: insets.top + space.lg }}>
      <ComingSoon
        title="Rugby Hub"
        body="Laws, age-grade guidance and the rest of Ovalball's rugby content, in your own code. Not built in this mobile foundation — the website has all of it today."
      />
    </ScrollView>
  )
}
