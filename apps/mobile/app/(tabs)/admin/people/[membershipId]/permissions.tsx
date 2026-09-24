import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { accessEventSentence } from "@ovalball/contracts/club/access-history"
import { groupsForScope } from "@ovalball/contracts/club/permission-groups"
import { personName, readClubPerson, type ClubPerson } from "@ovalball/contracts/club/people"
import {
  decidePermission,
  effectiveLabel,
  lockSentence,
  permissionErrorMessage,
  readAccessHistory,
  readPermissionCapabilities,
  readPersonPermissionScopes,
  readPersonPermissions,
  restoreDefault,
  roleDefaultSentence,
  sourceSentence,
  stateOf,
  type AccessHistoryEntry,
  type PermissionCapabilities,
  type PermissionRow,
  type PermissionScope,
  type PermissionScopeOption,
  type PermissionState,
} from "@ovalball/contracts/club/permissions"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { DecisionSheet, type DecisionAsk } from "../../../../../src/admin/decision-sheet"
import { holdIntent, takeIntent } from "../../../../../src/admin/pending-intent"
import { personRoleLine } from "../../../../../src/admin/person-row"
import { supabase } from "../../../../../src/auth/supabase"
import { useAppContexts } from "../../../../../src/context/contexts"
import { Button, Card, CardSkeleton, ErrorState, StatusPill } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { formatDate } from "../../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * WHAT ONE PERSON MAY DO, AND WHY (CA-M4).
 *
 * The model in three lines a volunteer Club Admin can hold: a ROLE gives a default set of
 * permissions; a DECISION allows or withholds one of them at the club or for one team; RESTORE
 * removes the decision so the role answers again. Every row shows the effective answer and where it
 * came from, and -- when a decision exists -- the role default beside it, so default, decision and
 * effect are three visible facts rather than one mysterious tick.
 *
 * NOTHING IS COMPUTED HERE. Rows come from `club_person_permissions` (the same computation the
 * website's grid uses); the scopes on offer from `club_person_permission_scopes`; writes go to the
 * two canonical operations. The screen re-reads on focus, after every write and after a step-up,
 * and clears everything first when the club context changes.
 */
export default function PersonPermissionsScreen() {
  const router = useRouter()
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { club } = useAppContexts()
  const [person, setPerson] = useState<ClubPerson | null>(null)
  const [scopes, setScopes] = useState<PermissionScopeOption[] | null>(null)
  const [scope, setScope] = useState<PermissionScope>({ kind: "club" })
  const [rows, setRows] = useState<PermissionRow[] | null>(null)
  const [caps, setCaps] = useState<PermissionCapabilities | null>(null)
  const [history, setHistory] = useState<AccessHistoryEntry[] | null>(null)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [ask, setAsk] = useState<DecisionAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The person, the scopes on offer, the viewer's capabilities and the history: re-read together.
  const loadPerson = useCallback(async () => {
    if (!clubId || !membershipId) return
    setLoadError(null)
    try {
      const p = await readClubPerson(supabase, clubId, membershipId)
      setPerson(p)
      if (!p?.userId) {
        setScopes([])
        return
      }
      const [sc, allowed] = await Promise.all([readPersonPermissionScopes(supabase, clubId, p.userId), readPermissionCapabilities(supabase, clubId)])
      setScopes(sc)
      setCaps(allowed)
      try {
        setHistory(await readAccessHistory(supabase, clubId, p.userId, 10))
      } catch {
        // people.access.explain not held: the timeline simply is not shown.
        setHistory(null)
      }
    } catch (cause) {
      const translated = friendly(cause, "this person's permissions")
      logDetail("admin:permissions", translated)
      setLoadError(translated)
      setScopes([])
    }
  }, [clubId, membershipId])

  // The rows for the selected scope. Cleared first: a stale answer must never stand in for this one.
  const loadRows = useCallback(async () => {
    if (!clubId || !person?.userId) return
    setRows(null)
    setRowsError(null)
    try {
      setRows(await readPersonPermissions(supabase, clubId, person.userId, scope))
    } catch (cause) {
      const translated = friendly(cause, "these permissions")
      logDetail("admin:permissions:rows", translated)
      setRows([])
      setRowsError(permissionErrorMessage(cause, translated.message))
    }
  }, [clubId, person?.userId, scope])

  useEffect(() => {
    // A new club context: nothing from the previous one may be shown.
    setPerson(null)
    setScopes(null)
    setRows(null)
    setCaps(null)
    setHistory(null)
    setScope({ kind: "club" })
    void loadPerson()
  }, [loadPerson])
  useEffect(() => {
    void loadRows()
  }, [loadRows])
  useFocusEffect(
    useCallback(() => {
      void loadPerson()
      void loadRows()
      // Back from a step-up: the same decision sheet, the choice and reason put back, the server
      // asked again on Confirm.
      const p = takeIntent<{ row: PermissionRow; scope: PermissionScope; choice: PermissionState; reason: string; label: string; description: string; userId: string; clubId: string }>(`permissions:${membershipId}`)
      if (p) {
        setScope(p.scope)
        openDecision(p.row, p.scope, p.label, p.description, p.choice, p.reason, { userId: p.userId, clubId: p.clubId })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadPerson, loadRows, membershipId])
  )

  const name = person ? personName(person) : "Person"
  const viewerMayDecide = !!caps?.manage
  const loading = person === null && loadError === null
  const scopeOptions = scopes ?? []

  function selectScope(o: PermissionScopeOption) {
    setScope(o.kind === "team" && o.teamId ? { kind: "team", teamId: o.teamId, teamName: o.teamName ?? "this team" } : { kind: "club" })
  }

  function openDecision(row: PermissionRow, at: PermissionScope, label: string, description: string, initialChoice?: PermissionState, initialReason?: string, ids?: { userId: string; clubId: string }) {
    // The subject and club are fixed when the sheet opens (and carried through a step-up), so a
    // confirmation after a re-mount never depends on the screen having finished loading again.
    const subject = ids ?? (person?.userId && clubId ? { userId: person.userId, clubId } : null)
    setAsk({
      row,
      scope: at,
      label,
      description,
      initialChoice,
      initialReason,
      note: initialChoice !== undefined ? "Verified. Confirm to continue." : undefined,
      onConfirm: async (choice, reason) => {
        if (!subject) throw new Error("This person is still loading. Try again in a moment.")
        if (choice === "inherit") {
          // RESTORE DEFAULT removes the decision; the role answers again. Never an opposite decision.
          if (row.decision) await restoreDefault(supabase, row.decision.id, reason)
        } else {
          await decidePermission(supabase, { userId: subject.userId, key: row.key, clubId: subject.clubId, scope: at, effect: choice === "allow" ? "grant" : "deny", reason })
        }
        setNotice(choice === "inherit" ? `${label}: back to the role default.` : choice === "allow" ? `${label}: allowed${at.kind === "team" ? ` for ${at.teamName}` : ""}.` : `${label}: withheld${at.kind === "team" ? ` for ${at.teamName}` : ""}.`)
        await Promise.all([loadRows(), loadPerson()])
      },
    })
  }

  const groups = groupsForScope(scope.kind)
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]))

  return (
    <AdminScreen section={name} onRefresh={() => { void loadPerson(); void loadRows() }} refreshing={false}>
      {loading && <CardSkeleton lines={4} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void loadPerson()} offline={loadError.retryable} />}
      {!loading && !loadError && !person && <ErrorState message="This person is not part of the club any more, or is not visible to you." onRetry={() => router.back()} />}

      {person && (
        <>
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {name}
              {person.isSelf ? <Text style={{ color: colour.inkMuted }}> (you)</Text> : null}
            </Text>
            <Text style={[type.small, { color: colour.forest800 }]}>{personRoleLine(person)}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>A role gives a default set of permissions. A decision allows or withholds one of them, at the club or for one team.</Text>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Scope</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Scope" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {scopeOptions.map((o) => {
                const on = o.kind === "club" ? scope.kind === "club" : scope.kind === "team" && scope.teamId === o.teamId
                const label = o.kind === "club" ? "Club" : (o.teamName ?? "Team")
                return (
                  <Pressable key={o.kind === "club" ? "club" : o.teamId ?? label} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={() => selectScope(o)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                    <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{scope.kind === "team" ? `A decision here applies to ${scope.teamName} only. It does not change what they may do elsewhere.` : `A club decision applies everywhere at ${club.name ?? "the club"}.`}</Text>
          </View>

          {notice && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
              <Text style={[type.small, { color: colour.forest800 }]}>{notice}</Text>
            </View>
          )}

          {caps && !viewerMayDecide && !person.isSelf && <Text style={[type.caption, { color: colour.inkMuted }]}>You can see these permissions but not change them.</Text>}
          {person.isSelf && <Text style={[type.caption, { color: colour.inkMuted }]}>Your own permissions are decided by another Club Admin.</Text>}

          {rows === null && !rowsError && !loadError && <CardSkeleton lines={3} />}
          {rowsError && !loadError && <ErrorState message={rowsError} onRetry={() => void loadRows()} />}

          {rows &&
            groups.map((group) => {
              const items = group.items.map((item) => ({ item, row: byKey.get(item.key) })).filter((x): x is { item: (typeof group.items)[number]; row: PermissionRow } => !!x.row)
              if (items.length === 0) return null
              return (
                <View key={group.title} style={{ gap: space.sm }}>
                  <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                    {group.title}
                  </Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{group.blurb}</Text>
                  <Card style={{ padding: 0, overflow: "hidden" }}>
                    {items.map(({ item, row }, i) => (
                      <PermissionRowView key={row.key} label={item.label} description={item.description} row={row} scope={scope} first={i === 0} onChange={row.editable ? () => openDecision(row, scope, item.label, item.description) : undefined} />
                    ))}
                  </Card>
                </View>
              )
            })}

          {history && history.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                History
              </Text>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {history.map((h, i) => (
                  <View key={`${h.at}-${i}`} style={{ padding: space.md, gap: 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{accessEventSentence(h.eventType, h.capabilityLabel, h.roleLabel, h.teamName)}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      by {h.actorName} · {formatDate(h.at)}
                    </Text>
                    {h.reason && <Text style={[type.caption, { color: colour.inkSubtle }]}>{h.reason}</Text>}
                  </View>
                ))}
              </Card>
            </View>
          )}
        </>
      )}

      <DecisionSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => {
          void refreshAccess()
          void loadPerson()
          void loadRows()
        }}
        onStepUp={(choice, reason) => {
          if (ask && person?.userId && clubId) holdIntent(`permissions:${membershipId}`, { row: ask.row, scope: ask.scope, choice, reason, label: ask.label ?? ask.row.label, description: ask.description ?? ask.row.description, userId: person.userId, clubId })
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: `/admin/people/${membershipId}/permissions` } } as never)
        }}
        errorMessage={(cause) => permissionErrorMessage(cause, friendly(cause, "this decision").message)}
      />
    </AdminScreen>
  )
}

