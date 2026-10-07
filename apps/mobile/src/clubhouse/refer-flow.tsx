import { useEffect, useMemo, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"

import { inviteClubToOvalball } from "@ovalball/contracts/clubhouse/actions"
import { distanceMiles, findDistanceOrigin, matchesClubhouseQuery, readClubhouseMarkers, type ClubMapMarker } from "@ovalball/contracts/clubhouse/map-read-model"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { ShareView } from "../sharing/share-view"
import { ClubCrest } from "../components/identity"
import { Button, CardSkeleton, EmptyState } from "../components/ui"
import { Search } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { Body, ButtonRow, ChoiceRow, FlowScreen, Note, SectionTitle } from "../people/ui"

/**
 * REFER A CLUB -- the one way a club recommends Ovalball to another club, from the Clubhouse's Refer
 * Clubs, Add to Club, or a club's own page in the directory (People & Invitations; it replaces that
 * page's own inline invite form).
 *
 * ON THE EXISTING REFERRAL SYSTEM, AND NOTHING NEW. `create_partner_invitation` records one invitation
 * per referring club and directory club (contact name and email are its required fields) and opens the
 * club's referral in the same transaction; a second one to the same club while the first is open is
 * refused by the server. Attribution happens when that club joins Ovalball -- its claim approved -- keyed
 * on the directory club itself, whatever link they used. So sharing the link again, on WhatsApp or
 * anywhere, creates nothing and can never double-count. The phone sends no email: the person shares the
 * link themselves, and the screen says so.
 */
export function ReferClub({ clubId, directoryId: givenDirectoryId, directoryName: givenName }: { clubId: string; directoryId?: string | null; directoryName?: string | null }) {
  const router = useRouter()
  const { club } = useAppContexts()
  const [markers, setMarkers] = useState<(ClubMapMarker & { miles: number | null })[] | null>(givenDirectoryId ? [] : null)
  const [query, setQuery] = useState("")
  const [target, setTarget] = useState<{ directoryId: string; name: string; logoUrl: string | null } | null>(givenDirectoryId ? { directoryId: givenDirectoryId, name: givenName ?? "This club", logoUrl: null } : null)
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [alreadyOpen, setAlreadyOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)

  useEffect(() => {
    if (givenDirectoryId) return
    let live = true
    void readClubhouseMarkers(supabase, clubId)
      .then((all) => {
        if (!live) return
        // NEAREST FIRST, from the club's own recorded location -- the clubs a club knows are the ones down the
        // road. A club with no known location is never dropped or guessed at: it follows, by name.
        const origin = findDistanceOrigin(all)
        const rows = all
          .filter((x) => x.networkState === "not_on_ovalball" && !x.isOwnClub)
          .map((x) => ({ ...x, miles: origin ? distanceMiles(origin, x) : null }))
          .sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity) || a.name.localeCompare(b.name))
        setMarkers(rows)
      })
      .catch(() => live && setMarkers([]))
    return () => {
      live = false
    }
  }, [clubId, givenDirectoryId])

  const shown = useMemo(() => (markers ?? []).filter((m) => !query.trim() || matchesClubhouseQuery(m, query)).slice(0, 40), [markers, query])
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
  const clubName = club.name ?? "Your club"

  async function create() {
    if (!target) return
    setBusy(true)
    setProblem(null)
    setAlreadyOpen(false)
    const result = await inviteClubToOvalball(supabase, webUrl, clubId, target.directoryId, contactName.trim(), contactEmail.trim())
    setBusy(false)
    if (!result.ok) {
      // ONE OPEN REFERRAL PER CLUB is the server's rule; the link itself carries nothing secret, so it can
      // simply be shared again without making a second record.
      if (/already have a pending invitation/i.test(result.error)) {
        setAlreadyOpen(true)
        return
      }
      setProblem(result.error)
      return
    }
    setLink(result.inviteLink)
  }

  const shareLink = target ? `${webUrl.replace(/\/$/, "")}/signup?directory=${target.directoryId}` : null

  return (
    <FlowScreen title="Refer a Club">
      <Body>
        {!target && (
          <View style={{ gap: space.md }}>
            <SectionTitle title="Which Club?" detail={(markers ?? []).some((m) => m.miles !== null) ? "Clubs in the Club Directory that aren't on Ovalball yet, nearest first." : "Clubs in the Club Directory that aren't on Ovalball yet."} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
              <Search size={18} color={colour.inkSubtle} />
              <TextInput accessibilityLabel="Search clubs" value={query} onChangeText={setQuery} placeholder="Search by club, town or county" placeholderTextColor={colour.inkSubtle} autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
            </View>
            {markers === null && <CardSkeleton lines={3} />}
            {markers !== null && shown.length === 0 && <EmptyState title="No clubs match" body={query ? "Try a different name or town." : "Every club in the directory is already on Ovalball."} />}
            <View style={{ gap: space.sm }}>
              {shown.map((m) => (
                <ChoiceRow key={m.directoryId} kind="link" checked={false} label={m.name} description={[m.town, m.county, m.miles !== null ? `${m.miles < 1 ? "Under 1" : Math.round(m.miles)} ${m.miles >= 1.5 ? "miles" : "mile"} away` : null].filter(Boolean).join(", ") || null} onPress={() => setTarget({ directoryId: m.directoryId, name: m.name, logoUrl: m.logoUrl })} />
              ))}
            </View>
          </View>
        )}

        {target && !link && !alreadyOpen && (
          <View style={{ gap: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ClubCrest clubName={target.name} url={target.logoUrl} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.heading, { color: colour.ink }]}>{target.name}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>Not on Ovalball yet</Text>
              </View>
            </View>
            <SectionTitle title="Who Should Hear About It?" detail="Somebody at that club. It doesn't give anyone ownership of the club." />
            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Contact Name<Text style={{ color: colour.danger }}> *</Text></Text>
              <TextInput accessibilityLabel="Contact name" value={contactName} onChangeText={setContactName} placeholder="e.g. Chris Morgan" placeholderTextColor={colour.inkSubtle} autoCapitalize="words" maxLength={120} style={[type.body, { minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Contact Email<Text style={{ color: colour.danger }}> *</Text></Text>
              <TextInput accessibilityLabel="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="name@theirclub.co.uk" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" autoComplete="email" autoCorrect={false} maxLength={254} style={[type.body, { minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]} />
            </View>
            {problem && <Note tone="danger">{problem}</Note>}
            <ButtonRow weights={givenDirectoryId ? [1] : [1, 2]}>
              {!givenDirectoryId && <Button label="Back" variant="secondary" onPress={() => setTarget(null)} />}
              <Button label="Create Referral" onPress={() => void create()} busy={busy} disabled={!contactName.trim() || !emailOk} />
            </ButtonRow>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Ovalball records the referral for your club. You share the link with them next.</Text>
          </View>
        )}

        {target && (link || alreadyOpen) && shareLink && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title={alreadyOpen ? "Already Referred" : "Referral Created"} detail={alreadyOpen ? `Your club already has an open referral for ${target.name}. Share the same link again; nothing new is recorded.` : `Share it with ${contactName.trim() || "them"} however suits you.`} />
            <ShareView
              share={{ url: link ?? shareLink, code: null, outcome: [], expiresLabel: null, sentTo: null }}
              subject={{ kind: "REFERRAL", clubName, referredClubName: target.name }}
              poster={{ identity: { clubName, crestUrl: club.crestUrl }, subject: { variant: "REFERRAL" } }}
              email={alreadyOpen ? null : contactEmail.trim()}
              explainer={`When ${target.name} joins Ovalball, the referral is connected to ${clubName} automatically, whichever link they use. Club Admins can follow it under Your Referrals.`}
              onDone={() => (router.canGoBack() ? router.back() : router.dismissTo("/clubhouse/refer" as never))}
            />
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
