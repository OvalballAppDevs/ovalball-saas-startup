import { useCallback, useEffect, useState } from "react"
import { Modal, Pressable, Share, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
import * as Linking from "expo-linking"
import {
  deactivateSafeguardingOfficer,
  inviteSafeguardingOfficer,
  messageSafeguardingOfficer,
  nominateClubMemberAsOfficer,
  nominateSafeguardingContact,
  OFFICER_STATUS_LABEL,
  OFFICER_TYPE_LABEL,
  PENDING_CONFIRMATION_EXPLANATION,
  readClubSafeguarding,
  readNominationCandidates,
  resendSafeguardingOfficerInvitation,
  revokeSafeguardingOfficerInvitation,
  safeguardingErrorMessage,
  updateSafeguardingOfficerContact,
  type ClubSafeguardingState,
  type NominationCandidate,
  type OfficerType,
  type SafeguardingOfficerContact,
} from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../src/admin/screen"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { webUrl } from "../../../../src/config/environment"
import { ArrowRightLeft, ChevronRight, Copy, HeartHandshake, MessageCircleWarning, MessageSquare, Share2 } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { useSafeguardingOfficerAccess } from "../../../../src/safeguarding/access"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../../../../src/design/tokens"

const RETURN_TO = "/admin/safeguarding"

/**
 * SAFEGUARDING OFFICER (CA-M11.1) -- the club's safeguarding contact, natively, and the confirmed
 * officer's own sections on the same screen.
 *
 * ONE SCREEN, TWO KINDS OF AUTHORITY, NEITHER A ROLE LABEL. A person who holds the club's key sees the
 * appointment: who the officer is, the contact card, the invitation and the four things the website
 * offers to do about it. A person who holds the officer's keys sees, underneath, only the sections the
 * server has a read for. Somebody who holds both sees both; somebody who holds neither is told so.
 * Every control is offered from `my_capabilities` and judged again by the server on the call.
 *
 * NO EMAIL FROM THE PHONE. The website emails an invitation link from a server-only module. Here the
 * canonical issuer's link is shown ONCE, with copy and share, and the screen says no email was sent.
 *
 * NOTHING SENSATIONAL. No counts, no badges, no case content -- because there is none. A nomination
 * that Ovalball has not yet confirmed is shown as exactly that, in the website's own words.
 */
export default function SafeguardingScreen() {
  const router = useRouter()
  const { userId } = useSession()
  const { loading: accessLoading, clubId, access, refresh: refreshAccess } = useSafeguardingOfficerAccess()
  const [state, setState] = useState<ClubSafeguardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const pending = usePendingIntent("safeguarding")
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const [nominate, setNominate] = useState<{ officerType: OfficerType; mode: "member" | "contact"; query: string; userId: string | null; name: string; email: string } | null>(null)
  const [candidates, setCandidates] = useState<NominationCandidate[] | null>(null)
  const [edit, setEdit] = useState<{ officer: SafeguardingOfficerContact; name: string; email: string } | null>(null)
  const [message, setMessage] = useState<{ officer: SafeguardingOfficerContact; body: string } | null>(null)
  const [link, setLink] = useState<{ joinUrl: string; name: string; copied: boolean } | null>(null)
  /** The website's email fallback, honestly: no conversation was opened, and here is the recorded address. */
  const [noAccount, setNoAccount] = useState<{ name: string; email: string } | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      setState(await readClubSafeguarding(supabase, clubId))
    } catch (cause) {
      const translated = friendly(cause, "the club's safeguarding contact")
      logDetail("admin:safeguarding", translated)
      setError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  useEffect(() => {
    if (!nominate || nominate.mode !== "member" || candidates || !clubId) return
    let live = true
    readNominationCandidates(supabase, clubId)
      .then((c) => live && setCandidates(c))
      .catch(() => live && setCandidates([]))
    return () => {
      live = false
    }
  }, [nominate, candidates, clubId])

  const done = async (text: string) => {
    setNotice({ tone: "ok", text })
    await Promise.all([load(), refreshAccess()])
  }

  // ---- The club's operations: each one explicit, confirmed, and judged again by the server ----------

  function beginNominate(officerType: OfficerType) {
    setNominate({ officerType, mode: "member", query: "", userId: null, name: "", email: "" })
  }

  function confirmNominate() {
    if (!nominate || !clubId) return
    const n = nominate
    const label = OFFICER_TYPE_LABEL[n.officerType]
    if (n.mode === "member") {
      const who = candidates?.find((c) => c.userId === n.userId)
      if (!who) return
      setNominate(null)
      setAsk({
        title: `Nominate ${who.name} as ${label}?`,
        body: "Ovalball must confirm the appointment before it grants anything. Until then they hold no Safeguarding Officer authority.",
        confirmLabel: "Nominate",
        reason: "optional",
        onConfirm: async (reason) => {
          const result = await nominateClubMemberAsOfficer(supabase, { clubId, userId: who.userId, officerType: n.officerType, reason })
          if (result.outcome === "INVITATION_REQUIRED") {
            setNotice({ tone: "error", text: result.reason })
            await load()
            return
          }
          await done(`${who.name} nominated. Ovalball must confirm the appointment before it grants anything.`)
        },
      })
      return
    }
    const name = n.name.trim()
    const email = n.email.trim()
    if (!name || !email) return
    setNominate(null)
    setAsk({
      title: `Nominate ${name} as ${label}?`,
      body: "This records a contact only. It gives nobody access to Ovalball; invite them separately once they are nominated.",
      confirmLabel: "Nominate",
      reason: "none",
      onConfirm: async () => {
        await nominateSafeguardingContact(supabase, { clubId, officerType: n.officerType, contactName: name, contactEmail: email })
        await done(`${name} recorded as the club's ${label}.`)
      },
    })
  }

  function confirmEdit() {
    if (!edit) return
    const { officer, name, email } = edit
    if (!name.trim() || !email.trim()) return
    setEdit(null)
    setAsk({
      title: "Save Contact Details?",
      body: `The published contact for ${OFFICER_TYPE_LABEL[officer.officerType]} changes. Nothing about their access changes.`,
      confirmLabel: "Save Changes",
      reason: "none",
      onConfirm: async () => {
        await updateSafeguardingOfficerContact(supabase, officer.id, name, email)
        await done("Contact details saved.")
      },
    })
  }

  function invite(officer: SafeguardingOfficerContact, resend: boolean) {
    setAsk({
      title: resend ? `Resend the invitation to ${officer.contactName}?` : `Invite ${officer.contactName} to Ovalball?`,
      body: resend
        ? "A new link is issued and the old one stops working. No email is sent from the phone: you pass the link on yourself."
        : "An invitation link is issued for them to confirm the role. No email is sent from the phone: you pass the link on yourself.",
      confirmLabel: resend ? "Resend Invitation" : "Issue Invitation",
      reason: "none",
      onConfirm: async () => {
        const issued = resend ? await resendSafeguardingOfficerInvitation(supabase, officer.id, webUrl) : await inviteSafeguardingOfficer(supabase, officer.id, webUrl)
        setLink({ joinUrl: issued.joinUrl, name: officer.contactName, copied: false })
        await done(resend ? "Invitation reissued." : "Invitation issued.")
      },
    })
  }

  function revoke(officer: SafeguardingOfficerContact) {
    const invitation = officer.openInvitation
    if (!invitation) return
    setAsk({
      title: `Withdraw the invitation to ${officer.contactName}?`,
      body: invitation.legacy ? "The link stops working." : "The link stops working. The reason is recorded.",
      confirmLabel: "Withdraw Invitation",
      destructive: true,
      reason: invitation.legacy ? "none" : "required",
      onConfirm: async (reason) => {
        await revokeSafeguardingOfficerInvitation(supabase, invitation, reason)
        await done("Invitation withdrawn.")
      },
    })
  }

  function remove(officer: SafeguardingOfficerContact) {
    setAsk({
      title: `Remove ${officer.contactName} as ${OFFICER_TYPE_LABEL[officer.officerType]}?`,
      body: "This can be undone by nominating a replacement. Any safeguarding conversations move to a remaining confirmed officer, or Ovalball is told there is none.",
      confirmLabel: "Remove Assignment",
      destructive: true,
      reason: "none",
      onConfirm: async () => {
        await deactivateSafeguardingOfficer(supabase, officer.id)
        await done("Assignment ended.")
      },
    })
  }

  function confirmMessage() {
    if (!message || !clubId) return
    const { officer, body } = message
    if (!body.trim()) return
    setMessage(null)
    setAsk({
      title: `Send to ${officer.contactName}?`,
      body: officer.status === "active" ? "This opens a safeguarding conversation with the officer on Ovalball." : "This officer does not have an active Ovalball account yet; if a conversation cannot be opened you will be offered their recorded address instead.",
      confirmLabel: "Send",
      reason: "none",
      onConfirm: async () => {
        const result = await messageSafeguardingOfficer(supabase, clubId, officer.id, body)
        if (result.mode === "ovalball") {
          router.push(`/admin/safeguarding/threads/${result.conversationId}` as never)
          return
        }
        setNoAccount({ name: officer.contactName, email: officer.contactEmail })
      },
    })
  }

  // ---- Presentation ----------------------------------------------------------------------------

  const canSeeAnything = access.nominate || access.deactivate || access.conversationStart || access.anyOfficer || access.contactView
  const busy = accessLoading || loading

  return (
    <AdminScreen section="Safeguarding Officer" onRefresh={() => void Promise.all([load(), refreshAccess()])} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Safeguarding Officer
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>The club's designated Safeguarding Officer, their Ovalball status, and how to reach them.</Text>
      </View>

      {notice && (
        <View accessibilityRole={notice.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: notice.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
          <Text style={[type.small, { color: notice.tone === "error" ? colour.danger : colour.forest800 }]}>{notice.text}</Text>
        </View>
      )}

      {busy && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {!busy && !clubId && <EmptyState title="Choose a club context" body="Safeguarding works on the club you are viewing. Switch to a club context from the header." />}
      {!busy && clubId && !canSeeAnything && <EmptyState title="Nothing here for you" body="You do not currently hold a safeguarding permission at this club." />}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {!busy && clubId && state && canSeeAnything && (
        <>
          {!state.hasPrimary && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>No primary Safeguarding Officer</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>This club currently has no active primary Safeguarding Officer.</Text>
            </View>
          )}

          {state.pending.length > 0 && (
            <Section title="Awaiting Confirmation">
              {state.pending.map((a, i) => (
                <Row key={a.assignmentId} first={i === 0}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                      {a.personName ?? "A club member"} — {OFFICER_TYPE_LABEL[a.officerType]}
                    </Text>
                    <StatusPill label="Pending" tone="caution" />
                  </View>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: space.xs }]}>{PENDING_CONFIRMATION_EXPLANATION}</Text>
                </Row>
              ))}
            </Section>
          )}

          {state.confirmed.length > 0 && (
            <Section title="Confirmed Appointments">
              {state.confirmed.map((a, i) => (
                <Row key={a.assignmentId} first={i === 0}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                      {a.personName ?? "A club member"} — {OFFICER_TYPE_LABEL[a.officerType]}
                    </Text>
                    <StatusPill label={a.state === "SUSPENDED" ? "Suspended" : "Confirmed"} tone={a.state === "SUSPENDED" ? "caution" : "positive"} />
                  </View>
                </Row>
              ))}
            </Section>
          )}

          {state.officers.length > 0 && (
            <Section title="Safeguarding Contact">
              {state.officers.map((o, i) => {
                const own = !!userId && o.userId === userId
                const live = o.status !== "inactive"
                const canEdit = live && (access.nominate || (own && access.contactEditSelf))
                return (
                  <Row key={o.id} first={i === 0}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.smallMedium, { color: colour.ink }]}>{o.contactName}</Text>
                        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{OFFICER_TYPE_LABEL[o.officerType]}</Text>
                        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]} numberOfLines={1}>
                          {o.contactEmail}
                        </Text>
                      </View>
                      <StatusPill label={OFFICER_STATUS_LABEL[o.status]} tone={o.status === "active" ? "positive" : o.status === "invite_sent" ? "caution" : "neutral"} />
                    </View>
                    {(canEdit || access.nominate || access.conversationStart || access.deactivate) && live && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.sm }}>
                        {canEdit && <Button label="Edit Contact" variant="quiet" onPress={() => setEdit({ officer: o, name: o.contactName, email: o.contactEmail })} />}
                        {access.nominate && o.openInvitation && <Button label="Resend Invitation" variant="quiet" onPress={() => invite(o, true)} />}
                        {access.nominate && o.openInvitation && <Button label="Withdraw Invitation" variant="quiet" onPress={() => revoke(o)} />}
                        {access.nominate && !o.openInvitation && o.status !== "active" && <Button label="Invite to Ovalball" variant="quiet" onPress={() => invite(o, false)} />}
                        {access.conversationStart && !own && <Button label={o.status === "active" ? "Message Safeguarding Officer" : "Email Safeguarding Officer"} variant="quiet" onPress={() => setMessage({ officer: o, body: "" })} />}
                        {access.deactivate && <Button label="Remove Assignment" variant="quiet" onPress={() => remove(o)} />}
                      </View>
                    )}
                  </Row>
                )
              })}
            </Section>
          )}

          {access.nominate && (!state.hasPrimary || !state.hasDeputy) && (
            <View style={{ gap: space.sm }}>
              {!state.hasPrimary && <Button label="Nominate Safeguarding Officer" variant="secondary" onPress={() => beginNominate("primary")} />}
              {!state.hasDeputy && <Button label="Nominate Deputy Safeguarding Officer" variant="secondary" onPress={() => beginNominate("deputy")} />}
            </View>
          )}

          {(access.anyOfficer || access.conversationStart) && (
            <Section title={access.anyOfficer ? "Your Safeguarding Work" : "Conversations"}>
              {(access.officer.conversationHandle || access.conversationStart) && (
                <SectionLink
                  first
                  icon={<MessageSquare size={20} color={colour.forest800} strokeWidth={1.9} />}
                  label="Conversations"
                  caption={access.officer.conversationHandle ? "Safeguarding conversations for this club" : "Safeguarding conversations you have opened"}
                  onPress={() => router.push("/admin/safeguarding/threads" as never)}
                />
              )}
              {access.officer.dispensationView && <SectionLink icon={<ArrowRightLeft size={20} color={colour.forest800} strokeWidth={1.9} />} label="Dispensations" caption="Age-grade dispensations across the club's sides" onPress={() => router.push("/admin/safeguarding/dispensations" as never)} />}
              {access.officer.welfareView && <SectionLink icon={<HeartHandshake size={20} color={colour.forest800} strokeWidth={1.9} />} label="Welfare Lookup" caption="A player's team and guardian contact, with your reason recorded" onPress={() => router.push("/admin/safeguarding/welfare" as never)} />}
              {access.officer.moderationReview && <SectionLink icon={<MessageCircleWarning size={20} color={colour.forest800} strokeWidth={1.9} />} label="Reported Messages" caption="Messages members have reported at this club" onPress={() => router.push("/admin/safeguarding/reports" as never)} />}
            </Section>
          )}
        </>
      )}

      {/* ---- Nominate: a club member (the canonical path) or a contact card ---- */}
      <BottomSheet visible={!!nominate} onClose={() => setNominate(null)} title={nominate ? `Nominate ${OFFICER_TYPE_LABEL[nominate.officerType]}` : ""}>
        {nominate && (
          <>
            <View accessibilityRole="radiogroup" accessibilityLabel="Who to nominate" style={{ flexDirection: "row", gap: space.sm }}>
              {(["member", "contact"] as const).map((mode) => {
                const on = nominate.mode === mode
                return (
                  <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setNominate({ ...nominate, mode })} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                    <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{mode === "member" ? "Club Member" : "Contact Details"}</Text>
                  </Pressable>
                )
              })}
            </View>
            {nominate.mode === "member" ? (
              <>
                <Text style={[type.caption, { color: colour.inkMuted }]}>An active member of this club. Ovalball must confirm the appointment before it grants anything.</Text>
                <TextInput accessibilityLabel="Search members" value={nominate.query} onChangeText={(query) => setNominate({ ...nominate, query })} placeholder="Search by name" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} style={input} />
                <View style={{ maxHeight: 240, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
                  {candidates === null && <Text style={[type.caption, { color: colour.inkMuted, padding: space.md }]}>Loading members…</Text>}
                  {candidates?.filter((c) => c.name.toLowerCase().includes(nominate.query.trim().toLowerCase())).slice(0, 8).map((c, i) => {
                    const on = nominate.userId === c.userId
                    return (
                      <Pressable key={c.userId} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={c.name} onPress={() => setNominate({ ...nominate, userId: c.userId })} style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: on ? colour.mint100 : colour.surface }}>
                        <Text style={[type.small, { color: colour.ink }]}>{c.name}</Text>
                      </Pressable>
                    )
                  })}
                  {candidates && candidates.length === 0 && <Text style={[type.caption, { color: colour.inkMuted, padding: space.md }]}>No members can be listed here.</Text>}
                </View>
                <Button label="Continue" onPress={confirmNominate} disabled={!nominate.userId} />
              </>
            ) : (
              <>
                <Text style={[type.caption, { color: colour.inkMuted }]}>This adds a contact record only. It does not give this person Ovalball access; invite them separately once they are nominated.</Text>
                <TextInput accessibilityLabel="Name" value={nominate.name} onChangeText={(name) => setNominate({ ...nominate, name })} placeholder="Name" placeholderTextColor={colour.inkSubtle} autoCorrect={false} style={input} />
                <TextInput accessibilityLabel="Email" value={nominate.email} onChangeText={(email) => setNominate({ ...nominate, email })} placeholder="Email" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} />
                <Button label="Continue" onPress={confirmNominate} disabled={!nominate.name.trim() || !nominate.email.trim()} />
              </>
            )}
          </>
        )}
      </BottomSheet>

      {/* ---- Edit the contact card ---- */}
      <BottomSheet visible={!!edit} onClose={() => setEdit(null)} title="Edit Contact">
        {edit && (
          <>
            <TextInput accessibilityLabel="Name" value={edit.name} onChangeText={(name) => setEdit({ ...edit, name })} placeholder="Name" placeholderTextColor={colour.inkSubtle} autoCorrect={false} style={input} />
            <TextInput accessibilityLabel="Email" value={edit.email} onChangeText={(email) => setEdit({ ...edit, email })} placeholder="Email" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} />
            <Button label="Continue" onPress={confirmEdit} disabled={!edit.name.trim() || !edit.email.trim()} />
          </>
        )}
      </BottomSheet>

      {/* ---- Message the officer ---- */}
      <BottomSheet visible={!!message} onClose={() => setMessage(null)} title={message ? `Message ${message.officer.contactName}` : ""}>
        {message && (
          <>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{message.officer.status === "active" ? "This opens a safeguarding conversation with the officer on Ovalball." : "This officer does not have an active Ovalball account yet."}</Text>
            <TextInput accessibilityLabel="Your message" value={message.body} onChangeText={(body) => setMessage({ ...message, body })} multiline textAlignVertical="top" placeholder="What would you like to raise?" placeholderTextColor={colour.inkSubtle} style={[input, { minHeight: TOUCH_TARGET * 2.5, paddingVertical: space.md }]} />
            <Button label="Continue" onPress={confirmMessage} disabled={!message.body.trim()} />
          </>
        )}
      </BottomSheet>

      {/* ---- The invitation link, shown once ---- */}
      <BottomSheet visible={!!link} onClose={() => setLink(null)} title="Invitation Link">
        {link && (
          <>
            <Text style={[type.small, { color: colour.inkMuted }]}>No email was sent from the phone. Pass this link to {link.name} yourself. It confirms a named safeguarding role, so only give it to the person named.</Text>
            <View style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
              <Text selectable style={[type.caption, { color: colour.ink }]}>{link.joinUrl}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy Link"
                onPress={() => void Clipboard.setStringAsync(link.joinUrl).then(() => setLink({ ...link, copied: true }))}
                style={{ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}
              >
                <Copy size={16} color={colour.ink} />
                <Text style={[type.smallMedium, { color: colour.ink }]}>{link.copied ? "Copied" : "Copy Link"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share Link"
                onPress={() => void Share.share({ message: link.joinUrl }).catch(() => undefined)}
                style={{ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, backgroundColor: colour.forest800 }}
              >
                <Share2 size={16} color={colour.onForest} />
                <Text style={[type.smallMedium, { color: colour.onForest }]}>Share Link</Text>
              </Pressable>
            </View>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>This link is shown once. Resend the invitation to issue a new one.</Text>
          </>
        )}
      </BottomSheet>

      <BottomSheet visible={!!noAccount} onClose={() => setNoAccount(null)} title="No Conversation Opened">
        {noAccount && (
          <>
            <Text style={[type.small, { color: colour.inkMuted }]}>{noAccount.name} does not have an active Ovalball account yet, so no Ovalball conversation was opened and nothing was sent. The website would email them; the phone does not. Reach them at their recorded address instead.</Text>
            <Button label="Open Email" onPress={() => void Linking.openURL(`mailto:${noAccount.email}`)} />
          </>
        )}
      </BottomSheet>

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void refreshAccess()}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: RETURN_TO } } as never)
        }}
        errorMessage={(cause) => safeguardingErrorMessage(cause, friendly(cause, "this request").message)}
      />
    </AdminScreen>
  )
}

const input = { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, ...type.body } as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>{title.toUpperCase()}</Text>
      <Card style={{ padding: 0, overflow: "hidden" }}>{children}</Card>
    </View>
  )
}

function Row({ first, children }: { first: boolean; children: React.ReactNode }) {
  return <View style={{ padding: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>{children}</View>
}

function SectionLink({ icon, label, caption, onPress, first = false }: { icon: React.ReactNode; label: string; caption: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

function BottomSheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md }, elevation.sheet]}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        {children}
        <Button label="Cancel" variant="quiet" onPress={onClose} />
      </View>
    </Modal>
  )
}
