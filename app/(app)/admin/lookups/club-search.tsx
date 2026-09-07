"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"

import { Autocomplete } from "@/components/ui/autocomplete"

import { searchAdminClubs, type ClubSearchResult } from "./actions"

/**
 * Club search for Lookup Administration.
 *
 * This replaced a `<form method="get">`: nothing happened until you pressed
 * Enter, and selecting a club meant a full page navigation to read the
 * results. That is the reported "club search requires pressing Enter,
 * suggestions don't appear while typing".
 *
 * Now it searches as you type through the shared Autocomplete primitive --
 * the same component the venue address field uses -- so both behave
 * identically and both are keyboard-navigable.
 *
 * Each suggestion carries the club's identity, not just its name: town,
 * county, rugby code and how many operational teams it runs. Two clubs
 * called "Old Boys RFC" are told apart by what is on screen, never by the
 * Site Admin guessing.
 *
 * Selecting still navigates to `?clubId=`, because the venues and pitches
 * below are server-rendered from that club. The search is what stopped
 * needing a round trip, not the result.
 */
export function ClubSearch({ selectedLabel }: { selectedLabel: string | null }) {
  const router = useRouter()

  const runSearch = useCallback((q: string) => searchAdminClubs(q), [])

  return (
    <div className="mt-6">
      <Autocomplete<ClubSearchResult>
        label="Find a club"
        placeholder="Start typing a club name…"
        minChars={2}
        emptyMessage="No activated Ovalball club matches that name."
        hint={
          selectedLabel
            ? `Currently viewing ${selectedLabel}. Search again to switch club.`
            : "Activated Ovalball clubs only — a club must be on Ovalball before it can own venues or pitches."
        }
        onSearch={runSearch}
        optionKey={(c) => c.clubId}
        optionLabel={(c) =>
          `${c.name}, ${[c.town, c.county].filter(Boolean).join(", ") || "location unknown"}, ${c.teamCount} teams`
        }
        renderOption={(c) => (
          <>
            <span className="block truncate font-medium text-ink">{c.name}</span>
            <span className="block truncate text-xs text-ink-muted">
              {[
                [c.town, c.county].filter(Boolean).join(", ") || "No location recorded",
                c.rugbyCode === "league" ? "League" : "Union",
                `${c.teamCount} active ${c.teamCount === 1 ? "team" : "teams"}`,
                c.status !== "active" ? c.status : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        )}
        onSelect={(c) => router.push(`/admin/lookups?clubId=${c.clubId}`)}
      />
    </div>
  )
}
