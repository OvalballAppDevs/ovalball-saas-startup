import type { Metadata } from "next"

import { HeritageTimelineExperience } from "@/components/rugby-hub/heritage/timeline"
import { getHeritageTimeline } from "@/lib/app-context/heritage-data"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "The Story of Rugby | Rugby Hub",
  description: "An interactive journey through the history of Rugby Union and Rugby League, from a shared beginning to two distinct games.",
}

export default async function StoryOfRugbyPage() {
  const supabase = await createClient()
  const { eras, entries } = await getHeritageTimeline(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-xl text-ink">The Story of Rugby</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        One game split in two in 1895. Union and League have been separate ever since &mdash; different rules,
        different heartlands, different heroes &mdash; but they share the same first hundred years. This is that
        story, from folk football to the modern game, told honestly: where the record is solid, and where it
        isn&rsquo;t.
      </p>

      <HeritageTimelineExperience eras={eras} entries={entries} />
    </div>
  )
}
