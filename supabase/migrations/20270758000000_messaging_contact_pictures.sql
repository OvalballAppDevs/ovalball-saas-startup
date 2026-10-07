-- =====================================================================================================================
-- MESSAGING CONTACT PICTURES
--
-- A direct conversation and the New Message list showed initials for everybody, because a person's picture path
-- lives on `profiles`, which only its owner can read, and no messaging function returned it. This answers it --
-- and nothing else -- for exactly the people the caller already messages or may message:
--   * the other person in one of my direct conversations, while neither of us blocks the other, or
--   * somebody `internal.may_direct_message` would let me start a conversation with (which is adults only,
--     never across a block, and only where Ovalball knows a relationship).
-- Both are adults, so the avatars bucket's own policy (`can_view_account_avatar`) already lets the caller sign the
-- file; this only says where it is. No name, email or anything else is returned.
-- =====================================================================================================================

create or replace function public.my_contact_avatars(p_user_ids uuid[])
 returns table(user_id uuid, avatar_storage_path text)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  perform internal.require_live_session();
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return query
  select p.id, p.avatar_storage_path
    from public.profiles p
   where p.id = any((coalesce(p_user_ids, '{}'::uuid[]))[1:200])
     and p.id <> v_uid
     and p.avatar_storage_path is not null
     and internal.is_adult_messaging_user(p.id)
     and not internal.is_personally_blocked(v_uid, p.id)
     and not internal.is_personally_blocked(p.id, v_uid)
     and (
       exists (
         select 1 from public.direct_conversations d
          where d.user_a = least(v_uid, p.id) and d.user_b = greatest(v_uid, p.id)
       )
       or internal.may_direct_message(p.id)
     );
end;
$function$;

revoke all on function public.my_contact_avatars(uuid[]) from public, anon;
grant execute on function public.my_contact_avatars(uuid[]) to authenticated;
