-- =====================================================================================================
-- SLICE 7e (1/n) -- AB.3: the search Users & Access does has a name, and now it exists.
--
-- WHAT WAS THERE. The Users & Access list built its own filter in the browser-facing layer and sent it
-- to PostgREST:
--
--   q.or(`first_name.ilike.%${escaped}%,surname.ilike.%${escaped}%,email.ilike.%${escaped}%,...`)
--
-- That is a filter EXPRESSION composed in application code out of a value a person typed, handed to the
-- API as a string. It was escaped, and it read a security_invoker view, so it was not a hole -- but the
-- shape is wrong for the one screen in the product that can see every account on the platform. The
-- brief named an RPC (AB.3) precisely so that "which people can this administrator search, and by what"
-- is a question the database answers once, rather than a question every caller re-answers by assembling
-- a string.
--
-- WHAT THIS IS. One definer function, authorised on site.users.view before it reads anything, taking
-- the search as DATA. There is no dynamic SQL in it at all: the sort is a CASE over a closed set and an
-- unrecognised sort is refused rather than silently defaulted, because a sort that quietly becomes
-- something else is how a paginated export ends up incomplete without anybody noticing.
--
-- It returns `total_count` alongside the rows because the caller needs both and asking twice would let
-- them disagree under concurrent writes.
--
-- WHAT IT IS NOT. Not a widening: internal.require_site_capability is the same capability the view's own
-- RLS demanded, checked once, first, and loudly. And not an AAL2 operation -- this reads. The ten-minute
-- authenticator rule belongs on the master-control mutations, and putting it on a search would train
-- administrators to keep a code ready for looking things up.
-- =====================================================================================================

create or replace function public.site_search_users(
  p_query  text default null,
  p_access text default 'all',
  p_status text default 'all',
  p_sort   text default 'name-asc',
  p_limit  int  default 25,
  p_offset int  default 0
)
returns table (
  user_id               uuid,
  first_name            text,
  surname               text,
  email                 text,
  user_created_at       timestamptz,
  is_site_admin         boolean,
  memberships           jsonb,
  pending_requests      jsonb,
  club_names            text,
  team_names            text,
  has_active_membership boolean,
  has_club_admin        boolean,
  has_fixtures_admin    boolean,
  has_team_admin        boolean,
  has_pending_request   boolean,
  account_state         text,
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needle text;
  v_limit  int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  -- Authorise BEFORE looking anything up, per 20270425000000_authorise_before_lookup: a refusal must not
  -- depend on whether the search matched, or the refusal itself answers the question.
  perform internal.require_site_capability('site.users.view');

  if coalesce(p_access, 'all') not in ('all','site_admin','club_admin','fixtures_admin','team_admin','view_only','no_access') then
    raise exception 'Unknown access filter.' using errcode = '22023';
  end if;
  if coalesce(p_status, 'all') not in ('all','active','pending','no_access','suspended') then
    raise exception 'Unknown status filter.' using errcode = '22023';
  end if;
  if coalesce(p_sort, 'name-asc') not in ('name-asc','name-desc','newest','oldest','club') then
    raise exception 'Unknown sort order.' using errcode = '22023';
  end if;

  -- A search of one character matches most of the platform, so it is treated as no search at all --
  -- the same two-character floor the list page already applied, moved to where it cannot be forgotten.
  v_needle := nullif(btrim(coalesce(p_query, '')), '');
  if v_needle is not null and length(v_needle) < 2 then
    v_needle := null;
  end if;
  if v_needle is not null then
    -- The value is DATA here; escaping is for LIKE's own metacharacters, not for SQL.
    v_needle := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with matched as (
    select v.*
      from public.admin_user_overview v
     where (v_needle is null
            or v.first_name  ilike v_needle
            or v.surname     ilike v_needle
            or v.email       ilike v_needle
            or v.club_names  ilike v_needle
            or v.team_names  ilike v_needle)
       and (coalesce(p_access,'all') = 'all'
            or (p_access = 'site_admin'     and v.is_site_admin)
            or (p_access = 'club_admin'     and v.has_club_admin)
            or (p_access = 'fixtures_admin' and v.has_fixtures_admin)
            or (p_access = 'team_admin'     and v.has_team_admin)
            or (p_access = 'view_only'      and v.has_active_membership
                                           and not v.has_club_admin
                                           and not v.has_fixtures_admin
                                           and not v.has_team_admin)
            or (p_access = 'no_access'      and not v.has_active_membership and not v.is_site_admin))
       and (coalesce(p_status,'all') = 'all'
            or (p_status = 'active'    and v.has_active_membership)
            or (p_status = 'pending'   and v.has_pending_request)
            or (p_status = 'no_access' and not v.has_active_membership
                                       and not v.has_pending_request
                                       and not v.is_site_admin)
            or (p_status = 'suspended' and v.account_state = 'SUSPENDED'))
  ),
  counted as (select count(*) as n from matched)
  select m.user_id, m.first_name, m.surname, m.email, m.user_created_at, m.is_site_admin,
         m.memberships, m.pending_requests, m.club_names, m.team_names,
         m.has_active_membership, m.has_club_admin, m.has_fixtures_admin, m.has_team_admin,
         m.has_pending_request, m.account_state, c.n
    from matched m cross join counted c
   order by
     case when coalesce(p_sort,'name-asc') = 'name-asc'  then lower(m.first_name) end asc  nulls last,
     case when coalesce(p_sort,'name-asc') = 'name-asc'  then lower(m.surname)    end asc  nulls last,
     case when p_sort = 'name-desc' then lower(m.first_name) end desc nulls last,
     case when p_sort = 'name-desc' then lower(m.surname)    end desc nulls last,
     case when p_sort = 'newest'    then m.user_created_at   end desc nulls last,
     case when p_sort = 'oldest'    then m.user_created_at   end asc  nulls last,
     case when p_sort = 'club'      then lower(m.club_names) end asc  nulls last,
     -- A stable tiebreak, so page 2 cannot repeat a row page 1 already showed.
     m.user_id
   limit v_limit offset v_offset;
end $$;

comment on function public.site_search_users(text, text, text, text, int, int) is
  'Phase 2 AB.3. The one search behind Site Admin Users & Access. Authorises on site.users.view before '
  'reading, takes every filter as data, refuses an unrecognised sort rather than defaulting it, and '
  'returns total_count with the page so the two cannot disagree. A read: no AAL2, by design.';

revoke all on function public.site_search_users(text, text, text, text, int, int) from public, anon;
grant execute on function public.site_search_users(text, text, text, text, int, int) to authenticated;

do $$
begin
  if to_regprocedure('public.site_search_users(text,text,text,text,int,int)') is null then
    raise exception 'SLICE 7e: site_search_users was not created';
  end if;
  if has_function_privilege('anon', 'public.site_search_users(text,text,text,text,int,int)', 'EXECUTE') then
    raise exception 'SLICE 7e: anon can search every account on the platform';
  end if;
  raise notice 'Slice 7e: AB.3 site_search_users exists and is the named search';
end $$;
