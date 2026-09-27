import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Switch, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import {
  CLUB_CONTACT_ROLE_LABEL,
  CLUB_CONTACT_ROLES,
  canEditClubProfile,
  clubProfileErrorMessage,
  clubProfileFieldsDiffer,
  deleteClubContact,
  EMPTY_CLUB_PROFILE_FIELDS,
  readClubProfile,
  saveClubContact,
  updateClubProfile,
  type ClubContact,
  type ClubContactInput,
  type ClubContactRole,
  type ClubProfile,
  type ClubProfileFields,
} from "@ovalball/contracts/club/profile"

import { AdminScreen } from "../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../src/admin/access"
import { supabase } from "../../../src/auth/supabase"
import { ClubCrest } from "../../../src/components/identity"
import { removeClubCover, replaceClubCover } from "../../../src/identity/images"
import { PictureSheet, type PictureAction } from "../../../src/components/picture-sheet"
import { CircleAlert, Plus } from "../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState, StatusPill } from "../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * CLUB PROFILE, natively -- the website's page on a phone (CA-M1).
 *
 * ONE RECORD. What is shown is `clubs` and `club_contacts` as the server holds them now, read
 * through the shared `readClubProfile`; what is changed goes through the domain operations
 * (`updateClubProfile`, `saveClubContact`, `deleteClubContact`) that the website's own actions
 * call. There is no local copy that outlives the screen, no queue, no cache that stands in for the
 * server's answer.
 *
 * NO OPTIMISTIC AUTHORITY. The fields are editable only while the server says this person holds
 * `club.profile.edit` at the club; that is re-asked whenever the screen comes back into focus. A
 * save the server refuses is shown as refused, the fields are locked, and nothing is pretended.
 * After every successful write the profile is RE-READ rather than patched in place, so the screen
 * shows the record, not the request.
 *
 * ONE SAVE. The four profile fields are edited together and saved together: a draft is tracked
 * against the server's record, "unsaved changes" is that difference, and Save Changes / Discard
 * act on the whole draft. Contacts are their own small operations, saved one at a time.
 */
