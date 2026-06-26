// =============================================================================
// Pure derivation logic for the revamped quick-inspection + actions workflow.
// No I/O, fully unit-tested. The /api/inspections route uses these to decide
// which ESH actions to raise and what the box badge should say.
// =============================================================================

import type { Priority } from './types.ts';

export type ActionType =
  | 'Box Accessibility Issue'
  | 'Box Condition Issue'
  | 'Emergency Contact Not Visible'
  | 'Item Low Qty'
  | 'Item Missing'
  | 'Item Expired';

export type ItemCheckStatus = 'OK' | 'Low Qty' | 'Missing' | 'Expired';

export interface QuickAnswers {
  box_accessible: boolean;
  box_clean: boolean;
  seal_intact: boolean;
  contact_visible: boolean;
}

export interface QuickActionSpec {
  action_type: ActionType;
  category: 'quick_check';
  priority: Priority;
}

/** Box-level actions raised by failed quick-check answers (seal handled separately). */
export function quickCheckActions(a: QuickAnswers): QuickActionSpec[] {
  const out: QuickActionSpec[] = [];
  if (!a.box_accessible)
    out.push({ action_type: 'Box Accessibility Issue', category: 'quick_check', priority: 'High' });
  if (!a.box_clean)
    out.push({ action_type: 'Box Condition Issue', category: 'quick_check', priority: 'High' });
  if (!a.contact_visible)
    out.push({ action_type: 'Emergency Contact Not Visible', category: 'quick_check', priority: 'Medium' });
  return out;
}

/** Map an item-check button to an action type + priority (null when OK). */
export function itemActionType(
  status: ItemCheckStatus,
): { action_type: ActionType; priority: Priority } | null {
  switch (status) {
    case 'Low Qty':
      return { action_type: 'Item Low Qty', priority: 'Medium' };
    case 'Missing':
      return { action_type: 'Item Missing', priority: 'High' };
    case 'Expired':
      return { action_type: 'Item Expired', priority: 'High' };
    default:
      return null;
  }
}

/**
 * The item checklist must open when the seal is broken / shows use, OR when a
 * known expired item needs replacement (ESH can also trigger it manually).
 */
export function itemCheckRequired(seal_intact: boolean, hasKnownExpiredItem: boolean): boolean {
  return !seal_intact || hasKnownExpiredItem;
}

export type DueStatus = 'Overdue' | 'Due Soon' | 'Completed' | 'Not Yet Inspected';
export type StatusTag = 'Issue Found' | 'Overdue' | 'Due Soon' | 'Not Due';

/** The single badge shown on a box card: open actions win over due status. */
export function statusTag(openActions: number, dueStatus: DueStatus): StatusTag {
  if (openActions > 0) return 'Issue Found';
  if (dueStatus === 'Overdue') return 'Overdue';
  if (dueStatus === 'Due Soon') return 'Due Soon';
  return 'Not Due';
}

/** Card button: not-due boxes with no issue are "view only"; everything else is inspectable. */
export function primaryAction(tag: StatusTag): 'inspect' | 'view' {
  return tag === 'Not Due' ? 'view' : 'inspect';
}
