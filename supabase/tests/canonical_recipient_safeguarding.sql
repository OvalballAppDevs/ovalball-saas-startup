-- ONE ANSWER TO "WHO MAY LEGITIMATELY BE CONTACTED FOR THIS PLAYER?"
--
-- THE RULE
--
--   under 16              -> never the player, eligible guardian only
--   16-17, no consent     -> eligible guardian only
--   16-17, valid consent  -> the player's own destination is legitimate
--   18+                   -> the player's own destination is legitimate
--   no legitimate destination -> NOBODY, with a reason
--
-- and never, under any circumstance, a club admin, a team admin, a coach, an
-- arbitrary email, a raw family email, an unrelated guardian or a
-- club_directory contact.
--
-- WHAT THIS FILE EXISTS TO STOP COMING BACK
--
-- Before consolidation, internal.notify_training_participants selected
-- `players.user_id where user_id is not null` and called it "adult
-- self-managed players". A twelve-year-old with a login received direct club
-- communication about training. The predicate is now in ONE place, and the
-- assertions below run against the real notification paths, not only against
-- the predicate in isolation.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_club uuid; v_dir uuid; v_team uuid; v_other_team uuid; v_other_club uuid; v_other_dir uuid;
  v_admin uuid := gen_random_uuid();
  v_guardian_a uuid := gen_random_uuid();
  v_guardian_b uuid := gen_random_uuid();
  v_stranger_guardian uuid := gen_random_uuid();

  v_u12 uuid; v_u12_account uuid := gen_random_uuid();
  v_u12_no_guardian uuid;
  v_sixteen_no_consent uuid; v_sixteen_no_consent_acct uuid := gen_random_uuid();
  v_sixteen_no_consent_no_guardian uuid; v_sixteen_lonely_acct uuid := gen_random_uuid();
  v_sixteen_consented uuid; v_sixteen_consented_acct uuid := gen_random_uuid();
  v_adult uuid; v_adult_acct uuid := gen_random_uuid();
  v_sibling uuid;

  v_slug text := substr(gen_random_uuid()::text, 1, 8);
  v_n int; v_txt text; v_session uuid; v_plan uuid;
  v_membership uuid;
begin

-- ------------------------------------------------------------------ setup
insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'crs-admin-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_guardian_a,'crs-ga-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_guardian_b,'crs-gb-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger_guardian,'crs-sg-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_u12_account,'crs-u12-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_sixteen_no_consent_acct,'crs-16nc-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_sixteen_lonely_acct,'crs-16lonely-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_sixteen_consented_acct,'crs-16c-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_adult_acct,'crs-adult-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email)
select id, 'Crs', 'Person', email from auth.users where email like 'crs-%'||v_slug||'%';

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('CRS RUFC '||v_slug,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','crs-'||v_slug)
returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'crs-'||v_slug,'active') returning id into v_club;
insert into public.teams (club_id, display_name, rugby_code, category, age_group, gender, active)
values (v_club,'Under 12 Boys','union','youth','U12','boys',true) returning id into v_team;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('CRS Other '||v_slug,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','crs-o-'||v_slug)
returning id into v_other_dir;
insert into public.clubs (directory_id, slug, status) values (v_other_dir,'crs-o-'||v_slug,'active') returning id into v_other_club;
insert into public.teams (club_id, display_name, rugby_code, category, age_group, gender, active)
values (v_other_club,'Under 12 Boys','union','youth','U12','boys',true) returning id into v_other_team;

insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');

-- The cast. Every one has a login, which is exactly the point: a login is not
-- a licence to be contacted directly.
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth, user_id)
values ('Under','Twelve', true, 'MALE', current_date - interval '12 years', v_u12_account) returning id into v_u12;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth)
values ('Under','TwelveAlone', true, 'MALE', current_date - interval '12 years') returning id into v_u12_no_guardian;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth, user_id)
values ('Sixteen','NoConsent', true, 'MALE', current_date - interval '16 years' - interval '2 months', v_sixteen_no_consent_acct) returning id into v_sixteen_no_consent;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth, user_id)
values ('Sixteen','Lonely', true, 'MALE', current_date - interval '16 years' - interval '2 months', v_sixteen_lonely_acct) returning id into v_sixteen_no_consent_no_guardian;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth, user_id)
values ('Sixteen','Consented', true, 'MALE', current_date - interval '16 years' - interval '2 months', v_sixteen_consented_acct) returning id into v_sixteen_consented;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth, user_id)
values ('Adult','Player', true, 'MALE', current_date - interval '25 years', v_adult_acct) returning id into v_adult;
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth)
values ('Sibling','Ofu12', true, 'MALE', current_date - interval '11 years') returning id into v_sibling;

