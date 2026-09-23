import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { findAdjacentEntries, findEraRelatives, getHeritageEntrySources, type HeritageSource } from "@ovalball/contracts/rugby-hub/heritage-data"

import { supabase } from "../../../../src/auth/supabase"
import { ChevronLeft, ChevronRight } from "../../../../src/components/icons"
import { oneParam, useHeritage } from "../../../../src/hub/bundles"
import { CERTAINTY_DESCRIPTION, CertaintyBadge, CodeBadge, isQuestionable } from "../../../../src/hub/heritage"
import { HubScreen } from "../../../../src/hub/screen"
import { HubCallout, HubEmpty, HubFailed, HubLoading, HubOverline, HubParagraph, HubSources } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const TIER_LABEL: Record<string, string> = {
  GOVERNING_BODY: "Governing body",
  MUSEUM_OR_ARCHIVE: "Museum or archive",
  ACADEMIC: "Academic",
  ENCYCLOPEDIA: "Encyclopedia",
  POPULAR_HISTORY: "Popular history",
  CONTEMPORARY_REPORT: "Contemporary report",
}

/**
 * ONE MOMENT IN THE STORY. A myth or a legend carries its warning beside its
 * title, never only in a badge; the sources are read on demand for this entry
 * (as the website does) and listed with tier, publisher and what they support.
 * Previous / next walk the whole timeline in date order.
 */
export default function StoryEntryScreen() {
  const router = useRouter()
  const { entryKey } = useLocalSearchParams<{ entryKey: string }>()
  const key = oneParam(entryKey)
  const { data, loading, error, refresh, refreshing } = useHeritage()
  const entry = data && key ? (data.entries.find((e) => e.entryKey === key) ?? null) : null
  const era = entry && data ? (data.eras.find((e) => e.id === entry.eraId) ?? null) : null
  const [sources, setSources] = useState<HeritageSource[] | null>(null)

  useEffect(() => {
    if (!entry) return
    let live = true
    setSources(null)
    getHeritageEntrySources(supabase, entry.id)
      .then((s) => live && setSources(s))
      .catch(() => live && setSources([]))
    return () => {
      live = false
    }
  }, [entry])

  const adjacent = data && entry ? findAdjacentEntries(data.entries, entry.entryKey) : { previous: null, next: null }
  const relatives = data && entry ? findEraRelatives(data.entries, entry) : []
  const period = entry ? (entry.endsYear && entry.endsYear !== entry.happenedYear ? `${entry.happenedYear}–${entry.endsYear}` : (entry.happenedOn ?? String(entry.happenedYear))) : ""
  const go = (k: string) => router.push({ pathname: "/hub/story/[entryKey]", params: { entryKey: k } })

  return (
    <HubScreen section="The Story of Rugby" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !entry && <HubEmpty title="This moment isn't in the story yet" body="It may have been renamed or withdrawn. The whole timeline is under The Story of Rugby." />}
      {data && entry && (
        <>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md }}>
              <Text style={{ fontFamily: type.display.fontFamily, fontSize: 30, lineHeight: 32, color: colour.inkMuted }}>{period}</Text>
              <CodeBadge codeScope={entry.codeScope} />
              {era && <Text style={[type.small, { color: colour.inkMuted }]}>{era.title}</Text>}
            </View>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {entry.title}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <CertaintyBadge certainty={entry.certainty} size="md" />
              <Text style={[type.small, { color: colour.inkMuted }]}>{CERTAINTY_DESCRIPTION[entry.certainty]}</Text>
            </View>
          </View>

          {(entry.certainty === "MYTH" || entry.certainty === "LEGEND") && (
            <HubCallout tone="amber">
              {entry.certainty === "MYTH"
                ? "This is a well-known story, but the historical evidence doesn't support it. Ovalball records it because of its cultural importance, not because it happened."
                : "This is part of rugby's tradition, but it isn't established historical fact."}
            </HubCallout>
          )}

          <View style={{ gap: space.md }}>
            <HubParagraph>{entry.summary}</HubParagraph>
            {entry.detail && <HubParagraph>{entry.detail}</HubParagraph>}
          </View>

          {entry.certaintyNote && (
            <View style={{ borderLeftWidth: 2, borderLeftColor: isQuestionable(entry.certainty) ? "rgba(138,90,0,0.4)" : colour.lineStrong, paddingLeft: space.lg }}>
              <Text style={[type.small, { color: "rgba(16,21,18,0.6)" }]}>{entry.certaintyNote}</Text>
            </View>
          )}

          {(entry.people.length > 0 || entry.places.length > 0) && (
            <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.lg, gap: space.md }}>
              {entry.people.length > 0 && (
                <View style={{ gap: 2 }}>
                  <HubOverline>People</HubOverline>
                  <Text style={[type.small, { color: "rgba(16,21,18,0.75)" }]}>{entry.people.join(", ")}</Text>
                </View>
              )}
              {entry.places.length > 0 && (
                <View style={{ gap: 2 }}>
                  <HubOverline>Place</HubOverline>
                  <Text style={[type.small, { color: "rgba(16,21,18,0.75)" }]}>{entry.places.join(", ")}</Text>
                </View>
              )}
            </View>
          )}

          {sources === null ? (
            <HubLoading rows={1} />
          ) : (
            <HubSources heading={`Sources (${sources.length})`} items={sources.map((s) => ({ title: s.sourceTitle, url: s.sourceUrl, tierLabel: TIER_LABEL[s.sourceTier] ?? s.sourceTier, publisher: s.publisher, supports: s.supports, retrievedOn: s.retrievedOn }))} />
          )}

          {relatives.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.lg, gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>
                More from {era?.title ?? "this era"}
              </Text>
              {relatives.map((rel) => (
                <Pressable key={rel.id} accessibilityRole="button" accessibilityLabel={`${rel.happenedYear}: ${rel.title}`} onPress={() => go(rel.entryKey)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, paddingHorizontal: space.sm, backgroundColor: pressed ? "rgba(220,247,229,0.5)" : "transparent" })}>
                  <Text style={{ fontFamily: type.display.fontFamily, fontSize: 17, color: colour.inkMuted }}>{rel.happenedYear}</Text>
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{rel.title}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View accessibilityRole="toolbar" accessibilityLabel="Chronological navigation" style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.lg, flexDirection: "row", gap: space.lg }}>
            <View style={{ flex: 1 }}>
              {adjacent.previous && (
                <Pressable accessibilityRole="button" accessibilityLabel={`Previous: ${adjacent.previous.happenedYear}, ${adjacent.previous.title}`} onPress={() => go(adjacent.previous!.entryKey)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, gap: 4, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <ChevronLeft size={14} color={colour.inkMuted} />
                    <Text style={[type.caption, { color: colour.inkMuted, textTransform: "uppercase", letterSpacing: 0.8 }]}>{adjacent.previous.happenedYear}</Text>
                  </View>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{adjacent.previous.title}</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              {adjacent.next && (
                <Pressable accessibilityRole="button" accessibilityLabel={`Next: ${adjacent.next.happenedYear}, ${adjacent.next.title}`} onPress={() => go(adjacent.next!.entryKey)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, gap: 4, alignItems: "flex-end", opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <Text style={[type.caption, { color: colour.inkMuted, textTransform: "uppercase", letterSpacing: 0.8 }]}>{adjacent.next.happenedYear}</Text>
                    <ChevronRight size={14} color={colour.inkMuted} />
                  </View>
                  <Text style={[type.smallMedium, { color: colour.ink, textAlign: "right" }]}>{adjacent.next.title}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </>
      )}
    </HubScreen>
  )
}
