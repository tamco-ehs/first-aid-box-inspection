'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client/api.ts';
import type { Me, MyBoxesResponse } from '@/lib/client/types.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { BoxCard } from '@/components/BoxCard';
import { Spinner } from '@/components/Spinner';

export default function MyBoxesPage() {
  return <RequireAuth>{(me) => <MyBoxesInner me={me} />}</RequireAuth>;
}

function MyBoxesInner({ me }: { me: Me }) {
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter');
  const [data, setData] = useState<MyBoxesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredBoxes = useMemo(() => {
    const boxes = data?.boxes ?? [];
    if (filter === 'overdue') return boxes.filter((box) => box.due_status === 'Overdue');
    if (filter === 'due-this-month') {
      const month = new Date().toISOString().slice(0, 7);
      return boxes.filter((box) => box.next_due_date.startsWith(month));
    }
    return boxes;
  }, [data, filter]);

  const filterLabel =
    filter === 'overdue' ? 'Overdue boxes' : filter === 'due-this-month' ? 'Boxes due this month' : null;

  useEffect(() => {
    api
      .myBoxes()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <AppHeader
        title="My First Aid Boxes"
        subtitle={me.full_name}
        right={
          me.role === 'superadmin' || me.role === 'admin' ? (
            <a href="/reports" className="btn btn-ghost btn-md text-slate-600">
              Dashboard
            </a>
          ) : undefined
        }
      />
      <main className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        )}

        {!data && !error && (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner className="h-7 w-7" />
          </div>
        )}

        {data && data.boxes.length === 0 && (
          <div className="card p-8 text-center text-slate-500">
            No first aid box assigned to you. Please contact EHS/Admin.
          </div>
        )}

        {data && data.boxes.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 px-1 text-sm text-slate-500">
              <p>
                {filterLabel ?? `${data.count} box${data.count === 1 ? '' : 'es'}`} - overdue shown first
              </p>
              {filterLabel && (
                <a href="/my-boxes" className="font-semibold text-brand">
                  Show all
                </a>
              )}
            </div>
            {filteredBoxes.length === 0 && (
              <div className="card p-8 text-center text-slate-500">No boxes match this dashboard link.</div>
            )}
            {filteredBoxes.map((box) => (
              <BoxCard key={box.box_id} box={box} />
            ))}
          </>
        )}
      </main>
      <BottomNav />
    </>
  );
}
