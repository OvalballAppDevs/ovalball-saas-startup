import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { activatedSentence, loadMembershipSetup, readMembershipPriceHistory, type MembershipPriceRow } from "@ovalball/contracts/membership/setup"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { connectNoticeText } from "@/lib/payments/gocardless/connect-notices"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../resolve-nav-capabilities"
import { getSiblingDiscountRules } from "./actions"
import { MembershipSettingsBoard, type BoardNotice } from "./membership-settings-board"
import { MembershipSetupJourney } from "./membership-setup-journey"

export const metadata = { title: "Club Memberships | Club Settings" }

/**
 * Club Settings > Subscriptions & Payments -- CLUB MEMBERSHIPS (Part 1, 20270748000000).
 *
 * One server answer decides what this page is: `membership_setup_state`, read as the signed-in person (it refuses
 * anybody without a finance permission at the club). A club that has not switched memberships on gets the setup
 * journey; a club that has gets Membership Settings. GoCardless is connected through the website's own OAuth routes
 * and no token, organisation id or bank detail ever reaches this page.
 */
export default async function ClubSubscriptionsSettingsPage({ searchParams }: { searchParams: Promise<{ gc_connected?: string; gc_error?: string; step?: string; activated?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const navCaps = await resolveClubSettingsNavCapabilities(supabase, clubId)
  const { canSubscriptionConfigure: canConfigure, canSubscriptionViewFinance: canViewFinance } = navCaps
  if (!clubId || (!canConfigure && !canViewFinance)) redirect("/club/settings")

  const clubName = activeContext.kind === "club" ? activeContext.label : "the club"
  const setup = await loadMembershipSetup(supabase, clubId).catch(() => null)
  const settingUp = !setup || setup.state === "NOT_STARTED" || setup.state === "SETTING_UP"

  const [history, siblingRules]: [MembershipPriceRow[], Awaited<ReturnType<typeof getSiblingDiscountRules>>] =
    setup?.programme && !settingUp ? await Promise.all([readMembershipPriceHistory(supabase, setup.programme.id).catch(() => []), getSiblingDiscountRules(setup.programme.id)]) : [[], []]

  // What GoCardless's return, or Activate, said: the journey shows it beside its buttons; Membership Settings shows
  // it in the section it is about (GoCardless's return in GoCardless, Activate in the status strip).
  const pricedTeams = setup ? setup.memberships.reduce((n, m) => n + (m.monthlyAmountMinor !== null ? m.teams.length : 0), 0) : 0
  const fromGoCardless = Boolean(params.gc_error || params.gc_connected)
  const initialNotice = params.gc_error
    ? ({ tone: "danger", text: connectNoticeText(params.gc_error)! } as const)
    : params.gc_connected
      ? ({ tone: "positive", text: "GoCardless is connected." } as const)
      : params.activated && setup?.state === "ACTIVE"
        ? ({
            tone: "positive",
            text: `${params.activated === "resumed" ? "Club Memberships are back on." : "Club Memberships are on."} ${activatedSentence(pricedTeams)} You can pause new memberships here at any time.`,
          } as const)
        : null
  const boardNotice: BoardNotice | null = initialNotice
    ? { where: fromGoCardless ? "gocardless" : "status", tone: initialNotice.tone === "danger" ? "error" : "ok", text: initialNotice.text }
    : null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">{settingUp ? "Club Memberships" : "Membership Settings"}</h1>
      {/* States the direction of money first, so a Club Admin looking for what the club pays Ovalball knows
          straight away that they want the Ovalball Plan tab instead. */}
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Members pay {clubName} by Direct Debit, through the club&rsquo;s own GoCardless account. Ovalball&rsquo;s fee is set here. What the club pays Ovalball for its own subscription is under Ovalball Plan.
      </p>

      <ClubSettingsNav active="subscriptions" {...navCaps} />

      {!setup ? (
        <p role="alert" className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
          Could not load the club&rsquo;s memberships. Refresh the page to try again.
        </p>
      ) : settingUp ? (
        <MembershipSetupJourney setup={setup} clubName={clubName} initialStep={params.step} initialNotice={initialNotice} />
      ) : (
        <MembershipSettingsBoard setup={setup} clubName={clubName} history={history} siblingRules={siblingRules} canEditSiblings={canConfigure} initialNotice={boardNotice} />
      )}

      {canViewFinance && (
        <section className="mt-10 border-t border-ink/10 pt-6">
          <Link href="/club/finance" className="text-sm font-medium text-forest-800 underline underline-offset-4 hover:text-forest-950">
            Open Memberships
          </Link>
        </section>
      )}
    </div>
  )
}
