-- =====================================================================================================
-- SLICE 5 (14/n) -- D-S5-AUTO-8: a CLUB_STAFF invitation carries a TEAM LIST
--
-- Phase 2 O.1 gives each kind a scope, and they are not the same shape:
--
--   CLUB_STAFF            CL (+ TE list)          <- club-scoped, with a LIST of teams
--   GUARDIAN              TE (+ optional player)  <- genuinely one team
--   TEAM_JOIN_CODE        TE                      <- genuinely one team
--   SITE_ADMIN / ACCOUNT_SETUP / SAFEGUARDING_OFFICER / PLAYER_ACCOUNT / CLUB_REFERRAL  <- no team
--
-- The scalar access_invitations.team_id keeps exactly the meaning Y.12 gives it: the ONE team a
-- genuinely team-scoped invitation is for. It is not overloaded to mean "the first of several". For
-- CLUB_STAFF it stays NULL and the authorised teams live in intended_outcome, which is the designed
-- extensible outcome representation -- so there is one source of truth for a staff invitation's team
-- scope, not two that can disagree.
--
-- Legacy `invitations` carries its team list in `invitation_teams`, so collapsing to a scalar would
-- have silently truncated every multi-team invitation to its first team on migration.
--
-- The list is SERVER-AUTHORED. It is validated and canonicalised at issue and read from the stored
-- invitation at redemption; a redemption payload naming teams is ignored, because there is nowhere in
-- the redemption signature to put one.
--
-- Each entry carries its OWN roles, as {"id": <team>, "roles": [...]}. That is not over-engineering:
-- the legacy People & Access form already lets a Club Admin invite somebody as Coach of one team and
-- Team Manager of another in a single invitation, and a flat list of team ids could only carry that
-- by giving every role to every team -- which is precisely the widening the migration must not do.
-- =====================================================================================================

-- One source of truth: a staff invitation's teams are in intended_outcome, never in the scalar.
alter table public.access_invitations drop constraint if exists access_invitations_club_staff_no_scalar_team;
alter table public.access_invitations add constraint access_invitations_club_staff_no_scalar_team
  check (kind <> 'CLUB_STAFF' or team_id is null);

-- Which roles are held at a team, taken from the canonical catalogue rather than a list written here.
create or replace function internal.role_is_team_scoped(p_role_key text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select rd.scope = 'TEAM' from public.role_definitions rd where rd.role_key = p_role_key), false);
$$;

drop function if exists public.issue_invitation(text,uuid,uuid,uuid,uuid,uuid,text,jsonb,integer);

