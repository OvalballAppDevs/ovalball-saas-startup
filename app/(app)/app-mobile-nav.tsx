"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, Menu, Settings } from "lucide-react"

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

import type { NavItem } from "./app-nav"
import { MessagesPopover } from "./messages-popover"
import { NotificationBell } from "./notification-bell"
import { SupportButton } from "./support-button"
import { useSwitchContextState } from "./switch-context-provider"

interface AppMobileNavProps {
  primaryItems: NavItem[]
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
        <Sheet>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" />}
        >
          <Menu className="size-5" />
          <span className="sr-only">Open menu</span>
        </SheetTrigger>
        <SheetContent side="right" className="bg-forest-950 text-chalk">
          <SheetHeader>
            <div className="flex items-center gap-2.5">
              {identity.avatarKind === "club" ? (
                <ClubAvatar logoUrl={clubLogoUrl} name={clubName} size="sm" variant="dark" />
              ) : identity.avatarKind === "brand" ? (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10">
                  <OvalballMark variant="dark" className="h-4 w-6" />
                </div>
              ) : (
                <UserAvatar avatarUrl={personAvatarUrl} name={personName} size="sm" variant="dark" />
              )}
              <SheetTitle className="min-w-0 flex-1 truncate font-display text-lg tracking-wide text-chalk">{identity.nameLabel}</SheetTitle>
              {settingsLink && (
                <SheetClose
                  nativeButton={false}
                  render={
                    <Link
                      href={settingsLink.href}
                      aria-label={settingsLink.ariaLabel}
                      title={settingsLink.ariaLabel}
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-white/40 outline-none transition-colors hover:bg-white/5 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
                    />
                  }
                >
                  <Settings className="size-4" />
                </SheetClose>
              )}
            </div>
          </SheetHeader>
          <p className="px-4 -mt-2 text-xs text-white/50">{identity.subLabel}</p>
          {contexts.length > 1 && (
            <div className="border-b border-white/10 px-2 pt-3 pb-2">
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-white/40 uppercase">Switch context</p>
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
                      <span className="block text-xs text-white/40">{c.roleLabel}</span>
                    </span>
                    {c.key === activeKey && <Check className="size-4 shrink-0" />}
                  </SheetClose>
                ))}
              </div>
            </div>
          )}
          <nav className="flex flex-col gap-1 px-2 pt-2">
            {primaryItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <SheetClose
                  key={item.href}
                  nativeButton={false}
                  render={
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-3 text-base outline-none transition-colors focus-visible:bg-white/10 focus-visible:text-white",
                        active ? "bg-pitch-600/15 text-pitch-400" : "text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    />
                  }
                >
                  <span className="flex items-center justify-between">
                    {item.label}
                    {!!item.badge && (
                      <span className="ml-2 flex size-5 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </span>
                </SheetClose>
              )
            })}
            <SheetClose
              nativeButton={false}
              render={
                <Link
                  href="/account"
                  className="rounded-md px-3 py-3 text-base text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
                />
              }
            >
              Profile
            </SheetClose>
            <SheetClose
              nativeButton={false}
              render={
                <Link
                  href="/support"
                  className="rounded-md px-3 py-3 text-base text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
                />
              }
            >
              Support
            </SheetClose>
          </nav>
        </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
