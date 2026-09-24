-- ===========================================================================
-- THE CLUB PROFILE IS A DOMAIN OPERATION (CA-M1)
-- ===========================================================================
--
-- Ovalball is one product with two clients. The website's Club Profile page wrote `clubs.bio`,
-- `clubs.website`, `clubs.facebook_url`, `clubs.address_display` and the `club_contacts` rows
-- directly from a server action, trusting RLS (`clubs_update_admin`, `club_contacts_*_admin` --
-- both `club.profile.edit`) as the whole boundary, with the trimming and the "name is required"
-- rule living in the action. A second client would have had to carry a second copy of that
-- validation, and two copies drift.
--
-- OWNER DECISION 3 -- DOMAIN OPERATION FIRST. These three operations are now the one way either
-- client changes the profile:
--
--   update_club_profile(club, bio, website, facebook, address)
--   save_club_contact(club, contact?, role, name, phone, email, is_public)   -> contact id
--   delete_club_contact(contact)
--
-- SAME AUTHORITY. Each asks exactly what the row policies ask: a live, AAL-satisfied, active
-- session (`internal.session_ok`, the `session_ok_required` policy the direct write met), then
-- `club.profile.edit` at the club through the canonical engine (`internal.can`) or the site master
-- `site.clubs.profile.manage`. A refusal is 42501, as the policy's would have been. Nothing is
-- broadened: `club.profile.edit` is an A2 capability with no recent-authenticator requirement, and
-- the catalogue is not touched here (the R convergence list is docs/mobile/RECENT_AUTH_CONVERGENCE.md).
--
-- SAME VALIDATION. Whitespace is trimmed and an empty field is stored as null (what the website did);
-- a contact needs a name and a role from the check constraint; an email must look like one; a
-- website or Facebook address without a scheme is given https://; a contact being edited must
-- belong to the club named. All of it in one place, with 22023 for a bad value and P0002 for a
-- row that is not there.
--
-- SAME AUDIT. The row triggers (`internal.audit_row_change` on clubs and club_contacts) record the
-- change with the acting person, exactly as they did for the direct write -- one history, whichever
-- client made the change. `updated_by` is set to the actor, which the website's direct update never
-- did.
--
-- The row policies stay. The RPCs are the product's path; the policies remain the floor.
-- Forward-only, no data changed.
-- ===========================================================================

