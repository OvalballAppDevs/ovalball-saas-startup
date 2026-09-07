import { KitPlaceholder, RugbyKit } from "@/components/club/rugby-kit"
import type { MatchCentreFixture, MatchCentreSide } from "@/lib/app-context/match-centre-data"

const STATUS_STYLE: Record<MatchCentreFixture["status"], { label: string; className: string; icon: string | null }> = {
  PLANNED: { label: "Planned", className: "bg-white/10 text-white/70", icon: null },
  AWAITING_OPPOSITION: { label: "Awaiting opposition", className: "bg-amber-400/20 text-amber-200", icon: "?" },
  ACCEPTED: { label: "Confirmed", className: "bg-pitch-500/20 text-pitch-200", icon: "✓" },
  AMENDMENT_PENDING: { label: "Amendment pending", className: "bg-amber-400/20 text-amber-200", icon: "?" },
  CANCELLED: { label: "Cancelled", className: "bg-red-500/20 text-red-200", icon: "✕" },
  COMPLETED: { label: "Completed", className: "bg-white/10 text-white/70", icon: null },
}

function formatKickoff(fixture: MatchCentreFixture): string {
  const date = new Date(`${fixture.kickoffDate}T00:00:00`)
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)
  if (!fixture.kickoffTime) return dateLabel
  const [h, m] = fixture.kickoffTime.split(":")
  const hour = Number(h)
  const period = hour >= 12 ? "pm" : "am"
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const time = m === "00" ? `${hour12}${period}` : `${hour12}:${m}${period}`
  return `${dateLabel} · Kick-off ${time}`
}

export function MatchCentreHero({ fixture, homeSide, awaySide }: { fixture: MatchCentreFixture; homeSide: MatchCentreSide; awaySide: MatchCentreSide }) {
  const status = STATUS_STYLE[fixture.status]
  return (
    <div className="overflow-hidden rounded-2xl border border-ink/8 bg-forest-950 text-chalk">
      <div className="px-4 pt-5 pb-3 text-center sm:px-8">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase ${status.className}`}>
          {status.icon && <span aria-hidden="true">{status.icon}</span>}
          {status.label}
        </span>
        <p className="mt-2 text-sm text-white/70">{formatKickoff(fixture)}</p>
        {fixture.competitionIdentity && <p className="mt-0.5 text-xs text-white/45">{fixture.competitionIdentity}</p>}
        {fixture.status === "CANCELLED" && fixture.cancellationReason && <p className="mt-1 text-xs text-red-200">{fixture.cancellationReason}</p>}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-6 sm:gap-4 sm:px-8">
        <SideColumn side={homeSide} align="right" />
        <span className="px-1 text-center font-display text-lg text-white/50 sm:text-xl">VS</span>
        <SideColumn side={awaySide} align="left" />
      </div>
    </div>
  )
}

function SideColumn({ side, align }: { side: MatchCentreSide; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 text-center ${align === "right" ? "sm:items-end sm:text-right" : "sm:items-start sm:text-left"}`}>
      <div className="flex items-center gap-2">
        {side.clubLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo, not a Next/Image-managed remote source.
          <img src={side.clubLogoUrl} alt="" className="size-9 shrink-0 rounded-md bg-white/10 object-contain p-1 sm:size-11" />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10 text-[10px] font-semibold text-white/50 sm:size-11">
            {side.clubDisplayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        {side.kit ? (
          <RugbyKit kit={side.kit} clubName={side.clubDisplayName} variant="primary" className="size-9 text-white sm:size-11" />
        ) : (
          <KitPlaceholder className="size-9 text-white/40 sm:size-11" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-base leading-tight text-chalk sm:text-lg">{side.clubDisplayName}</p>
        {side.fixtureSeasonTeamIdentity && <p className="truncate text-xs text-white/55 sm:text-sm">{side.fixtureSeasonTeamIdentity}</p>}
        {!side.claimed && <p className="mt-0.5 text-[10px] tracking-wide text-white/35 uppercase">{side.clubDirectoryId ? "Not yet on Ovalball" : "To be confirmed"}</p>}
      </div>
    </div>
  )
}
