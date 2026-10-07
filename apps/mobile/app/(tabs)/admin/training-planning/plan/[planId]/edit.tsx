import { useLocalSearchParams } from "expo-router"

import { EditPlanScreen } from "../../../../../../src/training-planning/edit-plan-screen"

export default function EditPlanRoute() {
  const { planId } = useLocalSearchParams<{ planId: string }>()
  if (!planId) return null
  return <EditPlanScreen planId={planId} />
}
