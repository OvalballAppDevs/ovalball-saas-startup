-- =====================================================================
-- A CLUB HAS A HOME
--
-- Club news, team news and short announcements, for the public club
-- homepage at /club/{slug} and the article pages beneath it.
--
-- WHAT THIS IS, AND IS NOT
--
--   An ARTICLE is a club publication: a match report, an event, an update.
--   It has a stable, shareable URL and belongs to the club, and may also
--   belong to one of the club's teams.
--
--   An ANNOUNCEMENT is a short notice with a start and an expiry --
--   "Clubhouse closed Saturday". It is not a short article.
--
--   Neither is a messenger announcement. public.messenger_announcements is
--   private, per-recipient delivery with no public read path at all; that is
--   the whole point of its design, and nothing here reads or widens it.
--
-- AUTHORITY IS CONSUMED, NOT REDEFINED
--
--   Two capabilities are added the way docs/CAPABILITY_ARCHITECTURE.md
--   prescribes -- catalogue rows and role defaults, nothing else:
--
--     club.news.manage   club scope   the club's news and announcements,
--                                      including every team's
--     team.news.manage   team scope   one team's news and announcements
--
--   Every decision goes through the two adapters below. Editing and
--   publishing are separate functions even though today they resolve the
--   same keys, so a finer split (a volunteer who may draft but not publish)
--   is a change to one function body rather than to every caller.
--
--   Nothing here touches internal.has_capability, the role catalogue, the
--   override engine or membership. The identity programme can replace what
--   these adapters ask without rewriting the news feature.
--
-- THE PUBLIC BOUNDARY
--
--   Both tables are read directly under RLS, never through an owner-rights
--   view: a signed-out visitor sees PUBLISHED + PUBLIC rows of an active
--   club, and nothing else. Browser roles hold SELECT on a named column list
--   that deliberately omits who created, edited and published a row -- the
--   byline is the club or the team, not the person who pressed the button.
--   There is no INSERT, UPDATE or DELETE grant or policy for any browser
--   role; every write is one of the functions below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------

insert into public.capabilities (key, label, description, category, applicable_scopes)
values
  (
    'club.news.manage',
    'Manage Club News',
    'Write, publish and archive the club''s news and announcements, including news for every team at the club.',
    'club',
    array['club']
  ),
  (
    'team.news.manage',
    'Manage Team News',
    'Write, publish and archive news and announcements for one team.',
    'team',
    array['team']
  )
on conflict (key) do nothing;

