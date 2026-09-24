import { useCallback, useEffect, useState } from "react"
import { Linking, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { invitePlayerAccount, permissionAgeBand, readChildPermissions, setChildPermission, type ChildPermission } from "@ovalball/contracts/family/permissions"

import { supabase } from "../../../src/auth/supabase"
import { webUrl } from "../../../src/config/environment"
import { useAppContexts } from "../../../src/context/contexts"
import { useFamily } from "../../../src/family/family"
import { loadFamilyScreen, type FamilyRow } from "../../../src/family/data"
import { removeChildAvatar, replaceChildAvatar } from "../../../src/identity/images"
import { choosePhoto, takePhoto } from "../../../src/messages/pickers"
import { PersonAvatar } from "../../../src/components/identity"
import { Camera, ChevronRight, ExternalLink, Image as ImageIcon, KeyRound, X } from "../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * ONE CHILD (CA-M9): their picture, their sides, what they may do for themselves, and their login.
 *
 * Everything here is a canonical operation the website already offers a guardian: the picture through
 * `set_player_avatar`, the permissions through `set_guardian_player_permission` (unanimous-grant across
 * the child's guardians -- the screen says when another guardian has not yet answered), the login
 * through the one invitation operation. What is NOT here: the date of birth (never shown), the gender
 * (recorded once, on the website), team or club changes (a club's job). A person who is not this
 * child's guardian is refused by the server on every one of these and told so on arrival.
 */
export default function ChildScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { playerId } = useLocalSearchParams<{ playerId: string }>()
  const { sessionContext, refreshIdentityImages } = useAppContexts()
  const { reload: reloadFamily } = useFamily()
  const [row, setRow] = useState<FamilyRow | null | undefined>(undefined)
  const [permissions, setPermissions] = useState<ChildPermission[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pictureSheet, setPictureSheet] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [inviteNote, setInviteNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sessionContext || !playerId) return
    setProblem(null)
    try {
      const data = await loadFamilyScreen(supabase, sessionContext)
      const found = data.rows.find((r) => r.playerId === playerId) ?? null
      setRow(found)
      if (found) {
        try {
          setPermissions(await readChildPermissions(supabase, playerId))
          setRefused(false)
        } catch (caught) {
          const e = caught as { code?: string }
          if (e.code === "42501") setRefused(true)
          else throw caught
        }
      }
    } catch (caught) {
      const failure = friendly(caught, "this child")
      logDetail("child", failure)
      setProblem(failure.message)
    }
  }, [sessionContext, playerId])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function changePicture(source: "camera" | "library") {
    setPictureSheet(false)
    if (!playerId) return
    const picked = source === "camera" ? await takePhoto({ square: true }) : await choosePhoto({ square: true })
    if (!("ok" in picked) || !picked.ok) {
      if ("ok" in picked && !picked.ok) setProblem(picked.message)
      return
    }
    setBusy("picture")
    const result = await replaceChildAvatar(supabase, playerId, picked.file)
    setBusy(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await Promise.all([reloadFamily(), refreshIdentityImages(), load()])
  }

  async function removePicture() {
    setPictureSheet(false)
    if (!playerId) return
    setBusy("picture")
    const result = await removeChildAvatar(supabase, playerId)
    setBusy(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await Promise.all([reloadFamily(), load()])
  }

  async function toggle(permission: ChildPermission, next: boolean) {
    if (!playerId) return
    setBusy(permission.key)
    setProblem(null)
    try {
      await setChildPermission(supabase, playerId, permission.key, next)
      setPermissions(await readChildPermissions(supabase, playerId))
    } catch (caught) {
      setProblem(friendly(caught, "that permission").message)
    } finally {
      setBusy(null)
    }
  }

  async function invite() {
    if (!playerId || !email.trim()) return
    setBusy("invite")
    setInviteNote(null)
    try {
      const result = await invitePlayerAccount(supabase, playerId, email)
      setInviteNote(result.alreadyExisted ? "An invitation to that address is already open." : `An invitation has been sent to ${email.trim()}.`)
      setEmail("")
    } catch (caught) {
      setInviteNote(friendly(caught, "this invitation").message)
    } finally {
      setBusy(null)
    }
  }

  const title = row?.fullName ?? "Child"

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink, flex: 1 }]}>
          {title}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {row === undefined && !problem && <CardSkeleton lines={3} />}
        {row === null && (
          <EmptyState title="Not one of your children" body="This child is not linked to you, or the link has ended. If that is wrong, ask the club." />
        )}
        {row && (
          <>
            {/* THE CHILD: picture, name, sides. Tap the picture to change it -- the picture is the control. */}
            <View style={{ alignItems: "center", gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.fullName}'s picture. Change it`}
                onPress={() => setPictureSheet(true)}
                disabled={busy === "picture"}
                style={({ pressed }) => ({ opacity: pressed || busy === "picture" ? 0.7 : 1 })}
              >
                <PersonAvatar name={row.fullName} url={row.avatarUrl} initials={row.initials} size={96} />
                <View style={{ position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colour.chalk }}>
                  <Camera size={15} color={colour.onForest} strokeWidth={2.2} />
                </View>
              </Pressable>
              <Text style={[type.title, { color: colour.ink }]}>{row.fullName}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{`${row.relationshipLabel === "You" ? "You" : "Your child"} · ${row.ageLabel}`}</Text>
            </View>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Teams</Text>
              {row.teams.length === 0 ? (
                <Text style={[type.small, { color: colour.inkMuted }]}>Awaiting a team from the club.</Text>
              ) : (
                <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                  {row.teams.map((t, i) => (
                    <View key={t.teamId} style={{ padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{t.teamName}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{t.clubName}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {row.relationship === "guardian_of" && (
              <View style={{ gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>What they may do themselves</Text>
                {refused ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>Only an active guardian may see or change these.</Text>
                ) : permissions === null ? (
                  <CardSkeleton lines={4} />
                ) : (
                  <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                    {permissions.map((p, i) => (
                      <View key={p.key} style={{ padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.md }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.smallMedium, { color: colour.ink }]}>{p.label}</Text>
                          {!!p.description && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{p.description}</Text>}
                          <Text style={[type.caption, { color: p.effective ? colour.forest800 : colour.inkSubtle, marginTop: 2 }]}>
                            {[permissionAgeBand(p), p.effective ? "Allowed" : p.myDecision ? (p.coGuardiansPending ? "Waiting for another guardian" : "Not allowed") : "Not allowed"].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <Switch
                          accessibilityLabel={`${p.label}. Your decision`}
                          value={p.myDecision === true}
                          disabled={busy === p.key}
                          onValueChange={(next) => void toggle(p, next)}
                          trackColor={{ true: colour.pitch600, false: colour.lineStrong }}
                          thumbColor={colour.surface}
                        />
                      </View>
                    ))}
                  </View>
                )}
                <Text style={[type.caption, { color: colour.inkSubtle }]}>A permission is in effect only when every guardian allows it.</Text>
              </View>
            )}

            {row.relationship === "guardian_of" && (
              <View style={{ gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Their own login</Text>
                {row.hasLogin ? (
                  <Card>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                      <KeyRound size={18} color={colour.forest800} />
                      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{`${row.firstName} has their own Ovalball login.`}</Text>
                    </View>
                  </Card>
                ) : (
                  <Card>
                    <Text style={[type.small, { color: colour.ink }]}>{`Invite ${row.firstName} to their own login. The club's rules on age apply, and the invitation goes by email.`}</Text>
                    {inviteOpen ? (
                      <View style={{ marginTop: space.md, gap: space.sm }}>
                        <TextInput
                          accessibilityLabel="Email address"
                          placeholder="Their email address"
                          placeholderTextColor={colour.inkSubtle}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          value={email}
                          onChangeText={setEmail}
                          style={{ minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, fontFamily: "Inter_400Regular", fontSize: 16 }}
                        />
                        <Button label="Send Invitation" onPress={() => void invite()} busy={busy === "invite"} disabled={!email.trim()} />
                      </View>
                    ) : (
                      <Button label="Invite to Their Own Login" variant="secondary" style={{ marginTop: space.md }} onPress={() => setInviteOpen(true)} />
                    )}
                    {!!inviteNote && <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colour.forest800, marginTop: space.sm }]}>{inviteNote}</Text>}
                  </Card>
                )}
              </View>
            )}

            <Card onPress={() => void Linking.openURL(`${webUrl}/parent/children`)} accessibilityLabel="Gender, another guardian and account repair are on the Ovalball website">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Gender, another guardian, account repair</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Recorded once, or needing a desk: on the website.</Text>
                </View>
                <ExternalLink size={16} color={colour.inkSubtle} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <Modal visible={pictureSheet} transparent animationType="fade" onRequestClose={() => setPictureSheet(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPictureSheet(false)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{`${row?.firstName ?? "Their"}'s picture`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => void changePicture("camera")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Camera size={20} color={colour.forest800} />
              <Text style={[type.body, { color: colour.ink }]}>Take a photo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose a photo" onPress={() => void changePicture("library")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ImageIcon size={20} color={colour.forest800} />
              <Text style={[type.body, { color: colour.ink }]}>Choose a photo</Text>
            </Pressable>
            {!!row?.avatarUrl && (
              <Pressable accessibilityRole="button" accessibilityLabel="Remove the picture" onPress={() => void removePicture()} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
                <X size={20} color={colour.danger} />
                <Text style={[type.body, { color: colour.danger }]}>Remove the picture</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}
