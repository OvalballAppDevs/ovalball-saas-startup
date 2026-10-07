import { useCallback, useEffect, useMemo, useState } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"

import { loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import { setTeamCover, teamMediaErrorMessage } from "@ovalball/contracts/team/media"
import { stockMediaForTeam } from "@ovalball/contracts/media/stock-library"

import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { CardSkeleton, ErrorState } from "../components/ui"
import { colour, space, type } from "../design/tokens"
import { StockLibraryBrowser } from "../media/media-picker"
import { teamFallbackHint } from "../media/stock-assets"

/**
 * A TEAM'S OVALBALL LIBRARY -- the one Stock Media Library's team pictures (`StockLibraryBrowser`), given a
 * whole screen. The side's own kind of team is ordered first; nothing is hidden by team type. Choosing one
 * calls the SAME governed `set_team_cover` the upload path uses, with a library key the server re-checks
 * against `internal.stock_media` for a team. Library pictures are illustrative -- never "a photo of this team".
 */
export function CoverLibraryScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setIdentity(await loadTeamProfileIdentity(supabase, teamId))
    } catch (caught) {
      setProblem(teamMediaErrorMessage(caught, "Couldn't load this team."))
    }
  }, [teamId])
  useEffect(() => { void load() }, [load])

  async function save(key: string) {
    setBusy(true)
    setSaveProblem(null)
    try {
      await setTeamCover(supabase, teamId, { stockKey: key })
      router.back()
    } catch (caught) {
      setSaveProblem(teamMediaErrorMessage(caught, "That picture couldn't be set as the cover."))
    } finally {
      setBusy(false)
    }
  }

  const ordered = useMemo(() => (identity ? stockMediaForTeam(teamFallbackHint(identity).teamGroup) : undefined), [identity])
  const currentKey = identity?.cover.kind === "stock" ? identity.cover.key : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Ovalball Library" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity ? (
        <View style={{ padding: space.lg }}>
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <View style={{ flex: 1, paddingTop: space.md }}>
          {!!saveProblem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, paddingHorizontal: space.lg }]}>{saveProblem}</Text>}
          <StockLibraryBrowser domain="TEAM" selectedKey={currentKey} ordered={ordered} onUse={(key) => void save(key)} onBack={() => router.back()} backLabel="Cancel" busy={busy} />
        </View>
      )}
    </View>
  )
}
