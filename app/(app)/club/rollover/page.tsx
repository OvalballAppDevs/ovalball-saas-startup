import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { CalendarSync } from "lucide-react"
import { handoverIntroSentence, handoverStateWord, readHandoverBoard, readinessSentence } from "@ovalball/contracts/club/handover"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../settings/club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../settings/resolve-nav-capabilities"
import { HandoverApply } from "./handover-apply"
import { HandoverNeedsAttention } from "./handover-attention"
import { HandoverNav, resolveHandoverSection } from "./handover-nav"
import { HandoverOverview } from "./handover-overview"
import { GraduationQueue } from "./graduation-queue"
import { MiniRugbyNextSeasonReview } from "./mini-rugby-next-season"
import { PlayerHandoverProposals } from "./player-handover-proposals"
import { RolloverReview } from "./rollover-review"

/**
 * The Season Handover board.
 *
 * PREPARE -> DECIDE -> REVIEW -> APPLY. Everything on this page up to the Apply
 * section records decisions; none of it changes a team, a membership or a
 * season identity. apply_season_handover is the single mutation boundary, and
 * it runs server-side in one transaction rather than being sequenced from here.
 *
 * The five sections are routes (?section=...), not tab widgets, so Back,
 * Refresh and a copied link all behave the way a reviewer expects when a
 * handover is worked through over several days by more than one person.
 *
 * THE READ MODEL IS SHARED (CA-M11.1). `readHandoverBoard` builds every read
 * this page used to make -- the register's seasons, the batches, the server's
 * state, readiness, blockers, consequences and audit, the player proposals,
 * the graduation queue and the Mini-Rugby Groups -- once, in the shared
 * package, so the phone's Admin Centre reads exactly the same board.
 */
export default async function ClubRolloverPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)
  // Scoped to the ACTIVE context, not "any CLUB_ADMIN membership this session
  // holds" -- see app/(app)/people/page.tsx for the identical, live-confirmed
  // leak this mirrors. Authorization derives from the canonical capability
  // engine (team.handover.prepare) rather than a raw role comparison. Preparing a
  // handover is the Club Admin's AND the Fixtures Secretary's; applying it is the
  // Club Admin's alone, and apply_season_handover enforces that separately (section U).
  const navCaps = await resolveClubSettingsNavCapabilities(supabase, activeClub)
  const { canRollover: canRunRollover } = navCaps
  if (!canRunRollover || !activeClub) redirect("/dashboard")

  const section = resolveHandoverSection((await searchParams).section)

  const board = await readHandoverBoard(supabase, activeClub)
  if (!board) redirect("/dashboard")

  const { currentSeason, nextSeason, rollover, readiness, blockers, consequences, audit, batches, playerProposals, plannedResolved, graduationQueue, graduationTargets, miniRugbyGroups } = board

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <CalendarSync className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Season Handover</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="text-ink">
          {currentSeason?.name ?? "This season"} <span className="text-ink-muted">&rarr;</span> {nextSeason?.name ?? "next season"}
        </span>
        <span className="rounded-md bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink/70">{handoverStateWord(board.state)}</span>
        {nextSeason?.preSeasonStartsOn && (
          <span className="text-ink-muted">
            Runs from {new Date(nextSeason.preSeasonStartsOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">{handoverIntroSentence(board)}</p>
      {readiness && <p className="mt-1.5 text-sm text-ink-muted">{readinessSentence(readiness)}</p>}

      <ClubSettingsNav active="rollover" {...navCaps} />
      <HandoverNav active={section} attentionCount={blockers.length} />

      <div className="mt-8 space-y-6">
        {section === "overview" && (
          <HandoverOverview
            consequences={consequences}
            counts={{
              teamsTotal: readiness?.teamsTotal ?? 0,
              teamsPending: readiness?.teamsPending ?? 0,
              playersTotal: readiness?.playersTotal ?? 0,
              playersNeedingAttention: (readiness?.playersNeedsAttention ?? 0) + (readiness?.playersBlocked ?? 0),
              dispensationsPending: readiness?.dispensationsPending ?? 0,
              playersClubHolding: readiness?.playersClubHolding ?? 0,
            }}
            toSeasonName={nextSeason?.name ?? null}
            isApplied={readiness?.isApplied ?? false}
          />
        )}

        {section === "teams" && (
          <>
            <RolloverReview clubId={board.club.id} rugbyCode={board.club.rugbyCode} toSeasonOptions={board.upcomingSeasons} batches={batches} currentSeasonName={currentSeason?.name ?? null} />
            <MiniRugbyNextSeasonReview toSeasonId={nextSeason?.id ?? null} toSeasonName={nextSeason?.name ?? null} groups={miniRugbyGroups} />
          </>
        )}

        {section === "players" && (
          <>
            <PlayerHandoverProposals rows={playerProposals} toSeasonName={nextSeason?.name ?? null} />
            <GraduationQueue rows={graduationQueue} targetTeams={graduationTargets} />
          </>
        )}

        {section === "attention" && <HandoverNeedsAttention blockers={blockers} planned={plannedResolved} />}

        {section === "apply" && (
          <HandoverApply
            rolloverId={rollover?.id ?? null}
            toSeasonName={nextSeason?.name ?? null}
            decisionsRevision={rollover?.decisionsRevision ?? 0}
            isApplied={rollover?.appliedAt !== null && rollover?.appliedAt !== undefined}
            appliedAt={rollover?.appliedAt ?? null}
            blockerCount={blockers.length}
            consequences={consequences}
            audit={audit}
            // Applying restructures the club, so the control is offered on the SAME key the server
            // judges (team.handover.apply) rather than the reviewing key -- the server refused the
            // Fixtures Secretary before; the board now says why instead of offering a dead control.
            canApply={board.capabilities.apply}
          />
        )}
      </div>
    </div>
  )
}
