import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import {
  DISPENSATION_STATUS_LABEL,
  dispensationDate,
  dispensationMismatchSentence,
  dispensationTone,
  type DispensationRecord,
} from "@ovalball/contracts/team/dispensation"

import { Card, EmptyState, StatusPill } from "../components/ui"
import { ChevronRight } from "../components/icons"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

const PILL_TONE = { waiting: "caution", granted: "positive", refused: "negative", closed: "neutral" } as const

/**
 * THE CLUB'S DISPENSATIONS, ONE ROW EACH (20270742000000) -- pending first in the server's order, every row
 * opening the one record screen where it is decided and its history read. The website's register says the
 * same thing in the same words.
 */
export function DispensationRows({ records, emptyTitle, emptyBody }: { records: DispensationRecord[]; emptyTitle: string; emptyBody: string }) {
  const router = useRouter()
  if (records.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />
  return (
    <View style={{ gap: space.md }}>
      {records.map((r) => {
        const name = `${r.player.firstName} ${r.player.surname}`.trim() || "A player"
        const waiting = !!r.viewer.decidesAs && r.status === "requested"
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${DISPENSATION_STATUS_LABEL[r.status]}. ${dispensationMismatchSentence(r)}${waiting ? " Waiting for your decision." : ""}`}
            accessibilityHint="Opens the dispensation"
            onPress={() => router.push({ pathname: "/dispensations/[id]", params: { id: r.id } } as never)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, minHeight: TOUCH_TARGET })}
          >
            <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.heading, { color: colour.ink }]}>{name}</Text>
                  <StatusPill label={DISPENSATION_STATUS_LABEL[r.status]} tone={PILL_TONE[dispensationTone(r.status)]} />
                </View>
                <Text style={[type.small, { color: colour.inkMuted }]}>{dispensationMismatchSentence(r)}</Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>
                  {`${r.season.name}${r.requestedBy ? `, asked by ${r.requestedBy.name}` : ""}${r.requestedAt ? ` on ${dispensationDate(r.requestedAt)}` : ""}${waiting ? ". Waiting for your decision." : ""}`}
                </Text>
              </View>
              <ChevronRight size={18} color={colour.inkSubtle} />
            </Card>
          </Pressable>
        )
      })}
    </View>
  )
}
