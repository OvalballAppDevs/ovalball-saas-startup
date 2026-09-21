-- =====================================================================================================
-- CONVERGENCE STEP 16 -- COMPETITION / GOVERNING CLOSURE
--
-- Steps 14-15 built a governing body that could run a competition. This closes the relationships around
-- it, and the archaeology (docs/product/CONVERGENCE_STEP_16_ARCHAEOLOGY.md) settled four of the nine
-- requested items without writing any code:
--
--   * THE CAPABILITY SCOPE IS CALLED `organisation`, and the engine already says so.
--     internal.capability_decision refuses it at rule 1 with SCOPE_NOT_IMPLEMENTED, and
--     public.capabilities.valid_scopes already permits the word. It stays unimplemented -- see the
--     guard at the foot of this file, which makes sure nobody registers a capability the engine can
--     never allow, and that governing authority keeps exactly ONE resolver chain.
--
--   * AFFILIATION IS PUBLISHED REFERENCE DATA, not a workflow. club_directory.constituent_body holds
--     the county's published NAME ("Lancashire RFU") beside the resolved FK, sourced from the county
--     unions' own club lists. Which county a club is in is a fact the RFU publishes, so there is no
--     lifecycle to build and this migration adds none.
--
--   * COMPETITION ENTRY HAS NO CLUB-SIDE CONSENT BY DESIGN. competition_participants.status is
--     ('entered','withdrawn') and only the organiser writes it; the club's canonical act is answering
--     each MATCH through competition_match_verifications. So no status vocabulary is invented here --
--     what was missing was a club-side READ, and that is what is added.
--
--   * THE DISPENSATION CHAIN IS UNTOUCHED AGAIN. Its governing-body stage is the club attesting to a
--     certificate it holds off-platform. There is not even a column in which a native Ovalball body
--     decision could be recorded, and existing rows' governing_body_decided_by points at CLUB
--     administrators. Reinterpreting them would falsify them. Owner decision, not a migration.
--
-- WHAT THIS MIGRATION ACTUALLY DOES:
--   1. one invitation KIND, through the canonical invitation architecture -- no second system
--   2. removes the account-existence oracle by leaving one path
--   3. fixes a real defect: a body organiser was never told what its own clubs answered
--   4. two read models: the body's competition results, and the club's own competition entries
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. AN INVITATION CAN BE FOR AN ORGANISATION
--
-- One nullable scope column beside the five that already exist, and the generated scope_key learns
-- about it so the live-uniqueness index keeps meaning "one open invitation per person per scope".
-- -----------------------------------------------------------------------------------------------------
alter table public.access_invitations
  add column if not exists constituent_body_id uuid references public.constituent_bodies(id) on delete cascade;

create index if not exists access_invitations_body_state_idx
  on public.access_invitations (constituent_body_id, state) where constituent_body_id is not null;

comment on column public.access_invitations.constituent_body_id is
  'The governing body a GOVERNING_BODY_OFFICER invitation is for. One more nullable scope column beside '
  'club_id, team_id, player_id and club_directory_id -- an organisation is not inside a club, so it is '
  'its own scope rather than a club with a flag.';

-- The generated column cannot be altered in place, and the live-uniqueness index depends on it.
drop index if exists access_invitations_personal_live_idx;
alter table public.access_invitations drop column if exists scope_key;
alter table public.access_invitations
  add column scope_key text generated always as (
    coalesce(player_id::text, team_id::text, club_id::text, club_directory_id::text,
             constituent_body_id::text, target_user_id::text, 'SITE')) stored;
create unique index access_invitations_personal_live_idx
  on public.access_invitations (kind, scope_key, invited_email_normalised)
  where state = 'ISSUED' and invited_email_normalised is not null;

-- The kind, and the rule that it is a personal invitation bound to an address.
alter table public.access_invitations drop constraint if exists access_invitations_kind_check;
alter table public.access_invitations add constraint access_invitations_kind_check check (
  kind = any (array['SITE_ADMIN','ACCOUNT_SETUP','CLUB_STAFF','SAFEGUARDING_OFFICER','GUARDIAN',
                    'PLAYER_ACCOUNT','TEAM_JOIN_CODE','CLUB_REFERRAL','GOVERNING_BODY_OFFICER']));

alter table public.access_invitations drop constraint if exists access_invitations_personal_email;
alter table public.access_invitations add constraint access_invitations_personal_email check (
  (kind = any (array['SITE_ADMIN','ACCOUNT_SETUP','CLUB_STAFF','SAFEGUARDING_OFFICER','GUARDIAN',
                     'PLAYER_ACCOUNT','CLUB_REFERRAL','GOVERNING_BODY_OFFICER'])
   and invited_email_normalised is not null)
  or (kind = 'TEAM_JOIN_CODE' and invited_email_normalised is null and team_id is not null));

-- AN ORGANISATION IS ITS OWN ISSUING LEVEL.
--
-- `issued_level` records WHO issued an invitation, and redemption re-checks the issuer's authority
-- against it. Filing a county officer's invitation as 'SITE' would have claimed they were a Site Admin —
-- and the first run of the Step 16 suite proved that is not cosmetic: redemption's step 8 refused the
-- invitation with `issuer_authority_lost`, because the issuer is not in `site_admins`.
--
-- Nothing outside internal.invitation_kind_spec, public.issue_invitation and public.redeem_invitation
-- reads this column, so adding a value is contained.
alter table public.access_invitations drop constraint if exists access_invitations_issued_level_check;
alter table public.access_invitations add constraint access_invitations_issued_level_check check (
  issued_level = any (array['SITE','CLUB','TEAM','GUARDIAN','SYSTEM','ORGANISATION']));

