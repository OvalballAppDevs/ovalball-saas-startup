import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import { parseMatchCentreSection, type MatchCentreSection } from "@ovalball/contracts/match-centre/sections"
import { readTournamentParticipantCentre } from "@ovalball/contracts/tournaments/participant-centre"
import {
  countsTowardsTable,
  latestClaimPerSide,
  readTournamentGameResult,
  resolveTournamentGameResult,
  resultStatusExplanation,
  resultStatusLabel,
  resultStatusTone,
  submitTournamentGameResult,
  type ResultSide,
  type ResultSubmission,
  type TournamentGameResult,
} from "@ovalball/contracts/tournaments/results"

import { supabase } from "../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { Button, CardSkeleton, ErrorState, InfoNote, StatusPill } from "../../../../src/components/ui"
import { ChevronRight } from "../../../../src/components/icons"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { longDate } from "../../../../src/tournaments/detail-chrome"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"
import { MatchHero, type MatchHeroModel } from "../../../../src/fixtures/match-centre/hero"
import { MatchCentreTabs } from "../../../../src/fixtures/match-centre/tabs"
import { routeForIntent } from "../../../../src/links/destinations"
import { useCurrentStack, withinStack } from "../../../../src/links/stack"

/**
 * ONE TOURNAMENT GAME, IN THE ONE MATCH CENTRE.
 *
 * Every game is opened in the Match Centre (owner brief, 2026-10-03): a tournament game is drawn by the
 * same header, the same hero and the same section bar as a fixture -- `MatchHero` and `MatchCentreTabs`
 * are shared components, not copies -- with the sections a single game of a tournament has: its
 * Overview, and its Result. Attendance, the draw and the table belong to the whole tournament and stay
 * in the Tournament Centre, which the Overview opens. This address stays the game's canonical one,
 * because every tournament result notification and job already carries it.
 *
 * ---- THE RESULT SECTION: ONE TOURNAMENT GAME'S RESULT, FOR WHOEVER IS LOOKING AT IT ----------------
 *
 * ONE SCREEN, SEVERAL STATES, AND DELIBERATELY NOT ONE FORM. A side submitting a score, the other side
 * confirming or contesting it, a side proposing a correction, and the organiser settling a
 * disagreement are the same conversation at different points -- so they share a screen. What they do
 * NOT share is a layout.
 *
 * ---- THE INVARIANT THIS SCREEN EXISTS TO HOLD ----------------------------------------------------
 *
 * WHEN THERE IS ONE CANONICAL SETTLED RESULT, THE SCREEN SHOWS THAT SCORE ONCE.
 *
 * The first draft showed it three times -- in the fixture card, again in a "Final Result" panel, and
 * again inside two editable score boxes -- and said the organiser had settled it in five different
 * places. A finished result should be EASIER to read than an unfinished one, and it was the opposite.
 *
 * So the score lives in the card at the top, and nothing below repeats it. FORMS EXIST ONLY WHILE
 * SOMEBODY IS PERFORMING AN ACTION: a settled game shows no inputs at all until an authorised person
 * explicitly chooses to change it, and that choice is its own mode with its own heading.
 *
 * ---- WHAT THE SCREEN IS FOR IS THE SERVER'S ANSWER -----------------------------------------------
 *
 * `game.can` carries what this caller may do, resolved by the same authorities the write path
 * enforces. Nothing here is gated on a role name, and every button that exists calls an RPC that
 * re-checks the same authority -- so a button drawn in error is refused rather than obeyed.
 *
 * ---- AND IT IS NOT A ROUND ROBIN SCREEN ----------------------------------------------------------
 *
 * The result lifecycle is the same whatever the competition's shape; only the sporting consequence
 * differs -- a table recalculates, or a bracket advances. This component is therefore the one result
 * detail for every format, and must not be forked per format.
 */

/** What the person is DOING, which is not the same as what state the game is in. */
type Mode = "view" | "submit" | "contest" | "resolve" | "edit"

