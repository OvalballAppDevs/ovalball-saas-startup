import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  HANDOVER_SECTION_LABELS,
  handoverErrorMessage,
  handoverStateWord,
  readHandoverBoard,
  type HandoverBoard,
  type HandoverSection,
  type HandoverState,
} from "@ovalball/contracts/club/handover"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { friendly, logDetail, type FriendlyError } from "../errors/translate"
import { ChevronRight } from "../components/icons"
import { StatusPill } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE SEASON HANDOVER BOARD, ON THE PHONE (CA-M11.1).
 *
 * ONE READ MODEL, THE WEBSITE'S. `readHandoverBoard` is the shared reader the `/club/rollover` page
 * builds from; every handover screen here asks it for the active club and renders what it returns.
 * Nothing on this side computes a season, an age grade, a readiness or a tense: the register, the
 * server's handover functions and the shared presentation rules answer, and the phone displays.
 *
 * RE-READ ON FOCUS AND AFTER EVERY WRITE. Decisions are recorded server-side and the board's counts,
 * blockers and consequences change with each; a screen that kept yesterday's answer would offer a
 * control the server now refuses.
 */
export interface HandoverBoardState {
  loading: boolean
  clubId: string | null
  board: HandoverBoard | null
  error: FriendlyError | null
  reload: () => Promise<void>
}

export function useHandoverBoard(): HandoverBoardState {
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [board, setBoard] = useState<HandoverBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async () => {
    if (!clubId) {
      setBoard(null)
      setLoading(false)
      return
    }
    const gen = ++generation.current
    setError(null)
    try {
      const next = await readHandoverBoard(supabase, clubId)
      if (gen !== generation.current) return
      setBoard(next)
    } catch (cause) {
      const translated = friendly(cause, "the season handover")
      logDetail("admin:rollover", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    // Cleared FIRST: the previous context's board must never decide this context's screen.
    setBoard(null)
    setLoading(true)
    void reload()
  }, [reload])

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload])
  )

  return { loading, clubId, board, error, reload }
}

/** The server's sentence where it raised one on purpose; the app's own otherwise. */
export function handoverProblem(cause: unknown, subject: string): string {
  return handoverErrorMessage(cause, friendly(cause, subject).message)
}

/** "1 September 2027" -- a register date, formatted, never computed. */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function stateTone(state: HandoverState): "positive" | "caution" | "neutral" {
  if (state === "READY" || state === "COMPLETED") return "positive"
  if (state === "REVIEW_REQUIRED") return "caution"
  return "neutral"
}

/** The line every handover screen opens with: which seasons, and where the handover stands. */
export function HandoverSeasonLine({ board }: { board: HandoverBoard }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
      <Text style={[type.small, { color: colour.ink }]}>
        {board.currentSeason?.name ?? "This season"} <Text style={{ color: colour.inkMuted }}>→</Text> {board.nextSeason?.name ?? "next season"}
      </Text>
      <StatusPill label={handoverStateWord(board.state)} tone={stateTone(board.state)} />
    </View>
  )
}

/** A row that opens one of the board's sections. */
export function HandoverSectionRow({ section, caption, badge, first }: { section: HandoverSection; caption: string; badge?: number; first?: boolean }) {
  const router = useRouter()
  const label = HANDOVER_SECTION_LABELS[section]
  const path = section === "overview" ? "/admin/rollover" : `/admin/rollover/${section}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} outstanding. ${caption}` : `${label}. ${caption}`}
      onPress={() => router.push(path as never)}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      {!!badge && badge > 0 && (
        <View style={{ backgroundColor: colour.warningSurface, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
          <Text style={[type.caption, { color: colour.warning }]}>{badge}</Text>
        </View>
      )}
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

/** A quiet card holding one message: an outcome, a refusal, a note. */
export function Notice({ tone, text }: { tone: "ok" | "error" | "info"; text: string }) {
  const bg = tone === "error" ? colour.dangerSurface : tone === "ok" ? colour.successSurface : "rgba(16,21,18,0.05)"
  const fg = tone === "error" ? colour.danger : tone === "ok" ? colour.forest800 : colour.inkMuted
  return (
    <View accessibilityRole={tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: bg }}>
      <Text style={[type.small, { color: fg }]}>{text}</Text>
    </View>
  )
}

/** A label/value line in a list card. */
export function CountRow({ label, value, first }: { label: string; value: number; first?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}
