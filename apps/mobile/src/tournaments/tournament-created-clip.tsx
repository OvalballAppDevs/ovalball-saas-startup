import { useEffect, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { VideoView, useVideoPlayer } from "expo-video"
import * as Haptics from "expo-haptics"

import { useReduceMotion } from "../a11y/reduce-motion"

/**
 * THE TOURNAMENT CREATED CONVERSION.
 *
 * A short silent clip, generated on Higgsfield and chosen by the product owner, played once between
 * the create transaction committing and the success screen appearing.
 *
 * THE CLIP'S GROUND IS NOT OVALBALL CHALK. It renders on a warm cream (#FFF9ED) rather than the app's
 * chalk (#F8FAF7), and a video cannot carry an alpha channel, so the two cannot simply be laid on top
 * of one another. Two things follow, and both are the reason this file exists rather than a bare
 * `<VideoView>`:
 *
 *   - the clip COVERS the whole screen, so there is no rectangle with an edge -- the frame IS the
 *     screen, and the cream is the only ground visible while it plays;
 *   - it CROSS-FADES out rather than cutting, because a hard cut from cream to chalk reads as a
 *     flash. The fade is short enough to feel like a settle rather than a transition.
 */

/** The clip runs 4s, but the tick and the words have fully settled by 3.25s and nothing moves after
 * that -- so the last three quarters of a second is dead air a person would be waiting through. */
const HAND_OVER_AT = 3400
const FADE = 260

/** The clip's own background, measured from its corners across every frame. Held here so the view
 * behind it matches exactly and no seam can appear if the aspect ratio ever letterboxes. */
export const CLIP_BACKGROUND = "#FFF9ED"

const SOURCE = require("../../assets/tournaments/tournament-created.mp4")

export function TournamentCreatedClip({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReduceMotion()
  const [failed, setFailed] = useState(false)
  const done = useRef(false)
  const fade = useSharedValue(1)

  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = false
    p.muted = true
    p.play()
  })

  useEffect(() => {
    // SOMEBODY WHO ASKED FOR LESS MOVEMENT STILL GETS THE OUTCOME -- the screen underneath is the
    // outcome, so it is shown immediately rather than played to.
    if (reduceMotion) {
      onDone()
      return
    }

    const finish = () => {
      if (done.current) return
      done.current = true
      fade.value = withTiming(0, { duration: FADE, easing: Easing.out(Easing.quad) }, (ok) => {
        if (ok) runOnJS(onDone)()
      })
    }

    const cut = setTimeout(finish, HAND_OVER_AT)
    // A single success haptic as the ball goes through, which is where the clip's own accent lands.
    const tap = setTimeout(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined), 1150)
    // A LAST RESORT, NOT THE MECHANISM. If the player never starts -- a corrupt asset, a device that
    // refuses to decode -- the screen must still arrive rather than the person staring at cream.
    const guard = setTimeout(finish, HAND_OVER_AT + 2000)

    return () => {
      clearTimeout(cut)
      clearTimeout(tap)
      clearTimeout(guard)
      cancelAnimation(fade)
    }
  }, [reduceMotion, onDone, fade])

  // A clip that cannot be decoded is not worth a black rectangle: hand over at once.
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "error") setFailed(true)
    })
    return () => sub.remove()
  }, [player])

  useEffect(() => {
    if (failed && !done.current) {
      done.current = true
      onDone()
    }
  }, [failed, onDone])

  const style = useAnimatedStyle(() => ({ opacity: fade.value }))

  if (reduceMotion || failed) return null

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: CLIP_BACKGROUND }, style]}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        // No controls, no gestures, no picture-in-picture: this is a moment in a flow, not a video a
        // person is watching.
        nativeControls={false}
        allowsPictureInPicture={false}
        // COVER, so the clip fills the screen and never shows an edge. The posts sit well inside the
        // safe area, so the crop at the sides takes only empty ground.
        contentFit="cover"
      />
      <View pointerEvents="none" style={StyleSheet.absoluteFill} />
    </Animated.View>
  )
}
