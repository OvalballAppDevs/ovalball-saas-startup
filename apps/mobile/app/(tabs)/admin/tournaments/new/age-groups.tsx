import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { TOURNAMENT_AGE_GROUPS } from "@ovalball/contracts/club/tournaments"

import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { supabase } from "../../../../../src/auth/supabase"
import { CreateTournamentHeader, useTournamentDraft } from "../../../../../src/tournaments/create-context"
import { ageGroupCountLabel, clearAgeGroups, ourTeamsLabel, toggleAgeGroup, type DetachedAgeGroups } from "../../../../../src/tournaments/age-group-selection"
import { WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { Check, Info, Shirt } from "../../../../../src/components/icons"
import { colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * CREATE TOURNAMENT -- STEP 2 OF 4: AGE GROUPS.
 *
 * ONE QUESTION: which age groups are taking part? Everything else about a tournament's shape follows
 * from the answer -- the next step configures teams *within* each selected grade, which is why the
 * grades are chosen first and not derived from whichever teams somebody happened to add.
 *
 * THE GRADES ARE THE CANONICAL ONES, RE-EXPORTED, NEVER RE-DECLARED. `teams/age-groups.ts` mirrors
 * `teams.age_group`'s real check constraint, and exists precisely because two hardcoded copies once
 * drifted apart on the web. An earlier draft of the tournament contract invented its own list
 * (U7…U16+): it dropped U6 and U17-U19 and offered "U16+", which no team can hold. Offering a grade
 * a team cannot actually be would produce a tournament no team could be entered into.
 *
 * OUR OWN TEAM COUNTS ARE SHOWN, BUT THEY DO NOT GATE THE CHOICE. A host club can run a grade it
 * fields no side in -- hosting is not entering -- so the count is information, never a lock.
 */

/** Three across, per the approved mock-up. Four fitted, but left each option no room for a shirt
 * beside the grade and squeezed the selected state down to a bare tick in a corner. */
const GRID_COLS = 3

export default function AgeGroupsScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { clubId } = useAdminCentreAccess()
  const { draft, setDraft } = useTournamentDraft()
  const [ourTeamCounts, setOurTeamCounts] = useState<Record<string, number>>({})

  /**
   * DESELECTING MUST NOT SILENTLY DESTROY WORK. Once the next step exists, a grade carries the teams
   * the organiser put in it; an accidental tap here would take them with it. The removed grade is
   * kept aside for as long as this screen is open, so tapping it again restores exactly what was
   * there rather than an empty grade. Leaving the step is the deliberate act that drops it.
   */
  const detached = useRef<DetachedAgeGroups>(new Map())

  /**
   * THE UNDO EXPIRES WHEN THE ORGANISER MOVES ON.
   *
   * Found in the Simulator: the stash is a ref on this screen, and expo-router keeps the screen
   * MOUNTED in the stack rather than unmounting it when Teams is pushed. So a grade deselected here,
   * left behind, and re-added later came back carrying the clubs that used to be in it -- a stale
   * competition reappearing with no way for the organiser to know it had. Clearing on blur keeps the
   * behaviour a person expects on both sides: tapping a grade off and straight back on is an undo,
   * while removing it, going on, and adding it again is a genuinely new, empty competition.
   */
  useFocusEffect(
    useCallback(() => {
      return () => detached.current.clear()
    }, []),
  )

  useEffect(() => {
    if (!clubId) return
    let live = true
    void readClubTeams(supabase, clubId)
      .then((d) => {
        if (!live) return
        const counts: Record<string, number> = {}
        for (const t of d.teams) {
          if (!t.active || !t.ageGroup) continue
          counts[t.ageGroup] = (counts[t.ageGroup] ?? 0) + 1
        }
        setOurTeamCounts(counts)
      })
      .catch(() => {
        // The counts are a helpful annotation, not the question this screen asks. A club whose teams
        // cannot be read still gets to choose its grades rather than a blocked screen.
      })
    return () => {
      live = false
    }
  }, [clubId])

  const selected = useMemo(() => new Set(draft.ageGroups.map((a) => a.ageGroup)), [draft.ageGroups])

  const toggle = useCallback(
    (ageGroup: string) => setDraft((d) => ({ ...d, ageGroups: toggleAgeGroup(d.ageGroups, ageGroup, detached.current) })),
    [setDraft],
  )

  const clearAll = useCallback(() => setDraft((d) => ({ ...d, ageGroups: clearAgeGroups(d.ageGroups, detached.current) })), [setDraft])

  const count = draft.ageGroups.length
  const valid = count > 0
  const cell = (width - space.lg * 2 - space.sm * (GRID_COLS - 1)) / GRID_COLS

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <CreateTournamentHeader step={2} />

      {/* THE WHOLE STEP FITS WITHOUT SCROLLING ON AN IPHONE, and that is worth the tighter rhythm:
          fourteen cards plus the information panel at the previous spacing left the panel sliced in
          half by the footer, which reads as a broken layout rather than as more content below. */}
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.md, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.title, { color: colour.ink }]}>Age Groups</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Select the age groups taking part in this tournament.</Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {TOURNAMENT_AGE_GROUPS.map((ag) => (
            <AgeGroupCard
              key={ag}
              ageGroup={ag}
              width={cell}
              ourTeams={ourTeamCounts[ag] ?? 0}
              selected={selected.has(ag)}
              onPress={() => toggle(ag)}
            />
          ))}
        </View>

        {/* SUPPORTING INFORMATION, NOT ANOTHER FIELD. A tinted panel behind an information mark reads
            as an aside; the same words as loose body copy read as something still to be answered. */}
        <View
          style={{
            flexDirection: "row",
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2,
            borderRadius: radius.md,
            backgroundColor: colour.successSurface,
          }}
        >
          <View style={{ paddingTop: 1 }}>
            <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
          </View>
          <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
            The number of teams shows where your club already has a team at that age group. You can still
            run an age group your club does not field a side in.
          </Text>
        </View>
      </ScrollView>

      {/* THE RUNNING ANSWER, KEPT IN VIEW. It sits above the footer rather than under the grid so the
          count never scrolls away from the button that depends on it. */}
      {valid && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.sm,
            borderTopWidth: 1,
            borderTopColor: colour.line,
            backgroundColor: colour.surface,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{ageGroupCountLabel(count)}</Text>
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              {draft.ageGroups.map((a) => a.ageGroup).join(" · ")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear Selection"
            onPress={clearAll}
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: space.xs, paddingLeft: space.sm })}
          >
            <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Clear</Text>
          </Pressable>
        </View>
      )}

      <WizardFooter
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments/new" as never))}
        primaryLabel="Next: Add Teams"
        onPrimary={() => router.push("/admin/tournaments/new/teams" as never)}
        primaryDisabled={!valid}
        primaryHint="Select at least one age group to continue."
      />
    </View>
  )
}

