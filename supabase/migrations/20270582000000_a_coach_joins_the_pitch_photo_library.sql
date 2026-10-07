-- TRAINING PLANNING PAGE 3 HERO CORRECTION -- adds one newly-accepted Higgsfield asset
-- ("training-coaching-01": a coach actively coaching two players, replacing the previous
-- empty-pitch hero) to set_pitch_cover's own allow-list. This is a plain re-create of the
-- function (20270580000000) with one more key in the array -- the function was already
-- applied locally, so it is extended rather than hand-edited in place.

create or replace function public.set_pitch_cover(p_pitch_id uuid, p_storage_path text, p_stock_key text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where club_pitches.id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.' using errcode = 'P0002';
  end if;

  if not internal.can_manage_pitch(v_club_id) then
    raise exception 'Not authorized to change this pitch''s cover photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/pitch-' || p_pitch_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this pitch.' using errcode = '22023';
  end if;

  if p_stock_key is not null and not (p_stock_key = any(array[
    'pitch-match-02', 'pitch-training-02', 'pitch-wet-weather-02', 'pitch-shared-training-02', 'pitch-floodlit-02', 'training-hero-02', 'training-evening-01', 'training-coaching-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.club_pitches set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_pitch_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('club_pitches', p_pitch_id, 'update', auth.uid(), jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$$;

revoke execute on function public.set_pitch_cover(uuid, text, text) from public, anon;
grant execute on function public.set_pitch_cover(uuid, text, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.set_pitch_cover(uuid, text, text)', 'EXECUTE') then
    raise exception 'set_pitch_cover must not be executable by anon';
  end if;
end $$;
