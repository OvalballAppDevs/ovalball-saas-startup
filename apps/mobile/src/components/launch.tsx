import { useEffect, useRef } from "react"
import { Animated, Easing, View } from "react-native"

import { OvalballMark, OvalballWordmark } from "./brand"
import { colour } from "../design/tokens"

/**
 * THE LAUNCH CANVAS — the frame between the native splash and the product.
 *
 * WHAT WAS WRONG. A cold start ran native splash → white frame → React hold → screen, and the white
 * frame is the one people notice: it reads as the app restarting rather than opening. It exists
 * because the native splash is torn down on one schedule and React paints on another, and whatever is
 * behind them both is the window's default.
 *
 * THE FIX IS THAT NOTHING IN THE STACK IS EVER WHITE. The launch storyboard, this view and the root
 * background are all #071C14, so the handoff has no colour to change: the native splash is hidden only
 * once React has something on screen, and what it reveals is the same canvas with the same mark in the
 * same place.
 *
 * AND IT DOES NOT HOLD YOU UP. There is no minimum display time -- a fixed two-second logo is a cost
 * charged to somebody who just wanted to check a kick-off time. The mark fades out the moment the app
 * knows where it is going, which on a warm start is immediate.
 */
export function LaunchCanvas({ fading = false }: { fading?: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!fading) return
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [fading, opacity])

  // ONCE IT IS LEAVING, IT IS INERT. While the canvas fades it is still a full-screen view on top of
  // the product: without this a tap in those 220ms lands on decoration, and a screen reader can focus
  // a layer that is on its way out and announce "Ovalball" over the screen the person actually wants.
  // An axe run timed to the fade found exactly that -- the wordmark half-composited at 1.9:1 -- which
  // is a real defect, not a testing artefact, because a person using VoiceOver lives in those frames.
  return (
    <View
      accessible={!fading}
      accessibilityLabel="Ovalball is starting"
      accessibilityRole="image"
      testID="launch-canvas"
      accessibilityElementsHidden={fading}
      importantForAccessibility={fading ? "no-hide-descendants" : "yes"}
      pointerEvents={fading ? "none" : "auto"}
      style={{
        ...StyleSheetAbsolute,
        backgroundColor: colour.forest950,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={{ opacity, alignItems: "center", gap: 22 }}>
        <OvalballMark size={150} />
        <OvalballWordmark size={40} />
      </Animated.View>
    </View>
  )
}

/** Inlined rather than imported so the canvas has no dependency beyond the brand it draws. */
const StyleSheetAbsolute = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
}
