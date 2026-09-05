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

function startOfMonth(iso: string): Date {
  const d = new Date(`${iso}T00:00:00`)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/**
 * Section 54 date control, replaced per live request: a native `<input
 * type="date">` shows only the OS's raw locale format and a browser-chrome
 * picker with no way to match the app's own look. This renders the full
 * "Weekday Nth Month YYYY" label the user asked for and opens an in-page
 * month grid on click -- prev/next-day arrows in the parent are unchanged.
 */
export function PitchAllocationDatePicker({ dateIso, onChange }: { dateIso: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(dateIso))
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
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v
            if (next) setMonthAnchor(startOfMonth(dateIso))
            return next
          })
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Selected date, choose a different date"
        className="flex h-9 items-center gap-2 rounded-lg border border-ink/15 px-3 text-sm font-medium text-ink outline-none hover:bg-ink/5 focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <CalendarIcon className="size-4 text-ink/50" />
        {formatFullDate(dateIso)}
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
              const isSelected = iso === dateIso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  aria-current={isSelected ? "date" : undefined}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                    !inMonth && "text-ink/25 hover:bg-ink/5",
                    inMonth && !isSelected && "text-ink hover:bg-ink/5",
                    isSelected && "bg-pitch-600 font-semibold text-white hover:bg-pitch-600",
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
