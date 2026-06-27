-- =============================================================================
-- Email reminder cycle support
-- Run once in Supabase SQL Editor before enabling the enhanced reminder cron.
--
-- Adds reminder_key + cycle_key so the cron can avoid duplicate emails for the
-- same inspection, item, or action within the same daily reminder cycle.
-- =============================================================================

begin;

alter table public.reminder_logs
  add column if not exists reminder_key text
    check (reminder_key is null or char_length(reminder_key) <= 160);

alter table public.reminder_logs
  add column if not exists cycle_key text
    check (cycle_key is null or char_length(cycle_key) <= 40);

alter table public.reminder_logs
  drop constraint if exists reminder_logs_reminder_type_check;

alter table public.reminder_logs
  add constraint reminder_logs_reminder_type_check
  check (reminder_type in (
    'due_soon',
    'overdue',
    'inspection_due_soon',
    'inspection_overdue',
    'item_due_soon',
    'item_overdue',
    'action_required'
  ));

create index if not exists idx_reminder_logs_cycle
  on public.reminder_logs (reminder_type, reminder_key, cycle_key, status);

notify pgrst, 'reload schema';

commit;
