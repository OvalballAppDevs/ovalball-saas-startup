export interface HistoryEntry {
  at: string
  entry: string
  detail: string | null
  where: string | null
  actorName: string | null
}

/**
 * SLICE 7e -- tabs 11, 12 and 13.
 *
 * `site_membership_history`, `site_team_history` and `site_family_history` were
 * built in 7b and the reconciliation's verdict on them was that they "answer a
 * question no screen asks". They are read-only provenance from security_events,
 * and the question they answer is the one that actually gets asked in support:
 * not "what can this person do" but "how did they come to have it, and who
 * decided".
 *
 * They are three tabs rather than one merged feed because they are three
 * different subjects. A merged timeline reads well and is useless the moment
 * somebody is looking for one specific decision, which is the only moment anyone
 * opens it.
 *
 * Nothing here is editable and nothing here can be deleted: public.audit_log and
 * public.security_events are append-only by construction
 * (internal.refuse_history_rewrite), so this screen cannot rewrite what it shows
 * even if it tried.
 */
export function HistoryPanel({
  title,
  explanation,
  entries,
  emptyLine,
}: {
  title: string
  explanation: string
  entries: HistoryEntry[]
  emptyLine: string
}) {
  return (
    <section>
      <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{explanation}</p>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
          {emptyLine}
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink">{humanise(entry.entry)}</p>
                <p className="text-xs text-ink-muted">{formatDateTime(entry.at)}</p>
              </div>
              {entry.where && <p className="mt-0.5 text-sm text-ink-muted">{entry.where}</p>}
              {entry.detail && <p className="mt-1 text-sm text-ink/70">{entry.detail}</p>}
              <p className="mt-1 text-xs text-ink-muted">{entry.actorName ? `Decided by ${entry.actorName}` : "Decided by the system"}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Event types are stable identifiers (`site.club_membership_added`), not copy.
 * They are shown as a readable phrase rather than renamed in the database, for
 * the same reason a historical team name is not re-spelled because presentation
 * improved: the identifier is what everything else matches on.
 */
function humanise(eventType: string): string {
  const withoutPrefix = eventType.replace(/^(site|membership|role|guardian|club|family)\./, "")
  const words = withoutPrefix.replace(/[._]/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
