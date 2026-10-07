import { useCallback, useEffect, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { deactivateMembership, peopleErrorMessage, personName, personSummary, readClubPerson, reasonRuleFor, removeFromClub, type ClubPerson } from "@ovalball/contracts/club/people"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"
import { resolvePersonalAvatarUrl } from "@ovalball/contracts/personal-avatar"

import { supabase } from "../auth/supabase"
import { holdIntent, takeIntent } from "../admin/pending-intent"
import { useAppContexts } from "../context/contexts"
import { PersonAvatar } from "../components/identity"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { CalendarDays, CircleX, History, Lock, TriangleAlert, Trash2, UserRoundX, Users } from "../components/icons"
import { friendly, friendlyAction } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { Body, FlowScreen } from "./ui"

/**
 * DEACTIVATE MEMBERSHIP and REMOVE FROM CLUB -- two different things, each a screen of its own that
 * says exactly what will happen before it happens (People & Invitations).
 *
 *   DEACTIVATE  the membership's reversible pause (SUSPENDED): access to the club stops, their roles are
 *               paused rather than deleted, the account and every record stay, and the club can
 *               reactivate them with the roles they had.
 *   REMOVE      the end of the relationship (REVOKED): every role here ends, history is kept, the
 *               Ovalball account is untouched, and coming back means a new invitation.
 *
 * Both go through `transition_club_membership`, which requires a reason and a recent authenticator and
 * refuses to leave the club without a Club Admin; the server's own sentence is shown when it refuses.
 * A reason typed before a step-up is put back when the person returns, never stored.
 */
export function MembershipChange({ clubId, membershipId, kind }: { clubId: string; membershipId: string; kind: "deactivate" | "remove" }) {
  const router = useRouter()
  const { club } = useAppContexts()
  const [person, setPerson] = useState<ClubPerson | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const intentKey = `membership:${kind}:${membershipId}`

  const load = useCallback(async () => {
    try {
      const p = await readClubPerson(supabase, clubId, membershipId)
      setPerson(p)
      setAvatarUrl(p?.avatarStoragePath ? await resolvePersonalAvatarUrl(supabase, p.avatarStoragePath) : null)
    } catch (cause) {
      setLoadProblem(friendly(cause, "this person").message)
    }
  }, [clubId, membershipId])
  useEffect(() => void load(), [load])
  useFocusEffect(
    useCallback(() => {
      const held = takeIntent<string>(intentKey)
      if (held !== null) setReason(held)
    }, [intentKey])
  )

  const name = person ? personName(person) : "this member"
  const clubName = club.name ?? "your club"
  const rule = reasonRuleFor("transition_club_membership", { actingOnSelf: person?.isSelf })
  const ready = rule !== "required" || reason.trim().length > 0
  const deactivate = kind === "deactivate"

  async function confirm() {
    if (!person?.membershipId) return
    setBusy(true)
    setProblem(null)
    try {
      if (deactivate) await deactivateMembership(supabase, person.membershipId, reason)
      else await removeFromClub(supabase, person.membershipId, reason)
      // THE REGISTER SAYS WHAT HAPPENED: back on the list, the person who acted reads the outcome rather than
      // inferring it from a row that has quietly moved.
      router.dismissTo({ pathname: "/admin/people", params: { notice: deactivate ? `${name}'s membership is deactivated.` : `${name} has been removed from the club.` } } as never)
    } catch (cause) {
      if (isRecentAuthRefusal(cause)) {
        holdIntent<string>(intentKey, reason)
        router.push({ pathname: "/step-up", params: { returnTo: `/admin/people/${membershipId}/${kind}` } } as never)
        return
      }
      setProblem(peopleErrorMessage(cause, friendlyAction(cause, "save", "this change").message))
    } finally {
      setBusy(false)
    }
  }

  const consequences = deactivate
    ? [
        { icon: <CircleX size={18} color={colour.danger} />, text: "They lose access to the club straight away." },
        { icon: <Users size={18} color={colour.inkMuted} />, text: "Their team roles are paused, not deleted." },
        { icon: <CalendarDays size={18} color={colour.inkMuted} />, text: "Past fixtures, allocations and records are kept." },
        { icon: <History size={18} color={colour.inkMuted} />, text: "You can reactivate them at any time, with the roles they had." },
      ]
    : [
        { icon: <CircleX size={18} color={colour.danger} />, text: "They lose all access to the club." },
        { icon: <UserRoundX size={18} color={colour.danger} />, text: "Every role they hold here ends." },
        { icon: <CalendarDays size={18} color={colour.inkMuted} />, text: "Past fixtures, allocations and records are kept." },
        { icon: <Lock size={18} color={colour.inkMuted} />, text: "This can't be undone. To bring them back, invite them again." },
      ]

  return (
    <FlowScreen title={deactivate ? "Deactivate Membership" : "Remove from Club"}>
      <Body gap={space.lg}>
        {loadProblem && <ErrorState message={loadProblem} onRetry={() => void load()} />}
        {!person && !loadProblem && <CardSkeleton lines={3} />}
        {person && (
          <>
            <View style={{ flexDirection: "row", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: deactivate ? "rgba(138,90,0,0.22)" : "rgba(193,34,27,0.22)", backgroundColor: deactivate ? colour.warningSurface : colour.dangerSurface }}>
              <TriangleAlert size={22} color={deactivate ? colour.warning : colour.danger} />
              <Text style={[type.body, { color: deactivate ? colour.ink : colour.danger, flex: 1 }]}>
                {deactivate
                  ? `Deactivating ${name} removes their access to ${clubName}. Their Ovalball account stays theirs.`
                  : `This permanently removes ${name} from ${clubName}. Their personal Ovalball account is not deleted.`}
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <PersonAvatar name={name} url={avatarUrl} size={56} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.heading, { color: colour.ink }]}>{name}</Text>
                {person.email && <Text style={[type.small, { color: colour.inkMuted }]}>{person.email}</Text>}
                <Text style={[type.small, { color: colour.inkMuted }]}>{personSummary(person)}</Text>
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{deactivate ? "What happens next" : "Before you continue"}</Text>
              {consequences.map((c) => (
                <View key={c.text} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.xs }}>
                  <View style={{ marginTop: 2 }}>{c.icon}</View>
                  <Text style={[type.body, { color: colour.ink, flex: 1 }]}>{c.text}</Text>
                </View>
              ))}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Reason{rule === "required" ? <Text style={{ color: colour.danger }}> *</Text> : " (Optional)"}</Text>
              <TextInput
                accessibilityLabel={rule === "required" ? "Reason, required" : "Reason, optional"}
                value={reason}
                onChangeText={setReason}
                placeholder={deactivate ? "e.g. Not returning next season" : "e.g. Left the club"}
                placeholderTextColor={colour.inkSubtle}
                multiline
                maxLength={500}
                style={[type.body, { minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlignVertical: "top" }]}
              />
              <Text style={[type.caption, { color: colour.inkMuted }]}>Recorded in the club's history with your name.</Text>
            </View>

            {problem && (
              <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
                <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>
              </View>
            )}

            <View style={{ gap: space.sm }}>
              <Button
                label={deactivate ? "Deactivate Membership" : "Remove from Club"}
                icon={deactivate ? <UserRoundX size={18} color={colour.onForest} /> : <Trash2 size={18} color={colour.onForest} />}
                onPress={() => void confirm()}
                busy={busy}
                disabled={!ready}
                style={{ backgroundColor: colour.danger, borderColor: colour.danger, minHeight: TOUCH_TARGET + 8 }}
              />
              {!ready && <Text style={[type.caption, { color: colour.inkMuted }]}>Give a reason to continue.</Text>}
              <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
            </View>
          </>
        )}
      </Body>
    </FlowScreen>
  )
}
