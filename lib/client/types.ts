// Shapes returned by the API routes, used by the client pages. Kept in sync
// with the route handlers by hand (no codegen).

import type { MeasurementType, Priority, Role } from '@/lib/logic/types.ts';
import type { DueStatus, StatusTag } from '@/lib/logic/actions.ts';

export type { MeasurementType, Priority, Role, DueStatus, StatusTag };

export type ItemCheckStatus = 'OK' | 'Low Qty' | 'Missing' | 'Expired';

export type ActionType =
  | 'Box Accessibility Issue'
  | 'Box Condition Issue'
  | 'Emergency Contact Not Visible'
  | 'Item Low Qty'
  | 'Item Missing'
  | 'Item Expired';

export type ActionStatus = 'Open' | 'In Progress' | 'Closed' | 'Rejected';

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
  open_actions: number;
  status_tag: StatusTag;
  primary_action: 'inspect' | 'view';
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
  current_volume_level: string | null;
  current_present_status: string | null;
  current_expiry_date: string | null;
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
  template: { template_name: string; guideline_reference: string | null; description: string | null } | null;
  item_count: number;
  items: TemplateItem[];
  last_inspection: {
    overall_status: string;
    created_at: string;
    inspector_name: string;
    notes: string | null;
  } | null;
}

export interface CreatedAction {
  action_code: string;
  action_type: ActionType;
  item_name: string | null;
  priority: Priority;
}

export interface QuickInspectionResult {
  ok: boolean;
  inspection_id: string;
  overall_status: 'Ready' | 'Action Required';
  item_check_performed: boolean;
  summary: { ok: number; low_qty: number; missing: number; expired: number; actions_created: number };
  actions: CreatedAction[];
}

export interface BoxLite {
  box_code: string;
  box_name?: string;
  location_description?: string;
  area: string | null;
}

export interface ActionRow {
  id: string;
  action_code: string;
  box_id: string;
  inspection_id: string | null;
  action_type: ActionType;
  category: 'quick_check' | 'item';
  box_item_id: string | null;
  item_name: string | null;
  required_quantity: number | null;
  observed_quantity: number | null;
  new_quantity: number | null;
  expiry_date: string | null;
  new_expiry_date: string | null;
  priority: Priority | null;
  status: ActionStatus;
  details: string | null;
  closure_note: string | null;
  created_at: string;
  closed_at: string | null;
  boxes: BoxLite | null;
}

export interface ActionsResponse {
  actions: ActionRow[];
}

export interface DashboardMetrics {
  due_this_month: number;
  overdue: number;
  quick_check_issues: number;
  seal_broken_used: number;
  expired_items: number;
  expiring_30_days: number;
  open_actions: number;
}

export interface Compliance {
  percent: number;
  completed: number;
  attention: number;
  total: number;
}

export interface NeedsAttentionRow {
  id: string;
  action_code: string;
  box_code: string;
  location: string;
  issue_type: ActionType;
  item_name: string | null;
  priority: Priority | null;
  created_at: string;
}

export interface ActionMonthlyPoint {
  label: string;
  created: number;
  closed: number;
  backlog: number;
}

export interface ReportInspection {
  id: string;
  box_id: string;
  inspector_name: string;
  inspector_department: string | null;
  overall_status: string;
  seal_intact: boolean | null;
  item_check_performed: boolean;
  created_at: string;
  notes: string | null;
  boxes: { box_code: string; box_name: string; area: string | null } | null;
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

export interface ReportsResponse {
  filters: Record<string, string>;
  dashboard: DashboardMetrics;
  compliance: Compliance;
  needs_attention: NeedsAttentionRow[];
  trend: { label: string; count: number }[];
  action_monthly: ActionMonthlyPoint[];
  inspections: ReportInspection[];
  actions: ActionRow[];
  usage_logs: ReportUsage[];
}

export interface SignatureResponse {
  timestamp: number;
  signature: string;
  api_key: string;
  cloud_name: string;
  folder: string;
  allowed_formats: string[];
}
