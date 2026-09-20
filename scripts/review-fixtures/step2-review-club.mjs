#!/usr/bin/env node
// =====================================================================
// THE CANONICAL LOCAL UAT REVIEW WORLD.
//
// Established for the Step 2 manual review and then made PERMANENT: these are
// the product owner's standing review personas for the rest of the convergence
// programme, not per-step scaffolding. The point is continuity -- reviewing
// navigation, then permissions, then fixtures, then Match Centre and
// recognising the SAME people in the SAME club each time is how you can see
// whether Ovalball itself is converging. A fresh cast per slice destroys that.
//
// So: reuse and ENRICH this world rather than standing up a parallel one. A
// later step needing fixtures, training, availability, messages, competitions or
// another child adds them HERE, through canonical product writes. A genuinely
// new persistent identity is justified only when no existing persona can
// legitimately represent the context, and is then documented in the canonical
// directory alongside the rest:
//
//   docs/product/STEP_2_MANUAL_REVIEW_WALKTHROUGH.md
//
// `down` is NOT ordinary post-review cleanup -- see the guard on it.
//
// AUTOMATED TESTS MUST NOT DEPEND ON THIS. Every suite seeds and cleans its own
// isolated fixtures; permanent manual-review data and automated-test data are
// separate concepts, and a suite that reads whichever row happens to sort first
// is broken by definition. `recipient_audience_engine.sql` was exactly that and
// was corrected rather than accommodated.
//
// The product owner reviews Step 2 by hand, in Chrome, against a running
// local stack. A quiet club renders almost every Users & Permissions surface
// as an empty state, so this builds one club with somebody at every door:
// three teams, the three club roles, a Volunteer, staff at two teams, a
// guardian and child, a capability override, a waiting invitation, both
// kinds of join request, and a Safeguarding Officer nomination sitting in
// PENDING_CONFIRMATION.
//
// EVERYTHING IS LOCAL AND DISPOSABLE. Every identity is review.*@ovalball.test
// and the club is "Step 2 Review RFC". No production data is touched, no
// production identity is created, and no authority is widened to make a
// demonstration easier -- every grant below is one the product itself makes,
// through the RPC that owns it, in the review Club Admin's own session.
//
//   node scripts/review-fixtures/step2-review-club.mjs up
//   node scripts/review-fixtures/step2-review-club.mjs report
//   node scripts/review-fixtures/step2-review-club.mjs down --destroy-the-canonical-review-world
//
// EVERYTHING HERE IS LOCAL AND DISPOSABLE IN THE SENSE THAT IT IS NOT
// PRODUCTION -- never in the sense that it is throwaway. No production data is
// touched, no production identity is created, every address is
// review.step2.*@ovalball.test, and no authority is ever widened to make a
// demonstration easier: every grant below is made by the product's own RPC in
// the review Club Admin's session.
// =====================================================================

import { execFileSync } from "node:child_process"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const KEY = "step2-review-rfc"
const CLUB_NAME = "Step 2 Review RFC"
const DOMAIN = "review.step2"
const E = (n) => `${DOMAIN}.${n}@ovalball.test`

/** Everyone the review needs, and why they exist. */
const PEOPLE = [
  ["admin", "Hannah", "Whitmore", "CLUB_ADMIN", "The review login. Club Admin of the review club."],
  ["secretary", "Gordon", "Pike", "FIXTURE_SECRETARY", "The third club-wide role, so all three are visible at once."],
  ["coach", "Dev", "Raman", "BASIC_USER", "Staff at TWO teams -- Coach at one, Manager at another."],
  ["manager", "Sian", "Lowry", "BASIC_USER", "Team Manager of Men's 1st. The team-scoped review login."],
  ["member", "Tomas", "Beck", "BASIC_USER", "The safe one: role changes and team-role add/remove happen here."],
  ["volunteer", "Nadia", "Oyelaran", "BASIC_USER", "Holds the Volunteer role assignment. See section 9 of the walkthrough."],
  ["guardian", "Marta", "Ferreira", "BASIC_USER", "Guardian of Leo Ferreira."],
  ["officer", "Priya", "Devlin", "BASIC_USER", "Nominated Safeguarding Officer, awaiting Ovalball confirmation."],
  ["overridden", "Karl", "Ndlovu", "BASIC_USER", "An ordinary member with ONE capability granted directly."],
]

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`)

function identity(slug, first, last, dob = "1986-09-03") {
  const email = E(slug)
  // Reused if it already exists. A review identity that has acted leaves rows in
  // `public.audit_log`, which is append-only BY DESIGN -- its history cannot be
  // changed or deleted, so neither can the auth.users row it names. Teardown
  // therefore leaves the account behind with no membership anywhere, and this
  // picks it up again rather than colliding on the unique address.
  const id = sql(`
    with existing as (select id from auth.users where email = ${q(email)}),
    created as (
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
        reauthentication_token)
      select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        ${q(email)}, '', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', ''
      where not exists (select 1 from existing)
      returning id
    ) select id::text from (select id from existing union all select id from created) both_`)
  // A date of birth is not decoration: the O.1 safeguarding rule refuses Coach
  // and Team Manager to anybody whose record does not show they are an adult.
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
       values (${q(id)}, ${q(first)}, ${q(last)}, ${q(email)}, ${q(dob)}, 'ACTIVE')
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname,
         date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE'`)
  sql(`select internal.refresh_account_security_state(${q(id)})`)
  return id
}

