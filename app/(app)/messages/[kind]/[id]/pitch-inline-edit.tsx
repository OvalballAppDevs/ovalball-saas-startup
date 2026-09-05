"use client"

import { useState } from "react"
import { MapPin, Pencil } from "lucide-react"

import { updateFixturePitchAction } from "./result-actions"

const TBC_VALUE = "__tbc__"

interface AvailablePitch {
  id: string
  display_name: string
}

/**
 * A HOME fixture gets a real dropdown of the home club's own active named
 * pitches (never free text -- Section 2's "not free-text fixture-by-
 * fixture forever"), plus a genuine "TBC / Not assigned" option that
 * clears the pitch without forcing a fake pitch row (Section 5). An AWAY
 * fixture keeps the old free-text field -- the away club can still note
 * something, but can never assign one of ITS pitches to the other club's
 * home fixture (enforced server-side in update_fixture_pitch regardless
 * of what this component sends).
 */
export function PitchInlineEdit({
  fixtureId,
  pitch,
  pitchId,
  isHomeFixture,
  availablePitches,
}: {
  fixtureId: string
  pitch: string | null
  pitchId: string | null
  isHomeFixture: boolean
  availablePitches: AvailablePitch[]
}) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [currentText, setCurrentText] = useState(pitch)
  const [currentPitchId, setCurrentPitchId] = useState(pitchId)
  const [textValue, setTextValue] = useState(pitch ?? "")
  const [selectValue, setSelectValue] = useState(pitchId ?? TBC_VALUE)

  const label = isHomeFixture ? (availablePitches.find((p) => p.id === currentPitchId)?.display_name ?? currentText ?? "TBC") : (currentText ?? "Set pitch")

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white px-2.5 py-1 text-xs font-medium text-ink/70 outline-none transition-colors hover:border-pitch-600/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <MapPin className="size-3.5 text-ink/35" />
        {label}
        <Pencil className="size-3 text-ink/30" />
      </button>
    )
  }

  if (isHomeFixture) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-600/40 bg-white py-1 pr-1.5 pl-2.5">
        <select
          autoFocus
          value={selectValue}
          onChange={(e) => setSelectValue(e.target.value)}
          className="h-6 border-0 bg-transparent p-0 text-xs text-ink outline-none"
        >
          <option value={TBC_VALUE}>TBC / Not assigned</option>
          {availablePitches.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true)
            const result =
              selectValue === TBC_VALUE
                ? await updateFixturePitchAction(fixtureId, { pitchText: null })
                : await updateFixturePitchAction(fixtureId, { pitchId: selectValue })
            setPending(false)
            if (result.ok) {
              if (selectValue === TBC_VALUE) {
                setCurrentPitchId(null)
                setCurrentText(null)
              } else {
                setCurrentPitchId(selectValue)
                setCurrentText(availablePitches.find((p) => p.id === selectValue)?.display_name ?? null)
              }
              setEditing(false)
            }
          }}
          className="rounded-full bg-pitch-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-pitch-600/90 disabled:opacity-40"
        >
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink/40 hover:text-ink/70">
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-600/40 bg-white py-1 pr-1.5 pl-2.5">
      <input
        autoFocus
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        placeholder="e.g. Pitch 2"
        className="h-6 w-24 border-0 p-0 text-xs text-ink outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          const result = await updateFixturePitchAction(fixtureId, { pitchText: textValue || null })
          setPending(false)
          if (result.ok) {
            setCurrentText(textValue || null)
            setEditing(false)
          }
        }}
        className="rounded-full bg-pitch-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-pitch-600/90 disabled:opacity-40"
      >
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink/40 hover:text-ink/70">
        Cancel
      </button>
    </span>
  )
}