/** The sections one game of a tournament has. */
const TOURNAMENT_GAME_SECTIONS: readonly MatchCentreSection[] = ["overview", "result"]

export default function TournamentGameResultScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { gameId, tab, tournamentId } = useLocalSearchParams<{ gameId: string; tab?: string; tournamentId?: string }>()
  const id = String(gameId ?? "")
  const stack = useCurrentStack()
  // A result is what a tournament game is opened for -- every notification about one is about its result.
  const [section, setSection] = useState<MatchCentreSection>(tab ? parseMatchCentreSection(tab) : "result")
  const [venueName, setVenueName] = useState<string | null>(null)

  const [game, setGame] = useState<TournamentGameResult | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // `null` means "whatever this game's state implies"; a value means the person chose a mode.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null)
  const [scoreA, setScoreA] = useState("")
  const [scoreB, setScoreB] = useState("")
  const [note, setNote] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await readTournamentGameResult(supabase, id)
      if (!loaded) {
        // THE RESULT CONVERSATION IS THE SIDES' AND THE ORGANISER'S. A family that tapped its child's
        // game is not refused at a dead end: it goes to the tournament's Agenda, which lists that game
        // for them, read-only. The read itself is unchanged -- nothing here widens who sees a result.
        if (tournamentId) {
          router.replace(withinStack({ pathname: "/tournaments/[tournamentId]", params: { tournamentId: String(tournamentId), tab: "Agenda" } }, stack) as never)
          return
        }
        setMissing(true)
        return
      }
      setGame(loaded)
      // The ground is the tournament's. Best effort: a game reads perfectly well without it.
      void readTournamentParticipantCentre(supabase, loaded.tournamentId)
        .then((centre) => setVenueName(centre?.venueName ?? null))
        .catch(() => setVenueName(null))
    } catch (caught) {
      const fail = friendly(caught, "this result")
      logDetail("tournament game result", fail)
      setProblem(fail.message)
    }
  }, [id, tournamentId, router, stack])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * THE DEFAULT MODE IS WHAT THE PERSON CAME TO DO.
   *
   * A game with no result and a side who can record one: they are here to submit, so the form is the
   * screen. Everything else opens in VIEW, because reading the result is the common case and every
   * change is a deliberate choice.
   */
  const mode: Mode = useMemo(() => {
    if (chosenMode) return chosenMode
    if (!game) return "view"
    if (game.resultStatus === "none" && game.can.submit) return "submit"
    return "view"
  }, [chosenMode, game])

  const settled = !!game && countsTowardsTable(game.resultStatus)
  const contested = !!game && (game.resultStatus === "disputed" || game.resultStatus === "amendment_pending")
  const awaiting = game?.resultStatus === "awaiting_confirmation"
  const mine = awaiting && game?.submittedBySideId === game?.viewerSideId

  function enter(next: Mode) {
    // A NEW SCORE IS NEVER A COPY OF SOMEBODY ELSE'S. Contesting, resolving and correcting all begin
    // from blank, so the quickest path through the screen can never be "endorse whatever is already
    // there without reading it".
    setScoreA("")
    setScoreB("")
    setNote("")
    setFailure(null)
    setChosenMode(next)
  }

  async function run(kind: "submit" | "confirm" | "resolve", scores?: { a: number; b: number }) {
    if (!game) return
    const a = scores ? scores.a : Number(scoreA)
    const b = scores ? scores.b : Number(scoreB)
    if (!Number.isInteger(a) || a < 0 || !Number.isInteger(b) || b < 0) {
      setFailure("Enter both scores as whole numbers.")
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      if (kind === "resolve") {
        await resolveTournamentGameResult(supabase, game.id, a, b, note.trim() || null)
      } else {
        await submitTournamentGameResult(supabase, game.id, a, b, note.trim() || null)
      }
      setNote("")
      setChosenMode(null)
      await load()
    } catch (caught) {
      const fail = friendly(caught, "this result")
      logDetail("tournament result write", fail)
      setFailure(fail.message)
    } finally {
      setBusy(false)
    }
  }

  const hero = useMemo<MatchHeroModel | null>(() => (game ? tournamentGameHero(game, venueName) : null), [game, venueName])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader
        title="Match Centre"
        onBack={() => {
          // Leaving a form returns to the result, not off the screen -- the person has not finished.
          if (chosenMode && chosenMode !== "submit") {
            setChosenMode(null)
            return
          }
          router.canGoBack() ? router.back() : router.replace("/calendar" as never)
        }}
      />

      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={hero ? [1] : []}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      >
        {/*
          THE CANONICAL RESULT IS IN THE HERO. One score, at the top, beside the game it belongs to --
          the same hero every fixture has. Nothing below repeats it.
        */}
        {hero && <MatchHero view={hero} onOpenClub={() => undefined} onOpenTeam={() => undefined} relationLabels={{ home: "YOUR SIDE", away: "YOUR SIDE" }} />}
        {hero && <MatchCentreTabs tabs={TOURNAMENT_GAME_SECTIONS} section={section} onSelect={setSection} />}

        <View style={{ padding: space.lg, gap: space.md }}>
        {missing && <ErrorState message="This game isn't one you can see the result of." />}
        {!missing && problem && !game && <ErrorState message={problem} onRetry={() => void load()} />}
        {!missing && !problem && !game && <CardSkeleton lines={4} />}

        {!!game && section === "overview" && (
          <TournamentGameOverview
            game={game}
            venueName={venueName}
            settled={settled}
            onOpenTournament={() => {
              const route = routeForIntent({ kind: "TOURNAMENT", tournamentId: game.tournamentId })
              if (route) router.push(route as never)
            }}
          />
        )}

        {!!game && section === "result" && (
          <>

            {mode === "view" && (
              <ViewState
                game={game}
                busy={busy}
                onEnter={enter}
                onConfirm={() => void run("confirm", { a: game.sideAScore ?? 0, b: game.sideBScore ?? 0 })}
              />
            )}

            {mode === "submit" && (
              <ScoreForm
                heading="THE SCORE"
                game={game}
                scoreA={scoreA} setScoreA={setScoreA}
                scoreB={scoreB} setScoreB={setScoreB}
                note={note} setNote={setNote}
                noteLabel="Note (Optional)"
                notePlaceholder="Anything the other side or the organiser should know."
                action="Submit Result"
                busy={busy}
                failure={failure}
                onSubmit={() => void run("submit")}
              />
            )}

            {mode === "contest" && (
              <>
                <ClaimPanel
                  heading="SUBMITTED RESULT"
                  by={`Submitted by ${game.viewerIsSideA ? game.sideB.clubName : game.sideA.clubName}`}
                  sideA={game.sideA.clubName}
                  sideB={game.sideB.clubName}
                  scoreA={game.sideAScore}
                  scoreB={game.sideBScore}
                  at={game.submittedAt}
                />
                <ScoreForm
                  heading="YOUR PROPOSED RESULT"
                  game={game}
                  scoreA={scoreA} setScoreA={setScoreA}
                  scoreB={scoreB} setScoreB={setScoreB}
                  note={note} setNote={setNote}
                  noteLabel="Reason or Note (Optional)"
                  notePlaceholder="Say what you think the score was and why — the organiser reads this."
                  action="Contest Result"
                  busy={busy}
                  failure={failure}
                  onSubmit={() => void run("submit")}
                  onCancel={() => setChosenMode(null)}
                />
              </>
            )}

            {mode === "resolve" && (
              <ScoreForm
                heading="FINAL SCORE"
                game={game}
                scoreA={scoreA} setScoreA={setScoreA}
                scoreB={scoreB} setScoreB={setScoreB}
                note={note} setNote={setNote}
                noteLabel="Resolution Note (Optional)"
                notePlaceholder="Recorded against the tournament, so the clubs can see how it was settled."
                action="Confirm Final Result"
                busy={busy}
                failure={failure}
                onSubmit={() => void run("resolve")}
                onCancel={() => setChosenMode(null)}
              />
            )}

            {mode === "edit" && (
              <>
                {/* THE TRANSITION IS EXPLICIT. The settled numbers are shown as what they ARE, and the
                    new ones are typed beneath -- rather than the old score quietly becoming editable. */}
                <ClaimPanel
                  heading="EDIT FINAL RESULT"
                  by="Current result"
                  sideA={game.sideA.clubName}
                  sideB={game.sideB.clubName}
                  scoreA={game.sideAScore}
                  scoreB={game.sideBScore}
                  at={null}
                />
                <ScoreForm
                  heading="NEW RESULT"
                  game={game}
                  scoreA={scoreA} setScoreA={setScoreA}
                  scoreB={scoreB} setScoreB={setScoreB}
                  note={note} setNote={setNote}
                  noteLabel="Reason for Correction"
                  notePlaceholder="Why the settled result is being changed. Recorded against the tournament."
                  action="Save Corrected Result"
                  busy={busy}
                  failure={failure}
                  // CHANGING A SETTLED RESULT NEEDS A REASON. A club whose agreed score moves is owed
                  // an explanation, and the audit trail is where they will look for it.
                  requireNote
                  onSubmit={() => void run(game.can.resolve ? "resolve" : "submit")}
                  onCancel={() => setChosenMode(null)}
                />
              </>
            )}

            {/*
              THE AUDIT TRAIL, FOLDED AWAY. Nothing in it is ever overwritten, so it is always worth
              keeping -- but a settled result should not be buried under its own history.
            */}
            {game.submissions.length > 0 && (
              <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: historyOpen }}
                  accessibilityLabel={`Result history, ${game.submissions.length} ${game.submissions.length === 1 ? "entry" : "entries"}`}
                  onPress={() => setHistoryOpen((v) => !v)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                    minHeight: TOUCH_TARGET,
                    paddingHorizontal: space.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={[type.smallMedium, { flex: 1, color: colour.ink }]}>Result history</Text>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{game.submissions.length}</Text>
                  <View style={{ transform: [{ rotate: historyOpen ? "90deg" : "0deg" }] }}>
                    <ChevronRight size={16} color={colour.inkSubtle} strokeWidth={2} />
                  </View>
                </Pressable>
                {historyOpen &&
                  game.submissions.map((s) => <Claim key={s.id} claim={s} />)}
              </View>
            )}
          </>
        )}
        </View>
      </ScrollView>
    </View>
  )
}

