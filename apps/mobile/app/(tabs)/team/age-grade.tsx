import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { ageGradeStatusLabel } from "@ovalball/contracts/team/age-grade"
import { DISPENSATION_NOT_A_GRANT, DISPENSATION_REASON_MAX, dispensationErrorMessage, readDispensationOptions, requestDispensation } from "@ovalball/contracts/team/dispensation"
import { TEAM_ACTIONABLE_AGE_GRADE_STATUSES } from "@ovalball/contracts/team/overview"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { ReasonSheet, type ReasonAsk } from "../../../src/admin/reason-sheet"
import { useTeamAuthority } from "../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../src/team/screen"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { CircleCheck } from "../../../src/components/icons"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * AGE GRADE -- where "a player's age grade needs your action" lands (CA-M7 team workspace).
 *
 * THE LIST IS THE SERVER'S. `team_age_grade_attention` answers, per player, from the recorded date of
 * birth, the Seasons register and any dispensation: the same answer the website's team page shows, in the
 * same words (`@ovalball/contracts/team/age-grade`).
 *
 * THE TEAM'S MOVE IS TO ASK (20270742000000). A player outside the team's grade needs a dispensation; the
 * team asks for one here, with a reason, through the one operation the website uses. The club's
 * Safeguarding Officer or a Club Admin decides it -- never the team -- so the row then reads "Dispensation
 * pending", opens the request, and leaves the team's Action Required list on its own.
 */
interface AgeGradeRow {
  playerId: string
  name: string
  status: string
  detail: string
  /** The request this row is about, where this person may read it. */
  requestId: string | null
}

export default function TeamAgeGrade() {
  const router = useRouter()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const { active, refreshUnread } = useAppContexts()
  const [rows, setRows] = useState<AgeGradeRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      const { data, error } = await supabase.rpc("team_age_grade_attention", { p_team_id: teamId })
      if (error) throw error
      const base = (data ?? []).map((r) => ({ playerId: r.player_id, name: r.display_name ?? "A player", status: r.status, detail: r.detail }))
      const withRequests = await Promise.all(
        base.map(async (r) => ({
          ...r,
          requestId:
            r.status === "DISPENSATION_PENDING" || r.status === "DISPENSATION_APPROVED"
              ? ((await readDispensationOptions(supabase, r.playerId, teamId).catch(() => null))?.live?.id ?? null)
              : null,
        }))
      )
      setRows(withRequests)
    } catch (caught) {
      const failure = friendly(caught, "this team's age grades")
      logDetail("team age grade", failure)
      setProblem(failure.message)
    }
  }, [teamId])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function askFor(row: AgeGradeRow) {
    if (!teamId) return
    const first = row.name.split(" ")[0] || row.name
    const teamLabel = active?.label ?? "this team"
    setMessage(null)
    setAsk({
      title: `Request a dispensation for ${first}?`,
      body: `${row.detail} A dispensation is an exception the club has to approve. ${DISPENSATION_NOT_A_GRANT}`,
      confirmLabel: "Send Request",
      reason: "required",
      fieldLabel: `Why Should ${first} Play for ${teamLabel}?`,
      placeholder: "The people who decide read this",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (reason) => {
        await requestDispensation(supabase, { playerId: row.playerId, teamId, reason })
        setMessage(`Request sent for ${row.name}. ${DISPENSATION_NOT_A_GRANT} The club's Safeguarding Officer or a Club Admin decides.`)
        invalidateAttention()
        void refreshUnread()
        await load()
      },
    })
  }

  const yours = rows?.filter((r) => TEAM_ACTIONABLE_AGE_GRADE_STATUSES.has(r.status)) ?? []
  const elsewhere = rows?.filter((r) => !TEAM_ACTIONABLE_AGE_GRADE_STATUSES.has(r.status)) ?? []

  return (
    <TeamScreen
      section="Age Grade"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true)
        await load()
        setRefreshing(false)
      }}
    >
      {!authorityLoading && !authority.rosterView && (
        <NotForYou title="Age grades are not part of your job here" body="The team's managers and coaches look after which age grade each player is in." />
      )}
      {problem && !rows && <ErrorState message={problem} onRetry={load} />}
      {!problem && rows === null && <CardSkeleton lines={3} />}
      {message && (
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: colour.warningSurface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: "rgba(138,90,0,0.18)" }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{message}</Text>
        </View>
      )}

      {rows && rows.length === 0 && (
        <EmptyState title="Every player is in their age grade" body={`Nobody on ${active?.label ?? "this team"} needs an age-grade decision.`} icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />} />
      )}

      {yours.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Needs Your Action
          </Text>
          {yours.map((row) => (
            <Row key={row.playerId} row={row}>
              {row.status === "OUTSIDE_AGE_GRADE" && authority.dispensationRequest && <Button label="Request Dispensation" variant="secondary" onPress={() => askFor(row)} />}
              {row.status === "OUTSIDE_AGE_GRADE" && !authority.dispensationRequest && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>Ask the team's manager or a Club Admin to request a dispensation.</Text>
              )}
              {row.status === "AGE_EVIDENCE_REQUIRED" && <Text style={[type.caption, { color: colour.inkMuted }]}>Ask the player's family to add a date of birth to their profile.</Text>}
            </Row>
          ))}
        </View>
      )}

      {elsewhere.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            With the Club
          </Text>
          {elsewhere.map((row) => (
            <Row key={row.playerId} row={row}>
              {row.requestId && (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open the request for ${row.name}`}
                  onPress={() => router.push({ pathname: "/dispensations/[id]", params: { id: row.requestId as string } } as never)}
                  style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}
                >
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>Open Request</Text>
                </Pressable>
              )}
            </Row>
          ))}
        </View>
      )}
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => dispensationErrorMessage(cause, "The request could not be sent. Try again.")} />
    </TeamScreen>
  )
}

function Row({ row, children }: { row: AgeGradeRow; children?: React.ReactNode }) {
  const tone = row.status === "OUTSIDE_AGE_GRADE" || row.status === "AGE_EVIDENCE_REQUIRED" || row.status === "DISPENSATION_PENDING" ? "caution" : row.status === "DISPENSATION_APPROVED" ? "positive" : "neutral"
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.bodyMedium, { color: colour.ink, flexShrink: 1 }]}>{row.name}</Text>
        <StatusPill label={ageGradeStatusLabel(row.status)} tone={tone} />
      </View>
      <Text style={[type.small, { color: colour.inkMuted }]}>{row.detail}</Text>
      {children}
    </View>
  )
}
