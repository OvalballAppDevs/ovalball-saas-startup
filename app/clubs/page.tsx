import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { ConnectedClubsVisual } from "@/components/site/connected-clubs-visual"
import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { PartnerWall } from "@/components/site/partner-wall"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { Reveal } from "@/lib/motion/reveal"

export const metadata: Metadata = {
  title: "Rugby Clubs & Communities | Ovalball",
  description:
    "Discover how Ovalball helps rugby clubs, teams and communities stay connected through better organisation, communication and grassroots rugby technology.",
}

const CONNECTION_PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "Connected clubs",
    body: "Fixtures are requested between real clubs and real teams, so both sides know from the start who they are arranging a game with.",
  },
  {
    title: "Connected teams",
    body: "The right teams are attached to the right activity, so an age group's fixtures, training and calendar belong to that age group.",
  },
  {
    title: "Connected communication",
    body: "Fixture conversations stay attached to the fixture instead of scattering across separate message threads.",
  },
  {
    title: "Connected families",
    body: "Parents and players see the information relevant to them and their own team, rather than everything the club holds.",
  },
  {
    title: "Connected operations",
    body: "Calendar, pitches, training and fixtures work from the same underlying records, so agreeing something once is enough.",
  },
]

export default async function ClubsPage() {
  const identity = await getPublicHeaderIdentity()

  return (
    <>
      <Header identity={identity} />
      <main>
        {/* Hero: the strongest human image in the bank, used once, at full
            bleed. Two teammates walking off toward a lit clubhouse says
            "club" faster than any headline can. */}
        <section className="relative flex min-h-[86vh] items-end overflow-hidden bg-forest-950 pb-16 md:min-h-screen md:pb-24">
          <Image
            src="/images/arms-round.png"
            alt="Two muddy teammates walking off the pitch arm in arm in the rain, heading towards a lit clubhouse"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[50%_35%]"
          />
          {/* Gradient rather than a flat scrim: the top stays photographic,
              the bottom carries the type. */}
          <div className="absolute inset-0 bg-gradient-to-t from-forest-950 via-forest-950/70 to-forest-950/25" />

          <div className="relative mx-auto w-full max-w-[1200px] px-4 md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                The heart of the game
              </p>
              <h1 className="mt-4 max-w-3xl font-display text-display-xl text-white text-balance">
                Rugby starts with its clubs.
              </h1>
            </Reveal>
            <Reveal index={1}>
              <div className="mt-6 max-w-2xl space-y-4 text-base text-white/75 md:text-lg">
                <p>
                  Before the stadiums, the television cameras and the biggest stages in the game,
                  there is a rugby club. Grassroots rugby brings together players, coaches,
                  volunteers, parents, families and communities from every background &mdash;
                  connected by a shared love of the game.
                </p>
                <p>
                  Ovalball is being built to help those clubs stay connected, communicate clearly
                  and organise rugby without losing sight of what matters most: the people who make
                  the game possible.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* More than a team: image and layered text, on chalk so the page
            breathes after the dark hero. */}
        <section className="bg-chalk py-20 md:py-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
              <Reveal variant="wipe" className="relative aspect-[4/5] overflow-hidden rounded-2xl">
                <Image
                  src="/images/club-house.png"
                  alt="Players and supporters laughing together in a clubhouse after a match, still muddy from the pitch"
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
              </Reveal>

              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                    More than a team
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-ink text-balance">
                    A club is the people who keep it going.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <p className="mt-6 text-[17px] leading-relaxed text-ink/75">
                    A rugby club is more than the players who take the field.
                  </p>
                </Reveal>
                {/* Deliberately its own rhythm: short lines, one role each,
                    because that is how the list actually reads out loud. */}
                <Reveal index={2}>
                  <ul className="mt-5 space-y-2.5 border-l-2 border-pitch-600/40 pl-5 text-[17px] leading-relaxed text-ink/75">
                    <li>Coaches giving their time.</li>
                    <li>Parents getting players to training.</li>
                    <li>Volunteers preparing pitches and opening clubhouses.</li>
                    <li>Administrators arranging fixtures.</li>
                    <li>Supporters standing on touchlines in every kind of weather.</li>
                  </ul>
                </Reveal>
                <Reveal index={3}>
                  <p className="mt-6 text-[17px] leading-relaxed text-ink/75">
                    It is a place where generations meet and communities grow &mdash; where the
                    same faces turn up on a wet Sunday morning, season after season, because the
                    club matters to them.
                  </p>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* Grassroots: dark, centred, type-led. No photograph here on
            purpose -- the two strongest images sit either side of it, and a
            third would dilute both. */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <Reveal>
              <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                Every rugby story starts somewhere
              </p>
              <h2 className="mt-3 font-display text-display-l text-white text-balance">
                Grassroots rugby is where the game begins.
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mx-auto mt-6 max-w-xl text-base text-white/70 md:text-lg">
                Every international player, professional name and lifelong rugby supporter started
                with the same fundamentals:
              </p>
            </Reveal>
            <Reveal index={2}>
              <ul className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-3 gap-y-3">
                {["a club", "a team", "a coach", "a training night", "a fixture", "people willing to make it happen"].map(
                  (item) => (
                    <li
                      key={item}
                      className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm text-white/80"
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            </Reveal>
            <Reveal index={3}>
              <p className="mx-auto mt-8 max-w-xl text-base text-white/70 md:text-lg">
                Ovalball exists for that level of the game &mdash; the clubs and communities that
                create rugby&rsquo;s future.
              </p>
            </Reveal>
          </div>
        </section>

        {/* The handshake: two opposing clubs, which is exactly the argument
            the next section makes. Used as the transition into it. */}
        <section className="relative flex h-[52vh] min-h-[340px] items-center justify-center overflow-hidden bg-forest-950 md:h-[62vh]">
          <Image
            src="/images/handshake.png"
            alt="Two players from opposing clubs shaking hands in the rain after a match, the clubhouse lit behind them"
            fill
            sizes="100vw"
            className="object-cover object-[50%_40%]"
          />
          <div className="absolute inset-0 bg-forest-950/55" />
          <Reveal className="relative max-w-2xl px-4 text-center">
            <p className="font-display text-display-l text-white text-balance">
              Opposition becomes familiar faces.
            </p>
          </Reveal>
        </section>

        {/* Connected clubs: the turn from story into product philosophy. */}
        <section className="bg-forest-950 pb-20 md:pb-28">
          <div className="mx-auto max-w-[1200px] px-4 md:px-8">
            <div className="grid items-center gap-14 pt-20 md:pt-28 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
              <div>
                <Reveal>
                  <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
                    A more connected game
                  </p>
                  <h2 className="mt-3 font-display text-display-l text-white text-balance">
                    Fixtures do not happen in isolation.
                  </h2>
                </Reveal>
                <Reveal index={1}>
                  <ul className="mt-6 space-y-2.5 text-base text-white/70 md:text-lg">
                    <li>Clubs need to find each other.</li>
                    <li>Team administrators need to communicate.</li>
                    <li>Coaches need accurate information.</li>
                    <li>Parents need to know what is happening.</li>
                    <li>Venues and pitches need organising.</li>
                    <li>Changes need to reach the right people quickly.</li>
                  </ul>
                </Reveal>
                <Reveal index={2}>
                  <p className="mt-6 text-base text-white/70 md:text-lg">
                    Ovalball gives clubs a common place to connect those conversations, instead of
                    every club working alone and hoping the other one saw the message.
                  </p>
                </Reveal>
              </div>

              <Reveal index={1}>
                <ConnectedClubsVisual />
              </Reveal>
            </div>

            <Reveal>
              <h3 className="mt-20 font-display text-2xl text-white md:mt-28">
                What being connected actually means
              </h3>
            </Reveal>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {CONNECTION_PRINCIPLES.map((principle, i) => (
                <li key={principle.title} className="bg-forest-950 p-6 md:p-7">
                  <Reveal index={i}>
                    <h4 className="font-display text-lg text-white">{principle.title}</h4>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/65">{principle.body}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PartnerWall />

        {/* CTA */}
        <section className="bg-forest-950 py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <Reveal>
              <h2 className="font-display text-display-l text-white text-balance">
                Bring your club into Ovalball
              </h2>
            </Reveal>
            <Reveal index={1}>
              <p className="mx-auto mt-5 max-w-xl text-base text-white/70 md:text-lg">
                From fixtures and team communication to calendars, pitches, training and club
                administration, Ovalball is being designed around the way rugby clubs actually
                work.
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
                  className="flex min-h-12 w-full items-center justify-center rounded-lg border border-white/20 px-7 text-base font-medium text-white transition-colors hover:border-white/45 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:w-auto"
                >
                  Explore Fixtures
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
