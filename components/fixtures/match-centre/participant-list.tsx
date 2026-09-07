import type { MatchCentreParticipant } from "@/lib/app-context/match-centre-data"

/** Grouped by response only -- no ranking, no "who hasn't responded" singled out by name. Youth-safe by construction. */
export function ParticipantList({ participants, canView }: { participants: MatchCentreParticipant[]; canView: boolean }) {
  if (!canView) return <p className="text-sm text-ink/50">Participant list is not available in this view.</p>
  if (participants.length === 0) return <p className="text-sm text-ink/50">No participants recorded yet.</p>

  const attending = participants.filter((p) => p.response === "ATTENDING")
  const unsure = participants.filter((p) => p.response === "UNSURE")
  const cannotAttend = participants.filter((p) => p.response === "CANNOT_ATTEND")
  const awaiting = participants.filter((p) => p.response === null)

  return (
    <div className="flex flex-col gap-4">
      <Group label="Attending" items={attending} />
      <Group label="Unsure" items={unsure} />
      <Group label="Can't attend" items={cannotAttend} />
      {awaiting.length > 0 && <Group label="Awaiting response" items={awaiting} muted />}
    </div>
  )
}

function Group({ label, items, muted = false }: { label: string; items: MatchCentreParticipant[]; muted?: boolean }) {
  if (items.length === 0) return null
  return (
    <section>
      <h3 className="text-xs font-medium tracking-[0.06em] text-ink/50 uppercase">
        {label} <span className="text-ink/35">({items.length})</span>
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2.5">
        {items.map((p) => (
          <li key={p.playerId} className={`flex items-center gap-2 rounded-full border border-ink/10 bg-white py-1 pr-3 pl-1 ${muted ? "opacity-60" : ""}`}>
            {p.avatarState === "PHOTO_ALLOWED" && p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage-hosted profile avatar.
              <img src={p.avatarUrl} alt={p.displayName} className="size-8 shrink-0 rounded-full border border-ink/12 object-cover" />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-forest-800/15 bg-forest-800/8 text-[10px] font-semibold text-forest-800">
                {p.initials}
              </span>
            )}
            <span className="text-sm text-ink">{p.displayName}</span>
            {p.callUp && (
              <span title={`On loan from another team for this fixture (${p.callUp.status})`} className="rounded-full bg-forest-800/10 px-1.5 py-0.5 text-[10px] font-medium text-forest-800">
                Call-up
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