/** Runs a statement inside a named person's authenticated session, as the product would. */
function asPerson(userId, statement) {
  return sql(`
    do $$ declare v uuid := gen_random_uuid();
    begin
      insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, ${q(userId)}, now(), now(), 'aal1');
      perform set_config('request.jwt.claims', jsonb_build_object('sub', ${q(userId)}, 'role', 'authenticated', 'session_id', v)::text, false);
    end $$;
    ${statement}`)
}

function up() {
  down({ quiet: true })

  const dirId = sql(`
    insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values (${q(CLUB_NAME)}, 'Harrogate', 'North Yorkshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', ${q(KEY)})
    returning id`)
  const clubId = sql(`insert into public.clubs (directory_id, slug, status) values (${q(dirId)}, ${q(KEY)}, 'active') returning id`)

  // Three teams, so "which team?" is a real question on every screen.
  const team = (key, displayName) => {
    const ctt = sql(`select id from public.canonical_team_types where key = ${q(key)} and is_active limit 1`)
    if (!ctt) throw new Error(`no canonical team type for ${key}`)
    const row = sql(`select category || '|' || coalesce(age_group,'') || '|' || coalesce(gender,'') || '|' || coalesce(fixed_squad_designation,'')
                     from public.canonical_team_types where id = ${q(ctt)}`).split("|")
    return sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code,
                  canonical_team_type_id, squad_designation, active)
                values (${q(clubId)}, ${q(displayName)}, ${q(`${KEY}-${key}`)}, ${q(row[0])}, ${q(row[1] || null)},
                  ${q(row[2] || null)}, 'union', ${q(ctt)}, ${q(row[3] || null)}, true) returning id`)
  }
  const teams = {
    u12: team("u12", "Under 12 Boys"),
    u14g: team("girls_u14", "Under 14 Girls"),
    mens1: team("mens_1st", "Men's Open Age"),
  }

  const ids = {}
  for (const [slug, first, last, role] of PEOPLE) {
    ids[slug] = identity(slug, first, last)
    sql(`insert into public.club_memberships (club_id, user_id, role, status)
         values (${q(clubId)}, ${q(ids[slug])}, ${q(role)}, 'active')`)
  }
  const membershipOf = (slug) =>
    sql(`select id from public.club_memberships where club_id = ${q(clubId)} and user_id = ${q(ids[slug])}`)

  // --- Team staff, through set_team_access, in the Club Admin's own session.
  asPerson(ids.admin, `
    select public.set_team_access(${q(membershipOf("coach"))}, ${q(teams.u12)}, 'coach', 'Review fixture: coaches the U12s.');
    select public.set_team_access(${q(membershipOf("coach"))}, ${q(teams.u14g)}, 'manager', 'Review fixture: manages the U14 Girls.');
    select public.set_team_access(${q(membershipOf("manager"))}, ${q(teams.mens1)}, 'manager', 'Review fixture: manages the Men''s side.');`)

  // --- The Volunteer role assignment. There is no capability bundle behind
  //     VOLUNTEER today (role_capability_defaults has no rows for it), so this
  //     records the role honestly and grants exactly what the product grants:
  //     nothing beyond ordinary membership. See walkthrough section E.
  sql(`insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason)
       values (${q(ids.volunteer)}, ${q(clubId)}, ${q(membershipOf("volunteer"))}, 'VOLUNTEER', 'ACTIVE',
               'CLUB_ADMIN_ASSIGNMENT', ${q(ids.admin)}, 'Review fixture: helps on match days.')`)

  // --- One capability granted directly, so "why?" has something to say other
  //     than "their role includes it".
  asPerson(ids.admin, `
    select public.set_capability_override(${q(ids.overridden)}, 'fixture.fixture.create', 'club', ${q(clubId)}, null,
      'grant', 'Review fixture: runs the club''s friendly fixtures.');`)

  // --- A guardian and a child, with the child in a squad.
  const playerId = sql(`insert into public.players (first_name, surname, date_of_birth, active, created_by, playing_pathway)
    values ('Leo', 'Ferreira', (current_date - interval '11 years')::date, true, ${q(ids.guardian)}, 'MALE') returning id`)
  sql(`insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by, approved_by, approved_at)
       values (${q(ids.guardian)}, ${q(playerId)}, 'parent', 'active', 'ACTIVE', 'CLUB_CREATED', ${q(ids.admin)}, ${q(ids.admin)}, now())`)
  sql(`insert into public.player_team_memberships (player_id, team_id, status, state, source, created_by, approved_by, approved_at)
       values (${q(playerId)}, ${q(teams.u12)}, 'active', 'ACTIVE', 'CLUB_CREATED', ${q(ids.admin)}, ${q(ids.admin)}, now())`)

  // --- A Safeguarding Officer nomination, through the real state machine.
  //     It stops at PENDING_CONFIRMATION and grants zero SO authority.
  const nomination = asPerson(ids.admin, `
    select public.nominate_club_safeguarding_officer(${q(clubId)}, ${q(ids.officer)}, 'primary',
      'Review fixture: nominated, awaiting Ovalball confirmation.')::text;`).split("\n").pop()

  // --- A waiting invitation carrying a DIFFERENT role at each of two teams.
  const inviteeEmail = E("invitee")
  asPerson(ids.admin, `
    select 1 from public.issue_invitation('CLUB_STAFF', ${q(clubId)}, null, null, null, null, ${q(inviteeEmail)},
      '{}'::jsonb, null, null,
      jsonb_build_array(jsonb_build_object('id', ${q(teams.u12)}, 'roles', jsonb_build_array('TEAM_MANAGER')),
                        jsonb_build_object('id', ${q(teams.mens1)}, 'roles', jsonb_build_array('COACH'))));`)

  // --- Somebody asking for club access (the queue on Users & Permissions).
  const applicantId = identity("applicant", "Rowan", "Ashby")
  sql(`insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
       values (${q(clubId)}, ${q(applicantId)}, 'BASIC_USER', 'pending')`)

  // --- And a PLAYER asking to join, which is a different queue on its own page.
  const waitingParent = identity("waitingparent", "Alina", "Kovac")
  const waitingPlayer = sql(`insert into public.players (first_name, surname, date_of_birth, active, created_by, playing_pathway)
    values ('Mina', 'Kovac', (current_date - interval '13 years')::date, true, ${q(waitingParent)}, 'FEMALE') returning id`)
  sql(`insert into public.player_club_join_requests (player_id, club_id, requested_by, status)
       values (${q(waitingPlayer)}, ${q(clubId)}, ${q(waitingParent)}, 'pending')`)

  return { clubId, teams, ids, playerId, nomination, inviteeEmail }
}

/**
 * CONVERGENCE STEP 6 — enrich, never rebuild.
 *
 * Step 6 reviews club onboarding and canonical club/venue/team data, and the
 * review club had a crest, a kit and three teams but NO GROUND — so every venue,
 * pitch, address and fixture-location surface rendered an empty state.
 *
 * This is additive and idempotent. It never calls `down()`, never touches a
 * person, a team, a role or a membership, and skips anything already present, so
 * the product owner's own manual changes survive it.
 *
 * EVERY WRITE GOES THROUGH THE CANONICAL RPCs, as the review Club Admin. That is
 * not ceremony: Step 6 found that the seed files insert venue rows directly and
 * produce a row the product cannot produce — a full structured address with no
 * derived display line — which was then read as a product defect. A fixture that
 * bypasses the product's own writers will keep manufacturing findings like that.
 */
function enrich() {
  const clubId = sql(`select c.id from public.clubs c
                      join public.club_directory d on d.id = c.directory_id
                      where d.normalized_key = ${q(KEY)} limit 1`)
  if (!clubId) {
    console.error(`No "${CLUB_NAME}" found. Run \`up\` first — this command enriches, it does not create.`)
    process.exit(1)
  }
  const adminId = sql(`select id from public.profiles where email = ${q(E("admin"))}`)
  if (!adminId) {
    console.error("The review Club Admin is missing; the world is incomplete.")
    process.exit(1)
  }

  const existing = Number(sql(`select count(*) from public.venues where club_id = ${q(clubId)}`))
  if (existing > 0) {
    console.log(`${CLUB_NAME} already has ${existing} venue(s) — nothing to add.`)
    return
  }

  /** One statement, as the review Club Admin, through the product's own authority. */
  const asAdmin = (statement) =>
    sql(`do $$
         begin
           perform set_config('request.jwt.claims',
             jsonb_build_object('sub', ${q(adminId)}, 'role', 'authenticated')::text, true);
           set local role authenticated;
           ${statement}
           reset role;
         end $$;`)

  // The default home ground, with a structured address and two pitches — a club
  // with more than one pitch is what makes allocation and "which pitch?" real.
  asAdmin(`
    declare v_venue uuid;
    begin
      v_venue := public.create_venue(${q(clubId)}, 'Claro Road', 'Turn in past the clubhouse; visitor parking on the left.', true);
      perform public.set_venue_address(v_venue, 'Claro Road', '', 'Harrogate', 'North Yorkshire', 'HG1 4AF', 'United Kingdom');
      perform public.create_club_pitch(${q(clubId)}, 'Main Pitch', 'Floodlit, posts up all season.', v_venue);
      perform public.create_club_pitch(${q(clubId)}, 'Second Pitch', 'Used for minis on Sunday mornings.', v_venue);
    end;`)

  // A SECOND ground, so "default venue" is a choice rather than the only option
  // and a fixture can be put at the wrong one.
  asAdmin(`
    declare v_venue uuid;
    begin
      v_venue := public.create_venue(${q(clubId)}, 'Pannal Playing Fields', 'Council pitches; no clubhouse.', false);
      perform public.set_venue_address(v_venue, 'Station Road', '', 'Pannal', 'North Yorkshire', 'HG3 1JR', 'United Kingdom');
      perform public.create_club_pitch(${q(clubId)}, 'Pannal Pitch', null, v_venue);
    end;`)

  const venues = sql(`select count(*) from public.venues where club_id = ${q(clubId)}`)
  const pitches = sql(`select count(*) from public.club_pitches where club_id = ${q(clubId)}`)
  const derived = sql(`select count(*) from public.venues
                        where club_id = ${q(clubId)} and address is not null`)
  console.log(`${CLUB_NAME}: ${venues} venue(s), ${pitches} pitch(es), ${derived} with a derived address line.`)
  console.log("Added through create_venue / set_venue_address / create_club_pitch as the review Club Admin.")
}

