import { useLocalSearchParams } from "expo-router"

import { ClubDocumentsScreen } from "../../../../../src/documents/library-screen"

/** One folder of Club Documents: the SAME library screen, a level down, so Back climbs out one level. */
export default function ClubDocumentsFolderRoute() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>()
  if (!folderId) return null
  return <ClubDocumentsScreen key={folderId} folderId={folderId} />
}
