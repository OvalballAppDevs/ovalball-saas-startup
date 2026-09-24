-- THE CLUB PROFILE IS A DOMAIN OPERATION (CA-M1) -- permanent regression.
--
-- Pins: update_club_profile / save_club_contact / delete_club_contact are the one way a client
-- changes the profile, and they carry the same authority the row policies carry (club.profile.edit
-- at the club through the canonical engine, or the site master), the same validation for every
-- client (trim, empty -> null, a web address given its scheme, a contact needs a name and a real
-- role, a contact must belong to the club named), and the same audit (the row triggers record the
-- change with the acting person). A stranger and another club's admin are refused 42501; a Site
-- Admin deny override on club.profile.edit refuses a holder mid-session and revoking it restores
-- them -- the stale-authority case a phone left open must meet. The required-reasons list the
-- clients share equals the set of public functions that ask the server for a reason. anon holds no
-- grant on any of it.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

create temp table t_reasons (rpc text) on commit drop;
insert into t_reasons values
  ('assign_role'), ('change_membership_access_profile'), ('decide_club_join_request'), ('grant_club_membership'),
  ('move_player_team_membership'), ('remove_team_access'), ('revoke_invitation'), ('set_primary_club_role'),
  ('set_team_access'), ('transition_club_membership'), ('transition_guardian_relationship'), ('transition_role_assignment');

