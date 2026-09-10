import Link from "next/link"
import { ChevronRight, ClipboardCheck, Clock, Dumbbell, MapPin, Users } from "lucide-react"

import { RugbyKit } from "@/components/club/rugby-kit"
import type { AgendaItem, AgendaSide } from "@/lib/agenda/load"
import { cn } from "@/lib/utils"

/**
 * ONE FIXTURE, AT AGENDA DENSITY.
 *
 * The permanent rule this implements:
 *
 *   A fixture must look unmistakably like the same fixture everywhere in
 *   Ovalball. Match Centre is the richest expression; Dashboard, Fixtures and
 *   Calendar inherit its identity language at the appropriate density.
 *
 * So the same facts appear, in the same order, drawn from the same canonical
 * sources -- crest, kit, opposition, home/away, time, venue, status -- but a
 * list of twenty of these is a different job from one hero. The crest and kit
 * shrink to a paired mark; the VS becomes a small divider rather than the
 * centrepiece; the date moves out to the spine on the left where it can be
 * scanned down a column.
 *
 * WHAT IS DELIBERATELY NOT COPIED FROM THE MATCH CENTRE: the mown-stripe
 * ground, the large kit, the attendance control, the weather, the venue map.
 * Twenty dark heroes down a page is unreadable, and a card that answers
 * everything removes the reason to open the fixture at all. This card answers
 * "what, when, who, where, home or away" and hands off.
 *
 * HOME/AWAY IS CANONICAL. It comes from the fixture's own semantics, already
 * flipped to the viewer's side by the loader, and never from venue text.
 */

const STATUS_TONE: Record<string, { label: string; className: string }> = {
  Cancelled: { label: "Cancelled", className: "border-destructive/30 bg-destructive/10 text-destructive-text" },
  Completed: { label: "Result", className: "border-ink/12 bg-ink/5 text-ink-muted" },
  "To Be Determined": { label: "Awaiting opposition", className: "border-amber-400/40 bg-amber-50 text-amber-900" },
}

/**
 * The paired club mark: crest and kit, the same two marks the Match Centre
 * hero shows side by side, here at chip size. A club with neither still gets
 * a deliberate initials mark rather than an empty gap.
 */
function SideMark({ side, className }: { side: AgendaSide; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {side.crestUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo.
        <img src={side.crestUrl} alt="" className="size-8 shrink-0 rounded-md bg-white object-contain ring-1 ring-ink/8" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink/5 text-[10px] font-semibold text-ink-muted ring-1 ring-ink/8"
        >
          {side.clubName.slice(0, 2).toUpperCase()}
        </span>
      )}
      {side.kit && <RugbyKit kit={side.kit} clubName={side.clubName} variant="primary" className="size-8 shrink-0 text-ink/70" />}
    </span>
  )
}

/**
 * "YOU HAVEN'T ANSWERED THIS ONE."
 *
 * Part of the card, not a pill floating beneath it. The card gains an amber
 * left rail and an amber edge, and the words go in the chip row the card
 * already has -- beside HOME/AWAY, where a reader is already looking for the
 * facts that decide their Saturday.
 *
 * Three signals again, none of them hue alone: the RAIL (a structural change),
 * the WORDS ("Response Needed"), and the sentence a screen reader hears.
 */
/*
  OPAQUE, deliberately. A translucent amber wash looks identical to white on
  the chalk page and turns the card into a dark pane on the promoted card's
  forest ground -- where this exact style put near-black type on near-black,
  caught in UAT. The fill is a real colour so the card reads the same on both
  grounds, and the hover is stated here so the base `hover:bg-chalk` cannot
  drop it back to grey mid-press.
*/
const ATTENTION_CARD =
  "border-amber-500/45 bg-amber-50 hover:bg-amber-100 hover:border-amber-500/60 shadow-[inset_3px_0_0_0_theme(colors.amber.500)]"

function AttentionChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
      <ClipboardCheck className="size-3" aria-hidden="true" />
      Response Needed
    </span>
  )
}

