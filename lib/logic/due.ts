// =============================================================================
// Inspection due-date / due-status calculation. Pure + deterministic (now is
// injected). Shared by /api/my-boxes (status badges + sorting) and the cron.
// =============================================================================

import type { DueStatus } from './types.ts';

export const DUE_SOON_WINDOW_DAYS = 7;

export interface DueInput {
  lastInspectionAt: string | null; // ISO timestamp of latest inspection, or null
  boxCreatedAt: string; // ISO timestamp; reference when never inspected
  frequencyDays: number;
  now: Date;
  dueSoonWindowDays?: number;
}

export interface DueResult {
  next_due_date: string; // ISO timestamp
  days_overdue: number; // 0 when not overdue
  due_status: DueStatus;
}

function addDays(iso: string, days: number): number {
  return new Date(iso).getTime() + days * 86_400_000;
}

function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 86_400_000);
}

export function computeDue(input: DueInput): DueResult {
  const window = input.dueSoonWindowDays ?? DUE_SOON_WINDOW_DAYS;
  const reference = input.lastInspectionAt ?? input.boxCreatedAt;
  const dueMs = addDays(reference, Math.max(1, input.frequencyDays));
  const nowMs = input.now.getTime();

  // Positive => overdue by N days; negative => N days remaining.
  const overdueDays = wholeDaysBetween(dueMs, nowMs);
  const daysOverdue = Math.max(0, overdueDays);

  let due_status: DueStatus;
  if (overdueDays > 0) {
    due_status = 'Overdue';
  } else if (!input.lastInspectionAt) {
    due_status = 'Not Yet Inspected';
  } else if (-overdueDays <= window) {
    due_status = 'Due Soon';
  } else {
    due_status = 'Completed';
  }

  return {
    next_due_date: new Date(dueMs).toISOString(),
    days_overdue: daysOverdue,
    due_status,
  };
}

// Sort order for the boxes list: Overdue (most overdue first), then Due Soon,
// then Not Yet Inspected, then recently Completed.
const RANK: Record<DueStatus, number> = {
  Overdue: 0,
  'Due Soon': 1,
  'Not Yet Inspected': 2,
  Completed: 3,
};

export function compareByDue(
  a: { due_status: DueStatus; days_overdue: number },
  b: { due_status: DueStatus; days_overdue: number },
): number {
  if (RANK[a.due_status] !== RANK[b.due_status]) return RANK[a.due_status] - RANK[b.due_status];
  // within Overdue, most overdue first
  return b.days_overdue - a.days_overdue;
}
