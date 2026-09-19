import { setCapabilityOverride } from "../master-control"
import { MasterControlAction } from "../master-control-action"

export interface OverrideRow {
  id: string
  capabilityKey: string
  capabilityLabel: string
  scopeType: string
  scopeName: string | null
  effect: string
  status: string
  reason: string | null
  expiresAt: string | null
}

/**
 * SLICE 7e -- tab 8. `site_set_capability_override` is the one operation that
 * puts a per-person exception in front of the whole capability model, and it had
 * no caller: the only way to grant or deny one person one capability was to write
 * SQL.
 *
 * The expiry field is offered deliberately and near the top of the mind. Almost
 * every legitimate override is temporary -- covering an injured officer, a
 * fortnight of tournament admin -- and the ones that are not temporary are
 * describing a role that should exist rather than an exception that should
 * persist. An override with no end date is the thing somebody finds three years
 * later and cannot explain.
 */
export function CapabilityOverridesPanel({
  userId,
  userName,
  overrides,
  capabilities,
  clubs,
  teams,
}: {
  userId: string
  userName: string
  overrides: OverrideRow[]
  capabilities: { key: string; label: string }[]
  clubs: { id: string; name: string }[]
  teams: { id: string; name: string; clubName: string }[]
}) {
  const live = overrides.filter((o) => o.status === "ACTIVE" || o.status === "active")

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Exceptions In Force</h2>
        {live.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
            {userName} has no capability exceptions. Everything they can do comes from a role.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {live.map((o) => (
              <li
                key={o.id}
                className={`rounded-lg border px-4 py-3 ${
                  o.effect === "deny" ? "border-destructive/25 bg-destructive/[0.03]" : "border-pitch-600/25 bg-mint-100/40"
                }`}
              >
                <p className="text-sm font-medium text-ink">
                  {o.effect === "deny" ? "Denied" : "Granted"}: {o.capabilityLabel}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {o.scopeType === "site" ? "Across the platform" : `${o.scopeName ?? o.scopeType}`}
                  {o.expiresAt ? ` · until ${formatDate(o.expiresAt)}` : " · no end date"}
                </p>
                {o.reason && <p className="mt-1 text-sm text-ink/70">{o.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Make an Exception</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          An override sits in front of every role {userName} holds. Give it an end date unless you genuinely mean it to
          outlive the situation that caused it &mdash; if it is permanent, it is a role, not an exception.
        </p>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Site Admin capabilities are not listed. Those come from a Site Admin profile and are changed on the Site
          Admin tab; a per-person exception has never applied to them.
        </p>
        <div className="mt-3">
          <MasterControlAction
            label="Grant or Deny One Capability"
            confirmLabel="Apply Exception"
            description="Writes a per-person override through the canonical override rules. A deny beats every grant a role gives."
            placeholder="Covering the Safeguarding Officer's maternity leave until 30 November."
            fields={[
              {
                name: "capabilityKey",
                label: "Capability",
                kind: "select",
                options: capabilities.map((c) => ({ value: c.key, label: `${c.label} (${c.key})` })),
              },
              {
                name: "scopeType",
                label: "Scope",
                kind: "select",
                options: [
                  { value: "site", label: "The whole platform" },
                  { value: "club", label: "One club" },
                  { value: "team", label: "One team" },
                ],
              },
              { name: "clubId", label: "Club (club scope only)", kind: "select", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
              {
                name: "teamId",
                label: "Team (team scope only)",
                kind: "select",
                options: teams.map((t) => ({ value: t.id, label: `${t.clubName} — ${t.name}` })),
              },
              {
                name: "effect",
                label: "Effect",
                kind: "select",
                options: [
                  { value: "grant", label: "Grant it" },
                  { value: "deny", label: "Deny it" },
                ],
              },
              { name: "expiresAt", label: "Ends on", kind: "date", hint: "Leave blank only if this is genuinely permanent." },
            ]}
            perform={setCapabilityOverride.bind(null, userId)}
          />
        </div>
      </section>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