export function FixtureCard({ item, showChild, attention = false }: { item: AgendaItem; showChild: boolean; attention?: boolean }) {
  const cancelled = item.status === "Cancelled"
  const tone = item.status ? STATUS_TONE[item.status] : null
  const opposition = item.them?.clubName ?? "Opposition to be confirmed"

  const body = (
    <div className={cn("flex items-start gap-3", cancelled && "opacity-70")}>
      <div className="min-w-0 flex-1">
        {showChild && item.childFirstName && (
          <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-forest-800/8 py-0.5 pr-2.5 pl-0.5 text-xs font-semibold text-forest-900">
            <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-forest-800 text-[9px] font-bold text-chalk">
              {item.childFirstName.slice(0, 1).toUpperCase()}
            </span>
            {item.childFirstName}
          </p>
        )}

        <div className="flex items-center gap-2.5">
          <SideMark side={item.us} />
          <span aria-hidden="true" className="font-display text-[11px] tracking-[0.12em] text-ink-subtle">
            V
          </span>
          {item.them && <SideMark side={item.them} />}
        </div>

        <p className="mt-2 font-display text-base leading-tight text-ink">
          {item.us.teamName ?? item.us.clubName}
          <span className="text-ink-subtle"> v </span>
          {opposition}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          {item.time && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {item.time}
            </span>
          )}
          {item.meetTime && (
            <span className="inline-flex items-center gap-1 font-medium text-forest-800">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              Meet {item.meetTime}
            </span>
          )}
          {item.venue && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.venue}</span>
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {attention && <AttentionChip />}
          {/* Home/away in WORDS as well as position -- a parent needs to know
              whether to travel, and that must survive greyscale. */}
          {(item.homeAway === "Home" || item.homeAway === "Away") && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset",
                item.homeAway === "Home" ? "bg-forest-800/10 text-forest-900 ring-forest-800/20" : "bg-ink/5 text-ink-muted ring-ink/12"
              )}
            >
              {item.homeAway}
            </span>
          )}
          {/* The status chip is suppressed once a result is showing: "Result
              24-17" says the same thing twice, and the score already tells a
              reader the match has been played. */}
          {tone && !item.result && <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", tone.className)}>{tone.label}</span>}
        </div>
      </div>

      {/* THE SCORE GETS ITS OWN RAIL on a played match. In the chip row it was
          13px, beside HOME, under a 16px team name -- the quietest thing on
          the card, on the one view that exists to show it. */}
      {item.result ? (
        <div className="flex shrink-0 flex-col items-end gap-0.5 pl-1">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
              item.result.ourScore > item.result.theirScore
                ? "bg-pitch-400/25 text-forest-900"
                : item.result.ourScore < item.result.theirScore
                  ? "bg-ink/8 text-ink-muted"
                  : "bg-amber-400/25 text-amber-900"
            )}
          >
            {item.result.ourScore > item.result.theirScore ? "W" : item.result.ourScore < item.result.theirScore ? "L" : "D"}
          </span>
          <span className="font-display text-xl leading-none text-ink tabular-nums">
            {item.result.ourScore}&ndash;{item.result.theirScore}
          </span>
        </div>
      ) : (
        <ChevronRight className="mt-1 size-4 shrink-0 text-ink/30" aria-hidden="true" />
      )}
    </div>
  )

  return (
    <Link
      href={item.href ?? "#"}
      className={cn(
        "block rounded-xl border bg-white px-4 py-3.5 shadow-[0_1px_0_0_theme(colors.ink/6%)] transition-[background-color,border-color,transform] hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px",
        attention ? ATTENTION_CARD : "border-ink/10 hover:border-ink/20"
      )}
    >
      {/* One accessible sentence for the whole card, so a screen reader hears
          the fixture rather than a pile of fragments. */}
      <span className="sr-only">
        {item.us.teamName ?? item.us.clubName} versus {opposition}
        {item.homeAway === "Home" || item.homeAway === "Away" ? `, ${item.homeAway.toLowerCase()}` : ""}
        {item.time ? `, kick-off ${item.time}` : ""}
        {item.venue ? `, at ${item.venue}` : ""}
        {item.result
          ? `. Final score ${item.result.ourScore} to ${item.result.theirScore}, ${item.result.ourScore > item.result.theirScore ? "won" : item.result.ourScore < item.result.theirScore ? "lost" : "drawn"}`
          : ""}
        {attention ? ". You have not said whether you can attend" : ""}. Open Match Centre.
      </span>
      <span aria-hidden="true">{body}</span>
    </Link>
  )
}

