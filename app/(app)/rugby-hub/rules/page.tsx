import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ReviewStatusNotice } from "@/components/rugby-hub/review-status-notice"
import { RegulatoryFactCard } from "@/components/rugby-hub/regulatory-fact-card"
import { getSessionContext } from "@/lib/app-context/session-context"
import {
  getRugbyHubIdentityContext,
  getRulesBundle,
  getRulesBundleByIdentity,
  getRulesOfPlayBundle,
  getRulesOfPlayBundleByIdentity,
  getSourceMetadata,
  type DomainResult,
  type RugbyHubTeamOption,
  type RulesByIdentityRow,
  type RulesOfPlayRow,
  type RulesRow,
} from "@/lib/app-context/rugby-hub-data"
import { formatRulesValue, groupPitchDimensions, groupRulesOfPlay, labelForObligation, presentPitch, presentRuleOfPlay, RULES_SECTION_LABELS } from "@/lib/app-context/rugby-hub-format"
import { createClient } from "@/lib/supabase/server"

import { resolveHubTeamForRequest } from "../active-team"

export const metadata: Metadata = {
  title: "Rules | Rugby Hub",
  description: "The laws of the game and the age-grade Rules of Play, sourced from official RFU and RFL regulations.",
}

type Supabase = Awaited<ReturnType<typeof createClient>>

const CODE_LABEL: Record<string, string> = { union: "Rugby Union", league: "Rugby League" }

/**
 * RULES -- one page, two layers, for THIS team's age grade (RH-M0.2).
 *
 * GENERAL LAWS are the laws of the game every age grade shares (World Rugby /
 * IRL, published as a regulatory content set). RULES OF PLAY are the governing
 * body's own variations for this age grade -- players, pitch, ball, contact,
 * kicking, scrum, restarts, substitutions, eligibility -- read from the
 * regulatory register for the identity the team's canonical type maps to.
 * Neither layer is Ovalball's: every card carries the governing body's value,
 * its obligation and a link to the registered source.
 *
 * WHOSE RULES: the app-wide selected context decides (resolveHubTeamForRequest),
 * so a parent viewing one child sees that child's age grade and switching
 * context changes the page. The context line says whose rules these are, and
 * the browse banner says when they are not the viewer's own.
 */
export default async function RulesPage({ searchParams }: { searchParams: Promise<{ identity?: string }> }) {
  const { identity: browseIdentityKey } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const { teamId, team, source, options } = await resolveHubTeamForRequest(supabase, ctx)
  const identity = teamId ? await getRugbyHubIdentityContext(supabase, teamId) : null
  const who = team ? whoseTeam(team) : null
  const code = identity?.rugbyCode ? CODE_LABEL[identity.rugbyCode] : null

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Rules</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
        The laws of the game, and the Rules of Play for {browseIdentityKey ? "the age group you chose" : (who ?? "your team")}. This reflects the currently
        published rules for this age group and rugby code &mdash; it is not necessarily the complete official regulation. Check with your club or the
        governing body directly for anything not covered here.
      </p>

      {!browseIdentityKey && who && (
        <p className="mt-4 text-sm text-forest-900" aria-live="polite">
          Rules for <span className="font-semibold">{who}</span>
          {code ? ` · ${code}` : ""}
          {source === "first" && options.length > 1 ? " — your first team; change it under Viewing" : ""}
        </p>
      )}

      <div className="mt-8">
        {browseIdentityKey ? (
          <BrowseRulesContent supabase={supabase} identityKey={browseIdentityKey} />
        ) : teamId && identity ? (
          <RulesContent supabase={supabase} teamId={teamId} identity={identity} who={who ?? "your team"} code={code} />
        ) : (
          <ReviewStatusNotice tone="unavailable" message="No team relationship available to show rules for." />
        )}
      </div>
    </div>
  )
}

function whoseTeam(team: RugbyHubTeamOption): string {
  return team.childName ? `${team.childName}'s ${team.teamDisplayName}` : team.teamDisplayName
}

/**
 * Broad-browse mode: reached from a search result, never from the personal
 * navigation. Shows a real identity's published rules regardless of the
 * viewer's own team -- with a banner that says exactly that, so it is never
 * mistaken for "your own team's rules". If the identity_key doesn't resolve
 * to real content, this says so rather than silently falling back.
 */
async function BrowseRulesContent({ supabase, identityKey }: { supabase: Supabase; identityKey: string }) {
  const [laws, rulesOfPlay] = await Promise.all([getRulesBundleByIdentity(supabase, identityKey), getRulesOfPlayBundleByIdentity(supabase, identityKey)])

  if (laws.status === "error" || rulesOfPlay.status === "error") return <ReviewStatusNotice tone="unavailable" message="Rules for this age group are temporarily unavailable. Please try again shortly." />
  if (laws.status !== "content" && rulesOfPlay.status !== "content") return <ReviewStatusNotice tone="reviewing" message="No published rules were found for that age group." />

  const first = laws.status === "content" ? laws.rows[0] : rulesOfPlay.status === "content" ? rulesOfPlay.rows[0] : null
  const codeLabel = CODE_LABEL[first?.identity_rugby_code ?? "union"]
  const identityLabel = first?.identity_label ?? "this age group"

  return (
    <div>
      <div className="mb-6 rounded-xl border border-mint-300/60 bg-mint-100/50 px-4 py-3">
        <p className="text-sm text-forest-900">
          Showing rules for <span className="font-semibold">{identityLabel}</span> ({codeLabel}) &mdash; not necessarily your own team&apos;s rules.
        </p>
      </div>
      <RulesLayers supabase={supabase} laws={laws} rulesOfPlay={rulesOfPlay} who={identityLabel} code={codeLabel} />
    </div>
  )
}

