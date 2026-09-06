"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, Shirt } from "lucide-react"

import {
  KIT_PATTERNS,
  RugbyKit,
  describeKit,
  patternNeedsSecondary,
  type KitConfig,
  type KitPattern,
} from "@/components/club/rugby-kit"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { saveClubKit } from "./actions"

/**
 * Club kit configuration -- Home and Away, with a live preview.
 *
 * This lives in Club Settings because that is where the club's profile
 * permanently belongs. The future first-run setup wizard will mount this
 * same component in its Step 1 rather than building a second editor, so a
 * club edits its kit in one place regardless of how it got there.
 *
 * The preview is the same <RugbyKit/> the future Matchday invitation will
 * render, from the same canonical row. What you configure here is exactly
 * what appears on the fixture card.
 *
 * BOTH VARIANTS ARE HELD LOCALLY. Switching tabs is not a round trip and
 * does not discard unsaved edits to the other kit -- each is saved on its
 * own, against its own `club_kits` row, so an unfinished Away kit can never
 * overwrite a finished Home one.
 */
type Variant = "primary" | "alternate"

const VARIANTS: { key: Variant; label: string; sub: string }[] = [
  { key: "primary", label: "Home", sub: "Your usual shirt" },
  { key: "alternate", label: "Away", sub: "Worn when colours clash" },
]

const SWATCHES = [
  "#7a1f3d", "#9b1b30", "#c8102e", "#e35205",
  "#f2a900", "#046a38", "#00594c", "#0b3d91",
  "#5aa9e6", "#4b2e83", "#111111", "#ffffff",
]

const DEFAULT_KIT: KitConfig = {
  pattern: "SOLID",
  primaryColour: "#7a1f3d",
  secondaryColour: "#ffffff",
  accentColour: null,
}

