import { Redirect, useLocalSearchParams } from "expo-router"

/**
 * PITCH ALLOCATION NOW LIVES INSIDE ARENA PLANNING.
 *
 * The board is Arena Planning's Pitches view (src/arena/planner/pitch-board.tsx), so every old link,
 * notification and bookmark to Pitch Allocation lands on it, on the day it asked for. The board's settings
 * stay at /admin/pitch-allocation/settings.
 */
export default function PitchAllocationRedirect() {
  const { date } = useLocalSearchParams<{ date?: string }>()
  const params: Record<string, string> = { view: "pitches" }
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) params.date = date
  return <Redirect href={{ pathname: "/admin/arena/planning", params } as never} />
}
