import type { ReactNode } from 'react';
import type { DueStatus, FinalItemStatus, ItemStatus, OverallStatus, Priority } from '@/lib/client/types.ts';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const toneClass: Record<Tone, string> = {
  ok: 'status-ok',
  warn: 'status-warn',
  bad: 'status-bad',
  neutral: 'status-neutral',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${toneClass[tone]}`}>{children}</span>;
}

const dueTone: Record<DueStatus, Tone> = {
  Overdue: 'bad',
  'Due Soon': 'warn',
  Completed: 'ok',
  'Not Yet Inspected': 'neutral',
};
export function DueBadge({ status, daysOverdue }: { status: DueStatus; daysOverdue?: number }) {
  const label =
    status === 'Overdue' && daysOverdue ? `Overdue ${daysOverdue}d` : status;
  return <Badge tone={dueTone[status]}>{label}</Badge>;
}

const itemTone: Record<ItemStatus, Tone> = {
  OK: 'ok',
  'Low Stock': 'warn',
  'Expiring Soon': 'warn',
  'No Expiry Date': 'bad',
  'Expiry Label Mismatch': 'warn',
  Missing: 'bad',
  Expired: 'bad',
  Damaged: 'bad',
  'Not Applicable': 'neutral',
};
export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <Badge tone={itemTone[status]}>{status}</Badge>;
}

// The badge-facing verdict shown on the inspection card (combines condition +
// expiry). An expiry-tracked item stays "Needs expiry check" until verified.
const finalTone: Record<FinalItemStatus, Tone> = {
  pending: 'neutral',
  ok: 'ok',
  ok_quantity_updated: 'ok',
  incomplete: 'warn',
  expiry_baseline_missing: 'warn',
  issue_found: 'bad',
  topup_required: 'warn',
  replacement_required: 'bad',
};
const finalLabel: Record<FinalItemStatus, string> = {
  pending: 'Pending',
  ok: 'OK',
  ok_quantity_updated: 'OK · qty updated',
  incomplete: 'Needs expiry check',
  expiry_baseline_missing: 'Record expiry',
  issue_found: 'Issue found',
  topup_required: 'Top-up',
  replacement_required: 'Replace now',
};
export function FinalItemStatusBadge({ status }: { status: FinalItemStatus }) {
  return <Badge tone={finalTone[status]}>{finalLabel[status]}</Badge>;
}

const overallTone: Record<OverallStatus, Tone> = {
  Pass: 'ok',
  'Needs Restock': 'warn',
  Fail: 'bad',
};
export function OverallBadge({ status }: { status: OverallStatus }) {
  return <Badge tone={overallTone[status]}>{status}</Badge>;
}

const priorityTone: Record<Priority, Tone> = {
  High: 'bad',
  Medium: 'warn',
  Low: 'neutral',
};
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priorityTone[priority]}>{priority}</Badge>;
}
