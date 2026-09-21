-- CONVERGENCE STEP 16 — COMPETITION / GOVERNING CLOSURE.
--
--   A. THE INVITATION IS THE CANONICAL ONE, and there is only one path in.
--   B. NO ACCOUNT-EXISTENCE ORACLE: a registered address and an unregistered one behave identically.
--   C. REDEMPTION IS SERVER-AUTHORED and bound to the invited identity.
--   D. REVOKE AND RESEND come from the canonical authority, for a body administrator too.
--   E. A BODY ORGANISER CAN READ ITS OWN COMPETITION -- the RLS half of Step 15's fix.
--   F. AND IS TOLD WHAT ITS CLUBS ANSWERED -- the notification routing defect.
--   G. THE CLUB'S OWN SIDE: a read, with no entry consent invented.
--   H. AFFILIATION CONFERS NOTHING, and organising confers nothing over club fixtures.
--   I. RACES that Step 16 actually creates.
--   J. THE BOUNDARIES: the capability engine, the dispensation chain, protected data.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;
do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_body_admin uuid := gen_random_uuid();
  v_body_comps uuid := gen_random_uuid();
  v_body_viewer uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_other_club_admin uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_invitee uuid := gen_random_uuid();
  v_wrong uuid := gen_random_uuid();
  v_body uuid; v_other_body uuid;
  v_dir uuid; v_club uuid; v_other_dir uuid; v_other_club uuid;
  v_type uuid; v_team uuid; v_other_team uuid; v_fixture uuid;
  v_comp uuid; v_edition uuid; v_season uuid; v_stage uuid;
  v_p1 uuid; v_p2 uuid; v_match uuid; v_ver uuid;
  v_inv uuid; v_inv2 uuid; v_token text; v_token2 text;
  v_n int; v_state text; v_txt text; v_bool boolean; v_json jsonb;