function PermissionRowView({ label, description, row, scope, first, onChange }: { label: string; description: string; row: PermissionRow; scope: PermissionScope; first: boolean; onChange?: () => void }) {
  const state = stateOf(row)
  const decided = row.decision !== null
  const pill = state === "allow" ? { label: "Allowed explicitly", tone: "positive" as const } : state === "withhold" ? { label: "Withheld", tone: "caution" as const } : row.decision?.expired ? { label: "Expired decision", tone: "neutral" as const } : null
  const lock = lockSentence(row)
  return (
    <View style={{ padding: space.md, gap: 4, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, minHeight: TOUCH_TARGET + 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text style={[type.smallMedium, { color: colour.ink, flex: 1, minWidth: 0 }]}>{label}</Text>
        {pill && <StatusPill label={pill.label} tone={pill.tone} />}
      </View>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{description}</Text>
      <Text style={[type.small, { color: row.effective ? colour.forest800 : colour.inkMuted }]}>
        {effectiveLabel(row)} · {sourceSentence(row, scope)}
      </Text>
      {decided && <Text style={[type.caption, { color: colour.inkSubtle }]}>Role default: {roleDefaultSentence(row)}</Text>}
      {row.decision?.reason && state !== "inherit" && <Text style={[type.caption, { color: colour.inkSubtle }]}>Reason: {row.decision.reason}</Text>}
      {lock && !onChange && <Text style={[type.caption, { color: colour.inkSubtle }]}>{lock}</Text>}
      {onChange && (
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          <Button label="Change" variant="secondary" onPress={onChange} accessibilityHint={`Decide whether ${label} is allowed${scope.kind === "team" ? ` for ${scope.teamName}` : ""}`} />
        </View>
      )}
    </View>
  )
}
