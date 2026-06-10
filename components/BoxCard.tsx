import type { MyBox } from '@/lib/client/types.ts';
import { DueBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/client/format.ts';

export function BoxCard({ box }: { box: MyBox }) {
  return (
    <div className="card p-4">
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

      <a href={`/inspect/${box.box_id}`} className="btn btn-lg btn-primary mt-4 w-full">
        Start inspection
      </a>
    </div>
  );
}