-- Team news mirrors team.community.manage: the people who already speak for
-- a team (its manager and its coaches) may publish for it. Club Admin holds
-- both, at their own scopes.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values
  ('club', 'CLUB_ADMIN', 'club.news.manage'),
  ('team', 'CLUB_ADMIN', 'team.news.manage'),
  ('team', 'TEAM_MANAGER', 'team.news.manage'),
  ('team', 'TEAM_STAFF', 'team.news.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. The authority adapters
-- ---------------------------------------------------------------------

create or replace function internal.may_edit_club_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_club_id is null then
    return false;
  end if;
  -- A team is only ever a scope inside its own club. Checked first, so club
  -- authority cannot be pointed at another club's team either.
  if p_team_id is not null
     and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    return false;
  end if;
  if internal.has_capability('club.news.manage', 'club', p_club_id, null) then
    return true;
  end if;
  -- has_capability also proves the team belongs to that club, so a team
  -- grant can never reach another club's content.
  return p_team_id is not null
     and internal.has_capability('team.news.manage', 'team', p_club_id, p_team_id);
end;
$$;

comment on function internal.may_edit_club_content(uuid, uuid) is
  'The one answer to "may this person draft or edit club content in this scope". Club scope: club.news.manage. Team scope: club.news.manage or team.news.manage for that team. A club-wide item (team null) needs club authority.';

create or replace function internal.may_publish_club_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  -- Deliberately a separate function with, today, the same answer. See the
  -- header: publishing is where a future split would land.
  return internal.may_edit_club_content(p_club_id, p_team_id);
end;
$$;

comment on function internal.may_publish_club_content(uuid, uuid) is
  'The one answer to "may this person make club content public, change what is public, or take it down". Resolves the same capabilities as may_edit_club_content today; kept separate so the two can diverge in one place.';

create or replace function internal.may_view_club_member_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is null or p_club_id is null then
    return false;
  end if;
  return internal.has_capability('club.view', 'club', p_club_id, null)
      or (p_team_id is not null and internal.has_capability('team.view', 'team', p_club_id, p_team_id));
end;
$$;

comment on function internal.may_view_club_member_content(uuid, uuid) is
  'Who may read content a club marked MEMBERS: someone who can already see the club (club.view) or, for a team item, that team (team.view). Consumes existing view capabilities; grants nothing.';

revoke execute on function internal.may_edit_club_content(uuid, uuid) from public, anon;
revoke execute on function internal.may_publish_club_content(uuid, uuid) from public, anon;
revoke execute on function internal.may_view_club_member_content(uuid, uuid) from public, anon;
grant execute on function internal.may_edit_club_content(uuid, uuid) to authenticated;
grant execute on function internal.may_publish_club_content(uuid, uuid) to authenticated;
grant execute on function internal.may_view_club_member_content(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Articles
-- ---------------------------------------------------------------------

create table public.club_articles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  -- An article always belongs to the club. It may also belong to one team,
  -- which decides who may write it and where it appears -- never who may
  -- read it; that is `visibility`.
  team_id uuid references public.teams(id) on delete cascade,

  -- The public URL segment. Set from the title while the article has never
  -- been published, then frozen: a link a club has already shared must keep
  -- working when a typo in the headline is corrected.
  slug text not null,
  title text not null,
  excerpt text,
  -- A deliberately small, safe markup (headings, paragraphs, bold, italic,
  -- links, lists) rendered to React elements by lib/club-content/markup.ts.
  -- Never HTML: nothing stored here is ever handed to the browser as markup.
  body text not null default '',

  -- A controlled vocabulary with its labels in TypeScript. Generic enough not
  -- to need a migration for every new kind of club story.
  category text not null default 'NEWS',
  status text not null default 'DRAFT',
  visibility text not null default 'PUBLIC',
  featured boolean not null default false,

  hero_image_path text,
  hero_image_alt text,

  -- Non-null only for articles Ovalball itself wrote. One per key per club,
  -- which is what makes the welcome article idempotent.
  system_key text,

  published_at timestamptz,
  first_published_at timestamptz,
  archived_at timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_articles_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint club_articles_title_length check (char_length(btrim(title)) between 3 and 140),
  constraint club_articles_excerpt_length check (excerpt is null or char_length(excerpt) <= 300),
  constraint club_articles_body_length check (char_length(body) <= 20000),
  constraint club_articles_category_check check (category in ('NEWS', 'MATCH_REPORT', 'EVENT', 'UPDATE', 'CELEBRATION', 'WELCOME')),
  constraint club_articles_status_check check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  constraint club_articles_visibility_check check (visibility in ('PUBLIC', 'MEMBERS')),
  constraint club_articles_system_key_check check (system_key is null or system_key in ('WELCOME_TO_OVALBALL')),
  constraint club_articles_published_has_time check (status <> 'PUBLISHED' or published_at is not null),
  constraint club_articles_featured_is_published check (not featured or status = 'PUBLISHED'),
  -- An image is described, or it is not there. Screen readers and shared
  -- link previews both depend on it.
  constraint club_articles_hero_needs_alt check (
    hero_image_path is null or char_length(btrim(coalesce(hero_image_alt, ''))) between 1 and 250
  ),
  -- An article can only point at an image stored under its own club.
  constraint club_articles_hero_in_club_folder check (
    hero_image_path is null or hero_image_path like club_id::text || '/%'
  ),
  unique (club_id, slug)
);

create unique index club_articles_one_system_article on public.club_articles (club_id, system_key) where system_key is not null;
create unique index club_articles_one_lead_story on public.club_articles (club_id) where featured;
create index club_articles_club_feed on public.club_articles (club_id, status, published_at desc);
create index club_articles_team_feed on public.club_articles (team_id, status, published_at desc) where team_id is not null;

comment on table public.club_articles is
  'Club and team news articles for the public club homepage. Read under RLS (published + public for everyone; members-only for people who can see the club or team; everything in scope for its editors). Written only through save_club_article / set_club_article_status / set_club_article_featured.';

-- ---------------------------------------------------------------------
-- 4. Announcements
-- ---------------------------------------------------------------------

create table public.club_announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,

  title text not null,
  body text,
  priority text not null default 'NORMAL',
  status text not null default 'DRAFT',
  visibility text not null default 'PUBLIC',

  -- The notice shows from starts_at, and stops showing at expires_at. An
  -- announcement with no expiry stays up until someone archives it.
  starts_at timestamptz not null default now(),
  expires_at timestamptz,

  link_label text,
  link_url text,

  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_announcements_title_length check (char_length(btrim(title)) between 3 and 100),
  constraint club_announcements_body_length check (body is null or char_length(body) <= 500),
  constraint club_announcements_priority_check check (priority in ('NORMAL', 'IMPORTANT', 'URGENT')),
  constraint club_announcements_status_check check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  constraint club_announcements_visibility_check check (visibility in ('PUBLIC', 'MEMBERS')),
  constraint club_announcements_window check (expires_at is null or expires_at > starts_at),
  constraint club_announcements_published_has_time check (status <> 'PUBLISHED' or published_at is not null),
  constraint club_announcements_link_together check ((link_label is null) = (link_url is null)),
  constraint club_announcements_link_label_length check (link_label is null or char_length(btrim(link_label)) between 1 and 40),
  -- An https:// address or a path on this site. Never javascript:, data: or
  -- a protocol-relative //host that would leave the site unannounced.
  constraint club_announcements_link_safe check (
    link_url is null or link_url ~ '^https://[^\s]+$' or link_url ~ '^/(?!/)[^\s]*$'
  )
);

