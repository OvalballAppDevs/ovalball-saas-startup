import type { Metadata } from "next"
import Link from "next/link"

import { ConnectedFixtureDemo } from "@/components/site/connected-fixture-demo"
import { FixtureJourney } from "@/components/site/fixture-journey"
import { FixtureRequestDemo } from "@/components/site/fixture-request-demo"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { PhotoTransition } from "@/components/site/photo-transition"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { JOURNEY_FIXTURES } from "@/lib/marketing/fixture-journey-demo"
import { Reveal } from "@/lib/motion/reveal"

export const metadata: Metadata = {
  title: "Rugby Fixture Management",
  description:
    "See how Ovalball connects fixture requests, messaging, calendars and pitch allocation in one rugby club management platform.",
}

const HERO_STEPS = [
  "Request a match.",
  "Agree the details.",
  "Keep the conversation together.",
  "Place it on the calendar.",
  "Allocate the pitch.",
  "Keep both teams informed.",
]

const FIXTURE = JOURNEY_FIXTURES[0]

export default async function FixturesPage() {
  const identity = await getPublicHeaderIdentity()
  const beta = await getBetaBadgeState()

  return (
    <>
      <Header identity={identity} beta={beta} />
      <main>
        {/* Product-led hero rather than another photograph: this page is
            about how the software behaves, and the fixture card makes that
            case from the first screen. */}
        <section className="bg-forest-950 pt-32 pb-20 md:pt-40 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    From request to kick-off
                  </p>
                  <h1 className="mt-4 font-display text-display-xl text-white text-balance">
                    Fixtures, without the chaos.
                  </h1>
                </Reveal>
                <Reveal index={1}>
                  <ul className="mt-6 space-y-1.5 text-base text-white/70 md:text-lg">
                    {HERO_STEPS.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-6 max-w-xl text-base text-white/70 md:text-lg">
                    Ovalball is designed so a fixture is organised once and stays connected across
                    the club.
                  </p>
                </Reveal>
                <Reveal index={3}>
                  <a
                    href="#how-it-works"
                    className="mt-9 inline-flex min-h-12 items-center rounded-lg bg-pitch-600 px-7 text-base font-medium text-ink transition-colors hover:bg-pitch-400 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                  >
                    See how it works
                  </a>
                </Reveal>
              </div>

              <Reveal index={1}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs tracking-[0.06em] text-white/60 uppercase">
                      {FIXTURE.competition}
                    </span>
                    <span className="rounded-full bg-pitch-600/15 px-2.5 py-1 text-xs font-medium text-pitch-400">
                      {FIXTURE.status}
                    </span>
                  </div>
                  <p className="mt-5 font-display text-2xl text-white">{FIXTURE.ourTeam}</p>
                  <p className="text-sm text-white/60">versus</p>
                  <p className="font-display text-2xl text-white">{FIXTURE.opponentTeam}</p>

                  <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/10 pt-5">
                    {[
                      ["Date", FIXTURE.date],
                      ["Kick-off", FIXTURE.kickoff],
                      ["Venue", FIXTURE.venue],
                      ["Pitch", FIXTURE.pitch],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs tracking-[0.04em] text-white/60 uppercase">{label}</dt>
                        <dd className="mt-1 text-sm text-white">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-5 text-[11px] tracking-[0.06em] text-white/60 uppercase">
                    Product preview &mdash; example data
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* One fixture, one record */}
        <section id="how-it-works" className="scroll-mt-24 bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                One fixture
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-ink text-balance">
                One fixture. One record. Everywhere it needs to be.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <div className="mt-6 grid max-w-4xl gap-4 text-[17px] leading-relaxed text-ink/75 md:grid-cols-2 md:gap-8">
                <p>
                  When a fixture changes, a club should not have to update five different systems.
                  One fixture should not become five different records.
                </p>
                <p>
                  The fixture in Fixture Management is the fixture that appears in the calendar. The
                  same fixture can feed pitch planning. The same fixture carries the relevant
                  conversation, and stays attached to the correct teams.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Interactive journey */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                The journey
              </p>
              <h2 className="mt-3 max-w-2xl font-display text-display-l text-white text-balance">
                Six stages, one rugby commitment.
              </h2>
              <p className="mt-4 max-w-xl text-base text-white/65 md:text-lg">
                The request, the conversation, the calendar entry and the pitch requirement all
                belong to the same fixture. Step through it.
              </p>
            </Reveal>
            <Reveal index={1} className="mt-10">
              <FixtureJourney />
            </Reveal>
          </div>
        </section>

        {/* Find it. Request it. Agree it. */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-12 border-t border-white/10 pt-20 lg:grid-cols-[1fr_1fr] lg:gap-16 md:pt-28">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Find it. Request it. Agree it.
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    A request that already knows who is playing.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-5 text-base text-white/70 md:text-lg">
                    Fixture organisation starts with the right club and the right team. Ovalball is
                    designed to make fixture requests structured from the beginning &mdash; who is
                    playing, when, where, and what still needs agreeing.
                  </p>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-4 text-base text-white/60">
                    Not a loose message with no shared context, where the reply arrives three days
                    later and nobody is sure which team it was about.
                  </p>
                </Reveal>
              </div>
              <Reveal index={1}>
                <FixtureRequestDemo />
              </Reveal>
            </div>
          </div>
        </section>

        <PhotoTransition
          src="/images/muddy-phone.png"
          alt="A muddy hand holding a phone at the side of a rugby pitch"
          line="Agreed once. In everyone's pocket."
        />

        {/* The connected demo: the page's central claim, operable. */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                Connected surfaces
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-white text-balance">
                Change the fixture. Watch everything else follow.
              </h2>
              <p className="mt-4 max-w-2xl text-base text-white/65 md:text-lg">
                These four panels are the same fixture seen from four places in Ovalball. Choose a
                different fixture and all four update together &mdash; which is the entire point.
              </p>
            </Reveal>
            <Reveal index={1} className="mt-10">
              <ConnectedFixtureDemo />
            </Reveal>
            <Reveal index={2}>
              <p className="mt-6 text-sm text-white/60">
                Product previews using example data. Club names, teams and messages shown here are
                fictitious.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Supporting stories */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 md:grid-cols-3">
              {[
                {
                  eyebrow: "Keep the conversation with the fixture",
                  body: "Changes happen. Kick-off moves, availability changes, venues need confirming. Ovalball keeps fixture-related communication connected to the fixture it belongs to, so the people responsible have the right context.",
                },
                {
                  eyebrow: "When it's agreed, everyone can see where it belongs",
                  body: "The agreed fixture flows into the calendar. Authorised users see it in the calendars relevant to their club, team or relationship — not a broadcast to everybody.",
                },
                {
                  eyebrow: "From fixture to pitch",
                  body: "For home fixtures, scheduling does not stop once the opposition is agreed. Ovalball connects the fixture with the club's pitch planning, so the people responsible for the ground can see what needs to be accommodated.",
                },
              ].map((item, i) => (
                <div key={item.eyebrow} className="bg-chalk p-7 md:p-8">
                  <Reveal index={i}>
                    <h3 className="font-display text-xl text-ink text-balance">{item.eyebrow}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-ink/70">{item.body}</p>
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <Reveal>
              <h2 className="font-display text-display-l text-white text-balance">
                Agree the game once.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mx-auto mt-5 max-w-xl text-base text-white/70 md:text-lg">
                Let the right people see the same information &mdash; on the calendar, in the
                conversation, and at the ground.
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
                  className="flex min-h-12 w-full items-center justify-center rounded-lg border border-white/20 px-7 text-base font-medium text-white transition-colors hover:border-white/45 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:w-auto"
                >
                  For Clubs
                </Link>
              </div>
            </Reveal>
            <Reveal index={3}>
              <p className="mt-8 text-sm text-white/60">
                Once the fixture is agreed, get the team ready &mdash;{" "}
                <Link
                  href="/game-management"
                  className="font-medium text-pitch-400 underline underline-offset-2 hover:text-pitch-300"
                >
                  see Game Management
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
