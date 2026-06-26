import type { MyBox, StatusTag } from '@/lib/client/types.ts';
import { StatusTagBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/client/format.ts';

// Accent color of the left icon block, by status.
const accent: Record<StatusTag, string> = {
  'Issue Found': 'bg-red-500',
  Overdue: 'bg-red-500',
  'Due Soon': 'bg-amber-500',
  'Not Due': 'bg-brand',
};

export function BoxCard({ box }: { box: MyBox }) {
  const isView = box.primary_action === 'view';
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl text-white ${accent[box.status_tag]}`}>
          <span aria-hidden>🧰</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold leading-tight">{box.box_code}</h2>
            <StatusTagBadge tag={box.status_tag} />
          </div>
          <p className="text-sm text-slate-600">{box.box_name}</p>
          <p className="text-sm text-slate-500">
            {box.location_description}
            {box.area ? ` · ${box.area}` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 p-4">
        <div className="text-sm">
          <p className="text-slate-500">{isView ? 'Next inspection' : 'Due date'}</p>
          <p className="font-semibold">{formatDate(box.next_due_date)}</p>
        </div>
        <a
          href={`/inspect/${box.box_id}`}
          className={`btn btn-lg ${isView ? 'btn-secondary' : 'btn-primary'} min-w-[7.5rem]`}
        >
          {isView ? 'View ›' : 'Inspect ›'}
        </a>
      </div>
    </div>
  );
}