/**
 * ONE GRADE, AS A CONTROL RATHER THAN A LABELLED BOX.
 *
 * THE SELECTED STATE CARRIES FOUR SIGNALS, NEVER COLOUR ALONE: a forest border, the grade and the
 * shirt turned green, the palest mint ground, and a filled circular check that is visibly part of
 * the card rather than a tick floating near it. Four signals is what makes it legible to somebody
 * who cannot separate the greens -- and it is why the tint stays almost white, because fourteen
 * cards at a real mint fill would be a wall of colour, and the point of a grid is seeing at a
 * glance which grades are in.
 */
function AgeGroupCard({
  ageGroup,
  width,
  ourTeams,
  selected,
  onPress,
}: {
  ageGroup: string
  width: number
  ourTeams: number
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={ourTeams > 0 ? `${ageGroup}. ${ourTeamsLabel(ourTeams)} at this club.` : ageGroup}
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        minHeight: 62,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colour.forest800 : colour.line,
        backgroundColor: selected ? colour.successSurface : colour.surface,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <Shirt size={20} color={selected ? colour.rugby700 : colour.inkSubtle} strokeWidth={1.7} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.heading, { color: selected ? colour.forest800 : colour.ink }]}>{ageGroup}</Text>
        {/* THE COUNT'S LINE IS ALWAYS RESERVED, even where there is no count. Without it the grade code
            rides up on the cards that have one, and the row's grades stop sitting on a shared line --
            fourteen cards at two different heights is the difference between a grid and a rubble pile. */}
        <View style={{ height: 14, justifyContent: "center" }}>
          {ourTeams > 0 && <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{ourTeamsLabel(ourTeams)}</Text>}
        </View>
      </View>
      {selected && (
        <View
          style={{
            // INSIDE the card, not straddling its corner. Overhanging read as a notification badge
            // stuck onto the card; tucked within the border it reads as the card's own state, and it
            // cannot be clipped by the column edge.
            position: "absolute",
            top: 6,
            right: 6,
            width: 20,
            height: 20,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colour.forest800,
          }}
        >
          <Check size={12} color={colour.onForest} strokeWidth={3} />
        </View>
      )}
    </Pressable>
  )
}
