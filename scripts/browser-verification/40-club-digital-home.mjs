// CLUB DIGITAL HOME -- browser acceptance.
//
// A club's public homepage, its news and announcements, and the publishing
// flows behind them, driven in a real browser as the people who use them:
//
//   a signed-out visitor    homepage, article, share metadata, private data
//   a Club Admin            write -> preview -> publish -> copy link; edit,
//                           lead story, archive; announcements
//   a coach                 team news for their own team only
//   a club member           members-only content, no editing controls
//   another club's admin    cannot open this club's editor
//
// Four clubs are seeded with deliberately awkward home kits -- navy/white,
// white/yellow, black/navy, pale blue/white -- and crests of different
// shapes, and each homepage is measured for hero contrast and horizontal
// overflow at 320 to 1600px. Everything this run creates is removed at the
// end, whatever happens in between.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/40-club-digital-home.mjs
//
// Optional: SUPABASE_DB_CONTAINER (default supabase_db_ovalball-saas-startup),
// MAILPIT_URL, SUPABASE_URL + SUPABASE_SECRET_KEY (to upload test crests;
// without them the crest-shape checks are skipped and say so),
// SCREENSHOT_DIR (default: a temp directory).

import { execFileSync } from "node:child_process"
import { crc32, deflateSync } from "node:zlib"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP, launch, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321"
const SECRET = process.env.SUPABASE_SECRET_KEY || null
const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "ovalball-club-digital-home")
fs.mkdirSync(SHOTS, { recursive: true })

const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const TAG = Date.now().toString(36).slice(-6)
const email = (who) => `uat.clubhome.${who}.${TAG}@ovalball.test`
const SECRET_NOTE = `SECRET-NOTE-${TAG}`
const SECRET_ROOM = `SECRET-ROOM-${TAG}`
const SECRET_MEET = "07:17"

// -----------------------------------------------------------------------------
// Seed
// -----------------------------------------------------------------------------

const CLUBS = [
  { key: "harbour", name: "Harbour Vale RUFC", pattern: "HOOPS", primary: "#0b3d91", secondary: "#ffffff", crest: "tall" },
  { key: "saffron", name: "Saffron Hill RFC", pattern: "VERTICAL_STRIPES", primary: "#ffffff", secondary: "#ffe600", crest: "wide" },
  { key: "blackwater", name: "Blackwater Nomads RUFC", pattern: "HALVES", primary: "#000000", secondary: "#0a1a3a", crest: "tiny" },
  { key: "chalk", name: "Chalkstream RFC", pattern: "SASH", primary: "#cfe8ff", secondary: "#ffffff", crest: null },
]
const slugOf = (c) => `uat-home-${c.key}-${TAG}`

