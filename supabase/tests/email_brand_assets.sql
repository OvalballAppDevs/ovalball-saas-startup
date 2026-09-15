-- The image library behind every Ovalball email.
--
-- The guarantee this exists to hold is narrow and worth stating plainly:
-- there is NO WAY, from any screen or any client, to make an Ovalball email
-- load an image from a host Ovalball does not control. Not because the input
-- is validated, but because no field anywhere accepts an address -- an
-- administrator uploads to Ovalball's own bucket and selects a stored path.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_count integer;
  v_ok boolean; v_err text;
  v_cols integer;
begin

-- ============ A. The setting holds a path, never a URL ============

select count(*) into v_cols
from information_schema.columns
where table_schema = 'public' and table_name = 'email_brand_settings'
  and column_name in ('active_logo_url', 'logo_url', 'image_url', 'src', 'href');

if v_cols = 0 then
  raise notice 'PASS 1 (A): there is no URL column, so no screen can express one';
else
  raise notice 'FAIL 1 (A): % URL-shaped column(s) exist on the brand settings', v_cols;
end if;

select count(*) into v_count
from information_schema.columns
where table_schema = 'public' and table_name = 'email_brand_settings'
  and column_name = 'active_logo_path';

if v_count = 1 then
  raise notice 'PASS 2 (A): the chosen image is recorded as a storage path';
else
  raise notice 'FAIL 2 (A): active_logo_path is missing';
end if;

-- Exactly one row, enforced by the database rather than by convention.
select count(*) into v_count from public.email_brand_settings;
if v_count = 1 then
  raise notice 'PASS 3 (A): exactly one brand settings row exists';
else
  raise notice 'FAIL 3 (A): found % brand settings rows', v_count;
end if;

begin
  insert into public.email_brand_settings (id) values ('second');
  v_ok := true;
exception when others then
  v_ok := false;
end;

if not v_ok then
  raise notice 'PASS 4 (A): a second brand row cannot be created';
else
  raise notice 'FAIL 4 (A): a second brand settings row was accepted';
end if;

-- ============ B. Only a Full Site Admin may change the logo ============

-- No authenticated user, so internal.is_full_site_admin() is false. This is
-- the anonymous case: the one an unauthenticated request would take.
begin
  perform public.set_email_brand_logo('logos/anything.png', 0);
  v_ok := true;
exception when others then
  v_ok := false; v_err := sqlerrm;
end;

if not v_ok and v_err like '%Full Site Admin%' then
  raise notice 'PASS 5 (B): a caller who is not a Full Site Admin cannot change the logo';
else
  raise notice 'FAIL 5 (B): allowed, or refused for the wrong reason (%)', coalesce(v_err, 'no error');
end if;

begin
  perform public.clear_email_brand_logo(0);
  v_ok := true;
exception when others then
  v_ok := false; v_err := sqlerrm;
end;

if not v_ok and v_err like '%Full Site Admin%' then
  raise notice 'PASS 6 (B): restoring the bundled logo is gated by the same authority';
else
  raise notice 'FAIL 6 (B): allowed, or refused for the wrong reason (%)', coalesce(v_err, 'no error');
end if;

-- ============ C. A chosen path must be a real uploaded object ============

-- Authority is checked first, so this asserts the check EXISTS rather than
-- exercising it as an admin. Without it the column is free text by another
-- name, and a typo silently breaks the logo on every email Ovalball sends.
select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_email_brand_logo'
  and pg_get_functiondef(p.oid) like '%storage.objects%'
  and pg_get_functiondef(p.oid) like '%email-brand%';

if v_count = 1 then
  raise notice 'PASS 7 (C): the chosen path is verified to exist in the email-brand bucket';
else
  raise notice 'FAIL 7 (C): set_email_brand_logo does not check the object exists';
end if;

-- ============ D. Nothing writes to the settings row directly ============

select count(*) into v_count
from pg_policies
where schemaname = 'public' and tablename = 'email_brand_settings'
  and cmd in ('INSERT', 'UPDATE', 'DELETE');