-- Relationships. Guardian A represents the U12 AND their sibling -- the
-- deduplication case. Guardian B is a second guardian of the U12.
insert into public.guardians (guardian_user_id, player_id, status) values
  (v_guardian_a, v_u12, 'active'),
  (v_guardian_b, v_u12, 'active'),
  (v_guardian_a, v_sibling, 'active'),
  (v_guardian_a, v_sixteen_no_consent, 'active'),
  (v_guardian_a, v_sixteen_consented, 'active'),
  (v_guardian_a, v_adult, 'active');

-- A REVOKED RELATIONSHIP IS NOT A RELATIONSHIP.
insert into public.guardians (guardian_user_id, player_id, status) values (v_stranger_guardian, v_u12, 'revoked');

-- The 16-year-old with consent.
insert into public.guardian_player_permissions (player_id, guardian_user_id, permission_key, granted, actor)
values (v_sixteen_consented, v_guardian_a, 'direct_coach_communication', true, v_guardian_a);

-- ============ A. UNDER 16 ============

select count(*) into v_n from internal.player_contact_eligibility(array[v_u12]) e
where e.user_id = v_u12_account;
if v_n = 0 then
  raise notice 'PASS 1 (A): a 12-year-old WITH THEIR OWN LOGIN is never a direct destination';
else
  raise notice 'FAIL 1 (A): the under-16 player themselves was returned as a destination';
end if;

select count(*) into v_n from internal.player_contact_eligibility(array[v_u12]) e
where e.user_id is not null;
if v_n = 2 and exists (select 1 from internal.player_contact_eligibility(array[v_u12]) e where e.user_id = v_guardian_a)
           and exists (select 1 from internal.player_contact_eligibility(array[v_u12]) e where e.user_id = v_guardian_b) then
  raise notice 'PASS 2 (A): under-16 with eligible guardians resolves to BOTH guardians and nobody else';
else
  raise notice 'FAIL 2 (A): under-16 resolved to % destinations', v_n;
end if;

select count(*) into v_n from internal.player_contact_eligibility(array[v_u12]) e where e.user_id = v_stranger_guardian;
if v_n = 0 then
  raise notice 'PASS 3 (A): a REVOKED guardian relationship is not a relationship';
else
  raise notice 'FAIL 3 (A): a revoked guardian was treated as eligible';
end if;

select count(*) into v_n from internal.player_contact_eligibility(array[v_u12_no_guardian]) e where e.user_id is not null;
select outcome into v_txt from internal.player_contact_eligibility(array[v_u12_no_guardian]) limit 1;
if v_n = 0 and v_txt = 'NO_ELIGIBLE_GUARDIAN' then
  raise notice 'PASS 4 (A): under-16 with NO eligible guardian resolves to NOBODY, and says why';
else
  raise notice 'FAIL 4 (A): % destinations, outcome %', v_n, v_txt;
end if;

-- ============ B. 16-17 ============

select count(*) into v_n from internal.player_contact_eligibility(array[v_sixteen_no_consent]) e
where e.user_id = v_sixteen_no_consent_acct;
if v_n = 0 then
  raise notice 'PASS 5 (B): 16-17 WITHOUT valid direct consent is not a direct destination';
else
  raise notice 'FAIL 5 (B): a 16-year-old without consent was contacted directly';
end if;

if exists (select 1 from internal.player_contact_eligibility(array[v_sixteen_no_consent]) e where e.user_id = v_guardian_a)
   and (select count(*) from internal.player_contact_eligibility(array[v_sixteen_no_consent]) e where e.user_id is not null) = 1 then
  raise notice 'PASS 6 (B): 16-17 without consent falls to the eligible guardian, and only the guardian';
else
  raise notice 'FAIL 6 (B): 16-17 without consent resolved to the wrong set';
end if;

select count(*) into v_n from internal.player_contact_eligibility(array[v_sixteen_no_consent_no_guardian]) e where e.user_id is not null;
select outcome into v_txt from internal.player_contact_eligibility(array[v_sixteen_no_consent_no_guardian]) limit 1;
if v_n = 0 and v_txt = 'CONSENT_REQUIRED_NO_GUARDIAN' then
  raise notice 'PASS 7 (B): 16-17, no consent, no guardian -> NOBODY, named as a consent problem not a missing guardian';
else
  raise notice 'FAIL 7 (B): % destinations, outcome %', v_n, v_txt;
end if;

if exists (select 1 from internal.player_contact_eligibility(array[v_sixteen_consented]) e
           where e.user_id = v_sixteen_consented_acct and e.relationship = 'self') then
  raise notice 'PASS 8 (B): 16-17 WITH valid direct consent is a legitimate destination in their own right';
