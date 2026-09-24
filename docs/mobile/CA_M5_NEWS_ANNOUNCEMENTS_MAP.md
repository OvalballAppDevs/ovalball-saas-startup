# CA-M5 — News & Announcements: forensic map

Read-only archaeology of Ovalball's publishing domain, taken 24 September 2026 against the
working tree and the live local database (`supabase_db_ovalball-saas-startup`, queried with
`psql -U postgres`). Nothing here is a design; every statement cites a file and line or a
live catalogue query. Where the code and a document disagree, both are recorded and the
disagreement is named.

**Snapshot in motion.** While this map was being written (12:26–12:37 on 24 September), CA-M5
implementation was landing in the same working tree: `supabase/migrations/20270547000000_where_a_person_may_publish.sql`
(12:26), `packages/contracts/src/club/content.ts` (12:35), nine new mobile routes under
`apps/mobile/app/(tabs)/{news,announcements,admin/news}/**` (12:32–12:34), new modules
`apps/mobile/src/content/*` and `apps/mobile/src/admin/content/*` (12:31–12:35), and the web's
`lib/club-content/actions.ts`, `lib/club-content/manage.ts` and `lib/club-public/articles.ts` re-pointed at the
shared contract. Sections 1–6, 8, 9, 11–14 and 16 describe the database and web domain as it stood before
and after that work (it did not change them). Sections 7.4, 10 and 15 record both the pre-CA-M5 state
(what the mobile build shipped with) and what is now on disk, clearly marked as **in flight and unverified**
— no build, test or browser check was run for this map. Line numbers for the modified files are as of the
version last read here and may already have moved.

Two things are called "announcement" on this platform, and a third nearly is:

| | What it is | Tables | Where it lives |
|---|---|---|---|
| **(A) Club content publishing** | The club's own news (`club_articles`) and short dated notices (`club_announcements`), published to the club's public home and read by whoever RLS admits. **This is what "News & Announcements" means in Club Settings, the Admin Centre IA, and the mobile Home.** | `club_articles`, `club_announcements` | `supabase/migrations/20270340000000_a_club_has_a_home.sql`, `lib/club-content/*`, `lib/club-public/*`, `packages/contracts/src/club/*` |
| **(B) Messenger broadcast announcements** | A message sent *as* a team, a club or Ovalball to a resolved, safeguarding-aware recipient list, with per-recipient deliveries, read marks, an optional reply mode and withdrawal. **This is the MESSAGING domain**; it appears in Messages as "Announcement". | `messenger_announcements`, `messenger_announcement_deliveries`, replies in `fixture_messages` | `supabase/migrations/2027024x…`, `lib/messenger/announcement.ts`, `app/(app)/messages/**announcement**` |
| (C) Fixture communication | `send_fixture_communication` — "Announce" in Match Centre on both clients (`apps/mobile/src/match-centre/announce.ts:1-40`). A notification fan-out scoped to one fixture. Not mapped here beyond noting the word collides. | `fixture_communications`… | Match Centre |

Section 14 sets (A) and (B) side by side. Everything else is (A) unless it says otherwise.

---

## 1. Tables — live schema

Both tables were created by `supabase/migrations/20270340000000_a_club_has_a_home.sql`
(`club_articles` at :160, `club_announcements` at :237). One column was added later:
`club_articles.fixture_id` by `20270522000000_a_match_is_something_a_team_did_together.sql:176-181`.

### 1.1 `public.club_articles` (23 columns, live `information_schema.columns`)

| column | type | default | null | notes |
|---|---|---|---|---|
| id | uuid | gen_random_uuid() | no | PK |
| club_id | uuid | | no | FK clubs ON DELETE CASCADE |
| team_id | uuid | | yes | FK teams ON DELETE CASCADE; **null = club-wide** |
| slug | text | | no | unique per club; shape-checked |
| title | text | | no | 3–140 chars (trimmed) |
| excerpt | text | | yes | ≤300 |
| body | text | `''` | no | ≤20 000; **Ovalball's own text markup, not HTML** (§5) |
| category | text | `'NEWS'` | no | NEWS · MATCH_REPORT · EVENT · UPDATE · CELEBRATION · WELCOME |
| status | text | `'DRAFT'` | no | DRAFT · PUBLISHED · ARCHIVED |
| visibility | text | `'PUBLIC'` | no | PUBLIC · MEMBERS |
| featured | boolean | false | no | the club's one lead story; only while PUBLISHED |
| hero_image_path | text | | yes | object path in bucket `club-news-media`; must start `{club_id}/` |
| hero_image_alt | text | | yes | required (1–250) whenever hero_image_path is set |
| system_key | text | | yes | only `'WELCOME_TO_OVALBALL'`; one per club |
| published_at | timestamptz | | yes | required when PUBLISHED |
| first_published_at | timestamptz | | yes | freezes the slug once set |
| archived_at | timestamptz | | yes | |
| created_by / updated_by / published_by | uuid | | yes | FK auth.users ON DELETE SET NULL; **not readable by browser roles** (§2.3) |
| created_at / updated_at | timestamptz | now() | no | `set_updated_at` trigger |
| fixture_id | uuid | | yes | FK fixtures ON DELETE SET NULL; "the match this article is about, for MATCH_REPORT articles" (live column comment) |

Check constraints (live `pg_constraint`):

- `club_articles_body_length` — `char_length(body) <= 20000`
- `club_articles_category_check` — the six categories above
- `club_articles_excerpt_length` — `excerpt IS NULL OR char_length(excerpt) <= 300`
- `club_articles_featured_is_published` — `NOT featured OR status = 'PUBLISHED'`
- `club_articles_hero_in_club_folder` — `hero_image_path IS NULL OR hero_image_path LIKE club_id || '/%'`
- `club_articles_hero_needs_alt` — path null, or trimmed alt length between 1 and 250
- `club_articles_published_has_time` — `status <> 'PUBLISHED' OR published_at IS NOT NULL`
- `club_articles_slug_shape` — `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80`
- `club_articles_status_check` — DRAFT / PUBLISHED / ARCHIVED
- `club_articles_system_key_check` — null or `'WELCOME_TO_OVALBALL'`
- `club_articles_title_length` — trimmed title 3..140
- `club_articles_visibility_check` — PUBLIC / MEMBERS
- unique `club_articles_club_id_slug_key (club_id, slug)`

Indexes: `club_articles_pkey`; `club_articles_club_id_slug_key`; `club_articles_club_feed (club_id, status, published_at desc)`; `club_articles_team_feed (team_id, status, published_at desc) WHERE team_id IS NOT NULL`; `club_articles_one_lead_story UNIQUE (club_id) WHERE featured`; `club_articles_one_system_article UNIQUE (club_id, system_key) WHERE system_key IS NOT NULL`; `club_articles_fixture_idx (fixture_id) WHERE fixture_id IS NOT NULL`.

Triggers: `club_articles_scope` BEFORE INSERT OR UPDATE → `internal.validate_club_content_scope()` (club_id may never change; team must belong to the club — migration :289-311); `set_updated_at` BEFORE UPDATE; `audit_row_change` AFTER INSERT/UPDATE/DELETE → `internal.audit_row_change()` which inserts into `public.audit_log`.

### 1.2 `public.club_announcements` (19 columns)

| column | type | default | null | notes |
|---|---|---|---|---|
| id | uuid | gen_random_uuid() | no | |
| club_id | uuid | | no | FK clubs CASCADE |
| team_id | uuid | | yes | FK teams CASCADE; null = club-wide |
| title | text | | no | 3–100 |
| body | text | | yes | ≤500, **plain text** |
| priority | text | `'NORMAL'` | no | NORMAL · IMPORTANT · URGENT |
| status | text | `'DRAFT'` | no | DRAFT · PUBLISHED · ARCHIVED |
| visibility | text | `'PUBLIC'` | no | PUBLIC · MEMBERS |
| starts_at | timestamptz | now() | no | window start (the scheduling mechanism, §4) |
| expires_at | timestamptz | | yes | window end; must be > starts_at |
| link_label | text | | yes | 1–40; label and url together or neither |
| link_url | text | | yes | `^https://\S+$` or a same-site path `^/(?!/)\S*$` |
| published_at | timestamptz | | yes | required when PUBLISHED |
| archived_at | timestamptz | | yes | |
| created_by / updated_by / published_by | uuid | | yes | not browser-readable |
| created_at / updated_at | timestamptz | now() | no | |

Checks: `_body_length`, `_link_label_length`, `_link_safe`, `_link_together ((link_label IS NULL) = (link_url IS NULL))`, `_priority_check`, `_published_has_time`, `_status_check`, `_title_length`, `_visibility_check`, `_window (expires_at IS NULL OR expires_at > starts_at)`.

Indexes: `club_announcements_pkey`; `club_announcements_club_live (club_id, status, starts_at desc)`.
Triggers: same three as articles (`club_announcements_scope`, `set_updated_at`, `audit_row_change`).

No `pinned` column exists on either table. "Featured" (articles) and "priority" (announcements) are the only prominence fields.

---

## 2. RLS — the audience model

RLS is enabled on both tables (`relrowsecurity = true`, not forced). There are **SELECT policies only**; no INSERT/UPDATE/DELETE policy exists for any role (asserted live and by `club_digital_home.sql` PASS D8 at :370). Every write is a SECURITY DEFINER function (§3).

### 2.1 Policies (live `pg_policies`, full text)

**`club_articles_public_read`** — SELECT, `{anon}`, PERMISSIVE
```
(status = 'PUBLISHED') AND (visibility = 'PUBLIC')
AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_articles.club_id AND c.status = 'active')
```

**`club_articles_signed_in_read`** — SELECT, `{authenticated}`, PERMISSIVE
```
(   (status = 'PUBLISHED')
AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_articles.club_id AND c.status = 'active')
AND ((visibility = 'PUBLIC') OR internal.may_view_club_member_content(club_id, team_id)) )
OR internal.may_edit_club_content(club_id, team_id)
```

