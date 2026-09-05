"use client"

import { useEffect, useRef, useState } from "react"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function formatFullDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" })
  const month = d.toLocaleDateString("en-GB", { month: "long" })
  return `${weekday} ${ordinal(d.getDate())} ${month} ${d.getFullYear()}`
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function todayIso(): string {
  return toIso(new Date())
}

function startOfMonth(iso: string): Date {
  const d = new Date(`${iso}T00:00:00`)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/**
 * A calendar-style date picker for ordinary forms (Add Fixture, Create
 * Fixture) -- the same "full label + month grid" interaction
 * PitchAllocationDatePicker established, generalized to accept an UNSET
 * value (a new fixture has no date chosen yet) rather than always
 * requiring one. Kept as its own component rather than importing the
 * Pitch Allocation one so that already-verified feature stays untouched.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Select a date",
  className,
  id,
  minDate,
  maxDate,
}: {
  /** ISO yyyy-mm-dd, or "" when nothing is chosen yet. */
  value: string
  onChange: (iso: string) => void
  placeholder?: string
  className?: string
  id?: string
  /** ISO yyyy-mm-dd bounds (inclusive) -- a day outside this range renders disabled, same as the native input's min/max it replaces. */
  minDate?: string
  maxDate?: string
}) {
  const [open, setOpen] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(value || todayIso()))
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const gridStart = new Date(monthAnchor)
  const startWeekday = (gridStart.getDay() + 6) % 7 // Monday-first
  gridStart.setDate(gridStart.getDate() - startWeekday)
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })

  return (
    <div className="relative" ref={containerRef}>
      <button
        id={id}
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v
            if (next) setMonthAnchor(startOfMonth(value || todayIso()))
            return next
          })
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border border-ink/15 bg-white px-2.5 text-left text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400",
          !value && "text-ink/40",
          className
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-ink/40" />
        <span className="truncate">{value ? formatFullDate(value) : placeholder}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose date" className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-ink/10 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="flex size-7 items-center justify-center rounded-md text-ink/50 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-sm font-semibold text-ink">{monthAnchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="flex size-7 items-center justify-center rounded-md text-ink/50 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink/40">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((d) => {
              const iso = toIso(d)
              const inMonth = d.getMonth() === monthAnchor.getMonth()
              const isSelected = iso === value
              const isToday = iso === todayIso()
              const isOutOfRange = Boolean(minDate && iso < minDate) || Boolean(maxDate && iso > maxDate)
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isOutOfRange}
                  onClick={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  aria-current={isSelected ? "date" : undefined}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                    !inMonth && "text-ink/25 hover:bg-ink/5",
                    inMonth && !isSelected && "text-ink hover:bg-ink/5",
                    isToday && !isSelected && "font-semibold text-pitch-600",
                    isSelected && "bg-pitch-600 font-semibold text-white hover:bg-pitch-600",
                    isOutOfRange && "cursor-not-allowed text-ink/15 hover:bg-transparent"
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
