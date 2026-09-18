-- =====================================================================================================
-- SLICE 6b.2a -- the contract the RESTRICTIVE table gate could never reach
--
-- Phase 2 D.2 names three enforcement layers and makes the DATABASE the authoritative one. That is not
-- a claim: 209 of 231 RLS-enabled public tables carry the RESTRICTIVE `session_ok_required` policy, and
-- `internal.capability_decision` -- which `can()`, `has_site_capability()` and `club_ids_with()` all
-- funnel through -- refuses a session that is not live and an account that is not usable. Every
-- capability-gated path inherits both checks without repeating them.
--
-- SECURITY DEFINER is the hole in that argument, and it is not a small one. A definer function runs as
-- its owner, so RLS does not apply to it at all: the RESTRICTIVE policy that every table relies on
-- simply never runs. For a definer function the only authority is whatever the body states.
--
-- Twenty-six such functions, callable by a browser role and performing a mutation, stated authority
-- from `auth.uid()` alone. `auth.uid()` reads a claim out of a JWT. A JWT stays cryptographically valid
-- until it expires, which means it survives:
--
--   * sign-out-everywhere (the `auth.sessions` row is deleted; the token is not),
--   * a Site Admin suspending the account,
--   * a Site Admin disabling the account.
--
-- So for these twenty-six, "revoked" meant "revoked for everything except these". That is what this
-- migration closes, and it closes it in the database rather than in the application, because the
-- application is layer 2 and layer 2 is explicitly not the boundary.
--
-- WHAT THIS MIGRATION IS NOT
--
-- It is not a capability change. Every existing authority condition -- the invitation token, the exact
-- email match, the self/guardian relationship, the club membership, the mandatory-topic rule, the
-- one-time recovery-code rule -- is untouched and still decides exactly what it decided before. The
-- session check is ADDITIVE and sits in front of them.
--
-- It is not a new session predicate. `internal.require_live_session` holds no logic of its own; it asks
-- `internal.session_ok()`, the same function the 206 RESTRICTIVE policies ask, and raises the refusal.
-- Inventing a second answer to "is this session usable" is how the two drift.
--
-- It is not a table or data migration. Twenty-five CREATE OR REPLACEs and one new guard function.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- THE GUARD
--
-- Shaped exactly like `internal.require_capability` and `internal.require_recent_aal2`, which is
-- deliberate: a reader who knows one knows this. STABLE SECURITY DEFINER with an empty search_path, and
-- 42501, because that is the refusal vocabulary every other authority guard in this schema already uses.
--
-- `p_allow_aal_elevation` is the database half of the application's `allowAalElevation`, and exists for
-- exactly one caller. `internal.session_ok()` folds `session_aal_ok()`, so once an MFA enforcement group
-- exists, a person who has lost their authenticator fails it -- and `redeem_my_recovery_code` is the one
-- function whose entire purpose is to rescue that person. Gating it on the unqualified predicate would
-- refuse the only door out of the room, which is the shape that locked the platform owner out on
-- 17 September. Every other caller passes false, and a permanent test fails if that stops being true.
--
-- The elevated branch is still a real gate: the session row must exist for this user (that is what
-- `current_session_aal()` returns non-null for) and the account must still be usable. It stands down the
-- assurance question and nothing else.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.require_live_session(p_allow_aal_elevation boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_allow_aal_elevation then
    if internal.current_session_aal() is null or not internal.is_account_active(auth.uid()) then
      raise exception 'Your session is no longer valid. Sign in again.' using errcode = '42501';
    end if;
    return;
  end if;

  if not internal.session_ok() then
    raise exception 'Your session is no longer valid. Sign in again.' using errcode = '42501';
  end if;
end $$;

revoke all on function internal.require_live_session(boolean) from public;

comment on function internal.require_live_session(boolean) is
  'Phase 2 D.2 / S6-9. Raises 42501 unless the caller''s Ovalball session is live and the account is '
  'usable, by asking internal.session_ok() -- the same predicate the RESTRICTIVE table policies ask. '
  'SECURITY DEFINER functions bypass RLS, so this is where that gate is stated for them. '
  'p_allow_aal_elevation stands down only the assurance half, for redeem_my_recovery_code alone.';

-- ---------------------------------------------------------------------------------------
-- accept_guardian_invitation
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_guardian_invitation(p_token text)
 RETURNS TABLE(invitation_id uuid, club_id uuid, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv public.guardian_invitations;
  v_email text;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select * into inv from public.guardian_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation is no longer available.';
  end if;
  if inv.expires_at < now() then
    update public.guardian_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null or lower(v_email) <> lower(inv.invited_email) then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;

  update public.guardian_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = inv.id;

  return query select inv.id, inv.club_id, inv.team_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- accept_site_admin_invitation
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_site_admin_invitation(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_inv public.site_admin_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  select * into v_inv from public.site_admin_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.site_admin_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  begin
    perform internal.apply_site_admin_grant(auth.uid(), internal.site_profile_for_admin_role(v_inv.admin_role));
  exception when insufficient_privilege then
    -- NO security event is written here, and that is not an oversight.
    --
    -- The first version of this handler emitted one before re-raising, so that the administrator who
    -- sent the invitation could see it had been clicked. It could never have worked: the RAISE below
    -- aborts the transaction and takes the insert with it. An emit in an exception handler that
    -- re-raises is dead code that reads like a feature, which is worse than no code at all -- the
    -- next person to look would believe the trail exists.
    --
    -- Recording an attempt that must also fail needs a transaction that survives the failure, which
    -- plpgsql has no way to start. If this trail is wanted it belongs in the route handler, which is
    -- still running after the refusal. It is not wanted yet: production has exactly one pending
    -- invitation and its holder is known.
    raise exception 'Your invitation is valid, but Site Admin access now needs a second Ovalball administrator to approve it before it takes effect. Nothing is wrong with your account -- ask whoever invited you to approve it, and this link will still work afterwards.'
      using errcode = '42501';
  end;

  update public.site_admin_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'site_admin_invitation_accepted',
    'Site Admin invitation accepted',
    format('Your Site Admin invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('site_admin_invitation_id', v_inv.id)
  );
end $function$;

-- ---------------------------------------------------------------------------------------
-- add_support_followup
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_support_followup(p_ticket_id uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select status into v_status from public.support_tickets
  where id = p_ticket_id and created_by_user_id = auth.uid();

  if v_status is null then
    raise exception 'Support ticket not found.';
  end if;
  if v_status = 'closed' then
    raise exception 'This request is closed. Create a follow-up request instead.';
  end if;
  if length(trim(p_body)) = 0 then
    raise exception 'Message is required.';
  end if;

  insert into public.support_ticket_events (ticket_id, event_type, actor_user_id, visibility, body)
  values (p_ticket_id, 'requester_message', auth.uid(), 'requester', trim(p_body));

  update public.support_tickets set updated_at = now() where id = p_ticket_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- block_user
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_user_id = auth.uid() then
    raise exception 'You cannot block yourself.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    -- Deliberately the same message as a real block would produce nothing:
    -- probing this function must not confirm whether an account exists.
    raise exception 'That person could not be blocked.';
  end if;

  insert into public.user_message_blocks (blocker_user_id, blocked_user_id)
  values (auth.uid(), p_user_id)
  on conflict do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- cancel_guardian_link_request
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_guardian_link_request(p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.guardian_link_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null or r.requested_by_user_id is distinct from auth.uid() then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.' using errcode = '23514';
  end if;

  update public.guardian_link_requests
  set status = 'CANCELLED', decided_at = now(), decision_note = 'Withdrawn by the requester.'
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, 'Withdrawn by the requester.');
  perform internal.close_self_added_child(p_request_id);

  return 'cancelled';
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- claim_disabled_email_suppression
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_disabled_email_suppression(p_event_key text, p_occurrence_key text, p_recipient_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'A suppression may only be claimed by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_email, subject, status, suppression_reason
  )
  values (
    p_event_key, p_occurrence_key, p_occurrence_key, p_recipient_kind, null, '(email channel disabled)', 'suppressed',
    'This email is currently switched off in Email Configuration.'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- claim_email_delivery
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_email_delivery(p_event_key text, p_idempotency_key text, p_occurrence_key text, p_recipient_kind text, p_recipient_ref uuid DEFAULT NULL::uuid, p_recipient_email text DEFAULT NULL::text, p_club_id uuid DEFAULT NULL::uuid, p_subject text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Email delivery may only be claimed by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_ref,
    recipient_email, club_id, subject
  )
  values (
    p_event_key, p_idempotency_key, p_occurrence_key, p_recipient_kind, p_recipient_ref,
    p_recipient_email, p_club_id, p_subject
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- claim_responsible_payer
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_relationship text;
  v_id uuid;
  v_pricing record;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id and enabled = true;
  if v_club_id is null then
    raise exception 'This subscription programme is not available.';
  end if;

  if exists (select 1 from public.players where id = p_player_id and user_id = auth.uid()) then
    v_relationship := 'self';
  elsif internal.is_active_player_guardian(p_player_id) then
    v_relationship := 'guardian';
  else
    raise exception 'You are not authorized to set up a subscription for this player.' using errcode = '42501';
  end if;

  if exists (select 1 from public.player_subscription_payers where player_id = p_player_id and programme_id = p_programme_id and status = 'active') then
    raise exception 'This player already has an active responsible payer. Ask a Club Admin to change it.';
  end if;

  if not exists (
    select 1 from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id and t.club_id = v_club_id and ptm.status = 'active'
  ) then
    raise exception 'This player does not have an active membership at this club.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_programme_id::text, 0));

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, current_date);
  if v_pricing.final_amount_minor is null then
    raise exception 'No price is configured for this programme.';
  end if;

  insert into public.player_subscription_payers (
    player_id, programme_id, payer_user_id, relationship, created_by,
    sibling_ordinal, base_amount_minor, sibling_discount_type, sibling_discount_value, sibling_discount_amount_minor, final_amount_minor, pricing_id
  )
  values (
    p_player_id, p_programme_id, auth.uid(), v_relationship, auth.uid(),
    v_pricing.ordinal, v_pricing.base_amount_minor, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.final_amount_minor, v_pricing.pricing_id
  )
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (
    auth.uid(), v_club_id, 'payer_self_enrolled', 'player_subscription_payers', v_id,
    jsonb_build_object('player_id', p_player_id, 'relationship', v_relationship, 'sibling_ordinal', v_pricing.ordinal, 'final_amount_minor', v_pricing.final_amount_minor),
    'parent_ui'
  );

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- exit_diagnostic_club
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exit_diagnostic_club(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  update public.site_admin_diagnostic_sessions
  set exited_at = now()
  where id = p_session_id and site_admin_user_id = auth.uid() and exited_at is null;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- mark_announcement_read
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_announcement_read(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  update public.messenger_announcement_deliveries
  set read_at = coalesce(read_at, now())
  where announcement_id = p_announcement_id
    and recipient_user_id = auth.uid()
    and status = 'delivered';

  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and type = 'announcement_received'
    and (data ->> 'announcement_id') = p_announcement_id::text;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- mark_direct_conversation_read
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_direct_conversation_read(p_conversation_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  -- S6-9: SECURITY DEFINER bypasses RLS, so the session gate is stated here instead.
  select internal.require_live_session();
  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and type = 'new_direct_message'
    and (data ->> 'direct_conversation_id') = p_conversation_id::text
    and read_at is null;
$function$;

-- ---------------------------------------------------------------------------------------
-- record_billing_request
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_billing_request(p_payer_subscription_id uuid, p_club_id uuid, p_gc_billing_request_id text, p_gc_billing_request_flow_id text, p_authorisation_url text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if not exists (select 1 from public.player_subscription_payers psp where psp.id = p_payer_subscription_id and psp.payer_user_id = auth.uid()) then
    raise exception 'You are not authorized to start this enrolment.' using errcode = '42501';
  end if;

  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, gc_billing_request_flow_id, authorisation_url, created_by)
  values (p_club_id, p_payer_subscription_id, p_gc_billing_request_id, p_gc_billing_request_flow_id, p_authorisation_url, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- record_email_delivery_result
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_email_delivery_result(p_delivery_id uuid, p_status text, p_provider text DEFAULT NULL::text, p_provider_reference text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_suppression_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Email delivery results may only be recorded by an authenticated session.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  update public.email_deliveries
  set status = p_status,
      provider = coalesce(p_provider, provider),
      provider_reference = coalesce(p_provider_reference, provider_reference),
      error_code = p_error_code,
      error_message = p_error_message,
      suppression_reason = p_suppression_reason,
      attempts = attempts + case when p_status in ('sent', 'failed') then 1 else 0 end,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = p_delivery_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- record_own_date_of_birth
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_own_date_of_birth(p_date_of_birth date, p_first_name text DEFAULT NULL::text, p_surname text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_existing date;
  v_has_profile boolean;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_date_of_birth is null then
    raise exception 'Enter your date of birth.' using errcode = '22023';
  end if;
  -- Not a validation flourish: a date in the future or centuries back is how an unchecked field
  -- becomes a way to assert whatever the gate above it wants to hear.
  if p_date_of_birth > current_date then
    raise exception 'A date of birth cannot be in the future.' using errcode = '22023';
  end if;
  if p_date_of_birth < current_date - interval '120 years' then
    raise exception 'That date of birth does not look right.' using errcode = '22023';
  end if;

  select true, pr.date_of_birth into v_has_profile, v_existing
    from public.profiles pr where pr.id = v_actor;

  -- Set once. Correcting one is a different act, by somebody else, through a capability that exists
  -- for it -- so this refuses rather than quietly overwriting.
  if v_existing is not null then
    raise exception 'Your date of birth is already on file. Ask Ovalball support to correct it.'
      using errcode = '42501';
  end if;

  if coalesce(v_has_profile, false) then
    update public.profiles set date_of_birth = p_date_of_birth,
           first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
           surname    = coalesce(nullif(btrim(p_surname), ''), surname)
     where id = v_actor;
  else
    -- Somebody invited to Ovalball who has never been anybody here yet: first name and surname are
    -- NOT NULL on profiles, so this is the minimum identity, and nothing more is asked for.
    if nullif(btrim(p_first_name), '') is null or nullif(btrim(p_surname), '') is null then
      raise exception 'Enter your first name and last name.' using errcode = '22023';
    end if;
    insert into public.profiles (id, first_name, surname, date_of_birth)
    values (v_actor, btrim(p_first_name), btrim(p_surname), p_date_of_birth);
  end if;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('identity.date_of_birth_recorded', v_actor, 'the person supplied their own date of birth',
          jsonb_build_object('established_adult', internal.person_is_established_adult(v_actor)));
end $function$;

-- ---------------------------------------------------------------------------------------
-- record_session_version
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_session_version(p_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version integer := least(coalesce(p_version, 0), internal.auth_session_version());
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  insert into public.user_session_versions (user_id, version, set_at)
  values (auth.uid(), v_version, now())
  on conflict (user_id) do update
    set version = greatest(public.user_session_versions.version, excluded.version), set_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- redeem_my_recovery_code
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_my_recovery_code(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_ok boolean;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session(true);

  -- Consumes exactly one code, or refuses. Throttling and the one-time rule live in here.
  v_ok := internal.redeem_recovery_code(v_actor, p_code);
  if not v_ok then
    return false;
  end if;

  -- The authenticator is gone as far as Ovalball is concerned, so it must be gone in GoTrue too --
  -- otherwise the person is still challenged by a factor they have just told us they cannot reach.
  -- Challenges and amr entries go with it: a challenge outliving its factor is a dangling row, and an
  -- amr entry claiming a totp method for a factor that no longer exists is a claim about a proof that
  -- can no longer be made.
  delete from auth.mfa_challenges c
   where c.factor_id in (select f.id from auth.mfa_factors f where f.user_id = v_actor);
  delete from auth.mfa_amr_claims a
   where a.authentication_method = 'totp'
     and a.session_id in (select s.id from auth.sessions s where s.user_id = v_actor);
  delete from auth.mfa_factors f where f.user_id = v_actor;

  update public.account_security_state
     set mfa_enrolled_at = null, updated_at = now()
   where user_id = v_actor;

  insert into public.security_events (event_type, subject_user_id, reason, metadata)
  values ('mfa.factors_reset', v_actor, 'recovery code redeemed', '{}'::jsonb);

  return true;
end $function$;

-- ---------------------------------------------------------------------------------------
-- request_to_join_club
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_to_join_club(p_player_id uuid, p_club_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_self boolean;
  v_is_guardian boolean;
  v_existing uuid;
  v_active uuid;
  v_dob date;
  v_pathway text;
  v_code text;
  a record;
  v_season uuid;
  v_age record;
  v_category text;
  v_type_id uuid;
  v_id uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select p.date_of_birth, p.playing_pathway into v_dob, v_pathway
  from public.players p where p.id = p_player_id;
  if not found then raise exception 'Player not found.'; end if;

  -- Authority comes from the relationship, never from knowing the id.
  v_is_self := exists (select 1 from public.players p where p.id = p_player_id and p.user_id = auth.uid());
  v_is_guardian := exists (select 1 from public.guardians g
                           where g.player_id = p_player_id and g.guardian_user_id = auth.uid() and g.status = 'active');
  if not (v_is_self or v_is_guardian) then
    raise exception 'Only this player, or their guardian, can ask to join a club for them.' using errcode = '42501';
  end if;

  -- Allocation needs both. Asking without them would send the club a request
  -- they cannot act on.
  if v_dob is null then
    raise exception 'A date of birth is needed before you can ask to join a club.' using errcode = '23514';
  end if;
  if v_pathway is null then
    raise exception 'Ovalball needs to know which pathway this player is registered in before asking a club to accept them.' using errcode = '23514';
  end if;

  select cd.rugby_code into v_code
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id and c.status = 'active';
  if v_code is null then raise exception 'Club not found.'; end if;

  -- Already a member here. Saying so is more useful than a second request.
  select ptm.id into v_active
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and t.club_id = p_club_id and ptm.status = 'active'
  limit 1;
  if v_active is not null then
    raise exception 'This player already plays for this club.' using errcode = '23505';
  end if;

  -- IDEMPOTENT. A refresh, a double click, or a return through a different
  -- sign-in method finds the request that already exists.
  select id into v_existing from public.player_club_join_requests
  where player_id = p_player_id and club_id = p_club_id and status = 'pending';
  if v_existing is not null then
    return v_existing;
  end if;

  -- Record what Ovalball resolved, so the club reads the same answer the player
  -- was shown. Youth and adult go through their own canonical resolvers.
  v_season := internal.resolve_season_for_date(v_code, current_date);
  if v_season is not null then
    select * into v_age from public.resolve_player_regulatory_age(v_code, v_season, v_dob);
    if v_age.status = 'ADULT' then
      select * into a from public.resolve_adult_category(v_code, v_pathway);
      v_category := a.display_label;
      v_type_id := a.canonical_team_type_id;
    else
      declare n record;
      begin
        select * into n from public.resolve_normal_operational_identity(v_code, v_season, v_dob, v_pathway);
        v_type_id := n.canonical_team_type_id;
        if v_type_id is not null then
          select ap.display_label into v_category from internal.allocation_presentation(v_type_id, v_code) ap;
        end if;
      end;
    end if;
  end if;

  insert into public.player_club_join_requests
    (player_id, club_id, requested_by, resolved_category, resolved_canonical_team_type_id)
  values (p_player_id, p_club_id, auth.uid(), v_category, v_type_id)
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- respond_to_attendance
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source text;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  -- The player's place in a team involved in this fixture is locked for the
  -- response, so a concurrent move decides it one way or the other (R20).
  perform 1
  from public.fixtures f
  join public.player_team_memberships ptm
    on ptm.player_id = p_player_id and ptm.state = 'ACTIVE' and ptm.team_id in (f.home_team_id, f.away_team_id)
  where f.id = p_fixture_id
  for share of ptm;
  if not found then
    raise exception 'This player is not associated with a team involved in this fixture.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- respond_to_event_attendance
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_event_attendance(p_event_id uuid, p_player_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source text;
  v_event public.club_events;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Unknown response.' using errcode = '22023';
  end if;

  select * into v_event from public.club_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;

  -- The player must actually be involved in this event, or the response is
  -- about a relationship that does not exist.
  if not exists (
    select 1
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id
      and ptm.status = 'active'
      and t.club_id = v_event.club_id
      and (
        v_event.is_club_wide
        or exists (select 1 from public.club_event_teams cet where cet.event_id = p_event_id and cet.team_id = ptm.team_id)
      )
  ) then
    raise exception 'That player is not involved in this event.' using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);
  if v_source is null then
    raise exception 'You cannot respond for this player.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (event_id, player_id, status, responded_by_user_id, response_source)
  values (p_event_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (event_id, player_id) where event_id is not null
  do update set
    status = excluded.status,
    responded_by_user_id = excluded.responded_by_user_id,
    response_source = excluded.response_source,
    updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- respond_to_training_attendance
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_training_attendance(p_training_session_id uuid, p_player_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_source text;
  v_involved boolean;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  -- Section 25: a cancelled session is read-only -- no new response needed or accepted.
  if s.status = 'CANCELLED' then
    raise exception 'This training session has been cancelled -- no attendance response is needed.' using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  select exists (
    select 1 from public.player_team_memberships ptm
    where ptm.player_id = p_player_id and ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
  ) into v_involved;
  if not v_involved then
    raise exception 'This player is not associated with the team training in this session.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
  values (p_training_session_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (training_session_id, player_id) where training_session_id is not null do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- set_notification_preference
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_notification_preference(p_topic_key text, p_in_app_enabled boolean DEFAULT NULL::boolean, p_email_enabled boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();

  if not exists (select 1 from public.notification_topics where key = p_topic_key) then
    raise exception 'Unknown notification category.';
  end if;

  -- THE IN-APP SAFEGUARD. A mandatory topic may not be switched off, and
  -- saying so is better than accepting the write and quietly ignoring it.
  if p_in_app_enabled is false
     and (select mandatory from public.notification_topics where key = p_topic_key) then
    raise exception 'This notification topic is mandatory and cannot be turned off.' using errcode = '23514';
  end if;

  insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled)
  values (
    auth.uid(),
    p_topic_key,
    coalesce(p_in_app_enabled, true),
    coalesce(p_email_enabled, true)
  )
  on conflict (user_id, topic_key) do update set
    -- Only the channel actually named is changed, so a screen that saves one
    -- switch cannot silently reset the other.
    in_app_enabled = coalesce(p_in_app_enabled, public.notification_preferences.in_app_enabled),
    email_enabled  = coalesce(p_email_enabled,  public.notification_preferences.email_enabled),
    updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- soft_delete_own_message
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_own_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sender uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select sender_user_id into v_sender from public.fixture_messages where id = p_message_id;
  if v_sender is null then
    raise exception 'Message not found.';
  end if;
  if v_sender <> auth.uid() then
    raise exception 'You can only delete your own messages.' using errcode = '42501';
  end if;

  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'sender'
  where id = p_message_id and deleted_at is null;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- touch_last_active
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_last_active()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- S6-9: SECURITY DEFINER bypasses RLS, so the session gate is stated here instead.
  select internal.require_live_session();
  update public.profiles set last_active_at = now() where id = auth.uid();
$function$;

-- ---------------------------------------------------------------------------------------
-- unblock_user
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unblock_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  update public.user_message_blocks
  set lifted_at = now(), lifted_by = auth.uid()
  where blocker_user_id = auth.uid() and blocked_user_id = p_user_id and lifted_at is null;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- withdraw_player_club_join_request
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_player_club_join_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.player_club_join_requests;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select * into r from public.player_club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0001';
  end if;
  if not (
    exists (select 1 from public.players p where p.id = r.player_id and p.user_id = auth.uid())
    or exists (select 1 from public.guardians g where g.player_id = r.player_id
               and g.guardian_user_id = auth.uid() and g.status = 'active')
  ) then
    raise exception 'Only the player, or their guardian, can withdraw this request.' using errcode = '42501';
  end if;

  update public.player_club_join_requests
  set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_request_id;
end;
$function$;

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
--
-- The archaeology that found these twenty-six is re-run here, from first principles, against the schema
-- this migration has just produced. It is a fixpoint over the call graph rather than a grep, because a
-- function that reaches the gate through a helper is gated and a grep would call it naked.
--
-- One function is expected to remain: `submit_public_support_ticket` is the public contact form, granted
-- to `anon` by design. Requiring a live session there would refuse the people it exists for, and it
-- grants nothing an anonymous caller could not already do -- so it is named, not silently tolerated.
-- =====================================================================================================
do $$
declare
  v_leftover text;
  v_count int;
begin
  with recursive allfn as (
    select ((n.nspname||'.'||p.proname)::text collate "default") as qname, p.prosrc, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','internal') and p.prokind = 'f'
  ),
  seeds as (
    select unnest(array[
      'internal.session_ok','internal.session_live','internal.session_live_only',
      'internal.capability_decision','internal.can','internal.has_site_capability',
      'internal.club_ids_with','internal.is_account_active','internal.session_aal_ok',
      'internal.require_live_session'
    ]) as fn
  ),
  edges as (
    select a.qname as caller, b.qname as callee
    from allfn a join allfn b
      on a.oid <> b.oid
     and a.prosrc ~ ('(^|[^a-zA-Z0-9_.])' || replace(b.qname,'.','\.') || '\s*\(')
  ),
  closure as (
    select fn as qname from seeds
    union
    select e.caller from edges e join closure c on e.callee = c.qname
  )
  select count(*), coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into v_count, v_leftover
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.prosecdef
    and (has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute'))
    and p.prosrc ~* '(^|[^a-zA-Z_])(insert|update|delete|merge)\s'
    and ('public.'||p.proname) not in (select qname from closure)
    and p.proname <> 'submit_public_support_ticket';

  if v_count > 0 then
    raise exception 'Slice 6b.2a: % browser-callable SECURITY DEFINER mutation path(s) still bypass the canonical session gate: %', v_count, v_leftover;
  end if;

  -- The public exception must still BE the public exception: ungated, and still reachable by anon.
  if not has_function_privilege('anon', 'public.submit_public_support_ticket(text,text,text,text,text,text)', 'execute') then
    raise exception 'Slice 6b.2a: the public contact form is no longer anon-callable, so the declared exception is now a lie';
  end if;

  raise notice 'Slice 6b.2a: every browser-callable definer mutation now meets the session gate, bar the declared public one';
end $$;

-- -----------------------------------------------------------------------------------------------------
-- The AAL stand-down is narrow, and stays narrow (the database half of D-S6B-AUTO-12).
-- -----------------------------------------------------------------------------------------------------
do $$
declare v_users text;
begin
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into v_users
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ 'require_live_session\s*\(\s*true\s*\)';

  if v_users <> 'redeem_my_recovery_code' then
    raise exception 'Slice 6b.2a: the AAL stand-down must be used by redeem_my_recovery_code and nothing else, but is used by: %', coalesce(nullif(v_users,''), '(nobody)');
  end if;
  raise notice 'Slice 6b.2a: the assurance stand-down reaches exactly one function, the one that rescues a lost authenticator';
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Nothing about these functions changed except their authority body.
-- -----------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ 'require_live_session'
    and (not p.prosecdef
      or not has_function_privilege('authenticated', p.oid, 'execute')
      or pg_get_userbyid(p.proowner) <> 'postgres');

  if v_bad <> '' then
    raise exception 'Slice 6b.2a: a gated function lost its definer status, its grant or its owner: %', v_bad;
  end if;
  raise notice 'Slice 6b.2a: signatures, grants, ownership and definer status are exactly as they were';
end $$;
