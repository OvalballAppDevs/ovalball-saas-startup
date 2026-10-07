import { useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { resolveTeamCover } from "@ovalball/contracts"
import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { createTrainingPlan } from "../data"
import { friendly, logDetail } from "../../errors/translate"
import { Bell, CalendarDays, Check } from "../../components/icons"
import { Button, ErrorState } from "../../components/ui"
import { colour, elevation, radius, space, type } from "../../design/tokens"
import { useTrainingPlanDraft } from "./draft-context"
import { deriveEndTime, durationLabel, bufferLabel } from "./times-and-details-logic"
import { draftToSavePlanArgs, repeatWeekdaysLabel } from "./review-logic"
import { WizardHero } from "./wizard-hero"
import { WizardStepIndicator } from "./step-indicator"
import { coverPhotoSource, teamCoverSource, libraryAsset } from "../../media/stock-assets"

const heroPhoto = libraryAsset("training-huddle-01")

/**
 * CREATE TRAINING PLAN -- STEP 5: REVIEW & CREATE.
 *
 * EVERY VALUE SHOWN IS READ FROM THE DRAFT, never hardcoded (Step 6 correction brief Section 3).
 * Create Plan calls the one canonical write, `save_training_plan` (`createTrainingPlan`, `data.ts`),
 * which itself creates the plan, replaces its schedule rules, generates every session for the plan's
 * full season range, and notifies Team Staff -- all in one server-side transaction. There is no
 * separate "generate sessions" or "send notification" step here to get out of sync with that RPC.
 *
 * NOTIFICATION / CALENDAR ROWS ARE INFORMATIONAL, NOT TOGGLES (Section 9-10). `save_training_plan`
 * unconditionally notifies Team Staff on create (`internal.notify_team_staff`, migration
 * `20270581000000`) and unconditionally generates the plan's sessions into the same
 * `training_sessions` table every calendar surface already reads -- there is no optional path to turn
 * either off, so presenting them as checkboxes the person could uncheck would be dishonest. There is
 * also no external (Google/Apple) calendar sync anywhere in this codebase (confirmed absent by
 * searching for any `.ics`/webcal export) -- the copy says "Ovalball" calendars only, never promises
 * external sync.
 */
export function ReviewScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft } = useTrainingPlanDraft()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const onBack = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))

  const args = clubId ? draftToSavePlanArgs(clubId, draft) : null

  async function onCreate() {
    if (!args || submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setProblem(null)
    try {
      await createTrainingPlan(supabase, args)
      router.replace("/admin/training-planning" as never)
    } catch (caught) {
      const failure = friendly(caught, "this training plan")
      logDetail("training-planning review", failure)
      setProblem(failure.message)
      submittingRef.current = false
      setBusy(false)
    }
  }

  const teamPhoto = draft.team
    ? teamCoverSource(
        resolveTeamCover({ supabase, coverImagePath: draft.team.coverImagePath, coverStockKey: draft.team.coverStockKey, crestUrl: null }),
        { category: draft.team.category, ageGroup: draft.team.ageGroup, gender: draft.team.gender, active: true }
      )
    : null
  const venuePhoto = draft.venue ? coverPhotoSource("VENUE", resolveVenueCover({ supabase, coverImagePath: draft.venue.coverImagePath, coverStockKey: draft.venue.coverStockKey }), draft.venue.id) : null
  const pitchPhoto = draft.pitch ? coverPhotoSource("PITCH", resolvePitchCover({ supabase, coverImagePath: draft.pitch.coverImagePath, coverStockKey: draft.pitch.coverStockKey }), draft.pitch.id) : null

  const endTime = draft.startTime && draft.durationMinutes !== null ? deriveEndTime(draft.startTime, draft.durationMinutes) : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 + 96 }} showsVerticalScrollIndicator={false}>
        <WizardHero heroPhoto={heroPhoto} heading="Review Plan" onClose={onBack} />

        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg, gap: space.md }}>
          <WizardStepIndicator currentStep={5} />

          <SummaryCard>
            <Row label="TEAM">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {teamPhoto && <Image source={teamPhoto} accessible={false} contentFit="cover" style={{ width: 36, height: 36, borderRadius: radius.sm }} />}
                <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.team?.teamLabel ?? "—"}</Text>
              </View>
            </Row>
            <Divider />
            <Row label="PLAN TYPE">
              <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.planType === "SEASON" ? "Season Long" : draft.planType === "SEASON_PRE_SEASON" ? "Pre Season" : "—"}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{draft.season?.name ?? "—"}</Text>
            </Row>
            <Divider />
            <Row label="DATES">
              <Text style={[type.smallMedium, { color: colour.ink }]}>
                {draft.startDate ? formatDate(draft.startDate) : "—"} – {draft.endDate ? formatDate(draft.endDate) : "—"}
              </Text>
            </Row>
            <Divider />
            <Row label="REPEATS">
              <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.repeatWeekdays.length ? repeatWeekdaysLabel(draft.repeatWeekdays) : "—"}</Text>
            </Row>
            <Divider />
            <Row label="TIME">
              <Text style={[type.smallMedium, { color: colour.ink }]}>
                {draft.startTime ?? "—"} – {endTime ?? "—"} {draft.durationMinutes !== null ? `(${durationLabel(draft.durationMinutes)})` : ""}
              </Text>
              {(draft.warmUpMinutes > 0 || draft.coolDownMinutes > 0) && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  {draft.warmUpMinutes > 0 ? `Warm up: ${bufferLabel(draft.warmUpMinutes)}` : ""}
                  {draft.warmUpMinutes > 0 && draft.coolDownMinutes > 0 ? " | " : ""}
                  {draft.coolDownMinutes > 0 ? `Pack up: ${bufferLabel(draft.coolDownMinutes)}` : ""}
                </Text>
              )}
            </Row>
            <Divider />
            <Row label="VENUE & PITCH">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {venuePhoto && <Image source={venuePhoto} accessible={false} contentFit="cover" style={{ width: 32, height: 32, borderRadius: radius.sm }} />}
                <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.venue?.name ?? "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 4 }}>
                {pitchPhoto && <Image source={pitchPhoto} accessible={false} contentFit="cover" style={{ width: 32, height: 32, borderRadius: radius.sm }} />}
                <Text style={[type.caption, { color: colour.inkMuted }]}>{draft.pitch?.displayName ?? "—"}</Text>
              </View>
              {draft.needsChangingRoom && <Text style={[type.caption, { color: colour.inkMuted }]}>Needs a changing room at every session</Text>}
            </Row>
            {!!draft.notes.trim() && (
              <>
                <Divider />
                <Row label="NOTES">
                  <Text style={[type.small, { color: colour.ink }]}>{draft.notes.trim()}</Text>
                </Row>
              </>
            )}
          </SummaryCard>

          <InfoRow icon={<Bell size={18} color={colour.forest800} />} title="Team staff will be notified" body="A notification is sent automatically to everyone with a staff role on this team." />
          <InfoRow icon={<CalendarDays size={18} color={colour.forest800} />} title="Sessions will appear in the Ovalball calendar" body="Every session this plan generates is added to the club's training calendar automatically." />

          {!!problem && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
              <ErrorState message={problem} />
            </View>
          )}
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, paddingBottom: space.lg + insets.bottom, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <View style={{ flex: 1 }}>
          <Button label="Back" variant="secondary" onPress={onBack} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Create Plan" variant="primary" disabled={!args || busy} busy={busy} onPress={() => void onCreate()} />
        </View>
      </View>
    </View>
  )
}

function SummaryCard({ children }: { children: React.ReactNode }) {
  return <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.sm, ...elevation.card }}>{children}</View>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{label}</Text>
      {children}
    </View>
  )
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: colour.line }} />
}

function InfoRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.mint100, padding: space.md, alignItems: "flex-start" }}>
      <View style={{ width: 20, height: 20, borderRadius: radius.pill, backgroundColor: colour.pitch600, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <Check size={13} color={colour.forest950} strokeWidth={2.5} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon}
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{title}</Text>
        </View>
        <Text style={[type.caption, { color: colour.forest800 }]}>{body}</Text>
      </View>
    </View>
  )
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}
