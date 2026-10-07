import { useLocalSearchParams } from "expo-router"

import { DispensationRecordScreen } from "../../../src/dispensation/record"

/** One dispensation -- from its notification, a Needs Attention row, or a register. */
export default function DispensationRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  return <DispensationRecordScreen id={typeof id === "string" && id.length > 0 ? id : null} />
}
