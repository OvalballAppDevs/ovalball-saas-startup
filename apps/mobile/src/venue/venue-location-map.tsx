import Constants from "expo-constants"
import { Text, View } from "react-native"

import { colour, radius, space, type } from "../design/tokens"

/**
 * EXPO GO CANNOT RUN MAPLIBRE, and the four Venue screens that show this pin are routes, which Expo
 * Router evaluates eagerly -- so a static MapLibre import here crashed the whole app in Expo Go with
 * `MLRNCameraModule could not be found`, not just this preview. The map itself lives in
 * `venue-location-map-native.tsx` and is required only when this is not Expo Go, exactly as Clubhouse's
 * map does (`app/(tabs)/clubhouse/map.tsx`). A development build shows the real map, unchanged.
 */
const isExpoGo = Constants.appOwnership === "expo"
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: see the comment above.
const NativeMap = isExpoGo ? null : (require("./venue-location-map-native") as typeof import("./venue-location-map-native")).NativeVenueLocationMap

export function VenueLocationMap({ latitude, longitude, height = 160 }: { latitude: number; longitude: number; height?: number }) {
  if (NativeMap) return <NativeMap latitude={latitude} longitude={longitude} height={height} />
  return (
    <View style={{ height, borderRadius: radius.lg, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line, alignItems: "center", justifyContent: "center", padding: space.md }}>
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>The map preview needs the Ovalball development build. The location is saved as shown.</Text>
    </View>
  )
}