else
  raise notice 'FAIL 8 (B): a consented 16-year-old was not reachable';
end if;

-- ============ C. 18+ ============

if exists (select 1 from internal.player_contact_eligibility(array[v_adult]) e
           where e.user_id = v_adult_acct and e.relationship = 'self') then
  raise notice 'PASS 9 (C): an adult player is a legitimate destination';
else
  raise notice 'FAIL 9 (C): an adult player was not reachable';
end if;

-- An adult still has their guardian relationship on file; the rule does not
-- silence the guardian, it stops PRETENDING the child is an adult.
if exists (select 1 from internal.player_contact_eligibility(array[v_adult]) e where e.user_id = v_guardian_a) then
  raise notice 'PASS 10 (C): an existing active guardian of an adult remains a destination -- eligibility adds, it does not replace';
else
  raise notice 'FAIL 10 (C): the guardian disappeared once the player turned 18';
end if;

-- ============ D. DEDUPLICATION AND CONTEXT ============

select count(*) into v_n from internal.player_contact_eligibility(array[v_u12, v_sibling]) e
where e.user_id = v_guardian_a;
if v_n = 2 then
  raise notice 'PASS 11 (D): one guardian of two players on the audience is TWO context rows -- the ambiguity is preserved, not collapsed';
else
  raise notice 'FAIL 11 (D): % context rows for a guardian of two players', v_n;
end if;

select count(distinct e.user_id) into v_n from internal.player_contact_eligibility(array[v_u12, v_sibling]) e
where e.user_id is not null;
if v_n = 2 then
  raise notice 'PASS 12 (D): the same audience deduplicates to TWO humans -- guardian A counted once, not once per child';
else
  raise notice 'FAIL 12 (D): % distinct destinations', v_n;
end if;

-- ============ E. FORGED AND FOREIGN ============

select count(*) into v_n from internal.player_contact_eligibility(array[gen_random_uuid()]) e where e.user_id is not null;
if v_n = 0 then
  raise notice 'PASS 13 (E): a forged player id yields no destination and discloses nothing';
else
  raise notice 'FAIL 13 (E): a forged player id produced % destinations', v_n;
end if;

-- A guardian who was revoked from ONE player is not thereby eligible for
-- their sibling: eligibility is per relationship, never per person.
select count(*) into v_n from internal.player_contact_eligibility(array[v_sibling]) e where e.user_id = v_stranger_guardian;
if v_n = 0 then
  raise notice 'PASS 14 (E): eligibility is per relationship -- a revoked guardian reaches neither child';
else
  raise notice 'FAIL 14 (E): a revoked guardian reached a sibling';
end if;

-- The canonical primitive is not reachable by a signed-in user directly.
perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_guardian_a, 'role','authenticated')::text, true);
begin
  perform 1 from internal.player_contact_eligibility(array[v_u12]);
  raise notice 'FAIL 15 (E): the canonical primitive is callable by an ordinary signed-in user';
exception when others then
  raise notice 'PASS 15 (E): the canonical primitive is server-side only -- authenticated has no execute';
end;
perform set_config('role','postgres',true);

-- ============ F. THE REAL NOTIFICATION PATHS ============
--
-- Not the predicate in isolation: the paths that used to bypass it.

insert into public.player_team_memberships (player_id, team_id, status) values
  (v_u12, v_team, 'active'),
  (v_sixteen_no_consent, v_team, 'active'),
  (v_adult, v_team, 'active');

insert into public.training_sessions (club_id, team_id, session_date, start_time)
values (v_club, v_team, current_date + 7, '18:00') returning id into v_session;

delete from public.notifications where type = 'crs_training_probe';
perform internal.notify_training_participants(v_session, 'crs_training_probe', 'Training moved', 'The session has moved.');

select count(*) into v_n from public.notifications where type = 'crs_training_probe' and user_id = v_u12_account;
if v_n = 0 then
  raise notice 'PASS 16 (F): TRAINING COMMUNICATION never reaches a 12-year-old directly -- the bypass is closed';
else
  raise notice 'FAIL 16 (F): a 12-year-old received % direct training notifications', v_n;
end if;

select count(*) into v_n from public.notifications where type = 'crs_training_probe' and user_id = v_sixteen_no_consent_acct;
if v_n = 0 then
  raise notice 'PASS 17 (F): training communication never reaches a 16-year-old without direct consent';
else
  raise notice 'FAIL 17 (F): an unconsented 16-year-old received a direct training notification';
end if;