async function RulesContent({ supabase, teamId, identity, who, code }: { supabase: Supabase; teamId: string; identity: Awaited<ReturnType<typeof getRugbyHubIdentityContext>>; who: string; code: string | null }) {
  if (identity.mappingType === "NO_DIRECT_MAPPING") {
    return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group. Ovalball does not invent one — check with your club for locally-agreed playing arrangements." />
  }
  if (!identity.regulatoryIdentityId) {
    return <ReviewStatusNotice tone="reviewing" message="This age group hasn't been mapped to a regulatory identity yet — age-grade rules aren't available here for it." />
  }

  const [laws, rulesOfPlay] = await Promise.all([getRulesBundle(supabase, teamId, identity), getRulesOfPlayBundle(supabase, teamId, identity)])

  if (laws.status === "error" || rulesOfPlay.status === "error") return <ReviewStatusNotice tone="unavailable" message="Rules for this context are temporarily unavailable. Please try again shortly." />
  if (laws.status === "no-mapping" || rulesOfPlay.status === "no-mapping") return <ReviewStatusNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group." />
  if (laws.status === "empty" && rulesOfPlay.status === "empty") return <ReviewStatusNotice tone="reviewing" message="Detailed rules for this age group are being reviewed and aren't published here yet." />

  return <RulesLayers supabase={supabase} laws={laws} rulesOfPlay={rulesOfPlay} who={who} code={code} />
}

/** The two layers, in order: the General Laws every age grade shares, then this age grade's own Rules of Play. Each layer says plainly when it has nothing published. */
async function RulesLayers({ supabase, laws, rulesOfPlay, who, code }: { supabase: Supabase; laws: DomainResult<RulesRow> | DomainResult<RulesByIdentityRow>; rulesOfPlay: DomainResult<RulesOfPlayRow>; who: string; code: string | null }) {
  const lawRows: (RulesRow | RulesByIdentityRow)[] = laws.status === "content" ? laws.rows : []
  const playRows = rulesOfPlay.status === "content" ? rulesOfPlay.rows : []
  const sourceMetadata = await getSourceMetadata(supabase, [...lawRows.map((r) => r.primary_source_key), ...playRows.map((r) => r.primary_source_key)])
  const generalHasPitch = lawRows.some((r) => r.fact_type === "PITCH_LENGTH" || r.fact_type === "PITCH_WIDTH")

  return (
    <div className="space-y-10">
      <section aria-labelledby="general-laws">
        <h2 id="general-laws" className="font-display text-2xl text-ink">
          General Laws
        </h2>
        <p className="mt-1 text-sm text-ink-muted">The laws of the game every age grade plays under.</p>
        <div className="mt-4">
          {lawRows.length > 0 ? <RulesCards rows={lawRows} sourceMetadata={sourceMetadata} /> : <ReviewStatusNotice tone="reviewing" message="The general laws for this rugby code are being reviewed and aren't published here yet." />}
        </div>
      </section>

      <section aria-labelledby="rules-of-play">
        <h2 id="rules-of-play" className="font-display text-2xl text-ink">
          Rules of Play for {who}
          {code ? <span className="text-ink-muted"> · {code}</span> : null}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">The governing body&apos;s own variations for this age grade.</p>
        <div className="mt-4">
          {playRows.length > 0 ? (
            <RulesOfPlayCards rows={playRows} sourceMetadata={sourceMetadata} pitchAnchorTaken={generalHasPitch} />
          ) : (
            <ReviewStatusNotice tone="reviewing" message="No separate age-grade Rules of Play are published for this age group yet — the general laws above apply." />
          )}
        </div>
      </section>
    </div>
  )
}

/** "General Law" vs "Your Age Grade's Variation" -- the Tier-1/Tier-2 merge distinction. Only get_rugby_hub_rules/get_rugby_hub_rules_by_identity carry is_tier1_variation; other regulatory domains (Safeguarding, Player Welfare) don't have the concept and show no badge. */
function tierLabelFor(row: RulesRow | RulesByIdentityRow): string | null {
  if (row.is_tier1_variation == null) return null
  return row.is_tier1_variation ? "Your Age Grade's Variation" : "General Law"
}

type SourceMap = Awaited<ReturnType<typeof getSourceMetadata>>

