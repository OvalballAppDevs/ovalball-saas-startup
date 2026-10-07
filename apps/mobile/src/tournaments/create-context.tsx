import { createContext, useContext, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { TournamentFormat, TournamentVisibility } from "@ovalball/contracts/club/tournaments"

import type { TournamentCoverChoice } from "./cover-control"

import { ChevronLeft, X } from "../components/icons"
import { colour, radius, space, surface, type } from "../design/tokens"

/** Short enough to sit four-across on a phone without truncating -- the rail said
 * "2. Select Age…", "3. Configure T…" before. The full names live on each screen's own heading. */
export const CREATE_TOURNAMENT_STEPS = ["Basic Details", "Age Groups", "Teams", "Review"] as const

/**
 * ONE TOURNAMENT DRAFT, HELD ACROSS THE WHOLE WIZARD.
 *
 * Nothing here touches the database until Review & Create. The draft is the organiser's work in
 * progress: switching between age groups, removing one of our own sides, adding another club's teams
 * -- all of it has to survive moving backwards and forwards through the steps, which is exactly what
 * a screen-local `useState` cannot do.
 *
 * THE SHAPE IS THE PRODUCT MODEL, NOT A FLAT LIST. A tournament runs age groups; each age group has
 * our own teams and other clubs' teams under it. Flattening that into one participant array would
 * lose which age group somebody is in the moment two age groups contain the same club.
 */

/**
 * ONE PARTICIPATING SIDE, shaped like the row it will become.
 *
 * Deliberately flat rather than a club holding a list of teams: one of these maps exactly onto one
 * `tournament_participants` row, and onto that table's uniqueness key. A nested shape would let the
 * draft hold a club with three sides while the database can only be asked about one side at a time,
 * and the two would drift the moment a side is removed.
 */
export interface DraftSide {
  /** Stable within an age group: the team id for an Ovalball side, directory + label for an external
   * one. This is what deduplication and removal are keyed on. */
  key: string
  /** The canonical directory row. An external club has one of these too -- it is how a club that is
   * not on Ovalball is represented without inventing a club record for it. */
  directoryId: string
  clubName: string
  /** Set only when the club is genuinely on Ovalball. Null means external, and the participant will
   * be recorded as `external_recorded` rather than `added`. */
  clubId: string | null
  crestUrl: string | null
  /** The real team, for an Ovalball club. Null for an external side, which has no team row. */
  teamId: string | null
  /** What this side is called: the canonical derived team name, or the organiser's typed label. For a
   * directory club entered without a squad name this is the age group, for display only. */
  label: string
  /** What actually gets written to `squad_label`. Null when the organiser named nothing, which is a
   * real state -- a club coming with one unnamed side. Never the display fallback. */
  squadLabel?: string | null
}

export interface DraftAgeGroup {
  ageGroup: string
  /**
   * THE HOST'S OWN SIDES, as team ids. NULL means "not looked at yet", and the Teams step fills it
   * from the club's real teams at this grade; an empty array means the organiser deliberately took
   * them all out, which must survive switching grades and must not be re-seeded behind their back.
   */
  ourTeamIds: string[] | null
  /** Every other club's side at this grade -- Ovalball and external alike. */
  sides: DraftSide[]
}

export interface TournamentDraft {
  name: string
  startsOn: string | null
  endsOn: string | null
  startTime: string | null
  multiDay: boolean
  format: TournamentFormat
  /** Only ever set while the format IS swiss -- the database refuses a round count on any other
   * shape, so carrying one through a format change would fail at the last moment. */
  swissRounds: number | null
  visibility: TournamentVisibility
  /** The photograph chosen on Basic Details. `undefined` means nothing was chosen, which resolves to
   * the canonical Ovalball default -- deliberately NOT the default's key, so a tournament created
   * without a choice keeps following the default rather than being pinned to today's one. */
  cover?: TournamentCoverChoice
  venueId: string | null
  venueName: string | null
  venueAddress: string | null
  notes: string
  ageGroups: DraftAgeGroup[]
}

export const EMPTY_DRAFT: TournamentDraft = {
  name: "",
  // A real date from the outset: the picker always shows something true, and the organiser changes it
  // rather than being handed a blank control they must discover is required.
  startsOn: new Date().toISOString().slice(0, 10),
  endsOn: null,
  startTime: "09:00",
  multiDay: false,
  format: "round_robin",
  swissRounds: null,
  // PRIVATE BY DEFAULT, ALWAYS. A tournament is never made discoverable by omission -- making it
  // public has to be something the organiser chose.
  visibility: "private",
  cover: undefined,
  venueId: null,
  venueName: null,
  venueAddress: null,
  notes: "",
  ageGroups: [],
}

interface DraftContextValue {
  draft: TournamentDraft
  setDraft: React.Dispatch<React.SetStateAction<TournamentDraft>>
  reset: () => void
}

const DraftContext = createContext<DraftContextValue | null>(null)

export function TournamentDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<TournamentDraft>(EMPTY_DRAFT)
  const value = useMemo(() => ({ draft, setDraft, reset: () => setDraft(EMPTY_DRAFT) }), [draft])
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
}

export function useTournamentDraft(): DraftContextValue {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error("useTournamentDraft must be used inside TournamentDraftProvider")
  return ctx
}

/** The horizontal step header the approved mock-up shows -- the same shape as Add Venue's, because
 * these are the same kind of journey and a second step treatment would read as a different product. */
export function CreateTournamentHeader({ step, onBack, onCancel }: { step: number; onBack?: () => void; onCancel?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const steps = CREATE_TOURNAMENT_STEPS
  const leave = () => router.replace("/admin/tournaments" as never)
  return (
    <View style={{ backgroundColor: surface.forest, paddingTop: insets.top + space.xs, paddingBottom: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : leave()))}
          hitSlop={8}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[type.smallMedium, { color: colour.chalk }]}>Create Tournament</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel ?? leave} hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <X size={20} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* THE STEP RAIL. Compact by design: four numbered marks, the current one named. The previous
          version spent a third of the screen on a dot row plus a separate caption line saying the
          same thing twice. */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, marginTop: space.sm, gap: 6 }}>
        {steps.map((label, i) => {
          const n = i + 1
          const done = n < step
          const current = n === step
          return (
            <View key={label} style={{ flex: 1, gap: 5 }}>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: done || current ? colour.pitch600 : "rgba(248,250,247,0.20)" }} />
              <Text
                numberOfLines={1}
                style={[
                  type.caption,
                  {
                    color: current ? colour.chalk : "rgba(248,250,247,0.55)",
                    fontFamily: current ? "Inter_600SemiBold" : undefined,
                    fontSize: 11,
                  },
                ]}
              >
                {n}. {label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

export const WIZARD_CARD_RADIUS = radius.lg
