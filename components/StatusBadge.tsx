import type { ReactNode } from 'react';
import type { DueStatus, ItemStatus, OverallStatus, Priority } from '@/lib/client/types.ts';

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
  Missing: 'bad',
  Expired: 'bad',
  Damaged: 'bad',
  'Not Applicable': 'neutral',
};
export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <Badge tone={itemTone[status]}>{status}</Badge>;
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
