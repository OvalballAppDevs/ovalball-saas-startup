import { ATTENDANCE_GROUPS, initialsFor, type AttendanceGroupKey } from "@/components/shared/attendance-groups"
import type { TrainingAttendanceStatus } from "@/lib/app-context/training-centre-data"
import { cn } from "@/lib/utils"

/**
 * WHO'S TRAINING -- the squad, grouped by what each person actually said.
 *
 * THE PRIVACY RULE IS NOT IN THIS FILE. Nothing here decides who may be seen:
 * the rows arrive already filtered by public.get_training_register, which
 * refuses outright unless the caller holds team.attendance.view or can manage
 * the training. A viewer without that capability is handed no rows and this
 * section renders NOTHING AT ALL -- not a locked panel, not a "not available
 * in your view" placeholder. A parent is not missing a feature; they are
 * simply not staff, and saying so on every session is noise.
 *
 * WHAT CHANGED, AND WHY. This was a flat list of every player in RPC order
 * with an 11px word on the right, and the design review was blunt about the
 * cost: a coach arriving at "Awaiting 9" had to read all 22 rows to find WHICH
 * nine. Now the counts answer "how many", and each group answers "who" --
 * which is the question a coach opened the page to ask.
 *
 * PROGRESSIVE DISCLOSURE, WITH A REASON FOR THE DEFAULT. Groups are native
 * <details>, so they are keyboard-operable, carry their own expanded state to
 * a screen reader, and need no JavaScript at all -- this stays a server
 * component. AWAITING opens by default because it is the only group with
 * something to do about it; the settled answers stay folded until asked for.
 *
 * INITIALS, NEVER PHOTOS. A player's photo lives in a private bucket and a
 * register is not a gallery of other people's children. The initials disc is
 * the same treatment Match Centre's participant list uses.
 *
 * SLIMMER THAN MATCHDAY ON PURPOSE: no call-up markers, no positions, no squad
 * selection. A training register answers how many are coming and who has not
 * said.
 */

export interface TrainingRegisterEntry {
  playerId: string
  firstName: string
  surname: string
  status: TrainingAttendanceStatus | null
}

export function WhosTraining({ entries, canView }: { entries: TrainingRegisterEntry[]; canView: boolean }) {
  if (!canView) return null

  const byGroup: Record<AttendanceGroupKey, TrainingRegisterEntry[]> = {
    ATTENDING: entries.filter((e) => e.status === "ATTENDING"),
    UNSURE: entries.filter((e) => e.status === "UNSURE"),
    CANNOT_ATTEND: entries.filter((e) => e.status === "CANNOT_ATTEND"),
    AWAITING: entries.filter((e) => e.status === null),
  }
  const answered = entries.length - byGroup.AWAITING.length

  return (
    <section aria-labelledby="tc-register-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/8 bg-chalk px-5 py-3">
        <h2 id="tc-register-heading" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          Who&rsquo;s Training
        </h2>
        {entries.length > 0 && (
          <p className="text-xs text-ink-muted">
            {answered} of {entries.length} responded
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        // A real product state, not an error: a session whose team has no
        // players yet is a club mid-setup, and it should read like one.
        <p className="px-5 py-8 text-center text-sm text-ink-muted">
          No players are on this team yet, so there is nobody to expect at training.
        </p>
      ) : (
        <>
          {/* THE COUNTS, first and largest -- "how many can I plan for" is the
              question a coach has before any name matters. */}
          <dl className="grid grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-4 sm:px-5">
            {ATTENDANCE_GROUPS.map((g) => (
              <div
                key={g.key}
                className={cn("flex flex-col items-center gap-1 rounded-xl bg-gradient-to-b px-2 py-3 text-center ring-1 ring-inset", g.tile)}
              >
                <dt className={cn("flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase", g.heading)}>
                  <g.Icon className="size-3.5 shrink-0" aria-hidden="true" strokeWidth={2.5} />
                  {g.label}
                </dt>
                <dd className={cn("font-display text-2xl leading-none tabular-nums", g.figure)}>{byGroup[g.key].length}</dd>
              </div>
            ))}
          </dl>

          <div className="divide-y divide-ink/8 border-t border-ink/8">
            {ATTENDANCE_GROUPS.map((g) => {
              const people = byGroup[g.key]
              if (people.length === 0) return null
              return (
                <details key={g.key} open={g.key === "AWAITING"} className="group">
                  {/* 44px minimum, and the whole row is the control -- a
                      coach opening this one-handed should not have to find a
                      chevron. */}
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-5 py-2.5 outline-none hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden="true"
                      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", g.badge)}
                    >
                      <g.Icon className="size-3.5" strokeWidth={2.5} />
                    </span>
                    <span className={cn("text-sm font-semibold", g.heading)}>{g.label}</span>
                    <span className="text-sm text-ink-muted tabular-nums">{people.length}</span>
                    <span aria-hidden="true" className="ml-auto text-xs text-ink-subtle transition-transform group-open:rotate-90">
                      &rsaquo;
                    </span>
                  </summary>
                  <ul className="flex flex-wrap gap-1.5 px-5 pt-1 pb-4">
                    {people.map((p) => (
                      <li
                        key={p.playerId}
                        className={cn("flex min-w-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm text-ink", g.chip)}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold", g.avatar)}
                        >
                          {initialsFor(p.firstName, p.surname)}
                        </span>
                        {/* Wraps rather than truncating: a long surname on a
                            register is somebody's actual name. */}
                        <span className="min-w-0">
                          {p.firstName} {p.surname}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