**`club_announcements_public_read`** — SELECT, `{anon}`
```
(status = 'PUBLISHED') AND (visibility = 'PUBLIC') AND (starts_at <= now())
AND ((expires_at IS NULL) OR (expires_at > now()))
AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_announcements.club_id AND c.status = 'active')
```

**`club_announcements_signed_in_read`** — SELECT, `{authenticated}`
```
(   (status = 'PUBLISHED') AND (starts_at <= now()) AND ((expires_at IS NULL) OR (expires_at > now()))
AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_announcements.club_id AND c.status = 'active')
AND ((visibility = 'PUBLIC') OR internal.may_view_club_member_content(club_id, team_id)) )
OR internal.may_edit_club_content(club_id, team_id)
```

### 2.2 The two predicates the policies call (live `pg_get_functiondef`)

`internal.may_view_club_member_content(p_club_id, p_team_id)` — STABLE SECURITY DEFINER:
- false when `auth.uid()` is null or club is null;
- false when a team is given that is not in that club;
- otherwise `internal.can('club.profile.view','club',club,null,null)` **OR** (team given AND `internal.can('team.team.view','team',club,team,null)`).

`internal.may_edit_club_content(p_club_id, p_team_id)` — STABLE SECURITY DEFINER:
- false when club null or team not in club;
- true when `internal.can('club.news.manage','club',club,null,null)`;
- else `p_team_id IS NOT NULL AND internal.can('team.news.manage','team',club,team,null)`.

(These were rewritten from `internal.has_capability` to `internal.can` after 20270340; the migration text at :86-131 shows the original, the live body is the canonical one above.)

### 2.3 Who can read what — stated precisely

| Reader | PUBLISHED + PUBLIC | PUBLISHED + MEMBERS (club-wide, team_id null) | PUBLISHED + MEMBERS (team item) | DRAFT / ARCHIVED |
|---|---|---|---|---|
| Signed-out visitor (anon) | yes, if the club is `active` | no | no | no |
| Any signed-in person with no place at the club | yes (same as anon) | no | no | no |
| Club member holding `club.profile.view` at the club (bundles CA, CO, FS, MB, SO, TM, VO — live `bundle_capabilities`) | yes | **yes** | **yes** (club.profile.view is enough; the team test is an OR) | no, unless an editor |
| Guardian of a player on the team / adult player on the team (`team.team.view` at team scope via bundles PG, PL) | yes | **no** (needs club.profile.view) | **yes** for their own team's items | no |
| Editor in scope (`club.news.manage` at club, or `team.news.manage` on that team) | yes | yes | yes | **yes — every state, in their scope** |
| Club suspended (`clubs.status <> 'active'`) | nothing to anyone except editors (the editor branch is an OR outside the club-status test) | | | |

