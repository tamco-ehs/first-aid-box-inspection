// =============================================================================
// Action auto-resolution rules.
//
// Actions used to be created and never cleared: the ONLY way an action closed
// was the ESH "Close Action" screen. So a box kept showing "Issue Found" even
// after the stock was topped up, the expiry date revised, or a clean inspection
// submitted. These pure rules decide when an open action is genuinely resolved
// by the CURRENT state of the box, so the server can close it automatically.
//
// Pure + unit-tested (resolve.test.ts). No I/O.
// =============================================================================

import type { ActionType } from './actions.ts';

export interface ResolvableAction {
  id: string;
  action_type: ActionType;
  category: 'quick_check' | 'item';
  box_item_id: string | null;
  item_name: string | null;
  created_at: string;
}

/** Current master state of one item in the box. */
export interface ItemState {
  id: string;
  item_name: string;
  required_quantity: number | null;
  current_quantity: number | null;
  has_expiry: boolean;
  expiry_date: string | null; // 'YYYY-MM-DD'
  is_active: boolean;
}

/** The most recent inspection for the box (quick-check answers). */
export interface LatestInspection {
  created_at: string;
  box_accessible: boolean | null;
  box_clean: boolean | null;
  contact_visible: boolean | null;
}

/** Which quick-check answer clears which box-level action. */
const QUICK_ANSWER = {
  'Box Accessibility Issue': 'box_accessible',
  'Box Condition Issue': 'box_clean',
  'Emergency Contact Not Visible': 'contact_visible',
} as const satisfies Partial<Record<ActionType, keyof LatestInspection>>;

/**
 * Is this open action resolved by the current state?
 *
 *  quick_check  - a NEWER inspection answered "Yes" to that question.
 *  Item Low Qty / Item Missing - stock is back at (or above) the required qty.
 *  Item Expired - the item's expiry date has been revised to today or later
 *                 (or the item no longer tracks expiry).
 *  any item action - the item was removed / deactivated from the box.
 */
export function isActionResolved(
  action: ResolvableAction,
  item: ItemState | undefined,
  latest: LatestInspection | null,
  today: string,
): boolean {
  if (action.category === 'quick_check') {
    const key = QUICK_ANSWER[action.action_type as keyof typeof QUICK_ANSWER];
    if (!key || !latest) return false;
    // Only an inspection done at/after the report can clear it - otherwise an
    // old "Yes" would immediately wipe a freshly raised issue.
    if (new Date(latest.created_at).getTime() < new Date(action.created_at).getTime()) return false;
    return latest[key] === true;
  }

  // Item action but the item is gone from the box -> nothing left to restock.
  if (!item || !item.is_active) return true;

  switch (action.action_type) {
    case 'Item Low Qty':
    case 'Item Missing':
      if (item.required_quantity == null || item.current_quantity == null) return false;
      return item.current_quantity >= item.required_quantity;

    case 'Item Expired':
      if (!item.has_expiry) return true;
      if (!item.expiry_date) return false; // unknown expiry - leave it open
      return item.expiry_date >= today;

    default:
      return false;
  }
}

/** Key used to match an item action to its box item when box_item_id is null. */
export function itemLookupKey(boxId: string, itemName: string): string {
  return `${boxId}:${itemName.trim().toLowerCase()}`;
}
