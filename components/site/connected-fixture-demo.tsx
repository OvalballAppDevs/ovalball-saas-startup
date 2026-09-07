"use client"

import { useRef, useState } from "react"
import { CalendarDays, Check, Clock, MapPin, MessageSquare, Users } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  CALENDAR_DAYS,
  CALENDAR_WEEKDAYS,
  JOURNEY_FIXTURES,
  JOURNEY_TRAINING,
  type DemoJourneyFixture,
} from "@/lib/marketing/fixture-journey-demo"

/**
 * The connected-fixture demonstration: one selected fixture, four surfaces.
 *
 * This is the page's central argument made operable rather than described.
 * Selecting a fixture in the Fixture Management panel updates the
 * conversation, the calendar and the pitch allocation at the same time,
 * because all four read the same object from fixture-journey-demo.ts.
 * Building four unrelated mock panels would have quietly undermined the
 * exact point the section is making.
 *
 * Selection is a radio group with roving tabindex and arrow-key support:
 * choosing one of several fixtures is a single-select, not a tab set (all
 * four panels respond, so there is no one panel a tab could control).
 * Everything is in-memory; no network request is made from this component.
 */
const PANEL_CLASS = "rounded-xl border border-white/10 bg-white/[0.035] p-5 md:p-6"
const PANEL_TITLE_CLASS = "flex items-center gap-2 text-sm font-medium tracking-[0.06em] text-white/60 uppercase"

