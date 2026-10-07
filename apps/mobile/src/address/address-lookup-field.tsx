import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts/database"
import { type AddressSuggestion, type CanonicalAddress, userMessageForFailure } from "@ovalball/contracts/address"

import { MapPin, Search, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { resolveAddress, suggestAddresses } from "./address-lookup"
import { barePostcodeGuidance, hintForAddressResult, isCurrentRequest, postcodeCaveat } from "./address-search-logic"

type Client = SupabaseClient<Database>

const SEARCH_DEBOUNCE_MS = 350
const MIN_QUERY_LENGTH = 3

/**
 * THE SITEWIDE CANONICAL LOCATION SEARCH -- mobile. The approved layout is unchanged: one search
 * field, a location-pin result list beneath it as you type, and a selection that populates the
 * canonical fields and the map itself.
 *
 * POSTCODE-FIRST, BECAUSE THAT IS WHAT CAN BE ANSWERED HONESTLY. postcodes.io holds no Royal Mail /
 * PAF property records, so this list contains real POSTCODES, never invented houses. Picking one
 * resolves its true geography and coordinates; the building name and street remain Ovalball's own
 * data in the confirmation fields below, typed by the person and never attributed to a provider.
 *
 * DISPLAY, THEN SEARCH. When `currentAddressLine` is non-empty this starts collapsed, showing that
 * line the way the mock-up's Edit Venue Details screen does -- tapping it opens the search field.
 * Nothing is applied until a postcode is actually picked: closing the search (the X) or navigating
 * away leaves the caller's own draft untouched, so "Cancel preserves the previous address" falls out
 * of this component never calling `onResolve` on its own.
 */
export function AddressLookupField({
  supabase,
  currentAddressLine,
  onResolve,
}: {
  supabase: Client
  /** The address the caller's draft currently holds, joined into one line -- shown collapsed until
   * the person taps to search. Empty/null shows the mock-up's own placeholder instead. */
  currentAddressLine: string | null
  onResolve: (address: CanonicalAddress) => void
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  // ONE Google billing session per search. Generated when the search opens and handed to every
  // autocomplete request and the final resolve, so a whole typed search is billed once rather than
  // once per keystroke.
  const sessionToken = useRef("")
  const requestSeq = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (trimmed.length < MIN_QUERY_LENGTH) {
        setSuggestions([])
        setHint(null)
        setLoading(false)
        setSearched(false)
        return
      }
      const id = ++requestSeq.current
      setLoading(true)
      const result = await suggestAddresses(supabase, trimmed, sessionToken.current)
      if (!isCurrentRequest(id, requestSeq.current)) return
      setLoading(false)
      setSearched(true)
      setSuggestions(result.status === "ok" ? result.suggestions : [])
      // A bare postcode legitimately returns the street rather than the houses -- say so, instead of
      // letting it look like a broken search. See `barePostcodeGuidance`.
      setHint(hintForAddressResult(result) ?? barePostcodeGuidance(trimmed))
    },
    [supabase]
  )

  function onChangeQuery(next: string) {
    setQuery(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(next), SEARCH_DEBOUNCE_MS)
  }

  function openSearch() {
    sessionToken.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    setQuery("")
    setSuggestions([])
    setHint(null)
    setSearched(false)
    setSearching(true)
  }

  function closeSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearching(false)
    setQuery("")
    setSuggestions([])
    setHint(null)
    setSearched(false)
  }

  async function handlePick(suggestion: AddressSuggestion) {
    setResolving(true)
    setHint(null)
    const result = await resolveAddress(supabase, suggestion.placeId, sessionToken.current)
    setResolving(false)
    if (result.status === "ok") {
      onResolve(result.address)
      // A postcode that came from the map rather than the provider is flagged before the search
      // closes, so the person knows to check it rather than discovering it later.
      const caveat = postcodeCaveat(result.address)
      closeSearch()
      if (caveat) setHint(caveat)
      return
    }
    setHint(userMessageForFailure(result))
  }

  if (!searching) {
    return (
      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>ADDRESS</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={currentAddressLine ? `Address: ${currentAddressLine}. Tap to change.` : "Search for an address or postcode"}
          onPress={openSearch}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: colour.surface,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {currentAddressLine ? <MapPin size={18} color={colour.forest800} strokeWidth={1.9} /> : <Search size={18} color={colour.inkSubtle} strokeWidth={1.9} />}
          <Text numberOfLines={2} style={[type.body, { color: currentAddressLine ? colour.ink : colour.inkSubtle, flex: 1 }]}>
            {currentAddressLine || "Search for an address or postcode..."}
          </Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>ADDRESS</Text>

      <View
        style={{
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colour.forest800,
          backgroundColor: colour.surface,
        }}
      >
        <Search size={18} color={colour.inkSubtle} strokeWidth={1.9} />
        <TextInput
          accessibilityLabel="Search for an address or postcode"
          autoFocus
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search for an address or postcode..."
          placeholderTextColor={colour.inkSubtle}
          autoCapitalize="words"
          autoCorrect={false}
          selectionColor={colour.pitch600}
          style={[type.body, { color: colour.ink, flex: 1, minHeight: TOUCH_TARGET }]}
        />
        {loading || resolving ? (
          <ActivityIndicator size="small" color={colour.forest800} />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel search" onPress={closeSearch} hitSlop={8} style={{ padding: space.xs }}>
            <X size={18} color={colour.inkSubtle} strokeWidth={1.9} />
          </Pressable>
        )}
      </View>

      {resolving && <Text style={[type.small, { color: colour.inkMuted }]}>Confirming location…</Text>}

      {/* Says exactly what this search can do, so nobody types a house number and concludes the
          feature is broken. The building and street are confirmed below, in Ovalball's own fields. */}
      {!resolving && query.trim().length < MIN_QUERY_LENGTH && (
        <View style={{ borderRadius: radius.md, backgroundColor: colour.mint100, padding: space.md }}>
          <Text style={[type.small, { color: colour.forest800 }]}>
            Start typing a building name, street or postcode — then pick the address from the list.
          </Text>
        </View>
      )}

      {!resolving && query.trim().length >= MIN_QUERY_LENGTH && hint && <Text style={[type.small, { color: colour.inkMuted }]}>{hint}</Text>}

      {!resolving && !loading && searched && !hint && suggestions.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>We couldn&apos;t find that address.</Text>}

      {!resolving && suggestions.length > 0 && (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {suggestions.map((suggestion, i) => (
            <Pressable
              key={suggestion.placeId}
              accessibilityRole="button"
              accessibilityLabel={suggestion.label}
              onPress={() => void handlePick(suggestion)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET + 6,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colour.line,
                backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
              })}
            >
              <MapPin size={17} color={colour.forest800} strokeWidth={1.9} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                  {suggestion.primary}
                </Text>
                {!!suggestion.secondary && (
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                    {suggestion.secondary}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}
