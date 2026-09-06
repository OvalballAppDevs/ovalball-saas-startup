import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { AvailabilityDemo } from "@/components/site/availability-demo"
import { ConnectedGameVisual } from "@/components/site/connected-game-visual"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { getBetaBadgeState } from "@/lib/platform/mode"
import {
  BASELINE_COUNTS,
  DEMO_FIXTURE,
  DEMO_FIXTURE_UPDATES,
  POSITION_GROUPS,
} from "@/lib/marketing/game-day-demo"
import { Reveal } from "@/lib/motion/reveal"

export const metadata: Metadata = {
  title: "Rugby Game Management | Ovalball",
  description:
    "Keep coaches, players and families connected for game day with fixture information, player availability and team preparation in Ovalball.",
}

export default async function GameManagementPage() {
  const identity = await getPublicHeaderIdentity()
  const beta = await getBetaBadgeState()

  return (
    <>
      <Header identity={identity} beta={beta} />
      <main>
        {/* Hero */}
        <section className="relative flex min-h-[86vh] items-end overflow-hidden bg-forest-950 pb-16 md:min-h-screen md:pb-24">
          {/* team-huddle.png is the closest subject match but is only
              216x288 -- far too small to carry a full-bleed hero without
              visibly softening. playing-rugby.png is the match-day image in
              the bank at full resolution; it appears once on the homepage as
              a narrow band, and is cropped and graded differently here. */}
          <Image
            src="/images/playing-rugby.png"
            alt="Rugby players competing for the ball during a match, mud on their kit and supporters watching from the touchline"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[50%_30%]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-forest-950 via-forest-950/75 to-forest-950/30" />

          <div className="relative mx-auto w-full max-w-[1200px] px-4 md:px-8">
            <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_auto]">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Be ready before kick-off
                  </p>
                  <h1 className="mt-4 max-w-2xl font-display text-display-xl text-white text-balance">
                    Know your team before game day.
                  </h1>
                </Reveal>
                <Reveal index={1}>
                  <div className="mt-6 max-w-xl space-y-4 text-base text-white/75 md:text-lg">
                    <p>
                      A rugby match starts long before the whistle. Coaches need to know who is
                      available. Parents need the right information. Players need to know where they
                      need to be. Clubs need time to prepare.
                    </p>
                    <p>
                      Ovalball brings the people and information around a fixture together, so your
                      team can arrive ready.
                    </p>
                  </div>
                </Reveal>
              </div>

              <Reveal index={2}>
                <div className="rounded-2xl border border-white/12 bg-forest-950/75 p-6 backdrop-blur-sm md:w-80">
                  <p className="text-xs tracking-[0.06em] text-white/45 uppercase">
                    {DEMO_FIXTURE.date}
                  </p>
                  <p className="mt-3 font-display text-xl text-white">{DEMO_FIXTURE.ourTeam}</p>
                  <p className="text-sm text-white/50">versus</p>
                  <p className="font-display text-xl text-white">{DEMO_FIXTURE.opponentTeam}</p>

                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4">
                    {[
                      ["Kick-off", DEMO_FIXTURE.kickoff],
                      ["Venue", DEMO_FIXTURE.venue],
                      ["Pitch", DEMO_FIXTURE.pitch],
                      ["Status", DEMO_FIXTURE.status],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[11px] tracking-[0.04em] text-white/40 uppercase">{label}</dt>
                        <dd className="mt-0.5 text-sm text-white">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-[11px] tracking-[0.06em] text-white/40 uppercase">Availability</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      <li className="flex justify-between text-pitch-400">
                        <span>Attending</span>
                        <span className="tabular-nums">{BASELINE_COUNTS.ATTENDING}</span>
                      </li>
                      <li className="flex justify-between text-white/65">
                        <span>Can&apos;t attend</span>
                        <span className="tabular-nums">{BASELINE_COUNTS.CANNOT_ATTEND}</span>
                      </li>
                      <li className="flex justify-between text-amber-300">
                        <span>Unsure</span>
                        <span className="tabular-nums">{BASELINE_COUNTS.UNSURE}</span>
                      </li>
                      <li className="flex justify-between text-white/45">
                        <span>Awaiting response</span>
                        <span className="tabular-nums">{BASELINE_COUNTS.NO_RESPONSE}</span>
                      </li>
                    </ul>
                  </div>
                  <p className="mt-4 text-[11px] tracking-[0.06em] text-white/35 uppercase">
                    Product preview &mdash; example data
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* The game starts before the whistle */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                The game starts before the whistle
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-ink text-balance">
                Selecting a side shouldn&apos;t begin with chasing messages.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink/75">
                When availability is visible early, coaches and team managers can start planning
                properly instead of piecing a squad together from three different group chats on a
                Friday night.
              </p>
            </Reveal>
            <Reveal index={2}>
              <ul className="mt-8 grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
                {[
                  "Who is available?",
                  "Where might players fit?",
                  "Are there positions that need covering?",
                  "How many people are coming?",
                  "Does the club need to prepare food or facilities?",
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
                Ovalball gives the people organising the game a clearer picture before match day
                arrives.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Availability -- the central interaction */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                One tap. Everyone knows.
              </p>
              <h2 className="mt-3 max-w-2xl font-display text-display-l text-white text-balance">
                One response. Two views of the same game.
              </h2>
              <div className="mt-5 max-w-2xl space-y-4 text-base text-white/70 md:text-lg">
                <p>
                  For parents and eligible players, responding should be simple. Open the fixture,
                  choose Attending, Can&apos;t Attend or Unsure, and you&apos;re done.
                </p>
                <p>
                  The response is connected directly to that game, giving authorised team staff an
                  up-to-date picture of availability without anyone maintaining a separate list.
                </p>
              </div>
            </Reveal>
            <Reveal index={1} className="mt-10">
              <AvailabilityDemo />
            </Reveal>
          </div>
        </section>

        {/* Squad shape */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-12 border-t border-white/10 pt-20 lg:grid-cols-[1fr_1fr] lg:gap-16 md:pt-28">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    See the picture taking shape
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    Know the shape of the squad.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-5 text-base text-white/70 md:text-lg">
                    Availability is more useful when it helps coaches understand the squad they may
                    have. Instead of waiting until the last minute, authorised team staff can watch
                    the responses coming in and begin preparing for the game &mdash; numbers,
                    cover, travel, equipment.
                  </p>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
                    Ovalball shows you who is available. It does not pick your side &mdash; the
                    grouping below is an illustration of squad shape, not a team-selection tool.
                  </p>
                </Reveal>
              </div>

              <Reveal index={1}>
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-7">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium tracking-[0.06em] text-white/55 uppercase">
                      Squad shape
                    </p>
                    <p className="text-sm text-white/45">
                      <span className="font-medium text-pitch-400">{BASELINE_COUNTS.ATTENDING + 1}</span>{" "}
                      available &middot;{" "}
                      <span className="font-medium text-amber-300">{BASELINE_COUNTS.UNSURE}</span> unsure
                    </p>
                  </div>

                  <ul className="mt-5 flex flex-col gap-2">
                    {POSITION_GROUPS.map((group) => (
                      <li
                        key={group.label}
                        className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-4 py-3"
                      >
                        <span className="text-sm text-white/80">{group.label}</span>
                        <span className="flex items-center gap-1.5" aria-hidden="true">
                          {Array.from({ length: group.needed }).map((_, i) => (
                            <span key={i} className="size-2 rounded-full bg-pitch-600/70" />
                          ))}
                        </span>
                        <span className="sr-only">{group.needed} positions</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-white/40">
                    Illustration of the standard position groups in a rugby side.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Club preparation */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                More than team selection
              </p>
              <h2 className="mt-3 max-w-3xl font-display text-display-l text-ink text-balance">
                Numbers help the people behind the scenes.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <div className="mt-6 grid max-w-4xl gap-4 text-[17px] leading-relaxed text-ink/75 md:grid-cols-2 md:gap-8">
                <p>
                  Availability can matter well beyond the team sheet. Knowing expected numbers
                  earlier helps clubs prepare for the wider match day &mdash; from facilities and
                  volunteers to catering and hospitality.
                </p>
                <p>
                  Better information gives the people behind the scenes more time to prepare. The
                  club sees the numbers; the decisions stay with the people who know their own
                  clubhouse.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Everything they need for game day */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    Everything they need for game day
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    Updates that belong to the game.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-5 text-base text-white/70 md:text-lg">
                    When the pitch changes or the kick-off is confirmed, that update belongs to the
                    fixture &mdash; not to a message thread somebody has to remember to forward.
                  </p>
                </Reveal>
                <Reveal index={2}>
                  {/* The §21 distinction, made naturally rather than as a
                      disclaimer: two different audiences, two different
                      kinds of communication. */}
                  <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-sm font-medium text-white">
                      Two kinds of fixture communication
                    </p>
                    <p className="mt-2 text-sm text-white/65">
                      Clubs negotiating a fixture &mdash; kick-off, venue, confirmation &mdash; talk
                      in an operational conversation between authorised club and team staff.
                      Families and players receive the participant information that concerns them.
                      They are not the same thread, and parents do not see the club-to-club
                      negotiation.
                    </p>
                  </div>
                </Reveal>
              </div>

              <Reveal index={1}>
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-7">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium tracking-[0.06em] text-white/55 uppercase">
                      Fixture information
                    </p>
                    <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/40 uppercase">
                      Product preview
                    </span>
                  </div>
                  <p className="mt-4 text-sm text-white/60">
                    {DEMO_FIXTURE.ourTeam} v {DEMO_FIXTURE.opponentTeam}
                  </p>

                  <ul className="mt-4 flex flex-col gap-2.5">
                    {DEMO_FIXTURE_UPDATES.map((update) => (
                      <li key={update.text} className="rounded-lg bg-white/[0.03] px-4 py-3">
                        <p className="text-[11px] tracking-[0.04em] text-white/40 uppercase">
                          {update.meta}
                        </p>
                        <p className="mt-1 text-sm text-white/85">{update.text}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-white/40">
                    Shown to the families and players involved in this fixture.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Connected game */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="border-t border-white/10 pt-20 md:pt-28">
              <Reveal>
                <h2 className="max-w-3xl font-display text-display-l text-white text-balance">
                  One game. Everyone who needs it, connected.
                </h2>
                <p className="mt-5 max-w-2xl text-base text-white/70 md:text-lg">
                  The fixture should not live in one place, availability in another and important
                  updates somewhere else. Ovalball keeps the game connected to the people
                  responsible for organising, playing and supporting it.
                </p>
              </Reveal>
              <Reveal index={1} className="mt-10">
                <ConnectedGameVisual />
              </Reveal>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <Reveal>
              <h2 className="font-display text-display-l text-ink text-balance">
                Ready before kick-off
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mx-auto mt-5 max-w-xl text-base text-ink/70 md:text-lg">
                Give coaches, players and families one connected place for game day.
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
                  href="/fixtures"
                  className="flex min-h-12 w-full items-center justify-center rounded-lg border border-ink/20 px-7 text-base font-medium text-ink transition-colors hover:border-ink/45 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:w-auto"
                >
                  See how the fixture gets organised
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
