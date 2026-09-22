-- CONVERGENCE STEP 16 — HARDENING.
--
-- ONE DEFECT, ONE FUNCTION. Accepting a governing-body invitation lifted a suspension.
--
-- Found by asking the question §28 of the Step 16 handoff asked and its suite did not: does a person
-- whose organisation access has been revoked or suspended actually lose authority? Revocation was
-- already correct and is now covered permanently (step16_governing_closure K1-K5). Suspension was
-- correct for reads and for every authority predicate -- internal.body_role() requires ACTIVE -- but
-- redeem_invitation could put the row back to ACTIVE, which is the one way back in that did not go
-- through an administrator.
--
-- This migration recreates public.redeem_invitation with the guard and changes NOTHING else: the body
-- is the live definition captured with pg_get_functiondef, so every other kind, the consumption step,
-- the security event and the L7 release bridge (accept_invitation, get_invitation_preview) are
-- byte-identical to what was deployed.
--
-- No column is added, nothing is dropped, and no historical migration is rewritten.
-- -----------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_teams jsonb;
  v_officer text;
  v_team uuid;
  v_team_roles text[];
  v_id uuid;
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
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '1 day';
  if v_failures >= 20 then
    perform internal.invitation_refused(null, 'throttled_day');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts today', '{}'::jsonb);
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
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
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 11 (multi-use idempotency). A second redemption by the same person returns what they already
  -- have rather than making a second request.
  select r.id into v_existing from public.invitation_redemptions r
   where r.invitation_id = v.id and r.user_id = v_actor;
  if v_existing is not null then
    return jsonb_build_object('outcome','ALREADY_REDEEMED','invitation_id',v.id,'kind',v.kind);
  end if;

  -- Step 5. Missing, revoked, expired or used all give the SAME answer: a prober must not be able to
  -- tell a revoked invitation from one that never existed.
  if v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    perform internal.invitation_refused(v.id, lower(v.state));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
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
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
  end if;
  if v.kind = 'ACCOUNT_SETUP' and v.target_user_id is distinct from v_actor then
    perform internal.invitation_refused(v.id, 'wrong_identity');
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 7. The scope must still be real and usable.
  if v.club_id is not null and not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.team_id is not null and not exists (select 1 from public.teams t where t.id = v.team_id and t.active) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.player_id is not null and not exists (select 1 from public.players p where p.id = v.player_id) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 8. The issuer's authority is re-checked NOW. An invitation sent by somebody who has since
  -- lost the authority to send it must not still work.
  if not (
      (v.club_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed)
      or (v.team_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed)
      or (v.player_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'child', null, null, v.player_id)).allowed)
      or (v.issued_level = 'SITE' and exists (
            select 1 from public.site_admins sa where sa.user_id = v.issued_by and sa.status = 'active'))
      -- CONVERGENCE STEP 16. The same rule as every line above it: an invitation must not still work
      -- if the person who sent it has since lost the authority to send it. Asked of the ISSUER, by id,
      -- so it is their standing at the organisation that is re-checked and not the redeemer's.
      or (v.constituent_body_id is not null
          and (internal.body_role(v.constituent_body_id, v.issued_by) = 'BODY_ADMIN'
               or exists (select 1 from public.site_admins sa
                           where sa.user_id = v.issued_by and sa.status = 'active')))
    ) then
    perform internal.invitation_refused(v.id, 'issuer_authority_lost');
    insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
    values ('invitation.issuer_authority_lost', v_actor, v.club_id, 'issuer no longer holds the authority',
            jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- Steps 9 and 10. The outcome, through the canonical transitions and nothing else.
  --
  -- D-S5-1 is NOT re-implemented here. Every path below ends in internal.grant_role or
  -- internal.enter_safeguarding_nomination, which carry the gate, so a caller who reaches this
  -- function through some other route still meets it. What this function does is refuse BEFORE
  -- consuming the invitation, so a fixable refusal leaves the invitation usable.
  -- ---------------------------------------------------------------------------------------------
  if v.kind = 'SITE_ADMIN' and not internal.person_is_established_adult(v_actor) then
    perform internal.invitation_refused(v.id, 'age_eligibility_required');
    -- NOT consumed: the invitation stays usable once a date of birth is on file.
    return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
  end if;

  if v.kind in ('CLUB_STAFF','SAFEGUARDING_OFFICER') then
    v_roles := case when v.kind = 'SAFEGUARDING_OFFICER' then array['SAFEGUARDING_OFFICER']
                    else coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'roles')), '{}') end;
    if exists (select 1 from unnest(v_roles) r
                join public.role_definitions rd on rd.role_key = r
               where rd.minor_prohibited)
       and not internal.person_is_established_adult(v_actor) then
      perform internal.invitation_refused(v.id, 'age_eligibility_required');
      -- NOT consumed: the invitation stays usable once a date of birth is on file.
      return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
    end if;
  end if;

  if v.kind = 'CLUB_STAFF' then
    -- The authorised teams come from the STORED invitation. Redemption takes no team argument, so
    -- there is nothing for a browser to substitute.
    v_teams := coalesce(v.intended_outcome->'teams', '[]'::jsonb);

    -- Validated here, before ANY part of the outcome is written: every team must still be an active
    -- team of this club, or the invitation stays unspent and the person is left exactly as they were.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>'id')::uuid and te.club_id = v.club_id and te.active)) then
      perform internal.invitation_refused(v.id, 'scope_gone');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;

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
      if not internal.role_is_team_scoped(v_role) then
        perform internal.grant_role(v_membership, v_role, null, 'INVITATION',
                                    'accepted invitation ' || v.id::text);
      end if;
    end loop;
    for v_team, v_team_roles in
      select (t->>'id')::uuid, array(select jsonb_array_elements_text(t->'roles'))
        from jsonb_array_elements(v_teams) t
    loop
      foreach v_role in array v_team_roles loop
        perform internal.grant_role(v_membership, v_role, v_team, 'INVITATION',
                                    'accepted invitation ' || v.id::text);
      end loop;
    end loop;
    v_result := jsonb_build_object('outcome','MEMBERSHIP_ACTIVE','membership_id',v_membership,
                                   'roles',to_jsonb(v_roles),'teams',v_teams);

  elsif v.kind = 'SAFEGUARDING_OFFICER' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. Admit the person, then
    -- enter the one state machine -- which is the shape 4G said Slice 5 inherits, and the reason an
    -- EXTERNAL nominee can accept at all. Requiring a membership first would have made the
    -- email-bound invitation useful only to people who did not need it.
    v_officer := v.intended_outcome->>'officer_id';
    perform internal.lock_club_people(v.club_id);
    v_membership := internal.admit_club_member(v.club_id, v_actor, 'SAFEGUARDING_APPOINTMENT', null, null, null);

    if v_officer is not null then
      update public.club_safeguarding_officers
         set user_id = v_actor, status = 'active', activated_at = now(),
             updated_by = v_actor, updated_at = now()
       where id = v_officer::uuid;
    end if;

    -- The officer record says active; the AUTHORITY does not. enter_safeguarding_nomination forces
    -- PENDING_CONFIRMATION whoever calls it, so this is a contact record that has been claimed and an
    -- appointment still waiting on Ovalball (AN-6).
    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>'officer_type','primary'),
      'SAFEGUARDING_APPOINTMENT', v.id, 'accepted invitation',
      case when v_officer is null then null else v_officer::uuid end);

    insert into public.notifications (user_id, type, title, body, data)
    values (v.issued_by, 'safeguarding_officer_invitation_accepted',
            'Safeguarding Officer invitation accepted',
            format('Your Safeguarding Officer invitation for %s was accepted. Ovalball must confirm the appointment before it grants anything.',
                   v.invited_email_normalised),
            jsonb_build_object('officer_id', v_officer, 'invitation_id', v.id));

    v_result := jsonb_build_object('outcome','PENDING_CONFIRMATION','assignment_id',v_id,
                                   'membership_id',v_membership);

  elsif v.kind = 'TEAM_JOIN_CODE' then
    -- L14: a code never grants access. It produces a REQUEST somebody with authority must decide.
    insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, 'BASIC_USER', 'pending', v.id)
    on conflict do nothing;
    v_result := jsonb_build_object('outcome','JOIN_REQUEST_PENDING','club_id',v.club_id,'team_id',v.team_id);

  elsif v.kind = 'SITE_ADMIN' then
    perform internal.apply_site_admin_grant(
      v_actor, internal.site_profile_for_admin_role(coalesce(v.intended_outcome->>'admin_role','read_only')));
    v_result := jsonb_build_object('outcome','SITE_ADMIN_ACTIVE');

  elsif v.kind = 'ACCOUNT_SETUP' then
    -- The identity is confirmed here; the password and MFA setup itself is Slice 6.
    v_result := jsonb_build_object('outcome','ACCOUNT_SETUP_CONFIRMED','user_id',v_actor);

  elsif v.kind = 'PLAYER_ACCOUNT' then
    -- One account is one person. Linking an account that is already somebody, or a player who
    -- already has a login, would merge two identities -- so both refuse, and neither spends the
    -- invitation, because the person can be told what is wrong and it can still be used after.
    if not internal.can('player.account.link', 'self', null, null, null)
       or exists (select 1 from public.players pl where pl.user_id = v_actor)
       or exists (select 1 from public.players pl where pl.id = v.player_id and pl.user_id is not null) then
      perform internal.invitation_refused(v.id, 'player_account_link_unavailable');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
    update public.players set user_id = v_actor where id = v.player_id;
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);

  -- CONVERGENCE STEP 16 -- A GOVERNING BODY OFFICER.
  --
  -- SERVER-AUTHORED, like every other outcome here: the role comes from the invitation the
  -- administrator fixed, never from anything the redeemer sends. The organisation comes from the
  -- invitation's own column, and the address was already matched against this session's CONFIRMED
  -- email at step 6, so a link forwarded to somebody else cannot be redeemed by them.
  elsif v.kind = 'GOVERNING_BODY_OFFICER' then
    -- A SUSPENSION IS NOT LIFTED BY ACCEPTING AN INVITATION.
    --
    -- The upsert below sets state = 'ACTIVE', and its conflict target is `state <> 'REVOKED'` -- so it
    -- matches a SUSPENDED row as readily as an ACTIVE one. Accepting an invitation therefore used to
    -- reinstate suspended authority as a side effect, and raise the role while doing it: measured, a
    -- SUSPENDED BODY_COMPETITIONS officer redeemed and came back as an ACTIVE BODY_ADMIN.
    --
    -- That contradicts the rule this platform states for the club role machine, where suspended
    -- authority survives even a full club reactivation: "reactivate_club() deliberately does NOT clear
    -- it -- only restore_club_membership_authority(), one membership at a time, does ... data returns,
    -- privileged authority does not silently return with it." A governing body is a smaller
    -- organisation, not a laxer one.
    --
    -- REFUSED BY RETURNING, NOT BY RAISING, which is this function's contract (IN-K1/IN-K2): a raise
    -- rolls back the attempt record and defeats the redemption rate limits. The reason is specific
    -- rather than the generic message because identity was already established at step 6 -- this is the
    -- invited person, being told something they need and can act on, exactly as
    -- AGE_ELIGIBILITY_REQUIRED is. The invitation is left ISSUED, so it still works once an
    -- administrator has deliberately restored them.
    --
    -- Nothing writes SUSPENDED today -- it is vocabulary the table and the People page carry, and no
    -- control sets it -- so this closes the path before it is reachable rather than after.
    if exists (select 1 from public.constituent_body_roles r
                where r.constituent_body_id = v.constituent_body_id
                  and r.user_id = v_actor and r.state = 'SUSPENDED') then
      perform internal.invitation_refused(v.id, 'organisation_access_suspended');
      return jsonb_build_object('outcome','REFUSED','reason','ORGANISATION_ACCESS_SUSPENDED',
        'message','Your access to this organisation is suspended. An administrator there must restore it before you can accept an invitation.');
    end if;
    insert into public.constituent_body_roles (constituent_body_id, user_id, role_key, granted_by, reason)
    values (v.constituent_body_id, v_actor, v.intended_outcome->>'role_key', v.issued_by,
            'Accepted an invitation to this organisation')
    on conflict (constituent_body_id, user_id) where state <> 'REVOKED'
    do update set role_key = excluded.role_key, state = 'ACTIVE', updated_at = now()
    returning id into v_id;
    v_result := jsonb_build_object('outcome','BODY_ROLE_ACTIVE','role_id',v_id,
      'constituent_body_id',v.constituent_body_id,'role_key',v.intended_outcome->>'role_key');

  elsif v.kind in ('GUARDIAN','CLUB_REFERRAL') then
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
end $function$;


