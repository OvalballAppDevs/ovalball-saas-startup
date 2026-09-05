"use client"

import Link from "next/link"
import { Check, ChevronsUpDown, Settings } from "lucide-react"

import { OvalballMark } from "@/components/brand/ovalball-mark"
import { ClubAvatar } from "@/components/club/club-avatar"
import { UserAvatar } from "@/components/profile/user-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ActiveContextKind, SwitchableContext } from "@/lib/app-context/active-context"
import { resolveContextSettingsLink, resolveIdentityDisplay } from "@/lib/app-context/identity-display"
import { cn } from "@/lib/utils"

import { useSwitchContextState } from "./switch-context-provider"

interface ContextSwitcherProps {
  contexts: SwitchableContext[]
  activeKey: string
  identityKind: ActiveContextKind
  clubName: string
  clubLogoUrl: string | null
  roleLabel: string
  personName: string
  personAvatarUrl: string | null
}

/**
 * Desktop sidebar identity block. Becomes a switcher only when the session
 * genuinely holds more than one operating context (Club Admin at one club,
 * a team-scoped permission, Site Admin) -- a single-context session sees
 * exactly the plain identity link it always has, unchanged. Switching only
 * relabels which of the session's OWN real contexts is active (see
 * active-context.ts); it never grants a permission the account lacks.
 */
export function ContextSwitcher({
  contexts,
  activeKey,
  identityKind,
  clubName,
  clubLogoUrl,
  roleLabel,
  personName,
  personAvatarUrl,
}: ContextSwitcherProps) {
  const { switchTo, isPending } = useSwitchContextState()

  const active = contexts.find((c) => c.key === activeKey) ?? null
  const settingsLink = resolveContextSettingsLink(identityKind, active?.id ?? null, clubName)

  const identity = resolveIdentityDisplay(identityKind, { contextLabel: clubName, roleLabel, personName })
  const identityAvatar =
    identity.avatarKind === "club" ? (
      <ClubAvatar logoUrl={clubLogoUrl} name={clubName} size="sm" variant="dark" />
    ) : identity.avatarKind === "brand" ? (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10">
        <OvalballMark variant="dark" className="h-4 w-6" />
      </div>
    ) : (
      <UserAvatar avatarUrl={personAvatarUrl} name={personName} size="sm" variant="dark" />
    )
  const nameLabel = identity.nameLabel
  const subLabel = identity.subLabel

  // The settings gear is a fixed-width sibling next to the switcher/
  // identity row, never nested inside it -- keeps a single, restrained
  // affordance per Master Architecture Pass §16/§17 ("one gear represents
  // settings for the active context", "keep the gear restrained... do not
  // introduce a large button") and avoids nesting an interactive link
  // inside the DropdownMenuTrigger button.
  const gear = settingsLink && (
    <Link
      href={settingsLink.href}
      aria-label={settingsLink.ariaLabel}
      title={settingsLink.ariaLabel}
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-white/40 outline-none transition-colors hover:bg-white/5 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
    >
      <Settings className="size-4" />
    </Link>
  )

  if (contexts.length <= 1) {
    return (
      <div className="flex items-center gap-1 border-b border-white/10 pl-5 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 py-4">
          {identityAvatar}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{nameLabel}</p>
            <p className="mt-0.5 text-xs text-white/50">{subLabel}</p>
          </div>
        </div>
        {gear}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 border-b border-white/10 pl-5 pr-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isPending}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-4 text-left outline-none transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {identityAvatar}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{nameLabel}</p>
            <p className="mt-0.5 text-xs text-white/50">{subLabel}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-white/40" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Switch context</DropdownMenuLabel>
            {contexts.map((c) => (
              <DropdownMenuItem key={c.key} onClick={() => switchTo(c.key)} className="gap-2">
                <Check className={cn("size-3.5 shrink-0", c.key === activeKey ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.switcherLabel}</span>
                  <span className="block text-xs text-muted-foreground">{c.roleLabel}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLinkItem render={<Link href="/account" />}>Account settings</DropdownMenuLinkItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {gear}
    </div>
  )
}
