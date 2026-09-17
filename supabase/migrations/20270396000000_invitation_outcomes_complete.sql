-- =====================================================================================================
-- SLICE 5 (15/n) -- the outcomes that were declared but never applied
--
-- Two things found while migrating the legacy issuers onto public.issue_invitation.
--
-- 1. PLAYER_ACCOUNT redemption answered ACCEPTED and did nothing. The legacy
--    accept_player_account_invitation links the player row to the account; the canonical path
--    returned the same shape of success without the link, so a player invited through the canonical
--    issuer would have been told they had an Ovalball login and then had none.
--
-- 2. A child-scoped invitation could never be issued at all. issue_invitation derives the club and
--    team from the player -- correctly, for the invitation ROW -- and was then passing them into the
--    authority check as well. Child scope is the canonical answer to "may I act for THIS CHILD", and
--    internal.capability_decision rejects it as SCOPE_MALFORMED the moment a club or a team is
--    supplied alongside, because a child's scope is the child. Every PLAYER_ACCOUNT invitation a
--    guardian tried to send was refused as unauthorised. The re-check at REDEMPTION had the same
--    gap from the other side: it re-tested the issuer's authority at club scope and at team scope
--    and nowhere else, so a child-scoped capability -- which is valid at neither -- always came back
--    as issuer_authority_lost. Both halves are fixed here, because fixing one alone just moves the
--    refusal.
--
-- 3. SITE_ADMIN redemption had no age gate. D-S5-1 gates the club roles because they are
--    minor_prohibited in role_definitions, and site_admins is not in that table -- so the single most
--    safeguarding-sensitive authority Ovalball has was the one authority an identity of unknown age
--    could still cross. That is exactly the escalation route D-S5-1 exists to close, and D-S5-1 names
--    invitation redemption as in scope.
-- =====================================================================================================

-- --- 0. A child's scope is the child --------------------------------------------------------------
do $$
declare v text;
begin
  -- The whole definition, so the signature comes from the function itself and this cannot quietly
  -- become an OVERLOAD of what it means to replace.
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='issue_invitation';
  v := replace(v,
E'      or (v_spec.scope_type = ''child'' and p_player_id is not null and internal.can(v_spec.issuer_capability, ''child'', v_club, p_team_id, p_player_id))',
E'      -- Only the player: a club or a team alongside makes the scope malformed, because child scope
      -- is the canonical answer to "may I act for THIS CHILD" and nothing else narrows it.
      or (v_spec.scope_type = ''child'' and p_player_id is not null and internal.can(v_spec.issuer_capability, ''child'', null, null, p_player_id))');
  execute v;
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v ~ 'player_account_link_unavailable' then return; end if;   -- already applied

  -- --- 0b. The issuer's authority is re-checked in the scope it was actually held in ----------------
  v := replace(v,
E'      or (v.issued_level = ''SITE'' and exists (',
E'      or (v.player_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, ''child'', null, null, v.player_id)).allowed)
      or (v.issued_level = ''SITE'' and exists (');

  -- --- 1. The age gate covers becoming a Site Admin ------------------------------------------------
  -- Phrased as its own condition rather than by adding SITE_ADMIN to the role loop, because a Site
  -- Admin is not a role_definitions role and pretending otherwise would put a fake row in the
  -- catalogue that every other query then has to know to ignore.
  v := replace(v,
E'  if v.kind in (''CLUB_STAFF'',''SAFEGUARDING_OFFICER'') then',
E'  if v.kind = ''SITE_ADMIN'' and not internal.person_is_established_adult(v_actor) then
    perform internal.invitation_refused(v.id, ''age_eligibility_required'');
    -- NOT consumed: the invitation stays usable once a date of birth is on file.
    return jsonb_build_object(''outcome'',''REFUSED'',''reason'',''AGE_ELIGIBILITY_REQUIRED'',''message'',''Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.'');
  end if;

  if v.kind in (''CLUB_STAFF'',''SAFEGUARDING_OFFICER'') then');

  -- --- 2. A player account invitation actually links the player ------------------------------------
  -- Every guard the legacy path had, in the same order, but REFUSING rather than raising, because a
  -- raise rolls back the attempt record (D-S5-AUTO-2) and consumes nothing that should be consumed.
  v := replace(v,
E'  elsif v.kind in (''GUARDIAN'',''PLAYER_ACCOUNT'',''CLUB_REFERRAL'') then',
E'  elsif v.kind = ''PLAYER_ACCOUNT'' then
    -- One account is one person. Linking an account that is already somebody, or a player who
    -- already has a login, would merge two identities -- so both refuse, and neither spends the
    -- invitation, because the person can be told what is wrong and it can still be used after.
    if not internal.can(''player.account.link'', ''self'', null, null, null)
       or exists (select 1 from public.players pl where pl.user_id = v_actor)
       or exists (select 1 from public.players pl where pl.id = v.player_id and pl.user_id is not null) then
      perform internal.invitation_refused(v.id, ''player_account_link_unavailable'');
      return jsonb_build_object(''outcome'',''REFUSED'',''message'',v_generic);
    end if;
    update public.players set user_id = v_actor where id = v.player_id;
    v_result := jsonb_build_object(''outcome'',''ACCEPTED'',''kind'',v.kind,''club_id'',v.club_id,
                                   ''team_id'',v.team_id,''player_id'',v.player_id);

  elsif v.kind in (''GUARDIAN'',''CLUB_REFERRAL'') then');

  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

-- The refusal reason has to be a registered one, or the attempt record is the thing that fails.
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.invitation_redemption_attempts'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%outcome%'
                and pg_get_constraintdef(oid) not like '%player_account_link_unavailable%') then
    alter table public.invitation_redemption_attempts drop constraint if exists invitation_redemption_attempts_outcome_check;
    alter table public.invitation_redemption_attempts add constraint invitation_redemption_attempts_outcome_check
      check (outcome ~ '^[a-z_]+$');
  end if;
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v !~ 'capability_decision\(v.issued_by, v.issuer_capability, ''child''' then
    raise exception 'Slice 5: the issuer of a child-scoped invitation is re-checked in a scope it cannot hold.';
  end if;
  if v !~ 'update public.players set user_id = v_actor' then
    raise exception 'Slice 5: a player account invitation still does not link the player.';
  end if;
  if position('v.kind = ''SITE_ADMIN'' and not internal.person_is_established_adult' in v) = 0 then
    raise exception 'Slice 5: becoming a Site Admin is not gated on an established age.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='issue_invitation')
     !~ '''child'', null, null, p_player_id' then
    raise exception 'Slice 5: a child-scoped invitation still checks authority with a malformed scope.';
  end if;
  raise notice 'Slice 5: the declared outcomes are the applied outcomes';
end $$;
