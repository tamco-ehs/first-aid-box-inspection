import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOverallStatus,
  evaluateItem,
  summarize,
  validateObservation,
} from './inspection.ts';
import type { BoxItemSpec, EvaluatedItem, Observation } from './types.ts';

const NOW = new Date('2026-06-10T00:00:00Z');

function spec(overrides: Partial<BoxItemSpec> = {}): BoxItemSpec {
  return {
    box_item_id: 'b1',
    item_name: 'Test Item',
    measurement_type: 'quantity',
    required_quantity: 30,
    has_expiry: false,
    expiry_warning_days: 60,
    is_critical: false,
    restock_threshold_type: null,
    restock_threshold_quantity: null,
    ...overrides,
  };
}

function evalOne(s: BoxItemSpec, o: Observation): EvaluatedItem {
  return evaluateItem(s, o, NOW);
}

// --- Quantity: low stock at 50% or below -------------------------------------
test('quantity at 100% is OK', () => {
  const r = evalOne(spec(), { observed_quantity: 30 });
  assert.equal(r.item_status, 'OK');
  assert.equal(r.topup_required, false);
  assert.equal(r.is_below_half, false);
});

test('quantity exactly at 50% is Low Stock + below half + topup', () => {
  const r = evalOne(spec({ required_quantity: 30 }), { observed_quantity: 15 });
  assert.equal(r.item_status, 'Low Stock');
  assert.equal(r.is_below_half, true);
  assert.equal(r.topup_required, true);
  assert.equal(r.priority, 'Medium');
});

test('quantity just above 50% is OK', () => {
  const r = evalOne(spec({ required_quantity: 30 }), { observed_quantity: 16 });
  assert.equal(r.item_status, 'OK');
  assert.equal(r.topup_required, false);
});

test('quantity 0 is Missing + topup', () => {
  const r = evalOne(spec(), { observed_quantity: 0 });
  assert.equal(r.item_status, 'Missing');
  assert.equal(r.topup_required, true);
  assert.equal(r.priority, 'High');
});

test('fixed_quantity threshold can trigger low stock above 50%', () => {
  const r = evalOne(
    spec({ required_quantity: 30, restock_threshold_type: 'fixed_quantity', restock_threshold_quantity: 20 }),
    { observed_quantity: 18 },
  );
  assert.equal(r.item_status, 'Low Stock');
  assert.equal(r.topup_required, true);
});

// --- Volume levels: Half / Below Half / Empty are flagged --------------------
test('volume Full and Three Quarter are OK', () => {
  for (const lvl of ['Full', 'Three Quarter'] as const) {
    const r = evalOne(spec({ measurement_type: 'volume_level', required_quantity: 1 }), {
      observed_volume_level: lvl,
    });
    assert.equal(r.item_status, 'OK', `${lvl} should be OK`);
    assert.equal(r.topup_required, false);
  }
});

test('volume Half and Below Half are Low Stock + below half + topup', () => {
  for (const lvl of ['Half', 'Below Half'] as const) {
    const r = evalOne(spec({ measurement_type: 'volume_level' }), { observed_volume_level: lvl });
    assert.equal(r.item_status, 'Low Stock', `${lvl}`);
    assert.equal(r.is_below_half, true, `${lvl} below half`);
    assert.equal(r.topup_required, true, `${lvl} topup`);
  }
});

test('volume Empty is Missing + topup', () => {
  const r = evalOne(spec({ measurement_type: 'volume_level' }), { observed_volume_level: 'Empty' });
  assert.equal(r.item_status, 'Missing');
  assert.equal(r.topup_required, true);
});

// --- Present / absent --------------------------------------------------------
test('present/absent statuses map correctly', () => {
  const base = spec({ measurement_type: 'present_absent', required_quantity: 1 });
  assert.equal(evalOne(base, { observed_present_status: 'Present' }).item_status, 'OK');
  assert.equal(evalOne(base, { observed_present_status: 'Missing' }).item_status, 'Missing');
  assert.equal(evalOne(base, { observed_present_status: 'Damaged' }).item_status, 'Damaged');
  assert.equal(evalOne(base, { observed_present_status: 'Damaged' }).topup_required, true);
});

// --- Expiry ------------------------------------------------------------------
test('expired item is flagged Expired regardless of quantity', () => {
  const r = evalOne(spec({ has_expiry: true }), {
    observed_quantity: 30,
    expiry_date: '2026-01-01', // before NOW
  });
  assert.equal(r.is_expired, true);
  assert.equal(r.item_status, 'Expired');
  assert.equal(r.topup_required, true);
  assert.equal(r.priority, 'High');
});

test('expiring soon within warning window is flagged', () => {
  const r = evalOne(spec({ has_expiry: true, expiry_warning_days: 60 }), {
    observed_quantity: 30,
    expiry_date: '2026-07-01', // 21 days after NOW
  });
  assert.equal(r.expires_soon, true);
  assert.equal(r.item_status, 'Expiring Soon');
  assert.equal(r.topup_required, true);
});