function RulesCards({ rows, sourceMetadata }: { rows: (RulesRow | RulesByIdentityRow)[]; sourceMetadata: SourceMap }) {
  const { length, width, rest } = groupPitchDimensions(rows)

  // A section can hold more than one fact (e.g. Tackle & Breakdown) --
  // grouped here so the section-level anchor and heading render once, with
  // each fact getting its own display_title-derived card title instead of
  // colliding on the shared section label.
  const sectionOrder: string[] = []
  const bySection = new Map<string, (RulesRow | RulesByIdentityRow)[]>()
  for (const row of rest) {
    if (!bySection.has(row.section_key)) {
      bySection.set(row.section_key, [])
      sectionOrder.push(row.section_key)
    }
    bySection.get(row.section_key)!.push(row)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(length || width) && (
        <div className="sm:col-span-2">
          <RegulatoryFactCard
            anchorId="section-PITCH"
            title="Pitch"
            valueDisplay={[length ? `Length: ${formatRulesValue(length)}` : null, width ? `Width: ${formatRulesValue(width)}` : null].filter(Boolean).join(" · ")}
            tierLabel={tierLabelFor(length ?? width!)}
            sourceKey={length?.primary_source_key ?? width?.primary_source_key ?? null}
            locator={length?.primary_source_locator ?? width?.primary_source_locator ?? null}
            sourceMetadata={sourceMetadata.get((length ?? width)?.primary_source_key ?? "")}
          />
        </div>
      )}
      {sectionOrder.map((sectionKey) => {
        const sectionRows = bySection.get(sectionKey)!
        const sectionLabel = RULES_SECTION_LABELS[sectionKey] ?? sectionKey

        if (sectionRows.length === 1) {
          const row = sectionRows[0]
          return (
            <RegulatoryFactCard
              key={row.fact_id}
              anchorId={`section-${sectionKey}`}
              title={row.display_title ?? sectionLabel}
              valueDisplay={formatRulesValue(row)}
              isOverlay={row.is_overlay ?? false}
              tierLabel={tierLabelFor(row)}
              sourceKey={row.primary_source_key}
              locator={row.primary_source_locator}
              sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
            />
          )
        }

        return (
          <div key={sectionKey} id={`section-${sectionKey}`} className="scroll-mt-24 sm:col-span-2">
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{sectionLabel}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sectionRows.map((row) => (
                <RegulatoryFactCard
                  key={row.fact_id}
                  title={row.display_title ?? sectionLabel}
                  valueDisplay={formatRulesValue(row)}
                  isOverlay={row.is_overlay ?? false}
                  tierLabel={tierLabelFor(row)}
                  sourceKey={row.primary_source_key}
                  locator={row.primary_source_locator}
                  sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The Rules of Play, one group per governing-body category in the shared canonical order
 * (RULES_OF_PLAY_CATEGORIES). The anchor a search result lands on is the category
 * (`#section-PLAYER_COUNT`); PITCH yields to the General Laws' own pitch card when both exist,
 * so one page never carries the same id twice.
 */
function RulesOfPlayCards({ rows, sourceMetadata, pitchAnchorTaken }: { rows: RulesOfPlayRow[]; sourceMetadata: SourceMap; pitchAnchorTaken: boolean }) {
  const groups = groupRulesOfPlay(rows)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {groups.map((group) => {
        const anchorId = group.key === "PITCH" && pitchAnchorTaken ? undefined : `section-${group.key}`
        const pitch = group.key === "PITCH" ? presentPitch(group.rows) : null
        const cardRows = pitch ? pitch.rest : group.rows
        const lengthOrWidth = pitch ? group.rows.find((r) => r.fact_type === "PITCH_LENGTH") ?? group.rows.find((r) => r.fact_type === "PITCH_WIDTH") : undefined

        const cards = [
          ...(pitch && pitch.headline && lengthOrWidth
            ? [
                <RegulatoryFactCard
                  key={`${group.key}-dimensions`}
                  title="Pitch"
                  valueDisplay={pitch.headline}
                  body={pitch.body}
                  obligation={labelForObligation(lengthOrWidth.obligation_level)}
                  sourceKey={lengthOrWidth.primary_source_key}
                  locator={lengthOrWidth.primary_source_locator}
                  sourceMetadata={sourceMetadata.get(lengthOrWidth.primary_source_key ?? "")}
                />,
              ]
            : []),
          ...cardRows.map((row) => {
            const p = presentRuleOfPlay(row)
            return (
              <RegulatoryFactCard
                key={row.fact_id}
                title={p.title}
                valueDisplay={p.headline}
                body={p.body}
                obligation={labelForObligation(row.obligation_level)}
                sourceKey={row.primary_source_key}
                locator={row.primary_source_locator}
                sourceMetadata={sourceMetadata.get(row.primary_source_key ?? "")}
              />
            )
          }),
        ]

        if (cards.length === 1) {
          return (
            <div key={group.key} id={anchorId} className="scroll-mt-24">
              {cards[0]}
            </div>
          )
        }
        return (
          <div key={group.key} id={anchorId} className="scroll-mt-24 sm:col-span-2">
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{group.label}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{cards}</div>
          </div>
        )
      })}
    </div>
  )
}
