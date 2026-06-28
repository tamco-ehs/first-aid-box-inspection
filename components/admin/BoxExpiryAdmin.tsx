'use client';

import { useMemo, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { computeBoxDue, DUE_SOON_WINDOW_DAYS } from '@/lib/logic/due.ts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Notice, Section, useAsync } from './shared.tsx';

interface BoxExpiryRow {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  created_at: string;
  inspection_frequency_days: number;
  box_expiry_start_date: string | null;
  is_active: boolean;
}

interface InspectionRow {
  box_id: string;
  created_at: string;
}

interface RowView extends BoxExpiryRow {
  latestInspectionAt: string | null;
  countFrom: string;
  countFromSource: 'last_inspection' | 'manual_start' | 'box_created';
  nextDueDate: string;
  emailStartDate: string;
  daysRemaining: number;
  daysOverdue: number;
  status: 'Active' | 'Inactive' | 'Expired' | 'Due Soon' | 'Current' | 'Not Yet Inspected';
}

const MS_PER_DAY = 86_400_000;

function isMissingExpiryStartDateColumn(message: string): boolean {
  return message.includes('box_expiry_start_date');
}

export function BoxExpiryAdmin() {
  const sb = getSupabaseBrowserClient();
  const rows = useAsync<RowView[]>(async () => {
    const boxSelectWithStartDate =
      'id, box_code, box_name, location_description, area, created_at, inspection_frequency_days, box_expiry_start_date, is_active';
    const boxSelectFallback =
      'id, box_code, box_name, location_description, area, created_at, inspection_frequency_days, is_active';
    const [boxResult, { data: inspectionData, error: inspectionError }] = await Promise.all([
      sb.from('boxes').select(boxSelectWithStartDate).order('box_code'),
      sb.from('inspections').select('box_id, created_at').order('created_at', { ascending: false }),
    ]);
    let { data: boxData, error: boxError } = boxResult;
    if (boxError && isMissingExpiryStartDateColumn(boxError.message)) {
      const fallback = await sb.from('boxes').select(boxSelectFallback).order('box_code');
      boxData = (fallback.data ?? []).map((box) => ({ ...box, box_expiry_start_date: null }));
      boxError = fallback.error;
    }
    if (boxError) throw new Error(boxError.message);
    if (inspectionError) throw new Error(inspectionError.message);

    const latestByBox = new Map<string, string>();
    for (const row of (inspectionData ?? []) as InspectionRow[]) {
      if (!latestByBox.has(row.box_id)) latestByBox.set(row.box_id, row.created_at);
    }

    const now = new Date();
    return ((boxData ?? []) as BoxExpiryRow[])
      .map((box) => toRowView(box, latestByBox.get(box.id) ?? null, now))
      .sort((a, b) => sortRows(a, b));
  });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (rows.loading) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {rows.error && <Notice kind="error">{rows.error}</Notice>}

      <Section title="Box expiry">
        <div className="overflow-x-auto">
          <table className="min-w-[1060px] w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Box</th>
                <th className="px-3 py-2">Start date</th>
                <th className="px-3 py-2">Count from</th>
                <th className="px-3 py-2">Expire date</th>
                <th className="px-3 py-2">Email starts</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Expire after</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((row) => (
                <ExpiryRow
                  key={row.id}
                  row={row}
                  onSaved={() => {
                    setMsg({ kind: 'ok', text: `Saved ${row.box_code}.` });
                    rows.reload();
                  }}
                  onError={(text) => setMsg({ kind: 'error', text })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ExpiryRow({
  row,
  onSaved,
  onError,
}: {
  row: RowView;
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [days, setDays] = useState(row.inspection_frequency_days);
  const [startDate, setStartDate] = useState(toDateInput(row.box_expiry_start_date));
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () =>
      toRowView(
        {
          ...row,
          inspection_frequency_days: days,
          box_expiry_start_date: startDate || null,
        },
        row.latestInspectionAt,
        new Date(),
      ),
    [days, row, startDate],
  );
  const unchanged = days === row.inspection_frequency_days && (startDate || null) === (row.box_expiry_start_date ?? null);

  async function save() {
    setBusy(true);
    try {
      const { error } = await sb
        .from('boxes')
        .update({
          inspection_frequency_days: Math.max(1, Number(days) || row.inspection_frequency_days),
          box_expiry_start_date: startDate || null,
        })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save expiry days.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="align-middle">
      <td className="rounded-l-lg border-y border-l border-slate-200 bg-white px-3 py-3">
        <p className="font-bold text-slate-950">{row.box_code}</p>
        <p className="text-xs text-slate-600">{row.box_name}</p>
        <p className="text-xs text-slate-500">{[row.location_description, row.area].filter(Boolean).join(' - ')}</p>
      </td>
      <td className="border-y border-slate-200 bg-white px-3 py-3">
        <input
          type="date"
          className="input w-40"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <button type="button" className="mt-1 block text-xs font-semibold text-brand" onClick={() => setStartDate('')}>
          Use default
        </button>
      </td>
      <td className="border-y border-slate-200 bg-white px-3 py-3">
        <p>{formatDate(preview.countFrom)}</p>
        <p className="text-xs text-slate-500">{sourceLabel(preview.countFromSource)}</p>
      </td>
      <td className="border-y border-slate-200 bg-white px-3 py-3 font-semibold">{formatDate(preview.nextDueDate)}</td>
      <td className="border-y border-slate-200 bg-white px-3 py-3">{formatDate(preview.emailStartDate)}</td>
      <td className="border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          <Badge tone={statusTone(preview.status)}>{preview.status}</Badge>
          <span className="text-xs text-slate-500">{statusDetail(preview)}</span>
        </div>
      </td>
      <td className="border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            className="input w-24"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <span className="text-xs text-slate-500">days</span>
        </div>
      </td>
      <td className="rounded-r-lg border-y border-r border-slate-200 bg-white px-3 py-3 text-right">
        <button onClick={save} disabled={busy || unchanged} className="btn btn-md btn-primary">
          {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
        </button>
      </td>
    </tr>
  );
}

function toRowView(box: BoxExpiryRow, latestInspectionAt: string | null, now: Date): RowView {
  const due = computeBoxDue({
    lastInspectionAt: latestInspectionAt,
    boxCreatedAt: box.created_at,
    boxExpiryStartDate: box.box_expiry_start_date,
    frequencyDays: box.inspection_frequency_days,
    now,
  });
  const nextDue = new Date(due.next_due_date);
  const emailStart = new Date(nextDue.getTime() - DUE_SOON_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const daysRemaining = Math.max(0, Math.ceil((nextDue.getTime() - now.getTime()) / MS_PER_DAY));

  return {
    ...box,
    latestInspectionAt,
    countFrom: due.reference_date,
    countFromSource: due.reference_source,
    nextDueDate: due.next_due_date,
    emailStartDate: emailStart,
    daysRemaining,
    daysOverdue: due.days_overdue,
    status: box.is_active ? mapStatus(due.due_status) : 'Inactive',
  };
}

function mapStatus(status: string): RowView['status'] {
  if (status === 'Overdue') return 'Expired';
  if (status === 'Completed') return 'Current';
  return status as RowView['status'];
}

function statusTone(status: RowView['status']): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'Expired') return 'bad';
  if (status === 'Due Soon' || status === 'Not Yet Inspected') return 'warn';
  if (status === 'Inactive') return 'neutral';
  return 'ok';
}

function statusDetail(row: RowView): string {
  if (row.status === 'Inactive') return 'Not included';
  if (row.daysOverdue > 0) return `${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'} expired`;
  return `${row.daysRemaining} day${row.daysRemaining === 1 ? '' : 's'} left`;
}

function sortRows(a: RowView, b: RowView): number {
  const rank = (row: RowView) => {
    if (row.status === 'Expired') return 0;
    if (row.status === 'Due Soon') return 1;
    if (row.status === 'Not Yet Inspected') return 2;
    if (row.status === 'Current') return 3;
    return 4;
  };
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function sourceLabel(source: RowView['countFromSource']): string {
  if (source === 'last_inspection') return 'Last inspection';
  if (source === 'manual_start') return 'Manual start';
  return 'Box created';
}
