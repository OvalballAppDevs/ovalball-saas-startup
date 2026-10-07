import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, Text, View } from "react-native"
import * as Haptics from "expo-haptics"
import { formatVoiceDuration, VOICE_MAX_MS } from "@ovalball/contracts"

import { readFileBytes } from "../../messages/pickers"
import { MicOff, Pause, Play, Send, X } from "../icons"
import { TOUCH_TARGET, colour, messenger, space, type } from "../../design/tokens"

/**
 * VOICE NOTES -- recording and playing, on SDK 57's own audio module.
 *
 * LOADED WITH A GUARD. `expo-audio` is a native module; an app binary built before it was added has no
 * native half, and importing it there would crash the whole messenger. So it is required inside a try, and
 * everything voice-related simply is not offered when it is absent -- the microphone does not appear, and a
 * voice note that arrives says plainly that this version cannot play it.
 *
 * RECORDING IS DELIBERATE. Tap the microphone, and only then is permission asked for and recording started;
 * the bar says it is recording in words and with a timer (never colour alone), and Cancel throws it away.
 * Two minutes is the limit, the server's own; at the limit recording stops and waits to be sent.
 *
 * NO INVENTED WAVEFORM. A waveform that is not drawn from the audio would be decoration pretending to be
 * information, so playback shows real progress through the real duration instead.
 */

type AudioModule = typeof import("expo-audio")

let audio: AudioModule | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  audio = require("expo-audio") as AudioModule
} catch {
  audio = null
}

export const voiceAvailable = audio !== null

/** Mono AAC at 64 kbit/s: a clear voice, about half a megabyte a minute, comfortably inside the server's limit. */
function recordingOptions(module: AudioModule) {
  return { ...module.RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000, sampleRate: 44_100 }
}

export type RecordedVoice = { bytes: ArrayBuffer; durationMs: number }

/**
 * The composer's recording state. Rendered in place of the text field while recording.
 */
export function VoiceRecorderBar({ onSend, onCancel, compact = false }: { onSend: (voice: RecordedVoice) => void; onCancel: () => void; compact?: boolean }) {
  if (!audio) return null
  return <Recorder module={audio} onSend={onSend} onCancel={onCancel} compact={compact} />
}

function Recorder({ module, onSend, onCancel, compact }: { module: AudioModule; onSend: (voice: RecordedVoice) => void; onCancel: () => void; compact: boolean }) {
  const recorder = module.useAudioRecorder(recordingOptions(module))
  const state = module.useAudioRecorderState(recorder, 200)
  const [phase, setPhase] = useState<"asking" | "denied" | "recording" | "finishing" | "failed">("asking")
  const pulse = useRef(new Animated.Value(1)).current
  const started = useRef(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const permission = await module.requestRecordingPermissionsAsync()
        if (!live) return
        if (!permission.granted) {
          setPhase("denied")
          return
        }
        await module.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        if (!live) return
        recorder.record()
        started.current = true
        setPhase("recording")
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        AccessibilityInfo.announceForAccessibility("Recording a voice note")
      } catch {
        if (live) setPhase("failed")
      }
    })()
    return () => {
      live = false
      // The native recorder may already have been released by the time this runs (a screen torn down
      // mid-recording); nothing here may throw, and nothing recorded is kept.
      try {
        if (started.current && recorder.isRecording) void recorder.stop().catch(() => {})
      } catch {
        // Already gone.
      }
      void module.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
    }
    // One recording per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A slow pulse on the recording dot -- skipped where the person has asked for less motion.
  useEffect(() => {
    if (phase !== "recording") return
    let loop: Animated.CompositeAnimation | null = null
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.35, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      )
      loop.start()
    })
    return () => loop?.stop()
  }, [phase, pulse])

  const elapsed = state.durationMillis ?? 0
  const atLimit = elapsed >= VOICE_MAX_MS

  // The server's limit is the recorder's limit: stop there and wait to be sent.
  useEffect(() => {
    if (phase !== "recording" || !atLimit) return
    let recordingNow = false
    try {
      recordingNow = recorder.isRecording
    } catch {
      recordingNow = false
    }
    if (recordingNow) {
      try {
        recorder.pause()
      } catch {
        // Nothing to pause.
      }
      AccessibilityInfo.announceForAccessibility("Two minutes reached. Send or cancel the voice note.")
    }
  }, [atLimit, phase, recorder])

  async function finish() {
    if (phase !== "recording") return
    setPhase("finishing")
    try {
      const durationMs = Math.min(recorder.currentTime * 1000 || elapsed, VOICE_MAX_MS)
      await recorder.stop()
      const uri = recorder.uri
      const bytes = uri ? await readFileBytes(uri) : null
      if (!bytes) {
        setPhase("failed")
        return
      }
      onSend({ bytes, durationMs: Math.max(durationMs, elapsed) })
    } catch {
      setPhase("failed")
    }
  }

  const height = compact ? 40 : TOUCH_TARGET

  if (phase === "denied" || phase === "failed") {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: height, paddingHorizontal: space.md, borderRadius: height / 2, backgroundColor: colour.warningSurface }}>
        <MicOff size={18} color={colour.warning} strokeWidth={2} />
        <Text style={[type.caption, { color: colour.ink, flex: 1 }]}>
          {phase === "denied" ? "Ovalball needs the microphone to record voice notes." : "That recording didn't work. Try again."}
        </Text>
        {phase === "denied" && (
          <Pressable accessibilityRole="button" accessibilityLabel="Open Settings" onPress={() => void Linking.openSettings()} hitSlop={8} style={{ minHeight: 32, justifyContent: "center" }}>
            <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onCancel} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <X size={17} color={colour.inkMuted} strokeWidth={2.2} />
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 6 : space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel voice note"
        onPress={() => {
          void Haptics.selectionAsync()
          onCancel()
        }}
        style={({ pressed }) => ({ width: height, height, borderRadius: height / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colour.dangerSurface : colour.chalk, borderWidth: 1, borderColor: colour.lineStrong })}
      >
        <X size={19} color={colour.danger} strokeWidth={2.2} />
      </Pressable>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={phase === "asking" ? "Starting the microphone" : `Recording, ${formatVoiceDuration(elapsed)}${atLimit ? ", limit reached" : ""}`}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: height, paddingHorizontal: space.md, borderRadius: height / 2, backgroundColor: colour.dangerSurface }}
      >
        <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.danger, opacity: phase === "recording" && !atLimit ? pulse : 1 }} />
        <Text maxFontSizeMultiplier={1.4} style={[type.smallMedium, { color: colour.danger, fontVariant: ["tabular-nums"] }]}>
          {phase === "asking" ? "Starting…" : formatVoiceDuration(elapsed)}
        </Text>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
          {atLimit ? "Two minutes reached" : phase === "finishing" ? "Preparing…" : "Recording"}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send voice note"
        accessibilityState={{ disabled: phase !== "recording" }}
        disabled={phase !== "recording"}
        onPress={() => void finish()}
        style={({ pressed }) => ({ width: height, height, borderRadius: height / 2, alignItems: "center", justifyContent: "center", backgroundColor: phase === "recording" ? colour.pitch600 : colour.lineStrong, transform: [{ scale: pressed ? 0.94 : 1 }] })}
      >
        <Send size={18} color={colour.onForest} strokeWidth={2.3} style={{ marginLeft: -2, marginTop: 1 }} />
      </Pressable>
    </View>
  )
}

