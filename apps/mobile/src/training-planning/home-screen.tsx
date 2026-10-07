import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import { resolveTeamCover } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { useAdminCentreAccess } from "../admin/access"
import { friendly, logDetail } from "../errors/translate"
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, ClipboardList } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { loadTrainingPlanningHome, type TrainingPlanTeamRow, type TrainingPlanningHomeData, type UpcomingTrainingSession } from "./data"
import { teamCoverSource, libraryAsset } from "../media/stock-assets"

const heroPhoto = libraryAsset("training-hero-02")

/**
 * TRAINING PLANNING HOME -- rebuilt against the owner's approved six-screen reference after a visual
 * QA rejection (Section 1 of that correction brief). The header, hero treatment, stat-card row,
 * segmented Teams/Calendar control and team-list density all now follow that reference directly rather
 * than a reinterpretation of the brief's prose description -- "do not reinterpret the design."
 *
 * ONE DELIBERATE, DOCUMENTED DEVIATION: the reference has no separate dark title bar above the hero --
 * only a back control and a help control floating directly on the photograph. The project's own
 * standing rule (CLAUDE.md, "Ovalball mobile chrome") is that a new surface uses the shared
 * OvalballDetailHeader rather than bespoke top chrome "without a deliberate, documented reason." This
 * comment, plus the owner's own supplied reference image (spanning all six Training Planning screens
 * consistently, not a one-off), is that reason -- so this screen's own floating back/help controls
 * replace OvalballDetailHeader here specifically, while still respecting the same safe-area and
 * light-status-bar-on-forest conventions every other forest header already follows.
 *
 * Every fact is the same read the web's Training Management page already assembles
 * (get_training_management_overview + the plans/teams/sessions tables, all open-read RLS) -- see
 * training-planning/data.ts's own comment.
 *
 * WHY A STOCK PHOTO HERE, UNLIKE EVENT HERO. `components/participant/event-hero.tsx` deliberately
 * never uses stock photography, because it is a specific family looking at their own child's specific
 * session and a borrowed photo would misrepresent whose rugby it is. This screen is the opposite case:
 * an operational section header for the person planning training across the whole club, exactly the
 * same class of screen Team Profile's own cover photo already uses curated Ovalball stock for.
 *
 * TEAM THUMBNAILS ARE THE CANONICAL TEAM PROFILE IMAGE, never a Training-Planning-specific photograph:
 * `resolveTeamCover` first, and only when a team truly has no cover of its own does it fall through to
 * `teamFallbackAsset` -- the SAME deterministic, category-appropriate stand-in Team Profile itself
 * uses (team/team-cover-demo.ts), not a second fallback invented for this screen.
 */
