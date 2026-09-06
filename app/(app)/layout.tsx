import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, listSwitchableContexts, resolveActiveContext } from "@/lib/app-context/active-context"
import { buildNavItems, buildSiteAdminSections } from "@/lib/app-context/build-nav-items"
import { getConversationSummaries } from "@/lib/app-context/conversations"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getRecentNotifications } from "@/lib/app-context/notifications"
import { resolvePersonalAvatarUrl } from "@/lib/app-context/personal-avatar"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getClubSetupState, isSetupAllowedPath, resumeStep } from "@/lib/club-setup/state"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { getNewSupportTicketCount, getSupportUnreadCount } from "@/lib/support/badges"
import { createClient } from "@/lib/supabase/server"

import { AskOvie } from "@/components/ovie/ask-ovie"
import { BetaBadge } from "@/components/platform/beta-badge"

import { AppMobileNav } from "./app-mobile-nav"
import { AppNav } from "./app-nav"
import { ContextSwitchOverlay } from "./context-switch-overlay"
import { ClubSetupRequired } from "./club-setup-required"
import { DiagnosticBanner } from "./diagnostic-banner"
import { SwitchContextProvider } from "./switch-context-provider"

/**
 * Guards every route in this group: authenticated + at least one active
 * club membership or Site Admin status required, or this redirects to
 * /welcome (the existing pending-state page, unchanged). This is a
 * convenience redirect for a good UX, not the actual security boundary --
 * every page/action underneath still hits its own RLS policy or
 * SECURITY DEFINER function regardless of whether someone reached it
 * through this guard.
 */
