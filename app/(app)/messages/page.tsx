import { MessagesSquare } from "lucide-react"

/**
 * WHAT THE MAIN PANE SHOWS WHEN NOTHING IS OPEN.
 *
 * On a laptop this route renders beside the conversation list, so it is the
 * "nothing selected yet" pane rather than a page in its own right -- the list
 * itself is the layout's, and on a phone it is the whole screen, which is why
 * this is hidden there rather than stacked underneath it.
 *
 * It is deliberately quiet. A resting state is not an opportunity to sell
 * something; the useful thing on screen is the list to the left, and this
 * should point at it and then get out of the way.
 */
export default function MessagesPage() {
  return (
    <div className="hidden h-full flex-col items-center justify-center px-8 text-center lg:flex">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white ring-1 ring-ink/10">
        <MessagesSquare className="size-6 text-forest-800" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-display text-[1.25rem] text-ink">Nothing open</h2>
      <p className="mt-1.5 max-w-[34ch] text-sm text-ink-muted">
        Choose a conversation on the left to read it and reply.
      </p>
    </div>
  )
}
