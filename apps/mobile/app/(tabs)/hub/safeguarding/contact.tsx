import { useEffect, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"

import { supabase } from "../../../../src/auth/supabase"
import { Button } from "../../../../src/components/ui"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { oneParam } from "../../../../src/hub/bundles"
import { openExternal } from "../../../../src/hub/routes"
import { HubScreen } from "../../../../src/hub/screen"
import { HubCallout, HubHero, HubLoading, HubNotice, HubTextLink } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * CONTACT THE CLUB SAFEGUARDING OFFICER — the one hand-off, unchanged.
 *
 * OVALBALL mode calls the existing `start_or_get_safeguarding_officer_conversation`
 * RPC, which decides for itself whether THIS viewer may open a conversation
 * with THIS officer at THIS club and opens (or finds) the one conversation
 * between them; the screen then confirms, exactly as the website does, and
 * every later message uses the ordinary messaging rules. EMAIL mode shows the officer's
 * registered address, read here through RLS -- never an address carried in
 * the link. No new authority and no new messaging path is introduced; the
 * ids in the link only say who was chosen on the previous screen.
 */
export default function SafeguardingContactScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ club?: string; assignment?: string; mode?: string }>()
  const clubId = oneParam(params.club)
  const assignmentId = oneParam(params.assignment)
  const modeParam = oneParam(params.mode)
  const mode = modeParam === "EMAIL" ? "EMAIL" : modeParam === "OVALBALL" ? "OVALBALL" : null
  const [officer, setOfficer] = useState<{ name: string | null; email: string | null } | null | undefined>(undefined)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!assignmentId) {
      setOfficer(null)
      return
    }
    let live = true
    supabase
      .from("club_safeguarding_officers")
      .select("contact_name, contact_email")
      .eq("id", assignmentId)
      .maybeSingle()
      .then(({ data }) => live && setOfficer(data ? { name: data.contact_name, email: data.contact_email } : null))
    return () => {
      live = false
    }
  }, [assignmentId])

  const name = officer?.name ?? "the Safeguarding Officer"
  const incomplete = !clubId || !assignmentId || !mode

  const send = async () => {
    if (!clubId || !assignmentId) return
    setSending(true)
    setProblem(null)
    try {
      const { error } = await supabase.rpc("start_or_get_safeguarding_officer_conversation", { p_club_id: clubId, p_officer_id: assignmentId, p_first_message: body.trim() })
      if (error) throw error
      setSent(true)
    } catch (cause) {
      const translated = friendly(cause, "your message")
      logDetail("hub:safeguarding-contact", translated)
      setProblem(translated.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <HubScreen section="Safeguarding">
      <HubHero title="Contact Safeguarding Officer" />
      {incomplete ? (
        <HubNotice tone="unavailable" message="This contact link is missing required information." />
      ) : officer === undefined ? (
        <HubLoading rows={1} />
      ) : mode === "EMAIL" ? (
        <HubCallout tone="mint">
          <View style={{ gap: space.sm }}>
            <Text style={{ ...type.body, color: "rgba(11,43,30,0.88)" }}>{officer?.name ?? "This officer"} is not yet an active Ovalball user, so the fastest way to reach them is by email.</Text>
            {officer?.email && <HubTextLink external label={officer.email} onPress={() => openExternal(`mailto:${officer.email}`)} />}
          </View>
        </HubCallout>
      ) : sent ? (
        <HubNotice tone="reviewing" message={`Your message has been sent to ${name}.`} />
      ) : (
        <View style={{ gap: space.md }}>
          <Text nativeID="mc-officer-message-label" style={[type.smallMedium, { color: colour.ink }]}>
            Message to {name}
          </Text>
          <TextInput
            accessibilityLabel={`Message to ${name}`}
            accessibilityLabelledBy="mc-officer-message-label"
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            placeholder="What would you like to raise?"
            placeholderTextColor={colour.inkSubtle}
            style={{ minHeight: TOUCH_TARGET * 3, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingVertical: space.md, ...type.body, color: colour.ink }}
          />
          <Button label={sending ? "Sending…" : "Send"} busy={sending} disabled={!body.trim()} onPress={() => void send()} style={{ alignSelf: "flex-start" }} />
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {problem}
            </Text>
          )}
        </View>
      )}
      <HubTextLink label="Back to Safeguarding" onPress={() => router.dismissTo("/hub/safeguarding")} />
    </HubScreen>
  )
}
