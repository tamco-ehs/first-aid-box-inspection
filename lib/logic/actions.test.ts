import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemActionType,
  itemCheckRequired,
  primaryAction,
  quickCheckActions,
  statusTag,
} from './actions.ts';

test('all quick checks pass -> no actions', () => {
  assert.deepEqual(
    quickCheckActions({ box_accessible: true, box_clean: true, seal_intact: true, contact_visible: true }),
    [],
  );
});

test('failed quick checks raise the right actions (seal excluded)', () => {
  const actions = quickCheckActions({
    box_accessible: false,
    box_clean: false,
    seal_intact: false, // handled by item-check, not a box action
    contact_visible: false,
  });
  assert.deepEqual(
    actions.map((a) => a.action_type),
    ['Box Accessibility Issue', 'Box Condition Issue', 'Emergency Contact Not Visible'],
  );
  assert.equal(actions[0]!.priority, 'High');
  assert.equal(actions[2]!.priority, 'Medium');
});

test('item status maps to action type', () => {
  assert.equal(itemActionType('OK'), null);
  assert.deepEqual(itemActionType('Low Qty'), { action_type: 'Item Low Qty', priority: 'Medium' });
  assert.deepEqual(itemActionType('Missing'), { action_type: 'Item Missing', priority: 'High' });
  assert.deepEqual(itemActionType('Expired'), { action_type: 'Item Expired', priority: 'High' });
});

test('item check required when seal broken or expired item known', () => {
  assert.equal(itemCheckRequired(true, false), false); // sealed, nothing expired -> skip
  assert.equal(itemCheckRequired(false, false), true); // seal broken -> open checklist
  assert.equal(itemCheckRequired(true, true), true); // expired item -> open checklist
});

test('status tag: open actions win, else due status', () => {
  assert.equal(statusTag(2, 'Completed'), 'Issue Found');
  assert.equal(statusTag(0, 'Overdue'), 'Overdue');
  assert.equal(statusTag(0, 'Due Soon'), 'Due Soon');
  assert.equal(statusTag(0, 'Completed'), 'Not Due');
  assert.equal(statusTag(0, 'Not Yet Inspected'), 'Not Due');
});

test('primary action: not-due is view, else inspect', () => {
  assert.equal(primaryAction('Not Due'), 'view');
  assert.equal(primaryAction('Issue Found'), 'inspect');
  assert.equal(primaryAction('Overdue'), 'inspect');
  assert.equal(primaryAction('Due Soon'), 'inspect');
});
