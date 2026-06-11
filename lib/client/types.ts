// Shapes returned by the API routes, used by the client pages. Kept in sync
// with the route handlers by hand (no codegen).

import type {
  ActionType,
  DueStatus,
  ExpiryReminderStatus,
  ExpiryValidationStatus,
  FinalItemStatus,
  ItemStatus,
  MeasurementType,
  OverallStatus,
  Priority,
  PresentStatus,
  QuantityStatus,
  Role,
  VolumeLevel,
} from '@/lib/logic/types.ts';

export type {
  ActionType,
  DueStatus,
  ExpiryReminderStatus,
  ExpiryValidationStatus,
  FinalItemStatus,
  ItemStatus,
  MeasurementType,
  OverallStatus,
  Priority,
  PresentStatus,
  QuantityStatus,
  Role,
  VolumeLevel,
};

export interface Me {
  id: string;
  full_name: string;
  employee_id: string | null;
  department: string | null;
  email: string | null;
  role: Role;
  is_active: boolean;
}

export interface AssignedInspector {
  full_name: string;
  email: string | null;
  is_primary: boolean;
}

export interface MyBox {
  box_id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  last_inspection_date: string | null;
  next_due_date: string;
  due_status: DueStatus;
  days_overdue: number;
  expiry_summary: {
    expired: number;
    expiring_30: number;
    expiring_60: number;
    missing_date: number;
    mismatch: number;
  };
  assigned_inspectors: AssignedInspector[];
}

export interface MyBoxesResponse {
  role: Role;
  count: number;
  boxes: MyBox[];
}

export interface TemplateItem {
  box_item_id: string;
  item_code: string | null;
  item_name: string;
  measurement_type: MeasurementType;
  required_quantity: number | null;
  unit: string | null;
  has_expiry: boolean;
  expiry_warning_days: number | null;
  is_critical: boolean;
  current_quantity: number | null;
  current_volume_level: VolumeLevel | null;
  current_present_status: PresentStatus | null;
  current_expiry_date: string | null;
  expiry_status: ExpiryReminderStatus | null;
  last_verified_date: string | null;
  last_replaced_date: string | null;
  item_photo_url: string | null;
  display_order: number | null;
}

export interface InspectionTemplateResponse {
  box: {
    box_id: string;
    box_code: string;
    box_name: string;
    location_description: string;
    area: string | null;
    inspection_frequency_days: number;
  };
  template: {
    template_name: string;
    guideline_reference: string | null;
    description: string | null;
  } | null;
  item_count: number;
  items: TemplateItem[];
  last_inspection: {
    overall_status: OverallStatus;
    created_at: string;
    inspector_name: string;
    notes: string | null;
  } | null;
}

export interface InspectionResult {
  ok: boolean;
  inspection_id: string;
  overall_status: OverallStatus;
  summary: {
    total: number;
    ok: number;
    low_stock: number;
    missing: number;
    damaged: number;
    expired: number;
    expiring_soon: number;
    no_expiry_date_recorded: number;
    expiry_label_mismatch: number;
    topup_required: number;
  };
  topups_created: number;
  topup_items: { item_name: string; priority: Priority; reason: string }[];
}

export interface SignatureResponse {
  timestamp: number;
  signature: string;
  api_key: string;
  cloud_name: string;
  folder: string;
  allowed_formats: string[];
}

export interface DashboardSummary {
  total_boxes: number;
  boxes_inspected_this_month: number;
  overdue_boxes: number;
  boxes_needing_topup: number;
  boxes_with_expired_items: number;
  boxes_with_expiring_soon_items: number;
  boxes_with_missing_expiry_dates: number;
  boxes_with_expiry_label_mismatch: number;
  items_expiring_within_30_days: number;
  open_topup_requests: number;
  usage_logs_this_month: number;
}

export interface ReportInspection {
  id: string;
  box_id: string;
  inspector_name: string;
  inspector_department: string | null;
  overall_status: OverallStatus;
  created_at: string;
  notes: string | null;
  boxes: { box_code: string; box_name: string; area: string | null } | null;
}

export interface ReportInspectionItem {
  id: string;
  inspection_id: string;
  item_name: string;
  required_quantity: number | null;
  observed_quantity: number | null;
  observed_volume_level: VolumeLevel | null;
  observed_present_status: PresentStatus | null;
  expiry_date: string | null;
  system_expiry_date: string | null;
  expiry_validation_status: ExpiryValidationStatus | null;
  expiry_label_mismatch: boolean;
  no_expiry_date_recorded: boolean;
  item_status: ItemStatus | null;
  is_expired: boolean;
  expires_soon: boolean;
  topup_required: boolean;
  remarks: string | null;
}

export interface ReportTopup {
  id: string;
  box_id: string;
  item_name: string;
  reason: string | null;
  priority: Priority | null;
  status: 'Open' | 'In Progress' | 'Completed' | 'Rejected';
  requested_at: string;
  completed_at: string | null;
}

export interface ReportUsage {
  id: string;
  box_id: string;
  user_name: string;
  department: string;
  usage_purpose: string;
  items_taken: string[] | null;
  notes: string | null;
  created_at: string;
}

export interface ReportExpiryItem {
  id: string;
  box_id: string;
  item_name: string;
  expiry_date: string | null;
  expiry_status: ExpiryReminderStatus;
  last_verified_date: string | null;
  last_replaced_date: string | null;
}

export interface ReportsResponse {
  filters: Record<string, string>;
  dashboard: DashboardSummary;
  inspections: ReportInspection[];
  inspection_items: ReportInspectionItem[];
  expiry_items: ReportExpiryItem[];
  topup_requests: ReportTopup[];
  usage_logs: ReportUsage[];
}
