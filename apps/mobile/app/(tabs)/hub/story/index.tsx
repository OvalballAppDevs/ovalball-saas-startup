import { useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import type { HeritageEntry, HeritageEra } from "@ovalball/contracts/rugby-hub/heritage-data"

import { useHeritage } from "../../../../src/hub/bundles"
import { CertaintyBadge, CodeBadge, codeAccent } from "../../../../src/hub/heritage"
import { HubScreen } from "../../../../src/hub/screen"
import { HubFailed, HubHero, HubLoading, HubSegmented } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, space, type } from "../../../../src/design/tokens"

type CodeFilter = "all" | "union" | "league"

/** Visible under a code filter if it is that code's own, or part of the shared history every code carries. */
function matches(entry: HeritageEntry, filter: CodeFilter): boolean {
  if (filter === "all") return true
  if (entry.codeScope === "pre_schism" || entry.codeScope === "both") return true
  return entry.codeScope === filter
}

/**
 * THE STORY OF RUGBY — one timeline, era by era, from folk football to two
 * games. The code filter narrows which code's OWN developments you see; it
 * never fragments the shared root into two copies.
 */
export default function StoryLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useHeritage()
  const [filter, setFilter] = useState<CodeFilter>("all")
  const eras = useMemo(
    () =>
      (data?.eras ?? []).map((era) => ({
        era,
        all: (data?.entries ?? []).filter((e) => e.eraId === era.id).sort((a, b) => a.happenedYear - b.happenedYear),
        visible: (data?.entries ?? []).filter((e) => e.eraId === era.id && matches(e, filter)).sort((a, b) => a.happenedYear - b.happenedYear),
      })),
    [data, filter]
  )

  return (
    <HubScreen section="Explore Rugby" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="The Story of Rugby" intro="One game split in two in 1895. Union and League have been separate ever since — different rules, different heartlands, different heroes — but they share the same first hundred years. This is that story, from folk football to the modern game, told honestly: where the record is solid, and where it isn't." />

      <HubSegmented
        label="Filter by rugby code"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All Rugby" },
          { value: "union", label: "Union" },
          { value: "league", label: "League" },
        ]}
      />

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data &&
        eras.map(({ era, all, visible }, i) => (
          <View key={era.id} style={{ gap: space.md }}>
            <EraMarker era={era} />
            {visible.length === 0 ? (
              <Text style={[type.small, { color: colour.inkMuted, marginLeft: 22, paddingLeft: space.lg, borderLeftWidth: 2, borderLeftColor: colour.line }]}>
                {all.length > 0 ? `This era belongs entirely to ${all[0].codeScope === "union" ? "Rugby Union" : "Rugby League"} — no ${filter} entries here.` : "No entries recorded for this era yet."}
              </Text>
            ) : (
              <View style={{ marginLeft: 22, borderLeftWidth: 2, borderLeftColor: colour.line }}>
                {visible.map((entry) => (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.happenedYear}: ${entry.title}`}
                    onPress={() => router.push({ pathname: "/hub/story/[entryKey]", params: { entryKey: entry.entryKey } })}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", gap: space.md, paddingLeft: space.lg, paddingVertical: space.md, backgroundColor: pressed ? "rgba(220,247,229,0.5)" : "transparent" })}
                  >
                    <Text style={{ fontFamily: type.display.fontFamily, fontSize: 20, lineHeight: 22, color: colour.inkMuted, width: 52 }}>{entry.happenedYear}</Text>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 }]}>{entry.title}</Text>
                      <Text style={[type.small, { color: "rgba(16,21,18,0.65)" }]} numberOfLines={2}>
                        {entry.summary}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: 2 }}>
                        <CodeBadge codeScope={entry.codeScope} />
                        <CertaintyBadge certainty={entry.certainty} />
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            {i === eras.length - 1 && <View />}
          </View>
        ))}
    </HubScreen>
  )
}

function EraMarker({ era }: { era: HeritageEra }) {
  const accent = codeAccent(era.codeScope)
  const years = era.endsYear ? `${era.startsYear}–${era.endsYear}` : `${era.startsYear}–present`
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <View accessibilityElementsHidden style={{ width: 12, alignItems: "center", paddingTop: 8 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: accent, borderWidth: 2, borderColor: colour.chalk }} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontFamily: type.display.fontFamily, fontSize: 22, lineHeight: 24, color: accent }}>{years}</Text>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 34 }]}>
          {era.title}
        </Text>
        <Text style={[type.small, { color: "rgba(16,21,18,0.7)" }]}>{era.summary}</Text>
      </View>
    </View>
  )
}