/**
 * A voice note in a bubble: play/pause, real progress, the length. Plays through a short-lived signed URL.
 */
export function VoiceNoteBubble({
  url,
  durationMs,
  mine,
  pending,
  context,
  onHold,
}: {
  url: string | null
  durationMs: number | null
  mine: boolean
  pending?: boolean
  /** Who sent it and when, read before "Play" -- the bubble around it is not a separate element for VoiceOver. */
  context?: string
  /** The message's own actions, offered to VoiceOver on the play control. */
  onHold?: () => void
}) {
  if (!audio || !url) {
    return <VoiceShell durationMs={durationMs} mine={mine} note={pending ? "Sending…" : !audio ? "Update Ovalball to play voice notes" : "Not available"} />
  }
  return <Player module={audio} url={url} durationMs={durationMs} mine={mine} context={context} onHold={onHold} />
}

function Player({ module, url, durationMs, mine, context, onHold }: { module: AudioModule; url: string; durationMs: number | null; mine: boolean; context?: string; onHold?: () => void }) {
  const player = module.useAudioPlayer({ uri: url })
  const status = module.useAudioPlayerStatus(player)
  const [failed, setFailed] = useState(false)
  const total = (status.duration > 0 ? status.duration * 1000 : durationMs) ?? 0
  const at = status.currentTime * 1000
  const progress = total > 0 ? Math.min(1, at / total) : 0

  useEffect(() => {
    if (status.didJustFinish) {
      void player.seekTo(0)
    }
  }, [status.didJustFinish, player])

  function toggle() {
    try {
      if (status.playing) {
        player.pause()
        return
      }
      void module.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {})
      player.play()
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  const ink = mine ? colour.onForest : colour.forest900
  const track = mine ? messenger.onMineLine : messenger.onTheirsLine
  const shown = status.playing || at > 0 ? at : total

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 196, paddingVertical: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[context, status.playing ? "Pause voice note" : `Play voice note, ${formatVoiceDuration(total)}`].filter(Boolean).join(" ")}
        accessibilityActions={onHold ? [{ name: "longpress", label: "Message options" }] : undefined}
        onAccessibilityAction={onHold ? () => onHold() : undefined}
        onPress={toggle}
        hitSlop={6}
        style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: mine ? messenger.onMineFaint : colour.surface, transform: [{ scale: pressed ? 0.94 : 1 }] })}
      >
        {status.playing ? <Pause size={17} color={ink} fill={ink} strokeWidth={0} /> : <Play size={17} color={ink} fill={ink} strokeWidth={0} style={{ marginLeft: 2 }} />}
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <View accessibilityElementsHidden style={{ height: 4, borderRadius: 2, backgroundColor: track, overflow: "hidden" }}>
          <View style={{ width: `${progress * 100}%`, height: 4, borderRadius: 2, backgroundColor: mine ? colour.onForest : colour.pitch600 }} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontSize: 11, fontVariant: ["tabular-nums"] }]}>
          {failed ? "Couldn't play this voice note" : formatVoiceDuration(shown)}
        </Text>
      </View>
    </View>
  )
}

function VoiceShell({ durationMs, mine, note }: { durationMs: number | null; mine: boolean; note: string }) {
  const ink = mine ? colour.onForest : colour.forest900
  return (
    <View accessible accessibilityLabel={`Voice note, ${formatVoiceDuration(durationMs)}. ${note}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 196, paddingVertical: 2, opacity: 0.85 }}>
      <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: mine ? messenger.onMineFaint : colour.surface }}>
        <Play size={17} color={ink} fill={ink} strokeWidth={0} style={{ marginLeft: 2 }} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: mine ? messenger.onMineLine : messenger.onTheirsLine }} />
        <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontSize: 11 }]}>
          {formatVoiceDuration(durationMs)} · {note}
        </Text>
      </View>
    </View>
  )
}

