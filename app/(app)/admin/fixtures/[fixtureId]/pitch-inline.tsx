"use client"

import { useState } from "react"
import { MapPin, Pencil } from "lucide-react"

import { updateFixturePitchAction } from "./result-admin-actions"

const TBC_VALUE = "__tbc__"

interface AvailablePitch {
  id: string
  display_name: string
}

/** Compact inline pitch control -- immediately discoverable near Status,
 * never buried in the general Edit details section (progressive
 * disclosure applies to less-common metadata, not this). Mirrors
 * messages/[kind]/[id]/pitch-inline-edit.tsx's dropdown-for-home,
 * free-text-for-away pattern exactly -- one shared design, two surfaces. */
export function PitchInline({
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

  const label = isHomeFixture
    ? (availablePitches.find((p) => p.id === currentPitchId)?.display_name ?? currentText ?? "Not set")
    : (currentText ?? "Not set")

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-sm text-ink/60 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <MapPin className="size-3.5 text-ink/40" />
        <span className="text-ink/40">Pitch:</span> {label}
        <Pencil className="size-3 text-ink/30" />
      </button>
    )
  }

  if (isHomeFixture) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <select
          autoFocus
          value={selectValue}
          onChange={(e) => setSelectValue(e.target.value)}
          className="h-7 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
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
          className="text-xs font-medium text-forest-800 hover:text-forest-950 disabled:opacity-40"
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
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        placeholder="e.g. Pitch 2"
        className="h-7 w-32 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
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
        className="text-xs font-medium text-forest-800 hover:text-forest-950 disabled:opacity-40"
      >
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink/40 hover:text-ink/70">
        Cancel
      </button>
    </span>
  )
}
