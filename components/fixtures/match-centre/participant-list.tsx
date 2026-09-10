import { Check, CircleDashed, HelpCircle, X } from "lucide-react"

import { ATTENDANCE_GROUPS } from "@/components/shared/attendance-groups"
import type { MatchCentreAttendance, MatchCentreParticipant } from "@/lib/app-context/match-centre-data"

/**
 * WHO'S IN.
 *
 * The squad and the attendance dial used to be two separate things on this
 * page: a row of four count tiles floating above the hero's neighbours, and a
 * grouped list of names much further down. They describe exactly the same
 * data, and being apart meant a coach read "Attending 9" in one place and
 * counted nine chips in another to check it was the same nine.
 *
 * They are now one section: the counts are the section's own summary, each
 * one labelling the group beneath it.
 *
 * WHAT GATES THIS. The whole section -- counts included -- is STAFF-level
 * (can_view_participants). That is deliberately narrower than "can I see my
 * own linked player": Main's RLS on player_fixture_attendance and
 * player_team_memberships already scopes those tables to a guardian's own
 * child, so a roster rendered for a guardian would show two names and a
 * confident "Attending 2" as though that were the whole squad. A confident
 * wrong number is worse than an absent one. A viewer's own response is a
 * separate, always-available path in the matchday card.
 *
 * Grouped by response only. No ranking, no selection, and nobody who has not
 * answered is singled out by name in a way that reads as a reprimand -- the
 * awaiting group is stated plainly and last.
 */

/**
 * One palette for the four answers, used by the tiles, the group headings and
 * the name chips alike, so a colour means the same thing everywhere on the
 * page -- and the same thing it means in the availability control at the top.
 *
 * Colour is never the only carrier. Every tile and every heading also has its
 * own ICON and its own WORD, so the section reads correctly in greyscale, to a
 * colour-blind reader, and to a screen reader.
 */
// THE PALETTE MOVED. These four groups are now components/shared/
// attendance-groups, shared byte-for-byte with Training Centre's register so
// one product cannot end up with two greens for "attending". The values are
// unchanged, so this list renders exactly as it did.
const GROUPS = ATTENDANCE_GROUPS

export function ParticipantList({
  participants,
  counts,
  canView,
}: {
  participants: MatchCentreParticipant[]
  counts: MatchCentreAttendance["counts"]
  canView: boolean
}) {
  if (!canView) return null

  const byGroup = {
    ATTENDING: participants.filter((p) => p.response === "ATTENDING"),
    UNSURE: participants.filter((p) => p.response === "UNSURE"),
    CANNOT_ATTEND: participants.filter((p) => p.response === "CANNOT_ATTEND"),
    AWAITING: participants.filter((p) => p.response === null),
  }
  const countFor = {
    ATTENDING: counts.attending,
    CANNOT_ATTEND: counts.cannotAttend,
    UNSURE: counts.unsure,
    AWAITING: counts.awaitingResponse,
  } as const
  const total = participants.length

  return (
    <section aria-labelledby="mc-participants-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2
        id="mc-participants-heading"
        className="flex items-baseline justify-between gap-3 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
      >
        Who&rsquo;s In
        {total > 0 && (
          <span className="text-xs font-normal normal-case tracking-normal text-ink-subtle">
            {total} {total === 1 ? "player" : "players"}
          </span>
        )}
      </h2>

      {total === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No participants recorded yet.</p>
      ) : (
        <>
          {/* The summary. Each figure is the count of the group below it, so a
              coach never has to reconcile two different renderings of the same
              number. Each carries its own icon and word -- never a colour
              alone. */}
          <dl className="grid grid-cols-4 gap-2 border-b border-ink/8 bg-chalk/60 p-3">
            {GROUPS.map((g) => (
              <CountCell key={g.key} group={g} value={countFor[g.key]} />
            ))}
          </dl>

          <div className="flex flex-col divide-y divide-ink/8">
            {GROUPS.map((g) => (
              <Group key={g.key} group={g} items={byGroup[g.key]} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * One answer, as a tile.
 *
 * NUMBER FIRST, label under it. With the label on top, "Can't attend" wrapped
 * to two lines and pushed its figure a row below the other three, so the four
 * numbers no longer sat on one line and the row stopped being scannable --
 * which is the only thing a row of counts is for.
 *
 * The depth is a gradient plus a hairline ring and a soft shadow, not a heavy
 * bevel: enough to make each tile read as its own object at a glance, quiet
 * enough that the figures stay the loudest thing in the section.
 */
function CountCell({ group, value }: { group: (typeof GROUPS)[number]; value: number }) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-xl bg-gradient-to-b px-1.5 py-3 text-center shadow-sm ring-1 ring-inset ${group.tile}`}
    >
      <span className={`flex size-6 items-center justify-center rounded-full border shadow-sm ${group.badge}`} aria-hidden="true">
        <group.Icon className="size-3.5" strokeWidth={2.5} />
      </span>
      {/* dt before dd in the DOM, because that is what a definition list means
          and what a screen reader reads; the visual order is flipped with
          `order`, so the number sits above its label without the markup
          lying about which is which. */}
      <dt className="order-last text-[10px] leading-tight tracking-wide text-ink-muted uppercase text-balance">{group.label}</dt>
      <dd className={`font-display text-2xl leading-none tabular-nums ${group.figure}`}>{value}</dd>
    </div>
  )
}

function Group({ group, items }: { group: (typeof GROUPS)[number]; items: MatchCentreParticipant[] }) {
  if (items.length === 0) return null
  return (
    <section className="px-5 py-3.5">
      <h3 className={`flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] uppercase ${group.heading}`}>
        <group.Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {group.label} <span className="font-normal text-ink-subtle">({items.length})</span>
      </h3>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {/* The chips carry the group's own colour, so a name is readable as
            "attending" without reading the heading above it. De-emphasis is
            done with a softer GROUND, never with opacity: opacity-60 washed the
            initials chip from forest-800 down to #6e897d -- 3.4:1, a WCAG AA
            failure axe caught on this page. Fading a whole subtree is the easy
            way to say "less important" and the reliable way to make it
            unreadable. */}
        {items.map((p) => (
          <li
            key={p.playerId}
            className={`flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 shadow-sm ${group.chip}`}
          >
            {p.avatarState === "PHOTO_ALLOWED" && p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage-hosted profile avatar.
              <img src={p.avatarUrl} alt="" className="size-8 shrink-0 rounded-full border border-ink/12 object-cover" />
            ) : (
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${group.avatar}`}
              >
                {p.initials}
              </span>
            )}
            <span className="text-sm text-ink">{p.displayName}</span>
            {p.callUp && (
              <span
                title={`On loan from another team for this fixture (${p.callUp.status})`}
                className="rounded-full bg-forest-800/10 px-1.5 py-0.5 text-[10px] font-medium text-forest-800"
              >
                Call-up
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
