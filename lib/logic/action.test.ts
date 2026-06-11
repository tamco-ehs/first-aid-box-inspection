import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateItem } from './inspection.ts';
import { deriveRequiredAction, groupActionItemsForAdmin, type ActionLine } from './action.ts';
import type { BoxItemSpec, Observation } from './types.ts';

const NOW = new Date('2026-06-10T00:00:00Z');

function spec(o: Partial<BoxItemSpec> = {}): BoxItemSpec {
  return {
    box_item_id: 'b',
    item_name: 'Item',
    measurement_type: 'quantity',
    required_quantity: 9,
    has_expiry: false,
    expiry_warning_days: 60,
    is_critical: false,
    restock_threshold_type: null,
    restock_threshold_quantity: null,
    ...o,
  };
}
const ev = (s: BoxItemSpec, o: Observation) => evaluateItem(s, o, NOW);

test('deriveRequiredAction: below required -> top up the shortfall', () => {
  const r = ev(spec({ required_quantity: 9, previous_quantity: 9 }), { observed_quantity: 8, remarks: 'x' });
  assert.equal(deriveRequiredAction(r, 'pcs'), 'Top up 1 pcs');
});

test('deriveRequiredAction: quantity sufficient + expiry not verifiable is verification, not top-up', () => {
  const r = ev(spec({ required_quantity: 1, has_expiry: true, current_expiry_date: '2026-12-01' }), {
    observed_quantity: 2,
    expiry_validation_status: 'no_label',
    remarks: 'no label',
  });
  assert.equal(r.action_type, 'expiry_verification_required');
  assert.equal(deriveRequiredAction(r), 'Verify the physical label or update the expiry baseline');
});

test('deriveRequiredAction: expired -> replace immediately', () => {
  const r = ev(spec({ has_expiry: true, current_expiry_date: '2026-01-01', required_quantity: 1 }), {
    observed_quantity: 1,
    expiry_validation_status: 'matches_label',
    remarks: 'expired',
  });
  assert.equal(deriveRequiredAction(r), 'Replace expired item immediately');
});

test('deriveRequiredAction: OK quantity updated -> note inventory update', () => {
  const r = ev(spec({ required_quantity: 5, previous_quantity: 9 }), { observed_quantity: 8 });
  assert.equal(deriveRequiredAction(r, 'pcs'), 'Update box inventory quantity to 8 pcs');
});

test('groupActionItemsForAdmin: only non-empty sections, urgent first, no no_action', () => {
  const lines: ActionLine[] = [
    {
      ev: ev(spec({ required_quantity: 9, previous_quantity: 9 }), { observed_quantity: 8, remarks: 'x' }),
      unit: 'pcs',
    },
    {
      ev: ev(spec({ has_expiry: true, current_expiry_date: '2026-01-01', required_quantity: 1 }), {
        observed_quantity: 1,
        expiry_validation_status: 'matches_label',
        remarks: 'e',
      }),
      unit: null,
    },
    { ev: ev(spec({ required_quantity: 5, previous_quantity: 5 }), { observed_quantity: 5 }), unit: 'pcs' },
  ];
  const sections = groupActionItemsForAdmin(lines);
  assert.deepEqual(
    sections.map((s) => s.type),
    ['replacement_required', 'topup_required'],
  );
  assert.equal(sections[0]!.lines.length, 1);
});