function seed() {
  const users = ["admin", "coach", "member", "otheradmin", "parent", "family", "player", "multiclub", "siteadmin"]
  sql(`
do $$
declare
  v_id uuid; v_club uuid; v_dir uuid; v_ms uuid;
  v_admin uuid; v_coach uuid; v_member uuid; v_other uuid;
  v_parent uuid; v_family uuid; v_player uuid; v_multiclub uuid; v_siteadmin uuid; v_saffron uuid; v_child uuid;
begin
  ${users
    .map(
      (u) => `
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(u)}', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '') returning id into v_id;
  insert into public.profiles (id, first_name, surname, email) values (v_id, 'Uat', '${u[0].toUpperCase() + u.slice(1)} Clubhome', '${email(u)}') on conflict (id) do nothing;
  v_${u === "otheradmin" ? "other" : u} := v_id;`
    )
    .join("\n")}

  ${CLUBS.map(
    (c) => `
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, bio)
  values ('${c.name}', 'Testbridge', 'Lancashire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-home-${c.key}-${TAG}',
          ${c.key === "harbour" ? "'A community rugby club by the water, running minis to seniors since 1921.'" : "null"})
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, '${slugOf(c)}', 'active') returning id into v_club;
  insert into public.club_kits (club_id, variant, pattern, primary_colour, secondary_colour) values (v_club, 'primary', '${c.pattern}', '${c.primary}', '${c.secondary}');
  insert into public.club_setup_state (club_id, status) values (v_club, 'NOT_STARTED');
  update public.club_setup_state set status = 'COMPLETED', completed_at = now() where club_id = v_club;`
  ).join("\n")}

  select id into v_club from public.clubs where slug = '${slugOf(CLUBS[0])}';
  insert into public.teams (club_id, category, age_group, gender, rugby_code, active) values
    (v_club, 'youth', 'U9', 'mixed', 'union', true),
    (v_club, 'youth', 'U12', 'boys', 'union', true),
    (v_club, 'youth', 'U14', 'girls', 'union', true),
    (v_club, 'youth', 'U16', 'boys', 'union', true);
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active'), (v_club, v_member, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.team_permissions (membership_id, team_id, permission)
    select v_ms, t.id, 'coach' from public.teams t where t.club_id = v_club and t.age_group = 'U12';

  -- A parent of one Under 12, an adult with their own player profile, and a member of two clubs.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Uat', 'Clubhome Child ${TAG}', current_date - interval '11 years', 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) select v_child, t.id, 'active' from public.teams t where t.club_id = v_club and t.age_group = 'U12';
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_parent, v_child, 'guardian', 'active');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Uat', 'Clubhome Player ${TAG}', current_date - interval '15 years', 'MALE', v_player) returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) select v_child, t.id, 'active' from public.teams t where t.club_id = v_club and t.age_group = 'U16';
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_multiclub, 'BASIC_USER', 'active');
  -- read_only, deliberately: a Full Site Admin cannot be removed while it is the last one
  -- (internal.prevent_last_full_admin_lockout), and this suite must clean up in an empty database too.
  insert into public.site_admins (user_id, status, admin_role) values (v_siteadmin, 'active', 'read_only');

  select id into v_saffron from public.clubs where slug = '${slugOf(CLUBS[1])}';
  insert into public.teams (club_id, category, age_group, gender, rugby_code, active) values (v_saffron, 'youth', 'U12', 'boys', 'union', true);
  insert into public.club_memberships (club_id, user_id, role, status) values (v_saffron, v_other, 'CLUB_ADMIN', 'active'), (v_saffron, v_multiclub, 'BASIC_USER', 'active');

  -- A family with one child at each of two clubs: "All Children" spans clubs.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Uat', 'Clubhome Harbour Kid ${TAG}', current_date - interval '11 years', 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) select v_child, t.id, 'active' from public.teams t where t.club_id = v_club and t.age_group = 'U12';
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_family, v_child, 'guardian', 'active');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Uat', 'Clubhome Saffron Kid ${TAG}', current_date - interval '11 years', 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) select v_child, t.id, 'active' from public.teams t where t.club_id = v_saffron and t.age_group = 'U12';
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_family, v_child, 'guardian', 'active');

  select id into v_club from public.clubs where slug = '${slugOf(CLUBS[2])}';
  insert into public.teams (club_id, category, age_group, gender, rugby_code, active) values (v_club, 'youth', 'U15', 'boys', 'union', true);
end $$;`)

  const harbour = one(`select id from clubs where slug='${slugOf(CLUBS[0])}'`)
  const team = (club, age) => one(`select id from teams where club_id='${club}' and age_group='${age}'`)
  const u12 = team(harbour, "U12")
  const u14 = team(harbour, "U14")
  const u16 = team(harbour, "U16")
  const blackwater = one(`select id from clubs where slug='${slugOf(CLUBS[2])}'`)
  const saffron = one(`select id from clubs where slug='${slugOf(CLUBS[1])}'`)

  // Fixtures, with private operational detail that must never reach the public page.
  sql(`
insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, meet_time, changing_room) values
  ('${u12}', 'Home', 'Northgate RFC', current_date + 3, '10:30', 'Booked', 'club_created', '${SECRET_NOTE}', '${SECRET_MEET}', '${SECRET_ROOM}'),
  ('${u14}', 'Away', 'Riverside Ladies RFC', current_date + 5, '11:00', 'Booked', 'club_created', '${SECRET_NOTE}', '${SECRET_MEET}', '${SECRET_ROOM}'),
  ('${u16}', 'Home', 'Old Mill RUFC', current_date + 10, '14:00', 'Booked', 'club_created', '${SECRET_NOTE}', null, null),
  ('${u12}', 'Away', 'Castle Park RFC', current_date + 17, null, 'Booked', 'club_created', null, null, null),
  ('${u14}', 'Home', 'Eastwood RFC', current_date + 24, '10:00', 'Booked', 'club_created', null, null, null);
insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
values ('${team(blackwater, "U15")}', 'Home', 'Moorside RFC', current_date + 6, '11:30', 'Booked', 'club_created');
insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, home_score, away_score, result_status)
values ('${u12}', 'Away', 'Friendly Rivals RFC ${TAG}', current_date - 6, '10:30', 'Completed', 'club_created', 27, 12, 'final');
insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, event_type)
values ('${u12}', 'Not Applicable', 'Half Term ${TAG}', current_date + 1, null, 'Annual Holiday', 'club_created', 'holiday');
insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, cancellation_reason)
values ('${u12}', 'Home', 'Called Off RFC ${TAG}', current_date + 2, '10:30', 'Cancelled', 'club_created', 'Waterlogged pitch');`)

  // A public competition result for the club's Under 16s.
  const season = one(`select id from seasons where rugby_code='union' and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on order by starts_on limit 1`)
  const competition = one(`insert into competitions (name, slug, normalized_key, rugby_code, active, format, team_count) values ('Testbridge Cup ${TAG}', 'uat-home-cup-${TAG}', 'uat home cup ${TAG}', 'union', true, 'league', 2) returning id`)
  const edition = one(`insert into competition_editions (competition_id, season_id, rugby_code, active) values ('${competition}', '${season}', 'union', true) returning id`)
  const stage = one(`insert into competition_stages (edition_id, kind, name, sort_order, settings) values ('${edition}', 'league', 'League', 1, '{}') returning id`)
  const ours = one(`insert into competition_participants (edition_id, slot, club_directory_id, club_id, team_id) select '${edition}', 1, c.directory_id, c.id, '${u16}' from clubs c where c.id='${harbour}' returning id`)
  const theirs = one(`insert into competition_participants (edition_id, slot, club_directory_id) select '${edition}', 2, d.id from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name limit 1 returning id`)
  sql(`insert into competition_matches (edition_id, stage_id, round_number, home_participant_id, away_participant_id, match_date, kickoff_time, status, verification_state, home_score, away_score, winner_participant_id, result_source)
       values ('${edition}', '${stage}', 1, '${ours}', '${theirs}', current_date - 13, '11:00', 'completed', 'not_required', 31, 19, '${ours}', 'organiser')`)

  // Content the flows below do not create.
  sql(`
insert into public.club_articles (club_id, team_id, slug, title, excerpt, body, category, status, visibility, published_at, first_published_at) values
  ('${harbour}', null, 'clubhouse-refurbishment-${TAG}', 'Clubhouse Refurbishment Complete', 'The bar and changing rooms reopen this Friday.', E'After eight months of work the clubhouse is finished.\\n\\n## What has changed\\n\\n- New **changing rooms** for every age group\\n- A bigger kitchen for match teas\\n\\nThank you to every volunteer who gave up a weekend.', 'UPDATE', 'PUBLISHED', 'PUBLIC', now() - interval '2 days', now() - interval '2 days'),
  ('${harbour}', null, 'members-evening-${TAG}', 'Members Evening Details', 'Doors open at seven.', 'Bring a friend. Members only.', 'EVENT', 'PUBLISHED', 'MEMBERS', now() - interval '1 day', now() - interval '1 day'),
  ('${harbour}', null, 'unpublished-draft-${TAG}', 'Unpublished Draft ${TAG}', null, 'Not ready.', 'NEWS', 'DRAFT', 'PUBLIC', null, null),
  ('${harbour}', '${u14}', 'u14-girls-county-final-${TAG}', 'Under 14 Girls Reach County Final', 'A fantastic semi-final win on Sunday.', 'Brilliant effort from the whole squad.', 'MATCH_REPORT', 'PUBLISHED', 'PUBLIC', now() - interval '3 days', now() - interval '3 days'),
  ('${saffron}', null, 'summer-fete-${TAG}', 'Summer Fete Raises Record Total', 'Thank you to everyone who came.', 'The fete raised more than ever before.', 'CELEBRATION', 'PUBLISHED', 'PUBLIC', now() - interval '4 days', now() - interval '4 days');
insert into public.club_announcements (club_id, title, body, priority, status, visibility, starts_at, expires_at, published_at, link_label, link_url) values
  ('${harbour}', 'Pitches Closed Saturday', 'The ground is waterlogged. All home training moves to Sunday.', 'URGENT', 'PUBLISHED', 'PUBLIC', now() - interval '1 hour', now() + interval '2 days', now(), 'Club Calendar', '/calendar'),
  ('${harbour}', 'Expired Notice ${TAG}', null, 'NORMAL', 'PUBLISHED', 'PUBLIC', now() - interval '5 days', now() - interval '1 day', now() - interval '5 days', null, null),
  ('${harbour}', 'Members AGM Tuesday ${TAG}', null, 'IMPORTANT', 'PUBLISHED', 'MEMBERS', now() - interval '1 hour', null, now(), null, null);`)

  return { harbour, saffron, blackwater, u12, u14, competition, edition }
}