export default function ClubProfileScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()

  const [profile, setProfile] = useState<ClubProfile | null>(null)
  const [coverPicture, setCoverPicture] = useState<PictureAction | null>(null)
  const [draft, setDraft] = useState<ClubProfileFields>(EMPTY_CLUB_PROFILE_FIELDS)
  const [dirty, setDirty] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Read inside `load` without making `load` depend on it, so a refocus never restarts a read mid-edit.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    if (!clubId) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const [next, allowed] = await Promise.all([readClubProfile(supabase, clubId), canEditClubProfile(supabase, clubId)])
      setProfile(next)
      setCanEdit(allowed)
      if (next) {
        // The server's record is the baseline. Unsaved edits are kept; an untouched draft follows the record.
        setDraft((current) => (dirtyRef.current ? current : { bio: next.bio, website: next.website, facebookUrl: next.facebookUrl, addressDisplay: next.addressDisplay }))
      }
    } catch (cause) {
      const translated = friendly(cause, "the club profile")
      logDetail("admin:club-profile", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    setProfile(null)
    setDraft(EMPTY_CLUB_PROFILE_FIELDS)
    dirtyRef.current = false
    setDirty(false)
    setLoading(true)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function edit(patch: Partial<ClubProfileFields>) {
    setSaved(false)
    setSaveError(null)
    setDraft((d) => {
      const next = { ...d, ...patch }
      const changed = profile ? clubProfileFieldsDiffer(next, profile) : true
      dirtyRef.current = changed
      setDirty(changed)
      return next
    })
  }

  function discard() {
    if (!profile) return
    setDraft({ bio: profile.bio, website: profile.website, facebookUrl: profile.facebookUrl, addressDisplay: profile.addressDisplay })
    dirtyRef.current = false
    setDirty(false)
    setSaveError(null)
  }

  async function save() {
    if (!clubId || !profile) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await updateClubProfile(supabase, clubId, draft)
      setDirty(false)
      dirtyRef.current = false
      await load()
      setSaved(true)
    } catch (cause) {
      const e = cause as { code?: string }
      setSaveError(clubProfileErrorMessage(cause, friendly(cause, "the club profile").message))
      if (e.code === "42501") {
        // The server has withdrawn this person's authority since the screen was drawn: lock the
        // fields and re-ask the Admin Centre which rows still belong to them.
        setCanEdit(false)
        void refreshAccess()
      }
    } finally {
      setSaving(false)
    }
  }

  const contactsChanged = useCallback(async () => {
    await load()
  }, [load])

  const footer =
    canEdit && dirty ? (
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: colour.surface,
          borderTopWidth: 1,
          borderTopColor: colour.line,
          flexDirection: "row",
          gap: space.md,
        }}
      >
        <Button label="Discard" variant="secondary" onPress={discard} disabled={saving} style={{ flex: 1 }} />
        <Button label="Save Changes" onPress={() => void save()} busy={saving} style={{ flex: 2 }} accessibilityHint="Saves the club introduction, web links and home ground address" />
      </View>
    ) : null

  return (
    <>
    <AdminScreen section="Club Profile" onRefresh={() => void load()} refreshing={false} footer={footer}>
      {loading && !profile && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {!loading && !loadError && !profile && <ErrorState message="This club's profile is not available to you." />}

      {profile && (
        <>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {profile.clubName ?? "Club Profile"}
            </Text>
            <Text style={[type.body, { color: colour.inkMuted }]}>
              {canEdit ? "What the club says about itself on its public page. The club's name comes from the Club Directory and is not edited here." : "You can see the club's profile but no longer have permission to change it."}
            </Text>
          </View>

          {!canEdit && (
            <View accessibilityRole="alert" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
              <CircleAlert size={18} color={colour.warning} />
              <Text style={[type.small, { color: colour.warning, flex: 1 }]}>Editing is off because the club has not given you the Club Profile permission. Ask a Club Admin if that is wrong.</Text>
            </View>
          )}

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Public Profile Cover
            </Text>
            <Card style={{ gap: 0, overflow: "hidden", padding: 0 }}>
              <View style={{ height: 140, backgroundColor: colour.forest900 }}>
                {profile.coverUrl && <Image source={{ uri: profile.coverUrl }} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />}
              </View>
              <View style={{ padding: space.md, gap: space.sm }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{profile.coverUrl ? "Shown at the top of your public Clubhouse profile." : "No cover photo yet. The forest background stands in until you add one."}</Text>
                {canEdit ? (
                  <Button
                    label={profile.coverUrl ? "Change Cover Photo" : "Add Cover Photo"}
                    variant="secondary"
                    onPress={() =>
                      setCoverPicture({
                        subject: "the cover photo",
                        aspect: [16, 9],
                        onReplace: async (file) => {
                          if (!clubId) return "You don't have fixture authority at a club."
                          const result = await replaceClubCover(supabase, clubId, file)
                          if (!result.ok) return result.message
                          await load()
                          return null
                        },
                        onRemove: profile.coverUrl
                          ? async () => {
                              if (!clubId) return "You don't have fixture authority at a club."
                              const result = await removeClubCover(supabase, clubId)
                              if (!result.ok) return result.message
                              await load()
                              return null
                            }
                          : null,
                      })
                    }
                  />
                ) : (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Changing the cover photo needs the Club Profile permission.</Text>
                )}
              </View>
            </Card>
          </View>

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Club Crest
            </Text>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ClubCrest clubName={profile.clubName} url={profile.logoUrl} size={56} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>The crest is the club's identity, shown everywhere Ovalball names this club -- changed from Branding, not here.</Text>
              </View>
              <Button label="Branding" variant="quiet" onPress={() => router.push("/admin/branding" as never)} />
            </Card>
          </View>

          <Card style={{ gap: space.lg }}>
            <Field label="About the Club" value={draft.bio} onChange={(v) => edit({ bio: v })} editable={canEdit} multiline placeholder="A short introduction shown on your club's public page." />
            <Field label="Website" value={draft.website} onChange={(v) => edit({ website: v })} editable={canEdit} keyboard="url" placeholder="https://" />
            <Field label="Facebook" value={draft.facebookUrl} onChange={(v) => edit({ facebookUrl: v })} editable={canEdit} keyboard="url" placeholder="https://facebook.com/…" />
            <Field label="Home Ground Address" value={draft.addressDisplay} onChange={(v) => edit({ addressDisplay: v })} editable={canEdit} placeholder="As it should read on the public page" />
            {saveError && (
              <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
                <Text style={[type.small, { color: colour.danger }]}>{saveError}</Text>
              </View>
            )}
            {saved && !dirty && (
              <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>
                Saved. The club's record is updated everywhere.
              </Text>
            )}
            {dirty && canEdit && (
              <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.inkMuted }]}>
                Unsaved changes.
              </Text>
            )}
          </Card>

          <ContactsSection clubId={profile.clubId} contacts={profile.contacts} canEdit={canEdit} onChanged={contactsChanged} onRefused={() => { setCanEdit(false); void refreshAccess() }} />
        </>
      )}
    </AdminScreen>
    <PictureSheet action={coverPicture} onClose={() => setCoverPicture(null)} />
    </>
  )
}

