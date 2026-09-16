-- =====================================================================================================
-- SLICE 4G (1/3) — THE SAFEGUARDING APPOINTMENT AUTHORITY AND STATE MACHINE
--
-- Phase 2 AA.3 row 4g, design J.12 and section T "Appointment"/"Lifecycle", decision AN-6, under the
-- programme's locked decision D-S4-2.
--
-- WHAT IS WRONG TODAY, stated plainly because the rest of this file follows from it:
--
--   internal.grant_role writes confirmation_state = 'CONFIRMED' the instant a SAFEGUARDING_OFFICER
--   assignment is created. public.accept_safeguarding_officer_invitation calls it, with the comment
--   "The club's nomination and the officer's own email-bound acceptance are the confirmation." So a
--   Club Admin can today appoint a Safeguarding Officer end to end, with no Ovalball involvement at
--   any point. AN-6 says the opposite: Site Admin confirmation is what makes the role real.
--
-- The state machine this installs, which is the ONE state machine (D-S4-2):
--
--   nomination  ->  state ACTIVE, confirmation_state PENDING_CONFIRMATION   -- ZERO authority
--   AN-6        ->  confirmation_state CONFIRMED                            -- the role becomes real
--   deactivate  ->  state REVOKED                                           -- authority ends
--
-- PENDING_CONFIRMATION conferring nothing is not something this slice has to build: Slice 3's
-- internal.bundle_source already carries
--   (ra.role_key <> 'SAFEGUARDING_OFFICER' or ra.confirmation_state = 'CONFIRMED')
-- at club, team and self scope. What was missing was anything that ever put an assignment INTO
-- PENDING_CONFIRMATION. This file supplies it, and the matrix asserts the consequence rather than
-- assuming the resolver still behaves.
--
-- D-S4-2, honoured exactly: no invitation table is created, no token, no code, no redemption RPC.
-- The pre-existing club_safeguarding_officer_invitations machinery is left alone and is NOT extended;
-- unified invitation redemption is Slice 5's. 4G's own nomination targets an existing ACTIVE club
-- member and returns INVITATION_REQUIRED for anybody else.
-- =====================================================================================================

-- 0. The security events this slice emits ------------------------------------------------------------
-- Registered before anything can emit one. internal.emit_security_event validates against this
-- catalogue and refuses an unknown type, which is how the three-segment names this file first used
-- were caught: security_event_types_event_type_check allows exactly one dot.
--
-- None of the appointment events is club_visible. A club seeing "Ovalball declined to confirm your
-- nominee" in its own security log would be Ovalball explaining a safeguarding judgement to the club
-- it concerns; the notification says what the club needs to know, and the event is the record.
--
-- There is deliberately no event for a REFUSED confirmation. Postgres has no autonomous transaction,
-- so an event written just before a raise dies with the statement that raised it; registering a type
-- for it would advertise an audit trail that does not exist.
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason) values
  ('safeguarding.officer_nominated',       'MEMBERSHIP',       'WARNING',  false, false, false),
  ('safeguarding.officer_confirmed',       'MEMBERSHIP',       'CRITICAL', false, false, true),
  ('safeguarding.threads_unattended',      'SENSITIVE_ACCESS', 'CRITICAL', false, false, false)
on conflict (event_type) do update set category = excluded.category, severity = excluded.severity,
  club_visible = excluded.club_visible, subject_visible = excluded.subject_visible, requires_reason = excluded.requires_reason;

-- 1. Who is actually a Safeguarding Officer ----------------------------------------------------------
-- The canonical answer, and the retirement AA.3 row 4g calls "per-officer override dependence":
-- officer identity has been read off club_safeguarding_officers.user_id / status = 'active', a table
-- that a Club Admin writes. It now comes from an ACTIVE, CONFIRMED role assignment sitting on an
-- ACTIVE membership -- the same three facts every other role in Ovalball rests on.
create or replace function internal.active_safeguarding_officer_ids(p_club_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ra.user_id), '{}')
  from public.role_assignments ra
  join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
  where ra.club_id = p_club_id
    and ra.role_key = 'SAFEGUARDING_OFFICER'
    and ra.state = 'ACTIVE'
    and ra.confirmation_state = 'CONFIRMED';
$$;