export function KitSection({
  clubId,
  clubName,
  initialPrimary,
  initialAlternate,
  readOnly = false,
}: {
  clubId: string
  clubName: string
  initialPrimary: KitConfig | null
  initialAlternate: KitConfig | null
  readOnly?: boolean
}) {
  const [variant, setVariant] = useState<Variant>("primary")
  const [kits, setKits] = useState<Record<Variant, KitConfig>>({
    primary: initialPrimary ?? DEFAULT_KIT,
    alternate: initialAlternate ?? { ...DEFAULT_KIT, primaryColour: "#ffffff", secondaryColour: "#7a1f3d" },
  })
  const [configured, setConfigured] = useState<Record<Variant, boolean>>({
    primary: initialPrimary !== null,
    alternate: initialAlternate !== null,
  })
  const [saved, setSaved] = useState<Variant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const kit = kits[variant]
  const needsSecondary = patternNeedsSecondary(kit.pattern)

  /** Whether the away kit is currently an exact copy of the home kit. */
  const sameAsHome =
    kits.alternate.pattern === kits.primary.pattern &&
    kits.alternate.primaryColour === kits.primary.primaryColour &&
    kits.alternate.secondaryColour === kits.primary.secondaryColour &&
    kits.alternate.accentColour === kits.primary.accentColour

  function handleSameAsHome(checked: boolean) {
    setError(null)
    setSaved(null)
    if (!checked) {
      // Unticking is an invitation to edit, not a save. The stored away kit
      // stays exactly as it is until they change something and press Save,
      // so an accidental untick costs nothing.
      setKits((k) => ({
        ...k,
        alternate: { ...k.alternate, primaryColour: k.primary.secondaryColour ?? "#ffffff", secondaryColour: k.primary.primaryColour },
      }))
      return
    }

    const home = kits.primary
    setKits((k) => ({ ...k, alternate: { ...home } }))
    startTransition(async () => {
      const result = await saveClubKit({
        clubId,
        variant: "alternate",
        pattern: home.pattern,
        primaryColour: home.primaryColour,
        secondaryColour: patternNeedsSecondary(home.pattern) ? home.secondaryColour : null,
        accentColour: home.accentColour,
      })
      if (result.ok) {
        setSaved("alternate")
        setConfigured((c) => ({ ...c, alternate: true }))
      } else {
        setError(result.error)
      }
    })
  }

  function update(patch: Partial<KitConfig>) {
    setKits((k) => ({ ...k, [variant]: { ...k[variant], ...patch } }))
    setSaved(null)
    setError(null)
  }

  function save() {
    setError(null)
    setSaved(null)
    const current = kits[variant]
    const target = variant
    startTransition(async () => {
      const result = await saveClubKit({
        clubId,
        variant: target,
        pattern: current.pattern,
        primaryColour: current.primaryColour,
        secondaryColour: patternNeedsSecondary(current.pattern) ? current.secondaryColour : null,
        accentColour: current.accentColour,
      })
      if (result.ok) {
        setSaved(target)
        setConfigured((c) => ({ ...c, [target]: true }))
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <section aria-labelledby="club-kit" className="mt-10">
      <div className="flex items-center gap-2.5">
        <Shirt aria-hidden="true" className="size-5 text-forest-800" />
        <h2 id="club-kit" className="font-display text-xl text-ink">
          Club kit
        </h2>
      </div>
      <p className="mt-1 max-w-xl text-sm text-ink/55">
        Your playing shirts, as they will appear on fixture cards. Separate from your club badge —
        both are shown side by side.
      </p>

      {/* ---------- Home / Away switch ----------
          Raised, pressable buttons: the selected one sits flush and the
          other stands proud, so the state reads as physical rather than as
          a colour difference. aria-pressed carries the same information for
          anyone who cannot see the shadow, and each tab says whether that
          kit has been set up yet. */}
      <div
        role="group"
        aria-label="Kit variant"
        className="mt-4 inline-flex gap-2 rounded-xl bg-ink/[0.06] p-1.5"
      >
        {VARIANTS.map((v) => {
          const active = variant === v.key
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                setVariant(v.key)
                setSaved(null)
                setError(null)
              }}
              aria-pressed={active}
              className={cn(
                "group relative flex min-w-[8.5rem] flex-col items-start rounded-lg px-4 py-2.5 text-left outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-pitch-400",
                active
                  ? "translate-y-0 bg-forest-950 text-white shadow-[0_1px_0_0_rgba(0,0,0,0.25)]"
                  : "-translate-y-0.5 bg-white text-ink/70 shadow-[0_3px_0_0_rgba(17,17,17,0.14)] hover:-translate-y-1 hover:text-ink hover:shadow-[0_4px_0_0_rgba(17,17,17,0.16)] active:translate-y-0 active:shadow-[0_1px_0_0_rgba(17,17,17,0.14)]"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {v.label}
                {configured[v.key] ? (
                  <Check
                    aria-hidden="true"
                    className={cn("size-3.5", active ? "text-pitch-400" : "text-forest-800")}
                  />
                ) : null}
              </span>
              <span className={cn("text-xs", active ? "text-white/60" : "text-ink/45")}>
                {configured[v.key] ? v.sub : "Not set up yet"}
              </span>
            </button>
          )
        })}
      </div>

      {/* Plenty of clubs run one set of shirts. Rather than make them
          re-pick the same colours on the Away tab, this copies the home kit
          across and saves it as the away kit -- a real `alternate` row, so
          every fixture card still reads from one canonical place and
          nothing downstream has to know the two happen to match. Unticking
          leaves that row alone until they edit and save it themselves. */}
      {variant === "alternate" && !readOnly && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
          <input
            type="checkbox"
            checked={sameAsHome}
            disabled={pending}
            onChange={(e) => handleSameAsHome(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-forest-800"
          />
          <span>
            <span className="block text-sm font-medium text-ink">
              We play in our home shirts away too
            </span>
            <span className="mt-0.5 block text-xs text-ink/50">
              Copies your home kit across, so away fixture cards still show the right shirt.
            </span>
          </span>
        </label>
      )}

      <div className="mt-4 grid gap-5 rounded-lg border border-ink/10 bg-white px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          {/* The opacity is doing real work: with the away kit locked to the
              home one, the controls are inert, and controls that are inert
              but look live invite clicks that do nothing. */}
          <fieldset
            disabled={readOnly || (variant === "alternate" && sameAsHome)}
            className="disabled:pointer-events-none disabled:opacity-45"
          >
            <legend className="text-sm text-ink/70">
              Pattern
              <span className="sr-only"> for the {variant === "primary" ? "home" : "away"} kit</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {KIT_PATTERNS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => update({ pattern: p.key as KitPattern })}
                  aria-pressed={kit.pattern === p.key}
                  title={p.description}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                    kit.pattern === p.key
                      ? "bg-forest-800 text-white"
                      : "bg-ink/5 text-ink/65 hover:bg-ink/10 hover:text-ink"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <ColourField
                label="Primary"
                value={kit.primaryColour}
                onChange={(v) => update({ primaryColour: v })}
              />
              <ColourField
                label="Secondary"
                value={kit.secondaryColour ?? "#ffffff"}
                onChange={(v) => update({ secondaryColour: v })}
                disabled={!needsSecondary}
                hint={!needsSecondary ? "Not used by a solid kit" : undefined}
              />
              <ColourField
                label="Trim"
                value={kit.accentColour ?? ""}
                onChange={(v) => update({ accentColour: v || null })}
                optional
                hint="Collar and cuffs"
              />
            </div>
          </fieldset>

          {!readOnly && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={save}
                disabled={pending || (variant === "alternate" && sameAsHome)}
                className="h-10 gap-2"
              >
                {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Save {variant === "primary" ? "home" : "away"} kit
              </Button>
              {saved === variant && !pending ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-forest-800" role="status">
                  <Check aria-hidden="true" className="size-4" />
                  Saved
                </span>
              ) : null}
              {error ? (
                <span className="text-sm text-destructive" role="alert">
                  {error}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Preview, plus the sentence a screen reader is given -- kit is
            never conveyed by colour alone. */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg bg-chalk px-4 py-5">
          <RugbyKit
            kit={kit}
            clubName={clubName}
            variant={variant}
            className="size-32 text-ink"
          />
          <p className="text-center text-xs text-ink/55">{describeKit(kit, clubName, variant)}</p>
        </div>
      </div>
    </section>
  )
}

/**
 * A colour control usable three ways: the native picker, a hex field for a
 * club that knows its exact colour, and common rugby swatches. The hex value
 * is always visible as text, so the control never depends on seeing colour.
 */
function ColourField({
  label,
  value,
  onChange,
  disabled = false,
  optional = false,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  optional?: boolean
  hint?: string
}) {
  const id = `kit-colour-${label.toLowerCase()}`
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)

  return (
    <div className={disabled ? "opacity-45" : undefined}>
      <label htmlFor={id} className="text-sm text-ink/70">
        {label}
        {optional ? <span className="text-ink/40"> (optional)</span> : null}
      </label>

      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#000000"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour picker`}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-ink/15 bg-white p-0.5 disabled:cursor-not-allowed"
        />
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          spellCheck={false}
          aria-invalid={!disabled && value !== "" && !valid}
          className="h-9 w-full rounded-lg border border-ink/15 bg-white px-2.5 font-mono text-xs text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
      </div>

      {!disabled && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              aria-label={`Use ${s}`}
              style={{ backgroundColor: s }}
              className={cn(
                "size-5 rounded border outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                value.toLowerCase() === s ? "border-forest-800 ring-1 ring-forest-800" : "border-ink/15"
              )}
            />
          ))}
        </div>
      )}

      {hint ? <p className="mt-1 text-xs text-ink/45">{hint}</p> : null}
      {!disabled && value !== "" && !valid ? (
        <p className="mt-1 text-xs text-destructive">Use a six-digit hex colour, e.g. #7a1f3d.</p>
      ) : null}
    </div>
  )
}
