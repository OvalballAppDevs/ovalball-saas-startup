import { redirect } from "next/navigation"

import {
  dispensationDate,
  dispensationHistory,
  dispensationMismatchSentence,
  dispensationStateSentence,
  dispensationTitle,
  readDispensationRecord,
  type DispensationRecord,
} from "@ovalball/contracts/team/dispensation"

import { AgeGradeBridge } from "@/components/dispensations/age-grade-bridge"
import { DispensationControls } from "@/components/dispensations/dispensation-controls"
import { DispensationStatusPill } from "@/components/dispensations/dispensation-status-pill"
import { PageIdentity } from "@/components/shell/page-identity"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dispensation" }

/**
 * ONE DISPENSATION -- the immutable record every notification about it opens (20270742000000), for every
 * person the server lets read it: the club's Safeguarding Officer and Club Admins (who decide it here), the
 * person who asked, the child's family, and the team's staff (who see the decision, never the child's date
 * of birth or the family's reasons). `dispensation_record` answers nothing for anybody else, and "not found"
 * and "not yours" read the same.
 */
export default async function DispensationPage({ params }: { params: Promise<{ dispensationId: string }> }) {
  const { dispensationId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const record = await readDispensationRecord(supabase as unknown as Parameters<typeof readDispensationRecord>[0], dispensationId).catch(() => null)
  if (!record) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
        <PageIdentity workspace={workspaceLabel("club")} title="Dispensation" />
        <p className="mt-6 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink-muted">
          This dispensation isn&apos;t available to you. If you were sent a link, ask the club.
        </p>
      </div>
    )
  }

  const family = record.viewer.isFamily && !record.viewer.decidesAs
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <PageIdentity workspace={workspaceLabel(family ? "parent" : "club")} title={dispensationTitle(record)} />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <DispensationStatusPill status={record.status} />
        <p className="text-sm text-ink-muted">
          {record.team.label}, {record.season.name}
          {record.club.name ? ` at ${record.club.name}` : ""}
        </p>
      </div>

      <section aria-labelledby="dispensation-why" className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
        <h2 id="dispensation-why" className="sr-only">
          Why a Dispensation Is Needed
        </h2>
        <AgeGradeBridge record={record} className="mb-4" />
        <p className="text-base text-ink">{dispensationMismatchSentence(record)}</p>
        <p className="mt-1 text-sm text-ink-muted">The normal way onto {record.team.label} is closed to them. A dispensation is an exception the club has to approve.</p>
      </section>

      <StateBand record={record} />

      <section aria-labelledby="dispensation-request" className="mt-6">
        <h2 id="dispensation-request" className="text-base font-semibold text-ink">
          The Request
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-muted">Asked By</dt>
          <dd className="text-ink">
            {record.requestedBy?.name ?? "Someone at the club"}
            {record.requestedAt ? `, ${dispensationDate(record.requestedAt)}` : ""}
          </dd>
          {record.reason && (
            <>
              <dt className="text-ink-muted">Reason</dt>
              <dd className="whitespace-pre-line text-ink">{record.reason}</dd>
            </>
          )}
          {record.player.dateOfBirth && (
            <>
              <dt className="text-ink-muted">Date of Birth</dt>
              <dd className="text-ink">{dispensationDate(`${record.player.dateOfBirth}T12:00:00Z`)}</dd>
            </>
          )}
          {record.sourceTeam && (
            <>
              <dt className="text-ink-muted">Currently On</dt>
              <dd className="text-ink">{record.sourceTeam.label}</dd>
            </>
          )}
          {record.governingBodyReference && (
            <>
              <dt className="text-ink-muted">Governing Body&apos;s Reference</dt>
              <dd className="text-ink">{record.governingBodyReference}</dd>
            </>
          )}
        </dl>
      </section>

      <DispensationControls record={record} />

      <section aria-labelledby="dispensation-history" className="mt-8">
        <h2 id="dispensation-history" className="text-base font-semibold text-ink">
          History
        </h2>
        <ol className="mt-3 flex flex-col gap-4 border-l-2 border-ink/10 pl-5">
          {dispensationHistory(record).map((event, i) => (
            <li key={`${event.kind}-${i}`} className="relative">
              <span aria-hidden="true" className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full bg-forest-800" />
              <p className="text-sm font-semibold text-ink">{event.title}</p>
              <p className="text-sm text-ink-muted">
                {[event.who, dispensationDate(event.at)].filter(Boolean).join(", ") || " "}
              </p>
              {event.detail && <p className="mt-1 text-sm text-ink">{event.detail}</p>}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-ink-muted">This record can&apos;t be edited or deleted. A different team or season needs a new request.</p>
      </section>
    </div>
  )
}

/** WHERE IT STANDS -- amber while it waits (asking is not approval), green once approved, quiet otherwise. */
function StateBand({ record }: { record: DispensationRecord }) {
  const tone =
    record.status === "requested"
      ? "border-amber-500/40 bg-amber-50 text-amber-950"
      : record.status === "approved"
        ? "border-mint-300 bg-mint-100/60 text-forest-950"
        : "border-ink/10 bg-ink/[0.03] text-ink"
  return (
    <p role="status" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      {dispensationStateSentence(record)}
    </p>
  )
}
