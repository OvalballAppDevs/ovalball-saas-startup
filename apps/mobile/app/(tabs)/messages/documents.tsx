import { View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { type AttachableKind } from "../../../src/messages/attachments"
import { DocumentPicker } from "../../../src/components/messenger/document-picker"
import { colour } from "../../../src/design/tokens"
import { OvalballDetailHeader } from "../../../src/components/app-header"

/**
 * SHARE SOMETHING ALREADY IN OVALBALL, full screen.
 *
 * The picker itself is `DocumentPicker`, which the compact messenger draws too -- one search, one note,
 * one category rule and one refusal wording for both windows onto a conversation. This screen only
 * frames it and returns to the conversation the share has just landed in.
 */
export default function ClubDocuments() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ kind?: string; id?: string }>()
  // The conversation this picker was opened FROM: it decides the share target and what may be offered.
  const kind = (["fixture", "request", "direct"].includes(String(params.kind)) ? params.kind : "fixture") as AttachableKind
  const id = String(params.id ?? "")

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Club Documents" onBack={() => router.back()} backLabel="Back to the conversation" />
      <DocumentPicker kind={kind} id={id} onShared={() => router.back()} bottomInset={insets.bottom} />
    </View>
  )
}
