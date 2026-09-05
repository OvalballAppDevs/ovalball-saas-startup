import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, listSwitchableContexts, resolveActiveContext } from "@/lib/app-context/active-context"
import { buildNavItems } from "@/lib/app-context/build-nav-items"
import { getConversationSummaries } from "@/lib/app-context/conversations"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getRecentNotifications } from "@/lib/app-context/notifications"
import { resolvePersonalAvatarUrl } from "@/lib/app-context/personal-avatar"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getNewSupportTicketCount, getSupportUnreadCount } from "@/lib/support/badges"
import { createClient } from "@/lib/supabase/server"

import { AskOvie } from "@/components/ovie/ask-ovie"

import { AppMobileNav } from "./app-mobile-nav"
import { AppNav } from "./app-nav"
import { ContextSwitchOverlay } from "./context-switch-overlay"
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
  const [{ items: notifications, unreadCount }, conversations, supportUnreadCount, newSupportTicketCount, { data: profile }, diagnosticClub] =
    await Promise.all([
      getRecentNotifications(supabase, user.id),
      getConversationSummaries(supabase, ctx, user.id),
      getSupportUnreadCount(supabase, user.id),
      ctx.isSiteAdmin ? getNewSupportTicketCount(supabase) : Promise.resolve(0),
      supabase.from("profiles").select("first_name, surname, avatar_storage_path").eq("id", user.id).maybeSingle(),
      ctx.isSiteAdmin ? resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null) : Promise.resolve(null),
    ])

  const personName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ")
  const personAvatarUrl = resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path)

  const primaryWithBadges = primary.map((item) =>
    item.href === "/admin/support" && newSupportTicketCount > 0 ? { ...item, badge: newSupportTicketCount } : item
  )

  return (
    <SwitchContextProvider>
      <div className="flex min-h-screen flex-col bg-chalk">
        {diagnosticClub && <DiagnosticBanner diagnosticClub={diagnosticClub} />}
        <div className="flex flex-1 flex-col md:flex-row">
          <div className="hidden md:block">
            <AppNav
              primaryItems={primaryWithBadges}
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
            primaryItems={primaryWithBadges}
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
            {children}
            <ContextSwitchOverlay />
          </main>
        </div>
        <AskOvie />
      </div>
    </SwitchContextProvider>
  )
}
