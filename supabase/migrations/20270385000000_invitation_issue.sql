-- =====================================================================================================
-- SLICE 5 (4/n) -- issuing, previewing, revoking and resending (Phase 2 O.1, O.2)
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- The kind table. Issuer capability, the scope it is asked at, and how long the invitation lives, all
-- from O.1 -- so a new kind is a row here rather than a new branch scattered through the code.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.invitation_kind_spec(p_kind text)
returns table (issuer_capability text, scope_type text, site_alternative text, lifetime interval, issued_level text)
language sql immutable set search_path = '' as $$
  select t.issuer_capability, t.scope_type, t.site_alternative, t.lifetime, t.issued_level from (values
    ('SITE_ADMIN',           'site.admins.manage',            'site',  null,                      interval '72 hours', 'SITE'),
    ('ACCOUNT_SETUP',        'site.users.create',             'site',  'site.invitations.manage', interval '72 hours', 'SITE'),
    ('CLUB_STAFF',           'people.invitation.create',      'club',  'site.memberships.manage', interval '7 days',   'CLUB'),
    ('SAFEGUARDING_OFFICER', 'safeguarding.officer.nominate', 'club',  null,                      interval '14 days',  'CLUB'),
    ('GUARDIAN',             'family.invitation.create',      'team',  null,                      interval '14 days',  'TEAM'),
    ('PLAYER_ACCOUNT',       'player.account.invite',         'child', null,                      interval '14 days',  'GUARDIAN'),
    ('TEAM_JOIN_CODE',       'team.join_code.manage',         'team',  null,                      interval '30 days',  'TEAM'),
    ('CLUB_REFERRAL',        'club.referrals.manage',         'club',  null,                      interval '14 days',  'CLUB')
  ) as t(kind, issuer_capability, scope_type, site_alternative, lifetime, issued_level)
  where t.kind = p_kind;
$$;

-- What a CLUB_STAFF invitation is allowed to produce (O.1). TEAM_ADMINISTRATION is deliberately
-- absent: O.1 says "TA only by CA", which is a delegation the Club Admin makes afterwards, not
-- something an invitation may carry on its own.
create or replace function internal.invitation_club_staff_ceiling()
returns text[] language sql immutable set search_path = '' as $$
  select array['CLUB_ADMIN','FIXTURES_SECRETARY','VOLUNTEER','COACH','TEAM_MANAGER']::text[];
$$;

