"use client"

import { useEffect, useId, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpRight, Plus } from "lucide-react"
import {
  collectionDaySentence,
  connectionSentence,
  feeBearerOptions,
  feePercent,
  firstPaymentPolicyOptions,
  GOCARDLESS_FEES_SENTENCE,
  goCardlessVerifyUrl,
  PROGRAMME_STATE_LABEL,
  type FeeBearer,
  type MembershipPriceRow,
  type MembershipSetupState,
  type SetupFirstPaymentPolicy,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import { formatFinanceDate } from "@ovalball/contracts/club/finance"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"

import {
  acceptMembershipTermsAction,
  activateMembershipsAction,
  archiveMembershipAction,
  disconnectGoCardless,
  getActiveSubscriptionImpact,
  pauseMembershipsAction,
  saveMembershipAction,
  saveMembershipSettingsAction,
} from "./actions"
import {
  ARIA_DISABLED_LOOK,
  ChoiceCards,
  CollectionDaySelect,
  ConnectionChip,
  exampleBasis,
  FirstPaymentExampleBlock,
  MembershipCard,
  MembershipDialog,
  MoneyReceipt,
  Panel,
  ReceiptAnnouncer,
  ReceiptPlaceholder,
  SectionNotice,
  TermsPanel,
  teamsSentence,
  ToneChip,
  useFirstPaymentExample,
  useWarnBeforeLeaving,
  type MembershipDraft,
  type SectionNoticeValue,
} from "./membership-parts"
import { SiblingDiscountPanel, type SiblingRuleRow } from "./sibling-discount-panel"

/**
 * MEMBERSHIP SETTINGS ON THE WEBSITE -- a club whose memberships are on (Club Memberships Part 1).
 *
 * ONE ORDER, at every width and for a screen reader alike: Status (whether new memberships are being taken),
 * Memberships, Collection & Fee, Sibling Discounts, GoCardless, Ovalball's Terms. From lg the status is a compact
 * strip across the top and the rest sits in two columns that both start at the top -- what the club collects and how
 * on the left, the arrangements around it on the right -- so the reading order and the visual order never disagree.
 *
 * Sections are the cards; nothing inside them is boxed again: memberships and sibling rules are divided rows, the
 * worked example is a plain block, and the money receipt is the one tinted thing. Settings and prices reach NEW
 * memberships; a member already enrolled keeps what they joined on. Pausing stops new memberships only. What an
 * action did is said beside the section that did it.
 */

type Draft = { collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }

export type BoardSection = "status" | "memberships" | "collection" | "gocardless" | "terms"
export type BoardNotice = SectionNoticeValue & { where: BoardSection }

const GOCARDLESS_SECTION_ID = "membership-settings-gocardless"

export function MembershipSettingsBoard({
  setup,
  clubName,
  history,
  siblingRules,
  canEditSiblings,
  initialNotice = null,
}: {
  setup: MembershipSetupState
  clubName: string
  history: MembershipPriceRow[]
  siblingRules: SiblingRuleRow[]
  canEditSiblings: boolean
  /** What brought the person here (GoCardless's return, or Activate), said in the section it is about. */
  initialNotice?: BoardNotice | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const s = setup
  const bps = s.feeBps
  const pct = feePercent(bps)
  const currency = s.programme?.currency ?? "GBP"
  const active = s.state === "ACTIVE"
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"

  const saved: Draft = useMemo(
    () => ({ collectionDay: s.programme?.collectionDay ?? 1, firstPaymentPolicy: s.programme?.firstPaymentPolicy ?? "NEXT_COLLECTION_DAY", feeBearer: s.programme?.feeBearer ?? null }),
    [s.programme?.collectionDay, s.programme?.firstPaymentPolicy, s.programme?.feeBearer]
  )
  const [form, setForm] = useState<Draft>(saved)
  const [touched, setTouched] = useState(false)
  // A draft nobody has touched follows the server; a changed one is the person's until Save or Discard. Adjusted
  // while rendering (React's own pattern for state that follows a prop), not in an effect after the frame.
  const [followed, setFollowed] = useState<Draft>(saved)
  if (!touched && followed !== saved) {
    setFollowed(saved)
    setForm(saved)
  }
  const dirty = form.collectionDay !== saved.collectionDay || form.firstPaymentPolicy !== saved.firstPaymentPolicy || form.feeBearer !== saved.feeBearer
  useWarnBeforeLeaving(dirty)

  const basis = exampleBasis(s.memberships)
  const { example, changedSinceOpening } = useFirstPaymentExample({ clubId: s.clubId, monthlyAmountMinor: basis.amountMinor, collectionDay: form.collectionDay, firstPaymentPolicy: form.firstPaymentPolicy, feeBearer: form.feeBearer })

  const [notice, setNotice] = useState<BoardNotice | null>(initialNotice)
  const said = (where: BoardSection): SectionNoticeValue | null => (notice?.where === where ? notice : null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [editing, setEditing] = useState<SetupMembership | "new" | null>(null)
  const [sheetSaving, setSheetSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)
  const [statusAsk, setStatusAsk] = useState<"pause" | "resume" | null>(null)
  const [reason, setReason] = useState("")
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusProblem, setStatusProblem] = useState<string | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [impact, setImpact] = useState<string>("")
  const [archiving, setArchiving] = useState<SetupMembership | null>(null)
  const [agreed, setAgreed] = useState(false)

  // Back from GoCardless: the page opens on the GoCardless section, where what happened is said.
  useEffect(() => {
    if (initialNotice?.where === "gocardless") document.getElementById(GOCARDLESS_SECTION_ID)?.scrollIntoView({ block: "center" })
  }, [initialNotice?.where])

  const historyByMembership = useMemo(() => {
    const map = new Map<string, MembershipPriceRow[]>()
    for (const row of history) if (row.productId) map.set(row.productId, [...(map.get(row.productId) ?? []), row])
    return map
  }, [history])
  const unassigned = s.teams.filter((t) => !t.productId)

  const refresh = () => startTransition(() => router.refresh())

  async function saveSettings() {
    if (!dirty || savingSettings) return
    setSavingSettings(true)
    const result = await saveMembershipSettingsAction(s.clubId, form)
    setSavingSettings(false)
    if (!result.ok) return setNotice({ where: "collection", tone: "error", text: result.error })
    setTouched(false)
    setNotice({ where: "collection", tone: "ok", text: "Settings saved. They apply to new memberships from now on." })
    refresh()
  }

  async function saveMembership(d: MembershipDraft) {
    if (!editing) return
    setSheetSaving(true)
    setSheetProblem(null)
    const result = await saveMembershipAction(s.clubId, {
      productId: editing === "new" ? null : editing.id,
      name: d.name,
      monthlyAmountMinor: d.monthlyAmountMinor,
      teamIds: d.teamIds,
      priceFrom: d.priceFrom,
      before: editing === "new" ? null : { name: editing.name, teamIds: editing.teams.map((t) => t.id) },
    })
    setSheetSaving(false)
    refresh()
    if (!result.ok) return setSheetProblem(result.error)
    setEditing(null)
    setNotice({ where: "memberships", tone: "ok", text: `${d.name} saved.` })
  }

  async function confirmStatus() {
    setStatusBusy(true)
    setStatusProblem(null)
    const result = statusAsk === "pause" ? await pauseMembershipsAction(s.clubId, reason.trim()) : await activateMembershipsAction(s.clubId)
    setStatusBusy(false)
    if (!result.ok) return setStatusProblem(result.error)
    setNotice({ where: "status", tone: "ok", text: statusAsk === "pause" ? "New memberships are paused." : "New memberships are open again." })
    setStatusAsk(null)
    setReason("")
    refresh()
  }

  async function openDisconnect() {
    setStatusProblem(null)
    setReason("")
    const figures = await getActiveSubscriptionImpact(s.clubId)
    setImpact(
      figures
        ? ` Right now: ${figures.activeGoCardlessSubscriptions} live Direct Debit ${figures.activeGoCardlessSubscriptions === 1 ? "subscription" : "subscriptions"}, ${figures.activePayers} active ${figures.activePayers === 1 ? "payer" : "payers"}, ${figures.pendingObligations} pending ${figures.pendingObligations === 1 ? "payment" : "payments"}.`
        : ""
    )
    setDisconnectOpen(true)
  }

  async function confirmDisconnect() {
    setStatusBusy(true)
    setStatusProblem(null)
    const result = await disconnectGoCardless(s.clubId, reason.trim())
    setStatusBusy(false)
    if (!result.ok) return setStatusProblem(result.error)
    setDisconnectOpen(false)
    setReason("")
    setNotice({ where: "gocardless", tone: "ok", text: "GoCardless is disconnected." })
    refresh()
  }

  async function confirmArchive() {
    if (!archiving) return
    setStatusBusy(true)
    const result = await archiveMembershipAction(archiving.id)
    setStatusBusy(false)
    if (!result.ok) return setStatusProblem(result.error)
    setNotice({ where: "memberships", tone: "ok", text: `${archiving.name} removed.` })
    setArchiving(null)
    refresh()
  }

  async function agree() {
    const result = await acceptMembershipTermsAction(s.clubId, s.terms.version)
    if (!result.ok) return setNotice({ where: "terms", tone: "error", text: result.error })
    setNotice({ where: "terms", tone: "ok", text: "Agreement recorded." })
    refresh()
  }

  return (
    <div className="mt-8 space-y-6">
      {/* ---------------------------------------------------------------------------------- 1. status */}
      <StatusStrip
        state={s.state}
        active={active}
        canConfigure={s.canConfigure}
        activatedAt={s.programme?.activatedAt ?? null}
        notice={said("status")}
        onToggle={(on) => (setStatusProblem(null), setStatusAsk(on ? "resume" : "pause"))}
      />

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* ------------------------------------------------------------------------------ 2-3. what is collected */}
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <Panel
            title="Memberships"
            description="Each team has one membership. A player in teams with different memberships pays the higher price."
            action={
              s.canConfigure ? (
                <Button className="h-11 sm:h-9" onClick={() => (setSheetProblem(null), setEditing("new"))}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Add a Membership
                </Button>
              ) : undefined
            }
          >
            {s.memberships.length > 0 && (
              <ul className="divide-y divide-ink/10">
                {s.memberships.map((m) => (
                  <li key={m.id} className="py-4 first:pt-0 last:pb-0">
                    <MembershipCard
                      variant="row"
                      membership={m}
                      currency={currency}
                      feeBearer={s.programme?.feeBearer ?? null}
                      showHolders
                      history={historyByMembership.get(m.id)}
                      onEdit={s.canConfigure ? () => (setSheetProblem(null), setEditing(m)) : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
            {unassigned.length > 0 && (
              <p className="mt-4 max-w-prose border-t border-ink/10 pt-4 text-sm text-ink">
                {`${unassigned.length === 1 ? "1 team has" : `${unassigned.length} teams have`} no membership: ${teamsSentence(unassigned, 4)}. Players only in ${unassigned.length === 1 ? "that team" : "those teams"} are not asked to pay.`}
              </p>
            )}
            <SectionNotice notice={said("memberships")} />
          </Panel>

          <Panel title="Collection & Fee" description="For new memberships. A member already paying keeps the settings they joined on.">
            <CollectionDaySelect value={form.collectionDay} disabled={!s.canConfigure} onChange={(collectionDay) => (setTouched(true), setForm({ ...form, collectionDay }))} />
            <p className="mt-2 max-w-prose text-sm text-ink-muted">{collectionDaySentence(form.collectionDay)}</p>

            <h3 className="mt-6 text-sm font-semibold text-ink">First Payment</h3>
            <p className="mt-0.5 max-w-prose text-sm text-ink-muted">When a player joins part-way through a month:</p>
            <div className="mt-3">
              <ChoiceCards legend="First payment" columns={2} disabled={!s.canConfigure} value={form.firstPaymentPolicy} onChange={(firstPaymentPolicy) => (setTouched(true), setForm({ ...form, firstPaymentPolicy }))} options={firstPaymentPolicyOptions(form.collectionDay)} />
            </div>
            <FirstPaymentExampleBlock heading={basis.heading} example={example} />

            <h3 className="mt-6 text-sm font-semibold text-ink">Ovalball&rsquo;s Fee</h3>
            <p className="mt-0.5 max-w-prose text-sm text-ink-muted">{`Ovalball's fee is ${pct} of the membership price in each payment collected through Ovalball. Who pays it?`}</p>
            <div className="mt-3 grid items-start gap-4 md:grid-cols-[1fr_17rem]">
              <ChoiceCards legend={`Who pays Ovalball's ${pct}`} disabled={!s.canConfigure} value={form.feeBearer} onChange={(feeBearer) => (setTouched(true), setForm({ ...form, feeBearer }))} options={feeBearerOptions(bps)} />
              {!form.feeBearer ? (
                <p className="border-l-2 border-amber-500 pl-3 text-sm text-amber-900">{`No fee arrangement is chosen yet, so Ovalball takes no fee from this club's memberships. Choose who pays Ovalball's ${pct}.`}</p>
              ) : example ? (
                <MoneyReceipt example={example} bps={bps} currency={currency} caveat={false} />
              ) : (
                <ReceiptPlaceholder />
              )}
            </div>
            {/* GoCardless's fees, said once: the receipt beside it leaves its own caveat off. */}
            <p className="mt-3 max-w-prose text-xs text-ink-muted">{GOCARDLESS_FEES_SENTENCE}</p>
            <ReceiptAnnouncer example={form.feeBearer ? example : null} announce={changedSinceOpening} />

            {s.canConfigure && (
              <div className="mt-6 flex flex-wrap gap-3 border-t border-ink/10 pt-4">
                <Button className={`h-11 px-5 sm:h-9 ${ARIA_DISABLED_LOOK}`} focusableWhenDisabled disabled={!dirty || savingSettings} onClick={() => void saveSettings()}>
                  {savingSettings ? "Saving…" : "Save Changes"}
                </Button>
                {dirty && (
                  <Button variant="outline" className="h-11 sm:h-9" onClick={() => (setTouched(false), setForm(saved))}>
                    Discard
                  </Button>
                )}
              </div>
            )}
            <SectionNotice notice={said("collection")} />
          </Panel>
        </div>

        {/* ------------------------------------------------------------------------------ 4-6. around it */}
        <div className="min-w-0 space-y-6 lg:col-span-5">
          {s.programme && canEditSiblings ? <SiblingDiscountPanel programmeId={s.programme.id} clubId={s.clubId} rules={siblingRules} /> : null}

          <Panel id={GOCARDLESS_SECTION_ID} title="GoCardless" action={<ConnectionChip state={s.connection.state} />}>
            <p className="max-w-prose text-sm text-ink">{connectionSentence(s.connection.state)}</p>
            {connected && s.connection.connectedAt && <p className="mt-2 text-xs text-ink-muted">{`Connected ${formatFinanceDate(s.connection.connectedAt, "long")}.`}</p>}
            {connected && s.connection.environment === "sandbox" && <p className="mt-1 text-xs text-ink-muted">This is a GoCardless test account: no real money moves.</p>}
            <p className="mt-1 max-w-prose text-xs text-ink-muted">The club&rsquo;s bank details are held by GoCardless, never by Ovalball.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {s.canConnect && s.connection.state === "ACTION_REQUIRED" && (
                <Button className="h-11 sm:h-9" nativeButton={false} render={<a href={goCardlessVerifyUrl(s.connection.environment)} target="_blank" rel="noreferrer" />}>
                  Finish Verification with GoCardless
                  <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                </Button>
              )}
              {s.canConnect && !connected && s.terms.accepted && (
                <Button className="h-11 sm:h-9" nativeButton={false} render={<a href={`/api/gocardless/oauth/start?clubId=${encodeURIComponent(s.clubId)}`} />}>
                  {s.connection.state === "DISCONNECTED" ? "Reconnect GoCardless" : "Connect GoCardless"}
                  <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                </Button>
              )}
              {s.canConnect && connected && (
                <Button variant="outline" className="h-11 sm:h-9" onClick={() => void openDisconnect()}>
                  Disconnect GoCardless
                </Button>
              )}
            </div>
            {!s.canConnect && <p className="mt-3 max-w-prose text-xs text-ink-muted">Connecting or disconnecting GoCardless needs the GoCardless permission at this club.</p>}
            <SectionNotice notice={said("gocardless")} />
          </Panel>

          <TermsPanel
            title="Ovalball's Terms"
            bps={bps}
            terms={s.terms}
            clubName={clubName}
            agreed={agreed}
            onAgreedChange={setAgreed}
            canAgree={(s.canConfigure || s.canConnect) && !s.terms.accepted}
            after={
              <>
                {!s.terms.accepted && (s.canConfigure || s.canConnect) && (
                  <Button variant="outline" className="mt-3 h-11 sm:h-9" disabled={!agreed} onClick={() => void agree()}>
                    Agree to These Terms
                  </Button>
                )}
                <SectionNotice notice={said("terms")} className="mt-3" />
              </>
            }
          />
        </div>
      </div>

      <MembershipDialog
        open={editing !== null}
        membership={editing === "new" ? null : editing}
        teams={s.teams}
        memberships={s.memberships}
        askPriceStart
        saving={sheetSaving}
        problem={sheetProblem}
        onClose={() => setEditing(null)}
        onSave={(d) => void saveMembership(d)}
        onArchive={editing && editing !== "new" ? () => (setArchiving(editing), setEditing(null)) : undefined}
      />

      {/* Pause needs a reason; resuming re-checks the club is still ready. */}
      <Dialog open={statusAsk !== null} onOpenChange={(next) => !next && setStatusAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{statusAsk === "pause" ? "Pause New Memberships?" : "Take New Memberships Again?"}</DialogTitle>
            <DialogDescription>
              {statusAsk === "pause"
                ? "Nobody can start a new membership while new memberships are paused. Members already enrolled keep paying as normal, and nothing already scheduled changes."
                : "Members can start a new membership again. Ovalball checks the club is still ready first: GoCardless connected and verified, and a membership with a price and a team."}
            </DialogDescription>
          </DialogHeader>
          {statusAsk === "pause" && (
            <div className="space-y-1.5">
              <label htmlFor="pause-reason" className="text-sm font-medium text-ink">
                Reason <span className="text-destructive-text">*</span>
              </label>
              <textarea id="pause-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Recorded with the change, e.g. end of season" className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-3 focus-visible:ring-pitch-400/40" />
            </div>
          )}
          {statusProblem && (
            <p role="alert" className="text-sm text-destructive-text">
              {statusProblem}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setStatusAsk(null)}>
              Cancel
            </Button>
            <Button className="h-11 sm:h-9" disabled={statusBusy || (statusAsk === "pause" && reason.trim().length === 0)} onClick={() => void confirmStatus()}>
              {statusBusy ? "Saving…" : statusAsk === "pause" ? "Pause New Memberships" : "Take New Memberships"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnectOpen} onOpenChange={(next) => !next && setDisconnectOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect GoCardless?</DialogTitle>
            <DialogDescription>{`Ovalball stops using the club's GoCardless account straight away, and no new memberships or collections can be set up until it is connected again. Payment history stays. GoCardless may still collect payments it has already scheduled; cancel those in GoCardless if they should stop.${impact}`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="disconnect-reason" className="text-sm font-medium text-ink">
              Reason <span className="text-destructive-text">*</span>
            </label>
            <textarea id="disconnect-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Recorded with the change" className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-3 focus-visible:ring-pitch-400/40" />
          </div>
          {statusProblem && (
            <p role="alert" className="text-sm text-destructive-text">
              {statusProblem}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setDisconnectOpen(false)}>
              Keep Connected
            </Button>
            <Button variant="destructive" className="h-11 sm:h-9" disabled={statusBusy || reason.trim().length === 0} onClick={() => void confirmDisconnect()}>
              {statusBusy ? "Disconnecting…" : "Disconnect GoCardless"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiving !== null} onOpenChange={(next) => !next && setArchiving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{archiving ? `Remove ${archiving.name}?` : "Remove Membership?"}</DialogTitle>
            <DialogDescription>{archiving && archiving.teams.length > 0 ? `Nobody is paying for it. ${teamsSentence(archiving.teams, 4)} will have no membership until you add ${archiving.teams.length === 1 ? "it" : "them"} to another.` : "Nobody is paying for it."}</DialogDescription>
          </DialogHeader>
          {statusProblem && (
            <p role="alert" className="text-sm text-destructive-text">
              {statusProblem}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setArchiving(null)}>
              Keep It
            </Button>
            <Button variant="destructive" className="h-11 sm:h-9" disabled={statusBusy} onClick={() => void confirmArchive()}>
              Remove Membership
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Whether new memberships are being taken: a compact strip across the top. The toggle is part of the strip, not a
 * card inside it; switching it asks first (a pause needs a reason, resuming re-checks the club is ready).
 */
function StatusStrip({
  state,
  active,
  canConfigure,
  activatedAt,
  notice,
  onToggle,
}: {
  state: MembershipSetupState["state"]
  active: boolean
  canConfigure: boolean
  activatedAt: string | null
  notice: SectionNoticeValue | null
  onToggle: (on: boolean) => void
}) {
  const titleId = useId()
  const labelId = useId()
  const descriptionId = useId()
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-ink/10 bg-white px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            Club Memberships
          </h2>
          <ToneChip label={PROGRAMME_STATE_LABEL[state]} tone={active ? "settled" : "attention"} srLabel={`Club memberships: ${PROGRAMME_STATE_LABEL[state]}`} />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 border-t border-ink/10 pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="min-w-0">
            <p id={labelId} className="text-sm font-medium text-ink">
              Taking New Memberships
            </p>
            <p id={descriptionId} className="mt-0.5 max-w-prose text-sm text-ink-muted">
              {active ? "Members can start a membership." : "Paused: nobody can start a membership. Members already enrolled keep paying."}
            </p>
            {activatedAt && <p className="mt-0.5 text-xs text-ink-muted">{`First switched on ${formatFinanceDate(activatedAt, "long")}.`}</p>}
          </div>
          {canConfigure && <Switch aria-labelledby={labelId} aria-describedby={descriptionId} checked={active} onCheckedChange={onToggle} />}
        </div>
      </div>
      <SectionNotice notice={notice} className="mt-3" />
    </section>
  )
}