create index club_announcements_club_live on public.club_announcements (club_id, status, starts_at desc);

comment on table public.club_announcements is
  'Short, prominent club or team notices with priority, a start and an optional expiry. Read under RLS; written only through save_club_announcement / set_club_announcement_status.';

-- ---------------------------------------------------------------------
-- 5. Integrity triggers
-- ---------------------------------------------------------------------

create or replace function internal.validate_club_content_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.club_id is distinct from old.club_id then
    raise exception 'Club content cannot move to another club.' using errcode = '23514';
  end if;
  if new.team_id is not null
     and not exists (select 1 from public.teams t where t.id = new.team_id and t.club_id = new.club_id) then
    raise exception 'That team does not belong to this club.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger club_articles_scope
  before insert or update on public.club_articles
  for each row execute function internal.validate_club_content_scope();

create trigger club_announcements_scope
  before insert or update on public.club_announcements
  for each row execute function internal.validate_club_content_scope();

create trigger set_updated_at before update on public.club_articles
  for each row execute function set_updated_at();
create trigger set_updated_at before update on public.club_announcements
  for each row execute function set_updated_at();

create trigger audit_row_change after insert or update or delete on public.club_articles
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.club_announcements
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 6. Row-level security and grants
-- ---------------------------------------------------------------------

alter table public.club_articles enable row level security;
alter table public.club_announcements enable row level security;

revoke all on public.club_articles from anon, authenticated;
revoke all on public.club_announcements from anon, authenticated;

grant select (
  id, club_id, team_id, slug, title, excerpt, body, category, status, visibility, featured,
  hero_image_path, hero_image_alt, system_key, published_at, first_published_at, archived_at,
  created_at, updated_at
) on public.club_articles to anon, authenticated;