-- AND IT MUST NAME THE ORGANISATION. A governing invitation with no body would redeem into nothing.
alter table public.access_invitations drop constraint if exists access_invitations_body_scope;
alter table public.access_invitations add constraint access_invitations_body_scope check (
  (kind = 'GOVERNING_BODY_OFFICER') = (constituent_body_id is not null));

-- -----------------------------------------------------------------------------------------------------
-- 1b. THE CAPABILITY THE INVITATION NAMES -- REQUIRED, not optional
--
-- `access_invitations.issuer_capability` is a FOREIGN KEY into public.capabilities, so an invitation
-- kind cannot name an authority the catalogue does not hold. Step 14 chose to register nothing and rely
-- on the dedicated predicates; the invitation architecture settles it, and the catalogue is the right
-- place for the vocabulary anyway.
--
-- `valid_scopes = ARRAY['organisation']` is the honest declaration: that is the scope this authority is
-- about, the word is already reserved in this table's own CHECK constraint, and
-- internal.capability_decision still refuses it at rule 1 with SCOPE_NOT_IMPLEMENTED.
--
-- SO THE ONE HAZARD IS CALLING THE ENGINE WITH IT -- `internal.can('governing.access.manage',
-- 'organisation', ...)` would return a silent false forever. The guard at the foot of this file asserts
-- that nothing does, which is a stronger check than refusing to register the row: the row documents the
-- vocabulary, and the guard stops the trap.
--
-- NOT delegable, NOT inheriting to a team, and grant_level 'N': this authority is not something a club
-- or a team can hand out, and it is not a site key, so it carries no site add-on.
-- -----------------------------------------------------------------------------------------------------
insert into public.capabilities (
  key, label, description, category, valid_scopes, domain, resource, action,
  inherits_to_team, grant_level, revoke_level, delegable, aal,
  safeguarding_sensitive, minor_prohibited, impersonation_blocked, status, design_section)
values (
  'governing.access.manage',
  'Manage Organisation Access',
  'Invite somebody to hold a role at a governing body, and remove their access. Resolved by '
  || 'internal.can_manage_body over constituent_body_roles: the organisation capability scope is '
  || 'reserved in this table and deliberately not implemented in internal.capability_decision, so this '
  || 'key is the NAME of the authority and never an argument to internal.can.',
  'permissions', array['organisation'], 'governing', 'access', 'manage',
  false, 'N', 'N', false, 'R',
  false, true, true, 'ACTIVE', 'Convergence Step 16')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------------------------------
-- 2. THE KIND'S OWN SPEC
--
-- `scope_type = 'organisation'` is the canonical word, already reserved in
-- public.capabilities.valid_scopes. `issuer_capability` NAMES the authority so the vocabulary has one
-- home; it is resolved by internal.can_manage_body until the organisation scope is implemented in the
-- engine, and issue_invitation says so at the line where it happens. The lifetime matches CLUB_STAFF,
-- because this is the same kind of act: giving a volunteer access to an organisation.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.invitation_kind_spec(p_kind text)
returns TABLE(issuer_capability text, scope_type text, site_alternative text, lifetime interval, issued_level text)
language sql immutable set search_path to '' as $$
  select t.issuer_capability, t.scope_type, t.site_alternative, t.lifetime, t.issued_level from (values
    ('SITE_ADMIN',            'site.admins.manage',            'site',         null,                      interval '72 hours', 'SITE'),
    ('ACCOUNT_SETUP',         'site.users.create',             'site',         'site.invitations.manage', interval '72 hours', 'SITE'),
    ('CLUB_STAFF',            'people.invitation.create',      'club',         'site.memberships.manage', interval '7 days',   'CLUB'),
    ('SAFEGUARDING_OFFICER',  'safeguarding.officer.nominate', 'club',         null,                      interval '14 days',  'CLUB'),
    ('GUARDIAN',              'family.invitation.create',      'team',         null,                      interval '14 days',  'TEAM'),
    ('PLAYER_ACCOUNT',        'player.account.invite',         'child',        null,                      interval '14 days',  'GUARDIAN'),
    ('TEAM_JOIN_CODE',        'team.join_code.manage',         'team',         null,                      interval '30 days',  'TEAM'),
    ('CLUB_REFERRAL',         'club.referrals.manage',         'club',         null,                      interval '14 days',  'CLUB'),
    ('GOVERNING_BODY_OFFICER','governing.access.manage',       'organisation', 'site.memberships.manage', interval '7 days',   'ORGANISATION')
  ) as t(kind, issuer_capability, scope_type, site_alternative, lifetime, issued_level)
  where t.kind = p_kind;