/**
 * STEP 7 -- FIXTURE OPERATIONS EXAMPLES, ADDED TO THIS WORLD RATHER THAN BESIDE IT.
 *
 * The review club already has people, roles, teams and two grounds. What it had
 * no examples of was the thing Step 7 is about: a season with fixtures in it, at
 * different grounds, of different kinds, some played and some not, so that the
 * Control Centre, the Calendar, Fixture Search, Match Centre and Pitch
 * Allocation all have something real to show.
 *
 * Written through the canonical writers as the review Club Admin, so every
 * record is one the product itself would have created -- never a direct insert
 * that skips a rule and then reads as a product defect later.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE. If the club already has fixtures, this adds
 * nothing and says so: the product owner's own fixtures are review material,
 * not something for a script to tidy.
 */
function enrichFixtures() {
  const clubId = sql(`select c.id from public.clubs c
                      join public.club_directory d on d.id = c.directory_id
                      where d.normalized_key = ${q(KEY)} limit 1`)
  if (!clubId) {
    console.error(`No "${CLUB_NAME}" found. Run \`up\` first.`)
    process.exit(1)
  }
  const adminId = sql(`select id from public.profiles where email = ${q(E("admin"))}`)
  if (!adminId) {
    console.error("The review Club Admin is missing; the world is incomplete.")
    process.exit(1)
  }

  const existing = Number(sql(`select count(*) from public.fixtures f
    join public.teams t on t.id = f.owning_team_id where t.club_id = ${q(clubId)}`))
  if (existing > 0) {
    console.log(`${CLUB_NAME} already has ${existing} fixture(s) -- nothing added. Those are review material, not clutter.`)
    return
  }

  const asAdmin = (statement) =>
    sql(`do $$
         begin
           perform set_config('request.jwt.claims',
             jsonb_build_object('sub', ${q(adminId)}, 'role', 'authenticated')::text, true);
           set local role authenticated;
           ${statement}
           reset role;
         end $$;`)

  const u12 = sql(`select id from public.teams where club_id = ${q(clubId)} and display_name = 'Under 12 Boys' limit 1`)
  const u14g = sql(`select id from public.teams where club_id = ${q(clubId)} and display_name = 'Under 14 Girls' limit 1`)
  const mens = sql(`select id from public.teams where club_id = ${q(clubId)} and display_name like 'Men%' limit 1`)
  const claro = sql(`select id from public.venues where club_id = ${q(clubId)} and name = 'Claro Road' limit 1`)
  const pannal = sql(`select id from public.venues where club_id = ${q(clubId)} and name = 'Pannal Playing Fields' limit 1`)
  const mainPitch = sql(`select id from public.club_pitches where venue_id = ${q(claro)} and display_name = 'Main Pitch' limit 1`)
  const secondPitch = sql(`select id from public.club_pitches where venue_id = ${q(claro)} and display_name = 'Second Pitch' limit 1`)
  const pannalPitch = sql(`select id from public.club_pitches where venue_id = ${q(pannal)} limit 1`)
  if (!u12 || !claro || !mainPitch) {
    console.error("The review club is missing the teams or grounds these fixtures hang on. Run `enrich` first.")
    process.exit(1)
  }

  // Opponents from the real Club Directory -- never invented names. One of them
  // is an Ovalball tenant where possible, so "ask the other club" is reviewable.
  const opponents = sql(`select string_agg(id::text, ',') from (
      select id from public.club_directory
      where active and rugby_code = 'union' and id <> (select directory_id from public.clubs where id = ${q(clubId)})
      order by name limit 4) x`).split(",").filter(Boolean)

  /**
   * Six fixtures: two match days at the default ground on the same morning (so
   * Pitch Allocation has something to arrange and a clash to show), one at the
   * second ground, one away, one already played with a real recorded result,
   * and one still to be determined -- which is what the Control Centre's
   * attention band is for.
   *
   * `create_fixture` returns the row it made, so the result on the past fixture
   * is recorded through `submit_fixture_result` on that id -- the canonical
   * writer, not an UPDATE that would skip the rule.
   */
  const plan = [
    { team: u12, side: "Home", day: 7, time: "10:30", type: "League Fixture", venue: claro, pitch: mainPitch, status: "Booked" },
    { team: u14g || u12, side: "Home", day: 7, time: "10:30", type: "League Fixture", venue: claro, pitch: secondPitch, status: "Booked" },
    { team: mens || u12, side: "Home", day: 14, time: "14:00", type: "Cup Fixture", venue: pannal || claro, pitch: pannalPitch || mainPitch, status: "Booked" },
    { team: u12, side: "Away", day: 21, time: "11:00", type: "Friendly", venue: null, pitch: null, status: "Booked" },
    { team: u12, side: "Home", day: -14, time: "10:30", type: "League Fixture", venue: claro, pitch: mainPitch, status: "Booked", result: [24, 17] },
    { team: u14g || u12, side: "Home", day: 28, time: null, type: "Friendly", venue: claro, pitch: null, status: "To Be Determined" },
  ]

  let created = 0
  plan.forEach((f, i) => {
    const opponentDir = opponents[i % Math.max(1, opponents.length)] ?? null
    const opponentName = opponentDir ? sql(`select name from public.club_directory where id = ${q(opponentDir)}`) : "Visiting club"
    // The result is recorded in the same authenticated block that created the
    // fixture, so it is the review Club Admin's own action throughout.
    asAdmin(`
      declare v_fixture uuid;
      begin
        v_fixture := (public.create_fixture(
          ${q(f.team)}, ${q(f.side)}, ${q(opponentName)},
          (current_date + ${f.day})::date, ${q(f.status)},
          null, ${q(opponentDir)},
          ${f.time ? `'${f.time}'::time` : "null"},
          ${q(f.type)}, ${q(f.venue)}, ${q(f.pitch)},
          'Step 7 review example.', null, null, null, null
        ) ->> 'fixtureId')::uuid;
        ${f.result ? `perform public.submit_fixture_result(v_fixture, ${f.result[0]}, ${f.result[1]});` : ""}
      end;`)
    created += 1
  })

  const total = sql(`select count(*) from public.fixtures f join public.teams t on t.id = f.owning_team_id where t.club_id = ${q(clubId)}`)
  console.log(`${CLUB_NAME}: ${created} fixture(s) arranged, ${total} now on the club.`)
  console.log("Home and away, three match types, two grounds, one played and one still to be determined.")
  console.log("Created through public.create_fixture as the review Club Admin.")
}