create or replace function public.issue_invitation(
  p_kind text,
  p_club_id uuid default null,
  p_team_id uuid default null,
  p_player_id uuid default null,
  p_club_directory_id uuid default null,
  p_target_user_id uuid default null,
  p_email text default null,
  p_intended_outcome jsonb default '{}'::jsonb,
  p_max_uses integer default null,
  p_team_ids uuid[] default null,
  p_team_roles jsonb default null
) returns table (invitation_id uuid, token text, code text, expires_at timestamptz, already_existed boolean)
language plpgsql security definer set search_path = 'public' as $$
declare
  v_spec record;
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(nullif(p_email, '')));
  v_token text; v_code text;
  v_id uuid; v_existing uuid;
  v_roles text[]; v_team_roles text[]; v_teams jsonb;
  v_max int; v_club uuid := p_club_id; v_outcome jsonb;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_spec from internal.invitation_kind_spec(p_kind);
  if v_spec.issuer_capability is null then
    raise exception 'Unknown invitation kind.' using errcode = '22023';
  end if;

  -- The club a team or player belongs to is DERIVED, never taken from the caller.
  if p_team_id is not null then
    select t.club_id into v_club from public.teams t where t.id = p_team_id;
    if v_club is null then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  elsif p_player_id is not null then
    select ptm.team_id, t.club_id into p_team_id, v_club
      from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
     where ptm.player_id = p_player_id and ptm.status = 'active' limit 1;
  end if;

  if not (
      (v_spec.scope_type = 'site'  and internal.has_site_capability(v_spec.issuer_capability))
      or (v_spec.scope_type = 'club'  and v_club is not null and internal.can(v_spec.issuer_capability, 'club', v_club, null, null))
      or (v_spec.scope_type = 'team'  and v_club is not null and internal.can(v_spec.issuer_capability, 'team', v_club, p_team_id, null))
      or (v_spec.scope_type = 'child' and p_player_id is not null and internal.can(v_spec.issuer_capability, 'child', v_club, p_team_id, p_player_id))
      or (v_spec.site_alternative is not null and internal.has_site_capability(v_spec.site_alternative))
    ) then
    raise exception 'You are not authorised to send that invitation.' using errcode = '42501';
  end if;

  v_outcome := coalesce(p_intended_outcome, '{}'::jsonb);

  if p_kind = 'CLUB_STAFF' then
    -- Two ways in, one stored shape. p_team_ids is the ordinary case -- these teams get whichever of
    -- the invitation's roles are held at a team. p_team_roles is for the invitation that genuinely
    -- differs per team. Accepting both at once would be two answers to one question.
    if p_team_ids is not null and p_team_roles is not null then
      raise exception 'Name the teams once, either as a list or with their own roles.' using errcode = '22023';
    end if;

    v_roles := coalesce(array(select jsonb_array_elements_text(v_outcome->'roles')), '{}');

    -- A scalar team is one team, not a special case: the old single-team call shape canonicalises
    -- into the list, which is why the COLUMN can stay null and still lose nothing.
    if p_team_roles is null then
      -- Which of this invitation's roles are actually held at a team. If none are, the invitation is
      -- club-scoped and there is nothing to assign at a team.
      v_team_roles := coalesce(array(select r from unnest(v_roles) r where internal.role_is_team_scoped(r)), '{}'::text[]);

      v_teams := case when v_team_roles = '{}'::text[] then '[]'::jsonb else
        coalesce((select jsonb_agg(jsonb_build_object('id', t, 'roles', to_jsonb(v_team_roles)) order by t)
                    from (select distinct t from unnest(
                            coalesce(p_team_ids, '{}'::uuid[]) ||
                            case when p_team_id is null then '{}'::uuid[] else array[p_team_id] end) t) d),
                 '[]'::jsonb) end;

      -- A team NAMED explicitly must end up with something. The scalar p_team_id is different: for
      -- CLUB_STAFF it is context from the old call shape, not an assignment (Y.12), so it is dropped
      -- rather than turned into an error.
      if coalesce(array_length(p_team_ids, 1), 0) > 0 and v_teams = '[]'::jsonb then
        raise exception 'That invitation names teams, but none of its roles are held at a team.'
          using errcode = '22023';
      end if;
    else
      v_teams := coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'roles', e.roles) order by e.id)
                             from (select (t->>'id')::uuid as id,
                                          jsonb_agg(distinct r order by r) as roles
                                     from jsonb_array_elements(p_team_roles) t,
                                          lateral jsonb_array_elements_text(t->'roles') r
                                    group by 1) e),
                          '[]'::jsonb);
      -- Every per-team role is part of what this invitation carries, so the ceiling, the age gate and
      -- the preview all see the whole picture rather than only the club-wide part.
      v_roles := coalesce((select array_agg(distinct r) from (
                             select unnest(v_roles) as r
                             union select jsonb_array_elements_text(t->'roles') from jsonb_array_elements(v_teams) t) u),
                          '{}');
    end if;

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

    -- A null in the list is checked FIRST and separately, because a null can never be caught by "does
    -- this team exist": the existence lookup returns no row, and a `select ... into` over no row
    -- leaves the variable null, which reads exactly like "nothing was wrong". An unnoticed null would
    -- then be stored as an authorised team.
    if exists (select 1 from jsonb_array_elements(v_teams) t where (t->>'id') is null) then
      raise exception 'That invitation names a team that is not a team.' using errcode = '22023';
    end if;

    -- Every team must exist AND belong to this invitation's club. A team from another club in the
    -- payload is the attack this rejects: it would otherwise hand a role inside somebody else's club.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>'id')::uuid and te.club_id = v_club and te.active)) then
      raise exception 'That invitation names a team which is not an active team of this club.'
        using errcode = '42501';
    end if;

    -- A role held at a CLUB cannot be granted at a team, and a team entry with no roles at all is an
    -- assignment that would do nothing -- both mean the caller and the server disagree about what
    -- this invitation is, which is not something to resolve by guessing.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where jsonb_array_length(t->'roles') = 0
                   or exists (select 1 from jsonb_array_elements_text(t->'roles') r
                               where not internal.role_is_team_scoped(r))) then
      raise exception 'A team in that invitation has no role, or a role that is not held at a team.'
        using errcode = '22023';
    end if;

    -- A Coach with nowhere to coach is not a smaller invitation, it is an incoherent one.
    if exists (select 1 from unnest(v_roles) r
                where internal.role_is_team_scoped(r)
                  and not exists (select 1 from jsonb_array_elements(v_teams) t,
                                       lateral jsonb_array_elements_text(t->'roles') tr where tr = r)) then
      raise exception 'A Coach or Team Manager invitation must name at least one team.' using errcode = '22023';
    end if;

    v_outcome := v_outcome || jsonb_build_object('roles', to_jsonb(v_roles), 'teams', v_teams);
    p_team_id := null;   -- Y.12: the scalar is for genuinely single-team kinds only
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
    v_outcome, v_spec.issuer_capability, v_actor, v_spec.issued_level,
    internal.invitation_token_hash(v_token), internal.invitation_code_hash(v_code),
    right(replace(v_code, '-', ''), 2), v_max, now() + v_spec.lifetime)
  returning id into v_id;

  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.issued', v_actor, v_club, p_team_id, 'invitation issued',
          jsonb_build_object('invitation_id', v_id, 'kind', p_kind,
                             'teams', coalesce(jsonb_array_length(v_outcome->'teams'), 0)));

  return query select v_id, v_token, v_code, (now() + v_spec.lifetime), false;
