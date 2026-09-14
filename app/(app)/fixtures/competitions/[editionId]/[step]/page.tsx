import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { StepBar, type StepBarStep } from "@/components/fixtures/step-bar"
import { competitionConflicts } from "@/lib/competitions/competition-conflicts"
import { loadCompetitionWorkspace } from "@/lib/competitions/load-workspace"
import { requireEditionOrganiser } from "@/lib/competitions/organiser-scope"
import { CREATOR_STEPS, CREATOR_STEP_LABEL, type CreatorStep } from "@/lib/competitions/workspace-types"

import { CompetitionDetailsForm } from "./step-details"
import { StepFixtures } from "./step-fixtures"
import { StepGroups } from "./step-groups"
import { StepIssue } from "./step-issue"
import { StepKnockout } from "./step-knockout"
import { StepParticipants } from "./step-participants"

export const metadata = { title: "Competition Creator" }

/**
 * THE COMPETITION CREATOR -- a top step bar and a full-width workspace.
 *
 * Details, Participants, Groups, Fixtures, Knockout, Issue. Every step reads
 * the same workspace (lib/competitions/load-workspace.ts) and writes through
 * the canonical Competition Match RPCs; the step bar carries each step's
 * live state, so it is the summary as well as the navigation.
 */
export default async function CompetitionCreatorPage({ params }: { params: Promise<{ editionId: string; step: string }> }) {
  const { editionId, step: rawStep } = await params
  if (!(CREATOR_STEPS as readonly string[]).includes(rawStep)) notFound()
  const step = rawStep as CreatorStep

  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) redirect("/fixtures/competitions")
  const ws = await loadCompetitionWorkspace(auth.scope.supabase, editionId)
  if (!ws) notFound()

  const entered = ws.participants.filter((p) => p.status === "entered")
  const league = ws.stages.find((s) => s.kind === "league")
  const knockout = ws.stages.find((s) => s.kind === "knockout")
  const leagueMatches = ws.matches.filter((m) => m.stageId === league?.id)
  const koMatches = ws.matches.filter((m) => m.stageId === knockout?.id)
  const reports = competitionConflicts(ws)
  const red = reports.filter((r) => r.level === "red").length
  const awaiting = ws.matches.filter((m) => m.verificationState === "awaiting" || m.verificationState === "change_requested").length
  const drafts = ws.matches.filter((m) => m.status === "draft").length
  // Each step starts from what is saved: after a save refreshes the workspace,
  // the step remounts on the new records instead of keeping stale local ids.
  const version = hashOf(
    JSON.stringify([
      ws.teamCount,
      ws.format,
      ws.participants.map((p) => [p.id, p.slot, p.teamId, p.seed, p.status]),
      ws.stages.map((st) => [st.id, st.settings, st.groups.map((g) => [g.id, g.members]), st.rounds]),
      ws.matches.map((m) => [m.id, m.status, m.verificationState, m.matchDate, m.kickoffTime, m.venueId, m.venueText, m.homeParticipantId, m.awayParticipantId, m.homeScore, m.awayScore]),
    ]),
  )
  const usesGroups = ws.format !== "knockout"
  const usesKnockout = ws.format !== "league"

  const detail: Record<CreatorStep, string | undefined> = {
    details: ws.format === "league_knockout" ? "League + Knockout" : ws.format === "knockout" ? "Knockout" : ws.format === "league" ? "League" : "Format not set",
    participants: `${entered.length}${ws.teamCount ? ` of ${ws.teamCount}` : ""} teams`,
    groups: usesGroups ? (league?.groups.length ? `${league.groups.length} group${league.groups.length === 1 ? "" : "s"}` : "Not drawn") : "Not used",
    fixtures: usesGroups ? (leagueMatches.length ? `${leagueMatches.length} matches${red ? `, ${red} to resolve` : ""}` : "None yet") : "Not used",
    knockout: usesKnockout ? (koMatches.length ? `${koMatches.length} match${koMatches.length === 1 ? "" : "es"}` : "Not drawn") : "Not used",
    issue: drafts > 0 ? `${drafts} draft` : awaiting > 0 ? `${awaiting} awaiting` : ws.matches.length ? "All issued" : "Nothing yet",
  }
  const steps: StepBarStep[] = CREATOR_STEPS.map((key) => ({
    key,
    label: CREATOR_STEP_LABEL[key],
    detail: detail[key],
    href: `/fixtures/competitions/${editionId}/${key}`,
    done: false,
  }))

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <Link href="/fixtures/competitions" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Competitions
      </Link>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-3xl text-ink">{ws.name}</h1>
        <p className="text-sm text-ink-muted">
          {/* The season's own name already says its code ("Rugby Union 26/27"); the code is only added when it does not. */}
          {ws.seasonName && /rugby/i.test(ws.seasonName) ? ws.seasonName : [ws.rugbyCode === "league" ? "Rugby League" : "Rugby Union", ws.seasonName].filter(Boolean).join(", ")}
        </p>
      </div>

      <div className="sticky top-0 z-10 mt-4 bg-chalk pb-2">
        <StepBar steps={steps} current={step} label="Competition Creator steps" />
      </div>

      <div className="mt-4">
        {step === "details" && (
          <CompetitionDetailsForm
            key={version}
            mode="edit"
            editionId={editionId}
            codes={[ws.rugbyCode]}
            seasonName={ws.seasonName}
            teamTypes={ws.teamTypes.map((t) => ({ ...t, rugbyCode: ws.rugbyCode }))}
            initial={{ name: ws.name, rugbyCode: ws.rugbyCode, canonicalTeamTypeId: ws.canonicalTeamTypeId, format: ws.format, teamCount: ws.teamCount, organiserName: ws.organiserName }}
          />
        )}
        {step === "participants" && <StepParticipants key={version} ws={ws} />}
        {step === "groups" && <StepGroups key={version} ws={ws} />}
        {step === "fixtures" && <StepFixtures key={version} ws={ws} />}
        {step === "knockout" && <StepKnockout key={version} ws={ws} />}
        {step === "issue" && <StepIssue key={version} ws={ws} />}
      </div>
    </div>
  )
}

function hashOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