comment on function internal.active_safeguarding_officer_ids(uuid) is
  'Slice 4G: the club''s Safeguarding Officers, from ACTIVE CONFIRMED role assignments on ACTIVE '
  'memberships. Returns an array so a policy can hoist it into an uncorrelated subquery rather than '
  'calling a SECURITY DEFINER function once per row.';

create or replace function internal.is_active_safeguarding_officer(p_user_id uuid, p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_club_id is not null
     and p_user_id = any (internal.active_safeguarding_officer_ids(p_club_id));
$$;

comment on function internal.is_active_safeguarding_officer(uuid, uuid) is
  'Slice 4G: is THIS PERSON a confirmed, active Safeguarding Officer of this club? Subject-taking, so '
  'it answers about somebody else -- which is what a notification resolver and a thread gate both need.';

-- 2. THE SEAM ----------------------------------------------------------------------------------------
-- One canonical transition into the state machine, and the only one. 4G's nomination calls it. Slice 5's
-- email-bound SAFEGUARDING_OFFICER redemption will call this same function after it has admitted the
-- person to the club, which is why every rule that must survive redemption lives HERE and not in the
-- RPC above it:
--
--   * the membership must exist and be ACTIVE -- PENDING, SUSPENDED, REVOKED, DECLINED and EXPIRED
--     are all refused, and so is a membership at a DIFFERENT club;
--   * the account must be active and not a minor (SAFEGUARDING_OFFICER is minor_prohibited);
--   * the assignment enters PENDING_CONFIRMATION, never ACTIVE authority;
--   * it is idempotent for a pending nomination and refuses to shadow a confirmed one.
--
-- Slice 5 therefore needs no second state machine, and cannot accidentally build one that skips a rule:
-- there is nowhere else to enter.
create or replace function internal.enter_safeguarding_nomination(
  p_club_id uuid,
  p_user_id uuid,
  p_officer_type text,
  p_source text default 'SAFEGUARDING_APPOINTMENT',
  p_source_invitation_id uuid default null,
  p_reason text default null,
  p_safeguarding_officer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_existing public.role_assignments;
  v_id uuid;
begin
  if p_club_id is null or p_user_id is null then
    raise exception 'A club and a person are both required to nominate a Safeguarding Officer.' using errcode = '22023';
  end if;
  if coalesce(p_officer_type, '') not in ('primary', 'deputy') then
    raise exception 'A Safeguarding Officer is either the primary officer or a deputy.' using errcode = '22023';
  end if;

  perform internal.lock_club_people(p_club_id);

  -- THE MEMBERSHIP PROOF. Read from the database, for THIS club, and not taken on trust from the
  -- caller: a nomination that named a club the person does not belong to would otherwise mint
  -- safeguarding authority out of an argument.
  select * into v_membership
  from public.club_memberships
  where club_id = p_club_id and user_id = p_user_id;

  if v_membership.id is null then
    raise exception 'INVITATION_REQUIRED: that person is not a member of this club.' using errcode = 'P0002';
  end if;
  if v_membership.state <> 'ACTIVE' then
    raise exception 'That person''s membership of this club is % rather than active, so they cannot be nominated.', v_membership.state
      using errcode = '23514';
  end if;

  -- An already-confirmed officer is not re-nominated, and a pending nomination is not duplicated.
  select * into v_existing
  from public.role_assignments
  where club_id = p_club_id and user_id = p_user_id and role_key = 'SAFEGUARDING_OFFICER'
    and state in ('ACTIVE', 'SUSPENDED')
  for update;
  if v_existing.id is not null then
    if v_existing.confirmation_state = 'CONFIRMED' and v_existing.state = 'ACTIVE' then
      raise exception 'That person is already a confirmed Safeguarding Officer of this club.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  -- internal.grant_role carries the account-active check, the minor prohibition, the scope rules and
  -- the security event. Reimplementing any of that here would be a second state machine by another
  -- name, so the seam delegates to it and grant_role enters SAFEGUARDING_OFFICER pending (section 3).
  v_id := internal.grant_role(
    v_membership.id, 'SAFEGUARDING_OFFICER', null, p_source, p_reason,
    jsonb_strip_nulls(jsonb_build_object(
      'officer_type', p_officer_type,
      'safeguarding_officer_id', p_safeguarding_officer_id,
      'nomination_source', p_source))
  );

  if p_source_invitation_id is not null then
    update public.role_assignments set source_invitation_id = p_source_invitation_id where id = v_id;
  end if;

  perform internal.emit_security_event('safeguarding.officer_nominated', p_user_id, 'SUCCESS', p_reason,
    jsonb_build_object('assignment_id', v_id, 'officer_type', p_officer_type, 'source', p_source),
    p_club_id, null, null);

  return v_id;
end;
$$;

comment on function internal.enter_safeguarding_nomination(uuid, uuid, text, text, uuid, text, uuid) is
  'Slice 4G: THE canonical entry into the Safeguarding Officer state machine, and the seam Slice 5''s '
  'email-bound redemption will call once it has admitted the person. Proves ACTIVE membership of THIS '
  'club from the database, refuses every other membership state, and lands the assignment in '
  'PENDING_CONFIRMATION, which confers no authority until AN-6 confirmation.';

-- 3. Nomination no longer confirms itself ------------------------------------------------------------
-- The single line that made AN-6 unreachable. Everything else in grant_role is untouched.
create or replace function internal.grant_role(p_membership_id uuid, p_role_key text, p_team_id uuid, p_source text, p_reason text, p_attributes jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_role public.role_definitions;
  v_team public.teams;
  v_existing public.role_assignments;
  v_base uuid;
  v_id uuid;
  v_member record;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if v_membership.state <> 'ACTIVE' then
    raise exception 'Roles can only be given to an active member of the club.' using errcode = '23514';
  end if;
  select * into v_role from public.role_definitions where role_key = p_role_key;
  if v_role.role_key is null then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if p_role_key = 'SAFEGUARDING_OFFICER' and p_source <> 'SAFEGUARDING_APPOINTMENT' then
    raise exception 'A Safeguarding Officer is appointed through nomination and acceptance, not assigned.' using errcode = '42501';
  end if;
  if not internal.is_account_active(v_membership.user_id) then
    raise exception 'That account is not active.' using errcode = '23514';
  end if;
  if v_role.minor_prohibited and internal.person_is_minor(v_membership.user_id) then
    raise exception 'The % role cannot be held by someone under 18.', v_role.label using errcode = '23514';
  end if;
  if v_role.scope = 'CLUB' and p_team_id is not null then
    raise exception 'The % role is held club-wide, not for a team.', v_role.label using errcode = '22023';
  elsif v_role.scope = 'TEAM' and p_team_id is null then
    raise exception 'The % role is held for a team.', v_role.label using errcode = '22023';
  end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id;
    if v_team.id is null or v_team.club_id <> v_membership.club_id then
      raise exception 'That team is not part of this club.' using errcode = '42501';
    end if;
    if not v_team.active then
      raise exception 'That team is archived.' using errcode = '23514';
    end if;
  end if;

  select * into v_existing from public.role_assignments
  where membership_id = p_membership_id and role_key = p_role_key and team_id is not distinct from p_team_id
    and state in ('ACTIVE', 'SUSPENDED')
  for update;
  if v_existing.state = 'ACTIVE' then
    return v_existing.id;
  elsif v_existing.state = 'SUSPENDED' then
    raise exception 'This role is suspended. Restore it rather than assigning it again.' using errcode = '23514';
  end if;

  if v_role.requires_base_role is not null then
    select id into v_base from public.role_assignments
    where membership_id = p_membership_id and team_id = p_team_id and role_key = any (v_role.requires_base_role) and state = 'ACTIVE'
    order by case role_key when 'TEAM_MANAGER' then 1 else 2 end
    limit 1;
    if v_base is null then
      raise exception 'Team Admin rests on a Coach or Team Manager role for the same team. Give one of those first.' using errcode = '23514';
    end if;
  end if;

  insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, base_assignment_id, state, source, granted_by, reason, attributes,
                                       confirmation_state, confirmed_at)
  values (v_membership.user_id, v_membership.club_id, p_team_id, p_membership_id, p_role_key, v_base, 'ACTIVE', p_source, auth.uid(), p_reason,
          coalesce(p_attributes, '{}'::jsonb),
          -- AN-6. A nomination is a request, not an appointment: it enters PENDING_CONFIRMATION and
          -- internal.bundle_source refuses it at every scope until a Site Admin holding
          -- safeguarding.officer.confirm says otherwise. Writing 'CONFIRMED' here, as this function
          -- did until Slice 4G, meant a club could appoint its own Safeguarding Officer end to end.
          case when p_role_key = 'SAFEGUARDING_OFFICER' then 'PENDING_CONFIRMATION' end,
          null)
  returning id into v_id;

  perform internal.emit_security_event('role.granted', v_membership.user_id, 'SUCCESS', p_reason,
    jsonb_build_object('membership_id', p_membership_id, 'assignment_id', v_id, 'role_key', p_role_key, 'source', p_source),
    v_membership.club_id, p_team_id, null);

  -- Club Admin and Fixtures Secretary replace the plain Member role.
  if p_role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') then
    for v_member in
      select id from public.role_assignments
      where membership_id = p_membership_id and team_id is null and role_key = 'MEMBER' and state <> 'REVOKED'
    loop
      perform internal.end_role(v_member.id, 'REVOKED', coalesce(p_reason, 'Replaced by ' || v_role.label), null);
    end loop;
  end if;

  return v_id;
end;
$$;

-- 4. AN-6: the confirmation ---------------------------------------------------------------------------
-- J.12 line 543: safeguarding.officer.confirm, SI scope, bundles FULL and SUPPORT, grant level S,
-- AAL R (a reason is required), safeguarding-sensitive. It is asked through
-- internal.has_site_capability, which resolves it the canonical way. No raw site-admin role check
-- appears anywhere in the body -- deliberately, and the assertion at the foot of this file greps for
-- one -- and a Club Admin has no route in at all, however they came to nominate the person.
create or replace function public.confirm_safeguarding_officer(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.role_assignments;
  v_recipient uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Confirming a Safeguarding Officer needs a reason, and it is recorded.' using errcode = '22023';
  end if;

  -- THE CAPABILITY, AND NOTHING ELSE. Not a role string, not "the Club Admin who nominated them",
  -- not the club at all. AN-6 exists so that an appointment has a second pair of eyes from outside
  -- the club, and a check that a Club Admin could satisfy would not be a second pair of eyes.
  if not internal.has_site_capability('safeguarding.officer.confirm') then
    raise exception 'You are not authorised to confirm a Safeguarding Officer.' using errcode = '42501';
  end if;

  select club_id into v_recipient from public.role_assignments where id = p_assignment_id;
  if v_recipient is null then
    raise exception 'Nomination not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_recipient);

  select * into v_assignment from public.role_assignments where id = p_assignment_id for update;
  if v_assignment.role_key <> 'SAFEGUARDING_OFFICER' then
    raise exception 'That is not a Safeguarding Officer nomination.' using errcode = '22023';
  end if;

  -- NO SELF-CONFIRMATION, whatever capability the person holds. A Site Admin nominated as a club's
  -- Safeguarding Officer is still somebody being appointed, and cannot be the outside check on it.
  if v_assignment.user_id = auth.uid() then
    -- No security event here, deliberately. An event emitted immediately before a raise is rolled
    -- back with the statement that raised, so a line recording this refusal would record nothing
    -- while reading as though refusals were audited. The matrix asserts the refusal leaves no state
    -- change instead, which is the claim that can actually be made.
    raise exception 'You cannot confirm your own appointment as a Safeguarding Officer.' using errcode = '42501';
  end if;

  if v_assignment.state <> 'ACTIVE' then
    raise exception 'That nomination is % and cannot be confirmed.', v_assignment.state using errcode = '23514';
  end if;
  if v_assignment.confirmation_state = 'CONFIRMED' then
    raise exception 'That Safeguarding Officer is already confirmed.' using errcode = '23505';
  end if;

  -- The membership is re-read under the lock rather than trusted from nomination time: a person
  -- suspended or removed between nomination and confirmation must not be confirmed into the role.
  if not exists (select 1 from public.club_memberships
                 where id = v_assignment.membership_id and state = 'ACTIVE') then
    raise exception 'That person is no longer an active member of the club.' using errcode = '23514';
  end if;

  update public.role_assignments
  set confirmation_state = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  where id = p_assignment_id;

  perform internal.emit_security_event('safeguarding.officer_confirmed', v_assignment.user_id, 'SUCCESS', trim(p_reason),
    jsonb_build_object('assignment_id', p_assignment_id,
                       'officer_type', v_assignment.attributes->>'officer_type',
                       'also_club_admin', exists (select 1 from public.role_assignments ca
                                                  where ca.club_id = v_assignment.club_id and ca.user_id = v_assignment.user_id
                                                    and ca.role_key = 'CLUB_ADMIN' and ca.state = 'ACTIVE')),
    v_assignment.club_id, null, null);

  -- Section T: existing SOs and all CAs are told. The "also Club Admin" flag AN-6 asks for is carried
  -- on the event above and surfaced in the notification body, because a club whose safeguarding
  -- officer is also its administrator should be visibly so rather than quietly so.
  for v_recipient in
    select distinct ra.user_id from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    where ra.club_id = v_assignment.club_id and ra.state = 'ACTIVE'
      and (ra.role_key = 'CLUB_ADMIN'
           or (ra.role_key = 'SAFEGUARDING_OFFICER' and ra.confirmation_state = 'CONFIRMED'))
      and ra.user_id <> v_assignment.user_id
  loop
    insert into public.notifications (user_id, type, title, body, data)
    values (v_recipient, 'safeguarding_officer_confirmed', 'Safeguarding Officer confirmed',
            'Ovalball has confirmed a Safeguarding Officer for your club.',
            jsonb_build_object('assignment_id', p_assignment_id, 'club_id', v_assignment.club_id));
  end loop;

  insert into public.notifications (user_id, type, title, body, data)
  values (v_assignment.user_id, 'safeguarding_officer_confirmed', 'Your Safeguarding Officer role is confirmed',
          'Ovalball has confirmed your appointment as a Safeguarding Officer.',
          jsonb_build_object('assignment_id', p_assignment_id, 'club_id', v_assignment.club_id));
end;
$$;

comment on function public.confirm_safeguarding_officer(uuid, text) is
  'AN-6 (Slice 4G): a Site Admin holding safeguarding.officer.confirm turns a PENDING_CONFIRMATION '
  'nomination into a real Safeguarding Officer. Reason required and recorded, no self-confirmation, '
  'membership re-checked under the lock, and no is_site_admin shortcut anywhere.';

revoke execute on function public.confirm_safeguarding_officer(uuid, text) from public, anon;
grant execute on function public.confirm_safeguarding_officer(uuid, text) to authenticated, service_role;
revoke execute on function internal.enter_safeguarding_nomination(uuid, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function internal.enter_safeguarding_nomination(uuid, uuid, text, text, uuid, text, uuid) to service_role;
revoke execute on function internal.active_safeguarding_officer_ids(uuid) from public, anon;
grant execute on function internal.active_safeguarding_officer_ids(uuid) to authenticated, service_role;
revoke execute on function internal.is_active_safeguarding_officer(uuid, uuid) from public, anon, authenticated;
grant execute on function internal.is_active_safeguarding_officer(uuid, uuid) to service_role;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'grant_role') ~ 'then ''CONFIRMED'' end' then
    raise exception 'grant_role still confirms a Safeguarding Officer on creation; AN-6 is unreachable.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'confirm_safeguarding_officer') ~ '\mis_site_admin\(' then
    raise exception 'AN-6 confirmation is asking is_site_admin; the canonical site capability is the contract.';
  end if;
end $$;

-- 5. Nomination, 4G's own ----------------------------------------------------------------------------
-- D-S4-2: for 4G a nomination names an EXISTING ACTIVE member of THIS club, and anybody else is told
-- the truth -- that an invitation is what they need, and that Ovalball does not have one to give them
-- yet. The outcome is returned rather than raised, because "this person needs inviting" is an answer
-- to the question, not a failure of it; the invalid membership STATES are raised, because nominating
-- a suspended or removed member is a mistake and should read like one. Neither path creates anything.
create or replace function public.nominate_club_safeguarding_officer(
  p_club_id uuid,
  p_user_id uuid,
  p_officer_type text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_id uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can('safeguarding.officer.nominate', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to nominate a Safeguarding Officer for this club.' using errcode = '42501';
  end if;

  -- The membership is read for THIS club. A person who is a perfectly good active member somewhere
  -- else is, here, someone who needs an invitation -- which is the wrong-club case, and it answers
  -- the same way as a complete stranger because from this club's point of view it is the same thing.
  select state into v_state from public.club_memberships where club_id = p_club_id and user_id = p_user_id;

  if v_state is null then
    return jsonb_build_object(
      'outcome', 'INVITATION_REQUIRED',
      'club_id', p_club_id,
      'reason', 'That person is not a member of this club. An email invitation is needed, and Ovalball does not issue one yet.',
      'deferred_to', 'SLICE_5_SAFEGUARDING_OFFICER_INVITATION');
  end if;
  if v_state <> 'ACTIVE' then
    raise exception 'That person''s membership of this club is % rather than active, so they cannot be nominated.', v_state
      using errcode = '23514';
  end if;

  v_id := internal.enter_safeguarding_nomination(p_club_id, p_user_id, p_officer_type, 'SAFEGUARDING_APPOINTMENT', null, p_reason, null);

  return jsonb_build_object(
    'outcome', 'PENDING_CONFIRMATION',
    'assignment_id', v_id,
    'club_id', p_club_id,
    'reason', 'Nominated. Ovalball must confirm the appointment before it grants anything.');
end;
$$;

comment on function public.nominate_club_safeguarding_officer(uuid, uuid, text, text) is
  'Slice 4G (D-S4-2): nominate an EXISTING ACTIVE member of this club as Safeguarding Officer. Lands '
  'in PENDING_CONFIRMATION, which grants nothing until AN-6. A non-member -- including a member of a '
  'different club -- gets the INVITATION_REQUIRED outcome, and Slice 5 supplies that path.';

revoke execute on function public.nominate_club_safeguarding_officer(uuid, uuid, text, text) from public, anon;
grant execute on function public.nominate_club_safeguarding_officer(uuid, uuid, text, text) to authenticated, service_role;

-- 6. The pre-existing contact and invitation path, canonicalised but NOT extended ---------------------
-- club_safeguarding_officer_invitations, its token, and the invite/resend/revoke/preview RPCs all
-- predate Slice 4 and belong to Slice 5's unified redemption. D-S4-2 forbids building a temporary one;
-- it does not ask for a working feature to be torn out. So they are left exactly as they are, with two
-- changes and no more: the gate becomes the canonical key, and acceptance enters THE state machine
-- instead of granting the role outright.
create or replace function public.nominate_safeguarding_officer(p_club_id uuid, p_officer_type text, p_contact_name text, p_contact_email text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  if not internal.can('safeguarding.officer.nominate', 'club', p_club_id, null, null) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if p_officer_type not in ('primary', 'deputy') then
    raise exception 'Invalid officer type.';
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'A name and email are required to nominate a Safeguarding Officer.';
  end if;

  -- Still the CONTACT CARD only. It grants nothing, and it never did: the authority arrives through
  -- the role assignment, and only after AN-6.
  insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, created_by, updated_by)
  values (p_club_id, p_officer_type, trim(p_contact_name), lower(trim(p_contact_email)), auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'This club already has an active % Safeguarding Officer assignment. Deactivate it first before nominating a replacement.', p_officer_type using errcode = '23505';
end;
$$;

create or replace function public.accept_safeguarding_officer_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.club_safeguarding_officer_invitations;
  v_officer public.club_safeguarding_officers;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.club_safeguarding_officer_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.club_safeguarding_officer_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set user_id = auth.uid(), status = 'active', activated_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = v_inv.officer_id
  returning * into v_officer;

  perform internal.lock_club_people(v_inv.club_id);
  v_membership_id := internal.admit_club_member(v_inv.club_id, auth.uid(), 'SAFEGUARDING_APPOINTMENT', null, null, null);

  -- THE SAME SEAM, and this is the shape Slice 5 inherits: admit the person, then enter the one
  -- state machine. The comment this replaced said "The club's nomination and the officer's own
  -- email-bound acceptance are the confirmation" -- which is precisely what AN-6 says they are not.
  perform internal.enter_safeguarding_nomination(
    v_inv.club_id, auth.uid(), v_officer.officer_type, 'SAFEGUARDING_APPOINTMENT', v_inv.id, null, v_inv.officer_id);

  update public.club_safeguarding_officer_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'safeguarding_officer_invitation_accepted',
    'Safeguarding Officer invitation accepted',
    format('Your Safeguarding Officer invitation for %s was accepted. Ovalball must confirm the appointment before it grants anything.', v_inv.invited_email),
    jsonb_build_object('officer_id', v_inv.officer_id, 'invitation_id', v_inv.id)
  );
end;
$$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_safeguarding_officer_invitation') !~ 'enter_safeguarding_nomination' then
    raise exception 'invitation acceptance does not enter the canonical state machine.';
  end if;
end $$;
