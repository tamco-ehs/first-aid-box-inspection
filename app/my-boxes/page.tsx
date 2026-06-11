'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import type { Me, MyBoxesResponse } from '@/lib/client/types.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BoxCard } from '@/components/BoxCard';
import { Spinner } from '@/components/Spinner';

export default function MyBoxesPage() {
  return <RequireAuth>{(me) => <MyBoxesInner me={me} />}</RequireAuth>;
}

function MyBoxesInner({ me }: { me: Me }) {
  const [data, setData] = useState<MyBoxesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          me.role === 'admin' || me.role === 'viewer' ? (
            <a href="/reports" className="btn btn-ghost btn-md text-slate-600">
              Reports
            </a>
          ) : undefined
        }
      />
      <main className="mx-auto max-w-3xl space-y-3 p-4" data-tour="box-list">
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
            <p className="px-1 text-sm text-slate-500">
              {data.count} box{data.count === 1 ? '' : 'es'} · overdue shown first
            </p>
            {data.boxes.map((box) => (
              <BoxCard key={box.box_id} box={box} />
            ))}
          </>
        )}
      </main>
    </>
  );
}
