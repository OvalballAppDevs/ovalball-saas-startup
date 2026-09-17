-- =====================================================================================================
-- SLICE 7b -- CREATE USER COULD NEVER HAVE WORKED
--
-- Found in a browser. Two defects, and the second one is a repeat of a mistake this slice has already
-- made once.
--
-- 1. THE ID-6 GUARD FIRED ON EVERY CREATION.
--
-- site_register_created_identity refused when the profile was already set up, and tested that with
--
--     if v_profile.setup_state = 'COMPLETE' or v_profile.account_state = 'ACTIVE' then ...
--
-- internal.create_profile_for_identity -- the ID-1 trigger on auth.users -- creates EVERY new profile
-- as ('ACTIVE', 'PENDING_DETAILS'). account_state is ACTIVE from the first instant and says nothing
-- whatever about whether anybody has set the account up; setup_state is the column that does. So the
-- guard fired on the identity the server had created one statement earlier, every single time, and
-- Create User refused with "That account already exists and is set up."
--
-- WHY THE SQL SUITE MISSED IT, which is the part worth remembering: SMC-37 set the profile to
-- PENDING_SETUP before calling the RPC. It seeded the state the function expects instead of the state
-- the product actually produces, so it proved the function works on input nothing generates. The
-- browser used the real path and the bug was the first thing it hit. The suite now creates its
-- identity the way the trigger does and does not touch account_state.
--
-- 2. user.created WAS EMITTED TWICE, AND ONE OF THEM WAS WRONG.
--
-- The same ID-1 trigger already emits user.created, with created_source derived from the auth
-- metadata -- which for an administrator-created identity reads SELF_SIGNUP, because there is no
-- invitation and no social provider. The RPC then emitted a second user.created saying
-- SITE_ADMIN_CREATE.
--
-- Two events of one type for one act, disagreeing about how the account came to exist. This is the
-- third time in this slice: account.suspended was double-emitted, and 'account.reinstated' was
-- invented for a transition already called 'account.restored'. The rule each time is the same -- one
-- writer per event type.
--
-- The trigger keeps user.created, because an identity coming into existence is its fact to record.
-- The RPC now emits site.user_created, which is a different fact: a named administrator made this
-- account for somebody, and here is the reason they gave. The trigger cannot record that, because at
-- the moment it fires the reason has not been supplied yet.
-- =====================================================================================================

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('site.user_created','SITE_ADMIN','CRITICAL',false,true,true)
on conflict (event_type) do nothing;

create or replace function public.site_register_created_identity(
  p_user_id uuid,
  p_first_name text,
  p_surname text,
  p_dob date default null,
  p_reason text default null,
  p_intended jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_inv record;
  v_profile public.profiles;
begin
  perform internal.master_control_preamble('site.users.create', p_reason, null);

  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null then
    raise exception 'That identity does not exist. It is created by the server before this is called.'
      using errcode = 'P0002';
  end if;
  -- ID-6. setup_state is the only column that says whether anybody has set this account up.
  -- account_state is ACTIVE on every new profile and means nothing here.
  if v_profile.setup_state = 'COMPLETE' then
    raise exception 'That account already exists and is set up. Open the existing user instead.'
      using errcode = '23505';
  end if;
  if coalesce(btrim(p_first_name),'') = '' or coalesce(btrim(p_surname),'') = '' then
    raise exception 'A person needs a first name and a surname.' using errcode = '22023';
  end if;

  update public.profiles
     set first_name = btrim(p_first_name),
         surname = btrim(p_surname),
         date_of_birth = coalesce(p_dob, date_of_birth),
         account_state = 'PENDING_SETUP',
         setup_state = 'PENDING_DETAILS',
         created_source = 'SITE_ADMIN_CREATE'
   where id = p_user_id;

  -- site.user_created, not user.created: the ID-1 trigger already wrote that one when the identity
  -- appeared, and it had no reason to record because the reason had not been given yet.
  perform internal.emit_security_event('site.user_created', p_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('created_source','SITE_ADMIN_CREATE',
                       'intended_assignments', jsonb_array_length(coalesce(p_intended,'[]'::jsonb))),
    null, null, null);

  for v_item in select * from jsonb_array_elements(coalesce(p_intended, '[]'::jsonb))
  loop
    case v_item ->> 'kind'
      when 'CLUB_MEMBERSHIP' then
        perform public.site_add_club_membership(p_user_id, (v_item->>'club_id')::uuid, btrim(p_reason));
      when 'CLUB_ROLE' then
        perform public.site_assign_club_role(p_user_id, (v_item->>'club_id')::uuid, v_item->>'role_key',
                                             btrim(p_reason), coalesce(v_item->'attributes','{}'::jsonb));
      when 'TEAM_ROLE' then
        perform public.site_assign_team_role(p_user_id, (v_item->>'team_id')::uuid, v_item->>'role_key',
                                             btrim(p_reason));
      when 'GUARDIAN_LINK' then
        perform public.site_link_guardian(p_user_id, (v_item->>'player_id')::uuid,
                                          coalesce(v_item->>'relationship_type','parent'), btrim(p_reason),
                                          'SITE_VERIFIED');
      when 'SITE_ADMIN' then
        raise exception 'Site Admin access is not granted when creating a user. Raise a grant request and have a second Full Site Admin approve it.'
          using errcode = '42501';
      else
        raise exception 'Unknown assignment kind: %', coalesce(v_item->>'kind','(none)') using errcode = '22023';
    end case;
    v_applied := v_applied || jsonb_build_array(v_item ->> 'kind');
  end loop;

  select * into v_inv from public.issue_invitation('ACCOUNT_SETUP', null, null, null, null, p_user_id,
    v_profile.email, '{}'::jsonb, 1, null, null);

  return jsonb_build_object(
    'user_id', p_user_id,
    'invitation_id', v_inv.invitation_id,
    'assignments_applied', v_applied);
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='site_register_created_identity') ~ 'account_state = ''ACTIVE''' then
    raise exception 'Slice 7b: the ID-6 guard still reads account_state, which is ACTIVE on every new profile';
  end if;
  raise notice 'Slice 7b: Create User can create a user';
end $$;
