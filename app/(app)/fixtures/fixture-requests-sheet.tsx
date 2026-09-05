"use client"

import { useState } from "react"
import Link from "next/link"
import { Inbox } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

import { RequestRow, type RequestRowData } from "./request-row"

export interface TournamentInvitationRowData {
  id: string
  hostClubName: string
  teamIdentityLabel: string
  eventDate: string
  resolution: "exists_active" | "exists_folded" | "genuinely_missing" | "has_target_team" | null
}

/**
 * Section 21-22: a compact "View Fixture Requests" control opening a Sheet
 * (never a page navigation) covering ACTION REQUIRED (incoming, including
 * team-creation/reactivation-required states) for both ordinary fixture
 * requests and tournament invitations -- the SAME underlying request
 * records (fixture_requests / tournament_participants), reusing RequestRow
 * unchanged rather than a second implementation. SENT/history/non-Ovalball
 * detail stays on the full /fixtures page (linked at the bottom) rather
 * than fully duplicated here -- a deliberate scope boundary, not silently
 * dropped functionality.
 */
export function FixtureRequestsSheet({
  incoming,
  tournamentInvitations,
}: {
  incoming: RequestRowData[]
  tournamentInvitations: TournamentInvitationRowData[]
}) {
  const [open, setOpen] = useState(false)
  const count = incoming.length + tournamentInvitations.length

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button type="button" className="h-10">
            <Inbox className="mr-1.5 size-4" />
            View Fixture Requests{count > 0 ? ` (${count})` : ""}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Fixture Requests</SheetTitle>
          <SheetDescription>Action required &mdash; received requests and tournament invitations awaiting your response.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4 px-4 pb-4">
          <div>
            <p className="text-xs font-medium tracking-[0.06em] text-ink/45 uppercase">Action required</p>
            {count === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-center text-sm text-ink/50">Nothing waiting on you.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {incoming.map((r) => (
                  // canManage is always true here -- this sheet only ever renders inside
                  // /fixtures/management, which already redirects away anyone without
                  // genuine club-wide fixture authority or Site Admin before this mounts.
                  <RequestRow key={r.id} request={r} canManage />
                ))}
                {tournamentInvitations.map((t) => (
                  <li key={t.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                    <p className="text-sm font-medium text-ink">
                      Tournament invitation &middot; {t.hostClubName} &middot; {t.teamIdentityLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/50">
                      {new Date(t.eventDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      {t.resolution === "genuinely_missing" && " — your club does not currently have this team active"}
                      {t.resolution === "exists_folded" && " — this team is currently inactive"}
                    </p>
                    <Link href="/fixtures" className="mt-2 inline-block text-xs font-medium text-forest-800 underline hover:text-forest-950">
                      Respond to this invitation
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link href="/fixtures" onClick={() => setOpen(false)} className="text-sm font-medium text-forest-800 underline hover:text-forest-950">
            View sent requests &amp; full history &rarr;
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
