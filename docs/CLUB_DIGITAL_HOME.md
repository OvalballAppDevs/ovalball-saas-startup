# Club Digital Home

Every Ovalball club has a public home at `/club/{slug}`: its identity, crest and
home-kit branding, news, team news, announcements, fixtures, results, teams, the
Rugby Hub and club information. Articles live at `/club/{slug}/news/{article}`.

## Where things are

| Concern | One canonical place |
|---|---|
| Theme | `lib/club-theme/theme.ts` (`resolveClubTheme`, `clubThemeVariables`) |
| Public club identity | `lib/club-public/club.ts` (`loadPublicClub`) |
| Public news queries | `lib/club-public/articles.ts` |
| Homepage aggregation | `lib/club-public/load-club-home.ts` |
| Match shaping (pure) | `lib/club-public/matches.ts` |
| Article markup | `lib/club-content/markup.ts` |
| Article renderer | `components/club-home/article-body.tsx` |
| Publishing actions | `lib/club-content/actions.ts` |
| Consoles | `/club/settings/news` (club), `/teams/{teamId}/news` (team) |
| Database | `supabase/migrations/20270340000000_a_club_has_a_home.sql` |

`scripts/verify-club-digital-home.mjs` holds these structurally.

## Home kit is the branding

There is no website colour. `club_kits` variant `primary` feeds
`resolveClubTheme`, which chooses every foreground, button, link and focus ring
by measured WCAG contrast (text >= 4.5:1, controls and focus >= 3:1), keeping the
club's hue where it can. A club with no kit gets Ovalball's colours. The hero
draws the kit's own pattern (hoops, halves, sash...) beside the words, never
behind them.

## Authority: consumed, not redefined

Two catalogue keys, added the way `docs/CAPABILITY_ARCHITECTURE.md` prescribes:

| Key | Scope | Default holders |
|---|---|---|
| `club.news.manage` | club | Club Admin |
| `team.news.manage` | team | Club Admin, Team Manager, Team Staff (mirrors `team.community.manage`) |

Every decision goes through two adapters: `internal.may_edit_club_content(club, team)`
and `internal.may_publish_club_content(club, team)`. They resolve the same keys
today and are separate so drafting and publishing can diverge in one function.
Writes happen only through `save_club_article`, `set_club_article_status`,
`set_club_article_featured`, `save_club_announcement` and
`set_club_announcement_status`. None of these is executable by anon, and there
is no write grant or policy on either table.

**Dependency for the Identity/Auth programme.** When capabilities are finalised,
replace the bodies of the two adapters (and, if the keys are renamed, the four
role-default rows). Nothing else in the feature asks an authority question.
`club.news.manage` is deliberately not in `internal.club_delegable_capability`,
because that allow-list belongs to the permissions work. Until it is added
there, a club cannot delegate news publishing through its own Permissions page.

## Public data boundary

- Articles and announcements are read under RLS. Anon sees PUBLISHED + PUBLIC
  rows of an active club. Signed-in viewers also see MEMBERS rows where they
  hold `club.view` (or `team.view` for a team item). Browser roles have column
  grants that omit `created_by`, `updated_by` and `published_by`.
- Upcoming fixtures come only from `public_club_fixtures`.
- Results come from `competition_matches` under their own public RLS. A club
  fixture's result appears only for a signed-in viewer whose fixture policy
  already returns that fixture, and the page says so.
- **Not built, by design:** publishing friendly (non-competition) results to
  anonymous visitors. `calendar_match_centre_link` asserts the public fixture
  projection carries no score columns, and `security_perimeter_guard` only
  admits new anon-readable owner-rights views or definer functions through a
  reviewed inventory. It is also an age-grade question: governing bodies do not
  publish results for the youngest grades. This needs a product decision first.

## Welcome to Ovalball

A trigger on `club_setup_state` publishes one club-wide article when a club's
setup first reaches COMPLETED (`internal.ensure_club_welcome_article`). A unique
`(club_id, system_key)` index makes it idempotent across retries, repeated
completion and archiving. Teams never trigger it. Clubs that completed setup
before this migration are not backfilled.

## Tests

- `supabase/tests/club_digital_home.sql`: authority, lifecycle, scope,
  direct-write refusal, column privacy, members-only, announcement windows,
  welcome idempotency and image path authority.
- `supabase/tests/js/club_theme.test.mts`: contrast floors, including a
  500-kit property sweep.
- `supabase/tests/js/club_digital_home.test.mts`: markup link safety, and
  fixture/result selection and merging.
- `scripts/browser-verification/40-club-digital-home.mjs`: self-seeding,
  self-cleaning browser acceptance covering visitor, Club Admin, coach, member
  and another club's admin, four kits at 320–1600px.
