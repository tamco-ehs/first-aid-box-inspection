// =============================================================================
// Action mapping shared by the admin email (and the Phase-2 dashboard). Turns an
// already-scored EvaluatedItem into a human "required action" line, and groups a
// set of items into the ordered sections EHS/admin scan first. Pure (no I/O), so
// inspection, email and dashboard all agree on what to do for each item.
// =============================================================================

import type { ActionType, EvaluatedItem, Priority } from './types.ts';

/** Section order for the admin email / action queue (most urgent first). */
export const ACTION_SECTIONS: { type: ActionType; title: string }[] = [
  { type: 'immediate_action', title: 'Immediate Action Required' },
  { type: 'replacement_required', title: 'Replacement Required' },
  { type: 'topup_required', title: 'Top-up Required' },
  { type: 'expiring_soon', title: 'Expiring Soon' },
  { type: 'expiry_verification_required', title: 'Expiry Verification Required' },
  { type: 'expiry_baseline_missing', title: 'Expiry Baseline Missing' },
  { type: 'admin_review_required', title: 'Admin Review' },
];

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export interface ActionLine {
  ev: EvaluatedItem;
  unit: string | null;
}

export interface ActionSection {
  type: ActionType;
  title: string;
  lines: ActionLine[];
}

/** Human "what to do" line for one item. Date is shown separately in the card. */
export function deriveRequiredAction(ev: EvaluatedItem, unit?: string | null): string {
  const qtyUnit = unit && unit.trim() ? unit.trim() : 'pcs';
  switch (ev.action_type) {
    case 'immediate_action':
    case 'replacement_required':
      if (ev.is_expired) return 'Replace expired item immediately';
      if (ev.observed_volume_level === 'Empty') return 'Replace item immediately (container empty)';
      if (ev.item_status === 'Damaged') return 'Replace damaged item';
      return 'Replace item immediately';
    case 'topup_required':
      if (ev.topup_quantity && ev.topup_quantity > 0) return `Top up ${ev.topup_quantity} ${qtyUnit}`;
      if (ev.condition_status === 'half') return 'Top up or replace (half full)';
      return 'Top up to the required level';
    case 'expiring_soon':
      return ev.priority === 'High'
        ? 'Plan replacement before the expiry date'
        : 'Monitor and prepare replacement';
    case 'expiry_verification_required':
      return 'Verify the physical label or update the expiry baseline';
    case 'expiry_baseline_missing':
      return 'Record the expiry baseline date';
    case 'admin_review_required':
      return 'Admin review required';
    default:
      if (ev.quantity_status === 'ok_quantity_updated' && ev.observed_quantity != null) {
        return `Update box inventory quantity to ${ev.observed_quantity} ${qtyUnit}`;
      }
      return 'No action required';
  }
}

/** Group action-needing lines into the fixed section order, priority-sorted. */
export function groupActionItemsForAdmin(lines: ActionLine[]): ActionSection[] {
  const sections: ActionSection[] = [];
  for (const { type, title } of ACTION_SECTIONS) {
    const matched = lines
      .filter((l) => l.ev.action_type === type)
      .sort((a, b) => PRIORITY_RANK[a.ev.priority] - PRIORITY_RANK[b.ev.priority]);
    if (matched.length > 0) sections.push({ type, title, lines: matched });
  }
  return sections;
}
