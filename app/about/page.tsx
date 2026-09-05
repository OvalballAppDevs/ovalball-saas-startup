import type { Metadata } from "next"
import Link from "next/link"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_ROUTE, OPERATOR_NAME, PRODUCT_NAME } from "@/lib/legal/metadata"

export const metadata: Metadata = {
  title: "About Us | Ovalball",
  description:
    "Ovalball is technology built for rugby — bringing the day-to-day organisation of club rugby into one connected place. Operated by Pipaxon Technologies Ltd.",
}

/**
 * What Ovalball can actually help with today.
 *
 * Deliberately written against the features that genuinely exist in the
 * live application rather than an aspirational roadmap: every entry below
 * corresponds to a real, shipped area of the product. Anything not yet
 * available is stated separately, in future-facing language, further down
 * the page -- a club evaluating Ovalball has to be able to trust this list.
 */
const CAPABILITIES: string[] = [
  "club and team administration",
  "fixtures, results and season calendars",
  "pitch and venue allocation",
  "Mini-Rugby age groups organised as a single operational unit",
  "players and team membership",
  "parents, guardians and the access they hold",
  "match-day attendance and availability",
  "player requests and moves between teams",
  "club communications and messaging",
  "club documents and information",
  "partner clubs and inter-club fixtures",
  "membership subscription administration",
]

const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "One connected club",
    body: "Information should not need to be re-entered into multiple disconnected systems. Enter something once and it should be there wherever the club needs it.",
  },
  {
    title: "Built around rugby",
    body: "Ovalball understands teams, age grades, fixtures, pitches, Mini-Rugby, players and guardians as rugby concepts — rather than forcing clubs to bend generic software into the shape of a rugby club.",
  },
  {
    title: "Appropriate access",
    body: "People should see the information they legitimately need for their role or relationship at the club, and not everything the club holds. Access follows the role, not the login.",
  },
  {
    title: "Designed for club communities",
    body: "Technology should make administration easier without getting in the way of the people and relationships that make rugby clubs work.",
  },
]

export default async function AboutPage() {
  const identity = await getPublicHeaderIdentity()

  return (
    <>
      <Header identity={identity} />
      <main className="brand-light-scope bg-chalk pt-32 pb-24 md:pt-40">
        <div className="mx-auto max-w-3xl px-4 md:px-8">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">About</p>
          <h1 className="mt-2 font-display text-display-l text-ink text-balance">
            {PRODUCT_NAME} is technology built for rugby.
          </h1>

          <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-ink/75">
            <p>
              We help rugby clubs bring the day-to-day organisation of club rugby into one connected
              place &mdash; from teams, fixtures and calendars to pitches, players, parents,
              guardians and club administration.
            </p>
            <p>
              Rugby clubs are communities. Behind every match are volunteers, coaches,
              administrators, parents and players coordinating countless details to make rugby
              happen. {PRODUCT_NAME} is being built to make that work simpler.
            </p>
            <p>
              Instead of important information being spread across spreadsheets, message threads,
              calendars and separate systems, {PRODUCT_NAME} connects the people and the information
              involved in running a rugby club.
            </p>
          </div>

          <section aria-labelledby="capabilities-heading" className="mt-14">
            <h2 id="capabilities-heading" className="font-display text-2xl text-ink">
              What {PRODUCT_NAME} helps with
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
              Depending on the features a club chooses to use, {PRODUCT_NAME} can help with areas
              such as:
            </p>
            <ul className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {CAPABILITIES.map((item) => (
                <li key={item} className="flex gap-2.5 text-[15px] leading-relaxed text-ink/80">
                  <span
                    aria-hidden="true"
                    className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-pitch-600"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[15px] leading-relaxed text-ink/70">
              Training sessions can be scheduled alongside fixtures in the club calendar today, with
              fuller training management to follow. Membership subscriptions can be administered in
              {" "}{PRODUCT_NAME} now; Direct Debit collection is supported in the product but is not
              yet switched on in the live service. We would rather say that plainly than imply a
              club can start collecting payments today.
            </p>
          </section>

          <section aria-labelledby="principles-heading" className="mt-14">
            <h2 id="principles-heading" className="font-display text-2xl text-ink">
              What we&apos;re building for
            </h2>
            <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-ink/10 bg-ink/10 sm:grid-cols-2">
              {PRINCIPLES.map((principle) => (
                <div key={principle.title} className="bg-white p-6">
                  <h3 className="font-display text-lg text-ink">{principle.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink/70">{principle.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="aim-heading" className="mt-14">
            <h2 id="aim-heading" className="font-display text-2xl text-ink">
              Our aim
            </h2>
            <p className="mt-3 text-[17px] leading-relaxed text-ink/75">
              Our aim is not to change what makes rugby clubs special. It is to reduce the
              administration around rugby, so that clubs can spend more time on the people, teams
              and communities that make the game possible.
            </p>
          </section>

          <section aria-labelledby="company-heading" className="mt-14 rounded-xl border border-ink/10 bg-white p-6 md:p-8">
            <h2 id="company-heading" className="font-display text-2xl text-ink">
              About {OPERATOR_NAME}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/75">
              {PRODUCT_NAME} is operated by {OPERATOR_NAME}, a technology company developing digital
              services designed to make complex administration simpler and more connected.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/75">
              You can reach us at{" "}
              <a
                href={CONTACT_MAILTO}
                className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              or through the{" "}
              <Link
                href={CONTACT_ROUTE}
                className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
              >
                contact page
              </Link>
              . How we handle information is set out in our{" "}
              <Link
                href="/legal"
                className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
              >
                Legal &amp; Trust
              </Link>{" "}
              area.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
