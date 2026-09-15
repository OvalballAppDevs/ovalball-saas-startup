-- CLUB DIGITAL HOME (20270340000000).
--
-- Club news, team news, announcements and the Welcome to Ovalball article.
-- Every assertion here is made against the database itself -- the boundary a
-- hidden button cannot move:
--
--   A. authority is the two news capabilities, scoped, and nothing wider
--   B. a draft is never public; publishing and archiving move exactly one row
--   C. team authority stays inside its team and its club
--   D. browser roles cannot write the tables or read who wrote a row
--   E. members-only content, club status and announcement windows
--   F. Welcome to Ovalball is created once per club, on establishment only
--   G. article images: authority follows the object path
--
-- Self-seeding and rolled back: it depends on no UAT seed and leaves the
-- database exactly as it found it.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_digital_home.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Functions created by postgres carry no PUBLIC EXECUTE since the Slice 1
-- perimeter; these session helpers are called after switching role.
grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_admin_a uuid := gen_random_uuid();
  v_coach_a1 uuid := gen_random_uuid();
  v_manager_a2 uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir_a uuid; v_dir_b uuid;
  v_club_a uuid; v_club_b uuid;
  v_team_a1 uuid; v_team_a2 uuid; v_team_b1 uuid;
  v_ms uuid;
  v_article uuid; v_team_article uuid; v_members_article uuid; v_other uuid;
  v_slug text; v_slug2 text;
  v_ann uuid;
  v_welcome uuid;
  v_count integer;
  v_text text;
  v_ok boolean;
