import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import { loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import { setTeamCover, teamMediaErrorMessage } from "@ovalball/contracts/team/media"

import { supabase } from "../auth/supabase"
import { STOCK_CATEGORIES, defaultGroupKeyForTeam, stockCoversForCategory, type StockCategory, type StockCoverAsset } from "./cover-library"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { Check } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE OVALBALL IMAGE LIBRARY -- curated stock, never a substitute for real Team Gallery history
 * (Section 5). Selecting one calls the SAME governed `set_team_cover` the upload path uses, with a
 * stock key rather than a storage path; the server re-validates that key against its own allow-list.
 */
export function CoverLibraryScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [category, setCategory] = useState<StockCategory>("Rugby Teams")
  const [selected, setSelected] = useState<StockCoverAsset | null>(null)
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

  async function save() {
    if (!selected) return
    setBusy(true)
    setSaveProblem(null)
    try {
      await setTeamCover(supabase, teamId, { stockKey: selected.key })
      router.back()
    } catch (caught) {
      setSaveProblem(teamMediaErrorMessage(caught, "That photo couldn't be set as the cover."))
    } finally {
      setBusy(false)
    }
  }

  const teamGroup = identity ? defaultGroupKeyForTeam(identity) : undefined
  const images = stockCoversForCategory(category, teamGroup)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Team Cover Images" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity ? (
        <View style={{ padding: space.lg }}>
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 60 }} contentContainerStyle={{ alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}>
            {STOCK_CATEGORIES.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: category === c }}
                accessibilityLabel={c}
                onPress={() => setCategory(c)}
                style={{ alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: category === c ? colour.forest800 : colour.surface, borderWidth: 1, borderColor: category === c ? colour.forest800 : colour.line }}
              >
                <Text style={[type.smallMedium, { color: category === c ? colour.onForest : colour.ink }]}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {images.map((img) => {
                const on = selected?.key === img.key
                return (
                  <Pressable
                    key={img.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={img.label}
                    onPress={() => setSelected(img)}
                    style={{ width: "31.5%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 3 : 0, borderColor: colour.forest800 }}
                  >
                    <Image source={img.asset} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
                    {on && (
                      <View style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center" }}>
                        <Check size={13} color={colour.onForest} strokeWidth={3} />
                      </View>
                    )}
                  </Pressable>
                )
              })}
            </View>

            {selected && (
              <View style={{ gap: space.sm }}>
                <Image source={selected.asset} accessible={false} contentFit="cover" style={{ width: "100%", aspectRatio: 3 / 2, borderRadius: radius.md }} />
                <Text style={[type.caption, { color: colour.inkSubtle }]}>Ovalball stock photography -- {selected.label.toLowerCase()}. Not a photo of this team.</Text>
                {!!saveProblem && <Text style={[type.small, { color: colour.danger }]}>{saveProblem}</Text>}
                <Button label="Use This Photo" onPress={save} busy={busy} />
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  )
}