if v_count = 0 then
  raise notice 'PASS 8 (D): no direct write policy exists on the brand settings';
else
  raise notice 'FAIL 8 (D): % direct write policies exist', v_count;
end if;

select count(*) into v_count
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'email_brand_settings'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

if v_count = 0 then
  raise notice 'PASS 9 (D): clients hold no write grant on the brand settings';
else
  raise notice 'FAIL 9 (D): clients hold % write grants', v_count;
end if;

-- ============ E. The bucket only accepts what email can render ============

select count(*) into v_count
from storage.buckets
where id = 'email-brand'
  and 'image/svg+xml' <> all(allowed_mime_types);

if v_count = 1 then
  raise notice 'PASS 10 (E): SVG is refused -- a script-bearing format no mail client renders';
else
  raise notice 'FAIL 10 (E): the email-brand bucket accepts SVG';
end if;

select count(*) into v_count
from storage.buckets where id = 'email-brand' and file_size_limit = 1572864;

if v_count = 1 then
  raise notice 'PASS 11 (E): uploads are capped at 1.5 MiB by the bucket, not merely in the browser';
else
  raise notice 'FAIL 11 (E): the email-brand bucket limit is not the expected 1572864 bytes';
end if;

-- ============ F. Only a Full Site Admin may upload ============

select count(*) into v_count
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'email_brand_%'
  and cmd in ('INSERT', 'UPDATE', 'DELETE')
  -- coalesce BOTH: an INSERT policy has no USING clause, so `qual` is null
  -- and a bare concatenation yields null rather than the WITH CHECK text.
  and coalesce(qual, '') || coalesce(with_check, '') like '%is_full_site_admin%';

if v_count = 3 then
  raise notice 'PASS 12 (F): insert, update and delete on the bucket all require a Full Site Admin';
else
  raise notice 'FAIL 12 (F): only % of 3 write policies check Full Site Admin', v_count;
end if;

-- ============ G. Concurrency is checked ============

select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_email_brand_logo', 'clear_email_brand_logo')
  and pg_get_function_arguments(p.oid) like '%p_expected_lock%'
  and p.prosecdef;

if v_count = 2 then
  raise notice 'PASS 13 (G): both write functions are SECURITY DEFINER and refuse a stale editor';
else
  raise notice 'FAIL 13 (G): only % of 2 write functions are properly guarded', v_count;
end if;


-- ============ H. A recipient can actually see the chosen logo ============

-- THE REGRESSION THIS PINS DOWN.
--
-- The endpoint that serves the logo into an email is fetched by a mail client
-- with no session. It once read email_brand_settings under the caller's own
-- authority, got nothing back, and fell back to the bundled logo -- so every
-- recipient received the placeholder while Site Admin displayed the chosen
-- image and reported success, because an administrator's own browser DOES
-- send cookies. The only person able to notice was the only person guaranteed
-- not to, which is why this is asserted as anon rather than as a superuser.

declare
  v_expected text;
  v_anon_path text;
  v_anon_row integer;
begin
  select active_logo_path into v_expected from public.email_brand_settings where id = 'brand';

  set local role anon;
  select public.active_email_logo_path() into v_anon_path;
  reset role;

  if v_anon_path is not distinct from v_expected then
    raise notice 'PASS 14 (H): a caller with no session reads the same chosen logo the setting names';
  else
    raise notice 'FAIL 14 (H): anon reads %, the setting says %', coalesce(v_anon_path, 'null'), coalesce(v_expected, 'null');
  end if;

  -- The function is the ONLY thing that got public: the row itself, with who
  -- changed the logo and when, stays Site Admin's business.
  begin
    set local role anon;
    select count(*) into v_anon_row from public.email_brand_settings;
    reset role;
  exception when insufficient_privilege then
    v_anon_row := 0;
  end;

  if v_anon_row = 0 then
    raise notice 'PASS 15 (H): the settings row itself is still not readable without a session';
  else
    raise notice 'FAIL 15 (H): an anonymous caller can read % settings row(s)', v_anon_row;
  end if;
end;

end $$;

rollback;