export function TrainingPlanningHomeScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const [data, setData] = useState<TrainingPlanningHomeData | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [tab, setTab] = useState<"teams" | "calendar">("teams")

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      setData(await loadTrainingPlanningHome(supabase, clubId))
    } catch (caught) {
      const failure = friendly(caught, "Training Planning")
      logDetail("training-planning home", failure)
      setProblem({ message: failure.message, offline: failure.retryable && /connection/i.test(failure.message) })
    }
  }, [clubId])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const onBack = () => (navigation.canGoBack() ? router.back() : router.replace("/admin" as never))

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 }} showsVerticalScrollIndicator={false}>
        <Hero insetsTop={insets.top} onBack={onBack} onHelp={() => router.push("/support" as never)} />

        {problem && !data && (
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
            <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
          </View>
        )}

        {!problem && !data && (
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={3} />
          </View>
        )}

        {data && (
          <>
            <StatRow data={data} />

            <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create Training Plan"
                onPress={() => router.push("/admin/training-planning/create" as never)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET + 8,
                  borderRadius: radius.lg,
                  backgroundColor: pressed ? colour.rugby700 : colour.pitch600,
                  alignItems: "center",
                  justifyContent: "center",
                })}
              >
                <Text style={[type.smallMedium, { color: colour.forest950 }]}>+ Create Training Plan</Text>
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
              <SegmentedControl value={tab} onChange={setTab} />
            </View>

            {tab === "teams" ? (
              <View style={{ marginTop: space.md }}>
                {data.teams.length === 0 ? (
                  <View style={{ paddingHorizontal: space.lg }}>
                    <EmptyState title="No teams yet" body="Active teams at this club will appear here." icon={<ClipboardList size={22} color={colour.inkSubtle} />} />
                  </View>
                ) : (
                  <View>
                    {data.teams.map((t, i) => (
                      <TeamRow
                        key={t.teamId}
                        team={t}
                        showDivider={i < data.teams.length - 1}
                        onPress={() => router.push(t.planId ? (`/admin/training-planning/plan/${t.planId}` as never) : (`/admin/training-planning/create?teamId=${t.teamId}` as never))}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={{ marginTop: space.md }}>
                {data.upcomingSessions.length === 0 ? (
                  <View style={{ paddingHorizontal: space.lg }}>
                    <EmptyState title="Nothing scheduled" body="Upcoming training sessions will appear here once a plan is created." icon={<ClipboardList size={22} color={colour.inkSubtle} />} />
                  </View>
                ) : (
                  <View>
                    {data.upcomingSessions.map((s, i) => (
                      <SessionRow key={s.id} session={s} showDivider={i < data.upcomingSessions.length - 1} />
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

/**
 * ONE PHOTOGRAPH, ONE GRADIENT SYSTEM -- a single top-to-bottom forest fade (transparent at the crown,
 * fully opaque forest950 at the foot where the heading sits), not the earlier build's two stacked
 * opacity stops that read as a hard colour band partway down the image. Correction brief Section C.
 */
function Hero({ insetsTop, onBack, onHelp }: { insetsTop: number; onBack: () => void; onHelp: () => void }) {
  return (
    <View style={{ height: 340 }}>
      <Image source={heroPhoto} style={{ width: "100%", height: "100%" }} contentFit="cover" />
      <View style={{ position: "absolute", inset: 0 }}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="trainingHeroFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colour.forest950} stopOpacity={0.05} />
              <Stop offset="0.45" stopColor={colour.forest950} stopOpacity={0.25} />
              <Stop offset="0.75" stopColor={colour.forest950} stopOpacity={0.72} />
              <Stop offset="1" stopColor={colour.forest950} stopOpacity={0.94} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#trainingHeroFade)" />
        </Svg>
      </View>

      <View style={{ position: "absolute", top: insetsTop + space.xs, left: space.sm, right: space.sm, flexDirection: "row", justifyContent: "space-between" }}>
        <HeroIconButton accessibilityLabel="Back" onPress={onBack}>
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </HeroIconButton>
        <HeroIconButton accessibilityLabel="Support" onPress={onHelp}>
          <CircleHelp size={20} color={colour.chalk} strokeWidth={1.9} />
        </HeroIconButton>
      </View>

      <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.lg }}>
        <Text style={[type.display, { color: colour.chalk }]}>Training{"\n"}Management</Text>
        <Text style={[type.small, { color: "rgba(248,250,247,0.9)", marginTop: space.xs }]}>Plan, manage and communicate training for all your teams.</Text>
      </View>
    </View>
  )
}

function HeroIconButton({ accessibilityLabel, onPress, children }: { accessibilityLabel: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: TOUCH_TARGET,
        height: TOUCH_TARGET,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? "rgba(7,28,20,0.55)" : "rgba(7,28,20,0.32)",
      })}
    >
      {children}
    </Pressable>
  )
}

/** Three compact stats, matching the reference exactly -- no icons, no fourth card. "Teams without a
 * plan" is still visible, just per-row ("No plan set up") rather than duplicated as a stat card. */
function StatRow({ data }: { data: TrainingPlanningHomeData }) {
  const stats: { label: string; value: number; warn?: boolean }[] = [
    { label: "Active Plans", value: data.overview.activePlanCount },
    { label: "Upcoming This Week", value: data.overview.upcomingSessionCount },
    { label: "Need Attention", value: data.overview.needsAttentionPlanCount, warn: data.overview.needsAttentionPlanCount > 0 },
  ]
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: space.lg, marginTop: space.md, gap: space.sm }}>
      {stats.map((s) => (
        <View key={s.label} style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, padding: space.sm, gap: 2 }}>
          {s.warn && <View style={{ position: "absolute", top: space.xs, right: space.xs, width: 8, height: 8, borderRadius: 4, backgroundColor: colour.danger }} />}
          <Text style={[type.displaySmall, { color: colour.ink, fontSize: 22 }]}>{s.value}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>{s.label}</Text>
        </View>
      ))}
    </View>
  )
}

function SegmentedControl({ value, onChange }: { value: "teams" | "calendar"; onChange: (v: "teams" | "calendar") => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: "#eef1ee", borderRadius: radius.md, padding: 3 }}>
      {(["teams", "calendar"] as const).map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityState={{ selected: value === k }}
          accessibilityLabel={k === "teams" ? "Teams" : "Calendar"}
          onPress={() => onChange(k)}
          style={{
            flex: 1,
            minHeight: TOUCH_TARGET - 4,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.sm,
            backgroundColor: value === k ? colour.surface : "transparent",
          }}
        >
          <Text style={[type.smallMedium, { color: value === k ? colour.ink : colour.inkMuted }]}>{k === "teams" ? "Teams" : "Calendar"}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function TeamRow({ team, onPress, showDivider }: { team: TrainingPlanTeamRow; onPress: () => void; showDivider: boolean }) {
  const cover = resolveTeamCover({ supabase, coverImagePath: team.teamCoverImagePath, coverStockKey: team.teamCoverStockKey, crestUrl: null })
  const source = teamCoverSource(cover, { category: team.teamCategory, ageGroup: team.teamAgeGroup, gender: team.teamGender, active: true })
  const hasPlan = team.planId !== null
  const needsAttention = team.planStatus === "NEEDS_ATTENTION"

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${team.teamLabel}. ${hasPlan ? "View Training Plan" : "Create a Training Plan"}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colour.line,
      })}
    >
      <Image source={source} style={{ width: 44, height: 44, borderRadius: radius.sm }} contentFit="cover" />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
          {team.teamLabel}
        </Text>
        {needsAttention ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <CircleAlert size={12} color={colour.danger} />
            <Text style={[type.caption, { color: colour.danger }]} numberOfLines={1}>
              {team.needsAttentionReason ?? "Needs attention"}
            </Text>
          </View>
        ) : hasPlan && team.nextSession ? (
          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
            Next: {friendlySessionSummary(team.nextSession)}
          </Text>
        ) : hasPlan ? (
          <Text style={[type.caption, { color: colour.inkMuted }]}>No upcoming sessions</Text>
        ) : (
          <Text style={[type.caption, { color: colour.inkSubtle }]}>No plan set up</Text>
        )}
      </View>
      <ChevronRight size={16} color={colour.inkSubtle} />
    </Pressable>
  )
}

function SessionRow({ session, showDivider }: { session: UpcomingTrainingSession; showDivider: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colour.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
          {session.teamLabel}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
          {friendlySessionSummary(session)}
        </Text>
      </View>
    </View>
  )
}

function friendlySessionSummary(session: { date: string; startTime: string | null; venueName: string | null; pitchName: string | null }): string {
  const date = new Date(`${session.date}T00:00:00`)
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" })
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const time = session.startTime ? session.startTime.slice(0, 5) : ""
  return [`${weekday} ${day}`, time, session.pitchName ?? session.venueName].filter(Boolean).join(" · ")
}
