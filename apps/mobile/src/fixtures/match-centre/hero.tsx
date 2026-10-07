import { Image } from "expo-image"
import { Pressable, Text, View } from "react-native"

import { matchStatusPresentation, type MatchStatusIcon } from "@ovalball/contracts"

import { ClubCrest } from "../../components/identity"
import { KitPlaceholder, RugbyKit } from "../../components/rugby-kit"
import { CalendarDays, Check as CircleCheckIcon, CircleAlert, CircleDashed, Clock, MapPin, Users } from "../../components/icons"
import { kickoffLabel } from "../../agenda/presentation"
import { colour, radius, space, type } from "../../design/tokens"
import type { MatchCentreSide, MatchCentreView } from "../../match-centre/load"

/**
 * WHAT THE HERO DRAWS -- the facts every game has, whether it is a fixture or one game of a tournament.
 * A fixture's whole view model satisfies it; a tournament game builds one from its own record, so both
 * are drawn by this one component rather than two that drift.
 */
export type MatchHeroModel = Pick<
  MatchCentreView,
  "status" | "resultStatus" | "cancelled" | "cancellationReason" | "matchType" | "competitionName" | "home" | "away" | "viewerSide" | "result" | "date" | "meetTime" | "kickoffTime"
> & { venue: { name: string | null }; pitch: { name: string | null } }

/**
 * THE MATCH CENTRE HERO -- the approved Part 1 composition, built on the existing dark-green banner.
 *
 *   HOME ................ V ................ AWAY
 *   shirt + crest                    shirt + crest
 *   club name (opens the public club page)
 *   team name (opens the public team page)
 *   YOU'RE HOME / YOU'RE AWAY -- only for somebody who belongs to that side
 *
 *   DATE | MEET | KICK-OFF | VENUE
 *
 * The ground is a floodlit pitch photographed for this (Higgsfield, checked by eye) under a forest
 * wash, so the words stay real text with full contrast. Shirts are the clubs' own configured kits from
 * `club_kits`; a club with none gets the finished placeholder, never invented colours. Meet time is a
 * first-class fact: "Not set" is said rather than the cell disappearing.
 */
const PITCH = require("../../../assets/match-centre/hero-pitch.jpg")

const STATUS_ICON: Record<MatchStatusIcon, typeof CircleDashed> = {
  "circle-check": CircleCheckIcon,
  "circle-dashed": CircleDashed,
  "circle-alert": CircleAlert,
}
const STATUS_PAINT: Record<string, { edge: string; wash: string; text: string }> = {
  positive: { edge: "rgba(90,203,131,0.45)", wash: "rgba(90,203,131,0.18)", text: "#bff0d1" },
  caution: { edge: "rgba(251,191,36,0.45)", wash: "rgba(251,191,36,0.15)", text: "#fde8b0" },
  negative: { edge: "rgba(248,113,113,0.50)", wash: "rgba(239,68,68,0.20)", text: "#fecaca" },
  neutral: { edge: "rgba(255,255,255,0.20)", wash: "rgba(255,255,255,0.10)", text: "rgba(255,255,255,0.85)" },
}

