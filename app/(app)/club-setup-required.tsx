import Link from "next/link"
import { CircleHelp, Lock } from "lucide-react"

/**
 * What someone without club-setup authority sees at a club that has not
 * finished activating.
 *
 * They are not given the wizard and they are not given extra privilege --
 * onboarding is never a reason to widen someone's authority. They are told
 * plainly what is happening, who can fix it, and what they can still do,
 * because the alternative was a half-working application or a blank page.
 *
 * Rendered inside the normal shell, so the nav, the context switcher and the
 * account menu all remain exactly where they were.
 */
export function ClubSetupRequired({ clubName }: { clubName: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <div className="flex items-center gap-2.5">
        <Lock aria-hidden="true" className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club setup</p>
      </div>

      <h1 className="mt-2 font-display text-display-l text-ink">{clubName} isn&rsquo;t ready yet</h1>

      <p className="mt-3 max-w-lg text-sm text-ink/60">
        A Club Admin needs to finish setting {clubName} up before fixtures, training and the calendar
        can be used. That means adding the club badge and kit, a home venue with at least one pitch,
        and confirming the team list.
      </p>

      <p className="mt-3 max-w-lg text-sm text-ink/60">
        You don&rsquo;t need to do anything — and this doesn&rsquo;t affect any other club you belong to.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/support"
          className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium text-ink outline-none transition-colors hover:border-forest-800/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <CircleHelp aria-hidden="true" className="size-4" />
          Contact Ovalball Support
        </Link>
        <Link
          href="/account"
          className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Your account
        </Link>
      </div>

      <p className="mt-8 text-xs text-ink-muted">
        Belong to more than one club? Use the club switcher at the top of the menu to move to
        another one.
      </p>
    </div>
  )
}