grant select (
  id, club_id, team_id, title, body, priority, status, visibility, starts_at, expires_at,
  link_label, link_url, published_at, archived_at, created_at, updated_at
) on public.club_announcements to anon, authenticated;

create policy club_articles_public_read on public.club_articles
  for select to anon
  using (
    status = 'PUBLISHED'
    and visibility = 'PUBLIC'
    and exists (select 1 from public.clubs c where c.id = club_id and c.status = 'active')
  );

create policy club_articles_signed_in_read on public.club_articles
  for select to authenticated
  using (
    (
      status = 'PUBLISHED'
      and exists (select 1 from public.clubs c where c.id = club_id and c.status = 'active')
      and (visibility = 'PUBLIC' or internal.may_view_club_member_content(club_id, team_id))
    )
    or internal.may_edit_club_content(club_id, team_id)
  );

create policy club_announcements_public_read on public.club_announcements
  for select to anon
  using (
    status = 'PUBLISHED'
    and visibility = 'PUBLIC'
    and starts_at <= now()
    and (expires_at is null or expires_at > now())
    and exists (select 1 from public.clubs c where c.id = club_id and c.status = 'active')
  );

create policy club_announcements_signed_in_read on public.club_announcements
  for select to authenticated
  using (
    (
      status = 'PUBLISHED'
      and starts_at <= now()
      and (expires_at is null or expires_at > now())
      and exists (select 1 from public.clubs c where c.id = club_id and c.status = 'active')
      and (visibility = 'PUBLIC' or internal.may_view_club_member_content(club_id, team_id))
    )
    or internal.may_edit_club_content(club_id, team_id)
  );

-- ---------------------------------------------------------------------
-- 7. Slugs
-- ---------------------------------------------------------------------

create or replace function internal.club_article_slug_base(p_title text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      trim(both '-' from left(
        trim(both '-' from regexp_replace(
          replace(lower(coalesce(p_title, '')), '&', ' and '),
          '[^a-z0-9]+', '-', 'g'
        )),
        60
      )),
      ''
    ),
    'article'
  );
$$;

