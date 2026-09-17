-- =====================================================================================================
-- SLICE 7b -- CREATE USER (Phase 2 Q.2), and the last of the Q.3 contract.
--
-- Q.2 splits the job in two on purpose. The service role creates the auth identity in
-- lib/admin/create-identity.ts and NOTHING else; everything that confers authority happens in this
-- RPC, under the ordinary capability rules, so the elevated client never decides anything. If the
-- service role could also make somebody a Club Admin, then a bug in the route handler would be an
-- authority bug rather than a failed insert.
--
-- The RPC re-checks site.users.create rather than trusting that the server already did. The server's
-- check is a courtesy that produces a good error message; this one is the boundary.
-- =====================================================================================================

create or replace function public.site_register_created_identity(
  p_user_id uuid,
  p_first_name text,
  p_surname text,
  -- p_dob and p_reason carry defaults so that a date of birth is genuinely optional at the call
  -- site. A null reason is not thereby allowed: internal.master_control_preamble refuses anything
  -- under ten characters, null included, before this function does anything at all.
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
  -- No refuse_self_target: creating an identity is not an act upon an existing person, and the
  -- caller cannot be the freshly created user.
  perform internal.master_control_preamble('site.users.create', p_reason, null);

  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null then
    raise exception 'That identity does not exist. It is created by the server before this is called.'
      using errcode = 'P0002';
  end if;
  -- ID-6: this RPC only ever finishes an identity the same request just created. An already-set-up
  -- account reaching here means the server matched an existing person, and filling their name from a
  -- Create User form would overwrite a real person's record.
  if v_profile.setup_state = 'COMPLETE' or v_profile.account_state = 'ACTIVE' then
    raise exception 'That account already exists and is set up. Open the existing user instead.'
      using errcode = '23505';
  end if;
  if coalesce(btrim(p_first_name),'') = '' or coalesce(btrim(p_surname),'') = '' then
    raise exception 'A person needs a first name and a surname.' using errcode = '22023';
  end if;

  -- normalise_person_name runs as a trigger on profiles, so the name is written plainly here and
  -- normalised by the one authority that owns it. Never in TypeScript, never twice.
  update public.profiles
     set first_name = btrim(p_first_name),
         surname = btrim(p_surname),
         date_of_birth = coalesce(p_dob, date_of_birth),
         account_state = 'PENDING_SETUP',
         setup_state = 'PENDING_DETAILS',
         created_source = 'SITE_ADMIN_CREATE'
   where id = p_user_id;

  perform internal.emit_security_event('user.created', p_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('created_source','SITE_ADMIN_CREATE',
                       'intended_assignments', jsonb_array_length(coalesce(p_intended,'[]'::jsonb))),
    null, null, null);

  -- ------------------------------------------------------------------------------------------------
  -- INTENDED ASSIGNMENTS
  --
  -- Each one goes through the SAME master-control RPC the Users & Access screen would call, so each
  -- re-checks its own site capability and writes its own security event. A Site Admin who may create
  -- users but not assign team roles creates the user and is refused the team role -- which is the
  -- point of separate capabilities, and would be lost if this function wrote the rows itself.
  --
  -- Deliberately NOT wrapped in a sub-transaction: if an assignment is refused, the whole creation
  -- fails and the server deletes the auth user it had just made. A half-assigned person is worse
  -- than no person, because nobody would know which half.
  -- ------------------------------------------------------------------------------------------------
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
        -- Q.2 step 2: Site Admin is explicitly NOT available here. It takes two administrators, and a
        -- checkbox on a create form is exactly the single-handed route Slice 7c closed.
        raise exception 'Site Admin access is not granted when creating a user. Raise a grant request and have a second Full Site Admin approve it.'
          using errcode = '42501';
      else
        raise exception 'Unknown assignment kind: %', coalesce(v_item->>'kind','(none)') using errcode = '22023';
    end case;
    v_applied := v_applied || jsonb_build_array(v_item ->> 'kind');
  end loop;

  -- ------------------------------------------------------------------------------------------------
  -- THE SETUP INVITATION. The plaintext never comes back to the caller (PG-10): issue_invitation
  -- returns the token to the server that sends the email, and this returns only the id, so a Site
  -- Admin reading their own network tab learns nothing they could use to become this person.
  -- ------------------------------------------------------------------------------------------------
  select * into v_inv from public.issue_invitation('ACCOUNT_SETUP', null, null, null, null, p_user_id,
    v_profile.email, '{}'::jsonb, 1, null, null);

  return jsonb_build_object(
    'user_id', p_user_id,
    'invitation_id', v_inv.invitation_id,
    'assignments_applied', v_applied);
end $$;

-- =====================================================================================================
-- site_resend_account_setup -- rotates the ACCOUNT_SETUP invitation (Q.3).
-- =====================================================================================================
create or replace function public.site_resend_account_setup(p_user_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv record; v_old uuid;
begin
  perform internal.master_control_preamble('site.invitations.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);

  if exists (select 1 from public.profiles where id = p_user_id and setup_state = 'COMPLETE') then
    raise exception 'That account is already set up.' using errcode = '23514';
  end if;

  -- Rotate, not reissue alongside: two live setup invitations for one person is two ways in, and the
  -- older one is the one nobody is watching.
  for v_old in select id from public.access_invitations
                where kind = 'ACCOUNT_SETUP' and target_user_id = p_user_id and state = 'ISSUED'
  loop
    perform public.revoke_invitation(v_old, 'superseded by a fresh setup link');
  end loop;

  select * into v_inv from public.issue_invitation('ACCOUNT_SETUP', null, null, null, null, p_user_id,
    (select email from public.profiles where id = p_user_id), '{}'::jsonb, 1, null, null);

  perform internal.emit_security_event('account.setup_resent', p_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('invitation_id', v_inv.invitation_id), null, null, null);
  return v_inv.invitation_id;
end $$;

-- =====================================================================================================
-- site_set_capability_override -- Q.3, granted_level = SITE.
--
-- Delegates to public.set_capability_override, which owns the override rules. The wrapper exists for
-- the preamble: an override is a per-person exception to the whole capability model, so it is exactly
-- the operation that should need a recent authenticator code and a reason somebody can read later.
-- =====================================================================================================
create or replace function public.site_set_capability_override(
  p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid,
  p_effect text, p_reason text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform internal.master_control_preamble('site.capabilities.override', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  v_id := public.set_capability_override(p_user_id, p_capability_key, p_scope_type, p_club_id, p_team_id,
                                         p_effect, btrim(p_reason), p_expires_at);
  return v_id;
end $$;

-- =====================================================================================================
-- INSPECTION (Q.3). Read-only provenance timelines, site.users.view.
--
-- These answer "how did this person come to have this?" -- the question Users & Access could not
-- answer before, because the canonical rows say what is true now and the security events say what
-- happened, and nothing joined them up.
-- =====================================================================================================
create or replace function public.site_membership_history(p_user_id uuid)
returns table (at timestamptz, club_id uuid, club_name text, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.club_id, cd.name, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
    left join public.clubs c on c.id = e.club_id
    left join public.club_directory cd on cd.id = c.directory_id
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.event_type like 'membership.%' or e.event_type like 'site.club_%' or e.event_type like 'club.%')
   order by e.occurred_at desc
   limit 500;
$$;

create or replace function public.site_team_history(p_user_id uuid)
returns table (at timestamptz, team_id uuid, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.team_id, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.event_type like 'role.%' or e.event_type like 'site.team_%' or e.event_type like 'site.player_team%')
   order by e.occurred_at desc
   limit 500;
$$;

create or replace function public.site_family_history(p_user_id uuid)
returns table (at timestamptz, player_id uuid, entry text, detail text, actor_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.occurred_at, e.player_id, e.event_type, e.reason, e.actor_user_id
    from public.security_events e
   where internal.has_site_capability('site.users.view')
     and e.subject_user_id = p_user_id
     and (e.event_type like 'guardian.%' or e.event_type like 'site.guardian%' or e.event_type like 'family.%')
   order by e.occurred_at desc
   limit 500;
$$;

-- =====================================================================================================
-- THE TWO RECOVERY RPCs Q.3 NAMES, which already exist under Slice 6's names.
--
-- Q.3 lists site_initiate_mfa_recovery / site_approve_mfa_recovery. Slice 6 shipped exactly those two
-- operations as public.request_privileged_recovery(p_target_user_id, p_kind, p_reason, p_proofing_note)
-- and public.approve_privileged_recovery(p_request_id, p_reason) -- same capability, same proofing
-- note, same second-administrator rule for a privileged target.
--
-- Adding a second pair under the Q.3 names would give the same operation two doors, which is the
-- mistake Slice 7c spent a whole migration undoing. The existing pair is strengthened instead: they
-- checked the capability and that a reason was non-empty, but not that the administrator had recently
-- passed a second factor, and not that the reason says anything. Every other master-control operation
-- asks for both.
-- =====================================================================================================
do $$
declare r record; v_def text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('request_privileged_recovery','approve_privileged_recovery')
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def ~ 'require_recent_aal2' then continue; end if;
    v_def := replace(v_def,
      $x$  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;$x$,
      $x$  perform internal.require_recent_aal2(interval '10 minutes');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a fuller reason -- at least ten characters, so the record makes sense later.'
      using errcode = '22023';
  end if;$x$);
    execute v_def;
  end loop;
end $$;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('account.setup_resent','SITE_ADMIN','WARNING',false,true,true)
on conflict (event_type) do nothing;

revoke all on function public.site_register_created_identity(uuid,text,text,date,text,jsonb) from public, anon;
revoke all on function public.site_resend_account_setup(uuid,text) from public, anon;
revoke all on function public.site_set_capability_override(uuid,text,text,uuid,uuid,text,text,timestamptz) from public, anon;
revoke all on function public.site_membership_history(uuid) from public, anon;
revoke all on function public.site_team_history(uuid) from public, anon;
revoke all on function public.site_family_history(uuid) from public, anon;
grant execute on function public.site_register_created_identity(uuid,text,text,date,text,jsonb) to authenticated;
grant execute on function public.site_resend_account_setup(uuid,text) to authenticated;
grant execute on function public.site_set_capability_override(uuid,text,text,uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.site_membership_history(uuid) to authenticated;
grant execute on function public.site_team_history(uuid) to authenticated;
grant execute on function public.site_family_history(uuid) to authenticated;

do $$
declare v_missing text;
begin
  select string_agg(x, ', ') into v_missing from (
    select unnest(array['site_register_created_identity','site_resend_account_setup',
                        'site_set_capability_override','site_membership_history',
                        'site_team_history','site_family_history']) as x
  ) w where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = w.x);
  if v_missing is not null then
    raise exception 'Slice 7b: missing %', v_missing;
  end if;
  if not exists (select 1 from pg_proc where proname = 'approve_privileged_recovery'
                   and prosrc ~ 'require_recent_aal2') then
    raise exception 'Slice 7b: approving a recovery still does not require a recent authenticator code';
  end if;
  raise notice 'Slice 7b: Create User, and the last of the Q.3 contract';
end $$;