select count(*) into v_n from public.notifications where type = 'crs_training_probe' and user_id = v_adult_acct;
if v_n = 1 then
  raise notice 'PASS 18 (F): training communication DOES reach an adult player on the squad';
else
  raise notice 'FAIL 18 (F): the adult player received % training notifications', v_n;
end if;

select count(*) into v_n from public.notifications where type = 'crs_training_probe' and user_id = v_guardian_a;
if v_n = 1 then
  raise notice 'PASS 19 (F): a guardian representing THREE players on one squad receives ONE message, not three';
else
  raise notice 'FAIL 19 (F): guardian A received % training notifications', v_n;
end if;

select count(*) into v_n from public.notifications n
where n.type = 'crs_training_probe'
  and n.user_id in (select cm.user_id from public.club_memberships cm where cm.club_id = v_club and cm.role = 'CLUB_ADMIN');
if v_n = 0 then
  raise notice 'PASS 20 (F): training communication never falls back to a club admin';
else
  raise notice 'FAIL 20 (F): a club admin was used as a recipient fallback';
end if;

-- The membership decision path.
insert into public.player_team_memberships (player_id, team_id, status) values (v_sibling, v_other_team, 'pending')
returning id into v_membership;
delete from public.notifications where type = 'add_child_approved';
perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
begin
  perform public.approve_pending_team_membership(v_membership);
exception when others then
  -- Not authorised at the OTHER club, which is itself correct; re-run at the
  -- club this admin actually runs.
  perform set_config('role','postgres',true);
  update public.player_team_memberships set team_id = v_team where id = v_membership;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform public.approve_pending_team_membership(v_membership);
end;
perform set_config('role','postgres',true);

select count(*) into v_n from public.notifications where type = 'add_child_approved' and user_id = v_guardian_a;
if v_n = 1 then
  raise notice 'PASS 21 (F): the membership decision reaches the guardian through the canonical primitive';
else
  raise notice 'FAIL 21 (F): guardian received % membership notifications', v_n;
end if;

-- ============ G. ONE ELIGIBILITY, TWO CHANNELS ============
--
-- The point of a channel-neutral primitive: the SAME set feeds the In-App
-- Notification path and the Email path, and each channel then applies its own
-- policy on top. A channel may narrow the set. It may never widen it, and it
-- may never suppress a different channel.

declare
  v_inapp int; v_audience int; v_before int; v_after int;
begin
  -- The audience resolver and the notification path agree, because they read
  -- the same primitive rather than two similar-looking queries.
  select count(distinct e.user_id) into v_audience
  from internal.player_contact_eligibility(array[v_u12, v_sixteen_no_consent, v_adult]) e
  where e.user_id is not null;
  select count(distinct n.user_id) into v_inapp
  from public.notifications n where n.type = 'crs_training_probe';
  if v_audience = v_inapp then
    raise notice 'PASS 22 (G): the resolved audience and the In-App notifications written are the SAME set of humans (%)', v_inapp;
  else
    raise notice 'FAIL 22 (G): audience resolved % humans, % were notified', v_audience, v_inapp;
  end if;

  -- EMAIL OFF MUST NOT SUPPRESS IN-APP. Turning an email event off is an
  -- Email-channel decision applied above eligibility; the In-App channel does
  -- not consult it and must not be affected by it.
  select count(*) into v_before from public.notifications where type = 'crs_training_probe';
  update public.email_events set active = false where event_key = (select event_key from public.email_events limit 1);
  delete from public.notifications where type = 'crs_training_probe';
  perform internal.notify_training_participants(v_session, 'crs_training_probe', 'Training moved', 'The session has moved.');
  select count(*) into v_after from public.notifications where type = 'crs_training_probe';
  if v_after = v_before and v_after > 0 then
    raise notice 'PASS 23 (G): an email event switched OFF does not suppress the In-App notification (% either side)', v_after;
  else
    raise notice 'FAIL 23 (G): In-App count moved from % to % when an email event was disabled', v_before, v_after;
  end if;

  -- MESSENGER IS NOT A RECIPIENT CHANNEL. Consolidating recipient eligibility
  -- must not quietly turn Messenger into player/guardian direct messaging: no
  -- conversation is created by any of this.
  select
    (select count(*) from public.club_conversations c where c.created_at >= now() - interval '1 minute')
    + (select count(*) from public.fixture_messages m where m.created_at >= now() - interval '1 minute')
  into v_after;
  if v_after = 0 then
    raise notice 'PASS 24 (G): no conversation was created -- Messenger stays a separate channel, not a notification destination';
  else
    raise notice 'FAIL 24 (G): % conversations appeared during recipient resolution', v_after;
  end if;
end;

perform set_config('role','postgres',true);

end $$;

rollback;