test('expiry beyond warning window is OK', () => {
  const r = evalOne(spec({ has_expiry: true, expiry_warning_days: 60 }), {
    observed_quantity: 30,
    expiry_date: '2026-12-01', // far future
  });
  assert.equal(r.expires_soon, false);
  assert.equal(r.item_status, 'OK');
});

// --- Overall status ----------------------------------------------------------
function lines(...items: EvaluatedItem[]): EvaluatedItem[] {
  return items;
}

test('overall Pass when all OK and box photo present', () => {
  const items = lines(evalOne(spec(), { observed_quantity: 30 }));
  assert.equal(computeOverallStatus(items, true), 'Pass');
});

test('overall Fail when box photo missing', () => {
  const items = lines(evalOne(spec(), { observed_quantity: 30 }));
  assert.equal(computeOverallStatus(items, false), 'Fail');
});

test('overall Needs Restock on low stock', () => {
  const items = lines(evalOne(spec({ required_quantity: 30 }), { observed_quantity: 10 }));
  assert.equal(computeOverallStatus(items, true), 'Needs Restock');
});

test('overall Fail on any expired item', () => {
  const items = lines(
    evalOne(spec({ has_expiry: true }), { observed_quantity: 30, expiry_date: '2020-01-01' }),
  );
  assert.equal(computeOverallStatus(items, true), 'Fail');
});

test('overall Needs Restock on expiring soon', () => {
  const items = lines(
    evalOne(spec({ has_expiry: true }), { observed_quantity: 30, expiry_date: '2026-07-01' }),
  );
  assert.equal(computeOverallStatus(items, true), 'Needs Restock');
});

test('critical item missing -> Fail; non-critical missing -> Needs Restock', () => {
  const critical = lines(evalOne(spec({ is_critical: true }), { observed_quantity: 0 }));
  assert.equal(computeOverallStatus(critical, true), 'Fail');

  const nonCritical = lines(evalOne(spec({ is_critical: false }), { observed_quantity: 0 }));
  assert.equal(computeOverallStatus(nonCritical, true), 'Needs Restock');
});

test('summarize counts issues', () => {
  const items = lines(
    evalOne(spec({ required_quantity: 30 }), { observed_quantity: 30 }), // OK
    evalOne(spec({ required_quantity: 30 }), { observed_quantity: 10 }), // Low Stock
    evalOne(spec(), { observed_quantity: 0 }), // Missing
    evalOne(spec({ has_expiry: true }), { observed_quantity: 30, expiry_date: '2020-01-01' }), // Expired
  );
  const s = summarize(items);
  assert.equal(s.total, 4);
  assert.equal(s.ok, 1);
  assert.equal(s.low_stock, 1);
  assert.equal(s.missing, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.topup_required, 3);
});

// --- Validation ---------------------------------------------------------------
test('validateObservation requires the right field per measurement type', () => {
  assert.match(validateObservation(spec(), {}) ?? '', /quantity is required/);
  assert.match(
    validateObservation(spec({ measurement_type: 'volume_level' }), {}) ?? '',
    /volume level is required/,
  );
  assert.match(
    validateObservation(spec({ measurement_type: 'present_absent' }), {}) ?? '',
    /present\/absent status is required/,
  );
});

test('validateObservation requires expiry validation when has_expiry', () => {
  assert.match(
    validateObservation(spec({ has_expiry: true }), { observed_quantity: 1 }) ?? '',
    /expiry check is required/,
  );
  assert.match(
    validateObservation(spec({ has_expiry: true }), { observed_quantity: 1, expiry_date: '2026-13-40' }) ?? '',
    /valid YYYY-MM-DD/,
  );
  assert.equal(
    validateObservation(spec({ has_expiry: true }), { observed_quantity: 1, expiry_date: '2026-12-01' }),
    null,
  );
});

test('monthly expiry validation can use the stored box item date', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-12-01' });
  assert.equal(
    validateObservation(s, { observed_quantity: 1, expiry_validation_status: 'matches_label' }),
    null,
  );
  const r = evalOne(s, { observed_quantity: 30, expiry_validation_status: 'matches_label' });
  assert.equal(r.expiry_date, '2026-12-01');
  assert.equal(r.item_status, 'OK');
});

test('expiry mismatch requires a corrected date and remarks', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-12-01' });
  assert.match(
    validateObservation(s, { observed_quantity: 1, expiry_validation_status: 'different_date', expiry_date: '2026-11-01' }) ?? '',
    /remarks are required/,
  );
  assert.equal(
    validateObservation(s, {
      observed_quantity: 1,
      expiry_validation_status: 'different_date',
      expiry_date: '2026-11-01',
      remarks: 'Physical label is different.',
    }),
    null,
  );
});

test('no expiry label is an issue without replacing the stored date', () => {
  const r = evalOne(spec({ has_expiry: true, current_expiry_date: '2026-12-01' }), {
    observed_quantity: 30,
    expiry_validation_status: 'no_label',
    remarks: 'Label missing.',
  });
  assert.equal(r.expiry_date, '2026-12-01');
  assert.equal(r.item_status, 'Expiry Label Mismatch');
  assert.equal(r.expiry_label_mismatch, true);
  assert.equal(r.topup_required, true);
});

