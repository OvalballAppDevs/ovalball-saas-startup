-- Rugby Hub general-knowledge recommendation foundation.
--
-- Extends the existing Rugby Hub server-context pattern (regulatory_
-- context_for_team / get_rugby_hub_* in 20261029030000_regulatory_
-- resolvers.sql) rather than building a second personalisation service.
-- The caller already resolves a real team -> regulatory_identity via
-- internal.regulatory_context_for_team; this RPC takes that same identity
-- and returns applicability-matched general content, published only.
--
-- Context determines RECOMMENDED/RELEVANT, never EXCLUSIVE ACCESS: this
-- function only ever narrows a published set for ranking purposes. It is
-- not, and must never become, the only way to reach Rugby Hub content --
-- browsing/search (public.search_hub_content) stays open to everyone.

create or replace function public.get_hub_recommended_content(
  p_regulatory_identity_id uuid default null,
  p_limit integer default 10
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  summary text,
  is_universal_match boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select 'CONTENT_ITEM', c.id, c.title, c.summary, a.is_universal
  from public.hub_content_items c
  join public.hub_content_applicability a on a.content_item_id = c.id
  where c.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  union all
  select 'POSITION', p.id, p.display_name, p.purpose, a.is_universal
  from public.hub_positions p
  join public.hub_content_applicability a on a.position_id = p.id
  where p.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  union all
  select 'SKILL', s.id, s.display_name, s.summary, a.is_universal
  from public.hub_skills s
  join public.hub_content_applicability a on a.skill_id = s.id
  where s.status = 'PUBLISHED'
    and (a.is_universal = true or a.regulatory_identity_id = p_regulatory_identity_id)
  order by is_universal asc
  limit p_limit;
$$;
comment on function public.get_hub_recommended_content is 'Context-ranked, published-only general knowledge for a resolved regulatory identity (team/player/child context, resolved by the caller exactly as internal.regulatory_context_for_team already does for the regulatory layer). Identity-specific matches rank before universal ones. Returns a RECOMMENDATION, not a filter on what the viewer may browse -- public.search_hub_content remains the unrestricted entry point for anyone exploring beyond their own context.';

revoke all on function public.get_hub_recommended_content(uuid, integer) from public, anon;
grant execute on function public.get_hub_recommended_content(uuid, integer) to authenticated;
