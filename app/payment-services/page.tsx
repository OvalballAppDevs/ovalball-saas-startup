import type { Metadata } from "next"
import Link from "next/link"

import { FinanceDashboardDemo } from "@/components/site/finance-dashboard-demo"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { MembershipJourneyDemo } from "@/components/site/membership-journey-demo"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { DEMO_FAMILY, DEMO_FINANCE_SUMMARY } from "@/lib/marketing/game-day-demo"
import { Reveal } from "@/lib/motion/reveal"

export const metadata: Metadata = {
  title: "Rugby Club Membership Payments | Ovalball",
  description:
    "Connect rugby club membership administration with recurring payment visibility. Ovalball integrates with GoCardless for Direct Debit collection.",
}

const LINK_CLASS =
  "font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
const DARK_LINK_CLASS =
  "font-medium text-pitch-400 underline underline-offset-2 hover:text-pitch-300"

export default async function PaymentServicesPage() {
  const identity = await getPublicHeaderIdentity()
  const beta = await getBetaBadgeState()

  return (
    <>
      <Header identity={identity} beta={beta} />
      <main>
        {/* Hero -- product-led, no banking stock photography. */}
        <section className="bg-forest-950 pt-32 pb-20 md:pt-40 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Membership, connected
                  </p>
                  <h1 className="mt-4 font-display text-display-xl text-white text-balance">
                    Membership payments without the monthly chase.
                  </h1>
                </Reveal>
                <Reveal index={1}>
                  <div className="mt-6 max-w-xl space-y-4 text-base text-white/75 md:text-lg">
                    <p>Membership keeps clubs moving.</p>
                    <p>
                      Ovalball brings membership administration and payment visibility together,
                      helping clubs automate regular collections, understand payment status and
                      support members when something needs attention.
                    </p>
                  </div>
                </Reveal>
                <Reveal index={2}>
                  {/* Provider attribution as text, not a borrowed logo -- no
                      approved GoCardless brand asset exists in this project,
                      and redrawing one would misuse their mark. */}
                  <div className="mt-8 inline-flex flex-col gap-1 rounded-lg border border-white/12 bg-white/[0.03] px-5 py-4">
                    <span className="text-[11px] tracking-[0.08em] text-white/60 uppercase">
                      Direct Debit collection by
                    </span>
                    <span className="font-display text-xl text-white">GoCardless</span>
                    <span className="mt-1 text-xs text-white/60">
                      Ovalball integrates with GoCardless. Each club connects its own GoCardless
                      account.
                    </span>
                  </div>
                </Reveal>
              </div>

              <Reveal index={1}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
                  <p className="text-xs tracking-[0.06em] text-white/60 uppercase">
                    Membership overview
                  </p>
                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                    <div>
                      <dt className="text-[11px] tracking-[0.04em] text-white/60 uppercase">
                        Active members
                      </dt>
                      <dd className="mt-1 font-display text-3xl tabular-nums text-white">
                        {DEMO_FINANCE_SUMMARY.activeMembers}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.04em] text-white/60 uppercase">
                        Expected this month
                      </dt>
                      <dd className="mt-1 font-display text-3xl tabular-nums text-white">
                        {DEMO_FINANCE_SUMMARY.expectedThisMonth}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.04em] text-white/60 uppercase">
                        Collected
                      </dt>
                      <dd className="mt-1 font-display text-3xl tabular-nums text-pitch-400">
                        {DEMO_FINANCE_SUMMARY.collected}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.04em] text-white/60 uppercase">
                        Needs attention
                      </dt>
                      <dd className="mt-1 font-display text-3xl tabular-nums text-amber-300">
                        {DEMO_FINANCE_SUMMARY.needsAttention}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-6 text-[11px] tracking-[0.06em] text-white/60 uppercase">
                    Product preview &mdash; example data
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Membership shouldn't live in a spreadsheet */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                One system
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-ink text-balance">
                Membership shouldn&apos;t live in a spreadsheet.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink/75">
                When membership records and payment information live in different places, club
                administration gets harder than it needs to be.
              </p>
            </Reveal>
            <Reveal index={2}>
              <ul className="mt-8 grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
                {[
                  "Who has joined?",
                  "Who has completed their payment setup?",
                  "What is due?",
                  "What has been collected?",
                  "What needs attention?",
                ].map((q) => (
                  <li key={q} className="flex gap-2.5 text-[17px] leading-relaxed text-ink/80">
                    <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-pitch-600" />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal index={3}>
              <p className="mt-8 max-w-2xl text-[17px] leading-relaxed text-ink/75">
                Ovalball connects the member and their membership status with the information
                authorised Club Admins need &mdash; the member and the payment belong together.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Simple for families */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-start gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Simple for families
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    Set up membership in a few simple steps.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-5 text-base text-white/70 md:text-lg">
                    A parent joins their child to the club, chooses the membership the club offers,
                    and authorises a Direct Debit arrangement with GoCardless. Ovalball never sees
                    or stores the bank details.
                  </p>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-4 text-base text-white/60">
                    Setting it up takes a few minutes. The collection itself follows Direct Debit
                    banking timings, so a membership becomes active once the arrangement is
                    confirmed by the provider &mdash; not the instant the form is submitted.
                  </p>
                </Reveal>

                {/* Sibling / family adjustment -- verified: the pricing
                    function supports sibling ordinals and has its own
                    regression suite. Kept as a subtle mention, not a headline
                    claim. */}
                <Reveal index={3}>
                  <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-sm font-medium tracking-[0.06em] text-white/60 uppercase">
                      Families with more than one player
                    </p>
                    <ul className="mt-3 flex flex-col gap-2">
                      {DEMO_FAMILY.map((member) => (
                        <li key={member.player} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-white/85">
                            {member.player} &middot;{" "}
                            <span className="text-white/60">{member.ageGroup}</span>
                          </span>
                          <span className="tabular-nums text-white/70">{member.monthly} / month</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 border-t border-white/10 pt-3 text-sm text-white/60">
                      Where a club configures a family adjustment for siblings, Ovalball applies it
                      when the membership price is calculated. Clubs can also configure how a new
                      membership&rsquo;s first period begins.
                    </p>
                  </div>
                </Reveal>
              </div>

              <Reveal index={1}>
                <MembershipJourneyDemo />
              </Reveal>
            </div>
          </div>
        </section>

        {/* Automated collections */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid gap-12 border-t border-white/10 pt-20 lg:grid-cols-[1fr_1fr] lg:gap-16 md:pt-28">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Set it up. Let the schedule do the work.
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    Automated collections. Clear visibility.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-5 text-base text-white/70 md:text-lg">
                    Regular membership subscriptions can be scheduled through GoCardless, so clubs
                    do not need to manually request the same payment every month. Members authorise
                    their payment arrangement once, and scheduled collections are handled through
                    the payment provider.
                  </p>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-4 text-base text-white/60">
                    Direct Debit collections follow banking scheme processing times, and a
                    collection can still fail. Ovalball&rsquo;s job is to make sure the club can see
                    exactly where each one stands.
                  </p>
                </Reveal>
              </div>

              <Reveal index={1}>
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-7">
                  <p className="text-sm font-medium tracking-[0.06em] text-white/60 uppercase">
                    How a collection travels
                  </p>
                  <ol className="mt-5 flex flex-col gap-0">
                    {[
                      ["Member", "Authorises a Direct Debit arrangement."],
                      ["Ovalball membership", "Holds the membership, the price and what is due."],
                      ["GoCardless", "Performs the collection and reports what happened."],
                      ["Payment status", "Paid, scheduled, submitted, or needs attention."],
                      ["Club Finance", "The club sees it against the right member."],
                    ].map(([label, body], i, arr) => (
                      <li key={label} className="relative flex gap-4 pb-5 last:pb-0">
                        {i < arr.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="absolute top-6 left-[9px] h-[calc(100%-1rem)] w-px bg-white/12"
                          />
                        )}
                        <span
                          aria-hidden="true"
                          className="mt-1.5 size-[18px] shrink-0 rounded-full border-2 border-pitch-600 bg-forest-950"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{label}</p>
                          <p className="mt-0.5 text-sm text-white/60">{body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs text-white/60">
                    GoCardless performs the payment processing. Ovalball provides the membership
                    administration and the visibility.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Finance dashboard */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="border-t border-white/10 pt-20 md:pt-28">
              <Reveal>
                <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                  See what needs your attention
                </p>
                <h2 className="mt-3 max-w-2xl font-display text-display-l text-white text-balance">
                  Every membership, and exactly where its payment stands.
                </h2>
              </Reveal>
              <Reveal index={1} className="mt-10">
                <FinanceDashboardDemo />
              </Reveal>
            </div>
          </div>
        </section>

        {/* Needs attention / support philosophy */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                When something needs attention, you can see it
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-ink text-balance">
                A failed payment is information, not a judgement.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <div className="mt-6 grid max-w-4xl gap-4 text-[17px] leading-relaxed text-ink/75 md:grid-cols-2 md:gap-8">
                <p>
                  Payments do not always go to plan. If a collection fails or a membership needs
                  attention, authorised Club Admins can see that in Ovalball rather than discovering
                  it weeks later.
                </p>
                <p>
                  That gives the club the chance to contact the member, understand what has
                  happened, and offer appropriate support. Visibility exists so clubs can help
                  earlier &mdash; not so they can chase harder.
                </p>
              </div>
            </Reveal>

            <Reveal index={2}>
              <div className="mt-10 max-w-md rounded-xl border border-ink/10 bg-white p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium tracking-[0.06em] text-ink-muted uppercase">
                    Member account
                  </p>
                  <span className="shrink-0 rounded-full border border-ink/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-ink-muted uppercase">
                    Product preview
                  </span>
                </div>
                <p className="mt-4 text-sm text-ink-muted">Membership</p>
                <p className="text-base font-medium text-ink">Junior Membership &middot; £25 / month</p>

                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <p className="text-xs tracking-[0.06em] text-amber-800 uppercase">Payment status</p>
                  <p className="mt-1 text-sm font-medium text-amber-900">Needs attention</p>
                  <p className="mt-1 text-sm text-amber-900/80">
                    The last collection was unsuccessful.
                  </p>
                </div>

                <p className="mt-4 text-sm text-ink-muted">
                  Shown to the member and to Club Admins with finance permission. No bank details,
                  card numbers or provider references are displayed.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Provider story */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                Built around a specialist payment provider
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-white text-balance">
                Ovalball handles membership. GoCardless handles the money.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <div className="mt-6 grid max-w-4xl gap-4 text-base text-white/70 md:grid-cols-2 md:gap-8 md:text-lg">
                <p>
                  Each club connects its own GoCardless account to Ovalball. Payments are collected
                  into the club&rsquo;s account, and GoCardless holds the payer&rsquo;s bank
                  details. Ovalball stores references to the customer, mandate, payment and
                  subscription records held by GoCardless, together with their status.
                </p>
                <p>
                  That separation is deliberate: the specialist payment provider does the payment
                  processing and the regulated parts, and Ovalball does the club administration and
                  the visibility on top.
                </p>
              </div>
            </Reveal>
            <Reveal index={2}>
              <div className="mt-8 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-5 py-4">
                <p className="text-sm font-medium text-amber-200">Current status</p>
                <p className="mt-1.5 max-w-3xl text-sm text-amber-100/80">
                  The GoCardless integration is built and supported in Ovalball. Live payment
                  collection is not yet switched on in the live service, and no club is collecting
                  production payments through Ovalball today. This page describes the capability
                  Ovalball supports, not a service that is already running.
                </p>
              </div>
            </Reveal>
            <Reveal index={3}>
              <p className="mt-6 max-w-3xl text-sm text-white/60">
                What information is involved, and who processes it, is set out in the{" "}
                <Link href="/legal/privacy" className={DARK_LINK_CLASS}>
                  Privacy Notice
                </Link>
                , the{" "}
                <Link href="/legal/subprocessors" className={DARK_LINK_CLASS}>
                  Third-Party Services
                </Link>{" "}
                page and the{" "}
                <Link href="/legal/terms" className={DARK_LINK_CLASS}>
                  Terms
                </Link>
                . GoCardless is named there as a supported provider, with its current status.
              </p>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <Reveal>
              <h2 className="font-display text-display-l text-ink text-balance">
                Membership. Payments. Club administration.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mx-auto mt-5 max-w-xl text-base text-ink/70 md:text-lg">
                One connected experience, for the club and for the families in it.
              </p>
            </Reveal>
            <Reveal index={2}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="flex min-h-12 w-full items-center justify-center rounded-lg bg-pitch-600 px-7 text-base font-medium text-ink transition-colors hover:bg-pitch-400 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:w-auto"
                >
                  Join Ovalball
                </Link>
                <Link
                  href="/clubs"
                  className="flex min-h-12 w-full items-center justify-center rounded-lg border border-ink/20 px-7 text-base font-medium text-ink transition-colors hover:border-ink/45 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:w-auto"
                >
                  Explore Clubs
                </Link>
              </div>
            </Reveal>
            <Reveal index={3}>
              <p className="mt-8 text-sm text-ink-muted">
                Organising the games themselves?{" "}
                <Link href="/game-management" className={LINK_CLASS}>
                  See Game Management
                </Link>
                .
              </p>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
