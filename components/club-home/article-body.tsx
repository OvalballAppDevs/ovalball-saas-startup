import Link from "next/link"
import { Fragment } from "react"

import { parseArticleBody, type Inline } from "@/lib/club-content/markup"
import { cn } from "@/lib/utils"

import { TEXT_LINK } from "./primitives"

/**
 * THE ONE ARTICLE RENDERER.
 *
 * The public article page and the editor's preview both render through here,
 * so what a club previews is exactly what it publishes. Output is React
 * elements built from lib/club-content/markup.ts -- never HTML from the
 * database.
 */

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>
          case "break":
            return <br key={i} />
          case "strong":
            return (
              <strong key={i} className="font-semibold text-ink">
                <InlineNodes nodes={n.children} />
              </strong>
            )
          case "em":
            return (
              <em key={i}>
                <InlineNodes nodes={n.children} />
              </em>
            )
          case "link":
            return n.external ? (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
                <InlineNodes nodes={n.children} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link key={i} href={n.href} className={TEXT_LINK}>
                <InlineNodes nodes={n.children} />
              </Link>
            )
        }
      })}
    </>
  )
}

export function ArticleBody({ body, className }: { body: string; className?: string }) {
  const blocks = parseArticleBody(body)
  return (
    <div className={cn("max-w-[68ch] text-[1.0625rem] leading-[1.75] text-ink/85 md:text-lg", className)}>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const Tag = b.level === 2 ? "h2" : "h3"
          return (
            <Tag key={i} className={cn("font-semibold text-balance text-ink", b.level === 2 ? "mt-10 text-2xl first:mt-0" : "mt-8 text-xl first:mt-0")}>
              <InlineNodes nodes={b.children} />
            </Tag>
          )
        }
        if (b.type === "list") {
          const List = b.ordered ? "ol" : "ul"
          return (
            <List key={i} className={cn("mt-5 grid gap-2 pl-6 first:mt-0", b.ordered ? "list-decimal" : "list-disc marker:text-(--club-ink)")}>
              {b.items.map((item, j) => (
                <li key={j} className="pl-1">
                  <InlineNodes nodes={item} />
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={i} className="mt-5 first:mt-0">
            <InlineNodes nodes={b.children} />
          </p>
        )
      })}
    </div>
  )
}
