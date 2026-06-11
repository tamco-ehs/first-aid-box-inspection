import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopupRows, topupKey } from './topup.ts';
import type { EvaluatedItem } from './types.ts';

function line(overrides: Partial<EvaluatedItem>): {
  evaluated: EvaluatedItem;
  inspectionItemId: string | null;
} {
  return {
    inspectionItemId: 'ii-' + (overrides.box_item_id ?? 'x'),
    evaluated: {
      box_item_id: 'bi-1',
      item_name: 'Handyplast',
      measurement_type: 'quantity',
      required_quantity: 30,
      observed_quantity: 0,
      observed_volume_level: null,
      observed_present_status: null,
      expiry_date: null,
      system_expiry_date: null,
      expiry_validation_status: null,
      expiry_label_mismatch: false,
      no_expiry_date_recorded: false,
      item_status: 'Missing',
      is_below_half: false,
      is_expired: false,
      expires_soon: false,
      topup_required: true,
      is_critical: false,
      reason: 'Item is out of stock (quantity 0).',
      priority: 'High',
      ...overrides,
    },
  };
}

test('creates a top-up for each item that needs one', () => {
  const rows = buildTopupRows({
    boxId: 'box-1',
    inspectionId: 'insp-1',
    requestedBy: 'user-1',
    lines: [
      line({ box_item_id: 'bi-1', item_name: 'Handyplast' }),
      line({ box_item_id: 'bi-2', item_name: 'Dettol', item_status: 'Low Stock' }),
    ],
    existingOpenKeys: new Set(),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.status, 'Open');
  assert.equal(rows[0]!.inspection_id, 'insp-1');
});

test('skips items that do not need a top-up', () => {
  const rows = buildTopupRows({
    boxId: 'box-1',
    inspectionId: 'insp-1',
    requestedBy: null,
    lines: [line({ box_item_id: 'bi-3', item_status: 'OK', topup_required: false })],
    existingOpenKeys: new Set(),
  });
  assert.equal(rows.length, 0);
});

test('does NOT duplicate an already-open top-up for the same box item', () => {
  const existing = new Set([topupKey('Handyplast')]);
  const rows = buildTopupRows({
    boxId: 'box-1',
    inspectionId: 'insp-2',
    requestedBy: 'user-1',
    lines: [line({ box_item_id: 'bi-1', item_name: 'Handyplast' })],
    existingOpenKeys: existing,
  });
  assert.equal(rows.length, 0);
});

test('de-dupes within a single submission', () => {
  const rows = buildTopupRows({
    boxId: 'box-1',
    inspectionId: 'insp-3',
    requestedBy: null,
    lines: [
      line({ box_item_id: 'bi-1', item_name: 'Handyplast' }),
      line({ box_item_id: 'bi-1', item_name: 'Handyplast' }), // accidental dup
    ],
    existingOpenKeys: new Set(),
  });
  assert.equal(rows.length, 1);
});

test('keys by normalized item name', () => {
  assert.equal(topupKey('Yellow Lotion'), 'name:yellow lotion');
  assert.equal(topupKey('  yellow lotion  '), 'name:yellow lotion');
});
