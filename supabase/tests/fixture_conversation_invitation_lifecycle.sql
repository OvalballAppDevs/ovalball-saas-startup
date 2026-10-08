-- FIXTURE CONVERSATION INVITATION LIFECYCLE (20270764000000) -- the locked policy: an invitation belongs to the
-- conversation it was given for, not to whichever opponent now occupies the fixture. Proved as the people concerned;
-- wrapped in a transaction and rolled back.
--   INV-a..c  the invited referee keeps READ access to the earlier conversation (messages, attachment, read state)
--   INV-d..f  ...which is read-only for them: no new message, reaction or reply
--   INV-g..i  they are not carried into the new conversation (no access, no notification, no transferred invitation)
--   INV-j..m  the new opponent reaches nothing of the earlier conversation
--   INV-n..o2 an explicit new invitation admits them to the new conversation (and its notifications), and keeps the
--             old one readable
--   INV-p..r  an explicit revocation removes both, and history is still there for everyone else
--   INV-t..z  invited-after-change, invitation visibility, realtime, dead session, safeguarding withhold, no deletion
--             in a closed thread, revoking a previous opponent's invitee; INV-q2 revocation removes stored excerpts
--   INV-x2/x3 a withhold scoped to another team does not apply; a withheld invitee is not notified
--   INV-mir   an invitation held only on the mirror fixture is revoked through the fixture
--   INV-mrg   a merge carries invitations with their conversation (INV-mrg2: historical ones with their messages)
--   INV-s     an invitation's conversation can never be re-pointed
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -v ON_ERROR_STOP=0 < supabase/tests/fixture_conversation_invitation_lifecycle.sql

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rh-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Rh',p_label,'rh-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RH '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','rh-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'rh-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  select p_club, 'RH '||p_key, 'rh-'||p_key||'-'||v_tag, c.category, c.age_group, c.gender, 'union', c.id, true
    from public.canonical_team_types_by_code c where c.rugby_code = 'union' and c.key = p_key returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club,p_user,p_role,'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text) returns void language plpgsql as $$
begin insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership,p_team,p_role_key); end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if; end $$;

-- Acting as a person with a LIVE session (an MFA-elevated one, so no authority is refused for its assurance level).
create or replace function pg_temp.act(p_subject uuid) returns void language plpgsql as $$
declare v_s uuid;
begin
  perform set_config('role','none',true);
  select id into v_s from auth.sessions where user_id = p_subject limit 1;
  if v_s is null then
    v_s := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_s, p_subject, now(), now(), 'aal2');
    insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at)
    values (gen_random_uuid(), v_s, 'totp', now(), now());
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',p_subject,'role','authenticated','aal','aal2','session_id',v_s)::text, true);
  perform set_config('role','authenticated', true);
