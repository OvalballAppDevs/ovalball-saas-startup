import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { KIT_PATTERNS, KIT_SWATCHES, describeKit, kitInputProblem, patternNeedsSecondary, type KitConfig, type KitPattern } from "@ovalball/contracts/agenda/kit"
import { kitErrorMessage, readBrandingCapabilities, readClubBranding, saveClubKit, type BrandingCapabilities, type ClubBranding, type KitVariant } from "@ovalball/contracts/club/branding"
import { OVALBALL_DEFAULT_KIT } from "@ovalball/contracts/club/theme"

import { AdminScreen } from "../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../src/admin/access"
import { supabase } from "../../../src/auth/supabase"
import { ClubCrest } from "../../../src/components/identity"
import { PictureSheet, type PictureAction } from "../../../src/components/picture-sheet"
import { RugbyKit } from "../../../src/components/rugby-kit"
import { Button, Card, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { useAppContexts } from "../../../src/context/contexts"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { removeClubCrest, replaceClubCrest } from "../../../src/identity/images"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * BRANDING -- the club's crest and its kit, natively (CA-M2).
 *
 * THREE IDENTITIES, KEPT APART ON ONE SCREEN. The crest is the club (`clubs.logo_storage_path`, else
 * the Club Directory's branding logo); the kit is what the club plays in (`club_kits`); neither is
 * ever drawn as the other, and nobody's avatar appears here. The crest tile is `ClubCrest`, the
 * shirt is `RugbyKit`, and the colours the rest of the product uses come from the home kit through
 * `resolveClubTheme` -- shown here, never edited as a separate thing.
 *
 * CREST: the same canonical flow the header already uses -- pick or take a square photo, the file
 * checked for type and size, uploaded to the club's own folder in `club-logos` under the bucket's
 * own policy (club.logo.manage), then linked, then the old file removed. A failed upload leaves the
 * previous crest in place. After success the record is re-read; nothing is patched in.
 *
 * KIT: Home and Away, each its own `club_kits` row, each saved on its own through `upsert_club_kit`
 * (club.profile.edit). The CHECK constraints are the authority; `kitInputProblem` is the same rule
 * said before the round trip.
 */
export default function BrandingScreen() {
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { refreshIdentityImages } = useAppContexts()
  const [branding, setBranding] = useState<ClubBranding | null>(null)
  const [caps, setCaps] = useState<BrandingCapabilities>({ crest: false, kit: false })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [picture, setPicture] = useState<PictureAction | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setBranding(null)
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const [next, allowed] = await Promise.all([readClubBranding(supabase, clubId), readBrandingCapabilities(supabase, clubId)])
      setBranding(next)
      setCaps(allowed)
    } catch (cause) {
      const translated = friendly(cause, "the club's branding")
      logDetail("admin:branding", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    setBranding(null)
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const crestAction: PictureAction | null =
    clubId && branding && caps.crest
      ? {
          subject: "the club crest",
          onReplace: async (file) => {
            const result = await replaceClubCrest(supabase, clubId, file)
            if (!result.ok) return result.message
            await Promise.all([refreshIdentityImages(), load()])
            return null
          },
          onRemove:
            branding.crest.source === "own"
              ? async () => {
                  const result = await removeClubCrest(supabase, clubId)
                  if (!result.ok) return result.message
                  await Promise.all([refreshIdentityImages(), load()])
                  return null
                }
              : null,
        }
      : null

  return (
    <AdminScreen section="Branding" onRefresh={() => void load()} refreshing={false}>
      {loading && !branding && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </View>
      )}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {!loading && !loadError && !branding && <ErrorState message="This club's branding is not available to you." />}

      {branding && (
        <>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              Branding
            </Text>
            <Text style={[type.body, { color: colour.inkMuted }]}>The crest is the club. The kit is what it plays in. The club's colours everywhere in Ovalball come from the home kit.</Text>
          </View>

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Crest
            </Text>
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                <ClubCrest clubName={branding.clubName} url={branding.crest.url} size={88} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{branding.clubName ?? "Club crest"}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    {branding.crest.source === "own" ? "The club's own upload. Shown on every Ovalball surface." : branding.crest.source === "directory" ? "From the Ovalball Club Directory, until the club uploads its own." : "No crest yet. The club's initials stand in."}
                  </Text>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>PNG, JPEG or WebP, up to 2MB. Square works best.</Text>
                </View>
              </View>
              {caps.crest ? (
                <Button label={branding.crest.source === "own" ? "Replace Crest" : "Upload Crest"} variant="secondary" onPress={() => setPicture(crestAction)} accessibilityHint="Choose or take a photo of the crest" />
              ) : (
                <Text style={[type.caption, { color: colour.inkMuted }]}>Changing the crest needs the club's crest permission.</Text>
              )}
            </Card>
          </View>

          <KitEditor clubId={branding.clubId} clubName={branding.clubName} kits={branding.kits} canEdit={caps.kit} onSaved={load} onRefused={() => { setCaps((c) => ({ ...c, kit: false })); void refreshAccess() }} />

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Club Colours
            </Text>
            <Card style={{ gap: space.sm }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {branding.theme.source === "home-kit" ? "Derived from the home kit above. Change the home kit to change them." : "The club has not set a home kit, so Ovalball's own colours stand in."}
              </Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Swatch label="Brand" hex={branding.theme.kit.primary} />
                <Swatch label="Second" hex={branding.theme.kit.secondary} />
                {branding.theme.kit.accent && <Swatch label="Trim" hex={branding.theme.kit.accent} />}
              </View>
            </Card>
          </View>
        </>
      )}

      <PictureSheet action={picture} onClose={() => setPicture(null)} />
    </AdminScreen>
  )
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <View accessibilityLabel={`${label} colour ${hex}`} style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: hex, borderWidth: 1, borderColor: colour.lineStrong }} />
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}

const VARIANTS: { key: KitVariant; label: string; sub: string }[] = [
  { key: "primary", label: "Home", sub: "Your usual shirt" },
  { key: "alternate", label: "Away", sub: "Worn when colours clash" },
]

const DEFAULT_KIT: KitConfig = { pattern: OVALBALL_DEFAULT_KIT.pattern, primaryColour: "#7a1f3d", secondaryColour: "#ffffff", accentColour: null }

/**
 * BOTH KITS ARE HELD LOCALLY, as on the website: switching Home/Away is not a round trip and does not
 * discard unsaved edits to the other kit. Each is saved on its own against its own row.
 */
function KitEditor({ clubId, clubName, kits, canEdit, onSaved, onRefused }: { clubId: string; clubName: string | null; kits: Record<KitVariant, KitConfig | null>; canEdit: boolean; onSaved: () => Promise<void>; onRefused: () => void }) {
  const [variant, setVariant] = useState<KitVariant>("primary")
  const [draft, setDraft] = useState<Record<KitVariant, KitConfig>>({ primary: kits.primary ?? DEFAULT_KIT, alternate: kits.alternate ?? { ...DEFAULT_KIT, primaryColour: "#ffffff", secondaryColour: "#7a1f3d" } })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  // The server's record is the baseline: a refocus or a save re-reads it, and an unsaved draft is kept.
  useEffect(() => {
    setDraft((d) => ({
      primary: kits.primary && sameKit(d.primary, kits.primary) ? kits.primary : kits.primary ?? d.primary,
      alternate: kits.alternate && sameKit(d.alternate, kits.alternate) ? kits.alternate : kits.alternate ?? d.alternate,
    }))
  }, [kits])

  const kit = draft[variant]
  const recorded = kits[variant]
  const dirty = !recorded || !sameKit(kit, recorded)
  const problem = kitInputProblem(kit)
  const twoTone = patternNeedsSecondary(kit.pattern)

  function edit(patch: Partial<KitConfig>) {
    setMessage(null)
    setDraft((d) => ({ ...d, [variant]: { ...d[variant], ...patch } }))
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await saveClubKit(supabase, clubId, variant, { ...kit, secondaryColour: twoTone ? kit.secondaryColour : null })
      await onSaved()
      setMessage({ tone: "ok", text: `${variant === "primary" ? "Home" : "Away"} kit saved. It is what the fixture card shows.` })
    } catch (cause) {
      setMessage({ tone: "error", text: kitErrorMessage(cause, friendly(cause, "the kit").message) })
      if ((cause as { code?: string }).code === "42501") onRefused()
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
        Kit
      </Text>
      <Card style={{ gap: space.lg }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Which kit" style={{ flexDirection: "row", gap: space.sm }}>
          {VARIANTS.map((v) => {
            const active = v.key === variant
            return (
              <Pressable key={v.key} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${v.label} kit`} onPress={() => { setVariant(v.key); setMessage(null) }} style={{ flex: 1, minHeight: TOUCH_TARGET + 8, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colour.forest800 : colour.lineStrong, backgroundColor: active ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                <Text style={[type.smallMedium, { color: active ? colour.onForest : colour.ink }]}>{v.label}</Text>
                <Text style={[type.caption, { color: active ? "rgba(255,255,255,0.72)" : colour.inkMuted }]}>{v.sub}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <RugbyKit kit={kit} clubName={clubName ?? undefined} variant={variant} size={96} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{describeKit(kit, clubName ?? undefined, variant)}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{recorded ? (dirty ? "Unsaved changes." : "As recorded.") : "Not recorded yet."}</Text>
          </View>
        </View>

        <Choice label="Pattern">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {KIT_PATTERNS.map((p) => {
              const active = kit.pattern === p.key
              return (
                <Pressable key={p.key} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${p.label}. ${p.description}`} disabled={!canEdit} onPress={() => edit({ pattern: p.key as KitPattern, secondaryColour: patternNeedsSecondary(p.key) ? (kit.secondaryColour ?? "#ffffff") : kit.secondaryColour })} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colour.forest800 : colour.lineStrong, backgroundColor: active ? colour.forest800 : colour.surface, justifyContent: "center", opacity: canEdit ? 1 : 0.6 }}>
                  <Text style={[type.small, { color: active ? colour.onForest : colour.ink }]}>{p.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </Choice>

        <ColourChoice label="First Colour" value={kit.primaryColour} onChange={(v) => edit({ primaryColour: v })} editable={canEdit} />
        {twoTone && <ColourChoice label="Second Colour" value={kit.secondaryColour ?? ""} onChange={(v) => edit({ secondaryColour: v })} editable={canEdit} />}
        <ColourChoice label="Trim" value={kit.accentColour ?? ""} onChange={(v) => edit({ accentColour: v || null })} editable={canEdit} optional />

        {problem && canEdit && <Text style={[type.small, { color: colour.warning }]}>{problem}</Text>}
        {message && (
          <View accessibilityRole={message.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: message.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
            <Text style={[type.small, { color: message.tone === "error" ? colour.danger : colour.forest800 }]}>{message.text}</Text>
          </View>
        )}
        {canEdit ? (
          <Button label={`Save ${variant === "primary" ? "Home" : "Away"} Kit`} onPress={() => void save()} busy={saving} disabled={!dirty || !!problem} />
        ) : (
          <Text style={[type.caption, { color: colour.inkMuted }]}>Changing the kit needs the Club Profile permission.</Text>
        )}
      </Card>
    </View>
  )
}

function sameKit(a: KitConfig, b: KitConfig): boolean {
  return a.pattern === b.pattern && a.primaryColour.toLowerCase() === b.primaryColour.toLowerCase() && (a.secondaryColour ?? "").toLowerCase() === (b.secondaryColour ?? "").toLowerCase() && (a.accentColour ?? "").toLowerCase() === (b.accentColour ?? "").toLowerCase()
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      {children}
    </View>
  )
}

function ColourChoice({ label, value, onChange, editable, optional = false }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; optional?: boolean }) {
  return (
    <Choice label={optional ? `${label} (optional)` : label}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {KIT_SWATCHES.map((hex) => {
          const active = value.toLowerCase() === hex
          return (
            <Pressable key={hex} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${label} ${hex}`} disabled={!editable} onPress={() => onChange(hex)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hex, borderWidth: active ? 3 : 1, borderColor: active ? colour.pitch600 : colour.lineStrong, opacity: editable ? 1 : 0.6 }} />
          )
        })}
      </View>
      <TextInput
        accessibilityLabel={`${label} colour code`}
        value={value}
        onChangeText={(v) => onChange(v.trim())}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={optional ? "None" : "#rrggbb"}
        placeholderTextColor={colour.inkSubtle}
        style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: editable ? colour.surface : "rgba(16,21,18,0.03)", color: colour.ink, width: 140 }]}
      />
    </Choice>
  )
}
