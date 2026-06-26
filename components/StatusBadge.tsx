import type { ReactNode } from 'react';
import type {
  ActionStatus,
  DueStatus,
  ItemCheckStatus,
  Priority,
  StatusTag,
} from '@/lib/client/types.ts';

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

// Box card status: Issue Found / Overdue / Due Soon / Not Due.
const tagTone: Record<StatusTag, Tone> = {
  'Issue Found': 'bad',
  Overdue: 'bad',
  'Due Soon': 'warn',
  'Not Due': 'ok',
};
export function StatusTagBadge({ tag }: { tag: StatusTag }) {
  const icon = tag === 'Issue Found' ? '⚠' : tag === 'Not Due' ? '🕑' : '';
  return (
    <Badge tone={tagTone[tag]}>
      {icon && <span aria-hidden>{icon}</span>}
      {tag.toUpperCase()}
    </Badge>
  );
}

const dueTone: Record<DueStatus, Tone> = {
  Overdue: 'bad',
  'Due Soon': 'warn',
  Completed: 'ok',
  'Not Yet Inspected': 'neutral',
};
export function DueBadge({ status }: { status: DueStatus }) {
  return <Badge tone={dueTone[status]}>{status}</Badge>;
}

export function ReadinessBadge({ status }: { status: string }) {
  return <Badge tone={status === 'Ready' ? 'ok' : 'bad'}>{status}</Badge>;
}

const itemTone: Record<ItemCheckStatus, Tone> = {
  OK: 'ok',
  'Low Qty': 'warn',
  Missing: 'bad',
  Expired: 'bad',
};
export function ItemCheckBadge({ status }: { status: ItemCheckStatus }) {
  return <Badge tone={itemTone[status]}>{status}</Badge>;
}

const priorityTone: Record<Priority, Tone> = { High: 'bad', Medium: 'warn', Low: 'neutral' };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priorityTone[priority]}>{priority}</Badge>;
}

const actionStatusTone: Record<ActionStatus, Tone> = {
  Open: 'warn',
  'In Progress': 'warn',
  Closed: 'ok',
  Rejected: 'neutral',
};
export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  return <Badge tone={actionStatusTone[status]}>{status}</Badge>;
}
