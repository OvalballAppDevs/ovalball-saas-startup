import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"
import {
  YOUTH_AGE_GROUPS,
  noAutomaticSuccessor,
  type GraduationTargetTeamOption,
  type MiniRugbyGroupRow,
  type PlacementOption,
  type PlacementVerdict,
  type RolloverTeamProposalRow,
  type TeamDecisionAction,
} from "@ovalball/contracts/club/handover"

import { Check, CircleCheck, TriangleAlert } from "../components/icons"
import { Button } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE HANDOVER'S DECISION SHEETS (CA-M11.1).
 *
 * Every control on the board records a DECISION and none of them changes a team, a membership or a
 * season identity -- the club runs exactly what it runs today until the handover is applied. Each
 * sheet here names what will be recorded, takes what the server requires (a fold's reason, an explicit
 * Girls-team answer at a Mixed boundary), and confirms. The server judges the call again and the sheet
 * shows its own sentence when it refuses.
 *
 * NO RULE IS DECIDED HERE. The proposed age grade, whether a choice is required, whether a cohort has an
 * automatic successor, which teams a player may be placed in and what the verdict on that placement is
 * all came from the server; the sheets only ask the questions the server left open.
 *
 * RECENT AUTHENTICATOR. Fold and graduate are held to `team.lifecycle.manage`, declared recent-auth in
 * the catalogue. When the server answers that a code must be entered first, the sheet hands the draft
 * back through `onStepUp`; the screen holds it, sends the person to step up, and re-opens the sheet on
 * return. Passing the factor never records the decision -- the person confirms again.
 */

