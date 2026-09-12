-- =====================================================================
-- WHAT THIS CLUB HAS GIVEN ITS PEOPLE
--
-- A delegation screen has to answer a question the capability engine
-- deliberately cannot: not "what may I do", which internal.has_capability
-- answers for the CALLER, but "what may THIS OTHER PERSON do".
--
-- The obvious shortcut is to recompute precedence in the page -- read the
-- role defaults, read the overrides, decide which wins. That is a second
-- implementation of the one rule that must never have two, and it would
-- drift the first time the precedence changed.
--
-- So the question is answered here instead, in the same order the engine
-- itself uses: an explicit DENY wins over everything, then an explicit
-- GRANT, then the person's role default for that scope. The screen renders
-- what this returns and decides nothing.
--
-- IT ALSO RETURNS THE SOURCE. "Allowed because of their role" and "allowed
-- because you granted it" look identical as a tick and are completely
-- different facts -- one disappears if the person changes role, the other
-- is a decision somebody made and can undo.
--
-- Readable by a club administrator holding club.capabilities.manage for
-- that club, and by Site Admin. It exposes only the delegable operational
-- capabilities of one named club, never a person's wider authority.
-- =====================================================================

create or replace function public.club_member_capabilities(p_club_id uuid)
returns table (
  user_id uuid,
  capability_key text,
  effective boolean,
  source text,
  override_id uuid
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if not (internal.is_site_admin()
          or internal.has_capability('club.capabilities.manage', 'club', p_club_id, null)) then
    raise exception 'You do not have permission to view this club''s capabilities.' using errcode = '42501';
  end if;

  return query
  with members as (
    select cm.user_id, cm.role
    from public.club_memberships cm
    where cm.club_id = p_club_id and cm.status = 'active'
  ),
  delegable as (
    select c.key
    from public.capabilities c
    where internal.club_delegable_capability(c.key)
      and 'club' = any (c.applicable_scopes)
  ),
  pairs as (
    select m.user_id, m.role, d.key
    from members m cross join delegable d
  )
  select
    p.user_id,
    p.key,
    case
      when o.effect = 'deny' then false
      when o.effect = 'grant' then true
      else rcd.capability_key is not null
    end,
    case
      when o.effect = 'deny' then 'denied'
      when o.effect = 'grant' then 'granted'
      when rcd.capability_key is not null then 'role'
      else 'none'
    end,
    o.id
  from pairs p
  left join public.capability_overrides o
    on o.user_id = p.user_id
   and o.capability_key = p.key
   and o.scope_type = 'club'
   and o.club_id = p_club_id
   and o.status = 'active'
  left join public.role_capability_defaults rcd
    on rcd.scope_type = 'club'
   and rcd.role_key = p.role
   and rcd.capability_key = p.key;
end;
$$;

comment on function public.club_member_capabilities(uuid) is
  'Every active member of one club against the operational capabilities that club may delegate, with the effective answer and WHERE it came from (role default, explicit grant, explicit deny). Precedence lives here rather than in the screen so there is only ever one implementation of it.';

revoke all on function public.club_member_capabilities(uuid) from public, anon;
grant execute on function public.club_member_capabilities(uuid) to authenticated;
