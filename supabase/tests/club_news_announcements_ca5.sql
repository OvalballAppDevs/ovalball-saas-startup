-- NEWS & ANNOUNCEMENTS -- ONE PUBLISHING DOMAIN, TWO CLIENTS (CA-M5).
--
-- The audience is the database's: PUBLIC published content for anyone, MEMBERS content for the people the
-- club or team recognises, drafts for editors only. Publishing authority is club.news.manage at the club
-- or team.news.manage on the team, and club_publishing_scopes answers the client with the write's own rule.
--
--   NA-A  where a person may publish: the scopes read model vs the writes
--   NA-B  cross-scope refusal: a team publisher cannot reach another team, the whole club or another club
--   NA-C  drafts never leak; a window decides whether a notice is live; archive is the lifecycle
--   NA-D  reader isolation: member, guardian of a team's player, unrelated person, another club's admin,
--         an opposition relationship, and the anonymous public
--   NA-E  the lead story is the club's decision
--   NA-F  stale authority: a Club Admin whose club.news.manage is withheld mid-edit is refused
--   NA-G  audit: the row-level audit trigger records every lifecycle change; no notification is created
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims', json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'na-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Na', p_label, 'na-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('NA ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'na-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'na-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

-- What a signed-in reader can see, through RLS, of a club's live content.
create or replace function pg_temp.visible_articles(p_club uuid) returns text[] language plpgsql as $$
declare v text[];
begin
  select coalesce(array_agg(title order by title), '{}') into v from public.club_articles where club_id = p_club and status = 'PUBLISHED';
  return v;
end $$;
create or replace function pg_temp.visible_notices(p_club uuid) returns text[] language plpgsql as $$
declare v text[];
begin
  select coalesce(array_agg(title order by title), '{}') into v from public.club_announcements where club_id = p_club and status = 'PUBLISHED'
    and starts_at <= now() and (expires_at is null or expires_at > now());
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.visible_articles(uuid) to public;
grant execute on function pg_temp.visible_notices(uuid) to public;

do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid;
  v_ca uuid; v_coach uuid; v_member uuid; v_guardian uuid; v_unrelated uuid; v_cab uuid; v_full uuid; v_bcoach uuid;
  v_ms_coach uuid; v_child uuid;
  v_state text; v_n int; r record;
  v_pub_article uuid; v_club_notice uuid; v_team_notice uuid; v_draft uuid; v_t14_notice uuid; v_future uuid; v_deny uuid; v_fixture uuid;
  v_scopes text;
begin
  -- =====================================================================================
  -- SEED
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');
  v_ca := pg_temp.person('ClubAdmin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_coach := pg_temp.person('Coach'); v_ms_coach := pg_temp.member(v_club, v_coach);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  v_member := pg_temp.person('Member'); perform pg_temp.member(v_club, v_member);
  v_guardian := pg_temp.person('Guardian');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Na', 'Child', (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_t12, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_child, 'parent', 'active');
  v_unrelated := pg_temp.person('Unrelated');
  v_cab := pg_temp.person('OtherClubAdmin'); perform pg_temp.member(v_club_b, v_cab, 'CLUB_ADMIN');
  v_bcoach := pg_temp.person('OtherClubCoach'); insert into public.team_permissions (membership_id, team_id, permission) values (pg_temp.member(v_club_b, v_bcoach), v_tb, 'coach');
  v_full := pg_temp.person('SiteFull'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  -- an opposition relationship: club B's Under 12 plays club A's Under 12
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, kickoff_date, status, raw_opposition_text)
  values (v_t12, v_tb, 'Home', current_date + 21, 'Planned', 'NA Away RUFC') returning id into v_fixture;

  -- =====================================================================================
  -- NA-A  WHERE A PERSON MAY PUBLISH
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  select string_agg(scope_type||':'||coalesce(team_display_name,'-'), ', ' order by scope_type, team_display_name) into v_scopes from public.club_publishing_scopes(v_club);
  perform pg_temp.check(v_scopes = 'club:-, team:Under 12 Boys, team:Under 14 Boys', format('NA-A1 a Club Admin may publish for the whole club and every team (%s)', v_scopes));
  perform pg_temp.act('authenticated', v_coach);
  select string_agg(scope_type||':'||coalesce(team_display_name,'-'), ', ') into v_scopes from public.club_publishing_scopes(v_club);
  perform pg_temp.check(v_scopes = 'team:Under 12 Boys', format('NA-A2 a Coach may publish for their own team only (%s)', v_scopes));
  perform pg_temp.act('authenticated', v_member);
  select count(*) into v_n from public.club_publishing_scopes(v_club);
  perform pg_temp.check(v_n = 0, 'NA-A3 a Member may publish nowhere');
  perform pg_temp.act('authenticated', v_guardian);
  select count(*) into v_n from public.club_publishing_scopes(v_club);
  perform pg_temp.check(v_n = 0, 'NA-A4 a guardian may publish nowhere');
  perform pg_temp.act('authenticated', v_cab);
  select count(*) into v_n from public.club_publishing_scopes(v_club);
  perform pg_temp.check(v_n = 0, 'NA-A5 another club''s admin may publish nowhere at this club (an empty answer, not a leak)');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select * from public.club_publishing_scopes(%L)', v_club)) <> 'OK', 'NA-A6 the scopes read is not for the anonymous public');

  -- =====================================================================================
  -- NA-B  CROSS-SCOPE REFUSAL
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_coach);
  v_state := pg_temp.try(format('select public.save_club_announcement(null, %L, %L, ''Training moved'', ''Tuesday is at 6.'', ''NORMAL'', ''MEMBERS'')', v_club, v_t12));
  perform pg_temp.check(v_state = 'OK', format('NA-B1 a Coach writes a notice for their own team (%s)', v_state));
  select id into v_team_notice from public.club_announcements where club_id = v_club and team_id = v_t12 and title = 'Training moved';
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(null, %L, null, ''Whole club'', ''x'', ''NORMAL'', ''PUBLIC'')', v_club)) = '42501', 'NA-B2 but not for the whole club');
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(null, %L, %L, ''Other team'', ''x'', ''NORMAL'', ''PUBLIC'')', v_club, v_t14)) = '42501', 'NA-B3 nor for another team');
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(null, %L, %L, ''Other club'', ''x'', ''NORMAL'', ''PUBLIC'')', v_club_b, v_tb)) = '42501', 'NA-B4 nor for another club''s team, even knowing every id');
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(null, %L, %L, ''Forged'', ''x'', ''NORMAL'', ''PUBLIC'')', v_club_b, v_t12)) = '42501', 'NA-B5 nor by naming their team under another club (a team is only a scope inside its own club)');
  perform pg_temp.check(pg_temp.try(format('select public.save_club_article(null, %L, null, ''Club story'', null, ''Body'', ''NEWS'', ''PUBLIC'')', v_club)) = '42501', 'NA-B6 and the same for news: no club-wide story from a team publisher');
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(%L, %L, %L, ''Training moved'', ''x'', ''NORMAL'', ''MEMBERS'')', v_team_notice, v_club, v_t14)) = '42501', 'NA-B7 an existing team notice cannot be moved to a team the editor does not hold');
  perform pg_temp.act('authenticated', v_cab);
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(%L, %L, %L, ''Hijacked'', ''x'', ''NORMAL'', ''PUBLIC'')', v_team_notice, v_club, v_t12)) = '42501'
                        and pg_temp.try(format('select public.set_club_announcement_status(%L, ''ARCHIVED'')', v_team_notice)) = '42501',
    'NA-B8 CROSS-CLUB: another club''s admin can neither edit nor archive it');

  -- =====================================================================================
  -- NA-C  DRAFTS, WINDOWS, LIFECYCLE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca);
  select article_id into v_draft from public.save_club_article(null, v_club, null, 'Clubhouse roof', 'A summary', '## Roof\n\nThe roof is fixed.', 'UPDATE', 'PUBLIC');
  select article_id into v_pub_article from public.save_club_article(null, v_club, null, 'Kitchen reopens', null, 'Sunday.', 'NEWS', 'PUBLIC');
  perform public.set_club_article_status(v_pub_article, 'PUBLISHED');
  v_club_notice := public.save_club_announcement(null, v_club, null, 'Car park closed', 'Use the school.', 'IMPORTANT', 'MEMBERS');
  perform public.set_club_announcement_status(v_club_notice, 'PUBLISHED');
  v_t14_notice := public.save_club_announcement(null, v_club, v_t14, 'U14 kit day', 'Bring boots.', 'NORMAL', 'MEMBERS');
  perform public.set_club_announcement_status(v_t14_notice, 'PUBLISHED');
  v_future := public.save_club_announcement(null, v_club, null, 'Next month', 'Later.', 'NORMAL', 'PUBLIC', now() + interval '30 days', null);
  perform public.set_club_announcement_status(v_future, 'PUBLISHED');
  perform pg_temp.act('authenticated', v_coach);
  perform public.set_club_announcement_status(v_team_notice, 'PUBLISHED');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(not exists (select 1 from public.club_articles where id = v_draft), 'NA-C1 a draft is invisible to a member');
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(not exists (select 1 from public.club_articles where id = v_draft), 'NA-C2 and to a team editor (a club draft is not their scope)');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(exists (select 1 from public.club_articles where id = v_draft and status = 'DRAFT'), 'NA-C3 but its author sees it in management');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(not ('Next month' = any (pg_temp.visible_notices(v_club))) and not exists (select 1 from public.club_announcements where id = v_future),
    'NA-C4 SCHEDULED: a published notice whose window has not opened is not a reader''s row at all -- the window decides, never a client timer');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(exists (select 1 from public.club_announcements where id = v_future and status = 'PUBLISHED'), 'NA-C4b (its editor sees it, scheduled)');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.save_club_announcement(null, %L, null, ''Expired'', ''x'', ''NORMAL'', ''PUBLIC'', now() - interval ''2 days'', now() - interval ''1 day'')', v_club)) = 'OK'
                        and pg_temp.try(format('select public.set_club_announcement_status((select id from public.club_announcements where club_id = %L and title = ''Expired''), ''PUBLISHED'')', v_club)) = '23514',
    'NA-C5 an already-expired notice cannot be published');
  perform public.set_club_article_status(v_pub_article, 'DRAFT');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(not exists (select 1 from public.club_articles where id = v_pub_article), 'NA-C6 UNPUBLISH: a story taken back to draft leaves every reader''s view');
  perform pg_temp.act('authenticated', v_ca);
  perform public.set_club_article_status(v_pub_article, 'PUBLISHED');
  perform public.set_club_article_status(v_pub_article, 'ARCHIVED');
  perform pg_temp.check((select status from public.club_articles where id = v_pub_article) = 'ARCHIVED' and exists (select 1 from public.club_articles where id = v_pub_article),
    'NA-C7 ARCHIVE is the lifecycle: the row is kept, out of every reader''s view, and there is no hard delete');
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(not exists (select 1 from public.club_articles where id = v_pub_article), 'NA-C7b (a reader no longer sees it)');
  perform pg_temp.act('authenticated', v_ca);
  perform public.set_club_article_status(v_pub_article, 'PUBLISHED');
  perform pg_temp.check((select first_published_at is not null from public.club_articles where id = v_pub_article), 'NA-C8 restoring keeps the date it was first read on');

  -- =====================================================================================
  -- NA-D  READER ISOLATION
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_member);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = array['Car park closed', 'Training moved', 'U14 kit day'] and pg_temp.visible_articles(v_club) = array['Kitchen reopens'],
    format('NA-D1 a club MEMBER sees the club''s members-only notices and every team''s (%s)', array_to_string(pg_temp.visible_notices(v_club), ', ')));
  perform pg_temp.act('authenticated', v_guardian);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = array['Training moved'] and pg_temp.visible_articles(v_club) = array['Kitchen reopens'],
    format('NA-D2 a GUARDIAN with no membership sees public news, their child''s team notices, and NOT the club''s members-only or another team''s (%s)', array_to_string(pg_temp.visible_notices(v_club), ', ')));
  perform pg_temp.act('authenticated', v_unrelated);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = '{}'::text[] and pg_temp.visible_articles(v_club) = array['Kitchen reopens'],
    'NA-D3 an UNRELATED signed-in person sees public news only');
  perform pg_temp.act('authenticated', v_cab);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = '{}'::text[] and pg_temp.visible_articles(v_club) = array['Kitchen reopens'],
    'NA-D4 CROSS-CLUB: another club''s admin sees public news only, never a members-only notice');
  perform pg_temp.act('authenticated', v_bcoach);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = '{}'::text[], 'NA-D5 OPPOSITION: a fixture against the team creates no readership of its notices');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.visible_notices(v_club) = '{}'::text[] and pg_temp.visible_articles(v_club) = array['Kitchen reopens'], 'NA-D6 the anonymous public sees public news only');
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check('Training moved' = any (pg_temp.visible_notices(v_club)) and 'Car park closed' = any (pg_temp.visible_notices(v_club)),
    'NA-D7 a Coach (a club member) reads the club''s members-only notices too');

  -- A FAMILY ACROSS CLUBS. Two children at two clubs: the guardian hears each club's own team notices and
  -- public news, and nothing members-only that neither child's team is in -- the relationship names the
  -- clubs to ask; the row policies decide every row.
  perform pg_temp.act_postgres();
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Na', 'SecondChild', (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_tb, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_child, 'parent', 'active');
  perform pg_temp.act('authenticated', v_cab);
  perform public.set_club_announcement_status(public.save_club_announcement(null, v_club_b, v_tb, 'Away U12 kit', 'Bring boots.', 'NORMAL', 'MEMBERS'), 'PUBLISHED');
  perform public.set_club_announcement_status(public.save_club_announcement(null, v_club_b, null, 'Away club members only', 'x', 'NORMAL', 'MEMBERS'), 'PUBLISHED');
  perform pg_temp.act('authenticated', v_guardian);
  perform pg_temp.check(pg_temp.visible_notices(v_club) = array['Training moved'] and pg_temp.visible_notices(v_club_b) = array['Away U12 kit'],
    format('NA-D8 MULTI-CLUB FAMILY: a guardian with a child at each club hears each club''s own team notice and neither club''s members-only notice (%s | %s)', array_to_string(pg_temp.visible_notices(v_club), ', '), array_to_string(pg_temp.visible_notices(v_club_b), ', ')));
  -- Two children on the SAME team: the row is one row -- there is nothing to duplicate server-side, and the
  -- client joins by publication id (news_reading_scope.test.mts).
  perform pg_temp.act_postgres();
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Na', 'ThirdChild', (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_t12, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_child, 'parent', 'active');
  perform pg_temp.act('authenticated', v_guardian);
  select count(*) into v_n from public.club_announcements where club_id = v_club and title = 'Training moved';
  perform pg_temp.check(v_n = 1 and pg_temp.visible_notices(v_club) = array['Training moved'], 'NA-D9 two children on the same team: one row, one notice, and still not the sibling team''s');

  -- =====================================================================================
  -- NA-E  THE LEAD STORY
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_article_featured(%L, true)', v_pub_article)) = '42501', 'NA-E1 a team publisher cannot choose the club''s lead story');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_article_featured(%L, true)', v_draft)) = '23514', 'NA-E2 a draft cannot lead');
  perform pg_temp.check(pg_temp.try(format('select public.set_club_article_featured(%L, true)', v_pub_article)) = 'OK', 'NA-E3 the club chooses a published story');

  -- =====================================================================================
  -- NA-F  STALE AUTHORITY
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_full);
  v_deny := public.set_capability_override(v_ca, 'club.news.manage', 'club', v_club, null, 'deny', 'CA-M5: stale-authority proof');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.save_club_article(%L, %L, null, ''Clubhouse roof'', ''edited'', ''x'', ''UPDATE'', ''PUBLIC'')', v_draft, v_club)) = '42501'
                        and pg_temp.try(format('select public.set_club_article_status(%L, ''PUBLISHED'')', v_draft)) = '42501'
                        and not exists (select 1 from public.club_publishing_scopes(v_club) where scope_type = 'club'),
    'NA-F1 with club.news.manage withheld mid-edit the club-wide save and publish refuse and the club scope is gone (their team scopes, held by the same role''s team.news.manage, stay -- a withhold reaches what it names)');
  perform pg_temp.check((select excerpt from public.club_articles where id = v_draft) is distinct from 'edited', 'NA-F2 (nothing mutated)');
  perform pg_temp.act('authenticated', v_full);
  perform public.revoke_capability_override(v_deny, 'CA-M5: restored');
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_article_status(%L, ''PUBLISHED'')', v_draft)) = 'OK', 'NA-F3 and the publish proceeds once the withhold is revoked');

  -- =====================================================================================
  -- NA-G  AUDIT, AND THE TRUTH ABOUT NOTIFICATIONS
  -- =====================================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.audit_log where table_name = 'club_articles' and record_id = v_pub_article;
  perform pg_temp.check(v_n >= 4, format('NA-G1 every lifecycle change of a story is in the row-level audit (%s rows: create, publish, unpublish, publish, archive, restore, feature)', v_n));
  select count(*) into v_n from public.audit_log where table_name = 'club_announcements' and record_id = v_team_notice and actor_user_id = v_coach;
  perform pg_temp.check(v_n >= 2, format('NA-G2 a team notice''s create and publish carry the Coach as actor (%s)', v_n));
  select count(*) into v_n from public.notifications where created_at > now() - interval '1 minute' and (data::text like '%' || v_pub_article::text || '%' or data::text like '%' || v_club_notice::text || '%');
  perform pg_temp.check(v_n = 0, 'NA-G3 THE TRUTH: publishing creates no notification row -- a notice is read when a person comes and looks (documented, not faked)');
end $$;

rollback;
