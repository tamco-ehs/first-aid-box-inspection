// Shared domain types used by both the pure logic functions and the API routes.
// This file is import-free (types only) so the logic modules stay unit-testable
// under `node --test` with TypeScript type-stripping.

export type Role = 'admin' | 'first_aider' | 'viewer';

export type MeasurementType = 'quantity' | 'volume_level' | 'present_absent';

export type VolumeLevel = 'Full' | 'Three Quarter' | 'Half' | 'Below Half' | 'Empty';

export type PresentStatus = 'Present' | 'Missing' | 'Damaged';

export type ItemStatus =
  | 'OK'
  | 'Low Stock'
  | 'Missing'
  | 'Expired'
  | 'Expiring Soon'
  | 'No Expiry Date'
  | 'Expiry Label Mismatch'
  | 'Damaged'
  | 'Not Applicable';

export type OverallStatus = 'Pass' | 'Fail' | 'Needs Restock';

export type Priority = 'Low' | 'Medium' | 'High';

export type DueStatus = 'Overdue' | 'Due Soon' | 'Completed' | 'Not Yet Inspected';

export type RestockThresholdType =
  | 'below_half'
  | 'fixed_quantity'
  | 'any_missing'
  | 'expired_only';

export type ExpiryValidationStatus =
  | 'matches_label'
  | 'different_date'
  | 'no_label'
  | 'expired'
  | 'replaced_now'
  | 'missing_not_replaced';

export type ExpiryReminderStatus =
  | 'Valid'
  | 'Expiring soon'
  | 'Expired'
  | 'No expiry date recorded'
  | 'Expiry label mismatch';

export type ExpiryAuditSource = 'replacement' | 'inspection_correction' | 'admin_correction';

/** The expected setup of one item in a box (from box_items joined with template). */
export interface BoxItemSpec {
  box_item_id: string;
  item_name: string;
  measurement_type: MeasurementType;
  required_quantity: number | null;
  has_expiry: boolean;
  current_expiry_date?: string | null;
  expiry_warning_days: number | null;
  is_critical: boolean;
  restock_threshold_type: RestockThresholdType | null;
  restock_threshold_quantity: number | null;
}

/** What the inspector reported for one item. */
export interface Observation {
  observed_quantity?: number | null;
  observed_volume_level?: VolumeLevel | null;
  observed_present_status?: PresentStatus | null;
  expiry_date?: string | null; // 'YYYY-MM-DD'
  expiry_validation_status?: ExpiryValidationStatus | null;
  replacement_date?: string | null; // 'YYYY-MM-DD'
  replacement_photo_url?: string | null;
  replacement_photo_cloudinary_public_id?: string | null;
  remarks?: string | null;
}

/** Fully evaluated line, ready to persist to inspection_items. */
export interface EvaluatedItem {
  box_item_id: string;
  item_name: string;
  measurement_type: MeasurementType;
  required_quantity: number | null;
  observed_quantity: number | null;
  observed_volume_level: VolumeLevel | null;
  observed_present_status: PresentStatus | null;
  expiry_date: string | null;
  system_expiry_date: string | null;
  expiry_validation_status: ExpiryValidationStatus | null;
  expiry_label_mismatch: boolean;
  no_expiry_date_recorded: boolean;
  item_status: ItemStatus;
  is_below_half: boolean;
  is_expired: boolean;
  expires_soon: boolean;
  topup_required: boolean;
  is_critical: boolean;
  // Derived hints for the top-up helper (not stored on inspection_items):
  reason: string;
  priority: Priority;
}
