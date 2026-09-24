import { useCallback } from "react"
import { useRouter } from "expo-router"
import type { HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"

import { openHubHref } from "../routes"
import { hubHrefForRef, type HubEntityRef } from "./explain"

/**
 * One way to leave an experience component: every entity and every hotspot carries a canonical
 * web href, and the one route table turns it into a native screen. No component pushes a route.
 */
export function useOpenHubEntity(): { openEntity: (entity: HubRelatedEntity) => void; openRef: (ref: HubEntityRef) => void } {
  const router = useRouter()
  const openEntity = useCallback((entity: HubRelatedEntity) => openHubHref(router, entity.href), [router])
  const openRef = useCallback((ref: HubEntityRef) => openHubHref(router, hubHrefForRef(ref)), [router])
  return { openEntity, openRef }
}
