"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, Menu, Settings, X } from "lucide-react"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { OvalballMark } from "@/components/brand/ovalball-mark"
import { ClubAvatar } from "@/components/club/club-avatar"
import { UserAvatar } from "@/components/profile/user-avatar"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { ActiveContextKind, SwitchableContext } from "@/lib/app-context/active-context"
import type { ConversationSummary } from "@/lib/app-context/conversations"
import { resolveContextSettingsLink, resolveIdentityDisplay } from "@/lib/app-context/identity-display"
import type { NotificationItem } from "@/lib/app-context/notifications"
import { cn } from "@/lib/utils"

import type { NavSection } from "@/lib/app-context/build-nav-items"

import type { NavItem } from "./app-nav"
import { MessagesPopover } from "./messages-popover"
import { NavSections } from "./nav-sections"
import { NotificationBell } from "./notification-bell"
import { SupportButton } from "./support-button"
import { useSwitchContextState } from "./switch-context-provider"

interface AppMobileNavProps {
  primaryItems: NavItem[]
  /** Site Admin only: ungrouped top-level items (Dashboard). Empty elsewhere. */
  top: NavItem[]
  /** Site Admin only: the grouped taxonomy. Empty elsewhere, which selects the flat list. */
  sections: NavSection[]
  contexts: SwitchableContext[]
  activeKey: string
  identityKind: ActiveContextKind
  clubName: string
  clubLogoUrl: string | null
  roleLabel: string
  personName: string
  personAvatarUrl: string | null
  notifications: NotificationItem[]
  unreadCount: number
  conversations: ConversationSummary[]
  supportUnreadCount: number
}

/**
 * Mobile-only top bar + slide-out menu -- the brief's "do NOT shrink
 * desktop tables, create responsive mobile-specific presentations"
 * applied to navigation itself: this is a different layout, not the
 * sidebar squeezed into a smaller box.
 */
export function AppMobileNav({
  primaryItems,
  top,
  sections,
  contexts,
  activeKey,
  identityKind,
  clubName,
  clubLogoUrl,
  roleLabel,
  personName,
  personAvatarUrl,
  notifications,
  unreadCount,
  conversations,
  supportUnreadCount,
}: AppMobileNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Controlled, so a link inside the scroll region can dismiss the drawer.
  // The links are no longer wrapped in SheetClose: nesting a Link inside
  // SheetClose's render prop made every nav row two overlapping controls,
  // which is exactly the sort of thing that produced the gear/X collision.
  const close = useCallback(() => setOpen(false), [])
  const { switchTo, isPending } = useSwitchContextState()
  const active = contexts.find((c) => c.key === activeKey) ?? null
  const settingsLink = resolveContextSettingsLink(identityKind, active?.id ?? null, clubName)
  const identity = resolveIdentityDisplay(identityKind, { contextLabel: clubName, roleLabel, personName })

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between border-b border-forest-950/10 bg-forest-950 px-4 py-3 md:hidden">
      <OvalballLogo variant="dark" />
      <div className="flex items-center gap-1">
        <MessagesPopover conversations={conversations} variant="dark" />
        <NotificationBell initialItems={notifications} initialUnreadCount={unreadCount} variant="dark" />
        <SupportButton unreadCount={supportUnreadCount} variant="dark" />
        <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" />}
        >
          <Menu className="size-5" />
          <span className="sr-only">Open menu</span>
        </SheetTrigger>
        {/* The Sheet's own absolutely-positioned close button is switched OFF
            and replaced by one laid out in the header row below. That is the
            fix for the reported collision: the built-in X sits at
            `absolute top-3 right-3`, which landed directly on top of the
            settings gear (the last child of a `p-4` header row). Two
            controls, one position. Laying both out in the same flex row
            makes overlap structurally impossible rather than tuned away. */}
        <SheetContent
          side="right"
          showCloseButton={false}
          // Width comes from the primitive's own data-[side=right]:w-3/4,
          // which beats a plain w-* utility -- so no width class here that
          // would look meaningful and do nothing.
          className="gap-0 bg-forest-950 p-0 text-chalk"
        >
          {/* ---------- fixed header: identity, gear, close ---------- */}
          <SheetHeader className="shrink-0 gap-0 border-b border-white/10 p-0">
            <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
              {identity.avatarKind === "club" ? (
                <ClubAvatar logoUrl={clubLogoUrl} name={clubName} size="sm" variant="dark" />
              ) : identity.avatarKind === "brand" ? (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10">
                  <OvalballMark variant="dark" className="h-4 w-6" />
                </div>
              ) : (
                <UserAvatar avatarUrl={personAvatarUrl} name={personName} size="sm" variant="dark" />
              )}

              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate font-display text-lg tracking-wide text-chalk">
                  {identity.nameLabel}
                </SheetTitle>
                <p className="truncate text-xs text-white/60">{identity.subLabel}</p>
              </div>

              {/* Gear and close are siblings with a real gap. Both are 44px
                  square touch targets -- the visual icon stays small, the
                  pressable area does not. */}
              {settingsLink && (
                <SheetClose
                  nativeButton={false}
                  render={
                    <Link
                      href={settingsLink.href}
                      aria-label={settingsLink.ariaLabel}
                      title={settingsLink.ariaLabel}
                      className="flex size-11 shrink-0 items-center justify-center rounded-md text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
                    />
                  }
                >
                  <Settings className="size-5" />
                </SheetClose>
              )}

              <SheetClose
                nativeButton={true}
                render={
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
                  />
                }
              >
                <X className="size-5" />
              </SheetClose>
            </div>
          </SheetHeader>

          {/* ---------- scrollable region: contexts + navigation ----------
              min-h-0 is what actually makes this work: without it a flex
              child refuses to shrink below its content height, the overflow
              never engages, and the tail of a long Site Admin nav is simply
              unreachable -- which is the reported bug. overscroll-contain
              stops the page behind the drawer taking over the scroll. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
          {contexts.length > 1 && (
            <div className="border-b border-white/10 px-2 pt-3 pb-2">
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-white/60 uppercase">Switch context</p>
              <div className="flex flex-col gap-1">
                {contexts.map((c) => (
                  <SheetClose
                    key={c.key}
                    nativeButton={true}
                    render={
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => switchTo(c.key)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:bg-white/10 focus-visible:text-white disabled:opacity-60",
                          c.key === activeKey ? "bg-pitch-600/15 text-pitch-400" : "text-white/85 hover:bg-white/10 hover:text-white"
                        )}
                      />
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.label}</span>
                      <span className="block text-xs text-white/60">{c.roleLabel}</span>
                    </span>
                    {c.key === activeKey && <Check className="size-4 shrink-0" />}
                  </SheetClose>
                ))}
              </div>
            </div>
          )}
          <nav aria-label="Main" className="px-2 py-2">
            {sections.length > 0 ? (
              // Site Admin: the same grouped taxonomy the desktop sidebar
              // renders, not a mobile-only alternative.
              <NavSections top={top} sections={sections} size="mobile" onNavigate={close} />
            ) : (
              <div className="flex flex-col gap-1">
                {primaryItems.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                        active ? "bg-pitch-600/15 text-pitch-400" : "text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {!!item.badge && (
                        <span className="ml-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
                          {item.badge > 9 ? "9+" : item.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}

            <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
              <Link
                href="/account"
                onClick={close}
                className="rounded-md px-3 py-3 text-base text-white/70 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Profile
              </Link>
              <Link
                href="/support"
                onClick={close}
                className="rounded-md px-3 py-3 text-base text-white/70 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Support
              </Link>
            </div>
          </nav>
          </div>
        </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
