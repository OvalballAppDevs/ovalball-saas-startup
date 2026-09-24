import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { resolvePersonalAvatarUrls } from "@ovalball/contracts/personal-avatar"
import {
  decideJoinRequest,
  PEOPLE_FILTERS,
  peopleErrorMessage,
  personName,
  readClubPeople,
  readPendingJoinRequests,
  readPeopleCapabilities,
  reasonRuleFor,
  type ClubPerson,
  type PendingJoinRequest,
  type PeopleCapabilities,
  type PeopleFilter,
} from "@ovalball/contracts/club/people"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { inviteClubStaff, readInvitationCapabilities, readStaffRoleOptions, resendInvitation, revokeInvitation, type InvitationCapabilities, type StaffRoleOption } from "@ovalball/contracts/club/invitations"
import { Modal } from "react-native"
import { supabase } from "../../../../src/auth/supabase"
import { Search } from "../../../../src/components/icons"
import { PersonRow } from "../../../../src/admin/person-row"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const PAGE = 50

/**
 * PEOPLE -- the club's memberships, natively (CA-M3).
 *
 * WHO IS HERE: the club's members (accounts) in every live state, with their primary club role,
 * their team roles and any additional role; staff invitations still open; and, above the list, the
 * requests to join waiting for a decision. Players and guardians are their own products and are
 * not rows here. The read is `club_people`: paged, searched and filtered on the SERVER, so a club
 * of a thousand people is fifty rows at a time, not a scroll.
 *
 * THREE IDENTITIES: the avatar here is the PERSON's (`resolvePersonalAvatarUrls`, the same
 * resolver the header uses); the club's crest is in the bar; a kit never appears.
 *
 * AUTHORITY is the server's: the section itself needs people.member.view; an email needs
 * people.member.view_contact and simply is not in the payload otherwise; deciding a join request
 * asks its own keys. Re-read on focus and after every write.
 */
