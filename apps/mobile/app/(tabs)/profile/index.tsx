import { useCallback, useEffect, useState } from "react"
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readMyProfile, updateMyName, updateMyPhone, type MyProfile } from "@ovalball/contracts/identity/profile"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { webUrl } from "../../../src/config/environment"
import { useAppContexts } from "../../../src/context/contexts"
import { removeMyAvatar, replaceMyAvatar } from "../../../src/identity/images"
import { choosePhoto, takePhoto } from "../../../src/messages/pickers"
import { PersonAvatar } from "../../../src/components/identity"
import { Camera, ChevronRight, ExternalLink, Image as ImageIcon, Lock, X } from "../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * PROFILE (CA-M9): who you are, on your phone.
 *
 * The name and the phone number a coach needs right; the picture that is the control for itself.
 * Written through the same RLS-scoped row the website's Account page writes, and normalised by the same
 * server-side normaliser. Email, password, the authenticator and the postal address stay on the website
 * -- an email change is an auth flow and the rest is desk work -- and this screen says so and opens
 * them. Nothing here touches a membership, a team or a role.
 */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { person, reload, refreshIdentityImages } = useAppContexts()
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [phone, setPhone] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pictureSheet, setPictureSheet] = useState(false)
  const userId = session?.user.id ?? null

  const load = useCallback(async () => {
    if (!userId) return
    setProblem(null)
    try {
      const mine = await readMyProfile(supabase, userId)
      setProfile(mine)
      setFirstName(mine?.firstName ?? "")
      setSurname(mine?.surname ?? "")
      setPhone(mine?.phoneNumber ?? "")
    } catch (caught) {
      const failure = friendly(caught, "your profile")
      logDetail("profile", failure)
      setProblem(failure.message)
    }
  }, [userId])
  useEffect(() => {
    void load()
  }, [load])

  const nameDirty = !!profile && (firstName.trim() !== profile.firstName || surname.trim() !== profile.surname)
  const phoneDirty = !!profile && (phone.trim() || null) !== (profile.phoneNumber ?? null)

  async function save() {
    if (!userId || !profile) return
    setBusy("save")
    setProblem(null)
    setSaved(null)
    try {
      if (nameDirty) await updateMyName(supabase, userId, firstName, surname)
      if (phoneDirty) await updateMyPhone(supabase, userId, phone)
      await load()
      await reload()
      setSaved("Saved.")
    } catch (caught) {
      setProblem(friendly(caught, "your profile").message)
    } finally {
      setBusy(null)
    }
  }

  async function changePicture(source: "camera" | "library") {
    setPictureSheet(false)
    const picked = source === "camera" ? await takePhoto({ square: true }) : await choosePhoto({ square: true })
    if (!("ok" in picked) || !picked.ok) {
      if ("ok" in picked && !picked.ok) setProblem(picked.message)
      return
    }
    setBusy("picture")
    const result = await replaceMyAvatar(supabase, picked.file)
    setBusy(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await refreshIdentityImages()
  }

  async function removePicture() {
    setPictureSheet(false)
    setBusy("picture")
    const result = await removeMyAvatar(supabase)
    setBusy(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await refreshIdentityImages()
  }

  const fullName = [profile?.firstName, profile?.surname].filter(Boolean).join(" ") || person.firstName

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Profile
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!profile && !problem && <CardSkeleton lines={3} />}
        {profile && (
          <>
            <View style={{ alignItems: "center", gap: space.sm }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Your picture. Change it" onPress={() => setPictureSheet(true)} disabled={busy === "picture"} style={({ pressed }) => ({ opacity: pressed || busy === "picture" ? 0.7 : 1 })}>
                <PersonAvatar name={fullName} url={person.avatarUrl} size={96} />
                <View style={{ position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colour.chalk }}>
                  <Camera size={15} color={colour.onForest} strokeWidth={2.2} />
                </View>
              </Pressable>
              <Text style={[type.title, { color: colour.ink }]}>{fullName}</Text>
              {!!profile.email && <Text style={[type.caption, { color: colour.inkMuted }]}>{profile.email}</Text>}
            </View>

            <Card style={{ gap: space.md }}>
              <Field label="First Name" value={firstName} onChange={setFirstName} autoCapitalize="words" />
              <Field label="Surname" value={surname} onChange={setSurname} autoCapitalize="words" />
              <Field label="Phone Number" value={phone} onChange={setPhone} keyboardType="phone-pad" hint="Shared with the staff who run your rugby, never with other families." />
              <Button label="Save Changes" onPress={() => void save()} busy={busy === "save"} disabled={!nameDirty && !phoneDirty} />
              {!!saved && <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colour.forest800 }]}>{saved}</Text>}
            </Card>

            <Card onPress={() => void Linking.openURL(`${webUrl}/account/security`)} accessibilityLabel="Password, authenticator and signed-in devices. Opens the Ovalball website">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Lock size={18} color={colour.forest800} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Security</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Password, authenticator and your signed-in devices</Text>
                </View>
                <ExternalLink size={16} color={colour.inkSubtle} />
              </View>
            </Card>
            <Card onPress={() => void Linking.openURL(`${webUrl}/account`)} accessibilityLabel="Email address and postal address. Opens the Ovalball website">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Email and postal address</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Changing your email is confirmed by email, so it stays on the website.</Text>
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
            <Text style={[type.smallMedium, { color: colour.ink }]}>Your picture</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => void changePicture("camera")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Camera size={20} color={colour.forest800} />
              <Text style={[type.body, { color: colour.ink }]}>Take a photo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose a photo" onPress={() => void changePicture("library")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ImageIcon size={20} color={colour.forest800} />
              <Text style={[type.body, { color: colour.ink }]}>Choose a photo</Text>
            </Pressable>
            {!!person.avatarUrl && (
              <Pressable accessibilityRole="button" accessibilityLabel="Remove your picture" onPress={() => void removePicture()} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
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

function Field({ label, value, onChange, hint, keyboardType, autoCapitalize }: { label: string; value: string; onChange: (v: string) => void; hint?: string; keyboardType?: "default" | "phone-pad"; autoCapitalize?: "none" | "words" }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[type.caption, { color: colour.inkMuted, fontFamily: "Inter_500Medium" }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "none"}
        autoCorrect={false}
        style={{ minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, fontFamily: "Inter_400Regular", fontSize: 16 }}
      />
      {!!hint && <Text style={[type.caption, { color: colour.inkSubtle }]}>{hint}</Text>}
    </View>
  )
}
