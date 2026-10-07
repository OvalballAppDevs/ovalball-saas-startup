import { useCallback, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { resolvePersonalAvatarUrls } from "@ovalball/contracts/personal-avatar"
import {
  PEOPLE_FILTERS,
  decideJoinRequest,
  peopleErrorMessage,
  personName,
  readAccessSummary,
  readClubPeople,
  readPendingJoinRequests,
  readPeopleCapabilities,
  reasonRuleFor,
  type ClubPerson,
  type PendingJoinRequest,
  type PeopleCapabilities,
  type PeopleFilter,
} from "@ovalball/contracts/club/people"
import { canonicalRoleLabel } from "@ovalball/contracts/role-labels"
import { readInvitationCapabilities, resendInvitation, revokeInvitation, type InvitationCapabilities } from "@ovalball/contracts/club/invitations"
import { invitationExpiryLabel, invitationJoinUrl, type InvitationShareData } from "@ovalball/contracts/invitations"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { ShareView } from "../../../../src/sharing/share-view"
import { webUrl } from "../../../../src/config/environment"
import { useAppContexts } from "../../../../src/context/contexts"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, KeyRound, Plus, Search, X } from "../../../../src/components/icons"
import { PersonRow } from "../../../../src/admin/person-row"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, friendlyAction, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const PAGE = 50

/**
 * PEOPLE -- the club's one register (CA-M3, rebuilt by People & Invitations).
 *
 * WHO IS HERE: the club's members in every live state, the players placed in its teams (for the people
 * who may read the club's rosters), and the invitations still open -- one row per person, whatever they
 * do. The filters keep two questions apart: ADMINS is club access; STAFF is what people do. Deactivated
 * is a lifecycle STATE, not a kind of person: it is not a chip and not mixed into All -- one quiet line at
 * the foot says how many there are and opens them.
 *
 * The read is `club_people`: paged, searched and filtered on the SERVER, so a club of a thousand people is
 * fifty rows at a time. Roles & Access opens the counts; a role or a title from there narrows this list.
 * The one way in is Add to Club, at the foot.
 *
 * THREE IDENTITIES: the avatar here is the PERSON's (`resolvePersonalAvatarUrls`); the club's crest is in
 * the bar; a kit never appears. AUTHORITY is the server's, re-read on focus and after every write.
 */
