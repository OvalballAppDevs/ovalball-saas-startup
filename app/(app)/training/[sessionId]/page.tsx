import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ClipboardList, Settings2 } from "lucide-react"

import { MatchConditions } from "@/components/fixtures/match-centre/match-conditions"
import { TrainingAttendancePanel } from "@/components/training/training-centre/attendance-panel"
import { TrainingCentreHero } from "@/components/training/training-centre/hero"
import { TrainingCommunicationPanel, type AudienceCounts } from "@/components/training/training-centre/communication-panel"
import { WhosTraining, type TrainingRegisterEntry } from "@/components/training/training-centre/whos-training"
import { getTrainingCentreContext, trainingForecastInput } from "@/lib/app-context/training-centre-data"
import { createClient } from "@/lib/supabase/server"
import { getFixtureForecast } from "@/lib/weather/fixture-forecast"

export const dynamic = "force-dynamic"
export const metadata = { title: "Training Centre" }

/**
 * TRAINING CENTRE -- one training session, one page, every role.
 *
 * ONE SHARED SURFACE, exactly as Match Centre is. There is no per-role variant
 * of this component tree and no role branch choosing between trees. Everybody
 * who may open this session sees the same structure in the same order;
 * CAPABILITY decides what their viewer's data and actions put in front of
 * them, and capability is resolved server-side by getTrainingCentreContext,
 * never from a role name in the browser.
 * (scripts/verify-training-centre-shared.mjs enforces this structurally.)
 *
 * ONE CANONICAL RECORD. The route is the training session's own id. Every
 * other surface -- the Agenda, the Calendar, Training Management -- links here
 * with that same id, and nothing on this page is identified by a team, a date,
 * a venue or the recurrence that generated the occurrence.
 *
 * A RECURRENCE IS NOT A SESSION. "Every Tuesday at 18:00" is a training plan;
 * "Tuesday 15 September, 18:00" is a session. This page is always the second
 * one. The plan is named in the hero as context and is never the thing being
 * answered, so a response given here cannot land on next Tuesday.
 *
 * THIS PAGE IS NOT THE SCHEDULER. It reads the canonical session and writes
 * exactly one thing a participant owns: their own availability. Date, time,
 * venue, pitch, agenda and cancellation are edited in Training Management,
 * which owns the record, and a viewer who can edit them is offered the route
 * there rather than a second set of controls here.
 *
 * THE SHAPE, top to bottom:
 *
 *   1. the session card -- whose training, when, and the viewer's own answer,
 *      because the invitation and the reply to it are one object
 *   2. training conditions -- where it is, which pitch, what the weather will
 *      do: the SAME component Match Centre uses, not a copy of it
 *   3. the session plan -- what the coach intends to cover
 *   4. who's training -- the register and its counts, staff-gated, rendering
 *      nothing at all for a viewer without the capability
 */
