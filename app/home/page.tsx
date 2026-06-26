'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api.ts';
import type { Me, MyBoxesResponse } from '@/lib/client/types.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { BoxCard } from '@/components/BoxCard';
import { Spinner } from '@/components/Spinner';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomePage() {
  return <RequireAuth>{(me) => <Home me={me} />}</RequireAuth>;
}

function Home({ me }: { me: Me }) {
  const [data, setData] = useState<MyBoxesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myBoxes()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const firstName = me.full_name.split(' ')[0];

  return (
    <>
      <AppHeader title="First Aid Readiness" subtitle="ESH" />
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
        <div>
          <h2 className="text-2xl font-bold">
            {greeting()}, {firstName}
          </h2>
          {data && (
            <p className="text-slate-500">
              You have {data.count} first aid box{data.count === 1 ? '' : 'es'} assigned.
            </p>
          )}
        </div>

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

        <div className="space-y-3">
          {data?.boxes.map((box) => (
            <BoxCard key={box.box_id} box={box} />
          ))}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
