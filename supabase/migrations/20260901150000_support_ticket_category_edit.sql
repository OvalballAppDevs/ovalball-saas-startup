-- Mirrors update_support_ticket_status exactly, but for category --
-- the Support Register's second inline-editable field. Manage-level Site
-- Admin only (same internal.can_manage_support() gate as every other
-- mutation on a ticket); every change is captured by the same generic
-- audit_row_change trigger already on support_tickets, so no separate
-- event/audit bookkeeping is needed here the way status changes need a
-- timeline entry (a category correction isn't part of the requester-facing
-- story the way a status change is).
create or replace function public.update_support_ticket_category(p_ticket_id uuid, p_new_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.can_manage_support() then
    raise exception 'Not authorized to change support ticket category.' using errcode = '42501';
  end if;
  if p_new_category not in (
    'account_login', 'club_management', 'teams', 'fixtures', 'results', 'messages', 'partner_clubs',
    'calendar', 'documents', 'permissions_users', 'bug', 'feature_question', 'data_club_information',
    'privacy_account_data', 'other'
  ) then
    raise exception 'Invalid category.';
  end if;

  update public.support_tickets set category = p_new_category where id = p_ticket_id;
  if not found then
    raise exception 'Support ticket not found.';
  end if;
end;
$$;