export function MatchHero({
  view,
  onOpenClub,
  onOpenTeam,
  onOpenVenue,
  relationLabels = { home: "YOU'RE HOME", away: "YOU'RE AWAY" },
}: {
  view: MatchHeroModel
  onOpenClub: (side: MatchCentreSide) => void
  onOpenTeam: (side: MatchCentreSide) => void
  onOpenVenue?: () => void
  /** A tournament game has no home and away, so it says "YOUR SIDE" instead. */
  relationLabels?: { home: string; away: string }
}) {
  const status = matchStatusPresentation(view.status)
  const StatusIcon = STATUS_ICON[status.icon]
  const paint = STATUS_PAINT[status.tone]
  const qualifier = resultQualifier(view.resultStatus)

  return (
    <View style={{ backgroundColor: colour.forest950, overflow: "hidden", opacity: view.cancelled ? 0.94 : 1 }}>
      <Image
        source={PITCH}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        contentFit="cover"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(7,28,20,0.62)" }} />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, backgroundColor: "rgba(7,28,20,0.55)" }} />

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs + 2,
            paddingHorizontal: space.md,
            paddingVertical: 5,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: paint.edge,
            backgroundColor: paint.wash,
          }}
        >
          <StatusIcon size={13} color={paint.text} strokeWidth={2.4} />
          <Text style={[type.caption, { color: paint.text, fontFamily: "Inter_500Medium" }]}>{status.label}</Text>
        </View>
        {(view.matchType || view.competitionName) && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.onForestMuted, flexShrink: 1 }]}>
            {[view.matchType, view.competitionName].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space.sm, paddingTop: space.md, gap: space.xs }}>
        <SideColumn side={view.home} relation={view.viewerSide === "home" ? relationLabels.home : null} onOpenClub={onOpenClub} onOpenTeam={onOpenTeam} />
        <View style={{ alignItems: "center", paddingTop: 44, minWidth: 54 }}>
          {view.result ? (
            <>
              <Text
                accessibilityLabel={`${qualifier ? "Provisional score" : "Score"}: ${view.home.clubName} ${view.result.homeScore}, ${view.away.clubName} ${view.result.awayScore}${qualifier ? `. ${qualifier}` : ""}`}
                style={[type.display, { color: colour.chalk, fontSize: 38, lineHeight: 42 }]}
              >
                {view.result.homeScore}–{view.result.awayScore}
              </Text>
              {!!qualifier && (
                <Text style={[type.caption, { color: colour.onForestMuted, textAlign: "center", fontSize: 10, letterSpacing: 0.6, maxWidth: 90 }]}>{qualifier.toUpperCase()}</Text>
              )}
            </>
          ) : (
            <Text accessibilityLabel="versus" style={[type.display, { color: colour.chalk, fontSize: 40, lineHeight: 44 }]}>
              V
            </Text>
          )}
        </View>
        <SideColumn side={view.away} relation={view.viewerSide === "away" ? relationLabels.away : null} onOpenClub={onOpenClub} onOpenTeam={onOpenTeam} />
      </View>

      {/* THE FOUR FACTS. Meet carries the same weight as kick-off: it is the time a family acts on. */}
      <View
        style={{
          flexDirection: "row",
          marginTop: space.lg,
          marginHorizontal: space.md,
          marginBottom: space.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.14)",
          backgroundColor: "rgba(7,28,20,0.55)",
        }}
      >
        <Fact Icon={CalendarDays} label="DATE" value={compactDate(view.date)} />
        <Fact Icon={Users} label="MEET" value={kickoffLabel(view.meetTime) ?? "Not set"} muted={!view.meetTime} divider />
        <Fact Icon={Clock} label="KICK-OFF" value={kickoffLabel(view.kickoffTime) ?? "TBC"} muted={!view.kickoffTime} divider />
        <Fact
          Icon={MapPin}
          label="VENUE"
          value={view.venue.name ?? "To be confirmed"}
          detail={view.pitch.name}
          muted={!view.venue.name}
          divider
          onPress={view.venue.name && onOpenVenue ? onOpenVenue : undefined}
          wide
        />
      </View>

      {view.cancelled && (
        <Text accessibilityRole="alert" style={[type.small, { color: "#fecaca", paddingHorizontal: space.lg, paddingBottom: space.md }]}>
          <Text style={{ fontFamily: "Inter_600SemiBold" }}>Cancelled. </Text>
          {view.cancellationReason ?? "This fixture is not going ahead."}
        </Text>
      )}
    </View>
  )
}

/**
 * ONE SIDE: the shirt with the crest on it, the club (to the public club page) and the team (to the
 * public team page). Both links use canonical ids; a side that is only a name has nothing to open.
 */
