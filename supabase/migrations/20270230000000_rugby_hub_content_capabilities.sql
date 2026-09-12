-- Rugby Hub general-knowledge content -- capability keys.
--
-- Follows the exact precedent regulatory content administration already set
-- (20261029000000_regulatory_capabilities.sql): two site_admins boolean
-- flags, not a granular per-verb grant. A Site Admin either has
-- manage_hub_content or does not -- there is no separate create/review/
-- publish/supersede grant, matching every other site-wide domain.
--
-- Deliberately a SEPARATE pair from view_regulatory_content/
-- manage_regulatory_content: general knowledge (positions, skills, glossary,
-- coaching guidance) is editorially different content from governing-body
-- regulatory truth, reviewed by different people on a different cadence, and
-- granting one must never silently grant the other.

alter table public.site_admins add column if not exists view_hub_content boolean not null default false;
alter table public.site_admins add column if not exists manage_hub_content boolean not null default false;
comment on column public.site_admins.view_hub_content is 'Read access to Rugby Hub general-knowledge administration data (drafts, review state) -- never implies write. Full confers it automatically.';
comment on column public.site_admins.manage_hub_content is 'The whole general-knowledge content lifecycle: create/edit content items, positions, skills, glossary terms; review, publish, supersede, archive. Full confers it automatically. Does NOT confer manage_regulatory_content -- these are separate grants.';

insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('site.hub_content.view', 'View Rugby Hub content administration', 'Read Rugby Hub general-knowledge content -- positions, skills, glossary terms, coaching guidance -- including drafts and review state.', 'site', array['site']),
  ('site.hub_content.manage', 'Manage Rugby Hub content', 'Create, edit, review, publish, supersede and archive Rugby Hub general-knowledge content (positions, skills, glossary, coaching guidance, practical guides, fun facts).', 'site', array['site'])
on conflict (key) do nothing;

create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when internal.is_full_site_admin() then true
    when p_capability_key = 'site.permissions.manage' then coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.lookups.manage' then coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.team_catalogue.manage' then coalesce((select manage_team_catalogue from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.competitions.manage' then coalesce((select manage_competitions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.fixture_support.manage' then coalesce((select manage_fixture_support from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.diagnostic.access' then coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.seasons.manage' then coalesce((select manage_seasons from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.release.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.beta.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.commercial.view' then coalesce((select view_commercial from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.commercial.manage' then false
    when p_capability_key = 'site.regulatory.view' then coalesce((select view_regulatory_content from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.regulatory.manage' then coalesce((select manage_regulatory_content from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.hub_content.view' then coalesce((select view_hub_content from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.hub_content.manage' then coalesce((select manage_hub_content from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    else internal.is_site_admin()
  end;
$function$;