begin
  foreach v_person in array array[v_body_admin, v_body_comps, v_body_viewer, v_other_admin, v_club_admin,
                                 v_other_club_admin, v_site, v_invitee, v_wrong] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's16-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Sixteen', 's16-' || v_person::text || '@ovalball.test', (current_date - interval '44 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role, profile_key) values (v_site, 'active', 'full', 'SITE_FULL');

  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S16 County RFU ' || v_tag, 'S16 ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_body;
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S16 Other County RFU ' || v_tag, 'S16 Other ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_other_body;

  -- TWO CLUBS, so "club A cannot act for club B" is a real test rather than a shape.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, constituent_body_id)
  values ('S16 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's16-' || v_tag, v_body)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's16-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, constituent_body_id)
  values ('S16 Other RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's16-o-' || v_tag, v_body)
  returning id into v_other_dir;
  insert into public.clubs (directory_id, slug, status) values (v_other_dir, 's16-o-' || v_tag, 'active') returning id into v_other_club;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_other_club, v_other_club_admin, 'CLUB_ADMIN', 'active');

  insert into public.constituent_body_roles (constituent_body_id, user_id, role_key) values
    (v_body, v_body_admin, 'BODY_ADMIN'),
    (v_body, v_body_comps, 'BODY_COMPETITIONS'),
    (v_body, v_body_viewer, 'BODY_VIEWER'),
    (v_other_body, v_other_admin, 'BODY_ADMIN');

  select id into v_type from public.canonical_team_types_by_code
   where rugby_code = 'union' and key = 'u12' and is_offered limit 1;
  if v_type is null then
    select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and is_offered limit 1;
  end if;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_other_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_other_team;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values (v_team, 'Home', 'S16 Visitors ' || v_tag, (current_date + 30)::date, '11:00', 'Friendly', 'Booked', 'club_created', 'S16 ' || v_tag)
  returning id into v_fixture;

  select internal.edition_season_for_code('union') into v_season;
  insert into public.competitions (name, slug, normalized_key, rugby_code, active, organiser_constituent_body_id, created_by)
  values ('S16 County Cup ' || v_tag, 's16-cup-' || v_tag, 's16 cup ' || v_tag || ' union', 'union', true, v_body, v_body_admin)
  returning id into v_comp;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_comp, v_season, 'union', true, v_body_admin, v_body_admin) returning id into v_edition;

  -- =====================================================================
  -- A. ONE INVITATION SYSTEM
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select invitation_id, token into v_inv, v_token
    from public.invite_governing_body_officer(v_body, 's16-' || v_invitee::text || '@ovalball.test', 'BODY_COMPETITIONS');
  perform pg_temp.check(v_inv is not null and v_token is not null, 'A1 an admin invites somebody to the organisation');

  perform pg_temp.act_postgres();
  select kind || '|' || issuer_capability || '|' || issued_level || '|' || max_uses::text
    into v_txt from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_txt = 'GOVERNING_BODY_OFFICER|governing.access.manage|ORGANISATION|1',
    format('A2 recorded as the canonical kind, naming a registered capability, single use (%s)', coalesce(v_txt,'null')));
  select (token_sha256 = internal.invitation_token_hash(v_token)) into v_bool
    from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_bool, 'A3 with the token stored only as a hash -- the plaintext is returned once and never kept');
  select scope_key into v_txt from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_txt = v_body::text,
    format('A4 and the organisation is the invitation''s SCOPE, so one open invitation per person per body (%s)', v_txt));

  -- The capability the kind names is registered, and nothing asks the engine for the scope it refuses.
  perform pg_temp.check(exists (select 1 from public.capabilities
                                 where key = 'governing.access.manage' and valid_scopes = array['organisation']),
    'A5 the authority it names is in the canonical capability catalogue');
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '(can|has_capability|capability_decision)\s*\([^)]*''organisation''';
  perform pg_temp.check(v_n = 0,
    'A6 and nothing asks the capability engine for the organisation scope, which it refuses at rule 1');

  -- =====================================================================
  -- B. NO ACCOUNT-EXISTENCE ORACLE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select invitation_id into v_inv2
    from public.invite_governing_body_officer(v_body, 'nobody-' || v_tag || '@ovalball.test', 'BODY_VIEWER');
  perform pg_temp.check(v_inv2 is not null,
    'B1 an address with NO Ovalball account is invited exactly as one with an account is');
  perform pg_temp.act_postgres();
  select (a.kind = b.kind and a.state = b.state and a.max_uses = b.max_uses
          and (a.expires_at::date = b.expires_at::date)) into v_bool
    from public.access_invitations a, public.access_invitations b where a.id = v_inv and b.id = v_inv2;
  perform pg_temp.check(v_bool,
    'B2 producing an indistinguishable record -- nothing in the result says whether the address is registered');
  perform pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = 'grant_governing_body_role_by_email'),
    'B3 and the function that used to answer NO_ACCOUNT is gone, not merely unused');
  select count(*) into v_n from public.constituent_body_roles where constituent_body_id = v_body;
  perform pg_temp.check(v_n = 3, format('B4 inviting creates no access until it is accepted (%s)', v_n));

  -- =====================================================================
  -- C. REDEMPTION IS SERVER-AUTHORED AND BOUND TO THE INVITED IDENTITY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_wrong);
  select public.redeem_invitation(p_token => v_token) into v_json;
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED',
    format('C1 somebody the link was NOT made out to cannot redeem it (%s)', v_json->>'outcome'));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.constituent_body_roles where constituent_body_id = v_body and user_id = v_wrong;
  perform pg_temp.check(v_n = 0, 'C2 and gains nothing by trying');

  perform pg_temp.act('authenticated', v_invitee);
  select public.redeem_invitation(p_token => v_token) into v_json;
  perform pg_temp.check(v_json->>'outcome' = 'BODY_ROLE_ACTIVE',
    format('C3 the invited person accepts it and holds the role (%s)', v_json->>'outcome'));
  perform pg_temp.act_postgres();
  select role_key || '|' || state into v_txt from public.constituent_body_roles
   where constituent_body_id = v_body and user_id = v_invitee;
  perform pg_temp.check(v_txt = 'BODY_COMPETITIONS|ACTIVE',
    format('C4 and it is the role the INVITATION fixed, not anything the redeemer chose (%s)', v_txt));
  select state into v_txt from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_txt = 'REDEEMED', format('C5 the invitation is then spent (%s)', v_txt));

  perform pg_temp.act('authenticated', v_invitee);
  select public.redeem_invitation(p_token => v_token) into v_json;
  perform pg_temp.check(v_json->>'outcome' in ('ALREADY_REDEEMED','REFUSED'),
    format('C6 and cannot be used twice (%s)', v_json->>'outcome'));

  -- The new officer can now do what that role allows, and no more.
  perform pg_temp.act('authenticated', v_invitee);
  perform pg_temp.check(internal.can_organise_competition(v_comp),
    'C7 a redeemed competitions officer organises the body''s competitions');
  select pg_temp.try(format('select * from public.invite_governing_body_officer(%L, %L, %L)',
    v_body, 's16-x-' || v_tag || '@ovalball.test', 'BODY_ADMIN')) into v_state;
  perform pg_temp.check(v_state = '42501', format('C8 and still cannot invite anybody (%s)', v_state));

  -- =====================================================================
  -- D. REVOKE AND RESEND, THROUGH THE CANONICAL AUTHORITY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  select token into v_token2 from public.resend_invitation(v_inv2);
  perform pg_temp.check(v_token2 is not null, 'D1 a body administrator can send an invitation again');
  perform pg_temp.act_postgres();
  select (token_sha256 = internal.invitation_token_hash(v_token2) and resend_count = 1) into v_bool
    from public.access_invitations where id = v_inv2;
  perform pg_temp.check(v_bool, 'D2 which rotates the secret, so the old link stops working');

  perform pg_temp.act('authenticated', v_body_viewer);
  select pg_temp.try(format('select public.revoke_invitation(%L, %L)', v_inv2, 'not mine to withdraw')) into v_state;
  perform pg_temp.check(v_state = '42501', format('D3 a VIEWER cannot withdraw an invitation (%s)', v_state));
  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select public.revoke_invitation(%L, %L)', v_inv2, 'not my organisation')) into v_state;
  perform pg_temp.check(v_state = '42501', format('D4 nor can an administrator of ANOTHER body (%s)', v_state));
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select public.revoke_invitation(%L, %L)', v_inv2, 'not my organisation')) into v_state;
  perform pg_temp.check(v_state = '42501', format('D5 nor a Club Admin of an affiliated club (%s)', v_state));

  perform pg_temp.act('authenticated', v_body_admin);
  select pg_temp.try(format('select public.revoke_invitation(%L, %L)', v_inv2, 'withdrawn during the review')) into v_state;
  perform pg_temp.check(v_state = 'OK', format('D6 and the organisation''s own administrator can (%s)', v_state));
  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.governing_body_invitations(v_body);
  perform pg_temp.check(v_n = 0, format('D7 after which no invitation is listed as waiting (%s)', v_n));

  -- =====================================================================
  -- E. A BODY ORGANISER CAN READ ITS OWN COMPETITION -- the RLS half
  --
  -- Measured before Step 16, internal.organised_edition_ids() returned ZERO editions for the county's own
  -- administrator, because it recognised the organiser CLUB and not the organising body.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  perform pg_temp.check(v_edition = any (internal.organised_edition_ids()),
    'E1 the organising body''s administrator organises its own edition, for RLS as well as for the RPCs');
  perform pg_temp.act('authenticated', v_body_comps);
  perform pg_temp.check(v_edition = any (internal.organised_edition_ids()),
    'E2 and so does its competitions officer');
  perform pg_temp.act('authenticated', v_body_viewer);
  perform pg_temp.check(not (v_edition = any (internal.organised_edition_ids())),
    'E3 a VIEWER does not -- reading a competition is not organising it');
  perform pg_temp.act('authenticated', v_other_admin);
  perform pg_temp.check(not (v_edition = any (internal.organised_edition_ids())),
    'E4 nor does an administrator of another body');
  perform pg_temp.act('authenticated', v_club_admin);
  perform pg_temp.check(not (v_edition = any (internal.organised_edition_ids())),
    'E5 nor a Club Admin of an affiliated club');

  -- The draw, so there is something to read.
  perform pg_temp.act('authenticated', v_body_admin);
  perform public.save_competition_participants(v_edition, jsonb_build_array(
    jsonb_build_object('slot', 1, 'club_directory_id', v_dir, 'club_id', v_club, 'team_id', v_team, 'canonical_team_type_id', v_type),
    jsonb_build_object('slot', 2, 'club_directory_id', v_other_dir, 'club_id', v_other_club, 'team_id', v_other_team, 'canonical_team_type_id', v_type)));
  perform public.save_competition_stage(v_edition, null, 'league', 'League', 1,
    jsonb_build_object('points', jsonb_build_object('win', 4, 'draw', 2, 'loss', 0)), '[]'::jsonb);
  select id into v_stage from public.competition_stages where edition_id = v_edition and kind = 'league';
  select id into v_p1 from public.competition_participants where edition_id = v_edition and slot = 1;
  select id into v_p2 from public.competition_participants where edition_id = v_edition and slot = 2;
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
    jsonb_build_object('round_number', 1, 'home_participant_id', v_p1, 'away_participant_id', v_p2,
                       'match_date', (current_date + 14)::text, 'kickoff_time', '10:30')));
  perform public.issue_competition_matches(v_edition);
  select id into v_match from public.competition_matches where edition_id = v_edition limit 1;
  perform pg_temp.check(v_match is not null, 'E6 the body organiser can build and issue its own draw');

  -- THE ONE THE PUBLIC FALLBACK DOES NOT COVER: verification rows have no is_public escape hatch, so
  -- before Step 16 a county literally could not see whether its clubs had answered.
  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.competition_match_verifications v where v.match_id = v_match;
  perform pg_temp.check(v_n = 2, format('E7 and can read what each club has been asked (%s)', v_n));
  perform pg_temp.act('authenticated', v_other_admin);
  select count(*) into v_n from public.competition_match_verifications v where v.match_id = v_match;
  perform pg_temp.check(v_n = 0, 'E8 while another body sees none of it');

  -- The organiser's own read model.
  perform pg_temp.act('authenticated', v_body_admin);
  select count(*) into v_n from public.governing_body_competition_matches(v_comp);
  perform pg_temp.check(v_n = 1, format('E9 the competition''s matches read from Competition Match truth (%s)', v_n));
  perform pg_temp.act('authenticated', v_other_admin);
  select pg_temp.try(format('select * from public.governing_body_competition_matches(%L)', v_comp)) into v_state;
  perform pg_temp.check(v_state = '42501', format('E10 and another body cannot read them (%s)', v_state));

  -- =====================================================================
  -- F. THE ORGANISER IS TOLD WHAT ITS CLUBS ANSWERED
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from internal.competition_organiser_recipients(v_edition) r
   where r.user_id in (v_body_admin, v_body_comps);
  perform pg_temp.check(v_n = 2, format('F1 both roles that run competitions hear about it (%s)', v_n));
  select count(*) into v_n from internal.competition_organiser_recipients(v_edition) r where r.user_id = v_body_viewer;
  perform pg_temp.check(v_n = 0, 'F2 a VIEWER is not made responsible for answering anything');
  select count(*) into v_n from internal.competition_organiser_recipients(v_edition) r where r.user_id = v_site;
  perform pg_temp.check(v_n = 0,
    'F3 and Site Admins are no longer notified as though a body-organised competition had no owner');
  select count(*) into v_n from internal.competition_organiser_recipients(v_edition) r where r.user_id = v_other_admin;
  perform pg_temp.check(v_n = 0, 'F4 nor is another body');

  -- A club answers, and the organiser is notified because of the routing above.
  select id into v_ver from public.competition_match_verifications where match_id = v_match and club_id = v_club;
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select public.respond_competition_match(%L, %L)', v_ver, 'confirmed')) into v_state;
  perform pg_temp.check(v_state = 'OK', format('F5 the club confirms its own match (%s)', v_state));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications
   where user_id in (v_body_admin, v_body_comps) and type = 'competition_match_response';
  perform pg_temp.check(v_n >= 2, format('F6 and the organising body is told -- the defect Step 16 fixed (%s)', v_n));

  -- And a club cannot answer for another club's side.
  select id into v_ver from public.competition_match_verifications where match_id = v_match and club_id = v_other_club;
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select public.respond_competition_match(%L, %L)', v_ver, 'declined')) into v_state;
  perform pg_temp.check(v_state = '42501', format('F7 and one club cannot answer for another (%s)', v_state));

  -- =====================================================================
  -- G. THE CLUB'S OWN SIDE -- a read, with nothing invented
  -- =====================================================================
  perform pg_temp.act('authenticated', v_club_admin);
  select count(*) into v_n from public.club_competition_entries(v_club);
  perform pg_temp.check(v_n = 1, format('G1 a club can see which competitions it is in (%s)', v_n));
  select organiser_kind || '|' || organiser_label into v_txt from public.club_competition_entries(v_club);
  perform pg_temp.check(v_txt = 'BODY|S16 County RFU ' || v_tag,
    format('G2 and WHO runs it, which is the fact that was missing entirely (%s)', v_txt));
  select entered_count::text || '|' || total_matches::text || '|' || confirmed::text
    into v_txt from public.club_competition_entries(v_club);
  perform pg_temp.check(v_txt = '1|1|1', format('G3 with its own teams, matches and answers (%s)', v_txt));

  -- REFUSED, not merely empty: the reader raises rather than returning nothing, so a club cannot even
  -- ask the question about another club.
  perform pg_temp.act('authenticated', v_other_club_admin);
  select pg_temp.try(format('select * from public.club_competition_entries(%L)', v_club)) into v_state;
  perform pg_temp.check(v_state = '42501', format('G4 one club cannot read another club''s entries (%s)', v_state));
  select count(*) into v_n from public.club_competition_entries(v_other_club);
  perform pg_temp.check(v_n = 1, 'G5 and sees its own');

  -- ENTRY IS STILL THE ORGANISER'S ACT. No club-side consent vocabulary was invented.
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select public.save_competition_participants(%L, %L)', v_edition, '[]')) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('G6 a Club Admin cannot enter or withdraw a team in somebody else''s competition (%s)', v_state));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select pg_get_constraintdef(oid) from pg_constraint
                          where conrelid = 'public.competition_participants'::regclass
                            and conname = 'competition_participants_status_check') ~ 'entered.*withdrawn',
    'G7 and the participant vocabulary is still only entered or withdrawn');

  -- =====================================================================
  -- H. AFFILIATION CONFERS NOTHING, AND ORGANISING CONFERS NOTHING OVER CLUB FIXTURES
  --
  -- §5 of the handoff: a county body is not a super-club. These are the specific ways it could have
  -- become one.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_admin);
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'team', v_club, v_team, null) = false,
    'H1 a body officer holds no authority over an affiliated club''s own fixtures');
  select count(*) into v_n from public.fixtures f where f.id = v_fixture;
  perform pg_temp.check(v_n = 0, 'H2 nor can they even read one');
  perform pg_temp.check(internal.can('people.membership.manage', 'club', v_club, null, null) = false,
    'H3 affiliation does not make them the club''s Club Admin');
  perform pg_temp.check(internal.can('team.roster.view', 'team', v_club, v_team, null) = false,
    'H4 nor give them the club''s roster');
  perform pg_temp.check(internal.can('safeguarding.case.view', 'club', v_club, null, null) = false,
    'H5 nor anything safeguarding-shaped');
  select count(*) into v_n from public.club_memberships cm where cm.club_id = v_club;
  perform pg_temp.check(v_n = 0, 'H6 and they cannot read who the club''s members are');

  -- A club admin of an affiliated club gains nothing at the body either. Affiliation runs both ways.
  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('H7 and being affiliated gives a club no access to the county (%s)', v_state));

  -- =====================================================================
  -- I. RACES STEP 16 ACTUALLY CREATES
  -- =====================================================================
  -- TWO ADMINISTRATORS INVITE THE SAME ADDRESS. The live-uniqueness index makes the second a no-op that
  -- returns the first, rather than two live links to one seat.
  perform pg_temp.act('authenticated', v_body_admin);
  select invitation_id into v_inv from public.invite_governing_body_officer(
    v_body, 's16-race-' || v_tag || '@ovalball.test', 'BODY_VIEWER');
  select invitation_id, already_existed into v_inv2, v_bool from public.invite_governing_body_officer(
    v_body, 's16-race-' || v_tag || '@ovalball.test', 'BODY_ADMIN');
  perform pg_temp.check(v_inv = v_inv2 and v_bool,
    'I1 two invitations to one address at one organisation resolve to ONE invitation, not two live links');
  perform pg_temp.act_postgres();
  select intended_outcome->>'role_key' into v_txt from public.access_invitations where id = v_inv;
  perform pg_temp.check(v_txt = 'BODY_VIEWER',
    format('I2 and the FIRST invitation''s role stands -- a second attempt cannot quietly escalate it (%s)', v_txt));

  -- THE SAME ADDRESS AT A DIFFERENT BODY IS A DIFFERENT INVITATION, because the organisation is the scope.
  perform pg_temp.act('authenticated', v_other_admin);
  select invitation_id into v_inv2 from public.invite_governing_body_officer(
    v_other_body, 's16-race-' || v_tag || '@ovalball.test', 'BODY_VIEWER');
  perform pg_temp.check(v_inv2 is not null and v_inv2 <> v_inv,
    'I3 the same person can be invited to two different organisations at once');

  -- REDEMPTION VERSUS REVOCATION: whichever lands first wins, and a revoked link is refused with the
  -- same generic answer as one that never existed.
  perform pg_temp.act('authenticated', v_body_admin);
  select token into v_token from public.resend_invitation(v_inv);
  perform public.revoke_invitation(v_inv, 'withdrawn before it was accepted');
  perform pg_temp.act('authenticated', v_wrong);
  select public.redeem_invitation(p_token => v_token) into v_json;
  perform pg_temp.check(v_json->>'outcome' = 'REFUSED',
    format('I4 a revoked invitation is refused (%s)', v_json->>'outcome'));
  perform pg_temp.check(v_json->>'message' = 'That invitation or code can''t be used.',
    'I5 with the same generic message as one that never existed, so a prober learns nothing');

  -- =====================================================================
  -- J. THE BOUNDARIES
  -- =====================================================================
  perform pg_temp.act_postgres();
  -- The capability engine still refuses the organisation scope, and still has five implemented ones.
  perform pg_temp.check(
    (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'SCOPE_NOT_IMPLEMENTED',
    'J1 internal.capability_decision still refuses the organisation scope at rule 1');
  perform pg_temp.check(
    (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') !~ 'p_organisation|p_body',
    'J2 and was not given an organisation parameter -- that is a whole-platform change, not a sprint one');

  -- The dispensation chain is untouched for the third step running.
  perform pg_temp.check(
    (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'decide_player_dispensation') !~ 'constituent_body|can_manage_body',
    'J3 the dispensation governing-body stage is still the club''s attestation');
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'player_team_dispensation' and column_name ~ 'constituent_body';
  perform pg_temp.check(v_n = 0,
    'J4 and there is still no column in which a native body decision could be recorded');

  -- Affiliation is still published reference data that nothing here writes.
  select string_agg(p.proname, ', ') into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and p.proname ~ 'governing|club_competition_entries|invite_governing'
     and p.prosrc ~* '(update|insert into)\s+(public\.)?club_directory';
  perform pg_temp.check(v_txt is null, format('J5 no Step 16 function writes club affiliation (%s)', coalesce(v_txt,'none')));

  -- No second invitation table, no second standings computation, no protected person data.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name ~ 'governing.*invit|body.*invit';
  perform pg_temp.check(v_n = 0, 'J6 no second invitation table appeared');
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal') and p.prosrc ~* 'points_for|league_position|standings';
  perform pg_temp.check(v_n = 0, 'J7 and standings are still computed in exactly one place, which is not SQL');
  select string_agg(p.proname, ', ') into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and p.proname ~ 'governing_body|invite_governing|club_competition_entries'
     and p.prosrc ~* 'date_of_birth|medical|safeguard|guardians|player_team_dispensation';
  perform pg_temp.check(v_txt is null,
    format('J8 and no Step 16 function reaches a date of birth, a medical field or a case note (%s)', coalesce(v_txt,'none')));

  -- ANON REACHES NONE OF IT.
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.invite_governing_body_officer(uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.governing_body_invitations(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.governing_body_competition_matches(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.club_competition_entries(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.current_competition_season(text)', 'EXECUTE'),
    'J9 anon can execute none of the Step 16 functions');

  -- FAIL CLOSED, PROVEN.
  perform pg_temp.check(internal.can_administer_invitation(gen_random_uuid()) is false,
    'J10 can_administer_invitation refuses an invitation that does not exist, definitely rather than null');
  perform pg_temp.check(internal.organised_edition_ids() is not null,
    'J11 and organised_edition_ids answers an array rather than null, so `= any(...)` cannot fail open');
end $$;

rollback;