do $$
declare
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_dir2 uuid; v_club uuid; v_club2 uuid;
  v_contact uuid; v_other_contact uuid; v_override uuid;
  v_n int; v_err text; v_state text;
  v_row record;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_site,        'cpdo-site@ovalball-test.invalid',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin,       'cpdo-admin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_other_admin, 'cpdo-other@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_stranger,    'cpdo-stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.site_admins (user_id, admin_role, status) values (v_site, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Domain Op Club', 'union', 'England', 'England', 'manual', 'verified', 'domain-op-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'domain-op-club', 'active') returning id into v_club;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Domain Op Other Club', 'union', 'England', 'England', 'manual', 'verified', 'domain-op-other-club') returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'domain-op-other-club', 'active') returning id into v_club2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_other_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_contacts (club_id, role, name, is_public) values (v_club2, 'general', 'Other Desk', true) returning id into v_other_contact;

  -- 1. the club's own admin updates the profile; validation is the server's
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.update_club_profile(v_club, '  Founded by the river.  ', ' www.domainop.example ', '', '  ');
  select bio, website, facebook_url, address_display, updated_by into v_row from public.clubs where id = v_club;
  if v_row.bio = 'Founded by the river.' and v_row.website = 'https://www.domainop.example' and v_row.facebook_url is null and v_row.address_display is null and v_row.updated_by = v_admin then
    raise notice 'PASS 1: the club admin updates the profile; trimmed, empty -> null, scheme supplied, updated_by set';
  else
    raise notice 'FAIL 1: profile stored as % / % / % / % by %', v_row.bio, v_row.website, v_row.facebook_url, v_row.address_display, v_row.updated_by;
  end if;

  -- 2. the change is in the one audit history, attributed to the actor
  select count(*) into v_n from public.audit_log a where a.table_name = 'clubs' and a.record_id = v_club and a.action = 'update' and a.actor_user_id = v_admin and a.after->>'bio' = 'Founded by the river.';
  if v_n >= 1 then raise notice 'PASS 2: the profile change is audited with the acting person';
  else raise notice 'FAIL 2: no audit row for the profile change'; end if;

  -- 3. contacts: create, edit, and the rules
  v_contact := public.save_club_contact(v_club, null, 'fixture_secretary', '  Jo Bloggs ', ' 07700 900000 ', ' JO@Example.org ', true);
  select role, name, phone, email, is_public, created_by into v_row from public.club_contacts where id = v_contact;
  if v_row.name = 'Jo Bloggs' and v_row.phone = '07700 900000' and v_row.email = 'jo@example.org' and v_row.is_public and v_row.created_by = v_admin then
    raise notice 'PASS 3: a contact is created through the operation, trimmed and lower-cased';
  else raise notice 'FAIL 3: contact stored as %', v_row; end if;
  perform public.save_club_contact(v_club, v_contact, 'general', 'Jo Bloggs', '', '', false);
  select role, phone, is_public into v_row from public.club_contacts where id = v_contact;
  if v_row.role = 'general' and v_row.phone is null and not v_row.is_public then raise notice 'PASS 3b: the contact is edited in place';
  else raise notice 'FAIL 3b: edit not applied: %', v_row; end if;
  begin
    perform public.save_club_contact(v_club, null, 'general', '   ', '', '', true);
    raise notice 'FAIL 3c: a nameless contact was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
    if v_state = '22023' and v_err = 'A name is required.' then raise notice 'PASS 3c: a nameless contact is refused (22023)';
    else raise notice 'FAIL 3c: refused with % %', v_state, v_err; end if;
  end;
  begin
    perform public.save_club_contact(v_club, null, 'chairman', 'Some One', '', '', true);
    raise notice 'FAIL 3d: an unknown role was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '22023' then raise notice 'PASS 3d: an unknown role is refused (22023)';
    else raise notice 'FAIL 3d: refused with %', v_state; end if;
  end;
  begin
    perform public.save_club_contact(v_club, null, 'general', 'Some One', '', 'not-an-email', true);
    raise notice 'FAIL 3e: a malformed email was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '22023' then raise notice 'PASS 3e: a malformed email is refused (22023)';
    else raise notice 'FAIL 3e: refused with %', v_state; end if;
  end;
  begin
    perform public.save_club_contact(v_club, v_other_contact, 'general', 'Hijack', '', '', true);
    raise notice 'FAIL 3f: another club''s contact was edited through this club';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = 'P0002' then raise notice 'PASS 3f: a contact of another club is not found through this club (P0002)';
    else raise notice 'FAIL 3f: refused with %', v_state; end if;
  end;
  select count(*) into v_n from public.audit_log a where a.table_name = 'club_contacts' and a.record_id = v_contact and a.actor_user_id = v_admin;
  if v_n >= 2 then raise notice 'PASS 3g: the contact''s create and edit are audited with the acting person';
  else raise notice 'FAIL 3g: % audit rows for the contact', v_n; end if;

  -- 4. a stranger and another club's admin are refused, exactly as the row policy refuses them
  foreach v_err in array array[v_stranger::text, v_other_admin::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_err::uuid, 'role', 'authenticated')::text, true);
    begin
      perform public.update_club_profile(v_club, 'Taken over', '', '', '');
      raise notice 'FAIL 4: % changed a club they do not administer', v_err;
    exception when others then
      get stacked diagnostics v_state = RETURNED_SQLSTATE;
      if v_state = '42501' then raise notice 'PASS 4: an outsider is refused (42501)';
      else raise notice 'FAIL 4: refused with %', v_state; end if;
    end;
    begin
      perform public.delete_club_contact(v_contact);
      raise notice 'FAIL 4b: % deleted a contact of a club they do not administer', v_err;
    exception when others then
      get stacked diagnostics v_state = RETURNED_SQLSTATE;
      if v_state = '42501' then raise notice 'PASS 4b: an outsider cannot delete the contact (42501)';
      else raise notice 'FAIL 4b: refused with %', v_state; end if;
    end;
  end loop;

  -- 5. STALE AUTHORITY: a Site Admin withholds club.profile.edit through the canonical permission
  --    system while the admin's "screen" is open; the next save is refused; revoking restores it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  v_override := public.set_capability_override(v_admin, 'club.profile.edit', 'club', v_club, null, 'deny', 'CA-M1 stale-authority regression', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_club_profile(v_club, 'After the deny', '', '', '');
    raise notice 'FAIL 5: a denied holder still changed the profile';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS 5: a deny override refuses the holder''s stale save (42501)';
    else raise notice 'FAIL 5: refused with %', v_state; end if;
  end;
  select count(*) into v_n from public.my_capabilities('club', v_club) m where m.capability_key = 'club.profile.edit' and m.allowed;
  if v_n = 0 then raise notice 'PASS 5b: the capability read the client redraws from says no';
  else raise notice 'FAIL 5b: my_capabilities still says yes under the deny'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.revoke_capability_override(v_override, 'CA-M1 stale-authority regression restored');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.update_club_profile(v_club, 'After the revoke', '', '', '');
  select bio into v_err from public.clubs where id = v_club;
  if v_err = 'After the revoke' then raise notice 'PASS 5c: revoking the override restores the holder';
  else raise notice 'FAIL 5c: bio is % after the revoke', v_err; end if;

  -- 6. the site master may act; delete works and is audited
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.delete_club_contact(v_contact);
  select count(*) into v_n from public.club_contacts where id = v_contact;
  if v_n = 0 then raise notice 'PASS 6: the site master deletes a contact through the operation';
  else raise notice 'FAIL 6: contact still present'; end if;
  select count(*) into v_n from public.audit_log a where a.table_name = 'club_contacts' and a.record_id = v_contact and a.action = 'delete' and a.actor_user_id = v_site;
  if v_n = 1 then raise notice 'PASS 6b: the delete is audited with the acting person';
  else raise notice 'FAIL 6b: % delete audit rows', v_n; end if;
  begin
    perform public.delete_club_contact(v_contact);
    raise notice 'FAIL 6c: deleting a missing contact did not fail';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = 'P0002' then raise notice 'PASS 6c: a missing contact is P0002';
    else raise notice 'FAIL 6c: %', v_state; end if;
  end;

  -- 7. an unknown club is not found (after authority, so it never reveals anything to an outsider)
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.update_club_profile(gen_random_uuid(), 'x', '', '', '');
    raise notice 'FAIL 7: an unknown club was updated';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS 7: an unknown club is refused before it is looked up (42501)';
    else raise notice 'FAIL 7: %', v_state; end if;
  end;

  -- 8. grants
  if has_function_privilege('anon', 'public.update_club_profile(uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_club_contact(uuid, uuid, text, text, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_club_contact(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'internal.require_club_profile_editor(uuid)', 'EXECUTE') then
    raise notice 'FAIL 8: a grant is wider than intended';
  else
    raise notice 'PASS 8: anon holds no grant; the internal helper is not callable by clients';
  end if;

  -- 9. the shared required-reasons list equals the server's own set
  select count(*) into v_n from (
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'internal\.require_reason\('
    except select rpc from t_reasons
  ) missing;
  select v_n + count(*) into v_n from (
    select rpc from t_reasons
    except select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'internal\.require_reason\('
  ) extra;
  if v_n = 0 then raise notice 'PASS 9: the shared required-reasons list is exactly the server''s set of reason-asking operations';
  else raise notice 'FAIL 9: the required-reasons list drifts from the server by % entries', v_n; end if;
end $$;

rollback;
