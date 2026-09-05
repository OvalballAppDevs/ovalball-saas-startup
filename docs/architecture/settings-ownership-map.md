# Ovalball Settings Ownership Map

Status: living document, first drafted during the Master Architecture Pass (2026-09-03), alongside
the Active Context Settings Gear. Every editable setting belongs to exactly ONE owner entity —
this table exists so a future developer never puts the same editable field into two scopes.

**Navigation update (Club Settings Consolidation pass, 2026-09-03):** the Club Profile, Team
Settings, and Lookup Administration rows below are unchanged in ownership, canonical field, and edit
capability — only how a Club Admin *reaches* them changed. `/club/settings` is a new hub page that
holds no data of its own; it is pure navigation over the exact same `/club`, `/teams`, and
`/club/venues` pages this table already describes, with a shared tab strip (`club-settings-nav.tsx`)
so moving between them never returns to unrelated top-level app navigation. The formerly-separate
"Club" / "Teams" / "Lookup Administration" top-level nav entries were folded into one "Club Settings"
entry; the settings gear now opens `/club/settings` instead of `/club` directly. See
`docs/architecture/club-settings-permission-matrix.md` for the per-section authorization matrix and
`docs/architecture/capability-model.md` for the underlying role/capability audit this pass produced.

| Setting | Owner entity | Canonical field/source | Edit capability | Read consumers | Invalidation/revalidation |
|---|---|---|---|---|---|
| Personal Avatar | Person (`profiles`) | `profiles.avatar_storage_path`, bucket `avatars` | The authenticated user themselves only (`account/actions.ts` — no capability check needed, RLS `profiles_update_self_or_admin` scopes it to `id = auth.uid()` or Site Admin) | `lib/app-context/personal-avatar.ts`'s `resolvePersonalAvatarUrl()` — used by `layout.tsx` (identity block), `account/page.tsx`, `public-header-identity.ts`, `resolve-identities.ts` (Messages participant identity) | `revalidatePath` on `/account`; every other consumer re-fetches on next server render (no client cache to invalidate) |
| Personal Name / Contact Details | Person (`profiles`) | `profiles.first_name`/`surname`/`phone_number`/address fields | Self only | `personal-details-form.tsx`, `phone-number-form.tsx`, identity blocks (name only) | `revalidatePath("/account")` |
| Club Logo | Club (`clubs`) | `clubs.logo_storage_path`, bucket `club-logos` — falls back to `club_directory.logo_storage_path` for READ-ONLY display consumers only (never the editor itself, which needs the raw uploaded-or-not state) | `is_site_admin() OR is_club_admin(club_id)` (RLS `clubs_update_admin`) | `lib/app-context/club-logo.ts`'s `resolveClubLogoUrl()`/`resolveClubLogoPath()` — `session-context.ts` (top-left identity, every page), `app/club/[slug]/page.tsx` (public page), `conversations.ts` (Messages), `partner-clubs/map-data.ts`, `admin/fixtures/query.ts` | `revalidatePath("/club")` |
| Club Details (bio, website, Facebook, address display) | Club (`clubs`) | `clubs.bio`/`website`/`facebook_url`/`address_display` | Same as Club Logo | Club Settings page, public club page | `revalidatePath("/club")` |
| Club Directory identity (name, town, county, rugby code) | **Club Directory**, deliberately NOT Club | `club_directory.name`/`town`/`county`/`rugby_code` | Site Admin only (governing-body-sourced canonical record — Club Settings' own page copy: *"Club name, location, and rugby code come from Ovalball's canonical directory and can't be edited here"*) | Everywhere a club's name/location is shown | `revalidatePath` on the relevant Site Admin club page |
| Team operational settings (category, age group, squad designation, gender, active/folded state) | Team (`teams`) | `teams.category`/`age_group`/`squad_designation`/`gender`/`active` | `is_site_admin() OR is_club_admin(club_id)` (RLS `teams_update_admin`) — **not** `team_admin` team-permission holders; confirmed this pass, a real pre-existing design choice, not a bug introduced now | `/teams/[teamId]` ("Team settings" section, newly labelled this pass) | `revalidatePath` inside `updateTeam()` |
| Team roster / people assignment | Team (`team_permissions`) | `team_permissions` rows | `is_site_admin() OR is_club_admin(club_id)` (same as above) — team-scoped assignment is itself a Club Admin action, not self-service | `team-people.tsx` | action-level revalidate |
| Parent/Guardian preferences | **None yet — explicitly deferred** | — | — | — | — |
| Player-specific settings | **None yet — explicitly deferred** | — | — | — | — |
| Site Admin capabilities (per-person grants) | Site Admin (`site_admins`) | `site_admins.admin_role` + 5 boolean capability columns | Existing Site Admin management surface (`/admin/site-admins`) | `getSessionContext()` | action-level revalidate |

## Team Settings — field-level classification and the Team Admin decision (Security/Safeguarding Gate)

Every field `/teams/[teamId]` can touch, inventoried directly from `team-edit-form.tsx` and
`teams/[teamId]/actions.ts` (not guessed):

| Field / action | Classification | Reasoning |
|---|---|---|
| `category`/`age_group`/`gender`/`squad_designation` (`updateTeam`) | **C — System/Canonical, not ordinary editable** | This is the team's canonical identity — which `canonical_team_type_id` this row represents. Reclassifying a team (e.g. U12 → U14) touches Team Directory identity, fixture-history meaning, and age-grade/season logic. Never casually editable by anyone below Club Admin. |
| `display_name` | **C — System/Canonical** | Not directly editable by anyone at all — a DB trigger (`teams_set_display_name_trigger`) derives it unconditionally from the structured fields above on every save. |
| Fold / Reactivate (`foldTeam`/`reactivateTeam`) | **B — Club Admin only** | Real cross-club-visible consequences: cancels every future active fixture the team owns and notifies real activated opponents. Not a single team's unilateral call. |
| Fixture restoration request | **B — Club Admin only** | Same reasoning as fold/reactivate; already gated by the same `canManage`. |
| Team roster assignment (`assignTeamMember`/`removeTeamMember`, i.e. `team_permissions` writes) | **B — Club Admin only (currently)** | Confirmed live via direct RLS query: `team_permissions_insert_scoped`/`update_scoped`/`delete_scoped` are *all* `is_site_admin() OR is_club_admin(club_id)` — a `team_admin`/`coach` permission holder has **zero** write authority here today, matching the pattern above. This is the one row with a plausible future case for **A** (a coach assigning another coach to their own team is a reasonable team-scoped action) — but it is not authorized today, and this pass does not change that. |

**Decision: no new Team Admin write capability was granted this pass.** Every field on this page is
currently B or C — there is no A-classified (genuinely team-admin-manageable) field in the existing
system to hand over. Extending capability here is a real product decision (which fields, what RPC
shape, what audit trail) that needs its own design pass, not something to infer from a settings-gear
routing task. The gear still correctly opens `/teams/{team_id}` for a Team Admin — they see the
read-only Team Settings summary (the existing `!canManage` branch), which is honest about what they
can actually do. Live-verified (Security/Safeguarding Gate): a genuine Team Admin's own `updateTeam`
call would be rejected by `teams_update_admin` RLS exactly like a Coach's is — confirmed with a real
tampering attempt against `teams` from an isolated single-team Coach account (0 rows matched).

## Why Parent/Guardian and Player rows are empty

Per the explicit instruction (§6/§7 of this pass's own brief): *"If we do not yet have meaningful
Parent-context settings, do NOT create fake configuration."* Nothing exists here to document because
nothing was built — the settings gear for `"parent"`/`"player"` context routes to Personal Settings
instead (see `docs/architecture/relationship-registry.md`'s Context Switcher section and
`lib/app-context/identity-display.ts`'s `resolveContextSettingsLink()`), which is real, already
belongs to the signed-in human, and is not mislabelled as parent- or player-specific. When a genuine
preferences surface is built (notification preferences, a player/guardian display-name choice,
team-specific parent preferences — all explicitly named as *future* candidates in the brief, not
built now), it gets its own row here and its own branch in `resolveContextSettingsLink()`.

## The one non-negotiable rule this map exists to enforce

**Settings never propagate upward.** A Personal Avatar change never touches `clubs`. A Team setting
change never touches `clubs`. A Club setting change never touches `club_directory` or any Site Admin
table. This is architecturally guaranteed today because each row above has exactly one real RLS
policy gating its own table — there is no shared "settings" table a lower-scope write could reach
into a higher scope through. Canonical *propagation* (many readers, one writer — Club Logo's 8+
consumers) is a completely different, and completely compatible, concept: it means many places
*read* the same source, never that two scopes *write* the same field.