function Field({ label, value, onChange, editable, multiline = false, keyboard = "default", placeholder }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; multiline?: boolean; keyboard?: "default" | "url" | "email-address" | "phone-pad"; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={keyboard}
        autoCapitalize={keyboard === "default" && !multiline ? "words" : keyboard === "default" ? "sentences" : "none"}
        autoCorrect={multiline}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        selectionColor={colour.pitch600}
        style={[
          type.body,
          {
            minHeight: multiline ? 112 : TOUCH_TARGET,
            paddingHorizontal: space.md,
            paddingVertical: multiline ? space.md : 0,
            textAlignVertical: multiline ? "top" : "center",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: editable ? colour.surface : "rgba(16,21,18,0.03)",
            color: editable ? colour.ink : colour.inkMuted,
          },
        ]}
      />
    </View>
  )
}

const EMPTY_CONTACT: ClubContactInput = { role: "general", name: "", phone: "", email: "", isPublic: true }

function ContactsSection({ clubId, contacts, canEdit, onChanged, onRefused }: { clubId: string; contacts: ClubContact[]; canEdit: boolean; onChanged: () => Promise<void>; onRefused: () => void }) {
  const [editing, setEditing] = useState<{ id: string | null; input: ClubContactInput } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(op: () => Promise<void>, subject: string) {
    setBusy(true)
    setError(null)
    try {
      await op()
      setEditing(null)
      setRemoving(null)
      await onChanged()
    } catch (cause) {
      setError(clubProfileErrorMessage(cause, friendly(cause, subject).message))
      if ((cause as { code?: string }).code === "42501") onRefused()
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          Public Contacts
        </Text>
        {canEdit && !editing && (
          <Pressable accessibilityRole="button" accessibilityLabel="Add Contact" onPress={() => setEditing({ id: null, input: EMPTY_CONTACT })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH_TARGET, paddingHorizontal: space.sm, opacity: pressed ? 0.7 : 1 })}>
            <Plus size={18} color={colour.forest800} strokeWidth={2.2} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Contact</Text>
          </Pressable>
        )}
      </View>
      <Text style={[type.small, { color: colour.inkMuted }]}>Shown on the public club page only when marked public. Never a personal login email.</Text>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {contacts.length === 0 && !editing && (
          <Text style={[type.small, { color: colour.inkMuted, padding: space.lg }]}>No contacts yet.</Text>
        )}
        {contacts.map((c, i) => (
          <View key={c.id} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
            {editing?.id === c.id ? (
              <ContactEditor value={editing.input} onChange={(input) => setEditing({ id: c.id, input })} busy={busy} onCancel={() => setEditing(null)} onSave={() => void run(async () => { await saveClubContact(supabase, clubId, c.id, editing.input) }, "the contact")} />
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{c.name}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{CLUB_CONTACT_ROLE_LABEL[c.role]}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{[c.phone, c.email].filter(Boolean).join(" · ") || "No phone or email"}</Text>
                  </View>
                  <StatusPill label={c.isPublic ? "Public" : "Private"} tone={c.isPublic ? "positive" : "neutral"} />
                </View>
                {canEdit && removing !== c.id && (
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button label="Edit" variant="secondary" onPress={() => { setError(null); setEditing({ id: c.id, input: { role: c.role, name: c.name, phone: c.phone ?? "", email: c.email ?? "", isPublic: c.isPublic } }) }} disabled={busy} style={{ flex: 1 }} />
                    <Button label="Remove" variant="quiet" onPress={() => setRemoving(c.id)} disabled={busy} style={{ flex: 1 }} />
                  </View>
                )}
                {canEdit && removing === c.id && (
                  <View style={{ gap: space.sm }}>
                    <Text style={[type.small, { color: colour.ink }]}>Remove {c.name} from the club's contacts?</Text>
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Button label="Keep" variant="secondary" onPress={() => setRemoving(null)} disabled={busy} style={{ flex: 1 }} />
                      <Button label="Confirm Remove" onPress={() => void run(async () => { await deleteClubContact(supabase, c.id) }, "the contact")} busy={busy} style={{ flex: 1 }} />
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        ))}
        {editing && editing.id === null && (
          <View style={{ padding: space.lg, borderTopWidth: contacts.length ? 1 : 0, borderTopColor: colour.line }}>
            <ContactEditor value={editing.input} onChange={(input) => setEditing({ id: null, input })} busy={busy} onCancel={() => setEditing(null)} onSave={() => void run(async () => { await saveClubContact(supabase, clubId, null, editing.input) }, "the contact")} />
          </View>
        )}
        {error && (
          <View accessibilityRole="alert" style={{ margin: space.lg, marginTop: 0, padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
            <Text style={[type.small, { color: colour.danger }]}>{error}</Text>
          </View>
        )}
      </Card>
    </View>
  )
}

function ContactEditor({ value, onChange, busy, onCancel, onSave }: { value: ClubContactInput; onChange: (v: ClubContactInput) => void; busy: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Role</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Contact role" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {CLUB_CONTACT_ROLES.map((role: ClubContactRole) => {
            const active = value.role === role
            return (
              <Pressable
                key={role}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={CLUB_CONTACT_ROLE_LABEL[role]}
                onPress={() => onChange({ ...value, role })}
                style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colour.forest800 : colour.lineStrong, backgroundColor: active ? colour.forest800 : colour.surface, justifyContent: "center" }}
              >
                <Text style={[type.small, { color: active ? colour.onForest : colour.ink }]}>{CLUB_CONTACT_ROLE_LABEL[role]}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Field label="Name" value={value.name} onChange={(v) => onChange({ ...value, name: v })} editable={!busy} />
      <Field label="Phone" value={value.phone} onChange={(v) => onChange({ ...value, phone: v })} editable={!busy} keyboard="phone-pad" />
      <Field label="Email" value={value.email} onChange={(v) => onChange({ ...value, email: v })} editable={!busy} keyboard="email-address" />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET }}>
        <Text style={[type.small, { color: colour.ink, flex: 1 }]}>Show on the public club page</Text>
        <Switch accessibilityLabel="Show on the public club page" value={value.isPublic} onValueChange={(v) => onChange({ ...value, isPublic: v })} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} thumbColor={colour.surface} disabled={busy} />
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
        <Button label="Save Contact" onPress={onSave} busy={busy} style={{ flex: 2 }} />
      </View>
    </View>
  )
}
