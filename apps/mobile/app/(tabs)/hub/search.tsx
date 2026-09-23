import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { searchRugbyHub, type HubSearchResult } from "@ovalball/contracts/rugby-hub/rugby-hub-search"

import { supabase } from "../../../src/auth/supabase"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { useHubIdentity } from "../../../src/hub/identity"
import { forgetRecentSearches, readRecentSearches, rememberSearch } from "../../../src/hub/recent"
import { openHubHref } from "../../../src/hub/routes"
import { HubScreen } from "../../../src/hub/screen"
import { HubChips, HubFailed, HubLoading, HubOverline, HubSearchField } from "../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * ONE RUGBY HUB SEARCH, and it is the website's.
 *
 * `searchRugbyHub` wraps the one `search_hub_content` RPC -- content items,
 * positions, skills, glossary terms, laws and story entries, ranked, published
 * only -- and adds the type label and the canonical href per result. That
 * function moved to the shared package unchanged, so a query typed here
 * returns exactly what the same query returns in a browser, and every result
 * opens through the one route table.
 *
 * THE VIEWER'S IDENTITY IS A GROUPING SIGNAL ONLY. It is passed so RULE results
 * for the viewer's own age grade are labelled as theirs; it never narrows what
 * the RPC returns, and a law for a different age grade is still a result.
 *
 * RESULTS ARE GROUPED BY TYPE for a thumb rather than a mouse: a phone shows
 * six rows at once, and "three glossary terms, then two laws, then a position"
 * scans faster than one interleaved list. The RANK still decides the order
 * inside each group and which group comes first.
 */
const MIN_QUERY = 2

export default function HubSearchScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ q?: string }>()
  const { identity, loading: identityLoading } = useHubIdentity()
  const [query, setQuery] = useState(typeof params.q === "string" ? params.q : "")
  const [results, setResults] = useState<HubSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const requestId = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void readRecentSearches().then(setRecent)
  }, [])

  const run = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (q.length < MIN_QUERY) {
        setResults(null)
        setSearching(false)
        return
      }
      const mine = ++requestId.current
      setSearching(true)
      setError(null)
      try {
        const found = await searchRugbyHub(supabase, q, 20, identity?.regulatoryIdentityId ?? null)
        if (mine !== requestId.current) return
        setResults(found)
        void rememberSearch(q).then(setRecent)
      } catch (cause) {
        if (mine !== requestId.current) return
        const translated = friendly(cause, "search")
        logDetail("hub:search", translated)
        setError(translated)
        setResults([])
      } finally {
        if (mine === requestId.current) setSearching(false)
      }
    },
    [identity?.regulatoryIdentityId]
  )

  useEffect(() => {
    if (identityLoading) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void run(query), 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, run, identityLoading])

  const trimmed = query.trim()
  const groups = results ? groupByType(results) : []

  return (
    <HubScreen section="Search" isSearch contentStyle={{ paddingTop: space.md }}>
      <HubSearchField value={query} onChange={setQuery} onSubmit={() => void run(query)} autoFocus />

      {trimmed.length < MIN_QUERY ? (
        recent.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <HubOverline>Recent</HubOverline>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                onPress={() => {
                  void forgetRecentSearches()
                  setRecent([])
                }}
                hitSlop={8}
                style={{ minHeight: 36, justifyContent: "center" }}
              >
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>Clear</Text>
              </Pressable>
            </View>
            <HubChips items={recent.map((r) => ({ label: r, onPress: () => setQuery(r) }))} />
          </View>
        ) : (
          <Text style={[type.small, { color: colour.inkMuted }]}>Type a word you heard at the pitch, a position, a skill or a law. Results come from every part of the Rugby Hub at once.</Text>
        )
      ) : searching && results === null ? (
        <HubLoading rows={3} />
      ) : error ? (
        <HubFailed error={error} onRetry={() => void run(query)} />
      ) : results && results.length === 0 ? (
        <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
          <Text style={[type.bodyMedium, { color: colour.ink, textAlign: "center" }]}>No results for “{trimmed}”</Text>
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>Check the spelling, or browse Positions, Skills or Rules directly.</Text>
          <HubChips
            items={[
              { label: "Positions", href: "/rugby-hub/positions" },
              { label: "Skills", href: "/rugby-hub/skills" },
              { label: "Rules", href: "/rugby-hub/rules" },
            ]}
          />
        </View>
      ) : (
        <View style={{ gap: space.lg }}>
          {searching && <Text style={[type.caption, { color: colour.inkMuted }]}>Searching…</Text>}
          {groups.map((g) => (
            <View key={g.label} style={{ gap: space.sm }}>
              <HubOverline>{g.label}</HubOverline>
              <View style={{ gap: space.sm }}>
                {g.items.map((r) => (
                  <Pressable
                    key={`${r.type}-${r.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title}, ${r.typeLabel}`}
                    accessibilityHint={r.snippet}
                    onPress={() => openHubHref(router, r.href)}
                    style={({ pressed }) => ({
                      minHeight: TOUCH_TARGET + 12,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      borderRadius: radius.lg,
                      borderWidth: 1,
                      borderColor: pressed ? "rgba(50,166,101,0.45)" : colour.line,
                      backgroundColor: pressed ? "rgba(220,247,229,0.5)" : colour.surface,
                      gap: 2,
                    })}
                  >
                    <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>{r.title}</Text>
                    <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_500Medium" }]}>{r.typeLabel}</Text>
                    {r.snippet ? (
                      <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={2}>
                        {r.snippet}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </HubScreen>
  )
}

/** Groups keep the RPC's rank: the first group is the one holding the best result, and so on down. */
function groupByType(results: HubSearchResult[]): { label: string; items: HubSearchResult[] }[] {
  const order: string[] = []
  const byLabel = new Map<string, HubSearchResult[]>()
  for (const r of results) {
    if (!byLabel.has(r.typeLabel)) {
      byLabel.set(r.typeLabel, [])
      order.push(r.typeLabel)
    }
    byLabel.get(r.typeLabel)!.push(r)
  }
  return order.map((label) => ({ label, items: byLabel.get(label)! }))
}
