import { useCallback, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { canOpenGuardiansPlayers, guardiansPlayersErrorMessage, readClubPlayerDirectory, readDuplicateReviews, resolveDuplicateAsExisting, resolveDuplicateAsNew, type DuplicateReview } from "@ovalball/contracts/club/guardians-players"

import { AdminScreen } from "../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * POSSIBLE DUPLICATE PLAYERS -- the staff-only resolution step (CA-M11.1).
 *
 * A parent tried to add a child whose name and date of birth match a player already at the club. The
 * submitting parent never sees this row. "Same Child" links the ORIGINAL applicant to the existing
 * player; "Different Child" creates the new player from what they already submitted. Both are
 * terminal and take no reason (the operations have none), so each is confirmed explicitly first. The
 * date shown is what the applicant TYPED; the existing player's own date of birth stays with their
 * family and only their age grade is shown. family.duplicate.resolve at the club, never the applicant.
 */
export default function DuplicateReviews() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps, refresh: refreshAccess } = useGuardiansPlayersAccess()
  const [rows, setRows] = useState<DuplicateReview[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = usePendingIntent("guardians:duplicates")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !caps.duplicateResolve) return
    const gen = ++generation.current
    setError(null)
    try {
      const directory = await readClubPlayerDirectory(supabase, clubId, caps)
      const list = await readDuplicateReviews(supabase, directory.teams)
      if (gen === generation.current) setRows(list)
    } catch (cause) {
      const translated = friendly(cause, "duplicate reviews")
      logDetail("admin:guardians:duplicates", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, accessLoading, caps])

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

  const may = canOpenGuardiansPlayers(caps)

  function resolve(r: DuplicateReview, as: "existing" | "new") {
    setAsk(
      as === "existing"
        ? {
            title: `Same child: link ${r.submittedName} to ${r.matchedName}?`,
            body: `The applicant becomes a guardian of the existing player ${r.matchedName} (${r.matchedAgeGrade ?? "age grade not resolved"}) and no new record is created. This cannot be undone.`,
            confirmLabel: "Confirm Same Child",
            reason: "none",
            onConfirm: async () => {
              await resolveDuplicateAsExisting(supabase, r.reviewId)
              setNotice(`${r.submittedName} linked to the existing player.`)
              await load()
            },
          }
        : {
            title: `Different child: create ${r.submittedName} as a new player?`,
            body: `A new player is created from what the applicant submitted, on ${r.teamLabel}, with the applicant as their guardian. This cannot be undone.`,
            confirmLabel: "Confirm Different Child",
            reason: "none",
            onConfirm: async () => {
              await resolveDuplicateAsNew(supabase, r.reviewId)
              setNotice(`${r.submittedName} created as a new player.`)
              await load()
            },
          }
    )
  }

  return (
    <AdminScreen section="Possible Duplicate Players" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Possible Duplicate Players
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>A parent tried to add a child whose name and date of birth match an existing player at this club. Confirm whether this is the same child.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="Resolving a possible duplicate is done by the people the club has given that job to." />}
      {may && !caps.duplicateResolve && !accessLoading && <EmptyState title="Not yours to decide" body="Deciding whether two records are the same child needs the club's duplicate-resolution permission." />}
      {caps.duplicateResolve && notice && <Notice tone="ok" text={notice} />}
      {caps.duplicateResolve && error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {caps.duplicateResolve && !error && rows === null && <CardSkeleton lines={4} />}
      {caps.duplicateResolve && rows !== null && rows.length === 0 && <EmptyState title="Nothing to review" body="When a parent's addition matches an existing player, it waits here." />}

      {caps.duplicateResolve &&
        rows?.map((r) => (
          <Card key={r.reviewId} style={{ gap: space.md }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{r.teamLabel}</Text>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <View style={{ flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
                <Text style={[type.overline, { color: colour.warning }]}>SUBMITTED</Text>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{r.submittedName}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{r.submittedDateOfBirth ? `Date of birth given: ${r.submittedDateOfBirth}` : "No date of birth given"}</Text>
              </View>
              <View style={{ flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>MATCHES EXISTING PLAYER</Text>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{r.matchedName}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{r.matchedAgeGrade ?? "Age grade not resolved"}</Text>
              </View>
            </View>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Either answer is final. The existing player's own date of birth stays with their family; only their age grade is shown.</Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Different Child" variant="secondary" onPress={() => resolve(r, "new")} style={{ flex: 1 }} />
              <Button label="Same Child" onPress={() => resolve(r, "existing")} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => { void refreshAccess(); void load() }}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/guardians/duplicates" } } as never)
        }}
        errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this review").message)}
      />
    </AdminScreen>
  )
}
