import { useLocalSearchParams } from "expo-router"

import { PlanDetailScreen } from "../../../../../src/training-planning/plan-detail-screen"

export default function PlanDetailRoute() {
  const { planId } = useLocalSearchParams<{ planId: string }>()
  if (!planId) return null
  return <PlanDetailScreen planId={planId} />
}
