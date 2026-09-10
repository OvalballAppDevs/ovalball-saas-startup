-- A Full Site Admin can change the logo on every Ovalball email, from a screen.
--
-- WHY THIS IS NOT SIMPLY AN EDITABLE URL FIELD
--
-- The logo sits at the top of an email that is correctly branded, correctly
-- authenticated, and arrives from a domain the recipient already trusts. A
-- free-text URL field would let whoever controls that field point every one of
-- those emails at a host they own: a read receipt on every recipient at best,
-- and somebody else's imagery under Ovalball's name at worst.
--
-- So there is no URL anywhere in this design. An administrator uploads a file
-- to Ovalball's own bucket and SELECTS one of the uploaded files. What is
-- stored is a storage PATH inside a known bucket, never an address.
--
-- WHY THE EMAIL STILL POINTS AT A STATIC URL
--
-- The rendered HTML always references one unchanging Ovalball URL, and a route
-- on Ovalball's own origin decides which bytes to serve. Three things fall out
-- of that, all of which matter:
--
--   1. The renderer stays synchronous and needs no database access, so the
--      shared shell has no idea any of this exists.
--   2. Every href and img src in an Ovalball email still resolves to
--      Ovalball's own origin, which is the invariant the whole email system is
--      built on.
--   3. An email sent last year keeps working, because its URL never referred
--      to a particular file in the first place.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-brand', 'email-brand', true, 1048576,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- public=true matches club-logos, and is not the security boundary: the route
-- that serves these to recipients proxies them through Ovalball's own origin
-- regardless, and WRITE access is restricted below. A logo is not a secret.
--
-- SVG IS DELIBERATELY ABSENT from the mime list, unlike club-logos. An SVG is
-- a script-bearing document, no email client renders it reliably, and this
-- bucket exists only to feed email. Accepting one would add a stored-XSS
-- surface to buy a format that cannot be used.

create policy email_brand_select_public on storage.objects for select
  using (bucket_id = 'email-brand');

create policy email_brand_insert_full_site_admin on storage.objects for insert
  to authenticated
  with check (bucket_id = 'email-brand' and internal.is_full_site_admin());

create policy email_brand_update_full_site_admin on storage.objects for update
  to authenticated
  using (bucket_id = 'email-brand' and internal.is_full_site_admin());

create policy email_brand_delete_full_site_admin on storage.objects for delete
  to authenticated
  using (bucket_id = 'email-brand' and internal.is_full_site_admin());

-- ---------------------------------------------------------------------------
-- Which uploaded file is currently the logo
-- ---------------------------------------------------------------------------

create table if not exists public.email_brand_settings (
  -- One row, ever. The check constraint is what makes that true rather than
  -- a convention somebody has to remember.
  id text primary key default 'brand' check (id = 'brand'),

  /**
   * The chosen object's path inside the email-brand bucket, or NULL for
   * "use the logo committed in the repository".
   *
   * A PATH, not a URL. Nothing in this system can be made to point outside
   * Ovalball, because there is no field in which to express that.
   */
  active_logo_path text,

  /** Optimistic concurrency, exactly as the template registry uses it. */
  lock_version integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.email_brand_settings is
  'Which uploaded file is the logo on every transactional email. Stores a storage path, never a URL -- see the migration header for why that distinction is the whole design.';

comment on column public.email_brand_settings.active_logo_path is
  'Path within the email-brand bucket. NULL means the repository default is served.';

insert into public.email_brand_settings (id) values ('brand') on conflict (id) do nothing;

alter table public.email_brand_settings enable row level security;

-- Readable by any Site Admin; writable by nobody directly. Every change goes
-- through the authority-checked functions below.
create policy email_brand_settings_select_site_admin on public.email_brand_settings
  for select to authenticated using (internal.is_site_admin());

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

/**
 * Chooses which uploaded file becomes the logo.
 *
 * The path is verified to exist in the email-brand bucket before it is
 * accepted. Without that check the field is a free-text string again by
 * another name, and a typo silently breaks the logo on every email Ovalball
 * sends with nothing to say what happened.
 */
create or replace function public.set_email_brand_logo(
  p_path text,
  p_expected_lock integer
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock integer;
  v_previous text;
begin
  perform internal.assert_may_manage_email_templates();

  if p_path is null or btrim(p_path) = '' then
    raise exception 'Choose an image, or restore Ovalball''s own logo.';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'email-brand' and name = p_path
  ) then
    raise exception 'That image is no longer in Ovalball''s email library.';
  end if;

  select lock_version, active_logo_path into v_lock, v_previous
  from public.email_brand_settings where id = 'brand' for update;

  if v_lock is distinct from p_expected_lock then
    raise exception 'The email logo has been changed by someone else since you opened this page. Reload to see the current version.'
      using errcode = 'P0001';
  end if;

  update public.email_brand_settings
  set active_logo_path = p_path,
      lock_version = lock_version + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'brand';

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('email_brand_settings', null, 'update', auth.uid(),
          jsonb_build_object('active_logo_path', v_previous),
          jsonb_build_object('active_logo_path', p_path, 'event', 'EMAIL_BRAND_LOGO_CHANGED'));
end;
$function$;

comment on function public.set_email_brand_logo(text, integer) is
  'Points every transactional email at one of the uploaded brand images. Takes a storage path that must already exist, never a URL.';

/**
 * Goes back to the logo committed in the repository.
 *
 * The uploaded files are NOT deleted. Reverting is a decision about which
 * image is live, and an operator who reverts by accident should be one click
 * from undoing it.
 */
create or replace function public.clear_email_brand_logo(
  p_expected_lock integer
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock integer;
  v_previous text;
begin
  perform internal.assert_may_manage_email_templates();

  select lock_version, active_logo_path into v_lock, v_previous
  from public.email_brand_settings where id = 'brand' for update;

  if v_lock is distinct from p_expected_lock then
    raise exception 'The email logo has been changed by someone else since you opened this page. Reload to see the current version.'
      using errcode = 'P0001';
  end if;

  update public.email_brand_settings
  set active_logo_path = null,
      lock_version = lock_version + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 'brand';

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('email_brand_settings', null, 'update', auth.uid(),
          jsonb_build_object('active_logo_path', v_previous),
          jsonb_build_object('active_logo_path', null, 'event', 'EMAIL_BRAND_LOGO_RESTORED'));
end;
$function$;

comment on function public.clear_email_brand_logo(integer) is
  'Restores the repository logo. Uploaded images are kept, so the change is reversible.';

-- Clients hold no write grant on the settings row, for the same reason the
-- template registry holds none: RLS with no write policy already refuses the
-- write, but TRUNCATE is not filtered by RLS at all.
revoke insert, update, delete, truncate, references, trigger
  on public.email_brand_settings from anon, authenticated;

-- Verification. A migration that silently did nothing would leave exactly the
-- state it was written to fix.
do $$
declare
  v_grants integer;
  v_row integer;
begin
  select count(*) into v_grants
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'email_brand_settings'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_grants > 0 then
    raise exception 'email_brand_settings still carries % client write grants.', v_grants;
  end if;

  select count(*) into v_row from public.email_brand_settings;
  if v_row <> 1 then
    raise exception 'email_brand_settings should hold exactly one row, found %.', v_row;
  end if;
end $$;