-- ---------------------------------------------------------------------------------------------------
-- issue_invitation
-- ---------------------------------------------------------------------------------------------------
create or replace function public.issue_invitation(
  p_kind text,
  p_club_id uuid default null,
  p_team_id uuid default null,
  p_player_id uuid default null,
  p_club_directory_id uuid default null,
  p_target_user_id uuid default null,
  p_email text default null,
  p_intended_outcome jsonb default '{}'::jsonb,
  p_max_uses integer default null
) returns table (invitation_id uuid, token text, code text, expires_at timestamptz, already_existed boolean)
language plpgsql security definer set search_path = 'public' as $$
declare
  v_spec record;
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(nullif(p_email, '')));
  v_token text; v_code text;
  v_id uuid; v_existing uuid;
  v_roles text[];
  v_max int;
  v_club uuid := p_club_id;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_spec from internal.invitation_kind_spec(p_kind);
  if v_spec.issuer_capability is null then
    raise exception 'Unknown invitation kind.' using errcode = '22023';
  end if;

  -- The club a team or player belongs to is derived, never taken from the caller: a payload that
  -- names one club and a team in another must not widen anything.
  if p_team_id is not null then
    select t.club_id into v_club from public.teams t where t.id = p_team_id;
    if v_club is null then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  elsif p_player_id is not null then
    select ptm.team_id, t.club_id into p_team_id, v_club
      from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
     where ptm.player_id = p_player_id and ptm.status = 'active' limit 1;
  end if;

  -- Authority, asked through the canonical resolver at the scope O.1 names.
  if not (
      (v_spec.scope_type = 'site'  and internal.has_site_capability(v_spec.issuer_capability))
      or (v_spec.scope_type = 'club'  and v_club is not null and internal.can(v_spec.issuer_capability, 'club', v_club, null, null))
      or (v_spec.scope_type = 'team'  and v_club is not null and internal.can(v_spec.issuer_capability, 'team', v_club, p_team_id, null))
      or (v_spec.scope_type = 'child' and p_player_id is not null and internal.can(v_spec.issuer_capability, 'child', v_club, p_team_id, p_player_id))
      or (v_spec.site_alternative is not null and internal.has_site_capability(v_spec.site_alternative))
    ) then
    raise exception 'You are not authorised to send that invitation.' using errcode = '42501';
  end if;

  -- The ceiling, checked at issue as well as at redemption. An issuer may not write an outcome they
  -- could not themselves grant.
  if p_kind = 'CLUB_STAFF' then
    v_roles := coalesce(array(select jsonb_array_elements_text(p_intended_outcome->'roles')), '{}');
    if v_roles = '{}' then
      raise exception 'A staff invitation must say which roles it is for.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_roles) r where r <> all (internal.invitation_club_staff_ceiling())) then
      raise exception 'That invitation asks for a role it is not allowed to carry.' using errcode = '42501';
    end if;
    if 'CLUB_ADMIN' = any (v_roles)
       and not (internal.can('people.invitation.create', 'club', v_club, null, null)
                or internal.has_site_capability('site.memberships.manage')) then
      raise exception 'You are not authorised to invite a Club Admin.' using errcode = '42501';
    end if;
  end if;

  if p_kind = 'TEAM_JOIN_CODE' then
    v_max := greatest(1, least(coalesce(p_max_uses, 50), 500));
    v_email := null;
  else
    v_max := 1;
    if v_email is null then
      raise exception 'That invitation kind needs an email address.' using errcode = '22023';
    end if;
  end if;

  -- O.2 "Uniqueness": a live personal invitation for the same person and scope is returned rather
  -- than duplicated, so an impatient administrator does not create two working secrets.
  if v_email is not null then
    select i.id into v_existing from public.access_invitations i
     where i.kind = p_kind and i.state = 'ISSUED' and i.invited_email_normalised = v_email
       and i.scope_key = coalesce(p_player_id::text, p_team_id::text, v_club::text, p_club_directory_id::text, p_target_user_id::text, 'SITE');
    if v_existing is not null then
      return query select v_existing, null::text, null::text,
                          (select a.expires_at from public.access_invitations a where a.id = v_existing), true;
      return;
    end if;
  end if;

  v_token := internal.new_invitation_token();
  v_code  := internal.new_invitation_code();

  insert into public.access_invitations (
    kind, club_id, team_id, player_id, club_directory_id, target_user_id, invited_email_normalised,
    intended_outcome, issuer_capability, issued_by, issued_level,
    token_sha256, code_hmac, code_hint, max_uses, expires_at)
  values (
    p_kind, v_club, p_team_id, p_player_id, p_club_directory_id, p_target_user_id, v_email,
    coalesce(p_intended_outcome, '{}'::jsonb), v_spec.issuer_capability, v_actor, v_spec.issued_level,
    internal.invitation_token_hash(v_token), internal.invitation_code_hash(v_code),
    right(replace(v_code, '-', ''), 2), v_max, now() + v_spec.lifetime)
  returning id into v_id;

  -- The event records that an invitation was issued. It must never record what the secret was.
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.issued', v_actor, v_club, p_team_id, 'invitation issued',
          jsonb_build_object('invitation_id', v_id, 'kind', p_kind, 'code_hint', right(replace(v_code,'-',''),2)));

  return query select v_id, v_token, v_code, (now() + v_spec.lifetime), false;
end $$;