function SideColumn({
  side,
  relation,
  onOpenClub,
  onOpenTeam,
}: {
  side: MatchCentreSide
  relation: string | null
  onOpenClub: (side: MatchCentreSide) => void
  onOpenTeam: (side: MatchCentreSide) => void
}) {
  const canOpenClub = Boolean(side.directoryId)
  const canOpenTeam = Boolean(side.teamId)
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
      <View style={{ width: 112, height: 104, alignItems: "center", justifyContent: "center" }}>
        {side.kit ? <RugbyKit kit={side.kit} clubName={side.clubName} size={104} /> : <KitPlaceholder size={96} />}
        <View
          style={{
            position: "absolute",
            bottom: -6,
            right: 2,
            borderRadius: radius.md,
            padding: 3,
            backgroundColor: colour.surface,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 3 },
            elevation: 4,
          }}
        >
          <ClubCrest clubName={side.clubName} url={side.crestUrl} size={36} />
        </View>
      </View>
      <Pressable
        accessibilityRole={canOpenClub ? "link" : "text"}
        accessibilityLabel={canOpenClub ? `${side.clubName}. Opens the club page` : side.clubName}
        disabled={!canOpenClub}
        onPress={() => onOpenClub(side)}
        hitSlop={6}
        style={({ pressed }) => ({ marginTop: space.md, minHeight: 32, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={[type.heading, { color: colour.chalk, textAlign: "center", fontSize: 16, lineHeight: 20 }]}>{side.clubName}</Text>
      </Pressable>
      {!!side.teamName && (
        <Pressable
          accessibilityRole={canOpenTeam ? "link" : "text"}
          accessibilityLabel={canOpenTeam ? `${side.teamName}. Opens the team page` : side.teamName}
          disabled={!canOpenTeam}
          onPress={() => onOpenTeam(side)}
          hitSlop={6}
          style={({ pressed }) => ({ minHeight: 28, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={[type.small, { color: colour.onForestMuted, textAlign: "center", textDecorationLine: canOpenTeam ? "underline" : "none" }]}>{side.teamName}</Text>
        </Pressable>
      )}
      {!side.onOvalball && (
        <Text style={[type.caption, { color: colour.onForestMuted, fontSize: 10, letterSpacing: 0.6, textAlign: "center", marginTop: 2 }]}>NOT YET ON OVALBALL</Text>
      )}
      {!!relation && (
        <View
          style={{
            marginTop: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: 4,
            borderRadius: radius.pill,
            backgroundColor: relation === "YOU'RE AWAY" ? "rgba(255,255,255,0.16)" : colour.pitch600,
          }}
        >
          <Text style={[type.caption, { color: relation === "YOU'RE AWAY" ? colour.chalk : colour.forest950, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6 }]}>{relation}</Text>
        </View>
      )}
    </View>
  )
}

function Fact({
  Icon,
  label,
  value,
  detail,
  muted = false,
  divider = false,
  onPress,
  wide = false,
}: {
  Icon: typeof CalendarDays
  label: string
  value: string
  detail?: string | null
  muted?: boolean
  divider?: boolean
  onPress?: () => void
  wide?: boolean
}) {
  const body = (
    <View style={{ alignItems: "center", gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Icon size={11} color={colour.onForestMuted} />
        <Text style={[type.caption, { color: colour.onForestMuted, fontSize: 10, letterSpacing: 0.6 }]}>{label}</Text>
      </View>
      <Text numberOfLines={2} style={[type.smallMedium, { color: muted ? colour.onForestMuted : colour.chalk, textAlign: "center", fontSize: 13, lineHeight: 16 }]}>
        {value}
      </Text>
      {!!detail && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.onForestMuted, fontSize: 10, textAlign: "center" }]}>
          {detail}
        </Text>
      )}
    </View>
  )
  const style = {
    flex: wide ? 1.35 : 1,
    paddingVertical: space.md,
    paddingHorizontal: 4,
    borderLeftWidth: divider ? 1 : 0,
    borderLeftColor: "rgba(255,255,255,0.12)",
    justifyContent: "center" as const,
  }
  if (!onPress) return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}`} style={style}>{body}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}. Opens Arena Details`}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  )
}

/** "Sat 17 Oct" -- a plain calendar date, never shifted by the device's timezone. */
export function compactDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** The words for a result that is not yet final, from the canonical status alone; null when it is. */
export function resultQualifier(status: string | null): string | null {
  switch (status) {
    case "awaiting_confirmation":
      return "Awaiting the other club's confirmation"
    case "amendment_pending":
      return "A correction is being agreed"
    case "disputed":
      return "Disputed"
    case "unverified":
      return "Not yet verified"
    default:
      return null
  }
}
