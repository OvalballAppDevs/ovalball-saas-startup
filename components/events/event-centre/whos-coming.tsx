import { ATTENDANCE_GROUPS, initialsFor, type AttendanceGroupKey } from "@/components/shared/attendance-groups"
import type { EventRegisterEntry } from "@/lib/app-context/event-centre-data"
import { cn } from "@/lib/utils"

/**
 * WHO'S COMING -- the same register Training Centre uses, for an event.
 *
 * SAME COMPONENT LANGUAGE, DELIBERATELY. The counts, the four groups, the
 * palette, the icons, the initials discs and the folded <details> all come
 * from components/shared/attendance-groups, exactly as Who's Training does. A
 * visually unrelated event register would have been a third way of saying the
 * same four things.
 *
 * THE PRIVACY RULE IS NOT IN THIS FILE. Nothing here decides who may be seen:
 * the rows arrive already filtered by public.get_club_event_register, which
 * returns only the teams the caller holds team.attendance.view on. On a
 * multi-team event, team-scoped staff are handed their own team's players and
 * nothing else -- so the leak cannot be reintroduced by a rendering mistake,
 * because the other team's names were never in the payload.
 *
 * WHAT AN EVENT ADDS: TEAMS. A presentation evening can involve several sides
 * at once, so where more than one team is visible the register groups by team
 * first and by answer within it -- "how many of MY under-12s have replied" is
 * the question a team manager actually has. With a single team visible the
 * team heading would be noise, so it is not drawn.
 */
export function WhosComing({ entries, canView }: { entries: EventRegisterEntry[]; canView: boolean }) {
  if (!canView) return null

  const teams = new Map<string, { teamId: string; teamName: string; people: EventRegisterEntry[] }>()
  for (const e of entries) {
    const existing = teams.get(e.teamId)
    if (existing) existing.people.push(e)
    else teams.set(e.teamId, { teamId: e.teamId, teamName: e.teamDisplayName, people: [e] })
  }
  const teamList = [...teams.values()]
  const answered = entries.filter((e) => e.status !== null).length

  return (
    <section aria-labelledby="ec-register-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/8 bg-chalk px-5 py-3">
        <h2 id="ec-register-heading" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          Who&rsquo;s Coming
        </h2>
        {entries.length > 0 && (
          <p className="text-xs text-ink-muted">
            {answered} of {entries.length} responded
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">
          No players are on the teams involved in this event yet, so there is nobody to expect.
        </p>
      ) : (
        <div className="divide-y divide-ink/8">
          {teamList.map((team) => (
            <div key={team.teamId}>
              {teamList.length > 1 && (
                <p className="bg-chalk/60 px-5 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-subtle uppercase">{team.teamName}</p>
              )}
              <RegisterGroups people={team.people} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function RegisterGroups({ people }: { people: EventRegisterEntry[] }) {
  const byGroup: Record<AttendanceGroupKey, EventRegisterEntry[]> = {
    ATTENDING: people.filter((e) => e.status === "ATTENDING"),
    UNSURE: people.filter((e) => e.status === "UNSURE"),
    CANNOT_ATTEND: people.filter((e) => e.status === "CANNOT_ATTEND"),
    AWAITING: people.filter((e) => e.status === null),
  }

  return (
    <>
      {/* The counts, first and largest -- "how many can I cater for" is the
          question before any name matters. */}
      <dl className="grid grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-4 sm:px-5">
        {ATTENDANCE_GROUPS.map((g) => (
          <div key={g.key} className={cn("flex flex-col items-center gap-1 rounded-xl bg-gradient-to-b px-2 py-3 text-center ring-1 ring-inset", g.tile)}>
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
          const group = byGroup[g.key]
          if (group.length === 0) return null
          return (
            <details key={g.key} open={g.key === "AWAITING"} className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-5 py-2.5 outline-none hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", g.badge)}>
                  <g.Icon className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className={cn("text-sm font-semibold", g.heading)}>{g.label}</span>
                <span className="text-sm text-ink-muted tabular-nums">{group.length}</span>
                <span aria-hidden="true" className="ml-auto text-xs text-ink-subtle transition-transform group-open:rotate-90">
                  &rsaquo;
                </span>
              </summary>
              <ul className="flex flex-wrap gap-1.5 px-5 pt-1 pb-4">
                {group.map((p) => {
                  const [first, ...rest] = p.playerName.split(" ")
                  return (
                    <li key={p.playerId} className={cn("flex min-w-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm text-ink", g.chip)}>
                      <span
                        aria-hidden="true"
                        className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold", g.avatar)}
                      >
                        {initialsFor(first ?? "", rest.join(" "))}
                      </span>
                      <span className="min-w-0">{p.playerName}</span>
                    </li>
                  )
                })}
              </ul>
            </details>
          )
        })}
      </div>
    </>
  )
}
