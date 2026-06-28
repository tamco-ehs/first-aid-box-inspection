import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareByDue, computeBoxDue, computeDue } from './due.ts';

const NOW = new Date('2026-06-10T00:00:00Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

test('never inspected, within frequency -> Not Yet Inspected', () => {
  const r = computeDue({ lastInspectionAt: null, boxCreatedAt: daysAgo(10), frequencyDays: 30, now: NOW });
  assert.equal(r.due_status, 'Not Yet Inspected');
  assert.equal(r.days_overdue, 0);
});

test('never inspected, past frequency -> Overdue', () => {
  const r = computeDue({ lastInspectionAt: null, boxCreatedAt: daysAgo(40), frequencyDays: 30, now: NOW });
  assert.equal(r.due_status, 'Overdue');
  assert.equal(r.days_overdue, 10);
});

test('recently inspected -> Completed', () => {
  const r = computeDue({ lastInspectionAt: daysAgo(5), boxCreatedAt: daysAgo(100), frequencyDays: 30, now: NOW });
  assert.equal(r.due_status, 'Completed');
  assert.equal(r.days_overdue, 0);
});

test('inspection due within the window -> Due Soon', () => {
  const r = computeDue({ lastInspectionAt: daysAgo(25), boxCreatedAt: daysAgo(100), frequencyDays: 30, now: NOW });
  assert.equal(r.due_status, 'Due Soon'); // 5 days remaining <= 7
});

test('inspected but past frequency -> Overdue with day count', () => {
  const r = computeDue({ lastInspectionAt: daysAgo(40), boxCreatedAt: daysAgo(200), frequencyDays: 30, now: NOW });
  assert.equal(r.due_status, 'Overdue');
  assert.equal(r.days_overdue, 10);
});

test('manual box expiry start date can reset the due counter', () => {
  const r = computeBoxDue({
    lastInspectionAt: daysAgo(80),
    boxCreatedAt: daysAgo(120),
    boxExpiryStartDate: daysAgo(10),
    frequencyDays: 30,
    now: NOW,
  });
  assert.equal(r.reference_source, 'manual_start');
  assert.equal(r.due_status, 'Completed');
  assert.equal(r.days_overdue, 0);
});

test('latest inspection wins after the manual box expiry start date', () => {
  const r = computeBoxDue({
    lastInspectionAt: daysAgo(5),
    boxCreatedAt: daysAgo(120),
    boxExpiryStartDate: daysAgo(40),
    frequencyDays: 30,
    now: NOW,
  });
  assert.equal(r.reference_source, 'last_inspection');
  assert.equal(r.due_status, 'Completed');
  assert.equal(r.days_overdue, 0);
});

test('compareByDue: overdue first (most overdue first), then due soon, not yet, completed', () => {
  const rows = [
    { id: 'completed', due_status: 'Completed' as const, days_overdue: 0 },
    { id: 'overdue5', due_status: 'Overdue' as const, days_overdue: 5 },
    { id: 'notyet', due_status: 'Not Yet Inspected' as const, days_overdue: 0 },
    { id: 'overdue20', due_status: 'Overdue' as const, days_overdue: 20 },
    { id: 'duesoon', due_status: 'Due Soon' as const, days_overdue: 0 },
  ];
  const order = [...rows].sort(compareByDue).map((r) => r.id);
  assert.deepEqual(order, ['overdue20', 'overdue5', 'duesoon', 'notyet', 'completed']);
});
