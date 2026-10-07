import { redirect } from "next/navigation"

/**
 * `/fixtures/<id>/result` -- THE RESULT ADDRESS every fixture-result notification and result job
 * carries (`notificationHref`, the team and club attention projections).
 *
 * On the website the confirm / dispute / revise panel (`FixtureResultPanel`) lives at the top of the
 * fixture's own thread, which every club participant can open; this address sends the person straight
 * there rather than to the Match Centre, which shows only a final score, or to Fixture Management,
 * which is about kick-off, venue and teams. The phone renders its own Result screen at the same
 * address. Whether the viewer may see or act on the result is decided again by that page and by
 * `submit_fixture_result`; the address grants nothing.
 */
export default async function FixtureResultAddress({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params
  redirect(`/messages/fixture/${encodeURIComponent(fixtureId)}`)
}