-- -----------------------------------------------------------------------------------------------------
-- SELF-CHECK. The guard is present, it refuses the way this function refuses, and nothing else moved.
-- -----------------------------------------------------------------------------------------------------
do $guard$
declare v_def text; v_raises int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_invitation';
  -- Comments are stripped before matching: this file's own prose names the states it guards, and a
  -- guard that matches its own commentary proves nothing. That trap has been sprung four times on this
  -- programme, so it is now stripped by reflex.
  v_def := regexp_replace(v_def, '--[^\n]*', '', 'g');

  if v_def !~ 'ORGANISATION_ACCESS_SUSPENDED' then
    raise exception 'redeem_invitation lost the suspended-access guard';
  end if;
  if v_def !~ 'GOVERNING_BODY_OFFICER' then
    raise exception 'redeem_invitation lost the governing body branch';
  end if;
  -- THE CALLER CONTRACT IS UNCHANGED. A refusal is returned, never raised, because raising rolls back
  -- the attempt record and defeats the rate limits (invitation_authority_matrix IN-K1/IN-K2). Three
  -- raises remain -- no session, unusable session, no input -- and this guard fails if a fourth appears.
  select count(*) into v_raises from regexp_matches(v_def, 'raise exception', 'g');
  if v_raises <> 3 then
    raise exception 'redeem_invitation should raise for exactly 3 conditions, found %', v_raises;
  end if;
  -- The other kinds are still there: this was a one-branch change, not a rewrite.
  if v_def !~ 'CLUB_STAFF' or v_def !~ 'GUARDIAN' or v_def !~ 'PLAYER_ACCOUNT' then
    raise exception 'redeem_invitation lost a kind it used to handle';
  end if;
  raise notice 'Step 16 hardening: redeem_invitation refuses to reinstate suspended organisation access.';
end $guard$;