revoke all on function public.issue_invitation(text,uuid,uuid,uuid,uuid,uuid,text,jsonb,integer) from public, anon;
grant execute on function public.issue_invitation(text,uuid,uuid,uuid,uuid,uuid,text,jsonb,integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- preview_invitation -- anon-executable, and deliberately almost empty (O.1 "Previews").
--
-- It exists so somebody holding a link can see what they have been asked to join before creating an
-- account. It must never confirm WHO was invited: no email, no child's name, no ids. A person who
-- guesses a code learns only that some club invited somebody, which is what they already assumed.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.preview_invitation(p_token text default null, p_code text default null)
returns table (kind text, scope_label text, inviter_label text, expires_at timestamptz, state text)
language plpgsql stable security definer set search_path = 'public' as $$
declare v record;
begin
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;
  select i.* into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1;
  if v.id is null then
    return;  -- an empty result, not an error: a probe learns nothing from the shape of the answer
  end if;
  return query
    select v.kind,
           coalesce((select t.display_name || ' at ' || d.name
                       from public.teams t join public.clubs c on c.id = t.club_id
                       join public.club_directory d on d.id = c.directory_id where t.id = v.team_id),
                    (select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id),
                    (select d.name from public.club_directory d where d.id = v.club_directory_id),
                    'Ovalball'),
           coalesce((select p.first_name || ' ' || p.surname from public.profiles p where p.id = v.issued_by), 'Ovalball'),
           v.expires_at,
           case when v.state <> 'ISSUED' then lower(v.state)
                when v.expires_at <= now() then 'expired'
                when v.use_count >= v.max_uses then 'used'
                else 'usable' end;
end $$;

revoke all on function public.preview_invitation(text,text) from public;
grant execute on function public.preview_invitation(text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- revoke_invitation / resend_invitation / the expiry job
-- ---------------------------------------------------------------------------------------------------
create or replace function public.revoke_invitation(p_invitation_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v record; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v from public.access_invitations where id = p_invitation_id for update;
  if v.id is null then raise exception 'Invitation not found.' using errcode = 'P0002'; end if;
  if not internal.can_administer_invitation(v.id) then
    raise exception 'You are not authorised to revoke that invitation.' using errcode = '42501';
  end if;
  if v.state <> 'ISSUED' then
    raise exception 'That invitation is already %.', lower(v.state) using errcode = 'P0001';
  end if;
  update public.access_invitations
     set state = 'REVOKED', revoked_by = v_actor, revoked_at = now(),
         revocation_reason = internal.require_reason(p_reason, true), updated_at = now()
   where id = p_invitation_id;
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.revoked', v_actor, v.club_id, v.team_id, p_reason,
          jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
end $$;

create or replace function internal.can_administer_invitation(p_invitation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_invitations i
    where i.id = p_invitation_id
      and (internal.has_site_capability('site.invitations.manage')
           or (i.club_id is not null and internal.can(i.issuer_capability, 'club', i.club_id, null, null))
           or (i.team_id is not null and internal.can(i.issuer_capability, 'team', i.club_id, i.team_id, null))));
$$;

create or replace function public.resend_invitation(p_invitation_id uuid)
returns table (token text, code text, expires_at timestamptz)
language plpgsql security definer set search_path = 'public' as $$
declare v record; v_token text; v_code text; v_spec record;
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v from public.access_invitations where id = p_invitation_id for update;
  if v.id is null then raise exception 'Invitation not found.' using errcode = 'P0002'; end if;
  if not internal.can_administer_invitation(v.id) then
    raise exception 'You are not authorised to resend that invitation.' using errcode = '42501';
  end if;
  if v.state <> 'ISSUED' then
    raise exception 'That invitation is already %.', lower(v.state) using errcode = 'P0001';
  end if;
  select * into v_spec from internal.invitation_kind_spec(v.kind);
  v_token := internal.new_invitation_token();
  v_code  := internal.new_invitation_code();
  -- Rotating BOTH secrets is the point: the old link stops working the moment this returns, so a
  -- resend is also the remedy for a link sent to the wrong address.
  update public.access_invitations
     set token_sha256 = internal.invitation_token_hash(v_token),
         code_hmac = internal.invitation_code_hash(v_code),
         code_hint = right(replace(v_code,'-',''),2),
         resend_count = resend_count + 1, last_sent_at = now(),
         expires_at = now() + v_spec.lifetime, updated_at = now()
   where id = p_invitation_id;
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.resent', auth.uid(), v.club_id, v.team_id, 'invitation resent',
          jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
  return query select v_token, v_code, (now() + v_spec.lifetime);
end $$;

revoke all on function public.revoke_invitation(uuid,text) from public, anon;
revoke all on function public.resend_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid,text) to authenticated;
grant execute on function public.resend_invitation(uuid) to authenticated;

-- The expiry job. O.2 step 5 needs the terminal state PERSISTED before a refusal, because a raise
-- rolls back anything the same transaction wrote (the M-5 lesson).
create or replace function internal.expire_due_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.access_invitations
     set state = 'EXPIRED', updated_at = now()
   where state = 'ISSUED' and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function internal.expire_due_invitations() from public, anon, authenticated;
