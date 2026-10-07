import { useCallback, useEffect, useRef, useState } from "react"
import { useFocusEffect } from "expo-router"
import { AccessibilityInfo, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { STANDING_LABEL, exclusionsSentence, loadTeamMembershipBoard, reminderExclusions, reminderOutcomeSentence, remindAgainOn, sendMembershipReminders, type MembershipRow, type TeamMembershipBoard } from "@ovalball/contracts/membership/board"
import {
  NEEDS_ACTION,
  REMINDER_RECIPIENTS_EXPLAINED,
  memberGroups,
  previewMembershipReminders,
  sendRemindersInBatches,
  sendRemindersLabel,
  standingGuidance,
  type ReminderPreview,
} from "@ovalball/contracts/membership/operate"
import { loadMembershipReminderHistory, type MembershipReminderEntry } from "@ovalball/contracts/membership/member"
import { isFamilyFacingContext } from "@ovalball/contracts"

import { supabase } from "../../src/auth/supabase"
import { useAppContexts } from "../../src/context/contexts"
import { useTeamAuthority } from "../../src/team/authority"
import { NotForYou, TeamScreen } from "../../src/team/screen"
import { DestinationFoundation } from "../../src/components/destination"
import { FamilySubscriptions } from "../../src/family/subscriptions"
import { AppHeader } from "../../src/components/app-header"
import { Receipt } from "../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../src/components/ui"
import { Sheet } from "../../src/components/field-sheet"
import { FoldedGroup, remindedLine } from "../../src/membership/board-ui"
import { MemberRow, StandingBar, StandingLegend, StatusCard, personName, reminderProblem, shortDate, spoken, standingLegendSpoken } from "../../src/membership/running-ui"
import { ReminderMessages } from "../../src/membership/reminder-messages"
import { ActionGroup, Note } from "../../src/people/ui"
import { Notice } from "../../src/admin/finance-ui"
import { ContextSheet } from "../../src/components/context-sheet"
import { friendly, logDetail } from "../../src/errors/translate"
import { colour, space, type } from "../../src/design/tokens"

/**
 * MEMBERSHIPS -- whether each player in the squad is up to date, and a way to ask (Club Memberships Part 2).
 *
 * IN A TEAM CONTEXT, for somebody the server says holds `finance.subscription.view` at the team (or the club), this
 * is the squad's membership standing: the same standing the club sees for each of these players -- one derivation on
 * the server, so the two can never disagree -- and nothing else. No amount, no payer, no Direct Debit, no club money
 * and no other team: the team board (`team_membership_board`) cannot return them (decision #2). The players who need
 * action come first; each opens what their standing means and, where it helps, a reminder. "Remind" asks the
 * player's responsible payer (or, with nothing set up, the guardians the contact rule allows -- never a child)
 * through the one notification system; the server holds a second reminder back for 72 hours, records who sent it,
 * and lets a team's staff remind only their own players. Recent reminders show who was asked about, never who was told.
 *
 * Everywhere else the route keeps what it was: a family's own memberships, or the foundation card, honest about what
 * it will hold and where the job lives today. Hiding a row removes a shortcut, never an authority.
 */
export default function Subscriptions() {
  const { active } = useAppContexts()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [board, setBoard] = useState<TeamMembershipBoard | null>(null)
  const [history, setHistory] = useState<MembershipReminderEntry[] | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)

  const teamContext = active?.kind === "team"

  const load = useCallback(async () => {
    if (!teamId || !authority.subscriptionView) return
    const gen = ++generation.current
    setProblem(null)
    try {
      const next = await loadTeamMembershipBoard(supabase, teamId)
      if (gen !== generation.current) return
      setBoard(next)
      setRefused(false)
      // The reminders about this team's own players. A team's staff are never told how many people were told.
      const recent = await loadMembershipReminderHistory(supabase, { clubId: next.clubId, teamId, limit: 50 }).catch(() => null)
      if (gen === generation.current) setHistory(recent ? recent.reminders : null)
    } catch (caught) {
      if ((caught as { code?: string }).code === "42501") {
        setRefused(true)
        return
      }
      const failure = friendly(caught, "the squad's memberships")
      logDetail("team:memberships", failure)
      if (gen === generation.current) setProblem(failure.message)
    }
  }, [teamId, authority.subscriptionView])

  useEffect(() => {
    setBoard(null)
    setHistory(null)
  }, [teamId])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  /** One player, or everybody who can be asked: the server decides who is asked and holds back repeats. */
  const remind = useCallback(
    async (playerIds: string[]): Promise<string> => {
      if (!board || !teamId || playerIds.length === 0) return ""
      const { result, error } = await sendRemindersInBatches((batch) => sendMembershipReminders(supabase, { clubId: board.clubId, teamId, playerIds: batch }), playerIds)
      const done = reminderOutcomeSentence(result)
      // The server's own sentence when it refuses (a daily limit, a refusal), never a guess.
      const text = error ? (result.sent > 0 || result.skipped.length > 0 ? `${done} The rest weren't sent. ${reminderProblem(error)}` : reminderProblem(error)) : done
      setNotice({ tone: error && result.sent === 0 ? "error" : "ok", text })
      await load()
      return text
    },
    [board, teamId, load]
  )

  /** The server's own words for exactly these players, as the team's staff -- records nothing. */
  const preview = useCallback(
    (playerIds: string[]): Promise<ReminderPreview> => {
      if (!board || !teamId) return Promise.reject(new Error("The squad is still loading."))
      return previewMembershipReminders(supabase, { clubId: board.clubId, teamId, playerIds })
    },
    [board, teamId]
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  // A FAMILY'S MEMBERSHIPS (CA-M9): what applies, whom it covers, what it costs and what to do next.
  if (active && isFamilyFacingContext(active.kind)) {
    return <FamilySubscriptionsScreen />
  }

  if (!teamContext) {
    return (
      <DestinationFoundation
        icon={<Receipt size={30} color={colour.forest800} strokeWidth={1.9} />}
        title="Subscriptions"
        intro="Whether each player in your squad is set up to pay. Payments themselves are handled by the club."
        willHold={["Who is paid, due, failed or not set up yet", "Chasing the ones that need chasing, without leaving the app", "For a parent: what you owe and when it goes out"]}
        webPath="/dashboard"
        webLabel="Open Subscriptions on the Web"
      />
    )
  }

  return (
    <TeamScreen section="Memberships" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && (!authority.subscriptionView || refused) && (
        <NotForYou title="Memberships are not part of your view" body="Whether the squad is up to date is shown to the people the club has given that job to. Payments themselves are handled by the club." />
      )}
      {authority.subscriptionView && !refused && <TeamMembershipView board={board} history={history} problem={problem} onRetry={load} notice={notice} onRemind={remind} onPreview={preview} />}
    </TeamScreen>
  )
}