$$;
-- -----------------------------------------------------------------------------------------------------
-- 3. THE CANONICAL ISSUER LEARNS THE ORGANISATION SCOPE
-- -----------------------------------------------------------------------------------------------------
create or replace function public.issue_invitation(p_kind text, p_club_id uuid DEFAULT NULL::uuid, p_team_id uuid DEFAULT NULL::uuid, p_player_id uuid DEFAULT NULL::uuid, p_club_directory_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text, p_intended_outcome jsonb DEFAULT '{}'::jsonb, p_max_uses integer DEFAULT NULL::integer, p_team_ids uuid[] DEFAULT NULL::uuid[], p_team_roles jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(invitation_id uuid, token text, code text, expires_at timestamp with time zone, already_existed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_spec record;
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(nullif(p_email, '')));
  v_token text; v_code text;
  v_id uuid; v_existing uuid;
  v_roles text[]; v_team_roles text[]; v_teams jsonb;
  v_max int; v_club uuid := p_club_id; v_outcome jsonb;
  v_body uuid;   -- CONVERGENCE STEP 16: the organisation a GOVERNING_BODY_OFFICER invitation is for.
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

  -- CONVERGENCE STEP 16 -- THE ORGANISATION AN INVITATION IS FOR.
  --
  -- It travels in p_intended_outcome rather than a new parameter, and that is deliberate: adding
  -- p_body_id would create an overload that makes every existing two-or-three-argument call
  -- ambiguous, and dropping this function to re-add it would put a contract surface at risk for no
  -- product gain. For this kind the organisation genuinely IS part of the intended outcome -- "become
  -- Competitions Officer at this body" -- and it is validated here and written to its own COLUMN, so
  -- the scope is a real column for scope_key, the live-uniqueness index and RLS.
  if p_kind = 'GOVERNING_BODY_OFFICER' then
    v_body := nullif(p_intended_outcome->>'constituent_body_id', '')::uuid;
    if v_body is null then
      raise exception 'A governing body invitation must say which organisation it is for.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.constituent_bodies b where b.id = v_body and b.active) then
      raise exception 'Governing body not found.' using errcode = 'P0002';
    end if;
    if coalesce(p_intended_outcome->>'role_key', '') not in ('BODY_ADMIN', 'BODY_COMPETITIONS', 'BODY_VIEWER') then
      raise exception 'A governing body invitation must say which role it is for.' using errcode = '22023';
    end if;
    -- A club or a team alongside makes the scope malformed: an organisation is not inside a club.
    if p_club_id is not null or p_team_id is not null or p_player_id is not null then
      raise exception 'A governing body invitation is for an organisation, not a club or a team.' using errcode = '22023';
    end if;
  end if;

  if not (
      (v_spec.scope_type = 'site'  and internal.has_site_capability(v_spec.issuer_capability))
      or (v_spec.scope_type = 'club'  and v_club is not null and internal.can(v_spec.issuer_capability, 'club', v_club, null, null))
      or (v_spec.scope_type = 'team'  and v_club is not null and internal.can(v_spec.issuer_capability, 'team', v_club, p_team_id, null))
      -- Only the player: a club or a team alongside makes the scope malformed, because child scope
      -- is the canonical answer to "may I act for THIS CHILD" and nothing else narrows it.
      or (v_spec.scope_type = 'child' and p_player_id is not null and internal.can(v_spec.issuer_capability, 'child', null, null, p_player_id))
      -- ORGANISATION SCOPE IS RESOLVED BY THE DEDICATED PREDICATE, not by internal.can.
      --
      -- `organisation` is the canonical scope name -- it is already reserved in
      -- public.capabilities.valid_scopes and already named in internal.capability_decision, which
      -- refuses it at rule 1 with SCOPE_NOT_IMPLEMENTED. Until that scope is implemented (a
      -- whole-platform change to the most-called function in the platform), governing authority is
      -- the one relationship chain internal.body_role -> can_manage_body. The spec row NAMES the
      -- authority so the vocabulary has one home; this line is where it resolves.
      or (v_spec.scope_type = 'organisation' and v_body is not null and internal.can_manage_body(v_body))
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
       and i.scope_key = coalesce(p_player_id::text, p_team_id::text, v_club::text, p_club_directory_id::text,
                                  v_body::text, p_target_user_id::text, 'SITE');
    if v_existing is not null then
      return query select v_existing, null::text, null::text,
                          (select a.expires_at from public.access_invitations a where a.id = v_existing), true;
      return;
    end if;
  end if;

  v_token := internal.new_invitation_token();
  v_code  := internal.new_invitation_code();

  insert into public.access_invitations (
    kind, club_id, team_id, player_id, club_directory_id, constituent_body_id, target_user_id, invited_email_normalised,
    intended_outcome, issuer_capability, issued_by, issued_level,
    token_sha256, code_hmac, code_hint, max_uses, expires_at)
  values (
    p_kind, v_club, p_team_id, p_player_id, p_club_directory_id, v_body, p_target_user_id, v_email,
    v_outcome, v_spec.issuer_capability, v_actor, v_spec.issued_level,
    internal.invitation_token_hash(v_token), internal.invitation_code_hash(v_code),
    right(replace(v_code, '-', ''), 2), v_max, now() + v_spec.lifetime)
  returning id into v_id;

  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.issued', v_actor, v_club, p_team_id, 'invitation issued',
          jsonb_build_object('invitation_id', v_id, 'kind', p_kind,
                             'teams', coalesce(jsonb_array_length(v_outcome->'teams'), 0)));

  return query select v_id, v_token, v_code, (now() + v_spec.lifetime), false;
end $$;create or replace function public.redeem_invitation(p_token text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
end $$;create or replace function public.preview_invitation(p_token text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS TABLE(kind text, scope_label text, inviter_label text, expires_at timestamp with time zone, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
                    -- CONVERGENCE STEP 16: an organisation invitation previews as the organisation,
                    -- not as "Ovalball" -- the person is being asked to act for a named county.
                    (select b.canonical_name from public.constituent_bodies b where b.id = v.constituent_body_id),
                    'Ovalball'),
           coalesce((select p.first_name || ' ' || p.surname from public.profiles p where p.id = v.issued_by), 'Ovalball'),
           v.expires_at,
           case when v.state <> 'ISSUED' then lower(v.state)
                when v.expires_at <= now() then 'expired'
                when v.use_count >= v.max_uses then 'used'
                else 'usable' end;
end $$;
-- -----------------------------------------------------------------------------------------------------
-- 4. REVOKING AND RESENDING A BODY INVITATION -- by reuse, not by a new RPC
--
-- public.revoke_invitation and public.resend_invitation both authorise through
-- internal.can_administer_invitation, so one disjunct here gives a body administrator both, with the
-- secret rotation, the security_events row and the terminal-state rules already written. A dedicated
-- revoke_governing_body_invitation would have been a second, weaker copy of all of it.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.can_administer_invitation(p_invitation_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.access_invitations i
    where i.id = p_invitation_id
      and (internal.has_site_capability('site.invitations.manage')
           or (i.club_id is not null and internal.can(i.issuer_capability, 'club', i.club_id, null, null))
           or (i.team_id is not null and internal.can(i.issuer_capability, 'team', i.club_id, i.team_id, null))
           -- CONVERGENCE STEP 16: the organisation's own administrator. coalesce is not decoration --
           -- can_manage_body already answers a definite boolean, and `exists` never yields null, so a
           -- caller with no relationship is refused rather than slipping through a null.
           or (i.constituent_body_id is not null and internal.can_manage_body(i.constituent_body_id))));
$$;

-- -----------------------------------------------------------------------------------------------------
-- 5. ISSUING ONE, AND THE END OF THE ACCOUNT-EXISTENCE ORACLE
--
-- Step 15 granted a role to an address that already had an Ovalball account and answered NO_ACCOUNT
-- when it did not -- which told an administrator whether a given address is registered here. This
-- replaces it with ONE path that works either way, so the product never has to distinguish and there
-- is nothing left to learn from the answer.
--
-- `public.grant_governing_body_role_by_email` is DROPPED rather than left without callers: CLAUDE.md is
-- explicit that a zero-caller helper is still a hazard, because the next person may find it before they
-- find the canonical route. public.set_governing_body_role survives -- Site Admin master control uses
-- it, and so does redemption.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.grant_governing_body_role_by_email(uuid, text, text, text);

create or replace function public.invite_governing_body_officer(
  p_body_id uuid, p_email text, p_role_key text)
returns table(invitation_id uuid, token text, expires_at timestamptz, already_existed boolean)
language plpgsql security definer set search_path to 'public' as $$
declare v_email text;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- Authorised here AND again inside issue_invitation, which is the boundary. This check exists so the
  -- refusal names the organisation rather than arriving as a generic invitation error.
  if not (internal.can_manage_body(p_body_id) or internal.has_site_capability('site.memberships.manage')) then
    raise exception 'You are not authorised to give access to this organisation.' using errcode = '42501';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  -- THE CANONICAL ISSUER. Nothing here writes a token, an expiry or a state: hashed token and code,
  -- lifetime, single use, dedupe and the security event all come from issue_invitation.
  return query
  select i.invitation_id, i.token, i.expires_at, i.already_existed
    from public.issue_invitation(
      p_kind => 'GOVERNING_BODY_OFFICER',
      p_email => v_email,
      p_intended_outcome => jsonb_build_object('constituent_body_id', p_body_id, 'role_key', p_role_key)
    ) i;
end;
$$;

comment on function public.invite_governing_body_officer(uuid, text, text) is
  'Invites somebody to hold a role at a governing body, through the canonical invitation architecture. '
  'Works whether or not the address already has an Ovalball account, which is what closes the '
  'account-existence oracle the Step 15 grant-by-email had: there is one path and one answer.';

-- -----------------------------------------------------------------------------------------------------
-- 6. THE INVITATIONS AN ORGANISATION IS WAITING ON
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.governing_body_invitations(uuid);
create or replace function public.governing_body_invitations(p_body_id uuid)
returns table(invitation_id uuid, invited_email text, role_key text, expires_at timestamptz,
              issued_at timestamptz, issued_by_name text, resend_count int, can_administer boolean,
              expires_soon boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  return query
  select i.id, i.invited_email_normalised, i.intended_outcome->>'role_key', i.expires_at,
         i.created_at,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
         i.resend_count,
         internal.can_administer_invitation(i.id),
         -- ANSWERED HERE BECAUSE THE DATABASE KNOWS THE TIME. Comparing expires_at with Date.now() in a
         -- React render is an impure call whose result changes between renders -- the same defect Step 10
         -- removed from the team page -- and the lint rule catches it. now() in a STABLE function is one
         -- value for the whole statement.
         (i.expires_at < now() + interval '3 days')
    from public.access_invitations i
    left join public.profiles p on p.id = i.issued_by
   where i.constituent_body_id = p_body_id
     and i.kind = 'GOVERNING_BODY_OFFICER'
     -- OPEN INVITATIONS ONLY. A redeemed one is a person, and they are on the people list; a revoked
     -- or expired one is history and does not belong in a list headed "waiting".
     and i.state = 'ISSUED' and i.expires_at > now()
   order by i.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 7. A BODY ORGANISER IS TOLD WHAT ITS OWN CLUBS ANSWERED
--
-- THE DEFECT: the second branch below notified Site Admins whenever `organiser_club_id is null`, which
-- is true of EVERY body-organised competition. So when a club confirmed, requested a change to, or
-- declined one of the county's matches, respond_competition_match notified the platform and not the
-- county -- and the county's own officers were told nothing at all.
--
-- The fix is additive and narrows nothing: the club organiser's branch is untouched, the body's officers
-- are added, and Site Admins are now notified for a competition that genuinely has NO organiser rather
-- than for one whose organiser simply is not a club.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.competition_organiser_recipients(p_edition_id uuid)
returns TABLE(user_id uuid) language sql stable security definer set search_path to '' as $$
  select cm.user_id
    from public.competition_editions e
    join public.competitions c on c.id = e.competition_id
    join public.club_memberships cm on cm.club_id = c.organiser_club_id
         and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
   where e.id = p_edition_id
  union
  -- CONVERGENCE STEP 16: the governing body that organises it. Only the two roles that actually run
  -- competitions -- a BODY_VIEWER is not on the hook for answering anything.
  select r.user_id
    from public.competition_editions e
    join public.competitions c on c.id = e.competition_id
    join public.constituent_body_roles r on r.constituent_body_id = c.organiser_constituent_body_id
         and r.state = 'ACTIVE' and r.role_key in ('BODY_ADMIN', 'BODY_COMPETITIONS')
   where e.id = p_edition_id
  union
  select sa.user_id
    from public.competition_editions e
    join public.competitions c on c.id = e.competition_id
    join public.site_admins sa on sa.status = 'active'
         and (exists (select 1 from public.bundle_capabilities bc
                       where bc.bundle_key = sa.profile_key
                         and bc.capability_key = 'site.competitions.manage')
              or sa.manage_competitions)
   where e.id = p_edition_id
     and c.organiser_club_id is null
     and c.organiser_constituent_body_id is null;
$$;

comment on function internal.competition_organiser_recipients(uuid) is
  'Who hears about a competition as its organiser: the organiser club''s fixture administrators, the '
  'organising governing body''s administrator and competitions officers, or -- only when a competition '
  'has no organiser at all -- Site Admins holding site.competitions.manage.';

-- How a participant reads. It DELEGATES to internal.canonical_team_presentation -- the one canonical
-- naming authority -- and takes its `display` form, which the Team Directory rules make the site-wide
-- display name. It is not a second naming convention invented for this view.
create or replace function internal.competition_participant_label(p_participant_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select nullif(btrim(concat_ws(' ',
           d.name,
           case when t.id is not null
                then (select n.display from internal.canonical_team_presentation(
                        t.category, t.age_group, t.gender, t.squad_designation, t.rugby_code) n)
                else nullif(btrim(coalesce(p.squad_label, '')), '') end)), '')
    from public.competition_participants p
    join public.club_directory d on d.id = p.club_directory_id
    left join public.teams t on t.id = p.team_id
   where p.id = p_participant_id;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 7b. A BODY ORGANISER CAN READ ITS OWN COMPETITION
--
-- THE SECOND DEFECT, and the worse one. `internal.organised_edition_ids()` gates the SELECT policy on
-- eight competition tables, and it recognised a site capability and the organiser CLUB -- not the
-- organising body. Measured against the review county before this change, it returned **0** editions
-- for that county's own administrator.
--
-- Most of those eight have an `or internal.competition_edition_is_public(edition_id)` fallback, so an
-- ACTIVE competition was readable by accident. **`competition_match_verifications_read` has no such
-- fallback**, which is the one that matters: it meant a governing body could not see whether its own
-- clubs had confirmed, requested a change to, or declined its matches. Together with the notification
-- routing above, a county was completely blind to its clubs' answers.
--
-- One function, one added disjunct, eight policies repaired, and nothing narrowed: the site capability
-- and the organiser club are byte-for-byte unchanged, and this can only ever match a competition whose
-- organiser_constituent_body_id is a body the caller may run competitions for.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.organised_edition_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.competition_editions e
  join public.competitions c on c.id = e.competition_id
  where internal.is_account_active(auth.uid())
    and (
      internal.has_site_capability('site.competitions.manage')
      or (c.organiser_club_id is not null
          and internal.can('competition.edition.manage', 'club', c.organiser_club_id, null, null))
      -- CONVERGENCE STEP 16: the governing body that organises it.
      or (c.organiser_constituent_body_id is not null
          and internal.can_manage_body_competitions(c.organiser_constituent_body_id))
    );
$$;

comment on function internal.organised_edition_ids() is
  'Every competition edition this account organises, in the active sense the competition SELECT policies '
  'use: a Site Admin holding site.competitions.manage, the organiser club''s edition managers, or the '
  'governing body recorded as organising it. Reading a competition you organise is not authority over '
  'any club''s own fixtures.';

-- -----------------------------------------------------------------------------------------------------
-- 8. ONE COMPETITION'S REAL OUTCOME, FOR THE ORGANISATION THAT RUNS IT
--
-- COMPETITION MATCH IS THE TRUTH, and this returns it -- including a match between two clubs that are
-- not on Ovalball, which is exactly why a fixture projection can never be the source. There is no
-- standings computation here: lib/competitions/standings.ts already computes one from these rows, for
-- the public competition page, with the organiser's own points rule. A second one in SQL would be a
-- second answer.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.governing_body_competition_matches(p_competition_id uuid)
returns table(
  match_id uuid, edition_id uuid, season_name text, round_number int, stage_kind text,
  match_date date, kickoff_time time, status text, verification_state text,
  home_participant_id uuid, away_participant_id uuid, home_label text, away_label text,
  home_score int, away_score int, venue_label text, is_external_only boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_body uuid;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select c.organiser_constituent_body_id into v_body from public.competitions c where c.id = p_competition_id;
  if v_body is null then
    raise exception 'That competition is not organised by a governing body.' using errcode = 'P0002';
  end if;
  -- SEEING THE COMPETITION IS SEEING THE ORGANISATION. Anything less would let somebody enumerate a
  -- county's competitions without a relationship to it.
  if not internal.can_view_body(v_body) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select m.id, m.edition_id, s.name, m.round_number, st.kind,
         m.match_date, m.kickoff_time, m.status, m.verification_state,
         m.home_participant_id, m.away_participant_id,
         internal.competition_participant_label(m.home_participant_id),
         internal.competition_participant_label(m.away_participant_id),
         m.home_score, m.away_score,
         coalesce(v.name, m.venue_text),
         -- Neither side is on Ovalball. The organiser still owns this match, and it still counts.
         (coalesce(hp.club_id, ap.club_id) is null)
    from public.competition_matches m
    join public.competition_editions e on e.id = m.edition_id
    join public.seasons s on s.id = e.season_id
    left join public.competition_stages st on st.id = m.stage_id
    left join public.venues v on v.id = m.venue_id
    left join public.competition_participants hp on hp.id = m.home_participant_id
    left join public.competition_participants ap on ap.id = m.away_participant_id
   where e.competition_id = p_competition_id
   order by s.starts_on desc, m.round_number nulls last, m.match_date nulls last, m.kickoff_time nulls last;
end;
$$;



-- -----------------------------------------------------------------------------------------------------
-- 9. THE CLUB'S OWN SIDE OF THE RELATIONSHIP
--
-- A club could see individual match requests and had nowhere that said WHICH COMPETITIONS IT IS IN.
-- This is that read, and it is only a read: entering and withdrawing a team stays the organiser's act
-- (internal.require_edition_organiser), and the club's canonical act stays answering each match.
--
-- `organiser_label` is the point of the whole thing -- a club taking part in a county cup should be able
-- to see WHO runs it, which is now a club, a governing body, a named external organiser or Ovalball.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.club_competition_entries(p_club_id uuid)
returns table(
  competition_id uuid, competition_name text, competition_slug text, edition_id uuid,
  season_name text, rugby_code text, format text,
  organiser_kind text, organiser_label text, organiser_body_id uuid,
  entered_teams text[], entered_count int,
  awaiting_response int, confirmed int, declined int, played int, total_matches int
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- The club's own fixture administration sees this; so does a Site Admin holding the support
  -- capability. Team staff reach their own matches through Competition Requests, which is where an
  -- answer is actually given.
  if not (internal.can('competition.match.respond', 'club', p_club_id, null, null)
          or internal.can('fixture.fixture.view', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.support.act_in_club')
          or internal.has_site_capability('site.clubs.view')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  with mine as (
    select distinct p.edition_id, p.id as participant_id
      from public.competition_participants p
     where p.club_id = p_club_id and p.status = 'entered'
  )
  select c.id, c.name, c.slug, e.id, s.name, c.rugby_code, c.format,
         case when c.organiser_constituent_body_id is not null then 'BODY'
              when c.organiser_club_id is not null then 'CLUB'
              when nullif(btrim(coalesce(c.organiser_name, '')), '') is not null then 'EXTERNAL'
              else 'OVALBALL' end,
         coalesce((select b.canonical_name from public.constituent_bodies b where b.id = c.organiser_constituent_body_id),
                  (select d.name from public.clubs oc join public.club_directory d on d.id = oc.directory_id
                    where oc.id = c.organiser_club_id),
                  nullif(btrim(coalesce(c.organiser_name, '')), ''),
                  'Ovalball'),
         c.organiser_constituent_body_id,
         coalesce((select array_agg(distinct internal.competition_participant_label(m2.participant_id))
                     from mine m2 where m2.edition_id = e.id), '{}'::text[]),
         (select count(*)::int from mine m3 where m3.edition_id = e.id),
         -- WHAT NEEDS ANSWERING, from the canonical verification rows and nothing else.
         (select count(*)::int from public.competition_match_verifications vv
            where vv.club_id = p_club_id and vv.status = 'awaiting'
              and vv.match_id in (select mm.id from public.competition_matches mm where mm.edition_id = e.id)),
         (select count(*)::int from public.competition_match_verifications vv
            where vv.club_id = p_club_id and vv.status = 'confirmed'
              and vv.match_id in (select mm.id from public.competition_matches mm where mm.edition_id = e.id)),
         (select count(*)::int from public.competition_match_verifications vv
            where vv.club_id = p_club_id and vv.status = 'declined'
              and vv.match_id in (select mm.id from public.competition_matches mm where mm.edition_id = e.id)),
         (select count(*)::int from public.competition_matches mm, mine m4
            where m4.edition_id = e.id and mm.edition_id = e.id and mm.home_score is not null
              and (mm.home_participant_id = m4.participant_id or mm.away_participant_id = m4.participant_id)),
         (select count(*)::int from public.competition_matches mm, mine m5
            where m5.edition_id = e.id and mm.edition_id = e.id
              and (mm.home_participant_id = m5.participant_id or mm.away_participant_id = m5.participant_id))
    from mine
    join public.competition_editions e on e.id = mine.edition_id
    join public.competitions c on c.id = e.competition_id
    join public.seasons s on s.id = e.season_id
   group by c.id, c.name, c.slug, e.id, s.name, s.starts_on, c.rugby_code, c.format,
            c.organiser_constituent_body_id, c.organiser_club_id, c.organiser_name
   order by s.starts_on desc, c.name;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 9b. WHICH SEASON A NEW COMPETITION WOULD BE IN
--
-- The Competitions page shows the season, the rugby code and the organiser before somebody names a
-- competition, so they can see what is inherited rather than guess. The season had to come from the
-- register and from nowhere else: deriving "the current season" in TypeScript -- or reading whichever
-- season an existing edition happens to use -- would be a second answer to a question that has exactly
-- one. This delegates to the same resolver create_governing_body_competition uses.
--
-- It returns NULL rather than a guess when the register has no current or upcoming season for the code,
-- which is the NEEDS_ATTENTION the product then states in words.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.current_competition_season(p_rugby_code text)
returns table(season_id uuid, season_name text)
language sql stable security definer set search_path to 'public' as $$
  select s.id, s.name
    from public.seasons s
   where s.id = internal.competition_season_for(p_rugby_code, null);
$$;

revoke all on function public.current_competition_season(text) from public;
grant execute on function public.current_competition_season(text) to authenticated;

comment on function public.current_competition_season(text) is
  'The canonical Seasons register''s answer to "which season would a new competition be in", by '
  'delegating to internal.competition_season_for. Null where the register has none, never a computed year.';

-- -----------------------------------------------------------------------------------------------------
-- 10. GRANTS
-- -----------------------------------------------------------------------------------------------------
revoke all on function public.invite_governing_body_officer(uuid, text, text)        from public;
revoke all on function public.governing_body_invitations(uuid)                       from public;
revoke all on function public.governing_body_competition_matches(uuid)               from public;
revoke all on function public.club_competition_entries(uuid)                         from public;

grant execute on function public.invite_governing_body_officer(uuid, text, text)      to authenticated;
grant execute on function public.governing_body_invitations(uuid)                     to authenticated;
grant execute on function public.governing_body_competition_matches(uuid)             to authenticated;
grant execute on function public.club_competition_entries(uuid)                       to authenticated;

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_def text; v_bad text; v_n int;
begin
  -- ---------------------------------------------------------------------------------------------
  -- THE SCOPE IS STILL NOT IMPLEMENTED, AND NOBODY REGISTERED A TRAP.
  --
  -- `organisation` is the canonical scope name, already reserved in public.capabilities.valid_scopes
  -- and already refused by internal.capability_decision at rule 1. An ACTIVE capability declaring a
  -- scope the engine can never allow would deny silently for whoever found it next, so there must not
  -- be one while the refusal stands.
  -- ---------------------------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'capability_decision';
  if v_def !~ 'SCOPE_NOT_IMPLEMENTED' then
    raise exception 'Step 16: the organisation scope refusal was removed without implementing the scope';
  end if;
  if pg_get_function_arguments((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'internal' and p.proname = 'capability_decision')) ~ 'p_organisation|p_body' then
    raise exception 'Step 16: capability_decision grew an organisation parameter -- that is a whole-platform change';
  end if;
  -- THE TRAP IS CALLING THE ENGINE WITH THE SCOPE, not holding the row.
  --
  -- public.capabilities must hold 'governing.access.manage' -- access_invitations.issuer_capability is a
  -- foreign key into it -- and declaring valid_scopes = {organisation} is the honest description of what
  -- that authority is about. What would deny silently forever is asking internal.can for it at a scope
  -- the resolver refuses, so that is what is forbidden here.
  if not exists (select 1 from public.capabilities
                  where key = 'governing.access.manage' and status = 'ACTIVE'
                    and valid_scopes = array['organisation']) then
    raise exception 'Step 16: governing.access.manage is not registered as an organisation-scoped capability';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '(can|has_capability|capability_decision)\s*\([^)]*''organisation''';
  if v_bad is not null then
    raise exception 'Step 16: % asks the capability engine for the organisation scope, which it refuses: %', v_bad, v_bad;
  end if;

  -- ONE RESOLVER CHAIN FOR GOVERNING AUTHORITY. Not two.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.prosrc ~ 'constituent_body_roles'
     and p.proname not in ('body_role', 'set_governing_body_role', 'revoke_governing_body_role',
                           'governing_body_people', 'my_governing_bodies', 'redeem_invitation',
                           'competition_organiser_recipients');
  if v_bad is not null then
    raise exception 'Step 16: % reads constituent_body_roles directly instead of asking internal.body_role', v_bad;
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- ONE INVITATION SYSTEM.
  -- ---------------------------------------------------------------------------------------------
  if not exists (select 1 from internal.invitation_kind_spec('GOVERNING_BODY_OFFICER')) then
    raise exception 'Step 16: the invitation kind has no spec row';
  end if;
  if (select scope_type from internal.invitation_kind_spec('GOVERNING_BODY_OFFICER')) <> 'organisation' then
    raise exception 'Step 16: the governing invitation kind is not organisation-scoped';
  end if;
  -- Every other kind still resolves to exactly one spec row: the values list must stay filtered.
  select count(*) into v_n from internal.invitation_kind_spec('CLUB_STAFF');
  if v_n <> 1 then
    raise exception 'Step 16: invitation_kind_spec returns % rows for one kind', v_n;
  end if;

  -- No second invitation table, and no plaintext secret anywhere near this kind.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name ~ 'governing.*invit|body.*invit|invit.*body';
  if v_n > 0 then
    raise exception 'Step 16: a second invitation table appeared';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ 'governing'
     and p.prosrc ~* 'gen_random_uuid\(\)::text|md5\(|encode\(gen_random_bytes'
     and p.prosrc !~ 'issue_invitation';
  if v_bad is not null then
    raise exception 'Step 16: % mints its own invitation secret instead of using the canonical issuer: %', v_bad, v_bad;
  end if;

  -- THE ORACLE IS GONE, not merely unused.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'grant_governing_body_role_by_email') then
    raise exception 'Step 16: the account-existence oracle still exists';
  end if;

  -- The redemption path is the canonical one, with the hardening it already had.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_invitation';
  if v_def !~ 'GOVERNING_BODY_OFFICER' then
    raise exception 'Step 16: redemption cannot accept a governing body invitation';
  end if;
  if v_def !~ 'invitation_redemption_attempts' or v_def !~ 'email_confirmed_at' then
    raise exception 'Step 16: redemption lost its throttling or its email binding';
  end if;
  -- The role a redeemer gets is the one the invitation fixed, never anything they send.
  if v_def !~ 'v\.intended_outcome->>''role_key''' then
    raise exception 'Step 16: the redeemed body role is not read from the invitation itself';
  end if;
  -- AND THE ISSUER'S STANDING IS STILL RE-CHECKED. The first run of the Step 16 suite caught this: an
  -- organisation invitation filed at level SITE was refused as `issuer_authority_lost`, because a county
  -- officer is not a Site Admin. The disjunct must exist and must ask about the ISSUER.
  if v_def !~ 'body_role\(v\.constituent_body_id, v\.issued_by\)' then
    raise exception 'Step 16: redemption does not re-check the organisation issuer''s authority';
  end if;
  if (select issued_level from internal.invitation_kind_spec('GOVERNING_BODY_OFFICER')) <> 'ORGANISATION' then
    raise exception 'Step 16: a governing invitation is filed at the wrong issuing level';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- THE ORGANISER NOTIFICATION DEFECT IS FIXED, ADDITIVELY.
  -- ---------------------------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'competition_organiser_recipients';
  if v_def !~ 'organiser_club_id' or v_def !~ 'CLUB_ADMIN' then
    raise exception 'Step 16: the organiser club lost its notifications';
  end if;
  if v_def !~ 'constituent_body_roles' then
    raise exception 'Step 16: a governing body organiser is still not told about its own competition';
  end if;
  if v_def !~ 'organiser_constituent_body_id is null' then
    raise exception 'Step 16: Site Admins are still notified for a competition that has a body organiser';
  end if;
  -- The role list, read from the CODE rather than the comments around it: a static check that greps a
  -- function body sees its own prose too, and the first version of this guard failed on the sentence
  -- explaining why a viewer is excluded.
  if regexp_replace(v_def, '--[^\n]*', '', 'g') !~ 'role_key in \(''BODY_ADMIN'', ''BODY_COMPETITIONS''\)' then
    raise exception 'Step 16: the organiser recipients no longer name exactly the two roles that run competitions';
  end if;
  if regexp_replace(v_def, '--[^\n]*', '', 'g') ~ 'BODY_VIEWER' then
    raise exception 'Step 16: a BODY_VIEWER is being made responsible for answering competition matches';
  end if;

  -- THE RLS HALF OF BEING AN ORGANISER.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'organised_edition_ids';
  if v_def !~ 'site\.competitions\.manage' or v_def !~ 'organiser_club_id' then
    raise exception 'Step 16: organised_edition_ids lost an existing organiser';
  end if;
  if v_def !~ 'can_manage_body_competitions' then
    raise exception 'Step 16: a body organiser still cannot read its own competition through RLS';
  end if;
  -- And the eight policies still route through it, so the fix reaches all of them.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and (coalesce(qual,'') || coalesce(with_check,'')) like '%organised_edition_ids%';
  if v_n < 8 then
    raise exception 'Step 16: only % competition policies read organised_edition_ids', v_n;
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- NOTHING WIDENED, AND NOTHING WAS INVENTED.
  -- ---------------------------------------------------------------------------------------------
  -- Competition entry is still the organiser's act, with no club-side consent vocabulary invented.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.competition_participants'::regclass
         and conname = 'competition_participants_status_check') !~ 'entered.*withdrawn' then
    raise exception 'Step 16: the participant status vocabulary changed -- entry consent was invented';
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_competition_participants';
  if v_def !~ 'require_edition_organiser' then
    raise exception 'Step 16: entering a team is no longer the organiser''s act';
  end if;

  -- Affiliation is still a read: no Step 16 function writes which body a club belongs to.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname ~ 'governing|club_competition_entries|invite_governing'
     and p.prosrc ~* '(update|insert into)\s+(public\.)?club_directory';
  if v_bad is not null then
    raise exception 'Step 16: % writes club affiliation, which is published reference data: %', v_bad, v_bad;
  end if;

  -- The dispensation chain is untouched for the third step running.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'decide_player_dispensation';
  if v_def ~ 'constituent_body|can_manage_body' then
    raise exception 'Step 16: the dispensation governing-body stage was re-pointed at a body officer';
  end if;

  -- No governing function reaches protected person data.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname ~ 'governing_body|invite_governing|can_manage_body|can_view_body'
     and p.prosrc ~* 'date_of_birth|medical|safeguard|guardians|player_team_dispensation';
  if v_bad is not null then
    raise exception 'Step 16: a governing body function reaches protected person data: %', v_bad;
  end if;

  -- The season shown before creating a competition comes from the register, by delegation.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_competition_season';
  if v_def !~ 'competition_season_for' then
    raise exception 'Step 16: current_competition_season does not delegate to the canonical resolver';
  end if;
  if v_def ~* 'extract\s*\(\s*year|current_date\s*-|''08-01''|''09-01''' then
    raise exception 'Step 16: current_competition_season computes a season instead of reading the register';
  end if;

  -- Standings are computed in exactly one place, and it is not SQL.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal') and p.prosrc ~* 'points_for|pointsfor|league_position|standings';
  if v_n > 0 then
    raise exception 'Step 16: a second standings computation appeared in the database';
  end if;

  -- ANON REACHES NONE OF IT.
  if has_function_privilege('anon', 'public.invite_governing_body_officer(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.governing_body_invitations(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.governing_body_competition_matches(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_competition_entries(uuid)', 'EXECUTE') then
    raise exception 'Step 16: anon can reach a Step 16 function';
  end if;

  -- FAIL CLOSED, PROVEN: every predicate this step touches answers a definite boolean.
  if internal.can_administer_invitation(gen_random_uuid()) is not false then
    raise exception 'Step 16: can_administer_invitation does not refuse an invitation that does not exist';
  end if;
end;
$guard$;
