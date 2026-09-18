import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * THE ONE PLACE A PAGE SAYS WHAT IT IS.
 *
 * Two facts, always both: WHICH WORKSPACE you are in, and WHAT you are looking at. UX-0 observed the
 * product answering only the second, and often not even that -- a Club Admin, a player and a team
 * volunteer all met an `<h1>` reading "Ovalball UAT RUFC", which names a club but not a page.
 *
 * WHY THE EYEBROW IS NOT A HEADING. It sits above an `<h1>` and looks like a label, so making it an
 * `<h2>` would put a heading ABOVE the page heading and invert the document outline. It is a plain
 * paragraph.
 *
 * WHY IT IS ALSO `aria-hidden`. Left visible to assistive technology the workspace is announced twice
 * -- once as loose text, once inside the heading -- and heading-by-heading navigation still lands on a
 * bare "Platform" with no idea which workspace it belongs to. So the visible eyebrow is decorative and
 * the REAL text lives inside the `<h1>`, visually hidden: the accessible name becomes
 * "Site Admin: Platform", announced exactly once, and correct however the page is reached. Nothing here
 * is carried by icon or colour alone -- the icon is decorative and the words say everything.
 */
export function PageIdentity({
  workspace,
  title,
  description,
  icon,
  showWorkspace = true,
  className,
  eyebrowClassName,
  titleClassName,
  descriptionClassName,
  id,
}: {
  /** The workspace this page belongs to -- from `workspaceLabel(context.kind)`, never a role. */
  workspace: string
  /** What this page IS. A task name ("People"), or the thing itself where the page is that thing. */
  title: string
  description?: ReactNode
  /** Decorative only. Never the sole carrier of meaning. */
  icon?: ReactNode
  /**
   * Whether to PRINT the workspace above the title. It is still announced either way -- the word lives
   * inside the heading, and this only decides whether it is also drawn.
   *
   * False on exactly one surface: the club hero, where the greeting, the club's own name and the
   * viewer's role already stack into four lines and a fifth reading "CLUB" above a club crest, a club
   * name and a club role told nobody anything they could not see.
   */
  showWorkspace?: boolean
  className?: string
  eyebrowClassName?: string
  titleClassName?: string
  descriptionClassName?: string
  id?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {showWorkspace && (
        <div aria-hidden="true" className="flex items-center gap-2.5">
          {icon}
          <p className={cn("text-sm font-medium tracking-[0.08em] text-forest-800 uppercase", eyebrowClassName)}>
            {workspace}
          </p>
        </div>
      )}
      <h1 id={id} className={cn("mt-2 font-display text-display-l text-ink", titleClassName)}>
        {/* The workspace, for anything that cannot see the eyebrow above. */}
        <span className="sr-only">{workspace}: </span>
        {title}
      </h1>
      {description ? (
        <p className={cn("mt-2 max-w-xl text-sm text-ink-muted", descriptionClassName)}>{description}</p>
      ) : null}
    </div>
  )
}
