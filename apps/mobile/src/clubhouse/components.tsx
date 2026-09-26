import type { ReactNode } from "react"
import { Image, Pressable, Text, View } from "react-native"
import type { ClubhouseDistanceFilter, ClubMapMarker } from "@ovalball/contracts/clubhouse"

import { Button, StatusPill } from "../components/ui"
import { MapPin } from "../components/icons"
import { colour, elevation, radius, space, type } from "../design/tokens"

/**
 * SHARED CLUBHOUSE PRESENTATION -- the same crest, network/partner pill and distance chips the main
 * Clubhouse map/list screen uses, extracted here (Clubhouse Programme Section 6) so Find a Fixture's
 * results reuse them exactly rather than drifting into a second, slightly-different look. Nothing about
 * either component changed in the move.
 */

/**
 * THE SHARED CLUBHOUSE EMPTY STATE (owner correction pass, physical device review): a compact, premium
 * warm-surface card with a real icon, never the generic dashed-border placeholder box, which read as
 * unfinished admin/SaaS chrome on a real screen. Partnerships and Looking for Opposition both had the
 * exact same "whole tab is one big empty rectangle" problem, independently -- shared here rather than
 * two near-identical implementations drifting apart.
 */
export function ClubhouseEmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm, alignItems: "center", ...elevation.card }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>{icon}</View>
      <Text style={[type.bodyMedium, { color: colour.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", maxWidth: 280 }]}>{body}</Text>
      {action && <Button label={action.label} onPress={action.onPress} style={{ marginTop: space.sm, alignSelf: "stretch" }} />}
    </View>
  )
}

export function NetworkPill({ marker }: { marker: ClubMapMarker }) {
  if (marker.partnershipStatus === "active") return <StatusPill label="Partner" tone="positive" />
  if (marker.networkState === "on_ovalball") return <StatusPill label="On Ovalball" tone="positive" />
  return <StatusPill label="Not yet on Ovalball" tone="caution" />
}

export function ClubCrest({ url, size }: { url: string | null; size: number }) {
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colour.chalk }} accessibilityIgnoresInvertColors />
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line, alignItems: "center", justifyContent: "center" }}>
      <MapPin size={size * 0.45} color={colour.inkSubtle} />
    </View>
  )
}

export const CLUBHOUSE_DISTANCES: { key: ClubhouseDistanceFilter; label: string }[] = [
  { key: 10, label: "10 mi" },
  { key: 25, label: "25 mi" },
  { key: 50, label: "50 mi" },
  { key: 100, label: "100 mi" },
  { key: "any", label: "Any" },
]

/**
 * Only ever rendered when `findDistanceOrigin` found a real, factual origin (the viewer's own club's
 * geocoded location) -- see the Clubhouse read model. There is no device-location fallback: Section 56
 * requires personal location permission to stay optional/unnecessary to use Clubhouse at all.
 */
export function DistanceChips({ distance, onChange }: { distance: ClubhouseDistanceFilter; onChange: (d: ClubhouseDistanceFilter) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Filter by distance" style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
      {CLUBHOUSE_DISTANCES.map((d) => {
        const on = distance === d.key
        return (
          <Pressable
            key={d.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(d.key)}
            style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, justifyContent: "center" }}
          >
            <Text style={[type.caption, { color: on ? colour.forest800 : colour.ink }]}>{d.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
