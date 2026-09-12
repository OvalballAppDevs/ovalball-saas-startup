"use client"

import { Search } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import type { SelectablePlayer } from "./actions"

/**
 * CHOOSING WHO, WITHIN AN AUDIENCE YOU ALREADY HOLD.
 *
 * The list comes from the server and is already filtered by the same
 * authority the send path applies, so this component never decides who is
 * selectable -- it decides how the choice is presented. Anything it did to
 * narrow the list would be a second opinion about eligibility.
 *
 * IT SHOWS PLAYERS, NOT RECIPIENTS. A coach telling four families that
 * Saturday is off is choosing children, not parents' inboxes, and the adults
 * behind each child never reach this component at all. The per-row "2 people"
 * is a NUMBER, deliberately never a name.
 *
 * AND IT NEVER TOTALS THEM. Two children can share a guardian -- in the UAT
 * data they do -- so adding the per-row counts overstates the send. The total
 * is asked of the server on every change, and this component has no opinion
 * about it. supabase/tests/announcement_recipient_picker.sql pins the exact
 * discrepancy (five rows, four people) so the shortcut stays closed.
 *
 * UNREACHABLE PLAYERS ARE SHOWN, NOT HIDDEN. A child with no contactable
 * guardian is the single most important thing a sender can learn from this
 * screen, and quietly dropping the row would leave them believing they had
 * told everybody. The row is present, disabled, and says why.
 */
export function RecipientPicker({
  players,
  selected,
  onChange,
  excludeU18,
  loading,
}: {
  players: SelectablePlayer[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  excludeU18: boolean
  loading: boolean
}) {
  const [query, setQuery] = useState("")
  const searchId = useId()

  const reachable = useMemo(() => players.filter((p) => p.reachable), [players])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players
    return players.filter((p) => p.displayName.toLowerCase().includes(q))
  }, [players, query])

  function toggle(playerId: string) {
    const next = new Set(selected)
    if (next.has(playerId)) next.delete(playerId)
    else next.add(playerId)
    onChange(next)
  }

  if (loading) {
    return <p className="mt-3 text-sm text-ink-muted">Loading the people you can choose from…</p>
  }

  if (players.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        There is nobody in this audience yet. Add players to the team and they will appear here.
      </p>
    )
  }

  const selectedReachable = reachable.filter((p) => selected.has(p.playerId)).length

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search the people you can choose from"
            className="pl-9"
          />
        </div>

        {/* Select all applies to REACHABLE players only: offering to select
            somebody who cannot be reached would put a tick against a person
            this announcement will not actually reach. */}
        <button
          type="button"
          onClick={() => onChange(new Set(reachable.map((p) => p.playerId)))}
          className="h-11 shrink-0 rounded-md border border-ink/15 px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={() => onChange(new Set())}
          disabled={selected.size === 0}
          className="h-11 shrink-0 rounded-md border border-ink/15 px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Clear
        </button>
      </div>

      {/* The running selection, announced to a screen reader as it changes.
          Never a count of PEOPLE -- that is the server's to state, and saying
          it here would be the client counting. */}
      <p aria-live="polite" className="mt-2 text-xs text-ink-muted">
        {selectedReachable === 0
          ? "Nobody chosen yet."
          : `${selectedReachable} of ${reachable.length} chosen.`}
      </p>

      <ul className="mt-2 max-h-72 divide-y divide-ink/10 overflow-y-auto rounded-md border border-ink/12">
        {visible.length === 0 && (
          <li className="px-3 py-4 text-sm text-ink-muted">Nobody matches &ldquo;{query.trim()}&rdquo;.</li>
        )}

        {visible.map((player) => {
          // Excluded by the U18 filter is a THIRD state, distinct from
          // unreachable and from unselected: the person is contactable, the
          // sender simply asked not to include them. Saying "no contact" here
          // would be a lie about a family that has one.
          const excluded = excludeU18 && !player.isAdult
          const disabled = !player.reachable || excluded
          const isSelected = selected.has(player.playerId)

          return (
            <li key={player.playerId}>
              <label
                className={`flex items-start gap-3 px-3 py-2.5 text-sm ${
                  disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-ink/[0.03]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected && !disabled}
                  disabled={disabled}
                  onChange={() => toggle(player.playerId)}
                  className="mt-0.5 size-4 shrink-0 accent-forest-800 disabled:opacity-45"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${disabled ? "text-ink-subtle" : "text-ink"}`}>
                    {player.displayName}
                  </span>
                  <span className="block text-xs text-ink-muted">{rowNote(player, excluded)}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * One line per person saying what will actually happen to them. Written as
 * separate cases rather than one clever string because each says something
 * genuinely different, and the difference is what the sender needs.
 */
function rowNote(player: SelectablePlayer, excluded: boolean): string {
  if (excluded) return "Left out — under 18"

  if (!player.reachable) {
    return player.outcome === "CONSENT_REQUIRED_NO_GUARDIAN"
      ? "Cannot be reached — no guardian, and no consent to contact them directly"
      : "Cannot be reached — no contactable guardian"
  }

  if (player.isAdult) return "Reached directly"

  return player.recipientCount === 1
    ? "Reaches their guardian"
    : `Reaches ${player.recipientCount} guardians`
}