export default async function TrainingCentrePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const resolution = await getTrainingCentreContext(supabase, sessionId)
  // A session that does not exist and one this viewer may not see are the same
  // 404. Telling them apart would let somebody map the platform's sessions by
  // watching which ids answer differently.
  if (resolution.status === "not_found") notFound()
  const { context } = resolution

  // The SAME weather entry point Match Centre uses -- one Met Office adapter,
  // one cache, one honest unavailable state. Never throws: a provider outage
  // is a state, not an error, and cannot take this page with it.
  const weather = await getFixtureForecast(trainingForecastInput(context.session, context.venue))

  // The register, and only for a viewer the database says may have it. The RPC
  // refuses outright otherwise, so this is not "fetch then hide".
  let register: TrainingRegisterEntry[] = []
  if (context.actions.canViewRegister) {
    const { data } = await supabase.rpc("get_training_register", { p_training_session_id: sessionId })
    register = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      playerId: r.player_id as string,
      firstName: (r.first_name as string) ?? "",
      surname: (r.surname as string) ?? "",
      status: (r.status as TrainingRegisterEntry["status"]) ?? null,
    }))
  }

  // Audience sizes for the composer. The RPC returns NULLs for a caller
  // without training-management authority, so an unauthorised viewer gets no
  // metric at all rather than an authoritative zero -- and the panel below is
  // not rendered for them in any case.
  let audienceCounts: AudienceCounts | null = null
  if (context.actions.canManage) {
    const { data } = await supabase.rpc("training_communication_counts", { p_training_session_id: sessionId }).maybeSingle()
    const c = data as Record<string, number | null> | null
    if (c && c.team_count !== null) {
      audienceCounts = {
        teamPlayers: c.team_count ?? 0,
        attendingPlayers: c.attending_count ?? 0,
        awaitingPlayers: c.awaiting_count ?? 0,
        teamRecipients: c.team_recipients ?? 0,
        attendingRecipients: c.attending_recipients ?? 0,
        awaitingRecipients: c.awaiting_recipients ?? 0,
      }
    }
  }

  return (
    // pb-28 clears the global "Ask Ovie" widget, fixed bottom-right on every
    // page -- the same allowance Match Centre makes, for the same reason.
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/agenda" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Fixtures &amp; Training
        </Link>
        {/* The route back to the record, offered only to somebody who already
            holds the capability to change it -- Training Management enforces
            its own authority on arrival, so this is presentation, but a dead
            end for every other viewer would be worse than no link. */}
        {context.actions.canManage && (
          <Link
            href="/club/training"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/12 px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-ink/[0.03] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          >
            <Settings2 className="size-4" aria-hidden="true" />
            Training Management
          </Link>
        )}
      </div>

      {/* 1. THE SESSION CARD, with the viewer's own answer inside it. */}
      <TrainingCentreHero session={context.session} club={context.club} venueName={context.venue.name}>
        {/* Cancellation is already folded into each entry's canRespond by the
            resolver, so this panel has exactly one authority to consult. */}
        <TrainingAttendancePanel sessionId={context.session.trainingSessionId} entries={context.mine} />
      </TrainingCentreHero>

      {/* 2. WHERE, AND WHAT IT WILL BE LIKE THERE. The same component as
             matchday, with the one word that differs passed in. */}
      <MatchConditions
        venue={context.venue}
        pitch={context.pitch}
        weather={weather}
        heading="Training Conditions"
        headingId="tc-conditions-heading"
        // A session has no kick-off. Same forecast, same panel, the one word
        // that is a match concept replaced.
        momentLabel="At the Start"
      />

      {/* 3. WHAT THE SESSION IS. Canonical: the agenda is a real column on the
             session with a club-set default, and further notes are whatever
             the coach added for this one occurrence. Never invented, and the
             notes line is simply absent when there are none. */}
      {(context.session.agenda || context.session.furtherNotes) && (
        <section aria-labelledby="tc-plan-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
          <h2
            id="tc-plan-heading"
            className="flex items-center gap-2 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
          >
            <ClipboardList className="size-3.5" aria-hidden="true" />
            Session Plan
          </h2>
          <div className="px-5 py-4">
            {context.session.agenda && <p className="text-sm leading-relaxed text-ink-muted">{context.session.agenda}</p>}
            {context.session.furtherNotes && (
              <p className="mt-3 border-t border-ink/8 pt-3 text-sm leading-relaxed text-ink">{context.session.furtherNotes}</p>
            )}
          </div>
        </section>
      )}

      {/* 4. THE SQUAD. Renders nothing without the capability. */}
      <WhosTraining entries={register} canView={context.actions.canViewRegister} />

      {/* 5. TELLING THEM SOMETHING. The natural end of the page for staff: you
             have just read who is coming and who has not answered, and this is
             where you act on it. Absent entirely for anybody without training
             authority -- a parent is not shown a composer they cannot use. */}
      {audienceCounts && <TrainingCommunicationPanel sessionId={context.session.trainingSessionId} counts={audienceCounts} />}
    </div>
  )
}
