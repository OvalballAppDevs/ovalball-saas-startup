"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, ChevronsUpDown, Menu, Settings, X } from "lucide-react"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { UserAvatar } from "@/components/profile/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { ActiveContextKind, SwitchableContext } from "@/lib/app-context/active-context"
import type { MessengerRow } from "@/lib/messenger/view-model"
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
  roleLabel: string
  personName: string
  personAvatarUrl: string | null
  notifications: NotificationItem[]
  unreadCount: number
  messagesUnreadCount: number
  conversations: MessengerRow[]
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
  roleLabel,
  personName,
  personAvatarUrl,
  notifications,
  unreadCount,
  messagesUnreadCount,
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
  // Must resolve identically to the desktop ContextSwitcher -- same helper,
  // same inputs, including the child a parent context is about.
  const identity = resolveIdentityDisplay(identityKind, {
    contextLabel: clubName,
    roleLabel,
    personName,
    subjectName: active?.subjectName ?? null,
  })

  return (
    <div className="sticky top-0 z-40 border-b border-forest-950/10 bg-forest-950 md:hidden">
    <div className="flex items-center justify-between px-4 py-3">
      <OvalballLogo variant="dark" />
      <div className="flex items-center gap-1">
        <MessagesPopover conversations={conversations} unreadCount={messagesUnreadCount} variant="dark" />
        <NotificationBell initialItems={notifications} initialUnreadCount={unreadCount} variant="dark" />
        <SupportButton unreadCount={supportUnreadCount} variant="dark" />
        <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          // size-11 rather than the icon default: this is the ONLY way into
          // navigation on a phone, and a 32px target on the one control that
          // opens the whole app is the wrong place to save eight pixels.
          render={<Button variant="ghost" size="icon" className="size-11 text-white hover:bg-white/10 hover:text-white" />}
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
              {/* Resolves identically to the desktop block, because it is the same helper -- and there
                  is one avatar now, for the same reason there is one there. */}
              {(
                <UserAvatar
                  avatarUrl={identity.avatarUsesPersonPhoto ? personAvatarUrl : null}
                  name={identity.avatarUsesPersonPhoto ? personName : identity.nameLabel}
                  size="sm"
                  variant="dark"
                />
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
                      {/* switcherLabel, not label: `label` is the bare team
                          name, so two children on the SAME team rendered as
                          two identical rows here. Caption matches desktop --
                          a child is described by club and team, never by the
                          viewer's own "Parent/Guardian" role. */}
                      <span className="block truncate">{c.switcherLabel}</span>
                      <span className="block truncate text-xs text-white/60">
                        {c.kind === "family"
                          ? `${c.playerIds?.length ?? 0} children`
                          : c.subjectName
                            ? [c.subjectClubName, c.label].filter(Boolean).join(" · ")
                            : c.roleLabel}
                      </span>
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

    {/* ---------- the context bar ----------

        UX-0's finding was narrow and specific: on a phone the shell said nothing about who you were or
        which context you were in, and changing context meant opening the drawer first -- which is the
        single most common thing a guardian does. Putting it in the top row was the obvious move and the
        wrong one: at 320px that row already carries a logo, three icon buttons and the only way into
        navigation, and a fifth item there is how horizontal overflow starts.

        So it is its own row: always visible, always legible, and interactive exactly when there is
        something to switch to. */}
    <MobileContextBar
      contexts={contexts}
      activeKey={activeKey}
      nameLabel={identity.nameLabel}
      subLabel={identity.subLabel}
    />
    </div>
  )
}

function MobileContextBar({
  contexts,
  activeKey,
  nameLabel,
  subLabel,
}: {
  contexts: SwitchableContext[]
  activeKey: string
  nameLabel: string
  subLabel: string
}) {
  const { switchTo, isPending } = useSwitchContextState()

  const lines = (
    <>
      <span className="truncate text-sm font-medium text-white">{nameLabel}</span>
      <span aria-hidden="true" className="shrink-0 text-white/30">
        ·
      </span>
      <span className="truncate text-xs text-white/60">
        <span className="sr-only">Acting in: </span>
        {subLabel}
      </span>
    </>
  )

  if (contexts.length <= 1) {
    return (
      <div className="flex items-baseline gap-2 border-t border-white/10 px-4 py-2">{lines}</div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        aria-label={`Switch context. Currently ${subLabel}`}
        // min-h-11 rather than the text's natural height: this is a real control on a phone, and the
        // row it lives in is only as tall as two small lines of type.
        className="flex min-h-11 w-full items-baseline gap-2 border-t border-white/10 px-4 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset disabled:opacity-60"
      >
        {lines}
        <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 self-center text-white/60" />
      </DropdownMenuTrigger>
      {/* Anchored to the trigger and width-capped to the viewport, so a long club name cannot push the
          menu off the side of a 320px screen. */}
      <DropdownMenuContent align="start" sideOffset={4} className="max-w-[calc(100vw-1rem)] w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch context</DropdownMenuLabel>
          {contexts.map((c) => (
            <DropdownMenuItem key={c.key} onClick={() => switchTo(c.key)} className="gap-2">
              <Check className={cn("size-3.5 shrink-0", c.key === activeKey ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.switcherLabel}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.kind === "family"
                    ? `${c.playerIds?.length ?? 0} children`
                    : c.subjectName
                      ? [c.subjectClubName, c.label].filter(Boolean).join(" · ")
                      : c.roleLabel}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
