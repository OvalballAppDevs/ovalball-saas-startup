import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  STANDING_LABEL,
  exclusionsSentence,
  loadClubMembershipBoard,
  reasonShort,
  reminderExclusions,
  reminderOutcomeSentence,
  sendMembershipReminders,
  type ClubMembershipBoard,
  type MembershipRow,
} from "@ovalball/contracts/membership/board"
import {
  NEEDS_ACTION,
  REMINDER_RECIPIENTS_EXPLAINED,
  audiencePlayerIds,
  memberTeamOptions,
  previewMembershipReminders,
  sendRemindersInBatches,
  sendRemindersLabel,
  standingGuidance,
  type ReminderAudience,
  type ReminderPreview,
} from "@ovalball/contracts/membership/operate"
import { ReminderMessages } from "../../../../src/membership/reminder-messages"
import { loadMembershipReminderHistory, type MembershipReminderEntry } from "@ovalball/contracts/membership/member"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, Send, Shield, Users } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, Skeleton } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { ChecklistSheet, PickerSheet, SegmentedTabs, personName, reminderProblem, spoken, type PickerOption } from "../../../../src/membership/running-ui"
import { ActionGroup, ChoiceRow, Note } from "../../../../src/people/ui"
import { FormRow } from "../../../../src/tournaments/form-primitives"
import { LARGE_TEXT_SCALE, colour, space, type } from "../../../../src/design/tokens"

/**
 * REMINDERS -- who to remind, the exact words they will receive, and who was reminded when (Club Memberships Part 2).
 *
 * SEND: choose who -- everyone who needs action, everyone overdue, a team, or chosen members -- and the count beside
 * each is only the people the server says can be asked now (`canRemind`). The message is the SERVER'S preview
 * (`membership_reminder_preview`), the same composer the reminder itself uses, so what is shown is exactly what each
 * family receives; there is deliberately no free text that could carry money or another family's business. Sending
 * goes in the server's batches; a refusal part-way (the daily limit) stops there and is said beside what was sent.
 * The server asks the payer -- or, with nobody paying yet, the player's guardians, never a child -- holds a second
 * reminder back for 72 hours and records who sent it. Sending needs `finance.enrolment.manage`.
 *
 * HISTORY: every reminder, newest first, grouped by day: who it was about, why, who sent it and how many people were
 * told. Reading needs `finance.subscription.view`.
 */

type Audience = "needs_action" | "overdue" | "team" | "selected"
type Tab = "send" | "history"