/** The hero's facts for one game of a tournament -- the same facts a fixture's hero draws. */
function tournamentGameHero(game: TournamentGameResult, venueName: string | null): MatchHeroModel {
  const side = (s: ResultSide) => ({
    teamId: null,
    clubId: null,
    directoryId: null,
    clubName: s.clubName,
    teamName: s.label,
    crestUrl: clubLogoUrlFromPath(supabase, s.crestPath),
    kit: null,
    onOvalball: s.onOvalball,
  })
  const scored = game.resultStatus !== "none" && game.sideAScore !== null && game.sideBScore !== null
  return {
    status: game.status === "CANCELLED" ? "CANCELLED" : game.status === "PLAYED" ? "COMPLETED" : "ACCEPTED",
    resultStatus: game.resultStatus,
    cancelled: game.status === "CANCELLED",
    cancellationReason: null,
    // A KNOCKOUT NAMES ITS GAMES; a round robin names its table and its round. The server writes the
    // knockout's name, so the draw and the result never call the same game two different things.
    matchType: game.stageLabel ?? game.roundName ?? ([game.tableName, game.round ? `Round ${game.round}` : null].filter(Boolean).join(" · ") || null),
    competitionName: game.tournamentName,
    home: side(game.sideA),
    away: side(game.sideB),
    viewerSide: game.viewerSideId ? (game.viewerIsSideA ? "home" : "away") : null,
    result: scored ? { homeScore: game.sideAScore as number, awayScore: game.sideBScore as number } : null,
    date: game.date,
    meetTime: null,
    kickoffTime: game.startTime,
    venue: { name: venueName },
    pitch: { name: game.pitchName },
  }
}

