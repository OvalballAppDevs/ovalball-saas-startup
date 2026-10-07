import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { dispensationDate, dispensationMismatchSentence, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

import { DispensationStatusPill } from "./dispensation-status-pill"

/**
 * THE CLUB'S DISPENSATIONS -- one row per record, pending first (the server's order), each opening the
 * record where it is decided and its history read. The same words as the record and the phone.
 */
export function DispensationRegister({ records, emptyText }: { records: DispensationRecord[]; emptyText: string }) {
  if (records.length === 0) {
    return <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink-muted">{emptyText}</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {records.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dispensations/${r.id}`}
            className="group flex min-h-11 items-start gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3 outline-none hover:border-forest-800/40 focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-600/30"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{`${r.player.firstName} ${r.player.surname}`.trim() || "A player"}</span>
                <DispensationStatusPill status={r.status} />
              </span>
              <span className="mt-1 block text-sm text-ink-muted">{dispensationMismatchSentence(r)}</span>
              <span className="mt-1 block text-xs text-ink-muted">
                {r.season.name}
                {r.requestedBy ? `, asked by ${r.requestedBy.name}` : ""}
                {r.requestedAt ? ` on ${dispensationDate(r.requestedAt)}` : ""}
                {r.viewer.decidesAs && r.status === "requested" ? ". Waiting for your decision." : ""}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-muted group-hover:text-forest-800" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