/**
 * TRAINING IS NOT A FIXTURE WITH FIELDS REMOVED.
 *
 * It has no opposition, so it gets no VS and no second crest -- inventing
 * either would be fabricating a match. What it gets instead is its own
 * treatment: a dashed edge and a training mark, which reads as "session"
 * rather than "match missing its opponent".
 *
 * IT LINKS TO TRAINING CENTRE, not to Match Centre. Training now has its own
 * canonical surface addressed by its own training_session_id, so the card
 * opens that -- it is never forced through a fixture route, and it never
 * borrows a fixture id. A session with no href (there should be none) still
 * renders as a plain card rather than a dead link.
 */
export function TrainingCard({
  item,
  showChild,
  onDark = false,
  attention = false,
}: {
  item: AgendaItem
  showChild: boolean
  onDark?: boolean
  attention?: boolean
}) {
  const className = cn(
    "block rounded-xl border border-dashed px-4 py-3.5 transition-[background-color,border-color,transform] focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none",
    // On the promoted card's forest ground a chalk card read as a rendering
    // fault rather than a deliberate distinction, so the training treatment
    // inverts instead of being pasted onto the dark.
    onDark ? "border-white/25 bg-white/5" : "border-ink/20 bg-chalk",
    item.href && (onDark ? "hover:bg-white/10 active:translate-y-px" : "hover:border-ink/35 hover:bg-white active:translate-y-px"),
    // The rail is applied only on the light ground: on the promoted dark card
    // an amber inset next to a white/25 dashed edge reads as two borders
    // arguing, and the promoted card is already the one thing being pointed at.
    attention && !onDark && ATTENTION_CARD
  )

  const label = (
    <span className="sr-only">
      Training, {item.us.teamName ?? item.us.clubName}
      {item.time ? `, ${item.time}` : ""}
      {item.venue ? `, at ${item.venue}` : ""}
      {attention ? ". You have not said whether you can attend" : ""}.{item.href ? " Open Training Centre." : ""}
    </span>
  )

  const Shell = item.href
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={item.href!} className={className}>
          {label}
          <span aria-hidden="true">{children}</span>
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div className={className}>
          {label}
          <span aria-hidden="true">{children}</span>
        </div>
      )

  return (
    <Shell>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ring-1",
            onDark ? "bg-white/10 text-chalk ring-white/20" : "bg-white text-ink-muted ring-ink/10"
          )}
        >
          <Dumbbell className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          {showChild && item.childFirstName && (
            <p
              className={cn(
                "mb-1 inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs font-semibold",
                onDark ? "bg-white/10 text-chalk" : "bg-ink/6 text-ink"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[9px] font-bold",
                  onDark ? "bg-chalk text-forest-950" : "bg-ink/70 text-chalk"
                )}
              >
                {item.childFirstName.slice(0, 1).toUpperCase()}
              </span>
              {item.childFirstName}
            </p>
          )}
          {/* Every text colour flips with the ground. Leaving them as ink put
              near-black type on near-black forest in the promoted card --
              legible on a designer's monitor and not on a phone. */}
          <p className={cn("text-[11px] font-semibold tracking-[0.1em] uppercase", onDark ? "text-pitch-400" : "text-ink-muted")}>Training</p>
          <p className={cn("mt-0.5 font-display text-base leading-tight", onDark ? "text-chalk" : "text-ink")}>
            {item.us.teamName ?? item.us.clubName}
          </p>
          <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", onDark ? "text-white/80" : "text-ink-muted")}>
            {item.time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                {item.time}
              </span>
            )}
            {item.venue && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.venue}</span>
              </span>
            )}
          </div>
          {attention && !onDark && (
            <div className="mt-2">
              <AttentionChip />
            </div>
          )}
        </div>
        {item.href && (
          <ChevronRight className={cn("mt-1 size-4 shrink-0", onDark ? "text-white/40" : "text-ink/30")} aria-hidden="true" />
        )}
      </div>
    </Shell>
  )
}

export function ActivityCard({
  item,
  showChild,
  onDark = false,
  attention = false,
}: {
  item: AgendaItem
  showChild: boolean
  onDark?: boolean
  /** This viewer still owes an answer on this activity. Decided by the page, never here. */
  attention?: boolean
}) {
  return item.kind === "training" ? (
    <TrainingCard item={item} showChild={showChild} onDark={onDark} attention={attention} />
  ) : (
    <FixtureCard item={item} showChild={showChild} attention={attention} />
  )
}
