-- The chosen email logo must be readable by somebody with no account at all.
--
-- THE BUG THIS FIXES
--
-- email_brand_settings is readable only by a Site Admin, which is right for a
-- configuration table. But the endpoint that serves the logo into an email is
-- fetched by a MAIL CLIENT: no session, no cookies, no account. It read the
-- setting under the caller's own authority, got nothing, and quietly fell back
-- to the logo bundled with the application.
--
-- So every recipient received the placeholder while Site Admin displayed the
-- chosen image and said "A custom image is on every email" -- because an
-- administrator loading that page DOES send cookies, and their own read
-- succeeds. The one person positioned to notice was the one person guaranteed
-- not to.
--
-- WHY A FUNCTION RATHER THAN A READ POLICY FOR anon
--
-- A policy would expose the whole row: who changed the logo, when, and the
-- lock version. None of that is anybody's business who is merely rendering an
-- email. This returns the single value the endpoint needs -- a path -- and
-- nothing else, which is the smallest thing that can be public here.

create or replace function public.active_email_logo_path()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select active_logo_path from public.email_brand_settings where id = 'brand';
$function$;

comment on function public.active_email_logo_path() is
  'The chosen email logo''s storage path, or null for the bundled one. Readable without a session because mail clients fetch images anonymously; exposes the path alone, never the settings row.';

-- Deliberately granted to anon: a recipient opening an email is not signed in.
grant execute on function public.active_email_logo_path() to anon, authenticated;

-- Verification. The whole point is that a caller with no session can read it,
-- so the migration proves exactly that rather than assuming it.
do $$
declare
  v_seen text;
  v_expected text;
begin
  select active_logo_path into v_expected from public.email_brand_settings where id = 'brand';

  set local role anon;
  select public.active_email_logo_path() into v_seen;
  reset role;

  if v_seen is distinct from v_expected then
    raise exception 'An anonymous caller reads % but the setting is %.',
      coalesce(v_seen, 'null'), coalesce(v_expected, 'null');
  end if;
end $$;