`supabase/tests/capability_adapters.sql:173-181` asserts the member and parent rows above
(member reads club-wide MEMBERS; parent reads their team's MEMBERS item but not the club-wide
one nor another team's). `club_digital_home.sql` PASS E1–E3, E4–E8 assert the visitor,
stranger, suspended-club and announcement-window rows.

Announcements add a **time window** to visibility: a PUBLISHED announcement is invisible to
non-editors before `starts_at` and after `expires_at`. Editors see it in every state.

### 2.4 Grants (live)

Table-level `relacl`: only `postgres` and `service_role`. Browser roles hold **column-level SELECT** only (`information_schema.column_privileges`), and the list omits `created_by`, `updated_by`, `published_by`:

- `club_articles` → anon, authenticated: `archived_at, body, category, club_id, created_at, excerpt, featured, first_published_at, hero_image_alt, hero_image_path, id, published_at, slug, status, system_key, team_id, title, updated_at, visibility`
- `club_announcements` → anon, authenticated: `archived_at, body, club_id, created_at, expires_at, id, link_label, link_url, priority, published_at, starts_at, status, team_id, title, updated_at, visibility`

Granted at `20270340…:334-344` and re-granted by the perimeter migration `20270342000000_database_api_perimeter.sql:133-134, 218-219`. Consequence: **a client must never `select("*")`** — the request fails on the hidden columns. Both shared readers select named columns.

One anon subtlety, recorded at `20270373000000_club_admin_authority_canonical.sql:65-76`: `club_articles_public_read` joins to `clubs`, whose policy calls `internal.club_ids_with(text)`, so that function is executable by anon precisely so a signed-out article read does not raise "permission denied for function".

---

## 3. Functions — rule by rule (live `pg_get_functiondef`)

All five public RPCs are `SECURITY DEFINER`, `search_path = public`, executable by `authenticated` only (`20270340…:736-745`; PASS D7). None emits a notification or an email; none writes a "security event". The only audit is the row-level `audit_row_change` trigger into `public.audit_log` (PASS D9). None of them takes a reason parameter.

### 3.1 `public.save_club_article(p_article_id, p_club_id, p_team_id, p_title, p_excerpt, p_body, p_category, p_visibility, p_hero_image_path, p_hero_image_alt) → TABLE(article_id uuid, article_slug text)`
All parameters default to NULL.
1. `auth.uid()` null → `42501` "Sign in to write club news."
2. **Create** (`p_article_id` null): `internal.may_edit_club_content(p_club_id, p_team_id)` else `42501` "You do not have permission to write news here." Inserts with `slug = internal.unique_club_article_slug(club, title, null)`, trimmed title, nullif-trimmed excerpt, `body = coalesce(p_body,'')`, `category = coalesce(p_category,'NEWS')`, `visibility = coalesce(p_visibility,'PUBLIC')`, hero path/alt trimmed-or-null, `created_by = updated_by = auth.uid()`. Status stays DRAFT (column default).
3. **Edit**: `SELECT … FOR UPDATE`; missing → `P0002` "That article no longer exists." `p_club_id` given and different → `23514` "Club content cannot move to another club."
4. Edit authority (any failing → `42501` "You do not have permission to edit this article."):
   - `may_edit_club_content(r.club_id, r.team_id)` (where it has been), AND
   - if `team_id` is changing, `may_edit_club_content(r.club_id, p_team_id)` (where it is going), AND
   - if `r.status = 'PUBLISHED'`, `may_publish_club_content(r.club_id, p_team_id)` (editing live copy is a publishing act).
5. Update sets team_id, title, excerpt, body, `category = coalesce(p_category, r.category)`, `visibility = coalesce(p_visibility, r.visibility)`, hero path/alt (**a null path clears the image**), `updated_by`. **Slug**: re-derived from the new title only while `first_published_at IS NULL` and the title changed; otherwise frozen.
6. Returns one row `(id, slug)`. Constraint violations surface as `23514` with the constraint name in the message (mapped by `CONSTRAINT_MESSAGES`, §3.9).

### 3.2 `public.set_club_article_status(p_article_id, p_status) → text`
1. Lock row; missing → `P0002`.
2. `may_publish_club_content(r.club_id, r.team_id)` else `42501` "You do not have permission to publish or archive this article."
3. `p_status` not in DRAFT/PUBLISHED/ARCHIVED → `22023` "That is not an article status."
4. Same status → returns it (idempotent, PASS B6).
5. → PUBLISHED: body trimmed-empty → `23514` "Write the article before publishing it." Sets `published_at = (from ARCHIVED ? coalesce(r.published_at, now()) : now())`, `first_published_at = coalesce(first_published_at, now())`, `archived_at = null`, `published_by = updated_by = auth.uid()`. (Restoring an archived article keeps its original date, PASS B11.)
6. → DRAFT: `published_at = null, archived_at = null, featured = false`.
7. → ARCHIVED: `archived_at = now(), featured = false`.
8. Returns `p_status`. There is no DELETE anywhere; archive is terminal-but-reversible.

### 3.3 `public.set_club_article_featured(p_article_id, p_featured) → boolean`
1. Lock; missing → `P0002`.
2. `may_publish_club_content(r.club_id, NULL)` — **club authority, even for a team article** — else `42501` "Only the club can choose its lead story."
3. `p_featured AND status <> 'PUBLISHED'` → `23514` "Publish the article before making it the lead story."
4. If featuring: un-features every other article at the club (one lead story, enforced also by the partial unique index).
5. Sets `featured`, `updated_by`. Returns `p_featured`.

### 3.4 `public.save_club_announcement(p_announcement_id, p_club_id, p_team_id, p_title, p_body, p_priority, p_visibility, p_starts_at, p_expires_at, p_link_label, p_link_url) → uuid`
1. `auth.uid()` null → `42501` "Sign in to write announcements."
2. Create: `may_edit_club_content(club, team)` else `42501` "You do not have permission to post announcements here." Inserts `priority = coalesce(p,'NORMAL')`, `visibility = coalesce(p,'PUBLIC')`, `starts_at = coalesce(p_starts_at, now())`, `expires_at = p_expires_at` (null allowed), label/url trimmed-or-null.
3. Edit: lock; `P0002` "That announcement no longer exists."; club change → `23514`; the same three-part authority test as articles → `42501` "You do not have permission to edit this announcement."
4. Update sets team_id, title, body, `priority = coalesce(p, r.priority)`, `visibility = coalesce(p, r.visibility)`, `starts_at = coalesce(p, r.starts_at)`, `expires_at = p_expires_at` (**null clears it**), label/url, `updated_by`.
5. Returns the id.

### 3.5 `public.set_club_announcement_status(p_announcement_id, p_status) → text`
1. Lock; `P0002`. 2. `may_publish_club_content(club, team)` else `42501` "You do not have permission to publish or archive this announcement." 3. Bad status → `22023` "That is not an announcement status." 4. Same status → no-op.
5. → PUBLISHED with `expires_at <= now()` → `23514` "That announcement has already expired. Change the end date first."
6. Sets `status`; `published_at = (PUBLISHED ? now() : DRAFT ? null : keep)`; `published_by` on publish; `archived_at = (ARCHIVED ? now() : null)`; `updated_by`.

### 3.6 `internal.may_publish_club_content(p_club_id, p_team_id) → boolean`
Body is one line: `return internal.may_edit_club_content(p_club_id, p_team_id);` with the comment "Deliberately separate, with today the same answer: publishing is where a future split would land." **There is no draft-only role today.**

### 3.7 `internal.may_manage_club_news_media(p_name text) → boolean` (STABLE, not definer)
Regex-matches the object name against `^{uuid}/(club|{uuid})/{uuid}\.(png|jpg|webp)$`; anything else (including `.svg`, `..`, a bare filename) is false. Then returns `may_edit_club_content(m[1]::uuid, m[2] = 'club' ? NULL : m[2]::uuid)`. So the **folder is the authority**: a team folder needs team (or club) news authority for that team; the `club` folder needs club authority. PASS G1–G2 (`club_digital_home.sql:577-590`).

### 3.8 `internal.ensure_club_welcome_article(p_club_id) → uuid` (SECURITY DEFINER; revoked from anon and authenticated — PASS F9)
1. Existing `system_key = 'WELCOME_TO_OVALBALL'` row → return its id (archived counts).
2. Club name from `club_directory` via `clubs.directory_id`, else "The club"; unknown club → null.
3. Author = the system user `rugby-hub-content-import@system.ovalball.internal` (the one canonical Ovalball identity from `20270301…`).
4. `featured := NOT EXISTS (featured article at club)` — never steals a lead story (PASS F10).
5. Slug `welcome-to-ovalball`, or a uniquified one if taken.
6. Inserts category WELCOME, status PUBLISHED, visibility PUBLIC, team null, published/first_published now, body in the markup of §5 linking only to `/rugby-hub`, `/calendar`, `/teams`, `/messages` (PASS F4). `ON CONFLICT (club_id, system_key) DO NOTHING`.
7. Called only by trigger `welcome_club_on_setup_completion` AFTER INSERT OR UPDATE OF status ON `club_setup_state` when it reaches COMPLETED (`20270340…:903-921`). Not backfilled to older clubs — a **locked owner decision** (memory `ovalball-club-home-locked-decisions`, and migration :143-146).

### 3.9 Slugs
`internal.club_article_slug_base(title)` (IMMUTABLE): lower-case, `&` → " and ", non-alphanumerics → `-`, trimmed, ≤60 chars, empty → `article`. `internal.unique_club_article_slug(club, title, exclude)` appends `-2`, `-3`… until unique within the club (PASS B5). Both revoked from anon; the web never calls them directly.

### 3.10 Error translation on the web
`lib/club-content/actions.ts:27-48` — `CONSTRAINT_MESSAGES` maps constraint names to sentences; `42501` → "You don't have permission to do that for this club or team."; `P0002` → "That item no longer exists. Refresh the page."; `23505` → "Something with that link already exists. Try saving again."; `23514`/`22023` pass the function's own sentence through. The same table is duplicated, byte-for-byte in intent, in `packages/contracts/src/club/content.ts:486-509` as `contentErrorMessage` (see §7.4 — that file is on disk but not yet exported).

---

## 4. Lifecycle, time and prominence

- **Status values**: `DRAFT → PUBLISHED → ARCHIVED`, all transitions allowed in any direction by `set_club_*_status`; there is no SCHEDULED or DELETED state and no delete path (PASS D3).
- **Articles**: `published_at` is "news today" on publish, kept on restore from ARCHIVED; `first_published_at` is set once and freezes the slug. `archived_at` set on archive, cleared otherwise. `featured` only on a PUBLISHED article; unpublishing or archiving clears it; one per club (partial unique index). Web wording: "Lead Story" (`components/club-content/content-manager.tsx` badge; editor "Now the lead story.").
- **Announcements**: `starts_at` / `expires_at` are the schedule. **Scheduling is a query-time predicate, not a job**: the RLS policies compare against `now()` and the readers filter `starts_at <= now` and `expires_at is null or > now` (`packages/contracts/src/club/home-content.ts:76-84`, `content.ts:197`). No `cron.job` touches either table (live `cron.job`: season transitions, dispensations, overdue fixtures, trials, invitations, attendance invitations, results, geocoding only). "Live" on the management list is computed the same way client-side (`lib/club-content/manage.ts:105-106`). An announcement can be published with a future `starts_at` — it is then invisible to non-editors until then (PASS E6) and silently disappears after `expires_at` (PASS E7); the editor still sees it (PASS E8).
- **Priority** (announcements): NORMAL / IMPORTANT / URGENT, shown as words "Notice" / "Important" / "Urgent" (`packages/contracts/src/club/vocabulary.ts:38-46`). Readers sort URGENT first, then IMPORTANT, then by `starts_at` desc. The web club desk pins URGENT notices above the viewer's own work (`lib/club-public/desk.ts:13-18`).
- **Authorship**: `created_by / updated_by / published_by` are written by the functions and are **never readable by a browser role** (§2.4). The byline is derived: `system_key` → "Ovalball"; else the team's `display_name`; else the club's name (`content.ts:140`, `home-content.ts:152`). Never a person (PASS D5).
- **Categories** (articles): NEWS "News", MATCH_REPORT "Match Report", EVENT "Event", UPDATE "Club Update", CELEBRATION "Celebration"; WELCOME "Welcome" exists but is not offered in the editor picker (`vocabulary.ts:14-25`).
- **MATCH_REPORT ↔ fixture**: `fixture_id` is read by Match Centre (`lib/app-context/match-community.ts:110-118`: the latest PUBLISHED MATCH_REPORT for the fixture, under the article's own RLS). Nothing in `save_club_article` sets `fixture_id`; the 20270522 migration added it and Step 11 wrote it through its own path. **The web article editor has no fixture field** (not in `EditableArticle`, `ArticleInput`, or `save_club_article`'s parameters).

---

## 5. Body format and rendering

**The body is neither HTML nor Markdown-by-library.** It is a deliberately small, hand-parsed text markup defined once in `packages/contracts/src/club/markup.ts` (re-exported unchanged by `lib/club-content/markup.ts:12`):

- `## Heading`, `### Smaller heading`; `**bold**`; `*italic*` / `_italic_`; `[text](href)`; `- ` / `* ` / `• ` bullets; `1. ` / `1) ` numbered; blank line = new paragraph; single newline kept as `<br>` (`markup.ts:11-21, 100-102`).
- `parseArticleBody(body): Block[]` returns a data tree (`heading | paragraph | list` of `text | strong | em | link | break`), no HTML string anywhere (`markup.ts:23-33, 105-156`).
- **Link safety is in the parser**: `safeHref` admits only `https?://`, `mailto:` and same-site `/path` (not `//`); anything else renders as its text with no link (`markup.ts:36-42, 64-73`; JS test "a hostile link keeps its words and loses its address", `supabase/tests/js/club_digital_home.test.mts:65`). "markup-looking HTML is just text" (:71).
- `articlePlainText`, `summarise(text, 180)` and `readingMinutes` (220 wpm, min 1) derive the excerpt fallback and reading time (`markup.ts:165-186`).

**Web renderer** — `components/club-home/article-body.tsx:56-89` (`ArticleBody`) maps the tree to React: `h2`/`h3`, `p`, `ul`/`ol`, `strong`, `em`, `br`, and links as `<a target="_blank" rel="noopener noreferrer">` (external, with an sr-only "(opens in a new tab)") or `next/link` (internal). The public article page and the editor preview both render through it (`article-body.tsx:9-16`). A repo-wide grep finds **no** `dangerouslySetInnerHTML` on article content (the only hit in the product is a QR SVG in `components/invitations/invitation-share.tsx:117`), no DOMPurify, remark, marked, react-markdown, tiptap, lexical or contenteditable, and no such dependency in `package.json`, `apps/mobile/package.json` or `packages/contracts/package.json`. `scripts/verify-club-digital-home.mjs:71` fails the build if `parseArticleBody(` is called anywhere other than `markup.ts` and `article-body.tsx`.

**Web editor** — `components/club-content/article-editor.tsx`: a plain `<textarea id="article-body">` (:343) with a `role="toolbar"` (:329) whose six tools (Heading, Bold, Italic, Link, Bulleted List, Numbered List — :82-90) insert the markup above into the text; a Write/Preview tab (:80) where Preview renders `ArticleView`; `canPublish` requires title ≥3, non-empty body, and alt text if a hero is set (:268). Buttons: Publish / Publish Changes / Save Draft / lead-story toggle / Unpublish / Archive (with a confirm step) (:460-513). Announcements: `components/club-content/announcement-editor.tsx` — title `maxLength=100` (:155), body `<textarea maxLength=500 rows=3>` (:159), priority, two `datetime-local` inputs converted to/from ISO in the browser's zone (:42-57, :178-183), visibility, Link Label / Link Address (:216-221), Publish / Save Draft / Publish Changes (:233-244).

**Announcement bodies are plain text**: no markup parse is applied anywhere (web `AnnouncementItem`, `components/club-home/home-sections.tsx:45-60`, renders `a.body` as text; mobile `AnnouncementPreview` renders `notice.body` in a `<Text numberOfLines={2}>`, `apps/mobile/src/components/home/sections.tsx:55-57`).

**Mobile today has no article renderer**: an article tap opens the web page (§15).

---

## 6. Media

- **Bucket** `club-news-media`: live `storage.buckets` → `public = true`, `file_size_limit = 5242880`, `allowed_mime_types = {image/png, image/jpeg, image/webp}`. Created at `20270340…:757-762` with the note "No SVG: an SVG is a document that can carry script, and a public bucket would serve it from our origin." PASS G3 asserts the bucket row.
- **Path convention**: `{club_id}/{team_id | "club"}/{uuid}.{png|jpg|webp}` — enforced by the regex in `internal.may_manage_club_news_media` (§3.7), by `club_articles_hero_in_club_folder`, and produced by `lib/club-content/actions.ts:157` and `packages/contracts/src/club/content.ts:36-38` (`articleImagePath`). The extension comes from the verified MIME type, never the filename (`actions.ts:24-25, 153`; `content.ts:41-42`).
- **Storage policies** (live `pg_policies` on `storage.objects`, all `to authenticated`): `club_news_media_insert` WITH CHECK, `club_news_media_select` USING, `club_news_media_update` USING+WITH CHECK, `club_news_media_delete` USING — each `bucket_id = 'club-news-media' AND internal.may_manage_club_news_media(name)`. Because the bucket is public, **reads need no policy** (public object URL); the SELECT policy only governs listing/metadata for editors.
- **Upload on the web** — `uploadArticleImage(formData)` server action (`actions.ts:143-164`): validates uuid ids, type, ≤5 MB; uploads with `upsert: false`; returns `{path, url}` where `url = storage.from("club-news-media").getPublicUrl(path)`. `discardArticleImage` (:167-174) removes an uploaded object not referenced by any article; `saveArticle` removes the previous hero when replaced (:109-112).
- **Resolver on the web**: `articleImageUrl(supabase, path)` = `getPublicUrl` (`lib/club-public/articles.ts:71-73`). **On mobile**: the shared `home-content.ts:156` uses the identical `getPublicUrl` ("a PUBLIC bucket — the same public URL the website renders, so an image needs no signing and no second policy"). No `createSignedUrl` anywhere in this domain.
- **Bucket reuse**: `teams.cover_image_path` (live column) also resolves in `club-news-media` (`lib/teams/team-cover.ts:28-43`; Step 10 archaeology F6, `docs/product/CONVERGENCE_STEP_10_ARCHAEOLOGY.md:116-121`). No upload path for team covers exists in `app/` or `lib/` today (grep for `cover_image_path` finds only the resolver).
- Alt text is mandatory for a hero (`hero_needs_alt`; editor `canPublish`). Mobile's `ClubNewsCard` (§15) does **not** carry `heroAlt`; the CA-M5 `ArticleCard` in `content.ts:63` does.
- Mobile fallback imagery when an article has no hero: four app-owned editorial photographs chosen by category label (`sections.tsx:88-138`; provenance in `docs/mobile/PARENT_HOME.md:261-266`).

---

## 7. Audience, targeting and read models

### 7.1 Targeting columns
Exactly one targeting dimension on each table: `team_id` (a team at the club) or null (club-wide), plus `visibility` (PUBLIC / MEMBERS). There is no per-person, per-age-grade, per-role or multi-team audience, no `audience_spec`, no recipient list. Every reader of a club sees the whole club's feed; team news is presentation-filtered (`scope: "club" | "teams" | teamId` in `lib/club-public/articles.ts:106-127`; `or(team_id.is.null,team_id.eq.X)` in `content.ts:185, 198`), never authority-filtered — the rows were already the caller's to read.

### 7.2 How a reader query decides
Purely RLS (§2) plus an explicit `status = 'PUBLISHED'` in every reader ("an editor opening their own home screen must see what everybody else sees", `home-content.ts:25-32`). No view, no feed RPC, no server-derived "my feed" exists for (A). The readers are table selects with named columns:

| Reader | File:line | Filters |
|---|---|---|
| `listLiveClubNotices(supabase, clubId, limit=6)` → `ClubNotice[]` | `packages/contracts/src/club/home-content.ts:74-102` (exported from `@ovalball/contracts`) | club, PUBLISHED, `starts_at <= now`, `expires_at null or > now`, order starts_at desc, then sorted by priority rank |
| `listClubNews(supabase, clubId, clubName, limit=4)` → `ClubNewsCard[]` | `home-content.ts:114-136` | featured PUBLISHED first (separate query), then latest PUBLISHED, de-duplicated, sliced |
| `listPublishedArticles(supabase, club, {limit, offset, scope, teamId})` → `{articles, total}` | `lib/club-public/articles.ts:106-127` (web only, `server-only`) | club, PUBLISHED, optional team scope, `count: exact` |
| `getLeadArticle`, `getPublishedArticle(club, slug)`, `relatedArticles` | `articles.ts:130-173` | PUBLISHED; slug lookup within club |
| `loadClubHome(supabase, club, todayIso)` → `ClubHome` | `lib/club-public/load-club-home.ts:66-300` | one-pass aggregation for the public page: lead, latest (club-wide, 7), teamNews (12), announcements (6), fixtures, results, teams, contacts, `viewer.canManageNews` via `hasCapability("club.news.manage")` |
| `loadClubDesk` (signed-in dashboard) | `lib/club-public/club-desk.ts:37-47` | notices (6), lead + latest (5) → 4; `manageHref` by `deskManageHref` (`desk.ts:32-36`) |
| Mobile Home: `loadHomeSummary` | `apps/mobile/src/context/home-data.ts:185-190` | `listLiveClubNotices(club, 4)` and `listClubNews(club, name, 3)`, each `.catch(() => [])` |

`ClubNotice` fields: `id, title, body, priority, priorityLabel, teamName, expiresAt, link{label,href,external}, membersOnly` (`home-content.ts:43-54`). `ClubNewsCard`: `id, slug, title, excerpt, categoryLabel, publishedAt, byline, teamName, heroUrl, membersOnly, readingMinutes` (:56-69) — **no `clubId`, no `heroAlt`, no `category` key, no `body`**.

### 7.3 Where a person may publish — `public.club_publishing_scopes(p_club_id) → TABLE(scope_type text, team_id uuid, team_display_name text)`
Live and on disk: `supabase/migrations/20270547000000_where_a_person_may_publish.sql` (the newest migration in the tree; header says "CA-M5 — WHERE A PERSON MAY PUBLISH"). STABLE SECURITY DEFINER, `search_path = ''`; executable by `authenticated` and `service_role` only (live `routine_privileges`); the migration self-checks that anon cannot execute it and that its body mentions `may_edit_club_content` (:42-50). Rules: signed-out → `42501` "You must be signed in."; null club → `22023`; returns a `('club', null, null)` row when `may_publish_club_content(club, null)`, plus one `('team', id, display_name)` row for each active, unfolded, unarchived team where `may_edit_club_content(club, team)`. Ordered by scope_type then name. **Note the asymmetry**: the club row asks the *publish* twin, the team rows ask the *edit* twin (today identical, §3.6).

### 7.4 The shared CA-M5 contract that already exists on disk — `packages/contracts/src/club/content.ts` (509 lines)
Header: "NEWS & ANNOUNCEMENTS — THE SHARED CONTRACT (CA-M5)". It holds `articleImageUrl`, `articleImagePath`, `MAX_IMAGE_BYTES`, `IMAGE_EXTENSION`; reader types `ArticleCard` (with `clubId`, `heroAlt`, `category`), `Article`, `AnnouncementCard` (with `clubId`, `teamId`, `startsAt`, `publishedAt`); paged readers `listPublishedArticles`, `listLiveAnnouncements` (both accept `teamId` = team-or-club-wide), `readPublishedArticle(id)`, `readPublishedArticleBySlug(clubSlug, articleSlug)`, `readLiveAnnouncement(id)`; `readPublishingScopes` → RPC `club_publishing_scopes`; `listManagedContent`, `loadEditableArticle`, `loadEditableAnnouncement` (copies of `lib/club-content/manage.ts:63-167`); operations `saveArticle`, `setArticleStatus`, `setArticleFeatured`, `saveAnnouncement`, `setAnnouncementStatus` (throwing wrappers over the five RPCs); `contentErrorMessage` (copy of §3.10).

**How it is wired (as of 12:37)**: it is **not** re-exported from the package index — `packages/contracts/src/index.ts:47-51` exports `club/home-content`, `club/accent`, `club/theme`, `club/vocabulary` only (unchanged since 23 Sep) — so consumers reach it by **deep import** `@ovalball/contracts/club/content`, which side-steps the name collision with `home-content.ts` (`ArticleCard`, `listPublishedArticles`, `listLiveAnnouncements` would otherwise clash). Importers now on disk:
- web: `lib/club-content/actions.ts:9-16` (`contentErrorMessage`, `saveArticle`/`saveAnnouncement`/`setArticleStatus`/`setArticleFeatured`/`setAnnouncementStatus` aliased `…Op`), `lib/club-content/manage.ts:22-24`, `lib/club-public/articles.ts:71-73` (`articleImageUrl` re-exported);
- mobile: `apps/mobile/app/(tabs)/news/index.tsx:5`, `news/[articleId].tsx:4`, `announcements/[announcementId].tsx:4`, `admin/news/index.tsx:4`, `admin/news/article/[articleId].tsx:6-13`, `admin/news/announcement/[announcementId].tsx:6-12`, `apps/mobile/src/admin/content/pieces.tsx:2`, `upload.ts:3`.
A late addition (12:35) is `isArticleImageInUse(supabase, path)` (`content.ts:516-519`), the orphan check both editors run before discarding an upload. Mobile Home (`home-data.ts:6-7, 187-188`) still reads through `home-content.ts` (`listLiveClubNotices`, `listClubNews`), so **two reader families are live at once**: `ClubNotice`/`ClubNewsCard` on Home, `AnnouncementCard`/`ArticleCard` on the new list and detail screens. Whether the migration and these files are committed was not checked (git commands were out of scope for this map); the session-start `git status` showed only the two protected logo PNGs untracked, and the mtimes show the work post-dates that snapshot.

---

## 8. Read / unread state — **No** (domain A)

No table, column, RPC or client state records whether a person has read a club article or announcement. Evidence: live `information_schema.columns` shows no column named `%article%` or `%club_announcement%` on any table other than the two content tables (the only hits are `message_policies.allow_club_announcements*`, which belong to domain B's policy flags); no `read_at`/`seen_at`/`unread` in `lib/club-public`, `lib/club-content`, `packages/contracts/src/club`, `components/club-home`, `components/club-content`, or the mobile Home files. The mobile `AnnouncementPreview` shows the first notice with no read marker (`sections.tsx:34-40`).

(Domain B has it: `messenger_announcement_deliveries.read_at` and `mark_announcement_read`, §14.)

---

## 9. Notifications and email — **None** (domain A)

- No function in `public` or `internal` that inserts into `public.notifications` mentions `club_articles` or `club_announcements` (live `pg_proc` search; the only announcement-related notifier is `send_announcement` / `mark_announcement_read` for domain B).
- Live `public.notification_types` has no news/article type; the only announcement type is `announcement_received | messages` (domain B, registered at `20270245000000_sending_is_a_fan_out_not_a_broadcast.sql:39-41`).
- `packages/contracts/src/notifications/destinations.ts` (re-exported by `lib/notifications/destinations.ts:11`) has no case for news or club announcements; its only announcement case is `announcement_received → /messages/announcement/{id}` (:64-66).
- No email path references the two tables.
- `packages/contracts/src/club/home-content.ts:34-38` states the intent: "It is not a second notification system. A notice is something a person reads when they come and look; an ANNOUNCEMENT delivered through the safeguarding-aware recipient model is something that reaches a guardian who never opens the app."
- The only side effects of publishing are: the `audit_log` row (trigger), and on the web, `revalidatePath` of `/club/{slug}`, `/club/settings/news` and `/teams/{teamId}/news` (`actions.ts:58-63`).
- Mobile has no `apps/mobile/src/notifications` directory; the notifications tab (`apps/mobile/app/(tabs)/notifications.tsx:11-12, 92-93`) turns a notification's `href` into a route through `resolveIntent` / `routeForIntent` (`apps/mobile/src/links/intents.ts`), which sends any `/messages/announcement/...` link to the inbox (`intents.ts:155-158`).

---

## 10. Identity and deep links

- **Articles** are identified publicly by `(club slug, article slug)`; the id is internal. `articlePath(clubSlug, articleSlug) = /club/{clubSlug}/news/{articleSlug}` and `clubHomePath = /club/{clubSlug}` (`vocabulary.ts:48-55`). The slug follows the title until first publication and is then frozen (PASS B7), so a shared link survives a headline correction. `content.ts:217-225` resolves the same pair for a client.
- **Announcements have no public URL of their own** — they appear inline on `/club/{slug}` (`AnnouncementBoard`, `home-sections.tsx:25-39`) and on the signed-in club desk; the editor URL is by id. `readLiveAnnouncement(id)` in `content.ts:228-233` is the only by-id reader and is unused.
- **Web routes (public)**: `app/club/[slug]/page.tsx` (home), `app/club/[slug]/news/page.tsx` (paginated "News" index, `metadata.title = "News | {club}"`), `app/club/[slug]/news/[articleSlug]/page.tsx` (article, OpenGraph/Twitter metadata from title/excerpt/hero, `notFound()` when not published or not readable).
- **Web routes (console)**: `app/(app)/club/settings/news/page.tsx` ("News & Announcements", `resolveClubNewsConsole`), `…/news/new`, `…/news/[articleId]`, `…/news/announcements/new`, `…/news/announcements/[announcementId]` (all `robots: noindex`); team twin under `app/(app)/teams/[teamId]/news/**` ("Team News", `resolveTeamNewsConsole`). The console resolver redirects when the person lacks the capability (`lib/club-content/console.ts:55-56, 91-92`) and, for a team, when the active context is another club (:84-89).
- **Navigation**: Club Settings tab strip label "News & Announcements" (`app/(app)/club/settings/club-settings-nav.tsx:9`, `requires: "news"`); Club Settings hub tile (`app/(app)/club/settings/page.tsx:108`); Admin Centre IA row `{ key: "news", label: "News & Announcements", caption: "What the club publishes to its members and the public", capability: "club.news.manage", native: true, webPath: "/club/settings/news" }` (`packages/contracts/src/club/admin-centre.ts:36`) — **`native: true` is already set although no native screen exists** (§15).
- **Mobile routes — before CA-M5**: none. The shipped build's `apps/mobile/app/(tabs)/**` had no `news`, `articles` or `announcements` segment, and `admin/**` covered branding, club-profile, people, permissions, teams and venues only.
- **Mobile routes — on disk now (in flight, 12:32–12:34, unverified)**: `apps/mobile/app/(tabs)/news/_layout.tsx`, `news/index.tsx` (196 lines; reads `listLiveAnnouncements` + `listPublishedArticles` with `{teamId, limit, offset}` paging and `readPublishingScopes`; a `tab` param of `announcements` | `news`), `news/[articleId].tsx` (96 lines; `readPublishedArticle(id)` or `readPublishedArticleBySlug(clubSlug, articleSlug)` so a web link resolves; renders `apps/mobile/src/content/article-body.tsx`, which parses `@ovalball/contracts/club/markup`'s `parseArticleBody` — the same tree the web renders), `announcements/_layout.tsx`, `announcements/[announcementId].tsx` (91 lines; `readLiveAnnouncement(id)`), and under Admin Centre `admin/news/_layout.tsx`, `admin/news/index.tsx` (215 lines; `readPublishingScopes` then `listManagedContent` per scope), `admin/news/article/[articleId].tsx` (378 lines; `loadEditableArticle`, `saveArticle`, `setArticleStatus`, `setArticleFeatured`, image upload/discard via `apps/mobile/src/admin/content/upload.ts`, a `ReasonSheet`), `admin/news/announcement/[announcementId].tsx` (294 lines; `loadEditableAnnouncement`, `saveAnnouncement`, `setAnnouncementStatus`, date/time fields). Supporting modules: `apps/mobile/src/content/{article-body,cards,links,reading-screen}` and `apps/mobile/src/admin/content/{pieces,preview,upload}`.
- **Mobile deep links — on disk now (in flight)**: `apps/mobile/src/links/intents.ts:75-84, 190+` adds intent kinds `NEWS` (`/news`), `CLUB_ARTICLE` (`/news/<id>`), `CLUB_ARTICLE_BY_SLUG` (the website's `/club/<clubSlug>/news/<articleSlug>`), `CLUB_ANNOUNCEMENT` (`/announcements/<id>`); `apps/mobile/src/links/destinations.ts:112-121` routes them to the new screens, the slug form arriving at `/news/[articleId]` with `articleId: "slug"` plus `clubSlug`/`articleSlug` params. So a link shared from the web resolves natively; a native announcement link still has no web counterpart (announcements have no web permalink).

---

## 11. Capability catalogue (live rows)

### `club.news.manage`
```
label: Manage Club News
description: Write, publish and archive the club's news and announcements, including news for every team at the club.
category: club · domain: club · resource: news · action: manage
valid_scopes: {club} · applicable_scopes: {club} · inherits_to_team: false
grant_level: C · revoke_level: C · delegable: true · aal: A2
safeguarding_sensitive: false · minor_prohibited: true · impersonation_blocked: false
site_master_equivalent: null · server_enforcement: rC · db_enforcement: internal.may_edit_club_content
legacy_key: club.news.manage · migration_action: KEEP · status: ACTIVE · design_section: Club · site_addon_allowed: false
```

### `team.news.manage`
```
label: Manage Team News
description: Write, publish and archive news and announcements for one team.
category: team · domain: team · resource: news · action: manage
valid_scopes: {team} · applicable_scopes: {team} · inherits_to_team: true
grant_level: T · revoke_level: T · delegable: true · aal: A2
safeguarding_sensitive: false · minor_prohibited: true · impersonation_blocked: false
site_master_equivalent: null · server_enforcement: rC · db_enforcement: internal.may_edit_club_content
legacy_key: team.news.manage · migration_action: KEEP · status: ACTIVE · design_section: Club · site_addon_allowed: false
```

### Bundles (live `bundle_capabilities`) and roles (`role_definitions`)
| capability | bundle | scope_type | role (label, scope) |
|---|---|---|---|
| club.news.manage | CA | club | CLUB_ADMIN (Club Admin, CLUB, primary seat) |
| team.news.manage | CA | club | CLUB_ADMIN |
| team.news.manage | CO | team | COACH (Coach, TEAM) |
| team.news.manage | TM | team | TEAM_MANAGER (Team Manager, TEAM) |

`role_capability_defaults` (the older table, still present) lists club/CLUB_ADMIN → club.news.manage; team/CLUB_ADMIN, team/TEAM_MANAGER, team/TEAM_STAFF → team.news.manage (`20270340…:74-79`). The bundle table is the one `internal.can` resolves through.

### Team-scoped publishing is capability-based, not role-based
`internal.may_edit_club_content` asks only `internal.can('club.news.manage','club',…)` and `internal.can('team.news.manage','team',…)`; there is no role-name test anywhere in the domain (`scripts/verify-club-digital-home.mjs:82` fails the build on `role ===`, `"CLUB_ADMIN"`, `"TEAM_MANAGER"`, `roleLabel` or `isClubAdminAnywhere` inside the feature directories). A coach or team manager publishes **team** news through `team.news.manage` at team scope; a Club Admin publishes anywhere at the club through `club.news.manage` (and, in the CA bundle, `team.news.manage` at club scope with `inherits_to_team = true`). A team-scoped holder **cannot** post a club-wide item (`p_team_id` null falls to the club key — PASS A2, C2, E11) and cannot choose the lead story (PASS C6).

`delegable = true` in the live row. `internal.club_delegable_capability(key)` (live) returns true for any ACTIVE, delegable, grant_level C/T, non-safeguarding key — so **a Club Admin can delegate `club.news.manage` today**. `docs/CLUB_DIGITAL_HOME.md:53-55` still says it is "deliberately not in `internal.club_delegable_capability` … a club cannot delegate news publishing"; that sentence predates the permissions programme and is **stale**.

`team.news.manage` is also borrowed as the authority for team award settings in Step 11 (`20270522…:726-733`, "the granted capability that already describes the same people") — a consumer to remember if the key is ever re-scoped.

Other content keys in the catalogue: `hub.content.view_published`, `site.hub_content.manage` / `site.hub_content.view` (DEPRECATED → `site.hub.*`) — Rugby Hub, not club news. Messaging keys are in §14.

### Web-side capability checks (presentation only)
`lib/club-content/manage.ts:32-37` `mayManageContent` → `hasCapability(supabase, "club.news.manage", "club", {clubId})` then `"team.news.manage", "team", {clubId, teamId}`; `hasCapability` (`lib/permissions/has-capability.ts:50-62`) calls RPC `my_capabilities`. The comment at `manage.ts:20-24` is explicit that this only decides which buttons to draw.

---

## 12. Tests covering domain A

| File | What it asserts |
|---|---|
| `supabase/tests/club_digital_home.sql` (≈600 lines, 60 PASS points A1–G3) | A1–A5 authority adapters per role and club; B1–B12 article lifecycle (draft slug, draft invisibility, publish/restore dates, slug frozen after publication, length checks); C1–C11 team scope, moving between teams, lead story is club-only, cross-club isolation; D1–D9 no direct INSERT/UPDATE/DELETE even as Club Admin, hidden author columns, anon cannot mutate or execute, read-only policies, audit rows; E1–E12 members-only, suspended club, announcement draft/window/expiry, link safety, coach cannot post club-wide; F1–F10 Welcome article creation, idempotency, archive-not-recreated, editability, no direct call, lead story not stolen; G1–G3 `may_manage_club_news_media` folder authority, path/extension rejection, bucket row |
| `supabase/tests/capability_adapters.sql:3-4, 161-194` | Club Home content boundary through `internal.can`: CA / TM / CO / member / parent / full-site-admin answers for edit, publish and member-view, including the parent-sees-own-team-only rule |
| `supabase/tests/capability_catalogue_integrity.sql:149, 161, 171` | both news keys present and ACTIVE; listed in the expected catalogue set |
| `supabase/tests/bundle_legacy_parity.sql:268` | CA bundle holds `team.news.manage` at club scope with `inherits_to_team` |
| `supabase/tests/identity_foundation_and_perimeter.sql:493-561` | perimeter: seeded article/announcement rows read as expected; anon cannot insert |
| `supabase/tests/cross_club_isolation_matrix.sql:225, 233` and `family_isolation_matrix.sql:226, 232` | both tables classified in the isolation matrices (4f / 4h) |
| `supabase/tests/public_team_season_identity.sql:251` | the transitive anon path through `club_articles_public_read → clubs_select` |
| `supabase/tests/step11_match_community.sql:489-500` | a MATCH_REPORT article with `fixture_id`, and its detachment |
| `supabase/tests/js/club_digital_home.test.mts:34-98, 219-231` | markup covers the toolbar; single line breaks; only https/http/mailto/same-site links; hostile link keeps words, loses address; HTML is just text; plain text, summaries, reading time; labels and public paths; desk pins urgent notices once; Manage News routing by authority |
| `supabase/tests/js/team_cover.test.mts:20-49` | team cover URLs resolve in `club-news-media` |
| `scripts/browser-verification/40-club-digital-home.mjs` (90 `record()`s) | self-seeding browser acceptance: visitor cannot see drafts / members-only / expired items, urgent shows as a word, team news carries its team, Welcome article on the page, Club Admin console lists everything in scope, tab strip has "News & Announcements", cleanup |
| `scripts/browser-verification/75-first-club-setup-journey.mjs` | S6S-43: completing setup twice creates no duplicate welcome article |
| `scripts/browser-verification/67-club-desk-hierarchy.mjs` | signed-in desk (notices/news rail) hierarchy |
| `scripts/verify-club-digital-home.mjs` | structural: one `resolveClubTheme`, one `parseArticleBody` call site, no role-name checks, no direct `from("club_articles").insert/update/delete` in feature dirs, migration present |
| `docs/mobile/PARENT_HOME.md` evidence | Home rendered against the seed (one notice, no news at the time) |

**Added by the in-flight CA-M5 work (on disk at 12:32, not run for this map):**
- `supabase/tests/club_news_announcements_ca5.sql` (283 lines) — header groups NA-A (publishing-scopes read model vs the writes), NA-B (cross-scope refusal: team publisher cannot reach another team, the whole club or another club), NA-C (drafts never leak; window decides liveness; archive lifecycle), NA-D (reader isolation: member, guardian of a team's player, unrelated person, another club's admin, opposition relationship, anonymous), NA-E (lead story is the club's decision). Registered in `supabase/tests/suite-registry.json:1738-1742` as `CANONICAL_GATE`, owner "Club administration", reason also naming "stale authority, audit, and the absence of notifications".
- `supabase/security/perimeter-manifest.json:4570, 8578` — `club_publishing_scopes(uuid)` admitted to the reviewed inventory.
- `supabase/tests/js/mobile_admin_centre.test.mts:362-389+` — structural: both clients read through the shared contract and never `from("club_articles")` / `rpc("save_club_…")` directly (the web `actions.ts` included); the audience picker is built from the server's scopes; the renderer is the shared markup tree.
Nothing yet exercises the mobile Home readers (`listClubNews` / `listLiveClubNotices`); `supabase/tests/js/parent_home*.test.mts` cover the agenda projection only.

---

## 13. Governing-body or Site Admin publishing — **No**

- No table, RPC or capability lets a governing body or Site Admin publish news or announcements into club feeds. Live capability keys under `site.*` / `governing*` that touch content are `site.email.manage`, `site.email.deliveries.view`, and the deprecated `site.hub_content.*` (Rugby Hub). No `site_announcements` / `platform_announcements` table exists (live `information_schema.tables` search for `%announce%|%article%|%news%|%notice%` returns only the four tables named in this map plus `safeguarding_thread_reviews`).
- The `ensure_club_welcome_article` system article is Ovalball-authored, but it is a one-off trigger, not a publishing surface.
- Domain B *does* have a platform sender: `messenger_announcements.sender_identity_type = 'platform'`, gated by `site.email.manage` (`internal.may_send_as`, "Ovalball speaks for Ovalball"), and a club policy flag `allow_platform_announcements` (`20270243…:18-30`). That is a broadcast message, not a published article.
- Site Admin's `site.support.act_in_club` reaches domain B's audiences (`can_address_club_audience`), not domain A's editor predicate — a Full Site Admin cannot edit a club's news through `may_edit_club_content` (`capability_adapters.sql:191-192` asserts `v_full` is refused).

---

## 14. Domain (B) — Messenger broadcast announcements (the MESSAGING domain)

**Model** (live schema): `messenger_announcements(id, actor_user_id, sender_identity_type ∈ {platform, team, club} with matching sender_identity_id, scope ∈ {platform | team | club | selected}, scope_id, audience_spec jsonb, exclude_u18, reply_mode ∈ {NO_REPLY, PRIVATE_REPLY, GROUP_DISCUSSION — group only for team/selected}, title (nullable), body (non-blank), status ∈ {draft, sending, sent, withdrawn}, fanout_state ∈ {pending, in_progress, complete, failed}, resolved_recipient_count, sent_at, withdrawn_at/by)`. `messenger_announcement_deliveries(id, announcement_id, recipient_user_id, status, delivered_at, read_at, safeguarding_route, concerning_player_id, idempotency_key unique, attempts, error_message)`. Replies are `fixture_messages` rows with `announcement_id`.

**Flow** (live function bodies):
- `create_announcement(sender type/id, scope, scope_id, body, title, reply_mode, audience_spec, exclude_u18) → uuid` — requires `internal.may_send_as`; dry-runs `internal.resolve_audience` so a draft that can never be sent is refused at compose time; inserts `status='draft'`.
- `send_announcement(id) → integer` — sender or `may_send_as`; resolves the audience **at send**, inserts one delivery per recipient (idempotent on `announcement_id:recipient`), and **inserts one `notifications` row per recipient with `type = 'announcement_received'`**, title = sender label, body = title or first 140 chars, `data = {announcement_id, sender_identity_type, sender_identity_id, reply_mode}`; marks `sent`.
- `my_announcements(limit) → TABLE(announcement_id, title, body, sender_identity_type/id, sender_label, reply_mode, withdrawn, delivered_at, read_at)` — the recipient's inbox, delivery-scoped on `recipient_user_id = auth.uid()`; a withdrawn item returns null title and body "This announcement has been withdrawn."
- `mark_announcement_read(id)` — sets `deliveries.read_at` and the matching `notifications.read_at`.
- `reply_to_announcement(id, body) → uuid` — refused for NO_REPLY or withdrawn; sender or recipient only; consults `get_effective_message_policy(club)` (`allow_group_discussion`, `allow_private_replies`); inserts into `fixture_messages`. `announcement_replies(id)` lists them.
- `withdraw_announcement(id)` — sender, `may_send_as`, or `site.messages.moderate`; status/timestamps only, body kept as evidence.
- `selectable_announcement_audience(scope, scope_id) → TABLE(player_id, display_name, is_adult, reachable, outcome, recipient_count)` — per-player picker for team/club scope, built on `internal.player_contact_eligibility` and `internal.may_address_player`; platform scope deliberately refused.

**Authority** — `internal.may_send_as`: person → self; platform → `site.email.manage`; team → `messaging.announcement.send_team`@team OR `messaging.announcement.send_club`@club OR `can_address_team_audience` (`team.attendance.view`) OR `site.support.act_in_club`; club → `can_address_club_audience` (`messaging.announcement.send_club` or `site.support.act_in_club`). Catalogue rows: `messaging.announcement.send_club` (label "Send Club Announcements", `{club}`, grant C, delegable, **safeguarding_sensitive: true**, minor_prohibited, site_master_equivalent `site.support.act_in_club`, db_enforcement "RPC may_send_as → can_CL", legacy `team.community.manage (club)` SPLIT) and `messaging.announcement.send_team` (label "Send Team Announcements", `{club, team}`, grant T, inherits_to_team, safeguarding_sensitive, db_enforcement "RPC may_send_as → can_TE"). Bundles: CA holds both at club scope; CO and TM hold `send_team` at team scope. Club policy flags `allow_team_announcements`, `allow_club_announcements`, `allow_platform_announcements` (`message_policies`, `get_effective_message_policy`) gate the resolver (`20270248…:195`).

**RLS**: `messenger_announcements_select_sender` (actor, `may_send_as`, or recipient), `messenger_announcement_deliveries_select_own` / `_update_own` (own deliveries), plus the RESTRICTIVE `session_ok_required`. No anon path at all (the 20270340 header, :16-18: "private, per-recipient delivery with no public read path").

**How (B) differs from (A)** — in one table:

| | (A) club content | (B) messenger announcement |
|---|---|---|
| Nature | published page content, read when someone looks | a message delivered to named recipients |
| Audience | `team_id` + PUBLIC/MEMBERS, evaluated by RLS at read time | resolved recipient list at send (guardians of players, exclude-U18, safeguarding routes) |
| Deliveries / read marks | none | one row per recipient, `read_at` |
| Notification | none | `announcement_received` per recipient |
| Replies | none | NO_REPLY / PRIVATE_REPLY / GROUP_DISCUSSION |
| Lifecycle | DRAFT ↔ PUBLISHED ↔ ARCHIVED, time window | draft → sending → sent, withdraw |
| Public | PUBLIC rows are anonymous-readable | never |
| Authority keys | `club.news.manage`, `team.news.manage` | `messaging.announcement.send_club/send_team`, `site.email.manage` (platform) |
| Sender identity | derived byline (club / team / Ovalball) | explicit `sender_identity_type` |

**User-visible wording for (B)** on the web: "Send an Announcement" (`app/(app)/messages/new/announcement/page.tsx:40`; `components/messenger/messenger-shell.tsx:132`), "Send Announcement" button (`announcement-composer.tsx:420`), row kind label "Announcement" with a Megaphone icon (`components/messenger/conversation-row.tsx:36`), thread header "Announcement" (`app/(app)/messages/announcement/[id]/page.tsx:95`). On mobile: inbox rows for announcements are listed but not openable ("M7 gives them native screens", `apps/mobile/src/messages/inbox.ts:67-70`); Match Centre's fixture communication is also labelled "Send Announcement" (`apps/mobile/src/components/announce-sheet.tsx:216`). **So the product already uses the word "Announcement" for (B) and (C) in front of users, while (A)'s notices are headed "Announcements" on the public page (`home-sections.tsx:29-31`), "Club Notices" on the signed-in desk (`club-desk.tsx:174`), "Announcements" in the console (`content-manager.tsx:107-108`) and "Announcements" on mobile Home (`sections.tsx:40`).** The shared contract calls them `ClubNotice` / `listLiveClubNotices` and the vocabulary labels NORMAL as "Notice".

---

## 15. Current mobile Home implementation

- **Screen**: `apps/mobile/app/(tabs)/index.tsx` (268 lines). Reads `loadHomeSummary(supabase, sessionContext, active, selectedPlayerId, projection)` (`:66`) from `apps/mobile/src/context/home-data.ts:132-252`, re-run on focus and pull-to-refresh (`:84-96`).
- **Data**: `home-data.ts:185-190` — when the active context has a `clubId`, `listLiveClubNotices(supabase, clubId, 4)` and `listClubNews(supabase, clubId, clubName ?? "Club", 3)` from `@ovalball/contracts` (i.e. `packages/contracts/src/club/home-content.ts`), each `.catch(() => [])`. The club name/slug/logo come from `loadClub` (`:269-288`: `clubs.slug, logo_storage_path, club_directory(name, logo_storage_path)`). Accents from `clubAccentsOnDark(resolveClubTheme(kit), "#071c14")` (`:200, 255`).
- **Render order** (`index.tsx:164-221`): `RugbyHero` → `AnnouncementPreview` → `NewsRail` → `SubscriptionStatusCard`s → "Everything else is on the web" card. Each content section renders **only when non-empty** (`sections.tsx:35, 75`).
- **`AnnouncementPreview`** (`sections.tsx:25-62`): heading "Announcements"; shows **only `notices[0]`** — a white card with a 4 px left rule in the club's `highlightOnLight` (or `colour.danger` for URGENT), a Megaphone, `PRIORITY · TEAM` caption, title (2 lines), body (2 lines). Nothing is tappable; the link field is not rendered. "View all" appears only when `notices.length > 1`.
- **`NewsRail`** (`sections.tsx:64-138`): heading "Latest News"; a horizontal rail of 188 pt `NewsCard`s: 112 pt image (article `heroUrl` via `expo-image`, else one of four bundled editorial photos by category label, else a Megaphone on forest), club-colour dot, `CATEGORY · relativeDay`, title (2 lines). "View all" only when `news.length > 1`.
- **"View all" and card targets — as shipped (the version first read for this map)**: they left the app. `onViewAll` for both sections → `Linking.openURL(\`${webUrl}/club/${clubSlug}\`)`; a news card → `Linking.openURL(\`${webUrl}/club/${clubSlug}/news/${article.slug}\`)`; the announcement card was not tappable. `webUrl` is `extra.webUrl ?? ""` (`apps/mobile/src/config/environment.ts:33`), so with it unset the URL was a bare path. The links resolved to the public web pages (§10) but there was no in-app destination, and with a null `clubSlug` the handler was `undefined` and the affordance hidden.
- **"View all" and card targets — on disk now (12:33, in flight, unverified)**: `index.tsx:194-205` routes natively — announcement card `router.push("/announcements/[announcementId]", {announcementId: notice.id})`, announcements View all `router.push("/news", {tab: "announcements"})`, news card `router.push("/news/[articleId]", {articleId: article.id})`, news View all `router.push("/news", {tab: "news"})`. `AnnouncementPreview` gained an `onOpen` prop and became a `Pressable` (`sections.tsx:25-70`); `NewsRail` is unchanged. Note the id-vs-slug switch: the card now navigates by `article.id`, while the web identity remains `(club slug, article slug)`; the detail route accepts either (§10).
- **Visual tokens** (`apps/mobile/src/design/tokens.ts`): page ground `surface.page = colour.chalk = #f8faf7` (:31, :77); cards `surface.card = colour.surface = #ffffff` (:32, :85) with `borderWidth 1, borderColor colour.line = rgba(16,21,18,0.10)` (:48), `radius.lg = 16` (:156), `marginHorizontal space.lg = 16` (`sections.tsx:189-195`); ink `#101512`, inkMuted `#616562`, forest800 `#123d2c` for "View all" and icons; club colour only as the rule/dot (`accents.highlightOnLight`, `packages/contracts/src/club/accent.ts:61-70`). `docs/mobile/PARENT_HOME.md:223-235` records the move from forest-raised cards to white cards on chalk.
- **Reads are already RLS-correct**: a guardian's session sees the club's PUBLIC items plus MEMBERS items for their child's team (§2.3). The mobile queries are the same two the web desk uses.
- **What the shipped mobile build did not have**: an article screen, an announcements list, an editor, any authority read, or any test over these two sections. **What is on disk now** (in flight): all of the first four (§10, mobile routes), reading `club_publishing_scopes` through `readPublishingScopes`. **Tests**: the in-flight work adds `club_news_announcements_ca5.sql` (database: scopes, refusals, windows, reader isolation, lead story) and structural checks in `mobile_admin_centre.test.mts` (§12); nothing yet exercises the Home readers (`listClubNews` / `listLiveClubNotices`) or renders the new screens. None of it was run for this map.

---

## 16. Documents and locked decisions

- `docs/CLUB_DIGITAL_HOME.md` — the canonical feature doc: where things are (table at :9-20), authority (:33-55), public data boundary (:57-72), Welcome article (:74-80), tests (:82-93). Two statements to treat with care: the delegable claim at :53-55 is stale (§11), and the "Signed-in viewers also see MEMBERS rows where they hold `club.view` (or `team.view`)" at :60-61 names the pre-catalogue keys — the live predicate uses `club.profile.view` and `team.team.view`.
- Memory `ovalball-club-home-locked-decisions` (owner-locked): friendly fixture scores are never public; **the Welcome to Ovalball article is prospective only — never backfilled, never triggered by team creation, existing clubs never modified to populate it**.
- `docs/mobile/PARENT_HOME.md` — the mobile Home build record: the two readers and their RLS reliance (:11-13, :79-91), the one-notice preview and horizontal news rail (:287-291), the editorial fallback photographs and their approval (:261-266), the chalk/white token decision (:223-235), and the honest gap that no news was published in the review world at the time (:120-127; since fixed by the seed `supabase/seeds/local_uat_club_voice.sql`, which adds one live notice "Car park closed for resurfacing" and two published stories with slugs `under-12s-head-to-wigan-for-the-lancashire-cup` and `clubhouse-kitchen-reopens-on-sunday`, idempotent on title/slug).
- `docs/mobile/CLUB_ADMIN_CENTRE_MAP.md` — §2.4 (:335-345) summarises the console, RPCs, bucket path and error mapping; the milestone table (:591) lists **"CA-M5 | News & Announcements (native editor, same RPCs, shared markup) | AMBER | error mapping → contracts"**; :137-138 and :549 list the section and its capability.
- `docs/product/CONVERGENCE_STEP_10_ARCHAEOLOGY.md:116-121` (team covers reuse `club-news-media`) and `docs/product/CONVERGENCE_STEP_11_REPORT.md:281, 364` (`fixture_id` added to `club_articles`; MATCH_REPORT already existed, "no second article model").
- `docs/mobile/MESSAGES_ARCHITECTURE.md:18-22, 84` — domain B on mobile: announcements are "a one-to-many announcement, with a reply mode — not a conversation", listed with unread state but not openable until M7.
- Migration header `20270340…:1-47` — the design statement: article vs announcement vs messenger announcement; authority consumed not redefined; the public boundary.

---

## What this means for CA-M5 (facts, not design)

1. **The write path is complete, server-owned and shared.** Five RPCs, two internal predicates, one trigger-enforced scope rule, and constraint-carried validation. A native editor has nothing to enforce; it needs the same parameter set, the same error-code translation (§3.10) and the same `PUBLISHED`-only readers.
2. **The audience model is RLS and only RLS.** There is no audience picker beyond "the whole club" or "one team", plus PUBLIC/MEMBERS. A guardian reads their child's team's MEMBERS items through `team.team.view`; a club member reads club-wide MEMBERS items through `club.profile.view`. Any client must select named columns (author columns are ungranted) and must never `select("*")`.
3. **Where a person may publish is already a server question**: `club_publishing_scopes(club)` is live locally and mirrors the write rule. The club row uses the publish twin; team rows use the edit twin; today the two are the same function.
4. **A shared contract for CA-M5 exists and is now consumed by both clients via deep import** (`@ovalball/contracts/club/content`): readers, managed lists, editable loaders, operations, error words, `readPublishingScopes`, `isArticleImageInUse`. It is deliberately not on the package index, because its names overlap `home-content.ts` (still exported, still what mobile Home reads). It has no test.
5. **Article bodies are the platform's own markup**, parsed by one pure module that already lives in the contracts package; there is no HTML in the path and no sanitiser. Announcement bodies are plain text (≤500). Mobile has no renderer for the markup tree today; the web's is `components/club-home/article-body.tsx`.
6. **Images** are a public bucket with a folder-is-authority write policy; upload paths are `{club}/{team|club}/{uuid}.{ext}` with the extension from verified MIME; hero images require alt text; the same `getPublicUrl` resolves on both clients. The web's upload runs in a server action, not from the browser.
7. **Nothing notifies.** Publishing a club article or notice creates no `notifications` row, no push, no email, and no read state. The only "announcement" that notifies is the Messenger one (`announcement_received`), which is a different domain with a different authority (`messaging.announcement.*`) and a safeguarding-sensitive recipient model.
8. **Naming already collides in front of users**: "Announcement" is the Messenger broadcast (B) and the Match Centre fixture communication (C) on both clients; (A)'s notices are "Announcements" on the public page, mobile Home and the console, "Club Notices" on the signed-in desk, and `ClubNotice` in code.
9. **Mobile Home already reads (A)** with the canonical readers and correct RLS and shows one notice and three news cards. As shipped, every tap and "View all" went to the website (`/club/{slug}`, `/club/{slug}/news/{slug}`); on disk now they route to the new native `/news`, `/news/[articleId]` and `/announcements/[announcementId]` screens (in flight, unverified). The Admin Centre IA row for news is flagged `native: true`, matching the new `admin/news/**` routes that now exist on disk.
10. **Authority is capability-only** (`club.news.manage` at club; `team.news.manage` at team), enforced in the database and guarded structurally against role-name checks; lead story is club authority even for a team's article; `club.news.manage` is delegable today despite the feature doc saying otherwise.
11. **Time-scheduling of notices is a query predicate on `starts_at`/`expires_at`** with no job, so "scheduled" is a state a client must compute (`PUBLISHED && starts_at > now`) and "expired" likewise; the management list already does (`live` flag).
12. **Test coverage** for the database side is deep (60 PASS points plus the adapters suite); the mobile side has none for these sections, and `club_publishing_scopes` / `content.ts` have none at all.

## Gaps / open questions

- **The in-flight CA-M5 work is unverified by this map**: no build, `tsc`, test suite, `scripts/verify-club-digital-home.mjs`, `scripts/verify-match-centre-shared.mjs`, browser run or clean-boot of `20270547` was executed. Its shape is recorded (§7.4, §10, §15); its correctness is not claimed.
- **Two reader families are live at once**: Home reads `home-content.ts` (`ClubNotice`, `ClubNewsCard`: no `clubId`, `heroAlt`, `category`, `teamId`, `startsAt`, `publishedAt`), the new screens read `content.ts` (`AnnouncementCard`, `ArticleCard`). Whether Home migrates to `content.ts` (and `home-content.ts` retires) or both stay is undecided; while both exist, the "one source" claim in `home-content.ts:16-23` holds at the table level but not at the contract level. `content.ts` is kept off the package index precisely because merging would collide on `ArticleCard`, `listPublishedArticles`, `listLiveAnnouncements` (also exported on the web by `lib/club-public/articles.ts`), `EditableArticle`, `EditableAnnouncement`, `ArticleInput`, `AnnouncementInput`, `ContentScope`, `ManagedArticleRow`, `ManagedAnnouncementRow` and the five operation names.
- **Commit state** of `20270547000000_where_a_person_may_publish.sql`, `content.ts` and the new mobile files was not verified (no git commands were run). All are on disk; the migration is applied locally.
- **Clean-boot proof** for `20270547` has not been recorded anywhere in `docs/`.
- **`readPublishingScopes` asymmetry** (club → publish twin, teams → edit twin) is harmless today and would matter the day `may_publish_club_content` diverges.
- **Announcement link on mobile Home**: `ClubNotice.link` is read but never rendered by `AnnouncementPreview` (`sections.tsx`); the web renders it. `ClubNotice` has no `startsAt`, so Home cannot say "from Saturday" (the new detail screen reads `AnnouncementCard`, which has it).
- **Announcements have no web permalink**: on the web they are inline on `/club/{slug}`; there is no `/club/{slug}/announcements` page. The new mobile `/announcements/[announcementId]` route therefore has no web equivalent to deep-link from or to — a share or notification for a notice has nowhere canonical to point on the web.
- **`webUrl` unset** in a mobile build yields relative `Linking.openURL("/club/…")` calls (`environment.ts:33`); this still matters for the remaining web hand-offs (subscription, "Everything else is on the web").
- **No `heroAlt` on mobile Home news cards** (`ClubNewsCard`), although alt is mandatory at write time; `ArticleCard` in `content.ts` carries it.
- **`ArticleInput.category` never offers WELCOME** and `save_club_article` does not stop a client sending `'WELCOME'` for an ordinary article; only `system_key` is unique-guarded. The category check constraint allows it.
- **`fixture_id`** cannot be set or shown through the editor or `save_club_article`; only Step 11's path writes it. A native MATCH_REPORT flow would need a decision on how the fixture is attached.
- **Editing a PUBLISHED item is a publish act** (`may_publish_club_content` re-checked on edit), so the "Publish Changes" button on the web is a plain save; a client that shows "Save" on a published item would be misdescribing the rule.
- **`set_club_article_status` and `set_club_announcement_status` take no reason** and emit no security event; archiving is unattributed beyond `audit_log`.
- **Delegability doc drift** (`docs/CLUB_DIGITAL_HOME.md:53-55`) and **key-name drift** (`:60-61`) should be corrected when the doc is next touched.
- **Team covers** share the bucket and policy but have no upload path anywhere; the storage policy's path regex (`{club}/{team|club}/{uuid}.{ext}`) means a cover for team T would need `team.news.manage` on T or club news authority — an inherited consequence worth stating if covers ever become editable.
- **Wording decision pending** on "Announcement" (A) vs "Announcement" (B/C) vs "Notice"; the vocabulary module already labels NORMAL priority "Notice" and the desk says "Club Notices".
- **Mobile inbox** does not open (B) announcements (M7), so a mobile user who receives an `announcement_received` notification lands on the inbox; this is a domain-B gap but it shapes what "announcement" means to a mobile user during CA-M5.


---

## As implemented (CA-M5, banked)

- **Canonical tables**: `club_articles`, `club_announcements` — unchanged. **Migration**: one,
  `20270547000000_where_a_person_may_publish.sql`, adding the read model `club_publishing_scopes(club)`
  (authenticated only; asks `internal.may_publish_club_content` for the club and
  `internal.may_edit_club_content` per team). No audience or authority model change.
- **Capabilities**: `club.news.manage` (club), `team.news.manage` (team). No new key.
- **Shared contract**: `packages/contracts/src/club/content.ts` (readers, management, the five
  operations, media, refusal words, `readingScopeFor` + `readFeed`); `home-content.ts` now delegates its
  Home readers to it. Web `lib/club-content/{manage,actions}.ts` and `lib/club-public/articles.ts`
  re-pointed; the web owns nothing the app cannot.
- **Family reading**: the client resolves the clubs to ask from canonical relationships
  (`guardianRelationships`, `linkedPlayerTeams`); RLS decides every row; results joined by id. Club,
  team, parent, player, family, site admin and governing each have an explicit rule.
- **Publication windows**: `starts_at`/`expires_at` against `now()` at query time; scheduled and
  expired are presentation words over the same window.
- **Featured / lead**: `set_club_article_featured` (club decision); the lead leads on both clients.
- **Safe markup**: `parseArticleBody` shared; the app renders the tree natively, the website through
  `components/club-home/article-body.tsx`; no HTML on either.
- **Media**: `club-news-media` (public), path `{club}/{team|club}/{uuid}.{ext}`, policy
  `internal.may_manage_club_news_media`; both clients upload to it and read `getPublicUrl`; a story with
  no image gets the app's own editorial fallback by category (never a generated photograph).
- **Not built, by truth**: publication notifications (none exist), read receipts (none exist),
  governing-body or Site Admin publishing (none exists), comments or replies (messaging domain).
- **Messenger broadcast domain** stays separate and untouched.
- **Gaps carried forward**: no web permalink for an announcement (the app opens it natively; the
  website's public page lists notices); paging in a multi-club family is per club (first page of each);
  `docs/CLUB_DIGITAL_HOME.md` wording drift noted in §16.
