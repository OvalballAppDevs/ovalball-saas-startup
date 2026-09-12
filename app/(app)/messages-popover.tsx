"use client"

import { useState } from "react"
import { MessageSquare } from "lucide-react"

import { CompactMessenger, useCompactMessengerState } from "@/components/messenger/compact-messenger"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { badgeCount, unreadLabel, type MessengerRow } from "@/lib/messenger/view-model"
import { cn } from "@/lib/utils"

/**
 * THE GLOBAL MESSAGES CONTROL.
 *
 * Opens a Messenger you can actually use from wherever you happen to be: read
 * a conversation, reply to it, come back to the list, and carry on with what
 * you were doing. It previously opened a preview list whose only affordance
 * navigated away, which meant every reply cost you your place in the product.
 *
 * A WINDOW, NOT A DROPDOWN. 400x600 on a laptop -- wide enough for a real
 * message column and tall enough to hold a conversation with its composer,
 * while still leaving the application visible behind it. On a phone it becomes
 * a near-full-screen sheet, because a 400px pop-down on a 390px screen is a
 * dropdown pretending to be a window.
 *
 * THE PANEL'S STATE LIVES HERE, in a control that never unmounts, so closing
 * and reopening returns you to the conversation you were reading and the reply
 * you had half-written.
 */

function TriggerButton({
  unreadCount,
  variant,
  onClick,
  open,
}: {
  unreadCount: number
  variant: "dark" | "light"
  onClick?: () => void
  open?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Messages, ${unreadLabel(unreadCount)}` : "Messages"}
      className={cn(
        "relative flex size-11 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
        variant === "dark"
          ? cn("text-white/70 hover:bg-white/10 hover:text-white", open && "bg-white/12 text-white")
          : cn("text-ink/60 hover:bg-ink/5 hover:text-ink", open && "bg-ink/5 text-ink")
      )}
    >
      <MessageSquare className="size-5" aria-hidden="true" />
      {unreadCount > 0 && (
        // min-w rather than a fixed circle: "99+" is a real value for a
        // fixture secretary in September, and a three-digit count inside a
        // 16px circle is a broken header rather than a large number.
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pitch-600 px-1 text-[10px] font-semibold tabular-nums text-white",
            variant === "dark" ? "ring-2 ring-forest-950" : "ring-2 ring-white"
          )}
          aria-hidden="true"
        >
          {badgeCount(unreadCount)}
        </span>
      )}
    </button>
  )
}

export function MessagesPopover({
  conversations,
  unreadCount: canonicalUnreadCount,
  variant = "dark",
}: {
  /** The SAME rows /messages lists, built once by getMessengerRows. */
  conversations: MessengerRow[]
  /**
   * THE CANONICAL MESSENGER UNREAD COUNT, from public.my_unread_counts.
   *
   * Not the sum of the rows below. The badge and the bell come from one
   * calculation, so clearing a message moves both.
   */
  unreadCount?: number
  variant?: "dark" | "light"
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const state = useCompactMessengerState()
  const unreadCount = canonicalUnreadCount ?? conversations.reduce((sum, c) => sum + c.unreadCount, 0)

  // A HALF-WRITTEN REPLY IS NOT THROWN AWAY BY A STRAY CLICK.
  //
  // An accidental click on the page behind the panel is the single easiest way
  // to lose a message somebody was part-way through, so while a draft exists
  // an outside press is refused. Escape and the trigger still close it -- both
  // are deliberate -- and the draft survives that too, because it lives in
  // this control rather than inside the box that unmounts.
  const hasDraft = state.draft.trim().length > 0
  const keepOpenWhileDrafting = (open: boolean, details: { reason?: string; cancel: () => void }) => {
    if (!open && hasDraft && details.reason === "outside-press") {
      details.cancel()
      return true
    }
    return false
  }

  return (
    <>
      {/* Desktop / tablet: an anchored Messenger window */}
      <div className="hidden sm:block">
        <Popover
          open={popoverOpen}
          onOpenChange={(open, details) => {
            if (keepOpenWhileDrafting(open, details)) return
            setPopoverOpen(open)
          }}
        >
          <PopoverTrigger
            render={<TriggerButton unreadCount={unreadCount} variant={variant} open={popoverOpen} />}
          />
          <PopoverContent
            align="end"
            sideOffset={8}
            className="flex h-[min(600px,calc(100dvh-6rem))] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink/10 p-0 shadow-[0_24px_60px_-20px_rgba(7,28,20,0.45)]"
          >
            <CompactMessenger
              rows={conversations}
              canStartConversation={false}
              state={state}
              onClose={() => setPopoverOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Mobile: a near-full-screen Messenger surface */}
      <div className="sm:hidden">
        <TriggerButton unreadCount={unreadCount} variant={variant} onClick={() => setSheetOpen(true)} open={sheetOpen} />
      </div>
      <Sheet
        open={sheetOpen}
        onOpenChange={(open, details) => {
          if (keepOpenWhileDrafting(open, details)) return
          setSheetOpen(open)
        }}
      >
        <SheetContent
          side="bottom"
          className="flex h-[92dvh] flex-col overflow-hidden rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
          <SheetTitle className="sr-only">Messages</SheetTitle>
          <CompactMessenger
            rows={conversations}
            canStartConversation={false}
            state={state}
            onClose={() => setSheetOpen(false)}
            density="sheet"
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
