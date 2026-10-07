import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { resolveTeamCover } from "@ovalball/contracts"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { friendly, logDetail } from "../../errors/translate"
import { CalendarDays, CalendarSync, ChevronDown, ChevronRight } from "../../components/icons"
import { Button, CardSkeleton, ErrorState } from "../../components/ui"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../../design/tokens"
import { loadSeasonsForClub, type CanonicalSeason } from "../data"
import { useTrainingPlanDraft } from "./draft-context"
import { WizardHero } from "./wizard-hero"
import { WizardStepIndicator } from "./step-indicator"
import { teamCoverSource } from "../../media/stock-assets"

const heroPhoto = require("../../../assets/training-planning/create-plan-hero-01.jpg")

/**
 * CREATE TRAINING PLAN -- STEP 1: TEAM & TYPE, built against the owner's approved six-screen
 * reference. Team data is the SAME canonical, rugby-ordered list Training Planning Home uses
 * (`loadOrderedClubTeams`, via the Select Team route) -- never a second training-specific team query.
 *
 * SEASON IS A REAL SELECTOR, not a read-only display (Page 2 correction pass): `loadSeasonsForClub`
 * reads every canonical season for the club's own rugby code from `public.seasons` -- the same table
 * `club/handover.ts` already reads -- and the current one (the row whose range contains today) is only
 * the *default* selection, pre-filled into the draft once and never silently overwritten again once the
 * person has chosen (or the draft already holds) a season. Every canonical season is a real, tappable
 * option via `/create/select-season`, never hidden, never hardcoded, never a hand-invented mock list.
 */
export function TeamAndTypeScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setPlanType, setSeason } = useTrainingPlanDraft()
  const [seasonsLoaded, setSeasonsLoaded] = useState<"pending" | "ok" | "empty" | "error">("pending")

  useEffect(() => {
    if (!clubId || draft.season) {
      if (draft.season) setSeasonsLoaded("ok")
      return
    }
    let cancelled = false
    loadSeasonsForClub(supabase, clubId)
      .then((r) => {
        if (cancelled) return
        if (r.seasons.length === 0) {
          setSeasonsLoaded("empty")
          return
        }
        const initial = r.seasons.find((s) => s.id === r.currentSeasonId) ?? r.seasons[0]
        setSeason(initial)
        setSeasonsLoaded("ok")
      })
      .catch((caught) => {
        if (cancelled) return
        const failure = friendly(caught, "the club's seasons")
        logDetail("training-planning create: seasons", failure)
        setSeasonsLoaded("error")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId])

  const onCancel = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning" as never))

  const canContinue = draft.team !== null && draft.planType !== null && draft.season !== null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 + 96 }} showsVerticalScrollIndicator={false}>
        <WizardHero heroPhoto={heroPhoto} heading={"Create\nTraining Plan"} subcopy="Set up a recurring training schedule for your team." onClose={onCancel} closeIcon="close" />

        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg, gap: space.xl }}>
          <WizardStepIndicator currentStep={1} />

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>SELECT TEAM</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={draft.team ? `Team: ${draft.team.teamLabel}. Change` : "Select Team"}
              onPress={() => router.push("/admin/training-planning/create/select-team" as never)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colour.line,
                padding: space.sm,
                backgroundColor: colour.surface,
                opacity: pressed ? 0.92 : 1,
                ...elevation.card,
              })}
            >
              {draft.team ? (
                <SelectedTeamThumbnail team={draft.team} />
              ) : (
                <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colour.line }} />
              )}
              <Text style={[type.heading, { color: draft.team ? colour.ink : colour.inkSubtle, flex: 1 }]}>{draft.team ? draft.team.teamLabel : "Choose a team"}</Text>
              <ChevronRight size={20} color={colour.inkSubtle} />
            </Pressable>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>PLAN TYPE</Text>
            <PlanTypeCard
              icon={<CalendarDays size={18} color={draft.planType === "SEASON" ? colour.forest800 : colour.inkMuted} />}
              title="Season Long"
              body="Runs for the season dates from your club settings."
              selected={draft.planType === "SEASON"}
              onPress={() => setPlanType("SEASON")}
            />
            <PlanTypeCard
              icon={<CalendarSync size={18} color={draft.planType === "SEASON_PRE_SEASON" ? colour.forest800 : colour.inkMuted} />}
              title="Pre Season"
              body="Set a custom pre-season period."
              selected={draft.planType === "SEASON_PRE_SEASON"}
              onPress={() => setPlanType("SEASON_PRE_SEASON")}
            />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>SEASON</Text>
            {seasonsLoaded === "error" && <ErrorState message="Couldn't load this club's seasons." onRetry={() => setSeasonsLoaded("pending")} />}
            {seasonsLoaded === "pending" && <CardSkeleton lines={2} />}
            {seasonsLoaded === "empty" && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.dangerSurface, padding: space.md }}>
                <Text style={[type.smallMedium, { color: colour.danger }]}>No canonical season is configured for this club's rugby code.</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 4 }]}>Ask a Site Admin to check the Seasons register.</Text>
              </View>
            )}
            {seasonsLoaded === "ok" && draft.season && <SeasonField season={draft.season} onPress={() => router.push("/admin/training-planning/create/select-season" as never)} />}
          </View>
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, paddingBottom: space.lg + insets.bottom, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Next" variant="primary" disabled={!canContinue} onPress={() => router.push("/admin/training-planning/create/dates" as never)} />
        </View>
      </View>
    </View>
  )
}

function SelectedTeamThumbnail({ team }: { team: NonNullable<ReturnType<typeof useTrainingPlanDraft>["draft"]["team"]> }) {
  const cover = resolveTeamCover({ supabase, coverImagePath: team.coverImagePath, coverStockKey: team.coverStockKey, crestUrl: null })
  const source = teamCoverSource(cover, { category: team.category, ageGroup: team.ageGroup, gender: team.gender, active: true })
  return <Image source={source} style={{ width: 48, height: 48, borderRadius: radius.md }} contentFit="cover" />
}

function SeasonField({ season, onPress }: { season: CanonicalSeason; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Season: ${season.name}. Change`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.lg,
        backgroundColor: colour.surface,
        borderWidth: 1,
        borderColor: colour.line,
        padding: space.md,
        opacity: pressed ? 0.92 : 1,
        ...elevation.card,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{season.name}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          {formatDate(season.startsOn)} – {formatDate(season.endsOn)}
        </Text>
      </View>
      <ChevronDown size={20} color={colour.inkSubtle} />
    </Pressable>
  )
}

function PlanTypeCard({ icon, title, body, selected, onPress }: { icon: React.ReactNode; title: string; body: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: TOUCH_TARGET,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colour.pitch600 : colour.line,
        backgroundColor: selected ? colour.mint100 : colour.surface,
        opacity: pressed ? 0.92 : 1,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        ...(selected ? {} : elevation.card),
      })}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{body}</Text>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.pill,
          borderWidth: 2,
          borderColor: selected ? colour.pitch600 : colour.line,
          backgroundColor: selected ? colour.pitch600 : "transparent",
        }}
      />
    </Pressable>
  )
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