export function ConnectedFixtureDemo() {
  const [selectedId, setSelectedId] = useState(JOURNEY_FIXTURES[0].id)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selected =
    JOURNEY_FIXTURES.find((f) => f.id === selectedId) ?? JOURNEY_FIXTURES[0]

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"]
    if (!keys.includes(event.key)) return
    event.preventDefault()

    const last = JOURNEY_FIXTURES.length - 1
    let next = index
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = index === last ? 0 : index + 1
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = index === 0 ? last : index - 1
    if (event.key === "Home") next = 0
    if (event.key === "End") next = last

    setSelectedId(JOURNEY_FIXTURES[next].id)
    optionRefs.current[next]?.focus()
  }

  return (
    <div>
      {/* One atomic announcement per change, rather than four panels each
          announcing themselves over the top of one another. */}
      <p role="status" aria-atomic="true" className="sr-only">
        Showing {selected.ourTeam} versus {selected.opponentTeam}, {selected.date} at{" "}
        {selected.kickoff}, {selected.homeOrAway}.
      </p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Fixture Management */}
        <div className={PANEL_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <h3 className={PANEL_TITLE_CLASS}>
              <CalendarDays className="size-4" aria-hidden="true" />
              Fixture management
            </h3>
            <DemoBadge />
          </div>

          <div
            role="radiogroup"
            aria-label="Select a fixture to see how it appears across Ovalball"
            className="mt-4 flex flex-col gap-2.5"
          >
            {JOURNEY_FIXTURES.map((fixture, i) => {
              const active = fixture.id === selected.id
              return (
                <button
                  key={fixture.id}
                  ref={(el) => {
                    optionRefs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setSelectedId(fixture.id)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  className={cn(
                    "rounded-lg border px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
                    active
                      ? "border-pitch-600/50 bg-pitch-600/[0.09]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{fixture.ourTeam}</p>
                      <p className="text-sm text-white/60">vs {fixture.opponentTeam}</p>
                    </div>
                    <StatusChip status={fixture.status} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      {fixture.shortDate}, {fixture.kickoff}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden="true" />
                      {fixture.homeOrAway}
                    </span>
                    <span>{fixture.competition}</span>
                  </p>
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-white/60">
            Select a fixture &mdash; every panel below follows it.
          </p>
        </div>

        {/* Messages. A flex column so a short thread (a planned fixture with
            one message and no reply yet) pushes its status line to the
            bottom of the panel instead of leaving a block of dead space
            under it -- the panels sit in a grid and share a row height. */}
        <div className={cn(PANEL_CLASS, "flex flex-col")}>
          <div className="flex items-center justify-between gap-3">
            <h3 className={PANEL_TITLE_CLASS}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Fixture conversation
            </h3>
            <DemoBadge />
          </div>
          <p className="mt-3 text-xs text-white/60">
            {selected.ourShort} &middot; {selected.opponentShort}
          </p>

          <ul className="mt-4 flex flex-1 flex-col gap-3">
            {selected.messages.map((message, i) => (
              <li
                key={i}
                className={cn("flex flex-col gap-1", message.side === "ours" ? "items-end" : "items-start")}
              >
                <span className="text-[11px] text-white/60">{message.from}</span>
                <p
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                    message.side === "ours"
                      ? "rounded-br-sm bg-pitch-600/20 text-white"
                      : "rounded-bl-sm bg-white/[0.06] text-white/85"
                  )}
                >
                  {message.text}
                </p>
              </li>
            ))}
          </ul>

          {selected.status === "Confirmed" ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-pitch-600/10 px-3.5 py-2.5 text-sm text-pitch-400">
              <Check className="size-4 shrink-0" strokeWidth={3} aria-hidden="true" />
              Fixture confirmed
            </p>
          ) : (
            <p className="mt-4 rounded-lg bg-white/[0.04] px-3.5 py-2.5 text-sm text-white/60">
              Awaiting a reply from {selected.opponentShort}.
            </p>
          )}
        </div>

        {/* Calendar */}
        <div className={PANEL_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <h3 className={PANEL_TITLE_CLASS}>
              <CalendarDays className="size-4" aria-hidden="true" />
              Calendar
            </h3>
            <DemoBadge />
          </div>
          <p className="mt-3 text-xs text-white/60">September</p>

          <div className="mt-3 grid grid-cols-7 gap-1" role="presentation">
            {CALENDAR_WEEKDAYS.map((day, i) => (
              <span key={i} className="pb-1 text-center text-[11px] text-white/60">
                {day}
              </span>
            ))}
            {CALENDAR_DAYS.map((day) => {
              const isSelected = day === selected.dayOfMonth
              const hasOther =
                JOURNEY_FIXTURES.some((f) => f.dayOfMonth === day && f.id !== selected.id) ||
                JOURNEY_TRAINING.some((t) => t.dayOfMonth === day)
              return (
                <span
                  key={day}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center rounded-md text-[12px] transition-colors",
                    isSelected
                      ? "bg-pitch-600 font-semibold text-ink"
                      : hasOther
                        ? "bg-white/[0.07] text-white/70"
                        : "text-white/60"
                  )}
                >
                  {day}
                  {/* A dot as well as the fill: never colour alone. */}
                  {(isSelected || hasOther) && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-1 rounded-full",
                        isSelected ? "bg-ink/60" : "bg-pitch-400"
                      )}
                    />
                  )}
                </span>
              )
            })}
          </div>

          <div className="mt-4 rounded-lg border border-pitch-600/30 bg-pitch-600/[0.07] px-3.5 py-3">
            <p className="text-sm font-medium text-white">
              {selected.shortDate} &middot; {selected.kickoff}
            </p>
            <p className="mt-0.5 text-sm text-white/65">
              {selected.ourShort} v {selected.opponentShort}
            </p>
            <p className="mt-1 text-xs text-white/60">
              {selected.venue} &middot; {selected.competition}
            </p>
          </div>
          <p className="mt-3 text-xs text-white/60">
            Authorised users see the fixture in the calendars relevant to their club, team or
            relationship.
          </p>
        </div>

        {/* Pitch allocation. Same flex treatment: the away-fixture state is
            a single short block, and the trailing note anchors the panel. */}
        <div className={cn(PANEL_CLASS, "flex flex-col")}>
          <div className="flex items-center justify-between gap-3">
            <h3 className={PANEL_TITLE_CLASS}>
              <Users className="size-4" aria-hidden="true" />
              Pitch allocation
            </h3>
            <DemoBadge />
          </div>
          <p className="mt-3 text-xs text-white/60">{selected.venue}</p>

          {selected.homeOrAway === "Home" ? (
            <div className="mt-4 flex flex-1 flex-col gap-2.5">
              <PitchRow
                pitch={selected.pitch}
                window={selected.pitchWindow}
                title={`${selected.ourShort} v ${selected.opponentShort}`}
                highlight
              />
              {JOURNEY_TRAINING.filter((t) => t.pitch !== selected.pitch).map((t) => (
                <PitchRow key={t.id} pitch={t.pitch} window={t.pitchWindow} title={t.label} />
              ))}
            </div>
          ) : (
            <div className="mt-4 flex flex-1 flex-col justify-center rounded-lg border border-white/10 bg-white/[0.02] px-4 py-6 text-center">
              <p className="text-sm text-white/70">This is an away fixture.</p>
              <p className="mt-1.5 text-sm text-white/60">
                {selected.opponentShort} is hosting, so no pitch is allocated at{" "}
                {JOURNEY_FIXTURES[0].venue}.
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-white/60">
            Home fixtures flow into pitch planning, so the people responsible for the ground can
            see what needs accommodating.
          </p>
        </div>
      </div>
    </div>
  )
}

function PitchRow({
  pitch,
  window: timeWindow,
  title,
  highlight = false,
}: {
  pitch: string
  window: string
  title: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        highlight ? "border-pitch-600/40 bg-pitch-600/[0.08]" : "border-white/10 bg-white/[0.02]"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-[0.06em] text-white/60 uppercase">{pitch}</span>
        <span className="text-xs text-white/60">{timeWindow}</span>
      </div>
      <p className="mt-1.5 text-sm text-white">{title}</p>
    </div>
  )
}

function StatusChip({ status }: { status: DemoJourneyFixture["status"] }) {
  const confirmed = status === "Confirmed"
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        confirmed ? "bg-pitch-600/15 text-pitch-400" : "bg-white/[0.08] text-white/60"
      )}
    >
      {confirmed && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      {status}
    </span>
  )
}

/** Quiet, not a watermark -- enough that this can't be mistaken for a live surface. */
function DemoBadge() {
  return (
    <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/60 uppercase">
      Product preview
    </span>
  )
}
