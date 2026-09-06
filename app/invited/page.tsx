import type { Metadata } from "next"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "You've been invited | Ovalball",
  description:
    "What to do if your rugby club has invited you to Ovalball: open the link in your invitation email. Ovalball is invite-only, so there is nothing to sign up for.",
}

/**
 * The public answer to "my club invited me, what now?".
 *
 * Ovalball is invite-only for people: there is no self-service way to join
 * a club, by design. Someone who has been invited already has everything
 * they need — a link — and someone who has not cannot get in from here, and
 * should be told so plainly rather than sent round a signup form that will
 * not help them.
 *
 * Deliberately not a "paste your invitation code" box. Invitation tokens
 * are long, single-use and arrive as links; a box for typing one out is a
 * worse version of clicking the link, and it invites guessing.
 */
export default function InvitedPage() {
  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/" className="w-fit">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-16 md:px-8 md:py-24">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Joining Ovalball</p>
        <h1 className="mt-3 font-display text-display-l text-ink">You&rsquo;ve been invited</h1>

        <p className="mt-4 text-base leading-relaxed text-ink/70">
          Open the link in your invitation email. That link is what connects you to your club, your
          team, or your child&rsquo;s team &mdash; there is nothing to fill in here.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-xl text-ink">If you can&rsquo;t find the email</h2>
          <ul className="mt-3 space-y-2.5 text-base text-ink/70">
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-pitch-600" />
              <span>
                Check your spam or junk folder. It comes from Ovalball, and the subject line
                mentions your club.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-pitch-600" />
              <span>
                Invitations expire. If yours has, ask whoever invited you to send a new one &mdash;
                they can do that in a couple of clicks.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-pitch-600" />
              <span>
                Check it went to the right address. An invitation only works for the email address
                it was sent to.
              </span>
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl text-ink">If nobody has invited you</h2>
          <p className="mt-3 text-base leading-relaxed text-ink/70">
            Ovalball is invite-only. Being a member of a club, or a parent of a player, does not by
            itself create an Ovalball account &mdash; someone at the club has to invite you, and
            that is deliberate: it is how a club stays in control of who can see its players,
            fixtures and messages.
          </p>
          <p className="mt-3 text-base leading-relaxed text-ink/70">
            Ask your club secretary, team manager, or whoever handles club administration.
          </p>
        </section>

        <section className="mt-10 rounded-lg bg-mint-100 px-5 py-5">
          <h2 className="font-display text-xl text-forest-950">Bringing a whole club to Ovalball?</h2>
          <p className="mt-2 text-base leading-relaxed text-forest-950/80">
            That is a different route. If you run a rugby club and want it on Ovalball, start here
            &mdash; you&rsquo;ll be asked which club it is and what your role there is, and a person
            reviews it before anything is set up.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-pitch-600 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-pitch-600/80 focus-visible:ring-3 focus-visible:ring-pitch-400/50"
          >
            Bring your club to Ovalball
          </Link>
        </section>

        <p className="mt-10 border-t border-ink/10 pt-6 text-sm text-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-forest-800 underline underline-offset-4">
            Sign in
          </Link>
          . Stuck?{" "}
          <a href={CONTACT_MAILTO} className="font-medium text-forest-800 underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </main>
  )
}
