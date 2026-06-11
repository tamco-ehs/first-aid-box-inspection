import type { MyBox } from '@/lib/client/types.ts';
import { DueBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/client/format.ts';

export function BoxCard({ box }: { box: MyBox }) {
  const expiryIssues =
    box.expiry_summary.expired +
    box.expiry_summary.expiring_30 +
    box.expiry_summary.expiring_60 +
    box.expiry_summary.missing_date +
    box.expiry_summary.mismatch;

  return (
    <div className="card p-4" data-tour="box-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">{box.box_code}</p>
          <h2 className="truncate text-base font-bold">{box.box_name}</h2>
        </div>
        <DueBadge status={box.due_status} daysOverdue={box.days_overdue} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-500">Location</dt>
        <dd className="text-right">{box.location_description}</dd>
        {box.area && (
          <>
            <dt className="text-slate-500">Area</dt>
            <dd className="text-right">{box.area}</dd>
          </>
        )}
        <dt className="text-slate-500">Last inspection</dt>
        <dd className="text-right">{formatDate(box.last_inspection_date)}</dd>
        <dt className="text-slate-500">Due date</dt>
        <dd className="text-right">{formatDate(box.next_due_date)}</dd>
      </dl>

      {expiryIssues > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Expiry attention</p>
          <p>
            {box.expiry_summary.expired > 0 && `${box.expiry_summary.expired} expired. `}
            {box.expiry_summary.expiring_30 > 0 && `${box.expiry_summary.expiring_30} due within 30d. `}
            {box.expiry_summary.expiring_60 > 0 && `${box.expiry_summary.expiring_60} due within 60d. `}
            {box.expiry_summary.missing_date > 0 && `${box.expiry_summary.missing_date} missing date. `}
            {box.expiry_summary.mismatch > 0 && `${box.expiry_summary.mismatch} label issue. `}
          </p>
        </div>
      )}

      <a href={`/inspect/${box.box_id}`} className="btn btn-lg btn-primary mt-4 w-full" data-tour="inspect-link">
        Start inspection
      </a>
    </div>
  );
}
