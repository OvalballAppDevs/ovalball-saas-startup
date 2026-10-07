import { useLocalSearchParams } from "expo-router"

import { UploadDocumentScreen } from "../../../../src/documents/upload-screen"

/** Upload to Club Documents, filed in the folder it was started from unless somebody chooses another. */
export default function UploadClubDocumentRoute() {
  const { folderId } = useLocalSearchParams<{ folderId?: string }>()
  return <UploadDocumentScreen folderId={folderId || null} />
}