function presetAudience(p: { audience?: string; teamId?: string }): { audience: Audience; teamId: string | null } {
  if (p.audience === "overdue") return { audience: "overdue", teamId: null }
  if (p.audience === "team" && p.teamId) return { audience: "team", teamId: String(p.teamId) }
  return { audience: "needs_action", teamId: null }
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** "Today", "Yesterday", "Monday 5 October". */
function dayLabel(iso: string): string {
  const today = dayKey(new Date().toISOString())
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const key = dayKey(iso)
  if (key === today) return "Today"
  if (key === yesterday) return "Yesterday"
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}

const canBeReminded = (n: number) => (n === 1 ? "1 can be reminded" : `${n} can be reminded`)

export default function RemindersScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ audience?: string; teamId?: string; tab?: string }>()
  const { clubId } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const canSend = authority.enrolmentManage
  const [tab, setTab] = useState<Tab>(params.tab === "history" ? "history" : "send")
  const [audience, setAudience] = useState<Audience>(() => presetAudience(params).audience)
  const [teamId, setTeamId] = useState<string | null>(() => presetAudience(params).teamId)
  const [selected, setSelected] = useState<string[]>([])
  const [picker, setPicker] = useState<"team" | "members" | null>(null)
  const [board, setBoard] = useState<ClubMembershipBoard | null>(null)
  const [boardError, setBoardError] = useState<FriendlyError | null>(null)
  const [history, setHistory] = useState<MembershipReminderEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<FriendlyError | null>(null)
  const [preview, setPreview] = useState<ReminderPreview | null>(null)
  const [previewProblem, setPreviewProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ tone: "positive" | "danger"; text: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)
  const previewGeneration = useRef(0)
  const { fontScale } = useWindowDimensions()

  // A link from the overview or a team chooses who to remind; the person can still change it.
  useEffect(() => {
    const preset = presetAudience({ audience: params.audience, teamId: params.teamId })
    setAudience(preset.audience)
    setTeamId(preset.teamId)
  }, [params.audience, params.teamId])

  const load = useCallback(async () => {
    if (!clubId || authorityLoading || !authority.view) return
    const gen = ++generation.current
    const [nextBoard, nextHistory] = await Promise.allSettled([
      authority.enrolmentManage ? loadClubMembershipBoard(supabase, clubId) : Promise.resolve(null),
      loadMembershipReminderHistory(supabase, { clubId }),
    ])
    if (gen !== generation.current) return
    if (nextBoard.status === "fulfilled") {
      setBoard(nextBoard.value)
      setBoardError(null)
    } else {
      const translated = friendly(nextBoard.reason, "who can be reminded")
      logDetail("admin:memberships:reminders", translated)
      setBoardError(translated)
    }
    if (nextHistory.status === "fulfilled") {
      setHistory(nextHistory.value.reminders)
      setHistoryError(null)
    } else {
      const translated = friendly(nextHistory.reason, "the reminder history")
      logDetail("admin:memberships:reminder-history", translated)
      setHistoryError(translated)
    }
  }, [clubId, authorityLoading, authority.view, authority.enrolmentManage])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refreshAuthority(), load()])
    setRefreshing(false)
  }, [refreshAuthority, load])

  const rows = useMemo(() => board?.rows ?? [], [board])
  const spec: ReminderAudience | null =
    audience === "needs_action" ? { kind: "needs_action" } : audience === "overdue" ? { kind: "overdue" } : audience === "team" ? (teamId ? { kind: "team", teamId } : null) : { kind: "selected", playerIds: selected }
  const ids = useMemo(() => (spec ? audiencePlayerIds(rows, spec) : []), [rows, spec?.kind, teamId, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const idsKey = ids.join(",")

  const needsRows = useMemo(() => rows.filter((r) => NEEDS_ACTION.has(r.standing)), [rows])
  const overdueRows = useMemo(() => rows.filter((r) => r.standing === "OVERDUE"), [rows])
  const needsIds = useMemo(() => audiencePlayerIds(rows, { kind: "needs_action" }), [rows])
  const overdueIds = useMemo(() => audiencePlayerIds(rows, { kind: "overdue" }), [rows])
  const teams = useMemo(() => memberTeamOptions(rows), [rows])
  const teamOptions = useMemo<PickerOption[]>(() => teams.map((t) => ({ id: t.id, label: t.name, detail: canBeReminded(audiencePlayerIds(rows, { kind: "team", teamId: t.id }).length) })), [teams, rows])
  const memberOptions = useMemo<PickerOption[]>(() => rows.filter((r) => r.canRemind).map((r) => ({ id: r.playerId, label: personName(r.firstName, r.surname), detail: `${STANDING_LABEL[r.standing]} · ${reasonShort(r.reason)}` })), [rows])
  const teamName = teamId ? (teams.find((t) => t.id === teamId)?.name ?? null) : null

  // Who this choice will NOT ask, and why: reminded in the last three days, or the club's to sort out.
  const notIncluded = useMemo(() => {
    const among: MembershipRow[] = audience === "needs_action" ? needsRows : audience === "overdue" ? overdueRows : audience === "team" && teamId ? rows.filter((r) => (r.teams ?? []).some((t) => t.id === teamId)) : []
    return exclusionsSentence(reminderExclusions(among))
  }, [audience, needsRows, overdueRows, rows, teamId])

  // THE SERVER'S OWN WORDS, for exactly these people -- re-asked a moment after the choice settles, never shown stale.
  useEffect(() => {
    if (!clubId || !canSend || ids.length === 0) {
      previewGeneration.current += 1
      setPreview(null)
      setPreviewProblem(null)
      return
    }
    const gen = ++previewGeneration.current
    setPreview(null)
    setPreviewProblem(null)
    const timer = setTimeout(() => {
      previewMembershipReminders(supabase, { clubId, playerIds: ids.slice(0, 500) })
        .then((next) => {
          if (gen === previewGeneration.current) setPreview(next)
        })
        .catch((cause: unknown) => {
          if (gen === previewGeneration.current) setPreviewProblem(reminderProblem(cause))
        })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, canSend, idsKey])

  async function send() {
    if (!clubId || ids.length === 0) return
    setSending(true)
    setOutcome(null)
    const { result, error } = await sendRemindersInBatches((batch) => sendMembershipReminders(supabase, { clubId, playerIds: batch }), ids)
    const done = reminderOutcomeSentence(result)
    const text = error ? (result.sent > 0 || result.skipped.length > 0 ? `${done} The rest weren't sent. ${reminderProblem(error)}` : reminderProblem(error)) : done
    setOutcome({ tone: error && result.sent === 0 ? "danger" : "positive", text })
    setSending(false)
    AccessibilityInfo.announceForAccessibility(text)
    if (audience === "selected") setSelected([])
    await load()
  }

  const nobodyToAsk = preview ? preview.skipped.filter((s) => s.reason === "NOBODY_TO_ASK").length : 0
  const sendButton = (
    <Button
      variant="brand"
      label={ids.length > 0 ? sendRemindersLabel(ids.length) : "Send Reminders"}
      icon={<Send size={18} color={colour.onForest} />}
      busy={sending}
      disabled={ids.length === 0}
      accessibilityHint={ids.length === 0 ? "Nobody in this choice can be reminded right now" : "Sends the message above to each family"}
      onPress={() => void send()}
    />
  )
  const showSend = canSend && tab === "send"
  // AT LARGE TEXT SIZES the button joins the end of the page, as a flow screen's footer does, rather than covering it.
  const inlineButton = fontScale > LARGE_TEXT_SCALE
  const footer =
    showSend && board && !inlineButton ? (
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colour.chalk, borderTopWidth: 1, borderTopColor: colour.line }}>{sendButton}</View>
    ) : undefined

  const openMember = (playerId: string) => router.push({ pathname: "/admin/subscriptions/member/[playerId]", params: { playerId } } as never)

  return (
    <AdminScreen section="Reminders" onRefresh={() => void refresh()} refreshing={refreshing} footer={footer}>
      {!authorityLoading && !authority.view && <EmptyState title="Not for you at this club" body="Membership reminders need the finance view permission at this club. If that has changed, pull to refresh." />}

      {authorityLoading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </View>
      )}

      {!authorityLoading && authority.view && (
        <>
          {canSend ? (
            <SegmentedTabs
              label="Reminders"
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "send", label: "Send Reminder" },
                { key: "history", label: "History" },
              ]}
            />
          ) : (
            <Text style={[type.small, { color: colour.inkMuted }]}>Sending reminders is for the people who manage the club's memberships. Every reminder the club sends is listed here.</Text>
          )}

          {showSend && (
            <>
              {boardError && <ErrorState message={boardError.message} onRetry={() => void load()} offline={boardError.retryable} />}
              {!board && !boardError && <CardSkeleton lines={4} />}
              {board && (
                <>
                  <View style={{ gap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                      Who to Remind
                    </Text>
                    <View accessibilityRole="radiogroup" accessibilityLabel="Who to remind" style={{ gap: space.sm }}>
                      <ChoiceRow
                        kind="radio"
                        describeInLabel
                        checked={audience === "needs_action"}
                        label="Everyone who needs action"
                        description={needsRows.length === 0 ? "Nobody needs action right now." : needsIds.length === needsRows.length ? `${canBeReminded(needsIds.length)}.` : `${needsIds.length} of ${needsRows.length} can be reminded now.`}
                        onPress={() => setAudience("needs_action")}
                      />
                      <ChoiceRow
                        kind="radio"
                        describeInLabel
                        checked={audience === "overdue"}
                        label="Everyone overdue"
                        description={overdueRows.length === 0 ? "Nobody is overdue." : overdueIds.length === overdueRows.length ? `${canBeReminded(overdueIds.length)}.` : `${overdueIds.length} of ${overdueRows.length} can be reminded now.`}
                        onPress={() => setAudience("overdue")}
                      />
                      <ChoiceRow
                        kind="radio"
                        describeInLabel
                        checked={audience === "team"}
                        label="A team"
                        description={teamName ? `${teamName} · ${canBeReminded(audience === "team" ? ids.length : audiencePlayerIds(rows, { kind: "team", teamId: teamId ?? "" }).length)}.` : "Choose a team."}
                        onPress={() => {
                          setAudience("team")
                          if (!teamId) setPicker("team")
                        }}
                      >
                        {audience === "team" && (
                          <View style={{ marginTop: space.sm }}>
                            <FormRow icon={<Shield size={20} color={colour.forest800} />} label="Team" value={teamName} placeholder="Choose a team" onPress={() => setPicker("team")} />
                          </View>
                        )}
                      </ChoiceRow>
                      <ChoiceRow
                        kind="radio"
                        describeInLabel
                        checked={audience === "selected"}
                        label="Selected members"
                        description={selected.length > 0 ? `${selected.length} chosen.` : "Choose who to remind."}
                        onPress={() => {
                          setAudience("selected")
                          if (selected.length === 0) setPicker("members")
                        }}
                      >
                        {audience === "selected" && (
                          <View style={{ marginTop: space.sm }}>
                            <FormRow
                              icon={<Users size={20} color={colour.forest800} />}
                              label="Members"
                              value={selected.length === 0 ? null : selectedSummary(selected, memberOptions)}
                              placeholder="Choose members"
                              onPress={() => setPicker("members")}
                            />
                          </View>
                        )}
                      </ChoiceRow>
                    </View>
                    {notIncluded && <Text style={[type.caption, { color: colour.inkMuted }]}>{notIncluded}</Text>}
                  </View>

                  <View style={{ gap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                      {preview && preview.examples.length > 1 ? "Messages" : "Message"}
                    </Text>
                    {ids.length === 0 ? (
                      <Card>
                        <Text style={[type.small, { color: colour.inkMuted }]}>Nobody in this choice can be reminded right now, so there is no message to show.</Text>
                      </Card>
                    ) : previewProblem ? (
                      <Card>
                        <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
                          {previewProblem}
                        </Text>
                      </Card>
                    ) : !preview ? (
                      <Card>
                        <View accessible accessibilityLabel="Loading the message" style={{ gap: space.sm }}>
                          <Skeleton height={14} width="40%" />
                          <Skeleton height={12} width="90%" />
                          <Skeleton height={12} width="70%" />
                        </View>
                      </Card>
                    ) : (
                      <ReminderMessages preview={preview} />
                    )}
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{REMINDER_RECIPIENTS_EXPLAINED}</Text>
                    {nobodyToAsk > 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>{nobodyToAsk === 1 ? "1 has no adult the club can contact, so won't be asked." : `${nobodyToAsk} have no adult the club can contact, so won't be asked.`}</Text>}
                  </View>

                  {outcome && <Note tone={outcome.tone}>{outcome.text}</Note>}
                  {inlineButton && sendButton}
                </>
              )}
            </>
          )}

          {(!canSend || tab === "history") && (
            <View style={{ gap: space.md }}>
              {historyError && <ErrorState message={historyError.message} onRetry={() => void load()} offline={historyError.retryable} />}
              {history === null && !historyError && <CardSkeleton lines={4} />}
              {history !== null && history.length === 0 && <EmptyState title="No reminders yet" body="Each reminder the club sends appears here: who it was about, who sent it and when." />}
              {history !== null && history.length > 0 && <HistoryList entries={history} onOpen={openMember} />}
            </View>
          )}

          <PickerSheet
            visible={picker === "team"}
            title="Choose a Team"
            hint="The team's members who can be reminded now."
            options={teamOptions}
            value={teamId}
            emptyMessage="No team has anybody to remind right now."
            applyLabel="Use This Team"
            onClose={() => setPicker(null)}
            onApply={(id) => {
              setTeamId(id)
              setPicker(null)
            }}
          />
          <ChecklistSheet
            visible={picker === "members"}
            title="Choose Members"
            hint="Only members who can be reminded now are listed."
            options={memberOptions}
            value={selected}
            emptyMessage="Nobody can be reminded right now."
            applyLabel={(n) => (n === 0 ? "Choose Members" : n === 1 ? "Choose 1 Member" : `Choose ${n} Members`)}
            onClose={() => setPicker(null)}
            onApply={(chosen) => {
              setSelected(chosen)
              setPicker(null)
            }}
          />
        </>
      )}
    </AdminScreen>
  )
}

/** "Abe Running, Cara Lane and 3 more". */
function selectedSummary(ids: string[], options: PickerOption[]): string {
  const names = ids.map((id) => options.find((o) => o.id === id)?.label).filter((n): n is string => Boolean(n))
  if (names.length === 0) return `${ids.length} chosen`
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

/** Every reminder, newest first, under the day it was sent. */
function HistoryList({ entries, onOpen }: { entries: MembershipReminderEntry[]; onOpen: (playerId: string) => void }) {
  const days: { key: string; label: string; entries: MembershipReminderEntry[] }[] = []
  for (const e of entries) {
    const key = dayKey(e.sentAt)
    const day = days.find((d) => d.key === key)
    if (day) day.entries.push(e)
    else days.push({ key, label: dayLabel(e.sentAt), entries: [e] })
  }
  return (
    <>
      {days.map((day) => (
        <View key={day.key} style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.inkMuted }]}>
            {day.label}
          </Text>
          <ActionGroup>
            {day.entries.map((e, i) => {
              const about = e.reason ? standingGuidance(e.reason, "club").title : e.standing ? STANDING_LABEL[e.standing] : null
              const time = new Date(e.sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              const line = [about, e.sentBy ? `by ${e.sentBy}` : null, e.scope === "team" ? "from the team" : null, time, e.recipients !== null ? `${e.recipients} told` : null].filter(Boolean).join(" · ")
              const name = personName(e.firstName, e.surname)
              return (
                <Pressable
                  key={`${e.sentAt}-${e.playerId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}. ${spoken(line)}`}
                  accessibilityHint="Opens their membership"
                  onPress={() => onOpen(e.playerId)}
                  style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm + 2, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>{name}</Text>
                    <Text style={[type.small, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{line}</Text>
                  </View>
                  <ChevronRight size={18} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </ActionGroup>
        </View>
      ))}
    </>
  )
}