// A minimal PNG writer, so the test crests need no image library.
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y)
      const o = y * (width * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

const CREST_IMAGES = {
  // A tall shield on a transparent background.
  tall: () => png(120, 200, (x, y) => (Math.abs(x - 60) < 55 - Math.max(0, y - 120) * 0.6 && y > 5 ? [20, 40, 120, 255] : [0, 0, 0, 0])),
  // A wide wordmark badge.
  wide: () => png(320, 110, (x, y) => (y > 10 && y < 100 && x > 8 && x < 312 ? (x % 40 < 20 ? [170, 20, 30, 255] : [240, 200, 0, 255]) : [0, 0, 0, 0])),
  // A 24px low-resolution square.
  tiny: () => png(24, 24, (x, y) => ((x + y) % 6 < 3 ? [230, 230, 230, 255] : [40, 40, 40, 255])),
}

async function uploadCrests() {
  if (!SECRET) return false
  for (const c of CLUBS) {
    if (!c.crest) continue
    const club = one(`select id from clubs where slug='${slugOf(c)}'`)
    const objectPath = `${club}/uat-crest-${TAG}.png`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/club-logos/${objectPath}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, apikey: SECRET, "content-type": "image/png", "x-upsert": "true" },
      body: CREST_IMAGES[c.crest](),
    })
    if (!res.ok) throw new Error(`crest upload failed: ${res.status} ${await res.text()}`)
    sql(`update clubs set logo_storage_path='${objectPath}' where id='${club}'`)
  }
  return true
}

async function removeStorage(bucket, prefixes) {
  if (!SECRET) return
  for (const prefix of prefixes) {
    const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, apikey: SECRET, "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100 }),
    }).then((r) => (r.ok ? r.json() : []))
    const names = []
    for (const item of list) {
      if (item.id) names.push(`${prefix}/${item.name}`)
      else {
        const nested = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}`, apikey: SECRET, "content-type": "application/json" },
          body: JSON.stringify({ prefix: `${prefix}/${item.name}`, limit: 100 }),
        }).then((r) => (r.ok ? r.json() : []))
        for (const n of nested) names.push(`${prefix}/${item.name}/${n.name}`)
      }
    }
    if (names.length) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${SECRET}`, apikey: SECRET, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: names }),
      })
    }
  }
}

let seeded = null
let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  const clubIds = sql(`select id from clubs where slug like 'uat-home-%-${TAG}'`).split("\n").filter(Boolean)
  try {
    await removeStorage("club-logos", clubIds)
    await removeStorage("club-news-media", clubIds)
  } catch (e) {
    console.error("storage cleanup failed:", e)
  }
  sql(`
do $$
declare v_clubs uuid[] := array(select id from public.clubs where slug like 'uat-home-%-${TAG}');
begin
  delete from public.competition_matches where edition_id in (select e.id from public.competition_editions e join public.competitions c on c.id = e.competition_id where c.slug = 'uat-home-cup-${TAG}');
  delete from public.competition_stages where edition_id in (select e.id from public.competition_editions e join public.competitions c on c.id = e.competition_id where c.slug = 'uat-home-cup-${TAG}');
  delete from public.competition_participants where edition_id in (select e.id from public.competition_editions e join public.competitions c on c.id = e.competition_id where c.slug = 'uat-home-cup-${TAG}');
  delete from public.competition_editions where competition_id in (select id from public.competitions where slug = 'uat-home-cup-${TAG}');
  delete from public.competitions where slug = 'uat-home-cup-${TAG}';
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.audit_log where table_name in ('club_articles', 'club_announcements', 'club_kits', 'clubs', 'teams', 'fixtures', 'club_setup_state', 'club_memberships', 'team_permissions')
    and (record_id in (select id from public.club_articles where club_id = any(v_clubs))
      or record_id in (select id from public.club_announcements where club_id = any(v_clubs))
      or record_id in (select id from public.club_kits where club_id = any(v_clubs))
      or record_id in (select id from public.teams where club_id = any(v_clubs))
      or record_id in (select id from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs)))
      or record_id in (select id from public.club_memberships where club_id = any(v_clubs))
      or record_id = any(v_clubs));
  delete from public.club_articles where club_id = any(v_clubs);
  delete from public.club_announcements where club_id = any(v_clubs);
  delete from public.audit_log where record_id in (select p.id from public.players p where p.surname like 'Clubhome % ${TAG}' or p.surname = 'Clubhome Child ${TAG}' or p.surname = 'Clubhome Player ${TAG}');
  delete from public.guardians where player_id in (select id from public.players where surname like 'Clubhome %${TAG}');
  delete from public.player_team_memberships where player_id in (select id from public.players where surname like 'Clubhome %${TAG}');
  delete from public.players where surname like 'Clubhome %${TAG}';
  delete from public.site_admins where user_id in (select id from auth.users where email like 'uat.clubhome.%.${TAG}@ovalball.test');
  delete from public.team_permissions where team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.club_kits where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key like 'uat-home-%-${TAG}';
  -- Audit rows this run caused: written by its people, or about its content.
  delete from public.audit_log where changed_by in (select id from auth.users where email like 'uat.clubhome.%.${TAG}@ovalball.test');
  delete from public.profiles where email like 'uat.clubhome.%.${TAG}@ovalball.test';
  delete from auth.users where email like 'uat.clubhome.%.${TAG}@ovalball.test';
end $$;`)
  const left = one(`select (select count(*) from clubs where slug like 'uat-home-%-${TAG}') + (select count(*) from auth.users where email like 'uat.clubhome.%.${TAG}@ovalball.test') + (select count(*) from competitions where slug = 'uat-home-cup-${TAG}')`)
  record("cleanup: every club, user, fixture, competition and article this run created is gone", left === "0", `remaining=${left}`)
}