create or replace function internal.unique_club_article_slug(p_club_id uuid, p_title text, p_exclude uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_base text := internal.club_article_slug_base(p_title);
  v_slug text := v_base;
  v_n integer := 1;
begin
  while exists (
    select 1 from public.club_articles a
    where a.club_id = p_club_id and a.slug = v_slug and (p_exclude is null or a.id <> p_exclude)
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

revoke execute on function internal.club_article_slug_base(text) from public, anon;
revoke execute on function internal.unique_club_article_slug(uuid, text, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 8. Writing articles
-- ---------------------------------------------------------------------

create or replace function public.save_club_article(
  p_article_id uuid default null,
  p_club_id uuid default null,
  p_team_id uuid default null,
  p_title text default null,
  p_excerpt text default null,
  p_body text default null,
  p_category text default null,
  p_visibility text default null,
  p_hero_image_path text default null,
  p_hero_image_alt text default null
)
returns table (article_id uuid, article_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.club_articles;
  v_title text := btrim(coalesce(p_title, ''));
  v_excerpt text := nullif(btrim(coalesce(p_excerpt, '')), '');
  v_body text := coalesce(p_body, '');
  v_path text := nullif(btrim(coalesce(p_hero_image_path, '')), '');
  v_alt text := nullif(btrim(coalesce(p_hero_image_alt, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to write club news.' using errcode = '42501';
  end if;

  if p_article_id is null then
    if not internal.may_edit_club_content(p_club_id, p_team_id) then
      raise exception 'You do not have permission to write news here.' using errcode = '42501';
    end if;

    insert into public.club_articles (
      club_id, team_id, slug, title, excerpt, body, category, visibility,
      hero_image_path, hero_image_alt, created_by, updated_by
    )
    values (
      p_club_id, p_team_id, internal.unique_club_article_slug(p_club_id, v_title, null),
      v_title, v_excerpt, v_body, coalesce(p_category, 'NEWS'), coalesce(p_visibility, 'PUBLIC'),
      v_path, v_alt, auth.uid(), auth.uid()
    )
    returning * into r;
  else
    select * into r from public.club_articles where id = p_article_id for update;
    if not found then
      raise exception 'That article no longer exists.' using errcode = 'P0002';
    end if;
    if p_club_id is not null and p_club_id <> r.club_id then
      raise exception 'Club content cannot move to another club.' using errcode = '23514';
    end if;

    -- Editing a published article changes what the public reads straight
    -- away, so it is a publishing decision as well as an edit. Moving it to
    -- another team needs authority over where it is going, not just where it
    -- has been.
    if not internal.may_edit_club_content(r.club_id, r.team_id)
       or (r.team_id is distinct from p_team_id and not internal.may_edit_club_content(r.club_id, p_team_id))
       or (r.status = 'PUBLISHED' and not internal.may_publish_club_content(r.club_id, p_team_id)) then
      raise exception 'You do not have permission to edit this article.' using errcode = '42501';
    end if;

    update public.club_articles
    set team_id = p_team_id,
        title = v_title,
        excerpt = v_excerpt,
        body = v_body,
        category = coalesce(p_category, r.category),
        visibility = coalesce(p_visibility, r.visibility),
        hero_image_path = v_path,
        hero_image_alt = v_alt,
        -- Frozen once it has ever been public. See the column comment.
        slug = case
          when r.first_published_at is null and v_title <> r.title
            then internal.unique_club_article_slug(r.club_id, v_title, r.id)
          else r.slug
        end,
        updated_by = auth.uid()
    where id = r.id
    returning * into r;
  end if;

  article_id := r.id;
  article_slug := r.slug;
  return next;
end;
$$;

comment on function public.save_club_article is
  'Creates (p_article_id null) or edits a club or team article. Authority: internal.may_edit_club_content for the scope, plus may_publish_club_content when the article is already public. The slug follows the title until first publication, then never changes.';

create or replace function public.set_club_article_status(p_article_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.club_articles;
begin
  select * into r from public.club_articles where id = p_article_id for update;
  if not found then
    raise exception 'That article no longer exists.' using errcode = 'P0002';
  end if;
  if not internal.may_publish_club_content(r.club_id, r.team_id) then
    raise exception 'You do not have permission to publish or archive this article.' using errcode = '42501';
  end if;
  if p_status not in ('DRAFT', 'PUBLISHED', 'ARCHIVED') then
    raise exception 'That is not an article status.' using errcode = '22023';
  end if;

  -- Idempotent: publishing a published article is a no-op, not an error.
  if r.status = p_status then
    return r.status;
  end if;

  if p_status = 'PUBLISHED' then
    if char_length(btrim(r.body)) = 0 then
      raise exception 'Write the article before publishing it.' using errcode = '23514';
    end if;
    update public.club_articles
    set status = 'PUBLISHED',
        -- Restoring an archived article keeps the date it was first read on;
        -- publishing a draft is news today.
        published_at = case when r.status = 'ARCHIVED' then coalesce(r.published_at, now()) else now() end,
        first_published_at = coalesce(r.first_published_at, now()),
        archived_at = null,
        published_by = auth.uid(),
        updated_by = auth.uid()
    where id = r.id;
  elsif p_status = 'DRAFT' then
    update public.club_articles
    set status = 'DRAFT', published_at = null, archived_at = null, featured = false, updated_by = auth.uid()
    where id = r.id;
  else
    update public.club_articles
    set status = 'ARCHIVED', archived_at = now(), featured = false, updated_by = auth.uid()
    where id = r.id;
  end if;

  return p_status;
end;
$$;

comment on function public.set_club_article_status is
  'Publishes, unpublishes (back to draft) or archives an article. Requires internal.may_publish_club_content. Idempotent. Never deletes: an archived article leaves every public surface but stays in the club''s list.';

create or replace function public.set_club_article_featured(p_article_id uuid, p_featured boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.club_articles;
begin
  select * into r from public.club_articles where id = p_article_id for update;
  if not found then
    raise exception 'That article no longer exists.' using errcode = 'P0002';
  end if;
  -- The lead story sits at the top of the whole club's homepage, so choosing
  -- it is a club decision even for a team's article.
  if not internal.may_publish_club_content(r.club_id, null) then
    raise exception 'Only the club can choose its lead story.' using errcode = '42501';
  end if;
  if p_featured and r.status <> 'PUBLISHED' then
    raise exception 'Publish the article before making it the lead story.' using errcode = '23514';
  end if;

  if p_featured then
    update public.club_articles set featured = false, updated_by = auth.uid()
    where club_id = r.club_id and featured and id <> r.id;
  end if;
  update public.club_articles set featured = p_featured, updated_by = auth.uid() where id = r.id;
  return p_featured;
end;
$$;

comment on function public.set_club_article_featured is
  'Makes a published article the club''s one lead story, or stops it being so. Club authority only (club.news.manage).';

-- ---------------------------------------------------------------------
-- 9. Writing announcements
-- ---------------------------------------------------------------------

create or replace function public.save_club_announcement(
  p_announcement_id uuid default null,
  p_club_id uuid default null,
  p_team_id uuid default null,
  p_title text default null,
  p_body text default null,
  p_priority text default null,
  p_visibility text default null,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_link_label text default null,
  p_link_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.club_announcements;
  v_label text := nullif(btrim(coalesce(p_link_label, '')), '');
  v_url text := nullif(btrim(coalesce(p_link_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to write announcements.' using errcode = '42501';
  end if;

  if p_announcement_id is null then
    if not internal.may_edit_club_content(p_club_id, p_team_id) then
      raise exception 'You do not have permission to post announcements here.' using errcode = '42501';
    end if;
    insert into public.club_announcements (
      club_id, team_id, title, body, priority, visibility, starts_at, expires_at, link_label, link_url, created_by, updated_by
    )
    values (
      p_club_id, p_team_id, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_body, '')), ''),
      coalesce(p_priority, 'NORMAL'), coalesce(p_visibility, 'PUBLIC'), coalesce(p_starts_at, now()), p_expires_at,
      v_label, v_url, auth.uid(), auth.uid()
    )
    returning * into r;
  else
    select * into r from public.club_announcements where id = p_announcement_id for update;
    if not found then
      raise exception 'That announcement no longer exists.' using errcode = 'P0002';
    end if;
    if p_club_id is not null and p_club_id <> r.club_id then
      raise exception 'Club content cannot move to another club.' using errcode = '23514';
    end if;
    if not internal.may_edit_club_content(r.club_id, r.team_id)
       or (r.team_id is distinct from p_team_id and not internal.may_edit_club_content(r.club_id, p_team_id))
       or (r.status = 'PUBLISHED' and not internal.may_publish_club_content(r.club_id, p_team_id)) then
      raise exception 'You do not have permission to edit this announcement.' using errcode = '42501';
    end if;
    update public.club_announcements
    set team_id = p_team_id,
        title = btrim(coalesce(p_title, '')),
        body = nullif(btrim(coalesce(p_body, '')), ''),
        priority = coalesce(p_priority, r.priority),
        visibility = coalesce(p_visibility, r.visibility),
        starts_at = coalesce(p_starts_at, r.starts_at),
        expires_at = p_expires_at,
        link_label = v_label,
        link_url = v_url,
        updated_by = auth.uid()
    where id = r.id
    returning * into r;
  end if;

  return r.id;
end;
$$;

create or replace function public.set_club_announcement_status(p_announcement_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.club_announcements;
begin
  select * into r from public.club_announcements where id = p_announcement_id for update;
  if not found then
    raise exception 'That announcement no longer exists.' using errcode = 'P0002';
  end if;
  if not internal.may_publish_club_content(r.club_id, r.team_id) then
    raise exception 'You do not have permission to publish or archive this announcement.' using errcode = '42501';
  end if;
  if p_status not in ('DRAFT', 'PUBLISHED', 'ARCHIVED') then
    raise exception 'That is not an announcement status.' using errcode = '22023';
  end if;
  if r.status = p_status then
    return r.status;
  end if;
  if p_status = 'PUBLISHED' and r.expires_at is not null and r.expires_at <= now() then
    raise exception 'That announcement has already expired. Change the end date first.' using errcode = '23514';
  end if;

  update public.club_announcements
  set status = p_status,
      published_at = case when p_status = 'PUBLISHED' then now() when p_status = 'DRAFT' then null else r.published_at end,
      published_by = case when p_status = 'PUBLISHED' then auth.uid() else r.published_by end,
      archived_at = case when p_status = 'ARCHIVED' then now() else null end,
      updated_by = auth.uid()
  where id = r.id;
  return p_status;
end;
$$;

revoke execute on function public.save_club_article(uuid, uuid, uuid, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.set_club_article_status(uuid, text) from public, anon;
revoke execute on function public.set_club_article_featured(uuid, boolean) from public, anon;
revoke execute on function public.save_club_announcement(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text) from public, anon;
revoke execute on function public.set_club_announcement_status(uuid, text) from public, anon;
grant execute on function public.save_club_article(uuid, uuid, uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_club_article_status(uuid, text) to authenticated;
grant execute on function public.set_club_article_featured(uuid, boolean) to authenticated;
grant execute on function public.save_club_announcement(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.set_club_announcement_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Article images
-- ---------------------------------------------------------------------
--
-- Public to read (a shared article's image must load for anyone, and in a
-- link preview), never public to write. No SVG: an SVG is a document that
-- can carry script, and a public bucket would serve it from our origin.
-- Object paths are {club_id}/{team_id | club}/{uuid}.{ext}, so the folder
-- itself says whose authority an upload needs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-news-media', 'club-news-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function internal.may_manage_club_news_media(p_name text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  m text[];
begin
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(club|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  );
  if m is null then
    return false;
  end if;
  return internal.may_edit_club_content(m[1]::uuid, case when m[2] = 'club' then null else m[2]::uuid end);
end;
$$;

revoke execute on function internal.may_manage_club_news_media(text) from public, anon;
grant execute on function internal.may_manage_club_news_media(text) to authenticated;

create policy club_news_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'club-news-media' and internal.may_manage_club_news_media(name));

create policy club_news_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_club_news_media(name));

create policy club_news_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_club_news_media(name))
  with check (bucket_id = 'club-news-media' and internal.may_manage_club_news_media(name));

create policy club_news_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_club_news_media(name));

-- ---------------------------------------------------------------------
-- 11. Welcome to Ovalball
-- ---------------------------------------------------------------------
--
-- THE TRIGGER IS CLUB ESTABLISHMENT, NOT TEAM CREATION.
--
-- A club is established on Ovalball when first-run setup completes:
-- club_setup_state reaches COMPLETED, and public.complete_club_setup is the
-- only path there. clubs.status cannot be the signal -- every club is created
-- 'active' the moment a claim is approved, long before it has a crest, a kit
-- or a team. Teams are created and removed during and after setup and must
-- never produce a second welcome, so nothing here listens to teams at all.
--
-- IDEMPOTENT BY CONSTRUCTION, not by care: the unique index on
-- (club_id, system_key) means a retried completion, a replayed trigger or a
-- club that somehow completes twice all resolve to the one row. An article
-- the club has archived is still that row, so it is never re-created.
--
-- Clubs that completed setup before this migration are deliberately NOT
-- backfilled: "your club is new to Ovalball" would be untrue for a club that
-- has been here a season, and publishing it everywhere on deploy would be a
-- production content change nobody asked for.

create or replace function internal.ensure_club_welcome_article(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_author uuid;
  v_featured boolean;
  v_slug text;
begin
  select id into v_id from public.club_articles where club_id = p_club_id and system_key = 'WELCOME_TO_OVALBALL';
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(d.name, 'The club') into v_name
  from public.clubs c left join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;
  if not found then
    return null;
  end if;

  -- The one canonical system identity for content Ovalball authors
  -- (20270301000000). Attribution on the page comes from system_key.
  select id into v_author from auth.users where email = 'rugby-hub-content-import@system.ovalball.internal';

  -- Lead story only if the club has not already chosen one.
  select not exists (select 1 from public.club_articles where club_id = p_club_id and featured) into v_featured;

  v_slug := case
    when exists (select 1 from public.club_articles where club_id = p_club_id and slug = 'welcome-to-ovalball')
      then internal.unique_club_article_slug(p_club_id, 'Welcome to Ovalball', null)
    else 'welcome-to-ovalball'
  end;

  insert into public.club_articles (
    club_id, team_id, slug, title, excerpt, body, category, status, visibility, featured,
    system_key, published_at, first_published_at, created_by, updated_by, published_by
  )
  values (
    p_club_id, null, v_slug, 'Welcome to Ovalball',
    v_name || ' is now on Ovalball. Here is what that means for players, parents, supporters and the volunteers who run the club.',
    v_name || ' has joined Ovalball, and this page is now the club''s home online. Fixtures, results, teams and news here come straight from the club''s own records, so they stay up to date without anyone having to maintain a separate website.' || E'\n\n' ||
    '## For players, parents and supporters' || E'\n\n' ||
    '- **Fixtures and results.** Upcoming matches appear on this page once they are confirmed, and results follow when they are recorded.' || E'\n' ||
    '- **News from the club and its teams.** Match reports, events and updates are published here, and every article has its own link to share.' || E'\n' ||
    '- **The Rugby Hub.** The laws of the game, positions, a glossary, skills and guidance for parents and guardians, written in plain English. [Explore the Rugby Hub](/rugby-hub)' || E'\n\n' ||
    '## For members of the club' || E'\n\n' ||
    'Members sign in to Ovalball to see what belongs to them and their teams.' || E'\n\n' ||
    '- **Calendar.** Fixtures, training and club events for your teams in one place. [Open the Calendar](/calendar)' || E'\n' ||
    '- **Match Centre.** Every fixture has one page with the kick-off, the venue and who is available.' || E'\n' ||
    '- **Teams.** Every team at the club, with its coaches, players and families in the right place. [See your teams](/teams)' || E'\n' ||
    '- **Messages.** Announcements and conversations with the club and your teams. [Open Messages](/messages)' || E'\n\n' ||
    '## For the people who run the club' || E'\n\n' ||
    'Club and team administrators can publish news and announcements on this page whenever there is something to share. Ovalball wrote this welcome when the club finished setting up, and the club can edit or archive it at any time.',
    'WELCOME', 'PUBLISHED', 'PUBLIC', v_featured,
    'WELCOME_TO_OVALBALL', now(), now(), v_author, v_author, v_author
  )
  on conflict (club_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.club_articles where club_id = p_club_id and system_key = 'WELCOME_TO_OVALBALL';
  end if;
  return v_id;
end;
$$;

revoke execute on function internal.ensure_club_welcome_article(uuid) from public, anon, authenticated;

comment on function internal.ensure_club_welcome_article(uuid) is
  'Publishes the club''s one Welcome to Ovalball article if it does not already have one (archived counts as having one). Idempotent by the unique (club_id, system_key) index. Called only by the club_setup_state completion trigger.';

create or replace function internal.welcome_club_on_setup_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'COMPLETED' and (tg_op = 'INSERT' or old.status is distinct from 'COMPLETED') then
    perform internal.ensure_club_welcome_article(new.club_id);
  end if;
  return new;
end;
$$;

revoke execute on function internal.welcome_club_on_setup_completion() from public, anon, authenticated;

create trigger welcome_club_on_setup_completion
  after insert or update of status on public.club_setup_state
  for each row execute function internal.welcome_club_on_setup_completion();