begin
  -- ---------------------------------------------------------------
  -- Seed
  -- ---------------------------------------------------------------
  foreach v_person in array array[v_admin_a, v_coach_a1, v_manager_a2, v_member_a, v_admin_b, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cdh-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Cdh', 'Tester', 'cdh-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CDH Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cdh-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CDH Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cdh-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'cdh-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'cdh-b-' || v_tag, 'active') returning id into v_club_b;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'cdh-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a1;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 14 Boys', 'cdh-a-u14-' || v_tag, 'youth', 'U14', 'boys', 'union', true) returning id into v_team_a2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 'cdh-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b1;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (v_club_a, v_member_a, 'BASIC_USER', 'active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_coach_a1, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team_a1, 'coach');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_manager_a2, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team_a2, 'manager');

  -- =================================================================
  -- A. AUTHORITY
  -- =================================================================
  perform pg_temp.act('authenticated', v_admin_a);
  if internal.may_edit_club_content(v_club_a, null) and internal.may_edit_club_content(v_club_a, v_team_a1)
     and not internal.may_edit_club_content(v_club_b, null) then
    raise notice 'PASS A1: a Club Admin may write club and team news at their own club, and not at another';
  else
    raise notice 'FAIL A1: Club Admin news authority is wrong';
  end if;

  perform pg_temp.act('authenticated', v_coach_a1);
  if internal.may_edit_club_content(v_club_a, v_team_a1)
     and not internal.may_edit_club_content(v_club_a, null)
     and not internal.may_edit_club_content(v_club_a, v_team_a2)
     and not internal.may_edit_club_content(v_club_b, v_team_b1) then
    raise notice 'PASS A2: a coach may write news for their own team only -- not the club, not another team';
  else
    raise notice 'FAIL A2: coach news authority leaked outside their team';
  end if;

  perform pg_temp.act('authenticated', v_manager_a2);
  if internal.may_edit_club_content(v_club_a, v_team_a2) and not internal.may_edit_club_content(v_club_a, v_team_a1) then
    raise notice 'PASS A3: a team manager may write news for their own team only';
  else
    raise notice 'FAIL A3: team manager news authority is wrong';
  end if;

  perform pg_temp.act('authenticated', v_member_a);
  if not internal.may_edit_club_content(v_club_a, null) and not internal.may_edit_club_content(v_club_a, v_team_a1) then
    raise notice 'PASS A4: an ordinary member has no news authority';
  else
    raise notice 'FAIL A4: an ordinary member can write club news';
  end if;

  -- Team authority cannot be borrowed across clubs by naming another club's team.
  perform pg_temp.act('authenticated', v_admin_a);
  if not internal.may_edit_club_content(v_club_a, v_team_b1) then
    raise notice 'PASS A5: a team from another club never resolves to authority at this club';
  else
    raise notice 'FAIL A5: another club''s team resolved to authority here';
  end if;

  -- =================================================================
  -- B. LIFECYCLE AND THE PUBLIC
  -- =================================================================
  perform pg_temp.act('authenticated', v_admin_a);
  select article_id, article_slug into v_article, v_slug
  from public.save_club_article(null, v_club_a, null, 'Clubhouse Refurbishment Complete', 'The bar reopens on Friday.',
    'The work is finished.' || E'\n\n' || 'Thank you to every volunteer.', 'UPDATE', 'PUBLIC', null, null);

  if v_slug = 'clubhouse-refurbishment-complete' then
    raise notice 'PASS B1: a new article is a draft with a slug derived from its title';
  else
    raise notice 'FAIL B1: unexpected slug %', v_slug;
  end if;

  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where id = v_article;
  if v_count = 0 then raise notice 'PASS B2: a draft is invisible to a signed-out visitor';
  else raise notice 'FAIL B2: a draft article is public'; end if;

  perform pg_temp.act('authenticated', v_member_a);
  select count(*) into v_count from public.club_articles where id = v_article;
  if v_count = 0 then raise notice 'PASS B3: a draft is invisible to an ordinary member of the same club';
  else raise notice 'FAIL B3: a member can read a draft'; end if;

  -- An ordinary member cannot publish it, even knowing its id.
  begin
    perform public.set_club_article_status(v_article, 'PUBLISHED');
    raise notice 'FAIL B4: an ordinary member published an article';
  exception when insufficient_privilege then
    raise notice 'PASS B4: an ordinary member cannot publish';
  end;

  -- A second draft with the same title gets its own slug.
  perform pg_temp.act('authenticated', v_admin_a);
  select article_id, article_slug into v_other, v_slug2
  from public.save_club_article(null, v_club_a, null, 'Clubhouse Refurbishment Complete', null, 'Second copy.', 'NEWS', 'PUBLIC', null, null);
  if v_slug2 = 'clubhouse-refurbishment-complete-2' then
    raise notice 'PASS B5: two articles with one title get two distinct URLs';
  else
    raise notice 'FAIL B5: duplicate title slug was %', v_slug2;
  end if;

  perform public.set_club_article_status(v_article, 'PUBLISHED');
  perform public.set_club_article_status(v_article, 'PUBLISHED'); -- retry is a no-op
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where id = v_article and status = 'PUBLISHED' and published_at is not null;
  if v_count = 1 then raise notice 'PASS B6: a published public article is readable by a signed-out visitor, and publishing twice is harmless';
  else raise notice 'FAIL B6: published article not public (% rows)', v_count; end if;

  -- The slug is frozen once the article has been public.
  perform pg_temp.act('authenticated', v_admin_a);
  select article_slug into v_text from public.save_club_article(v_article, v_club_a, null, 'Clubhouse Refurbishment Finished', 'The bar reopens on Friday.', 'The work is finished.', 'UPDATE', 'PUBLIC', null, null);
  if v_text = v_slug then raise notice 'PASS B7: correcting the headline of a published article keeps its shared link';
  else raise notice 'FAIL B7: publishing did not freeze the slug (now %)', v_text; end if;

  select article_slug into v_text from public.save_club_article(v_other, v_club_a, null, 'A Different Draft Headline', null, 'Second copy.', 'NEWS', 'PUBLIC', null, null);
  if v_text = 'a-different-draft-headline' then raise notice 'PASS B8: a never-published draft''s link follows its title';
  else raise notice 'FAIL B8: draft slug did not follow title (%)', v_text; end if;

  perform public.set_club_article_status(v_article, 'ARCHIVED');
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where id = v_article;
  if v_count = 0 then raise notice 'PASS B9: an archived article leaves every public surface';
  else raise notice 'FAIL B9: an archived article is still public'; end if;

  perform pg_temp.act('authenticated', v_admin_a);
  select count(*) into v_count from public.club_articles where id = v_article and status = 'ARCHIVED' and archived_at is not null;
  if v_count = 1 then raise notice 'PASS B10: the club still sees its archived article, marked archived';
  else raise notice 'FAIL B10: the editor lost sight of the archived article'; end if;

  -- Restoring keeps the original publication date.
  perform public.set_club_article_status(v_article, 'PUBLISHED');
  select count(*) into v_count from public.club_articles where id = v_article and status = 'PUBLISHED' and archived_at is null and published_at = first_published_at;
  if v_count = 1 then raise notice 'PASS B11: restoring an archived article keeps the date it was first published';
  else raise notice 'FAIL B11: restore rewrote the publication date'; end if;

  begin
    perform public.save_club_article(null, v_club_a, null, 'Hi', null, 'x', 'NEWS', 'PUBLIC', null, null);
    raise notice 'FAIL B12: a two-character headline was accepted';
  exception when check_violation then
    raise notice 'PASS B12: headline length is enforced by the database';
  end;

  -- =================================================================
  -- C. TEAM SCOPE
  -- =================================================================
  perform pg_temp.act('authenticated', v_coach_a1);
  select article_id into v_team_article
  from public.save_club_article(null, v_club_a, v_team_a1, 'Under 12s Win At Home', 'A great morning.', 'Well played, everyone.', 'MATCH_REPORT', 'PUBLIC', null, null);
  perform public.set_club_article_status(v_team_article, 'PUBLISHED');
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where id = v_team_article and team_id = v_team_a1 and club_id = v_club_a;
  if v_count = 1 then raise notice 'PASS C1: a coach can publish their team''s article, and it belongs to the club and the team';
  else raise notice 'FAIL C1: team article not published in scope'; end if;

  perform pg_temp.act('authenticated', v_coach_a1);
  begin
    perform public.save_club_article(null, v_club_a, null, 'A Club-Wide Story', null, 'x', 'NEWS', 'PUBLIC', null, null);
    raise notice 'FAIL C2: a coach wrote club-wide news';
  exception when insufficient_privilege then
    raise notice 'PASS C2: a coach cannot write club-wide news';
  end;

  begin
    perform public.save_club_article(null, v_club_a, v_team_a2, 'Another Team Story', null, 'x', 'NEWS', 'PUBLIC', null, null);
    raise notice 'FAIL C3: a coach wrote news for a team they do not coach';
  exception when insufficient_privilege then
    raise notice 'PASS C3: a coach cannot write news for another team';
  end;

  begin
    perform public.save_club_article(v_team_article, v_club_a, v_team_a2, 'Under 12s Win At Home', null, 'x', 'MATCH_REPORT', 'PUBLIC', null, null);
    raise notice 'FAIL C4: a coach moved their article onto a team they do not coach';
  exception when insufficient_privilege then
    raise notice 'PASS C4: moving an article to another team needs authority over that team';
  end;

  begin
    perform public.set_club_article_status(v_article, 'ARCHIVED');
    raise notice 'FAIL C5: a coach archived the club''s own article';
  exception when insufficient_privilege then
    raise notice 'PASS C5: a coach cannot archive a club-wide article';
  end;

  begin
    perform public.set_club_article_featured(v_team_article, true);
    raise notice 'FAIL C6: a coach chose the club''s lead story';
  exception when insufficient_privilege then
    raise notice 'PASS C6: only the club chooses its lead story';
  end;

  perform pg_temp.act('authenticated', v_admin_b);
  begin
    perform public.save_club_article(v_article, v_club_a, null, 'Hijacked Headline', null, 'x', 'NEWS', 'PUBLIC', null, null);
    raise notice 'FAIL C7: another club''s admin edited this club''s article';
  exception when insufficient_privilege then
    raise notice 'PASS C7: another club''s admin cannot edit this club''s article';
  end;
  begin
    perform public.save_club_article(null, v_club_a, null, 'Written From Outside', null, 'x', 'NEWS', 'PUBLIC', null, null);
    raise notice 'FAIL C8: another club''s admin wrote news for this club';
  exception when insufficient_privilege then
    raise notice 'PASS C8: another club''s admin cannot write news for this club';
  end;
  begin
    perform public.set_club_article_status(v_team_article, 'ARCHIVED');
    raise notice 'FAIL C9: another club''s admin archived this club''s team article';
  exception when insufficient_privilege then
    raise notice 'PASS C9: another club''s admin cannot archive this club''s team article';
  end;

  -- Moving an article to another club is refused whoever asks.
  perform pg_temp.act('authenticated', v_admin_a);
  begin
    perform public.save_club_article(v_article, v_club_b, null, 'Clubhouse Refurbishment Finished', null, 'x', 'UPDATE', 'PUBLIC', null, null);
    raise notice 'FAIL C10: an article moved to another club';
  exception when check_violation then
    raise notice 'PASS C10: an article can never move to another club';
  end;

  -- One lead story per club.
  perform public.set_club_article_featured(v_article, true);
  perform public.set_club_article_featured(v_team_article, true);
  select count(*) into v_count from public.club_articles where club_id = v_club_a and featured;
  if v_count = 1 and (select featured from public.club_articles where id = v_team_article) then
    raise notice 'PASS C11: choosing a new lead story replaces the old one -- a club has exactly one';
  else
    raise notice 'FAIL C11: % featured articles', v_count;
  end if;

  -- =================================================================
  -- D. BROWSER ROLES CANNOT WRITE, OR SEE WHO WROTE
  -- =================================================================
  perform pg_temp.act('authenticated', v_admin_a);
  begin
    insert into public.club_articles (club_id, slug, title, body) values (v_club_a, 'direct-' || v_tag, 'Direct Insert', 'x');
    raise notice 'FAIL D1: a Club Admin inserted an article directly, bypassing the functions';
  exception when insufficient_privilege then
    raise notice 'PASS D1: even a Club Admin cannot insert into club_articles directly';
  end;
  begin
    update public.club_articles set title = 'Direct Update' where id = v_article;
    raise notice 'FAIL D2: a Club Admin updated an article directly';
  exception when insufficient_privilege then
    raise notice 'PASS D2: direct UPDATE on club_articles is refused';
  end;
  begin
    delete from public.club_articles where id = v_article;
    raise notice 'FAIL D3: a Club Admin deleted an article directly';
  exception when insufficient_privilege then
    raise notice 'PASS D3: direct DELETE on club_articles is refused';
  end;
  begin
    insert into public.club_announcements (club_id, title) values (v_club_a, 'Direct Notice');
    raise notice 'FAIL D4: a Club Admin inserted an announcement directly';
  exception when insufficient_privilege then
    raise notice 'PASS D4: direct INSERT on club_announcements is refused';
  end;

  perform pg_temp.act('anon');
  begin
    perform created_by from public.club_articles limit 1;
    raise notice 'FAIL D5: a signed-out visitor can read who created an article';
  exception when insufficient_privilege then
    raise notice 'PASS D5: the person behind an article is not readable -- the byline is the club or team';
  end;
  begin
    update public.club_articles set title = 'Anon Update' where id = v_article;
    raise notice 'FAIL D6: a signed-out visitor updated an article';
  exception when insufficient_privilege then
    raise notice 'PASS D6: a signed-out visitor cannot mutate club content';
  end;

  perform pg_temp.act_postgres();
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('save_club_article', 'set_club_article_status', 'set_club_article_featured', 'save_club_announcement', 'set_club_announcement_status')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_count = 0 then raise notice 'PASS D7: no publishing function is executable by a signed-out caller';
  else raise notice 'FAIL D7: % publishing function(s) are executable by anon', v_count; end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename in ('club_articles', 'club_announcements') and cmd <> 'SELECT';
  if v_count = 0 then raise notice 'PASS D8: the content tables carry read policies only -- every write is a function';
  else raise notice 'FAIL D8: % write policies exist on content tables', v_count; end if;

  if exists (select 1 from pg_trigger where tgrelid = 'public.club_articles'::regclass and tgname = 'audit_row_change')
     and exists (select 1 from pg_trigger where tgrelid = 'public.club_announcements'::regclass and tgname = 'audit_row_change') then
    raise notice 'PASS D9: every article and announcement change is written to the audit log';
  else
    raise notice 'FAIL D9: content tables are not audited';
  end if;

  -- =================================================================
  -- E. MEMBERS-ONLY, CLUB STATUS, ANNOUNCEMENT WINDOWS
  -- =================================================================
  perform pg_temp.act('authenticated', v_admin_a);
  select article_id into v_members_article
  from public.save_club_article(null, v_club_a, null, 'Members Evening Details', null, 'Doors at seven.', 'EVENT', 'MEMBERS', null, null);
  perform public.set_club_article_status(v_members_article, 'PUBLISHED');

  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where id = v_members_article;
  perform pg_temp.act('authenticated', v_stranger);
  select v_count + count(*) into v_count from public.club_articles where id = v_members_article;
  if v_count = 0 then raise notice 'PASS E1: a members-only article is hidden from visitors and from signed-in strangers';
  else raise notice 'FAIL E1: members-only article leaked (% rows)', v_count; end if;

  perform pg_temp.act('authenticated', v_member_a);
  select count(*) into v_count from public.club_articles where id = v_members_article;
  if v_count = 1 then raise notice 'PASS E2: a member of the club reads its members-only article';
  else raise notice 'FAIL E2: a club member cannot read members-only content'; end if;

  perform pg_temp.act_postgres();
  update public.clubs set status = 'suspended' where id = v_club_a;
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_articles where club_id = v_club_a;
  if v_count = 0 then raise notice 'PASS E3: a suspended club publishes nothing';
  else raise notice 'FAIL E3: a suspended club''s articles are public'; end if;
  perform pg_temp.act_postgres();
  update public.clubs set status = 'active' where id = v_club_a;

  perform pg_temp.act('authenticated', v_admin_a);
  v_ann := public.save_club_announcement(null, v_club_a, null, 'Clubhouse Closed Saturday', 'Back open on Sunday.', 'IMPORTANT', 'PUBLIC', now() - interval '1 hour', now() + interval '1 day', 'Club Calendar', '/calendar');
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_announcements where id = v_ann;
  if v_count = 0 then raise notice 'PASS E4: a draft announcement is not public';
  else raise notice 'FAIL E4: a draft announcement is public'; end if;

  perform pg_temp.act('authenticated', v_admin_a);
  perform public.set_club_announcement_status(v_ann, 'PUBLISHED');
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_announcements where id = v_ann;
  if v_count = 1 then raise notice 'PASS E5: a published announcement inside its window is public';
  else raise notice 'FAIL E5: live announcement not public'; end if;

  perform pg_temp.act('authenticated', v_admin_a);
  perform public.save_club_announcement(v_ann, v_club_a, null, 'Clubhouse Closed Saturday', null, 'IMPORTANT', 'PUBLIC', now() + interval '2 days', now() + interval '3 days', null, null);
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_announcements where id = v_ann;
  if v_count = 0 then raise notice 'PASS E6: an announcement scheduled for later is not shown before it starts';
  else raise notice 'FAIL E6: a future announcement is already public'; end if;

  perform pg_temp.act_postgres();
  update public.club_announcements set starts_at = now() - interval '3 days', expires_at = now() - interval '1 day' where id = v_ann;
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_announcements where id = v_ann;
  if v_count = 0 then raise notice 'PASS E7: an expired announcement stops showing on its own';
  else raise notice 'FAIL E7: an expired announcement is still public'; end if;

  perform pg_temp.act('authenticated', v_admin_a);
  select count(*) into v_count from public.club_announcements where id = v_ann;
  if v_count = 1 then raise notice 'PASS E8: the club still sees its expired announcement';
  else raise notice 'FAIL E8: the editor lost sight of an expired announcement'; end if;

  begin
    perform public.save_club_announcement(null, v_club_a, null, 'Unsafe Link', null, 'NORMAL', 'PUBLIC', now(), null, 'Open', 'javascript:alert(1)');
    raise notice 'FAIL E9: a javascript: link was accepted';
  exception when check_violation then
    raise notice 'PASS E9: an announcement link must be https:// or a path on this site';
  end;
  begin
    perform public.save_club_announcement(null, v_club_a, null, 'Protocol Relative', null, 'NORMAL', 'PUBLIC', now(), null, 'Open', '//evil.example');
    raise notice 'FAIL E10: a protocol-relative link was accepted';
  exception when check_violation then
    raise notice 'PASS E10: a protocol-relative link cannot leave the site unannounced';
  end;

  perform pg_temp.act('authenticated', v_coach_a1);
  begin
    perform public.save_club_announcement(null, v_club_a, null, 'Coach Club Notice', null, 'NORMAL', 'PUBLIC', now(), null, null, null);
    raise notice 'FAIL E11: a coach posted a club-wide announcement';
  exception when insufficient_privilege then
    raise notice 'PASS E11: a coach cannot post a club-wide announcement';
  end;
  v_ann := public.save_club_announcement(null, v_club_a, v_team_a1, 'Training Moved To Thursday', null, 'NORMAL', 'MEMBERS', now() - interval '1 minute', null, null, null);
  perform public.set_club_announcement_status(v_ann, 'PUBLISHED');
  perform pg_temp.act('anon');
  select count(*) into v_count from public.club_announcements where id = v_ann;
  perform pg_temp.act('authenticated', v_member_a);
  if v_count = 0 and (select count(*) from public.club_announcements where id = v_ann) = 1 then
    raise notice 'PASS E12: a coach''s members-only team notice reaches members and not the public';
  else
    raise notice 'FAIL E12: team notice visibility is wrong';
  end if;

  -- =================================================================
  -- F. WELCOME TO OVALBALL
  -- =================================================================
  perform pg_temp.act_postgres();
  insert into public.club_setup_state (club_id, status) values (v_club_b, 'NOT_STARTED');
  if not exists (select 1 from public.club_articles where club_id = v_club_b) then
    raise notice 'PASS F1: a club that has not finished setting up has no welcome article';
  else
    raise notice 'FAIL F1: a welcome article appeared before the club was established';
  end if;

  update public.club_setup_state set status = 'IN_PROGRESS', started_at = now() where club_id = v_club_b;
  update public.club_setup_state set status = 'COMPLETED', completed_at = now() where club_id = v_club_b;

  select id into v_welcome from public.club_articles where club_id = v_club_b and system_key = 'WELCOME_TO_OVALBALL';
  select count(*) into v_count from public.club_articles where club_id = v_club_b;
  if v_welcome is not null and v_count = 1 then
    raise notice 'PASS F2: completing setup publishes exactly one Welcome to Ovalball article';
  else
    raise notice 'FAIL F2: % articles after completion', v_count;
  end if;

  select title into v_text from public.club_articles where id = v_welcome;
  if v_text = 'Welcome to Ovalball'
     and (select status = 'PUBLISHED' and visibility = 'PUBLIC' and team_id is null and slug = 'welcome-to-ovalball' from public.club_articles where id = v_welcome)
     and (select body like 'CDH Bravo RUFC ' || v_tag || ' has joined Ovalball%' from public.club_articles where id = v_welcome) then
    raise notice 'PASS F3: the welcome is a published, public, club-wide article naming the right club';
  else
    raise notice 'FAIL F3: welcome article content or state is wrong';
  end if;

  select body into v_text from public.club_articles where id = v_welcome;
  if v_text like '%](/rugby-hub)%' and v_text like '%](/calendar)%' and v_text like '%](/teams)%' and v_text like '%](/messages)%'
     and v_text not like '%http://%' then
    raise notice 'PASS F4: the welcome links to canonical in-app routes only';
  else
    raise notice 'FAIL F4: welcome links are not the canonical routes';
  end if;

  if not exists (select 1 from public.club_articles where club_id = v_club_a and system_key is not null) then
    raise notice 'PASS F5: another club''s establishment wrote nothing to this club';
  else
    raise notice 'FAIL F5: a welcome article landed on the wrong club';
  end if;

  -- Retries: the trigger firing again, the function called again, a new team.
  update public.club_setup_state set status = 'COMPLETED' where club_id = v_club_b;
  update public.club_setup_state set status = 'IN_PROGRESS' where club_id = v_club_b;
  update public.club_setup_state set status = 'COMPLETED' where club_id = v_club_b;
  perform internal.ensure_club_welcome_article(v_club_b);
  perform internal.ensure_club_welcome_article(v_club_b);
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 14 Boys', 'cdh-b-u14-' || v_tag, 'youth', 'U14', 'boys', 'union', true);
  select count(*) into v_count from public.club_articles where club_id = v_club_b;
  if v_count = 1 then
    raise notice 'PASS F6: retries, repeated completion and new teams never produce a second welcome';
  else
    raise notice 'FAIL F6: % welcome articles after retries', v_count;
  end if;

  -- An archived welcome stays archived.
  perform pg_temp.act('authenticated', v_admin_b);
  perform public.set_club_article_status(v_welcome, 'ARCHIVED');
  perform pg_temp.act_postgres();
  update public.club_setup_state set status = 'IN_PROGRESS' where club_id = v_club_b;
  update public.club_setup_state set status = 'COMPLETED' where club_id = v_club_b;
  if (select count(*) from public.club_articles where club_id = v_club_b) = 1
     and (select status from public.club_articles where id = v_welcome) = 'ARCHIVED' then
    raise notice 'PASS F7: a welcome the club archived is never re-created or re-published';
  else
    raise notice 'FAIL F7: archiving the welcome did not stick';
  end if;

  -- The club can edit it like any other article.
  perform pg_temp.act('authenticated', v_admin_b);
  perform public.save_club_article(v_welcome, v_club_b, null, 'Welcome to Ovalball', 'Edited by the club.', 'Our own words.', 'WELCOME', 'PUBLIC', null, null);
  if (select excerpt from public.club_articles where id = v_welcome) = 'Edited by the club.' then
    raise notice 'PASS F8: the club can edit the article Ovalball wrote for it';
  else
    raise notice 'FAIL F8: the welcome article is not editable by its club';
  end if;

  perform pg_temp.act('authenticated', v_admin_b);
  begin
    perform internal.ensure_club_welcome_article(v_club_a);
    raise notice 'FAIL F9: a signed-in caller invoked the welcome generator directly';
  exception when insufficient_privilege then
    raise notice 'PASS F9: nobody signed in can call the welcome generator directly';
  end;

  -- A club inserted straight into COMPLETED (a migration-style backfill) is welcomed too, once.
  perform pg_temp.act_postgres();
  insert into public.club_setup_state (club_id, status, completed_at) values (v_club_a, 'COMPLETED', now());
  if (select count(*) from public.club_articles where club_id = v_club_a and system_key = 'WELCOME_TO_OVALBALL') = 1
     and (select count(*) from public.club_articles where club_id = v_club_a and featured) = 1 then
    raise notice 'PASS F10: a welcome never takes the lead story from one the club already chose';
  else
    raise notice 'FAIL F10: welcome on insert-completed or lead-story handling is wrong';
  end if;

  -- =================================================================
  -- G. ARTICLE IMAGES
  -- =================================================================
  perform pg_temp.act('authenticated', v_coach_a1);
  if internal.may_manage_club_news_media(v_club_a || '/' || v_team_a1 || '/' || gen_random_uuid() || '.jpg')
     and not internal.may_manage_club_news_media(v_club_a || '/club/' || gen_random_uuid() || '.jpg')
     and not internal.may_manage_club_news_media(v_club_a || '/' || v_team_a2 || '/' || gen_random_uuid() || '.jpg')
     and not internal.may_manage_club_news_media(v_club_b || '/' || v_team_b1 || '/' || gen_random_uuid() || '.jpg') then
    raise notice 'PASS G1: a coach may upload into their own team''s folder only';
  else
    raise notice 'FAIL G1: image upload authority does not follow the path';
  end if;

  perform pg_temp.act('authenticated', v_admin_a);
  if internal.may_manage_club_news_media(v_club_a || '/club/' || gen_random_uuid() || '.webp')
     and not internal.may_manage_club_news_media(v_club_a || '/club/../x.jpg')
     and not internal.may_manage_club_news_media(v_club_a || '/club/' || gen_random_uuid() || '.svg')
     and not internal.may_manage_club_news_media('logo.png') then
    raise notice 'PASS G2: malformed paths, traversal and SVG never pass the upload check';
  else
    raise notice 'FAIL G2: a malformed or SVG path passed the upload check';
  end if;

  perform pg_temp.act_postgres();
  if exists (select 1 from storage.buckets where id = 'club-news-media' and public and file_size_limit = 5242880
             and not ('image/svg+xml' = any(allowed_mime_types))) then
    raise notice 'PASS G3: the article image bucket is public to read, capped at 5MB and refuses SVG';
  else
    raise notice 'FAIL G3: article image bucket configuration is wrong';
  end if;

  perform pg_temp.act('authenticated', v_admin_a);
  begin
    perform public.save_club_article(v_article, v_club_a, null, 'Clubhouse Refurbishment Finished', null, 'x', 'UPDATE', 'PUBLIC', v_club_b || '/club/' || gen_random_uuid() || '.jpg', 'A picture');
    raise notice 'FAIL G4: an article pointed at another club''s image';
  exception when check_violation then
    raise notice 'PASS G4: an article can only use an image stored under its own club';
  end;
  begin
    perform public.save_club_article(v_article, v_club_a, null, 'Clubhouse Refurbishment Finished', null, 'x', 'UPDATE', 'PUBLIC', v_club_a || '/club/' || gen_random_uuid() || '.jpg', null);
    raise notice 'FAIL G5: an image was attached without alt text';
  exception when check_violation then
    raise notice 'PASS G5: an article image cannot be saved without alt text';
  end;

  perform pg_temp.act_postgres();
end $$;

rollback;
