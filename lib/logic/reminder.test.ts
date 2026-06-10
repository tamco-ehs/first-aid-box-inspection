import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReminder, milestoneFor } from './reminder.ts';

test('milestoneFor returns the highest reached threshold', () => {
  assert.equal(milestoneFor(0), 0);
  assert.equal(milestoneFor(6), 0);
  assert.equal(milestoneFor(7), 7);
  assert.equal(milestoneFor(13), 7);
  assert.equal(milestoneFor(14), 14);
  assert.equal(milestoneFor(27), 21);
  assert.equal(milestoneFor(28), 28);
  assert.equal(milestoneFor(99), 28);
});

test('sends the first reminder exactly at 7 days', () => {
  assert.deepEqual(decideReminder(7, 0), { send: true, milestone: 7, escalate: false });
});

test('does not send before 7 days overdue', () => {
  assert.equal(decideReminder(6, 0).send, false);
});

test('does not repeat a milestone already sent', () => {
  // already sent the 7-day reminder, now 8 days overdue -> nothing new
  assert.equal(decideReminder(8, 7).send, false);
});

test('advances to the next milestone', () => {
  assert.deepEqual(decideReminder(14, 7), { send: true, milestone: 14, escalate: false });
});

test('robust to skipped cron days: jumps 13 -> 15 still sends 14 once', () => {
  // last successful send was at 13 days (milestone 7 covered); now 15 days
  assert.deepEqual(decideReminder(15, 13), { send: true, milestone: 14, escalate: false });
});

test('28-day milestone escalates', () => {
  assert.deepEqual(decideReminder(28, 21), { send: true, milestone: 28, escalate: true });
});

test('does not repeat the 28-day escalation', () => {
  assert.equal(decideReminder(30, 28).send, false);
});

test('a box that is suddenly very overdue sends only the highest milestone once', () => {
  // never reminded, discovered at 30 days -> send 28 (escalate), not 7/14/21 too
  assert.deepEqual(decideReminder(30, 0), { send: true, milestone: 28, escalate: true });
});
