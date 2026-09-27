import { useEffect, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

import { fixtureRequestGroupStatusLabel, isClearableGroupStatus, relativeTimeAgo, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"
import type { TeamFixtureRequest } from "@ovalball/contracts/team/requests"

import { ClubCrest } from "../components/identity"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../components/ui"
import { exactDate } from "../agenda/presentation"
import { dismissGroup, readDismissedGroupIds } from "./dismissed-groups"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * MY REQUESTS (owner correction pass, Sections 4-8): ONE shared view over the fixture-request-group
 * read model, fed by either a single team's rows or a whole club's -- exactly the Match Centre pattern
 * of "one component tree, a server-derived view model carrying what differs." Sent/Received/Confirmed
 * are mutually exclusive: a group that has converged into any real acceptance moves to Confirmed and
 * stays out of the other two, so the same ask is never tracked in two places at once.
 */
export type MyRequestsTab = "sent" | "received" | "confirmed"

function tabFor(group: FixtureRequestGroupSummary): MyRequestsTab {
  if (group.aggregateStatus === "confirmed" || group.aggregateStatus === "partially_confirmed") return "confirmed"
  return group.direction
}

export function MyRequestsView<T extends TeamFixtureRequest>({
  groups,
  problem,
  onRetry,
  canCreate,
  onOpenGroup,
  onWithdraw,
  withdrawingGroupId,
  teamLabel,
  initialTab = "sent",
}: {
  groups: FixtureRequestGroupSummary<T>[] | null
  problem: string | null
  onRetry: () => void
  canCreate: boolean
  onOpenGroup: (group: FixtureRequestGroupSummary<T>) => void
  onWithdraw: (group: FixtureRequestGroupSummary<T>) => void
  withdrawingGroupId: string | null
  /** How to label an individual child request's own team for the compact chip row -- "our" team in a
   * club context (several sides), or simply the one active team's own name in a team context. */
  teamLabel: (request: T) => string
  initialTab?: MyRequestsTab
}) {
  const [tab, setTab] = useState<MyRequestsTab>(initialTab)
  // A CLEARED WITHDRAWN CARD IS A VIEW PREFERENCE, never a change to the real request (Section: swipe
  // to clear a Withdrawn card). Loaded once per mount; a fresh withdrawal this session is never
  // pre-dismissed, since it was never added to the store.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => {
    void readDismissedGroupIds().then(setDismissed)
  }, [])

  const visibleGroups = useMemo(() => (groups ?? []).filter((g) => !(isClearableGroupStatus(g.aggregateStatus) && dismissed.has(g.groupId))), [groups, dismissed])

  const byTab = useMemo(() => {
    const result: Record<MyRequestsTab, FixtureRequestGroupSummary<T>[]> = { sent: [], received: [], confirmed: [] }
    for (const g of visibleGroups) result[tabFor(g)].push(g)
    return result
  }, [visibleGroups])

  const shown = byTab[tab]

  async function clear(groupId: string) {
    setDismissed(await dismissGroup(groupId))
  }

  return (
    <View style={{ gap: space.lg }}>
      <TabSegments
        value={tab}
        onChange={setTab}
        counts={{ sent: byTab.sent.length, received: byTab.received.length, confirmed: byTab.confirmed.length }}
      />

      {problem && !groups && <ErrorState message={problem} onRetry={onRetry} />}
      {!problem && groups === null && <CardSkeleton lines={3} />}

      {groups && shown.length === 0 && (
        <EmptyState
          title={tab === "sent" ? "Nothing sent" : tab === "received" ? "Nothing received" : "Nothing confirmed yet"}
          body={
            tab === "sent"
              ? canCreate
                ? "Ask another club for a match and it will be listed here until they answer."
                : "Requests sent to other clubs appear here."
              : tab === "received"
                ? "When another club asks for a match, it appears here."
                : "Once a request is accepted, it appears here alongside the fixture it became."
          }
        />
      )}

      {groups && shown.length > 0 && (
        <View style={{ gap: space.md }}>
          {shown.map((group) => (
            <SwipeToClear key={group.groupId} enabled={isClearableGroupStatus(group.aggregateStatus)} onClear={() => void clear(group.groupId)}>
              <RequestGroupCard
                group={group}
                onOpen={() => onOpenGroup(group)}
                onWithdraw={group.canWithdraw ? () => onWithdraw(group) : undefined}
                withdrawing={withdrawingGroupId === group.groupId}
                teamLabel={teamLabel}
              />
            </SwipeToClear>
          ))}
        </View>
      )}
    </View>
  )
}

