// =============================================================================
// Reminder milestone selection for the daily cron. Pure + deterministic.
//
// Reminders fire at 7, 14, 21, 28 days overdue. The cron runs daily, but we
// must be robust to skipped days (e.g. it jumps 13 -> 15): we send the HIGHEST
// milestone reached that has not yet been sent, exactly once. Escalation to
// admin/EHS happens at the 28-day milestone.
// =============================================================================

export const REMINDER_MILESTONES = [7, 14, 21, 28] as const;
export const ESCALATION_MILESTONE = 28;

/** Highest milestone <= days, or 0 if none reached. */
export function milestoneFor(days: number): number {
  let m = 0;
  for (const ms of REMINDER_MILESTONES) {
    if (days >= ms) m = ms;
  }
  return m;
}

export interface ReminderDecision {
  send: boolean;
  milestone: number; // 0 when send=false
  escalate: boolean; // true when the milestone is the escalation point
}

/**
 * Decide whether to send a reminder for a box right now.
 * @param daysOverdue       current days overdue (<=0 means not overdue)
 * @param alreadySentMaxDays the largest days_overdue value previously logged as
 *                           successfully sent for this box (0 if none)
 */
export function decideReminder(daysOverdue: number, alreadySentMaxDays: number): ReminderDecision {
  const target = milestoneFor(daysOverdue);
  const covered = milestoneFor(Math.max(0, alreadySentMaxDays));

  if (target > 0 && target > covered) {
    return { send: true, milestone: target, escalate: target >= ESCALATION_MILESTONE };
  }
  return { send: false, milestone: 0, escalate: false };
}