function down({ quiet = false } = {}) {
  // Ordered by dependency, and scoped to this review club and its identities only.
  sql(`
    do $$
    declare v_club uuid;
    begin
      select c.id into v_club from public.clubs c join public.club_directory d on d.id = c.directory_id
        where d.normalized_key = ${q(KEY)};

      delete from public.player_club_join_requests where club_id = v_club;
      delete from public.club_join_requests where club_id = v_club;
      delete from public.invitation_teams it using public.access_invitations i
        where it.invitation_id = i.id and i.club_id = v_club;
      delete from public.access_invitations where club_id = v_club;
      delete from public.club_safeguarding_officer_invitations where club_id = v_club;
      delete from public.club_safeguarding_officers where club_id = v_club;
      delete from public.capability_overrides where club_id = v_club;

      delete from public.player_team_memberships ptm using public.teams t
        where ptm.team_id = t.id and t.club_id = v_club;
      delete from public.guardians g using public.players p
        where g.player_id = p.id and p.surname in ('Ferreira', 'Kovac') and p.first_name in ('Leo', 'Mina');
      delete from public.players where surname in ('Ferreira', 'Kovac') and first_name in ('Leo', 'Mina');

      delete from public.team_permissions tp using public.teams t where tp.team_id = t.id and t.club_id = v_club;
      delete from public.role_assignments where club_id = v_club;
      delete from public.teams where club_id = v_club;
      delete from public.club_memberships where club_id = v_club;
      delete from public.clubs where id = v_club;
      delete from public.club_directory where normalized_key = ${q(KEY)};

      delete from auth.sessions s using auth.users u where s.user_id = u.id and u.email like ${q(DOMAIN + ".%@ovalball.test")};
    end $$;`)

  // The identities themselves, where the database still permits it.
  //
  // Acting as these people writes to `public.audit_log`, which is append-only by
  // design: its history cannot be changed or deleted, and neither rule is worth
  // bending for a fixture. So an identity that has DONE something stays, with no
  // membership of anything, and `up` picks it up again by address. One that
  // never acted is removed cleanly. Nothing outside the review identities is
  // ever touched.
  const left = sql(`
    do $$
    declare r record; v_ids uuid[];
    begin
      select array_agg(id) into v_ids from auth.users where email like ${q(DOMAIN + ".%@ovalball.test")};
      if v_ids is null then return; end if;
      for r in
        select n.nspname as sch, c.relname as tbl, a.attname as col, a.attnotnull as required
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and n.nspname = 'public'
          and array_length(k.conkey, 1) = 1 and c.relname <> 'audit_log'
      loop
        begin
          if r.required then
            execute format('delete from %I.%I where %I = any($1)', r.sch, r.tbl, r.col) using v_ids;
          else
            execute format('update %I.%I set %I = null where %I = any($1)', r.sch, r.tbl, r.col, r.col) using v_ids;
          end if;
        exception when others then null;
        end;
      end loop;
      for r in select id from auth.users where id = any(v_ids) loop
        begin
          delete from auth.users where id = r.id;
        exception when others then null;
        end;
      end loop;
    end $$;
    select count(*)::text from auth.users where email like ${q(DOMAIN + ".%@ovalball.test")};`).split("\n").pop()

  if (!quiet) {
    console.log(`Review fixture removed. ${left === "0" ? "No" : left} review identit${left === "1" ? "y" : "ies"} remain (append-only audit history keeps them).`)
  }
}