function FamilySubscriptionsScreen() {
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>Subscriptions & Payments</Text>
        <FamilySubscriptions />
      </ScrollView>
    </View>
  )
}

function TeamMembershipView({
  board,
  history,
  problem,
  onRetry,
  notice,
  onRemind,
  onPreview,
}: {
  board: TeamMembershipBoard | null
  history: MembershipReminderEntry[] | null
  problem: string | null
  onRetry: () => void
  notice: { tone: "ok" | "error"; text: string } | null
  onRemind: (playerIds: string[]) => Promise<string>
  onPreview: (playerIds: string[]) => Promise<ReminderPreview>
}) {
  const [open, setOpen] = useState<MembershipRow | null>(null)
  const [sending, setSending] = useState(false)
  const [allHistory, setAllHistory] = useState(false)
  // REMINDING EVERYBODY IS CONFIRMED, never one tap: the sheet shows the server's words for each situation first.
  const [confirm, setConfirm] = useState<{ ids: string[]; preview: ReminderPreview | null; problem: string | null } | null>(null)
  const [confirmSending, setConfirmSending] = useState(false)

  if (problem && !board) return <ErrorState message={problem} onRetry={onRetry} />
  if (board === null) return <CardSkeleton lines={4} />
  if (!board.programmeEnabled) {
    return <EmptyState title="The club does not collect membership through Ovalball" body="Each player's membership appears here once the club sets up its membership." icon={<Receipt size={22} color={colour.inkSubtle} />} />
  }
  if (board.rows.length === 0) return <EmptyState title="No players in this team yet" body="Each player's membership appears here once players have joined the squad." />

  const needsRows = board.rows.filter((r) => NEEDS_ACTION.has(r.standing))
  const askable = board.rows.filter((r) => r.canRemind).map((r) => r.playerId)
  const left = exclusionsSentence(reminderExclusions(needsRows), "team")
  const settledGroups = memberGroups(board.rows.filter((r) => !NEEDS_ACTION.has(r.standing) && r.standing !== "ENDED"))
  const total = board.counts.total
  const recent = history ? (allHistory ? history : history.slice(0, 5)) : []

  function openConfirm(ids: string[]) {
    setConfirm({ ids, preview: null, problem: null })
    onPreview(ids)
      .then((next) => setConfirm((c) => (c && c.ids === ids ? { ...c, preview: next } : c)))
      .catch((cause: unknown) => setConfirm((c) => (c && c.ids === ids ? { ...c, problem: reminderProblem(cause) } : c)))
  }

  async function remindAll() {
    if (!confirm) return
    setConfirmSending(true)
    const said = await onRemind(confirm.ids)
    setConfirmSending(false)
    setConfirm(null)
    if (said) AccessibilityInfo.announceForAccessibility(said)
  }

  async function remindOne() {
    if (!open) return
    setSending(true)
    const said = await onRemind([open.playerId])
    setSending(false)
    setOpen(null)
    if (said) AccessibilityInfo.announceForAccessibility(said)
  }

  const row = open
  const guidance = row ? standingGuidance(row.reason, "team") : null
  const reminded = row ? remindedLine(row) : null
  const again = row ? remindAgainOn(row) : null

  return (
    <>
      {/* THE SQUAD AT A GLANCE: how many, the standing bar, and the same in words. Never an amount. */}
      <Card style={{ gap: space.md }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {`${total} ${total === 1 ? "player" : "players"}`}
        </Text>
        <View accessible accessibilityLabel={`${standingLegendSpoken(board.counts)}.`} style={{ gap: space.sm }}>
          <StandingBar counts={board.counts} />
          <StandingLegend counts={board.counts} />
        </View>
        {needsRows.length === 0 && <Text style={[type.small, { color: colour.ink }]}>Nobody needs action this month.</Text>}
      </Card>

      {!board.takingNewMemberships && <Note>{"The club isn't taking new memberships just now. Members already paying carry on."}</Note>}

      <Notice notice={notice} />

      {needsRows.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.inkMuted }]}>
            Need action · {needsRows.length}
          </Text>
          <ActionGroup>
            {needsRows.map((r, i) => (
              <MemberRow key={r.playerId} row={r} first={i === 0} context="team" hint="Shows what this means, and a reminder" onPress={() => setOpen(r)} />
            ))}
          </ActionGroup>
          {askable.length > 0 && (
            <Button
              variant="brand"
              label={askable.length === 1 ? "Remind 1 Family" : `Remind ${askable.length} Families`}
              accessibilityHint="Shows the message each family will get before anything is sent"
              onPress={() => openConfirm(askable)}
            />
          )}
          {left && <Text style={[type.caption, { color: colour.inkMuted }]}>{left}</Text>}
        </View>
      )}

      {/* Collecting, up to date and exempt need nothing from the team, so they fold away, and are lines to read. */}
      {settledGroups.map((group) => (
        <FoldedGroup key={group.standing} label={STANDING_LABEL[group.standing]} count={group.rows.length}>
          <ActionGroup>
            {group.rows.map((r, i) => (
              <MemberRow key={r.playerId} row={r} first={i === 0} context="team" />
            ))}
          </ActionGroup>
        </FoldedGroup>
      ))}

      {recent.length > 0 && history && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Recent Reminders
          </Text>
          <ActionGroup>
            {recent.map((e, i) => {
              const about = e.reason ? standingGuidance(e.reason, "team").title : e.standing ? STANDING_LABEL[e.standing] : null
              const line = [about, e.sentBy ? `by ${e.sentBy}` : null, shortDate(e.sentAt)].filter(Boolean).join(" · ")
              const name = personName(e.firstName, e.surname)
              return (
                <View key={`${e.sentAt}-${e.playerId}`} accessible accessibilityLabel={`${name}. ${spoken(line)}`} style={{ paddingVertical: space.sm + 2, paddingHorizontal: space.lg, gap: 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{name}</Text>
                  <Text style={[type.small, { color: colour.inkMuted }]}>{line}</Text>
                </View>
              )
            })}
          </ActionGroup>
          {history.length > 5 && <Button label={allHistory ? "Show Fewer" : "See All"} variant="quiet" onPress={() => setAllHistory((v) => !v)} style={{ alignSelf: "flex-start" }} />}
        </View>
      )}

      <Text style={[type.caption, { color: colour.inkSubtle }]}>Whether each player is paid up, not how they pay. Payers and bank details never appear here.</Text>

      <Sheet
        visible={row !== null}
        title={row ? personName(row.firstName, row.surname) : ""}
        hint={row?.membership?.name}
        onClose={() => setOpen(null)}
        onSave={() => void remindOne()}
        saving={sending}
        problem={null}
        saveLabel="Send Reminder"
        canSave={!!row?.canRemind}
        brand
        dismissLabel="Close"
      >
        {row && guidance && (
          <View style={{ gap: space.md }}>
            <StatusCard flat guidance={guidance} />
            {reminded && <Text style={[type.caption, { color: colour.inkMuted }]}>{again ? `${reminded} · can remind again ${again}` : reminded}</Text>}
            {!row.canRemind && guidance.action === "remind" && !again && <Text style={[type.caption, { color: colour.inkMuted }]}>{"This player can't be reminded right now."}</Text>}
            {!row.canRemind && guidance.action !== "remind" && <Text style={[type.caption, { color: colour.inkMuted }]}>{"There is nothing to remind the family about."}</Text>}
          </View>
        )}
      </Sheet>

      <Sheet
        visible={confirm !== null}
        title={confirm ? (confirm.ids.length === 1 ? "Remind 1 Family" : `Remind ${confirm.ids.length} Families`) : ""}
        onClose={() => setConfirm(null)}
        onSave={() => void remindAll()}
        saving={confirmSending}
        problem={confirm?.problem ?? null}
        saveLabel={sendRemindersLabel(confirm?.preview?.willSend || confirm?.ids.length || 0)}
        canSave={!!confirm?.preview && confirm.preview.willSend > 0}
        brand
      >
        {confirm && (
          <View style={{ gap: space.md }}>
            {confirm.preview ? <ReminderMessages inSheet preview={confirm.preview} /> : !confirm.problem && <CardSkeleton lines={3} />}
            <Text style={[type.caption, { color: colour.inkMuted }]}>{REMINDER_RECIPIENTS_EXPLAINED} Nobody is asked twice in three days.</Text>
          </View>
        )}
      </Sheet>
    </>
  )
}
