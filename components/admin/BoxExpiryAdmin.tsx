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
        <div className="space-y-3">
          {(rows.data ?? []).map((row) => (
            <ExpiryRow
              key={row.id}
              row={row}
              onSaved={(text) => {
                setMsg({ kind: 'ok', text: text ?? `Saved ${row.box_code}.` });
                rows.reload();
              }}
              onError={(text) => setMsg({ kind: 'error', text })}
            />
          ))}
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
  onSaved: (text?: string) => void;
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

  async function save() {
    setBusy(true);
    const nextDays = Math.max(1, Number(days) || row.inspection_frequency_days);
    try {
      const { error } = await sb
        .from('boxes')
        .update({
          inspection_frequency_days: nextDays,
          box_expiry_start_date: startDate || null,
        })
        .eq('id', row.id);
      if (error && isMissingExpiryStartDateColumn(error.message)) {
        const fallback = await sb
          .from('boxes')
          .update({ inspection_frequency_days: nextDays })
          .eq('id', row.id);
        if (fallback.error) throw new Error(fallback.error.message);
        onSaved(`Saved expire after for ${row.box_code}. Start date needs the Supabase box_expiry_start_date migration.`);
        return;
      }
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save expiry days.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-950">{row.box_code}</p>
          <p className="text-sm text-slate-700">{row.box_name}</p>
          <p className="text-xs text-slate-500">{[row.location_description, row.area].filter(Boolean).join(' - ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(preview.status)}>{preview.status}</Badge>
          <span className="text-xs text-slate-500">{statusDetail(preview)}</span>
          <button type="button" onClick={save} disabled={busy} className="btn btn-md btn-primary">
            {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="label">Start date</span>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <button type="button" className="mt-1 text-xs font-semibold text-brand" onClick={() => setStartDate('')}>
            Use default
          </button>
        </label>
        <label className="block">
          <span className="label">Expire after</span>
          <input
            type="number"
            min={1}
            className="input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <span className="mt-1 block text-xs text-slate-500">days</span>
        </label>
        <Info label="Count from" value={formatDate(preview.countFrom)} sub={sourceLabel(preview.countFromSource)} />
        <Info label="Expire date" value={formatDate(preview.nextDueDate)} strong />
        <Info label="Email starts" value={formatDate(preview.emailStartDate)} />
      </div>
    </div>
  );
}

function Info({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={strong ? 'font-semibold text-slate-950' : 'text-slate-800'}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
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
