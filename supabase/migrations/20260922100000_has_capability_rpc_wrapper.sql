-- Section 15: "Create/establish one canonical authorization API/service
-- used by server-side code." internal.has_capability() (20260922000000)
-- is the primitive RLS policies call directly, but the `internal` schema
-- is never exposed to PostgREST -- no TS code anywhere in this codebase
-- calls an internal.* function via supabase.rpc(), by deliberate
-- convention. This thin public wrapper is the one, single way
-- server-side TypeScript reaches the SAME primitive RLS uses -- never a
-- second, independently-maintained resolution.
create or replace function public.has_capability(
  p_capability_key text, p_scope_type text, p_club_id uuid default null, p_team_id uuid default null
)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_capability(p_capability_key, p_scope_type, p_club_id, p_team_id);
$$;
revoke execute on function public.has_capability(text, text, uuid, uuid) from public;
grant execute on function public.has_capability(text, text, uuid, uuid) to authenticated;
