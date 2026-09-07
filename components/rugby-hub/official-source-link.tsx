import { ExternalLink } from "lucide-react"

import type { SourceMetadata } from "@/lib/app-context/rugby-hub-data"

/** The one reusable provenance component: authority, source title, and a link to the real registered canonical URL -- never a synthetic or internal source. */
export function OfficialSourceLink({ sourceKey, locator, metadata }: { sourceKey: string | null; locator: string | null; metadata: SourceMetadata | undefined }) {
  if (!sourceKey || !metadata) return null
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-ink/50">
      <span>
        Source: {metadata.authorityName} &mdash;{" "}
        <a
          href={metadata.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          {metadata.title}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
        {locator ? ` (${locator})` : ""}
      </span>
    </p>
  )
}
