"use client"

import { useState } from "react"

/** Small list-row thumbnail with a broken-image fallback (initials) -- a client component since the fallback needs onError, unlike the rest of this server-rendered list page. */
export function ClubCrest({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [broken, setBroken] = useState(false)

  if (!logoUrl || broken) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-ink/10 bg-ink/[0.03] text-[9px] font-medium text-ink/30">
        {name.slice(0, 2).toUpperCase()}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage public URLs, avoids next/image's remote-pattern config for a small thumbnail
    <img src={logoUrl} alt="" onError={() => setBroken(true)} className="size-9 shrink-0 rounded-md border border-ink/10 bg-white object-contain" />
  )
}