function report() {
  const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                      where d.normalized_key = ${q(KEY)}`)
  if (!clubId) return console.log("No review fixture is installed. Run `up` first.")
  console.log(`REVIEW CLUB   ${CLUB_NAME}  (${clubId})`)
  console.log(sql(`
    select '  ' || rpad(u.email, 42) || rpad(coalesce(p.first_name,'') || ' ' || coalesce(p.surname,''), 20)
         || rpad(m.role, 20)
         || coalesce((select string_agg(t.display_name || ' ' || tp.permission, ', ' order by t.display_name)
                      from public.team_permissions tp join public.teams t on t.id = tp.team_id
                      where tp.membership_id = m.id), '-')
    from public.club_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = u.id
    where m.club_id = ${q(clubId)} order by u.email`))
  console.log("\nWAITING")
  console.log(sql(`
    select '  invitation  ' || rpad(invited_email_normalised, 44) || state from public.access_invitations where club_id = ${q(clubId)}
    union all
    select '  join req    ' || rpad(u.email, 44) || r.status from public.club_join_requests r join auth.users u on u.id = r.requesting_user_id where r.club_id = ${q(clubId)}
    union all
    select '  player req  ' || rpad(p.first_name || ' ' || p.surname, 44) || r.status from public.player_club_join_requests r join public.players p on p.id = r.player_id where r.club_id = ${q(clubId)}
    union all
    select '  safeguarding' || rpad(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,''), 44) || coalesce(ra.confirmation_state,'-')
      from public.role_assignments ra left join public.profiles pr on pr.id = ra.user_id
      where ra.club_id = ${q(clubId)} and ra.role_key = 'SAFEGUARDING_OFFICER'
    union all
    select '  override    ' || rpad(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'') || ' ' || o.capability_key, 44) || o.effect
      from public.capability_overrides o left join public.profiles pr on pr.id = o.user_id
      where o.club_id = ${q(clubId)} and o.status = 'active'
    union all
    select '  volunteer   ' || rpad(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,''), 44) || ra.state
      from public.role_assignments ra left join public.profiles pr on pr.id = ra.user_id
      where ra.club_id = ${q(clubId)} and ra.role_key = 'VOLUNTEER'
    union all
    select '  guardian    ' || rpad(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'') || ' -> ' || pl.first_name || ' ' || pl.surname, 44) || g.state
      from public.guardians g join public.players pl on pl.id = g.player_id left join public.profiles pr on pr.id = g.guardian_user_id
      where pl.surname = 'Ferreira'
    order by 1`))
}

/**
 * HOW DOES THE REVIEW WORLD DIFFER FROM THE STATE IT WAS BUILT IN?
 *
 * Not "is it corrupt". A permanent review world is SUPPOSED to change: the
 * product owner reviews by using the product, and approving a join request or
 * revoking an invitation is the review working, not damage. This reports
 * differences so they can be SEEN; deciding what any of them means is the
 * owner's, and reverting one is never automatic.
 *
 * That distinction was learned the hard way here. During Step 2's review
 * preparation this club showed four Coach assignments nobody had scripted, and
 * they were removed through `remove_team_access` as though they were drift from
 * a stray test. The timestamps later lined up with the owner's own Chrome
 * session. The lesson is in the wording of this command: it prints, it does not
 * fix, and it says out loud that a difference may be somebody's real work.
 *
 * BASELINE = the state `up` creates. Nothing more is claimed for it.
 */
const BASELINE = {
  "review.step2.admin@ovalball.test": { role: "CLUB_ADMIN", teams: "-" },
  "review.step2.applicant@ovalball.test": { role: "BASIC_USER", teams: "-" },
  "review.step2.coach@ovalball.test": { role: "BASIC_USER", teams: "Under 12 Boys coach, Under 14 Girls manager" },
  "review.step2.guardian@ovalball.test": { role: "BASIC_USER", teams: "-" },
  "review.step2.manager@ovalball.test": { role: "BASIC_USER", teams: "Men's 1st Team manager" },
  "review.step2.member@ovalball.test": { role: "BASIC_USER", teams: "-" },
  "review.step2.officer@ovalball.test": { role: "BASIC_USER", teams: "-" },
  "review.step2.overridden@ovalball.test": { role: "BASIC_USER", teams: "-" },
  "review.step2.secretary@ovalball.test": { role: "FIXTURE_SECRETARY", teams: "-" },
  "review.step2.volunteer@ovalball.test": { role: "BASIC_USER", teams: "-" },
}
const BASELINE_STATE = [
  ["a waiting invitation", `select count(*) from public.access_invitations where club_id = $C and state = 'ISSUED'`, "1"],
  ["a pending club join request", `select count(*) from public.club_join_requests where club_id = $C and status = 'pending'`, "1"],
  ["a pending player join request", `select count(*) from public.player_club_join_requests where club_id = $C and status = 'pending'`, "1"],
  ["one direct capability grant", `select count(*) from public.capability_overrides where club_id = $C and status = 'active' and effect = 'grant'`, "1"],
  ["a Safeguarding Officer awaiting confirmation", `select count(*) from public.role_assignments where club_id = $C and role_key = 'SAFEGUARDING_OFFICER' and confirmation_state = 'PENDING_CONFIRMATION'`, "1"],
  ["an active Volunteer", `select count(*) from public.role_assignments where club_id = $C and role_key = 'VOLUNTEER' and state = 'ACTIVE'`, "1"],
  ["three teams", `select count(*) from public.teams where club_id = $C and active`, "3"],
]

function verify() {
  const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                      where d.normalized_key = ${q(KEY)}`)
  if (!clubId) {
    console.error("The canonical review world is NOT installed. Run `up`.")
    process.exit(1)
  }
  const problems = []
  const actual = new Map()
  for (const line of sql(`
    select u.email || '|' || m.role || '|' ||
           coalesce((select string_agg(t.display_name || ' ' || tp.permission, ', ' order by t.display_name)
                     from public.team_permissions tp join public.teams t on t.id = tp.team_id
                     where tp.membership_id = m.id), '-')
    from public.club_memberships m join auth.users u on u.id = m.user_id
    where m.club_id = ${q(clubId)}`).split(String.fromCharCode(10)).filter(Boolean)) {
    const [email, role, teams] = line.split("|")
    actual.set(email, { role, teams })
  }
  for (const [email, want] of Object.entries(BASELINE)) {
    const got = actual.get(email)
    if (!got) problems.push(`${email} is missing from the club entirely`)
    else if (got.role !== want.role) problems.push(`${email} holds ${got.role}, baseline says ${want.role}`)
    else if (got.teams !== want.teams) problems.push(`${email} team roles are "${got.teams}", baseline says "${want.teams}"`)
  }
  for (const email of actual.keys()) {
    if (!(email in BASELINE)) problems.push(`${email} is in the club but not in the baseline`)
  }
  for (const [what, query, want] of BASELINE_STATE) {
    const got = sql(query.replace("$C", q(clubId)))
    if (got !== want) problems.push(`${what}: found ${got}, baseline says ${want}`)
  }
  if (problems.length === 0) {
    console.log("The canonical review world is exactly as `up` built it.")
    return
  }
  console.log("The canonical review world differs from the state `up` built:")
  console.log("")
  for (const p of problems) console.log(`  - ${p}`)
  console.log("")
  console.log("THIS IS NOT NECESSARILY A PROBLEM. Approving a join request, revoking an")
  console.log("invitation or changing somebody's role is what reviewing the product looks")
  console.log("like, and those changes belong to whoever made them.")
  console.log("")
  console.log("Ask before putting anything back. If something genuinely does need")
  console.log("restoring, use the canonical transition -- remove_team_access,")
  console.log("set_primary_club_role, issue_invitation -- never a raw delete, and never by")
  console.log("rebuilding the world: every id would change and every URL written down")
  console.log("anywhere would stop working.")
}