create or replace function internal.require_club_profile_editor(p_club_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not (internal.can('club.profile.edit', 'club', p_club_id, null, null) or internal.has_site_capability('site.clubs.profile.manage')) then
    raise exception 'You do not have permission to change this club''s profile.' using errcode = '42501';
  end if;
end;
$function$;

comment on function internal.require_club_profile_editor(uuid) is
  'The one authority question the club-profile domain operations ask: a live, active, AAL-satisfied session holding club.profile.edit at the club (or the site master). Raises 42501 otherwise -- the same answer the row policies give a direct write.';

-- A web address as a person types one: trimmed, empty -> null, given https:// when no scheme was typed.
create or replace function internal.tidy_web_address(p_value text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when nullif(btrim(coalesce(p_value, '')), '') is null then null
    when btrim(p_value) ~* '^[a-z][a-z0-9+.-]*://' then btrim(p_value)
    else 'https://' || btrim(p_value)
  end;
$function$;

create or replace function public.update_club_profile(
  p_club_id uuid,
  p_bio text,
  p_website text,
  p_facebook_url text,
  p_address_display text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_website text := internal.tidy_web_address(p_website);
  v_facebook text := internal.tidy_web_address(p_facebook_url);
  v_address text := nullif(btrim(coalesce(p_address_display, '')), '');
  v_n int;
begin
  perform internal.require_club_profile_editor(p_club_id);

  if length(v_bio) > 4000 then raise exception 'Keep the club introduction to 4,000 characters or fewer.' using errcode = '22023'; end if;
  if length(v_website) > 500 or length(v_facebook) > 500 then raise exception 'That web address is too long.' using errcode = '22023'; end if;
  if length(v_address) > 500 then raise exception 'Keep the home ground address to 500 characters or fewer.' using errcode = '22023'; end if;

  update public.clubs
  set bio = v_bio,
      website = v_website,
      facebook_url = v_facebook,
      address_display = v_address,
      updated_by = auth.uid()
  where id = p_club_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
end;
$function$;

comment on function public.update_club_profile(uuid, text, text, text, text) is
  'The club''s own introduction, website, Facebook and home-ground address line -- the four profile fields the website''s Club Profile page edits. Requires club.profile.edit at the club (see internal.require_club_profile_editor). Trims, stores empty as null, gives a web address its scheme. Audited by the clubs row trigger.';

create or replace function public.save_club_contact(
  p_club_id uuid,
  p_contact_id uuid default null,
  p_role text default null,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_is_public boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id uuid;
begin
  perform internal.require_club_profile_editor(p_club_id);

  if v_name is null then raise exception 'A name is required.' using errcode = '22023'; end if;
  if length(v_name) > 120 then raise exception 'Keep the name to 120 characters or fewer.' using errcode = '22023'; end if;
  if p_role is null or p_role not in ('fixture_secretary', 'minis_secretary', 'general') then
    raise exception 'Choose a contact role.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;
  if length(v_phone) > 40 or length(v_email) > 254 then raise exception 'That contact detail is too long.' using errcode = '22023'; end if;

  if p_contact_id is null then
    insert into public.club_contacts (club_id, role, name, phone, email, is_public, created_by, updated_by)
    values (p_club_id, p_role, v_name, v_phone, v_email, coalesce(p_is_public, false), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.club_contacts
    set role = p_role, name = v_name, phone = v_phone, email = v_email, is_public = coalesce(p_is_public, false), updated_by = auth.uid()
    where id = p_contact_id and club_id = p_club_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Contact not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$function$;

comment on function public.save_club_contact(uuid, uuid, text, text, text, text, boolean) is
  'Create (p_contact_id null) or edit one of the club''s public-facing contacts. Requires club.profile.edit at the club. A contact being edited must belong to the club named. Returns the contact id. Audited by the club_contacts row trigger.';

create or replace function public.delete_club_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid;
begin
  select c.club_id into v_club from public.club_contacts c where c.id = p_contact_id;
  if v_club is null then
    raise exception 'Contact not found.' using errcode = 'P0002';
  end if;
  perform internal.require_club_profile_editor(v_club);
  delete from public.club_contacts where id = p_contact_id;
end;
$function$;

comment on function public.delete_club_contact(uuid) is
  'Remove one of the club''s contacts. Requires club.profile.edit at the contact''s club. Audited by the club_contacts row trigger.';

revoke execute on function internal.require_club_profile_editor(uuid) from public, anon, authenticated;
revoke execute on function internal.tidy_web_address(text) from public, anon, authenticated;
revoke execute on function public.update_club_profile(uuid, text, text, text, text) from public, anon;
revoke execute on function public.save_club_contact(uuid, uuid, text, text, text, text, boolean) from public, anon;
revoke execute on function public.delete_club_contact(uuid) from public, anon;
grant execute on function public.update_club_profile(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.save_club_contact(uuid, uuid, text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.delete_club_contact(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.update_club_profile(uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_club_contact(uuid, uuid, text, text, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_club_contact(uuid)', 'EXECUTE') then
    raise exception 'club profile domain operations must not be executable by anon';
  end if;
  if internal.tidy_web_address('  www.example.org ') <> 'https://www.example.org'
     or internal.tidy_web_address('http://example.org') <> 'http://example.org'
     or internal.tidy_web_address('   ') is not null then
    raise exception 'tidy_web_address does not behave';
  end if;
  -- the audit triggers the operations rely on are present
  if not exists (select 1 from pg_trigger where tgrelid = 'public.clubs'::regclass and tgname = 'audit_row_change')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.club_contacts'::regclass and tgname = 'audit_row_change') then
    raise exception 'the club profile tables must carry the audit row trigger';
  end if;
end $$;
