import { useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { groupTermsByLetter, rugbyCodeLabel } from "@ovalball/contracts/rugby-hub/glossary-data"

import { useGlossary } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubEmpty, HubFailed, HubHero, HubList, HubLoading, HubOverline, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

type CodeFilter = "ALL" | "UNIVERSAL" | "union" | "league"

const FILTERS: { value: CodeFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNIVERSAL", label: "Universal" },
  { value: "union", label: "Union" },
  { value: "league", label: "League" },
]

/**
 * THE GLOSSARY — A to Z over the whole published list, in memory.
 *
 * The alphabet rail and the code filter both operate on the one bundle the
 * website's Glossary already fetched; neither issues a request, and neither
 * is a second search. Looking a word up by MEANING is what the one Hub
 * search does. A letter with no terms under the current filter is drawn
 * dimmed and is not a target.
 */
export default function GlossaryLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useGlossary()
  const [filter, setFilter] = useState<CodeFilter>("ALL")
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())

  const filtered = useMemo(() => {
    const terms = data?.terms ?? []
    if (filter === "ALL") return terms
    if (filter === "UNIVERSAL") return terms.filter((t) => t.rugbyCode === null)
    return terms.filter((t) => t.rugbyCode === filter)
  }, [data, filter])
  const allLetters = useMemo(() => groupTermsByLetter(data?.terms ?? []).map((g) => g.letter), [data])
  const groups = useMemo(() => groupTermsByLetter(filtered), [filtered])
  const available = new Set(groups.map((g) => g.letter))

  return (
    <HubScreen ref={scroll} section="Learn the Game" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Glossary" intro="What does that word actually mean? Short, plain-English definitions for the terms you'll hear around the pitch — browse by letter or code below." />

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && (
        <>
          <View style={{ gap: space.sm }}>
            <HubSegmented label="Filter by rugby code" value={filter} onChange={setFilter} options={FILTERS} />
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.inkMuted }]}>
              {filtered.length} {filtered.length === 1 ? "term" : "terms"}
            </Text>
          </View>

          <View accessibilityRole="toolbar" accessibilityLabel="Jump to letter" style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
            {allLetters.map((letter) => {
              const on = available.has(letter)
              return (
                <Pressable
                  key={letter}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to ${letter}`}
                  accessibilityState={{ disabled: !on }}
                  disabled={!on}
                  onPress={() => {
                    const y = offsets.current.get(letter)
                    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true })
                  }}
                  style={({ pressed }) => ({ width: 36, height: TOUCH_TARGET - 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: pressed ? colour.mint100 : "transparent" })}
                >
                  <Text style={[type.smallMedium, { color: on ? colour.forest800 : "rgba(16,21,18,0.25)", fontFamily: on ? "Inter_600SemiBold" : "Inter_500Medium" }]}>{letter}</Text>
                </Pressable>
              )
            })}
          </View>

          {groups.length === 0 ? (
            <HubEmpty title="No terms match this filter yet" body="Try a different rugby code, or view all terms." />
          ) : (
            groups.map((group) => (
              <View key={group.letter} style={{ gap: space.sm }} onLayout={(e) => offsets.current.set(group.letter, e.nativeEvent.layout.y)}>
                <HubOverline>{group.letter}</HubOverline>
                <HubList>
                  {group.terms.map((t) => (
                    <HubRow key={t.id} title={t.displayTerm} badge={rugbyCodeLabel(t.rugbyCode)} description={t.plainLanguageDefinition} onPress={() => router.push({ pathname: "/hub/glossary/[termKey]", params: { termKey: t.termKey } })} />
                  ))}
                </HubList>
              </View>
            ))
          )}
        </>
      )}
    </HubScreen>
  )
}
