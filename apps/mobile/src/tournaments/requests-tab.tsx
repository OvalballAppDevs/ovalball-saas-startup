import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native"
import * as Clipboard from "expo-clipboard"
import { applicationCounts, sidesAtGrade, type TournamentApplication, type TournamentDetail } from "@ovalball/contracts/club/tournament-detail"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { QrCode } from "../sharing/qr"
import { ClubCrest } from "./team-row"
import { Check, Copy, Info, Lock, Share2, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"

/**
 * REQUESTS -- AND THE TWO THINGS IT IS NOT.
 *
 * A REQUEST IS A CLUB ASKING TO COME. It exists only for a PUBLIC tournament, and it is a different
 * thing from a club the organiser added: adding is a decision the organiser already made, so there is
 * nothing to approve. This tab never shows added clubs as though they were waiting on an answer.
 *
 * A PRIVATE TOURNAMENT HAS NO REQUESTS AT ALL, so it does not get a filtered empty list -- it gets a
 * plain statement of why, and then the clubs that are actually in it. There is no QR, no share link
 * and no route by which a club could apply, because for a private tournament those would be an
 * invitation to do something that cannot happen.
 */
export function TournamentRequestsTab({ detail, onChanged }: { detail: TournamentDetail; onChanged: () => void }) {
  return detail.visibility === "public" ? <PublicRequests detail={detail} onChanged={onChanged} /> : <PrivateRequests detail={detail} />
}

// ---------------------------------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------------------------------

type Filter = "All" | "Pending" | "Accepted" | "Rejected"

function PublicRequests({ detail, onChanged }: { detail: TournamentDetail; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("All")
  const [busy, setBusy] = useState<string | null>(null)
  const counts = useMemo(() => applicationCounts(detail), [detail])

  const shown = useMemo(() => {
    const byNewest = [...detail.applications].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
    if (filter === "All") return byNewest
    return byNewest.filter((a) => a.status === filter.toLowerCase())
  }, [detail.applications, filter])

  const decide = useCallback(
    async (application: TournamentApplication, accept: boolean) => {
      setBusy(application.id)
      const { error } = await supabase.rpc("decide_tournament_application", { p_application_id: application.id, p_accept: accept } as never)
      setBusy(null)
      if (error) Alert.alert("That application was not updated", error.message)
      else onChanged()
    },
    [onChanged],
  )

  const tabBar = useTabBarHeight()

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.title, { color: colour.ink }]}>Team Applications</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>Review and manage team applications for this tournament.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}>
        {(["All", "Pending", "Accepted", "Rejected"] as Filter[]).map((f) => {
          const on = f === filter
          const n = f === "All" ? counts.all : f === "Pending" ? counts.pending : f === "Accepted" ? counts.accepted : counts.rejected
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${f}, ${n}`}
              onPress={() => setFilter(f)}
              style={({ pressed }) => ({
                minHeight: 36,
                paddingHorizontal: space.md,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: on ? colour.forest800 : colour.line,
                backgroundColor: on ? colour.forest800 : colour.surface,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={[type.caption, { color: on ? colour.onForest : colour.ink, fontFamily: "Inter_600SemiBold" }]}>{f}</Text>
              <Text style={[type.caption, { color: on ? colour.onForestMuted : colour.inkMuted, fontSize: 11 }]}>{n}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {shown.length === 0 && (
        <View style={{ padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", lineHeight: 20 }]}>
            {counts.all === 0
              ? "No club has applied yet. Share the tournament so clubs can find it."
              : `No ${filter.toLowerCase()} applications.`}
          </Text>
        </View>
      )}

      {shown.map((a) => (
        <ApplicationCard key={a.id} application={a} busy={busy === a.id} onDecide={(accept) => void decide(a, accept)} />
      ))}

      <ShareTournament detail={detail} />
    </ScrollView>
  )
}

function ApplicationCard({ application, busy, onDecide }: { application: TournamentApplication; busy: boolean; onDecide: (accept: boolean) => void }) {
  const pending = application.status === "pending"
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ClubCrest url={application.crestUrl} name={application.clubName} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
            {application.clubName}
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {application.ageGroup} · applied {shortDate(application.appliedAt)}
          </Text>
        </View>
        <StatusPill status={application.status} />
      </View>

      {application.teams.length > 0 && (
        <View style={{ gap: 2, paddingLeft: space.lg }}>
          {application.teams.map((t) => (
            <Text key={t.teamId} numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {t.name}
            </Text>
          ))}
        </View>
      )}

      {!!application.note && <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>{application.note}</Text>}

      {pending && (
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reject ${application.clubName}`}
            disabled={busy}
            onPress={() => onDecide(false)}
            style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: busy ? 0.5 : pressed ? 0.85 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.ink }]}>Reject</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Accept ${application.clubName}`}
            disabled={busy}
            onPress={() => onDecide(true)}
            style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colour.forest800, opacity: busy ? 0.5 : pressed ? 0.88 : 1 })}
          >
            {busy ? <ActivityIndicator color={colour.onForest} /> : <Text style={[type.smallMedium, { color: colour.onForest }]}>Accept</Text>}
          </Pressable>
        </View>
      )}
    </View>
  )
}

function StatusPill({ status }: { status: TournamentApplication["status"] }) {
  const map = {
    pending: { label: "Pending", fg: colour.warning, bg: colour.warningSurface },
    accepted: { label: "Accepted", fg: colour.rugby700, bg: colour.successSurface },
    rejected: { label: "Rejected", fg: colour.inkMuted, bg: colour.chalk },
    withdrawn: { label: "Withdrawn", fg: colour.inkMuted, bg: colour.chalk },
  } as const
  const s = map[status]
  return (
    <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: s.bg, borderWidth: 1, borderColor: colour.line }}>
      <Text style={[type.caption, { color: s.fg, fontSize: 11 }]}>{s.label}</Text>
    </View>
  )
}

/**
 * SHARE THE TOURNAMENT.
 *
 * THE QR ENCODES THE REAL TOURNAMENT URL AND NOTHING ELSE -- the same link the Share button copies,
 * built from the canonical web base and the tournament's own id. There is no separate QR payload and
 * no token, so a QR can never carry access the link does not.
 *
 * The symbol is drawn by the SAME encoder the website uses, through the shared `QrCode` component, so
 * the quiet zone is preserved. Ovalball branding sits AROUND it, never over it.
 */
function ShareTournament({ detail }: { detail: TournamentDetail }) {
  const url = `${webUrl.replace(/\/+$/, "")}/tournaments/${detail.id}`
  const [copied, setCopied] = useState(false)

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>Share Tournament</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>
          Clubs can scan this or open the link to see {detail.name} and apply to enter.
        </Text>
      </View>

      <View style={{ alignItems: "center", paddingVertical: space.sm, gap: space.sm }}>
        <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line }}>
          <QrCode value={url} size={196} accessibilityLabel={`QR code linking to ${detail.name}`} />
        </View>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
          {url.replace(/^https?:\/\//, "")}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy Link"
          onPress={() => {
            void Clipboard.setStringAsync(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          style={({ pressed }) => ({ flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
        >
          {copied ? <Check size={16} color={colour.rugby700} strokeWidth={2.4} /> : <Copy size={16} color={colour.ink} strokeWidth={1.9} />}
          <Text style={[type.smallMedium, { color: copied ? colour.rugby700 : colour.ink }]}>{copied ? "Copied" : "Copy Link"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share Tournament"
          onPress={() => void Share.share({ message: `${detail.name} — ${url}`, url })}
          style={({ pressed }) => ({ flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, backgroundColor: colour.forest800, opacity: pressed ? 0.88 : 1 })}
        >
          <Share2 size={16} color={colour.onForest} strokeWidth={1.9} />
          <Text style={[type.smallMedium, { color: colour.onForest }]}>Share</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------
// PRIVATE
// ---------------------------------------------------------------------------------------------------

function PrivateRequests({ detail }: { detail: TournamentDetail }) {
  // Every club in the tournament, across every grade, with the sides each is bringing.
  const clubs = useMemo(() => {
    const out = new Map<string, { name: string; crestUrl: string | null; external: boolean; sides: string[] }>()
    for (const g of detail.ageGroups) {
      for (const c of sidesAtGrade(detail, g).clubs) {
        const e = out.get(c.directoryId) ?? { name: c.clubName, crestUrl: c.crestUrl, external: c.sides.every((s) => s.kind === "external"), sides: [] }
        // `label` already carries the competition for a side with no canonical team ("U12 Spears"),
        // so appending the grade again would read "U12 Spears · U12". Only a real team's canonical
        // name needs the competition added.
        e.sides.push(...c.sides.map((s) => (s.teamId ? `${s.label} · ${s.ageGroup}` : s.label)))
        out.set(c.directoryId, e)
      }
    }
    return [...out.values()]
  }, [detail])

  const tabBar = useTabBarHeight()

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      <View style={{ alignItems: "center", paddingVertical: space.lg, gap: space.sm }}>
        <View style={{ width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colour.successSurface }}>
          <Lock size={24} color={colour.rugby700} strokeWidth={1.9} />
        </View>
        <Text style={[type.heading, { color: colour.ink, textAlign: "center" }]}>Private Tournament</Text>
        <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", lineHeight: 20, paddingHorizontal: space.md }]}>
          This is a private tournament, invite only and therefore no requests will be managed in this area.
        </Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colour.ink }]}>Invited Clubs</Text>
        {clubs.length === 0 && (
          <View style={{ padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
            <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>No other clubs are in this tournament yet. Add them from the Teams tab.</Text>
          </View>
        )}
        {clubs.map((c) => (
          <View key={c.name} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ClubCrest url={c.crestUrl} name={c.name} size={30} />
              <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
                {c.name}
              </Text>
              {/* THE CANONICAL STATUS, NOT A FRIENDLIER ONE. These clubs were ADDED by the organiser;
                  nobody asked them anything, so nothing here says "invited" or "accepted". */}
              <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
                <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{c.external ? "External" : "Added"}</Text>
              </View>
            </View>
            <View style={{ paddingLeft: space.xl, gap: 2 }}>
              {c.sides.map((s) => (
                <Text key={s} numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                  {s}
                </Text>
              ))}
            </View>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
        <View style={{ paddingTop: 1 }}>
          <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
        </View>
        <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
          Make this tournament public from Overview if you want other clubs to find it and apply.
        </Text>
      </View>
    </ScrollView>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`
}

export const REQUESTS_CLOSE_ICON = X