test('replaced item requires replacement date and new expiry date', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-01-01' });
  assert.match(
    validateObservation(s, { observed_quantity: 1, expiry_validation_status: 'replaced_now', expiry_date: '2027-01-01' }) ?? '',
    /replacement date is required/,
  );
  assert.equal(
    validateObservation(s, {
      observed_quantity: 1,
      expiry_validation_status: 'replaced_now',
      expiry_date: '2027-01-01',
      replacement_date: '2026-06-10',
      remarks: 'Replaced during inspection.',
    }),
    null,
  );
});

test('negative quantity is rejected', () => {
  assert.match(validateObservation(spec(), { observed_quantity: -1 }) ?? '', />= 0/);
});

// --- final_item_status: the 8 acceptance scenarios ---------------------------
test('scenario 1: saved date + Still OK (matches_label) -> final ok', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-12-01' });
  const r = evalOne(s, { observed_quantity: 30, expiry_validation_status: 'matches_label' });
  assert.equal(r.expiry_verified, true);
  assert.equal(r.final_item_status, 'ok');
  assert.equal(r.expiry_date, '2026-12-01');
});

test('scenario 2: no saved date + record expiry date -> ok, not a mismatch, no remarks', () => {
  const s = spec({ has_expiry: true, current_expiry_date: null });
  const o: Observation = {
    observed_quantity: 30,
    expiry_validation_status: 'different_date',
    expiry_date: '2027-01-01',
  };
  assert.equal(validateObservation(s, o), null); // baseline record needs no remarks
  const r = evalOne(s, o);
  assert.equal(r.final_item_status, 'ok');
  assert.equal(r.expiry_label_mismatch, false);
  assert.equal(r.expiry_date, '2027-01-01');
});

test('scenario 3: no saved date + cannot find label -> issue_found, date untouched', () => {
  const s = spec({ has_expiry: true, current_expiry_date: null });
  const r = evalOne(s, { observed_quantity: 30, expiry_validation_status: 'no_label', remarks: 'No label.' });
  assert.equal(r.final_item_status, 'issue_found');
  assert.equal(r.expiry_date, null);
  assert.equal(r.item_status, 'Expiry Label Mismatch');
});

test('scenario 4: saved date + label different -> corrected ok, remarks required', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-12-01' });
  assert.match(
    validateObservation(s, {
      observed_quantity: 1,
      expiry_validation_status: 'different_date',
      expiry_date: '2026-11-01',
    }) ?? '',
    /remarks are required/,
  );
  const r = evalOne(s, {
    observed_quantity: 30,
    expiry_validation_status: 'different_date',
    expiry_date: '2026-11-01',
    remarks: 'Physical label differs.',
  });
  assert.equal(r.expiry_label_mismatch, true);
  assert.equal(r.final_item_status, 'ok');
  assert.equal(r.expiry_date, '2026-11-01');
});

test('scenario 5: saved date already expired -> replacement_required + remarks required', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-01-01' });
  assert.match(
    validateObservation(s, { observed_quantity: 30, expiry_validation_status: 'matches_label' }) ?? '',
    /remarks are required/,
  );
  const r = evalOne(s, {
    observed_quantity: 30,
    expiry_validation_status: 'matches_label',
    remarks: 'Confirmed expired.',
  });
  assert.equal(r.is_expired, true);
  assert.equal(r.final_item_status, 'replacement_required');
});

test('scenario 6: replaced now -> ok with new date + replacement recorded', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-01-01' });
  const o: Observation = {
    observed_quantity: 30,
    expiry_validation_status: 'replaced_now',
    expiry_date: '2027-06-01',
    replacement_date: '2026-06-10',
    remarks: 'Replaced during inspection.',
  };
  assert.equal(validateObservation(s, o), null);
  const r = evalOne(s, o);
  assert.equal(r.final_item_status, 'ok');
  assert.equal(r.expiry_date, '2027-06-01');
});

test('scenario 7: half -> topup_required, empty -> issue_found', () => {
  const half = evalOne(spec({ measurement_type: 'volume_level' }), { observed_volume_level: 'Half' });
  assert.equal(half.final_item_status, 'topup_required');
  const empty = evalOne(spec({ measurement_type: 'volume_level' }), {
    observed_volume_level: 'Empty',
    remarks: 'Empty.',
  });
  assert.equal(empty.final_item_status, 'issue_found');
});

test('scenario 8: has_expiry + condition set but expiry NOT verified -> incomplete, never ok', () => {
  const s = spec({ has_expiry: true, current_expiry_date: '2026-12-01' });
  const r = evalOne(s, { observed_quantity: 30 }); // Full condition, no expiry choice yet
  assert.equal(r.expiry_verified, false);
  assert.equal(r.final_item_status, 'incomplete');
  assert.notEqual(r.final_item_status, 'ok');
});

test('non-expiry acceptable item -> final ok', () => {
  assert.equal(evalOne(spec(), { observed_quantity: 30 }).final_item_status, 'ok');
  assert.equal(
    evalOne(spec({ measurement_type: 'present_absent' }), { observed_present_status: 'Present' }).final_item_status,
    'ok',
  );
});