end $$;

revoke all on function public.issue_invitation(text,uuid,uuid,uuid,uuid,uuid,text,jsonb,integer,uuid[],jsonb) from public, anon;
grant execute on function public.issue_invitation(text,uuid,uuid,uuid,uuid,uuid,text,jsonb,integer,uuid[],jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Redemption applies the WHOLE envelope, or none of it.
--
-- Everything the outcome needs is validated before the invitation is consumed, so a staff invitation
-- for three teams never leaves somebody holding one of them and a spent invitation.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v ~ 'role_is_team_scoped' then return; end if;   -- already carries the team list

  -- 1. The complete intended outcome is validated BEFORE the first write of the outcome. The club
  --    membership used to be created first, which meant a staff invitation naming a team that had
  --    since been retired left the person an ordinary member of a club they had not joined, from a
  --    redemption that reported REFUSED.
  v := replace(v,
E'  if v.kind = ''CLUB_STAFF'' then
    select m.id into v_membership from public.club_memberships m',
E'  if v.kind = ''CLUB_STAFF'' then
    -- The authorised teams come from the STORED invitation. Redemption takes no team argument, so
    -- there is nothing for a browser to substitute.
    v_teams := coalesce(v.intended_outcome->''teams'', ''[]''::jsonb);

    -- Validated here, before ANY part of the outcome is written: every team must still be an active
    -- team of this club, or the invitation stays unspent and the person is left exactly as they were.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>''id'')::uuid and te.club_id = v.club_id and te.active)) then
      perform internal.invitation_refused(v.id, ''scope_gone'');
      return jsonb_build_object(''outcome'',''REFUSED'',''message'',v_generic);
    end if;

    select m.id into v_membership from public.club_memberships m');

  -- 2. A club-scoped role is granted once; a team's own roles are granted at that team.
  v := replace(v,
E'    foreach v_role in array v_roles loop
      perform internal.grant_role(v_membership, v_role, v.team_id, ''INVITATION'',
                                  ''accepted invitation '' || v.id::text);
    end loop;
    v_result := jsonb_build_object(''outcome'',''MEMBERSHIP_ACTIVE'',''membership_id'',v_membership,''roles'',to_jsonb(v_roles));',
E'    foreach v_role in array v_roles loop
      if not internal.role_is_team_scoped(v_role) then
        perform internal.grant_role(v_membership, v_role, null, ''INVITATION'',
                                    ''accepted invitation '' || v.id::text);
      end if;
    end loop;
    for v_team, v_team_roles in
      select (t->>''id'')::uuid, array(select jsonb_array_elements_text(t->''roles''))
        from jsonb_array_elements(v_teams) t
    loop
      foreach v_role in array v_team_roles loop
        perform internal.grant_role(v_membership, v_role, v_team, ''INVITATION'',
                                    ''accepted invitation '' || v.id::text);
      end loop;
    end loop;
    v_result := jsonb_build_object(''outcome'',''MEMBERSHIP_ACTIVE'',''membership_id'',v_membership,
                                   ''roles'',to_jsonb(v_roles),''teams'',v_teams);');

  v := replace(v, '  v_existing uuid;', E'  v_existing uuid;\n  v_teams jsonb;\n  v_team uuid;\n  v_team_roles text[];');

  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  if v !~ 'intended_outcome->''teams''' then
    raise exception 'Slice 5: redemption does not read the authorised team list from the invitation.';
  end if;
  if v !~ 'role_is_team_scoped' then
    raise exception 'Slice 5: redemption does not distinguish a team-scoped role from a club-scoped one.';
  end if;
  if position('scope_gone'', v.intended_outcome' in v) = 0
     and position('invitation_refused(v.id, ''scope_gone'')' in v) > position('insert into public.club_memberships' in v) then
    raise exception 'Slice 5: the team list is validated AFTER the membership is written -- a refusal would leave a partial outcome.';
  end if;
  raise notice 'Slice 5: a staff invitation now carries, and applies, its whole team list';
end $$;
