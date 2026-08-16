import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActionResolved, type ItemState, type LatestInspection, type ResolvableAction } from './resolve.ts';

const TODAY = '2026-06-27';

function action(over: Partial<ResolvableAction> = {}): ResolvableAction {
  return {
    id: 'a1',
    action_type: 'Item Low Qty',
    category: 'item',
    box_item_id: 'i1',
    item_name: 'Handyplast',
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function item(over: Partial<ItemState> = {}): ItemState {
  return {
    id: 'i1',
    item_name: 'Handyplast',
    required_quantity: 30,
    current_quantity: 30,
    has_expiry: true,
    expiry_date: '2027-01-01',
    is_active: true,
    ...over,
  };
}

function inspection(over: Partial<LatestInspection> = {}): LatestInspection {
  return {
    created_at: '2026-06-20T00:00:00Z',
    box_accessible: true,
    box_clean: true,
    contact_visible: true,
    ...over,
  };
}

// --- Item Low Qty / Missing --------------------------------------------------
test('Low Qty resolves once stock is back to required', () => {
  assert.equal(isActionResolved(action(), item({ current_quantity: 30 }), null, TODAY), true);
});

test('Low Qty stays open while stock is still short', () => {
  assert.equal(isActionResolved(action(), item({ current_quantity: 12 }), null, TODAY), false);
});

test('Low Qty resolves when stock exceeds required', () => {
  assert.equal(isActionResolved(action(), item({ current_quantity: 40 }), null, TODAY), true);
});

test('Missing resolves once restocked', () => {
  const a = action({ action_type: 'Item Missing' });
  assert.equal(isActionResolved(a, item({ current_quantity: 0 }), null, TODAY), false);
  assert.equal(isActionResolved(a, item({ current_quantity: 30 }), null, TODAY), true);
});

test('quantity actions stay open when required/current is unknown', () => {
  assert.equal(isActionResolved(action(), item({ current_quantity: null }), null, TODAY), false);
  assert.equal(isActionResolved(action(), item({ required_quantity: null }), null, TODAY), false);
});

// --- Item Expired ------------------------------------------------------------
test('Expired resolves after the expiry date is revised to the future', () => {
  const a = action({ action_type: 'Item Expired' });
  assert.equal(isActionResolved(a, item({ expiry_date: '2026-01-01' }), null, TODAY), false);
  assert.equal(isActionResolved(a, item({ expiry_date: '2027-06-01' }), null, TODAY), true);
});

test('Expired resolves when the new expiry is exactly today', () => {
  const a = action({ action_type: 'Item Expired' });
  assert.equal(isActionResolved(a, item({ expiry_date: TODAY }), null, TODAY), true);
});

test('Expired stays open when the expiry date is unknown', () => {
  const a = action({ action_type: 'Item Expired' });
  assert.equal(isActionResolved(a, item({ expiry_date: null }), null, TODAY), false);
});

test('Expired resolves when the item no longer tracks expiry', () => {
  const a = action({ action_type: 'Item Expired' });
  assert.equal(isActionResolved(a, item({ has_expiry: false, expiry_date: null }), null, TODAY), true);
});

// --- Item removed ------------------------------------------------------------
test('item actions resolve when the item is removed or deactivated', () => {
  assert.equal(isActionResolved(action(), undefined, null, TODAY), true);
  assert.equal(isActionResolved(action(), item({ is_active: false }), null, TODAY), true);
});

// --- Quick check -------------------------------------------------------------
test('quick-check action resolves when a newer inspection answers Yes', () => {
  const a = action({ action_type: 'Box Accessibility Issue', category: 'quick_check', box_item_id: null, item_name: null });
  assert.equal(isActionResolved(a, undefined, inspection({ box_accessible: true }), TODAY), true);
});

test('quick-check action stays open while the answer is still No', () => {
  const a = action({ action_type: 'Box Condition Issue', category: 'quick_check', box_item_id: null, item_name: null });
  assert.equal(isActionResolved(a, undefined, inspection({ box_clean: false }), TODAY), false);
});

test('an OLDER inspection cannot clear a newer report', () => {
  const a = action({
    action_type: 'Emergency Contact Not Visible',
    category: 'quick_check',
    box_item_id: null,
    item_name: null,
    created_at: '2026-06-25T00:00:00Z',
  });
  const stale = inspection({ created_at: '2026-06-01T00:00:00Z', contact_visible: true });
  assert.equal(isActionResolved(a, undefined, stale, TODAY), false);
});

test('quick-check action stays open when there is no inspection yet', () => {
  const a = action({ action_type: 'Box Accessibility Issue', category: 'quick_check', box_item_id: null, item_name: null });
  assert.equal(isActionResolved(a, undefined, null, TODAY), false);
});

test('each quick-check type reads its own answer', () => {
  const base = { category: 'quick_check' as const, box_item_id: null, item_name: null };
  const insp = inspection({ box_accessible: false, box_clean: true, contact_visible: true });
  assert.equal(isActionResolved(action({ ...base, action_type: 'Box Accessibility Issue' }), undefined, insp, TODAY), false);
  assert.equal(isActionResolved(action({ ...base, action_type: 'Box Condition Issue' }), undefined, insp, TODAY), true);
  assert.equal(isActionResolved(action({ ...base, action_type: 'Emergency Contact Not Visible' }), undefined, insp, TODAY), true);
});
