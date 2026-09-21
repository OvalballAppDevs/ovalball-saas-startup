import Link from "next/link"

import { AttendanceAnswer } from "@/components/fixtures/agenda/attendance-answer"
import { isAnswerable } from "@/components/fixtures/agenda/answerable"
import { fixtureSides } from "@/lib/fixtures/presentation"
import type { AgendaItem } from "@/lib/agenda/load"

/**
 * WHAT'S NEXT, AND WHAT JUST HAPPENED.
 *
 * The two questions a team page exists to answer, and until Step 10 it answered
 * neither: the page was a settings form, a roster editor and a join code. Step 0
 * recorded the team page as administrative and unreachable, and this is the
 * administrative half being given something to sit underneath.
 *
 * IT CONSUMES, IT DOES NOT DEFINE. Every row here comes from the canonical
 * agenda reader that the Calendar and the family agenda already use, presented
 * with Step 7's canonical fixture rules -- the home side is named first, the
 * match type comes from the one taxonomy, training has no opposition and is
 * never given a fake one. There is no team-fixture truth #2 and no team-specific
 * result model.
 *
 * THE ANSWER CONTROL IS STEP 9'S, VERBATIM. Same component, same server entry
 * point, same canonical record, same authority. A coach seeing this page does
 * not get the control for somebody else's child: `answerable` lists only the
 * players this viewer is entitled to be asked about, and the server refuses the
 * rest regardless.
 */
export function TeamWhatsNext({
  upcoming,
  recent,
  todayIso,
  answerable,
  returnTo,
}: {
  upcoming: AgendaItem[]
  recent: AgendaItem[]
  todayIso: string
  /** Player ids this viewer may legitimately be asked to answer for. */
  answerable: string[]
  /** Where Match Centre should send them back to -- this team, not the agenda. */
  returnTo: string
}) {
  return (
    <>
      <section className="mt-8" aria-labelledby="team-whats-next">
        <h2 id="team-whats-next" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          What&rsquo;s Next
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 px-4 py-3.5 text-sm text-ink-muted">
            Nothing scheduled yet. Fixtures and training will appear here as the club arranges them.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {upcoming.map((item) => (
              <li key={item.key} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                <TeamActivityLine item={item} returnTo={returnTo} />
                {item.playerId && answerable.includes(item.playerId) && isAnswerable(item, todayIso) && (
                  <AttendanceAnswer
                    kind={item.kind}
                    eventId={item.eventId}
                    playerId={item.playerId}
                    current={item.attendance}
                    subject={item.childFirstName ?? "you"}
                    what={activityName(item)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="mt-8" aria-labelledby="team-recent">
          <h2 id="team-recent" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Recent Results
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {recent.map((item) => (
              <li key={item.key} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                <TeamActivityLine item={item} returnTo={returnTo} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Training is not a fixture with fields removed, so it is not described as one. */
function activityName(item: AgendaItem): string {
  if (item.kind === "training") return `training on ${item.date}`
  return `${item.them?.clubName ?? "the opposition"} on ${item.date}`
}

function TeamActivityLine({ item, returnTo }: { item: AgendaItem; returnTo: string }) {
  const when = [item.date, item.time].filter(Boolean).join(" · ")

  if (item.kind === "training") {
    return (
      <div>
        <p className="text-sm font-medium text-ink">Training</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {[when, item.venue, item.pitch].filter(Boolean).join(" · ")}
        </p>
      </div>
    )
  }

  // Step 7's rule: the home side is named first, always, from one place.
  const sides = fixtureSides({
    homeAway: item.homeAway === "Home" || item.homeAway === "Away" ? item.homeAway : null,
    ownLabel: item.us.teamName ?? item.us.clubName,
    oppositionLabel: item.them?.clubName ?? null,
  })

  const line = (
    <div>
      <p className="text-sm font-medium text-ink">{sides.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {/* Only what the agenda actually carries. The match type is not on an
            agenda row, and promising a field the data model does not have is
            how a team page starts lying quietly. */}
        {[when, item.status, item.venue, item.pitch].filter(Boolean).join(" · ")}
      </p>
      {item.result && (
        <p className="mt-0.5 text-xs font-medium text-ink">
          {item.result.ourScore} &ndash; {item.result.theirScore}
        </p>
      )}
    </div>
  )

  // Match Centre is Step 7's canonical fixture, reached with a return path back
  // to THIS team rather than to whichever list the person came through.
  return item.href ? (
    <Link
      href={`${item.href}${item.href.includes("?") ? "&" : "?"}from=${encodeURIComponent(returnTo)}`}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
    >
      {line}
    </Link>
  ) : (
    line
  )
}