export default function PeopleScreen() {
  const router = useRouter()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const [caps, setCaps] = useState<PeopleCapabilities | null>(null)
  const [filter, setFilter] = useState<PeopleFilter>("all")
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [total, setTotal] = useState(0)
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map())
  const [requests, setRequests] = useState<PendingJoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  // INVITATIONS (CA-M10): the canonical architecture -- issue, resend, revoke -- offered only where the
  // club-scope probe says so. Issuing needs recent authentication, so a refusal steps up and returns.
  const [inviteCaps, setInviteCaps] = useState<InvitationCapabilities>({ create: false, revoke: false })
  const [roleOptions, setRoleOptions] = useState<StaffRoleOption[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<string | null>(null)
  const pending = usePendingIntent("people:invitations")
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const generation = useRef(0)

  const load = useCallback(
    async (offset = 0) => {
      if (!clubId) {
        setLoading(false)
        return
      }
      const gen = ++generation.current
      setError(null)
      if (offset === 0) setLoading(true)
      else setLoadingMore(true)
      try {
        const [page, allowed] = await Promise.all([readClubPeople(supabase, clubId, { search: query, filter, limit: PAGE, offset }), readPeopleCapabilities(supabase, clubId)])
        if (gen !== generation.current) return
        setCaps(allowed)
        const list = offset === 0 ? page.people : [...people, ...page.people]
        setPeople(list)
        setTotal(page.total)
        const paths = list.filter((p) => p.userId && p.avatarStoragePath).map((p) => p.avatarStoragePath as string)
        const urls = await resolvePersonalAvatarUrls(supabase, paths)
        if (gen !== generation.current) return
        setAvatars(urls)
        if (offset === 0 && allowed.assignClub) {
          try {
            setRequests(await readPendingJoinRequests(supabase, clubId))
          } catch {
            setRequests([])
          }
        }
      } catch (cause) {
        const translated = friendly(cause, "the club's people")
        logDetail("admin:people", translated)
        if (gen === generation.current) setError(translated)
      } finally {
        if (gen === generation.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    // people is read for appending only; a filter or query change always restarts from offset 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubId, query, filter]
  )

  useEffect(() => {
    const t = setTimeout(() => void load(0), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, query])
  useFocusEffect(
    useCallback(() => {
      void load(0)
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )
  useEffect(() => {
    if (!clubId) return
    let live = true
    void readInvitationCapabilities(supabase, clubId).then((c) => { if (live) setInviteCaps(c) }).catch(() => undefined)
    void readStaffRoleOptions(supabase).then((o) => { if (live) setRoleOptions(o.filter((r) => !r.heldAtTeam)) }).catch(() => undefined)
    return () => { live = false }
  }, [clubId])

  function invite() {
    if (!clubId || !inviteEmail.trim() || !inviteRole) return
    const email = inviteEmail.trim()
    const role = inviteRole
    setInviteOpen(false)
    setAsk({
      title: `Invite ${email}?`,
      body: `They receive an email and join the club as ${roleOptions.find((r) => r.roleKey === role)?.label ?? role} when they accept.`,
      confirmLabel: "Send Invitation",
      reason: "none",
      onConfirm: async () => {
        const result = await inviteClubStaff(supabase, { clubId, email, clubRoles: [role] })
        setNotice({ tone: "ok", text: result.alreadyExisted ? "An invitation to that address is already open." : `Invitation sent to ${email}.` })
        setInviteEmail("")
        setInviteRole(null)
        await load(0)
      },
    })
  }

  function invitationAction(p: ClubPerson, action: "resend" | "revoke") {
    if (!p.invitationId) return
    const who = p.invitationEmail ?? "this invitation"
    setAsk(
      action === "resend"
        ? { title: `Resend to ${who}?`, body: "The same invitation goes again; nothing else changes.", confirmLabel: "Resend", reason: "none", onConfirm: async () => { await resendInvitation(supabase, p.invitationId!); setNotice({ tone: "ok", text: "Resent." }); await load(0) } }
        : { title: `Revoke the invitation to ${who}?`, body: "The link stops working. The reason is recorded.", confirmLabel: "Revoke", destructive: true, reason: "required", onConfirm: async (reason) => { await revokeInvitation(supabase, p.invitationId!, reason); setNotice({ tone: "ok", text: "Revoked." }); await load(0) } }
    )
  }

  async function decide(r: PendingJoinRequest, decision: "APPROVE" | "DECLINE") {
    const rule = decision === "DECLINE" ? "required" : reasonRuleFor("decide_club_join_request")
    setAsk({
      title: decision === "APPROVE" ? `Approve ${personName({ firstName: r.firstName, surname: r.surname, invitationEmail: null })}?` : `Decline ${personName({ firstName: r.firstName, surname: r.surname, invitationEmail: null })}?`,
      body: decision === "APPROVE" ? "They become a member of the club with the role they asked for." : "They will be told the club declined. The reason is recorded.",
      confirmLabel: decision === "APPROVE" ? "Approve" : "Decline",
      destructive: decision === "DECLINE",
      reason: rule,
      onConfirm: async (reason) => {
        await decideJoinRequest(supabase, r.requestId, decision, reason)
        setNotice({ tone: "ok", text: decision === "APPROVE" ? "Approved. They are now a member." : "Declined." })
        await load(0)
      },
    })
  }

  return (
    <AdminScreen section="People" onRefresh={() => void load(0)} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          People
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>The club's members and staff, and who is waiting to join. Players and their families are managed from their teams.</Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
        <Search size={18} color={colour.inkSubtle} />
        <TextInput accessibilityLabel="Search people" value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel="Filter people" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {PEOPLE_FILTERS.map((f) => {
          const on = filter === f.key
          return (
            <Pressable key={f.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={f.label} onPress={() => setFilter(f.key)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
              <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {notice && (
        <View accessibilityRole={notice.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: notice.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
          <Text style={[type.small, { color: notice.tone === "error" ? colour.danger : colour.forest800 }]}>{notice.text}</Text>
        </View>
      )}

      {caps?.assignClub && requests.length > 0 && filter === "all" && !query && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>WAITING ON YOU</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {requests.map((r, i) => (
              <View key={r.requestId} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{personName({ firstName: r.firstName, surname: r.surname, invitationEmail: null })}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Asked to join{r.requestedRole ? ` as ${r.requestedRole.replace(/_/g, " ").toLowerCase()}` : ""}</Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Decline" variant="secondary" onPress={() => void decide(r, "DECLINE")} style={{ flex: 1 }} />
                  <Button label="Approve" onPress={() => void decide(r, "APPROVE")} style={{ flex: 1 }} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load(0)} offline={error.retryable} />}

      {!loading && !error && people.length === 0 && (query ? <EmptyState title="No people match this search" body="Try a different name." /> : <EmptyState title={filter === "all" ? "No people yet" : "Nobody here"} body={filter === "all" ? "Members appear when they join the club or accept an invitation." : "Nobody matches this filter right now."} />)}

      {!loading && people.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>
            {total} {total === 1 ? "person" : "people"}
          </Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {people.map((p, i) => (
              <View key={p.membershipId ?? p.invitationId ?? String(i)}>
                <PersonRow person={p} avatarUrl={p.avatarStoragePath ? (avatars.get(p.avatarStoragePath) ?? null) : null} first={i === 0} onPress={p.membershipId ? () => router.push(`/admin/people/${p.membershipId}` as never) : undefined} />
                {p.kind === "invited" && !!p.invitationId && (inviteCaps.create || inviteCaps.revoke) && (
                  <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
                    {inviteCaps.create && <Button label="Resend" variant="quiet" onPress={() => invitationAction(p, "resend")} />}
                    {inviteCaps.revoke && <Button label="Revoke" variant="quiet" onPress={() => invitationAction(p, "revoke")} />}
                  </View>
                )}
              </View>
            ))}
          </Card>
          {people.length < total && <Button label={loadingMore ? "Loading…" : `Show More (${total - people.length} more)`} variant="secondary" busy={loadingMore} onPress={() => void load(people.length)} />}
        </View>
      )}

      {inviteCaps.create && <Button label="Invite Staff" variant="secondary" onPress={() => setInviteOpen(true)} />}

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setInviteOpen(false)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Invite Staff</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>An email invitation to join the club with a role. The server decides which roles you may give.</Text>
            <TextInput accessibilityLabel="Email address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="Their email address" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
            <View accessibilityRole="radiogroup" accessibilityLabel="Role" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {roleOptions.map((r) => {
                const on = inviteRole === r.roleKey
                return (
                  <Pressable key={r.roleKey} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={r.label} onPress={() => setInviteRole(r.roleKey)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                    <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{r.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Button label="Continue" onPress={invite} disabled={!inviteEmail.trim() || !inviteRole} />
          </Pressable>
        </Pressable>
      </Modal>

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void refreshAccess()}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/people" } } as never)
        }}
        errorMessage={(cause) => peopleErrorMessage(cause, friendly(cause, "this request").message)}
      />
    </AdminScreen>
  )
}

