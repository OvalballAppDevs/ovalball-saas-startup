"use client"

import { useState } from "react"

import { getPersonalDetails, type PersonalDetails } from "./actions"

/** Collapsed by default and fetched only on demand -- DOB/address never load into the page's initial payload, matching the brief's "least-privilege access" instruction even though Site Admin is already the only role that can reach this data at all. */
export function PersonalDetailsPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<PersonalDetails | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleOpen() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (!details) {
      setLoading(true)
      const result = await getPersonalDetails(userId)
      setDetails(result)
      setLoading(false)
    }
  }

  const address = details
    ? [details.addressLine1, details.addressLine2, details.addressLine3, details.town, details.county, details.postcode, details.country]
        .filter(Boolean)
        .join(", ")
    : ""

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <button
        type="button"
        onClick={handleOpen}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="text-sm font-medium text-ink">Personal details</span>
        <span className="text-xs text-ink/45">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {loading && <p className="text-ink/40">Loading&hellip;</p>}
          {!loading && details && (
            <>
              <p>
                <span className="text-ink/45">Date of birth: </span>
                <span className="text-ink">{details.dateOfBirth ?? "Not on file"}</span>
              </p>
              <p>
                <span className="text-ink/45">Address: </span>
                <span className="text-ink">{address || "Not on file"}</span>
              </p>
            </>
          )}
          {!loading && !details && <p className="text-ink/40">Not available.</p>}
        </div>
      )}
    </div>
  )
}
