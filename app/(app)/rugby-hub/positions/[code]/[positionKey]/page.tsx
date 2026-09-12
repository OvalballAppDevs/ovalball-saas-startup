import type { Metadata } from "next"

import { createClient } from "@/lib/supabase/server"

export async function generateMetadata({ params }: { params: Promise<{ code: string; positionKey: string }> }): Promise<Metadata> {
  const { code, positionKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_positions").select("display_name").eq("position_key", positionKey).eq("status", "PUBLISHED").maybeSingle()
  const label = code === "union" ? "Rugby Union" : "Rugby League"
  return {
    title: data ? `${data.display_name} | Position Explorer | Rugby Hub` : "Position Explorer | Rugby Hub",
    description: data ? `What a ${data.display_name} does in ${label}, and how to get better at it.` : undefined,
  }
}

// Selection itself renders from the layout's PositionExplorerClient via
// useParams -- see [code]/layout.tsx and position-explorer-client.tsx.
export default function PositionExplorerPositionPage() {
  return null
}