/** OVERVIEW: what this game is, where its result stands, and the way to the whole tournament. */
function TournamentGameOverview({ game, venueName, settled, onOpenTournament }: { game: TournamentGameResult; venueName: string | null; settled: boolean; onOpenTournament: () => void }) {
  const rows: [string, string | null][] = [
    ["Tournament", game.tournamentName],
    ["Stage", game.stageLabel ?? game.roundName ?? ([game.tableName, game.round ? `Round ${game.round}` : null].filter(Boolean).join(" · ") || null)],
    ["Date", longDate(game.date)],
    ["Kick-off", game.startTime ? game.startTime.slice(0, 5) : "To be confirmed"],
    ["Length", game.durationMinutes ? `${game.durationMinutes} minutes` : null],
    ["Ground", venueName],
    ["Pitch", game.pitchName],
  ]
  return (
    <>
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Match Details</Text>
        {rows.filter(([, v]) => !!v).map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", gap: space.md }}>
            <Text style={[type.small, { color: colour.inkMuted, width: 88 }]}>{label}</Text>
            <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{value}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs }}>
          <StatusPill
            label={resultStatusLabel(game.resultStatus)}
            tone={settled || resultStatusTone(game.resultStatus) === "positive" ? "positive" : resultStatusTone(game.resultStatus) === "caution" ? "caution" : "neutral"}
          />
        </View>
      </View>
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.sm }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>Attendance, the draw and the table for the whole tournament are in the Tournament Centre.</Text>
        <Button label="Open Tournament Centre" variant="secondary" onPress={onOpenTournament} />
      </View>
    </>
  )
}