export default async function AuthenticatedAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const ctx = await getSessionContext(supabase, user)

  // A pure Guardian and/or Player (no club_memberships row at all -- never
  // having joined a club as a general member, only ever registered as a
  // parent/player through the canonical Player/Guardian graph) is just as
  // legitimate an entry as a club member. Found live this pass: a
  // Guardian-only account was being bounced to /welcome ("we don't have a
  // club request on file yet"), which is both confusing and wrong -- they
  // have a real, canonical relationship, just not a club_memberships row.
  const hasAnyRealRelationship =
    ctx.clubMemberships.length > 0 || ctx.teamPermissions.length > 0 || ctx.guardianRelationships.length > 0 || ctx.linkedPlayerTeams.length > 0
  if (!ctx.isSiteAdmin && !hasAnyRealRelationship) {
    redirect("/welcome")
  }

  const cookieStore = await cookies()
  const contexts = listSwitchableContexts(ctx)
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const { primary, roleLabel, clubName, clubLogoUrl } = buildNavItems(ctx, activeContext)
  const [{ items: notifications, unreadCount }, conversations, supportUnreadCount, newSupportTicketCount, { data: profile }, diagnosticClub, betaState] =
    await Promise.all([
      getRecentNotifications(supabase, user.id),
      getConversationSummaries(supabase, ctx, user.id),
      getSupportUnreadCount(supabase, user.id),
      ctx.isSiteAdmin ? getNewSupportTicketCount(supabase) : Promise.resolve(0),
      supabase.from("profiles").select("first_name, surname, avatar_storage_path").eq("id", user.id).maybeSingle(),
      ctx.isSiteAdmin ? resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null) : Promise.resolve(null),
      getBetaBadgeState(supabase),
    ])

  // ---------------------------------------------------------------
  // First-run activation gate.
  //
  // A club that has not finished setup is not usable: no logo, no home
  // venue, no pitch, no confirmed teams. An authorized Club Admin is sent to
  // finish it; anyone else is shown a bounded explanation rather than a
  // half-working application or an unexplained blank page.
  //
  // Enforced here, on the server, rather than by a dismissible client modal
  // -- and never on a path the gate itself needs, so it cannot loop. Account,
  // support and context switching stay reachable throughout, because being
  // asked to finish setup must not mean being unable to sign out or move to
  // a different club.
  //
  // Clubs that pre-date this lifecycle were grandfathered COMPLETED, so no
  // working club is ever gated by its introduction.
  // ---------------------------------------------------------------
  const pathname = (await headers()).get("x-ovalball-pathname") ?? ""
  let setupGate: { clubName: string; canComplete: boolean } | null = null
  let setupInProgress = false

  // Resolved from the context's CLUB, not from its kind. A Team Admin,
  // coach, parent and player at an unset-up club are looking at the same
  // empty application a Club Admin would be -- no venues, no pitches, an
  // unconfirmed team list -- and every one of those contexts carries the
  // club it belongs to. Keying the gate on `kind === "club"` had meant only
  // a Fixture Secretary ever saw the explanation.
  const contextClubId = activeContext.clubId ?? (activeContext.kind === "club" ? activeContext.id : null)

  if (contextClubId && !diagnosticClub) {
    const setup = await getClubSetupState(supabase, contextClubId)
    if (setup && setup.status !== "COMPLETED") {
      const canComplete = await hasCapability(supabase, "club.edit_profile", "club", { clubId: contextClubId })
      if (canComplete) {
        if (!isSetupAllowedPath(pathname)) {
          redirect(`/club/setup?step=${resumeStep(setup.requirements)}`)
        }
        setupInProgress = true
      } else if (!isSetupAllowedPath(pathname)) {
        // No redirect: a coach has nowhere useful to be sent. The shell still
        // renders, so they keep their nav, their context switcher and their
        // way out.
        //
        // The club's own name, read from the directory -- NOT the nav's
        // `clubName`, which is the active context's label and in a team
        // context is the team. "Men's 1st isn't ready yet" told a coach the
        // wrong thing was unfinished.
        const { data: gateClub } = await supabase
          .from("clubs")
          .select("slug, club_directory(name)")
          .eq("id", contextClubId)
          .maybeSingle()
        setupGate = {
          clubName: gateClub?.club_directory?.name ?? gateClub?.slug ?? "This club",
          canComplete: false,
        }
      }
    }
  }

  const personName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ")
  const personAvatarUrl = resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path)

  const primaryWithBadges = primary.map((item) =>
    item.href === "/admin/support" && newSupportTicketCount > 0 ? { ...item, badge: newSupportTicketCount } : item
  )

  // While a Club Admin is finishing setup, the nav shows only what the gate
  // will actually let them open. Offering Fixtures and Calendar during
  // onboarding produced links that silently bounced back to the wizard,
  // which reads as a broken app rather than a deliberate sequence. The
  // context switcher, notifications and account menu are part of AppNav's
  // own chrome and are untouched, so a multi-club person can still leave.
  const navPrimary = setupInProgress
    ? [
        { href: "/club/setup", label: "Set up your club" },
        ...primaryWithBadges.filter((item) => isSetupAllowedPath(item.href)),
      ]
    : primaryWithBadges

  // Grouping is applied to the ALREADY capability-filtered list, and only in
  // a Site Admin context -- Club/Team/Parent/Player keep their existing flat
  // navigation untouched. Both the sidebar and the drawer receive the same
  // two structures, so the two surfaces cannot drift into different
  // taxonomies.
  const { top: navTop, sections: navSections } =
    activeContext.kind === "site_admin"
      ? buildSiteAdminSections(navPrimary)
      : { top: [] as typeof navPrimary, sections: [] }

  return (
    <SwitchContextProvider>
      <div className="flex min-h-screen flex-col bg-chalk">
        {/* ONE Beta indicator for every authenticated role -- Site Admin,
            Club Admin, Team Admin, Parent and Player all render through this
            shell, so none of them needs its own. Renders nothing at all when
            the platform is Live. */}
        {betaState.mode === "beta" && (
          <div className="flex justify-center border-b border-purple-200 bg-purple-50 px-4 py-1.5">
            <BetaBadge state={betaState} />
          </div>
        )}
        {diagnosticClub && <DiagnosticBanner diagnosticClub={diagnosticClub} />}
        <div className="flex flex-1 flex-col md:flex-row">
          <div className="hidden md:block">
            <AppNav
              primaryItems={navPrimary}
              top={navTop}
              sections={navSections}
              contexts={contexts}
              activeKey={activeContext.key}
              identityKind={activeContext.kind}
              clubName={clubName}
              clubLogoUrl={clubLogoUrl}
              roleLabel={roleLabel}
              personName={personName}
              personAvatarUrl={personAvatarUrl}
              notifications={notifications}
              unreadCount={unreadCount}
              conversations={conversations}
              supportUnreadCount={supportUnreadCount}
            />
          </div>
          <AppMobileNav
            primaryItems={navPrimary}
            top={navTop}
            sections={navSections}
            contexts={contexts}
            activeKey={activeContext.key}
            identityKind={activeContext.kind}
            clubName={clubName}
            clubLogoUrl={clubLogoUrl}
            roleLabel={roleLabel}
            personName={personName}
            personAvatarUrl={personAvatarUrl}
            notifications={notifications}
            unreadCount={unreadCount}
            conversations={conversations}
            supportUnreadCount={supportUnreadCount}
          />
          <main className="relative min-w-0 flex-1">
            {setupGate ? <ClubSetupRequired clubName={setupGate.clubName} /> : children}
            <ContextSwitchOverlay />
          </main>
        </div>
        <AskOvie />
      </div>
    </SwitchContextProvider>
  )
}