end $$;
create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;
create or replace function pg_temp.as_int(p_subject uuid, p_sql text) returns int language plpgsql as $$
declare v int;
begin perform pg_temp.act(p_subject); execute p_sql into v; perform pg_temp.act_postgres(); return v; end $$;
create or replace function pg_temp.as_bool(p_subject uuid, p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin perform pg_temp.act(p_subject); execute p_sql into v; perform pg_temp.act_postgres(); return v; end $$;
-- An internal authority helper asked AS a person: their identity and live session, evaluated by the owner role
-- (the helpers are not all executable by a browser role; what matters is the answer they give for this person).
create or replace function pg_temp.claims_bool(p_subject uuid, p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.act(p_subject);
  perform set_config('role','none',true);
  execute p_sql into v;
  perform pg_temp.act_postgres();
  return v;
end $$;
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin perform pg_temp.act(p_subject); v := pg_temp.try(p_sql); perform pg_temp.act_postgres(); return v; end $$;

grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.act(uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.as_int(uuid, text) to public;
grant execute on function pg_temp.as_bool(uuid, text) to public;
grant execute on function pg_temp.try_as(uuid, text) to public;
grant execute on function pg_temp.claims_bool(uuid, text) to public;

do $$
declare
  v_a uuid; v_b uuid; v_c uuid; v_dir_b uuid; v_dir_c uuid;
  v_a13 uuid; v_b13 uuid; v_c13 uuid;
  v_ca_a uuid; v_coach_a13 uuid; v_coach_b13 uuid; v_coach_c13 uuid; v_ref uuid; v_m uuid;
  v_fx uuid; v_conv1 uuid; v_conv2 uuid; v_m1 uuid; v_m2 uuid; v_path text;
  v_state text; v_n int; v_reads int; v_cursor timestamptz; v_notes int;
  v_late uuid; v_binv uuid; v_denied uuid; v_m3 uuid; v_g1 uuid; v_g2 uuid; v_gc2 uuid; v_gmsg uuid; v_ginv uuid;
  v_a14 uuid; v_teamdeny uuid; v_wd uuid; v_f2 uuid; v_mir uuid; v_mmsg uuid; v_r2 uuid;
  v_y uuid; v_yconv uuid; v_ymsg uuid; v_g3 uuid; v_hinv uuid;
begin
  v_a := pg_temp.club('Ashby'); v_b := pg_temp.club('Burnley'); v_c := pg_temp.club('Clitheroe');
  select directory_id into v_dir_b from public.clubs where id = v_b;
  select directory_id into v_dir_c from public.clubs where id = v_c;
  v_a13 := pg_temp.team(v_a,'u13'); v_b13 := pg_temp.team(v_b,'u13'); v_c13 := pg_temp.team(v_c,'u13');
  v_ca_a := pg_temp.person('CA-A'); perform pg_temp.member(v_a, v_ca_a, 'CLUB_ADMIN');
  v_coach_a13 := pg_temp.person('COACH-A13'); v_m := pg_temp.member(v_a, v_coach_a13); perform pg_temp.team_role(v_m, v_a13, 'COACH');
  v_coach_b13 := pg_temp.person('COACH-B13'); v_m := pg_temp.member(v_b, v_coach_b13); perform pg_temp.team_role(v_m, v_b13, 'COACH');
  v_coach_c13 := pg_temp.person('COACH-C13'); v_m := pg_temp.member(v_c, v_coach_c13); perform pg_temp.team_role(v_m, v_c13, 'COACH');
  -- THE REFEREE: a member of the owning club with no messaging authority of their own. Everything they can read
  -- here comes from the invitation.
  v_ref := pg_temp.person('REFEREE'); perform pg_temp.member(v_a, v_ref);

  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_a13, v_b13, v_dir_b, current_date + 10, 'Home', 'INV Burnley U13') returning id into v_fx;
  select conversation_id into v_conv1 from public.fixtures where id = v_fx;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'Team sheet attached', 'text')
  returning id into v_m1;
  v_path := 'f/' || v_fx::text || '/' || v_m1::text || '/team-sheet.pdf';
  insert into public.fixture_message_attachments (message_id, size_bytes, uploaded_by, storage_path, original_filename, mime_type)
  values (v_m1, 2048, v_coach_a13, v_path, 'team-sheet.pdf', 'application/pdf');

  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 0,
    'INV-pre without an invitation the referee reads nothing');
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_ref, v_ca_a);
  perform pg_temp.check((select conversation_id from public.fixture_conversation_participants where fixture_id = v_fx and user_id = v_ref) = v_conv1,
    'INV-pre2 the invitation records the conversation it was given for');
  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 1,
    'INV-pre3 invited, the referee reads the thread');
  v_n := pg_temp.as_int(v_ref, format('select public.mark_thread_read(%L)', v_m1));
  select count(*) into v_reads from public.message_reads where user_id = v_ref and message_id = v_m1;
  select last_read_at into v_cursor from public.thread_read_cursors where user_id = v_ref and thread_key = v_conv1;
  perform pg_temp.check(v_reads = 1 and v_cursor is not null, 'INV-pre4 the referee has read it: a receipt and a read position');

  -- A previous-opponent invitee: a member of club B with no messaging authority, invited while B was the opponent.
  v_binv := pg_temp.person('B-INVITEE'); perform pg_temp.member(v_b, v_binv);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_binv, v_ca_a);
  -- A third invitee who will be explicitly withheld by safeguarding authority.
  v_denied := pg_temp.person('WITHHELD'); perform pg_temp.member(v_a, v_denied);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_denied, v_ca_a);

  -- THE OPPOSITION CHANGES, through the canonical edit.
  v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_opposition(%L, %L, %L, ''INV Clitheroe U13'')', v_fx, v_c13, v_dir_c));
  select conversation_id into v_conv2 from public.fixtures where id = v_fx;
  perform pg_temp.check(v_state = 'OK' and v_conv2 is distinct from v_conv1, format('INV-pre5 the opposition changes and the fixture moves to a new conversation (%s)', v_state));

  -- INV-a..c  the earlier conversation stays readable to the people invited into it.
  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 1,
    'INV-a the previously invited referee keeps read access to the earlier conversation');
  perform pg_temp.check(pg_temp.claims_bool(v_ref, format('select internal.can_access_message_attachment_path(%L, false)', v_path))
                        and pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_message_attachments where message_id = %L', v_m1)) = 1,
    'INV-b and to its attachment (row and file)');
  perform pg_temp.check((select count(*) from public.message_reads where user_id = v_ref and message_id = v_m1) = 1
                        and (select last_read_at from public.thread_read_cursors where user_id = v_ref and thread_key = v_conv1) = v_cursor
                        and (select conversation_id from public.fixture_messages where id = v_m1) = v_conv1,
    'INV-c history and read state are preserved: the message, its conversation, the receipt and the read position');

  -- INV-d..f  read-only.
  v_state := pg_temp.try_as(v_ref, format('select public.send_conversation_message(''fixture'', %L, ''Can I still post?'', gen_random_uuid(), null)', v_fx));
  perform pg_temp.check(v_state = '42501', format('INV-d the referee cannot post into the fixture''s thread (%s)', v_state));
  perform pg_temp.check(not pg_temp.claims_bool(v_ref, format('select internal.can_post_to_message(%L)', v_m1)),
    'INV-e nor react or reply to the closed conversation');
  v_state := pg_temp.try_as(v_ref, format('select public.set_message_reaction(%L, ''👍'')', v_m1));
  perform pg_temp.check(v_state <> 'OK', format('INV-f a reaction from the referee is refused (%s)', v_state));

  -- INV-g..i  not carried into the new conversation.
  select count(*) into v_notes from public.notifications where user_id = v_ref;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'New opponent, new kick-off', 'text')
  returning id into v_m2;
  perform pg_temp.check((select conversation_id from public.fixture_messages where id = v_m2) = v_conv2, 'INV-g0 the new message is in the new conversation');
  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id = %L', v_m2)) = 0
                        and not pg_temp.claims_bool(v_ref, format('select internal.can_read_message_target(''fixture'', %L)', v_fx)),
    'INV-g the referee cannot read the new conversation without a new authorisation');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_ref) = v_notes,
    'INV-h nor is notified of it');
  perform pg_temp.check((select count(*) from public.fixture_conversation_participants where user_id = v_ref and conversation_id = v_conv2) = 0,
    'INV-i the invitation was not transferred');

  -- INV-j..m  the new opponent reaches nothing of the earlier conversation.
  perform pg_temp.check(pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 0,
    'INV-j the new opponent cannot read the earlier conversation');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_access_message_attachment_path(%L, false)', v_path))
                        and pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_message_attachments where message_id = %L', v_m1)) = 0,
    'INV-k nor its attachment: the old file stays protected');
  perform pg_temp.check(not pg_temp.claims_bool(v_coach_c13, format('select internal.can_read_attached_message(%L)', v_m1))
                        and not pg_temp.claims_bool(v_coach_c13, format('select internal.can_post_to_message(%L)', v_m1)),
    'INV-l nor its receipts, reactions or replies');
  v_state := pg_temp.try_as(v_coach_c13, format('select public.send_conversation_message(''fixture'', %L, ''Re: team sheet'', gen_random_uuid(), %L)', v_fx, v_m1));
  perform pg_temp.check(v_state <> 'OK', format('INV-m nor quote it in a reply (%s)', v_state));

  -- INV-t  somebody invited only AFTER the change reaches the new conversation, never the earlier one.
  v_late := pg_temp.person('LATE-INVITEE'); perform pg_temp.member(v_a, v_late);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_late, v_ca_a);
  perform pg_temp.check(pg_temp.as_int(v_late, format('select count(*)::int from public.fixture_messages where id = %L', v_m2)) = 1
                        and pg_temp.as_int(v_late, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 0,
    'INV-t a person invited after the change reads the new conversation but not the earlier one');

  -- INV-u  invitation records are visible as their conversation is.
  perform pg_temp.check(pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_conversation_participants where fixture_id = %L and conversation_id = %L', v_fx, v_conv1)) = 0
                        and pg_temp.as_int(v_coach_c13, format('select count(*)::int from public.fixture_conversation_participants where fixture_id = %L and conversation_id = %L', v_fx, v_conv2)) = 1,
    'INV-u the new opponent sees the new conversation''s invitee, not the earlier conversation''s invitee list');
  perform pg_temp.check(pg_temp.as_int(v_coach_b13, format('select count(*)::int from public.fixture_conversation_participants where fixture_id = %L and conversation_id = %L', v_fx, v_conv1)) = 3,
    'INV-u2 the previous opponent still sees who was in the conversation it was part of');

  -- INV-v  realtime follows the conversation: an invitee of the current conversation may join its topic; an earlier
  --        conversation's invitee may not join the new one.
  perform pg_temp.check(pg_temp.claims_bool(v_late, format('select internal.can_access_conversation(%L)', v_conv2))
                        and not pg_temp.claims_bool(v_ref, format('select internal.can_access_conversation(%L)', v_conv2)),
    'INV-v live updates for the new conversation reach its invitee, not the earlier conversation''s');

  -- INV-w  a dead session gets nothing, not even the file through the storage check.
  perform set_config('request.jwt.claims', json_build_object('sub',v_ref,'role','authenticated','aal','aal2','session_id',gen_random_uuid())::text, true);
  v_state := case when internal.can_access_message_attachment_path(v_path, false) then 'READABLE' else 'REFUSED' end;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'REFUSED', format('INV-w with a revoked session the referee''s historical file check refuses (%s)', v_state));

  -- INV-x  an explicit safeguarding withhold overrides an invitation.
  perform pg_temp.check(pg_temp.as_int(v_denied, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 1,
    'INV-x0 precondition: the second invitee reads the earlier conversation');
  insert into public.capability_overrides (user_id, capability_key, scope_type, effect, reason, granted_by, granted_level, status)
  values (v_denied, 'messaging.fixture_conversation.participate', 'site', 'deny', 'Safeguarding hold', v_ca_a, 'SITE', 'active');
  perform pg_temp.check(pg_temp.as_int(v_denied, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 0
                        and not pg_temp.claims_bool(v_denied, format('select internal.can_access_message_attachment_path(%L, false)', v_path)),
    'INV-x an explicit withhold of fixture-conversation participation ends the invitation''s access');

  -- INV-y  read-only includes deletion: no author can tombstone a message in the earlier conversation.
  v_state := pg_temp.try_as(v_coach_a13, format('select public.soft_delete_own_message(%L)', v_m1));
  perform pg_temp.check(v_state = '42501' and (select deleted_at from public.fixture_messages where id = v_m1) is null,
    format('INV-y the author cannot delete a message in the closed conversation (%s)', v_state));

  -- INV-z  a previous opponent's invitee can still be revoked by the fixture's current sides.
  v_state := pg_temp.try_as(v_ca_a, format('select public.remove_fixture_conversation_participant(%L, null, %L)', v_fx, v_binv));
  perform pg_temp.check(v_state = 'OK' and pg_temp.as_int(v_binv, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 0,
    format('INV-z the previous opponent''s invitee can be revoked, and then reads nothing (%s)', v_state));

  -- INV-x2  a withhold on ANOTHER team of the same club does not reach this conversation (canonical scoping).
  v_a14 := pg_temp.team(v_a,'u14');
  v_teamdeny := pg_temp.person('OTHER-TEAM-WITHHELD'); perform pg_temp.member(v_a, v_teamdeny);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_teamdeny, v_ca_a);
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, reason, granted_by, granted_level, status)
  values (v_teamdeny, 'messaging.fixture_conversation.participate', 'team', v_a, v_a14, 'deny', 'Held for another team', v_ca_a, 'TEAM', 'active');
  perform pg_temp.check(pg_temp.as_int(v_teamdeny, format('select count(*)::int from public.fixture_messages where id = %L', v_m2)) = 1,
    'INV-x2 a withhold on another team of the same club does not end this invitation');

  -- INV-x3  a withheld invitee is not notified (and a non-withheld one is, as the control).
  v_wd := pg_temp.person('WITHHELD-CURRENT'); perform pg_temp.member(v_a, v_wd);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_wd, v_ca_a);
  insert into public.capability_overrides (user_id, capability_key, scope_type, effect, reason, granted_by, granted_level, status)
  values (v_wd, 'messaging.fixture_conversation.participate', 'site', 'deny', 'Safeguarding hold', v_ca_a, 'SITE', 'active');
  select count(*) into v_n from public.notifications where user_id = v_wd;
  select count(*) into v_notes from public.notifications where user_id = v_late;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'Withheld check', 'text');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_wd) = v_n
                        and (select count(*) from public.notifications where user_id = v_late) > v_notes,
    'INV-x3 a withheld invitee is not notified of new messages (the non-withheld invitee is)');

  -- INV-n..o  an explicit new invitation.
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_ref, v_ca_a);
  perform pg_temp.check((select count(*) from public.fixture_conversation_participants where fixture_id = v_fx and user_id = v_ref) = 2,
    'INV-n an explicit invitation to the new conversation is a separate invitation');
  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id in (%L, %L)', v_m1, v_m2)) = 2,
    'INV-o with it the referee reads the new conversation, and still the earlier one');

  -- Positive control for INV-h: an invitation to THIS conversation does bring its notifications.
  select count(*) into v_notes from public.notifications where user_id = v_ref;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_fx, v_coach_a13, 'Referee confirmed for 10:30', 'text');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_ref) > v_notes,
    'INV-o2 control: invited to the new conversation, the referee IS notified of its messages (so INV-h is not vacuous)');

  -- INV-p..r  an explicit revocation overrides history.
  v_state := pg_temp.try_as(v_ca_a, format('select public.remove_fixture_conversation_participant(%L, null, %L)', v_fx, v_ref));
  perform pg_temp.check(v_state = 'OK', format('INV-p the owning club revokes the referee (%s)', v_state));
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_ref and type = 'new_fixture_message' and (data ->> 'fixture_id') = v_fx::text) = 0,
    'INV-q2 revocation also removes the message excerpts the referee''s notifications held');
  perform pg_temp.check(pg_temp.as_int(v_ref, format('select count(*)::int from public.fixture_messages where id in (%L, %L)', v_m1, v_m2)) = 0
                        and not pg_temp.claims_bool(v_ref, format('select internal.can_access_message_attachment_path(%L, false)', v_path)),
    'INV-q revoked, the referee reads neither conversation nor the old file');
  perform pg_temp.check(pg_temp.as_int(v_coach_a13, format('select count(*)::int from public.fixture_messages where id in (%L, %L)', v_m1, v_m2)) = 2
                        and pg_temp.as_int(v_coach_b13, format('select count(*)::int from public.fixture_messages where id = %L', v_m1)) = 1
                        and (select count(*) from public.message_reads where user_id = v_ref and message_id = v_m1) = 1,
    'INV-r nothing was deleted: the owning side and the previous opponent keep their history, and the revoked referee''s past receipt stays on record');

  -- INV-mrg  if 757's merge ever runs again, an invitation follows its conversation into the merged one.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 30, 'Home', 'INV Merge Vale') returning id into v_g1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 20, 'Away', 'INV Merge Vale') returning id into v_g2;
  update public.fixtures set conversation_id = gen_random_uuid() where id = v_g2;
  select conversation_id into v_gc2 from public.fixtures where id = v_g2;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_g2, v_coach_a13, 'away leg', 'text') returning id into v_gmsg;
  v_ginv := pg_temp.person('MERGE-INVITEE'); perform pg_temp.member(v_a, v_ginv);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_g2, v_ginv, v_ca_a);
  perform internal.merge_fixture_conversations_by_opponent();
  perform pg_temp.check((select conversation_id from public.fixture_conversation_participants where fixture_id = v_g2 and user_id = v_ginv)
                          = (select conversation_id from public.fixtures where id = v_g1)
                        and pg_temp.as_int(v_ginv, format('select count(*)::int from public.fixture_messages where id = %L', v_gmsg)) = 1,
    'INV-mrg a merge carries the invitation with its conversation: the invitee still reads the merged thread');

  -- INV-mir  an invitation held only on the MIRROR fixture is still revoked through the fixture.
  insert into public.fixtures (owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, home_away, raw_opposition_text)
  values (v_a13, v_b13, v_dir_b, current_date + 40, 'Home', 'INV Burnley Return') returning id into v_f2;
  -- A fixture linked as its MIRROR (and so sharing its conversation). Today's model keeps an Ovalball-v-Ovalball match
  -- as one row and refuses a second same-day commitment, so the linked row sits a day later; what is proved here is
  -- only that revocation reaches an invitation held through the mirror link.
  insert into public.fixtures (owning_team_id, opponent_team_id, kickoff_date, home_away, raw_opposition_text, mirror_fixture_id)
  values (v_b13, v_a13, current_date + 41, 'Away', 'INV Ashby Return', v_f2) returning id into v_mir;
  perform pg_temp.check((select conversation_id from public.fixtures where id = v_mir) = (select conversation_id from public.fixtures where id = v_f2),
    'INV-mir0 precondition: the mirror shares the fixture''s conversation');
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_f2, v_coach_a13, 'Return fixture plan', 'text') returning id into v_mmsg;
  v_r2 := pg_temp.person('MIRROR-INVITEE'); perform pg_temp.member(v_b, v_r2);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_mir, v_r2, v_ca_a);
  perform pg_temp.check(pg_temp.as_int(v_r2, format('select count(*)::int from public.fixture_messages where id = %L', v_mmsg)) = 1,
    'INV-mir1 precondition: invited on the mirror, they read the shared conversation');
  v_state := pg_temp.try_as(v_ca_a, format('select public.update_fixture_opposition(%L, %L, %L, ''INV Clitheroe Return'')', v_f2, v_c13, v_dir_c));
  v_state := pg_temp.try_as(v_ca_a, format('select public.remove_fixture_conversation_participant(%L, null, %L)', v_f2, v_r2));
  perform pg_temp.check(v_state = 'OK'
                        and not exists (select 1 from public.fixture_conversation_participants where user_id = v_r2)
                        and pg_temp.as_int(v_r2, format('select count(*)::int from public.fixture_messages where id = %L', v_mmsg)) = 0,
    format('INV-mir revoking through the fixture also removes the invitation held on its mirror (%s)', v_state));

  -- INV-mrg2  a merge carries a HISTORICAL invitation with its conversation's messages.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 60, 'Home', 'INV Hist Vale') returning id into v_g3;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type, created_at) values (v_g3, v_coach_a13, 'earliest', 'text', now() - interval '60 days');
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 50, 'Home', 'INV Hist Vale') returning id into v_y;
  update public.fixtures set conversation_id = gen_random_uuid() where id = v_y;
  select conversation_id into v_yconv from public.fixtures where id = v_y;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text) values (v_a13, current_date - 40, 'Away', 'INV Hist Vale') returning id into v_g1;
  update public.fixtures set conversation_id = v_yconv where id = v_g1;
  insert into public.fixture_messages (fixture_id, sender_user_id, body, content_type) values (v_y, v_coach_a13, 'kept with the old pair', 'text') returning id into v_ymsg;
  v_hinv := pg_temp.person('HIST-INVITEE'); perform pg_temp.member(v_a, v_hinv);
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_y, v_hinv, v_ca_a);
  -- Y leaves the pair (its opposition changes); its message and invitation stay with the old conversation, still used by G1.
  update public.fixtures set raw_opposition_text = 'INV Someone Else' where id = v_y;
  perform internal.merge_fixture_conversations_by_opponent();
  perform pg_temp.check((select conversation_id from public.fixture_messages where id = v_ymsg) = (select conversation_id from public.fixtures where id = v_g3)
                        and (select conversation_id from public.fixture_conversation_participants where user_id = v_hinv) = (select conversation_id from public.fixtures where id = v_g3)
                        and pg_temp.as_int(v_hinv, format('select count(*)::int from public.fixture_messages where id = %L', v_ymsg)) = 1,
    'INV-mrg2 a merge carries a historical invitation with its messages: the invitee still reads them');

  -- INV-s  an invitation's conversation is fixed.
  insert into public.fixture_conversation_participants (fixture_id, user_id, added_by) values (v_fx, v_ref, v_ca_a);
  v_state := pg_temp.try(format('update public.fixture_conversation_participants set conversation_id = %L where fixture_id = %L and user_id = %L', v_conv1, v_fx, v_ref));
  perform pg_temp.check(v_state = '42501', format('INV-s an invitation cannot be re-pointed at another conversation, even by the owner role (%s)', v_state));
end $$;

rollback;