/* ---- the settled / waiting / contested reading states ---------------------------------------------- */

function ViewState({
  game,
  busy,
  onEnter,
  onConfirm,
}: {
  game: TournamentGameResult
  busy: boolean
  onEnter: (m: Mode) => void
  /** CONFIRMING IS NOT A FORM. Agreeing means submitting the score already on screen, so it is one tap
      against the number the other side gave -- never a re-entry that could silently differ by a digit. */
  onConfirm: () => void
}) {
  const settled = countsTowardsTable(game.resultStatus)
  const contested = game.resultStatus === "disputed" || game.resultStatus === "amendment_pending"
  const awaiting = game.resultStatus === "awaiting_confirmation"
  const mineIsWaiting = awaiting && game.submittedBySideId === game.viewerSideId
  const recordedBy =
    game.submittedBySideId === game.sideA.participantId ? game.sideA.clubName
    : game.submittedBySideId === game.sideB.participantId ? game.sideB.clubName
    : null

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row" }}>
          <StatusPill
            label={resultStatusLabel(game.resultStatus)}
            tone={
              resultStatusTone(game.resultStatus) === "positive" ? "positive"
              : resultStatusTone(game.resultStatus) === "caution" ? "caution"
              : "neutral"
            }
          />
        </View>

        {/*
          WHO SETTLED IT AND WHEN, in ONE line rather than restated in four. "Confirmed" is two clubs
          agreeing; the organiser ruling is a different thing and says so; and a recorded result names
          the club that recorded it, because nobody confirmed it.
        */}
        {settled && (
          <>
            <Text style={[type.small, { color: colour.ink }]}>
              {game.resolvedAt
                ? "Confirmed by Tournament Organiser"
                : game.resultStatus === "external_recorded"
                  ? `Recorded by ${recordedBy ?? "the side that played"}`
                  : "Confirmed by both sides"}
            </Text>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>
              {whenText(game.resolvedAt ?? game.confirmedAt ?? game.submittedAt)}
            </Text>
            {game.resultStatus === "external_recorded" && (
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                The opposition is not on Ovalball, so confirmation was not required.
              </Text>
            )}
            {!!game.resolutionReason && (
              <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>“{game.resolutionReason}”</Text>
            )}
          </>
        )}

        {awaiting && (
          <>
            <Text style={[type.small, { color: colour.ink }]}>
              Submitted by {recordedBy ?? "the other side"}
            </Text>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>{whenText(game.submittedAt)}</Text>
          </>
        )}

        {game.resultStatus === "none" && (
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {game.status === "CANCELLED"
              ? "This game was cancelled, so it has no result."
              : game.kickedOff
                ? "No result has been recorded yet."
                : "A score can be recorded once this game has kicked off."}
          </Text>
        )}
      </View>

      {/*
        A CONTEST IS THE ONE STATE WHERE SEVERAL SCORES BELONG ON SCREEN, because there genuinely are
        several claims and the organiser is deciding between them.
      */}
      {contested && (
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
          <Text style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: space.md, paddingTop: space.sm }]}>
            RESULT CONTESTED
          </Text>
          {latestClaimPerSide(game).map((claim) => (
            <Claim key={claim.id} claim={claim} prominent />
          ))}
        </View>
      )}

      {/* ---- what this person may do about it ---------------------------------------------------- */}

      {awaiting && game.can.submit && !mineIsWaiting && (
        <View style={{ gap: space.sm }}>
          <Button
            label="Confirm Result"
            busy={busy}
            onPress={onConfirm}
            accessibilityHint="Agrees the score the other side submitted"
          />
          <Button label="Contest Result" variant="secondary" onPress={() => onEnter("contest")} />
        </View>
      )}

      {awaiting && mineIsWaiting && (
        <>
          {/* THE ONE SENTENCE, from the one place that writes it: a knockout's score decides who goes
              through, a round robin's moves a table, and this screen must not say the other. */}
          <InfoNote>{resultStatusExplanation(game)}</InfoNote>
          <Button label="Change Your Score" variant="secondary" onPress={() => onEnter("submit")} />
        </>
      )}

      {contested && game.can.resolve && <Button label="Resolve Result" onPress={() => onEnter("resolve")} />}

      {contested && !game.can.resolve && (
        <InfoNote>{resultStatusExplanation(game)}</InfoNote>
      )}

      {/* A SETTLED RESULT SHOWS NO CONTROLS until somebody chooses to change it. The organiser always
          may; a club may only where the result is the two clubs' own agreement rather than a ruling. */}
      {settled && game.can.resolve && (
        <Button label="Edit Result" variant="secondary" onPress={() => onEnter("edit")} />
      )}
      {settled && !game.can.resolve && game.can.submit && !game.resolvedAt && (
        <Button label="Propose a Change" variant="secondary" onPress={() => onEnter("edit")} />
      )}

      {game.resultStatus === "none" && game.can.resolve && !game.can.submit && game.kickedOff && (
        <Button label="Record Result" onPress={() => onEnter("resolve")} />
      )}
      {game.resultStatus === "none" && game.can.submit && game.kickedOff && (
        <Button label="Submit Result" onPress={() => onEnter("submit")} />
      )}
    </View>
  )
}

