-- Regulatory content administration -- capability keys.
--
-- Side Project 3's own Stage 2 used a temporary, isolated authorization
-- scaffold (public.regulatory_admins + internal.is_regulatory_admin) because
-- it could not safely alter Main's real site_admins table before
-- integration -- see docs/RUGBY_REGULATORY_SECURITY_MODEL.md in
-- ovalball-rugby-knowledge (audited, never copied). Now that this IS Main,
-- the correct, precedented shape is two new site_admins boolean flags,
-- following the exact pattern every other site-wide domain already uses
-- (manage_team_catalogue, manage_competitions, manage_fixture_support,
-- manage_global_lookups, manage_system, view_commercial -- see
-- internal.has_site_role_capability, 20260922000000_scoped_capability_
-- engine.sql).
--
-- Two flags, not SP3's proposed six (source.view/source.manage/content.
-- view_draft/content.edit/content.verify/content.publish/content.supersede/
-- conflict.resolve). SP3's own docs called that split "proposed, not
-- decided" -- Main's real site-wide domains never separate view from a
-- single granular per-verb grant (a Site Admin either has
-- manage_team_catalogue or does not; there is no separate "create vs
-- verify vs publish" catalogue grant). Following that established,
-- lower-complexity precedent: view_regulatory_content (read draft/source/
-- conflict administration data) and manage_regulatory_content (the whole
-- edit/verify/publish/supersede/resolve-conflict lifecycle). A Full Site
-- Admin continues to bypass both, exactly as every other site domain.

alter table public.site_admins add column if not exists view_regulatory_content boolean not null default false;
alter table public.site_admins add column if not exists manage_regulatory_content boolean not null default false;
comment on column public.site_admins.view_regulatory_content is 'Read access to regulatory source/content administration data (drafts, conflicts, review states) -- never implies write. A genuine per-person grant, like view_commercial; Full confers it automatically.';
comment on column public.site_admins.manage_regulatory_content is 'The whole regulatory content lifecycle: create/edit sources and facts, verify, publish, supersede, resolve conflicts. A genuine per-person grant, like manage_team_catalogue; Full confers it automatically.';

insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('site.regulatory.view', 'View regulatory content administration', 'Read regulatory sources, facts, conflicts and draft content across every rugby code.', 'site', array['site']),
  ('site.regulatory.manage', 'Manage regulatory content', 'Create, edit, verify, publish, supersede and resolve conflicts in regulatory rules/safeguarding/player-welfare content.', 'site', array['site'])
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
    else internal.is_site_admin()
  end;
$function$;