// -----------------------------------------------------------------------------
// Browser helpers
// -----------------------------------------------------------------------------

const CONTRAST = `(() => {
  const parse = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  window.__contrast = (a, b) => { const x = lum(parse(a)), y = lum(parse(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
})()`

/** Console errors and uncaught exceptions, hydration mismatches included. */
function watchErrors(page) {
  const errors = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160))
  })
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)))
  return errors
}


/** The club desk on /dashboard: what it shows, where, and that the dashboard's own work is still there. */
async function readDesk(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body
    const header = main.querySelector("header")
    const aside = main.querySelector("aside")
    // textContent, not innerText: innerText applies CSS text-transform, so an
    // uppercase-styled heading would read "THIS WEEK" and never match its source.
    const text = (el) => (el ? el.textContent.replace(/\s+/g, " ") : "")
    const pos = (needle) => text(main).indexOf(needle)
    return {
      h1: text(main.querySelector("h1")),
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
      headerText: text(header),
      asideText: text(aside),
      mainText: text(main),
      urgentBeforeWeek: pos("Pitches Closed Saturday") > -1 && pos("Pitches Closed Saturday") < pos("This Week"),
      weekBeforeRail: pos("This Week") > -1 && pos("This Week") < pos("Club Notices"),
      urgentInRail: text(aside).includes("Pitches Closed Saturday"),
      manageHref: aside?.querySelector('a[href$="/news"]:not([href^="/club/uat"])')?.getAttribute("href") ?? null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

async function status(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" })
  return res?.status() ?? 0
}

const hex = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

process.on("SIGINT", async () => {
  await cleanup()
  process.exit(130)
})

let browser
try {
  seeded = seed()
  const crests = await uploadCrests()
  browser = await launch()
  const harbourSlug = slugOf(CLUBS[0])
  const home = `${APP}/club/${harbourSlug}`

  // ---------------------------------------------------------------- visitor
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    const errors = watchErrors(page)
    await page.goto(home, { waitUntil: "networkidle" })
    await page.evaluate(CONTRAST)
    await page.screenshot({ path: path.join(SHOTS, "harbour-desktop.png"), fullPage: true })

    record("visitor: the club homepage renders with the club's name as its one h1", (await page.locator("h1").count()) === 1 && (await page.locator("h1").innerText()).includes("Harbour Vale RUFC"))

    const html = await page.content()
    record("visitor: private fixture notes, meet times and changing rooms never reach the page", !html.includes(SECRET_NOTE) && !html.includes(SECRET_ROOM) && !html.includes(SECRET_MEET))
    record("visitor: upcoming fixtures are listed from the public projection", html.includes("Northgate RFC") && html.includes("Old Mill RUFC"))
    record("visitor: a public competition result is shown with its score and outcome word", /31.19/.test(await page.locator("section[aria-labelledby=results]").innerText()) && (await page.locator("section[aria-labelledby=results]").innerText()).includes("Won"))
    record("visitor: a friendly result nobody published is not shown to the public", !html.includes(`Friendly Rivals RFC ${TAG}`))
    record("visitor: a draft article is not listed", !html.includes(`Unpublished Draft ${TAG}`))
    record("visitor: a members-only article is not listed", !html.includes("Members Evening Details"))
    record("visitor: a live urgent announcement shows its priority as a word", (await page.locator("section[aria-labelledby=announcements]").innerText()).includes("Urgent") && html.includes("Pitches Closed Saturday"))
    record("visitor: an expired announcement is gone", !html.includes(`Expired Notice ${TAG}`))
    record("visitor: a members-only announcement is not shown", !html.includes(`Members AGM Tuesday ${TAG}`))
    record("visitor: team news carries its team", (await page.locator("section[aria-labelledby=team-news]").innerText()).includes("Under 14 Girls Reach County Final"))
    record("visitor: the Welcome to Ovalball article is on the page", html.includes("Welcome to Ovalball"))
    const hub = page.locator('a[href="/rugby-hub"]', { hasText: "Explore the Rugby Hub" })
    record("visitor: the Rugby Hub is advertised with a prominent link to its canonical route", (await hub.count()) === 1)
    record("visitor: no Manage News control for a signed-out visitor", (await page.getByRole("link", { name: "Manage News" }).count()) === 0)

    const heroBg = await page.locator("section[aria-labelledby=club-name]").evaluate((el) => getComputedStyle(el).backgroundColor)
    record("theme: the hero is the home kit's primary colour", heroBg === hex(CLUBS[0].primary), heroBg)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href")
    record("SEO: the homepage declares its canonical URL", Boolean(canonical?.endsWith(`/club/${harbourSlug}`)), canonical ?? "none")
    record("SEO: the homepage has a description and Open Graph title", (await page.locator('meta[name="description"]').count()) === 1 && (await page.locator('meta[property="og:title"]').count()) === 1)

    // Landmarks and keyboard.
    const landmarks = await page.evaluate(() => ({
      banner: document.querySelectorAll("body header:not(main header):not(article header)").length,
      main: document.querySelectorAll("main").length,
      contentinfo: document.querySelectorAll("body footer:not(main footer):not(article footer)").length,
    }))
    record("a11y: one banner, one main and one contentinfo landmark", landmarks.banner === 1 && landmarks.main === 1 && landmarks.contentinfo === 1, JSON.stringify(landmarks))
    await page.goto(home, { waitUntil: "networkidle" })
    await page.keyboard.press("Tab")
    const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim())
    record("a11y: the first Tab reaches Skip to content", firstFocus === "Skip to content", firstFocus)
    await page.keyboard.press("Tab")
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement)
      return { style: s.outlineStyle, width: s.outlineWidth }
    })
    record("a11y: keyboard focus draws a visible outline", ring.style !== "none" && ring.width !== "0px", JSON.stringify(ring))
    const unlabelledImages = await page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length)
    record("a11y: every image carries an alt attribute", unlabelledImages === 0, `missing=${unlabelledImages}`)
    const rail = page.locator('ul[aria-label^="Upcoming fixtures"]')
    record("interaction: the fixture rail is a focusable, labelled list", (await rail.count()) === 1 && (await rail.getAttribute("tabindex")) === "0")

    // Article page as the public reads and shares it.
    await page.goto(`${home}/news/clubhouse-refurbishment-${TAG}`, { waitUntil: "networkidle" })
    await page.screenshot({ path: path.join(SHOTS, "article-desktop.png"), fullPage: true })
    record("article: a published article renders its title, byline and formatted body", (await page.locator("h1").innerText()).includes("Clubhouse Refurbishment Complete") && (await page.locator("article strong").first().innerText()).includes("changing rooms") && (await page.locator("article h2").first().innerText()).includes("What has changed"))
    record("article: Open Graph type is article with the canonical URL", (await page.locator('meta[property="og:type"]').getAttribute("content")) === "article" && Boolean((await page.locator('link[rel="canonical"]').getAttribute("href"))?.endsWith(`/news/clubhouse-refurbishment-${TAG}`)))
    record("article: sharing offers Copy Link and ordinary share links", (await page.getByRole("button", { name: "Copy Link" }).count()) === 1 && (await page.locator('a[href^="https://wa.me/"]').count()) === 1)
    record("article: related articles link back into the club", (await page.locator("section[aria-labelledby=more-news] a").count()) >= 1)
    record("visitor: the homepage and article render with no console errors or hydration mismatches", errors.length === 0, errors.join(" | "))
    record("article: a draft's URL is not found", (await status(page, `${home}/news/unpublished-draft-${TAG}`)) === 404)
    record("article: a members-only article's URL is not found for a visitor", (await status(page, `${home}/news/members-evening-${TAG}`)) === 404)
    await ctx.close()
  }

  // ------------------------------------------------ every kit, every width
  for (const c of CLUBS) {
    for (const width of [320, 390, 768, 1280, 1600]) {
      const ctx = await newContext(browser, { width, height: 900 })
      const page = await ctx.newPage()
      const kitErrors = watchErrors(page)
      await page.goto(`${APP}/club/${slugOf(c)}`, { waitUntil: "networkidle" })
      await page.evaluate(CONTRAST)
      const over = await overflow(page)
      const hero = await page.locator("section[aria-labelledby=club-name]").evaluate((el) => {
        const h1 = el.querySelector("h1")
        const bg = getComputedStyle(el).backgroundColor
        return { ratio: window.__contrast(getComputedStyle(h1).color, bg), muted: window.__contrast(getComputedStyle(el.querySelector("p")).color, bg) }
      })
      const hubBand = await page.locator("section[aria-labelledby=rugby-hub]").evaluate((el) => window.__contrast(getComputedStyle(el).color, getComputedStyle(el).backgroundColor))
      const ok = over <= 0 && hero.ratio >= 4.5 && hero.muted >= 4.5 && hubBand >= 4.5 && kitErrors.length === 0
      record(`${c.key} @${width}px: no horizontal overflow, hero and Rugby Hub text clear 4.5:1, no console errors`, ok, `overflow=${over} hero=${hero.ratio.toFixed(2)} muted=${hero.muted.toFixed(2)} hub=${hubBand.toFixed(2)} errors=${kitErrors.length}`)
      if (width === 390 || width === 1280) await page.screenshot({ path: path.join(SHOTS, `${c.key}-${width}.png`), fullPage: width === 390 })
      if (width === 1280) {
        const plate = page.locator("section[aria-labelledby=club-name] span.grid").first()
        if (c.crest && crests) {
          const fit = await plate.evaluate((p) => {
            const img = p.querySelector("img")
            if (!img || !img.complete || img.naturalWidth === 0) return null
            const box = p.getBoundingClientRect()
            const r = img.getBoundingClientRect()
            return { objectFit: getComputedStyle(img).objectFit, inside: r.width <= box.width + 0.5 && r.height <= box.height + 0.5, natural: img.naturalWidth, rendered: r.width }
          })
          if (c.crest === "tiny") {
            record(`${c.key}: a crest too small to show well gives way to the club's shirt`, (await plate.locator('svg[role="img"]').count()) === 1 && (await plate.locator("img").count()) === 0)
          } else {
            record(`${c.key}: the ${c.crest} crest sits inside its plate undistorted`, Boolean(fit && fit.objectFit === "contain" && fit.inside), JSON.stringify(fit))
          }
        } else if (!c.crest) {
          record(`${c.key}: with no crest the plate shows the club's home shirt`, (await plate.locator('svg[role="img"]').count()) === 1)
        }
      }
      if (c.key === "chalk" && width === 390) {
        const text = await page.locator("main").innerText()
        record("empty club: a club with no fixtures, results or news still has a deliberate page", text.includes("Welcome to Ovalball") && text.includes("No upcoming fixtures published") && text.includes("The season starts here") && text.includes("Teams are on their way"))
      }
      await ctx.close()
    }
  }
  if (!crests) record("crests: shape checks skipped because SUPABASE_SECRET_KEY was not provided", true)

  // ---------------------------------------------------------------- Club Admin
  let publishedUrl = null
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    await signIn(page, email("admin"))

    // The club desk on the dashboard.
    const deskErrors = watchErrors(page)
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
    const desk = await readDesk(page)
    await page.screenshot({ path: path.join(SHOTS, "dashboard-admin-1280.png"), fullPage: true })
    record("dashboard: the Club Admin's dashboard wears the club's home kit and names the club", desk.h1.includes("Harbour Vale RUFC") && desk.headerBg === hex(CLUBS[0].primary), `${desk.h1} ${desk.headerBg}`)
    record("dashboard: the dashboard's own work is still there -- This Week lists the club's fixtures", desk.mainText.includes("This Week") && desk.mainText.includes("Northgate RFC"))
    record("dashboard: an urgent club notice is pinned above the viewer's work, and not repeated in the rail", desk.urgentBeforeWeek && !desk.urgentInRail)
    record("dashboard: the club rail carries notices, news, the Rugby Hub and the club page", desk.asideText.includes("Club Notices") && desk.asideText.includes(`Members AGM Tuesday ${TAG}`) && desk.asideText.includes("Club News") && desk.asideText.includes("Explore the Rugby Hub") && desk.asideText.includes("View Club Page"))
    record("dashboard: Manage News takes a Club Admin to the club's console", desk.manageHref === "/club/settings/news", String(desk.manageHref))
    const chip = page.getByRole("link", { name: /Your Next Match/ })
    const chipText = (await chip.count()) ? await chip.innerText() : ""
    record("dashboard: Your Next Match skips a holiday block and a cancelled fixture", chipText.includes("Northgate RFC") && !chipText.includes("Half Term") && !chipText.includes("Called Off"), chipText.replace(/\s+/g, " "))
    const holidayRow = page.locator("main li", { hasText: `Half Term ${TAG}` })
    record("dashboard: a holiday block in This Week is shown, but is not a link to a Match Centre it does not have", (await holidayRow.count()) === 1 && (await holidayRow.locator("a").count()) === 0)
    await chip.click()
    await page.waitForURL(/\/fixtures\/[0-9a-f-]{36}/, { timeout: 30000 })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.screenshot({ path: path.join(SHOTS, "dashboard-next-match-centre.png"), fullPage: true })
    // Identity, not page text: Match Centre names the opponent from its canonical
    // opponent link, so free-text opposition is not a reliable thing to look for.
    const expectedFixture = one(`select id from fixtures where owning_team_id='${seeded.u12}' and raw_opposition_text='Northgate RFC'`)
    const openedFixture = new URL(page.url()).pathname.split("/").pop()
    record("dashboard: Your Next Match opens that exact fixture's Match Centre", openedFixture === expectedFixture, `opened ${openedFixture}, expected ${expectedFixture}`)
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
    await page.getByRole("link", { name: /View Club Page/ }).click()
    await page.waitForURL(new RegExp(`/club/${harbourSlug}$`), { timeout: 30000 })
    record("dashboard: View Club Page opens the club's canonical public page", (await page.locator("h1").innerText()).includes("Harbour Vale RUFC"), page.url())
    record("dashboard: the dashboard does not overflow at desktop width", desk.overflow <= 0, `overflow=${desk.overflow}`)
    const ownDeskErrors = deskErrors.filter((e) => !/Encountered a script tag/.test(e))
    record("dashboard: the club desk renders with no console errors of its own", ownDeskErrors.length === 0, ownDeskErrors.join(" | "))
    {
      const mobile = await newContext(browser, { width: 390, height: 844 })
      const m = await mobile.newPage()
      await signIn(m, email("admin"))
      await m.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
      const small = await readDesk(m)
      await m.screenshot({ path: path.join(SHOTS, "dashboard-admin-390.png"), fullPage: true })
      record("dashboard @390px: urgent notice, then the viewer's week, then the club rail, with no overflow", small.urgentBeforeWeek && small.weekBeforeRail && small.overflow <= 0, `overflow=${small.overflow}`)
      const contained = await m.evaluate(() => {
        const plate = document.querySelector("main header span.grid")
        const mark = plate?.querySelector("img, svg")
        if (!plate || !mark) return null
        const p = plate.getBoundingClientRect()
        const r = mark.getBoundingClientRect()
        return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5
      })
      record("dashboard @390px: the crest stays inside its plate", contained === true, String(contained))
      await mobile.close()
    }

    await page.goto(`${APP}/club/settings/news`, { waitUntil: "networkidle" })
    const list = await page.locator("main").innerText()
    record("Club Admin: News & Announcements lists every article in scope, drafts and team news included", list.includes(`Unpublished Draft ${TAG}`) && list.includes("Under 14 Girls Reach County Final") && list.includes("Written by Ovalball"))
    record("Club Admin: the Club Settings tab strip includes News & Announcements", (await page.locator('nav[aria-label="Club Settings sections"] a', { hasText: "News & Announcements" }).count()) === 1)

    const editorErrors = watchErrors(page)
    await page.getByRole("link", { name: "Write an Article" }).click()
    await page.waitForURL(/\/club\/settings\/news\/new/)
    await page.getByLabel("Headline").fill(`Under 12s Win the Festival ${TAG}`)
    await page.getByLabel("Summary").fill("Four games, four wins, and a lot of mud.")
    const body = page.getByLabel("Article")
    await body.click()
    await body.type("A brilliant morning for the whole squad.\n\n")
    await page.getByRole("button", { name: "Bold" }).click()
    // The toolbar selects its placeholder on the next frame; a person cannot type faster than that.
    await page.waitForFunction(() => {
      const el = document.getElementById("article-body")
      return el && el.selectionEnd - el.selectionStart === "bold text".length
    })
    await page.keyboard.type("Player of the day")
    record("Club Admin: the Bold button wraps what is typed next", (await body.inputValue()).includes("**Player of the day**"), await body.inputValue())
    await page.locator("#article-team").selectOption({ label: "Under 12 Boys" })
    await page.getByRole("button", { name: "Preview" }).click()
    const preview = page.locator("article").first()
    record("Club Admin: Preview renders the article exactly as published, formatting included", (await preview.locator("strong", { hasText: "Player of the day" }).count()) === 1)
    await page.screenshot({ path: path.join(SHOTS, "editor-preview.png"), fullPage: true })
    // The authenticated app shell logs one pre-existing warning about an inline theme script; it is not this feature's.
    const ownErrors = editorErrors.filter((e) => !/Encountered a script tag/.test(e))
    record("Club Admin: the editor renders with no console errors of its own", ownErrors.length === 0, ownErrors.join(" | "))
    await page.getByRole("button", { name: "Write" }).click()
    await page.getByRole("button", { name: "Publish" }).click()
    await page.waitForURL(/\/club\/settings\/news\/[0-9a-f-]{36}/, { timeout: 30000 })
    await page.getByText("Live at").waitFor({ timeout: 30000 })
    publishedUrl = (await page.locator("p", { hasText: "Live at" }).locator("span").innerText()).trim()
    record("Club Admin: Publish produces a live public link with Copy Link beside it", /\/club\/.+\/news\/under-12s-win-the-festival/.test(publishedUrl) && (await page.getByRole("button", { name: "Copy Link" }).count()) >= 1, publishedUrl)

    // Edit the headline: the shared link must keep working.
    await page.getByLabel("Headline").fill(`Under 12s Win the Spring Festival ${TAG}`)
    await page.getByRole("button", { name: "Publish Changes" }).click()
    await page.getByText("Changes published.").waitFor({ timeout: 30000 })
    await page.getByRole("button", { name: "Make Lead Story" }).click()
    await page.getByText("Now the lead story.").waitFor({ timeout: 30000 })

    // An announcement.
    await page.goto(`${APP}/club/settings/news/announcements/new`, { waitUntil: "networkidle" })
    await page.getByLabel("Title").fill(`Kit Sale This Sunday ${TAG}`)
    await page.getByLabel("Important").check()
    await page.getByRole("button", { name: "Publish" }).click()
    await page.waitForURL(/announcements\/[0-9a-f-]{36}/, { timeout: 30000 })
    await ctx.close()

    const anon = await newContext(browser, { width: 390, height: 844 })
    const a = await anon.newPage()
    await a.goto(publishedUrl.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: "networkidle" })
    record("share: the copied link opens for a signed-out visitor, with the corrected headline", (await a.locator("h1").innerText()).includes(`Under 12s Win the Spring Festival ${TAG}`))
    await a.screenshot({ path: path.join(SHOTS, "published-article-390.png"), fullPage: true })
    await a.goto(home, { waitUntil: "networkidle" })
    const leadText = await a.locator("section[aria-labelledby=news] article").first().innerText()
    record("homepage: the new lead story leads Latest News", leadText.includes(`Under 12s Win the Spring Festival ${TAG}`))
    record("homepage: the published announcement appears for the public", (await a.locator("main").innerText()).includes(`Kit Sale This Sunday ${TAG}`))
    record("mobile: the homepage does not overflow after publishing", (await overflow(a)) <= 0)
    await anon.close()

    // Archive it: the link stops resolving publicly.
    const ctx2 = await newContext(browser, { width: 1280, height: 900 })
    const p2 = await ctx2.newPage()
    await signIn(p2, email("admin"))
    const articleId = one(`select id from club_articles where club_id='${seeded.harbour}' and slug like 'under-12s-win-the-festival%' limit 1`)
    await p2.goto(`${APP}/club/settings/news/${articleId}`, { waitUntil: "networkidle" })
    await p2.getByRole("button", { name: "Archive", exact: true }).click()
    record("archive: archiving asks for confirmation before it happens", (await p2.getByRole("button", { name: "Confirm Archive" }).count()) === 1)
    await p2.getByRole("button", { name: "Confirm Archive" }).click()
    await p2.getByText("Archived.").waitFor({ timeout: 30000 })
    await ctx2.close()
    const anon2 = await newContext(browser)
    const a2 = await anon2.newPage()
    record("archive: an archived article's public link is no longer found", (await status(a2, publishedUrl.replace(/^https?:\/\/[^/]+/, APP))) === 404)
    await anon2.close()
  }

  // ---------------------------------------------------------------- coach
  {
    const ctx = await newContext(browser, { width: 390, height: 844 })
    const page = await ctx.newPage()
    await signIn(page, email("coach"))
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
    const coachDesk = await readDesk(page)
    await page.screenshot({ path: path.join(SHOTS, "dashboard-coach-390.png"), fullPage: true })
    record("dashboard: a coach's dashboard is their club's desk, naming their team", coachDesk.h1.includes("Harbour Vale RUFC") && coachDesk.headerText.includes("Under 12 Boys"), coachDesk.headerText.replace(/\s+/g, " ").slice(0, 120))
    record("dashboard: Manage News takes a coach to their own team's news", coachDesk.manageHref === `/teams/${seeded.u12}/news`, String(coachDesk.manageHref))
    await page.goto(`${APP}/teams/${seeded.u12}`, { waitUntil: "networkidle" })
    record("coach: the team page offers Team News", (await page.getByRole("link", { name: /Team News/ }).count()) === 1)
    await page.goto(`${APP}/teams/${seeded.u12}/news/new`, { waitUntil: "networkidle" })
    record("coach: the team is fixed to their own team", (await page.locator("#article-team").innerText()).includes("Under 12 Boys"))
    await page.getByLabel("Headline").fill(`Training Moves to Thursday ${TAG}`)
    await page.getByLabel("Article").fill("Same time, same place, different day.")
    await page.getByRole("button", { name: "Publish" }).click()
    await page.getByText("Live at").waitFor({ timeout: 30000 })
    record("coach: a coach can publish their team's news", true)

    await page.goto(`${APP}/club/settings/news`, { waitUntil: "networkidle" })
    record("coach: the club's own console is not available to a coach", !/\/club\/settings\/news$/.test(new URL(page.url()).pathname), page.url())
    await page.goto(`${APP}/teams/${seeded.u14}/news`, { waitUntil: "networkidle" })
    record("coach: another team's news console is not available", !new URL(page.url()).pathname.endsWith(`/teams/${seeded.u14}/news`), page.url())
    await ctx.close()

    const anon = await newContext(browser)
    const a = await anon.newPage()
    await a.goto(home, { waitUntil: "networkidle" })
    const teamNews = await a.locator("section[aria-labelledby=team-news]").innerText()
    record("homepage: no story appears in both Latest News and Team News", !(await a.locator("section[aria-labelledby=news]").innerText()).includes("Under 14 Girls Reach County Final"))
    record("homepage: the coach's article appears in Team News with its team", teamNews.includes(`Training Moves to Thursday ${TAG}`) && teamNews.includes("Under 12 Boys"))
    const filter = a.getByRole("button", { name: "Under 14 Girls" })
    if ((await filter.count()) === 1) {
      await filter.click()
      const filtered = await a.locator("section[aria-labelledby=team-news] ul").innerText()
      record("interaction: the team filter narrows Team News and says so with aria-pressed", !filtered.includes(`Training Moves to Thursday ${TAG}`) && (await filter.getAttribute("aria-pressed")) === "true")
    } else {
      record("interaction: the team filter narrows Team News", false, "filter button missing")
    }
    await anon.close()
  }

  // ---------------------------------------------------------------- member
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    await signIn(page, email("member"))
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
    const memberDesk = await readDesk(page)
    record("dashboard: a member sees the club's members-only notices and news in the rail", memberDesk.asideText.includes(`Members AGM Tuesday ${TAG}`) && memberDesk.asideText.includes("Members Evening Details"), memberDesk.asideText.slice(0, 300))
    record("dashboard: an ordinary member gets no Manage News, and keeps the dashboard's own guidance", memberDesk.manageHref === null && memberDesk.mainText.includes("No team assigned yet"))
    record("dashboard: a member's desk names their club and them as a member, never 'Ovalball'", memberDesk.h1.includes("Harbour Vale RUFC") && memberDesk.headerText.includes("Member") && !memberDesk.headerText.includes("Ovalball"), memberDesk.headerText.slice(0, 120))
    await page.goto(home, { waitUntil: "networkidle" })
    const text = await page.locator("main").innerText()
    record("member: members-only news and notices appear for a club member", text.includes("Members Evening Details") && text.includes(`Members AGM Tuesday ${TAG}`))
    const friendlyShown = text.includes(`Friendly Rivals RFC ${TAG}`)
    record("member: any result shown from the member's own fixture access is labelled as such", !friendlyShown || text.includes("Some of these results are shown because you are signed in"), friendlyShown ? "shown with note" : "not admitted by this member's fixture policy")
    record("member: no Manage News control for an ordinary member", (await page.getByRole("link", { name: "Manage News" }).count()) === 0)
    record("member: the members-only article opens", (await status(page, `${home}/news/members-evening-${TAG}`)) === 200)
    record("member: members-only articles tell search engines not to index them", (await page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") ?? false)
    await page.goto(`${APP}/club/settings/news`, { waitUntil: "networkidle" })
    record("member: the publishing console is not available", !/\/club\/settings\/news$/.test(new URL(page.url()).pathname), page.url())
    await ctx.close()
  }

  // ------------------------------------------- parent, player, family, multi-club, Site Admin
  {
    const roleCheck = async (who, width = 1280) => {
      const ctx = await newContext(browser, { width, height: 900 })
      const page = await ctx.newPage()
      await signIn(page, email(who))
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
      const d = await readDesk(page)
      const facts = await page.evaluate(() => ({
        deskRail: Boolean(document.querySelector('aside[aria-label="Club news and notices"]')),
        yourClubs: document.querySelector('aside[aria-label="Your clubs"]')?.textContent ?? "",
        h1: document.querySelector("main h1")?.textContent ?? "",
      }))
      await page.screenshot({ path: path.join(SHOTS, `dashboard-${who}-${width}.png`), fullPage: true })
      await ctx.close()
      return { ...d, ...facts }
    }

    const parent = await roleCheck("parent", 390)
    record("dashboard: a parent keeps the children panel and gets their club's desk", parent.deskRail && parent.h1.includes("Harbour Vale RUFC") && /coming up|your children/i.test(parent.mainText) && parent.overflow <= 0, parent.mainText.slice(0, 160))

    const player = await roleCheck("player")
    record("dashboard: a player gets their club's desk with the club rail", player.deskRail && player.h1.includes("Harbour Vale RUFC"), player.headerText.slice(0, 120))

    const family = await roleCheck("family")
    record("dashboard: All Children spans two clubs, so it lists Your Clubs instead of one club's branding", !family.deskRail && family.yourClubs.includes("Harbour Vale RUFC") && family.yourClubs.includes("Saffron Hill RFC") && !family.h1.includes("Harbour Vale RUFC"), `${family.h1} | ${family.yourClubs.slice(0, 120)}`)

    const multi = await roleCheck("multiclub")
    record("dashboard: a member of two clubs gets Your Clubs, not an arbitrary club's desk", !multi.deskRail && multi.yourClubs.includes("Harbour Vale RUFC") && multi.yourClubs.includes("Saffron Hill RFC"), multi.yourClubs.slice(0, 120))

    const admin = await roleCheck("siteadmin")
    record("dashboard: Site Admin keeps its own Platform dashboard, with no club desk", admin.h1.includes("Platform") && !admin.deskRail && !admin.yourClubs, admin.h1)
  }

  // ---------------------------------------------------------- another club
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    await signIn(page, email("otheradmin"))
    const foreign = one(`select id from club_articles where club_id='${seeded.harbour}' and slug='clubhouse-refurbishment-${TAG}'`)
    const code = await status(page, `${APP}/club/settings/news/${foreign}`)
    record("another club's admin: this club's article cannot be opened for editing", code === 404, `status=${code}`)
    await page.goto(`${APP}/club/${harbourSlug}`, { waitUntil: "networkidle" })
    record("another club's admin: no Manage News on a club that is not theirs", (await page.getByRole("link", { name: "Manage News" }).count()) === 0)
    await ctx.close()
  }
} catch (error) {
  record("run completed without an unexpected error", false, String(error?.stack ?? error))
} finally {
  if (browser) await browser.close()
  try {
    await cleanup()
  } catch (e) {
    record("cleanup ran", false, String(e))
  }
  console.log(`\nScreenshots: ${SHOTS}`)
  process.exit(summarise() ? 0 : 1)
}