const cmd = process.argv[2]
if (cmd === "up") {
  console.log(JSON.stringify(up(), null, 2))
  report()
} else if (cmd === "down") {
  // A GUARD, BECAUSE THE DEFAULT ANSWER IS NO.
  //
  // This world is standing review data now. Running teardown "to tidy up after
  // the tests" would quietly destroy the continuity the whole arrangement
  // exists for, and rebuilding it is not equivalent -- every id changes, so
  // every URL written down anywhere stops working. It takes an explicit,
  // unmistakable flag.
  if (!process.argv.includes("--destroy-the-canonical-review-world")) {
    console.error(
      [
        "Refusing to tear down the canonical local UAT review world.",
        "",
        "These personas are permanent local review data for the whole convergence",
        "programme, documented in docs/product/STEP_2_MANUAL_REVIEW_WALKTHROUGH.md.",
        "They are NOT test fixtures and this is NOT post-test cleanup: every",
        "automated suite seeds and cleans its own.",
        "",
        "If a later step needs more, ENRICH this world rather than replacing it.",
        "",
        "If the product owner has actually asked for it to be destroyed:",
        "  node scripts/review-fixtures/step2-review-club.mjs down --destroy-the-canonical-review-world",
      ].join("\n")
    )
    process.exit(1)
  }
  down()
} else if (cmd === "enrich") enrich()
else if (cmd === "enrich-fixtures") enrichFixtures()
else if (cmd === "report") report()
else if (cmd === "verify") verify()
else console.log("usage: step2-review-club.mjs up|enrich|enrich-fixtures|report|verify|down --destroy-the-canonical-review-world")
