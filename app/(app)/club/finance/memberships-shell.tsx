import type { ReactNode } from "react"
import Link from "next/link"
import { Settings } from "lucide-react"
import type { ClubMembershipBoard } from "@ovalball/contracts/membership/board"
import { audiencePlayerIds, sendRemindersLabel } from "@ovalball/contracts/membership/operate"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { MembershipsAccess } from "./memberships-access"
import { MembershipsNav, type MembershipsSection } from "./memberships-nav"

/**
 * ONE HEADER AND ONE SECTION NAVIGATION FOR THE CLUB'S MEMBERSHIPS (Club Memberships Part 2).
 *
 * Overview, Members, Reminders and Payments are separate routes sharing this frame: the club's name, the area's
 * title, Settings for the people who configure memberships, and the one primary action -- Send N Reminders, which
 * opens Reminders with everybody who needs action chosen. It never sends from here: the person sees the message and
 * who it goes to first.
 *
 * Deliberately a component every page renders rather than a layout: each page asks the area's authority itself
 * (a layout's check can be skipped when a page is requested on its own), and the existing membership record
 * (`/club/finance/[payerSubscriptionId]`) keeps its own frame untouched.
 */
export function MembershipsShell({
  access,
  board,
  active,
  primaryAction = true,
  settingUp = false,
  children,
}: {
  access: MembershipsAccess
  board: ClubMembershipBoard | null
  active: MembershipsSection
  /**
   * False on a page with a primary action of its own (a member's Send Reminder), so the page never shows two
   * primaries -- or, with one family to remind, two buttons both called "Send Reminder" that do different things.
   */
  primaryAction?: boolean
  /**
   * True while the club is setting up: the page's own setup panel is then the one way in, so the header does not
   * offer a second door to the same journey (the phone's Memberships home does the same).
   */
  settingUp?: boolean
  children: ReactNode
}) {
  // A page opened for another club through a link (`?club=`) shows that club's name but none of the area's
  // navigation, which is for the club the person is working in.
  const detached = !access.isActiveClub
  const remindable = !detached && access.can.enrolment && board ? audiencePlayerIds(board.rows, { kind: "needs_action" }).length : 0
  const showSend = primaryAction && remindable > 0 && active !== "reminders"
  const showSettings = !detached && access.can.configure && !settingUp
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{access.clubName}</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Memberships</h1>
        </div>
        {(showSettings || showSend) && (
          <div className="flex flex-wrap items-center gap-2">
            {showSettings && (
              <Link href="/club/settings/subscriptions" className={cn(buttonVariants({ variant: "outline" }), "h-11 gap-1.5 px-3.5 sm:h-9")}>
                <Settings aria-hidden="true" />
                Settings
              </Link>
            )}
            {showSend && (
              <Link href="/club/finance/reminders?audience=needs_action" className={cn(buttonVariants({ variant: "default" }), "h-11 px-4 font-semibold sm:h-9")}>
                {sendRemindersLabel(remindable)}
              </Link>
            )}
          </div>
        )}
      </div>
      {detached ? (
        <p className="mt-4 max-w-prose text-sm text-ink-muted">{`Opened from a link for ${access.clubName}. Switch to ${access.clubName} to see the rest of its memberships.`}</p>
      ) : (
        <MembershipsNav active={active} />
      )}
      {/* The pages lay themselves out by the width they are actually given, which the sidebar changes. */}
      <div className="@container mt-6">{children}</div>
    </div>
  )
}

/** The server could not answer: said plainly, with the way forward. */
export function MembershipsLoadProblem() {
  return (
    <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
      The club&rsquo;s memberships couldn&rsquo;t be loaded. Refresh the page to try again.
    </p>
  )
}

/** A club that has never set memberships up: nothing to run yet, and where to start. */
export function MembershipsNotSetUp({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-white px-5 py-8 md:px-8">
      {/* An empty state, so sentence case; Club Memberships is the product's own name. */}
      <h2 className="text-base font-semibold text-ink">Club Memberships aren&rsquo;t set up yet</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">
        Once the club connects GoCardless and adds a membership, everybody who needs one appears here, with who is up to date and who needs action.
      </p>
      {canConfigure ? (
        <Link href="/club/settings/subscriptions" className={cn(buttonVariants({ variant: "default" }), "mt-4 h-11 px-4 font-semibold sm:h-9")}>
          Set Up Club Memberships
        </Link>
      ) : (
        <p className="mt-3 max-w-prose text-sm text-ink-muted">Somebody who manages the club&rsquo;s memberships sets them up.</p>
      )}
    </div>
  )
}
