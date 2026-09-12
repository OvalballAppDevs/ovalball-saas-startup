"use client"

import { useState } from "react"
import { EllipsisVertical } from "lucide-react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

import { DeactivateTeamTypeDialog } from "./deactivate-team-type-button"

/**
 * One canonical identity, read in two lines.
 *
 *   U14
 *   Under 14 Boys
 *
 * The rugby identifier first, because that is what an administrator scans for,
 * and what the team is CALLED underneath it -- so U14 and Girls U14 can never
 * be mistaken for each other, which was the real defect in reading "U14" and
 * "Girls U14" side by side.
 *
 * What is deliberately absent: the internal key (u14, girls_u14 -- stable
 * identifiers, not something anybody administers by), the per-code "not
 * offered" warning (the catalogue you are looking at IS the answer), and
 * "B/C squads allowed" (a squad is an operational arrangement inside a club,
 * not part of the identity this page governs).
 *
 * Retiring an identity lives in an overflow menu rather than a red button on
 * every row. A directory whose loudest element is the destructive action on
 * every line is telling an administrator the wrong thing about their job.
 */
export function IdentityRow({
  id,
  compact,
  display,
  isActive,
  canManage,
}: {
  id: string
  compact: string
  display: string
  isActive: boolean
  canManage: boolean
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${isActive ? "text-ink" : "text-ink-muted"}`}>{compact}</p>
        <p className="truncate text-sm text-ink-muted">{display}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isActive && (
          <span className="rounded-md bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink/60">Retired</span>
        )}
        {canManage && isActive && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More options for ${display}`}
              className="rounded-md p-1.5 text-ink-muted outline-none hover:bg-ink/5 hover:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <EllipsisVertical className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setConfirming(true)}>Retire this identity</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {confirming && <DeactivateTeamTypeDialog id={id} label={display} onClose={() => setConfirming(false)} />}
    </li>
  )
}
