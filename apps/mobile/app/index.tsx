import { View } from "react-native"

import { colour } from "../src/design/tokens"

/** The entry route. The gate in _layout.tsx decides where this session actually belongs. */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: colour.forest950 }} />
}
