-- =====================================================================================================
-- SLICE 5 (5/n) -- redemption (Phase 2 O.2, steps 1-12) + D-S5-1
--
-- The order of this function IS the security. In particular a one-time invitation is not consumed
-- until every check the transition needs has passed, so a person refused for a reason they can fix --
-- most importantly a missing date of birth under D-S5-1 -- still has a usable invitation afterwards.
-- =====================================================================================================

create or replace function internal.invitation_refused(p_invitation uuid, p_outcome text, p_generic boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invitation_redemption_attempts (invitation_id, user_id, ip_hash, outcome)
  values (p_invitation, auth.uid(),
          case when coalesce(current_setting('request.headers', true), '') = '' then null
               else extensions.digest(coalesce((current_setting('request.headers', true)::jsonb)->>'x-forwarded-for', ''), 'sha256') end,
          p_outcome);
end $$;

create or replace function public.redeem_invitation(p_token text default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v record;
  v_email text;
  v_failures int;
  v_membership uuid;
  v_role text;
  v_roles text[];
  v_result jsonb := '{}'::jsonb;
  v_existing uuid;
  v_generic constant text := 'That invitation or code can''t be used.';
begin
  -- Step 0. Redemption is an authenticated act. session_ok() is the canonical session gate; when
  -- Slice 6 adds the AAL2 requirement to it, redemption inherits that without being changed here.
  if v_actor is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session cannot be used for this.' using errcode = '42501';
  end if;
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;

  -- Step 3. Rate limits BEFORE any lookup, so guessing is capped whether or not the guess is close.
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    perform internal.invitation_refused(null, 'throttled');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts', '{}'::jsonb);
    raise exception '%', v_generic using errcode = 'P0001';
  end if;
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '1 day';
  if v_failures >= 20 then
    perform internal.invitation_refused(null, 'throttled_day');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts today', '{}'::jsonb);
    raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 5 (first half). Terminal states are persisted BEFORE any refusal, because a raise rolls
  -- back whatever the same transaction wrote -- the M-5 lesson.
  perform internal.expire_due_invitations();

  -- Steps 1, 4. Find it by hash, and hold the row for the rest of the transaction.
  select * into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1
   for update;

  if v.id is null then
    perform internal.invitation_refused(null, 'not_found');
    raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 5. Missing, revoked, expired or used all give the SAME answer: a prober must not be able to
  -- tell a revoked invitation from one that never existed.
  if v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    perform internal.invitation_refused(v.id, lower(v.state));
    raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 6. Personal invitations are bound to a verified email. The comparison is against the
  -- session's own confirmed address, never anything the caller supplied.
  if v.invited_email_normalised is not null then
    select lower(u.email) into v_email from auth.users u
     where u.id = v_actor and u.email_confirmed_at is not null;
    if v_email is null or v_email <> v.invited_email_normalised then
      perform internal.invitation_refused(v.id, 'wrong_identity');
      insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
      values ('invitation.identity_mismatch', v_actor, v.club_id, 'invitation opened by another identity',
              jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
      raise exception '%', v_generic using errcode = 'P0001';
    end if;
  end if;
  if v.kind = 'ACCOUNT_SETUP' and v.target_user_id is distinct from v_actor then
    perform internal.invitation_refused(v.id, 'wrong_identity');
    raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 7. The scope must still be real and usable.
  if v.club_id is not null and not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    perform internal.invitation_refused(v.id, 'scope_gone'); raise exception '%', v_generic using errcode = 'P0001';
  end if;
  if v.team_id is not null and not exists (select 1 from public.teams t where t.id = v.team_id and t.active) then
    perform internal.invitation_refused(v.id, 'scope_gone'); raise exception '%', v_generic using errcode = 'P0001';
  end if;
  if v.player_id is not null and not exists (select 1 from public.players p where p.id = v.player_id) then
    perform internal.invitation_refused(v.id, 'scope_gone'); raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 8. The issuer's authority is re-checked NOW. An invitation sent by somebody who has since
  -- lost the authority to send it must not still work.
  if not (
      (v.club_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed)
      or (v.team_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed)
      or (v.issued_level = 'SITE' and exists (
            select 1 from public.site_admins sa where sa.user_id = v.issued_by and sa.status = 'active'))
    ) then
    perform internal.invitation_refused(v.id, 'issuer_authority_lost');
    insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
    values ('invitation.issuer_authority_lost', v_actor, v.club_id, 'issuer no longer holds the authority',
            jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
    raise exception '%', v_generic using errcode = 'P0001';
  end if;

  -- Step 11 (multi-use idempotency). A second redemption by the same person returns what they already
  -- have rather than making a second request.
  select r.id into v_existing from public.invitation_redemptions r
   where r.invitation_id = v.id and r.user_id = v_actor;
  if v_existing is not null then
    return jsonb_build_object('outcome','ALREADY_REDEEMED','invitation_id',v.id,'kind',v.kind);
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- Steps 9 and 10. The outcome, through the canonical transitions and nothing else.
  --
  -- D-S5-1 is NOT re-implemented here. Every path below ends in internal.grant_role or
  -- internal.enter_safeguarding_nomination, which carry the gate, so a caller who reaches this
  -- function through some other route still meets it. What this function does is refuse BEFORE
  -- consuming the invitation, so a fixable refusal leaves the invitation usable.
  -- ---------------------------------------------------------------------------------------------
  if v.kind in ('CLUB_STAFF','SAFEGUARDING_OFFICER') then
    v_roles := case when v.kind = 'SAFEGUARDING_OFFICER' then array['SAFEGUARDING_OFFICER']
                    else coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'roles')), '{}') end;
    if exists (select 1 from unnest(v_roles) r
                join public.role_definitions rd on rd.role_key = r
               where rd.minor_prohibited)
       and not internal.person_is_established_adult(v_actor) then
      perform internal.invitation_refused(v.id, 'age_eligibility_required');
      -- NOT consumed: the invitation stays usable once a date of birth is on file.
      raise exception 'Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.'
        using errcode = '23514', hint = 'AGE_ELIGIBILITY_REQUIRED';
    end if;
  end if;

  if v.kind = 'CLUB_STAFF' then
    select m.id into v_membership from public.club_memberships m
     where m.club_id = v.club_id and m.user_id = v_actor and m.state = 'ACTIVE';
    if v_membership is null then
      -- A revoked or suspended membership is NOT resurrected by an invitation: the canonical path
      -- for readmission is a new row, and a terminal state stays terminal.
      insert into public.club_memberships (club_id, user_id, role, status, state)
      values (v.club_id, v_actor, 'BASIC_USER', 'active', 'ACTIVE')
      returning id into v_membership;
    end if;
    foreach v_role in array v_roles loop
      perform internal.grant_role(v_membership, v_role, v.team_id, 'INVITATION',
                                  'accepted invitation ' || v.id::text);
    end loop;
    v_result := jsonb_build_object('outcome','MEMBERSHIP_ACTIVE','membership_id',v_membership,'roles',to_jsonb(v_roles));

  elsif v.kind = 'SAFEGUARDING_OFFICER' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. This calls 4G's seam.
    select m.id into v_membership from public.club_memberships m
     where m.club_id = v.club_id and m.user_id = v_actor and m.state = 'ACTIVE';
    if v_membership is null then
      perform internal.invitation_refused(v.id, 'membership_required');
      raise exception 'You need to be an active member of that club before you can be its Safeguarding Officer.'
        using errcode = '23514';
    end if;
    v_result := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>'officer_type','primary'),
      'SAFEGUARDING_APPOINTMENT', v.id, 'accepted invitation');
    v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object('outcome','PENDING_CONFIRMATION');

  elsif v.kind = 'TEAM_JOIN_CODE' then
    -- L14: a code never grants access. It produces a REQUEST somebody with authority must decide.
    insert into public.club_join_requests (club_id, user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, 'BASIC_USER', 'pending', v.id)
    on conflict do nothing;
    v_result := jsonb_build_object('outcome','JOIN_REQUEST_PENDING','club_id',v.club_id,'team_id',v.team_id);

  elsif v.kind = 'SITE_ADMIN' then
    insert into public.site_admins (user_id, status, admin_role)
    values (v_actor, 'active', coalesce(v.intended_outcome->>'admin_role','read_only'))
    on conflict (user_id) do update set status = 'active';
    v_result := jsonb_build_object('outcome','SITE_ADMIN_ACTIVE');

  elsif v.kind = 'ACCOUNT_SETUP' then
    -- The identity is confirmed here; the password and MFA setup itself is Slice 6.
    v_result := jsonb_build_object('outcome','ACCOUNT_SETUP_CONFIRMED','user_id',v_actor);

  elsif v.kind in ('GUARDIAN','PLAYER_ACCOUNT','CLUB_REFERRAL') then
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);
  end if;

  -- Step 11. Consumption, only now that the outcome has actually been applied.
  insert into public.invitation_redemptions (invitation_id, user_id, result_ref) values (v.id, v_actor, v_result);
  update public.access_invitations
     set use_count = use_count + 1,
         state = case when use_count + 1 >= max_uses then 'REDEEMED' else state end,
         redeemed_by = case when max_uses = 1 then v_actor else redeemed_by end,
         redeemed_at = case when max_uses = 1 then now() else redeemed_at end,
         updated_at = now()
   where id = v.id;

  perform internal.invitation_refused(v.id, 'redeemed');
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.redeemed', v_actor, v.club_id, v.team_id, 'invitation redeemed',
          jsonb_build_object('invitation_id', v.id, 'kind', v.kind));

  return v_result || jsonb_build_object('invitation_id', v.id, 'kind', v.kind);
end $$;

revoke all on function public.redeem_invitation(text,text) from public, anon;
grant execute on function public.redeem_invitation(text,text) to authenticated;