/* ---- pieces ---------------------------------------------------------------------------------------- */

function ClaimPanel({
  heading,
  by,
  sideA,
  sideB,
  scoreA,
  scoreB,
  at,
}: {
  heading: string
  by: string
  sideA: string
  sideB: string
  scoreA: number | null
  scoreB: number | null
  at: string | null
}) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.xs }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{heading}</Text>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{by}</Text>
      <View style={{ gap: 2, paddingTop: 2 }}>
        <Row label={sideA} value={scoreA} />
        <Row label={sideB} value={scoreB} />
      </View>
      {!!at && <Text style={[type.caption, { color: colour.inkSubtle }]}>{whenText(at)}</Text>}
    </View>
  )
}

function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.ink }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: colour.forest800 }]}>{value ?? "—"}</Text>
    </View>
  )
}

function ScoreForm({
  heading,
  game,
  scoreA, setScoreA,
  scoreB, setScoreB,
  note, setNote,
  noteLabel,
  notePlaceholder,
  action,
  busy,
  failure,
  requireNote = false,
  onSubmit,
  onCancel,
}: {
  heading: string
  game: TournamentGameResult
  scoreA: string; setScoreA: (v: string) => void
  scoreB: string; setScoreB: (v: string) => void
  note: string; setNote: (v: string) => void
  noteLabel: string
  notePlaceholder: string
  action: string
  busy: boolean
  failure: string | null
  requireNote?: boolean
  onSubmit: () => void
  onCancel?: () => void
}) {
  const ready = scoreA !== "" && scoreB !== "" && (!requireNote || note.trim().length > 0)
  return (
    <View style={{ gap: space.md }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{heading}</Text>
      <ScoreField label={game.sideA.clubName} value={scoreA} onChange={setScoreA} />
      <ScoreField label={game.sideB.clubName} value={scoreB} onChange={setScoreB} />

      <View style={{ gap: space.xs }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{noteLabel}</Text>
        <TextInput
          accessibilityLabel={noteLabel}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={notePlaceholder}
          placeholderTextColor={colour.inkSubtle}
          style={[
            type.body,
            {
              minHeight: 84,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              backgroundColor: colour.surface,
              color: colour.ink,
              textAlignVertical: "top",
            },
          ]}
        />
      </View>

      {failure && <Text style={[type.small, { color: colour.danger }]}>{failure}</Text>}

      <Button label={action} busy={busy} disabled={!ready} onPress={onSubmit} />
      {!!onCancel && <Button label="Cancel" variant="secondary" onPress={onCancel} />}
    </View>
  )
}

function Claim({ claim, prominent = false }: { claim: ResultSubmission; prominent?: boolean }) {
  return (
    <View style={{ paddingHorizontal: space.md, paddingVertical: prominent ? space.md : space.sm, borderTopWidth: 1, borderTopColor: colour.line, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
          {claim.byHost ? "Tournament Organiser" : (claim.bySideName ?? "A side")}
          {claim.byViewer ? " (you)" : ""}
        </Text>
        <Text style={[prominent ? type.heading : type.smallMedium, { color: colour.forest800 }]}>
          {claim.sideAScore} – {claim.sideBScore}
        </Text>
      </View>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>
        {[claimKindLabel(claim), claim.bySideTeam, whenText(claim.at)].filter(Boolean).join(" · ")}
      </Text>
      {!!claim.note && <Text style={[type.small, { color: colour.inkMuted }]}>{claim.note}</Text>}
    </View>
  )
}

function claimKindLabel(claim: ResultSubmission): string {
  switch (claim.kind) {
    case "initial":
      return "Submitted"
    case "confirmation":
      return "Confirmed"
    case "dispute":
      return "Contested"
    case "amendment_proposal":
      return "Change proposed"
    case "host_resolution":
      return "Resolved"
    case "external_recorded":
      return "Recorded"
  }
}

/** "1 Oct 2026 · 14:32" -- the date the app already writes, plus the time a claim needs. */
function whenText(iso: string | null): string {
  if (!iso) return ""
  const day = longDate(iso.slice(0, 10))
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return day
  const hh = String(time.getHours()).padStart(2, "0")
  const mm = String(time.getMinutes()).padStart(2, "0")
  return `${day} · ${hh}:${mm}`
}

function ScoreField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} score`}
        value={value}
        onChangeText={(next) => onChange(next.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="0"
        placeholderTextColor={colour.inkSubtle}
        style={[
          type.title,
          {
            minHeight: TOUCH_TARGET + 12,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: colour.surface,
            color: colour.ink,
            textAlign: "center",
          },
        ]}
      />
    </View>
  )
}
