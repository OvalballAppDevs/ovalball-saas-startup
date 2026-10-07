import { Redirect } from "expo-router"

/**
 * PROGRAMME & PRICING BECAME MEMBERSHIP SETTINGS (Club Memberships Part 1).
 *
 * One place now holds what this screen held -- collection day, first payment and its worked example, prices on an
 * effective-dated schedule with their history, sibling discounts, the view-only summary -- with what the club
 * memberships model added: several memberships assigned by team, who pays Ovalball's fee, and whether new memberships
 * are being taken. An old link to this screen lands there; a club that has not switched memberships on yet lands in
 * the setup journey instead.
 */
export default function ProgrammeAndPricingMoved() {
  return <Redirect href={"/admin/subscriptions/settings" as never} />
}
