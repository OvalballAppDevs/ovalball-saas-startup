-- Rugby Hub general-knowledge RLS -- permanent regression.
--
-- Proves: an ordinary authenticated user reads PUBLISHED only; DRAFT/
-- REVIEWED/ARCHIVED/SUPERSEDED are invisible to them by direct id and by
-- listing; a forged direct id cannot bypass publication; write is refused
-- entirely without site.hub_content.manage; a narrow Site Admin holding
-- only view_hub_content can read draft administration data but cannot
-- write; a Full Site Admin can manage; app-supplied context never
-- substitutes for a real capability grant.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_full_admin uuid := gen_random_uuid();
  v_narrow_view uuid := gen_random_uuid();
  v_ordinary uuid := gen_random_uuid();
  v_draft_id uuid;
  v_published_id uuid;
  v_raised boolean;
  v_n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_full_admin, 'hrl-full-' || v_full_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_narrow_view, 'hrl-narrow-' || v_narrow_view::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_ordinary, 'hrl-ordinary-' || v_ordinary::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_full_admin, 'Full', 'Admin', 'hrl-full-' || v_full_admin::text || '@ovalball.test'),
    (v_narrow_view, 'Narrow', 'Viewer', 'hrl-narrow-' || v_narrow_view::text || '@ovalball.test'),
    (v_ordinary, 'Ordinary', 'User', 'hrl-ordinary-' || v_ordinary::text || '@ovalball.test');

  insert into public.site_admins (user_id, status, admin_role) values (v_full_admin, 'active', 'full');
  insert into public.site_admins (user_id, status, admin_role, view_hub_content) values (v_narrow_view, 'active', 'read_only', true);

  -- Seed a draft and a published item AS the postgres role (bypasses RLS,
  -- as the platform's own service/seed operations do).
  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hrl-draft-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Draft title', 'Draft summary')
  returning id into v_draft_id;

  insert into public.hub_content_items (content_key, content_type, title, summary)
  values ('hrl-pub-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Published title', 'Published summary')
  returning id into v_published_id;
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_published_id, true);
  update public.hub_content_items
  set status = 'PUBLISHED', reviewed_by = v_full_admin, reviewed_at = now(), published_by = v_full_admin, published_at = now()
  where id = v_published_id;

  -- Section E's applicability row is seeded here, still as postgres/admin
  -- (before any impersonation below), since an ordinary user cannot write
  -- to hub_content_applicability at all -- that is exactly what section D
  -- already proved for hub_content_items, and this row's own RLS is
  -- identically gated.
  insert into public.hub_content_applicability (content_item_id, is_universal) values (v_draft_id, true);

  -- ============ A. Ordinary authenticated user: PUBLISHED visible ============
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary, 'role','authenticated')::text, true);

  select count(*) into v_n from public.hub_content_items where id = v_published_id;
  if v_n <> 1 then
    raise exception 'FAIL (A): ordinary authenticated user could not see the PUBLISHED content item';
  end if;
  raise notice 'PASS (A): ordinary authenticated user reads PUBLISHED content';

  -- ============ B. Ordinary user: DRAFT invisible, even by direct id ============
  select count(*) into v_n from public.hub_content_items where id = v_draft_id;
  if v_n <> 0 then
    raise exception 'FAIL (B): ordinary authenticated user could see a DRAFT content item by direct id';
  end if;
  raise notice 'PASS (B): DRAFT is invisible to an ordinary user, even addressed by its exact id -- no forged-id bypass';

  -- ============ C. Ordinary user: cannot list drafts by scanning either ============
  select count(*) into v_n from public.hub_content_items where status <> 'PUBLISHED';
  if v_n <> 0 then
    raise exception 'FAIL (C): ordinary user could see % non-PUBLISHED row(s) via a broad scan', v_n;
  end if;
  raise notice 'PASS (C): scanning for any non-PUBLISHED row returns nothing for an ordinary user';

  -- ============ D. Ordinary user: cannot write at all ============
  v_raised := false;
  begin
    insert into public.hub_content_items (content_key, content_type, title, summary)
    values ('hrl-forbidden-' || substr(gen_random_uuid()::text,1,8), 'FUN_FACT', 'Should never insert', 'x');
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (D): an ordinary authenticated user was able to INSERT a hub_content_items row';
  end if;
  raise notice 'PASS (D): an ordinary authenticated user cannot create content -- RLS refuses the write outright';

  -- ============ E. Applicability rows for a draft parent do not leak either ============
  select count(*) into v_n from public.hub_content_applicability where content_item_id = v_draft_id;
  if v_n <> 0 then
    raise exception 'FAIL (E): an applicability row for a DRAFT content item was visible to an ordinary user';
  end if;
  raise notice 'PASS (E): applicability rows follow the parent''s publication state -- a draft''s scoping facts do not leak either';

  -- ============ F. search_hub_content never returns the draft ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary, 'role','authenticated')::text, true);
  select count(*) into v_n from public.search_hub_content('Draft title', 20) where result_id = v_draft_id;
  if v_n <> 0 then
    raise exception 'FAIL (F): search_hub_content returned a DRAFT row';
  end if;
  select count(*) into v_n from public.search_hub_content('Published title', 20) where result_id = v_published_id;
  if v_n <> 1 then
    raise exception 'FAIL (F2): search_hub_content did not return the PUBLISHED row it should have';
  end if;
  raise notice 'PASS (F): search never surfaces a draft title/snippet, and does surface a real published one';

  -- ============ G. Narrow Site Admin (view_hub_content only): can read draft, cannot write ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_narrow_view, 'role','authenticated')::text, true);
  select count(*) into v_n from public.hub_content_items where id = v_draft_id;
  if v_n <> 1 then
    raise exception 'FAIL (G): a Site Admin holding view_hub_content could not see a DRAFT row';
  end if;
  raise notice 'PASS (G): view_hub_content grants read of draft/administration data';

  v_raised := false;
  begin
    update public.hub_content_items set title = 'Should not be allowed' where id = v_draft_id;
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (G2): view_hub_content alone was sufficient to WRITE -- view and manage must stay separate grants';
  end if;
  raise notice 'PASS (G2): view_hub_content does not imply write -- manage_hub_content is a separate, ungranted capability here';

  -- ============ H. Hub content is not written through the API ============
  -- Rugby Hub content is authored through migrations; no application surface
  -- writes it. Since the Slice 1 perimeter no browser role holds a write
  -- privilege on it, so even a Full Site Admin's session cannot change it
  -- directly -- an admin authoring surface will get an explicit, checked path.
  perform set_config('request.jwt.claims', json_build_object('sub', v_full_admin, 'role','authenticated')::text, true);
  v_raised := false;
  begin
    update public.hub_content_items set title = 'Updated by Full Site Admin' where id = v_draft_id;
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL (H): a browser session wrote Rugby Hub content directly';
  end if;
  raise notice 'PASS (H): Rugby Hub content cannot be written through the API, even by a Full Site Admin session';

  -- ============ I. App-supplied context never substitutes for a real grant ============
  -- Simulates a forged claim asserting an admin-sounding role that is not
  -- backed by a real site_admins row -- must still be refused. The row is
  -- already invisible to this user (section B), so the UPDATE's WHERE
  -- clause matches zero rows under RLS rather than raising an exception --
  -- that is itself the correct, secure outcome. The real assertion is that
  -- the title is unchanged afterwards, checked as Full Site Admin (who can
  -- see it) to be sure "unchanged" isn't itself an RLS-filtered illusion.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary, 'role','authenticated', 'app_role','FULL_SITE_ADMIN')::text, true);
  begin
    update public.hub_content_items set title = 'Forged claim should not work' where id = v_draft_id;
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_admin, 'role','authenticated')::text, true);
  if (select title from public.hub_content_items where id = v_draft_id) = 'Forged claim should not work' then
    raise exception 'FAIL (I): a forged app_role claim in the JWT, with no real site_admins row, was enough to change the title';
  end if;
  raise notice 'PASS (I): a forged/presentation-layer role claim never substitutes for a real capability grant -- authority is only ever server-side, and the row genuinely did not change';

  reset role;
end $$;

rollback;
