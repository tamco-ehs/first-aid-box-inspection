-- =============================================================================
-- Box expiry start date
--
-- Adds an optional manual baseline date for inspection expiry counting.
-- When set, reminder/due logic counts from the later of:
--   - latest inspection date
--   - box_expiry_start_date
-- If blank, the system falls back to the original box created_at behavior.
-- =============================================================================

alter table public.boxes
  add column if not exists box_expiry_start_date date;

comment on column public.boxes.box_expiry_start_date is
  'Optional manual baseline date for box inspection expiry counting. Latest inspection date still wins when it is newer.';