function Sheet({ visible, title, hint, onClose, busy, children }: { visible: boolean; title: string; hint?: string; onClose: () => void; busy?: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={busy ? undefined : onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)" }} />
      <View style={[{ maxHeight: "88%", backgroundColor: colour.chalk, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, paddingBottom: insets.bottom + space.lg }, elevation.sheet]}>
        <View style={{ paddingTop: space.sm, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <View>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {title}
            </Text>
            {!!hint && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{hint}</Text>}
          </View>
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
      <Text style={[type.small, { color: colour.danger }]}>{text}</Text>
    </View>
  )
}

function Note({ text }: { text?: string }) {
  if (!text) return null
  return (
    <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
      <Text style={[type.small, { color: colour.forest800 }]}>{text}</Text>
    </View>
  )
}

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

function Field({ label, value, onChange, placeholder, multiline, autoCapitalize = "sentences" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; autoCapitalize?: "none" | "sentences" | "characters" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[type.body, { minHeight: multiline ? 72 : TOUCH_TARGET, padding: space.md, textAlignVertical: multiline ? "top" : "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// One team's decision
// ---------------------------------------------------------------------------

export interface TeamDecisionDraft {
  action: TeamDecisionAction
  ageGroup: string | null
  squadDesignation: string | null
  foldReason: string | null
}

export interface TeamDecisionAsk {
  proposal: RolloverTeamProposalRow
  /** Put back after a step-up, with a note. */
  initialDraft?: TeamDecisionDraft
  note?: string
  /** Records the decision through the canonical operation. Throws to refuse. */
  onConfirm: (draft: TeamDecisionDraft) => Promise<void>
}

const ACTION_LABEL: Record<TeamDecisionAction, string> = {
  confirm: "Confirm",
  graduate: "Youth Pathway Complete",
  adjust: "Adjust",
  fold: "Fold",
  defer: "Defer",
}

export function TeamDecisionSheet({ ask, onClose, onStepUp, errorMessage }: { ask: TeamDecisionAsk | null; onClose: () => void; onStepUp?: (draft: TeamDecisionDraft) => void; errorMessage: (cause: unknown) => string }) {
  const [action, setAction] = useState<TeamDecisionAction | null>(null)
  const [ageGroup, setAgeGroup] = useState<string | null>(null)
  const [squad, setSquad] = useState("")
  const [foldReason, setFoldReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const d = ask?.initialDraft
    setAction(d?.action ?? null)
    setAgeGroup(d?.ageGroup ?? ask?.proposal.proposedAgeGroup ?? null)
    setSquad(d?.squadDesignation ?? "")
    setFoldReason(d?.foldReason ?? "")
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null
  const p = ask.proposal
  const noSuccessor = noAutomaticSuccessor(p)
  const offered: TeamDecisionAction[] = [...(p.requiresManualChoice ? [] : ["confirm" as const]), ...(noSuccessor ? ["graduate" as const] : []), "adjust", "fold", "defer"]

  const draft = (): TeamDecisionDraft | null => {
    if (!action) return null
    if (action === "confirm") return { action, ageGroup: p.proposedAgeGroup, squadDesignation: null, foldReason: null }
    if (action === "adjust") return ageGroup ? { action, ageGroup, squadDesignation: squad.trim() || null, foldReason: null } : null
    if (action === "fold") return foldReason.trim() ? { action, ageGroup: null, squadDesignation: null, foldReason: foldReason.trim() } : null
    return { action, ageGroup: null, squadDesignation: null, foldReason: null }
  }
  const ready = draft() !== null

  async function confirm() {
    const d = draft()
    if (!ask || !d) return
    setBusy(true)
    setProblem(null)
    try {
      await ask.onConfirm(d)
      onClose()
    } catch (cause) {
      if (isRecentAuthRefusal(cause) && onStepUp) {
        setBusy(false)
        onStepUp(d)
        return
      }
      logDetail("admin:rollover:sheet", friendly(cause, "this decision"))
      setProblem(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible title={p.teamDisplayName} hint={`${p.currentAgeGroup} → ${noSuccessor ? "no automatic successor" : p.requiresManualChoice ? "needs an explicit choice" : (p.proposedAgeGroup ?? "")}`} onClose={onClose} busy={busy}>
      <Note text={ask.note} />
      {noSuccessor && (
        <Text style={[type.small, { color: colour.inkMuted }]}>
          There is no established next age grade for this cohort in this code, so Ovalball will not invent one. Either the youth pathway ends here — its players move to the club's holding list, with no senior team assigned automatically — or you choose a destination yourself.
        </Text>
      )}
      <View accessibilityRole="radiogroup" accessibilityLabel="Decision" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {offered.map((a) => (
          <Chip key={a} label={a === "adjust" && p.requiresManualChoice ? "Choose Destination" : ACTION_LABEL[a]} on={action === a} onPress={() => setAction(a)} disabled={busy} />
        ))}
      </View>

      {action === "confirm" && <Text style={[type.small, { color: colour.inkMuted }]}>Records that {p.teamDisplayName} becomes {p.proposedAgeGroup} next season, keeping its history. Nothing changes until the handover is applied.</Text>}
      {action === "defer" && <Text style={[type.small, { color: colour.inkMuted }]}>Leaves this team undecided for now. The handover cannot be applied until it is decided.</Text>}
      {action === "graduate" && <Text style={[type.small, { color: colour.inkMuted }]}>The youth pathway ends here. The cohort is archived when the handover is applied and its players move to the club's holding list — no senior team is assigned automatically.</Text>}

      {action === "adjust" && (
        <View style={{ gap: space.md }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Destination Age Group</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={`Destination age group for ${p.teamDisplayName}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {YOUTH_AGE_GROUPS.map((g) => (
                <Chip key={g} label={g} on={ageGroup === g} onPress={() => setAgeGroup(g)} disabled={busy} />
              ))}
            </View>
          </View>
          <Field label="Squad (Optional)" value={squad} onChange={setSquad} placeholder="e.g. B" autoCapitalize="characters" />
        </View>
      )}

      {action === "fold" && (
        <View style={{ gap: space.md }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {p.teamDisplayName} will not continue next season. Its fixtures, results and history stay available, and its players appear in Players needing a new place. Nothing happens until the handover is applied.
          </Text>
          <Field label="Reason for Folding" value={foldReason} onChange={setFoldReason} placeholder="Recorded with the decision" multiline />
        </View>
      )}

      <Problem text={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
        <Button label={action === "fold" ? `Fold ${p.teamDisplayName}` : action === "adjust" ? "Record This Destination" : "Record Decision"} onPress={() => void confirm()} busy={busy} disabled={!ready} style={{ flex: 2 }} />
      </View>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The Mixed -> U12 structural transition
// ---------------------------------------------------------------------------

export interface MixedBoundaryAsk {
  proposal: RolloverTeamProposalRow
  onConfirm: (createGirlsTeam: boolean, girlsSquadDesignation: string | null) => Promise<void>
}

/**
 * Never a plain Confirm and never a defaulted Girls-team answer: the server refuses a null answer, and
 * this mirrors that by leaving the control unusable until Yes or No is chosen.
 */
export function MixedBoundarySheet({ ask, onClose, errorMessage }: { ask: MixedBoundaryAsk | null; onClose: () => void; errorMessage: (cause: unknown) => string }) {
  const [createGirls, setCreateGirls] = useState<boolean | null>(null)
  const [girlsSquad, setGirlsSquad] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setCreateGirls(null)
    setGirlsSquad("")
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null
  const p = ask.proposal
  const squadSuffix = p.teamSquadDesignation ? ` ${p.teamSquadDesignation}` : ""

  async function confirm() {
    if (!ask || createGirls === null) return
    setBusy(true)
    setProblem(null)
    try {
      await ask.onConfirm(createGirls, girlsSquad.trim() || null)
      onClose()
    } catch (cause) {
      logDetail("admin:rollover:sheet", friendly(cause, "this decision"))
      setProblem(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible title={`Mixed → ${p.proposedAgeGroup} structural transition`} hint={p.teamDisplayName} onClose={onClose} busy={busy}>
      <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, gap: space.sm }}>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Current</Text>
            <Text style={[type.smallMedium, { color: colour.ink }]}>
              {p.currentAgeGroup} Mixed{squadSuffix}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Continues next season as</Text>
            <Text style={[type.smallMedium, { color: colour.ink }]}>
              {p.proposedAgeGroup} Boys{squadSuffix}
            </Text>
          </View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm, gap: 4 }}>
          {["Same team", "Previous history retained", "Existing team ID retained"].map((fact) => (
            <View key={fact} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <CircleCheck size={14} color={colour.forest800} />
              <Text style={[type.caption, { color: colour.forest800 }]}>{fact}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Should the club run a {p.proposedAgeGroup} Girls team next season?</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          A separate team with its own history. It is created when this handover is applied, not now, and will not inherit any of {p.teamDisplayName}'s past fixtures or results.
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Run a Girls team" style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          <Chip label={`Yes — run a ${p.proposedAgeGroup} Girls team`} on={createGirls === true} onPress={() => setCreateGirls(true)} disabled={busy} />
          <Chip label="No — do not run a Girls team" on={createGirls === false} onPress={() => setCreateGirls(false)} disabled={busy} />
        </View>
        {createGirls === null && <Text style={[type.caption, { color: colour.inkMuted }]}>Choose Yes or No to continue.</Text>}
      </View>
      {createGirls === true && <Field label="Squad for the New Girls Team (Optional)" value={girlsSquad} onChange={setGirlsSquad} placeholder="e.g. B" autoCapitalize="characters" />}

      <Problem text={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
        <Button label="Record This Decision" onPress={() => void confirm()} busy={busy} disabled={createGirls === null} style={{ flex: 2 }} />
      </View>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// A player's placement
// ---------------------------------------------------------------------------

export interface PlacementAsk {
  playerName: string
  loadOptions: () => Promise<PlacementOption[]>
  /** Records the choice and returns the server's verdict, which the sheet displays and never decides. */
  onChoose: (option: PlacementOption) => Promise<PlacementVerdict>
}

export function PlacementSheet({ ask, onClose, onChanged, errorMessage }: { ask: PlacementAsk | null; onClose: () => void; onChanged: () => void; errorMessage: (cause: unknown) => string }) {
  const [options, setOptions] = useState<PlacementOption[] | null>(null)
  const [verdict, setVerdict] = useState<PlacementVerdict | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setOptions(null)
    setVerdict(null)
    setProblem(null)
    setBusy(false)
    if (!ask) return
    let live = true
    ask
      .loadOptions()
      .then((o) => {
        if (live) setOptions(o)
      })
      .catch((cause) => {
        if (live) setProblem(errorMessage(cause))
      })
    return () => {
      live = false
    }
    // errorMessage is a stable translation function; the sheet reloads per ask only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  if (!ask) return null
  const blocked = verdict?.reviewState === "BLOCKED"

  async function choose(o: PlacementOption) {
    if (!ask) return
    setBusy(true)
    setProblem(null)
    try {
      setVerdict(await ask.onChoose(o))
      onChanged()
    } catch (cause) {
      setVerdict(null)
      logDetail("admin:rollover:sheet", friendly(cause, "this decision"))
      setProblem(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible title={`Change placement for ${ask.playerName}`} hint="Teams are shown as they will be next season. Moving between squads at the same age grade is your decision; moving age grade is checked against the governing rules. Nothing moves until the handover is applied." onClose={onClose} busy={busy}>
      {options === null && !problem && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <ActivityIndicator color={colour.forest800} />
          <Text style={[type.small, { color: colour.inkMuted }]}>Loading teams…</Text>
        </View>
      )}
      {options && options.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No team is available for this player next season.</Text>}
      {options && options.length > 0 && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {options.map((o, i) => (
            <Pressable
              key={o.teamId ?? `planned-${o.plannedId}`}
              accessibilityRole="button"
              accessibilityLabel={`${o.displayName}${o.isPlanned ? ", created on apply" : ""}${o.isNormal ? ", normal placement" : ""}`}
              disabled={busy}
              onPress={() => void choose(o)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 6, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : o.isSelected ? colour.mint100 : "transparent" })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{o.displayName}</Text>
                {(o.isPlanned || o.isNormal) && (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    {[o.isPlanned ? "Created on apply" : null, o.isNormal ? "Normal placement" : null].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              {o.isSelected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
            </Pressable>
          ))}
        </View>
      )}
      {verdict?.reason && (
        <View accessibilityRole={blocked ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: blocked ? colour.dangerSurface : verdict.reviewState === "NEEDS_ATTENTION" ? colour.warningSurface : colour.successSurface }}>
          <Text style={[type.small, { color: blocked ? colour.danger : verdict.reviewState === "NEEDS_ATTENTION" ? colour.warning : colour.forest800 }]}>{verdict.reason}</Text>
        </View>
      )}
      <Problem text={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
        {/* A blocked placement offers no misleading Done. */}
        {!blocked && <Button label="Done" onPress={onClose} disabled={busy} style={{ flex: 2 }} />}
      </View>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// A Mini-Rugby Group's next-season composition
// ---------------------------------------------------------------------------

export interface GroupCompositionAsk {
  group: MiniRugbyGroupRow
  toSeasonName: string
  onCreate: (teamIds: string[], alias: string | null) => Promise<void>
}

export function GroupCompositionSheet({ ask, onClose, errorMessage }: { ask: GroupCompositionAsk | null; onClose: () => void; errorMessage: (cause: unknown) => string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [alias, setAlias] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setSelected(new Set(ask?.group.teams.map((t) => t.teamId) ?? []))
    setAlias(ask?.group.alias ?? "")
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null
  const g = ask.group

  function toggle(teamId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  async function create() {
    if (!ask) return
    if (selected.size === 0) {
      setProblem("Select at least one team.")
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await ask.onCreate(Array.from(selected), alias.trim() || null)
      onClose()
    } catch (cause) {
      logDetail("admin:rollover:sheet", friendly(cause, "this decision"))
      setProblem(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible title={g.alias ?? g.displayTag} hint={`Teams in the ${ask.toSeasonName} group. A new group is created for next season; this season's group is never changed.`} onClose={onClose} busy={busy}>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {g.teams.map((t, i) => {
          const on = selected.has(t.teamId)
          return (
            <Pressable
              key={t.teamId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={t.projectedAgeGroup ? `${t.displayName}, becomes ${t.projectedAgeGroup}` : t.displayName}
              disabled={busy}
              onPress={() => toggle(t.teamId)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 6, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
                {on && <Check size={15} color={colour.onForest} strokeWidth={3} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{t.displayName}</Text>
                {!!t.projectedAgeGroup && <Text style={[type.caption, { color: colour.inkMuted }]}>→ {t.projectedAgeGroup}</Text>}
              </View>
            </Pressable>
          )
        })}
      </View>
      <Field label="Alias (Optional)" value={alias} onChange={setAlias} placeholder="e.g. The Minis" />
      <Problem text={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
        <Button label="Create With These Teams" onPress={() => void create()} busy={busy} disabled={selected.size === 0} style={{ flex: 2 }} />
      </View>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// A graduating player's placement
// ---------------------------------------------------------------------------

export interface GraduationAsk {
  playerName: string
  previousTeamName: string
  targets: GraduationTargetTeamOption[]
  /** place_graduating_player enforces the governing-body-approval gate server-side; its sentence is shown verbatim. */
  onPlace: (teamId: string) => Promise<void>
}

export function GraduationSheet({ ask, onClose, errorMessage }: { ask: GraduationAsk | null; onClose: () => void; errorMessage: (cause: unknown) => string }) {
  const [teamId, setTeamId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setTeamId(null)
    setProblem(null)
    setBusy(false)
  }, [ask])

  if (!ask) return null

  async function place() {
    if (!ask || !teamId) return
    setBusy(true)
    setProblem(null)
    try {
      await ask.onPlace(teamId)
      onClose()
    } catch (cause) {
      logDetail("admin:rollover:sheet", friendly(cause, "this decision"))
      setProblem(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible title={`Place ${ask.playerName}`} hint={`Previous team: ${ask.previousTeamName}. The governing-body rules for an under-18 joining a senior side are checked by the server.`} onClose={onClose} busy={busy}>
      {ask.targets.length === 0 ? (
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <TriangleAlert size={16} color={colour.warning} />
          <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>No active team to place them on.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 300 }}>
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {ask.targets.map((t, i) => {
              const on = teamId === t.id
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={t.displayName}
                  disabled={busy}
                  onPress={() => setTeamId(t.id)}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 6, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : on ? colour.mint100 : "transparent" })}
                >
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{t.displayName}</Text>
                  {on && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      )}
      <Problem text={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
        <Button label="Place on This Team" onPress={() => void place()} busy={busy} disabled={!teamId} style={{ flex: 2 }} />
      </View>
    </Sheet>
  )
}