function TabSegments({
  value,
  onChange,
  counts,
}: {
  value: MyRequestsTab
  onChange: (next: MyRequestsTab) => void
  counts: Record<MyRequestsTab, number>
}) {
  const options: { key: MyRequestsTab; label: string }[] = [
    { key: "sent", label: "Sent" },
    { key: "received", label: "Received" },
    { key: "confirmed", label: "Confirmed" },
  ]
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}>
      {options.map((option) => {
        const selected = option.key === value
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label}${counts[option.key] > 0 ? `, ${counts[option.key]}` : ""}`}
            onPress={() => onChange(option.key)}
            style={{
              flex: 1,
              minHeight: TOUCH_TARGET - 8,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 6,
              borderRadius: radius.sm,
              backgroundColor: selected ? colour.forest800 : colour.surface,
            }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink }]}>{option.label}</Text>
            {counts[option.key] > 0 && (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 4,
                  borderRadius: 9,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? "rgba(255,255,255,0.22)" : "rgba(16,21,18,0.08)",
                }}
              >
                <Text style={[type.caption, { color: selected ? colour.onForest : colour.inkMuted, fontSize: 11 }]}>{counts[option.key]}</Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

function RequestGroupCard<T extends TeamFixtureRequest>({
  group,
  onOpen,
  onWithdraw,
  withdrawing,
  teamLabel,
}: {
  group: FixtureRequestGroupSummary<T>
  onOpen: () => void
  onWithdraw?: () => void
  withdrawing: boolean
  teamLabel: (request: T) => string
}) {
  const status = fixtureRequestGroupStatusLabel(group)
  const dateSummary = group.proposedDate ? exactDate(group.proposedDate) : group.hasMixedDates ? "Multiple dates" : "Date to be agreed"
  const chips = group.requests.slice(0, 3).map(teamLabel)
  const overflow = group.requests.length - chips.length
  const whenLabel = group.direction === "sent" ? `Sent ${relativeTimeAgo(group.createdAt)}` : `Received ${relativeTimeAgo(group.createdAt)}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.otherClub}, ${group.teamCount} ${group.teamCount === 1 ? "team" : "teams"}, ${status.label}`}
      onPress={onOpen}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        padding: space.md,
        gap: space.sm,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <ClubCrest clubName={group.otherClub} url={group.otherClubCrestUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>
            {group.otherClub}
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {group.teamCount} {group.teamCount === 1 ? "team" : "teams"} · {dateSummary}
          </Text>
        </View>
        <StatusPill label={status.label} tone={status.tone} />
      </View>

      {chips.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chips.map((label, i) => (
            <View key={i} style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "rgba(16,21,18,0.05)" }}>
              <Text style={[type.caption, { color: colour.ink }]}>{label}</Text>
            </View>
          ))}
          {overflow > 0 && (
            <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "rgba(16,21,18,0.05)" }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>+{overflow}</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{whenLabel}</Text>
        {onWithdraw && (
          <Button
            label="Withdraw"
            variant="quiet"
            busy={withdrawing}
            onPress={onWithdraw}
            style={{ minHeight: TOUCH_TARGET - 12, paddingHorizontal: space.md }}
          />
        )}
      </View>
    </Pressable>
  )
}

const CLEAR_WIDTH = 88

/**
 * SWIPE TO CLEAR A FINISHED CARD. Enabled only where `isClearableGroupStatus` says the group has
 * genuinely finished (Confirmed, Declined, Withdrawn, Expired) -- a Pending, Under Discussion or
 * Partially Confirmed card is never dismissable this way, since it still has real outstanding work.
 * Clearing removes the card from THIS viewer's list; it never touches the real, permanent
 * `fixture_requests` row underneath.
 */
function SwipeToClear({ enabled, onClear, children }: { enabled: boolean; onClear: () => void; children: React.ReactNode }) {
  const tx = useSharedValue(0)

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          tx.value = Math.min(0, Math.max(e.translationX, -CLEAR_WIDTH * 1.3))
        })
        .onEnd(() => {
          tx.value = withTiming(tx.value < -CLEAR_WIDTH / 2 ? -CLEAR_WIDTH : 0, { duration: 160 })
        }),
    [enabled, tx]
  )

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }))

  if (!enabled) return <>{children}</>

  return (
    <View style={{ borderRadius: radius.lg, overflow: "hidden" }}>
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: CLEAR_WIDTH }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear this withdrawn request"
          onPress={() => {
            tx.value = withTiming(0, { duration: 120 })
            onClear()
          }}
          style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colour.dangerSurface }}
        >
          <Text style={[type.smallMedium, { color: colour.danger }]}>Clear</Text>
        </Pressable>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={style}>{children}</Animated.View>
      </GestureDetector>
    </View>
  )
}