export default function PeopleScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ role?: string; title?: string; filter?: string; notice?: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { club } = useAppContexts()
  const [caps, setCaps] = useState<PeopleCapabilities | null>(null)
  const [filter, setFilter] = useState<PeopleFilter>((params.filter as PeopleFilter) || "all")
  const [role, setRole] = useState<string | null>(params.role ?? null)
  const [title, setTitle] = useState<string | null>(params.title ?? null)
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [total, setTotal] = useState(0)
  const [deactivated, setDeactivated] = useState<number | null>(null)
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map())
  const [requests, setRequests] = useState<PendingJoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [inviteCaps, setInviteCaps] = useState<InvitationCapabilities>({ create: false, revoke: false })
  // A RESEND ROTATES THE SECRET: the new link and code are shown once, in the page.
  const [reissued, setReissued] = useState<{ share: InvitationShareData; person: ClubPerson } | null>(null)
  const pending = usePendingIntent("people:invitations")
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const generation = useRef(0)
  // AT LARGE TEXT SIZES Add to Club joins the end of the list: pinned, it took a third of what was left
  // between the header and the tab bar.
  const { fontScale } = useWindowDimensions()
  const inlineAdd = fontScale > LARGE_TEXT_SCALE

  // An outcome another screen hands back (a deactivation, a removal) is said here, once, then forgotten.
  useEffect(() => {
    if (!params.notice) return
    setNotice({ tone: "ok", text: params.notice })
    router.setParams({ notice: undefined } as never)
  }, [params.notice, router])

  // Said aloud as well as shown: a notice appearing above the list is otherwise silent on iOS.
  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice.text)
  }, [notice])

  useEffect(() => {
    setRole(params.role ?? null)
    setTitle(params.title ?? null)
    if (params.filter) setFilter(params.filter as PeopleFilter)
  }, [params.role, params.title, params.filter])

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
        const [page, allowed] = await Promise.all([readClubPeople(supabase, clubId, { search: query, filter, limit: PAGE, offset, roleKey: role ?? undefined, title: title ?? undefined }), readPeopleCapabilities(supabase, clubId)])
        if (gen !== generation.current) return
        setCaps(allowed)
        const list = offset === 0 ? page.people : [...people, ...page.people]
        setPeople(list)
        setTotal(page.total)
        const paths = list.filter((p) => p.kind === "member" && p.avatarStoragePath).map((p) => p.avatarStoragePath as string)
        const urls = await resolvePersonalAvatarUrls(supabase, paths)
        if (gen !== generation.current) return
        setAvatars(urls)
        if (offset === 0) {
          readAccessSummary(supabase, clubId).then((s) => gen === generation.current && setDeactivated(s.deactivated)).catch(() => undefined)
          if (allowed.assignClub) {
            try {
              setRequests(await readPendingJoinRequests(supabase, clubId))
            } catch {
              setRequests([])
            }
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
    // people is read for appending only; a filter, role, title or query change always restarts from offset 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubId, query, filter, role, title]
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
    return () => { live = false }
  }, [clubId])

  function invitationAction(p: ClubPerson, action: "resend" | "revoke") {
    if (!p.invitationId) return
    const who = personName(p)
    setAsk(
      action === "resend"
        ? { title: `Reissue the invitation to ${who}?`, body: "A new link and a new code are created; the ones they were sent before stop working.", confirmLabel: "Reissue", reason: "none", onConfirm: async () => { const next = await resendInvitation(supabase, p.invitationId!); if (next.token) { setNotice(null); setReissued({ person: p, share: { url: invitationJoinUrl(next.token, webUrl), code: next.code, outcome: [], expiresLabel: invitationExpiryLabel(next.expiresAt), sentTo: null, replacesPrevious: true } }) } else setNotice({ tone: "ok", text: "Reissued." }); await load(0) } }
        : { title: `Withdraw the invitation to ${who}?`, body: "The link stops working. The reason is recorded.", confirmLabel: "Withdraw Invitation", destructive: true, reason: "required", onConfirm: async (reason) => { await revokeInvitation(supabase, p.invitationId!, reason); setNotice({ tone: "ok", text: "Invitation withdrawn." }); await load(0) } }
    )
  }

  async function decide(r: PendingJoinRequest, decision: "APPROVE" | "DECLINE") {
    const rule = decision === "DECLINE" ? "required" : reasonRuleFor("decide_club_join_request")
    const who = personName({ firstName: r.firstName, surname: r.surname, invitationEmail: null })
    setAsk({
      title: decision === "APPROVE" ? `Approve ${who}?` : `Decline ${who}?`,
      body: decision === "APPROVE" ? "They become a member of the club." : "They will be told the club declined. The reason is recorded.",
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

  const filters = PEOPLE_FILTERS.filter((f) => !f.needsPlayers || caps?.viewPlayers)
  const narrowed = role ? canonicalRoleLabel(role) : title
  const listTitle = narrowed ? narrowed : filter === "deactivated" ? "Deactivated" : filter === "all" ? "Club People" : (PEOPLE_FILTERS.find((f) => f.key === filter)?.label ?? "People")
  const canAdd = !!caps && (caps.invite || caps.joinCodes || caps.assignTeam)

  return (
    <AdminScreen
      section="People"
      onRefresh={() => void load(0)}
      refreshing={false}
      footer={
        canAdd && !inlineAdd ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colour.chalk, borderTopWidth: 1, borderTopColor: colour.line }}>
            <Button label="Add to Club" icon={<Plus size={18} color={colour.onForest} />} onPress={() => router.push("/admin/people/add" as never)} />
          </View>
        ) : undefined
      }
    >
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>People</Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Everyone who belongs to {club.name ?? "the club"}: what they do, and what they can access.</Text>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Roles and Access. Who can do what, and who does what" onPress={() => router.push("/admin/people/access" as never)} style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.mint100 : colour.surface })}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
          <KeyRound size={19} color={colour.forest800} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.heading, { color: colour.ink }]}>Roles & Access</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Who can do what, and who does what</Text>
        </View>
        <ChevronRight size={18} color={colour.inkSubtle} />
      </Pressable>

      {!narrowed && (
        // THE FILTERS WRAP, never scroll sideways: a chosen filter must always be in view, and at a large text
        // size the row becomes two rather than hiding "Pending" off the edge.
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Filter people">
          {filters.map((f) => {
            const on = filter === f.key
            return (
              <Pressable key={f.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={f.label} onPress={() => setFilter(f.key)} style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {narrowed && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingLeft: space.md, borderRadius: radius.pill, backgroundColor: colour.mint100, alignSelf: "flex-start" }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Showing {narrowed}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Show everyone, not only ${narrowed}`} onPress={() => { setRole(null); setTitle(null); router.setParams({ role: undefined, title: undefined } as never) }} hitSlop={6} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
            <X size={16} color={colour.forest800} />
          </Pressable>
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
        <Search size={18} color={colour.inkSubtle} />
        <TextInput accessibilityLabel="Search people" value={query} onChangeText={setQuery} placeholder={caps?.viewContact ? "Search by name or email" : "Search by name"} placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
      </View>

      {/* THE REISSUED CREDENTIAL, IN THE PAGE. In a second modal opened while the Reissue confirmation was still
          closing, iOS dismissed it with the confirmation and the new link and code -- shown once -- were never seen. */}
      {reissued && (
        <View accessibilityLiveRegion="polite" style={{ padding: space.md, gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.pitch600, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.forest800 }]}>Invitation Reissued</Text>
          <ShareView
            share={reissued.share}
            subject={{ kind: "INVITATION", clubName: club.name ?? "Our club", roleLine: null, placeName: null, inviteeName: reissued.person.invitationName }}
            email={reissued.person.invitationEmail?.includes("…") ? null : reissued.person.invitationEmail}
            onDone={() => setReissued(null)}
          />
        </View>
      )}
      {notice && (
        <View accessibilityRole={notice.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: notice.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
          <Text style={[type.small, { color: notice.tone === "error" ? colour.danger : colour.forest800 }]}>{notice.text}</Text>
        </View>
      )}

      {caps?.assignClub && requests.length > 0 && filter === "all" && !query && !narrowed && (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Waiting on You</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {requests.map((r, i) => (
              <View key={r.requestId} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                <Text style={[type.bodyMedium, { color: colour.ink }]}>{personName({ firstName: r.firstName, surname: r.surname, invitationEmail: null })}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>Asked to join the club</Text>
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

      {!loading && !error && people.length === 0 &&
        (query ? (
          <EmptyState title="No people match this search" body="Try a different name." />
        ) : filter === "deactivated" ? (
          <EmptyState title="No deactivated members" body="Everyone in the club is active." />
        ) : (
          <EmptyState title={filter === "all" && !narrowed ? "No people yet" : "No people match this filter"} body={filter === "all" && !narrowed ? "People appear here when they join the club or accept an invitation." : "Try another filter, or Add to Club."} />
        ))}

      {!loading && people.length > 0 && (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flexShrink: 1 }]}>{listTitle}</Text>
            <Text accessibilityLabel={`${total} ${total === 1 ? "person" : "people"}`} style={[type.heading, { color: colour.ink }]}>{total}</Text>
          </View>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {people.map((p, i) => (
              <View key={p.membershipId ?? p.playerId ?? p.invitationId ?? String(i)}>
                <PersonRow
                  person={p}
                  avatarUrl={p.kind === "member" && p.avatarStoragePath ? (avatars.get(p.avatarStoragePath) ?? null) : null}
                  first={i === 0}
                  onPress={p.membershipId ? () => router.push(`/admin/people/${p.membershipId}` as never) : p.kind === "player" && p.playerId ? () => router.push({ pathname: "/admin/guardians/player/[playerId]", params: { playerId: p.playerId } } as never) : undefined}
                />
                {p.kind === "invited" && !!p.invitationId && (inviteCaps.create || inviteCaps.revoke) && (
                  <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
                    {inviteCaps.create && p.invitationKind === "CLUB_STAFF" && <Button label="Reissue" variant="quiet" onPress={() => invitationAction(p, "resend")} />}
                    {inviteCaps.revoke && <Button label="Withdraw" variant="quiet" onPress={() => invitationAction(p, "revoke")} />}
                  </View>
                )}
              </View>
            ))}
          </Card>
          {people.length < total && <Button label={loadingMore ? "Loading…" : `Show More (${total - people.length} more)`} variant="secondary" busy={loadingMore} onPress={() => void load(people.length)} />}
        </View>
      )}

      {/* DEACTIVATED IS A STATE, NOT A KIND OF PERSON: one quiet line, never a chip, never "add a deactivated". */}
      {!loading && filter !== "deactivated" && !narrowed && !query && deactivated !== null && (
        deactivated === 0 ? (
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>No deactivated members.</Text>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`${deactivated} deactivated ${deactivated === 1 ? "member" : "members"}. Show them`} onPress={() => setFilter("deactivated")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs }}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>{deactivated} deactivated {deactivated === 1 ? "member" : "members"}</Text>
            <ChevronRight size={16} color={colour.forest800} />
          </Pressable>
        )
      )}
      {filter === "deactivated" && <Button label="Show Everyone Else" variant="quiet" onPress={() => setFilter("all")} />}
      {canAdd && inlineAdd && <Button label="Add to Club" icon={<Plus size={18} color={colour.onForest} />} onPress={() => router.push("/admin/people/add" as never)} />}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void refreshAccess()}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/people" } } as never)
        }}
        errorMessage={(cause) => peopleErrorMessage(cause, friendlyAction(cause, "answer", "this request").message)}
      />
    </AdminScreen>
  )
}
